import { createServer,type Server } from 'node:http';
import { randomBytes,randomUUID,createHash,timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { AccountStore,type Registration } from './storage.js';
import { OfficialOpenAI,OPENAI_OAUTH,OPENAI_SCOPES,APP_AGENT_NAME,TokenEndpointError,limitedJson } from './openai.js';
import { AccountError,OAuthFailure } from './errors.js';
import { assertAccountUsage,type ConnectedAccount,type OAuthDiagnostic } from '../shared/accounts.js';
import { callOAuthResponses } from './responses.js';

const random=()=>randomBytes(32).toString('base64url');
const tokenResponse=z.object({access_token:z.string().min(1).max(32000),refresh_token:z.string().min(1).max(32000),id_token:z.string().min(1).max(32000).optional(),token_type:z.string().regex(/^Bearer$/i),expires_in:z.number().int().min(1).max(86400),scope:z.string().max(4096).optional(),earliest_refresh_at:z.number().int().nonnegative().optional()}).passthrough();
type Attempt={id:string;owner:string;redirect:string;state:string;nonce:string;verifier:string;expiresAt:number;expected?:Registration;server:Server;timer:ReturnType<typeof setTimeout>;consumed:boolean};
const exactState=(a:string,b:string)=>a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
export class OAuthAccountManager {
  private attempts=new Map<string,Attempt>();
  private outcomes=new Map<string,{owner:string;status:'pending'|'connected'|'rejected';expiresAt:number;diagnostic?:OAuthDiagnostic}>();
  private locks=new Map<string,Promise<unknown>>();
  private requests=new Map<string,AbortController>();
  private listeners=new Set<Server>();
  constructor(readonly store:AccountStore,readonly upstream=new OfficialOpenAI(),private readonly now:()=>number=()=>Math.floor(Date.now()/1000)){}
  private registration(ref:string){const a=this.store.snapshot().accounts.find(a=>a.credentialRef===ref);if(!a)throw new AccountError('invalid_request');return a;}
  private serial<T>(ref:string,task:()=>Promise<T>):Promise<T>{
    const running=(this.locks.get(ref)??Promise.resolve()).catch(()=>{}).then(task);this.locks.set(ref,running);
    void running.finally(()=>{if(this.locks.get(ref)===running)this.locks.delete(ref);}).catch(()=>{});return running;
  }
  list():ConnectedAccount[]{return this.store.snapshot().accounts.map(a=>{
    const email=a.email?.split('@');const label=email&&email.length===2?`${email[0].slice(0,1)}•••@${email[1].slice(0,1)}•••`:`Account …${a.subject.slice(-6)}`;
    return {credentialRef:a.credentialRef,provider:'openai',kind:'chatgpt-oauth',billingSource:'chatgpt-plan',usage:'personal-local',accountLabel:label,workspaceLabel:`Workspace registration …${a.clientId.slice(-6)}`,status:a.status==='connected'&&a.tokens&&a.tokens.expiresAt<=this.now()?'expired':a.status,expiresAt:a.tokens?.expiresAt,retryAt:a.retryAt,remoteRevocationConfirmed:a.remoteRevocationConfirmed};
  });}
  async begin(owner:string,sessionExpiresAt:number,ref?:string):Promise<{attemptId:string;authorizationUrl:string}>{
    for(const [id,o]of this.outcomes)if(o.expiresAt<=this.now())this.outcomes.delete(id);
    if(this.attempts.size>=8||this.store.snapshot().accounts.length>=32&&!ref||[...this.attempts.values()].some(a=>a.owner===owner))throw new AccountError('invalid_request');
    const expected=ref?this.registration(ref):undefined;
    const id=randomUUID(),state=random(),nonce=random(),verifier=random();
    const expiresAt=Math.min(this.now()+300,sessionExpiresAt);
    if(expiresAt<=this.now())throw new AccountError('authorization_rejected',401);
    const server=createServer(async(req,res)=>{
      res.setHeader('cache-control','no-store');res.setHeader('referrer-policy','no-referrer');res.setHeader('x-content-type-options','nosniff');
      res.setHeader('content-security-policy',"default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
      const attempt=this.attempts.get(id);const address=server.address();const port=address&&typeof address!=='string'?address.port:0;
      if(req.headers.host!==`127.0.0.1:${port}`||req.method!=='GET'){res.writeHead(403);res.end('OAuth callback rejected.');return;}
      const url=new URL(req.url??'/',`http://127.0.0.1:${port}`);
      if(url.pathname==='/auth/complete'){res.writeHead(200,{'content-type':'text/plain; charset=utf-8'});res.end('Return to LLM Providers to check your account connection.');return;}
      if(url.pathname==='/auth/rejected'){const diagnostic=this.outcomes.get(id)?.diagnostic;res.writeHead(200,{'content-type':'text/plain; charset=utf-8'});res.end('OAuth connection rejected. '+(diagnostic?`Diagnostic: ${diagnostic.stage}/${diagnostic.reason}. `:'')+'Return to LLM Providers. No authorization code or token needs to be copied.');return;}
      if(!attempt||url.pathname!=='/auth/callback'){res.writeHead(404);res.end('OAuth callback unavailable.');return;}
      try{await this.finish(id,url.toString());res.writeHead(303,{location:'/auth/complete'});res.end();}
      catch{res.writeHead(303,{location:'/auth/rejected'});res.end();}
    });
    await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>resolve());});
    this.listeners.add(server);server.once('close',()=>this.listeners.delete(server));server.unref();
    server.requestTimeout=20000;server.headersTimeout=5000;server.maxHeadersCount=32;
    const address=server.address() as {port:number};const redirect=`http://127.0.0.1:${address.port}/auth/callback`;
    const timer=setTimeout(()=>this.cancel(id,'attempt_expired'),Math.max(1,expiresAt-this.now())*1000);timer.unref();
    this.attempts.set(id,{id,owner,redirect,state,nonce,verifier,expiresAt,expected,server,timer,consumed:false});
    this.outcomes.set(id,{owner,status:'pending',expiresAt:this.now()+600});
    const url=new URL(OPENAI_OAUTH.authorize);
    for(const [k,v]of Object.entries({client_id:expected?.clientId??'dynamic_agent_client',ext_agent_host_id:'urn:uuid:'+this.store.snapshot().hostId,response_type:'code',redirect_uri:redirect,scope:OPENAI_SCOPES.join(' '),resource:OPENAI_OAUTH.resource,state,nonce,code_challenge_method:'S256',code_challenge:createHash('sha256').update(verifier).digest('base64url'),...(expected?{}:{agent_name_hint:APP_AGENT_NAME})}))url.searchParams.set(k,v);
    // No ID-token or email hints are returned to the UI. Returning registration still uses its issued client ID.
    return {attemptId:id,authorizationUrl:url.toString()};
  }
  outcome(owner:string,id:string){const value=this.outcomes.get(id);if(!value||value.owner!==owner||value.expiresAt<=this.now())throw new AccountError('invalid_request');return {status:value.status,...(value.diagnostic?{diagnostic:{...value.diagnostic}}:{})};}
  cancel(id:string,reason:'attempt_expired'|'attempt_cancelled'='attempt_cancelled'){const a=this.attempts.get(id);if(!a)return;clearTimeout(a.timer);a.server.close();this.attempts.delete(id);const outcome=this.outcomes.get(id);if(outcome){outcome.status='rejected';outcome.diagnostic={stage:'lifecycle',reason};}}
  cancelOwner(owner:string){for(const a of this.attempts.values())if(a.owner===owner)this.cancel(a.id);}
  /** Invoked only by the bound loopback callback listener. Not a public token-import API. */
  async finish(id:string,callback:string):Promise<void>{
    const a=this.attempts.get(id);if(!a||a.consumed)throw new AccountError('authorization_rejected');
    if(a.expiresAt<=this.now()){this.cancel(id,'attempt_expired');throw new OAuthFailure({stage:'lifecycle',reason:'attempt_expired'});}
    let stage:OAuthDiagnostic['stage']='callback';
    function reject(reason:OAuthDiagnostic['reason']):never{throw new OAuthFailure({stage,reason});}
    try{
      const url=new URL(callback);if(url.origin+url.pathname!==a.redirect||url.hash||url.username||url.password||url.toString().length>16000)reject('redirect_mismatch');
      if(!exactState(url.searchParams.get('state')??'',a.state))reject('state_mismatch');
      for(const key of url.searchParams.keys())if(!['state','code','client_id','scope','iss','error','error_description','error_uri'].includes(key)||url.searchParams.getAll(key).length!==1)reject('callback_parameters');
      // Callback scope is informational only; token-response scopes remain authoritative.
      if((url.searchParams.get('scope')?.length??0)>4096)reject('callback_parameters');
      a.consumed=true;clearTimeout(a.timer);
      if(url.searchParams.has('error'))reject('consent_denied');
      if(url.searchParams.has('iss')&&url.searchParams.get('iss')!==OPENAI_OAUTH.issuer)reject('issuer_mismatch');
      const clientId=url.searchParams.get('client_id')??a.expected?.clientId;
      if(!clientId||!/^oaiapp_[a-zA-Z0-9_-]{1,200}$/.test(clientId)||a.expected&&clientId!==a.expected.clientId||!a.expected&&this.store.snapshot().accounts.some(account=>account.clientId===clientId))reject('client_mismatch');
      const code=url.searchParams.get('code');if(!code||code.length>4096)reject('missing_code');
      stage='exchange';
      const body=await this.upstream.token({grant_type:'authorization_code',client_id:clientId,code,code_verifier:a.verifier,redirect_uri:a.redirect});
      stage='identity';
      if(typeof body.id_token!=='string')reject('missing_id_token');
      const identity=await this.upstream.verifyIdentity(body.id_token,clientId,a.nonce,this.now());
      if(a.expected&&identity.sub!==a.expected.subject)reject('identity_subject');
      const scopes=typeof body.scope==='string'?body.scope.split(/\s+/).filter(Boolean):[];
      const enabled=OPENAI_SCOPES.every(scope=>scopes.includes(scope));
      stage='token_schema';const parsed=enabled?tokenResponse.parse(body):undefined;
      if(parsed&&!parsed.id_token)reject('missing_id_token');
      const account:Registration={credentialRef:a.expected?.credentialRef??randomUUID(),provider:'openai',clientId,subject:identity.sub!,email:typeof identity.email==='string'&&identity.email.length<=320?identity.email:undefined,status:enabled?'connected':'permission_required',revision:(a.expected?.revision??-1)+1,...(parsed?{tokens:{accessToken:parsed.access_token,refreshToken:parsed.refresh_token,idToken:parsed.id_token!,scopes,expiresAt:this.now()+parsed.expires_in,earliestRefreshAt:parsed.earliest_refresh_at??0,nonce:a.nonce}}:{})};
      stage='lifecycle';if(this.attempts.get(id)!==a||a.expiresAt<=this.now())reject(a.expiresAt<=this.now()?'attempt_expired':'attempt_cancelled');
      stage='storage';
      await this.serial(account.credentialRef,()=>this.store.update(s=>{
        if(this.attempts.get(id)!==a||a.expiresAt<=this.now())throw new OAuthFailure({stage:'lifecycle',reason:a.expiresAt<=this.now()?'attempt_expired':'attempt_cancelled'});
        const index=s.accounts.findIndex(existing=>existing.credentialRef===account.credentialRef);
        if(a.expected){if(index<0||s.accounts[index].revision!==a.expected.revision)throw new AccountError('authorization_rejected');s.accounts[index]=account;}
        else{if(s.accounts.some(existing=>existing.clientId===clientId))throw new AccountError('authorization_rejected');s.accounts.push(account);}
      }));
      this.outcomes.get(id)!.status='connected';delete this.outcomes.get(id)!.diagnostic;
    }catch(error){
      const diagnostic:OAuthDiagnostic=error instanceof OAuthFailure?error.diagnostic:error instanceof TokenEndpointError?{stage:'exchange',reason:error.oauthReason}:{stage,reason:stage==='storage'?'storage_unavailable':stage==='token_schema'?'invalid_token_response':stage==='identity'?'identity_invalid':stage==='exchange'?'exchange_unavailable':'callback_parameters'};
      const outcome=this.outcomes.get(id);if(outcome){if(a.consumed)outcome.status='rejected';outcome.diagnostic=diagnostic;}
      throw new OAuthFailure(diagnostic);
    }
    finally{if(a.consumed){this.attempts.delete(id);setTimeout(()=>a.server.close(),10000).unref();}}
  }
  private async accessToken(ref:string):Promise<string>{return this.serial(ref,async()=>{
    let a=this.registration(ref);
    if(a.status==='permission_required')throw new AccountError('permission_required',403);
    if(!a.tokens||a.status==='reconnect_required'||a.status==='signed_out')throw new AccountError('reconnect_required',401);
    if(a.retryAt&&a.retryAt>this.now())throw new AccountError(a.status==='quota_limited'?'quota_limited':a.status==='rate_limited'?'rate_limited':'unavailable',503);
    if(a.tokens.expiresAt>this.now()+60)return a.tokens.accessToken;
    if(a.tokens.earliestRefreshAt>this.now())throw new AccountError('unavailable',503);
    const old=a.tokens;
    await this.store.changeAccount(ref,account=>{account.status='refreshing';});
    try{
      const body=await this.upstream.token({grant_type:'refresh_token',client_id:a.clientId,refresh_token:old.refreshToken});
      const parsed=tokenResponse.parse(body);
      const scopes=parsed.scope===undefined?old.scopes:parsed.scope.split(/\s+/).filter(Boolean);
      if(!OPENAI_SCOPES.every(scope=>scopes.includes(scope)))throw new TokenEndpointError(true);
      if(parsed.id_token){const identity=await this.upstream.verifyIdentity(parsed.id_token,a.clientId,undefined,this.now());if(identity.sub!==a.subject||identity.nonce!==undefined&&identity.nonce!==old.nonce)throw new TokenEndpointError(true);}
      if(parsed.refresh_token===old.refreshToken)throw new TokenEndpointError(true);
      await this.store.changeAccount(ref,account=>{account.tokens={...old,accessToken:parsed.access_token,refreshToken:parsed.refresh_token,idToken:parsed.id_token??old.idToken,scopes,expiresAt:this.now()+parsed.expires_in,earliestRefreshAt:parsed.earliest_refresh_at??0};account.status='connected';delete account.retryAt;delete account.remoteRevocationConfirmed;});
      return parsed.access_token;
    }catch(error){
      const terminal=!(error instanceof TokenEndpointError)||error.terminal;
      await this.store.changeAccount(ref,account=>{if(terminal){delete account.tokens;account.status='reconnect_required';}else{account.status='unavailable';account.retryAt=this.now()+5;}});
      throw new AccountError(terminal?'reconnect_required':'unavailable',503);
    }
  });}
  async disconnect(ref:string):Promise<{remoteRevocationConfirmed:boolean}>{
    this.requests.get(ref)?.abort();for(const a of this.attempts.values())if(a.expected?.credentialRef===ref)this.cancel(a.id);
    return this.serial(ref,async()=>{
      const account=this.registration(ref);
      // Persist the unknown-remote-result marker before revocation, also safe across process crashes.
      await this.store.changeAccount(ref,a=>{a.status='refreshing';});
      const confirmed=account.tokens?await this.upstream.revoke(account.tokens.refreshToken,account.clientId):account.remoteRevocationConfirmed??false;
      await this.store.changeAccount(ref,a=>{delete a.tokens;delete a.retryAt;a.status='signed_out';a.remoteRevocationConfirmed=confirmed;});
      return {remoteRevocationConfirmed:confirmed};
    });
  }
  private checkUse(usage:'personal-local'|'marketplace',privateMode:boolean){try{assertAccountUsage(usage,privateMode);}catch{throw new AccountError(privateMode?'private_oauth_unavailable':'marketplace_oauth_unavailable',403);}}
  async models(ref:string,usage:'personal-local'|'marketplace'='personal-local',privateMode=false):Promise<{slug:string;displayName:string}[]>{
    this.checkUse(usage,privateMode);const access=await this.accessToken(ref);
    try{
      const response=await this.upstream.fetch(OPENAI_OAUTH.resource+'/models',{headers:{authorization:`Bearer ${access}`},signal:AbortSignal.timeout(15000)});
      if(!response.ok){await response.body?.cancel();await this.markFailure(ref,response.status);throw new AccountError(response.status===429?'rate_limited':response.status===403?'restricted':'unavailable',response.status);}
      const body=z.object({models:z.array(z.object({slug:z.string().min(1).max(128),display_name:z.string().min(1).max(256),visibility:z.string()})).max(1000)}).parse(await limitedJson(response));
      return body.models.filter(m=>m.visibility==='list').map(m=>({slug:m.slug,displayName:m.display_name}));
    }catch(error){if(error instanceof AccountError)throw error;throw new AccountError('unavailable',503);}
  }
  async infer(ref:string,model:string,prompt:string,maxOutputTokens:number,usage:'personal-local'|'marketplace'='personal-local',privateMode=false){
    this.checkUse(usage,privateMode);
    if(!prompt.trim()||Buffer.byteLength(prompt)>32000||!Number.isSafeInteger(maxOutputTokens)||maxOutputTokens<1||maxOutputTokens>8192||this.requests.has(ref))throw new AccountError('invalid_request');
    const controller=new AbortController();this.requests.set(ref,controller);
    try{
      const models=await this.models(ref);if(!models.some(m=>m.slug===model))throw new AccountError('restricted',403);
      const access=await this.accessToken(ref);if(controller.signal.aborted)throw new AccountError('unavailable',503);
      const result=await callOAuthResponses(this.upstream,access,model,prompt,maxOutputTokens,controller.signal);
      if(controller.signal.aborted)throw new AccountError('unavailable',503);
      await this.store.changeAccount(ref,a=>{if(a.tokens){a.status='connected';delete a.retryAt;}});
      if(controller.signal.aborted)throw new AccountError('unavailable',503);
      return result; // Personal result only. No marketplace invoice or MON settlement is fabricated.
    }catch(error){if(error instanceof AccountError){await this.markFailure(ref,error.status,error.code);throw error;}throw new AccountError('unavailable',503);}
    finally{this.requests.delete(ref);}
  }
  private async markFailure(ref:string,status:number,code?:string){
    await this.store.changeAccount(ref,a=>{
      if(!a.tokens)return;
      // A bare 401 is not proof of revocation; keep tokens, pause and ask for diagnostics/reconsent.
      a.status=code==='quota_limited'?'quota_limited':status===429?'rate_limited':status===403?'restricted':'unavailable';
      a.retryAt=this.now()+(code==='quota_limited'?60:5);
    });
  }
  async close(){for(const a of this.attempts.values())this.cancel(a.id);for(const server of this.listeners){server.closeAllConnections();server.close();}for(const c of this.requests.values())c.abort();await Promise.allSettled([...this.locks.values()]);await this.store.close();}
}
