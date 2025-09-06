// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Script.sol";
import "../src/ZetaGachaStakingTestnet.sol";

contract DeployStakingTestnetScript is Script {
    function run() external {
        // Load environment variables
        address pythEntropy = vm.envAddress("PYTH_ENTROPY_ADDRESS");
        address pythProvider = vm.envAddress("PYTH_ENTROPY_PROVIDER");
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY_DEPLOYER");

        vm.startBroadcast(deployerPrivateKey);

        // Deploy ZetaGachaStakingTestnet contract
        ZetaGachaStakingTestnet gacha = new ZetaGachaStakingTestnet(
            pythEntropy,
            pythProvider
        );

        vm.stopBroadcast();

        console.log("ZetaGachaStakingTestnet deployed at:", address(gacha));
        console.log("Pyth Entropy contract:", pythEntropy);
        console.log("Pyth Entropy provider:", pythProvider);
        console.log("Fixed prize pool: 5 ZETA (for testnet)");
        console.log("Participation: Free (user pays gas + entropy fee)");
        console.log("Draw limit: 30 per address (lifetime)");

        console.log("\n=== Prize Tiers (TESTNET with scaled inventory) ===");
        console.log("Probabilities are the same as mainnet.");
        console.log("0.2 ZETA: 5 supply");
        console.log("1 ZETA: 1 supply");
        console.log("10 ZETA: 1 supply (for testing insufficient funds)");
        console.log("Merch: 2 supply");
        console.log("Higher tiers: 0 supply");

        console.log("\n=== Next Steps ===");
        console.log("1. Owner must call seedPrizePool() with 5 ZETA.");
        console.log("2. Users can call participateAndDraw(), sending the exact entropy fee as msg.value.");
        console.log("3. Owner can call endActivity() to halt the contract.");
    }
}
