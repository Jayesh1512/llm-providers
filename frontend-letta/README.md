# Alternate LLM Providers frontend

This distinct frontend lives entirely in `frontend-letta/`. It imports the current browser-safe marketplace, account and protocol clients from the existing project; it does not replace the root app or backend.

## Run

From the project root, using its existing dependencies:

```sh
npm --prefix frontend-letta run dev
npm --prefix frontend-letta run typecheck
npm --prefix frontend-letta run build
```

- Marketplace: http://127.0.0.1:5174/
- Presentation: http://127.0.0.1:5174/demo
- Existing app: http://127.0.0.1:5173/ remains separate.

The alternate Vite config does not load the root `.env`. Public contract addresses can be entered in Advanced settings. It never deploys contracts. Node/registration setup stays under a disclosure.

## Prepare the personal demo

1. The backend owner must run the current helper on loopback `127.0.0.1:8791` with the exact allowed origin `http://127.0.0.1:5174`, preserving its existing 5173 origin and owner/credentials. No wildcard, remote or Vercel origin is needed. The frontend does not reconfigure or restart it.
2. Open `/demo`, connect the helper owner's browser wallet on Monad testnet 10143, then click **Authorize local session**. A fresh empty helper requires an explicit initialization signature; an existing helper requires its pinned owner's unlock signature. The agent cannot sign for the user.
3. Click **Connect ChatGPT** and complete the official OpenAI consent manually. Existing connections are preserved until the user explicitly disconnects them. Connection state remains unchecked until signed helper authorization.
4. Click **Load account models**, explicitly choose an exact returned model, write a prompt, and send it. This is the same user's personal local connection, with no MON invoice, independent buyer or subscription marketplace resale.

The current mini chat uses `/accounts/infer`. Each send is an independent prompt; previous messages are displayed but are not supplied as model context. History is transient. **Stop waiting** suppresses the displayed result, but this client cannot cancel the upstream request; another send stays blocked until it finishes. Wallet changes, lock and disconnect clear the local conversation. Only completed returned input/output usage is displayed.

The running helper now reports `catalog-oidc-diagnostics-20261010-1`, `openai-models-v1`, and `stages-v1`; a harmless public GET from origin 5174 returned 200. The old origin rejection is resolved. The owner is diagnosing a repeated real OAuth callback rejection. Both screens import the current bounded OAuth diagnostic allowlist; rejected consent shows only known stage/reason values and drops unexpected fields or codes. A fresh user-run consent is needed for current diagnostics. Fixtures establish UI behavior, not successful real account authentication. The secure scoped local-tool `/v1/models` + `/v1/responses` endpoint is not implemented; backend work is paused until the OAuth completion blocker is diagnosed. Endpoint controls are deliberately unavailable until it lands and is tested. Localhost will serve tools on this computer, not the public internet.

## Provider and consumer workflows

OpenAI normal onboarding uses one password-only save with `discoverModels:true`. The wallet-authenticated helper saves one protected credential and fetches actual OpenAI catalog metadata. The UI displays every supported exact text-model entry, discovery time/status, excluded entries/reasons, and inference-unverified labeling. There are no suggestion-based credential models or automatic billed calls. Discovery failure keeps the saved credential, clears catalog membership and allows retry by opaque ref without a repeated secret POST.

Explicit **Price & prepare** selects an exact per-model configuration from that catalog, then separate input/output test MON prices and **Publish offer** require a registered active provider and a wallet transaction. No models, prices or offers are selected/published automatically. All catalog configurations share one local credential ref; neither key nor reference is put on-chain. Removal, lock, wallet changes and changed/failed catalogs invalidate unpublished prepared selections. Claude/compatible API keys and existing node bindings remain secondary manual paths.

Consumers choose model → matching provider → prompt and maximum budget. Available registry models appear first; popular catalog suggestions are honestly unchecked or unavailable until chain discovery. Every matching exact-model supplier has separate rates; there is no automatic peer/model/fallback choice. Delisting or model changes clear the peer choice. Capped funding, signed requests, signed invoices, explicit usage approval, direct-settlement retry, funding recovery, expiry refunds and credit withdrawal remain integrated with the real protocol.

Standard providers see prompts and answers. Registration does not prove the upstream model or honest metering. Private/TEE inference is blocked pending hardware/action/key evidence. Claude OAuth and subscription resale remain unavailable. OpenAI OAuth is optional personal local use only.

## Reference and assets

The actual Letta reference was visually inspected at https://www.letta.com/agent/ on desktop and mobile before implementation. Captures: `screenshots/reference-desktop.jpg`, `reference-mobile.jpg`. Observed: vivid cobalt geological landscape/orange sky; Roobert light geometric typography (desktop h1 64px, mobile 28px); broad gutters; square filled/outlined actions; dark product window overlapping the hero; a looping muted product demo video. This app translates that composition to its own peer marketplace, without Letta branding, agent-memory claims or reused Letta art.

Original generated still landscape: `assets/cobalt-landscape.webp` (1536×1024, optimized from a tool-generated PNG). Exact prompt: `design/landscape-prompt.txt`; embedded provenance sidecar: `assets/cobalt-landscape.webp.json`. Generation source: `/Users/jys/.codex/generated_images/01a12543-9319-7920-9f24-4513fc1346df/exec-925e3989-52e2-4c54-a0ee-332a318e5b3e.png`. No video was touched. Self-hosted Space Grotesk is independently licensed under `assets/FONT-LICENSE.txt`.

Surface-specific direction is `.impeccable/surface.md`; the root design/README/package files are preserved. Impeccable context was loaded once. Direction seed `ab2b44da` index3 used the pinned reference after the external roll/catalog service failed bounded retries.

## Verification

```sh
./node_modules/.bin/tsx frontend-letta/scripts/validate.ts
```

The isolated browser script uses existing local Playwright via `PLAYWRIGHT_MODULE` (default `/tmp/llm-ui-work/node_modules/playwright/index.mjs`) and installed Chrome. It uses real empty-state screens plus intercepted synthetic registry, wallet, helper/OAuth and chat responses. Fixture screens carry explicit labels. No fixture logic ships in `src/` or `dist/`.

`screenshots/validation.json` records keyboard tabs, 390px layouts, empty availability, manual exact peers/rates, delisting/no fallback, blocked private mode, wallet-signed fixture initialization, password-only single-key catalog, ref-only failed discovery cleanup, exact offer configuration, secret/session storage cleanup, and personal demo manual consent/model/chat/disconnect. No real vendor login, inference, payment or chain mutation was performed. The build reports a large shared wallet/protocol bundle and HPKE's browser-external Node crypto warning; the browser checks have no runtime page errors.

## Deployment

Only the static `dist/` output is intended for the new Vercel project `llm-providers-letta`, separate from existing projects. `vercel.json` rewrites `/demo` to the SPA entry. Hosted account/key/ChatGPT operations are gated to the local workspace, and the backend is neither deployed nor given a public origin.

Public URL: https://llm-providers-letta.vercel.app (home `/`, presentation `/demo`). The final production deployment `dpl_9tVzffNwYU8JYBCCejaTnKYwd6mt` is ready, including owner/request guards and bounded diagnostic handling; `screenshots/hosted-validation.json` records the most recent verification. Deployment metadata is `design/deployment.json`. GitHub CLI was switched to `Jayesh1512`; no repository push or root git changes were needed for static deployment.
