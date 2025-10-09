// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

// Pyth Entropy SDK
import "@pythnetwork/entropy-sdk-solidity/IEntropy.sol";
import "@pythnetwork/entropy-sdk-solidity/IEntropyConsumer.sol";

/// @notice 外部 ManageLotteryCode 接口（只需用到的函数）
interface IManageLotteryCode {
    function setUsedBy(bytes32 codeHash, address user) external;
    function usedBy(bytes32 codeHash) external view returns (address);
    function codeExists(bytes32 codeHash) external view returns (bool);
}

/**
 * @title ZetaGachaStaking (integrated with ManageLotteryCode)
 * @dev 使用 Pyth Entropy 作为随机性源。可对接 ManageLotteryCode：当用户提交邀请码时
 * 本合约会调用 ManageLotteryCode.setUsedBy(codeHash, msg.sender) 将其标记为已使用，
 * 并在随机分配时对非空奖项概率按「1.5倍」的规则放大。
 */
contract ZetaGachaStaking is Ownable, ReentrancyGuard, Pausable, IEntropyConsumer {
    // ---------------- Constants ----------------
    // 保持原样，如果实际投入是 8 ether，可以考虑改为 8 ether。
    uint256 public constant FIXED_PRIZE_POOL = 2 ether; 
    uint256 private constant PROB_DENOMINATOR = 1_000_000; // ppm

    // ---------------- Prize Tier ----------------
    struct PrizeTier {
        uint256 amount;      // 奖励金额（wei, 用 ether 单位写入）
        uint256 probability; // 原始概率（ppm）
        uint256 maxSupply;
        uint256 remaining;
        bool unlimited;
    }

    uint8 public constant T_NONE     = 0;
    uint8 public constant T_0P1      = 1;
    uint8 public constant T_0P5      = 2;
    uint8 public constant T_1        = 3;
    uint8 public constant T_2        = 4;
    uint8 public constant T_5        = 5;
    uint8 public constant T_10       = 6;
    uint8 public constant T_20       = 7;
    uint8 public constant T_50       = 8;
    uint8 public constant T_100      = 9;
    uint8 public constant TIER_COUNT = 10;

    // ---------------- State ----------------
    uint256 public prizePoolBalance;
    bool public activityEnded;

    mapping(uint8 => PrizeTier) public prizeTiers;

    // Pyth Entropy
    IEntropy public immutable entropy;
    address public immutable entropyProvider;

    struct PendingDraw {
        address player;
        bytes32 codeHash; // bytes32(0) if none
    }
    mapping(uint64 => PendingDraw) private pendingDraws;

    // ManageLotteryCode 合约引用（可由 owner 设置）
    IManageLotteryCode public lotteryCode;

    // 每日（UTC+8）抽奖次数限制 - 方案A
    struct UserDaily {
        uint32 dayId; // (block.timestamp + 8 hours) / 1 days
        uint32 used;  // 当日已用次数
    }
    mapping(address => UserDaily) public dailyUsage;
    uint32 public constant MAX_DRAWS_PER_DAY = 10;

    // ---------------- Events ----------------
    /// draw requested by user; include codeHash if any
    event DrawRequested(address indexed player, uint64 indexed sequenceNumber, uint128 entropyFee, bytes32 codeHash);
    /// draw completed; include codeHash if any
    event DrawCompleted(address indexed player, uint8 tierIndex, uint256 amount, bytes32 codeHash);
    event PrizePoolSeeded(uint256 amount, uint256 newBalance);
    event ActivityEnded();
    event InventoryReset();
    event LotteryCodeSet(address indexed mgr);

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

        // 初始化奖励层级（保持原设定）
        prizeTiers[T_NONE] = PrizeTier(0, 414_449, 0, 0, true);

        prizeTiers[T_0P1]  = PrizeTier(0.1 ether, 350_000, 5000, 5000, false);
        prizeTiers[T_0P5]  = PrizeTier(0.5 ether, 150_000, 1000, 1000, false);
        prizeTiers[T_1]    = PrizeTier(1 ether,   50_000,  500,  500,  false);
        prizeTiers[T_2]    = PrizeTier(2 ether,   20_000,  500,  500,  false);
        prizeTiers[T_5]    = PrizeTier(5 ether,   10_000,  200,  200,  false);
        prizeTiers[T_10]   = PrizeTier(10 ether,   5_000,  150,  150,  false);
        prizeTiers[T_20]   = PrizeTier(20 ether,     500,   50,   50,  false);
        prizeTiers[T_50]   = PrizeTier(50 ether,      50,   20,   20,  false);
        prizeTiers[T_100]  = PrizeTier(100 ether,      1,   10,   10,  false);
    }

    // ---------------- Owner functions ----------------
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
        prizePoolBalance = 0;
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

    /// @notice 绑定 ManageLotteryCode 合约地址（owner 专用）
    function setLotteryCode(address _mgr) external onlyOwner {
        require(_mgr != address(0), "Invalid address");
        lotteryCode = IManageLotteryCode(_mgr);
        emit LotteryCodeSet(_mgr);
    }

    // ---------------- User functions ----------------

    /**
     * @notice 用户参与抽奖。可选传入 codeHash（bytes32(0) 表示无）。
     * @param userRandomNumber 用户提供的随机数（会传递给 Pyth Entropy）
     * @param codeHash 邀请码 hash（keccak256 原始 code），可为 bytes32(0)
     */
    function participateAndDraw(bytes32 userRandomNumber, bytes32 codeHash)
        external
        payable
        nonReentrant
        whenNotPaused
        returns (uint64 sequenceNumber)
    {
        require(userRandomNumber != bytes32(0), "Invalid random number");

        if (activityEnded) revert ActivityAlreadyEnded();
        // 使用东八区“自然日”进行日配额判断
        uint32 today = _todayDayId();
        UserDaily storage u = dailyUsage[msg.sender];
        if (u.dayId != today) {
            u.dayId = today;
            u.used = 0;
        }
        if (u.used >= MAX_DRAWS_PER_DAY) revert DrawLimitReached();

        uint128 entropyFee = entropy.getFee(entropyProvider);
        if (msg.value != entropyFee) revert EntropyFeeMismatch();

        // 如果传入 codeHash（非 0），则先原子地在 ManageLotteryCode 上标记为已用
        if (codeHash != bytes32(0)) {
            // ensure lotteryCode has been set
            require(address(lotteryCode) != address(0), "Lottery manager not set");
            // will revert if code not exists or already used (ManageLotteryCode 的校验)
            lotteryCode.setUsedBy(codeHash, msg.sender);
        }

        // 请求 entropy 随机数（在同一 tx 中，若上面失败会 revert）
        sequenceNumber = entropy.requestWithCallback{value: entropyFee}(
            entropyProvider,
            userRandomNumber
        );

        // 记录 pending draw，包括 codeHash（可能为 0）
        pendingDraws[sequenceNumber] = PendingDraw({
            player: msg.sender,
            codeHash: codeHash
        });

        // 递增当日已用次数
        u.used += 1;

        emit DrawRequested(msg.sender, sequenceNumber, entropyFee, codeHash);
        return sequenceNumber;
    }

    // ---------------- Entropy Callback ----------------
    /// @dev Pyth Entropy 回调（内部覆盖实现）
    function entropyCallback(
        uint64 sequenceNumber,
        address provider,
        bytes32 randomNumber
    ) internal override {
        require(provider == entropyProvider, "Invalid provider");
        require(randomNumber != bytes32(0), "Invalid random number");
        
        PendingDraw memory pd = pendingDraws[sequenceNumber];
        if (pd.player == address(0)) revert DrawNotFound();
        delete pendingDraws[sequenceNumber];

        bool usedCode = (pd.codeHash != bytes32(0));

        // 如果使用了 code，再次校验 on-chain usedBy 确实是当前玩家（额外防护）
        if (usedCode) {
            // 若 lotteryCode 未设置，则 treat as not used (shouldn't happen)
            if (address(lotteryCode) != address(0)) {
                address recorded = lotteryCode.usedBy(pd.codeHash);
                // 如果被他人抢先篡改（理应不会），则当作未使用（降级）
                if (recorded != pd.player) {
                    usedCode = false;
                }
            } else {
                usedCode = false;
            }
        }

        (uint8 tierWon, uint256 prizeAmount) = _determineAndDistributeWithCode(uint256(randomNumber), pd.player, usedCode);

        emit DrawCompleted(pd.player, tierWon, prizeAmount, pd.codeHash);
    }

    function getEntropy() internal view override returns (address) {
        return address(entropy);
    }

    // ---------------- Internal logic ----------------

    /// @notice 获取当前的东八区日编号（用于每日限额重置）
    function _todayDayId() internal view returns (uint32) {
        return uint32((block.timestamp + 8 hours) / 1 days);
    }

    /// @notice 基于是否使用邀请码来决定概率分布；返回中奖 tier 与奖励金额
    function _determineAndDistributeWithCode(uint256 randomness, address player, bool usedCode)
        internal
        returns (uint8 tierWon, uint256 prizeAmount)
    {
        // === START OF MODIFICATION for 1.5x ===
        
        // 使用分子/分母来表示放大系数 1.5x (即 3/2)
        uint256 NUMERATOR = 1;
        uint256 DENOMINATOR = 1;

        if (usedCode) {
            // Hardcode 1.5x scaling (3/2)
            NUMERATOR = 3;
            DENOMINATOR = 2;
        }

        // 以缩放后的概率进行抽取（保持 PROB_DENOMINATOR 不变）
        uint256 roll = randomness % PROB_DENOMINATOR;
        uint256 cumulative = 0;
        uint8 picked = T_NONE;

        for (uint8 i = 0; i < TIER_COUNT; i++) {
            uint256 p = prizeTiers[i].probability;
            
            // 只对非空级应用放大，且仅在 NUMERATOR > DENOMINATOR (即放大) 时执行
            if (i != T_NONE && p > 0 && NUMERATOR > DENOMINATOR) {
                // 应用 1.5x 缩放: p = (p * NUMERATOR) / DENOMINATOR
                p = (p * NUMERATOR) / DENOMINATOR;
            }
            // === END OF MODIFICATION ===
            
            if (p == 0) continue;
            
            cumulative += p;
            // 注意：放大后的累积概率可能超过 PROB_DENOMINATOR，但 roll 的范围为 [0, PROB_DENOMINATOR-1]，比较仍然成立。
            if (roll < cumulative) {
                picked = i;
                break;
            }
        }

        // 选出后做库存降级与发放
        tierWon = _downgradeFrom(picked);
        prizeAmount = _distributePrize(player, tierWon);
    }

    /// @notice 奖励分发逻辑与剩余库存处理（与原逻辑一致）
    function _distributePrize(address player, uint8 tierIndex)
        internal
        returns (uint256 prizeAmount)
    {
        PrizeTier storage tier = prizeTiers[tierIndex];
        if (!tier.unlimited) {
            require(tier.remaining > 0, "Tier depleted");
            if (tier.remaining == 0) {
                tierIndex = _downgradeFrom(tierIndex);
                tier = prizeTiers[tierIndex];
            } else {
                tier.remaining--;
            }
        }

        prizeAmount = tier.amount;
        if (prizeAmount > 0) {
            require(prizePoolBalance >= prizeAmount, "Insufficient prize pool");
            prizePoolBalance -= prizeAmount;
            (bool success, ) = player.call{value: prizeAmount}("");
            require(success, "Prize transfer failed");
        }
        return prizeAmount;
    }

    /// @notice 如果某个 tier 没库存则降级到下一级（与原逻辑一致）
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

    /// @notice 查询某地址当日剩余的抽奖次数（基于东八区自然日）
    function remainingDraws(address user) external view returns (uint32 remaining) {
        uint32 today = _todayDayId();
        UserDaily memory u = dailyUsage[user];
        uint32 used = (u.dayId == today) ? u.used : 0;
        if (used >= MAX_DRAWS_PER_DAY) {
            return 0;
        }
        return MAX_DRAWS_PER_DAY - used;
    }

    // ---------------- Fallback ----------------
    receive() external payable {
        revert("Use participateAndDraw() or seedPrizePool()");
    }
    fallback() external payable {
        revert("Function not found");
    }
}