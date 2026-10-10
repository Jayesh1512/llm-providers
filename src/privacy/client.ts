import { verifyTypedData, type Hex } from 'viem';
import { publicKeyToAddress } from 'viem/accounts';
import { escrowDomain, type InferenceResult } from '../shared/protocol.js';
import { configHash, exportKey, importKey, keyBindingMessage, keyBindingTypes, keyHash, open, parsePrivacyConfig, seal, suite, type PrivacyContext } from './protocol.js';
import { APPROVED_PRIVACY_CONFIGS } from './trust.js';

// CONSUMER'S local verifier, never a supplier endpoint or provider-supplied URL.
const CLIENT_ORIGIN='http://127.0.0.1:8790';
async function clientFetch(path:string,body?:unknown):Promise<unknown>{
  const response=await fetch(`${CLIENT_ORIGIN}/privacy/${path}`,{method:body?'POST':'GET',headers:body?{'content-type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(180000)});
  if(!response.ok)throw new Error('Consumer Lit verification/action failed. No plaintext fallback.');
  if(!response.body)throw new Error('Empty private reply.');
  const reader=response.body.getReader();let size=0;const chunks:Uint8Array[]=[];
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>1000000){await reader.cancel();throw new Error('Private reply exceeds limits.');}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
}
export type ClientGateway={context:PrivacyContext;key:CryptoKey;replyKeys:CryptoKeyPair;enclaveKeyHash:Hex;expiresAt:number};
export async function verifyLitKeyBinding(binding:unknown,context:PrivacyContext,policy:ReturnType<typeof parsePrivacyConfig>,now=Date.now()):Promise<CryptoKey>{
  const b=binding as {publicKey?:unknown;issuedAt?:unknown;signature?:unknown};
  if(!b||typeof b.publicKey!=='string'||b.publicKey.length>2048||typeof b.issuedAt!=='number'||!Number.isSafeInteger(b.issuedAt)||now-b.issuedAt>60000||b.issuedAt>now+5000||context.configHash!==configHash(policy)||context.operator.toLowerCase()!==publicKeyToAddress(policy.actionPublicKey as Hex).toLowerCase()||!await verifyTypedData({address:context.operator,domain:escrowDomain(context.chainId,context.escrow),types:keyBindingTypes,primaryType:'GatewayKeyBinding',message:keyBindingMessage(context,policy.actionId,b.publicKey,b.issuedAt),signature:b.signature as Hex}))throw new Error('Invalid or stale Lit action key/session binding.');
  return importKey(b.publicKey);
}
export async function authenticateGateway(_supplierEndpoint:string,base:Omit<PrivacyContext,'responseKeyHash'|'issuedAt'>):Promise<ClientGateway>{
  if(base.chainId!==10143||!APPROVED_PRIVACY_CONFIGS.includes(base.configHash))throw new Error('No approved Lit privacy release. Configure the consumer verifier and independently review runtime, action, and upstream account policy before funding.');
  const policy=parsePrivacyConfig(await clientFetch('config'));
  if(configHash(policy)!==base.configHash)throw new Error('Local consumer policy differs from on-chain provider configuration.');
  const replyKeys=await suite.kem.generateKeyPair();
  const context:PrivacyContext={...base,responseKeyHash:keyHash(await exportKey(replyKeys.publicKey)),issuedAt:Date.now()};
  // Consumer service performs TDX, collateral, governance and actual-connection TLS verification.
  const proof=await clientFetch('attest',{context}) as {binding?:unknown;verifiedAt?:number;runtimePolicyId?:string};
  if(proof.runtimePolicyId!==policy.runtimePolicyId||typeof proof.verifiedAt!=='number'||Date.now()-proof.verifiedAt>60000||proof.verifiedAt>Date.now()+5000)throw new Error('Consumer runtime verification is stale or mismatched.');
  const key=await verifyLitKeyBinding(proof.binding,context,policy);
  return {context,key,replyKeys,enclaveKeyHash:keyHash(await exportKey(key)),expiresAt:context.issuedAt+60000};
}
export async function privateInference(_supplierEndpoint:string,gateway:ClientGateway,prompt:string,promptSalt:Hex,signature:Hex):Promise<InferenceResult>{
  if(gateway.expiresAt<=Date.now()||gateway.context.requestId==='0')throw new Error('Private session expired or not funded.');
  const envelope=await seal(gateway.key,gateway.context,'request',{prompt,promptSalt,signature,replyKey:await exportKey(gateway.replyKeys.publicKey)});
  const encrypted=await clientFetch('infer',{context:gateway.context,envelope});
  return await open(gateway.replyKeys.privateKey,gateway.context,'response',encrypted) as InferenceResult;
}
