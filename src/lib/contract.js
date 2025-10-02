// src/lib/contract.js

// 依赖：wagmi/actions（v2 行为 API），viem
import {
  readContract,
  writeContract,
  waitForTransactionReceipt,
  watchContractEvent,
} from '@wagmi/core';
  import { toHex, keccak256 } from 'viem';
  
  // ===== 合约 ABI（ZetaGachaStaking.sol，对齐最新合约）=====
  export const ZetaGachaStakingAbi = [
    // constants / views
    { type: 'function', stateMutability: 'view', name: 'FIXED_PRIZE_POOL', inputs: [], outputs: [{ type: 'uint256' }] },
    { type: 'function', stateMutability: 'view', name: 'prizePoolBalance', inputs: [], outputs: [{ type: 'uint256' }] },
    { type: 'function', stateMutability: 'view', name: 'activityEnded', inputs: [], outputs: [{ type: 'bool' }] },
    { type: 'function', stateMutability: 'view', name: 'owner', inputs: [], outputs: [{ type: 'address' }] },
    { type: 'function', stateMutability: 'view', name: 'MAX_DRAWS_PER_ADDRESS', inputs: [], outputs: [{ type: 'uint32' }] },
    { type: 'function', stateMutability: 'view', name: 'totalDraws', inputs: [{ type: 'address' }], outputs: [{ type: 'uint32' }] },
    { type: 'function', stateMutability: 'view', name: 'remainingDraws', inputs: [{ type: 'address' }], outputs: [{ type: 'uint32' }] },
  
    // views - helpers
    { type: 'function', stateMutability: 'view', name: 'getCurrentEntropyFee', inputs: [], outputs: [{ type: 'uint128' }] },
    {
      type: 'function',
      stateMutability: 'view',
      name: 'getContractStatus',
      inputs: [],
      outputs: [
        { type: 'uint256', name: 'contractBalance' },
        { type: 'uint256', name: 'currentPrizePool' },
        { type: 'uint256', name: 'fixedPrizePool' },
        { type: 'bool',    name: 'isActivityEnded' },
        { type: 'address', name: 'owner_' },
        { type: 'uint128', name: 'currentEntropyFee' },
      ],
    },
    {
      type: 'function',
      stateMutability: 'view',
      name: 'getInventoryStatus',
      inputs: [],
      outputs: [
        { type: 'uint256[]', name: 'amounts' },
        { type: 'uint256[]', name: 'probabilities' },
        { type: 'uint256[]', name: 'maxSupplies' },
        { type: 'uint256[]', name: 'remaining' },
        { type: 'bool[]',    name: 'unlimited' },
      ],
    },
  
    // user
    {
      type: 'function',
      stateMutability: 'payable',
      name: 'participateAndDraw',
      inputs: [
        { type: 'bytes32', name: 'userRandomNumber' },
        { type: 'bytes32', name: 'codeHash' },
      ],
      outputs: [{ type: 'uint64', name: 'sequenceNumber' }],
    },
  
    // owner/admin
    { type: 'function', stateMutability: 'payable', name: 'seedPrizePool', inputs: [], outputs: [] },
    { type: 'function', stateMutability: 'nonpayable', name: 'endActivity', inputs: [], outputs: [] },
    { type: 'function', stateMutability: 'nonpayable', name: 'withdrawRemainingPrizePool', inputs: [], outputs: [] },
    { type: 'function', stateMutability: 'nonpayable', name: 'resetInventory', inputs: [], outputs: [] },
    { type: 'function', stateMutability: 'nonpayable', name: 'pause', inputs: [], outputs: [] },
    { type: 'function', stateMutability: 'nonpayable', name: 'unpause', inputs: [], outputs: [] },
  
    // events（包含 codeHash）
    {
      type: 'event',
      name: 'DrawRequested',
      inputs: [
        { indexed: true, name: 'player', type: 'address' },
        { indexed: true, name: 'sequenceNumber', type: 'uint64' },
        { indexed: false, name: 'entropyFee', type: 'uint128' },
        { indexed: false, name: 'codeHash', type: 'bytes32' },
      ],
      anonymous: false,
    },
    {
      type: 'event',
      name: 'DrawCompleted',
      inputs: [
        { indexed: true, name: 'player', type: 'address' },
        { indexed: false, name: 'tierIndex', type: 'uint8' },
        { indexed: false, name: 'amount', type: 'uint256' },
        { indexed: false, name: 'codeHash', type: 'bytes32' },
      ],
      anonymous: false,
    },
    { type: 'event', name: 'PrizePoolSeeded', inputs: [{ indexed: false, name: 'amount', type: 'uint256' }, { indexed: false, name: 'newBalance', type: 'uint256' }], anonymous: false },
    { type: 'event', name: 'ActivityEnded', inputs: [], anonymous: false },
    { type: 'event', name: 'InventoryReset', inputs: [], anonymous: false },
  ];
  
  // ===== 合约 ABI（ManageLotteryCode.sol，最小只读片段）=====
  // 仅包含查询有效性所需的两个 getter：codeExists(bytes32) 与 usedBy(bytes32)
  export const ManageLotteryCodeAbi = [
    { type: 'function', stateMutability: 'view', name: 'codeExists', inputs: [{ type: 'bytes32' }], outputs: [{ type: 'bool' }] },
    { type: 'function', stateMutability: 'view', name: 'usedBy',     inputs: [{ type: 'bytes32' }], outputs: [{ type: 'address' }] },
  ];
  
  // ===== 工具：前端生成 bytes32 随机数 =====
  export function randomBytes32() {
    // 浏览器环境生成 32 字节随机数
    const arr = new Uint8Array(32);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      crypto.getRandomValues(arr);
    } else {
      // 兜底：较弱的随机（仅在极端环境下）
      for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256);
    }
    return toHex(arr); // '0x' + 64 hex chars
  }
  
  // 前端将邀请码字符串转为 keccak256(bytes(code))
  export function codeStringToHash(code) {
    return keccak256(toHex(code || ''));
  }
  
  // ===== 读方法 =====
  
  // 查询某个邀请码的状态（存在性 + 使用者）
  // 返回：{ exists: boolean, usedBy: `0x...`, used: boolean }
  export async function getLotteryCodeStatus({ config, managerAddress, codeHash }) {
    const [exists, usedBy] = await Promise.all([
      readContract(config, {
        address: managerAddress,
        abi: ManageLotteryCodeAbi,
        functionName: 'codeExists',
        args: [codeHash],
      }),
      readContract(config, {
        address: managerAddress,
        abi: ManageLotteryCodeAbi,
        functionName: 'usedBy',
        args: [codeHash],
      }),
    ]);
    const used = usedBy !== '0x0000000000000000000000000000000000000000';
    return { exists, usedBy, used };
  }
  
  // 便捷函数：邀请码是否“有效”（定义为：存在 且 未被使用）
  export async function isLotteryCodeValid({ config, managerAddress, codeHash }) {
    const status = await getLotteryCodeStatus({ config, managerAddress, codeHash });
    return status.exists && !status.used;
  }
  export async function readEntropyFee({ config, contractAddress }) {
    return readContract(config, {
      address: contractAddress,
      abi: ZetaGachaStakingAbi,
      functionName: 'getCurrentEntropyFee',
    });
  }
  
  export async function getContractStatus({ config, contractAddress }) {
    return readContract(config, {
      address: contractAddress,
      abi: ZetaGachaStakingAbi,
      functionName: 'getContractStatus',
    });
  }
  
  export async function getInventoryStatus({ config, contractAddress }) {
    return readContract(config, {
      address: contractAddress,
      abi: ZetaGachaStakingAbi,
      functionName: 'getInventoryStatus',
    });
  }
  
  export async function getUserDrawCount({ config, contractAddress, userAddress }) {
    return readContract(config, {
      address: contractAddress,
      abi: ZetaGachaStakingAbi,
      functionName: 'totalDraws',
      args: [userAddress],
    });
  }
  
  export async function getMaxDrawsPerUser({ config, contractAddress }) {
    return readContract(config, {
      address: contractAddress,
      abi: ZetaGachaStakingAbi,
      functionName: 'MAX_DRAWS_PER_ADDRESS',
    });
  }
  
  // 查询某地址剩余抽奖次数（合约新增 view）
  export async function getRemainingDraws({ config, contractAddress, userAddress }) {
    return readContract(config, {
      address: contractAddress,
      abi: ZetaGachaStakingAbi,
      functionName: 'remainingDraws',
      args: [userAddress],
    });
  }
  
  export async function getPrizePoolBalance({ config, contractAddress }) {
    return readContract(config, {
      address: contractAddress,
      abi: ZetaGachaStakingAbi,
      functionName: 'prizePoolBalance',
    });
  }
  
  export async function getActivityEnded({ config, contractAddress }) {
    return readContract(config, {
      address: contractAddress,
      abi: ZetaGachaStakingAbi,
      functionName: 'activityEnded',
    });
  }
  
  // ===== 写方法 =====
  // 参与抽奖：会先读取 entropy fee，若未显式传递 value 则自动用该费用
  export async function participateAndDraw({
    config,
    contractAddress,
    userRandomNumber, // bytes32
    codeHash = '0x0000000000000000000000000000000000000000000000000000000000000000', // 可选：邀请码哈希；无则传 0x0
    value,            // 可选：以 wei 指定。若不传将自动读取 entropy fee 作为 msg.value
  }) {
    const fee = value ?? await readEntropyFee({ config, contractAddress });
    const hash = await writeContract(config, {
      address: contractAddress,
      abi: ZetaGachaStakingAbi,
      functionName: 'participateAndDraw',
      args: [userRandomNumber, codeHash],
      value: fee,
    });
    const receipt = await waitForTransactionReceipt(config, { hash });
    return receipt;
  }
  
  // 管理员：注资奖池（注意：需要严格等于 FIXED_PRIZE_POOL）
  export async function adminSeedPrizePool({
    config,
    contractAddress,
    value, // 必须等于 FIXED_PRIZE_POOL（主网：5000 ether；测试版可能缩放，请以合约为准）
  }) {
    const hash = await writeContract(config, {
      address: contractAddress,
      abi: ZetaGachaStakingAbi,
      functionName: 'seedPrizePool',
      value,
    });
    return waitForTransactionReceipt(config, { hash });
  }
  
  export async function adminEndActivity({ config, contractAddress }) {
    const hash = await writeContract(config, {
      address: contractAddress,
      abi: ZetaGachaStakingAbi,
      functionName: 'endActivity',
    });
    return waitForTransactionReceipt(config, { hash });
  }
  
  export async function adminWithdrawRemaining({ config, contractAddress }) {
    const hash = await writeContract(config, {
      address: contractAddress,
      abi: ZetaGachaStakingAbi,
      functionName: 'withdrawRemainingPrizePool',
    });
    return waitForTransactionReceipt(config, { hash });
  }
  
  export async function adminResetInventory({ config, contractAddress }) {
    const hash = await writeContract(config, {
      address: contractAddress,
      abi: ZetaGachaStakingAbi,
      functionName: 'resetInventory',
    });
    return waitForTransactionReceipt(config, { hash });
  }
  
  export async function adminPause({ config, contractAddress }) {
    const hash = await writeContract(config, {
      address: contractAddress,
      abi: ZetaGachaStakingAbi,
      functionName: 'pause',
    });
    return waitForTransactionReceipt(config, { hash });
  }
  
  export async function adminUnpause({ config, contractAddress }) {
    const hash = await writeContract(config, {
      address: contractAddress,
      abi: ZetaGachaStakingAbi,
      functionName: 'unpause',
    });
    return waitForTransactionReceipt(config, { hash });
  }
  
  // ===== 事件监听 =====
  // 返回 unwatch() 以停止监听
  export function onDrawRequested({ config, contractAddress, listener }) {
    return watchContractEvent(config, {
      address: contractAddress,
      abi: ZetaGachaStakingAbi,
      eventName: 'DrawRequested',
      onLogs: (logs) => listener?.(logs),
    });
  }
  
  export function onDrawCompleted({ config, contractAddress, listener }) {
    return watchContractEvent(config, {
      address: contractAddress,
      abi: ZetaGachaStakingAbi,
      eventName: 'DrawCompleted',
      onLogs: (logs) => listener?.(logs),
    });
  }
  
  export function onActivityEnded({ config, contractAddress, listener }) {
    return watchContractEvent(config, {
      address: contractAddress,
      abi: ZetaGachaStakingAbi,
      eventName: 'ActivityEnded',
      onLogs: (logs) => listener?.(logs),
    });
  }
  
  export function onPrizePoolSeeded({ config, contractAddress, listener }) {
    return watchContractEvent(config, {
      address: contractAddress,
      abi: ZetaGachaStakingAbi,
      eventName: 'PrizePoolSeeded',
      onLogs: (logs) => listener?.(logs),
    });
  }
  
  export function onInventoryReset({ config, contractAddress, listener }) {
    return watchContractEvent(config, {
      address: contractAddress,
      abi: ZetaGachaStakingAbi,
      eventName: 'InventoryReset',
      onLogs: (logs) => listener?.(logs),
    });
  }