import { createRemoteJWKSet,customFetch,jwtVerify,errors,type JWTPayload } from 'jose';
import { AccountError,OAuthFailure } from './errors.js';

export const OPENAI_OAUTH={issuer:'https://auth.openai.com',authorize:'https://auth.openai.com/api/accounts/authorize',token:'https://auth.openai.com/api/accounts/oauth/token',jwks:'https://auth.openai.com/.well-known/jwks.json',discovery:'https://auth.openai.com/.well-known/openid-configuration',revoke:'https://auth.openai.com/api/accounts/oauth/revoke',resource:'https://api.openai.com/v1'} as const;
export const OPENAI_SCOPES=['openid','profile','email','offline_access','resource.invoke','chatgpt.tokens.use.direct'] as const;
export const APP_AGENT_NAME='LLM Providers Personal';
const fatalRefresh=new Set(['invalid_grant','invalid_refresh_token','token_expired','refresh_token_expired','refresh_token_invalidated','refresh_token_reused']);
export class TokenEndpointError extends AccountError {
  constructor(readonly terminal:boolean,readonly ambiguous=false,readonly oauthReason:'exchange_invalid_grant'|'exchange_rejected'|'exchange_unavailable'='exchange_unavailable'){super(terminal?'reconnect_required':'unavailable',503);}
}
export async function limitedJson(response:Response,limit=262144):Promise<unknown>{
  if(!response.body)throw new AccountError('unavailable',503);
  const reader=response.body.getReader();let total=0;const chunks:Uint8Array[]=[];
  try{for(;;){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>limit){await reader.cancel();throw new AccountError('unavailable',503);}chunks.push(value);}}
  finally{reader.releaseLock();}
  const bytes=new Uint8Array(total);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new AccountError('unavailable',503);}
}
/** URLs and public-client identity are fixed by official discovery, never supplied by a peer or env flag. */
export class OfficialOpenAI {
  private jwks;
  constructor(private readonly network:typeof fetch=fetch){
    this.jwks=createRemoteJWKSet(new URL(OPENAI_OAUTH.jwks),{[customFetch]:async(url,options)=>{
      if(String(url)!==OPENAI_OAUTH.jwks)throw new AccountError('authorization_rejected');
      let response:Response;
      try{response=await this.network(url,{...options,redirect:'error',signal:AbortSignal.timeout(15000)});}catch{throw new OAuthFailure({stage:'identity',reason:'jwks_unavailable'});}
      if(response.status!==200){await response.body?.cancel();throw new OAuthFailure({stage:'identity',reason:'jwks_unavailable'});}
      try{return Response.json(await limitedJson(response));}catch{throw new OAuthFailure({stage:'identity',reason:'jwks_invalid'});}
    }});
  }
  async verifyIdentity(idToken:string,clientId:string,nonce:string|undefined,now:number):Promise<JWTPayload>{
    try{
      if(idToken.length>32000)throw new Error('Limit');
      const {payload}=await jwtVerify(idToken,this.jwks,{algorithms:['RS256'],issuer:OPENAI_OAUTH.issuer,audience:clientId,requiredClaims:['sub','iat','exp'],clockTolerance:5,currentDate:new Date(now*1000)});
      if(typeof payload.sub!=='string'||!payload.sub||payload.sub.length>256)throw new OAuthFailure({stage:'identity',reason:'identity_subject'});
      if(!Number.isSafeInteger(payload.iat)||payload.iat!>now+5)throw new OAuthFailure({stage:'identity',reason:'identity_time'});
      if(nonce!==undefined&&payload.nonce!==nonce)throw new OAuthFailure({stage:'identity',reason:'identity_nonce'});
      if(Array.isArray(payload.aud)&&payload.aud.length>1&&payload.azp!==clientId||payload.azp!==undefined&&payload.azp!==clientId)throw new OAuthFailure({stage:'identity',reason:'identity_audience'});
      return payload;
    }catch(error){
      if(error instanceof OAuthFailure)throw error;
      const reason=error instanceof errors.JWTExpired?'identity_time':error instanceof errors.JOSEAlgNotAllowed?'identity_algorithm':error instanceof errors.JWSSignatureVerificationFailed?'identity_signature':error instanceof errors.JWKSNoMatchingKey?'identity_key':error instanceof errors.JWTClaimValidationFailed?error.claim==='iss'?'identity_issuer':error.claim==='aud'?'identity_audience':['exp','iat','nbf'].includes(error.claim)?'identity_time':'identity_invalid':'identity_invalid';
      throw new OAuthFailure({stage:'identity',reason});
    }
  }
  async token(values:Record<string,string>):Promise<Record<string,unknown>>{
    let response:Response;
    try{response=await this.network(OPENAI_OAUTH.token,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({...values,resource:OPENAI_OAUTH.resource}),redirect:'error',signal:AbortSignal.timeout(15000)});}
    catch{throw new TokenEndpointError(true,true);} // Rotation may have happened before transport loss.
    let body:unknown;
    try{body=await limitedJson(response);}catch{throw new TokenEndpointError(response.ok);}
    if(!response.ok){const code=(body as {error?:unknown})?.error;throw new TokenEndpointError(typeof code==='string'&&fatalRefresh.has(code),false,code==='invalid_grant'?'exchange_invalid_grant':response.status>=500?'exchange_unavailable':'exchange_rejected');}
    if(response.status!==200||!body||typeof body!=='object'||Array.isArray(body))throw new TokenEndpointError(true);
    return body as Record<string,unknown>;
  }
  async revoke(refreshToken:string,clientId:string):Promise<boolean>{
    try{
      const discovery=await this.network(OPENAI_OAUTH.discovery,{redirect:'error',signal:AbortSignal.timeout(10000)});
      if(!discovery.ok)return false;
      const doc=await limitedJson(discovery) as Record<string,unknown>;
      if(doc.issuer!==OPENAI_OAUTH.issuer||doc.revocation_endpoint!==OPENAI_OAUTH.revoke)return false;
      for(let attempt=0;attempt<2;attempt++){
        const result=await this.network(OPENAI_OAUTH.revoke,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:refreshToken,token_type_hint:'refresh_token',client_id:clientId}),redirect:'error',signal:AbortSignal.timeout(10000)});
        await result.body?.cancel();if(result.status===200)return true;if(result.status<500)return false;
        if(attempt===0)await new Promise(resolve=>setTimeout(resolve,250));
      }
    }catch{}return false;
  }
  fetch(url:string,init:RequestInit){if(![OPENAI_OAUTH.resource+'/models',OPENAI_OAUTH.resource+'/responses'].includes(url))throw new AccountError('invalid_request');return this.network(url,{...init,redirect:'error'});}
}
