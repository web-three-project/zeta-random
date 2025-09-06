// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Script.sol";
import "../src/ZetaGachaStaking.sol";

contract DeployStakingScript is Script {
    function run() external {
        // Load environment variables
        address pythEntropy = vm.envAddress("PYTH_ENTROPY_ADDRESS");
        address pythProvider = vm.envAddress("PYTH_ENTROPY_PROVIDER");
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY_DEPLOYER");

        vm.startBroadcast(deployerPrivateKey);

        // Deploy ZetaGachaStaking contract
        ZetaGachaStaking gacha = new ZetaGachaStaking(
            pythEntropy,
            pythProvider
        );

        vm.stopBroadcast();

        console.log("ZetaGachaStaking deployed at:", address(gacha));
        console.log("Pyth Entropy contract:", pythEntropy);
        console.log("Pyth Entropy provider:", pythProvider);
        console.log("Fixed prize pool: 5000 ZETA");
        console.log("Participation: Free (user pays gas + entropy fee)");
        console.log("Draw limit: 30 per address (lifetime)");

        console.log("\n=== Prize Tiers (as per front.jsx) ===");
        console.log("0.2 ZETA: 50% (5000 supply)");
        console.log("1 ZETA: 5% (1000 supply)");
        console.log("10 ZETA: 0.5% (100 supply)");
        console.log("100 ZETA: 0.05% (10 supply)");
        console.log("1000 ZETA: 0.005% (1 supply)");
        console.log("Merch: 0% (10 supply, downgrade only)");
        console.log("No Prize: 44.445%");

        console.log("\n=== Next Steps ===");
        console.log("1. Owner must call seedPrizePool() with 5000 ZETA.");
        console.log("2. Users can call participateAndDraw(), sending the exact entropy fee as msg.value.");
        console.log("3. Owner can call endActivity() to halt the contract.");
    }
}
