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

- `seedPrizePool()` - Owner injects the fixed prize pool (exactly 5000 ZETA)
- `participateAndDraw(bytes32 userRandomNumber)` - User participates by paying the current Pyth Entropy fee
- `entropyCallback(uint64 sequenceNumber, address provider, bytes32 randomNumber)` - Pyth Entropy callback
- `withdrawRemainingPrizePool()` - Owner withdraws remaining pool funds after ending the activity

## 部署与测试流程

下列命令使用 Foundry 的 forge/cast 工具，请先在项目根目录加载环境变量（.env）：

```bash
source .env
```

### 1. 部署（测试网/主网）

```bash
# 测试网部署（使用 Zeta 测试网 RPC）
forge script script/DeployStakingTestnet.s.sol \
  --rpc-url $ZETA_TESTNET_RPC \
  --broadcast

# 主网部署（使用 Zeta 主网 RPC）
forge script script/DeployStaking.s.sol \
  --rpc-url $ZETA_MAINNET_RPC \
  --broadcast
```

部署后请记录合约地址到环境变量，例如：

```bash
export TESTNET_CONTRACT_ADDRESS=0x...
export MAINNET_CONTRACT_ADDRESS=0x...
```

### 2. 奖池注入金额（Owner 执行）

合约 `seedPrizePool()` 需要一次性注入固定奖池 `FIXED_PRIZE_POOL = 5000 ether`。

```bash
# 测试网
cast send $TESTNET_CONTRACT_ADDRESS "seedPrizePool()" \
  --value 5000ether \
  --rpc-url $ZETA_TESTNET_RPC \
  --private-key $PRIVATE_KEY_OWNER

# 主网
cast send $MAINNET_CONTRACT_ADDRESS "seedPrizePool()" \
  --value 5000ether \
  --rpc-url $ZETA_MAINNET_RPC \
  --private-key $PRIVATE_KEY_OWNER
```

### 3. 用户参与活动（payable 需支付 Pyth 费用）

`participateAndDraw(bytes32 userRandomNumber)` 需要随交易支付当前的 Pyth Entropy 费用，不能自定义金额。

先查询当前费用：

```bash
# 查询当前 Entropy 费用（测试网）
cast call $TESTNET_CONTRACT_ADDRESS "getCurrentEntropyFee()(uint128)" \
  --rpc-url $ZETA_TESTNET_RPC

# 查询当前 Entropy 费用（主网）
cast call $MAINNET_CONTRACT_ADDRESS "getCurrentEntropyFee()(uint128)" \
  --rpc-url $ZETA_MAINNET_RPC
```

将上面返回的费用数值作为 `--value` 参与抽奖：

```bash
# 测试网示例（bytes32 用户随机数可自定义）
cast send $TESTNET_CONTRACT_ADDRESS \
  "participateAndDraw(bytes32)" \
  0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef \
  --value $(cast call $TESTNET_CONTRACT_ADDRESS "getCurrentEntropyFee()(uint128)" --rpc-url $ZETA_TESTNET_RPC) \
  --private-key $PRIVATE_KEY_USER \
  --rpc-url $ZETA_TESTNET_RPC

# 主网示例
cast send $MAINNET_CONTRACT_ADDRESS \
  "participateAndDraw(bytes32)" \
  0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef \
  --value $(cast call $MAINNET_CONTRACT_ADDRESS "getCurrentEntropyFee()(uint128)" --rpc-url $ZETA_MAINNET_RPC) \
  --private-key $PRIVATE_KEY_USER \
  --rpc-url $ZETA_MAINNET_RPC
```

### 4. 结束活动并提取剩余奖池（Owner 执行）

```bash
# 结束活动
cast send $TESTNET_CONTRACT_ADDRESS \
  "endActivity()" \
  --private-key $PRIVATE_KEY_OWNER \
  --rpc-url $ZETA_TESTNET_RPC

# 提取剩余奖池到 Owner
cast send $TESTNET_CONTRACT_ADDRESS \
  "withdrawRemainingPrizePool()" \
  --private-key $PRIVATE_KEY_OWNER \
  --rpc-url $ZETA_TESTNET_RPC
```

主网同理，将地址与 RPC 替换为 `$MAINNET_CONTRACT_ADDRESS` 与 `$ZETA_MAINNET_RPC`。

### 5. 查询命令

```bash
# 查询奖池余额（合约内部记录）
cast call $TESTNET_CONTRACT_ADDRESS "prizePoolBalance()" --rpc-url $ZETA_TESTNET_RPC

# 查询合约状态（返回：contractBalance, currentPrizePool, fixedPrizePool, isActivityEnded, owner, currentEntropyFee）
cast call $TESTNET_CONTRACT_ADDRESS \
  "getContractStatus()(uint256,uint256,uint256,bool,address,uint128)" \
  --rpc-url $ZETA_TESTNET_RPC

# 查询合约原生代币余额
cast balance $TESTNET_CONTRACT_ADDRESS --rpc-url $ZETA_TESTNET_RPC --ether

# Pyth 需要支付的费用（同第 3 步）
cast call $TESTNET_CONTRACT_ADDRESS \
  "getCurrentEntropyFee()(uint128)" \
  --rpc-url $ZETA_TESTNET_RPC
```

如需主网查询，将地址与 RPC 切换为 `$MAINNET_CONTRACT_ADDRESS` 与 `$ZETA_MAINNET_RPC`。

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



