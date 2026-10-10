import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPublicClient, createWalletClient, defineChain, http, keccak256, parseEther, verifyTypedData, zeroAddress, type Address, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { registryAbi, registryBytecode, escrowAbi, escrowBytecode } from '../src/shared/contracts.js';
import { contentHash, escrowDomain, identityDomain, identityTypes, inferenceTypes, invoiceDomain, invoiceTypes, offerId, quoteCost, usageTypes } from '../src/shared/protocol.js';
import { loadConfig } from '../src/provider/config.js';
import { createProviderServer } from '../src/provider/server.js';
import { connectChain } from '../src/provider/chain.js';
import { callPaidApi } from '../src/provider/adapters.js';
import { PrivacyGateway } from '../src/privacy/gateway.js';
import { verifyLitKeyBinding } from '../src/privacy/client.js';
import { deriveActionEncryptionKeys, commitment, configHash, contextHash, exportKey, keyHash, open, privateInferenceTypes, randomHash, seal, suite, type PrivacyConfig, type PrivacyContext } from '../src/privacy/protocol.js';
import type { Invoice, ModelConfig } from '../src/provider/types.js';

const directory = await mkdtemp(join(tmpdir(), 'llm-providers-e2e-'));
const reserve = createServer();
await new Promise<void>(resolve => reserve.listen(0, '127.0.0.1', resolve));
const port = (reserve.address() as {port:number}).port;
await new Promise<void>((resolve,reject) => reserve.close(error => error ? reject(error) : resolve()));
const rpc = `http://127.0.0.1:${port}`;
const chain = defineChain({ id:31337, name:'Local integration test', nativeCurrency:{name:'Test ETH',symbol:'ETH',decimals:18}, rpcUrls:{default:{http:[rpc]}} });
const client = createPublicClient({ chain, transport:http(rpc, {retryCount:0}) });
const anvil = spawn('anvil', ['--host','127.0.0.1','--port',String(port),'--chain-id','31337','--silent'], {stdio:'ignore'});
let startupError: Error | undefined;
anvil.on('error', error => { startupError = error; });
let calls = 0;
const upstream = createServer(async (request,response) => {
  let body = '';
  for await (const chunk of request) body += chunk;
  const payload = JSON.parse(body);
  assert.ok(request.headers.authorization || request.headers['x-api-key']);
  calls++;
  response.setHeader('Content-Type','application/json');
  if (request.url === '/v1/messages') {
    assert.ok(Array.isArray(payload.messages));
    response.end(JSON.stringify({content:[{type:'text',text:'Claude fixture response'}],usage:{input_tokens:23,output_tokens:11,cache_read_input_tokens:5,cache_creation_input_tokens:2}}));
  } else if (request.url === '/v1/responses') {
    assert.equal(payload.store,false);
    response.end(JSON.stringify({output:[{type:'message',content:[{type:'output_text',text:'OpenAI fixture response'}]}],usage:{input_tokens:37,output_tokens:13}}));
  } else if (request.url === '/v1/chat/completions') {
    response.end(JSON.stringify({choices:[{message:{content:'Compatible fixture response'}}],usage:{prompt_tokens:41,completion_tokens:17}}));
  } else {
    response.statusCode=404;
    response.end('{}');
  }
});
let supplier: Awaited<ReturnType<typeof createProviderServer>> | undefined;
try {
  for (let attempt=0;attempt<40;attempt++) {
    if (startupError) throw startupError;
    try { if (await client.getChainId() === 31337) break; } catch {}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.equal(await client.getChainId(),31337);
  const admin=privateKeyToAccount(generatePrivateKey());
  const owner=privateKeyToAccount(generatePrivateKey());
  const buyer=privateKeyToAccount(generatePrivateKey());
  const operatorKey=generatePrivateKey();
  const operator=privateKeyToAccount(operatorKey);
  for (const account of [admin,owner,buyer,operator]) {
    await client.request({method:'anvil_setBalance' as never,params:[account.address,'0x8ac7230489e80000'] as never});
  }
  const adminWallet=createWalletClient({account:admin,chain,transport:http(rpc)});
  const ownerWallet=createWalletClient({account:owner,chain,transport:http(rpc)});
  const buyerWallet=createWalletClient({account:buyer,chain,transport:http(rpc)});
  async function mined(hash:Hex) {
    const receipt=await client.waitForTransactionReceipt({hash});
    assert.equal(receipt.status,'success');
    return receipt;
  }
  const registryReceipt=await mined(await adminWallet.deployContract({abi:registryAbi,bytecode:registryBytecode}));
  const registry=registryReceipt.contractAddress!;
  const escrowReceipt=await mined(await ownerWallet.deployContract({abi:escrowAbi,bytecode:escrowBytecode,args:[registry]}));
  const escrow=escrowReceipt.contractAddress!;
  await new Promise<void>(resolve=>upstream.listen(0,'127.0.0.1',resolve));
  const upstreamUrl=`http://127.0.0.1:${(upstream.address() as {port:number}).port}`;
  const models=[
    {model:'anthropic/fixture-claude',apiKind:1,upstreamModel:'fixture-claude',baseUrl:upstreamUrl,apiKeyEnv:'E2E_API_KEY'},
    {model:'openai/fixture-codex',apiKind:2,upstreamModel:'fixture-codex',baseUrl:upstreamUrl,apiKeyEnv:'E2E_API_KEY'},
    {model:'compatible/fixture-model',apiKind:3,upstreamModel:'fixture-model',baseUrl:upstreamUrl,apiKeyEnv:'E2E_API_KEY'},
  ];
  const env={LOCAL_TEST_MODE:'true',CHAIN_ID:'31337',MONAD_RPC_URL:rpc,REGISTRY_ADDRESS:registry,ESCROW_ADDRESS:escrow,PROVIDER_ADDRESS:owner.address,NODE_PRIVATE_KEY:operatorKey,PROVIDER_MODELS_JSON:JSON.stringify(models),STATE_DIR:join(directory,'journal'),ALLOWED_ORIGINS:'http://localhost:5173',E2E_API_KEY:'fixture-only-not-a-real-api-key'};
  const config=loadConfig(env);
  supplier=await createProviderServer(config,{env});
  await new Promise<void>(resolve=>supplier!.server.listen(0,'127.0.0.1',resolve));
  const endpoint=`http://127.0.0.1:${(supplier.server.address() as {port:number}).port}`;
  await mined(await ownerWallet.writeContract({address:registry,abi:registryAbi,functionName:'register',args:[1,operator.address,endpoint,'']}));
  await mined(await buyerWallet.writeContract({address:registry,abi:registryAbi,functionName:'register',args:[2,zeroAddress,'','']}));
  const inputPrice=parseEther('0.01'), outputPrice=parseEther('0.02');
  for (const model of models) await mined(await ownerWallet.writeContract({address:registry,abi:registryAbi,functionName:'setOffer',args:[model.model,model.apiKind,inputPrice,outputPrice,true]}));
  assert.equal(await client.readContract({address:registry,abi:registryAbi,functionName:'peerCount'}),2n);
  assert.equal(await client.readContract({address:registry,abi:registryAbi,functionName:'offerCount'}),3n);
  const challenge=contentHash('fresh integration identity challenge');
  const identityResponse=await fetch(`${endpoint}/identity?challenge=${challenge}`);
  assert.equal(identityResponse.status,200);
  const identity=await identityResponse.json() as {signature:Hex};
  assert.equal(await verifyTypedData({address:operator.address,domain:identityDomain(31337,registry),types:identityTypes,primaryType:'PeerIdentity',message:{challenge,provider:owner.address,registry},signature:identity.signature}),true);
  for (const [index,model] of models.entries()) {
    const prompt=`Local fixture test ${index}; no live upstream calls.`;
    const requestId=await client.readContract({address:escrow,abi:escrowAbi,functionName:'nextRequestId'});
    const latest=await client.getBlock();
    const expiresAt=latest.timestamp+600n;
    const deposit=parseEther('0.001');
    await mined(await buyerWallet.writeContract({address:escrow,abi:escrowAbi,functionName:'fund',args:[offerId(owner.address,model.model),contentHash(prompt),expiresAt],value:deposit}));
    const signature=await buyer.signTypedData({domain:escrowDomain(31337,escrow),types:inferenceTypes,primaryType:'InferenceRequest',message:{requestId,promptHash:contentHash(prompt),maxOutputTokens:128n}});
    const payload={requestId:String(requestId),prompt,maxOutputTokens:128,signature};
    const post=async (path:string,body:unknown)=>fetch(`${endpoint}${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const bad=await post('/infer',{...payload,prompt:'tampered prompt'});
    assert.equal(bad.status,403);
    const countBefore=calls;
    const [result,retry]=await Promise.all([post('/infer',payload),post('/infer',payload)]);
    assert.equal(result.status,200,await result.clone().text());
    assert.equal(retry.status,200,await retry.clone().text());
    const invoice=await result.json() as {text:string,inputTokens:number,outputTokens:number,responseHash:Hex,amountWei:string,signature:Hex};
    assert.equal(calls,countBefore+1,'Concurrent inference must call paid upstream exactly once.');
    assert.deepEqual(await retry.json(),invoice);
    const counts=index===0?[30,11]:index===1?[37,13]:[41,17];
    assert.equal(invoice.inputTokens,counts[0]);
    assert.equal(invoice.outputTokens,counts[1]);
    assert.equal(invoice.responseHash,contentHash(invoice.text));
    const cost=quoteCost(BigInt(invoice.inputTokens),BigInt(invoice.outputTokens),inputPrice,outputPrice);
    assert.equal(BigInt(invoice.amountWei),cost);
    assert.equal(await verifyTypedData({address:operator.address,domain:invoiceDomain(31337,escrow),types:invoiceTypes,primaryType:'Invoice',message:{requestId,responseHash:invoice.responseHash,inputTokens:BigInt(invoice.inputTokens),outputTokens:BigInt(invoice.outputTokens),amountWei:cost},signature:invoice.signature}),true);
    const approval=await buyer.signTypedData({domain:escrowDomain(31337,escrow),types:usageTypes,primaryType:'UsageReceipt',message:{requestId,inputTokens:BigInt(invoice.inputTokens),outputTokens:BigInt(invoice.outputTokens),responseHash:invoice.responseHash}});
    const settled=await post('/settle',{requestId:String(requestId),inputTokens:invoice.inputTokens,outputTokens:invoice.outputTokens,responseHash:invoice.responseHash,signature:approval});
    assert.equal(settled.status,200,await settled.clone().text());
    const settlement=await settled.json() as {transactionHash:Hex};
    await mined(settlement.transactionHash);
    const funded=await client.readContract({address:escrow,abi:escrowAbi,functionName:'getRequest',args:[requestId]});
    assert.equal(funded.closed,true);
    const replay=await post('/settle',{requestId:String(requestId),inputTokens:invoice.inputTokens,outputTokens:invoice.outputTokens,responseHash:invoice.responseHash,signature:approval});
    assert.equal(replay.status,409);
    console.log(`PASS ${model.model}: chain discovery → authenticated peer → paid API fixture → signed usage → settlement; duplicate requests called upstream once.`);
  }
  const providerCredit=await client.readContract({address:escrow,abi:escrowAbi,functionName:'credits',args:[owner.address]});
  const consumerCredit=await client.readContract({address:escrow,abi:escrowAbi,functionName:'credits',args:[buyer.address]});
  assert.equal(providerCredit+consumerCredit,parseEther('0.003'));
  await mined(await ownerWallet.writeContract({address:escrow,abi:escrowAbi,functionName:'withdraw'}));
  await mined(await buyerWallet.writeContract({address:escrow,abi:escrowAbi,functionName:'withdraw'}));
  assert.equal(await client.getBalance({address:escrow}),0n);
  // Explicit local simulation: action key is a throwaway account, never hardware evidence.
  const policy:PrivacyConfig={version:1,backend:'lit-chipotle',actionId:'Qm'+'1'.repeat(44),actionPublicKey:operator.publicKey.toLowerCase(),runtimePolicyId:'LOCAL-SIMULATION-ONLY',models:[{model:models[1].model,upstreamModel:models[1].upstreamModel,apiKind:2,origin:'https://api.openai.com',accountPolicyId:'LOCAL-FIXTURE-NOT-AN-APPROVED-ACCOUNT',credentialCommitment:contentHash('fixture-only')}]};
  const policyHash=configHash(policy);
  const mockArtifact=JSON.parse(await readFile('out/LocalPrivacyVerifier.sol/LocalPrivacyVerifier.json','utf8'));
  const mockReceipt=await mined(await adminWallet.deployContract({abi:mockArtifact.abi,bytecode:mockArtifact.bytecode.object,args:[escrow]}));
  const mock=mockReceipt.contractAddress!;
  await mined(await adminWallet.writeContract({address:registry,abi:registryAbi,functionName:'configureLocalTestPrivacyVerifier',args:[mock]}));
  const encryptionKeyHash=keyHash(await exportKey((await deriveActionEncryptionKeys(operatorKey)).publicKey));
  await mined(await adminWallet.writeContract({address:mock,abi:mockArtifact.abi,functionName:'approve',args:[owner.address,policyHash,encryptionKeyHash]}));
  await mined(await ownerWallet.writeContract({address:registry,abi:registryAbi,functionName:'setPrivacyConfig',args:[policyHash]}));
  const privateConfig={...config,models:[{...models[1],apiKind:2 as const,baseUrl:'https://api.openai.com'}]};
  const privateChain=await connectChain(privateConfig);
  const privateUpstream=(model:ModelConfig,prompt:string,maximum:number)=>callPaidApi({...model,baseUrl:upstreamUrl},prompt,maximum,{env,timeoutMs:1000});
  const gateway=await PrivacyGateway.create({policy,config:privateConfig,chain:privateChain,upstream:privateUpstream});
  const prompt='Local private fixture: never publish the prompt or secret salt.';
  const salt=randomHash(),promptHash=commitment('prompt',prompt,salt,policyHash);
  const reply=await suite.kem.generateKeyPair();const replySpki=await exportKey(reply.publicKey);
  const pre:PrivacyContext={version:1,chainId:31337,registry,escrow,provider:owner.address,operator:operator.address,consumer:buyer.address,offerId:offerId(owner.address,models[1].model),configHash:policyHash,requestId:'0',promptHash,maxOutputTokens:128,challenge:randomHash(),responseKeyHash:keyHash(replySpki),issuedAt:Date.now()};
  await verifyLitKeyBinding(await gateway.attest(pre),pre,policy);
  const privateId=await client.readContract({address:escrow,abi:escrowAbi,functionName:'nextRequestId'});
  await mined(await buyerWallet.writeContract({address:escrow,abi:escrowAbi,functionName:'fundPrivate',args:[pre.offerId,promptHash,(await client.getBlock()).timestamp+600n,policyHash],value:parseEther('0.001')}));
  const context:PrivacyContext={...pre,requestId:String(privateId),challenge:randomHash(),issuedAt:Date.now()};
  const binding=await gateway.attest(context);const key=await verifyLitKeyBinding(binding,context,policy);
  const privateSignature=await buyer.signTypedData({domain:escrowDomain(31337,escrow),types:privateInferenceTypes,primaryType:'PrivateInferenceRequest',message:{requestId:privateId,promptHash,maxOutputTokens:128n,contextHash:contextHash(context),enclaveKeyHash:keyHash(binding.publicKey)}});
  const encryptedRequest={context,envelope:await seal(key,context,'request',{prompt,promptSalt:salt,replyKey:replySpki,signature:privateSignature})};
  assert.ok(!JSON.stringify(encryptedRequest).includes(prompt));assert.ok(!JSON.stringify(encryptedRequest).includes(salt));
  const callsBefore=calls;
  const encryptedAnswer=await gateway.infer(encryptedRequest);
  const invoice=await open(reply.privateKey,context,'response',encryptedAnswer) as Invoice;
  assert.equal(invoice.responseHash,commitment('response',invoice.text,invoice.responseSalt!,policyHash));
  assert.equal(calls,callsBefore+1);
  assert.equal(await client.readContract({address:escrow,abi:escrowAbi,functionName:'privacyStarted',args:[privateId]}),true);
  assert.equal(await client.readContract({address:escrow,abi:escrowAbi,functionName:'requestPrivacyConfig',args:[privateId]}),policyHash);
  const restarted=await PrivacyGateway.create({policy,config:privateConfig,chain:privateChain,upstream:privateUpstream});
  await assert.rejects(restarted.infer(encryptedRequest));assert.equal(calls,callsBefore+1);
  const approval=await buyer.signTypedData({domain:escrowDomain(31337,escrow),types:usageTypes,primaryType:'UsageReceipt',message:{requestId:privateId,inputTokens:BigInt(invoice.inputTokens),outputTokens:BigInt(invoice.outputTokens),responseHash:invoice.responseHash}});
  await mined(await buyerWallet.writeContract({address:escrow,abi:escrowAbi,functionName:'settle',args:[privateId,BigInt(invoice.inputTokens),BigInt(invoice.outputTokens),invoice.responseHash,approval]}));
  assert.equal((await client.readContract({address:escrow,abi:escrowAbi,functionName:'getRequest',args:[privateId]})).closed,true);
  assert.equal(await client.readContract({address:escrow,abi:escrowAbi,functionName:'credits',args:[owner.address]})+await client.readContract({address:escrow,abi:escrowAbi,functionName:'credits',args:[buyer.address]}),parseEther('0.001'));
  await mined(await ownerWallet.writeContract({address:escrow,abi:escrowAbi,functionName:'withdraw'}));await mined(await buyerWallet.writeContract({address:escrow,abi:escrowAbi,functionName:'withdraw'}));
  console.log('PASS local private simulation: policy-bound funding → action-signed HPKE key → encrypted prompt/answer → durable on-chain replay claim → consumer-approved settlement. No Lit service or hardware validation.');
  const refundId=await client.readContract({address:escrow,abi:escrowAbi,functionName:'nextRequestId'});
  const expiry=(await client.getBlock()).timestamp+600n;
  await mined(await buyerWallet.writeContract({address:escrow,abi:escrowAbi,functionName:'fund',args:[offerId(owner.address,models[0]!.model),contentHash('expired local test'),expiry],value:parseEther('0.001')}));
  await client.request({method:'evm_setNextBlockTimestamp' as never,params:[Number(expiry)] as never});
  await mined(await buyerWallet.writeContract({address:escrow,abi:escrowAbi,functionName:'refundExpired',args:[refundId],gas:250_000n}));
  assert.equal(await client.readContract({address:escrow,abi:escrowAbi,functionName:'credits',args:[buyer.address]}),parseEther('0.001'));
  console.log('PASS fixed recipient credits, withdrawals, full expiry refund, all balances conserved. Local test chain 31337 only; no Monad deployment or real paid API usage performed.');
  // Prepaid API key: one deposit, repeated bearer-key calls, operator-metered charges, consumer close/refund.
  const secret='ab'.repeat(32), passId=await client.readContract({address:escrow,abi:escrowAbi,functionName:'nextPassId'});
  const passExpiry=(await client.getBlock()).timestamp+3600n;
  await mined(await buyerWallet.writeContract({address:escrow,abi:escrowAbi,functionName:'openPass',args:[owner.address,keccak256(`0x${secret}`),inputPrice*2n,outputPrice*2n,parseEther('0.005'),passExpiry],value:parseEther('0.01')}));
  const providerBefore=await client.readContract({address:escrow,abi:escrowAbi,functionName:'credits',args:[owner.address]});
  for (let i=0;i<2;i++) {
    const res=await fetch(`${endpoint}/v1/chat/completions`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer pt_${passId}_${secret}`},body:JSON.stringify({model:models[1]!.model,messages:[{role:'user',content:`pass call ${i}`}],max_tokens:64})});
    assert.equal(res.status,200,await res.clone().text());
  }
  for (let i=0;i<40&&(await client.readContract({address:escrow,abi:escrowAbi,functionName:'getPass',args:[passId]})).spent===0n;i++) await new Promise(r=>setTimeout(r,250));
  await new Promise(r=>setTimeout(r,1500));
  const used=await client.readContract({address:escrow,abi:escrowAbi,functionName:'getPass',args:[passId]});
  assert.ok(used.spent>0n&&used.spent<used.deposit);
  assert.equal((await client.readContract({address:escrow,abi:escrowAbi,functionName:'credits',args:[owner.address]}))-providerBefore,used.spent);
  const buyerBefore=await client.readContract({address:escrow,abi:escrowAbi,functionName:'credits',args:[buyer.address]});
  await mined(await buyerWallet.writeContract({address:escrow,abi:escrowAbi,functionName:'closePass',args:[passId]}));
  assert.equal((await client.readContract({address:escrow,abi:escrowAbi,functionName:'credits',args:[buyer.address]}))-buyerBefore,used.deposit-used.spent);
  assert.equal((await fetch(`${endpoint}/v1/chat/completions`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer pt_${passId}_${secret}`},body:JSON.stringify({model:models[1]!.model,messages:[{role:'user',content:'after close'}]})})).status,402);
  console.log('PASS prepaid API key: one deposit → repeated bearer calls with no wallet approval → on-chain per-call charges → close refunds the unspent remainder → closed key rejected.');
} finally {
  if(supplier) await supplier.close();
  if(upstream.listening) await new Promise<void>(resolve=>upstream.close(()=>resolve()));
  anvil.kill('SIGTERM');
  await rm(directory,{recursive:true,force:true});
}
