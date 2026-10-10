import test,{type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,chmod,realpath,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {privateKeyToAccount} from 'viem/accounts';
import {AccountStore} from '../src/accounts/storage.js';
import {OAuthAccountManager} from '../src/accounts/manager.js';
import {OfficialOpenAI} from '../src/accounts/openai.js';
import {ApiKeyStore,resolveManagedApiKey} from '../src/accounts/api-keys.js';
import {createAccountServer} from '../src/accounts/server.js';
import {accountManagementDomain,accountManagementMessage,accountManagementTypes,type AccountChallenge,type ApiKeyConnection} from '../src/shared/accounts.js';
import {callPaidApi} from '../src/provider/adapters.js';
import {openAITextCapability} from '../src/accounts/openai-catalog.js';
import {LocalAccountClient} from '../src/web/account-client.js';

// Local credentials, wallet and metadata fixtures only. No real account, inference or spend.
const secret='sk-LOCAL-CATALOG-FIXTURE-SECRET';
const origin='http://127.0.0.1:5173';
const operator=privateKeyToAccount(('0x'+'72'.repeat(32)) as `0x${string}`);
const saveInput={provider:'openai',baseUrl:'https://api.openai.com',apiKey:secret,discoverModels:true} as const;
const metadata=(ids:string[])=>Response.json({object:'list',data:ids.map(id=>({id,object:'model',created:123,owned_by:'local-fixture'}))});

async function fixture(t:TestContext){
  const directory=await realpath(await mkdtemp(join(tmpdir(),'llm-catalog-fixture-')));await chmod(directory,0o700);
  const state={calls:0,reply:async(_signal:AbortSignal)=>metadata(['gpt-4.1','gpt-5.4-pro','gpt-4.1-2025-04-14'])};
  const catalogFetch:typeof fetch=async(url,init)=>{
    state.calls++;assert.equal(String(url),'https://api.openai.com/v1/models');assert.equal(init?.method,'GET');assert.equal(init?.redirect,'error');assert.equal(init?.body,undefined);
    assert.equal(new Headers(init?.headers).get('authorization'),'Bearer '+secret);assert.ok(init?.signal);return state.reply(init.signal);
  };
  const store=await AccountStore.open(directory),manager=new OAuthAccountManager(store,new OfficialOpenAI(async()=>{throw new Error('OAuth must not be used');}));
  const service=createAccountServer(manager,operator.address,[origin],{catalogFetch});await service.ready;
  await new Promise<void>(resolve=>service.server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await service.close();await rm(directory,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${(service.server.address() as {port:number}).port}/accounts/`;
  const request=(path:string,value?:unknown,token?:string)=>fetch(base+path,{method:value===undefined?'GET':'POST',headers:{Origin:origin,...(value===undefined?{}:{'content-type':'application/json'}),...(token?{authorization:'Bearer '+token}:{})},body:value===undefined?undefined:JSON.stringify(value)});
  const unlock=async()=>{
    const challenge:AccountChallenge=await(await request('challenge',{})).json();
    const signature=await operator.signTypedData({domain:accountManagementDomain,types:accountManagementTypes,primaryType:'LocalAccountAccess',message:accountManagementMessage(challenge)});
    const result=await(await request('session',{challenge:challenge.challenge,signature})).json();return result.session as string;
  };
  const session=await unlock();
  const save=async()=>{const response=await request('api-keys/save',saveInput,session);assert.equal(response.status,200);return (await response.json()).credential as ApiKeyConnection;};
  return {directory,state,request,session,save,unlock,base};
}

test('one protected OpenAI key discovers only returned supported exact models, reused by multiple node configs',async t=>{
  const f=await fixture(t);
  f.state.reply=async()=>metadata(['gpt-4.1','gpt-5.4-pro','gpt-4.1-2025-04-14','gpt-image-1','gpt-4o-audio-preview','text-embedding-3-small','ft:gpt-4.1:local','gpt-999','gpt-3.5-turbo-instruct']);
  assert.equal((await f.request('api-keys/save',saveInput)).status,401);assert.equal(f.state.calls,0);
  for(const invalid of [{...saveInput,baseUrl:'https://evil.invalid'},{...saveInput,provider:'compatible'},{...saveInput,upstreamModel:'gpt-4.1'},{...saveInput,apiKey:'invalid whitespace token'}])assert.equal((await f.request('api-keys/save',invalid,f.session)).status,400);
  assert.equal(f.state.calls,0);
  const credential=await f.save();assert.equal(f.state.calls,1);assert.equal(credential.validation,'unverified');assert.equal(credential.model,undefined);assert.equal(credential.providerModelConfig,undefined);
  assert.equal(credential.catalog?.status,'ready');assert.ok(credential.catalog?.discoveredAt);
  assert.deepEqual(credential.catalog?.models.map(m=>m.upstreamModel),['gpt-4.1','gpt-5.4-pro','gpt-4.1-2025-04-14']);
  assert.deepEqual(credential.catalog?.unsupported.map(m=>m.id),['gpt-image-1','gpt-4o-audio-preview','text-embedding-3-small','ft:gpt-4.1:local','gpt-999','gpt-3.5-turbo-instruct']);
  assert.equal(credential.catalog?.unsupported.find(m=>m.id.startsWith('ft:'))?.reason,'fine_tune');
  const configs=credential.catalog!.models.map(m=>m.providerModelConfig);
  for(const config of configs){
    assert.equal(config.model,'openai/'+config.upstreamModel);assert.equal(config.authentication.credentialRef,credential.credentialRef);
    assert.equal(await resolveManagedApiKey(config,operator.address,f.directory),secret);
    let paid=0;
    const result=await callPaidApi(config,'local-fixture',16,{credentialResolver:m=>resolveManagedApiKey(m,operator.address,f.directory),fetch:async(url,init)=>{
      paid++;assert.equal(String(url),'https://api.openai.com/v1/responses');assert.equal(JSON.parse(String(init?.body)).model,config.upstreamModel);
      return Response.json({output:[{type:'message',content:[{type:'output_text',text:'fixture'}]}],usage:{input_tokens:4,output_tokens:2}});
    }});assert.equal(paid,1);assert.equal(result.outputTokens,2);
  }
  const config=configs[0];
  for(const changed of [
    {...config,upstreamModel:'gpt-4o',model:'openai/gpt-4o'}, // Supported globally but absent from this key's returned catalog.
    {...config,upstreamModel:'gpt-image-1',model:'openai/gpt-image-1'},
    {...config,model:'alias'},{...config,baseUrl:'https://evil.invalid'},
    {...config,apiKind:3 as const},{...config,authentication:{...config.authentication,provider:'compatible' as const}},
    {...config,apiKeyEnv:'FALLBACK'},
  ])await assert.rejects(resolveManagedApiKey(changed,operator.address,f.directory));
  await assert.rejects(resolveManagedApiKey(config,privateKeyToAccount(('0x'+'73'.repeat(32)) as `0x${string}`).address,f.directory));
  const list=await(await f.request('api-keys',undefined,f.session)).json();assert.equal(list.credentials.length,1);assert.ok(!JSON.stringify(list).includes(secret));
  const file=JSON.parse(await readFile(join(f.directory,'api-keys','keys.json'),'utf8'));assert.equal(file.keys.length,1);assert.equal(file.keys[0].apiKey,secret);assert.equal(file.keys[0].model,undefined);
  assert.equal(f.state.calls,1); // Listing/resolving is local; only explicit discovery fetched metadata.
  assert.equal((await f.request('api-keys/remove',{credentialRef:credential.credentialRef},f.session)).status,200);
  for(const selected of configs)await assert.rejects(callPaidApi(selected,'fixture',16,{env:{FALLBACK:secret},credentialResolver:m=>resolveManagedApiKey(m,operator.address,f.directory),fetch:async()=>{throw new Error('No fallback');}}));
  assert.ok(!(await readFile(join(f.directory,'api-keys','keys.json'),'utf8')).includes(secret));
  assert.equal((await f.request('api-keys/discover',{credentialRef:credential.credentialRef},f.session)).status,400);assert.equal(f.state.calls,1);
});

test('metadata failures retain one ref and redact vendor errors, clear stale membership, retry without the key',async t=>{
  const f=await fixture(t),credential=await f.save(),oldConfig=credential.catalog!.models[0].providerModelConfig;
  assert.equal((await f.request('api-keys/discover',{credentialRef:credential.credentialRef})).status,401);
  for(const [status,error] of [[401,'invalid_credentials'],[403,'forbidden'],[429,'rate_limited'],[500,'unavailable']] as const){
    f.state.reply=async()=>Response.json({error:{message:secret}}, {status});
    const response=await f.request('api-keys/discover',{credentialRef:credential.credentialRef},f.session);assert.equal(response.status,200);
    const body=await response.json();assert.equal(body.credential.catalog.status,'failed');assert.equal(body.credential.catalog.error,error);assert.deepEqual(body.credential.catalog.models,[]);assert.ok(!JSON.stringify(body).includes(secret));
    await assert.rejects(resolveManagedApiKey(oldConfig,operator.address,f.directory));
  }
  for(const reply of [
    ()=>metadata(['gpt-4.1','gpt-4.1']),()=>metadata([secret]),()=>metadata(['<script>']),
    ()=>Response.json({object:'list',data:[{id:42}]}),()=>Response.json({object:'wrong',data:[]}),
    ()=>new Response('x'.repeat(300000)),
  ]){
    f.state.reply=async()=>reply();const {credential:c}=await(await f.request('api-keys/discover',{credentialRef:credential.credentialRef},f.session)).json();
    assert.equal(c.catalog.status,'failed');assert.equal(c.catalog.error,'invalid_catalog');assert.deepEqual(c.catalog.models,[]);
  }
  f.state.reply=async()=>{throw new Error(secret);};
  const failed=await(await f.request('api-keys/discover',{credentialRef:credential.credentialRef},f.session)).json();assert.equal(failed.credential.catalog.error,'unavailable');assert.ok(!JSON.stringify(failed).includes(secret));
  f.state.reply=async()=>metadata(['gpt-5.4-pro']);
  const {credential:retried}=await(await f.request('api-keys/discover',{credentialRef:credential.credentialRef},f.session)).json();
  assert.equal(retried.credentialRef,credential.credentialRef);assert.equal(retried.catalog.status,'ready');assert.deepEqual(retried.catalog.models.map((m:{upstreamModel:string})=>m.upstreamModel),['gpt-5.4-pro']);
  const file=JSON.parse(await readFile(join(f.directory,'api-keys','keys.json'),'utf8'));assert.equal(file.keys.length,1);assert.equal(file.keys[0].apiKey,secret);
});

test('catalog refresh cancellation, removal and management lock cannot resurrect a late model cache',async t=>{
  const f=await fixture(t),credential=await f.save();let release!:()=>void,entered!:()=>void;
  let signal:AbortSignal|undefined;let entry=new Promise<void>(r=>entered=r),gate=new Promise<void>(r=>release=r);
  f.state.reply=async s=>{signal=s;entered();await gate;return metadata(['gpt-4o']);};
  const pending=f.request('api-keys/discover',{credentialRef:credential.credentialRef},f.session);await entry;
  assert.equal((await f.request('api-keys/discover',{credentialRef:credential.credentialRef},f.session)).status,400); // No competing refresh.
  await f.request('lock',{},f.session);assert.equal(signal?.aborted,true);release();assert.equal((await pending).status,401);
  const session=await f.unlock(),list=await(await f.request('api-keys',undefined,session)).json();assert.equal(list.credentials[0].catalog.status,'not_requested');assert.deepEqual(list.credentials[0].catalog.models,[]);
  entry=new Promise<void>(r=>entered=r);gate=new Promise<void>(r=>release=r);
  const removalRace=f.request('api-keys/discover',{credentialRef:credential.credentialRef},session);await entry;
  await f.request('api-keys/remove',{credentialRef:credential.credentialRef},session);assert.equal(signal?.aborted,true);release();assert.equal((await removalRace).status,401);
  assert.deepEqual((await(await f.request('api-keys',undefined,session)).json()).credentials,[]);
  assert.ok(!(await readFile(join(f.directory,'api-keys','keys.json'),'utf8')).includes(secret));
});

test('legacy refs keep exact manual bindings until explicit metadata upgrade, catalog survives protected restart',async t=>{
  const directory=await realpath(await mkdtemp(join(tmpdir(),'llm-catalog-migration-')));await chmod(directory,0o700);
  t.after(()=>rm(directory,{recursive:true,force:true}));
  let calls=0;let store=await ApiKeyStore.open(directory,operator.address,async()=>{calls++;return metadata(['gpt-4.1']);});
  const legacy=await store.save({provider:'openai',model:'my-alias',upstreamModel:'gpt-4.1',baseUrl:'https://api.openai.com',apiKey:secret});
  assert.equal(calls,0);assert.ok(legacy.providerModelConfig);assert.equal(await resolveManagedApiKey(legacy.providerModelConfig,operator.address,directory),secret);
  const upgraded=await store.discover(legacy.credentialRef,'local-fixture');assert.equal(upgraded.credentialRef,legacy.credentialRef);assert.equal(upgraded.model,undefined);
  await assert.rejects(resolveManagedApiKey(legacy.providerModelConfig,operator.address,directory));
  const config=upgraded.catalog!.models[0].providerModelConfig;await store.close();
  store=await ApiKeyStore.open(directory,operator.address,async()=>{throw new Error('No automatic discovery on restart');});
  assert.equal(store.list()[0].catalog!.models[0].upstreamModel,'gpt-4.1');assert.equal(await resolveManagedApiKey(config,operator.address,directory),secret);await store.close();
  assert.equal(calls,1);
});

test('capability policy never treats arbitrary prefixes, fine-tunes or specialized models as text offers',()=>{
  for(const id of ['gpt-4.1','gpt-4.1-2025-04-14','gpt-5.4-pro','gpt-6.1-sol'])assert.equal(openAITextCapability(id).supported,true);
  for(const id of ['gpt-4.1-2099-01-01','gpt-4.1-malicious','gpt-999','ft:gpt-4.1:x','gpt-3.5-turbo-instruct','o3-deep-research','gpt-4o-audio-preview','text-embedding-3-small','gpt-image-1','unknown-text-model'])assert.equal(openAITextCapability(id).supported,false);
});

test('browser catalog wrappers authenticate save once, refresh only the ref, and fence late replies on lock',async t=>{
  const f=await fixture(t),priorFetch=globalThis.fetch,priorLocation=Object.getOwnPropertyDescriptor(globalThis,'location'),bodies:unknown[]=[];
  Object.defineProperty(globalThis,'location',{configurable:true,value:{origin}});
  globalThis.fetch=async(url,init)=>{
    const original=new URL(String(url));assert.equal(original.origin,'http://127.0.0.1:8791');
    if(init?.body)bodies.push(JSON.parse(String(init.body)));
    const headers=new Headers(init?.headers);headers.set('Origin',origin);
    return priorFetch(f.base+original.pathname.replace('/accounts/',''),{...init,headers});
  };
  t.after(()=>{globalThis.fetch=priorFetch;if(priorLocation)Object.defineProperty(globalThis,'location',priorLocation);else Reflect.deleteProperty(globalThis,'location');});
  const client=new LocalAccountClient();await assert.rejects(client.saveApiKey(saveInput),/Unlock/);assert.equal(f.state.calls,0);
  await client.unlock(operator.address,request=>operator.signTypedData(request));
  const {credential}=await client.saveApiKey(saveInput);assert.equal(credential.catalog?.status,'ready');
  f.state.reply=async()=>metadata(['gpt-4o']);const refreshed=await client.discoverApiKey(credential.credentialRef);
  assert.deepEqual(refreshed.credential.catalog?.models.map(m=>m.upstreamModel),['gpt-4o']);
  assert.equal(bodies.filter(v=>JSON.stringify(v).includes(secret)).length,1);assert.deepEqual(bodies.at(-1),{credentialRef:credential.credentialRef});
  let release!:()=>void,entered!:()=>void;const entry=new Promise<void>(r=>entered=r),gate=new Promise<void>(r=>release=r);
  f.state.reply=async()=>{entered();await gate;return metadata(['gpt-4.1']);};
  const pending=client.discoverApiKey(credential.credentialRef);await entry;const rejection=assert.rejects(pending,/locked|wallet changed/);
  await client.lock();release();await rejection;assert.equal(client.isUnlocked(),false);
  await assert.rejects(client.discoverApiKey(credential.credentialRef),/Unlock/);
});
