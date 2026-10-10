import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, realpath, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyTypedData, zeroAddress, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { contentHash, escrowDomain, identityDomain, identityTypes, inferenceTypes, invoiceDomain, invoiceTypes, offerId, usageTypes } from '../src/shared/protocol.js';
import { ProviderCore } from '../src/provider/core.js';
import { ProviderError } from '../src/provider/errors.js';
import { FileStateStore, MemoryStateStore } from '../src/provider/persistence.js';
import { createProviderServer } from '../src/provider/server.js';
import type { FundedRequest, InferenceInput, PeerRecord, ProviderChain, ProviderConfig, UpstreamResult } from '../src/provider/types.js';
import { ApiKeyStore } from '../src/accounts/api-keys.js';

const nodeKey = `0x${'2'.repeat(64)}` as Hex;
const operator = privateKeyToAccount(nodeKey);
const consumer = privateKeyToAccount(`0x${'1'.repeat(64)}`);
const provider = privateKeyToAccount(`0x${'3'.repeat(64)}`).address;
const registry = '0x4444444444444444444444444444444444444444' as Address;
const escrow = '0x5555555555555555555555555555555555555555' as Address;
const prompt = 'test prompt';
function setup(options: { request?: Partial<FundedRequest>; peer?: Partial<PeerRecord>; consumerActive?: boolean; upstream?: () => Promise<UpstreamResult>; store?: MemoryStateStore } = {}) {
  const config: ProviderConfig = { provider, privateKey: nodeKey, registry, escrow, chainId: 31337, rpcUrl: 'http://127.0.0.1:8545', models: [{ model: 'anthropic/test', apiKind: 1, upstreamModel: 'test', apiKeyEnv: 'TEST_KEY', baseUrl: 'http://127.0.0.1:8000' }], allowedOrigins: ['http://localhost:5173'], stateDir: '/tmp/provider-test-unused', port: 0, maxOutputTokens: 100, maxPromptBytes: 32000, upstreamTimeoutMs: 60000, maxStateEntries: 10, localMode: true };
  const request: FundedRequest = { consumer: consumer.address, provider, offerId: offerId(provider, 'anthropic/test'), promptHash: contentHash(prompt), deposit: 1000n, inputPrice: 1_000_000n, outputPrice: 1_000_000n, expiresAt: 1800n, closed: false, ...options.request };
  let paidCalls = 0;
  let settlements = 0;
  const chain: ProviderChain = {
    getRequestPrivacy: async () => `0x${'0'.repeat(64)}`,
    isPrivacyVerified:async()=>false,getVerifiedEncryptionKeyHash:async()=>`0x${'0'.repeat(64)}`,
    getPrivacyConfig: async () => `0x${'0'.repeat(64)}`,
    claimPrivate: async () => { throw new Error('Not a private fixture'); },
    getRequest: async () => request,
    getPeer: async address => address === provider ? { roles: 1, active: true, operator: operator.address, endpoint: 'https://peer.example', metadataURI: '', ...options.peer } : { roles: 2, active: options.consumerActive ?? true, operator: zeroAddress, endpoint: '', metadataURI: '' },
    getOffer: async () => ({ provider, model: 'anthropic/test', apiKind: 1, inputPrice: 1_000_000n, outputPrice: 1_000_000n, active: true }),
    getPass: async () => { throw new Error('Not a pass fixture'); }, chargePass: async () => { throw new Error('Not a pass fixture'); },
    settle: async () => { settlements++; return `0x${'a'.repeat(64)}`; },
  };
  const upstream = async () => { paidCalls++; return options.upstream ? options.upstream() : { text: 'response', inputTokens: 5, outputTokens: 3 }; };
  const store = options.store ?? new MemoryStateStore();
  const core = new ProviderCore({ config, chain, store, upstream, now: () => 1000 });
  async function authorization(maxOutputTokens = 10, id = '1'): Promise<InferenceInput> {
    const signature = await consumer.signTypedData({ domain: escrowDomain(config.chainId, escrow), types: inferenceTypes, primaryType: 'InferenceRequest', message: { requestId: BigInt(id), promptHash: request.promptHash, maxOutputTokens: BigInt(maxOutputTokens) } });
    return { requestId: id, prompt, maxOutputTokens, signature };
  }
  return { core, config, chain, store, request, upstream, authorization, paidCalls: () => paidCalls, settlements: () => settlements };
}
function code(expected: string) { return (error: unknown) => error instanceof ProviderError && error.code === expected; }

test('registered identity proves the exact operator key with a fresh challenge', async () => {
  const fixture = setup();
  const challenge = contentHash('random challenge');
  const result = await fixture.core.identity(challenge);
  assert.equal(await verifyTypedData({ address: operator.address, domain: identityDomain(31337, registry), types: identityTypes, primaryType: 'PeerIdentity', message: { challenge, provider, registry }, signature: result.signature }), true);
  await assert.rejects(setup({ peer: { operator: consumer.address } }).core.identity(challenge), code('operator_mismatch'));
  await assert.rejects(fixture.core.identity('0x1234'), code('invalid_challenge'));
});
test('funded signed inference returns a verifiable invoice and exact ceiling charge', async () => {
  const fixture = setup({ request: { inputPrice: 1_500_001n, outputPrice: 2_500_003n }, upstream: async () => ({ text: 'response', inputTokens: 2, outputTokens: 3 }) });
  const invoice = await fixture.core.infer(await fixture.authorization());
  assert.equal(invoice.amountWei, '11');
  assert.equal(invoice.responseHash, contentHash(invoice.text));
  assert.equal(await verifyTypedData({ address: operator.address, domain: invoiceDomain(31337, escrow), types: invoiceTypes, primaryType: 'Invoice', message: { requestId: 1n, responseHash: invoice.responseHash, inputTokens: 2n, outputTokens: 3n, amountWei: 11n }, signature: invoice.signature }), true);
  assert.equal(fixture.paidCalls(), 1);
});
test('even funded authorized requests cannot route personal OAuth through a supplier adapter', async () => {
  const fixture = setup();
  fixture.config.models[0].authentication = { kind: 'chatgpt-oauth', provider: 'openai', billingSource: 'chatgpt-plan', usage: 'personal-local', credentialRef: '00000000-0000-4000-8000-000000000001' };
  await assert.rejects(fixture.core.infer(await fixture.authorization()), code('subscription_resale_unavailable'));
  assert.equal(fixture.paidCalls(), 0);
  assert.equal(fixture.store.get('1'), undefined);
});
test('authorization, ownership, registry and deadlines gate all paid upstream calls', async () => {
  for (const [options, expected] of [
    [{ request: { provider: consumer.address } }, 'wrong_provider'],
    [{ request: { closed: true } }, 'request_closed'],
    [{ request: { expiresAt: 1119n } }, 'insufficient_deadline'],
    [{ peer: { active: false } }, 'inactive_provider'],
    [{ peer: { operator: consumer.address } }, 'operator_mismatch'],
    [{ consumerActive: false }, 'consumer_not_registered'],
    [{ request: { deposit: 1n } }, 'insufficient_budget'],
  ] as const) {
    const fixture = setup(options);
    await assert.rejects(fixture.core.infer(await fixture.authorization()), code(expected));
    assert.equal(fixture.paidCalls(), 0);
  }
  const fixture = setup();
  const input = await fixture.authorization();
  await assert.rejects(fixture.core.infer({ ...input, prompt: 'different' }), code('prompt_mismatch'));
  await assert.rejects(fixture.core.infer({ ...input, maxOutputTokens: 11 }), code('invalid_signature'));
  await assert.rejects(fixture.core.infer({ ...input, signature: `0x${'0'.repeat(130)}` }), code('invalid_signature'));
  assert.equal(fixture.paidCalls(), 0);
});
test('concurrent requests and retries make one paid call and preserve the same invoice', async () => {
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const start = new Promise<void>(resolve => { started = resolve; });
  const fixture = setup({ upstream: async () => { started(); await gate; return { text: 'response', inputTokens: 5, outputTokens: 3 }; } });
  const input = await fixture.authorization();
  const first = fixture.core.infer(input);
  await start;
  const second = fixture.core.infer(input);
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.deepEqual(a, b);
  assert.deepEqual(await fixture.core.infer(input), a);
  assert.equal(fixture.paidCalls(), 1);
  await assert.rejects(fixture.core.infer(await fixture.authorization(11)), code('replay_mismatch'));
});
test('request IDs must be canonical strings so JSON numbers cannot bypass replay keys', async () => {
  const fixture = setup();
  const input = await fixture.authorization();
  const numeric = { ...input, requestId: 1 } as unknown as InferenceInput;
  await assert.rejects(fixture.core.infer(numeric), code('invalid_request'));
  await assert.rejects(fixture.core.recover(numeric), code('invalid_request'));
  await fixture.core.infer(input);
  await assert.rejects(fixture.core.infer(numeric), code('invalid_request'));
  await assert.rejects(fixture.core.settle({ requestId: 1, inputTokens: 5, outputTokens: 3, responseHash: contentHash('response'), signature: input.signature } as unknown as Parameters<ProviderCore['settle']>[0]), code('invalid_receipt'));
  assert.equal(fixture.paidCalls(), 1);
});
test('interrupted or failed paid requests remain nonretryable after node restart', async () => {
  const fixture = setup({ upstream: async () => { throw new ProviderError(502, 'upstream_unavailable', 'Unavailable.'); } });
  const input = await fixture.authorization();
  await assert.rejects(fixture.core.infer(input), code('upstream_unavailable'));
  await assert.rejects(fixture.core.infer(input), code('request_not_retryable'));
  assert.equal(fixture.paidCalls(), 1);
  const restarted = setup({ store: fixture.store });
  await assert.rejects(restarted.core.infer(input), code('request_not_retryable'));
  assert.equal(restarted.paidCalls(), 0);
  const pending = setup();
  await pending.store.set('1', { status: 'pending', promptHash: contentHash(prompt), maxOutputTokens: 10 });
  await assert.rejects(pending.core.infer(await pending.authorization()), code('request_not_retryable'));
});
test('usage limits, zero charge and invoice deposits are enforced after paid execution', async () => {
  const exactly = setup({ request: { deposit: 5n }, upstream: async () => ({ text: 'response', inputTokens: 2, outputTokens: 3 }) });
  assert.equal((await exactly.core.infer(await exactly.authorization(3))).amountWei, '5');
  const exceeded = setup({ request: { deposit: 5n }, upstream: async () => ({ text: 'response', inputTokens: 3, outputTokens: 3 }) });
  await assert.rejects(exceeded.core.infer(await exceeded.authorization(3)), code('invoice_exceeds_deposit'));
  const output = setup({ upstream: async () => ({ text: 'response', inputTokens: 1, outputTokens: 11 }) });
  await assert.rejects(output.core.infer(await output.authorization()), code('invalid_upstream_usage'));
  const zero = setup({ upstream: async () => ({ text: 'response', inputTokens: 0, outputTokens: 0 }) });
  await assert.rejects(zero.core.infer(await zero.authorization()), code('invalid_upstream_usage'));
});
test('consumer approval must match cached invoice; provider never settles changed usage', async () => {
  const fixture = setup();
  const invoice = await fixture.core.infer(await fixture.authorization());
  const signature = await consumer.signTypedData({ domain: escrowDomain(31337, escrow), types: usageTypes, primaryType: 'UsageReceipt', message: { requestId: 1n, inputTokens: 5n, outputTokens: 3n, responseHash: invoice.responseHash } });
  const receipt = { requestId: '1', inputTokens: 5, outputTokens: 3, responseHash: invoice.responseHash, signature };
  await assert.rejects(fixture.core.settle({ ...receipt, inputTokens: 6 }), code('invoice_mismatch'));
  await assert.rejects(fixture.core.settle({ ...receipt, signature: `0x${'0'.repeat(130)}` }), code('invalid_signature'));
  assert.equal(fixture.settlements(), 0);
  assert.match(await fixture.core.settle(receipt), /^0x/);
  assert.equal(fixture.settlements(), 1);
});
test('authenticated recovery works without another paid call even near expiry', async () => {
  const fixture = setup();
  const input = await fixture.authorization();
  const invoice = await fixture.core.infer(input);
  fixture.request.expiresAt = 1001n;
  assert.deepEqual(await fixture.core.recover(input), invoice);
  await assert.rejects(fixture.core.recover({ ...input, maxOutputTokens: 11 }), code('invalid_signature'));
  assert.equal(fixture.paidCalls(), 1);
});
test('durable journal survives restart, refuses parallel nodes, and never evicts replay IDs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'peer-tokens-journal-'));
  try {
    const first = await FileStateStore.open(dir, 1);
    await first.set('1', { status: 'pending', promptHash: contentHash(prompt), maxOutputTokens: 10 });
    await assert.rejects(FileStateStore.open(dir, 1), /locked/);
    await assert.rejects(first.set('2', { status: 'pending', promptHash: contentHash(prompt), maxOutputTokens: 10 }), code('state_capacity_reached'));
    await first.close();
    const restarted = await FileStateStore.open(dir, 1);
    assert.equal(restarted.get('1')?.status, 'pending');
    await restarted.close();
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('HTTP server exposes only public config, limits CORS, and sanitizes failures', async () => {
  const fixture = setup();
  const node = await createProviderServer(fixture.config, { chain: fixture.chain, store: fixture.store, now: () => 1000, upstream: fixture.upstream });
  await new Promise<void>(resolve => node.server.listen(0, '127.0.0.1', resolve));
  const address = node.server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const health = await (await fetch(`${base}/health`)).text();
    assert.ok(health.includes('anthropic/test'));
    assert.ok(!health.includes('apiKeyEnv') && !health.includes(nodeKey) && !health.includes('baseUrl'));
    assert.equal((await fetch(`${base}/health`, { headers: { origin: 'https://untrusted.example' } })).status, 403);
    const identity = await fetch(`${base}/identity?challenge=${contentHash('nonce')}`, { headers: { origin: 'http://localhost:5173' } });
    assert.equal(identity.headers.get('access-control-allow-origin'), 'http://localhost:5173');
    const input = await fixture.authorization();
    const invoice = await (await fetch(`${base}/infer`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) })).json();
    assert.equal(invoice.amountWei, '8');
    const recovered = await (await fetch(`${base}/requests/1?maxOutputTokens=10`, { headers: { 'x-inference-signature': input.signature } })).json();
    assert.deepEqual(recovered, invoice);
    assert.equal(fixture.paidCalls(), 1);
    assert.equal((await fetch(`${base}/infer`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' })).status, 400);
  } finally { await node.close(); }
});
test('provider HTTP path resolves selected managed keys for funded inference and blocks removed refs',async()=>{
  const directory=await realpath(await mkdtemp(join(tmpdir(),'managed-provider-fixture-')));await chmod(directory,0o700);
  const keys=await ApiKeyStore.open(directory,provider);const fixture=setup();
  const saved=await keys.save({provider:'anthropic',model:'anthropic/test',upstreamModel:'test',baseUrl:'https://api.anthropic.com',apiKey:'sk-managed-local-fixture-secret'});
  assert.ok(saved.providerModelConfig);
  fixture.config.models=[saved.providerModelConfig];fixture.config.accountStateDir=directory;
  const originalFetch=globalThis.fetch;let paidCalls=0;
  globalThis.fetch=(async(url,options)=>{
    if(String(url)==='https://api.anthropic.com/v1/messages'){
      paidCalls++;assert.equal(new Headers(options?.headers).get('x-api-key'),'sk-managed-local-fixture-secret');
      return Response.json({content:[{type:'text',text:'managed key fixture response'}],usage:{input_tokens:5,output_tokens:3}});
    }
    return originalFetch(url,options);
  }) as typeof fetch;
  const node=await createProviderServer(fixture.config,{chain:fixture.chain,store:fixture.store,now:()=>1000,env:{}});
  await new Promise<void>(resolve=>node.server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${(node.server.address() as {port:number}).port}`;
  try{
    const health=await originalFetch(base+'/health');assert.equal(health.status,200);
    const publicHealth=await health.text();assert.ok(!publicHealth.includes(saved.credentialRef));assert.ok(!publicHealth.includes('sk-managed'));
    const response=await originalFetch(base+'/infer',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(await fixture.authorization())});assert.equal(response.status,200);
    const invoice=await response.json();assert.equal(invoice.text,'managed key fixture response');assert.equal(invoice.amountWei,'8');assert.equal(paidCalls,1);
    await keys.remove(saved.credentialRef);
    assert.equal((await originalFetch(base+'/health')).status,503);
    assert.equal((await originalFetch(base+'/infer',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(await fixture.authorization(10,'2'))})).status,503);
    assert.equal(paidCalls,1);
  }finally{globalThis.fetch=originalFetch;await node.close();await keys.close();await rm(directory,{recursive:true,force:true});}
});
