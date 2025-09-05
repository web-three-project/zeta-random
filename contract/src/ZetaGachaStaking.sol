// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

// Official Pyth Entropy SDK imports
import "@pythnetwork/entropy-sdk-solidity/IEntropy.sol";
import "@pythnetwork/entropy-sdk-solidity/IEntropyConsumer.sol";

/**
 * @title ZetaGachaStaking
 * @dev Staking-based gacha with fixed prize pool using Pyth Entropy for secure randomness
 * @notice Users stake 1 ZETA to participate, stakes go to collection address
 * Fixed prize pool of 5000 ZETA, activity can be ended by owner
 * Prize tiers match front.jsx exactly
 */
contract ZetaGachaStaking is Ownable, ReentrancyGuard, Pausable, IEntropyConsumer {
    using Strings for uint256;
    // Constants
    uint256 public constant FIXED_PRIZE_POOL = 5000 ether; // 5000 ZETA
    uint256 public constant STAKE_AMOUNT = 1 ether; // 1 ZETA per participation
    
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
    address public immutable entropyProvider;
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
    
    // Custom errors
    error InsufficientStake();
    error InsufficientPrizePool();
    error ActivityAlreadyEnded();
    error ActivityNotEnded();
    error InvalidAddress();
    error DrawNotFound();
    error OnlyEntropy();
    error EntropyFeeTooHigh();
    
    constructor(
        address _finalRecipientAddress,
        address _entropy,
        address _entropyProvider
    ) Ownable(msg.sender) {
        finalRecipientAddress = _finalRecipientAddress;
        entropy = IEntropy(_entropy);
        entropyProvider = _entropyProvider;
        
        // Initialize prize tiers - MATCHING front.jsx EXACTLY
        // Tier 0: No prize (50%)
        prizeTiers[0] = PrizeTier({
            amount: 0,
            probability: 5000, // 50%
            maxSupply: 0,
            remaining: 0,
            unlimited: true
        });
        
        // Tier 1: 1 ZETA (40%) - CORRECTED from 35%
        prizeTiers[1] = PrizeTier({
            amount: 1 ether,
            probability: 4000, // 40%
            maxSupply: 0,
            remaining: 0,
            unlimited: true
        });
        
        // Tier 2: 10 ZETA (9.5%, max 200) - CORRECTED from 12% max 100
        prizeTiers[2] = PrizeTier({
            amount: 10 ether,
            probability: 950, // 9.5%
            maxSupply: 200,
            remaining: 200,
            unlimited: false
        });
        
        // Tier 3: 100 ZETA (0.4%, max 10) - CORRECTED from 50 ZETA 2.5% max 20
        prizeTiers[3] = PrizeTier({
            amount: 100 ether,
            probability: 40, // 0.4%
            maxSupply: 10,
            remaining: 10,
            unlimited: false
        });
        
        // Tier 4: 1000 ZETA (0.1%, max 2) - CORRECTED from 500 ZETA 0.5% max 5
        prizeTiers[4] = PrizeTier({
            amount: 1000 ether,
            probability: 10, // 0.1%
            maxSupply: 2,
            remaining: 2,
            unlimited: false
        });
    }
    
    /**
     * @dev Owner seeds the prize pool with 5000 ZETA
     */
    function seedPrizePool() external payable onlyOwner {
        if (msg.value != FIXED_PRIZE_POOL) revert InsufficientStake();
        if (activityEnded) revert ActivityAlreadyEnded();
        
        prizePoolBalance += msg.value;
        emit PrizePoolSeeded(msg.value, prizePoolBalance);
    }
    
    /**
     * @dev Users stake 1 ZETA to participate in gacha
     * @param userRandomNumber User-provided random number for Entropy
     * @return sequenceNumber The Pyth Entropy sequence number
     */
    function participateAndDraw(bytes32 userRandomNumber) external payable nonReentrant whenNotPaused returns (uint64 sequenceNumber) {
        if (msg.value != STAKE_AMOUNT) revert InsufficientStake();
        if (activityEnded) revert ActivityAlreadyEnded();
        
        // Get Pyth Entropy fee
        uint128 entropyFee = entropy.getFee(entropyProvider);
        if (entropyFee >= STAKE_AMOUNT) revert EntropyFeeTooHigh();
        
        uint256 actualStake = STAKE_AMOUNT - entropyFee;
        
        // Record participant (allow multiple participations)
        participantStakes[msg.sender] += actualStake;
        if (participantStakes[msg.sender] == actualStake) {
            // First time participant
            participants.push(msg.sender);
            totalParticipants++;
        }
        totalStakesCollected += actualStake;
        
        // Keep actual stake inside this contract balance; settle at endActivity()
        emit StakeReceived(msg.sender, actualStake, entropyFee);
        
        // Request randomness from Pyth Entropy
        sequenceNumber = entropy.requestWithCallback{value: entropyFee}(
            entropyProvider,
            userRandomNumber
        );
        
        // Store pending draw information
        pendingDraws[sequenceNumber] = msg.sender;
        pendingUserRandomness[sequenceNumber] = userRandomNumber;
        
        emit DrawRequested(msg.sender, sequenceNumber);
        return sequenceNumber;
    }
    
    /**
     * @dev Callback function called by Pyth Entropy with randomness
     * @param sequenceNumber The sequence number from the original request
     * @param provider The entropy provider address
     * @param randomNumber The random number provided by Pyth
     */
    function entropyCallback(
        uint64 sequenceNumber,
        address provider,
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
    
    /**
     * @dev Returns the Entropy contract address (required by IEntropyConsumer)
     */
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
     * @dev Get current Entropy fee
     */
    function getCurrentEntropyFee() external view returns (uint128 fee) {
        return entropy.getFee(entropyProvider);
    }
    
    /**
     * @dev Get actual stake amount after entropy fee deduction
     */
    function getActualStakeAmount() external view returns (uint256 actualStake) {
        uint128 entropyFee = entropy.getFee(entropyProvider);
        if (entropyFee >= STAKE_AMOUNT) return 0;
        return STAKE_AMOUNT - entropyFee;
    }

    /**
     * @dev Helper: prizePoolBalance in human-readable ZETA (as decimal string with up to 18 decimals)
     */
    function prizePoolBalanceZeta() external view returns (string memory) {
        return _formatZeta(prizePoolBalance);
    }

    /**
     * @dev Helper: totalStakesCollected in human-readable ZETA (as decimal string with up to 18 decimals)
     */
    function totalStakesCollectedZeta() external view returns (string memory) {
        return _formatZeta(totalStakesCollected);
    }

    /**
     * @dev Helper: actual stake amount after entropy fee, in ZETA (as decimal string with up to 18 decimals)
     */
    function getActualStakeAmountZeta() external view returns (string memory) {
        uint128 entropyFee = entropy.getFee(entropyProvider);
        if (entropyFee >= STAKE_AMOUNT) return "0";
        return _formatZeta(STAKE_AMOUNT - entropyFee);
    }

    /**
     * @dev Internal: format wei amount into ZETA decimal string with up to 18 decimals (trim trailing zeros)
     */
    function _formatZeta(uint256 weiAmount) internal pure returns (string memory) {
        uint256 whole = weiAmount / 1e18;
        uint256 frac = weiAmount % 1e18;

        if (frac == 0) {
            return whole.toString();
        }

        // Convert fraction to 18-digit string with leading zeros
        string memory fracRaw = _pad18(frac.toString());
        // Trim trailing zeros
        bytes memory b = bytes(fracRaw);
        uint256 len = b.length;
        while (len > 0 && b[len - 1] == bytes1("0")) {
            len--;
        }
        if (len == 0) {
            return whole.toString();
        }
        return string(abi.encodePacked(whole.toString(), ".", _slice(b, 0, len)));
    }

    /**
     * @dev Pad a decimal string on the left with zeros to 18 characters
     */
    function _pad18(string memory s) internal pure returns (string memory) {
        bytes memory bs = bytes(s);
        if (bs.length >= 18) return s;
        bytes memory out = new bytes(18);
        uint256 pad = 18 - bs.length;
        for (uint256 i = 0; i < pad; i++) {
            out[i] = bytes1("0");
        }
        for (uint256 j = 0; j < bs.length; j++) {
            out[pad + j] = bs[j];
        }
        return string(out);
    }

    /**
     * @dev Slice first `len` bytes from `data` starting at `start`
     */
    function _slice(bytes memory data, uint256 start, uint256 len) internal pure returns (string memory) {
        bytes memory out = new bytes(len);
        for (uint256 i = 0; i < len; i++) {
            out[i] = data[start + i];
        }
        return string(out);
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
            entropy.getFee(entropyProvider)
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
        
        prizeTiers[2].remaining = prizeTiers[2].maxSupply; // 10 ZETA (200)
        prizeTiers[3].remaining = prizeTiers[3].maxSupply; // 100 ZETA (10)  
        prizeTiers[4].remaining = prizeTiers[4].maxSupply; // 1000 ZETA (2)
    }
    
    // Receive function - reject direct payments
    receive() external payable {
        revert("Use participateAndDraw() or seedPrizePool()");
    }
    
    fallback() external payable {
        revert("Function not found");
    }
}
