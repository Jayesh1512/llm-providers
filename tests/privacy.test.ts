import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { keccak256, verifyTypedData, zeroAddress, zeroHash, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { PrivacyGateway } from '../src/privacy/gateway.js';
import { createPrivacyRelay, createPrivacyServer } from '../src/privacy/server.js';
import { deriveActionEncryptionKeys, bytesHex, commitment, configHash, contextHash, exportKey, hexBytes, importKey, keyHash, open, parsePrivacyConfig, privateInferenceTypes, randomHash, seal, suite, type PrivacyConfig, type PrivacyContext } from '../src/privacy/protocol.js';
import { escrowDomain, invoiceDomain, invoiceTypes, offerId } from '../src/shared/protocol.js';
import { verifyLitKeyBinding, authenticateGateway } from '../src/privacy/client.js';
import { enforceRuntimeReport, enforceFullVerification, runtimePolicySchema, VerifiedLitChannel } from '../src/privacy/lit-channel.js';
import type { AttestationReport } from '@lit-protocol/keychain';
import { runLitAction, manifestSchema } from '../src/privacy/lit-action.js';
import { ProviderCore } from '../src/provider/core.js';
import { MemoryStateStore } from '../src/provider/persistence.js';
import type { Invoice, ProviderChain, ProviderConfig } from '../src/provider/types.js';

const operatorKey=`0x${'2'.repeat(64)}` as Hex;
const operator=privateKeyToAccount(operatorKey);
const buyer=privateKeyToAccount(`0x${'1'.repeat(64)}`);
const provider=privateKeyToAccount(`0x${'3'.repeat(64)}`).address;
const registry='0x4444444444444444444444444444444444444444';
const escrow='0x5555555555555555555555555555555555555555';
const prompt='PRIVATE PROMPT: never visible to the supplier host';
const answer='PRIVATE ANSWER: enclave-only plaintext';
const policy:PrivacyConfig={version:1,backend:'lit-chipotle',actionId:'Qm'+'1'.repeat(44),actionPublicKey:operator.publicKey.toLowerCase(),runtimePolicyId:'LOCAL TEST ONLY',models:[{model:'openai/local-fixture',upstreamModel:'fixture',apiKind:2,origin:'https://api.openai.com',accountPolicyId:'LOCAL TEST ONLY; not an approved real account',credentialCommitment:zeroHash}]};
const policyHash=configHash(policy);
async function fixture(){
  const salt=randomHash(); const promptHash=commitment('prompt',prompt,salt,policyHash);
  const config:ProviderConfig={provider,privateKey:operatorKey,registry,escrow,chainId:31337,rpcUrl:'http://127.0.0.1:1',models:[{model:policy.models[0].model,upstreamModel:'fixture',apiKind:2,baseUrl:'https://api.openai.com',apiKeyEnv:'FIXTURE_KEY'}],allowedOrigins:[],stateDir:'/unused/no-private-journal',port:0,maxOutputTokens:128,maxPromptBytes:32000,upstreamTimeoutMs:1000,maxStateEntries:10,localMode:true};
  let calls=0,claims=0;const started=new Set<string>();let spki='';
  const chain:ProviderChain={
    getRequest:async()=>({consumer:buyer.address,provider,offerId:offerId(provider,config.models[0].model),promptHash,deposit:1000n,inputPrice:1000000n,outputPrice:1000000n,expiresAt:BigInt(Math.floor(Date.now()/1000)+1800),closed:false}),
    getPeer:async address=>address.toLowerCase()===provider.toLowerCase()?{roles:1,active:true,operator:operator.address,endpoint:'https://peer.invalid',metadataURI:''}:{roles:2,active:true,operator:zeroAddress,endpoint:'',metadataURI:''},
    getOffer:async()=>({provider,model:config.models[0].model,apiKind:2,inputPrice:1000000n,outputPrice:1000000n,active:true}),
    getPrivacyConfig:async()=>policyHash,getRequestPrivacy:async()=>policyHash,
    isPrivacyVerified:async()=>true,getVerifiedEncryptionKeyHash:async()=>keyHash(await exportKey((await deriveActionEncryptionKeys(operatorKey)).publicKey)),
    claimPrivate:async id=>{if(started.has(String(id)))throw new Error('Already claimed');started.add(String(id));claims++;},
    getPass: async () => { throw new Error('Not a pass fixture'); }, chargePass: async () => { throw new Error('Not a pass fixture'); },
    settle:async()=>zeroHash,
  };
  const upstream=async()=>{calls++;return {text:answer,inputTokens:5,outputTokens:3};};
  const gateway=await PrivacyGateway.create({config,chain,policy,upstream});
  const reply=await suite.kem.generateKeyPair();const replySpki=await exportKey(reply.publicKey);
  function context():PrivacyContext{return {version:1,chainId:31337,provider,operator:operator.address,consumer:buyer.address,registry,escrow,offerId:offerId(provider,config.models[0].model),configHash:policyHash,requestId:'1',promptHash,maxOutputTokens:100,challenge:randomHash(),responseKeyHash:keyHash(replySpki),issuedAt:Date.now()};}
  async function request(overrides:{payload?:Record<string,unknown>;signedKeyHash?:Hex}={}){
    const c=context();const binding=await gateway.attest(c);spki=binding.publicKey;await verifyLitKeyBinding(binding,c,policy);
    const signature=await buyer.signTypedData({domain:escrowDomain(31337,escrow),types:privateInferenceTypes,primaryType:'PrivateInferenceRequest',message:{requestId:1n,promptHash,maxOutputTokens:100n,contextHash:contextHash(c),enclaveKeyHash:overrides.signedKeyHash??keyHash(spki)}});
    const payload={prompt,promptSalt:salt,replyKey:replySpki,signature,...overrides.payload};
    return {context:c,envelope:await seal(await importKey(spki),c,'request',payload)};
  }
  return {gateway,config,chain,upstream,salt,reply,context,request,spki:()=>spki,calls:()=>calls,claims:()=>claims};
}
async function listen(server:Server){server.listen(0,'127.0.0.1');await once(server,'listening');return `http://127.0.0.1:${(server.address() as {port:number}).port}`;}
async function close(server:Server){server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}

test('private gateway creation rejects host OAuth before deriving keys, funding acceptance or upstream access',async()=>{
  const f=await fixture();
  f.config.models[0].authentication={kind:'chatgpt-oauth',provider:'openai',billingSource:'chatgpt-plan',usage:'personal-local',credentialRef:'00000000-0000-4000-8000-000000000001'};
  await assert.rejects(PrivacyGateway.create({config:f.config,chain:f.chain,policy,upstream:f.upstream}),/Private OAuth/);
  assert.equal(f.claims(),0);assert.equal(f.calls(),0);
  f.config.models[0].authentication={kind:'api-key',provider:'openai',billingSource:'api-credits',credentialRef:'00000000-0000-4000-8000-000000000001'};
  await assert.rejects(PrivacyGateway.create({config:f.config,chain:f.chain,policy,upstream:f.upstream}),/standard-host references/);
  assert.equal(f.claims(),0);assert.equal(f.calls(),0);
});

test('local encrypted gateway through an opaque HTTP relay returns a wallet-verifiable salted invoice',async()=>{
  const f=await fixture();const inner=createPrivacyServer(f.gateway);const innerUrl=await listen(inner);const relay=createPrivacyRelay(innerUrl,[]);const endpoint=await listen(relay);
  try{
    const request=await f.request();const wire=JSON.stringify(request);
    for(const secret of [prompt,f.salt,await exportKey(f.reply.publicKey)])assert.ok(!wire.includes(secret));
    const response=await fetch(`${endpoint}/privacy/infer`,{method:'POST',headers:{'content-type':'application/json'},body:wire});
    assert.equal(response.status,200);const encrypted=await response.json();assert.ok(!JSON.stringify(encrypted).includes(answer));
    const invoice=await open(f.reply.privateKey,request.context,'response',encrypted) as Invoice;
    assert.equal(invoice.text,answer);assert.equal(invoice.responseHash,commitment('response',answer,invoice.responseSalt!,policyHash));
    assert.equal(invoice.amountWei,'8');assert.equal(f.calls(),1);assert.equal(f.claims(),1);
    assert.equal(await verifyTypedData({address:operator.address,domain:invoiceDomain(31337,escrow),types:invoiceTypes,primaryType:'Invoice',message:{requestId:1n,responseHash:invoice.responseHash,inputTokens:5n,outputTokens:3n,amountWei:8n},signature:invoice.signature}),true);
    const replay=await fetch(`${endpoint}/privacy/infer`,{method:'POST',headers:{'content-type':'application/json'},body:wire});assert.equal(replay.status,400);assert.equal(f.calls(),1);
    const restart=await PrivacyGateway.create({config:f.config,chain:f.chain,policy,upstream:f.upstream});
    const c=f.context();const binding=await restart.attest(c);assert.equal(binding.publicKey,f.spki());
    const signature=await buyer.signTypedData({domain:escrowDomain(31337,escrow),types:privateInferenceTypes,primaryType:'PrivateInferenceRequest',message:{requestId:1n,promptHash:c.promptHash,maxOutputTokens:100n,contextHash:contextHash(c),enclaveKeyHash:keyHash(f.spki())}});
    await assert.rejects(restart.infer({context:c,envelope:await seal(await importKey(f.spki()),c,'request',{prompt,promptSalt:f.salt,signature,replyKey:await exportKey(f.reply.publicKey)})}));assert.equal(f.calls(),1);
    for(const path of ['/infer','/privacy/infer']){
      const rejected=await fetch(`${endpoint}${path}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({prompt})});assert.ok(rejected.status>=400);assert.ok(!(await rejected.text()).includes(prompt));
    }
  }finally{await close(relay);await close(inner);}
});

test('identity/context changes, tampering, swapped enclave/response keys and wallet signatures fail before payment/API use',async()=>{
  for(const mutation of [
    {provider:buyer.address},{operator:buyer.address},{consumer:provider},{chainId:10143},
    {registry:buyer.address},{escrow:buyer.address},{offerId:randomHash()},{configHash:randomHash()},
    {requestId:'2'},{promptHash:randomHash()},{maxOutputTokens:99},{challenge:randomHash()},{responseKeyHash:randomHash()},
  ]){
    const f=await fixture();const r=await f.request();await assert.rejects(f.gateway.infer({...r,context:{...r.context,...mutation}}));assert.equal(f.calls(),0);assert.equal(f.claims(),0);
  }
  for(const overrides of [{payload:{prompt:'substituted'}},{payload:{promptSalt:randomHash()}},{payload:{signature:`0x${'0'.repeat(130)}`}},{signedKeyHash:randomHash()}]){
    const f=await fixture();await assert.rejects(f.gateway.infer(await f.request(overrides)));assert.equal(f.calls(),0);assert.equal(f.claims(),0);
  }
  const wrongReply=await suite.kem.generateKeyPair();const f=await fixture();await assert.rejects(f.gateway.infer(await f.request({payload:{replyKey:await exportKey(wrongReply.publicKey)}})));assert.equal(f.calls(),0);
  const g=await fixture();const r=await g.request();r.envelope.ciphertext=(r.envelope.ciphertext[0]==='0'?'1':'0')+r.envelope.ciphertext.slice(1);await assert.rejects(g.gateway.infer(r));assert.equal(g.calls(),0);
  const h=await fixture();const request=await h.request();const wrongEnclave=await suite.kem.generateKeyPair();request.envelope=await seal(wrongEnclave.publicKey,request.context,'request',{prompt});await assert.rejects(h.gateway.infer(request));assert.equal(h.calls(),0);
});

test('HPKE binds direction and context; response cannot decrypt with a substituted consumer key',async()=>{
  const f=await fixture();const c=f.context();const ciphertext=await seal(f.reply.publicKey,c,'response',{text:answer});
  assert.deepEqual(await open(f.reply.privateKey,c,'response',ciphertext),{text:answer});
  for(const mutation of [{requestId:'2'},{chainId:10143 as const},{escrow:buyer.address},{configHash:randomHash()},{responseKeyHash:randomHash()}])await assert.rejects(open(f.reply.privateKey,{...c,...mutation},'response',ciphertext));
  await assert.rejects(open(f.reply.privateKey,c,'request',ciphertext));const other=await suite.kem.generateKeyPair();await assert.rejects(open(other.privateKey,c,'response',ciphertext));
});

test('private requests are refused by the existing plaintext core; unsupported origins/adapters/policies fail',async()=>{
  const f=await fixture();const plain=new ProviderCore({config:f.config,chain:f.chain,store:new MemoryStateStore(),upstream:f.upstream});
  await assert.rejects(plain.infer({requestId:'1',prompt,maxOutputTokens:100,signature:`0x${'0'.repeat(130)}`}),/privacy configuration/);assert.equal(f.calls(),0);
  for(const p of [{...policy,backend:'local-simulation'},{...policy,models:[{...policy.models[0],origin:'https://supplier.invalid'}]},{...policy,models:[{...policy.models[0],apiKind:3}]},{...policy,unexpected:true}])assert.throws(()=>parsePrivacyConfig(p));
  assert.notEqual(commitment('prompt',prompt,f.salt,policyHash),keccak256(new TextEncoder().encode(prompt)));
  assert.notEqual(commitment('prompt',prompt,f.salt,policyHash),commitment('prompt',prompt,randomHash(),policyHash));
  assert.notEqual(commitment('prompt',prompt,f.salt,policyHash),commitment('response',prompt,f.salt,policyHash));
});


// All gateway fixtures above are local simulations, never production runtime evidence.
test('fresh action signatures bind the public encryption key and every session field',async()=>{
  const f=await fixture();const c=f.context();const binding=await f.gateway.attest(c);
  assert.ok(await verifyLitKeyBinding(binding,c,policy));
  for(const mutation of [{provider:buyer.address},{consumer:provider},{operator:buyer.address},{chainId:10143 as const},{registry:buyer.address},{escrow:buyer.address},{offerId:randomHash()},{configHash:randomHash()},{requestId:'2'},{promptHash:randomHash()},{challenge:randomHash()},{responseKeyHash:randomHash()},{issuedAt:c.issuedAt-1},{maxOutputTokens:99}])await assert.rejects(verifyLitKeyBinding(binding,{...c,...mutation},policy));
  const other=await suite.kem.generateKeyPair();
  for(const bad of [{...binding,publicKey:await exportKey(other.publicKey)},{...binding,issuedAt:binding.issuedAt-60001},{...binding,signature:`0x${'0'.repeat(130)}`}])await assert.rejects(verifyLitKeyBinding(bad,c,policy));
  await assert.rejects(verifyLitKeyBinding(binding,c,{...policy,actionId:'Qm'+'2'.repeat(44)}));
  await assert.rejects(verifyLitKeyBinding(binding,c,policy,binding.issuedAt+60001));
});

test('consumer rejects unapproved releases before network/funding; no simulated proof or plaintext fallback',async()=>{
  const f=await fixture();const {responseKeyHash,issuedAt,...base}=f.context();
  await assert.rejects(authenticateGateway('https://supplier.invalid',{...base,chainId:10143}),/No approved Lit privacy release/);
  await assert.rejects(authenticateGateway('http://127.0.0.1:1',base),/No approved Lit privacy release/);
});

const measurements={mrtd:'11'.repeat(48),rtmr0:'22'.repeat(48),rtmr1:'33'.repeat(48),rtmr2:'44'.repeat(48),rtmr3:'55'.repeat(48)};
const runtimePolicy=runtimePolicySchema.parse({id:'TEST ONLY',appId:'3f91deaf16ff7c823ee65081d6bafa1ceea05ffc',composeHash:'11'.repeat(32),osImageHash:'22'.repeat(32),mrKms:'TEST ONLY',measurements,verifierPath:'/not-installed/test-only-verifier',verifierSha256:'00'.repeat(32)});
test('runtime policy gate rejects mismatched measurements, code, origin, certificate and freshness (not hardware validation)',()=>{
  const now=Date.now();const cert='aa'.repeat(32);
  const report={origin:'https://api.chipotle.litprotocol.com',appId:runtimePolicy.appId,composeHash:runtimePolicy.composeHash,osImageHash:runtimePolicy.osImageHash,mrKms:runtimePolicy.mrKms,measurements,verifiedAt:now,tlsCertificateSha256:cert,checks:['tls-certificate-in-tee']} as AttestationReport;
  enforceRuntimeReport(report,runtimePolicy,cert,now);
  for(const mutation of [{origin:'https://supplier.invalid'},{appId:'unapproved'},{composeHash:'00'.repeat(32)},{osImageHash:'00'.repeat(32)},{mrKms:'supplier-kms'},{tlsCertificateSha256:'bb'.repeat(32)},{measurements:{...measurements,rtmr3:'00'.repeat(48)}},{verifiedAt:now-60001},{verifiedAt:now+5001},{checks:[]}])assert.throws(()=>enforceRuntimeReport({...report,...mutation},runtimePolicy,cert,now));
  assert.throws(()=>runtimePolicySchema.parse({...runtimePolicy,verifierPath:'provider/verifier'}));
});

test('full verifier result policy refuses non-OK TCB, advisories, missing checks and a different quote (synthetic output only)',()=>{
  const reportData='11'.repeat(64);
  const details={quote_verified:true,event_log_verified:true,os_image_hash_verified:true,tcb_status:'UpToDate',advisory_ids:[],report_data:reportData,os_image_is_dev:false};
  enforceFullVerification({is_valid:true,details},reportData);
  for(const changed of [{tcb_status:'OutOfDate'},{tcb_status:'Revoked'},{tcb_status:'SWHardeningNeeded'},{advisory_ids:['INTEL-SA-TEST']},{quote_verified:false},{event_log_verified:false},{os_image_hash_verified:false},{report_data:'22'.repeat(64)},{os_image_is_dev:true}])assert.throws(()=>enforceFullVerification({is_valid:true,details:{...details,...changed}},reportData));
  assert.throws(()=>enforceFullVerification({is_valid:true},reportData));
  assert.throws(()=>enforceFullVerification({is_valid:false,details},reportData));
});

test('missing Lit prerequisites fail closed; immutable action has no plaintext/key export or mutable origin operations',async()=>{
  await assert.rejects(VerifiedLitChannel.open(runtimePolicy,''),/billing credential/);
  const manifest={version:1,chainId:10143,provider,registry,escrow,runtimePolicyId:policy.runtimePolicyId,models:policy.models};
  assert.throws(()=>manifestSchema.parse({...manifest,chainId:8453}));
  assert.throws(()=>manifestSchema.parse({...manifest,rpcUrl:'https://supplier.invalid'}));
  assert.throws(()=>manifestSchema.parse({...manifest,models:[{...policy.models[0],origin:'https://supplier.invalid'}]}));
  for(const operation of ['decrypt','exportKey','sign','plaintext','infer']){
    // Unknown operations or missing Lit runtime are generic errors and never leak payloads.
    const result=await runLitAction(manifest,{operation,policy,context:{prompt,answer},credentials:{secret:prompt}});
    assert.deepEqual(result,{ok:false,error:'private_request_rejected'});
    assert.ok(!JSON.stringify(result).includes(prompt));
  }
});
