# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

React, TypeScript, Vite, and viem. Routine implementation choices delegated to the agents by the user.

## Users

Token consumers choose an LLM and compare matching peers and their prices. Token providers make spare paid API capacity available through their own peer node.

## Product Purpose

Enable consumers to purchase inference directly from registered peers, and enable providers to earn from otherwise unused paid API capacity.

## Operating Context

An injected EVM wallet connects to Monad testnet. Providers run a server with their own upstream API credentials. Consumers discover peers using the on-chain registry. Standard mode sends prompts to the selected peer; the Lit private path encrypts through a consumer-verified protected runtime and is currently blocked until hardware/action/key evidence is available.

## Capabilities and Constraints

- Marketplace supplier inference uses paid APIs; local models are future scope. Separate personal/local ChatGPT OAuth usage creates no marketplace offer or MON invoice.
- All public contracts target Monad testnet, chain ID 10143; live deployment addresses remain unverified.
- Peer identities, endpoints, and offers are discoverable on-chain.
- Consumers compare matching peers and prices before selecting a provider.
- Providers configure Anthropic Messages, OpenAI Responses, or a compatible paid Chat Completions endpoint.
- Local wallet-authenticated API-key saves are unverified and require explicit provider/model reference selection. Claude OAuth and supplier/private OAuth are unavailable until their external authorization/verification prerequisites are established.
- Standard API credentials remain on the provider server. Private credentials are sealed to an immutable approved Lit Action and pinned against account substitution.
- Private mode requires consumer runtime/TLS/action/account approval and live on-chain zkDCAP gateway verification. Current Lit evidence lacks the required action/key binding, so private registration/funding/acceptance fail closed.
- Lit is an external TDX/KMS/governance dependency, including Base third-party infrastructure. All marketplace contracts remain on Monad testnet.
- Blockchain supplies public cryptographic identity/configuration/payment integrity; encryption and private keys remain off-chain.
- Native test MON is used for prototype accounting; it has no enforced USD conversion.
- A consumer funds a bounded request and explicitly approves its usage receipt before settlement.
- On-chain registration does not prove availability, model identity, or output quality. The prototype does not solve fair exchange if a consumer withholds payment approval.

## Brand Commitments

Use the existing name LLM Providers. Keep product language concrete and transparent about testnet operation.

## Evidence on Hand

No verified live providers, realized savings, production deployment, or customer evidence exists. Do not fabricate these.

## Product Principles

- Make peer identity and exact model identifiers inspectable.
- Show input and output prices separately.
- Keep money movement explicit and tied to a visible request.
- Represent chain data and errors truthfully.
