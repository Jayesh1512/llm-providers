import { isAddressEqual, keccak256, type Address, type Hex } from 'viem';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { offerId, quoteCost } from '../shared/protocol.js';
import { ProviderError } from './errors.js';
import type { ModelConfig, PassRecord, ProviderChain, ProviderConfig, UpstreamResult } from './types.js';

const BEARER = /^pt_([1-9]\d{0,30})_([\da-f]{64})$/;
export interface PassCompletion { model: string; text: string; inputTokens: number; outputTokens: number; costWei: bigint; settled: Promise<void> }

/** Bearer-key gateway over a prepaid on-chain pass. The node meters tokens; the contract prices them within the consumer's ceilings. */
export class PassGateway {
  private readonly pending = new Map<string, bigint>();
  private totals = { calls: 0, earnedWei: '0', inputTokens: 0, outputTokens: 0 };
  constructor(private readonly o: { config: ProviderConfig; chain: ProviderChain; operator: Address; upstream: (m: ModelConfig, prompt: string, max: number) => Promise<UpstreamResult>; now: () => number; statsFile?: string }) {
    try { if (o.statsFile) this.totals = { ...this.totals, ...JSON.parse(readFileSync(o.statsFile, 'utf8')) }; } catch { /* first run */ }
  }

  /** Charged API-key calls so far. Persisted per node state dir; counts only calls whose on-chain charge confirmed. */
  stats() { return this.totals; }

  models() { return this.o.config.models.map(m => m.model); }

  private async authenticate(bearer: string): Promise<{ id: bigint; pass: PassRecord }> {
    const match = BEARER.exec(bearer);
    if (!match) throw new ProviderError(401, 'invalid_api_key', 'Invalid API key.');
    const id = BigInt(match[1]!), { config, chain, now } = this.o;
    const pass = await chain.getPass(id);
    // Same error for unknown pass and wrong secret: no oracle for which pass IDs exist.
    if (pass.consumer === '0x0000000000000000000000000000000000000000' || keccak256(`0x${match[2]}`) !== pass.keyHash) throw new ProviderError(401, 'invalid_api_key', 'Invalid API key.');
    if (!isAddressEqual(pass.provider, config.provider)) throw new ProviderError(403, 'wrong_provider', 'This key belongs to a different supplier.');
    if (pass.closed) throw new ProviderError(402, 'key_revoked', 'This key was closed. Open a new pass.');
    if (pass.expiresAt < BigInt(now() + 30)) throw new ProviderError(402, 'key_expired', 'This key has expired.');
    const peer = await chain.getPeer(config.provider);
    if (!peer.active || !(peer.roles & 1) || !isAddressEqual(peer.operator, this.o.operator)) throw new ProviderError(409, 'inactive_provider', 'Supplier is not actively registered with this node key.');
    return { id, pass };
  }

  async complete(bearer: string, input: { model: string; prompt: string; maxOutputTokens: number }): Promise<PassCompletion> {
    const { config, chain, upstream } = this.o;
    if (!input.prompt || !Number.isSafeInteger(input.maxOutputTokens) || input.maxOutputTokens < 1 || input.maxOutputTokens > config.maxOutputTokens) throw new ProviderError(400, 'invalid_request', 'Invalid prompt or max token limit.');
    const promptBytes = new TextEncoder().encode(input.prompt).length;
    if (promptBytes > config.maxPromptBytes) throw new ProviderError(413, 'prompt_too_large', 'Prompt exceeds this supplier limit.');
    const { id, pass } = await this.authenticate(bearer);
    const model = config.models.find(m => m.model === input.model || m.model === `${m.model.split('/')[0]}/${input.model}`);
    if (!model) throw new ProviderError(404, 'model_not_found', 'This supplier does not serve that model.');
    if (model.authentication?.kind === 'chatgpt-oauth') throw new ProviderError(403, 'subscription_resale_unavailable', 'Personal ChatGPT OAuth cannot serve paid requests.');
    const oid = offerId(config.provider, model.model), offer = await chain.getOffer(oid);
    if (!offer.active || !isAddressEqual(offer.provider, config.provider) || offer.apiKind !== model.apiKind) throw new ProviderError(409, 'unavailable_model', 'Model is not currently offered.');
    if (offer.inputPrice > pass.maxInputPrice || offer.outputPrice > pass.maxOutputPrice) throw new ProviderError(402, 'price_above_ceiling', 'Current price exceeds this key\'s price ceiling.');
    // Worst case: every prompt byte is a token. Reserved before the paid call, released after the charge lands.
    const reserve = quoteCost(BigInt(promptBytes), BigInt(input.maxOutputTokens), offer.inputPrice, offer.outputPrice);
    const key = id.toString(), unspent = pass.deposit - pass.spent - (this.pending.get(key) ?? 0n);
    if (reserve > pass.maxCallCost || reserve > unspent) throw new ProviderError(402, 'insufficient_balance', 'Key balance or per-call cap cannot cover this request. Lower max_tokens or open a new pass.');
    this.pending.set(key, (this.pending.get(key) ?? 0n) + reserve);
    const release = (amount: bigint) => { const left = (this.pending.get(key) ?? 0n) - amount; left > 0n ? this.pending.set(key, left) : this.pending.delete(key); };
    let result: UpstreamResult;
    try {
      result = await upstream(model, input.prompt, input.maxOutputTokens);
      if (!result.text || !Number.isSafeInteger(result.inputTokens) || !Number.isSafeInteger(result.outputTokens) || result.inputTokens < 0 || result.outputTokens < 0 || result.outputTokens > input.maxOutputTokens) throw new ProviderError(502, 'invalid_upstream_usage', 'Paid API returned invalid usage.');
    } catch (error) { release(reserve); throw error; }
    const costWei = quoteCost(BigInt(result.inputTokens), BigInt(result.outputTokens), offer.inputPrice, offer.outputPrice);
    const callId = `0x${randomBytes(32).toString('hex')}` as Hex;
    // Charge after replying; the reserve holds until the chain reflects it. A failed charge is the supplier's loss, never the consumer's.
    const settled = chain.chargePass({ passId: id, offerId: oid, callId, inputTokens: BigInt(result.inputTokens), outputTokens: BigInt(result.outputTokens) }).then(() => {
      const t = this.totals; this.totals = { calls: t.calls + 1, earnedWei: (BigInt(t.earnedWei) + costWei).toString(), inputTokens: t.inputTokens + result.inputTokens, outputTokens: t.outputTokens + result.outputTokens };
      try { if (this.o.statsFile) writeFileSync(this.o.statsFile, JSON.stringify(this.totals), { mode: 0o600 }); } catch { /* stats are best-effort */ }
    }, () => {}).finally(() => release(reserve));
    return { model: model.model, text: result.text, inputTokens: result.inputTokens, outputTokens: result.outputTokens, costWei, settled };
  }
}

/** Flatten OpenAI chat messages into one prompt. ponytail: loses roles/tools/images; upgrade the adapters to take message arrays if needed. */
export function messagesToPrompt(messages: unknown): string {
  if (!Array.isArray(messages) || !messages.length || messages.length > 200) throw new ProviderError(400, 'invalid_request', '`messages` must be a non-empty array.');
  const parts = messages.map(m => {
    const role = (m as { role?: unknown })?.role, content = (m as { content?: unknown })?.content;
    const text = typeof content === 'string' ? content : Array.isArray(content) ? content.map(c => (c as { type?: string; text?: unknown })?.type === 'text' && typeof (c as { text?: unknown }).text === 'string' ? (c as { text: string }).text : '').join('') : '';
    if (typeof role !== 'string' || !text) throw new ProviderError(400, 'invalid_request', 'Messages must have a role and text content.');
    return { role, text };
  });
  return parts.length === 1 && parts[0]!.role === 'user' ? parts[0]!.text : parts.map(p => `${p.role}: ${p.text}`).join('\n\n');
}
