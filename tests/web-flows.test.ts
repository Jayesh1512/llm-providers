import test from 'node:test';
import assert from 'node:assert/strict';
import { activeSupplierOffers, consumerModels, matchingSupplierOffers } from '../src/web/market-offers.js';
import { LocalAccountClient } from '../src/web/account-client.js';
import type { OfferWithId } from '../src/shared/protocol.js';
import type { AccountChallenge, SaveApiKeyInput } from '../src/shared/accounts.js';

const offer = (id: string, model: string, inputPrice: bigint, outputPrice: bigint, active = true, peerActive = true, roles = 1) => ({ id, model, inputPrice, outputPrice, active, peer: { active: peerActive, roles } } as unknown as OfferWithId);

test('model comparison matches exact IDs, active supplier roles, and separate rates without fallback', () => {
  const offers = [offer('a', 'openai/exact', 2n, 9n), offer('b', 'openai/exact', 5n, 1n), offer('c', 'openai/exact-plus', 1n, 1n), offer('paused', 'openai/exact', 1n, 1n, false), offer('peer-paused', 'openai/exact', 1n, 1n, true, false), offer('consumer-only', 'openai/exact', 1n, 1n, true, true, 2)];
  assert.deepEqual(matchingSupplierOffers(offers, '', 'input'), []);
  assert.deepEqual(matchingSupplierOffers(offers, 'openai/missing', 'input'), []);
  assert.deepEqual(matchingSupplierOffers(offers, 'OpenAI/exact', 'input'), []);
  assert.deepEqual(matchingSupplierOffers(offers, 'openai/exact', 'input').map(o => o.id), ['a', 'b']);
  assert.deepEqual(matchingSupplierOffers(offers, 'openai/exact', 'output').map(o => o.id), ['b', 'a']);
  assert.deepEqual(activeSupplierOffers(offers).map(o => o.id), ['a', 'b', 'c']);
  assert.deepEqual(offers.map(o => o.id), ['a', 'b', 'c', 'paused', 'peer-paused', 'consumer-only']);
});

test('consumer catalog includes popular and all listed models without inventing suppliers or merging exact IDs', () => {
  const model = 'anthropic/claude-sonnet-5-5';
  const a = '0x1111111111111111111111111111111111111111';
  const b = '0x2222222222222222222222222222222222222222';
  const listed = (id: string, model: string, provider: `0x${string}` = a, active = true) => ({ ...offer(id, model, 1n, 2n, active), provider });
  const models = consumerModels([
    listed('a', model), listed('b', model, b), listed('duplicate', model),
    listed('variant', `${model}-snapshot`), listed('compatible', 'custom/exact-model'),
    listed('paused', 'custom/paused', a, false),
  ], 'custom/removed');
  assert.equal(models.find(m => m.id === model)?.supplierCount, 2);
  assert.equal(models.find(m => m.id === model)?.label, 'Claude Sonnet 5.5');
  assert.equal(models.find(m => m.id === `${model}-snapshot`)?.supplierCount, 1);
  assert.equal(models.find(m => m.id === 'custom/exact-model')?.group, 'Available models');
  assert.equal(models.find(m => m.id === 'custom/removed')?.supplierCount, 0);
  assert.equal(models.find(m => m.id === 'custom/paused'), undefined);
  assert.equal(models.find(m => m.id === 'openai/gpt-6-astra')?.supplierCount, 0);
  assert.ok(consumerModels([]).every(m => m.supplierCount === 0));
});

test('API-key UI client requires wallet unlock, uses authenticated local routes, and never validates upstream automatically', async t => {
  const calls: { path: string; init?: RequestInit }[] = [];
  const wallet = '0x1111111111111111111111111111111111111111';
  const challenge: AccountChallenge = { operator: wallet, origin: 'http://127.0.0.1:5173', serviceId: `0x${'a'.repeat(64)}`, challenge: `0x${'b'.repeat(64)}`, expiresAt: Math.floor(Date.now() / 1000) + 60 };
  const priorFetch = globalThis.fetch;
  const priorLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { origin: challenge.origin } });
  globalThis.fetch = async (url, init) => {
    const parsed = new URL(String(url)); assert.equal(parsed.origin, 'http://127.0.0.1:8791'); calls.push({ path: parsed.pathname, init });
    if (parsed.pathname === '/accounts/info') return Response.json({ operator: wallet, serviceId: challenge.serviceId });
    if (parsed.pathname === '/accounts/challenge') return Response.json(challenge);
    if (parsed.pathname === '/accounts/session') return Response.json({ session: 'opaque-fixture', expiresAt: Math.floor(Date.now() / 1000) + 600 });
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer opaque-fixture');
    if (parsed.pathname === '/accounts/api-keys') return Response.json({ credentials: [] });
    if (parsed.pathname === '/accounts/api-keys/save' || parsed.pathname === '/accounts/api-keys/discover') return Response.json({ credential: { validation: 'unverified', catalog: { status: 'ready', models: [] } } });
    return Response.json({ removed: true });
  };
  t.after(() => { globalThis.fetch = priorFetch; if (priorLocation) Object.defineProperty(globalThis, 'location', priorLocation); else Reflect.deleteProperty(globalThis, 'location'); });
  const client = new LocalAccountClient();
  const input: SaveApiKeyInput = { provider: 'anthropic', apiKey: 'LOCAL-TEST-FIXTURE-ONLY', upstreamModel: 'fixture-model', model: 'anthropic/fixture-model', baseUrl: 'https://api.anthropic.com' };
  await assert.rejects(client.saveApiKey(input), /Unlock/); assert.equal(calls.length, 0);
  await client.unlock(wallet, async request => { assert.equal(request.message.origin, challenge.origin); return `0x${'0'.repeat(130)}`; });
  assert.equal(client.isUnlocked(), true);
  const saved = await client.saveApiKey(input); assert.equal(saved.credential.validation, 'unverified');
  const catalogInput: SaveApiKeyInput = { provider: 'openai', baseUrl: 'https://api.openai.com', apiKey: 'LOCAL-CATALOG-FIXTURE-ONLY', discoverModels: true };
  await client.saveApiKey(catalogInput); await client.discoverApiKey('fixture-reference');
  await client.apiKeys(); await client.removeApiKey('fixture-reference'); await client.lock();
  assert.equal(client.isUnlocked(), false);
  await assert.rejects(client.apiKeys(), /Unlock/);
  assert.deepEqual(calls.map(c => c.path), ['/accounts/info', '/accounts/challenge', '/accounts/session', '/accounts/api-keys/save', '/accounts/api-keys/save', '/accounts/api-keys/discover', '/accounts/api-keys', '/accounts/api-keys/remove', '/accounts/lock']);
  assert.deepEqual(JSON.parse(String(calls[3].init?.body)), input);
  assert.deepEqual(JSON.parse(String(calls[4].init?.body)), catalogInput);
  assert.deepEqual(JSON.parse(String(calls[5].init?.body)), { credentialRef: 'fixture-reference' });
});
