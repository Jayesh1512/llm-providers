import { constants } from 'node:fs';
import { mkdir, open, lstat, realpath, rename, unlink, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AccountError } from './errors.js';
import type { ApiKeyConnection, SaveApiKeyInput,ManagedProviderModelConfig,ApiKeyDiscoveryError } from '../shared/accounts.js';
import type { ModelConfig } from '../provider/types.js';
import { ProviderError } from '../provider/errors.js';
import { limitedJson } from './openai.js';
import { openAITextCapability,OPENAI_CAPABILITY_POLICY } from './openai-catalog.js';

export const saveApiKeySchema=z.object({
  provider:z.enum(['anthropic','openai','compatible']),
  model:z.string().min(1).max(128).refine(v=>Buffer.byteLength(v)<=128&&!/[\u0000-\u001f\u007f]/.test(v)).optional(),
  upstreamModel:z.string().min(1).max(128).refine(v=>!/[\u0000-\u001f\u007f]/.test(v)).optional(),
  baseUrl:z.string().max(2048),apiKey:z.string().min(12).max(8192).regex(/^[\x21-\x7e]+$/),
  discoverModels:z.boolean().optional(),
}).strict().superRefine((v,ctx)=>{
  if(v.discoverModels?(v.provider!=='openai'||v.model!==undefined||v.upstreamModel!==undefined):(!v.model||!v.upstreamModel))ctx.addIssue({code:'custom',message:'Choose official OpenAI discovery or an exact manual model binding.'});
  try{
    const url=new URL(v.baseUrl);
    if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.toString().replace(/\/$/,'')!==v.baseUrl.replace(/\/$/,''))throw new Error();
    if(v.provider==='anthropic'&&v.baseUrl!=='https://api.anthropic.com'||v.provider==='openai'&&v.baseUrl!=='https://api.openai.com')throw new Error();
  }catch{ctx.addIssue({code:'custom',path:['baseUrl'],message:'Use the official origin or an explicit compatible HTTPS endpoint.'});}
});
const catalogId=z.string().min(1).max(128).regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);
const catalogSchema=z.object({status:z.enum(['ready','failed','not_requested']),ids:z.array(catalogId).max(1000),discoveredAt:z.number().int().positive().optional(),error:z.enum(['invalid_credentials','forbidden','rate_limited','unavailable','invalid_catalog']).optional()}).strict().superRefine((v,ctx)=>{
  if(new Set(v.ids).size!==v.ids.length||v.status==='ready'&&(!v.discoveredAt||v.error)||v.status!=='ready'&&v.ids.length||v.status==='failed'&&!v.error||v.status!=='failed'&&v.error)ctx.addIssue({code:'custom',message:'Invalid catalog snapshot.'});
});
// Keep saved API secrets separate: the ordinary provider reader never parses an OAuth token file.
const fileSchema=z.object({version:z.literal(1),operator:z.string().regex(/^0x[0-9a-f]{40}$/),keys:z.array(z.object({credentialRef:z.string().uuid(),provider:z.enum(['anthropic','openai','compatible']),model:z.string().optional(),upstreamModel:z.string().optional(),baseUrl:z.string(),apiKey:z.string(),catalog:catalogSchema.optional()}).strict()).max(100)}).strict();
type KeyFile=z.infer<typeof fileSchema>;
type Key=KeyFile['keys'][number];
function parseFile(value:unknown):KeyFile{
  const file=fileSchema.parse(value);
  for(const key of file.keys){
    saveApiKeySchema.parse({provider:key.provider,model:key.model,upstreamModel:key.upstreamModel,baseUrl:key.baseUrl,apiKey:key.apiKey,discoverModels:!!key.catalog});
    if(key.catalog?.ids.some(id=>id.includes(key.apiKey)))throw new AccountError('storage_unavailable',503);
  }
  if(new Set(file.keys.map(k=>k.credentialRef)).size!==file.keys.length)throw new AccountError('storage_unavailable',503);
  return file;
}
function modelConfig(key:Key,model:string,upstreamModel:string,apiKind:1|2|3):ManagedProviderModelConfig{
  return {model,upstreamModel,baseUrl:key.baseUrl,apiKind,apiKeyEnv:'',authentication:{kind:'api-key',provider:key.provider,billingSource:'api-credits',credentialRef:key.credentialRef}};
}
function publicKey(key:Key):ApiKeyConnection{
  const {credentialRef,provider,model,upstreamModel,baseUrl}=key;
  const result:ApiKeyConnection={credentialRef,provider,baseUrl,kind:'api-key',billingSource:'api-credits',credentialLabel:'••••'+key.apiKey.slice(-4),validation:'unverified'};
  if(model&&upstreamModel)Object.assign(result,{model,upstreamModel,providerModelConfig:modelConfig(key,model,upstreamModel,provider==='anthropic'?1:provider==='openai'?2:3)});
  if(key.catalog){
    result.catalog={source:'openai-models',capabilityPolicy:OPENAI_CAPABILITY_POLICY,status:key.catalog.status,discoveredAt:key.catalog.discoveredAt,error:key.catalog.error,models:[],unsupported:[]};
    for(const id of key.catalog.ids){const capability=openAITextCapability(id);if(capability.supported){const config=modelConfig(key,'openai/'+id,id,2);result.catalog.models.push({model:config.model,upstreamModel:id,apiKind:2,providerModelConfig:config});}else result.catalog.unsupported.push({id,reason:capability.reason});}
  }
  return result;
}
async function safeDirectory(path:string){const info=await lstat(path);if(!info.isDirectory()||info.isSymbolicLink()||info.mode&0o077||info.uid!==process.getuid?.()||await realpath(path)!==path)throw new AccountError('storage_unavailable',503);}
async function readKeys(directory:string):Promise<KeyFile>{
  await safeDirectory(directory);
  const fd=await open(join(directory,'keys.json'),constants.O_RDONLY|constants.O_NOFOLLOW);
  try{const info=await fd.stat();if(!info.isFile()||info.mode&0o077||info.uid!==process.getuid?.()||info.size>2*1024*1024)throw new AccountError('storage_unavailable',503);return parseFile(JSON.parse(await fd.readFile('utf8')));}finally{await fd.close();}
}
export class ApiKeyStore {
  private tail:Promise<unknown>=Promise.resolve();private failed=false;private closed=false;
  private discoveries=new Map<string,{owner:string;controller:AbortController}>();
  private constructor(readonly directory:string,private state:KeyFile,private lease:Awaited<ReturnType<typeof open>>,private network:typeof fetch){}
  static async open(accountDirectory:string,operator:string,network:typeof fetch=fetch):Promise<ApiKeyStore>{
    const parent=resolve(accountDirectory),directory=join(parent,'api-keys');let lease:Awaited<ReturnType<typeof open>>|undefined;
    try{
      await safeDirectory(parent);await mkdir(directory,{mode:0o700});
    }catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw new AccountError('storage_unavailable',503);}
    try{
      await safeDirectory(directory);lease=await open(join(directory,'.lock'),constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);
      await lease.writeFile(JSON.stringify({pid:process.pid}));await lease.sync();
      for(const name of await readdir(directory))if(/^\.snapshot-[0-9a-f-]{36}$/.test(name)){const info=await lstat(join(directory,name));if(!info.isFile()||info.isSymbolicLink()||info.uid!==process.getuid?.()||info.mode&0o077)throw new Error();await unlink(join(directory,name));}
      let state:KeyFile;try{state=await readKeys(directory);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;state={version:1,operator:operator.toLowerCase(),keys:[]};}
      if(state.operator!==operator.toLowerCase())throw new Error();const store=new ApiKeyStore(directory,state,lease,network);await store.mutate(()=>{});return store;
    }catch{if(lease){await lease.close();await unlink(join(directory,'.lock')).catch(()=>{});}throw new AccountError('storage_unavailable',503);}
  }
  list(){if(this.failed||this.closed)throw new AccountError('storage_unavailable',503);return this.state.keys.map(publicKey);}
  private mutate(change:(state:KeyFile)=>void):Promise<void>{
    const operation=this.tail.then(async()=>{
      if(this.failed||this.closed)throw new AccountError('storage_unavailable',503);
      const next=structuredClone(this.state);change(next);const parsed=parseFile(next),path=join(this.directory,'.snapshot-'+randomUUID());
      if(Buffer.byteLength(JSON.stringify(parsed))>2*1024*1024)throw new AccountError('invalid_request');
      try{
        const fd=await open(path,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);try{await fd.writeFile(JSON.stringify(parsed));await fd.sync();}finally{await fd.close();}
        await rename(path,join(this.directory,'keys.json'));const dir=await open(this.directory,constants.O_RDONLY);try{await dir.sync();}finally{await dir.close();}this.state=parsed;
      }catch{this.failed=true;throw new AccountError('storage_unavailable',503);}finally{await unlink(path).catch(()=>{});}
    });this.tail=operation.catch(()=>{});return operation;
  }
  async save(input:unknown){
    const {discoverModels,...value}=saveApiKeySchema.parse(input),key:Key={...value,credentialRef:randomUUID(),...(discoverModels?{catalog:{status:'not_requested',ids:[]}}:{})};
    await this.mutate(s=>{if(s.keys.length>=100)throw new AccountError('invalid_request');s.keys.push(key);});return publicKey(key);
  }
  /** Metadata only; fixed official origin, no inference or key-pattern guessing. */
  async discover(credentialRef:string,owner:string,active:()=>boolean=()=>true):Promise<ApiKeyConnection>{
    if(this.failed||this.closed)throw new AccountError('storage_unavailable',503);
    const key=this.state.keys.find(k=>k.credentialRef===credentialRef);
    if(!key||key.provider!=='openai'||key.baseUrl!=='https://api.openai.com'||this.discoveries.has(credentialRef))throw new AccountError('invalid_request');
    if(!active())throw new AccountError('authorization_rejected',401);
    const controller=new AbortController(),job={owner,controller};this.discoveries.set(credentialRef,job);
    const live=()=>!controller.signal.aborted&&!this.closed&&active();
    try{
      // Explicit upgrade from a legacy single-model record. Stale membership cannot survive a failed refresh.
      await this.mutate(s=>{const k=s.keys.find(k=>k.credentialRef===credentialRef);if(!k||!live())throw new AccountError('authorization_rejected',401);delete k.model;delete k.upstreamModel;k.catalog={status:'not_requested',ids:[]};});
      let ids:string[]=[],error:ApiKeyDiscoveryError|undefined,received=false;
      try{
        const response=await this.network('https://api.openai.com/v1/models',{method:'GET',headers:{authorization:'Bearer '+key.apiKey},redirect:'error',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])});
        received=true;
        if(!response.ok){await response.body?.cancel();error=response.status===401?'invalid_credentials':response.status===403?'forbidden':response.status===429?'rate_limited':'unavailable';}
        else if(response.status!==200){await response.body?.cancel();error='invalid_catalog';}
        else{
          const parsed=z.object({object:z.literal('list'),data:z.array(z.object({id:catalogId}).passthrough()).max(1000)}).passthrough().parse(await limitedJson(response));
          ids=parsed.data.map(m=>m.id);if(new Set(ids).size!==ids.length||ids.some(id=>id.includes(key.apiKey)))throw new Error();
        }
      }catch{error=received?'invalid_catalog':'unavailable';ids=[];}
      if(!live())throw new AccountError('authorization_rejected',401);
      await this.mutate(s=>{const k=s.keys.find(k=>k.credentialRef===credentialRef);if(!k||!live())throw new AccountError('authorization_rejected',401);k.catalog=error?{status:'failed',ids:[],error}:{status:'ready',ids,discoveredAt:Math.floor(Date.now()/1000)};});
      return publicKey(this.state.keys.find(k=>k.credentialRef===credentialRef)!);
    }finally{if(this.discoveries.get(credentialRef)===job)this.discoveries.delete(credentialRef);}
  }
  cancelOwner(owner:string){for(const job of this.discoveries.values())if(job.owner===owner)job.controller.abort();}
  async remove(credentialRef:string){this.discoveries.get(credentialRef)?.controller.abort();await this.mutate(s=>{if(!s.keys.some(k=>k.credentialRef===credentialRef))throw new AccountError('invalid_request');s.keys=s.keys.filter(k=>k.credentialRef!==credentialRef);});}
  async close(){if(this.closed)return;this.closed=true;for(const job of this.discoveries.values())job.controller.abort();await this.tail;this.failed=true;await this.lease.close();await unlink(join(this.directory,'.lock'));}
}
/** Re-read atomic API-only snapshots per paid call. Missing/removed/mismatched refs never fall back to env. */
export async function resolveManagedApiKey(model:ModelConfig,provider:string,accountDirectory:string):Promise<string>{
  try{
    const authentication=model.authentication;if(authentication?.kind!=='api-key'||!authentication.credentialRef)throw new Error();
    const parent=resolve(accountDirectory);await safeDirectory(parent);const file=await readKeys(join(parent,'api-keys'));
    if(file.operator!==provider.toLowerCase())throw new Error();
    const key=file.keys.find(k=>k.credentialRef===authentication.credentialRef);
    if(!key||key.provider!==authentication.provider||authentication.billingSource!=='api-credits'||model.apiKeyEnv||key.baseUrl!==model.baseUrl)throw new Error();
    if(key.catalog){
      if(key.provider!=='openai'||key.catalog.status!=='ready'||!key.catalog.ids.includes(model.upstreamModel)||!openAITextCapability(model.upstreamModel).supported||model.model!=='openai/'+model.upstreamModel||model.apiKind!==2)throw new Error();
    }else if(key.model!==model.model||key.upstreamModel!==model.upstreamModel||model.apiKind!==(key.provider==='anthropic'?1:key.provider==='openai'?2:3))throw new Error();
    return key.apiKey;
  }catch{throw new ProviderError(503,'managed_api_credentials_unavailable','The selected local API credential is unavailable or does not match this provider/model.');}
}
