// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "../src/ManageLotteryCode.sol";

contract ManageLotteryCodeTest is Test {
    ManageLotteryCode public manage;
    address owner = address(0xABCD);
    address gacha = address(0x1234);
    address user1 = address(0x1111);

    function setUp() public {
        vm.startPrank(owner);
        manage = new ManageLotteryCode();
        vm.stopPrank();
    }

    function testBatchAddCodesAndQuery() public {
        vm.startPrank(owner);

        // 生成两条邀请码的 hash
        bytes32 code1 = keccak256(abi.encodePacked("INVITE1234"));
        bytes32 code2 = keccak256(abi.encodePacked("INVITE5678"));

        bytes32[] memory codes = new bytes32[](2);
        codes[0] = code1;
        codes[1] = code2;

        // 批量添加
        manage.batchAddCode(codes);

        assertEq(manage.totalCodes(), 2);
        assertTrue(manage.codeExists(code1));
        assertTrue(manage.codeExists(code2));

        // 分页查询
        (bytes32[] memory pageCodes, address[] memory users) = manage.getCodesByPage(0, 2);
        assertEq(pageCodes.length, 2);
        assertEq(users[0], address(0));
        assertEq(users[1], address(0));

        vm.stopPrank();
    }

    function testSetUsedByFromGacha() public {
        // 先添加一个邀请码
        vm.startPrank(owner);
        bytes32 code = keccak256(abi.encodePacked("INVITE9999"));
        bytes32[] memory codes = new bytes32[](1);
        codes[0] = code;
        manage.batchAddCode(codes);

        // 设置 Gacha 合约
        manage.setGachaContract(gacha);
        vm.stopPrank();

        // 用 gacha 合约来调用 setUsedBy
        vm.startPrank(gacha);
        manage.setUsedBy(code, user1);
        vm.stopPrank();

        // 校验
        assertEq(manage.usedBy(code), user1);
    }

    function test_RevertWhen_CodeIsDoubleUsed() public {
    // 添加邀请码
        vm.startPrank(owner);
        bytes32 code = keccak256(abi.encodePacked("INVITE0000"));
        bytes32[] memory codes = new bytes32[](1);
        codes[0] = code;
        manage.batchAddCode(codes);

        manage.setGachaContract(gacha);
        vm.stopPrank();

    // 第一次使用
        vm.prank(gacha);
        manage.setUsedBy(code, user1);

    // 第二次使用应该 revert
        vm.startPrank(gacha);
        vm.expectRevert("Already used");
        manage.setUsedBy(code, address(0x2222));
        vm.stopPrank();
    }
}