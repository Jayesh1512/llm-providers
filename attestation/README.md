# Local zkDCAP proof preparation

This tool prepares a genuine Groth16 receipt for the pinned Intel DCAP program. Monad independently verifies the receipt and its claims. It does not publish transactions, attest arbitrary actions, or turn current Lit TLS evidence into a runtime/action/key statement.

See [the on-chain protocol](../docs/ONCHAIN_ATTESTATION.md) for the missing Lit binding prerequisite. No fresh production proof or usable private gateway was produced in this session.

## Inputs and execution

Use the pinned zkDCAP source revision in `prover/Cargo.toml` to fetch current Intel-signed collateral for the quote. `collateral.bin` must contain its `QvCollateral` serialization; an oracle verdict or unsigned JSON is insufficient. `quote.hex` contains the raw quote as hexadecimal, optionally prefixed with `0x`. Both inputs are public evidence. Do not put prompts, secret salts, credentials or private keys in either input.

Install a working RISC Zero 3.0.5 local proving environment, its Groth16 tools/Docker and sufficient memory. On macOS, the normal proving build additionally needs the Xcode Metal toolchain; it is absent in this checkout's environment. Rebuild and compare the pinned guest image before approving a release.

```sh
cargo build --release --locked --manifest-path attestation/prover/Cargo.toml
cargo run --release --locked --manifest-path attestation/prover/Cargo.toml -- quote.hex collateral.bin output-proof.json
```

The tool explicitly refuses `RISC0_DEV_MODE`, `RISC0_PROVER` or `BONSAI_API_KEY` overrides. It uses the genuine local prover, verifies its receipt, and emits public `programId`, `seal`, `journal` and `onchainVerified:false`. A dev receipt is never an alternative. Paid proof services are not provisioned or selected automatically. Proof generation must finish within the contract challenge's ten-minute window for gateway registration.

For this session, the Rust types/APIs passed `RISC0_SKIP_BUILD_KERNELS=1 cargo check --locked --manifest-path attestation/prover/Cargo.toml`. This skips native/GPU kernel builds and **does not validate an executable prover or generate a proof**. A normal build failed because `xcrun metal` is unavailable. Do not use the skip setting as a production proving configuration.

`npm run privacy:attestation-call -- configure|challenge|submit public-input.json` produces unsigned Monad 10143 calldata for wallet review. Configuration input includes `{to,policy:{escrow,revoker,measurements,minimumTcb}}`; challenge input includes `{to,identity}`; submission input includes `{to,identity,challenge,proof}`. Identity fields are documented in the verifier protocol. These tools never send a transaction or label preparation as on-chain verification.
