// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Script.sol";
import "../src/ZetaGachaStaking.sol";

contract InteractStakingScript is Script {
    ZetaGachaStaking public gacha;
    
    function setUp() public {
        // Load deployed contract address
        address gachaAddress = vm.envAddress("STAKING_CONTRACT_ADDRESS");
        gacha = ZetaGachaStaking(payable(gachaAddress));
    }
    
    /**
     * @dev Owner seeds the prize pool with 5000 ZETA
     */
    function seedPrizePool() external {
        uint256 ownerPrivateKey = vm.envUint("PRIVATE_KEY_OWNER");
        uint256 seedAmount = 5000 ether; // 5000 ZETA
        
        vm.startBroadcast(ownerPrivateKey);
        
        gacha.seedPrizePool{value: seedAmount}();
        
        vm.stopBroadcast();
        
        console.log("Prize pool seeded with:", seedAmount);
        console.log("Current prize pool balance:", gacha.prizePoolBalance());
    }
    
    /**
     * @dev User participates and draws (stakes 1 ZETA). Requires a user-provided random seed.
     */
    function participateAndDraw() external {
        uint256 userPrivateKey = vm.envUint("PRIVATE_KEY_USER");
        uint256 stakeAmount = 1 ether; // 1 ZETA
        // Provide a userRandomNumber seed (could be derived from off-chain randomness or user input)
        bytes32 userRandomNumber = keccak256(abi.encodePacked(block.timestamp, msg.sender));
        
        vm.startBroadcast(userPrivateKey);
        
        uint64 sequenceNumber = gacha.participateAndDraw{value: stakeAmount}(userRandomNumber);
        
        vm.stopBroadcast();
        
        console.log("User participated with stake:", stakeAmount);
        console.log("Pyth Entropy sequence number:", sequenceNumber);
        console.log("Total participants:", gacha.totalParticipants());
        console.log("Total stakes collected:", gacha.totalStakesCollected());
    }
    
    // Note: entropyCallback is handled by Pyth Entropy; no direct simulation function is exposed.
    
    /**
     * @dev Owner ends the activity
     */
    function endActivity() external {
        uint256 ownerPrivateKey = vm.envUint("PRIVATE_KEY_OWNER");
        
        vm.startBroadcast(ownerPrivateKey);
        
        gacha.endActivity();
        
        vm.stopBroadcast();
        
        console.log("Activity ended");
        console.log("Contract is now paused");
        console.log("Total stakes collected:", gacha.totalStakesCollected());
    }
    
    /**
     * @dev Owner withdraws remaining prize pool
     */
    function withdrawRemainingPrizePool() external {
        uint256 ownerPrivateKey = vm.envUint("PRIVATE_KEY_OWNER");
        
        vm.startBroadcast(ownerPrivateKey);
        
        gacha.withdrawRemainingPrizePool();
        
        vm.stopBroadcast();
        
        console.log("Remaining prize pool withdrawn");
        console.log("Current prize pool balance:", gacha.prizePoolBalance());
    }
    
    /**
     * @dev Check contract status
     */
    function checkStatus() external view {
        (
            uint256 contractBalance,
            uint256 currentPrizePool,
            uint256 fixedPrizePool,
            uint256 totalStakes,
            uint256 participantCount,
            bool isActivityEnded,
            address owner_,
            address finalRecipient,
            uint128 currentEntropyFee
        ) = gacha.getContractStatus();
        
        console.log("=== Contract Status ===");
        console.log("Contract Balance:", contractBalance);
        console.log("Prize Pool Balance:", currentPrizePool);
        console.log("Fixed Prize Pool:", fixedPrizePool);
        console.log("Total Stakes Collected:", totalStakes);
        console.log("Participant Count:", participantCount);
        console.log("Activity Ended:", isActivityEnded);
        console.log("Owner:", owner_);
        console.log("Final Recipient Address:", finalRecipient);
        console.log("Current Entropy Fee:", currentEntropyFee);
        
        // Get inventory status
        (
            uint256[] memory amounts,
            uint256[] memory probabilities,
            uint256[] memory maxSupplies,
            uint256[] memory remaining,
            bool[] memory unlimited
        ) = gacha.getInventoryStatus();
        
        console.log("\n=== Prize Inventory ===");
        for (uint8 i = 0; i < amounts.length; i++) {
            console.log("Tier", i, ":");
            console.log("  Amount:", amounts[i]);
            console.log("  Probability:", probabilities[i], "bp");
            if (unlimited[i]) {
                console.log("  Inventory: Unlimited");
            } else {
                console.log("  Inventory:", remaining[i], "/", maxSupplies[i]);
            }
        }
    }
    
    /**
     * @dev Get participants (first 10)
     */
    function getParticipants() external view {
        (
            address[] memory participantList,
            uint256[] memory stakes,
            uint256 total
        ) = gacha.getParticipants(0, 10);
        
        console.log("=== Participants (first 10) ===");
        console.log("Total participants:", total);
        
        for (uint256 i = 0; i < participantList.length; i++) {
            console.log("Participant", i + 1, ":", participantList[i]);
            console.log("  Stake:", stakes[i]);
        }
    }
    
    
    
    /**
     * @dev Update final recipient address
     */
    function setFinalRecipientAddress() external {
        uint256 ownerPrivateKey = vm.envUint("PRIVATE_KEY_OWNER");
        address newAddress = vm.envAddress("NEW_FINAL_RECIPIENT_ADDRESS");
        
        vm.startBroadcast(ownerPrivateKey);
        
        gacha.setFinalRecipientAddress(newAddress);
        
        vm.stopBroadcast();
        
        console.log("Final recipient address updated to:", newAddress);
    }
    
    /**
     * @dev Reset prize inventory
     */
    function resetInventory() external {
        uint256 ownerPrivateKey = vm.envUint("PRIVATE_KEY_OWNER");
        
        vm.startBroadcast(ownerPrivateKey);
        
        gacha.resetInventory();
        
        vm.stopBroadcast();
        
        console.log("Prize inventory reset");
    }
}
