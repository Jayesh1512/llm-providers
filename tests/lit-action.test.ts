import test from 'node:test';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createContext, runInContext } from 'node:vm';
import { decodeFunctionData, encodeFunctionResult, zeroAddress, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { registryAbi, escrowAbi } from '../src/shared/contracts.js';
import { offerId } from '../src/shared/protocol.js';
import { credentialContext, type ActionManifest } from '../src/privacy/lit-action.js';
import { commitment, configHash, deriveActionEncryptionKeys, exportKey, keyHash, randomHash, seal, suite, type PrivacyConfig, type PrivacyContext } from '../src/privacy/protocol.js';
import { verifyLitKeyBinding } from '../src/privacy/client.js';

// Actual production bundle and entry point, with simulated Lit key APIs and RPC reads only.
// No public transactions, Lit execution, Intel evidence or real upstream service are exercised.
test('bundled immutable action runs without Node APIs; authenticates keys and blocks credential/code/authorization substitutions',async()=>{
  const key=`0x${'2'.repeat(64)}` as Hex,operator=privateKeyToAccount(key),buyer=privateKeyToAccount(`0x${'1'.repeat(64)}`);
  const provider='0x3333333333333333333333333333333333333333',registry='0x4444444444444444444444444444444444444444',escrow='0x5555555555555555555555555555555555555555';
  const credential='LOCAL-SECRET-API-KEY-NOT-LIVE',credentialSalt=randomHash(),prompt='LOCAL-SECRET-PROMPT';
  const model='openai/local-action-fixture';
  const policy:PrivacyConfig={version:1,backend:'lit-chipotle',actionId:'Qm'+'1'.repeat(44),actionPublicKey:operator.publicKey.toLowerCase(),runtimePolicyId:'LOCAL-SIMULATION',models:[{model,upstreamModel:'fixture',apiKind:2,origin:'https://api.openai.com',accountPolicyId:'TEST-ONLY-NOT-APPROVED',credentialCommitment:commitment('credential',credential,credentialSalt,offerId(provider,model))}]};
  const manifest:ActionManifest={version:1,chainId:10143,provider,registry,escrow,runtimePolicyId:policy.runtimePolicyId,models:policy.models};
  const reply=await suite.kem.generateKeyPair();const replySpki=await exportKey(reply.publicKey);
  const promptSalt=randomHash();const promptHash=commitment('prompt',prompt,promptSalt,configHash(policy));
  const context:PrivacyContext={version:1,chainId:10143,provider,operator:operator.address,consumer:buyer.address,registry,escrow,offerId:offerId(provider,model),configHash:configHash(policy),requestId:'0',promptHash,maxOutputTokens:100,challenge:randomHash(),responseKeyHash:keyHash(replySpki),issuedAt:Date.now()};
  const keys=await deriveActionEncryptionKeys(key);
  const bundle=await build({entryPoints:['src/privacy/lit-action.ts'],bundle:true,write:false,platform:'browser',target:'es2022',format:'iife',globalName:'LLMProvidersLit',minify:true,plugins:[{name:'test-errors',setup(build){build.onLoad({filter:/lit-action\.ts$/},async(args)=>({contents:(await readFile(args.path,'utf8')).replace('}catch{return {ok:false,error:', '}catch(error){(globalThis as any).__testError=String(error);return {ok:false,error:'),loader:'ts'}));}}]});
  let writes=0,upstreamCalls=0,verified=false;
  const fetchMock=async(url:unknown,init?:RequestInit)=>{
    if(new URL(url instanceof Request?url.url:String(url)).origin!=='https://testnet-rpc.monad.xyz'){upstreamCalls++;throw new Error('No upstream calls authorized in this simulation');}
    const rpc=JSON.parse(url instanceof Request?await url.text():String(init?.body));let result:unknown;
    if(rpc.method==='eth_chainId')result='0x279f';
    else if(rpc.method==='eth_getCode')result='0x6000';
    else if(rpc.method==='eth_call'){
      const isRegistry=rpc.params[0].to.toLowerCase()===registry;
      const abi=isRegistry?registryAbi:escrowAbi;
      const decoded=decodeFunctionData({abi,data:rpc.params[0].data});
      const fn=decoded.functionName;
      if(fn==='registry')result=registry;
      else if(fn==='getPeer')result={roles:decoded.args?.[0]?.toString().toLowerCase()===provider?1:2,active:true,operator:decoded.args?.[0]?.toString().toLowerCase()===provider?operator.address:zeroAddress,endpoint:'https://supplier.invalid',metadataURI:''};
      else if(fn==='getOffer')result={provider,model,apiKind:2,inputPrice:1000000n,outputPrice:1000000n,active:true};
      else if(fn==='isPrivacyVerified')result=verified;
      else if(fn==='privacyEncryptionKeyHash')result=keyHash(await exportKey(keys.publicKey));
      else if(fn==='privacyConfigHash'||fn==='requestPrivacyConfig')result=configHash(policy);
      else if(fn==='getRequest')result={consumer:buyer.address,provider,offerId:context.offerId,promptHash,deposit:1000n,inputPrice:1000000n,outputPrice:1000000n,expiresAt:BigInt(Math.floor(Date.now()/1000)+1800),closed:false};
      else{writes++;throw new Error('No claims/writes expected');}
      result=encodeFunctionResult({abi,functionName:fn as never,result:result as never});
    }else{writes++;throw new Error('No writes expected');}
    return new Response(JSON.stringify({jsonrpc:'2.0',id:rpc.id,result}),{headers:{'content-type':'application/json'}});
  };
  const sandbox=createContext({crypto,TextEncoder,TextDecoder,AbortController,AbortSignal,URL,URLSearchParams,Request,Response,Headers,fetch:fetchMock,setTimeout,clearTimeout,structuredClone,Lit:{Actions:{getLitActionPrivateKey:async()=>key,getLitActionPublicKey:async({ipfsId}:{ipfsId:string})=>ipfsId===policy.actionId?operator.publicKey:buyer.publicKey}},console:{log(){throw new Error('Action must not log')},error(){throw new Error('Action must not log')}}},{codeGeneration:{strings:false,wasm:false}});
  runInContext(bundle.outputFiles[0].text+'\nglobalThis.run=LLMProvidersLit.runLitAction;',sandbox);
  const run=sandbox.run as (manifest:unknown,params:unknown)=>Promise<{ok:boolean;result?:unknown;error?:string}>;
  // Bootstrap only proves an action signature over public keys. It must not bypass on-chain approval.
  const bootstrap=await run(manifest,{operation:'bootstrap',policy,context});
  assert.equal(bootstrap.ok,true,String(sandbox.__testError));
  await verifyLitKeyBinding(bootstrap.result,context,policy);
  assert.equal((await run(manifest,{operation:'key',policy,context})).ok,false);
  assert.equal((await run(manifest,{operation:'bootstrap',policy,context:{...context,requestId:'1'}})).ok,false);
  assert.equal((await run(manifest,{operation:'bootstrap',policy,context,credentials:{[model]:'forbidden'}})).ok,false);
  verified=true;
  const binding=await run(manifest,{operation:'key',policy,context});assert.equal(binding.ok,true,String(sandbox.__testError));
  const encryptionKey=await verifyLitKeyBinding(binding.result,context,policy);
  assert.equal(await exportKey(encryptionKey),await exportKey(keys.publicKey));
  const credentials={[model]:await seal(keys.publicKey,credentialContext(policy,manifest,model),'credential',{key:credential,salt:credentialSalt})};
  const funded={...context,requestId:'1',challenge:randomHash()};
  const envelope=await seal(encryptionKey,funded,'request',{prompt,promptSalt,replyKey:replySpki,signature:`0x${'0'.repeat(130)}`});
  const goodStructure={operation:'infer',policy,context:funded,envelope,credentials};
  // Valid encrypted credentials plus invalid consumer authorization still cannot claim or call an API.
  for(const params of [goodStructure,{...goodStructure,credentials:{}},{...goodStructure,credentials:{[model]:await seal(keys.publicKey,credentialContext(policy,manifest,model),'credential',{key:'SUBSTITUTED-CONTENT-LOGGING-ACCOUNT',salt:credentialSalt})}},{...goodStructure,credentials:{[model]:{...credentials[model],ciphertext:'00'}}},{operation:'key',policy:{...policy,actionId:'Qm'+'2'.repeat(44)},context},{operation:'key',policy:{...policy,runtimePolicyId:'supplier-policy'},context},{operation:'exportKey',policy,context},{operation:'key',policy,context:{...context,operator:buyer.address}},{operation:'key',policy,context:{...context,chainId:31337}}]){
    const value=await run(manifest,params);assert.equal(value.ok,false);assert.equal(value.error,'private_request_rejected');
    for(const secret of [key,prompt,promptSalt,credential,credentialSalt])assert.ok(!JSON.stringify(value).includes(secret));
  }
  assert.equal(writes,0);assert.equal(upstreamCalls,0);
});
