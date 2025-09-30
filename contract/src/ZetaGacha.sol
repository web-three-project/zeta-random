// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./ManageLotteryCode.sol";

contract ZetaGacha {
    ManageLotteryCode public codeManager;
    address public owner;

    event Played(address user, bool win, bool usedCode);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor(address _manager) {
        owner = msg.sender;
        codeManager = ManageLotteryCode(_manager);
    }

    function play(bytes32 codeHash) external {
        bool usedCode = false;

        if (codeHash != bytes32(0)) {
            // 验证邀请码存在且未使用
            require(codeManager.usedBy(codeHash) == address(0), "Code invalid or used");

            // 使用邀请码
            codeManager.setUsedBy(codeHash, msg.sender);
            usedCode = true;
        }

        // 简化：直接随机（伪随机演示）
        uint256 rand = uint256(keccak256(abi.encodePacked(block.timestamp, msg.sender))) % 100;
        bool win;
        if (usedCode) {
            // 使用邀请码中奖率翻倍
            win = rand < 40; // 40% 概率
        } else {
            win = rand < 20; // 20% 概率
        }

        emit Played(msg.sender, win, usedCode);
    }
}