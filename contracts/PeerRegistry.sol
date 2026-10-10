// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ZkDcapGatewayVerifier, ILitGatewayVerifier} from "./ZkDcapGatewayVerifier.sol";

/// @notice Peer identities and paid API offers. Registration never proves availability or model quality.
contract PeerRegistry {
    struct Peer {
        uint8 roles;
        bool active;
        address operator;
        string endpoint;
        string metadataURI;
    }

    struct Offer {
        address provider;
        string model;
        uint8 apiKind;
        uint256 inputPrice;
        uint256 outputPrice;
        bool active;
    }

    mapping(address => Peer) private peers;
    /// @notice Hash of the provider's canonical privacy policy; not hardware attestation.
    mapping(address => bytes32) public privacyConfigHash;
    address public immutable privacyAuthority = msg.sender;
    ILitGatewayVerifier public privacyVerifier;
    mapping(bytes32 => Offer) private offers;
    mapping(address => bool) private registered;
    address[] private peerAddresses;
    bytes32[] private offerIds;

    error InvalidRoles();
    error InvalidProvider();
    error InvalidLength();
    error NotRegistered();
    error NotActiveProvider();
    error InvalidOffer();
    error InvalidPrivacyAttestation();
    error NotPrivacyAuthority();

    event PeerRegistered(address indexed owner, uint8 roles, address operator, string endpoint, string metadataURI);
    event PeerActiveChanged(address indexed owner, bool active);
    event PrivacyConfigUpdated(address indexed owner, bytes32 configHash);
    event PrivacyVerifierConfigured(address indexed verifier, bytes32 approvedMeasurements);

    /// @notice Once-only global policy installation. Supplier wallets cannot install per-provider verifiers.
    /// @dev No policy is pre-approved. Governance must independently review runtime measurements.
    function configurePrivacyVerifier(address escrow, address revoker, bytes32 measurements, uint32 minimumTcb) external {
        if (msg.sender != privacyAuthority || address(privacyVerifier) != address(0)) revert NotPrivacyAuthority();
        privacyVerifier = new ZkDcapGatewayVerifier(address(this), escrow, revoker, measurements, minimumTcb);
        emit PrivacyVerifierConfigured(address(privacyVerifier), measurements);
    }

    /// @notice Explicit local-test fixture hook. Impossible on Monad 10143; never used by public deployment tools.
    function configureLocalTestPrivacyVerifier(ILitGatewayVerifier verifier) external {
        if (block.chainid != 31337 || msg.sender != privacyAuthority || address(privacyVerifier) != address(0) || address(verifier).code.length == 0) revert NotPrivacyAuthority();
        privacyVerifier = verifier;
        emit PrivacyVerifierConfigured(address(verifier), bytes32(0));
    }
    event OfferUpdated(
        bytes32 indexed offerId,
        address indexed provider,
        string model,
        uint8 apiKind,
        uint256 inputPrice,
        uint256 outputPrice,
        bool active
    );

    function register(uint8 roles, address operator, string calldata endpoint, string calldata metadataURI) external {
        if (roles == 0 || roles > 3) revert InvalidRoles();
        if (bytes(endpoint).length > 512 || bytes(metadataURI).length > 512) revert InvalidLength();
        if ((roles & 1) != 0 && (operator == address(0) || bytes(endpoint).length == 0)) revert InvalidProvider();
        if (!registered[msg.sender]) {
            registered[msg.sender] = true;
            peerAddresses.push(msg.sender);
        }
        peers[msg.sender] = Peer(roles, true, operator, endpoint, metadataURI);
        emit PeerRegistered(msg.sender, roles, operator, endpoint, metadataURI);
    }

    function setActive(bool active) external {
        if (!registered[msg.sender]) revert NotRegistered();
        peers[msg.sender].active = active;
        emit PeerActiveChanged(msg.sender, active);
    }

    function getPeer(address owner) external view returns (Peer memory) {
        return peers[owner];
    }

    function setPrivacyConfig(bytes32 configHash) external {
        Peer storage peer = peers[msg.sender];
        if (!peer.active || (peer.roles & 1) == 0) revert NotActiveProvider();
        if (configHash != bytes32(0) && (msg.sender == privacyAuthority || address(privacyVerifier) == address(0) || !privacyVerifier.isValid(msg.sender, configHash, peer.operator, _privacyEscrow()))) revert InvalidPrivacyAttestation();
        privacyConfigHash[msg.sender] = configHash;
        emit PrivacyConfigUpdated(msg.sender, configHash);
    }

    function _privacyEscrow() private view returns (address) {
        (bool ok, bytes memory result) = address(privacyVerifier).staticcall(abi.encodeWithSignature("escrow()"));
        if (!ok || result.length != 32) revert InvalidPrivacyAttestation();
        return abi.decode(result, (address));
    }

    function isPrivacyVerified(address provider, bytes32 configHash, address escrow) external view returns (bool) {
        Peer memory peer = peers[provider];
        return peer.active && (peer.roles & 1) != 0 && configHash != bytes32(0) && privacyConfigHash[provider] == configHash && address(privacyVerifier) != address(0) && privacyVerifier.isValid(provider, configHash, peer.operator, escrow);
    }

    function privacyEncryptionKeyHash(address provider, bytes32 configHash, address escrow) external view returns (bytes32) {
        if (address(privacyVerifier) == address(0) || !privacyVerifier.isValid(provider, configHash, peers[provider].operator, escrow)) return bytes32(0);
        return privacyVerifier.encryptionKeyHash(provider, configHash);
    }

    function peerCount() external view returns (uint256) {
        return peerAddresses.length;
    }

    function peerAt(uint256 index) external view returns (address) {
        return peerAddresses[index];
    }

    /// @dev Prices are native currency wei per one million input/output tokens.
    function setOffer(string calldata model, uint8 apiKind, uint256 inputPrice, uint256 outputPrice, bool active)
        external
        returns (bytes32 id)
    {
        Peer storage peer = peers[msg.sender];
        if (!peer.active || (peer.roles & 1) == 0) revert NotActiveProvider();
        if (bytes(model).length == 0 || bytes(model).length > 128) revert InvalidLength();
        if (apiKind == 0 || apiKind > 3 || inputPrice == 0 || outputPrice == 0) revert InvalidOffer();
        id = keccak256(abi.encode(msg.sender, model));
        if (offers[id].provider == address(0)) offerIds.push(id);
        offers[id] = Offer(msg.sender, model, apiKind, inputPrice, outputPrice, active);
        emit OfferUpdated(id, msg.sender, model, apiKind, inputPrice, outputPrice, active);
    }

    function getOffer(bytes32 id) external view returns (Offer memory) {
        return offers[id];
    }

    function offerCount() external view returns (uint256) {
        return offerIds.length;
    }

    function offerIdAt(uint256 index) external view returns (bytes32) {
        return offerIds[index];
    }
}
