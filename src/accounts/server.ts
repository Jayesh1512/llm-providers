import { createServer,type IncomingMessage } from 'node:http';
import { randomBytes } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { isAddress,verifyTypedData,type Address,type Hex } from 'viem';
import { z } from 'zod';
import { AccountError,safeAccountError } from './errors.js';
import { OAuthAccountManager } from './manager.js';
import { ApiKeyStore,saveApiKeySchema } from './api-keys.js';
import { accountManagementDomain,accountManagementMessage,accountManagementTypes,assertAccountUsage,CLAUDE_OAUTH_UNAVAILABLE,MARKETPLACE_OAUTH_UNAVAILABLE,PRIVATE_OAUTH_UNAVAILABLE,type AccountChallenge } from '../shared/accounts.js';

const ref=z.string().uuid();
const useSchema=z.object({credentialRef:ref,usage:z.enum(['personal-local','marketplace']),privateMode:z.boolean()});
async function body(request:IncomingMessage):Promise<unknown>{
  if(request.headers['content-type']!=='application/json')throw new AccountError('invalid_request',415);
  let size=0;const chunks:Buffer[]=[];for await(const chunk of request){size+=chunk.length;if(size>65536)throw new AccountError('invalid_request',413);chunks.push(Buffer.from(chunk));}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new AccountError('invalid_request');}
}
type LocalSession={origin:string;expiresAt:number};
/** Local personal account control plane. Never mounted on supplier inference endpoints. */
export function createAccountServer(manager:OAuthAccountManager,operator:Address|undefined,allowedOrigins:string[],options:{catalogFetch?:typeof fetch}={}){
  if(operator&&(!isAddress(operator)||/^0x0{40}$/i.test(operator))||!allowedOrigins.length)throw new AccountError('invalid_request');
  for(const origin of allowedOrigins){const url=new URL(origin);if(url.origin!==origin||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||!['http:','https:'].includes(url.protocol))throw new AccountError('invalid_request');}
  const now=()=>Math.floor(Date.now()/1000);
  const owner=()=>manager.store.snapshot().operator as Address|undefined;
  let keyStore:Promise<ApiKeyStore>|undefined;
  const getKeys=()=>{
    const address=owner();if(!address)throw new AccountError('authorization_rejected',401);
    return keyStore??=ApiKeyStore.open(manager.store.directory,address,options.catalogFetch);
  };
  const ready=(async()=>{
    if(operator)await manager.store.bindOperator(operator);
    if(owner())return getKeys();
    // A legacy/unowned credential directory must never be claimable by the first visitor.
    if(manager.store.snapshot().accounts.length)throw new AccountError('storage_unavailable',503);
    try{await lstat(join(manager.store.directory,'api-keys'));throw new AccountError('storage_unavailable',503);}
    catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    return undefined;
  })();
  void ready.catch(()=>{}); // Requests/startup await this boundary and fail closed on a wrong persisted owner.
  const challenges=new Map<string,AccountChallenge>(),sessions=new Map<string,LocalSession>();
  const server=createServer(async(request,response)=>{
    const send=(status:number,data:unknown)=>{response.writeHead(status,{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'});response.end(JSON.stringify(data));};
    try{
      await ready;
      const address=server.address();const port=address&&typeof address!=='string'?address.port:0;
      if(request.headers.host!==`127.0.0.1:${port}`)throw new AccountError('authorization_rejected',403);
      const origin=request.headers.origin;if(!origin||!allowedOrigins.includes(origin))throw new AccountError('authorization_rejected',403);
      response.setHeader('access-control-allow-origin',origin);response.setHeader('vary','Origin');
      if(request.method==='OPTIONS'){response.setHeader('access-control-allow-methods','GET,POST,OPTIONS');response.setHeader('access-control-allow-headers','Content-Type,Authorization');response.writeHead(204);response.end();return;}
      const url=new URL(request.url??'/',`http://127.0.0.1:${port}`);if(url.search||url.hash)throw new AccountError('invalid_request');
      for(const [id,c]of challenges)if(c.expiresAt<=now())challenges.delete(id);
      for(const [token,s]of sessions)if(s.expiresAt<=now()){sessions.delete(token);manager.cancelOwner(token);void keyStore?.then(keys=>keys.cancelOwner(token));}
      if(request.method==='GET'&&url.pathname==='/accounts/info'){
        send(200,{service:'llm-providers-accounts',version:1,runtime:'catalog-oidc-diagnostics-20261010-1',apiKeyCatalog:'openai-models-v1',oauthDiagnostics:'stages-v1',operator:owner()??null,initializationRequired:!owner(),serviceId:manager.store.snapshot().serviceId,chatgpt:'personal-local',claudeOAuth:{available:false,reason:CLAUDE_OAUTH_UNAVAILABLE},marketplaceOAuth:{available:false,reason:MARKETPLACE_OAUTH_UNAVAILABLE},privateOAuth:{available:false,reason:PRIVATE_OAUTH_UNAVAILABLE}});return;
      }
      if(request.method==='POST'&&url.pathname==='/accounts/challenge'){
        const input=z.object({operator:z.string().refine(v=>isAddress(v)&&!/^0x0{40}$/i.test(v)).optional()}).strict().parse(await body(request));if(challenges.size>=32)throw new AccountError('authorization_rejected',429);
        const address=owner()??input.operator as Address|undefined;
        if(!address||input.operator&&input.operator.toLowerCase()!==address.toLowerCase())throw new AccountError('authorization_rejected',403);
        const challenge=('0x'+randomBytes(32).toString('hex')) as Hex;
        const value:AccountChallenge={serviceId:manager.store.snapshot().serviceId as Hex,origin,challenge,expiresAt:now()+60,operator:address,...(!owner()?{initializing:true}:{})};challenges.set(challenge,value);send(200,value);return;
      }
      if(request.method==='POST'&&url.pathname==='/accounts/session'){
        const value=z.object({challenge:z.string(),signature:z.string().regex(/^0x[0-9a-fA-F]{130}$/)}).strict().parse(await body(request));
        const pending=challenges.get(value.challenge);challenges.delete(value.challenge);
        if(!pending||pending.origin!==origin||pending.expiresAt<=now()||owner()&&owner()!.toLowerCase()!==pending.operator.toLowerCase()||!await verifyTypedData({address:pending.operator,domain:accountManagementDomain,types:accountManagementTypes,primaryType:'LocalAccountAccess',message:accountManagementMessage(pending),signature:value.signature as Hex})||sessions.size>=32)throw new AccountError('authorization_rejected',401);
        if(!owner()&&!pending.initializing)throw new AccountError('authorization_rejected',401);
        // Recheck atomically after async verification: concurrent initialization cannot grant another owner's session.
        await manager.store.bindOperator(pending.operator);
        await getKeys();
        const token=randomBytes(32).toString('base64url'),expiresAt=now()+600;sessions.set(token,{origin,expiresAt});send(200,{session:token,expiresAt});return;
      }
      const token=request.headers.authorization?.replace(/^Bearer /,'')??'',session=sessions.get(token);
      if(!session||session.origin!==origin||session.expiresAt<=now())throw new AccountError('authorization_rejected',401);
      const keys=await getKeys();
      if(request.method==='GET'&&url.pathname==='/accounts/status'){send(200,{accounts:manager.list()});return;}
      if(request.method==='GET'&&url.pathname==='/accounts/api-keys'){send(200,{credentials:keys.list()});return;}
      if(request.method!=='POST')throw new AccountError('invalid_request',404);
      const value=await body(request);
      const active=()=>sessions.get(token)===session&&session.expiresAt>now()&&server.listening;
      if(url.pathname==='/accounts/api-keys/save'){
        const input=saveApiKeySchema.parse(value),saved=await keys.save(input);
        send(200,{credential:input.discoverModels?await keys.discover(saved.credentialRef,token,active):saved});return;
      }
      if(url.pathname==='/accounts/api-keys/discover'){const input=z.object({credentialRef:ref}).strict().parse(value);send(200,{credential:await keys.discover(input.credentialRef,token,active)});return;}
      if(url.pathname==='/accounts/api-keys/remove'){const input=z.object({credentialRef:ref}).strict().parse(value);await keys.remove(input.credentialRef);send(200,{removed:true});return;}
      if(url.pathname==='/accounts/lock'){z.object({}).strict().parse(value);sessions.delete(token);manager.cancelOwner(token);keys.cancelOwner(token);send(200,{locked:true});return;}
      if(url.pathname==='/accounts/connect'){
        const input=z.object({provider:z.enum(['openai','anthropic']),credentialRef:ref.optional(),usage:z.enum(['personal-local','marketplace']),privateMode:z.boolean()}).strict().parse(value);
        try{assertAccountUsage(input.usage,input.privateMode);}catch{throw new AccountError(input.privateMode?'private_oauth_unavailable':'marketplace_oauth_unavailable',403);}
        if(input.provider!=='openai')throw new AccountError('oauth_unavailable',503);
        send(200,await manager.begin(token,session.expiresAt,input.credentialRef));return;
      }
      if(url.pathname==='/accounts/attempt'){const input=z.object({attemptId:ref}).strict().parse(value);send(200,manager.outcome(token,input.attemptId));return;}
      if(url.pathname==='/accounts/disconnect'){const input=z.object({credentialRef:ref}).strict().parse(value);send(200,await manager.disconnect(input.credentialRef));return;}
      if(url.pathname==='/accounts/models'){const input=useSchema.strict().parse(value);send(200,{models:await manager.models(input.credentialRef,input.usage,input.privateMode)});return;}
      if(url.pathname==='/accounts/infer'){
        const input=useSchema.extend({model:z.string().min(1).max(128),prompt:z.string().min(1).max(32000),maxOutputTokens:z.number().int().min(1).max(8192)}).strict().parse(value);
        send(200,{result:await manager.infer(input.credentialRef,input.model,input.prompt,input.maxOutputTokens,input.usage,input.privateMode),billingSource:'chatgpt-plan',marketplaceInvoice:false,privacy:'ordinary-local-host'});return;
      }
      throw new AccountError('invalid_request',404);
    }catch(error){const safe=safeAccountError(error instanceof z.ZodError?new AccountError('invalid_request'):error);if(!response.headersSent)send(safe.status,safe.body);else response.end();}
  });
  server.requestTimeout=120000;server.headersTimeout=10000;server.maxHeadersCount=32;
  return {server,ready,async close(){for(const token of sessions.keys()){manager.cancelOwner(token);void keyStore?.then(keys=>keys.cancelOwner(token));}sessions.clear();server.closeAllConnections();if(server.listening)await new Promise<void>(resolve=>server.close(()=>resolve()));await ready.catch(()=>{});await keyStore?.then(keys=>keys.close()).catch(()=>{});await manager.close();}};
}
