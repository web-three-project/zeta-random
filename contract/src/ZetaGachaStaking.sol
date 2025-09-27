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
 * 固定奖池 8000 ZETA（需要 Owner 一次性注入）。
 */
contract ZetaGachaStaking is Ownable, ReentrancyGuard, Pausable, IEntropyConsumer {
    // ---------------- Constants ----------------
    uint256 public constant FIXED_PRIZE_POOL = 8000 ether; // 固定奖池（更新为 8000 ZETA）
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
    uint8 public constant T_NONE          = 0;  // 未中奖（作为兜底，概率为剩余）
    uint8 public constant T_0P1           = 1;  // 0.1 ZETA
    uint8 public constant T_0P5           = 2;  // 0.5 ZETA
    uint8 public constant T_1             = 3;  // 1 ZETA
    uint8 public constant T_2             = 4;  // 2 ZETA
    uint8 public constant T_5             = 5;  // 5 ZETA
    uint8 public constant T_10            = 6;  // 10 ZETA
    uint8 public constant T_20            = 7;  // 20 ZETA
    uint8 public constant T_50            = 8;  // 50 ZETA
    uint8 public constant T_100           = 9;  // 100 ZETA
    uint8 public constant TIER_COUNT      = 10;

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
        require(_entropy != address(0), "Invalid entropy address");
        require(_entropyProvider != address(0), "Invalid entropy provider");
        entropy = IEntropy(_entropy);
        entropyProvider = _entropyProvider;

        // 初始化奖励层级（新分布）
        // 概率单位为 ppm（每百万分），合计 1,000,000。
        // 100 ZETA 的给定概率 0.000005% 小于 1 ppm 的精度，采用最小 1 ppm 近似（0.0001%）。
        // 其余概率按给定值设置，未分配的概率作为未中奖（T_NONE）。
        // 概率求和（不含 T_NONE）：350000 + 150000 + 50000 + 20000 + 10000 + 5000 + 500 + 50 + 1 = 585,551
        // T_NONE 概率 = 1,000,000 - 585,551 = 414,449 ppm（约 41.4449%）
        prizeTiers[T_NONE] = PrizeTier(0, 414_449, 0, 0, true);

        prizeTiers[T_0P1]  = PrizeTier(0.1 ether, 350_000, 5000, 5000, false);   // 35%  N=5000
        prizeTiers[T_0P5]  = PrizeTier(0.5 ether, 150_000, 1000, 1000, false);   // 15%  N=1000
        prizeTiers[T_1]    = PrizeTier(1 ether,   50_000,  500,  500,  false);   // 5%   N=500
        prizeTiers[T_2]    = PrizeTier(2 ether,   20_000,  500,  500,  false);   // 2%   N=500
        prizeTiers[T_5]    = PrizeTier(5 ether,   10_000,  200,  200,  false);   // 1%   N=200
        prizeTiers[T_10]   = PrizeTier(10 ether,   5_000,  150,  150,  false);   // 0.5% N=150
        prizeTiers[T_20]   = PrizeTier(20 ether,     500,   50,   50,  false);   // 0.05% N=50
        prizeTiers[T_50]   = PrizeTier(50 ether,      50,   20,   20,  false);   // 0.005% N=20
        prizeTiers[T_100]  = PrizeTier(100 ether,      1,   10,   10,  false);   // ~0.0001% N=10（精度近似）
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
        require(userRandomNumber != bytes32(0), "Invalid random number");
        
        if (activityEnded) revert ActivityAlreadyEnded();
        if (totalDraws[msg.sender] >= MAX_DRAWS_PER_ADDRESS) revert DrawLimitReached();

        uint128 entropyFee = entropy.getFee(entropyProvider);
        if (msg.value != entropyFee) revert EntropyFeeMismatch();

        sequenceNumber = entropy.requestWithCallback{value: entropyFee}(
            entropyProvider,
            userRandomNumber
        );


        totalDraws[msg.sender] += 1;
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
            if (i > 0) {
                 i -= 1;
            }
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