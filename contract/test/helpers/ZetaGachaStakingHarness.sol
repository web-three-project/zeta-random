// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "../../src/ZetaGachaStaking.sol";

// 继承被测合约，公开一个测试用入口来触发内部回调
contract ZetaGachaStakingHarness is ZetaGachaStaking {
    constructor(address _entropy, address _provider)
        ZetaGachaStaking(_entropy, _provider)
    {}

    // 测试辅助方法：手动触发内部 entropyCallback
    function testEntropyCallback(uint64 sequenceNumber, address provider, bytes32 randomNumber) external {
        entropyCallback(sequenceNumber, provider, randomNumber);
    }
}