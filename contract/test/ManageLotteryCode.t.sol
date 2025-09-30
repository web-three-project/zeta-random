// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "../src/ManageLotteryCode.sol";

contract ManageLotteryCodeTest is Test {
    ManageLotteryCode manage;
    address owner = address(0xABCD);
    address user1 = address(0x1111);
    address user2 = address(0x2222);

    function setUp() public {
        vm.startPrank(owner);
        manage = new ManageLotteryCode();
        vm.stopPrank();
    }

    function testBatchAddCode() public {
        vm.startPrank(owner);

        bytes32 code1 = keccak256(abi.encodePacked("CODE1"));
        bytes32 code2 = keccak256(abi.encodePacked("CODE2"));

        // ✅ 修正后: 声明并初始化一个动态数组
        bytes32[] memory codes = new bytes32[](2);
        codes[0] = code1;
        codes[1] = code2;

        manage.batchAddCode(codes);
        uint total = manage.totalCodes();
        assertEq(total, 2);

        vm.stopPrank();
    }

    function testSetUsedBy() public {
        vm.startPrank(owner);

        bytes32 code1 = keccak256(abi.encodePacked("CODE1"));
        manage.batchAddCode(toArray(code1));

        manage.setUsedBy(code1, user1);
        address used = manage.usedBy(code1);
        assertEq(used, user1);

        vm.stopPrank();
    }

    function testCannotReuseCode() public {
        vm.startPrank(owner);

        bytes32 code1 = keccak256(abi.encodePacked("CODE1"));
        manage.batchAddCode(toArray(code1));

        manage.setUsedBy(code1, user1);

        vm.expectRevert("Already used");
        manage.setUsedBy(code1, user2);

        vm.stopPrank();
    }

    function testPagination() public {
        vm.startPrank(owner);

        // ✅ 修正后: 声明并初始化一个动态数组
        bytes32[] memory codes = new bytes32[](5);
        for (uint i = 0; i < 5; i++) {
            codes[i] = keccak256(abi.encodePacked("CODE", i));
        }

        manage.batchAddCode(codes);

        (bytes32[] memory pageCodes, address[] memory pageUsers) = manage.getCodesByPage(1, 3);
        assertEq(pageCodes.length, 3);
        assertEq(pageUsers.length, 3);

        vm.stopPrank();
    }

    function toArray(bytes32 code) internal pure returns (bytes32[] memory arr) {
        // ✅ 修正后: 声明并初始化一个长度为 1 的动态数组
        arr = new bytes32[](1);
        arr[0] = code;
    }
}