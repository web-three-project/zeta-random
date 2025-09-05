// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Script.sol";
import "../src/ZetaGachaStaking.sol";

contract DeployStakingScript is Script {
    function run() external {
        // Load environment variables
        address finalRecipientAddress = vm.envAddress("FINAL_RECIPIENT_ADDRESS");
        address pythEntropy = vm.envAddress("PYTH_ENTROPY_ADDRESS");
        address pythProvider = vm.envAddress("PYTH_ENTROPY_PROVIDER");
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY_DEPLOYER");
        
        vm.startBroadcast(deployerPrivateKey);
        
        // Deploy ZetaGachaStaking contract (stakes kept in-contract)
        ZetaGachaStaking gacha = new ZetaGachaStaking(
            finalRecipientAddress,
            pythEntropy,
            pythProvider
        );
        
        vm.stopBroadcast();
        
        console.log("ZetaGachaStaking deployed at:", address(gacha));
        console.log("Final recipient address:", finalRecipientAddress);
        console.log("Pyth Entropy contract:", pythEntropy);
        console.log("Pyth Entropy provider:", pythProvider);
        console.log("Fixed prize pool: 5000 ZETA");
        console.log("Stake amount: 1 ZETA per participation");
        
        console.log("\n=== Prize Tiers (CORRECTED to match front.jsx) ===");
        console.log("Tier 0: No prize (50% chance)");
        console.log("Tier 1: 1 ZETA (40% chance, unlimited)");
        console.log("Tier 2: 10 ZETA (9.5% chance, max 200)");
        console.log("Tier 3: 100 ZETA (0.4% chance, max 10)");
        console.log("Tier 4: 1000 ZETA (0.1% chance, max 2)");
        
        console.log("\n=== Next Steps ===");
        console.log("1. Owner needs to call seedPrizePool() with 5000 ZETA");
        console.log("2. Users can call participateAndDraw() with 1 ZETA");
        console.log("3. Owner can call endActivity() to end the activity");
    }
}
