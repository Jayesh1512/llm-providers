export type AccountErrorCode='invalid_request'|'authorization_rejected'|'oauth_unavailable'|'reconnect_required'|'permission_required'|'rate_limited'|'quota_limited'|'restricted'|'unavailable'|'private_oauth_unavailable'|'marketplace_oauth_unavailable'|'storage_unavailable';
const messages:Record<AccountErrorCode,string>={
  invalid_request:'Invalid local account request.',authorization_rejected:'Local account authorization was rejected.',
  oauth_unavailable:'This OAuth connector is unavailable. Use the supported API-key connector.',
  reconnect_required:'Reconnect this ChatGPT account before using it.',permission_required:'ChatGPT plan permission was not granted. Reconnect to authorize it.',
  rate_limited:'The upstream rate limit was reached. Try again later.',quota_limited:'This app or account reached a ChatGPT usage limit. Review ChatGPT usage settings.',
  restricted:'The account, model or integration is not eligible for this request.',unavailable:'The account service could not complete the request. No other billing path was used.',
  private_oauth_unavailable:'Private OAuth is blocked pending Lit action/key evidence and protected refresh storage.',
  marketplace_oauth_unavailable:'Subscription capacity cannot be offered for sale without vendor authorization for this marketplace.',
  storage_unavailable:'Protected account storage is unavailable. Account operations are blocked.',
};
export class AccountError extends Error {
  constructor(readonly code:AccountErrorCode,readonly status=400){super(messages[code]);this.name='AccountError';}
}
export function safeAccountError(error:unknown){const safe=error instanceof AccountError?error:new AccountError('unavailable',503);return {status:safe.status,body:{error:safe.code,message:safe.message}};}
/** Fixed enum diagnostics only; never attach upstream bodies, exception text or identity claims. */
export class OAuthFailure extends AccountError {
  constructor(readonly diagnostic:import('../shared/accounts.js').OAuthDiagnostic){super('authorization_rejected');}
}
