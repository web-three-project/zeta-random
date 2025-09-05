## ZetaGacha Smart Contract

A decentralized gacha game contract for ZetaChain with Pyth Entropy integration.

## Features

- **Prize System**: 5 tiers with different probabilities (0%, 1, 10, 100, 1000 ZETA)
- **Inventory Management**: Limited supply for high-value prizes with auto-downgrade
- **Revenue Management**: Automatic overflow handling to revenue address
- **Pyth Entropy**: Secure randomness for fair prize distribution
- **Owner Controls**: Pool seeding, withdrawal, and emergency functions

## Contract Architecture

### Core Functions

- `seedPool(uint256 amount)` - Owner seeds prize pool (max 5000 ZETA)
- `draw()` - Players pay 1 ZETA to participate in gacha
- `onRandomnessReady(bytes32 requestId, uint256 randomness)` - Pyth callback
- `withdrawUnclaimed()` - Owner withdraws remaining pool funds

### Prize Distribution

| Prize | Probability | Max Supply | Notes |
|-------|-------------|------------|-------|
| 0 ZETA | 50% | Unlimited | No prize |
| 1 ZETA | 40% | Unlimited | Base prize |
| 10 ZETA | 9.5% | 200 | Limited supply |
| 100 ZETA | 0.4% | 10 | Limited supply |
| 1000 ZETA | 0.1% | 2 | Limited supply |

**Total Budget**: 5000 ZETA (10×200 + 100×10 + 1000×2)

## Environment Setup

1. Copy environment variables:
```bash
cp .env.example .env
```

2. Configure your `.env` file:
```bash
# Required addresses
ADDRESS1=0x...  # Owner address (controls contract)
ADDRESS2=0x...  # Revenue address (receives overflow)

# ZetaChain RPC endpoints
ZETA_TESTNET_RPC=https://zetachain-athens-evm.blockpi.network/v1/rpc/public
ZETA_MAINNET_RPC=https://zetachain-evm.blockpi.network/v1/rpc/public

# Pyth Entropy provider
PYTH_ENTROPY_PROVIDER=0x4374e5a8b9C22271E9EB878A2AA31DE97DF15DAF

# Private keys for deployment
PRIVATE_KEY_OWNER=0x...
PRIVATE_KEY_DEPLOYER=0x...
```

## Development Commands

### Build
```bash
forge build
```

### Test
```bash
forge test -vvv
```

### Deploy to ZetaChain Testnet
```bash
forge script script/Deploy.s.sol --rpc-url $ZETA_TESTNET_RPC --broadcast --verify
```

### Interact with Contract
```bash
# Seed pool
forge script script/Interact.s.sol:InteractScript --sig "seedPool()" --rpc-url $ZETA_TESTNET_RPC --broadcast

# Check status
forge script script/Interact.s.sol:InteractScript --sig "checkStatus()" --rpc-url $ZETA_TESTNET_RPC

# Test draw
forge script script/Interact.s.sol:InteractScript --sig "testDraw()" --rpc-url $ZETA_TESTNET_RPC --broadcast
```

## Security Features

- **ReentrancyGuard**: Prevents reentrancy attacks
- **Pausable**: Emergency stop functionality
- **Ownable**: Access control for administrative functions
- **Custom Errors**: Gas-efficient error handling

## Production Considerations

⚠️ **Important**: This contract includes a simplified Pyth Entropy integration for demo purposes. For production deployment:

1. **Integrate Real Pyth Entropy**: Replace `_requestRandomness()` with actual Pyth Entropy API calls
2. **Set Proper Pyth Provider**: Use the official Pyth Entropy contract address on ZetaChain
3. **Security Audit**: Conduct thorough security review before mainnet deployment
4. **Gas Optimization**: Consider optimizing for ZetaChain's gas costs

## Contract Events

- `DrawRequested(address indexed player, bytes32 indexed requestId)`
- `DrawCompleted(address indexed player, uint256 amount)`
- `PoolSeeded(uint256 amount, uint256 newBalance)`
- `RevenueTransferred(uint256 amount)`


# 使用方法
1.初始化奖池
# 使用PRIVATE_KEY_OWNER为合约充值奖池
# 测试网版本
cast send $TESTNET_CONTRACT_ADDRESS "seedPrizePool()" \
    --value 0.5ether \
    --private-key $PRIVATE_KEY_OWNER \
    --rpc-url $ZETA_TESTNET_RPC

# 主网版本  
cast send $STAKING_CONTRACT_ADDRESS "seedPrizePool()" \
    --value 5000ether \
    --private-key $PRIVATE_KEY_OWNER \
    --rpc-url $ZETA_TESTNET_RPC

2.用户参与抽奖
# 使用PRIVATE_KEY_USER进行测试
# 测试网版本
cast send $TESTNET_CONTRACT_ADDRESS "participateAndDraw()" \
    --value 0.0001ether \
    --private-key $PRIVATE_KEY_USER \
    --rpc-url $ZETA_TESTNET_RPC

# 主网版本
cast send $STAKING_CONTRACT_ADDRESS "participateAndDraw()" \
    --value 1ether \
    --private-key $PRIVATE_KEY_USER \
    --rpc-url $ZETA_TESTNET_RPC

3.合约状态查询
# 查询奖池余额
cast call $CONTRACT_ADDRESS "prizePoolBalance()" --rpc-url $ZETA_TESTNET_RPC

# 查询用户质押
cast call $CONTRACT_ADDRESS "participantStakes(address)" $USER_ADDRESS --rpc-url $ZETA_TESTNET_RPC

# 查询总质押收集
cast call $CONTRACT_ADDRESS "totalStakesCollected()" --rpc-url $ZETA_TESTNET_RPC

# 查询StakeCollector余额
cast call $STAKE_COLLECTION_ADDRESS "getBalance()" --rpc-url $ZETA_TESTNET_RPC

4.结束活动
# 使用PRIVATE_KEY_OWNER结束活动
cast send $CONTRACT_ADDRESS "endActivity()" \
    --private-key $PRIVATE_KEY_OWNER \
    --rpc-url $ZETA_TESTNET_RPC

# 提取剩余奖池
cast send $CONTRACT_ADDRESS "withdrawRemainingPrizePool()" \
    --private-key $PRIVATE_KEY_OWNER \
    --rpc-url $ZETA_TESTNET_RPC

5.转移质押资金

# 使用PRIVATE_KEY_OWNER从StakeCollector转移资金到最终接收地址
cast send $STAKE_COLLECTION_ADDRESS "emergencyWithdraw(address)" $FINAL_RECIPIENT_ADDRESS \
    --private-key $PRIVATE_KEY_OWNER \
    --rpc-url $ZETA_TESTNET_RPC
