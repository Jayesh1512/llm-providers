// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {PeerRegistry} from "../contracts/PeerRegistry.sol";
import {InferenceEscrow} from "../contracts/InferenceEscrow.sol";
import {LocalPrivacyVerifier} from "./LocalPrivacyVerifier.sol";
import {Deploy} from "../script/Deploy.s.sol";

interface Vm {
    function addr(uint256 privateKey) external returns (address);
    function sign(uint256 privateKey, bytes32 digest) external returns (uint8 v, bytes32 r, bytes32 s);
    function deal(address account, uint256 balance) external;
    function prank(address sender) external;
    function startPrank(address sender) external;
    function stopPrank() external;
    function warp(uint256 timestamp) external;
    function chainId(uint256 chainId_) external;
    function expectRevert(bytes4 selector) external;
}

contract WithdrawalPeer {
    InferenceEscrow public escrow;
    bool public attempted;
    bool public reentered;
    bool public rejectPayment;

    function register(PeerRegistry registry, InferenceEscrow escrow_) external returns (bytes32) {
        escrow = escrow_;
        registry.register(1, address(this), "https://provider.test", "");
        return registry.setOffer("test-model", 3, 1 ether, 2 ether, true);
    }

    function setRejectPayment(bool reject) external {
        rejectPayment = reject;
    }

    function withdraw() external {
        escrow.withdraw();
    }

    receive() external payable {
        require(!rejectPayment, "rejected");
        attempted = true;
        try escrow.withdraw() {
            reentered = true;
        } catch {}
    }
}

contract PeerTokensTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 private constant CONSUMER_KEY = 0xA11CE;
    uint256 private constant OTHER_KEY = 0xB0B;
    PeerRegistry private registry;
    InferenceEscrow private escrow;
    address private consumer;
    address private provider;
    address private other;
    bytes32 private offerId;
    bytes32 private constant RESPONSE_HASH = keccak256("completed API response");

    function setUp() public {
        vm.chainId(31337);
        vm.warp(10_000);
        consumer = vm.addr(CONSUMER_KEY);
        provider = address(0xCAFE);
        other = vm.addr(OTHER_KEY);
        registry = new PeerRegistry();
        escrow = new InferenceEscrow(registry);
        LocalPrivacyVerifier localVerifier = new LocalPrivacyVerifier(address(escrow));
        registry.configureLocalTestPrivacyVerifier(localVerifier);
        vm.deal(consumer, 100 ether);
        vm.prank(consumer);
        registry.register(2, address(0), "", "consumer");
        vm.startPrank(provider);
        registry.register(1, provider, "https://provider.test", "ipfs://metadata");
        offerId = registry.setOffer("test-model", 3, 1 ether, 2 ether, true);
        vm.stopPrank();
    }

    function _assert(bool condition) private pure {
        require(condition, "assertion failed");
    }

    function _eq(uint256 left, uint256 right) private pure {
        require(left == right, "uint mismatch");
    }

    function _sig(uint256 key, bytes32 digest) private returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _fund() private returns (uint256 id) {
        vm.prank(consumer);
        id = escrow.fund{value: 1 ether}(offerId, keccak256("prompt"), uint64(block.timestamp + 600));
    }

    function _receipt(uint256 id, uint256 inputTokens, uint256 outputTokens) private returns (bytes memory) {
        return _sig(CONSUMER_KEY, escrow.receiptDigest(id, inputTokens, outputTokens, RESPONSE_HASH));
    }

    function testOwnerRegistrationUpdatesWithoutDuplicatingRoster() public {
        _eq(registry.peerCount(), 2);
        _assert(registry.peerAt(0) == consumer);
        vm.prank(provider);
        registry.register(3, other, "https://new.test", "updated");
        _eq(registry.peerCount(), 2);
        PeerRegistry.Peer memory peer = registry.getPeer(provider);
        _eq(peer.roles, 3);
        _assert(peer.operator == other && peer.active);
        vm.prank(other);
        registry.register(2, address(0), "", "");
        _assert(registry.getPeer(provider).operator == other);
        _assert(registry.getPeer(other).roles == 2);
    }

    function testRegistrationAndOffersRejectInvalidInputs() public {
        vm.expectRevert(PeerRegistry.InvalidRoles.selector);
        registry.register(0, address(0), "", "");
        vm.expectRevert(PeerRegistry.InvalidProvider.selector);
        registry.register(1, address(0), "https://test", "");
        vm.expectRevert(PeerRegistry.InvalidLength.selector);
        registry.register(2, address(0), string(new bytes(513)), "");
        vm.expectRevert(PeerRegistry.NotRegistered.selector);
        registry.setActive(false);
        vm.prank(consumer);
        vm.expectRevert(PeerRegistry.NotActiveProvider.selector);
        registry.setOffer("test", 3, 1, 1, true);
        vm.startPrank(provider);
        vm.expectRevert(PeerRegistry.InvalidOffer.selector);
        registry.setOffer("test", 4, 1, 1, true);
        vm.expectRevert(PeerRegistry.InvalidOffer.selector);
        registry.setOffer("test", 3, 0, 1, true);
        vm.expectRevert(PeerRegistry.InvalidLength.selector);
        registry.setOffer("", 3, 1, 1, true);
        vm.stopPrank();
    }

    function testOffersAreOwnerScopedAndUpdatesDoNotDuplicate() public {
        vm.prank(provider);
        bytes32 updated = registry.setOffer("test-model", 2, 3 ether, 4 ether, false);
        _assert(updated == offerId);
        _eq(registry.offerCount(), 1);
        _assert(registry.offerIdAt(0) == offerId);
        vm.startPrank(other);
        registry.register(1, other, "https://other.test", "");
        bytes32 different = registry.setOffer("test-model", 1, 1, 1, true);
        vm.stopPrank();
        _assert(different != offerId);
        _assert(registry.getOffer(offerId).provider == provider);
        _eq(registry.offerCount(), 2);
    }

    function testFundingChecksRolesStatusOfferAndDeposit() public {
        vm.prank(other);
        vm.expectRevert(InferenceEscrow.InvalidPeer.selector);
        escrow.fund(offerId, bytes32(0), uint64(block.timestamp + 600));
        vm.prank(consumer);
        vm.expectRevert(InferenceEscrow.InvalidDeposit.selector);
        escrow.fund(offerId, bytes32(0), uint64(block.timestamp + 600));
        vm.prank(provider);
        registry.setOffer("test-model", 3, 1 ether, 2 ether, false);
        vm.prank(consumer);
        vm.expectRevert(InferenceEscrow.InvalidOffer.selector);
        escrow.fund{value: 1 ether}(offerId, bytes32(0), uint64(block.timestamp + 600));
        vm.prank(provider);
        registry.setOffer("test-model", 3, 1 ether, 2 ether, true);
        vm.prank(provider);
        registry.setActive(false);
        vm.prank(consumer);
        vm.expectRevert(InferenceEscrow.InvalidPeer.selector);
        escrow.fund{value: 1 ether}(offerId, bytes32(0), uint64(block.timestamp + 600));
        vm.prank(provider);
        registry.register(2, address(0), "", "");
        vm.prank(consumer);
        vm.expectRevert(InferenceEscrow.InvalidPeer.selector);
        escrow.fund{value: 1 ether}(offerId, bytes32(0), uint64(block.timestamp + 600));
    }

    function testFundingRejectsInvalidExpiryAndInactiveConsumer() public {
        vm.startPrank(consumer);
        vm.expectRevert(InferenceEscrow.InvalidExpiry.selector);
        escrow.fund{value: 1 ether}(offerId, bytes32(0), uint64(block.timestamp + 59));
        vm.expectRevert(InferenceEscrow.InvalidExpiry.selector);
        escrow.fund{value: 1 ether}(offerId, bytes32(0), uint64(block.timestamp + 1 days + 1));
        registry.setActive(false);
        vm.expectRevert(InferenceEscrow.InvalidPeer.selector);
        escrow.fund{value: 1 ether}(offerId, bytes32(0), uint64(block.timestamp + 600));
        vm.stopPrank();
    }

    function testSettlementCreditsFixedProviderAndConsumerAndCloses() public {
        uint256 id = _fund();
        _eq(id, 1);
        bytes memory signature = _receipt(id, 100_000, 50_000);
        vm.prank(other); // Relayers cannot redirect payment to themselves.
        escrow.settle(id, 100_000, 50_000, RESPONSE_HASH, signature);
        _eq(escrow.credits(provider), 0.2 ether);
        _eq(escrow.credits(consumer), 0.8 ether);
        _eq(escrow.credits(other), 0);
        _assert(escrow.getRequest(id).closed);
        vm.expectRevert(InferenceEscrow.RequestClosed.selector);
        escrow.settle(id, 100_000, 50_000, RESPONSE_HASH, signature);
        vm.warp(block.timestamp + 601);
        vm.expectRevert(InferenceEscrow.RequestClosed.selector);
        escrow.refundExpired(id);
        vm.prank(consumer);
        escrow.withdraw();
        _eq(consumer.balance, 99.8 ether);
        _eq(escrow.credits(consumer), 0);
        vm.prank(consumer);
        vm.expectRevert(InferenceEscrow.NoCredit.selector);
        escrow.withdraw();
    }

    function testSnapshotsPricesAndRemainsSettleableAfterProviderLeaves() public {
        uint256 id = _fund();
        vm.startPrank(provider);
        registry.setOffer("test-model", 3, 99 ether, 99 ether, false);
        registry.setActive(false);
        vm.stopPrank();
        bytes memory signature = _receipt(id, 100_000, 50_000);
        escrow.settle(id, 100_000, 50_000, RESPONSE_HASH, signature);
        _eq(escrow.credits(provider), 0.2 ether);
        _eq(escrow.getRequest(id).inputPrice, 1 ether);
        _eq(escrow.getRequest(id).outputPrice, 2 ether);
    }

    function testWrongSignerModifiedReceiptAndCrossRequestReplayFail() public {
        uint256 id = _fund();
        bytes memory wrong = _sig(OTHER_KEY, escrow.receiptDigest(id, 100, 50, RESPONSE_HASH));
        vm.expectRevert(InferenceEscrow.InvalidSignature.selector);
        escrow.settle(id, 100, 50, RESPONSE_HASH, wrong);
        bytes memory signature = _receipt(id, 100, 50);
        vm.expectRevert(InferenceEscrow.InvalidSignature.selector);
        escrow.settle(id, 101, 50, RESPONSE_HASH, signature);
        vm.expectRevert(InferenceEscrow.InvalidSignature.selector);
        escrow.settle(id, 100, 50, keccak256("different response"), signature);
        uint256 second = _fund();
        vm.expectRevert(InferenceEscrow.InvalidSignature.selector);
        escrow.settle(second, 100, 50, RESPONSE_HASH, signature);
        _assert(!escrow.getRequest(id).closed && !escrow.getRequest(second).closed);
    }

    function testDomainBindsChainAndContract() public {
        uint256 id = _fund();
        InferenceEscrow different = new InferenceEscrow(registry);
        bytes memory wrongContract = _sig(CONSUMER_KEY, different.receiptDigest(id, 100, 50, RESPONSE_HASH));
        vm.expectRevert(InferenceEscrow.InvalidSignature.selector);
        escrow.settle(id, 100, 50, RESPONSE_HASH, wrongContract);
        bytes memory wrongChain = _receipt(id, 100, 50);
        vm.chainId(10143);
        vm.expectRevert(InferenceEscrow.InvalidSignature.selector);
        escrow.settle(id, 100, 50, RESPONSE_HASH, wrongChain);
    }

    function testMalformedAndMalleableSignaturesFail() public {
        uint256 id = _fund();
        vm.expectRevert(InferenceEscrow.InvalidSignature.selector);
        escrow.settle(id, 100, 50, RESPONSE_HASH, hex"00");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(CONSUMER_KEY, escrow.receiptDigest(id, 100, 50, RESPONSE_HASH));
        uint256 order = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141;
        bytes memory malleable = abi.encodePacked(r, bytes32(order - uint256(s)), uint8(v == 27 ? 28 : 27));
        vm.expectRevert(InferenceEscrow.InvalidSignature.selector);
        escrow.settle(id, 100, 50, RESPONSE_HASH, malleable);
        vm.expectRevert(InferenceEscrow.InvalidSignature.selector);
        escrow.settle(id, 100, 50, RESPONSE_HASH, abi.encodePacked(r, s, uint8(1)));
    }

    function testZeroAndOverDepositChargesFailEvenWhenSigned() public {
        uint256 id = _fund();
        bytes memory signature = _receipt(id, 0, 0);
        vm.expectRevert(InferenceEscrow.InvalidCharge.selector);
        escrow.settle(id, 0, 0, RESPONSE_HASH, signature);
        signature = _receipt(id, 2_000_000, 0);
        vm.expectRevert(InferenceEscrow.InvalidCharge.selector);
        escrow.settle(id, 2_000_000, 0, RESPONSE_HASH, signature);
        _assert(!escrow.getRequest(id).closed);
        _eq(escrow.credits(provider), 0);
    }

    function testExpiryBoundaryRefundAndDoubleRefund() public {
        uint256 id = _fund();
        vm.expectRevert(InferenceEscrow.NotExpired.selector);
        escrow.refundExpired(id);
        bytes memory signature = _receipt(id, 100, 50);
        vm.warp(escrow.getRequest(id).expiresAt);
        vm.expectRevert(InferenceEscrow.RequestExpired.selector);
        escrow.settle(id, 100, 50, RESPONSE_HASH, signature);
        vm.prank(other);
        escrow.refundExpired(id);
        _eq(escrow.credits(consumer), 1 ether);
        _eq(escrow.credits(other), 0);
        vm.expectRevert(InferenceEscrow.RequestClosed.selector);
        escrow.refundExpired(id);
        vm.expectRevert(InferenceEscrow.UnknownRequest.selector);
        escrow.refundExpired(123);
    }

    function testRoundingUsesCombinedCostAndRoundsUp() public view {
        _eq(escrow.quoteCost(1, 1, 1, 1), 1);
        _eq(escrow.quoteCost(500_000, 500_000, 1, 1), 1);
        _eq(escrow.quoteCost(1_000_000, 1, 1, 1), 2);
        _eq(escrow.quoteCost(0, 0, 1, 1), 0);
    }

    function testFuzzCostRoundsWithinOneWei(uint64 input, uint64 output, uint64 inputPrice, uint64 outputPrice)
        public
        view
    {
        uint256 numerator = uint256(input) * inputPrice + uint256(output) * outputPrice;
        uint256 cost = escrow.quoteCost(input, output, inputPrice, outputPrice);
        _assert(cost * 1_000_000 >= numerator);
        if (cost > 0) _assert((cost - 1) * 1_000_000 < numerator);
    }

    function testWithdrawCannotReenterAndFailedTransferPreservesCredit() public {
        WithdrawalPeer receiver = new WithdrawalPeer();
        offerId = receiver.register(registry, escrow);
        uint256 id = _fund();
        escrow.settle(id, 100_000, 50_000, RESPONSE_HASH, _receipt(id, 100_000, 50_000));
        receiver.setRejectPayment(true);
        vm.expectRevert(InferenceEscrow.TransferFailed.selector);
        receiver.withdraw();
        _eq(escrow.credits(address(receiver)), 0.2 ether);
        receiver.setRejectPayment(false);
        receiver.withdraw();
        _assert(receiver.attempted() && !receiver.reentered());
        _eq(address(receiver).balance, 0.2 ether);
        _eq(escrow.credits(address(receiver)), 0);
        _eq(address(escrow).balance, 0.8 ether);
    }

    function testDeploymentScriptRefusesOtherChains() public {
        Deploy deployer = new Deploy();
        vm.expectRevert(Deploy.MonadTestnetOnly.selector);
        deployer.run();
        vm.chainId(143); // Monad mainnet is explicitly prohibited.
        vm.expectRevert(Deploy.MonadTestnetOnly.selector);
        deployer.run();
    }
    function _setLocalPrivacyPolicy(bytes32 policy) private {
        LocalPrivacyVerifier(address(registry.privacyVerifier())).approve(provider, policy, keccak256("SIMULATED ENCRYPTION KEY"));
        vm.prank(provider);
        registry.setPrivacyConfig(policy);
    }

    function testPrivateFundingPinsPolicyAndAcceptanceCannotReplay() public {
        bytes32 policy = keccak256("reviewed privacy configuration");
        vm.prank(provider);
        _setLocalPrivacyPolicy(policy);
        vm.prank(consumer);
        uint256 id = escrow.fundPrivate{value: 1 ether}(offerId, keccak256("secret salted commitment"), uint64(block.timestamp + 600), policy);
        _assert(escrow.requestPrivacyConfig(id) == policy);
        bytes memory auth = _sig(CONSUMER_KEY, escrow.privateAuthorizationDigest(id, 100, keccak256("LOCAL SESSION")));
        vm.prank(other);
        vm.expectRevert(InferenceEscrow.InvalidPeer.selector);
        escrow.claimPrivate(id, 100, keccak256("LOCAL SESSION"), auth);
        vm.prank(provider);
        escrow.claimPrivate(id, 100, keccak256("LOCAL SESSION"), auth);
        _assert(escrow.privacyStarted(id));
        vm.prank(provider);
        vm.expectRevert(InferenceEscrow.PrivacyAlreadyStarted.selector);
        escrow.claimPrivate(id, 100, keccak256("LOCAL SESSION"), auth);
        // Policy rotation cannot alter the funded request or its settlement semantics.
        vm.prank(provider);
        _setLocalPrivacyPolicy(keccak256("new policy"));
        _assert(escrow.requestPrivacyConfig(id) == policy);
        escrow.settle(id, 100_000, 50_000, RESPONSE_HASH, _receipt(id, 100_000, 50_000));
        _eq(escrow.credits(provider), 0.2 ether);
        _eq(escrow.credits(consumer), 0.8 ether);
    }

    function testPrivatePolicyRaceZeroAndPlainClaimRejected() public {
        bytes32 policy = keccak256("old policy");
        vm.prank(provider);
        _setLocalPrivacyPolicy(keccak256("rotated policy"));
        vm.prank(consumer);
        vm.expectRevert(InferenceEscrow.InvalidPrivacyConfig.selector);
        escrow.fundPrivate{value: 1 ether}(offerId, RESPONSE_HASH, uint64(block.timestamp + 600), policy);
        vm.prank(consumer);
        vm.expectRevert(InferenceEscrow.InvalidPrivacyConfig.selector);
        escrow.fundPrivate{value: 1 ether}(offerId, RESPONSE_HASH, uint64(block.timestamp + 600), bytes32(0));
        uint256 plain = _fund();
        vm.prank(provider);
        vm.expectRevert(InferenceEscrow.InvalidPrivacyConfig.selector);
        escrow.claimPrivate(plain, 100, keccak256("LOCAL SESSION"), "");
        _assert(escrow.requestPrivacyConfig(plain) == bytes32(0));
    }

    function testPrivateAuthorizationRejectsSessionWalletRequestChainAndKeySubstitution() public {
        bytes32 policy = keccak256("local policy");
        _setLocalPrivacyPolicy(policy);
        vm.prank(consumer);
        uint256 id = escrow.fundPrivate{value: 1 ether}(offerId, RESPONSE_HASH, uint64(block.timestamp + 600), policy);
        bytes32 session = keccak256("all request context and consumer response key");
        bytes memory auth = _sig(CONSUMER_KEY, escrow.privateAuthorizationDigest(id, 100, session));
        bytes memory wrongWallet = _sig(OTHER_KEY, escrow.privateAuthorizationDigest(id, 100, session));
        vm.prank(provider);vm.expectRevert(InferenceEscrow.InvalidSignature.selector);
        escrow.claimPrivate(id, 100, keccak256("changed response key"), auth);
        vm.prank(provider);vm.expectRevert(InferenceEscrow.InvalidSignature.selector);
        escrow.claimPrivate(id, 101, session, auth);
        vm.prank(provider);vm.expectRevert(InferenceEscrow.InvalidSignature.selector);
        escrow.claimPrivate(id, 100, session, wrongWallet);
        vm.prank(consumer);
        uint256 second = escrow.fundPrivate{value: 1 ether}(offerId, RESPONSE_HASH, uint64(block.timestamp + 600), policy);
        vm.prank(provider);vm.expectRevert(InferenceEscrow.InvalidSignature.selector);
        escrow.claimPrivate(second, 100, session, auth);
        bytes32 oldDomain = escrow.DOMAIN_SEPARATOR();
        vm.chainId(10143);
        _assert(escrow.DOMAIN_SEPARATOR() != oldDomain);
        // Local verifier also fails closed when moved to a public chain.
        vm.prank(provider);vm.expectRevert(InferenceEscrow.InvalidPrivacyConfig.selector);
        escrow.claimPrivate(id, 100, session, auth);
        vm.chainId(31337);
        LocalPrivacyVerifier local = LocalPrivacyVerifier(address(registry.privacyVerifier()));
        local.approve(provider, policy, keccak256("substituted gateway key"));
        vm.prank(provider);vm.expectRevert(InferenceEscrow.InvalidPrivacyConfig.selector);
        escrow.claimPrivate(id, 100, session, auth);
        _assert(!escrow.privacyStarted(id));
        local.approve(provider, policy, keccak256("SIMULATED ENCRYPTION KEY"));
        vm.prank(provider);escrow.claimPrivate(id, 100, session, auth);
        _assert(escrow.requestPrivateSession(id) == session);
    }

    function testRevokedPrivateGatewayBlocksFundingAndAcceptanceButPreservesRefund() public {
        bytes32 policy = keccak256("local policy");
        _setLocalPrivacyPolicy(policy);
        vm.prank(consumer);
        uint256 id = escrow.fundPrivate{value: 1 ether}(offerId, RESPONSE_HASH, uint64(block.timestamp + 600), policy);
        bytes memory auth = _sig(CONSUMER_KEY, escrow.privateAuthorizationDigest(id, 100, keccak256("session")));
        LocalPrivacyVerifier(address(registry.privacyVerifier())).setValid(false);
        vm.prank(consumer);vm.expectRevert(InferenceEscrow.InvalidPrivacyConfig.selector);
        escrow.fundPrivate{value: 1 ether}(offerId, RESPONSE_HASH, uint64(block.timestamp + 600), policy);
        vm.prank(provider);vm.expectRevert(InferenceEscrow.InvalidPrivacyConfig.selector);
        escrow.claimPrivate(id, 100, keccak256("session"), auth);
        _assert(!escrow.privacyStarted(id));
        vm.warp(block.timestamp + 600);
        escrow.refundExpired(id);
        _eq(escrow.credits(consumer), 1 ether);
    }

    function testUnsettledClaimedPrivateRequestStillRefunds() public {
        bytes32 policy = keccak256("policy");
        vm.prank(provider);
        _setLocalPrivacyPolicy(policy);
        vm.prank(consumer);
        uint256 id = escrow.fundPrivate{value: 1 ether}(offerId, RESPONSE_HASH, uint64(block.timestamp + 600), policy);
        bytes memory auth = _sig(CONSUMER_KEY, escrow.privateAuthorizationDigest(id, 100, keccak256("LOCAL SESSION")));
        vm.prank(provider);
        escrow.claimPrivate(id, 100, keccak256("LOCAL SESSION"), auth);
        vm.warp(block.timestamp + 600);
        escrow.refundExpired(id);
        _eq(escrow.credits(consumer), 1 ether);
    }

    function _pass() private returns (uint256 id) {
        vm.prank(consumer);
        id = escrow.openPass{value: 10 ether}(provider, keccak256("secret"), 1 ether, 2 ether, 1 ether, uint64(block.timestamp + 1 days));
    }

    function testPassChargesWithinCeilingsAndRefundsUnspentOnClose() public {
        uint256 id = _pass();
        vm.prank(provider);
        escrow.chargePass(id, offerId, keccak256("call-1"), 500_000, 250_000); // 0.5 + 0.5 ether
        _eq(escrow.credits(provider), 1 ether);
        _eq(escrow.getPass(id).spent, 1 ether);
        vm.prank(consumer);
        escrow.closePass(id);
        _eq(escrow.credits(consumer), 9 ether);
        vm.expectRevert(InferenceEscrow.PassClosed.selector);
        vm.prank(provider);
        escrow.chargePass(id, offerId, keccak256("call-2"), 1, 1);
    }

    function testPassRejectsReplayOverCapStrangersAndRaisedPrices() public {
        uint256 id = _pass();
        vm.prank(provider);
        escrow.chargePass(id, offerId, keccak256("call-1"), 1000, 1000);
        vm.expectRevert(InferenceEscrow.DuplicateCall.selector);
        vm.prank(provider);
        escrow.chargePass(id, offerId, keccak256("call-1"), 1000, 1000);
        vm.expectRevert(InferenceEscrow.InvalidCharge.selector);
        vm.prank(provider);
        escrow.chargePass(id, offerId, keccak256("big"), 2_000_000, 0);
        vm.expectRevert(InferenceEscrow.NotAuthorized.selector);
        vm.prank(other);
        escrow.chargePass(id, offerId, keccak256("stranger"), 1000, 1000);
        vm.prank(provider);
        registry.setOffer("test-model", 3, 5 ether, 2 ether, true);
        vm.expectRevert(InferenceEscrow.InvalidOffer.selector);
        vm.prank(provider);
        escrow.chargePass(id, offerId, keccak256("raised"), 1000, 1000);
    }

    function testPassExpiryAndClosePermissions() public {
        uint256 id = _pass();
        vm.expectRevert(InferenceEscrow.NotAuthorized.selector);
        vm.prank(other);
        escrow.closePass(id);
        vm.warp(block.timestamp + 1 days + 1);
        vm.expectRevert(InferenceEscrow.RequestExpired.selector);
        vm.prank(provider);
        escrow.chargePass(id, offerId, keccak256("late"), 1000, 1000);
        vm.prank(other);
        escrow.closePass(id);
        _eq(escrow.credits(consumer), 10 ether);
    }
}
