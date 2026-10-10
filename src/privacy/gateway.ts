import { z } from 'zod';
import { isAddressEqual, type Hex } from 'viem';
import { privateKeyToAccount, publicKeyToAddress } from 'viem/accounts';
import { escrowDomain } from '../shared/protocol.js';
import { ProviderCore } from '../provider/core.js';
import { MemoryStateStore } from '../shared/memory-store.js';
import { callPaidApi } from '../provider/adapters.js';
import type { ProviderChain, ProviderConfig, UpstreamResult, ModelConfig } from '../provider/types.js';
import { configHash, contextHash, contextSchema, envelopeSchema, exportKey, importKey, keyHash, open, parsePrivacyConfig, randomHash, seal, deriveActionEncryptionKeys, keyBindingMessage, keyBindingTypes, type Envelope, type PrivacyConfig, type PrivacyContext } from './protocol.js';

const payloadSchema = z.object({
  prompt: z.string().min(1).max(48000), promptSalt: z.string().regex(/^0x[0-9a-f]{64}$/),
  signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/), replyKey: z.string().regex(/^[0-9a-f]+$/).max(2048),
}).strict();
/** Production use is exclusively inside the approved immutable Lit Action. */
export class PrivacyGateway {
  private constructor(private readonly options: {
    config:ProviderConfig; policy:PrivacyConfig; chain:ProviderChain;
    upstream?: (model:ModelConfig, prompt:string, maximum:number)=>Promise<UpstreamResult>;
  }, private readonly keys:CryptoKeyPair) {}
  static async create(options: GatewayOptions): Promise<PrivacyGateway> {
    if(options.config.models.some(model=>model.authentication?.kind==='chatgpt-oauth'))throw new Error('Private OAuth requires protected, rollback-safe refresh storage and hardware action/key evidence.');
    if(options.config.models.some(model=>model.authentication?.kind==='api-key'&&model.authentication.credentialRef))throw new Error('Local managed API credentials are standard-host references. Private credentials must be explicitly sealed to the approved immutable action.');
    const policy = parsePrivacyConfig(options.policy);

    if (!(options.config.chainId === 10143 || (options.config.localMode && options.config.chainId === 31337))) throw new Error('Unsupported gateway chain.');
    if (options.config.models.length !== policy.models.length || policy.models.some(p => !options.config.models.some(m => m.model === p.model && m.upstreamModel === p.upstreamModel && m.apiKind === p.apiKind && m.baseUrl === p.origin))) throw new Error('Gateway upstream configuration does not match the attested policy.');
    if (!isAddressEqual(publicKeyToAddress(policy.actionPublicKey as Hex),privateKeyToAccount(options.config.privateKey).address)) throw new Error('Action identity key mismatch.');
    const keys = await deriveActionEncryptionKeys(options.config.privateKey);
    return new PrivacyGateway({...options, policy}, keys);
  }
  get policy(): PrivacyConfig { return structuredClone(this.options.policy); }
  private async validateContext(value: unknown): Promise<PrivacyContext> {
    const c = contextSchema.parse(value);
    if(c.issuedAt > Date.now()+5000 || Date.now()-c.issuedAt > 60000)throw new Error('Stale action session.');
    const {config, chain, policy} = this.options;
    if (c.chainId !== config.chainId || !isAddressEqual(c.registry,config.registry) || !isAddressEqual(c.escrow,config.escrow) || !isAddressEqual(c.provider,config.provider) || c.configHash !== configHash(policy) || c.maxOutputTokens > config.maxOutputTokens) throw new Error('Gateway context mismatch.');
    const [peer, offer, published] = await Promise.all([chain.getPeer(config.provider), chain.getOffer(c.offerId), chain.getPrivacyConfig(config.provider)]);
    const core = new ProviderCore({config, chain, store:new MemoryStateStore()});
    if (!peer.active || !(peer.roles & 1) || !isAddressEqual(peer.operator, core.operator) || !isAddressEqual(c.operator,core.operator) || !offer.active || !isAddressEqual(offer.provider,config.provider) || published !== c.configHash || !policy.models.some(m => m.model === offer.model && m.apiKind === offer.apiKind)) throw new Error('Gateway identity or published policy mismatch.');
    if (!await chain.isPrivacyVerified(config.provider,c.configHash) || await chain.getVerifiedEncryptionKeyHash(config.provider,c.configHash) !== keyHash(await exportKey(this.keys.publicKey))) throw new Error('No valid on-chain Lit hardware/action/key attestation.');
    if (c.requestId !== '0') {
      const r = await chain.getRequest(BigInt(c.requestId));
      if (r.closed || !isAddressEqual(r.consumer,c.consumer) || !isAddressEqual(r.provider,c.provider) || r.offerId !== c.offerId || r.promptHash !== c.promptHash || await chain.getRequestPrivacy(BigInt(c.requestId)) !== c.configHash) throw new Error('Funded privacy context mismatch.');
    }
    return c;
  }
  async attest(value: unknown): Promise<{publicKey:string;issuedAt:number;signature:Hex}> {
    const context=await this.validateContext(value);
    const publicKey=await exportKey(this.keys.publicKey);const issuedAt=Date.now();
    const account=privateKeyToAccount(this.options.config.privateKey);
    const signature=await account.signTypedData({domain:escrowDomain(context.chainId,context.escrow),types:keyBindingTypes,primaryType:'GatewayKeyBinding',message:keyBindingMessage(context,this.options.policy.actionId,publicKey,issuedAt)});
    return {publicKey,issuedAt,signature}; // Action proof only; consumer must verify the Lit runtime/connection first.
  }
  async infer(value: unknown): Promise<Envelope> {
    const request = z.object({context:contextSchema, envelope:envelopeSchema}).strict().parse(value);
    if(request.context.requestId === '0')throw new Error('Funded request required.');
    const c = await this.validateContext(request.context);
    const payload = payloadSchema.parse(await open(this.keys.privateKey, c, 'request', request.envelope));
    const replyKey = await importKey(payload.replyKey);
    if (keyHash(payload.replyKey) !== c.responseKeyHash) throw new Error('Response key substitution.');
    const core = new ProviderCore({
      config:this.options.config, chain:this.options.chain, store:new MemoryStateStore(),
      privacy:{context:c, enclaveKeyHash:keyHash(await exportKey(this.keys.publicKey)), promptSalt:payload.promptSalt as Hex, responseSalt:randomHash()},
      upstream:this.options.upstream ?? ((model,prompt,maximum)=>callPaidApi(model,prompt,maximum,{timeoutMs:this.options.config.upstreamTimeoutMs})),
    });
    const invoice = await core.infer({requestId:c.requestId, prompt:payload.prompt, maxOutputTokens:c.maxOutputTokens, signature:payload.signature as Hex});
    const encrypted=await seal(replyKey, c, 'response', invoice);
    if(JSON.stringify(encrypted).length>900000)throw new Error('Encrypted answer exceeds Lit reply limit.');
    return encrypted;
  }
}
type GatewayOptions = {
  config:ProviderConfig; policy:PrivacyConfig; chain:ProviderChain;
  upstream?: (model:ModelConfig, prompt:string, maximum:number)=>Promise<UpstreamResult>;
};
