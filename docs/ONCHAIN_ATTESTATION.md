# Monad hardware attestation verifier

## Readiness

`ZkDcapGatewayVerifier` implements genuine RISC Zero Groth16 verification of a pinned Intel DCAP verification program. Registry selection, private funding and private acceptance enforce its result. This is not a trusted signing oracle or a boolean supplied by a provider. **The complete live Lit private-inference requirement is not achieved:** current Lit does not expose the hardware-authenticated runtime → immutable action → action/HPKE key binding this contract requires. No production gateway has been registered or publicly deployed. Invalid/incomplete evidence cannot create verified state.

## Authenticated program and claims

The verifier constructs its own non-upgradeable RISC Zero Ethereum v3.0.1 Groth16 verifier with the published control root and BN254 circuit identity. It does not accept an external verifier address or route to a fake development receipt verifier. The only accepted DCAP image is `65ca60d4fce9aed394c4363c4cc550e781995c296eefe9f93858689078ccf82e`, from the pinned [zkDCAP guest](https://github.com/datachainlab/zkdcap/blob/fe39b99e976a9dc0e8d7232f0056b31eb81db7b1/zkvm/risc0/guest/src/bin/main.rs). The receipt must prove successful execution with the SHA256 of the exact submitted journal.

The guest authenticates Intel quote/PCK/QE signatures and key linkage, signed CRLs and revocations, certificate constraints, TCB/QE identities and TDX module status. Its published output contains a root-certificate hash, collateral validity intersection, minimum TCB evaluation counter and authenticated TD report. Our Solidity wrapper independently enforces:

- Exact output version 0, quote version 4 and TDX type `0x81`; unsupported formats fail.
- Intel root DER Keccak256 `a1acc73eb45794fa1734f14d882e91925b6006f79d3bb2460df9d01b333d7009`, fetched from Intel and compared byte-for-byte with the guest's reference.
- Strict `STATUS_OK`, no advisories and no debug bit. Hardening/configuration-needed, out-of-date and revoked statuses are rejected.
- `block.timestamp` within the authenticated intersection of certificate, CRL and TCB/QE collateral validity. Prover-supplied time is not authoritative.
- Minimum approved Intel TCB evaluation counter. Counter increases require a genuine proof, not a caller-provided number.
- Exact independently approved measurement digest: `keccak256(MRTD || RTMR0 || RTMR1 || RTMR2 || RTMR3)`, using raw 48-byte measurements. Approval must establish what measured runtime actually implements; matching arbitrary measurements is not sufficient.
- Exact bounded journal format and canonical empty advisory list. Unverified parsing cannot produce gateway state.

The off-chain local prover is in `attestation/prover`. It pins guest source/binary identity, rejects dev mode and paid Bonsai environment selection, uses `LocalProver`, generates Groth16 and verifies the resulting receipt before emitting public proof/journal bytes. It does not send transactions. Collateral input must use zkDCAP's `QvCollateral` serialization and current Intel-signed material. Reproducible guest build, a working RISC Zero/Groth16 environment and proof generation within the challenge window are release prerequisites. A genuine proof for this production guest was not generated in this session. Rust API/type checking passed with native kernels skipped; a normal build is blocked by the missing macOS Metal toolchain. This is not an executable prover validation. See [proof preparation](../attestation/README.md).

## Gateway binding and freshness

A provider requests `beginVerification(Identity)` with provider/operator, configuration hash, immutable action-ID hash, action public-key hash, HPKE SPKI hash and TLS certificate hash. The contract creates a one-use challenge, domain-separated by chain, verifier, identity, nonce and recent block hash, valid for ten minutes.

The authenticated TD report must contain exactly:

```
REPORTDATA[0:32] = keccak256(abi.encode(
  keccak256("LLMProvidersLitHardwareBinding:v1"), chainId,
  verifier, registry, escrow, Identity, challengeId
))
REPORTDATA[32:64] = 0
```

The **approved measured runtime must construct this statement itself**, after authenticating the actual currently executing immutable action CID, its action scalar/public key, its action-derived HPKE key, and the protected TLS certificate. An API that quotes arbitrary caller-supplied report data without these checks is not acceptable. The required measurement release must cover that implementation, not just a generic TDX VM.

Current Chipotle `/attestation` REPORTDATA is unused/zero. `/evidences/quote.json` authenticates SHA256 of a checksum list that contains the TLS certificate. Neither quotes an arbitrary JavaScript action CID nor authenticates its derived encryption key as a hardware statement. An HTTP public-key lookup over verified TLS supports consumer verification, but its application response is not a hardware-signed transferable proof for Solidity. An action wallet signature and a provider claim cannot bridge that gap. Current evidence therefore fails `submitGateway` even if its DCAP proof is otherwise valid.

This is the precise external prerequisite: Lit must expose an authenticated statement constructed by reviewed measured runtime code tying the actual executing action and keys to our fresh challenge and domain. Its DCAP evidence must be provable by the pinned guest (or a separately reviewed new verifier deployment must support an equivalent sound statement). There is no oracle fallback and no "attestation verified on Monad" label for TLS checks done only on the consumer.

Accepted gateways live for at most one hour or the collateral expiry, whichever comes first. Challenges are consumed only after successful verification. Renewal requires fresh evidence. Measurements/root/program are immutable. Per-configuration revocations are permanent; global policy revocation is permanent. The independent revoker can invalidate but cannot fabricate approvals, replace roots, lower counters or re-enable a revoked policy. New runtime/root/proof-program releases require a new reviewed registry/verifier deployment; funded requests retain their original addresses.

Registry authority can install the fixed verifier implementation **once** with reviewed measurement digest, initial TCB counter, escrow and independent revoker. It cannot install an arbitrary verifier on Monad. No measurements are pre-approved by deployment scripts. Independence of governance ownership is an explicit deployment prerequisite; Solidity cannot prove that two wallets have different human owners. The registry authority cannot select its own provider privacy configuration; ordinary supplier wallets cannot install policy or raise counters without authenticated proof.

Freshness is challenge-based: TDX quotes do not themselves provide a trusted wall-clock issuance time. Collateral validity does not prove it is the newest CRL Intel has issued; valid older collateral can remain valid until expiry. Monitors must fetch current Intel data, raise authenticated TCB floors and revoke affected gateways/policy promptly. The one-hour lease bounds reuse but is not instantaneous Intel revocation discovery. Consumer runtime/governance and full collateral checks remain in place.

## Registry, funding and acceptance enforcement

`PeerRegistry.setPrivacyConfig` accepts a nonzero policy only when it is verified for the current provider/operator and the verifier's fixed escrow. Clearing a policy disables private funding/acceptance. `fundPrivate` checks active registry verification atomically, snapshots the policy, operator and HPKE key fingerprint, and preserves rates/capped deposits/deadlines. A provider cannot fund private inference using just an on-chain policy hash.

`claimPrivate(requestId,maxOutputTokens,contextHash,consumerSignature)` rechecks live verification and key equality, matches the funded operator, checks expiry/open/one-shot state, and verifies the consumer's existing EIP-712 private inference authorization against request ID, salted prompt commitment, output limit, signed context and funded encryption fingerprint. It stores the signed session hash before allowing a paid call. The context authenticates both wallets, both contracts, chain, offer/configuration, request/challenge, issuance time and consumer response-key fingerprint. Wallet approval of that context remains a consumer responsibility; the contract does not decrypt it or prove a TLS session.

Registry changes, expiry or revocation block acceptance. Even after acceptance, escrow's existing consumer-approved usage settlement, credits, refund and withdrawal semantics remain available. The chain does not prove the upstream model, honest metering, correct execution of a particular request or fair exchange. No plaintext, secret salts, private keys or API credentials are stored in calldata/events/state.

The explicit `configureLocalTestPrivacyVerifier` hook and `test/LocalPrivacyVerifier.sol` exist only for 31337 simulations. Both refuse public-chain use; public deployment tools never call that hook. Tests do not call a mock proof a hardware verdict.

## Evidence and feasibility checked on 2026-10-10

- Foundry verifies a genuine archived Automata DCAP Groth16 proof and an official RISC Zero receipt, then rejects altered seals/journals/program roots. The archived DCAP fixture has an old guest, stale collateral and non-OK TCB; **production rejects it**. Parser policy negatives use synthetic unverified journals only. Positive private registry/funding tests use an explicitly local mock, not a genuine production hardware record.
- zkDCAP's 23 native unit tests passed, including published Intel quote fixtures. This confirms native verification source behavior, not a fresh Lit proof or enclave deployment.
- A public current Lit quote passed SDK diagnostic quote-signature/PCK-chain verification. Full current collateral, Base KMS governance and actual immutable inference action execution were not all validated together. It is not an approved release.
- `npm run privacy:check-monad` read the live RPC chain ID 10143 and checked BN254 add/multiply/pairing precompiles. It used **eth_call state overrides**, without transactions, to run the genuine archived DCAP Groth16 proof through the compiled RISC Zero verifier. `eth_estimateGas` returned **1,133,337 gas**. This is proof cryptography, not a public deployment, fresh production DCAP policy acceptance or gateway registration. Full registration adds journal/policy/state costs and requires a genuine matching production proof before its gas can be measured end-to-end.

Compiled optimized sizes (Solidity 0.8.28, Cancun, optimizer 200):

| Contract | Runtime bytes | Initcode bytes |
|---|---:|---:|
| PeerRegistry | 23,593 | 23,657 |
| InferenceEscrow | 8,082 | 8,335 |
| ZkDcapGatewayVerifier | 6,810 | 17,049 |
| RiscZeroGroth16Verifier | 4,810 | 9,299 |

All public contracts fit conservative EIP-170 runtime/EIP-3860 initcode limits. The Foundry deployment **script** embeds both creation bytecodes and is larger; it runs locally and is not a public contract deployment. Invalid curve points can consume all supplied gas in the precompile; callers must budget for rejecting malicious proofs. Do not infer valid registration gas from mock tests or Ethereum pricing.

Current [Monad precompile documentation](https://docs.monad.xyz/developer-essentials/precompiles) and [opcode pricing](https://docs.monad.xyz/developer-essentials/opcode-pricing) confirm SHA256 and BN254 operations. Monad reprices EC multiplication/pairing relative to Ethereum; the live estimate above exercises that route. No P-256 precompile is required by this Groth16 path.

Run the ABI export/build, contract tests, TypeScript tests, browser checks, Anvil integration and `privacy:check-monad` after changes. `privacy:attestation-call` creates unsigned 10143 calldata for review; it cannot publish. See [PRIVACY.md](PRIVACY.md) for the protected channel, immutable action/credential setup and remaining service/account prerequisites, and [THIRD_PARTY.md](THIRD_PARTY.md) for source and license details.
