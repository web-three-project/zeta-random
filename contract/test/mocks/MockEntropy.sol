// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

// 最小化 IEntropy 接口，匹配被测合约的调用点
interface IEntropyLike {
    function getFee(address provider) external view returns (uint128);
    function requestWithCallback(address provider, bytes32 userRandomNumber) external payable returns (uint64);
}

contract MockEntropy is IEntropyLike {
    uint128 public fee;
    uint64 public lastSeq;
    address public lastProvider;
    bytes32 public lastUserRandomNumber;
    uint256 public lastMsgValue;

    constructor(uint128 _fee) {
        fee = _fee;
    }

    function setFee(uint128 _fee) external {
        fee = _fee;
    }

    function getFee(address /*provider*/) external view returns (uint128) {
        return fee;
    }

    function requestWithCallback(address provider, bytes32 userRandomNumber)
        external
        payable
        returns (uint64)
    {
        require(msg.value == fee, "fee mismatch to mock");
        lastProvider = provider;
        lastUserRandomNumber = userRandomNumber;
        lastMsgValue = msg.value;
        lastSeq += 1;
        // 注意：这里不自动回调被测合约，由测试通过 Harness 主动触发回调
        return lastSeq;
    }
}