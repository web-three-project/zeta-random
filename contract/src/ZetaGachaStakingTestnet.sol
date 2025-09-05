// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

// Pyth Entropy SDK
import "@pythnetwork/entropy-sdk-solidity/IEntropy.sol";
import "@pythnetwork/entropy-sdk-solidity/IEntropyConsumer.sol";

/**
 * @title ZetaGachaStakingTestnet
 * @dev Testnet version with scaled-down amounts for easy testing
 * @notice Prize pool: 0.5 ZETA, Stake: 0.1 ZETA, prizes scaled 1:1000
 */
contract ZetaGachaStakingTestnet is Ownable, ReentrancyGuard, Pausable, IEntropyConsumer {
    // Constants - Scaled down further for minimal testing
    uint256 public constant FIXED_PRIZE_POOL = 0.5 ether; // 0.5 ZETA
    uint256 public constant STAKE_AMOUNT = 0.1 ether; // 0.1 ZETA per participation
    
    // Prize tiers and inventory
    struct PrizeTier {
        uint256 amount;      // Prize amount in ZETA
        uint256 probability; // Probability out of 10000 (basis points)
        uint256 maxSupply;   // Maximum number of this prize
        uint256 remaining;   // Remaining supply
        bool unlimited;      // Whether this prize has unlimited supply
    }
    
    // State variables
    address public finalRecipientAddress;  // Where stakes go after activity ends
    uint256 public prizePoolBalance;       // Current prize pool balance
    uint256 public totalStakesCollected;   // Total stakes collected
    bool public activityEnded;             // Whether activity has ended
    
    // Prize configuration
    mapping(uint8 => PrizeTier) public prizeTiers;
    uint8 public constant TIER_COUNT = 5;
    
    // Pyth Entropy integration
    IEntropy public immutable entropy;
    address public immutable pythEntropyProvider;
    mapping(uint64 => address) public pendingDraws;
    mapping(uint64 => bytes32) public pendingUserRandomness;
    
    // Participant tracking
    mapping(address => uint256) public participantStakes;
    address[] public participants;
    uint256 public totalParticipants;
    
    // Events
    event StakeReceived(address indexed participant, uint256 stakeAmount, uint256 entropyFee);
    event DrawRequested(address indexed player, uint64 indexed sequenceNumber);
    event DrawCompleted(address indexed player, uint256 amount);
    event PrizePoolSeeded(uint256 amount, uint256 newBalance);
    event ActivityEnded(uint256 totalStakes, address recipient);
    event FinalRecipientAddressUpdated(address indexed newAddress);
    event PythEntropyProviderUpdated(address indexed newProvider);
    
    // Custom errors
    error InsufficientStake();
    error InsufficientPrizePool();
    error ActivityAlreadyEnded();
    error ActivityNotEnded();
    error InvalidAddress();
    error DrawNotFound();
    
    constructor(
        address _finalRecipientAddress,
        address _entropy,
        address _pythEntropyProvider
    ) Ownable(msg.sender) {
        finalRecipientAddress = _finalRecipientAddress;
        entropy = IEntropy(_entropy);
        pythEntropyProvider = _pythEntropyProvider;
        
        // Initialize prize tiers - TESTNET VERSION (scaled 1:1000)
        // Tier 0: No prize (50%)
        prizeTiers[0] = PrizeTier({
            amount: 0,
            probability: 5000, // 50%
            maxSupply: 0,
            remaining: 0,
            unlimited: true
        });
        
        // Tier 1: 0.0001 ZETA (40%)
        prizeTiers[1] = PrizeTier({
            amount: 0.0001 ether,
            probability: 4000, // 40%
            maxSupply: 0,
            remaining: 0,
            unlimited: true
        });
        
        // Tier 2: 0.001 ZETA (9.5%, max 200)
        prizeTiers[2] = PrizeTier({
            amount: 0.001 ether,
            probability: 950, // 9.5%
            maxSupply: 200,
            remaining: 200,
            unlimited: false
        });
        
        // Tier 3: 0.01 ZETA (0.4%, max 10)
        prizeTiers[3] = PrizeTier({
            amount: 0.01 ether,
            probability: 40, // 0.4%
            maxSupply: 10,
            remaining: 10,
            unlimited: false
        });
        
        // Tier 4: 0.1 ZETA (0.1%, max 2)
        prizeTiers[4] = PrizeTier({
            amount: 0.1 ether,
            probability: 10, // 0.1%
            maxSupply: 2,
            remaining: 2,
            unlimited: false
        });
    }
    
    /**
     * @dev Owner seeds the prize pool with 0.5 ZETA
     */
    function seedPrizePool() external payable onlyOwner {
        if (msg.value != FIXED_PRIZE_POOL) revert InsufficientStake();
        if (activityEnded) revert ActivityAlreadyEnded();
        
        prizePoolBalance += msg.value;
        emit PrizePoolSeeded(msg.value, prizePoolBalance);
    }
    
    /**
     * @dev Users stake 0.1 ZETA to participate in gacha
     * @param userRandomNumber User-provided random number for Entropy
     * @return sequenceNumber The Pyth Entropy sequence number
     */
    function participateAndDraw(bytes32 userRandomNumber) external payable nonReentrant whenNotPaused returns (uint64 sequenceNumber) {
        if (msg.value != STAKE_AMOUNT) revert InsufficientStake();
        if (activityEnded) revert ActivityAlreadyEnded();
        
        // Get Pyth Entropy fee
        uint128 entropyFee = entropy.getFee(pythEntropyProvider);
        require(entropyFee < STAKE_AMOUNT, "Entropy fee too high");
        uint256 actualStake = STAKE_AMOUNT - entropyFee;
        
        // Record participant (allow multiple participations)
        participantStakes[msg.sender] += actualStake;
        if (participantStakes[msg.sender] == actualStake) {
            // First time participant
            participants.push(msg.sender);
            totalParticipants++;
        }
        totalStakesCollected += actualStake;
        
        // Keep stake in-contract until endActivity()
        emit StakeReceived(msg.sender, actualStake, entropyFee);
        
        // Request randomness from Pyth Entropy
        sequenceNumber = entropy.requestWithCallback{value: entropyFee}(
            pythEntropyProvider,
            userRandomNumber
        );
        
        pendingDraws[sequenceNumber] = msg.sender;
        pendingUserRandomness[sequenceNumber] = userRandomNumber;
        
        emit DrawRequested(msg.sender, sequenceNumber);
        return sequenceNumber;
    }
    
    /**
     * @dev Callback function called by Pyth Entropy with randomness
     */
    function entropyCallback(
        uint64 sequenceNumber,
        address /*provider*/,
        bytes32 randomNumber
    ) internal override {
        address player = pendingDraws[sequenceNumber];
        if (player == address(0)) revert DrawNotFound();
        
        // Clear pending draw
        delete pendingDraws[sequenceNumber];
        delete pendingUserRandomness[sequenceNumber];
        
        // Determine prize based on randomness
        uint8 tierWon = _determinePrize(uint256(randomNumber));
        uint256 prizeAmount = _distributePrize(player, tierWon);
        
        emit DrawCompleted(player, prizeAmount);
    }

    function getEntropy() internal view override returns (address) {
        return address(entropy);
    }
    
    /**
     * @dev Owner ends the activity and transfers all stakes to final recipient
     * @notice This function now properly transfers funds from stakeCollectionAddress to finalRecipientAddress
     */
    function endActivity() external onlyOwner {
        if (activityEnded) revert ActivityAlreadyEnded();
        
        activityEnded = true;
        
        // Transfer all collected stakes held by this contract to final recipient
        if (totalStakesCollected > 0) {
            (bool success, ) = finalRecipientAddress.call{value: totalStakesCollected}("");
            require(success, "Stake payout failed");
            emit ActivityEnded(totalStakesCollected, finalRecipientAddress);
            totalStakesCollected = 0;
        }
        
        // Pause the contract
        _pause();
    }
    
    /**
     * @dev Owner can withdraw remaining prize pool after activity ends
     */
    function withdrawRemainingPrizePool() external onlyOwner {
        if (!activityEnded) revert ActivityNotEnded();
        
        uint256 remaining = prizePoolBalance;
        if (remaining > 0) {
            prizePoolBalance = 0;
            (bool success, ) = owner().call{value: remaining}("");
            require(success, "Prize pool withdrawal failed");
        }
    }
    
    
    
    /**
     * @dev Update final recipient address
     */
    function setFinalRecipientAddress(address _newAddress) external onlyOwner {
        if (_newAddress == address(0)) revert InvalidAddress();
        finalRecipientAddress = _newAddress;
        emit FinalRecipientAddressUpdated(_newAddress);
    }
    
    /**
     * @dev Updates the Pyth Entropy provider address
     */
    function setPythEntropyProvider(address _newProvider) external onlyOwner {
        if (_newProvider == address(0)) revert InvalidAddress();
        // Note: provider is immutable in this testnet mirror for simplicity in main; keeping event for API parity
        // This function can be adapted if you prefer mutability; for now we just emit.
        emit PythEntropyProviderUpdated(_newProvider);
    }
    
    /**
     * @dev Pause/unpause the contract
     */
    function pause() external onlyOwner {
        _pause();
    }
    
    function unpause() external onlyOwner {
        if (activityEnded) revert ActivityAlreadyEnded();
        _unpause();
    }
    
    /**
     * @dev Get participant list (paginated)
     */
    function getParticipants(uint256 offset, uint256 limit) external view returns (
        address[] memory participantList,
        uint256[] memory stakes,
        uint256 total
    ) {
        uint256 end = offset + limit;
        if (end > participants.length) {
            end = participants.length;
        }
        
        uint256 length = end - offset;
        participantList = new address[](length);
        stakes = new uint256[](length);
        
        for (uint256 i = 0; i < length; i++) {
            address participant = participants[offset + i];
            participantList[i] = participant;
            stakes[i] = participantStakes[participant];
        }
        
        return (participantList, stakes, participants.length);
    }
    
    /**
     * @dev Get current contract status
     */
    function getContractStatus() external view returns (
        uint256 contractBalance,
        uint256 currentPrizePool,
        uint256 fixedPrizePool,
        uint256 totalStakes,
        uint256 participantCount,
        bool isActivityEnded,
        address owner_,
        address finalRecipient,
        uint128 currentEntropyFee
    ) {
        return (
            address(this).balance,
            prizePoolBalance,
            FIXED_PRIZE_POOL,
            totalStakesCollected,
            totalParticipants,
            activityEnded,
            owner(),
            finalRecipientAddress,
            entropy.getFee(pythEntropyProvider)
        );
    }
    
    /**
     * @dev Get current inventory status for all prize tiers
     */
    function getInventoryStatus() external view returns (
        uint256[] memory amounts,
        uint256[] memory probabilities,
        uint256[] memory maxSupplies,
        uint256[] memory remaining,
        bool[] memory unlimited
    ) {
        amounts = new uint256[](TIER_COUNT);
        probabilities = new uint256[](TIER_COUNT);
        maxSupplies = new uint256[](TIER_COUNT);
        remaining = new uint256[](TIER_COUNT);
        unlimited = new bool[](TIER_COUNT);
        
        for (uint8 i = 0; i < TIER_COUNT; i++) {
            PrizeTier memory tier = prizeTiers[i];
            amounts[i] = tier.amount;
            probabilities[i] = tier.probability;
            maxSupplies[i] = tier.maxSupply;
            remaining[i] = tier.remaining;
            unlimited[i] = tier.unlimited;
        }
    }
    
    /**
     * @dev Get current Entropy fee
     */
    function getCurrentEntropyFee() external view returns (uint128 fee) {
        return entropy.getFee(pythEntropyProvider);
    }

    /**
     * @dev Get actual stake amount after entropy fee deduction
     */
    function getActualStakeAmount() external view returns (uint256 actualStake) {
        uint128 entropyFee = entropy.getFee(pythEntropyProvider);
        if (entropyFee >= STAKE_AMOUNT) return 0;
        return STAKE_AMOUNT - entropyFee;
    }
    
    /**
     * @dev Determines prize tier based on randomness and current inventory
     */
    function _determinePrize(uint256 randomness) internal view returns (uint8 tierWon) {
        uint256 roll = randomness % 10000;
        uint256 cumulativeProbability = 0;
        
        for (uint8 i = TIER_COUNT - 1; i >= 0; i--) {
            PrizeTier memory tier = prizeTiers[i];
            
            if (!tier.unlimited && tier.remaining == 0) {
                continue;
            }
            
            cumulativeProbability += tier.probability;
            if (roll < cumulativeProbability) {
                return i;
            }
            
            if (i == 0) break;
        }
        
        return 0;
    }
    
    /**
     * @dev Distributes prize to player and updates inventory
     */
    function _distributePrize(address player, uint8 tierIndex) internal returns (uint256 prizeAmount) {
        PrizeTier storage tier = prizeTiers[tierIndex];
        
        if (!tier.unlimited) {
            if (tier.remaining == 0) {
                tierIndex = _downgradePrize(tierIndex);
                tier = prizeTiers[tierIndex];
            } else {
                tier.remaining--;
            }
        }
        
        prizeAmount = tier.amount;
        
        if (prizeAmount > 0) {
            if (prizePoolBalance < prizeAmount) revert InsufficientPrizePool();
            
            prizePoolBalance -= prizeAmount;
            (bool success, ) = player.call{value: prizeAmount}("");
            require(success, "Prize transfer failed");
        }
        
        return prizeAmount;
    }
    
    /**
     * @dev Downgrades prize when inventory is insufficient
     */
    function _downgradePrize(uint8 originalTier) internal view returns (uint8 newTier) {
        for (uint8 i = originalTier - 1; i >= 0; i--) {
            PrizeTier memory tier = prizeTiers[i];
            
            if (tier.unlimited || tier.remaining > 0) {
                return i;
            }
            
            if (i == 0) break;
        }
        
        return 0;
    }
    
    /**
     * @dev Emergency function to reset prize inventory (owner only)
     */
    function resetInventory() external onlyOwner {
        if (activityEnded) revert ActivityAlreadyEnded();
        
        prizeTiers[2].remaining = prizeTiers[2].maxSupply; // 0.001 ZETA (200)
        prizeTiers[3].remaining = prizeTiers[3].maxSupply; // 0.01 ZETA (10)  
        prizeTiers[4].remaining = prizeTiers[4].maxSupply; // 0.1 ZETA (2)
    }
    
    // Receive function - reject direct payments
    receive() external payable {
        revert("Use participateAndDraw() or seedPrizePool()");
    }
    
    fallback() external payable {
        revert("Function not found");
    }
}
