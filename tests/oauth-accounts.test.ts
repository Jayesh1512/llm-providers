import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, readFile, stat, chmod, writeFile, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { privateKeyToAccount } from 'viem/accounts';
import { AccountStore } from '../src/accounts/storage.js';
import { OAuthAccountManager } from '../src/accounts/manager.js';
import { OfficialOpenAI, OPENAI_OAUTH, OPENAI_SCOPES } from '../src/accounts/openai.js';
import { AccountError, safeAccountError } from '../src/accounts/errors.js';
import { callOAuthResponses } from '../src/accounts/responses.js';
import { createAccountServer } from '../src/accounts/server.js';
import { accountManagementDomain, accountManagementMessage, accountManagementTypes, type AccountChallenge } from '../src/shared/accounts.js';
import { callPaidApi } from '../src/provider/adapters.js';
import { LocalAccountClient } from '../src/web/account-client.js';
import { resolveManagedApiKey,ApiKeyStore } from '../src/accounts/api-keys.js';
import { loadConfig,checkCredentials } from '../src/provider/config.js';
import type { ApiKeyConnection } from '../src/shared/accounts.js';
import { accountOptions,startAccountHelper,developmentAccountHelper } from '../src/accounts/start.js';

// All account credentials, identity keys, upstream responses and scopes below are local fixtures.
const key = await generateKeyPair('RS256');
const forgedKey = await generateKeyPair('RS256');
const jwk = { ...await exportJWK(key.publicKey), kid: 'local-fixture', alg: 'RS256', use: 'sig' };
const MODEL = 'local-fixture-model';
const event = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
const completion = (overrides = {}) => ({ type: 'response.completed', response: {
  id: 'resp_local_fixture', status: 'completed', model: MODEL,
  output: [{ type: 'message', content: [{ type: 'output_text', text: 'Fixture answer 🙂' }] }],
  usage: { input_tokens: 7, output_tokens: 3 }, ...overrides,
} });
const wire = (value: string) => new Response(new ReadableStream({ start(controller) {
  const data = new TextEncoder().encode(value);
  for (let i = 0; i < data.length; i += 7) controller.enqueue(data.slice(i, i + 7));
  controller.close();
} }), { headers: { 'content-type': 'text/event-stream' } });

async function fixture(t: TestContext) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'llm-account-fixture-')));
  await chmod(directory, 0o700);
  const store = await AccountStore.open(directory);
  const f = {
    now: Math.floor(Date.now() / 1000), store, directory,
    calls: [] as { url: string; init?: RequestInit }[],
    codes: new Map<string, { nonce: string; subject: string }>(),
    claims: {} as Record<string, unknown>, signingKey: key.privateKey,
    scopes: OPENAI_SCOPES.join(' '), refreshCount: 0, accessCount: 0, revokeStatus: 200,
    modelsStatus: 200, response: () => wire(event(completion())),
    tokenHook: undefined as undefined | ((form: URLSearchParams) => Promise<Response | undefined>),
    jwksResponse: undefined as undefined | (()=>Response),
  };
  const network: typeof fetch = async (url, init) => {
    const address = String(url); f.calls.push({ url: address, init });
    assert.equal(init?.redirect, 'error');
    if (address === OPENAI_OAUTH.jwks) return f.jwksResponse?.()??Response.json({ keys: [jwk] });
    if (address === OPENAI_OAUTH.token) {
      const form = new URLSearchParams(String(init?.body));
      const override = await f.tokenHook?.(form); if (override) return override;
      if (form.get('grant_type') === 'refresh_token') {
        f.refreshCount++;
        return Response.json({ access_token: `ACCESS-rotation-${f.refreshCount}`, refresh_token: `REFRESH-rotation-${f.refreshCount}`, token_type: 'Bearer', expires_in: 3600 });
      }
      const code = f.codes.get(form.get('code')!); assert.ok(code);
      const idToken = await new SignJWT({ email: 'fixture@example.test', nonce: code.nonce, ...f.claims })
        .setProtectedHeader({ alg: 'RS256', kid: jwk.kid }).setIssuer(String(f.claims.iss ?? OPENAI_OAUTH.issuer))
        .setAudience(String(f.claims.aud ?? form.get('client_id'))).setSubject(String(f.claims.sub ?? code.subject))
        .setIssuedAt(Number(f.claims.iat ?? f.now)).setExpirationTime(Number(f.claims.exp ?? f.now + 3600)).sign(f.signingKey);
      f.accessCount++;
      return Response.json({ access_token: `ACCESS-code-${f.accessCount}`, refresh_token: `REFRESH-code-${f.accessCount}`, id_token: idToken, token_type: 'Bearer', expires_in: 3600, scope: f.scopes });
    }
    if (address === OPENAI_OAUTH.discovery) return Response.json({ issuer: OPENAI_OAUTH.issuer, revocation_endpoint: OPENAI_OAUTH.revoke });
    if (address === OPENAI_OAUTH.revoke) return new Response(null, { status: f.revokeStatus });
    if (address === OPENAI_OAUTH.resource + '/models') return Response.json(f.modelsStatus === 200 ? { models: [
      { slug: MODEL, display_name: 'Fixture exact model', visibility: 'list' },
      { slug: 'hidden-fixture', display_name: 'Hidden', visibility: 'hidden' },
    ] } : { error: { message: 'PRIVATE-UPSTREAM-ERROR' } }, { status: f.modelsStatus });
    if (address === OPENAI_OAUTH.resource + '/responses') return f.response();
    throw new Error('Unexpected external destination');
  };
  const upstream = new OfficialOpenAI(network);
  const manager = new OAuthAccountManager(store, upstream, () => f.now);
  t.after(async () => { await manager.close(); await rm(directory, { recursive: true, force: true }); });
  const begin = async (ref?: string, clientId = ref ? store.snapshot().accounts.find(a => a.credentialRef === ref)!.clientId : 'oaiapp_local_fixture_1', subject = 'local-subject') => {
    const attempt = await manager.begin('local-owner', f.now + 600, ref);
    const consent = new URL(attempt.authorizationUrl);
    const code = 'local-code-' + attempt.attemptId;
    f.codes.set(code, { nonce: consent.searchParams.get('nonce')!, subject });
    const callback = new URL(consent.searchParams.get('redirect_uri')!);
    callback.searchParams.set('state', consent.searchParams.get('state')!);
    callback.searchParams.set('client_id', clientId); callback.searchParams.set('code', code);
    callback.searchParams.set('scope', OPENAI_SCOPES.slice().reverse().join(' '));
    return { ...attempt, consent, callback };
  };
  const connect = async (clientId?: string) => {
    const a = await begin(undefined, clientId);
    await manager.finish(a.attemptId, a.callback.toString());
    return manager.list().find(account => store.snapshot().accounts.find(a => a.credentialRef === account.credentialRef)?.clientId === (clientId ?? 'oaiapp_local_fixture_1'))!.credentialRef;
  };
  return { f, manager, upstream, begin, connect };
}

test('official fresh consent: loopback callback, S256, issued client, signed identity and masked metadata', async t => {
  const { f, manager, begin } = await fixture(t); const a = await begin();
  assert.equal(a.consent.origin + a.consent.pathname, OPENAI_OAUTH.authorize);
  assert.equal(a.consent.searchParams.get('client_id'), 'dynamic_agent_client');
  assert.equal(a.consent.searchParams.get('agent_name_hint'), 'LLM Providers Personal');
  assert.equal(a.consent.searchParams.get('ext_agent_host_id'), 'urn:uuid:' + f.store.snapshot().hostId);
  assert.equal(a.consent.searchParams.get('scope'), OPENAI_SCOPES.join(' '));
  assert.equal(a.consent.searchParams.get('resource'), OPENAI_OAUTH.resource);
  assert.equal(a.consent.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(a.callback.hostname, '127.0.0.1'); assert.equal(a.callback.pathname, '/auth/callback');
  assert.equal(a.consent.searchParams.has('id_token_hint'), false);
  const response = await fetch(a.callback, { redirect: 'manual' });
  assert.equal(response.status, 303); assert.equal(response.headers.get('location'), '/auth/complete');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  const exchange = f.calls.find(call => call.url === OPENAI_OAUTH.token)!;
  const form = new URLSearchParams(String(exchange.init?.body));
  assert.equal(form.get('client_id'), 'oaiapp_local_fixture_1');
  assert.equal(form.get('redirect_uri'), a.consent.searchParams.get('redirect_uri'));
  assert.equal(createHash('sha256').update(form.get('code_verifier')!).digest('base64url'), a.consent.searchParams.get('code_challenge'));
  assert.equal(manager.outcome('local-owner', a.attemptId).status, 'connected');
  const publicAccount = JSON.stringify(manager.list());
  for (const secret of ['ACCESS-', 'REFRESH-', 'fixture@example.test', f.store.snapshot().accounts[0].tokens!.idToken]) assert.ok(!publicAccount.includes(secret));
  assert.equal(manager.list()[0].status, 'connected');
  assert.deepEqual(await manager.models(manager.list()[0].credentialRef), [{ slug: MODEL, displayName: 'Fixture exact model' }]);
  await assert.rejects(manager.finish(a.attemptId, a.callback.toString()));
});

test('state, duplicate parameters, redirect, issuer, owner and callback expiry reject without token exchange', async t => {
  const { f, manager, begin } = await fixture(t); const a = await begin();
  for (const change of [
    (u: URL) => u.searchParams.set('state', 'wrong'),
    (u: URL) => u.searchParams.append('state', a.consent.searchParams.get('state')!),
    (u: URL) => u.searchParams.append('scope', 'openid'),
    (u: URL) => u.searchParams.set('scope', 'x'.repeat(4097)),
    (u: URL) => { u.hostname = 'localhost'; },
    (u: URL) => { u.pathname = '/other'; },
    (u: URL) => u.searchParams.set('redirect_uri', 'https://evil.invalid'),
  ]) { const u = new URL(a.callback); change(u); await assert.rejects(manager.finish(a.attemptId, u.toString())); }
  await assert.rejects(async () => manager.outcome('other-owner', a.attemptId));
  assert.equal(f.calls.length, 0);
  a.callback.searchParams.set('iss', 'https://evil.invalid');
  await assert.rejects(manager.finish(a.attemptId, a.callback.toString()));
  const b = await begin(); f.now += 301;
  await assert.rejects(manager.finish(b.attemptId, b.callback.toString())); assert.equal(f.calls.length, 0);
});

test('cryptographic JWT rejects forged signature, issuer, audience, nonce and validity violations', async t => {
  const { f, manager, begin } = await fixture(t);
  for (const claims of [{ nonce: 'substituted' }, { iss: 'https://evil.invalid' }, { aud: 'oaiapp_other' }, { exp: f.now - 60 }, { iat: f.now + 60 }, { azp: 'oaiapp_other' }]) {
    f.claims = claims; const a = await begin(); await assert.rejects(manager.finish(a.attemptId, a.callback.toString()));
    assert.equal(manager.list().length, 0);
  }
  f.claims = {}; f.signingKey = forgedKey.privateKey;
  const forged = await begin(); await assert.rejects(manager.finish(forged.attemptId, forged.callback.toString()));
  assert.equal(manager.list().length, 0);
});

test('identity-only scope grants cannot infer, reconnect keeps issued identity and rejects account substitution', async t => {
  const { f, manager, begin, connect } = await fixture(t);
  f.scopes = 'openid profile email'; const ref = await connect();
  assert.equal(manager.list()[0].status, 'permission_required'); assert.equal(f.store.snapshot().accounts[0].tokens, undefined);
  await assert.rejects(manager.models(ref), (error: AccountError) => error.code === 'permission_required');
  f.scopes = OPENAI_SCOPES.join(' '); let a = await begin(ref);
  assert.equal(a.consent.searchParams.get('client_id'), 'oaiapp_local_fixture_1');
  assert.equal(a.consent.searchParams.has('agent_name_hint'), false);
  await manager.finish(a.attemptId, a.callback.toString()); const original = f.store.snapshot().accounts[0].tokens!.refreshToken;
  a = await begin(ref, 'oaiapp_other_workspace'); await assert.rejects(manager.finish(a.attemptId, a.callback.toString()));
  a = await begin(ref, undefined, 'substituted-subject'); await assert.rejects(manager.finish(a.attemptId, a.callback.toString()));
  assert.equal(f.store.snapshot().accounts[0].tokens!.refreshToken, original);
  const second = await connect('oaiapp_local_fixture_2'); assert.notEqual(second, ref);
  assert.equal(manager.list().length, 2); assert.notEqual(manager.list()[0].workspaceLabel, manager.list()[1].workspaceLabel);
});

test('OAuth rejection diagnostics identify safe callback, exchange, identity, schema, storage and lifecycle stages',async t=>{
  const {f,manager,begin}=await fixture(t);
  const check=async(expected:{stage:string;reason:string},modify:(a:Awaited<ReturnType<typeof begin>>)=>void=()=>{})=>{
    const a=await begin();modify(a);await assert.rejects(manager.finish(a.attemptId,a.callback.toString()));
    const result=manager.outcome('local-owner',a.attemptId);assert.deepEqual(result.diagnostic,expected);
    for(const value of [a.callback.searchParams.get('code')!,a.consent.searchParams.get('state')!,a.consent.searchParams.get('nonce')!,'PRIVATE-DIAGNOSTIC-SECRET'])assert.ok(!JSON.stringify(result).includes(value));
    await assert.rejects(async()=>manager.outcome('other-owner',a.attemptId));manager.cancel(a.attemptId);
  };
  await check({stage:'callback',reason:'state_mismatch'},a=>a.callback.searchParams.set('state','PRIVATE-DIAGNOSTIC-SECRET'));
  await check({stage:'callback',reason:'callback_parameters'},a=>a.callback.searchParams.append('scope','openid'));
  f.tokenHook=async()=>Response.json({error:'invalid_grant',error_description:'PRIVATE-DIAGNOSTIC-SECRET'},{status:400});
  await check({stage:'exchange',reason:'exchange_invalid_grant'});
  f.tokenHook=async()=>Response.json({error:'PRIVATE-DIAGNOSTIC-SECRET'},{status:403});await check({stage:'exchange',reason:'exchange_rejected'});
  f.tokenHook=async()=>{throw new Error('PRIVATE-DIAGNOSTIC-SECRET');};await check({stage:'exchange',reason:'exchange_unavailable'});
  f.tokenHook=async()=>Response.json({access_token:'PRIVATE-DIAGNOSTIC-SECRET'});await check({stage:'identity',reason:'missing_id_token'});
  f.tokenHook=undefined;
  for(const [claims,reason] of [[{nonce:'PRIVATE-DIAGNOSTIC-SECRET'},'identity_nonce'],[{iss:'https://evil.invalid'},'identity_issuer'],[{aud:'oaiapp_other'},'identity_audience'],[{exp:f.now-60},'identity_time']] as const){f.claims={...claims};await check({stage:'identity',reason});}
  f.claims={};f.signingKey=forgedKey.privateKey;await check({stage:'identity',reason:'identity_signature'});f.signingKey=key.privateKey;
  f.tokenHook=async form=>{
    const code=f.codes.get(form.get('code')!)!;
    const id_token=await new SignJWT({nonce:code.nonce}).setProtectedHeader({alg:'RS256',kid:jwk.kid}).setIssuer(OPENAI_OAUTH.issuer).setAudience(form.get('client_id')!).setSubject(code.subject).setIssuedAt(f.now).setExpirationTime(f.now+3600).sign(key.privateKey);
    return Response.json({id_token,access_token:'PRIVATE-DIAGNOSTIC-SECRET',refresh_token:'fixture-refresh',token_type:'Bearer',scope:OPENAI_SCOPES.join(' '),expires_in:'wrong'});
  };
  await check({stage:'token_schema',reason:'invalid_token_response'});f.tokenHook=undefined;
  const update=f.store.update.bind(f.store);f.store.update=async()=>{throw new Error('PRIVATE-DIAGNOSTIC-SECRET');};
  await check({stage:'storage',reason:'storage_unavailable'});f.store.update=update;
  const expired=await begin();f.now+=301;await assert.rejects(manager.finish(expired.attemptId,expired.callback.toString()));assert.deepEqual(manager.outcome('local-owner',expired.attemptId).diagnostic,{stage:'lifecycle',reason:'attempt_expired'});
  const canceled=await begin();manager.cancelOwner('local-owner');assert.deepEqual(manager.outcome('local-owner',canceled.attemptId).diagnostic,{stage:'lifecycle',reason:'attempt_cancelled'});
  const valid=await begin();await manager.finish(valid.attemptId,valid.callback.toString());assert.deepEqual(manager.outcome('local-owner',valid.attemptId),{status:'connected'});
});

test('unavailable/invalid JWKS remains fail closed with bounded diagnostics; rejection redirects off the credential URL',async t=>{
  for(const [jwksResponse,reason] of [[()=>Response.json({error:'SECRET'},{status:503}),'jwks_unavailable'],[()=>new Response('SECRET'),'jwks_invalid'],[()=>Response.json({keys:[]}), 'identity_key']] as const){
    await t.test(reason,async t=>{
      const {f,manager,begin}=await fixture(t);f.jwksResponse=jwksResponse;const a=await begin();
      const response=await fetch(a.callback,{redirect:'manual'});assert.equal(response.status,303);assert.equal(response.headers.get('location'),'/auth/rejected');
      const diagnostic=manager.outcome('local-owner',a.attemptId).diagnostic;assert.deepEqual(diagnostic,{stage:'identity',reason});
      const clean=new URL('/auth/rejected',a.callback);const page=await(await fetch(clean)).text();assert.ok(page.includes('identity/'+reason));assert.ok(!page.includes(a.callback.searchParams.get('code')!));assert.ok(!page.includes('SECRET'));assert.equal(manager.list().length,0);
    });
  }
});

test('expired authorization and cancelled owner cannot publish tokens after exchange', async t => {
  const { f, manager, begin } = await fixture(t); const a = await begin();
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  f.tokenHook = async () => { await gate; return undefined; };
  const pending = manager.finish(a.attemptId, a.callback.toString());
  manager.cancelOwner('local-owner'); release();
  await assert.rejects(pending); assert.equal(manager.list().length, 0);
});

test('JWT algorithm restrictions and multiple-audience authorized-party binding are enforced', async t => {
  const { f, upstream } = await fixture(t); const client = 'oaiapp_local_fixture';
  const payload = { sub: 'fixture', iss: OPENAI_OAUTH.issuer, aud: [client, 'another-audience'], iat: f.now, exp: f.now + 60, nonce: 'fixture-nonce' };
  const multi = await new SignJWT(payload).setProtectedHeader({ alg: 'RS256', kid: jwk.kid }).sign(key.privateKey);
  await assert.rejects(upstream.verifyIdentity(multi, client, 'fixture-nonce', f.now));
  const accepted = await new SignJWT({ ...payload, azp: client }).setProtectedHeader({ alg: 'RS256', kid: jwk.kid }).sign(key.privateKey);
  assert.equal((await upstream.verifyIdentity(accepted, client, 'fixture-nonce', f.now)).sub, 'fixture');
  const symmetric = await new SignJWT({ ...payload, aud: client }).setProtectedHeader({ alg: 'HS256' }).sign(new Uint8Array(32));
  await assert.rejects(upstream.verifyIdentity(symmetric, client, 'fixture-nonce', f.now));
});

test('refresh timing and revoked inference scopes fail closed without token reuse', async t => {
  const { f, manager, connect } = await fixture(t); const ref = await connect(); f.now += 3550;
  await f.store.changeAccount(ref, a => { a.tokens!.earliestRefreshAt = f.now + 30; });
  const count = f.calls.length; await assert.rejects(manager.models(ref)); assert.equal(f.calls.length, count);
  f.now += 31;
  f.tokenHook = async () => Response.json({ access_token: 'NEW', refresh_token: 'ROTATED', token_type: 'Bearer', expires_in: 3600, scope: 'openid profile email' });
  await assert.rejects(manager.models(ref)); assert.equal(f.store.snapshot().accounts[0].tokens, undefined);
  assert.equal(manager.list()[0].status, 'reconnect_required');
});

test('refresh is serialized, rotates atomic tokens and preserves registration across restart', async t => {
  const { f, manager, connect } = await fixture(t); const ref = await connect();
  f.now += 3550; await Promise.all(Array.from({ length: 15 }, () => manager.models(ref)));
  assert.equal(f.refreshCount, 1);
  let registration = f.store.snapshot().accounts[0]; assert.equal(registration.tokens!.refreshToken, 'REFRESH-rotation-1');
  f.now += 3550; await manager.models(ref); assert.equal(f.refreshCount, 2);
  const calls = f.calls.filter(call => call.url === OPENAI_OAUTH.token).map(call => new URLSearchParams(String(call.init?.body)));
  assert.equal(calls[2].get('refresh_token'), 'REFRESH-rotation-1');
  assert.equal(calls[2].get('client_id'), registration.clientId); assert.equal(calls[2].has('scope'), false);
  assert.equal((await stat(f.directory)).mode & 0o777, 0o700);
  assert.equal((await stat(join(f.directory, 'accounts.json'))).mode & 0o777, 0o600);
  await assert.rejects(AccountStore.open(f.directory));
  const host = f.store.snapshot().hostId; await manager.close();
  const reopened = await AccountStore.open(f.directory); assert.equal(reopened.snapshot().hostId, host);
  assert.equal(reopened.snapshot().accounts[0].tokens!.refreshToken, 'REFRESH-rotation-2'); await reopened.close();
});

test('invalid/reused/ambiguous refresh requires reconnect; confirmed server failures retain tokens with backoff', async t => {
  const { f, manager, connect } = await fixture(t);
  for (const mode of ['invalid_grant', 'refresh_token_reused', 'ambiguous', 'unchanged', 'wrong_identity']) {
    const ref = await connect('oaiapp_' + mode); f.now += 3550;
    const old = f.store.snapshot().accounts.find(a => a.credentialRef === ref)!.tokens!;
    f.tokenHook = async form => {
      if (form.get('grant_type') !== 'refresh_token') return undefined;
      if (mode === 'ambiguous') throw new Error('SECRET-transport');
      if (mode === 'unchanged') return Response.json({ access_token: 'NEW', refresh_token: old.refreshToken, token_type: 'Bearer', expires_in: 3600 });
      if (mode === 'wrong_identity') {
        const id = await new SignJWT({}).setProtectedHeader({ alg: 'RS256', kid: jwk.kid }).setIssuer(OPENAI_OAUTH.issuer).setAudience('oaiapp_' + mode).setSubject('other-subject').setIssuedAt(f.now).setExpirationTime(f.now + 3600).sign(key.privateKey);
        return Response.json({ access_token: 'NEW', refresh_token: 'ROTATED', id_token: id, token_type: 'Bearer', expires_in: 3600 });
      }
      return Response.json({ error: mode, error_description: 'SECRET-refresh' }, { status: 400 });
    };
    await assert.rejects(manager.models(ref), (e: AccountError) => e.code === 'reconnect_required' && !e.message.includes('SECRET'));
    assert.equal(f.store.snapshot().accounts.find(a => a.credentialRef === ref)!.tokens, undefined); f.tokenHook = undefined;
  }
  const ref = await connect('oaiapp_transient'); f.now += 3550;
  const old = f.store.snapshot().accounts.find(a => a.credentialRef === ref)!.tokens!.refreshToken;
  f.tokenHook = async () => Response.json({ error: 'server_error', message: 'SECRET' }, { status: 503 });
  await assert.rejects(manager.models(ref)); assert.equal(f.store.snapshot().accounts.find(a => a.credentialRef === ref)!.tokens!.refreshToken, old);
  const count = f.calls.length; await assert.rejects(manager.models(ref)); assert.equal(f.calls.length, count);
});

test('interrupted rotations and orphan credential snapshots are cleared; unsafe storage is rejected', async t => {
  const { f, manager, connect } = await fixture(t); const ref = await connect();
  await f.store.changeAccount(ref, a => { a.status = 'refreshing'; });
  await manager.close(); const orphan = join(f.directory, '.snapshot-' + randomUUID());
  await writeFile(orphan, 'ORPHAN-REFRESH-SECRET', { mode: 0o600 });
  const reopened = await AccountStore.open(f.directory);
  assert.equal(reopened.snapshot().accounts[0].status, 'reconnect_required'); assert.equal(reopened.snapshot().accounts[0].tokens, undefined);
  await assert.rejects(readFile(orphan)); await reopened.close();
  assert.ok(!(await readFile(join(f.directory, 'accounts.json'), 'utf8')).includes('REFRESH-code'));
  await chmod(join(f.directory, 'accounts.json'), 0o644); await assert.rejects(AccountStore.open(f.directory));
  await chmod(join(f.directory, 'accounts.json'), 0o600); await chmod(f.directory, 0o755); await assert.rejects(AccountStore.open(f.directory));
  await chmod(f.directory, 0o700);
  const link = f.directory + '-symlink'; await symlink(f.directory, link); await assert.rejects(AccountStore.open(link)); await rm(link);
});

test('disconnect revokes one registration, removes credentials and reconnect uses issued client', async t => {
  const { f, manager, begin, connect } = await fixture(t); const ref = await connect(); const other = await connect('oaiapp_local_fixture_2');
  const first = f.store.snapshot().accounts.find(a => a.credentialRef === ref)!.tokens!;
  assert.deepEqual(await manager.disconnect(ref), { remoteRevocationConfirmed: true });
  const file = await readFile(join(f.directory, 'accounts.json'), 'utf8');
  for (const secret of [first.accessToken, first.refreshToken, first.idToken]) assert.ok(!file.includes(secret));
  assert.ok(f.store.snapshot().accounts.find(a => a.credentialRef === other)!.tokens);
  const revoke = f.calls.find(call => call.url === OPENAI_OAUTH.revoke)!;
  assert.equal(new URLSearchParams(String(revoke.init?.body)).get('token'), first.refreshToken);
  await assert.rejects(manager.models(ref)); const consent = await begin(ref);
  assert.equal(consent.consent.searchParams.get('client_id'), 'oaiapp_local_fixture_1');
  await manager.finish(consent.attemptId, consent.callback.toString());
  f.revokeStatus = 403; assert.deepEqual(await manager.disconnect(ref), { remoteRevocationConfirmed: false });
  assert.equal(f.store.snapshot().accounts.find(a => a.credentialRef === ref)!.tokens, undefined);
});

test('Responses uses the official endpoint, requires completion and counts usage without an invoice', async t => {
  const { f, manager, connect } = await fixture(t); const ref = await connect();
  const result = await manager.infer(ref, MODEL, 'Local fixture prompt', 16);
  assert.deepEqual(result, { text: 'Fixture answer 🙂', inputTokens: 7, outputTokens: 3 });
  assert.equal('signature' in result, false); assert.equal('amountWei' in result, false);
  const request = f.calls.find(c => c.url === OPENAI_OAUTH.resource + '/responses')!;
  assert.deepEqual(JSON.parse(String(request.init?.body)), { model: MODEL, input: [{ role: 'user', content: 'Local fixture prompt' }], max_output_tokens: 16, store: false, stream: true });
  const headers = new Headers(request.init?.headers); assert.equal(headers.get('user-agent'), null); assert.equal(headers.get('chatgpt-account-id'), null);
  await assert.rejects(manager.infer(ref, 'not-in-catalog', 'fixture', 16));
});

test('truncated/failed/tampered Responses streams and HTTP limits never fabricate successful output', async t => {
  const { f, upstream } = await fixture(t);
  const cases = [
    event({ type: 'response.output_text.delta', delta: 'PARTIAL-SECRET' }),
    event({ type: 'response.incomplete', response: { error: { message: 'SECRET' } } }),
    event({ type: 'response.failed', response: { error: { code: 'subscription_sharing_usage_limit_exceeded', message: 'SECRET' } } }),
    event(completion({ model: 'substituted-model' })), event(completion({ usage: { input_tokens: -1, output_tokens: 3 } })),
    event(completion({ usage: { input_tokens: 7, output_tokens: 17 } })), event(completion()) + event(completion()),
    'data: invalid-json-SECRET\n\n', 'event: response.failed\n' + event(completion()),
  ];
  for (const value of cases) {
    f.response = () => wire(value);
    await assert.rejects(callOAuthResponses(upstream, 'LOCAL-TOKEN', MODEL, 'PRIVATE-PROMPT', 16, new AbortController().signal), (error: AccountError) => error instanceof AccountError && !error.message.includes('SECRET') && !error.message.includes('PRIVATE-PROMPT'));
  }
  f.response = () => Response.json({ error: { message: 'SECRET-HTTP', code: 'subscription_sharing_usage_limit_exceeded' } }, { status: 429 });
  await assert.rejects(callOAuthResponses(upstream, 'LOCAL-TOKEN', MODEL, 'fixture', 16, new AbortController().signal), (e: AccountError) => e.code === 'quota_limited');
  assert.equal(f.calls.length, cases.length + 1); // No auto retry or alternate billing credentials.
});

test('quota status is explicit, bare 401 preserves credentials, and private/marketplace paths reject before access', async t => {
  const { f, manager, connect } = await fixture(t); const ref = await connect();
  f.response = () => wire(event({ type: 'response.failed', response: { error: { code: 'subscription_sharing_usage_limit_exceeded' } } }));
  await assert.rejects(manager.infer(ref, MODEL, 'fixture', 16)); assert.equal(manager.list()[0].status, 'quota_limited');
  const count = f.calls.length;
  for (const [use, privateMode] of [['marketplace', false], ['personal-local', true]] as const) {
    await assert.rejects(manager.infer(ref, MODEL, 'fixture', 16, use, privateMode)); await assert.rejects(manager.models(ref, use, privateMode));
  }
  assert.equal(f.calls.length, count);
  f.now += 61; f.modelsStatus = 401; await assert.rejects(manager.models(ref));
  assert.equal(manager.list()[0].status, 'unavailable'); assert.ok(f.store.snapshot().accounts[0].tokens);
  await assert.rejects(callPaidApi({ model: MODEL, apiKind: 2, upstreamModel: MODEL, baseUrl: 'https://api.openai.com', apiKeyEnv: 'UNUSED', authentication: { kind: 'chatgpt-oauth', provider: 'openai', billingSource: 'chatgpt-plan', usage: 'personal-local', credentialRef: ref } }, 'fixture', 16, { fetch: async () => { throw new Error('Must not access upstream'); } }), /Subscription OAuth/);
  assert.deepEqual(safeAccountError(new Error('secret-token')), { status: 503, body: { error: 'unavailable', message: 'The account service could not complete the request. No other billing path was used.' } });
});

test('management API enforces wallet signature, origin, service and single-use session authorization', async t => {
  const { f, manager } = await fixture(t);
  const operator = privateKeyToAccount(('0x' + '12'.repeat(32)) as `0x${string}`);
  const attacker = privateKeyToAccount(('0x' + '13'.repeat(32)) as `0x${string}`);
  const origin = 'http://127.0.0.1:5173';
  const service = createAccountServer(manager, operator.address, [origin, 'http://localhost:5173']);
  await new Promise<void>(resolve => service.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await service.close(); });
  const port = (service.server.address() as { port: number }).port;
  const request = (path: string, body?: unknown, token?: string, extra: Record<string, string> = {}) => fetch(`http://127.0.0.1:${port}/accounts/${path}`, {
    method: body === undefined ? 'GET' : 'POST', headers: { Origin: origin, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: 'Bearer ' + token } : {}), ...extra }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert.equal((await request('status')).status, 401);
  assert.equal((await request('info', undefined, undefined, { Origin: 'https://evil.invalid' })).status, 403);
  const wrongHost = await new Promise<number>(resolve => {
    const req = httpRequest(`http://127.0.0.1:${port}/accounts/info`, { headers: { Host: 'evil.invalid', Origin: origin } }, response => { response.resume(); resolve(response.statusCode!); }); req.end();
  });
  assert.equal(wrongHost, 403);
  assert.equal((await fetch(`http://127.0.0.1:${port}/accounts/info`)).status, 403);
  for (const mismatch of ['wallet', 'service', 'origin', 'chain', 'expiry']) {
    const challenge: AccountChallenge = await (await request('challenge', {})).json();
    const message = accountManagementMessage(challenge);
    if (mismatch === 'service') message.serviceId = ('0x' + 'ff'.repeat(32)) as `0x${string}`;
    if (mismatch === 'expiry') message.expiresAt += 1n;
    const signature = await (mismatch === 'wallet' ? attacker : operator).signTypedData({ domain: mismatch === 'chain' ? { ...accountManagementDomain, chainId: 31337 } : accountManagementDomain, types: accountManagementTypes, primaryType: 'LocalAccountAccess', message });
    const body = { challenge: challenge.challenge, signature };
    assert.equal((await request('session', body, undefined, mismatch === 'origin' ? { Origin: 'http://localhost:5173' } : {})).status, 401);
    assert.equal((await request('session', body)).status, 401);
  }
  const challenge: AccountChallenge = await (await request('challenge', {})).json();
  const signature = await operator.signTypedData({ domain: accountManagementDomain, types: accountManagementTypes, primaryType: 'LocalAccountAccess', message: accountManagementMessage(challenge) });
  const body = { challenge: challenge.challenge, signature };
  const authResponse = await request('session', body); assert.equal(authResponse.status, 200);
  const auth = await authResponse.json(); assert.equal(typeof auth.session, 'string');
  assert.equal((await request('session', body)).status, 401);
  assert.equal((await request('status', undefined, auth.session)).status, 200);
  assert.equal((await request('status', undefined, auth.session, { Origin: 'http://localhost:5173' })).status, 401);
  const connect = { provider: 'openai', usage: 'personal-local', privateMode: false };
  assert.equal((await request('connect', { ...connect, privateMode: true }, auth.session)).status, 403);
  assert.equal((await request('connect', { ...connect, usage: 'marketplace' }, auth.session)).status, 403);
  assert.equal((await request('connect', { ...connect, provider: 'anthropic' }, auth.session)).status, 503);
  assert.equal((await request('token-import', { accessToken: 'DO-NOT-IMPORT' }, auth.session)).status, 404);
  const started = await (await request('connect', connect, auth.session)).json();
  const url = new URL(started.authorizationUrl); assert.equal(url.origin, OPENAI_OAUTH.issuer);
  await request('lock', {}, auth.session); assert.equal(manager.outcome(auth.session, started.attemptId).status, 'rejected');
  assert.equal((await request('status', undefined, auth.session)).status, 401);
  assert.equal(f.calls.length, 0);
});

test('browser account client never exposes a reply after wallet/management lock', async () => {
  const original = globalThis.fetch;
  let release!: (response: Response) => void;
  globalThis.fetch = (() => new Promise<Response>(resolve => { release = resolve; })) as typeof fetch;
  try {
    const client = new LocalAccountClient();
    // Public request is enough to exercise generation fencing without importing a real credential/session.
    const reply = (client as unknown as { request: (p: string, b: unknown, auth: boolean) => Promise<unknown> }).request('info', undefined, false);
    await client.lock(); release(Response.json({ operator: 'stale-wallet' })); await assert.rejects(reply, /locked|wallet changed/);
  } finally { globalThis.fetch = original; }
});

test('authenticated API-key management saves unverified metadata and explicitly selected node refs, never OAuth tokens',async t=>{
  const {f,manager,connect}=await fixture(t);await connect();
  const operator=privateKeyToAccount(('0x'+'24'.repeat(32)) as `0x${string}`),origin='http://127.0.0.1:5173';
  const service=createAccountServer(manager,operator.address,[origin]);await service.ready;
  await new Promise<void>(resolve=>service.server.listen(0,'127.0.0.1',resolve));t.after(()=>service.close());
  const port=(service.server.address() as {port:number}).port;
  const request=(path:string,value?:unknown,token?:string)=>fetch(`http://127.0.0.1:${port}/accounts/${path}`,{method:value===undefined?'GET':'POST',headers:{Origin:origin,...(value===undefined?{}:{'content-type':'application/json'}),...(token?{authorization:'Bearer '+token}:{})},body:value===undefined?undefined:JSON.stringify(value)});
  const challenge:AccountChallenge=await(await request('challenge',{})).json();
  const signature=await operator.signTypedData({domain:accountManagementDomain,types:accountManagementTypes,primaryType:'LocalAccountAccess',message:accountManagementMessage(challenge)});
  const {session}=await(await request('session',{challenge:challenge.challenge,signature})).json();
  const baseline=f.calls.length,credentials:ApiKeyConnection[]=[];
  assert.equal((await request('api-keys')).status,401);
  for(const provider of ['anthropic','openai','compatible'] as const){
    const key='sk-LOCAL-KEY-'+provider+'-SECRET';
    const input={provider,model:provider+'/exact-fixture',upstreamModel:'exact-fixture',baseUrl:provider==='compatible'?'https://gateway.example.test/v1':`https://api.${provider==='anthropic'?'anthropic':'openai'}.com`,apiKey:key};
    assert.equal((await request('api-keys/save',input)).status,401);
    const reply=await request('api-keys/save',input,session);assert.equal(reply.status,200);
    const {credential}=await reply.json();credentials.push(credential);
    assert.equal(credential.validation,'unverified');assert.equal(credential.billingSource,'api-credits');
    assert.ok(!JSON.stringify(credential).includes(key));assert.ok(credential.providerModelConfig);assert.equal(credential.providerModelConfig.authentication.credentialRef,credential.credentialRef);
    const model=credential.providerModelConfig;
    assert.equal(await resolveManagedApiKey(model,operator.address,f.directory),key);
    let paidCalls=0;
    const result=await callPaidApi(model,'fixture',16,{credentialResolver:m=>resolveManagedApiKey(m,operator.address,f.directory),fetch:async(url,options)=>{
      paidCalls++;const headers=new Headers(options?.headers);
      assert.equal(provider==='anthropic'?headers.get('x-api-key'):headers.get('authorization'),provider==='anthropic'?key:'Bearer '+key);
      assert.equal(new URL(String(url)).origin,new URL(input.baseUrl).origin);
      return Response.json(provider==='anthropic'?{content:[{type:'text',text:'key fixture'}],usage:{input_tokens:7,output_tokens:3}}:provider==='openai'?completion().response:{choices:[{message:{content:'key fixture'}}],usage:{prompt_tokens:7,completion_tokens:3}});
    }});
    assert.equal(paidCalls,1);assert.equal(result.inputTokens,7);
    for(const changed of [{...model,model:'different-model'},{...model,upstreamModel:'different-upstream'},{...model,baseUrl:'https://evil.invalid'},{...model,apiKind:(model.apiKind===1?2:1) as 1|2}])await assert.rejects(resolveManagedApiKey(changed,operator.address,f.directory));
    await assert.rejects(resolveManagedApiKey(model,'0x0000000000000000000000000000000000000001',f.directory));
    await assert.rejects(callPaidApi(model,'fixture',16,{env:{UNUSED:key},fetch:async()=>{throw new Error('Cannot fallback');}}));
    const env={PROVIDER_ADDRESS:operator.address,NODE_PRIVATE_KEY:'0x'+'31'.repeat(32),REGISTRY_ADDRESS:'0x'+'40'.repeat(20),ESCROW_ADDRESS:'0x'+'50'.repeat(20),MONAD_RPC_URL:'https://rpc.example.test',PROVIDER_MODELS_JSON:JSON.stringify([model]),ACCOUNT_STATE_DIR:f.directory};
    const config=loadConfig(env);checkCredentials(config,{});assert.equal(config.models[0].apiKeyEnv,'');assert.equal(config.models[0].authentication?.credentialRef,credential.credentialRef);
    assert.throws(()=>loadConfig({...env,PROVIDER_MODELS_JSON:JSON.stringify([{...model,apiKeyEnv:'ALSO_ENV'}])}));
  }
  assert.equal(f.calls.length,baseline); // Saving/listing/resolving makes no upstream/billed validation call.
  const list=await(await request('api-keys',undefined,session)).json();assert.equal(list.credentials.length,3);
  const file=await readFile(join(f.directory,'api-keys','keys.json'),'utf8');
  assert.ok(!file.includes('ACCESS-code'));assert.ok(!file.includes('REFRESH-code'));assert.ok(!file.includes('idToken'));
  assert.equal((await stat(join(f.directory,'api-keys'))).mode&0o777,0o700);assert.equal((await stat(join(f.directory,'api-keys','keys.json'))).mode&0o777,0o600);
  assert.equal((await request('api-keys/save',{provider:'openai',model:'test',upstreamModel:'test',baseUrl:'https://evil.invalid',apiKey:'sk-fixture-secret'},session)).status,400);
  assert.equal((await request('api-keys/save',{provider:'compatible',model:'test',upstreamModel:'test',baseUrl:'https://gateway.example.test?key=secret',apiKey:'sk-fixture-secret'},session)).status,400);
  assert.equal((await request('api-keys/remove',{credentialRef:credentials[0].credentialRef},session)).status,200);
  await assert.rejects(resolveManagedApiKey(credentials[0].providerModelConfig!,operator.address,f.directory));
  assert.ok(!(await readFile(join(f.directory,'api-keys','keys.json'),'utf8')).includes('sk-LOCAL-KEY-anthropic-SECRET'));
  await assert.rejects(f.store.bindOperator('0x0000000000000000000000000000000000000001'));
  await assert.rejects(ApiKeyStore.open(f.directory,operator.address)); // Helper is the only writer.
});

test('fresh helper initializes only from a valid wallet signature and concurrent different-owner sessions cannot bypass the pin',async t=>{
  const {f,manager}=await fixture(t),origin='http://127.0.0.1:5173';
  const wallets=['61','62'].map(v=>privateKeyToAccount(('0x'+v.repeat(32)) as `0x${string}`));
  const service=createAccountServer(manager,undefined,[origin]);await service.ready;
  await new Promise<void>(resolve=>service.server.listen(0,'127.0.0.1',resolve));t.after(()=>service.close());
  const base=`http://127.0.0.1:${(service.server.address() as {port:number}).port}/accounts/`;
  const request=(path:string,value?:unknown)=>fetch(base+path,{method:value===undefined?'GET':'POST',headers:{Origin:origin,...(value===undefined?{}:{'content-type':'application/json'})},body:value===undefined?undefined:JSON.stringify(value)});
  const info=await(await request('info')).json();assert.equal(info.operator,null);assert.equal(info.initializationRequired,true);
  assert.equal((await request('challenge',{})).status,403);
  const invalid:AccountChallenge=await(await request('challenge',{operator:wallets[0].address})).json();
  assert.equal(invalid.initializing,true);
  const ordinarySignature=await wallets[0].signTypedData({domain:accountManagementDomain,types:accountManagementTypes,primaryType:'LocalAccountAccess',message:accountManagementMessage({...invalid,initializing:false})});
  assert.equal((await request('session',{challenge:invalid.challenge,signature:ordinarySignature})).status,401);assert.equal(f.store.snapshot().operator,undefined);
  const signed=await Promise.all(wallets.map(async wallet=>{
    const challenge:AccountChallenge=await(await request('challenge',{operator:wallet.address})).json();
    const message=accountManagementMessage(challenge);assert.equal(message.purpose,'Initialize local account management for this wallet');
    return {challenge:challenge.challenge,signature:await wallet.signTypedData({domain:accountManagementDomain,types:accountManagementTypes,primaryType:'LocalAccountAccess',message})};
  }));
  const replies=await Promise.all(signed.map(value=>request('session',value)));assert.equal(replies.filter(r=>r.status===200).length,1);
  const winner=replies.findIndex(r=>r.status===200),owner=wallets[winner].address.toLowerCase();assert.equal(f.store.snapshot().operator,owner);
  assert.equal((await(await request('info')).json()).operator,owner);
  assert.equal((await request('challenge',{operator:wallets[1-winner].address})).status,403);
  assert.ok((await request('session',signed[winner])).status>=400); // Consumed signature cannot be replayed.
  assert.equal(f.calls.length,0);
});

test('first-run client reaches actual helper, signs initialization and gets official consent without manual wallet environment',async t=>{
  const {f,manager}=await fixture(t),origin='http://127.0.0.1:5173';
  const wallet=privateKeyToAccount(('0x'+'63'.repeat(32)) as `0x${string}`);
  const service=createAccountServer(manager,undefined,[origin]);await service.ready;
  await new Promise<void>(resolve=>service.server.listen(0,'127.0.0.1',resolve));t.after(()=>service.close());
  const base=`http://127.0.0.1:${(service.server.address() as {port:number}).port}`;
  const originalFetch=globalThis.fetch,locationDescriptor=Object.getOwnPropertyDescriptor(globalThis,'location');
  Object.defineProperty(globalThis,'location',{configurable:true,value:{origin}});
  globalThis.fetch=(async(url,init)=>{
    const parsed=new URL(String(url));assert.equal(parsed.origin,'http://127.0.0.1:8791');
    return originalFetch(base+parsed.pathname,{...init,headers:{...Object.fromEntries(new Headers(init?.headers)),Origin:origin}});
  }) as typeof fetch;
  try{
    const client=new LocalAccountClient();await client.unlock(wallet.address,request=>wallet.signTypedData(request));
    assert.equal(client.isUnlocked(),true);assert.equal(f.store.snapshot().operator,wallet.address.toLowerCase());
    const consent=await client.connect();const url=new URL(consent.authorizationUrl);
    assert.equal(url.origin+url.pathname,OPENAI_OAUTH.authorize);assert.equal(url.searchParams.get('code_challenge_method'),'S256');
    assert.equal((await client.attempt(consent.attemptId)).status,'pending');assert.equal(f.calls.length,0);
    await client.lock();assert.equal(manager.outcome((manager as unknown as {outcomes:Map<string,{owner:string}>}).outcomes.get(consent.attemptId)!.owner,consent.attemptId).status,'rejected');
  }finally{globalThis.fetch=originalFetch;if(locationDescriptor)Object.defineProperty(globalThis,'location',locationDescriptor);else Reflect.deleteProperty(globalThis,'location');}
});

test('unowned existing credentials cannot be claimed, existing pin persists without environment, and configured mismatches fail',async t=>{
  const {f,manager,connect}=await fixture(t);await connect();
  const unsafe=createAccountServer(manager,undefined,['http://127.0.0.1:5173']);await assert.rejects(unsafe.ready);
  const owner='0x'+'70'.repeat(20);await f.store.bindOperator(owner);
  const restored=createAccountServer(manager,undefined,['http://127.0.0.1:5173']);await restored.ready;await restored.close();
  const store=await AccountStore.open(f.directory);const replacement=new OAuthAccountManager(store);
  const wrong=createAccountServer(replacement,('0x'+'71'.repeat(20)) as `0x${string}`,['http://127.0.0.1:5173']);
  await assert.rejects(wrong.ready);await wrong.close();
  assert.equal(accountOptions({}).operator,undefined);
  assert.equal(accountOptions({PROVIDER_ADDRESS:owner}).operator,owner);
  assert.throws(()=>accountOptions({ACCOUNT_OPERATOR_ADDRESS:'invalid-wallet'}));
});

test('shared dev startup really listens without configuration, reuses live helper and preserves its lock on failures',async t=>{
  const directory=await realpath(await mkdtemp(join(tmpdir(),'account-startup-fixture-')));await chmod(directory,0o700);
  const env={ACCOUNT_STATE_DIR:directory},options=accountOptions(env);
  const service=await startAccountHelper(options,0);
  t.after(async()=>{await service.close();await rm(directory,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${(service.server.address() as {port:number}).port}`;
  const originalFetch=globalThis.fetch;
  try{
    const response=await originalFetch(base+'/accounts/info',{headers:{Origin:'http://127.0.0.1:5173'}});
    assert.equal(response.status,200);const info=await response.json();assert.equal(info.operator,null);assert.equal(info.initializationRequired,true);
    globalThis.fetch=(async(url,init)=>{
      assert.equal(String(url),'http://127.0.0.1:8791/accounts/info');return originalFetch(base+'/accounts/info',init);
    }) as typeof fetch;
    const reused=await developmentAccountHelper(env);assert.equal(reused.owned,false);await reused.close();assert.equal(service.server.listening,true);
    assert.equal((await originalFetch(base+'/accounts/info',{headers:{Origin:'http://127.0.0.1:5173'}})).status,200);
    await assert.rejects(developmentAccountHelper({...env,ACCOUNT_OPERATOR_ADDRESS:'0x'+'81'.repeat(20)}));
    assert.equal(service.server.listening,true); // Never steal the active lock or initialize a mismatched owner.
    globalThis.fetch=async()=>Response.json({service:'unrelated-service'});
    await assert.rejects(developmentAccountHelper(env));assert.equal(service.server.listening,true);
  }finally{globalThis.fetch=originalFetch;}
});
