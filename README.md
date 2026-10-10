# LLM Providers

A paid-API peer marketplace with two registered roles: token providers and token consumers. Peer identities, endpoints, and model offers live on-chain. Consumers select a model, compare matching peers and input/output prices, and send prompts directly to the selected supplier. Standard mode keeps API keys on the supplier node. The Lit privacy integration seals credentials for an immutable protected action; live private mode is currently blocked by missing hardware/action/key evidence.

**Public contracts target Monad testnet only (chain ID 10143).** Deployment tools reject mainnet. Local tests run on a separate chain 31337 with fixture APIs. A passing local test is not a Monad deployment.

## Run the interface

Requires Node.js 22.12+ and Foundry (`forge`, plus `anvil` for integration tests).

```sh
npm install
cp .env.example .env
npm run contracts:export
npm run dev
```

Open the Vite URL. Connect an injected EVM wallet, switch to Monad testnet, then open **Advanced settings** from either tab to deploy PeerRegistry and InferenceEscrow with your wallet. The signing wallet needs test MON. The interface stores confirmed public addresses and can reuse an existing deployment; it never receives your private key.

Alternatively, set `DEPLOYER_PRIVATE_KEY` locally in `.env` and run `npm run deploy:monad`. That script verifies RPC chain ID 10143 and writes confirmed public addresses to `deployments/monad-testnet.json`. Set the returned addresses in both `REGISTRY_ADDRESS` / `ESCROW_ADDRESS` and `VITE_REGISTRY_ADDRESS` / `VITE_ESCROW_ADDRESS`. Restart Vite after changing environment configuration. Do not paste private keys or API credentials in chat or commit `.env`.

No deployment addresses are prefilled or invented. Empty discovery results mean no offers have been published to the configured registry.

After browser-wallet deployment, verify the two public addresses with `npm run verify:monad -- <registry-address> <escrow-address>`. This read-only command checks Monad testnet, deployed code, registry linkage, and contract reads, then saves public deployment data to `deployments/monad-testnet.json` while preserving existing transaction metadata. It requires no private key and sends no transaction.

## Two-tab interface

**Providers** starts with provider tiles grouped under **API keys** and **OAuth** connection tabs. API-key tiles offer Add Claude API key, Add OpenAI API key, and a secondary compatible paid API option. OAuth tiles offer Connect OpenAI / ChatGPT and explain why Connect Claude is unavailable, with a direct Claude API-key alternative. Keys are saved through the local wallet-authenticated helper and displayed as **saved locally, unverified**; saving never calls paid inference. For OpenAI, paste one key and load its official model metadata; choose any returned text model supported by the adapter, then prepare an offer with separate input/output test MON prices and explicitly publish it. All chosen model configurations reuse the same protected key. Catalog visibility is not inference validation or a promise of access to every OpenAI model. Failed discovery keeps the saved key and offers a ref-only retry. Claude and compatible APIs retain exact manual configuration. Start the node with each selected secret-free model configuration before accepting requests. Existing environment-configured nodes can still publish through an advanced disclosure.

OpenAI OAuth uses official consent for personal local use only. It does not authorize selling subscription quota. Claude OAuth has no authorized connector; use a Claude API key. Live private inference remains blocked by missing hardware/action/key evidence.

**Consumers** starts with **Model** and **Provider** dropdowns. The model list combines popular Claude, OpenAI, Gemini, DeepSeek and Qwen models with every exact model ID listed by active suppliers; unavailable choices show no providers, and setup errors show availability unchecked. Choosing a model lists every matching supplier and separate test MON input/output rates. Provider selection is always manual; an optional comparison disclosure shows all matching rates. Available models appear first; output limits and the blocked privacy option live under Advanced request options. The flow continues with prompt and capped budget → wallet funding → signed send → explicit usage approval and settlement. No supplier is selected automatically. Funding recovery, expired refunds, direct receipt settlement, and withdrawal remain available beside the request. **Advanced settings** contains contract verification/deployment and peer discovery details; wallet and Monad testnet context stay in the header.

Popular catalog IDs were checked on 2026-10-10 against the [Claude model catalog](https://platform.claude.com/docs/en/models/overview), [OpenAI model catalog](https://developers.openai.com/api/docs/models), [Gemini model catalog](https://ai.google.dev/gemini-api/docs/models), [DeepSeek API docs](https://api-docs.deepseek.com/), and [Qwen model catalog](https://www.alibabacloud.com/help/en/model-studio/models). These are discovery shortcuts using the default marketplace namespace; only exact published offers establish marketplace availability. Custom namespaces and model snapshots remain separate choices.

The **Serving requests** action opens a separate [provider request inspector](docs/REQUEST_INSPECTOR.md), outside the two main tabs. It shows real public chain metadata when configured; live node telemetry is not connected. Standard suppliers can read prompts and responses, and the live private demo remains blocked.

## Operate a standard provider

1. Connect your provider-owner wallet and register its provider role, public HTTPS endpoint, and node operator address. The operator is a separate EVM signing key held by your node; its address must match the on-chain record.
2. Set the node's `PROVIDER_ADDRESS`, `NODE_PRIVATE_KEY`, registry/escrow addresses, and paid API credentials locally in `.env`. Fund the operator with test MON so it can relay approved settlements.
3. Configure the exact models that the node can serve. Publish matching namespaced model IDs, API formats, and rates in the app. Rates are test MON per million input/output tokens.
4. Run `npm run provider`. For a public endpoint, put HTTPS in front of the node and configure `ALLOWED_ORIGINS` to the frontend's exact origin. Loopback HTTP is supported for development. Bind a public-facing node explicitly with `BIND_HOST=0.0.0.0` when your reverse proxy/container requires it.

Example model configuration (replace model IDs with models available to your paid API account):

```dotenv
PROVIDER_MODELS_JSON='[{"model":"anthropic/my-claude-model","apiKind":1,"upstreamModel":"EXACT_CLAUDE_MODEL_ID","baseUrl":"https://api.anthropic.com","apiKeyEnv":"ANTHROPIC_API_KEY"},{"model":"openai/my-codex-model","apiKind":2,"upstreamModel":"EXACT_OPENAI_MODEL_ID","baseUrl":"https://api.openai.com","apiKeyEnv":"OPENAI_API_KEY"}]'
```

Adapters support Anthropic Messages (1), OpenAI Responses (2), and configured OpenAI-compatible Chat Completions (3). `baseUrl` is the upstream origin or gateway prefix; adapters append the API endpoint path. OpenCode is a client/gateway ecosystem, not a model; compatible paid services can be configured through the relevant API format. Local models are future scope. Supplier subscription OAuth is unavailable; the separate personal/local ChatGPT connector cannot serve marketplace requests.

The node verifies registration, its authorized operator key, funded request ownership, prompt hash, consumer signature, output cap, and deadline before paid inference. Usage comes from upstream API usage fields, not character estimates. A durable request journal prevents concurrent requests or process restarts from silently repeating a paid call. Do not delete completed/pending journal entries; interrupted entries are intentionally nonretryable. After an unclean shutdown, remove only the namespace `.lock` after confirming no other node process uses it, preserving the journal.

`npm run dev` starts the interface and its loopback account helper together. On a fresh directory, the first account action asks your wallet to sign an explicit initialization message and pins that owner; no `.env` or manually entered wallet address is needed. An existing owner remains pinned. You can preconfigure a public `ACCOUNT_OPERATOR_ADDRESS` (or `PROVIDER_ADDRESS`) and run `npm run accounts` separately for a static/local preview. Select a saved key's returned `providerModelConfig` explicitly in `PROVIDER_MODELS_JSON`; the helper wallet must match `PROVIDER_ADDRESS`, and helper/node must share `ACCOUNT_STATE_DIR`. No save performs billed validation. OAuth tokens stay in a separate protected local file and never reach peers, offers or browser storage. Claude OAuth and Lit private OAuth remain unavailable. See [account setup, security, supported status and prerequisites](docs/ACCOUNT_CONNECTORS.md). No live OAuth login/inference was tested.

## Consumer flow

In standard mode, register as a consumer, select an exact model, compare matching peers, and select one supplier. The app authenticates the node using a fresh signed challenge, funds a capped request, then sends an authorized prompt directly to that node. It verifies the returned signed invoice and response hash before showing an explicit usage-payment approval. Settlement credits the provider's wallet and returns unused budget as consumer credit. Credits can be withdrawn; an unsettled request can be fully refunded once its deadline expires.

Prompts and response text are kept off-chain. The chain and signed receipts use hashes. Standard mode explicitly labels that the supplier can read prompts and answers. Private mode never falls back to standard mode. Native test MON is prototype accounting; the app does not imply a USD price or guaranteed savings.

## Lit protected inference and on-chain attestation

The privacy feature includes an immutable Lit Chipotle Action, HPKE encrypted requests/answers, secret-salted commitments, wallet/session/key bindings, a consumer TLS/TDX/collateral verifier, and an Intel-rooted zkDCAP verifier with registry/funding/acceptance enforcement. **It is code/test ready for review, not usable live end-to-end.** Current Lit quotes authenticate runtime/TLS evidence, but do not provide the action-CID/encryption-key hardware statement our on-chain verifier requires. No approved release exists; private registration/funding/acceptance fail closed.

All our public contracts remain Monad testnet 10143. Lit's third-party KMS/governance depends on Base; smart contracts do not privately encrypt/decrypt prompts. AWS Nitro is not a backend. See [privacy implementation and prerequisites](docs/PRIVACY.md), [on-chain verification and measured Monad feasibility](docs/ONCHAIN_ATTESTATION.md), and [dependency source/licenses](docs/THIRD_PARTY.md). The linked RISC Zero verifier introduces GPL-3.0 obligations for the combined contract deployment.

```sh
npm run privacy:build -- docs/examples/lit-action-manifest.local-example.json
npm run privacy:check-monad
```

The example contains dummy public values and is not approved. The first command builds locally; the second uses read-only RPC/state overrides and sends no transaction. Existing browser/CLI contract deployment still creates registry and escrow with privacy disabled. Independent governance can later configure the fixed verifier once through reviewed wallet calldata; no measurements or proof verdicts are prefilled. Live Lit preparation requires an execute-only billing key and existing prepaid access, a pinned full verifier, reviewed runtime/action/account policy, test MON for the action operator, and the missing authenticated binding evidence. No paid account, credits or infrastructure were provisioned.

## Validation

```sh
npm run test:contracts
npm test
npm run test:e2e
npm run build
```

The integration test starts an ephemeral local Anvil chain, deploys both contracts, registers distinct provider/consumer/operator accounts, exercises all three API formats through local HTTP fixtures, authenticates the node, verifies signed usage invoices, settles payments, checks duplicate-call protection, withdraws credits, and refunds an expired request. It also exercises the encrypted private gateway/claim/settlement path with an explicitly local-only mock verifier and throwaway action key; that is not hardware evidence. It uses no live API credentials and performs no public deployment.

## Payment and economic limits

This is a testnet prototype. The escrow verifies a consumer-approved charge; it does not prove model identity or honest upstream metering. A consumer can receive a response and withhold payment approval, leaving the supplier with the upstream cost. A production fair-exchange mechanism is separate work.

Lower consumer prices depend on the supplier having favorable API costs, discounts, or otherwise-unused prepaid credit. Ordinary pay-per-use access does not automatically create profitable spare inventory. Providers set their offers; the marketplace does not promise savings or profits.

See [protocol](PROTOCOL.md) and [architecture](docs/ARCHITECTURE.md) for schemas, trust boundaries, and future local-model integration. Network values: [official Monad testnet documentation](https://docs.monad.xyz/developer-essentials/testnet). Adapter references: [OpenAI text generation](https://developers.openai.com/api/docs/guides/text) and [Claude Messages](https://platform.claude.com/docs/en/build-with-claude/working-with-messages).
