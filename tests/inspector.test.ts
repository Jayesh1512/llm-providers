import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectorHref, parseInspectorContext, validInspectorRequestId } from '../src/web/inspector-context.js';

const registry = '0x1111111111111111111111111111111111111111';
const escrow = '0x2222222222222222222222222222222222222222';
const provider = '0x3333333333333333333333333333333333333333';

test('inspector links carry only allowlisted public lookup context, never request content or credentials', () => {
  const context = { registry, escrow, provider, requestId: '12', prompt: 'TEST-SECRET-PROMPT', result: { text: 'TEST-SECRET-ANSWER' }, signature: 'TEST-AUTHORIZATION', apiKey: 'TEST-SECRET-KEY', token: 'TEST-TOKEN' } as const;
  const href = inspectorHref(context);
  const url = new URL(href, 'http://127.0.0.1:5173');
  assert.equal(url.pathname, '/inspector');
  assert.deepEqual([...url.searchParams.keys()], ['registry', 'escrow', 'provider', 'requestId']);
  assert.equal(href.includes('TEST-'), false);
  assert.deepEqual(parseInspectorContext(url.search).context, { registry, escrow, provider, requestId: '12' });
  assert.equal(inspectorHref({}), '/inspector');
});

test('inspector rejects ambiguous or invalid identities and request IDs without model/request fallback', () => {
  for (const value of ['', '0', '-1', '1.2', '01', '1e2', 'foo', (2n ** 256n).toString(), '9'.repeat(100)]) assert.equal(validInspectorRequestId(value), false);
  assert.equal(validInspectorRequestId((2n ** 256n - 1n).toString()), false); // bounded to 77 decimal digits, matching node request IDs
  assert.equal(validInspectorRequestId('12345'), true);
  assert.ok(parseInspectorContext('?provider=https://evil.example').error);
  assert.ok(parseInspectorContext(`?registry=${registry}&registry=${escrow}`).error);
  assert.ok(parseInspectorContext('?requestId=0').error);
  assert.ok(parseInspectorContext('?requestId=1&requestId=2').error);
  assert.deepEqual(parseInspectorContext('?prompt=IGNORED&token=IGNORED').context, {});
});
