// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

contract ManageLotteryCode {
    address public owner;
    address public gachaContract;

    mapping(bytes32 => address) public usedBy;
    bytes32[] public allCodes;

    event CodeAdded(bytes32 codeHash);
    event CodeUsed(bytes32 codeHash, address user);
    event GachaContractSet(address gacha);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier onlyOwnerOrGacha() {
        require(msg.sender == owner || msg.sender == gachaContract, "Not allowed");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function batchAddCode(bytes32[] calldata codeHashes) external onlyOwner {
        for (uint256 i = 0; i < codeHashes.length; i++) {
            bytes32 codeHash = codeHashes[i];
            require(usedBy[codeHash] == address(0), "Code exists");
            usedBy[codeHash] = address(0);
            allCodes.push(codeHash);
            emit CodeAdded(codeHash);
        }
    }

    function setGachaContract(address _gacha) external onlyOwner {
        gachaContract = _gacha;
        emit GachaContractSet(_gacha);
    }

    function setUsedBy(bytes32 codeHash, address user) external onlyOwnerOrGacha {
        require(usedBy[codeHash] == address(0), "Already used");
        usedBy[codeHash] = user;
        emit CodeUsed(codeHash, user);
    }

    function getCodesByPage(uint256 start, uint256 limit) external view returns (bytes32[] memory, address[] memory) {
        uint256 end = start + limit;
        if (end > allCodes.length) {
            end = allCodes.length;
        }
        uint256 len = end - start;

        bytes32[] memory codes = new bytes32[](len);
        address[] memory users = new address[](len);

        for (uint256 i = 0; i < len; i++) {
            codes[i] = allCodes[start + i];
            users[i] = usedBy[allCodes[start + i]];
        }

        return (codes, users);
    }

    function totalCodes() external view returns (uint256) {
        return allCodes.length;
    }
}