import test from 'node:test';
import assert from 'node:assert/strict';
import { keccak256, zeroAddress, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { offerId } from '../src/shared/protocol.js';
import { MemoryStateStore } from '../src/provider/persistence.js';
import { createProviderServer } from '../src/provider/server.js';
import type { PassCharge, PassRecord, ProviderChain, ProviderConfig } from '../src/provider/types.js';

const nodeKey = `0x${'2'.repeat(64)}` as Hex;
const operator = privateKeyToAccount(nodeKey);
const consumer = privateKeyToAccount(`0x${'1'.repeat(64)}`).address;
const provider = privateKeyToAccount(`0x${'3'.repeat(64)}`).address;
const secret = 'ab'.repeat(32);
const key = `pt_7_${secret}`;
const model = 'openai/gpt-test';

async function fixture(pass: Partial<PassRecord> = {}, offer: { inputPrice?: bigint; outputPrice?: bigint; active?: boolean } = {}) {
  const config: ProviderConfig = { provider, privateKey: nodeKey, registry: '0x4444444444444444444444444444444444444444' as Address, escrow: '0x5555555555555555555555555555555555555555' as Address, chainId: 31337, rpcUrl: 'http://127.0.0.1:1', models: [{ model, apiKind: 2, upstreamModel: 'gpt-test', apiKeyEnv: 'K', baseUrl: 'http://127.0.0.1:1' }], allowedOrigins: ['http://localhost:5173'], stateDir: '/tmp/unused', port: 0, maxOutputTokens: 4096, maxPromptBytes: 32000, upstreamTimeoutMs: 1000, maxStateEntries: 10, localMode: true };
  const record: PassRecord = { consumer, provider, keyHash: keccak256(`0x${secret}`), deposit: 10n ** 18n, spent: 0n, maxInputPrice: 10n ** 18n, maxOutputPrice: 10n ** 18n, maxCallCost: 10n ** 17n, expiresAt: 5000n, closed: false, ...pass };
  const charges: PassCharge[] = [];
  let calls = 0;
  const chain = {
    getPass: async () => record,
    chargePass: async (c: PassCharge) => { await new Promise(r => setTimeout(r, 100)); charges.push(c); record.spent += 1n; return `0x${'a'.repeat(64)}` as Hex; },
    getPeer: async () => ({ roles: 1, active: true, operator: operator.address, endpoint: '', metadataURI: '' }),
    getOffer: async () => ({ provider, model, apiKind: 2, inputPrice: 10n ** 15n, outputPrice: 2n * 10n ** 15n, active: true, ...offer }),
    getRequestPrivacy: async () => `0x${'0'.repeat(64)}`, settle: async () => { throw new Error('unused'); }, getRequest: async () => { throw new Error('unused'); },
    isPrivacyVerified: async () => false, getVerifiedEncryptionKeyHash: async () => `0x${'0'.repeat(64)}`, getPrivacyConfig: async () => `0x${'0'.repeat(64)}`, claimPrivate: async () => { throw new Error('unused'); },
  } as unknown as ProviderChain;
  const node = await createProviderServer(config, { chain, store: new MemoryStateStore(), now: () => 1000, upstream: async () => { calls++; return { text: 'hello back', inputTokens: 5, outputTokens: 3 }; } });
  await new Promise<void>(resolve => node.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(node.server.address() as { port: number }).port}`;
  const post = (body: unknown, bearer: string | undefined = key) => fetch(`${base}/v1/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) }, body: JSON.stringify(body) });
  return { node, base, post, charges, calls: () => calls, record };
}
const chat = { model, messages: [{ role: 'user', content: 'hi' }], max_tokens: 50 };

test('a prepaid key serves repeated OpenAI-style calls with no consumer approval and charges on-chain per call', async () => {
  const f = await fixture();
  try {
    for (let i = 0; i < 2; i++) {
      const res = await f.post(chat), body = await res.json() as any;
      assert.equal(res.status, 200);
      assert.equal(body.choices[0].message.content, 'hello back');
      assert.deepEqual(body.usage, { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 });
    }
    await new Promise(r => setTimeout(r, 300));
    assert.equal(f.charges.length, 2);
    assert.equal(f.charges[0]!.passId, 7n);
    assert.equal(f.charges[0]!.offerId, offerId(provider, model));
    assert.notEqual(f.charges[0]!.callId, f.charges[1]!.callId);
    const models = await (await fetch(`${f.base}/v1/models`)).json() as any;
    assert.equal(models.data[0].id, model);
  } finally { await f.node.close(); }
});

test('bare model names and streaming work', async () => {
  const f = await fixture();
  try {
    const res = await f.post({ ...chat, model: 'gpt-test', stream: true });
    const text = await res.text();
    assert.equal(res.status, 200);
    assert.match(text, /"content":"hello back"/);
    assert.match(text, /data: \[DONE\]/);
  } finally { await f.node.close(); }
});

test('wrong, missing, closed, expired and foreign keys never reach the paid API', async () => {
  const cases: Array<[string, Partial<PassRecord>, string | undefined, number]> = [
    ['missing', {}, '', 401], ['malformed', {}, 'sk-nope', 401], ['wrong secret', {}, `pt_7_${'cd'.repeat(32)}`, 401],
    ['closed', { closed: true }, key, 402], ['expired', { expiresAt: 1010n }, key, 402], ['other provider', { provider: zeroAddress }, key, 403],
  ];
  for (const [name, pass, bearer, status] of cases) {
    const f = await fixture(pass);
    try { assert.equal((await f.post(chat, bearer)).status, status, name); assert.equal(f.calls(), 0, name); } finally { await f.node.close(); }
  }
});

test('price ceilings, per-call cap, remaining balance and unknown models reject before the paid call', async () => {
  const cases: Array<[string, Partial<PassRecord>, object, number]> = [
    ['input ceiling', { maxInputPrice: 1n }, chat, 402], ['per-call cap', { maxCallCost: 1n }, chat, 402],
    ['balance', { deposit: 10n, spent: 5n }, chat, 402], ['unknown model', {}, { ...chat, model: 'nope' }, 404], ['bad messages', {}, { model, messages: [] }, 400],
  ];
  for (const [name, pass, body, status] of cases) {
    const f = await fixture(pass);
    try { assert.equal((await f.post(body)).status, status, name); assert.equal(f.calls(), 0, name); } finally { await f.node.close(); }
  }
  const f = await fixture({}, { active: false });
  try { assert.equal((await f.post(chat)).status, 409); } finally { await f.node.close(); }
});

test('concurrent calls cannot overspend: the reserve is held until the charge lands', async () => {
  // Worst-case reserve per call is ~1.02e11 wei here; fund 1.5 reserves so only one call fits at a time.
  const f = await fixture({ deposit: 150_000_000_000n });
  try {
    const results = await Promise.all([f.post(chat), f.post(chat), f.post(chat)]);
    const ok = results.filter(r => r.status === 200).length;
    assert.ok(ok >= 1 && ok < 3, `expected some but not all to be served, got ${ok}`);
  } finally { await f.node.close(); }
});
