# LLM Providers launch ad

A 30-second, 1920 × 1080, 30 fps Remotion film: kinetic typography, supplier input/output price comparison, a direct peer request, consumer-approved escrow, and a Monad testnet call to action. The green-and-paper palette and DM Sans typography follow the app's brand. The original stereo soundtrack contains no third-party samples.

## Preview and edit

```sh
cd video-ad/film
npm install
npm run dev
```

Open the printed Studio URL and choose `LLMProvidersAd`; the current server is <http://localhost:3000/LLMProvidersAd>. Press play and unmute to hear the score. Six connected scene compositions can be edited independently; named interactive layers expose text, layout, keyframes, and timing. Source: `film/src/`; timeline: `film/src/Composition.tsx`.

`STORYBOARD.md` records the scene plan. `output/poster.png` is the inspected 1080p closing frame. `output/frames/` contains representative frames at 2.5, 6, 11, 16.67, 22.5, and 27 seconds.

## Export when requested

```sh
cd video-ad/film
npm run render
```

This creates `video-ad/output/llm-providers-ad.mp4` using H.264. No full video has been exported yet; the Remotion skill defaults to the editable Studio preview until export is explicitly requested. Regenerate the poster with `npm run poster`.

If Chrome Headless Shell cannot download, use the installed Chrome:

```sh
npm run render -- --browser-executable='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
```

## Validation and assets

`npm run lint` checks ESLint and TypeScript. Six representative frames were rendered from the composition and inspected. The soundtrack is 30 seconds, 44.1 kHz stereo with a fade in/out; reproduce it with `python3 video-ad/scripts/make-soundtrack.py` from the repository root.

DM Sans uses the SIL Open Font License in `film/public/LICENSE`. The original geometric mark and soundtrack were authored for this film. No stock footage, private credentials, customer evidence, or deployment addresses appear.

The model ID, supplier names, rates, and budget split are labeled illustrative. The ad describes the testnet MVP without promising savings, profits, mainnet readiness, verified upstream usage, or automatic settlement without consumer approval.

## 15-second TEE explainer

`TEEPrivacyAd` is a separate, muted-readable 15-second composition (450 frames, 1920 × 1080, 30 fps). Preview: <http://localhost:3000/TEEPrivacyAd>. The completed `LLMProvidersAd` is preserved. Three connected scene timelines appear in `TEE-Scenes`.

The revised script and exact timings are saved in [`TEE-SCRIPT.md`](TEE-SCRIPT.md). Source/registration: `film/src/TEEPrivacyAd.tsx`; scenes: `film/src/TEE{Action,Input,Upstream}.tsx`. Poster: `output/tee-poster.png`; representative frames: `output/tee-explainer-frames/element-{100,225,420}.png`.

The film defines a TEE as a hardware-protected room inside a server, illustrates restricted host access, then explains relay privacy and our proposed Lit flow. Persistent status: **Concept • Not live end-to-end**. The external upstream LLM receives the prompt; code is built, while hardware-to-Action/key verification remains pending. The diagram explains the concept without claiming a validated live implementation or absolute privacy.

Regenerate the still with `npm run poster:tee` inside `video-ad/film`. A later explicitly requested export can use `npm run render:tee`; no MP4 has been exported. The installed-Chrome `--browser-executable` option above also applies. The composition has no narration or audio dependency and remains readable muted.

Validation: `npm run lint` checks ESLint and TypeScript. The three representative frames and poster are rendered from the executable composition and inspected; Studio playback is also verified.
