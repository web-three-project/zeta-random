// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Script.sol";
import "../src/ZetaGachaStakingTestnet.sol";

contract InteractTestnet is Script {
    ZetaGachaStakingTestnet public gacha;
    
    function setUp() public {
        _ensureLoaded();
    }

    function _ensureLoaded() internal {
        if (address(gacha) == address(0)) {
            address contractAddress = vm.envAddress("TESTNET_CONTRACT_ADDRESS");
            require(contractAddress != address(0), "TESTNET_CONTRACT_ADDRESS not set");
            gacha = ZetaGachaStakingTestnet(payable(contractAddress));
        }
    }
    
    // Owner seeds the prize pool with 0.5 ZETA
    function seedPrizePool() public {
        _ensureLoaded();
        uint256 ownerKey = vm.envUint("PRIVATE_KEY_OWNER");
        
        vm.startBroadcast(ownerKey);
        
        console.log("Seeding prize pool with 0.5 ZETA...");
        gacha.seedPrizePool{value: 0.5 ether}();
        
        console.log("Prize pool seeded successfully!");
        console.log("Contract balance:", address(gacha).balance);
        
        vm.stopBroadcast();
    }
    
    // User participates in gacha (costs 0.1 ZETA)
    function participate() public {
        _ensureLoaded();
        uint256 userKey = vm.envUint("PRIVATE_KEY_USER");
        
        vm.startBroadcast(userKey);
        
        console.log("User participating in gacha with 0.1 ZETA...");
        bytes32 userRandomNumber = keccak256(abi.encodePacked(block.timestamp, address(gacha)));
        uint64 sequenceNumber = gacha.participateAndDraw{value: 0.1 ether}(userRandomNumber);
        
        console.log("Participation successful!");
        console.log("Entropy sequence number:", sequenceNumber);
        
        vm.stopBroadcast();
    }
    
    // Owner ends the activity
    function endActivity() public {
        _ensureLoaded();
        uint256 ownerKey = vm.envUint("PRIVATE_KEY_OWNER");
        
        vm.startBroadcast(ownerKey);
        
        console.log("Ending activity...");
        gacha.endActivity();
        
        console.log("Activity ended successfully!");
        
        vm.stopBroadcast();
    }
    
    // Check contract status
    function checkStatus() public view {
        address contractAddress = vm.envAddress("TESTNET_CONTRACT_ADDRESS");
        ZetaGachaStakingTestnet c = ZetaGachaStakingTestnet(payable(contractAddress));
        console.log("=== Contract Status ===");
        console.log("Contract address:", address(c));
        console.log("Contract balance:", address(c).balance);
        console.log("Prize pool balance:", c.prizePoolBalance());
        console.log("Prize pool seeded:", c.prizePoolBalance() >= c.FIXED_PRIZE_POOL());
        console.log("Activity ended:", c.activityEnded());
        console.log("Total participants:", c.totalParticipants());
        console.log("Total stakes collected:", c.totalStakesCollected());
    }
    
    // Run all operations in sequence
    function run() public {
        checkStatus();
        
        if (gacha.prizePoolBalance() < gacha.FIXED_PRIZE_POOL()) {
            seedPrizePool();
        }
        
        // Simulate a few participations
        participate();
        
        checkStatus();
    }
}
