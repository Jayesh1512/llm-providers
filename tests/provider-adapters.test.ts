import test from 'node:test';
import assert from 'node:assert/strict';
import { callPaidApi, parseUpstreamResponse } from '../src/provider/adapters.js';
import { loadConfig } from '../src/provider/config.js';
import { ProviderError } from '../src/provider/errors.js';
import type { ModelConfig } from '../src/provider/types.js';

const anthropic: ModelConfig = { model: 'anthropic/test', apiKind: 1, upstreamModel: 'claude-test', baseUrl: 'https://api.anthropic.com', apiKeyEnv: 'ANTHROPIC_API_KEY' };
test('paid API adapters parse provider usage rather than estimating text length', () => {
  assert.deepEqual(parseUpstreamResponse(1, { content: [{ type: 'text', text: 'hello' }, { type: 'thinking', thinking: 'private' }], usage: { input_tokens: 3, cache_creation_input_tokens: 4, cache_read_input_tokens: 5, output_tokens: 6 } }), { text: 'hello', inputTokens: 12, outputTokens: 6 });
  assert.deepEqual(parseUpstreamResponse(2, { output: [{ type: 'reasoning', summary: [] }, { type: 'message', content: [{ type: 'output_text', text: 'hello ' }, { type: 'output_text', text: 'world' }] }], usage: { input_tokens: 12, output_tokens: 8 } }), { text: 'hello world', inputTokens: 12, outputTokens: 8 });
  assert.deepEqual(parseUpstreamResponse(3, { choices: [{ message: { content: 'hello' } }], usage: { prompt_tokens: 7, completion_tokens: 2 } }), { text: 'hello', inputTokens: 7, outputTokens: 2 });
});
test('missing, fractional, negative, or unsafe usage is never replaced with guesses', () => {
  for (const usage of [undefined, {}, { input_tokens: 3 }, { input_tokens: -1, output_tokens: 2 }, { input_tokens: 1.5, output_tokens: 2 }, { input_tokens: Number.MAX_SAFE_INTEGER + 1, output_tokens: 2 }, { input_tokens: 2, output_tokens: 2, cache_read_input_tokens: -2 }]) {
    assert.throws(() => parseUpstreamResponse(1, { content: [{ type: 'text', text: 'hello' }], usage }), ProviderError);
  }
  assert.throws(() => parseUpstreamResponse(2, { output: [], usage: { input_tokens: 1, output_tokens: 1 } }), /usable text/);
  assert.throws(() => parseUpstreamResponse(3, { choices: [{ message: { content: null } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), /return text/);
});
test('Anthropic credentials are headers only and messages use the paid endpoint', async () => {
  let seen = false;
  const fakeFetch: typeof fetch = async (url, init) => {
    seen = true;
    assert.equal(url, 'https://api.anthropic.com/v1/messages');
    assert.equal((init?.headers as Record<string, string>)['x-api-key'], 'secret-fixture-key');
    assert.equal((init?.headers as Record<string, string>)['anthropic-version'], '2023-06-01');
    assert.equal(init?.redirect, 'error');
    assert.deepEqual(JSON.parse(String(init?.body)), { model: 'claude-test', max_tokens: 8, messages: [{ role: 'user', content: 'hello' }] });
    assert.ok(!String(init?.body).includes('secret-fixture-key'));
    return new Response(JSON.stringify({ content: [{ type: 'text', text: 'hi' }], usage: { input_tokens: 1, output_tokens: 2 } }));
  };
  assert.equal((await callPaidApi(anthropic, 'hello', 8, { fetch: fakeFetch, env: { ANTHROPIC_API_KEY: 'secret-fixture-key' } })).text, 'hi');
  assert.equal(seen, true);
});
test('Responses and compatible paid APIs use their distinct request formats', async () => {
  for (const apiKind of [2, 3] as const) {
    const model: ModelConfig = { ...anthropic, apiKind, baseUrl: 'https://paid.example/v1', apiKeyEnv: 'PAID_API_KEY' };
    await callPaidApi(model, 'hello', 8, { env: { PAID_API_KEY: 'secret' }, fetch: async (url, init) => {
      assert.equal(url, `https://paid.example/v1/${apiKind === 2 ? 'responses' : 'chat/completions'}`);
      const payload = JSON.parse(String(init?.body));
      if (apiKind === 2) assert.deepEqual(payload, { model: 'claude-test', input: 'hello', max_output_tokens: 8, store: false });
      else assert.deepEqual(payload, { model: 'claude-test', messages: [{ role: 'user', content: 'hello' }], max_tokens: 8 });
      const response = apiKind === 2 ? { output: [{ type: 'message', content: [{ type: 'output_text', text: 'hi' }] }], usage: { input_tokens: 1, output_tokens: 1 } } : { choices: [{ message: { content: 'hi' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } };
      return new Response(JSON.stringify(response));
    } });
  }
});
test('credentials are required and paid API failures never expose upstream bodies', async () => {
  let called = false;
  await assert.rejects(callPaidApi(anthropic, 'hello', 4, { env: {}, fetch: async () => { called = true; throw new Error(); } }), /not configured credentials/);
  assert.equal(called, false);
  await assert.rejects(callPaidApi(anthropic, 'hello', 4, { env: { ANTHROPIC_API_KEY: 'secret' }, fetch: async () => new Response('secret-account-id private-prompt', { status: 401 }) }), error => error instanceof ProviderError && error.message === 'The paid API rejected the request.');
  await assert.rejects(callPaidApi(anthropic, 'hello', 4, { env: { ANTHROPIC_API_KEY: 'secret' }, fetch: async () => { throw new Error('secret-account-id'); } }), error => error instanceof ProviderError && !error.message.includes('secret-account-id'));
});
test('configuration forbids production chains and non-HTTPS upstreams', () => {
  const env = { PROVIDER_ADDRESS: '0x1111111111111111111111111111111111111111', NODE_PRIVATE_KEY: `0x${'1'.repeat(64)}`, REGISTRY_ADDRESS: '0x2222222222222222222222222222222222222222', ESCROW_ADDRESS: '0x3333333333333333333333333333333333333333', MONAD_RPC_URL: 'https://testnet-rpc.monad.xyz', PROVIDER_MODELS_JSON: JSON.stringify([anthropic]) };
  assert.equal(loadConfig(env).chainId, 10143);
  assert.throws(() => loadConfig({ ...env, CHAIN_ID: '1' }), /Monad testnet/);
  assert.throws(() => loadConfig({ ...env, CHAIN_ID: '31337' }), /Monad testnet/);
  assert.equal(loadConfig({ ...env, CHAIN_ID: '31337', LOCAL_TEST_MODE: 'true' }).localMode, true);
  assert.throws(() => loadConfig({ ...env, PROVIDER_MODELS_JSON: JSON.stringify([{ ...anthropic, baseUrl: 'http://paid.example' }]) }), /HTTPS/);
  assert.throws(() => loadConfig({ ...env, ALLOWED_ORIGINS: '*' }), /exact origins/);
});
