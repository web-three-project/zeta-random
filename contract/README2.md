# ZetaGacha  (Testnet & Mainnet Guide)

This guide includes economic model explanation, deployment & configuration, invite code management, prize pool management, participate & draw commands, query & end process, and notes, targeting Foundry's `forge/cast` for actual operation.

## Table of Contents
- [Overview](#Overview)
- [Economic Model](#Economic-Model)
- [Preconditions](#Preconditions)
- [Environment Variables](#Environment-Variables)
- [Deployment](#Deployment)
- [Contract Configuration & Query](#Contract-Configuration-&-Query)
- [Invite Code Management](#Invite-Code-Management)
- [Prize Pool Management](#Prize-Pool-Management)
- [Participate & Draw](#Participate-&-Draw)
- [End & Settlement](#End-&-Settlement)
- [Notes](#Notes)
- [Appendix: Original Command List](#Appendix-Original-Command-List)

## Overview
- Contract: ZetaChain lottery game, integrated with Pyth Entropy random fee.
- Feature: Supports invite code, uses invite code to double the winning probability.
- This document focuses on command-line operations and integration processes.

5 ZETA｜1%｜N= 200｜消耗 1000 ZETA

10 ZETA ｜0.5% ｜N=150｜消耗 1500 ZETA

20 ZETA  ｜0.05% ｜N=50｜消耗 1000 ZETA

50 ZETA  ｜0.005% ｜N=20｜消耗 1000 ZETA

100 ZETA｜ 0.000005% ｜N=10｜消耗 1000 ZETA

有邀请码的中奖概率 x 2

test流程:

部署
forge script script/DeployManageLotteryCode.s.sol:DeployManageLotteryCode \
  --rpc-url $ZETA_TESTNET_RPC \
  --broadcast

forge script script/DeployStaking.s.sol --rpc-url $ZETA_TESTNET_RPC --private-key $PRIVATE_KEY_DEPLOYER --broadcast

设置
cast send $TESTNET_LOTTERYCODE_ADDRESS "setGachaContract(address)"  $TESTNET_CONTRACT_ADDRESS  \
  --rpc-url $ZETA_TESTNET_RPC \
  --private-key $PRIVATE_KEY_OWNER

cast send $TESTNET_CONTRACT_ADDRESS "setLotteryCode(address)" $TESTNET_LOTTERYCODE_ADDRESS \
  --rpc-url $ZETA_TESTNET_RPC \
  --private-key $PRIVATE_KEY_OWNER

查询设置
cast call $TESTNET_CONTRACT_ADDRESS "lotteryCode()(address)" --rpc-url $ZETA_TESTNET_RPC

cast call $TESTNET_LOTTERYCODE_ADDRESS "gachaContract()(address)" --rpc-url $ZETA_TESTNET_RPC

添加邀请码
cast send $TESTNET_LOTTERYCODE_ADDRESS "batchAddCode(bytes32[])" \
"[$(cast keccak "INVITE1"),$(cast keccak "INVITE2")]" \
--rpc-url $ZETA_TESTNET_RPC \
--private-key $PRIVATE_KEY_OWNER

查询总邀请码
cast call $TESTNET_LOTTERYCODE_ADDRESS "totalCodes()(uint256)" \
  --rpc-url $ZETA_TESTNET_RPC

奖池
cast send $TESTNET_CONTRACT_ADDRESS "seedPrizePool()" \
  --value 0.5ether \
  --rpc-url $ZETA_TESTNET_RPC \
  --private-key $PRIVATE_KEY_OWNER

查询奖池数量
cast balance      $TESTNET_CONTRACT_ADDRESS --rpc-url $ZETA_TESTNET_RPC --ether

cast call $TESTNET_CONTRACT_ADDRESS "getContractStatus()(uint256,uint256,uint256,bool,address,uint128)" --rpc-url $ZETA_TESTNET_RPC

查询entropy
cast call $TESTNET_CONTRACT_ADDRESS "getCurrentEntropyFee()(uint128)" \
  --rpc-url $ZETA_TESTNET_RPC


参与活动（原版）
cast send $TESTNET_CONTRACT_ADDRESS \
  "participateAndDraw(bytes32)" \
  0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef \
  --value $(cast call $TESTNET_CONTRACT_ADDRESS "getCurrentEntropyFee()(uint128)" --rpc-url $ZETA_TESTNET_RPC) \
  --private-key $PRIVATE_KEY_USER \
  --rpc-url $ZETA_TESTNET_RPC

无邀请码
cast send $TESTNET_CONTRACT_ADDRESS \
"participateAndDraw(bytes32,bytes32)" \
0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef \
0x0000000000000000000000000000000000000000000000000000000000000000 \
--value $(cast call $TESTNET_CONTRACT_ADDRESS \
"getCurrentEntropyFee()(uint128)" \
--rpc-url $ZETA_TESTNET_RPC) \
--rpc-url $ZETA_TESTNET_RPC \
--private-key $PRIVATE_KEY_USER

有邀请码
cast send $TESTNET_CONTRACT_ADDRESS \
"participateAndDraw(bytes32,bytes32)" \
0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef \
"$(cast keccak "INVITE1")" \
--value $(cast call $TESTNET_CONTRACT_ADDRESS "getCurrentEntropyFee()(uint128)" --rpc-url $ZETA_TESTNET_RPC) \
--private-key $PRIVATE_KEY_USER \
--rpc-url $ZETA_TESTNET_RPC

查询邀请码使用情况
cast call $TESTNET_LOTTERYCODE_ADDRESS \
"getCodesByPage(uint256,uint256)(bytes32[],address[])" \
"0" "100" \
--rpc-url $ZETA_TESTNET_RPC

# 查询单条：例如 INVITE1 的使用者
cast call $TESTNET_LOTTERYCODE_ADDRESS \
"usedBy(bytes32)(address)" \
$(cast keccak "INVITE1") \
--rpc-url $ZETA_TESTNET_RPC

结束活动，拿回奖池
cast send $TESTNET_CONTRACT_ADDRESS \
"endActivity()" \
--private-key $PRIVATE_KEY_OWNER \
--rpc-url $ZETA_TESTNET_RPC

cast send $TESTNET_CONTRACT_ADDRESS \
  "withdrawRemainingPrizePool()" \
  --private-key $PRIVATE_KEY_OWNER \
  --rpc-url $ZETA_TESTNET_RPC


