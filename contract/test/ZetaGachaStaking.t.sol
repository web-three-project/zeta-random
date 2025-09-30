// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "./helpers/ZetaGachaStakingHarness.sol";
import "./mocks/MockEntropy.sol";

contract ZetaGachaStakingTest is Test {
    ZetaGachaStakingHarness gacha;
    MockEntropy entropy;

    address owner = address(0xA11CE);
    address provider = address(0xBEEF);
    address user = address(0xCAFE);

    uint128 constant ENTROPY_FEE = 0.01 ether; // 本地测试用的 mock fee

    function setUp() public {
        // 设置 msg.sender 为 owner 进行部署
        vm.startPrank(owner);
        entropy = new MockEntropy(ENTROPY_FEE);
        gacha = new ZetaGachaStakingHarness(address(entropy), provider);
        vm.stopPrank();

        // 给 owner 和 user 充值原生代币用于支付
        vm.deal(owner, 10000 ether);
        vm.deal(user, 10 ether);

        // owner 注资固定奖池
        vm.prank(owner);
        gacha.seedPrizePool{value: gacha.FIXED_PRIZE_POOL()}();
    }

    function test_SeedPrizePool_Balances() public {
        // 合约内部奖池余额应该等于 FIXED_PRIZE_POOL
        ( , uint256 currentPrizePool, uint256 fixedPool, , , ) = gacha.getContractStatus();
        assertEq(fixedPool, gacha.FIXED_PRIZE_POOL());
        assertEq(currentPrizePool, gacha.FIXED_PRIZE_POOL());
    }

    function test_ParticipateAndDraw_WithCorrectFee() public {
        // 用户支付正确的 entropy fee 参与，并获得 sequenceNumber
        vm.prank(user);
        uint64 seq = gacha.participateAndDraw{value: ENTROPY_FEE}(bytes32("user-seed"));
        assertGt(seq, 0);

        // pendingDraws 映射应记录用户地址
        assertEq(gacha.pendingDraws(seq), user);

        // 现在由测试手动触发回调，构造一个命中 0.1 ZETA 的随机数区间
        // 概率分布中：T_NONE 414,449 ppm，T_0P1 350,000 ppm => 命中 T_0P1 的 roll ∈ [414449, 764449)
        // 因此让 random % 1_000_000 = 414449
        bytes32 rn = bytes32(uint256(414_449));
        gacha.testEntropyCallback(seq, provider, rn);

        // 0.1 ZETA 应转给 user（可能由于库存降级逻辑最终不是 0.1，这里只断言 user 收到不小于 0）
        // 为了确定性断言，记录回调前后余额变动
        // 重新跑一遍：记录变动
    }

    function test_Draw_DistributesPrize_AndDecrementsPool() public {
        // 记录用户与合约余额
        uint256 userBefore = user.balance;
        (, uint256 poolBefore, , , , ) = gacha.getContractStatus();

        vm.prank(user);
        uint64 seq = gacha.participateAndDraw{value: ENTROPY_FEE}(bytes32("seed-1"));

        // 命中 T_0P1（0.1 ether）
        bytes32 rn = bytes32(uint256(414_449));
        gacha.testEntropyCallback(seq, provider, rn);

        // user 应增加 >= 0.1 ether（若未被降级为 0）
        // 根据库存初始化，T_0P1 初始 remaining=5000，应能发放 0.1 ether
        uint256 userAfter = user.balance;
        assertEq(userAfter, userBefore + 0.1 ether);

        // 奖池余额应减少同等额度
        (, uint256 poolAfter, , , , ) = gacha.getContractStatus();
        assertEq(poolAfter, poolBefore - 0.1 ether);
    }

    function test_DrawLimitReached_After30() public {
        // 提前给 user 充足余额
        vm.deal(user, 100 ether);

        for (uint256 i = 0; i < gacha.MAX_DRAWS_PER_ADDRESS(); i++) {
            vm.prank(user);
            uint64 seq = gacha.participateAndDraw{value: ENTROPY_FEE}(bytes32(uint256(i+1)));
            // 使用不同的随机数触发回调（不影响上限逻辑）
            gacha.testEntropyCallback(seq, provider, bytes32(uint256(500_000)));
        }

        // 第 31 次应 revert DrawLimitReached()
        vm.prank(user);
        vm.expectRevert(ZetaGachaStaking.DrawLimitReached.selector);
        gacha.participateAndDraw{value: ENTROPY_FEE}(bytes32("31"));
    }

    function test_EndActivity_And_WithdrawRemaining() public {
        // 结束活动
        vm.prank(owner);
        gacha.endActivity();

        // 记录 owner 和合约余额
        uint256 ownerBefore = owner.balance;
        uint256 contractBefore = address(gacha).balance;

        // 提取剩余奖池
        vm.prank(owner);
        gacha.withdrawRemainingPrizePool();

        // 全部提给 owner
        uint256 ownerAfter = owner.balance;
        assertEq(ownerAfter, ownerBefore + contractBefore);

        // 合约内部记录 prizePoolBalance 清零
        (, uint256 poolAfter, , , , ) = gacha.getContractStatus();
        assertEq(poolAfter, 0);
    }

    function test_Revert_OnWrongEntropyFee() public {
        vm.prank(user);
        vm.expectRevert(ZetaGachaStaking.EntropyFeeMismatch.selector);
        gacha.participateAndDraw{value: ENTROPY_FEE - 1}(bytes32("fee-wrong"));
    }

    function test_Revert_OnPaused() public {
        vm.prank(owner);
        gacha.pause();
        vm.prank(user);
        vm.expectRevert("Pausable: paused");
        gacha.participateAndDraw{value: ENTROPY_FEE}(bytes32("paused"));
    }

    function test_Revert_OnActivityEnded() public {
        vm.prank(owner);
        gacha.endActivity();

        vm.prank(user);
        vm.expectRevert(ZetaGachaStaking.ActivityAlreadyEnded.selector);
        gacha.participateAndDraw{value: ENTROPY_FEE}(bytes32("ended"));
    }
}