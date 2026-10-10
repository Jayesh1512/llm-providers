import { z } from 'zod';
import { bytesToHex, encodeAbiParameters, keccak256, toBytes, type Hex, type Address } from 'viem';
import { CipherSuite, DhkemP256HkdfSha256, HkdfSha256, Aes256Gcm } from '@hpke/core';

const hash = z.string().regex(/^0x[0-9a-f]{64}$/).transform(v => v as Hex);
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform(v => v.toLowerCase() as Address);
export const privacyConfigSchema = z.object({
  version: z.literal(1), backend: z.literal('lit-chipotle'),
  actionId: z.string().regex(/^Qm[1-9A-HJ-NP-Za-km-z]{44}$/),
  actionPublicKey: z.string().regex(/^0x04[0-9a-f]{128}$/),
  runtimePolicyId: z.string().min(1).max(128),
  models: z.array(z.object({
    model: z.string().min(1).max(128), upstreamModel: z.string().min(1).max(128),
    apiKind: z.union([z.literal(1), z.literal(2)]),
    origin: z.enum(['https://api.anthropic.com', 'https://api.openai.com']),
    // Identifier of an independently reviewed account/model no-content-access policy.
    accountPolicyId: z.string().min(1).max(256), credentialCommitment: hash,
  }).strict()).min(1).max(100),
}).strict();
export type PrivacyConfig = z.infer<typeof privacyConfigSchema>;
export function parsePrivacyConfig(value: unknown): PrivacyConfig {
  const config = privacyConfigSchema.parse(value);
  if (new Set(config.models.map(m => m.model)).size !== config.models.length || config.models.some(m => m.origin !== (m.apiKind === 1 ? 'https://api.anthropic.com' : 'https://api.openai.com'))) throw new Error('Unsupported privacy policy.');
  return config;
}
export function configHash(config: PrivacyConfig): Hex {
  const c = parsePrivacyConfig(config);
  return keccak256(toBytes(JSON.stringify(['LLMProvidersPrivacyConfig', c.version, c.backend, c.actionId, c.actionPublicKey, c.runtimePolicyId,
    c.models.map(m => [m.model, m.upstreamModel, m.apiKind, m.origin, m.accountPolicyId, m.credentialCommitment])])));
}
export const contextSchema = z.object({
  version: z.literal(1), chainId: z.union([z.literal(10143), z.literal(31337)]), registry: address, escrow: address,
  provider: address, operator: address, consumer: address, offerId: hash, configHash: hash,
  requestId: z.string().regex(/^(0|[1-9][0-9]{0,76})$/), promptHash: hash,
  maxOutputTokens: z.number().int().min(1).max(131072),
  challenge: hash, responseKeyHash: hash, issuedAt:z.number().int().min(1),
}).strict();
export type PrivacyContext = z.infer<typeof contextSchema>;
export function contextBytes(value: PrivacyContext): Uint8Array<ArrayBuffer> {
  const c = contextSchema.parse(value);
  if (BigInt(c.requestId) >= 2n ** 256n) throw new Error('Invalid request ID.');
  return new Uint8Array(toBytes(JSON.stringify(['LLMProvidersPrivacyContext', c.version, c.chainId, c.registry, c.escrow, c.provider,
    c.operator, c.consumer, c.offerId, c.configHash, c.requestId, c.promptHash, c.maxOutputTokens, c.challenge, c.responseKeyHash, c.issuedAt])));
}
export function contextHash(context: PrivacyContext): Hex { return keccak256(contextBytes(context)); }
export function randomHash(): Hex { return bytesToHex(crypto.getRandomValues(new Uint8Array(32))); }
export function commitment(kind: 'prompt' | 'response' | 'credential', text: string, salt: Hex, policy: Hex): Hex {
  if (!/^0x[0-9a-f]{64}$/.test(salt) || !/^0x[0-9a-f]{64}$/.test(policy)) throw new Error('Invalid commitment input.');
  return keccak256(encodeAbiParameters([{type:'string'}, {type:'bytes32'}, {type:'bytes32'}, {type:'string'}], [`LLMProvidersPrivate:${kind}:v1`, policy, salt, text]));
}
export const privateInferenceTypes = { PrivateInferenceRequest: [
  {name:'requestId',type:'uint256'}, {name:'promptHash',type:'bytes32'}, {name:'maxOutputTokens',type:'uint256'},
  {name:'contextHash',type:'bytes32'}, {name:'enclaveKeyHash',type:'bytes32'},
] } as const;
export const suite = new CipherSuite({ kem: new DhkemP256HkdfSha256(), kdf: new HkdfSha256(), aead: new Aes256Gcm() });
export const envelopeSchema = z.object({enc: z.string().regex(/^[0-9a-f]{130}$/), ciphertext: z.string().regex(/^[0-9a-f]+$/).max(4_300_000)}).strict();
export type Envelope = z.infer<typeof envelopeSchema>;
export function hexBytes(hex: string): Uint8Array<ArrayBuffer> {
  if (hex.length % 2 || !/^[0-9a-f]*$/.test(hex)) throw new Error('Invalid byte encoding.');
  return Uint8Array.from(hex.match(/../g) ?? [], pair => parseInt(pair, 16));
}
export function bytesHex(bytes: Uint8Array): string { return bytesToHex(bytes).slice(2); }
export async function exportKey(key: CryptoKey): Promise<string> { return bytesHex(new Uint8Array(await crypto.subtle.exportKey('spki', key))); }
export async function importKey(spki: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('spki', hexBytes(spki), {name:'ECDH', namedCurve:'P-256'}, true, []);
}
export async function seal(key: CryptoKey, context: PrivacyContext, direction: 'request' | 'response' | 'credential', value: unknown): Promise<Envelope> {
  const sender = await suite.createSenderContext({recipientPublicKey:key, info:toBytes(`LLMProvidersHPKE:v1:${direction}`)});
  const ciphertext = await sender.seal(toBytes(JSON.stringify(value)), contextBytes(context));
  return {enc:bytesHex(new Uint8Array(sender.enc)), ciphertext:bytesHex(new Uint8Array(ciphertext))};
}
export async function open(key: CryptoKey, context: PrivacyContext, direction: 'request' | 'response' | 'credential', value: unknown): Promise<unknown> {
  const e = envelopeSchema.parse(value);
  const recipient = await suite.createRecipientContext({recipientKey:key, enc:hexBytes(e.enc), info:toBytes(`LLMProvidersHPKE:v1:${direction}`)});
  return JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(await recipient.open(hexBytes(e.ciphertext), contextBytes(context))));
}

export function keyHash(spki:string):Hex { return keccak256(hexBytes(spki)); }

export const keyBindingTypes = { GatewayKeyBinding: [
  {name:'contextHash',type:'bytes32'}, {name:'configHash',type:'bytes32'},
  {name:'actionIdHash',type:'bytes32'}, {name:'encryptionKeyHash',type:'bytes32'},
  {name:'issuedAt',type:'uint256'},
] } as const;
export function keyBindingMessage(context:PrivacyContext, actionId:string, spki:string, issuedAt:number){
  return {contextHash:contextHash(context),configHash:context.configHash,actionIdHash:keccak256(toBytes(actionId)),encryptionKeyHash:keyHash(spki),issuedAt:BigInt(issuedAt)};
}
export async function deriveActionEncryptionKeys(actionKey:Hex):Promise<CryptoKeyPair>{
  const raw=hexBytes(actionKey.slice(2));
  const input=await crypto.subtle.importKey('raw',raw,'HKDF',false,['deriveBits']);
  const seed=new Uint8Array(await crypto.subtle.deriveBits({name:'HKDF',hash:'SHA-256',salt:new TextEncoder().encode('LLMProvidersLit:v1'),info:new TextEncoder().encode('action-bound-hpke-p256')},input,256));
  try{return await suite.kem.deriveKeyPair(seed);}finally{raw.fill(0);seed.fill(0);}
}
