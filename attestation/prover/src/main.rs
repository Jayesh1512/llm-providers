use anyhow::{bail, Context, Result};
use risc0_zkvm::{ExecutorEnv, LocalProver, Prover, ProverOpts, VerifierContext};
use std::{fs, time::{SystemTime, UNIX_EPOCH}};
use zkdcap_risc0::{DCAP_QUOTE_VERIFIER_ELF, DCAP_QUOTE_VERIFIER_ID, DCAP_QUOTE_VERIFIER_ID_STR};

fn main() -> Result<()> {
    // Never silently use paid Bonsai infrastructure or a development/fake proof.
    for name in ["BONSAI_API_KEY", "RISC0_DEV_MODE", "RISC0_PROVER"] {
        if std::env::var_os(name).is_some() { bail!("Remove {name}; this tool requires the local genuine prover"); }
    }
    let args: Vec<_> = std::env::args().collect();
    if args.len()!=4 { bail!("Usage: prover quote.hex collateral.bin output-proof.json; public evidence only"); }
    let image = risc0_binfmt::ProgramBinary::decode(DCAP_QUOTE_VERIFIER_ELF)?.compute_image_id()?;
    if image.to_string()!=DCAP_QUOTE_VERIFIER_ID_STR || DCAP_QUOTE_VERIFIER_ID_STR!="65ca60d4fce9aed394c4363c4cc550e781995c296eefe9f93858689078ccf82e" { bail!("Unapproved DCAP program binary"); }
    let quote_hex=fs::read_to_string(&args[1])?;
    let quote=hex::decode(quote_hex.trim().trim_start_matches("0x"))?;
    let collateral=fs::read(&args[2])?; // zkDCAP QvCollateral serialization, not an oracle verdict.
    let now=SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs();
    let env=ExecutorEnv::builder().write(&(quote,collateral,now))?.build()?;
    let proved=LocalProver::new("llm-providers-zkdcap").prove_with_ctx(env,&VerifierContext::default(),DCAP_QUOTE_VERIFIER_ELF,&ProverOpts::groth16()).context("Local proving needs the RISC Zero runtime, Groth16 tools/Docker and sufficient memory")?;
    proved.receipt.verify(DCAP_QUOTE_VERIFIER_ID)?;
    let groth16=proved.receipt.inner.groth16()?;
    if groth16.seal.len()!=256 { bail!("Unexpected Groth16 proof length"); }
    let mut seal=hex::decode("73c457ba")?; // pinned RISC Zero Ethereum v3.0.1 verifier selector.
    seal.extend_from_slice(&groth16.seal);
    fs::write(&args[3],serde_json::to_vec_pretty(&serde_json::json!({
        "programId":DCAP_QUOTE_VERIFIER_ID_STR,"seal":format!("0x{}",hex::encode(seal)),
        "journal":format!("0x{}",hex::encode(&proved.receipt.journal.bytes)),
        "onchainVerified":false
    }))?)?;
    println!("Genuine local proof written. Monad must independently verify it; no transaction was sent.");
    Ok(())
}
