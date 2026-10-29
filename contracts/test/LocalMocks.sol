// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
// Local-chain stand-ins for a deploy dry run (anvil).
contract LocalUSDC { mapping(address => uint256) public balanceOf; }
contract LocalCDW { address public token; constructor(address t) { token = t; } }
