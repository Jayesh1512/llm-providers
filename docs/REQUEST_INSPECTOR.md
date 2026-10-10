# Provider request inspector

Open **Providers → Marketplace supplier offers → Serving requests → Open request inspector**. It opens `/inspector` in a separate browser tab; Providers and Consumers remain the only primary navigation tabs. A funded consumer request also has **Open provider request inspector**, with its public request identity prefilled.

The link carries only public registry/escrow addresses, an optional provider-owner filter and numeric request ID. It does not transfer prompts, API/OAuth credentials, wallet signatures, authorization tokens, response text or private response keys. The inspector neither reads saved consumer sessions nor writes browser storage.

## What is observable

The inspector verifies chain 10143, deployed contract presence and escrow/registry linkage using the existing read-only setup checks. It reads a funded request, its offer and registered peer at one block, and displays identities, exact listed model, capped deposit, snapshotted rates, deadline and funded prompt hash/commitment. Funding or closure does not establish whether the node has started, completed or settled an inference; closure alone does not distinguish settlement from refund. Refresh reads the chain again and never sends inference or asks for a wallet signature.

If a request has a nonzero recorded privacy configuration, the inspector can read its funded key fingerprint, recorded session hash, acceptance flag and registry validity predicate at that same block. These values are explicitly **not independently verified runtime/channel evidence**. A recorded binding or a true contract predicate never turns this surface into a live private demo.

Contract addresses passed in the URL are lookup hints. The checks establish contract presence and linkage, not a reviewed public deployment, upstream execution or honest metering. Invalid IDs, missing requests, provider mismatches, missing setup and failed reads produce explicit unavailable/error states. No guessed transaction link, fabricated event or fallback request is shown.

## Content access and the blocked privacy demo

**Standard suppliers handle plaintext prompts and responses.** Omitting them from this UI does not make them inaccessible to the supplier. Public hashes are integrity metadata, not confidentiality evidence.

**Live private protection is unavailable.** `APPROVED_PRIVACY_CONFIGS` is empty and no usable live attested gateway is deployed. Current Lit Chipotle evidence lacks hardware-authenticated Action CID, HPKE/action key and fresh on-chain challenge binding. This inspector does not bypass the verifier, publish a configuration or provision a gateway. Even a future approved private action sends plaintext to the upstream LLM. See [privacy boundary](PRIVACY.md) and [on-chain evidence requirements](ONCHAIN_ATTESTATION.md).

## Missing node telemetry integration

There is no existing provider-owner-authenticated metadata/serving feed for this UI. It displays **Node telemetry · not connected**, including unavailable serving activity, received payloads, response commitments and runtime evidence. The consumer-authenticated `GET /requests/:id` recovery API returns the full invoice/response; the inspector deliberately does not call it. Public health/identity APIs are not request telemetry or hardware attestation.

A future backend integration must expose an explicitly owner-authorized, origin-bound metadata feed, with request/chain/provider binding, observed timestamps, an explicit execution mode and safe public commitments. It must exclude plaintext, credentials, consumer authorization tokens and decryption keys. Genuine private observations additionally require matching independently approved runtime/Action/key evidence, verified ciphertext receipt and current valid on-chain state. The backend/security owner must design that integration; this frontend task adds no telemetry endpoint and claims no live events or hardware protection.
