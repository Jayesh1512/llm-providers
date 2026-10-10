// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.28;

import {RiscZeroGroth16Verifier} from "./vendor/risc0/groth16/RiscZeroGroth16Verifier.sol";
import {ControlID} from "./vendor/risc0/groth16/ControlID.sol";

interface ILitGatewayVerifier {
    function isValid(address provider, bytes32 configHash, address operator, address escrow) external view returns (bool);
    function encryptionKeyHash(address provider, bytes32 configHash) external view returns (bytes32);
}

/// @notice Verifies zkDCAP execution, not an oracle verdict. Current Lit quotes lack the required action binding.
/// @dev An approved runtime must itself authenticate current-action identity/key before putting bindingDigest in REPORTDATA.
contract ZkDcapGatewayVerifier is ILitGatewayVerifier {
    // datachainlab/zkdcap fe39b99e976a9dc0e8d7232f0056b31eb81db7b1, checked-in RISC Zero 3.0.5 guest.
    bytes32 public constant DCAP_IMAGE_ID = 0x65ca60d4fce9aed394c4363c4cc550e781995c296eefe9f93858689078ccf82e;
    // keccak256 of DER from certificates.trustedservices.intel.com, independently compared with zkDCAP fixture.
    bytes32 public constant INTEL_ROOT_HASH = 0xa1acc73eb45794fa1734f14d882e91925b6006f79d3bb2460df9d01b333d7009;
    bytes32 private constant BINDING_TYPEHASH = keccak256("LLMProvidersLitHardwareBinding:v1");
    RiscZeroGroth16Verifier public immutable proofVerifier;
    address public immutable registry;
    address public immutable escrow;
    address public immutable revoker;
    bytes32 public immutable approvedMeasurements;
    uint32 public minimumTcbEvaluation;
    uint64 public epoch = 1;
    bool public disabled;
    uint256 private nonce;
    uint64 public constant CHALLENGE_LIFETIME = 10 minutes;
    uint64 public constant GATEWAY_LIFETIME = 1 hours;

    struct Identity {
        address provider;
        address operator;
        bytes32 configHash;
        bytes32 actionIdHash;
        bytes32 actionKeyHash;
        bytes32 encryptionKeyHash;
        bytes32 tlsCertificateHash;
    }
    struct Runtime {
        uint64 notBefore;
        uint64 notAfter;
        uint32 tcbEvaluation;
        bytes32 measurements;
        bytes32 reportData;
        bytes32 reportDataTail;
    }
    struct Challenge { address provider; bytes32 identityHash; uint64 expiresAt; }
    struct Gateway { address operator; bytes32 encryptionKey; bytes32 identityHash; uint64 expiresAt; uint64 epoch; uint32 tcbEvaluation; bool revoked; }
    mapping(bytes32 => Challenge) public challenges;
    mapping(address => mapping(bytes32 => Gateway)) public gateways;
    mapping(address => mapping(bytes32 => bool)) public revokedConfigurations;
    error InvalidPolicy();
    error InvalidEvidence();
    error InvalidBinding();
    error NotRevoker();
    event ChallengeCreated(bytes32 indexed challenge, address indexed provider, bytes32 identityHash, uint64 expiresAt);
    event GatewayVerified(address indexed provider, bytes32 indexed configHash, bytes32 identityHash, uint64 expiresAt);
    event GatewayRevoked(address indexed provider, bytes32 indexed configHash);
    event PolicyRevoked(uint64 epoch);
    event MinimumTcbRaised(uint32 minimum);

    constructor(address registry_, address escrow_, address revoker_, bytes32 measurements_, uint32 minimumTcb_) {
        if ((block.chainid != 10143 && block.chainid != 31337) || registry_.code.length == 0 || escrow_.code.length == 0 || revoker_ == address(0) || measurements_ == bytes32(0) || minimumTcb_ == 0) revert InvalidPolicy();
        (bool linked, bytes memory result) = escrow_.staticcall(abi.encodeWithSignature("registry()"));
        if (!linked || result.length != 32 || abi.decode(result, (address)) != registry_) revert InvalidPolicy();
        registry = registry_; escrow = escrow_; revoker = revoker_; approvedMeasurements = measurements_; minimumTcbEvaluation = minimumTcb_;
        // No caller-supplied verifier, fake receipt verifier, routing upgrade or oracle.
        proofVerifier = new RiscZeroGroth16Verifier(ControlID.CONTROL_ROOT, ControlID.BN254_CONTROL_ID);
    }

    /// @notice Cryptographically verified full DCAP result. No state is created by parsing unverified claims.
    function verifyRuntime(bytes calldata seal, bytes calldata journal) public view returns (Runtime memory r) {
        if (disabled || journal.length < 715 || journal.length > 4096 || seal.length != 260) revert InvalidEvidence();
        proofVerifier.verify(seal, DCAP_IMAGE_ID, sha256(journal));
        return _validateRuntimeClaims(journal);
    }

    /// @dev Parsing alone is not verification; production reaches this only after authenticating the zkVM receipt.
    function _validateRuntimeClaims(bytes calldata journal) internal view returns (Runtime memory r) {
        // zkDCAP v0 output: BE fields, followed by Intel's 584-byte LE TD10 report and ABI advisory list.
        if (uint16(bytes2(journal[0:2])) != 0 || uint16(bytes2(journal[2:4])) != 4 || uint32(bytes4(journal[4:8])) != 0x81 || uint8(journal[8]) != 0 || bytes32(journal[19:51]) != INTEL_ROOT_HASH) revert InvalidEvidence();
        r.tcbEvaluation = uint32(bytes4(journal[9:13]));
        r.notBefore = uint64(bytes8(journal[51:59])); r.notAfter = uint64(bytes8(journal[59:67]));
        if (r.tcbEvaluation < minimumTcbEvaluation || r.notBefore >= r.notAfter || block.timestamp < r.notBefore || block.timestamp >= r.notAfter) revert InvalidEvidence();
        bytes calldata body = journal[67:651];
        if ((uint8(body[120]) & 1) != 0) revert InvalidEvidence(); // TD_ATTRIBUTES.DEBUG is LE bit zero.
        r.measurements = keccak256(abi.encodePacked(body[136:184], body[328:520]));
        if (r.measurements != approvedMeasurements) revert InvalidEvidence();
        // Conservative policy: STATUS_OK and no advisory IDs. Require canonical empty ABI list.
        if (journal.length != 715 || uint256(bytes32(journal[651:683])) != 32 || uint256(bytes32(journal[683:715])) != 0) revert InvalidEvidence();
        r.reportData = bytes32(body[520:552]); r.reportDataTail = bytes32(body[552:584]);
    }

    function beginVerification(Identity calldata identity) external returns (bytes32 id) {
        if (disabled || identity.provider != msg.sender || identity.provider == revoker || identity.operator == address(0) || identity.configHash == bytes32(0) || identity.actionIdHash == bytes32(0) || identity.actionKeyHash == bytes32(0) || identity.encryptionKeyHash == bytes32(0) || identity.tlsCertificateHash == bytes32(0)) revert InvalidBinding();
        bytes32 identityHash = keccak256(abi.encode(identity));
        id = keccak256(abi.encode(BINDING_TYPEHASH, block.chainid, address(this), identityHash, ++nonce, blockhash(block.number - 1)));
        uint64 expiresAt = uint64(block.timestamp) + CHALLENGE_LIFETIME;
        challenges[id] = Challenge(msg.sender, identityHash, expiresAt);
        emit ChallengeCreated(id, msg.sender, identityHash, expiresAt);
    }
    function bindingDigest(Identity calldata identity, bytes32 challenge) public view returns (bytes32) {
        return keccak256(abi.encode(BINDING_TYPEHASH, block.chainid, address(this), registry, escrow, identity, challenge));
    }
    function submitGateway(Identity calldata identity, bytes32 challenge, bytes calldata seal, bytes calldata journal) external {
        Challenge memory pending = challenges[challenge];
        if (revokedConfigurations[identity.provider][identity.configHash] || pending.provider != identity.provider || pending.identityHash != keccak256(abi.encode(identity)) || block.timestamp >= pending.expiresAt) revert InvalidBinding();
        Runtime memory r = verifyRuntime(seal, journal);
        // Actual current Lit evidence (zero REPORTDATA or SHA256(checksum list)) fails here.
        // Neither a wallet signature nor a policy hash can fill the runtime -> action -> key gap.
        if (r.reportData != bindingDigest(identity, challenge) || r.reportDataTail != bytes32(0)) revert InvalidBinding();
        delete challenges[challenge];
        uint64 expiresAt = uint64(block.timestamp) + GATEWAY_LIFETIME;
        if (r.notAfter < expiresAt) expiresAt = r.notAfter;
        gateways[identity.provider][identity.configHash] = Gateway(identity.operator, identity.encryptionKeyHash, keccak256(abi.encode(identity)), expiresAt, epoch, r.tcbEvaluation, false);
        emit GatewayVerified(identity.provider, identity.configHash, keccak256(abi.encode(identity)), expiresAt);
    }
    function isValid(address provider, bytes32 config, address operator, address escrow_) external view returns (bool) {
        Gateway memory g = gateways[provider][config];
        return !disabled && escrow_ == escrow && !g.revoked && g.epoch == epoch && g.expiresAt > block.timestamp && g.operator == operator && operator != address(0) && g.tcbEvaluation >= minimumTcbEvaluation;
    }
    function encryptionKeyHash(address provider, bytes32 config) external view returns (bytes32) { return gateways[provider][config].encryptionKey; }
    function revokeGateway(address provider, bytes32 config) external {
        if (msg.sender != revoker) revert NotRevoker();
        gateways[provider][config].revoked = true;
        revokedConfigurations[provider][config] = true;
        emit GatewayRevoked(provider, config);
    }
    function revokePolicy() external {
        if (msg.sender != revoker) revert NotRevoker();
        disabled = true; ++epoch; emit PolicyRevoked(epoch); // permanent; new reviewed deployment required.
    }
    /// @notice Permissionless monotonic counter update, authenticated by Intel-rooted proof; never a supplied number.
    function raiseMinimumTcb(bytes calldata seal, bytes calldata journal) external {
        Runtime memory r = verifyRuntime(seal, journal);
        if (r.tcbEvaluation <= minimumTcbEvaluation) revert InvalidEvidence();
        minimumTcbEvaluation = r.tcbEvaluation;
        emit MinimumTcbRaised(r.tcbEvaluation);
    }
}
