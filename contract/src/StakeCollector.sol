// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title StakeCollector
 * @dev A simple contract to collect stakes and allow withdrawal to final recipient
 * @notice This contract is designed to work with ZetaGachaStaking
 */
contract StakeCollector is Ownable, ReentrancyGuard {
    // Events
    event StakeReceived(address indexed from, uint256 amount);
    event FundsTransferred(address indexed to, uint256 amount);
    event EmergencyWithdrawal(address indexed to, uint256 amount);
    
    // Custom errors
    error TransferFailed();
    error InsufficientBalance();
    error InvalidAddress();
    
    constructor() Ownable(msg.sender) {}
    
    /**
     * @dev Receive function to accept stake transfers
     */
    receive() external payable {
        emit StakeReceived(msg.sender, msg.value);
    }
    
    /**
     * @dev Transfer funds to final recipient (called by ZetaGachaStaking)
     * @param recipient The address to receive the funds
     * @param amount The amount to transfer
     */
    function transferToFinalRecipient(address recipient, uint256 amount) external onlyOwner nonReentrant {
        if (recipient == address(0)) revert InvalidAddress();
        if (address(this).balance < amount) revert InsufficientBalance();
        
        (bool success, ) = recipient.call{value: amount}("");
        if (!success) revert TransferFailed();
        
        emit FundsTransferred(recipient, amount);
    }
    
    /**
     * @dev Generic withdraw function (alternative interface)
     * @param recipient The address to receive the funds
     * @param amount The amount to transfer
     */
    function withdraw(address recipient, uint256 amount) external onlyOwner nonReentrant {
        if (recipient == address(0)) revert InvalidAddress();
        if (address(this).balance < amount) revert InsufficientBalance();
        
        (bool success, ) = recipient.call{value: amount}("");
        if (!success) revert TransferFailed();
        
        emit FundsTransferred(recipient, amount);
    }
    
    /**
     * @dev Emergency withdrawal of all funds (owner only)
     * @param recipient The address to receive all funds
     */
    function emergencyWithdraw(address recipient) external onlyOwner nonReentrant {
        if (recipient == address(0)) revert InvalidAddress();
        
        uint256 balance = address(this).balance;
        if (balance == 0) revert InsufficientBalance();
        
        (bool success, ) = recipient.call{value: balance}("");
        if (!success) revert TransferFailed();
        
        emit EmergencyWithdrawal(recipient, balance);
    }
    
    /**
     * @dev Get current balance
     */
    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }
    
    /**
     * @dev Transfer ownership to new owner
     */
    function transferOwnership(address newOwner) public override onlyOwner {
        if (newOwner == address(0)) revert InvalidAddress();
        super.transferOwnership(newOwner);
    }
}
