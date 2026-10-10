import { zeroAddress, type Address, type Hex } from 'viem';

export type UpstreamAuthentication =
  | {kind:'api-key';provider:'anthropic'|'openai'|'compatible';billingSource:'api-credits';credentialRef?:string}
  | {kind:'chatgpt-oauth';provider:'openai';billingSource:'chatgpt-plan';credentialRef:string;usage:'personal-local'};
export type AccountStatus='connected'|'expired'|'refreshing'|'reconnect_required'|'permission_required'|'signed_out'|'rate_limited'|'quota_limited'|'unavailable'|'restricted';
export interface ConnectedAccount {
  credentialRef:string;provider:'openai';kind:'chatgpt-oauth';billingSource:'chatgpt-plan';usage:'personal-local';
  accountLabel:string;workspaceLabel:string;status:AccountStatus;expiresAt?:number;retryAt?:number;remoteRevocationConfirmed?:boolean;
}
export type SaveApiKeyInput =
  | {provider:'anthropic'|'openai'|'compatible';model:string;upstreamModel:string;baseUrl:string;apiKey:string;discoverModels?:false}
  | {provider:'openai';baseUrl:'https://api.openai.com';apiKey:string;discoverModels:true;model?:never;upstreamModel?:never};
export interface ManagedProviderModelConfig {
  model:string;upstreamModel:string;apiKind:1|2|3;baseUrl:string;apiKeyEnv:'';
  authentication:{kind:'api-key';provider:SaveApiKeyInput['provider'];billingSource:'api-credits';credentialRef:string};
}
export type ApiKeyDiscoveryError='invalid_credentials'|'forbidden'|'rate_limited'|'unavailable'|'invalid_catalog';
export interface ApiKeyCatalog {
  source:'openai-models';capabilityPolicy:'openai-text-2026-10-10';
  status:'ready'|'failed'|'not_requested';discoveredAt?:number;error?:ApiKeyDiscoveryError;
  models:{model:string;upstreamModel:string;apiKind:2;providerModelConfig:ManagedProviderModelConfig}[];
  unsupported:{id:string;reason:'non_text_or_specialized'|'fine_tune'|'unsupported_by_adapter'}[];
}
export interface ApiKeyConnection {
  credentialRef:string;provider:SaveApiKeyInput['provider'];kind:'api-key';billingSource:'api-credits';
  // Legacy manual bindings remain exact. Catalog credentials have no implicitly selected model.
  model?:string;upstreamModel?:string;baseUrl:string;credentialLabel:string;validation:'unverified';
  providerModelConfig?:ManagedProviderModelConfig;catalog?:ApiKeyCatalog;
}
export interface AccountChallenge {serviceId:Hex;origin:string;challenge:Hex;expiresAt:number;operator:Address;initializing?:boolean}
export interface OAuthDiagnostic {
  stage:'callback'|'exchange'|'identity'|'token_schema'|'storage'|'lifecycle';
  reason:'state_mismatch'|'redirect_mismatch'|'callback_parameters'|'issuer_mismatch'|'client_mismatch'|'missing_code'|'consent_denied'|'attempt_expired'|'attempt_cancelled'|'exchange_invalid_grant'|'exchange_rejected'|'exchange_unavailable'|'missing_id_token'|'jwks_unavailable'|'jwks_invalid'|'identity_signature'|'identity_key'|'identity_algorithm'|'identity_issuer'|'identity_audience'|'identity_nonce'|'identity_time'|'identity_subject'|'identity_invalid'|'invalid_token_response'|'storage_unavailable';
}
export interface OAuthAttemptStatus {status:'pending'|'connected'|'rejected';diagnostic?:OAuthDiagnostic}
export const accountManagementTypes={LocalAccountAccess:[
  {name:'serviceId',type:'bytes32'},{name:'origin',type:'string'},{name:'challenge',type:'bytes32'},
  {name:'expiresAt',type:'uint64'},{name:'purpose',type:'string'},
]} as const;
export const accountManagementDomain={name:'LLMProvidersLocalAccounts',version:'1',chainId:10143,verifyingContract:zeroAddress} as const;
export function accountManagementMessage(c:AccountChallenge){return {serviceId:c.serviceId,origin:c.origin,challenge:c.challenge,expiresAt:BigInt(c.expiresAt),purpose:c.initializing?'Initialize local account management for this wallet':'Manage personal local accounts'};}
export const ACCOUNT_SERVICE_ORIGIN='http://127.0.0.1:8791';
export const CLAUDE_OAUTH_UNAVAILABLE='Claude OAuth has no verified authorized third-party app/client route. Use an Anthropic Console API key.';
export const MARKETPLACE_OAUTH_UNAVAILABLE='Subscription OAuth is unavailable for paid supplier inference without vendor authorization for this marketplace.';
export const PRIVATE_OAUTH_UNAVAILABLE='Private OAuth requires hardware-authenticated Lit action/key binding and protected, rollback-safe refresh storage. No host fallback is allowed.';
export function assertAccountUsage(usage:'personal-local'|'marketplace',privateMode:boolean):void{
  if(privateMode)throw new Error(PRIVATE_OAUTH_UNAVAILABLE);
  if(usage!=='personal-local')throw new Error(MARKETPLACE_OAUTH_UNAVAILABLE);
}
