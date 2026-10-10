import { ProviderError } from './errors.js';
import type { ModelConfig, UpstreamResult } from './types.js';

type JsonObject = Record<string, unknown>;
function object(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ProviderError(502, 'invalid_upstream_response', 'The paid API returned an invalid response.');
  }
  return value as JsonObject;
}
function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new ProviderError(502, 'invalid_upstream_usage', 'The paid API did not return valid token usage.');
  }
  return value;
}
function optionalCount(value: unknown): number { return value === undefined ? 0 : count(value); }
function sumCounts(...values: number[]): number { return count(values.reduce((sum, n) => sum + n, 0)); }

export function parseUpstreamResponse(apiKind: ModelConfig['apiKind'], value: unknown): UpstreamResult {
  const body = object(value);
  const usage = object(body.usage);
  let text = '';
  let inputTokens: number;
  let outputTokens: number;
  if (apiKind === 1) {
    if (!Array.isArray(body.content)) throw new ProviderError(502, 'invalid_upstream_response', 'Missing response content.');
    text = body.content.map(item => {
      const block = object(item);
      return block.type === 'text' && typeof block.text === 'string' ? block.text : '';
    }).join('');
    inputTokens = sumCounts(count(usage.input_tokens), optionalCount(usage.cache_creation_input_tokens), optionalCount(usage.cache_read_input_tokens));
    outputTokens = count(usage.output_tokens);
  } else if (apiKind === 2) {
    if (!Array.isArray(body.output)) throw new ProviderError(502, 'invalid_upstream_response', 'Missing response content.');
    text = body.output.map(item => {
      const message = object(item);
      if (message.type !== 'message') return '';
      if (!Array.isArray(message.content)) throw new ProviderError(502, 'invalid_upstream_response', 'Missing response content.');
      return message.content.map(item => {
        const block = object(item);
        return block.type === 'output_text' && typeof block.text === 'string' ? block.text : '';
      }).join('');
    }).join('');
    inputTokens = count(usage.input_tokens);
    outputTokens = count(usage.output_tokens);
  } else {
    if (!Array.isArray(body.choices) || body.choices.length !== 1) throw new ProviderError(502, 'invalid_upstream_response', 'Missing response content.');
    const message = object(object(body.choices[0]).message);
    if (typeof message.content !== 'string') throw new ProviderError(502, 'invalid_upstream_response', 'The paid API did not return text.');
    text = message.content;
    inputTokens = count(usage.prompt_tokens);
    outputTokens = count(usage.completion_tokens);
  }
  if (!text) throw new ProviderError(502, 'empty_upstream_response', 'The paid API did not return usable text.');
  return { text, inputTokens, outputTokens };
}

export async function callPaidApi(
  model: ModelConfig,
  prompt: string,
  maxOutputTokens: number,
  options: { env?: NodeJS.ProcessEnv; timeoutMs?: number; fetch?: typeof fetch;credentialResolver?:(model:ModelConfig)=>Promise<string> } = {},
): Promise<UpstreamResult> {
  if(model.authentication?.kind==='chatgpt-oauth')throw new ProviderError(403,'subscription_resale_unavailable','Subscription OAuth cannot be used through the paid supplier API-key adapter.');
  let apiKey:string|undefined;
  if(model.authentication?.kind==='api-key'&&model.authentication.credentialRef){
    if(!options.credentialResolver)throw new ProviderError(503,'managed_api_credentials_unavailable','The selected credential requires the protected local resolver.');
    apiKey=await options.credentialResolver(model);
  }else apiKey=(options.env ?? process.env)[model.apiKeyEnv];
  if (!apiKey) throw new ProviderError(503, 'missing_api_credentials', 'The supplier has not configured credentials for this paid API.');
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  let path: string;
  let body: JsonObject;
  if (model.apiKind === 1) {
    path = '/messages';
    headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = '2023-06-01';
    body = { model: model.upstreamModel, max_tokens: maxOutputTokens, messages: [{ role: 'user', content: prompt }] };
  } else if (model.apiKind === 2) {
    path = '/responses';
    headers.authorization = `Bearer ${apiKey}`;
    body = { model: model.upstreamModel, input: prompt, max_output_tokens: maxOutputTokens, store: false };
  } else {
    path = '/chat/completions';
    headers.authorization = `Bearer ${apiKey}`;
    body = { model: model.upstreamModel, messages: [{ role: 'user', content: prompt }], max_tokens: maxOutputTokens };
  }
  const base = model.baseUrl.replace(/\/$/, '');
  const url = `${base}${base.endsWith('/v1') ? '' : '/v1'}${path}`;
  try {
    const response = await (options.fetch ?? fetch)(url, {
      method: 'POST', headers, body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(options.timeoutMs ?? 60_000),
    });
    if (!response.ok) throw new ProviderError(502, 'upstream_rejected_request', 'The paid API rejected the request.');
    // Do not forward upstream error bodies or headers: either can contain account details.
    const bytes = await readLimitedResponse(response, 2 * 1024 * 1024);
    return parseUpstreamResponse(model.apiKind, JSON.parse(bytes));
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError(502, 'upstream_unavailable', 'The paid API request failed or timed out.');
  }
}

async function readLimitedResponse(response: Response, limit: number): Promise<string> {
  if (!response.body) throw new ProviderError(502, 'invalid_upstream_response', 'The paid API returned an empty response.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        throw new ProviderError(502, 'upstream_response_too_large', 'The paid API response exceeded the size limit.');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const data=new Uint8Array(total);let offset=0;for(const chunk of chunks){data.set(chunk,offset);offset+=chunk.length;}return new TextDecoder('utf-8',{fatal:true}).decode(data);
}
