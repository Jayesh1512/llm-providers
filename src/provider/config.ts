import { resolve } from 'node:path';
import { isAddress, type Address, type Hex } from 'viem';
import { ProviderError } from './errors.js';
import type { ModelConfig, ProviderConfig } from './types.js';
import { z } from 'zod';

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (!value) throw new Error(`Missing configuration: ${key}`);
  return value;
}
function address(env: NodeJS.ProcessEnv, key: string): Address {
  const value = required(env, key);
  if (!isAddress(value)) throw new Error(`Invalid address in ${key}`);
  return value;
}
function integer(value: string | undefined, fallback: number, label: string, min: number, max: number): number {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) throw new Error(`Invalid ${label}`);
  return number;
}
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ProviderConfig {
  const localMode = env.LOCAL_TEST_MODE === 'true';
  const chainId = integer(env.CHAIN_ID, 10143, 'CHAIN_ID', 1, Number.MAX_SAFE_INTEGER);
  if (chainId !== 10143 && !(localMode && chainId === 31337)) throw new Error('Contracts must use Monad testnet (10143), or explicit LOCAL_TEST_MODE=true for local chain 31337.');
  const privateKey = required(env, 'NODE_PRIVATE_KEY');
  if (!/^0x[\da-fA-F]{64}$/.test(privateKey)) throw new Error('Invalid NODE_PRIVATE_KEY');
  let raw: unknown;
  try { raw = JSON.parse(required(env, 'PROVIDER_MODELS_JSON')); } catch { throw new Error('Invalid PROVIDER_MODELS_JSON'); }
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 100) throw new Error('PROVIDER_MODELS_JSON must be a nonempty array of up to 100 paid API models.');
  const models: ModelConfig[] = raw.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Invalid paid API model configuration');
    const { model, apiKind, upstreamModel, baseUrl, apiKeyEnv,authentication } = item as ModelConfig;
    const auth=authentication===undefined?undefined:z.discriminatedUnion('kind',[
      z.object({kind:z.literal('api-key'),provider:z.enum(['anthropic','openai','compatible']),billingSource:z.literal('api-credits'),credentialRef:z.string().uuid().optional()}).strict(),
      z.object({kind:z.literal('chatgpt-oauth'),provider:z.literal('openai'),billingSource:z.literal('chatgpt-plan'),credentialRef:z.string().uuid(),usage:z.literal('personal-local')}).strict(),
    ]).parse(authentication);
    if (typeof model !== 'string' || !model || Buffer.byteLength(model) > 128 || ![1, 2, 3].includes(apiKind) ||
        typeof upstreamModel !== 'string' || !upstreamModel || upstreamModel.length > 128 ||
        (auth?.kind!=='chatgpt-oauth'&&!(auth?.kind==='api-key'&&auth.credentialRef))&&(typeof apiKeyEnv !== 'string' || !/^[A-Z][A-Z0-9_]*$/.test(apiKeyEnv)) || typeof baseUrl !== 'string') throw new Error('Invalid paid API model configuration');
    if(auth?.kind==='api-key'&&auth.credentialRef&&apiKeyEnv)throw new Error('Select a local credential reference or an environment key, not both.');
    const url = new URL(baseUrl);
    if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(localMode && url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) throw new Error('Paid API baseUrl must use HTTPS (loopback HTTP is allowed only in local test mode).');
    if(auth&&(auth.provider!==(apiKind===1?'anthropic':apiKind===2?'openai':'compatible')||auth.kind==='chatgpt-oauth'&&(apiKind!==2||baseUrl!=='https://api.openai.com')))throw new Error('Authentication does not match the upstream API.');
    return { model, apiKind, upstreamModel, baseUrl, apiKeyEnv:apiKeyEnv??'',...(auth?{authentication:auth}:{}) };
  });
  if (new Set(models.map(model => model.model)).size !== models.length) throw new Error('Duplicate model IDs');
  const allowedOrigins = (env.ALLOWED_ORIGINS ?? 'http://localhost:5173').split(',').map(item => item.trim()).filter(Boolean);
  for (const origin of allowedOrigins) {
    if (origin === '*' || new URL(origin).origin !== origin) throw new Error('ALLOWED_ORIGINS must contain exact origins, not wildcards or paths.');
  }
  return {
    provider: address(env, 'PROVIDER_ADDRESS'), privateKey: privateKey as Hex,
    registry: address(env, 'REGISTRY_ADDRESS'), escrow: address(env, 'ESCROW_ADDRESS'),
    chainId, rpcUrl: required(env, 'MONAD_RPC_URL'), models, allowedOrigins, localMode,
    stateDir: resolve(env.STATE_DIR ?? '.provider-state'),
    accountStateDir:resolve(env.ACCOUNT_STATE_DIR??'.account-state'),
    port: integer(env.PROVIDER_PORT, 8787, 'PROVIDER_PORT', 0, 65535),
    maxOutputTokens: integer(env.MAX_OUTPUT_TOKENS, 8192, 'MAX_OUTPUT_TOKENS', 1, 131072),
    maxPromptBytes: integer(env.MAX_PROMPT_BYTES, 32000, 'MAX_PROMPT_BYTES', 1, 48000),
    upstreamTimeoutMs: integer(env.UPSTREAM_TIMEOUT_MS, 60000, 'UPSTREAM_TIMEOUT_MS', 100, 120000),
    maxStateEntries: integer(env.MAX_STATE_ENTRIES, 10000, 'MAX_STATE_ENTRIES', 1, 100000),
  };
}
export function checkCredentials(config: ProviderConfig, env: NodeJS.ProcessEnv = process.env): void {
  if(config.models.some(model=>model.authentication?.kind==='chatgpt-oauth'))throw new ProviderError(503,'subscription_resale_unavailable','ChatGPT OAuth is personal/local only; marketplace supplier authorization is unavailable.');
  if (config.models.some(model => !(model.authentication?.kind==='api-key'&&model.authentication.credentialRef)&&!env[model.apiKeyEnv])) throw new ProviderError(503, 'missing_api_credentials', 'One or more configured paid APIs have no credentials.');
}
