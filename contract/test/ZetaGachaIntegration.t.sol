// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "forge-std/console.sol";
import "../src/ManageLotteryCode.sol";
import "../src/ZetaGacha.sol";

contract ZetaGachaIntegrationTest is Test {
    ManageLotteryCode manage;
    ZetaGacha gacha;

    address owner = address(0xABCD);
    address user1 = address(0x1111);
    address user2 = address(0x2222);

    bytes32 codeHash1;
    bytes32 codeHash2;

    function setUp() public {
        vm.startPrank(owner);

        // 部署 ManageLotteryCode
        manage = new ManageLotteryCode();

        // 部署 ZetaGacha，并设置 gacha 合约地址
        gacha = new ZetaGacha(address(manage));
        manage.setGachaContract(address(gacha));

        // 生成邀请码
        codeHash1 = keccak256(abi.encodePacked("INVITE1"));
        codeHash2 = keccak256(abi.encodePacked("INVITE2"));
        bytes32[] memory codes = new bytes32[](2);
        codes[0] = codeHash1;
        codes[1] = codeHash2;
        manage.batchAddCode(codes);

        vm.stopPrank();
    }

    function testPlayWithAndWithoutCode() public {
        // 用户1 使用邀请码
        vm.startPrank(user1);
        gacha.play(codeHash1);
        vm.stopPrank();

        // 用户2 不使用邀请码
        vm.startPrank(user2);
        gacha.play(bytes32(0));
        vm.stopPrank();

        // 验证邀请码被标记为已使用
        address usedBy1 = manage.usedBy(codeHash1);
        assertEq(usedBy1, user1);

        // 打印日志
        console.log("CodeHash1 used by:", usedBy1);
        console.log("CodeHash2 used by:", manage.usedBy(codeHash2));
    }

    function testRevertWhenCodeAlreadyUsed() public {
        vm.startPrank(user1);
        gacha.play(codeHash1);
        vm.stopPrank();

        vm.startPrank(user2);
        vm.expectRevert("Code invalid or used");
        gacha.play(codeHash1);
        vm.stopPrank();
    }
}