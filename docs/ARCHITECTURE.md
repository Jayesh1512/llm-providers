# Paid API peer network

The two participant roles are provider and consumer. One wallet may register both roles. A supplier is an independently operated HTTPS node that holds its own upstream paid API credentials. Consumers discover suppliers through PeerRegistry on Monad testnet. Standard mode sends prompts directly to the selected node. Private mode targets an immutable Lit Action over a consumer-verified protected channel, with on-chain hardware/configuration enforcement; it currently fails closed because Lit lacks the required runtime/action/key statement. The interface lists matching peers and both token prices; it does not automatically choose a supplier.

## Authority and discovery

PeerRegistry owns registration, operator authorization, peer endpoints, and model offers. Registration is signed by the participant's wallet. Providers can publish multiple exact model IDs. Anyone can enumerate contract records or build a replaceable index over their events. The initial client reads the registry itself. No database or DHT determines membership.

Standard node operators prove possession of their registered signing key by signing a fresh identity challenge. The consumer checks the signature against the registry before funding and before submitting a prompt. A registration says which node is authorized; it is not proof of current reachability, true spare API credit, or upstream model identity.

## Standard request and payment lifecycle

1. Consumer connects a wallet, registers as a consumer, selects a model and peer, and verifies the node identity.
2. Consumer funds a single request on-chain with a maximum budget, prompt hash, offer ID, and deadline. The escrow snapshots the offer's rates.
3. Consumer signs a chain-and-contract-bound inference authorization and sends the prompt directly to the peer.
4. Peer validates funding and authorization, calls its configured paid upstream, and returns an operator-signed invoice containing upstream-reported token counts and the response hash.
5. Consumer checks the invoice, sees the actual charge, and explicitly signs a usage approval. Any relayer may settle that approval; payout destinations are fixed by escrow.
6. Provider receives withdrawable credit. Unused budget becomes consumer credit. If no settlement happens before expiry, the full funded request can be refunded. Credits are withdrawn through pull payments.

For the prototype, prices and escrow use native test MON, with separate rates per million input/output tokens and ceiling rounding to wei. Test MON is testnet accounting, not a USD-denominated price or a production settlement currency. Actual input/output usage comes from paid API response usage fields. Anthropic cached input categories count toward input usage; OpenAI reasoning output is included in reported output usage.

## Extensibility

Paid API adapters normalize Anthropic Messages, OpenAI Responses, and explicitly configured OpenAI-compatible Chat Completions into one invoice format. Model names and upstream endpoints are operator configuration. OpenCode can consume compatible endpoints; it is not a separate model. A future local-model adapter can emit the same result/invoice shape while preserving on-chain registration and settlement.

The loopback account helper is a separate wallet-authorized control plane. It atomically stores unverified API keys in an API-only file. A single OpenAI credential can discover its official model-list metadata and bind one owner-bound ref to multiple exact supported text model configs; manual credentials retain their original exact binding. The provider resolver checks the owner, cached visible ID, reviewed capability, namespace, API kind and official origin for each call, with no environment fallback for invalid refs. Metadata visibility does not validate inference or billing; failed rediscovery clears membership and pending discovery is canceled by removal/management lock. The ordinary supplier adapter resolves explicitly selected refs without reading OAuth tokens. Existing environment-key configuration remains supported. Neither key save/discovery nor account consent publishes on-chain offers.

Personal ChatGPT OAuth uses the official open-source registration and Responses endpoint, verified OIDC identity and rotating per-account/workspace registrations. It has its own token file and ordinary local-host content boundary, no supplier/peer transport and no MON invoice. Supplier subscription offerings require vendor authorization and are hard-blocked; Claude OAuth is unavailable. Private OAuth requires authenticated Lit action/key evidence plus protected rollback-safe token storage and cannot use the ordinary host connector. See [account connector architecture and protocol](ACCOUNT_CONNECTORS.md).

## Limits that affect the design

Escrow verifies a consumer-approved charge. It does not prove inference was served by a particular model or that usage claims from a supplier are honest. The supplier can lose the upstream cost if a consumer receives the answer and refuses to approve payment. This is a testnet prototype, not a fair-exchange solution. The Lit privacy/zkDCAP addition gates confidentiality without proving upstream model identity, honest metering or fair exchange. Staged payment channels or a defined dispute process remain separate additions.

Lower pricing depends on suppliers' actual economics: bulk discounts, expiring prepaid credit, or another source of favorable API costs. An ordinary pay-per-use API key does not itself create discounted spare inventory. The system provides offer competition and metered payment; it does not promise a guaranteed discount.

## Network restriction

All public deployment paths enforce Monad testnet chain ID 10143. Mainnet is rejected. Local integration tests use chain 31337, generated throwaway accounts, and fixture APIs; these deployments and responses are explicitly local testing. Live paid API credentials are never replaced with silent mock responses.

## Protected execution and on-chain verification

The consumer-owned helper validates current Chipotle TDX, collateral, measured runtime and actual-connection TLS; the browser validates action-signed HPKE key/session bindings. The immutable action derives its encryption key inside Lit, verifies the consumer wallet authorization and Monad funding/configuration, mines a one-shot acceptance claim, calls allowlisted HTTPS APIs and encrypts the invoice to a consumer response key. Supplier-host plaintext journals/recovery are absent from this path.

Registry governance can install `ZkDcapGatewayVerifier` once. That verifier fixes the Intel root and RISC Zero/zkDCAP program, checks collateral time/TCB/debug/measurements and requires fresh REPORTDATA authenticating provider, action and keys under our chain/contracts. The registry selects only verified privacy configurations; escrow snapshots the accepted operator/key at funding and verifies the consumer session signature and live gateway at acceptance. Consumer approval/refunds/credits retain their original semantics.

Current Lit quote evidence binds runtime/TLS certificate evidence, not an arbitrary action/key. Those quotes cannot pass gateway registration. Existing test-only gateway/relay and local verifier fixtures are not production privacy. The live Lit API also depends on third-party Base KMS/governance and Phala/dstack; our contracts stay on Monad. See [privacy protocol and upstream restrictions](PRIVACY.md) and [on-chain verification boundary and feasibility](ONCHAIN_ATTESTATION.md).
