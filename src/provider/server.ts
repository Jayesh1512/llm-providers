import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import type { Hex } from 'viem';
import { callPaidApi } from './adapters.js';
import { connectChain } from './chain.js';
import { checkCredentials } from './config.js';
import { ProviderCore, type CoreOptions } from './core.js';
import { ProviderError } from './errors.js';
import { FileStateStore } from './persistence.js';
import type { InferenceInput, ProviderChain, ProviderConfig, StateStore } from './types.js';
import { PassGateway, messagesToPrompt } from './pass.js';
import { resolveManagedApiKey } from '../accounts/api-keys.js';

interface ServerDependencies {
  chain?: ProviderChain;
  store?: StateStore;
  upstream?: CoreOptions['upstream'];
  env?: NodeJS.ProcessEnv;
  now?: () => number;
}
async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  const contentType = request.headers['content-type']?.split(';')[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') throw new ProviderError(415, 'json_required', 'Use application/json.');
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > 65_536) throw new ProviderError(413, 'body_too_large', 'Request body exceeds 64 KiB.');
    chunks.push(Buffer.from(chunk));
  }
  let value: unknown;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new ProviderError(400, 'invalid_json', 'Invalid JSON body.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ProviderError(400, 'invalid_json', 'JSON body must be an object.');
  return value as Record<string, unknown>;
}
function json(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  response.end(JSON.stringify(value));
}

export async function createProviderServer(config: ProviderConfig, dependencies: ServerDependencies = {}) {
  if (config.chainId !== 10143 && !(config.localMode && config.chainId === 31337)) throw new Error('Supplier must use Monad testnet, or explicit local test chain.');
  if (dependencies.upstream && !config.localMode) throw new Error('Injected upstream fixtures are allowed only in explicit local test mode.');
  const chain = dependencies.chain ?? await connectChain(config);
  const journal = dependencies.store ? undefined : await FileStateStore.open(join(config.stateDir, `${config.chainId}-${config.escrow.toLowerCase()}-${config.provider.toLowerCase()}`), config.maxStateEntries);
  const store = dependencies.store ?? journal!;
  const credentialResolver=(model:ProviderConfig['models'][number])=>resolveManagedApiKey(model,config.provider,config.accountStateDir??'.account-state');
  const credentialsReady=async()=>{
    checkCredentials(config,dependencies.env);
    for(const model of config.models)if(model.authentication?.kind==='api-key'&&model.authentication.credentialRef)await credentialResolver(model);
  };
  const upstream = dependencies.upstream ?? ((model, prompt, maximum) => callPaidApi(model, prompt, maximum, { env: dependencies.env, timeoutMs: config.upstreamTimeoutMs,credentialResolver }));
  const now = dependencies.now ?? (() => Math.floor(Date.now() / 1000));
  const core = new ProviderCore({ config, chain, store, upstream, now });
  const gateway = new PassGateway({ config, chain, operator: core.operator, upstream, now, statsFile: journal ? join(config.stateDir, `${config.chainId}-${config.escrow.toLowerCase()}-${config.provider.toLowerCase()}`, 'pass-stats.json') : undefined });
  async function openAiRoute(request: IncomingMessage, response: ServerResponse, path: string) {
    if (request.method === 'GET' && path === '/v1/models') {
      json(response, 200, { object: 'list', data: gateway.models().map(id => ({ id, object: 'model', created: 0, owned_by: config.provider })) }); return;
    }
    if (request.method !== 'POST' || path !== '/v1/chat/completions') throw new ProviderError(404, 'not_found', 'Unknown endpoint. Use /v1/chat/completions or /v1/models.');
    const bearer = /^Bearer (\S+)$/.exec(request.headers.authorization ?? '')?.[1];
    if (!bearer) throw new ProviderError(401, 'invalid_api_key', 'Send your key as `Authorization: Bearer <key>`.');
    const value = await body(request);
    if (!dependencies.upstream) await credentialsReady();
    const max = value.max_completion_tokens ?? value.max_tokens ?? 1024;
    const done = await gateway.complete(bearer, { model: String(value.model ?? ''), prompt: messagesToPrompt(value.messages), maxOutputTokens: typeof max === 'number' ? max : NaN });
    const id = `chatcmpl-${Date.now().toString(36)}`, created = now();
    const usage = { prompt_tokens: done.inputTokens, completion_tokens: done.outputTokens, total_tokens: done.inputTokens + done.outputTokens };
    if (value.stream === true) {
      // ponytail: the whole reply is sent as one SSE chunk after the upstream finishes; real token streaming needs streaming adapters.
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
      const chunk = (delta: object, finish: string | null, extra: object = {}) => `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model: done.model, choices: [{ index: 0, delta, finish_reason: finish }], ...extra })}\n\n`;
      response.end(chunk({ role: 'assistant', content: done.text }, null) + chunk({}, 'stop', { usage }) + 'data: [DONE]\n\n'); return;
    }
    json(response, 200, { id, object: 'chat.completion', created, model: done.model, choices: [{ index: 0, message: { role: 'assistant', content: done.text }, finish_reason: 'stop' }], usage });
  }
  const server = createHttpServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://supplier.invalid');
    const openAi = url.pathname.startsWith('/v1/');
    try {
      const origin = request.headers.origin;
      // /v1 is bearer-authenticated (no cookies), so any browser origin may call it.
      if (openAi) response.setHeader('access-control-allow-origin', '*');
      else if (origin) {
        if (!config.allowedOrigins.includes(origin)) throw new ProviderError(403, 'origin_not_allowed', 'Browser origin is not allowed by this supplier.');
        response.setHeader('access-control-allow-origin', origin);
        response.setHeader('vary', 'Origin');
      }
      if (request.method === 'OPTIONS') {
        response.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
        response.setHeader('access-control-allow-headers', 'Content-Type, Authorization, X-Inference-Signature');
        response.setHeader('access-control-max-age', '600');
        response.writeHead(204); response.end(); return;
      }
      if (openAi) { await openAiRoute(request, response, url.pathname); return; }
      if (request.method === 'GET' && url.pathname === '/health') {
        let ready = true,unavailableCode='missing_api_credentials';
        try {
          if(config.models.some(model=>model.authentication?.kind==='chatgpt-oauth'))throw new ProviderError(503,'subscription_resale_unavailable','Personal OAuth cannot serve supplier requests.');
          if (!dependencies.upstream) await credentialsReady();
        } catch (error) { ready = false;if(error instanceof ProviderError)unavailableCode=error.code; }
        json(response, ready ? 200 : 503, {
          ready, ...(ready ? {} : { error: unavailableCode }),
          provider: config.provider, operator: core.operator, chainId: config.chainId, registry: config.registry, escrow: config.escrow,
          models: config.models.map(model => ({ model: model.model, apiKind: model.apiKind,upstreamProvider:model.authentication?.provider??(model.apiKind===1?'anthropic':model.apiKind===2?'openai':'compatible'),authentication:model.authentication?.kind??'api-key',billingSource:model.authentication?.billingSource??'api-credits' })),
        }); return;
      }
      if (request.method === 'GET' && url.pathname === '/stats') {
        const funded = journal?.summary() ?? { requests: 0, earnedWei: 0n }, api = gateway.stats();
        json(response, 200, { requests: funded.requests, requestEarningsWei: funded.earnedWei.toString(), apiCalls: api.calls, apiEarningsWei: api.earnedWei, apiInputTokens: api.inputTokens, apiOutputTokens: api.outputTokens }); return;
      }
      if (request.method === 'GET' && url.pathname === '/identity') {
        json(response, 200, await core.identity((url.searchParams.get('challenge') ?? '') as Hex)); return;
      }
      if (request.method === 'GET' && /^\/requests\/[1-9]\d*$/.test(url.pathname)) {
        const signature = request.headers['x-inference-signature'];
        json(response, 200, await core.recover({ requestId: url.pathname.split('/')[2]!, maxOutputTokens: Number(url.searchParams.get('maxOutputTokens')), signature: (typeof signature === 'string' ? signature : '') as Hex })); return;
      }
      if (request.method === 'POST' && url.pathname === '/infer') {
        const value = await body(request);
        if (!dependencies.upstream) await credentialsReady();
        json(response, 200, await core.infer(value as unknown as InferenceInput)); return;
      }
      if (request.method === 'POST' && url.pathname === '/settle') {
        const value = await body(request);
        const transactionHash = await core.settle(value as unknown as Parameters<ProviderCore['settle']>[0]);
        json(response, 200, { transactionHash }); return;
      }
      throw new ProviderError(404, 'not_found', 'Unknown supplier endpoint.');
    } catch (error) {
      // Never log or return prompts, API credentials, upstream bodies, or RPC errors.
      const safe = error instanceof ProviderError ? error : new ProviderError(503, 'supplier_unavailable', 'Supplier could not complete the request.');
      if (!response.headersSent) json(response, safe.status, openAi ? { error: { message: safe.message, type: 'invalid_request_error', code: safe.code } } : { error: safe.code, message: safe.message });
      else response.end();
    }
  });
  server.requestTimeout = 120_000;
  server.headersTimeout = 10_000;
  server.maxHeadersCount = 32;
  return {
    server, core,
    async close() {
      if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      await journal?.close();
    },
  };
}
