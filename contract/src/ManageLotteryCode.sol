// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

contract ManageLotteryCode {
    address public owner;
    address public gachaContract;

    // 邀请码是否存在
    mapping(bytes32 => bool) public codeExists;
    // 邀请码是否被使用，以及使用者
    mapping(bytes32 => address) public usedBy;
    // 存储所有的邀请码 hash，用于分页查询
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

    /// @notice 批量添加邀请码（哈希后的值）
    /// @param codeHashes 邀请码的 keccak256 哈希数组
    function batchAddCode(bytes32[] calldata codeHashes) external onlyOwner {
        for (uint256 i = 0; i < codeHashes.length; i++) {
            require(!codeExists[codeHashes[i]], "Code exists");
            codeExists[codeHashes[i]] = true;
            allCodes.push(codeHashes[i]);
            emit CodeAdded(codeHashes[i]);
        }
    }

    /// @notice 设置可调用的 Gacha 合约地址
    function setGachaContract(address _gacha) external onlyOwner {
        gachaContract = _gacha;
        emit GachaContractSet(_gacha);
    }

    /// @notice 设置某个邀请码的使用者（只能 owner 或 Gacha 合约调用）
    /// @param codeHash 邀请码 keccak256 哈希
    /// @param user 使用该邀请码的用户地址
    function setUsedBy(bytes32 codeHash, address user) external onlyOwnerOrGacha {
        require(codeExists[codeHash], "Code does not exist");
        require(usedBy[codeHash] == address(0), "Already used");

        usedBy[codeHash] = user;
        emit CodeUsed(codeHash, user);
    }

    /// @notice 分页查询邀请码和使用者
    /// @param start 起始下标
    /// @param limit 查询数量
    /// @return codes 邀请码数组
    /// @return users 对应使用者数组
    function getCodesByPage(uint256 start, uint256 limit) external view returns (bytes32[] memory codes, address[] memory users) {
        uint256 end = start + limit;
        if (end > allCodes.length) {
            end = allCodes.length;
        }
        uint256 len = end - start;

        codes = new bytes32[](len);
        users = new address[](len);

        for (uint256 i = 0; i < len; i++) {
            bytes32 code = allCodes[start + i];
            codes[i] = code;
            users[i] = usedBy[code];
        }
    }
    /// @notice 获取邀请码总数
    function totalCodes() external view returns (uint256) {
        return allCodes.length;
    }

    /// @notice 查询邀请码当前状态（存在性与使用者）
    /// @param codeHash 邀请码 keccak256 哈希
    /// @return exists 是否存在
    /// @return user 使用该邀请码的用户地址（未使用则为 address(0)）
    function getCodeStatus(bytes32 codeHash) external view returns (bool exists, address user) {
        exists = codeExists[codeHash];
        user = usedBy[codeHash];
    }

    /// @notice 邀请码是否有效（定义为：存在 且 未被使用）
    /// @param codeHash 邀请码 keccak256 哈希
    /// @return valid 是否有效
    function isCodeValid(bytes32 codeHash) external view returns (bool valid) {
        valid = codeExists[codeHash] && usedBy[codeHash] == address(0);
    }
}