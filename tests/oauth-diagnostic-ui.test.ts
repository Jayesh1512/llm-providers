import test from 'node:test';
import assert from 'node:assert/strict';
import { boundedOAuthDiagnostic } from '../src/web/oauth-diagnostic.js';

test('OAuth UI exposes only bounded stage/reason and drops callback or credential fields', () => {
  const result = boundedOAuthDiagnostic({ stage: 'identity', reason: 'identity_nonce', callbackURL: 'LOCAL-CALLBACK-FIXTURE', code: 'LOCAL-CODE-FIXTURE', token: 'LOCAL-TOKEN-FIXTURE', message: 'LOCAL-MESSAGE-FIXTURE' });
  assert.deepEqual(result, { stage: 'identity', reason: 'identity_nonce' });
  assert.equal(JSON.stringify(result).includes('FIXTURE'), false);
  assert.deepEqual(boundedOAuthDiagnostic({ stage: 'lifecycle', reason: 'attempt_expired' }), { stage: 'lifecycle', reason: 'attempt_expired' });
  for (const value of [null, {}, 'LOCAL-CODE-FIXTURE', { stage: 'identity', reason: 'LOCAL-TOKEN-FIXTURE' }, { stage: 'LOCAL-CALLBACK-FIXTURE', reason: 'identity_nonce' }, { stage: 'constructor', reason: 'identity_nonce' }, { stage: 'identity', reason: 'toString' }]) assert.equal(boundedOAuthDiagnostic(value), undefined);
});
