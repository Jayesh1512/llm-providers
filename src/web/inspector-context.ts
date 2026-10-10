import { getAddress, isAddress, zeroAddress, type Address } from 'viem';

export type InspectorContext = { registry?: Address; escrow?: Address; provider?: Address; requestId?: string };

export function validInspectorRequestId(value: string) {
  return /^[1-9]\d{0,76}$/.test(value) && BigInt(value) < 2n ** 256n;
}

/** Only public contract/wallet identities and a numeric request ID cross tabs. */
export function inspectorHref(context: InspectorContext) {
  const params = new URLSearchParams();
  for (const key of ['registry', 'escrow', 'provider'] as const) {
    const value = context[key];
    if (value && isAddress(value) && value.toLowerCase() !== zeroAddress) params.set(key, getAddress(value));
  }
  if (context.requestId && validInspectorRequestId(context.requestId)) params.set('requestId', context.requestId);
  return `/inspector${params.size ? `?${params}` : ''}`;
}

export function parseInspectorContext(search: string): { context: InspectorContext; error?: string } {
  const params = new URLSearchParams(search);
  const context: InspectorContext = {};
  for (const key of ['registry', 'escrow', 'provider'] as const) {
    const value = params.get(key);
    if (value === null) continue;
    if (params.getAll(key).length !== 1 || !isAddress(value) || value.toLowerCase() === zeroAddress) return { context: {}, error: `Invalid ${key} address. Open the inspector again from the app.` };
    context[key] = getAddress(value);
  }
  const requestId = params.get('requestId');
  if (requestId !== null) {
    if (params.getAll('requestId').length !== 1 || !validInspectorRequestId(requestId)) return { context: {}, error: 'Invalid request ID. Open the inspector again from the app.' };
    context.requestId = requestId;
  }
  return { context };
}
