// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "forge-std/console.sol"; // Add this line
import "../src/ManageLotteryCode.sol";

contract ManageLotteryCodeLocalTest is Test {
    ManageLotteryCode manage;
    address owner = address(0xABCD);
    address gacha = address(0x1234);
    address user1 = address(0x1111);
    address user2 = address(0x2222);

    // 生成 8 位邀请码（数字+大写字母）
    function randomCode(uint256 seed) internal pure returns (string memory) {
        bytes memory chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
        bytes memory code = new bytes(8);
        for (uint i = 0; i < 8; i++) {
            code[i] = chars[(seed >> (i*4)) % chars.length];
        }
        return string(code);
    }

    function setUp() public {
        vm.startPrank(owner);
        manage = new ManageLotteryCode();
        manage.setGachaContract(gacha);
        vm.stopPrank();
    }

    function testFullFlow() public {
        vm.startPrank(owner);

        uint256 batchSize = 10;
        bytes32[] memory codeHashes = new bytes32[](batchSize);
        for (uint i = 0; i < batchSize; i++) {
            string memory codeStr = randomCode(i);
            codeHashes[i] = keccak256(abi.encodePacked(codeStr));
        }

        manage.batchAddCode(codeHashes);
        uint total = manage.totalCodes();
        assertEq(total, batchSize);

        vm.stopPrank();

        vm.startPrank(gacha);
        manage.setUsedBy(codeHashes[0], user1);
        manage.setUsedBy(codeHashes[1], user2);
        vm.stopPrank();

        (bytes32[] memory codesPage, address[] memory usersPage) = manage.getCodesByPage(0, 5);

        for (uint i = 0; i < codesPage.length; i++) {
            console.log("Code hash:", uint256(codesPage[i]));
            console.log("Used by:", usersPage[i]);
        }

        vm.startPrank(gacha);
        vm.expectRevert("Already used");
        manage.setUsedBy(codeHashes[0], user2);
        vm.stopPrank();
    }
}