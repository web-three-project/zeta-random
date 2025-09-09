// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

// Pyth Entropy SDK
import "@pythnetwork/entropy-sdk-solidity/IEntropy.sol";
import "@pythnetwork/entropy-sdk-solidity/IEntropyConsumer.sol";

/**
 * @title ZetaGachaStaking
 * @dev Free gacha (抽奖) 合约，使用 Pyth Entropy 作为安全随机源。
 * 用户仅支付 gas 和 entropy fee，不需要 stake/参与费。
 * 固定奖池 5000 ZETA（需要 Owner 一次性注入）。
 */
contract ZetaGachaStaking is Ownable, ReentrancyGuard, Pausable, IEntropyConsumer {
    // ---------------- Constants ----------------
    uint256 public constant FIXED_PRIZE_POOL = 5000 ether; // 固定奖池
    uint256 private constant PROB_DENOMINATOR = 1_000_000; // 百万分比 (ppm)

    // ---------------- Prize Tier 定义 ----------------
    struct PrizeTier {
        uint256 amount;      // 奖励额度（ZETA）
        uint256 probability; // 概率（ppm）
        uint256 maxSupply;   // 最大奖励数量
        uint256 remaining;   // 剩余奖励数量
        bool unlimited;      // 是否不限量
    }

    // 奖励层级索引
    uint8 public constant T_NONE         = 0;
    uint8 public constant T_MERCH        = 1;  // 实物奖品（0 ZETA）
    uint8 public constant T_ZEROPOINTFIVE = 2;  // 0.5 ZETA
    uint8 public constant T_ONE          = 3;  // 1 ZETA
    uint8 public constant T_TEN          = 4;  // 10 ZETA
    uint8 public constant T_HUNDRED      = 5;  // 100 ZETA
    uint8 public constant T_TWOHUNDRED   = 6;  // 200 ZETA (降级用)
    uint8 public constant T_FIVEHUNDRED  = 7;  // 500 ZETA (降级用)
    uint8 public constant T_THOUSAND     = 8;  // 1000 ZETA
    uint8 public constant TIER_COUNT     = 9;

    // ---------------- State ----------------
    uint256 public prizePoolBalance;      // 当前奖池余额
    bool public activityEnded;            // 是否已结束活动

    mapping(uint8 => PrizeTier) public prizeTiers;

    // Pyth Entropy
    IEntropy public immutable entropy;
    address public immutable entropyProvider;
    mapping(uint64 => address) public pendingDraws; // sequenceNumber -> player

    // 用户抽奖次数限制
    mapping(address => uint32) public totalDraws;
    uint32 public constant MAX_DRAWS_PER_ADDRESS = 30;

    // ---------------- Events ----------------
    event DrawRequested(address indexed player, uint64 indexed sequenceNumber, uint128 entropyFee);
    event DrawCompleted(address indexed player, uint8 tierIndex, uint256 amount);
    event PrizePoolSeeded(uint256 amount, uint256 newBalance);
    event ActivityEnded();
    event InventoryReset();

    // ---------------- Errors ----------------
    error InsufficientPrizePool();
    error ActivityAlreadyEnded();
    error ActivityNotEnded();
    error DrawNotFound();
    error EntropyFeeMismatch();
    error DrawLimitReached();

    // ---------------- Constructor ----------------
    constructor(address _entropy, address _entropyProvider) Ownable(msg.sender) {
        entropy = IEntropy(_entropy);
        entropyProvider = _entropyProvider;

        // 初始化奖励层级
        prizeTiers[T_NONE] = PrizeTier(0, 444_450, 0, 0, true);
        prizeTiers[T_MERCH] = PrizeTier(0, 0, 10, 10, false);
        prizeTiers[T_ZEROPOINTFIVE] = PrizeTier(0.5 ether, 500_000, 2000, 2000, false);        
        prizeTiers[T_ONE] = PrizeTier(1 ether, 50_000, 1000, 1000, false);
        prizeTiers[T_TEN] = PrizeTier(10 ether, 5_000, 100, 100, false);
        prizeTiers[T_HUNDRED] = PrizeTier(100 ether, 500, 10, 10, false);
        prizeTiers[T_TWOHUNDRED] = PrizeTier(200 ether, 0, 5, 5, false);
        prizeTiers[T_FIVEHUNDRED] = PrizeTier(500 ether, 0, 2, 2, false);
        prizeTiers[T_THOUSAND] = PrizeTier(1000 ether, 50, 1, 1, false);
    }

    // ---------------- Owner Functions ----------------
    function seedPrizePool() external payable onlyOwner {
        if (msg.value != FIXED_PRIZE_POOL) revert InsufficientPrizePool();
        if (activityEnded) revert ActivityAlreadyEnded();

        prizePoolBalance += msg.value;
        emit PrizePoolSeeded(msg.value, prizePoolBalance);
    }

    function endActivity() external onlyOwner {
        if (activityEnded) revert ActivityAlreadyEnded();
        activityEnded = true;
        _pause();
        emit ActivityEnded();
    }

    function withdrawRemainingPrizePool() external onlyOwner {
        if (!activityEnded) revert ActivityNotEnded();
        uint256 remaining = address(this).balance; 
        (bool success, ) = owner().call{value: remaining}("");
        require(success, "Prize pool withdrawal failed");

        prizePoolBalance = 0; // 可选：清零逻辑余额
    }

    function resetInventory() external onlyOwner {
        if (activityEnded) revert ActivityAlreadyEnded();
        for (uint8 i = 0; i < TIER_COUNT; i++) {
            if (!prizeTiers[i].unlimited) {
                prizeTiers[i].remaining = prizeTiers[i].maxSupply;
            }
        }
        emit InventoryReset();
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner {
        if (activityEnded) revert ActivityAlreadyEnded();
        _unpause();
    }

    // ---------------- User Functions ----------------
    function participateAndDraw(bytes32 userRandomNumber)
        external
        payable
        nonReentrant
        whenNotPaused
        returns (uint64 sequenceNumber)
    {
        if (activityEnded) revert ActivityAlreadyEnded();
        if (totalDraws[msg.sender] >= MAX_DRAWS_PER_ADDRESS) revert DrawLimitReached();

        uint128 entropyFee = entropy.getFee(entropyProvider);
        if (msg.value != entropyFee) revert EntropyFeeMismatch();

        sequenceNumber = entropy.requestWithCallback{value: entropyFee}(
            entropyProvider,
            userRandomNumber
        );


        unchecked { totalDraws[msg.sender] += 1; }
        pendingDraws[sequenceNumber] = msg.sender;

        emit DrawRequested(msg.sender, sequenceNumber, entropyFee);
        return sequenceNumber;
    }

    // ---------------- Entropy Callback ----------------
    function entropyCallback(
        uint64 sequenceNumber,
        address provider,
        bytes32 randomNumber
    ) internal override {
        address player = pendingDraws[sequenceNumber];
        if (player == address(0)) revert DrawNotFound();
        delete pendingDraws[sequenceNumber];

        (uint8 tierWon, uint256 prizeAmount) =
            _determineAndDistribute(uint256(randomNumber), player);

        emit DrawCompleted(player, tierWon, prizeAmount);
    }

    function getEntropy() internal view override returns (address) {
        return address(entropy);
    }

    // ---------------- Internal Logic ----------------
    function _determineAndDistribute(uint256 randomness, address player)
        internal
        returns (uint8 tierWon, uint256 prizeAmount)
    {
        uint256 roll = randomness % PROB_DENOMINATOR;
        uint256 cumulative = 0;
        uint8 picked = T_NONE;

        for (uint8 i = 0; i < TIER_COUNT; i++) {
            uint256 p = prizeTiers[i].probability;
            if (p == 0) continue;
            cumulative += p;
            if (roll < cumulative) {
                picked = i;
                break;
            }
        }

        tierWon = _downgradeFrom(picked);
        prizeAmount = _distributePrize(player, tierWon);
    }

    function _distributePrize(address player, uint8 tierIndex)
        internal
        returns (uint256 prizeAmount)
    {
        PrizeTier storage tier = prizeTiers[tierIndex];
        if (!tier.unlimited) {
            if (tier.remaining == 0) {
                tierIndex = _downgradeFrom(tierIndex);
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

    function _downgradeFrom(uint8 originalTier) internal view returns (uint8 newTier) {
        uint8 i = originalTier;
        while (true) {
            PrizeTier memory tier = prizeTiers[i];
            if (tier.unlimited || tier.remaining > 0) {
                return i;
            }
            if (i == 0) break;
            unchecked { i -= 1; }
        }
        return T_NONE;
    }

    // ---------------- Views ----------------
    function getCurrentEntropyFee() external view returns (uint128 fee) {
        return entropy.getFee(entropyProvider);
    }

    function getContractStatus() external view returns (
        uint256 contractBalance,
        uint256 currentPrizePool,
        uint256 fixedPrizePool,
        bool isActivityEnded,
        address owner_,
        uint128 currentEntropyFee
    ) {
        return (
            address(this).balance,
            prizePoolBalance,
            FIXED_PRIZE_POOL,
            activityEnded,
            owner(),
            entropy.getFee(entropyProvider)
        );
    }

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

    // ---------------- Fallback ----------------
    receive() external payable {
        revert("Use participateAndDraw() or seedPrizePool()");
    }
    fallback() external payable {
        revert("Function not found");
    }
}