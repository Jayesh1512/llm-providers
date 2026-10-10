// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {ILitGatewayVerifier} from "../contracts/ZkDcapGatewayVerifier.sol";
/// @notice SIMULATION ONLY. Not an attestation verifier. Constructor refuses all public chains.
contract LocalPrivacyVerifier is ILitGatewayVerifier {
    address public immutable escrow;
    mapping(address => mapping(bytes32 => bytes32)) private keys;
    bool public valid = true;
    constructor(address escrow_) { require(block.chainid == 31337, "LOCAL TEST ONLY"); escrow = escrow_; }
    function approve(address provider, bytes32 config, bytes32 keyHash) external { keys[provider][config] = keyHash; }
    function setValid(bool value) external { valid = value; }
    function isValid(address provider, bytes32 config, address, address escrow_) external view returns (bool) { return block.chainid == 31337 && valid && escrow_ == escrow && keys[provider][config] != bytes32(0); }
    function encryptionKeyHash(address provider, bytes32 config) external view returns (bytes32) { return keys[provider][config]; }
}
