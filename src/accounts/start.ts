import { isAddress,type Address } from 'viem';
import { AccountStore } from './storage.js';
import { OAuthAccountManager } from './manager.js';
import { createAccountServer } from './server.js';
import { ACCOUNT_SERVICE_ORIGIN } from '../shared/accounts.js';
import { limitedJson } from './openai.js';

export function accountOptions(env:NodeJS.ProcessEnv=process.env){
  const operator=env.ACCOUNT_OPERATOR_ADDRESS?.trim()||env.PROVIDER_ADDRESS?.trim()||undefined;
  if(operator&&(!isAddress(operator)||/^0x0{40}$/i.test(operator)))throw new Error('Invalid account management wallet.');
  return {operator:operator as Address|undefined,directory:env.ACCOUNT_STATE_DIR||'.account-state',origins:(env.ACCOUNT_ALLOWED_ORIGINS||'http://localhost:5173,http://127.0.0.1:5173,http://127.0.0.1:5174').split(',').map(v=>v.trim())};
}
/** Local startup never creates consent, transactions or upstream calls. */
export async function startAccountHelper(options=accountOptions(),port=8791){
  const store=await AccountStore.open(options.directory);
  let service:ReturnType<typeof createAccountServer>|undefined;
  try{
    service=createAccountServer(new OAuthAccountManager(store),options.operator,options.origins);await service.ready;
    const server=service.server;
    await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});});
    return service;
  }catch{if(service)await service.close().catch(()=>{});else await store.close().catch(()=>{});throw new Error('Account helper could not start. Check local port 8791, configured owner and protected state-directory permissions/lock.');}
}
/** Reuse a running helper without killing it or stealing its lock. Browser challenges still authenticate the wallet. */
export async function developmentAccountHelper(env:NodeJS.ProcessEnv=process.env){
  const options=accountOptions(env);
  for(const origin of options.origins){
    try{
      const response=await fetch(ACCOUNT_SERVICE_ORIGIN+'/accounts/info',{headers:{Origin:origin},redirect:'error',signal:AbortSignal.timeout(1000)});
      if(!response.ok)continue;
      const info=await limitedJson(response) as Record<string,unknown>;
      if(info.service!=='llm-providers-accounts'||info.version!==1||typeof info.serviceId!=='string'||!/^0x[0-9a-f]{64}$/.test(info.serviceId)||info.operator!==null&&(typeof info.operator!=='string'||!isAddress(info.operator)))throw new Error('Wrong local service');
      if(options.operator&&(typeof info.operator!=='string'||info.operator.toLowerCase()!==options.operator.toLowerCase()))throw new Error('Wrong owner');
      return {owned:false,close:async()=>{}};
    }catch{}
  }
  const service=await startAccountHelper(options);
  return {owned:true,close:()=>service.close()};
}
