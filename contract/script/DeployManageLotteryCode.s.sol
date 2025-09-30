// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Script.sol";
import "../src/ManageLotteryCode.sol";

contract DeployManageLotteryCode is Script {
    function run() external {
        // 获取环境变量 PRIVATE_KEY 或默认 signer
        uint256 deployerKey = vm.envUint("PRIVATE_KEY_DEPLOYER");
        
        // 开始广播交易
        vm.startBroadcast(deployerKey);

        // 部署合约
        ManageLotteryCode manage = new ManageLotteryCode();

        // 输出部署地址
        console.log("ManageLotteryCode deployed at:", address(manage));

        vm.stopBroadcast();
    }
}