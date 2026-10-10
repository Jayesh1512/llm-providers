// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.28;
import {PeerRegistry} from "../contracts/PeerRegistry.sol";
import {InferenceEscrow} from "../contracts/InferenceEscrow.sol";
import {ZkDcapGatewayVerifier} from "../contracts/ZkDcapGatewayVerifier.sol";
import {RiscZeroGroth16Verifier} from "../contracts/vendor/risc0/groth16/RiscZeroGroth16Verifier.sol";
import {ControlID} from "../contracts/vendor/risc0/groth16/ControlID.sol";
import {ArchivedAutomataDcapReceipt} from "./fixtures/ArchivedAutomataDcapReceipt.sol";
import {TestReceipt} from "./fixtures/TestReceiptV3_0.sol";

interface AttestationVm {
    function chainId(uint256) external;
    function warp(uint256) external;
    function prank(address) external;
    function expectRevert() external;
    function deal(address,uint256) external;
}
/// @notice Parser harness only; this never fabricates a verified gateway or replaces the production proof verifier.
contract JournalParserHarness is ZkDcapGatewayVerifier {
    constructor(address registry,address escrow,bytes32 measurements) ZkDcapGatewayVerifier(registry,escrow,address(0xC0FFEE),measurements,19) { require(block.chainid == 31337); }
    function inspectUnverifiedForTest(bytes calldata journal) external view returns (Runtime memory) { return _validateRuntimeClaims(journal); }
}
contract ZkDcapGatewayVerifierTest {
    AttestationVm private constant vm=AttestationVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    PeerRegistry private registry;
    InferenceEscrow private escrow;
    JournalParserHarness private verifier;
    bytes32 private measurement;
    function setUp() public {
        vm.chainId(31337); vm.warp(10000);
        registry=new PeerRegistry();escrow=new InferenceEscrow(registry);
        bytes memory raw=new bytes(240);for(uint256 i;i<raw.length;i++)raw[i]=0x11;
        measurement=keccak256(raw);
        verifier=new JournalParserHarness(address(registry),address(escrow),measurement);
    }
    function _journal() private pure returns(bytes memory j) {
        // Synthetic claims used ONLY to test parsing/policy, never accepted as authenticated evidence.
        j=new bytes(715);j[3]=0x04;j[7]=0x81;j[12]=0x13;
        bytes32 root=0xa1acc73eb45794fa1734f14d882e91925b6006f79d3bb2460df9d01b333d7009;
        for(uint256 i;i<32;i++)j[19+i]=root[i];
        j[58]=0x01;j[65]=0xff;j[66]=0xff;
        for(uint256 i;i<48;i++)j[67+136+i]=0x11;
        for(uint256 i;i<192;i++)j[67+328+i]=0x11;
        j[682]=0x20;
    }
    function testRealGroth16ReceiptAndForgedProofProgramRootsRejected() public {
        RiscZeroGroth16Verifier real=new RiscZeroGroth16Verifier(ControlID.CONTROL_ROOT,ControlID.BN254_CONTROL_ID);
        // Official RISC Zero cryptographic receipt, NOT a hardware/zkDCAP fixture.
        bytes32 digest=sha256(TestReceipt.JOURNAL);
        bytes32 changedDigest=sha256("changed journal");
        real.verify(TestReceipt.SEAL,TestReceipt.IMAGE_ID,digest);
        bytes32 program=verifier.DCAP_IMAGE_ID();
        vm.expectRevert();real.verify(TestReceipt.SEAL,program,digest);
        vm.expectRevert();real.verify(TestReceipt.SEAL,TestReceipt.IMAGE_ID,changedDigest);
        bytes memory corrupt=TestReceipt.SEAL;corrupt[4]=bytes1(uint8(corrupt[4])^1);
        vm.expectRevert();real.verify(corrupt,TestReceipt.IMAGE_ID,digest);
        RiscZeroGroth16Verifier forged=new RiscZeroGroth16Verifier(bytes32(uint256(1)),ControlID.BN254_CONTROL_ID);
        vm.expectRevert();forged.verify(TestReceipt.SEAL,TestReceipt.IMAGE_ID,digest);
    }
    function testArchivedRealDcapProofCryptographyPassesButProductionProgramRejectsIt() public {
        RiscZeroGroth16Verifier real=new RiscZeroGroth16Verifier(ControlID.CONTROL_ROOT,ControlID.BN254_CONTROL_ID);
        real.verify(ArchivedAutomataDcapReceipt.SEAL,ArchivedAutomataDcapReceipt.IMAGE_ID,sha256(ArchivedAutomataDcapReceipt.JOURNAL));
        // This fixture uses a different archived guest, stale collateral and TCB status 4. It proves no Lit binding.
        vm.expectRevert();verifier.verifyRuntime(ArchivedAutomataDcapReceipt.SEAL,ArchivedAutomataDcapReceipt.JOURNAL);
    }

    function testProductionNeverAcceptsParsedClaimsOrUnrelatedValidProof() public {
        bytes memory j=_journal();
        verifier.inspectUnverifiedForTest(j);
        vm.expectRevert();verifier.verifyRuntime(new bytes(260),j);
        vm.expectRevert();verifier.verifyRuntime(TestReceipt.SEAL,j);
        require(!verifier.isValid(address(0xA),bytes32(uint256(1)),address(0xB),address(escrow)));
    }
    function testParserRejectsRootMeasurementDebugTcbStatusExpiryAndNoncanonicalAdvisories() public {
        bytes memory j=_journal();verifier.inspectUnverifiedForTest(j);
        for(uint256 i;i<8;i++){
            bytes memory bad=_journal();
            if(i==0)bad[19]=0;
            if(i==1)bad[67+136]=0;
            if(i==2)bad[67+120]=0x01;
            if(i==3)bad[8]=0x02; // revoked TCB
            if(i==4)bad[12]=0x12; // stale TCB counter
            if(i==5){bad[65]=0;bad[66]=0x02;} // expired collateral
            if(i==6){bad[57]=0xff;bad[58]=0xff;} // future collateral
            if(i==7)bad[714]=0x01; // advisories are not empty
            vm.expectRevert();verifier.inspectUnverifiedForTest(bad);
        }
        for(uint8 status=1;status<=6;status++){bytes memory bad=_journal();bad[8]=bytes1(status);vm.expectRevert();verifier.inspectUnverifiedForTest(bad);}
    }
    function _identity() private pure returns(ZkDcapGatewayVerifier.Identity memory) {
        return ZkDcapGatewayVerifier.Identity(address(0xA),address(0xB),keccak256("config"),keccak256("action"),keccak256("action public key"),keccak256("encryption public key"),keccak256("TLS certificate"));
    }
    function testChallengeBindsIdentityKeysActionChainContractsAndInvalidProofCannotCreateState() public {
        ZkDcapGatewayVerifier.Identity memory identity=_identity();vm.prank(identity.provider);
        bytes32 challenge=verifier.beginVerification(identity);bytes32 digest=verifier.bindingDigest(identity,challenge);
        for(uint256 i;i<7;i++){
            ZkDcapGatewayVerifier.Identity memory changed=_identity();
            if(i==0)changed.provider=address(0xC);if(i==1)changed.operator=address(0xC);if(i==2)changed.configHash=bytes32(uint256(1));if(i==3)changed.actionIdHash=bytes32(uint256(1));if(i==4)changed.actionKeyHash=bytes32(uint256(1));if(i==5)changed.encryptionKeyHash=bytes32(uint256(1));if(i==6)changed.tlsCertificateHash=bytes32(uint256(1));
            require(verifier.bindingDigest(changed,challenge)!=digest);
            vm.expectRevert();verifier.submitGateway(changed,challenge,new bytes(260),_journal());
        }
        vm.chainId(10143);require(verifier.bindingDigest(identity,challenge)!=digest);vm.chainId(31337);
        JournalParserHarness other=new JournalParserHarness(address(registry),address(escrow),measurement);require(other.bindingDigest(identity,challenge)!=digest);
        vm.expectRevert();verifier.submitGateway(identity,challenge,TestReceipt.SEAL,_journal());
        require(!verifier.isValid(identity.provider,identity.configHash,identity.operator,address(escrow)));
        vm.warp(10600);vm.expectRevert();verifier.submitGateway(identity,challenge,new bytes(260),_journal());
    }
    function testRevocationIsPermanentAndSuppliersCannotInstallVerifierOrUseLocalHookOnMonad() public {
        vm.prank(address(0xA));vm.expectRevert();verifier.revokePolicy();
        vm.prank(address(0xC0FFEE));verifier.revokePolicy();require(verifier.disabled());
        vm.expectRevert();verifier.verifyRuntime(TestReceipt.SEAL,_journal());
        vm.prank(address(0xA));vm.expectRevert();registry.configurePrivacyVerifier(address(escrow),address(0xC0FFEE),measurement,19);
        vm.chainId(10143);vm.expectRevert();registry.configureLocalTestPrivacyVerifier(verifier);vm.chainId(31337);
    }
    function testVerifierRejectsEscrowLinkedToDifferentRegistry() public {
        PeerRegistry other = new PeerRegistry();
        vm.expectRevert();
        new ZkDcapGatewayVerifier(address(other),address(escrow),address(0xC0FFEE),measurement,19);
    }
    function testRegistryAndFundingFailClosedWithoutHardwareGateway() public {
        address provider=address(0xA);address buyer=address(0xC);
        registry.configurePrivacyVerifier(address(escrow),address(0xC0FFEE),measurement,19);
        vm.prank(provider);registry.register(1,address(0xB),"https://supplier.invalid","");
        vm.prank(provider);bytes32 offer=registry.setOffer("fixture",2,100,200,true);
        vm.prank(provider);vm.expectRevert();registry.setPrivacyConfig(keccak256("config"));
        vm.prank(buyer);registry.register(2,address(0),"","");vm.deal(buyer,1 ether);
        vm.prank(buyer);vm.expectRevert();escrow.fundPrivate{value:1}(offer,keccak256("secret salted commitment"),10600,keccak256("config"));
        require(escrow.nextRequestId()==1);
    }
}
