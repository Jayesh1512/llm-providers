import { isAddressEqual, verifyTypedData, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  contentHash, escrowDomain, identityDomain, identityTypes, inferenceTypes,
  invoiceDomain, invoiceTypes, quoteCost, usageTypes,
} from '../shared/protocol.js';
import { callPaidApi } from './adapters.js';
import { ProviderError } from './errors.js';
import type { FundedRequest, InferenceInput, Invoice, ModelConfig, ProviderChain, ProviderConfig, StateStore, UpstreamResult } from './types.js';
import { commitment, contextHash, privateInferenceTypes, type PrivacyContext } from '../privacy/protocol.js';

export interface CoreOptions {
  config: ProviderConfig;
  chain: ProviderChain;
  store: StateStore;
  upstream?: (model: ModelConfig, prompt: string, maxOutputTokens: number) => Promise<UpstreamResult>;
  now?: () => number;
  privacy?: { context: PrivacyContext; enclaveKeyHash: Hex; promptSalt: Hex; responseSalt: Hex };
}
export class ProviderCore {
  readonly operator: Address;
  private readonly account;
  private readonly inFlight = new Map<string, Promise<Invoice>>();
  private readonly settling = new Map<string, Promise<Hex>>();
  private readonly upstream: NonNullable<CoreOptions['upstream']>;
  private readonly now: () => number;
  constructor(readonly options: CoreOptions) {
    this.account = privateKeyToAccount(options.config.privateKey);
    this.operator = this.account.address;
    this.upstream = options.upstream ?? ((model, prompt, maximum) => callPaidApi(model, prompt, maximum, { timeoutMs: options.config.upstreamTimeoutMs }));
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000));
  }
  async identity(challenge: Hex) {
    if (typeof challenge !== 'string' || !/^0x[\da-fA-F]{64}$/.test(challenge)) throw new ProviderError(400, 'invalid_challenge', 'Challenge must be 32 random bytes.');
    const { config, chain } = this.options;
    const peer = await chain.getPeer(config.provider);
    this.requirePeer(peer);
    const signature = await this.account.signTypedData({ domain: identityDomain(config.chainId, config.registry), types: identityTypes, primaryType: 'PeerIdentity', message: { challenge, provider: config.provider, registry: config.registry } });
    return { provider: config.provider, operator: this.operator, registry: config.registry, chainId: config.chainId, challenge, signature };
  }
  private requirePeer(peer: Awaited<ReturnType<ProviderChain['getPeer']>>) {
    if (!peer.active || !(peer.roles & 1)) throw new ProviderError(409, 'inactive_provider', 'Supplier is not actively registered as a provider.');
    if (!isAddressEqual(peer.operator, this.operator)) throw new ProviderError(409, 'operator_mismatch', 'Supplier node key does not match its on-chain operator.');
  }
  private async authorized(input: InferenceInput): Promise<{ request: FundedRequest; model: ModelConfig }> {
    const { config, chain } = this.options;
    if (typeof input.requestId !== 'string' || !/^[1-9]\d{0,76}$/.test(input.requestId) || BigInt(input.requestId) >= 2n ** 256n ||
      typeof input.prompt !== 'string' || !input.prompt || new TextEncoder().encode(input.prompt).length > config.maxPromptBytes ||
      !Number.isSafeInteger(input.maxOutputTokens) || input.maxOutputTokens < 1 || input.maxOutputTokens > config.maxOutputTokens ||
      typeof input.signature !== 'string' || !/^0x[\da-fA-F]{130}$/.test(input.signature)) throw new ProviderError(400, 'invalid_request', 'Invalid inference authorization or request limits.');
    const request = await chain.getRequest(BigInt(input.requestId));
    const policy = await chain.getRequestPrivacy(BigInt(input.requestId));
    const privacy = this.options.privacy;
    if (privacy ? policy !== privacy.context.configHash : policy !== `0x${'0'.repeat(64)}`) throw new ProviderError(403, 'privacy_required', 'Request privacy configuration does not match this execution path.');
    if (!isAddressEqual(request.provider, config.provider) || request.deposit <= 0n) throw new ProviderError(403, 'wrong_provider', 'Request is not funded for this supplier.');
    if (request.closed) throw new ProviderError(409, 'request_closed', 'The funded request is already closed.');
    if (request.expiresAt < BigInt(this.now() + 120)) throw new ProviderError(409, 'insufficient_deadline', 'At least 120 seconds must remain before inference starts.');
    const promptHash = privacy ? commitment('prompt', input.prompt, privacy.promptSalt, policy) : contentHash(input.prompt);
    if (request.promptHash.toLowerCase() !== promptHash.toLowerCase()) throw new ProviderError(403, 'prompt_mismatch', 'Prompt does not match the funded request.');
    const [peer, consumer, offer] = await Promise.all([chain.getPeer(config.provider), chain.getPeer(request.consumer), chain.getOffer(request.offerId)]);
    this.requirePeer(peer);
    if (!consumer.active || !(consumer.roles & 2)) throw new ProviderError(403, 'consumer_not_registered', 'Consumer is not actively registered.');
    const model = config.models.find(item => item.model === offer.model && item.apiKind === offer.apiKind);
    if (!offer.active || !isAddressEqual(offer.provider, config.provider) || !model) throw new ProviderError(409, 'unavailable_model', 'Funded model is not currently available from this supplier.');
    if(model.authentication?.kind==='chatgpt-oauth')throw new ProviderError(403,'subscription_resale_unavailable','Personal ChatGPT OAuth cannot serve a paid marketplace request.');
    let authorized = false;
    try {
      const common = { requestId: BigInt(input.requestId), promptHash: request.promptHash, maxOutputTokens: BigInt(input.maxOutputTokens) };
      authorized = privacy
        ? await verifyTypedData({address:request.consumer, domain:escrowDomain(config.chainId, config.escrow), types:privateInferenceTypes, primaryType:'PrivateInferenceRequest', message:{...common, contextHash:contextHash(privacy.context), enclaveKeyHash:privacy.enclaveKeyHash}, signature:input.signature})
        : await verifyTypedData({ address: request.consumer, domain: escrowDomain(config.chainId, config.escrow), types: inferenceTypes, primaryType: 'InferenceRequest', message: common, signature: input.signature });
    } catch {}
    if (!authorized) throw new ProviderError(403, 'invalid_signature', 'Consumer inference authorization is invalid.');
    // Reserve enough for the full authorized output cap before making a paid call.
    if (quoteCost(0n, BigInt(input.maxOutputTokens), request.inputPrice, request.outputPrice) > request.deposit) throw new ProviderError(409, 'insufficient_budget', 'Deposit cannot cover the requested output limit.');
    return { request, model };
  }
  async infer(input: InferenceInput): Promise<Invoice> {
    const { request, model } = await this.authorized(input);
    const saved = this.options.store.get(input.requestId);
    if (saved && (saved.promptHash !== request.promptHash || saved.maxOutputTokens !== input.maxOutputTokens)) throw new ProviderError(409, 'replay_mismatch', 'The request was already started with a different authorization.');
    const concurrent = this.inFlight.get(input.requestId);
    if (concurrent) return concurrent;
    if (saved?.status === 'done' && saved.invoice) return saved.invoice;
    if (saved) throw new ProviderError(409, 'request_not_retryable', 'This request was interrupted or failed after acceptance; it will not run a paid API again. Refund after expiry.');
    const operation = this.runOnce(input, request, model);
    this.inFlight.set(input.requestId, operation);
    try { return await operation; } finally { this.inFlight.delete(input.requestId); }
  }
  /** Authenticated recovery never starts inference and can recover near the deadline. */
  async recover(input: Omit<InferenceInput, 'prompt'>): Promise<Invoice> {
    const { config, chain, store } = this.options;
    if (typeof input.requestId !== 'string' || !/^[1-9]\d{0,76}$/.test(input.requestId) || BigInt(input.requestId) >= 2n ** 256n || !Number.isSafeInteger(input.maxOutputTokens) || input.maxOutputTokens < 1 || typeof input.signature !== 'string' || !/^0x[\da-fA-F]{130}$/.test(input.signature)) throw new ProviderError(400, 'invalid_request', 'Invalid recovery authorization.');
    const request = await chain.getRequest(BigInt(input.requestId));
    if (!isAddressEqual(request.provider, config.provider)) throw new ProviderError(403, 'wrong_provider', 'Request belongs to a different supplier.');
    let valid = false;
    try { valid = await verifyTypedData({ address: request.consumer, domain: escrowDomain(config.chainId, config.escrow), types: inferenceTypes, primaryType: 'InferenceRequest', message: { requestId: BigInt(input.requestId), promptHash: request.promptHash, maxOutputTokens: BigInt(input.maxOutputTokens) }, signature: input.signature }); } catch {}
    if (!valid) throw new ProviderError(403, 'invalid_signature', 'Consumer recovery authorization is invalid.');
    const state = store.get(input.requestId);
    if (state?.maxOutputTokens !== input.maxOutputTokens || state.promptHash !== request.promptHash) throw new ProviderError(404, 'invoice_not_found', 'No matching cached invoice.');
    if (state.status !== 'done' || !state.invoice) throw new ProviderError(409, 'request_not_retryable', 'The request has no completed invoice; no paid API will be replayed.');
    return state.invoice;
  }
  private async runOnce(input: InferenceInput, request: FundedRequest, model: ModelConfig): Promise<Invoice> {
    const { config, store } = this.options;
    const state = { promptHash: request.promptHash, maxOutputTokens: input.maxOutputTokens };
    // Durable acceptance precedes the paid call. On restart pending entries fail safe.
    await store.set(input.requestId, { ...state, status: 'pending' });
    try {
      if (this.options.privacy) await this.options.chain.claimPrivate(BigInt(input.requestId),{maxOutputTokens:input.maxOutputTokens,contextHash:contextHash(this.options.privacy.context),signature:input.signature});
      const result = await this.upstream(model, input.prompt, input.maxOutputTokens);
      if (!result.text || new TextEncoder().encode(result.text).length > (this.options.privacy ? 350000 : 2 * 1024 * 1024) || !Number.isSafeInteger(result.inputTokens) || result.inputTokens < 0 || !Number.isSafeInteger(result.outputTokens) || result.outputTokens < 0 || result.outputTokens > input.maxOutputTokens) throw new ProviderError(502, 'invalid_upstream_usage', 'Paid API response exceeded the authorized limits or returned invalid usage.');
      const amount = quoteCost(BigInt(result.inputTokens), BigInt(result.outputTokens), request.inputPrice, request.outputPrice);
      if (amount <= 0n) throw new ProviderError(502, 'invalid_upstream_usage', 'The paid API returned no billable token usage.');
      if (amount > request.deposit) throw new ProviderError(409, 'invoice_exceeds_deposit', 'Reported API usage exceeds the funded deposit. No invoice will be accepted.');
      const privacy = this.options.privacy;
      const responseHash = privacy ? commitment('response', result.text, privacy.responseSalt, privacy.context.configHash) : contentHash(result.text);
      const signature = await this.account.signTypedData({ domain: invoiceDomain(config.chainId, config.escrow), types: invoiceTypes, primaryType: 'Invoice', message: { requestId: BigInt(input.requestId), responseHash, inputTokens: BigInt(result.inputTokens), outputTokens: BigInt(result.outputTokens), amountWei: amount } });
      const invoice: Invoice = { ...result, ...(privacy ? {responseSalt:privacy.responseSalt} : {}), requestId: input.requestId, responseHash, amountWei: amount.toString(), provider: config.provider, operator: this.operator, signature };
      await store.set(input.requestId, { ...state, status: 'done', invoice });
      return invoice;
    } catch (error) {
      await store.set(input.requestId, { ...state, status: 'failed' });
      throw error;
    }
  }
  async settle(input: { requestId: string; inputTokens: number; outputTokens: number; responseHash: Hex; signature: Hex }): Promise<Hex> {
    const { config, chain, store } = this.options;
    if (typeof input.requestId !== 'string' || !/^[1-9]\d{0,76}$/.test(input.requestId) || BigInt(input.requestId) >= 2n ** 256n || !Number.isSafeInteger(input.inputTokens) || input.inputTokens < 0 || !Number.isSafeInteger(input.outputTokens) || input.outputTokens < 0 || typeof input.responseHash !== 'string' || !/^0x[\da-fA-F]{64}$/.test(input.responseHash) || typeof input.signature !== 'string' || !/^0x[\da-fA-F]{130}$/.test(input.signature)) throw new ProviderError(400, 'invalid_receipt', 'Invalid usage receipt.');
    const invoice = store.get(input.requestId)?.invoice;
    if (!invoice || invoice.inputTokens !== input.inputTokens || invoice.outputTokens !== input.outputTokens || invoice.responseHash.toLowerCase() !== input.responseHash.toLowerCase()) throw new ProviderError(409, 'invoice_mismatch', 'Usage approval does not match the supplier invoice.');
    const request = await chain.getRequest(BigInt(input.requestId));
    if (request.closed || request.expiresAt <= BigInt(this.now())) throw new ProviderError(409, 'request_closed', 'The request is closed or expired.');
    let valid = false;
    try { valid = await verifyTypedData({ address: request.consumer, domain: escrowDomain(config.chainId, config.escrow), types: usageTypes, primaryType: 'UsageReceipt', message: { requestId: BigInt(input.requestId), inputTokens: BigInt(input.inputTokens), outputTokens: BigInt(input.outputTokens), responseHash: input.responseHash }, signature: input.signature }); } catch {}
    if (!valid) throw new ProviderError(403, 'invalid_signature', 'Consumer usage approval is invalid.');
    const concurrent = this.settling.get(input.requestId);
    if (concurrent) return concurrent;
    const operation = chain.settle({ requestId: BigInt(input.requestId), inputTokens: BigInt(input.inputTokens), outputTokens: BigInt(input.outputTokens), responseHash: input.responseHash, signature: input.signature });
    this.settling.set(input.requestId, operation);
    try { return await operation; } finally { this.settling.delete(input.requestId); }
  }
}
