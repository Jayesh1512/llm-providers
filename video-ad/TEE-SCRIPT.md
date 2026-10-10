# TEEPrivacyAd — what a TEE is, why it matters, and our status

15 seconds · 1920 × 1080 · 30 fps · 450 frames.

This revision supersedes the previous script for this composition. It defines a TEE before explaining the proposed Lit implementation. The original 30-second LLMProvidersAd remains unchanged.

## Caption-led script

A TEE is a hardware-protected room inside a server. It helps keep prompts hidden from the relay. Our Lit code handles encrypted requests and answers; hardware verification is still pending.

## Exact timing

| Time | Frames | Caption and picture |
| --- | --- | --- |
| 0–5s | 0–149 | “TEE = Trusted Execution Environment.” “A hardware-protected room inside a server.” A server contains a distinct hardware-enforced room with program and data; a host operator outside the room attempts to inspect it and encounters an access restriction. Qualification: “Designed to restrict host access.” |
| 5–9s | 150–269 | “Protect prompts from the relay.” The user’s encrypted prompt travels through a ciphertext-only supplier relay to Lit’s protected runtime. The relay is labeled “Cannot read the prompt.” This explains the proposed flow, not a validated deployment. |
| 9–15s | 270–449 | “Our proposed Lit flow.” Device → encrypted prompt → protected Lit Action → encrypted answer → device. The Action calls an external paid LLM, explicitly outside the TEE. Disclosure: “Upstream LLM receives the prompt.” Status: “Code built. Hardware-to-Action/key verification pending.” |

Persistent exact status: **Concept • Not live end-to-end**.

## Boundaries

A TEE provides hardware isolation; encryption alone and ordinary containers do not define a TEE. The operator diagram explains the intended isolation property and does not promise unhackability or prove our implementation meets it. Our protected inference is not live end-to-end: the runtime-to-Action/key binding and immutable-action/runtime/upstream-governance review remain pending; approved private configuration is not enabled. The external upstream LLM receives plaintext. This film makes no privacy-from-upstream, anonymity, guaranteed secrecy, proven inference correctness, or deployed gateway claims.

The film is readable muted, with editable text and named layers. No narration or MP4 has been exported.
