import type { OAuthDiagnostic } from '../shared/accounts';

const stages = { callback: true, exchange: true, identity: true, token_schema: true, storage: true, lifecycle: true } satisfies Record<OAuthDiagnostic['stage'], true>;
const reasons = {
  state_mismatch: true, redirect_mismatch: true, callback_parameters: true, issuer_mismatch: true,
  client_mismatch: true, missing_code: true, consent_denied: true, attempt_expired: true, attempt_cancelled: true,
  exchange_invalid_grant: true, exchange_rejected: true, exchange_unavailable: true, missing_id_token: true,
  jwks_unavailable: true, jwks_invalid: true, identity_signature: true, identity_key: true, identity_algorithm: true,
  identity_issuer: true, identity_audience: true, identity_nonce: true, identity_time: true, identity_subject: true,
  identity_invalid: true, invalid_token_response: true, storage_unavailable: true,
} satisfies Record<OAuthDiagnostic['reason'], true>;

/** Keep only bounded public codes, even if a helper reply contains unexpected fields. */
export function boundedOAuthDiagnostic(value: unknown): OAuthDiagnostic | undefined {
  if (!value || typeof value !== 'object') return;
  const { stage, reason } = value as Record<string, unknown>;
  if (typeof stage !== 'string' || typeof reason !== 'string' || !Object.hasOwn(stages, stage) || !Object.hasOwn(reasons, reason)) return;
  return { stage, reason } as OAuthDiagnostic;
}
