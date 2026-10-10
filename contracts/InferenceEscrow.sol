// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {PeerRegistry} from "./PeerRegistry.sol";

/// @notice Consumer-approved receipts settle capped requests. Receipts are not proof of model execution.
contract InferenceEscrow {
    struct Request {
        address consumer;
        address provider;
        bytes32 offerId;
        bytes32 promptHash;
        uint256 deposit;
        uint256 inputPrice;
        uint256 outputPrice;
        uint64 expiresAt;
        bool closed;
    }

    /// @notice Prepaid API pass: one deposit, one bearer secret (only its hash is on-chain), many provider-metered calls.
    struct Pass {
        address consumer;
        address provider;
        bytes32 keyHash;
        uint256 deposit;
        uint256 spent;
        uint256 maxInputPrice;
        uint256 maxOutputPrice;
        uint256 maxCallCost;
        uint64 expiresAt;
        bool closed;
    }

    PeerRegistry public immutable registry;
    uint256 public nextPassId = 1;
    mapping(uint256 => Pass) private passes;
    mapping(uint256 => mapping(bytes32 => bool)) public passCallUsed;
    uint256 public nextRequestId = 1;
    mapping(uint256 => Request) private requests;
    mapping(uint256 => bytes32) public requestPrivacyConfig;
    mapping(uint256 => bool) public privacyStarted;
    mapping(uint256 => address) public requestPrivacyOperator;
    mapping(uint256 => bytes32) public requestEncryptionKeyHash;
    mapping(uint256 => bytes32) public requestPrivateSession;
    mapping(address => uint256) public credits;
    uint256 private lock = 1;
    bytes32 public constant USAGE_RECEIPT_TYPEHASH =
        keccak256("UsageReceipt(uint256 requestId,uint256 inputTokens,uint256 outputTokens,bytes32 responseHash)");
    bytes32 public constant PRIVATE_INFERENCE_TYPEHASH = keccak256("PrivateInferenceRequest(uint256 requestId,bytes32 promptHash,uint256 maxOutputTokens,bytes32 contextHash,bytes32 enclaveKeyHash)");
    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    uint256 private constant HALF_CURVE_ORDER = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;

    error InvalidRegistry();
    error InvalidPeer();
    error InvalidOffer();
    error InvalidDeposit();
    error InvalidExpiry();
    error UnknownRequest();
    error RequestClosed();
    error RequestExpired();
    error NotExpired();
    error InvalidSignature();
    error InvalidCharge();
    error Reentrancy();
    error NoCredit();
    error TransferFailed();
    error InvalidPrivacyConfig();
    error PrivacyAlreadyStarted();
    error UnknownPass();
    error PassClosed();
    error NotAuthorized();
    error DuplicateCall();

    event RequestFunded(
        uint256 indexed requestId,
        address indexed consumer,
        address indexed provider,
        bytes32 offerId,
        bytes32 promptHash,
        uint256 deposit,
        uint64 expiresAt
    );
    event RequestSettled(
        uint256 indexed requestId,
        address indexed provider,
        uint256 cost,
        uint256 refund,
        uint256 inputTokens,
        uint256 outputTokens,
        bytes32 responseHash
    );
    event RequestRefunded(uint256 indexed requestId, address indexed consumer, uint256 amount);
    event Withdrawn(address indexed owner, uint256 amount);
    event PrivateRequestBound(uint256 indexed requestId, bytes32 configHash);
    event PrivateRequestStarted(uint256 indexed requestId);
    event PassOpened(uint256 indexed passId, address indexed consumer, address indexed provider, uint256 deposit, uint64 expiresAt);
    event PassCharged(uint256 indexed passId, bytes32 indexed offerId, bytes32 callId, uint256 cost, uint256 inputTokens, uint256 outputTokens);
    event PassClosedEvent(uint256 indexed passId, uint256 refund);

    constructor(PeerRegistry registry_) {
        if (address(registry_).code.length == 0) revert InvalidRegistry();
        registry = registry_;
    }

    modifier nonReentrant() {
        if (lock != 1) revert Reentrancy();
        lock = 2;
        _;
        lock = 1;
    }

    function fund(bytes32 offerId, bytes32 promptHash, uint64 expiresAt) external payable returns (uint256 requestId) {
        return _fund(offerId, promptHash, expiresAt);
    }

    function fundPrivate(bytes32 offerId, bytes32 promptCommitment, uint64 expiresAt, bytes32 configHash)
        external payable returns (uint256 requestId)
    {
        address provider = registry.getOffer(offerId).provider;
        if (!registry.isPrivacyVerified(provider, configHash, address(this))) revert InvalidPrivacyConfig();
        requestId = _fund(offerId, promptCommitment, expiresAt);
        requestPrivacyConfig[requestId] = configHash;
        requestPrivacyOperator[requestId] = registry.getPeer(provider).operator;
        requestEncryptionKeyHash[requestId] = registry.privacyVerifier().encryptionKeyHash(provider, configHash);
        if (requestEncryptionKeyHash[requestId] == bytes32(0)) revert InvalidPrivacyConfig();
        emit PrivateRequestBound(requestId, configHash);
    }

    /// @notice Nonrollbackable acceptance before a paid private API call. Operator can deny service, not read content.
    function claimPrivate(uint256 requestId, uint256 maxOutputTokens, bytes32 contextHash, bytes calldata consumerSignature) external {
        Request storage request = requests[requestId];
        _requireOpen(request);
        if (block.timestamp >= request.expiresAt) revert RequestExpired();
        if (requestPrivacyConfig[requestId] == bytes32(0)) revert InvalidPrivacyConfig();
        if (!registry.isPrivacyVerified(request.provider, requestPrivacyConfig[requestId], address(this)) || registry.privacyVerifier().encryptionKeyHash(request.provider, requestPrivacyConfig[requestId]) != requestEncryptionKeyHash[requestId]) revert InvalidPrivacyConfig();
        if (requestPrivacyOperator[requestId] != msg.sender || registry.getPeer(request.provider).operator != msg.sender) revert InvalidPeer();
        if (privacyStarted[requestId]) revert PrivacyAlreadyStarted();
        if (maxOutputTokens == 0 || maxOutputTokens > 131072 || contextHash == bytes32(0) || _recover(privateAuthorizationDigest(requestId, maxOutputTokens, contextHash), consumerSignature) != request.consumer) revert InvalidSignature();
        privacyStarted[requestId] = true;
        requestPrivateSession[requestId] = contextHash;
        emit PrivateRequestStarted(requestId);
    }

    function privateAuthorizationDigest(uint256 requestId, uint256 maxOutputTokens, bytes32 contextHash) public view returns (bytes32) {
        bytes32 message = keccak256(abi.encode(PRIVATE_INFERENCE_TYPEHASH, requestId, requests[requestId].promptHash, maxOutputTokens, contextHash, requestEncryptionKeyHash[requestId]));
        return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR(), message));
    }

    function _fund(bytes32 offerId, bytes32 promptHash, uint64 expiresAt) private returns (uint256 requestId) {
        PeerRegistry.Peer memory consumer = registry.getPeer(msg.sender);
        if (!consumer.active || (consumer.roles & 2) == 0) revert InvalidPeer();
        PeerRegistry.Offer memory offer = registry.getOffer(offerId);
        if (!offer.active || offer.provider == address(0)) revert InvalidOffer();
        PeerRegistry.Peer memory provider = registry.getPeer(offer.provider);
        if (!provider.active || (provider.roles & 1) == 0) revert InvalidPeer();
        if (msg.value == 0) revert InvalidDeposit();
        if (expiresAt < block.timestamp + 60 || expiresAt > block.timestamp + 1 days) revert InvalidExpiry();
        requestId = nextRequestId++;
        requests[requestId] = Request(
            msg.sender,
            offer.provider,
            offerId,
            promptHash,
            msg.value,
            offer.inputPrice,
            offer.outputPrice,
            expiresAt,
            false
        );
        emit RequestFunded(requestId, msg.sender, offer.provider, offerId, promptHash, msg.value, expiresAt);
    }

    /// @notice Prepay a provider once. The consumer keeps the secret whose keccak256 is `keyHash`; closing the pass revokes it.
    /// Ceilings bind later price changes; `maxCallCost` bounds what any single provider-metered call can take.
    function openPass(address provider, bytes32 keyHash, uint256 maxInputPrice, uint256 maxOutputPrice, uint256 maxCallCost, uint64 expiresAt)
        external payable returns (uint256 passId)
    {
        PeerRegistry.Peer memory consumer = registry.getPeer(msg.sender);
        if (!consumer.active || (consumer.roles & 2) == 0) revert InvalidPeer();
        PeerRegistry.Peer memory peer = registry.getPeer(provider);
        if (!peer.active || (peer.roles & 1) == 0) revert InvalidPeer();
        if (msg.value == 0 || keyHash == bytes32(0) || maxCallCost == 0 || maxCallCost > msg.value) revert InvalidDeposit();
        if (expiresAt < block.timestamp + 60 || expiresAt > block.timestamp + 30 days) revert InvalidExpiry();
        passId = nextPassId++;
        passes[passId] = Pass(msg.sender, provider, keyHash, msg.value, 0, maxInputPrice, maxOutputPrice, maxCallCost, expiresAt, false);
        emit PassOpened(passId, msg.sender, provider, msg.value, expiresAt);
    }

    function getPass(uint256 passId) external view returns (Pass memory) {
        return passes[passId];
    }

    /// @notice Operator-metered charge. Cost is computed on-chain from tokens and the offer's current rates, within the pass ceilings.
    function chargePass(uint256 passId, bytes32 offerId, bytes32 callId, uint256 inputTokens, uint256 outputTokens) external {
        Pass storage pass = passes[passId];
        if (pass.consumer == address(0)) revert UnknownPass();
        if (pass.closed) revert PassClosed();
        if (block.timestamp >= pass.expiresAt) revert RequestExpired();
        if (registry.getPeer(pass.provider).operator != msg.sender) revert NotAuthorized();
        if (passCallUsed[passId][callId]) revert DuplicateCall();
        PeerRegistry.Offer memory offer = registry.getOffer(offerId);
        if (offer.provider != pass.provider || offer.inputPrice > pass.maxInputPrice || offer.outputPrice > pass.maxOutputPrice) revert InvalidOffer();
        uint256 cost = quoteCost(inputTokens, outputTokens, offer.inputPrice, offer.outputPrice);
        if (cost == 0 || cost > pass.maxCallCost || cost > pass.deposit - pass.spent) revert InvalidCharge();
        passCallUsed[passId][callId] = true;
        pass.spent += cost;
        credits[pass.provider] += cost;
        emit PassCharged(passId, offerId, callId, cost, inputTokens, outputTokens);
    }

    /// @notice Consumer may close any time (revoking the key); anyone may close after expiry. Unspent deposit becomes consumer credit.
    function closePass(uint256 passId) external {
        Pass storage pass = passes[passId];
        if (pass.consumer == address(0)) revert UnknownPass();
        if (pass.closed) revert PassClosed();
        if (msg.sender != pass.consumer && block.timestamp < pass.expiresAt) revert NotAuthorized();
        pass.closed = true;
        uint256 refund = pass.deposit - pass.spent;
        credits[pass.consumer] += refund;
        emit PassClosedEvent(passId, refund);
    }

    function getRequest(uint256 requestId) external view returns (Request memory) {
        return requests[requestId];
    }

    function DOMAIN_SEPARATOR() public view returns (bytes32) {
        return keccak256(
            abi.encode(DOMAIN_TYPEHASH, keccak256("PeerTokensEscrow"), keccak256("1"), block.chainid, address(this))
        );
    }

    function receiptDigest(uint256 requestId, uint256 inputTokens, uint256 outputTokens, bytes32 responseHash)
        public
        view
        returns (bytes32)
    {
        bytes32 receipt =
            keccak256(abi.encode(USAGE_RECEIPT_TYPEHASH, requestId, inputTokens, outputTokens, responseHash));
        return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR(), receipt));
    }

    function quoteCost(uint256 inputTokens, uint256 outputTokens, uint256 inputPrice, uint256 outputPrice)
        public
        pure
        returns (uint256)
    {
        uint256 numerator = inputTokens * inputPrice + outputTokens * outputPrice;
        return numerator / 1_000_000 + (numerator % 1_000_000 == 0 ? 0 : 1);
    }

    function settle(
        uint256 requestId,
        uint256 inputTokens,
        uint256 outputTokens,
        bytes32 responseHash,
        bytes calldata consumerSignature
    ) external {
        Request storage request = requests[requestId];
        _requireOpen(request);
        if (block.timestamp >= request.expiresAt) revert RequestExpired();
        if (
            _recover(receiptDigest(requestId, inputTokens, outputTokens, responseHash), consumerSignature)
                != request.consumer
        ) revert InvalidSignature();
        uint256 cost = quoteCost(inputTokens, outputTokens, request.inputPrice, request.outputPrice);
        if (cost == 0 || cost > request.deposit) revert InvalidCharge();
        request.closed = true;
        uint256 refund = request.deposit - cost;
        credits[request.provider] += cost;
        credits[request.consumer] += refund;
        emit RequestSettled(requestId, request.provider, cost, refund, inputTokens, outputTokens, responseHash);
    }

    function refundExpired(uint256 requestId) external {
        Request storage request = requests[requestId];
        _requireOpen(request);
        if (block.timestamp < request.expiresAt) revert NotExpired();
        request.closed = true;
        credits[request.consumer] += request.deposit;
        emit RequestRefunded(requestId, request.consumer, request.deposit);
    }

    function withdraw() external nonReentrant {
        uint256 amount = credits[msg.sender];
        if (amount == 0) revert NoCredit();
        credits[msg.sender] = 0;
        (bool success,) = payable(msg.sender).call{value: amount}("");
        if (!success) revert TransferFailed();
        emit Withdrawn(msg.sender, amount);
    }

    function _requireOpen(Request storage request) private view {
        if (request.consumer == address(0)) revert UnknownRequest();
        if (request.closed) revert RequestClosed();
    }

    function _recover(bytes32 digest, bytes calldata signature) private pure returns (address signer) {
        if (signature.length != 65) revert InvalidSignature();
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        if (uint256(s) > HALF_CURVE_ORDER || (v != 27 && v != 28)) revert InvalidSignature();
        signer = ecrecover(digest, v, r, s);
        if (signer == address(0)) revert InvalidSignature();
    }
}
