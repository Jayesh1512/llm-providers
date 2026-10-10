import { z } from 'zod';
import { isAddressEqual, zeroHash, type Address, type Hex } from 'viem';
import { privateKeyToAccount, publicKeyToAddress } from 'viem/accounts';
import { connectChain } from '../provider/chain.js';
import { callPaidApi } from '../provider/adapters.js';
import type { ProviderConfig } from '../provider/types.js';
import { offerId, escrowDomain } from '../shared/protocol.js';
import { PrivacyGateway } from './gateway.js';
import { commitment, configHash, contextSchema, deriveActionEncryptionKeys, exportKey, keyBindingMessage, keyBindingTypes, open, parsePrivacyConfig, privacyConfigSchema, type PrivacyConfig, type PrivacyContext } from './protocol.js';

export const manifestSchema=z.object({
  version:z.literal(1),chainId:z.literal(10143),provider:z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  registry:z.string().regex(/^0x[0-9a-fA-F]{40}$/),escrow:z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  runtimePolicyId:z.string().min(1).max(128),models:privacyConfigSchema.shape.models,
}).strict().superRefine((manifest,context)=>{
  if(new Set(manifest.models.map(m=>m.model)).size!==manifest.models.length||manifest.models.some(m=>m.origin!==(m.apiKind===1?'https://api.anthropic.com':'https://api.openai.com')))context.addIssue({code:'custom',message:'Unsupported immutable adapter configuration.'});
});
export type ActionManifest=z.infer<typeof manifestSchema>;
export interface LitRuntime { Actions:{getLitActionPrivateKey():Promise<string>;getLitActionPublicKey(params:{ipfsId:string}):Promise<string>} }
declare const Lit:LitRuntime;
export function credentialContext(policy:PrivacyConfig,manifest:ActionManifest,model:string):PrivacyContext{
  const provider=manifest.provider as Address;
  return {version:1,chainId:10143,provider,consumer:provider,operator:publicKeyToAddress(policy.actionPublicKey as Hex),registry:manifest.registry as Address,escrow:manifest.escrow as Address,offerId:offerId(provider,model),configHash:configHash(policy),requestId:'0',promptHash:zeroHash,maxOutputTokens:1,challenge:zeroHash,responseKeyHash:zeroHash,issuedAt:1};
}
/** Immutable Lit Action. No key export, arbitrary signing, general decryption, logging, PKP or plaintext response operation. */
export async function runLitAction(manifestValue:unknown,paramsValue:unknown):Promise<unknown>{
  let rawKey:Uint8Array|undefined;
  try{
    const manifest=manifestSchema.parse(manifestValue);
    const params=z.object({operation:z.enum(['bootstrap','key','infer']),policy:privacyConfigSchema,context:z.unknown(),envelope:z.unknown().optional(),credentials:z.record(z.string(),z.unknown()).optional()}).strict().parse(paramsValue);
    const policy=parsePrivacyConfig(params.policy);
    if(policy.runtimePolicyId!==manifest.runtimePolicyId||JSON.stringify(policy.models)!==JSON.stringify(manifest.models))throw new Error('Policy differs from immutable manifest.');
    const key=await Lit.Actions.getLitActionPrivateKey();
    if(!/^0x[0-9a-f]{64}$/.test(key))throw new Error('Invalid action key.');
    rawKey=Uint8Array.from(key.slice(2).match(/../g)!,pair=>parseInt(pair,16));
    const account=privateKeyToAccount(key as Hex);
    const discovered=await Lit.Actions.getLitActionPublicKey({ipfsId:policy.actionId});
    const publicKey=account.publicKey.toLowerCase();
    const compressed='0x'+(parseInt(publicKey.slice(-2),16)%2===0?'02':'03')+publicKey.slice(4,68);
    if(![publicKey,compressed].includes(discovered.toLowerCase())||policy.actionPublicKey!==account.publicKey.toLowerCase())throw new Error('Action CID/key mismatch.');
    const config:ProviderConfig={provider:manifest.provider as Address,privateKey:key as Hex,registry:manifest.registry as Address,escrow:manifest.escrow as Address,chainId:10143,rpcUrl:'https://testnet-rpc.monad.xyz',models:manifest.models.map(m=>({model:m.model,upstreamModel:m.upstreamModel,apiKind:m.apiKind,baseUrl:m.origin,apiKeyEnv:'ENCLAVE_API_KEY'})),allowedOrigins:[],stateDir:'',port:0,maxOutputTokens:8192,maxPromptBytes:32000,upstreamTimeoutMs:60000,maxStateEntries:1,localMode:false};
    const keys=await deriveActionEncryptionKeys(key as Hex);
    if(params.operation==='bootstrap'){
      // Public key discovery only, for creating the on-chain hardware challenge. Never permits funding/inference.
      const c=contextSchema.parse(params.context),issuedAt=Date.now();
      if(c.requestId!=='0'||c.chainId!==10143||c.configHash!==configHash(policy)||!isAddressEqual(c.provider,config.provider)||!isAddressEqual(c.operator,account.address)||!isAddressEqual(c.registry,config.registry)||!isAddressEqual(c.escrow,config.escrow)||c.issuedAt>issuedAt+5000||issuedAt-c.issuedAt>60000||params.credentials||params.envelope)throw new Error('Invalid bootstrap context.');
      const publicKey=await exportKey(keys.publicKey);
      const signature=await account.signTypedData({domain:escrowDomain(10143,config.escrow),types:keyBindingTypes,primaryType:'GatewayKeyBinding',message:keyBindingMessage(c,policy.actionId,publicKey,issuedAt)});
      return {ok:true,result:{publicKey,issuedAt,signature}};
    }
    const chain=await connectChain(config);
    // Reject credential substitution before consuming the irreversible one-shot claim.
    const credentials:Record<string,string>={};
    if(params.operation==='infer')for(const approval of manifest.models){
      const encrypted=params.credentials?.[approval.model];
      if(!encrypted)throw new Error('Pinned encrypted credential required.');
      const value=z.object({key:z.string().min(1).max(4096),salt:z.string().regex(/^0x[0-9a-f]{64}$/)}).strict().parse(await open(keys.privateKey,credentialContext(policy,manifest,approval.model),'credential',encrypted));
      if(commitment('credential',value.key,value.salt as Hex,offerId(config.provider,approval.model))!==approval.credentialCommitment)throw new Error('Upstream credential substituted.');
      credentials[approval.model]=value.key;
    }
    const gateway=await PrivacyGateway.create({config,policy,chain,upstream:async(model,prompt,maximum)=>{
      return callPaidApi(model,prompt,maximum,{env:{ENCLAVE_API_KEY:credentials[model.model]},timeoutMs:60000});
    }});
    if(!isAddressEqual(account.address,publicKeyToAddress(policy.actionPublicKey as Hex)))throw new Error('Action operator mismatch.');
    const result=params.operation==='key'?await gateway.attest(params.context):await gateway.infer({context:params.context,envelope:params.envelope});
    return {ok:true,result};
  }catch{return {ok:false,error:'private_request_rejected'};}
  finally{rawKey?.fill(0);} // JS strings/CryptoKeys cannot be reliably zeroed; no persistence or output of secrets.
}
