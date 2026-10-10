import type { Address,Hex } from 'viem';
import { ACCOUNT_SERVICE_ORIGIN,accountManagementDomain,accountManagementMessage,accountManagementTypes,type AccountChallenge,type ConnectedAccount,type ApiKeyConnection,type SaveApiKeyInput,type OAuthAttemptStatus } from '../shared/accounts.js';

/** Only an opaque local management session is held in memory. No OAuth credentials reach the browser. */
export class LocalAccountClient {
  private session?:{token:string;expiresAt:number};
  private generation=0;
  private async request<T>(path:string,body?:unknown,authenticated=true):Promise<T>{
    const generation=this.generation;
    if(authenticated&&(!this.session||this.session.expiresAt<=Date.now()/1000)){this.session=undefined;throw new Error('Unlock local accounts with the configured operator wallet.');}
    let response:Response;
    try{response=await fetch(ACCOUNT_SERVICE_ORIGIN+'/accounts/'+path,{method:body===undefined?'GET':'POST',headers:{...(body===undefined?{}:{'content-type':'application/json'}),...(authenticated?{authorization:'Bearer '+this.session!.token}:{})},body:body===undefined?undefined:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(path==='infer'?90000:30000)});}
    catch{throw new Error('Local account helper unavailable. Run npm run accounts with the configured operator wallet and frontend origin.');}
    if(generation!==this.generation)throw new Error('Account management was locked or the wallet changed.');
    if(response.status===401)this.session=undefined;
    if(!response.body)throw new Error('Empty account-helper reply.');
    const reader=response.body.getReader();let size=0;const chunks:Uint8Array[]=[];
    for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2*1024*1024){await reader.cancel();throw new Error('Account reply exceeds limits.');}chunks.push(value);}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    const result=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    if(generation!==this.generation)throw new Error('Account management was locked or the wallet changed.');
    if(!response.ok)throw new Error(typeof result.message==='string'?result.message:'Account operation rejected.');
    return result as T;
  }
  async unlock(wallet:Address,sign:(request:{domain:typeof accountManagementDomain;types:typeof accountManagementTypes;primaryType:'LocalAccountAccess';message:ReturnType<typeof accountManagementMessage>})=>Promise<Hex>){
    const generation=++this.generation;
    const info=await this.request<{operator:string|null;initializationRequired?:boolean;serviceId:string}>('info',undefined,false);
    const initializing=info.operator===null&&info.initializationRequired===true;
    if(!initializing&&info.operator?.toLowerCase()!==wallet.toLowerCase())throw new Error('Connect the wallet that owns this local account helper to manage accounts.');
    const challenge=await this.request<AccountChallenge>('challenge',initializing?{operator:wallet}:{},false);
    if(!!challenge.initializing!==initializing)throw new Error('Account initialization changed. Start the connection again.');
    if(challenge.operator.toLowerCase()!==wallet.toLowerCase()||challenge.serviceId!==info.serviceId||challenge.origin!==location.origin||!/^0x[0-9a-f]{64}$/.test(challenge.serviceId)||!/^0x[0-9a-f]{64}$/.test(challenge.challenge)||!Number.isSafeInteger(challenge.expiresAt)||challenge.expiresAt<Date.now()/1000||challenge.expiresAt>Date.now()/1000+61)throw new Error('Invalid local account challenge.');
    const signature=await sign({domain:accountManagementDomain,types:accountManagementTypes,primaryType:'LocalAccountAccess',message:accountManagementMessage(challenge)});
    const result=await this.request<{session:string;expiresAt:number}>('session',{challenge:challenge.challenge,signature},false);
    if(generation!==this.generation)throw new Error('Wallet changed while unlocking accounts. Unlock again.');
    this.session={token:result.session,expiresAt:result.expiresAt};
  }
  async lock(){const old=this.session;this.session=undefined;this.generation++;if(old)await fetch(ACCOUNT_SERVICE_ORIGIN+'/accounts/lock',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+old.token},body:'{}',redirect:'error',signal:AbortSignal.timeout(3000)}).catch(()=>{});}
  isUnlocked(){return !!this.session&&this.session.expiresAt>Date.now()/1000;}
  apiKeys(){return this.request<{credentials:ApiKeyConnection[]}>('api-keys');}
  saveApiKey(input:SaveApiKeyInput){return this.request<{credential:ApiKeyConnection}>('api-keys/save',input);}
  discoverApiKey(credentialRef:string){return this.request<{credential:ApiKeyConnection}>('api-keys/discover',{credentialRef});}
  removeApiKey(credentialRef:string){return this.request<{removed:true}>('api-keys/remove',{credentialRef});}
  status(){return this.request<{accounts:ConnectedAccount[]}>('status');}
  connect(credentialRef?:string){return this.request<{attemptId:string;authorizationUrl:string}>('connect',{provider:'openai',usage:'personal-local',privateMode:false,...(credentialRef?{credentialRef}:{})});}
  attempt(attemptId:string){return this.request<OAuthAttemptStatus>('attempt',{attemptId});}
  disconnect(credentialRef:string){return this.request<{remoteRevocationConfirmed:boolean}>('disconnect',{credentialRef});}
  models(credentialRef:string){return this.request<{models:{slug:string;displayName:string}[]}>('models',{credentialRef,usage:'personal-local',privateMode:false});}
  infer(credentialRef:string,model:string,prompt:string,maxOutputTokens:number){return this.request<{result:{text:string;inputTokens:number;outputTokens:number};marketplaceInvoice:false}>('infer',{credentialRef,model,prompt,maxOutputTokens,usage:'personal-local',privateMode:false});}
}
