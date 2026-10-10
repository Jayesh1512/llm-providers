import { defineChain, encodeAbiParameters, keccak256, toBytes, type Address, type Hex } from 'viem';

export const MONAD_TESTNET_ID = 10143;
export const MONAD_RPC_URL = 'https://testnet-rpc.monad.xyz';
export const monadTestnet = defineChain({
  id: MONAD_TESTNET_ID,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'Test MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [MONAD_RPC_URL] } },
  blockExplorers: { default: { name: 'Monad Testnet Explorer', url: 'https://testnet.monadexplorer.com' } },
  testnet: true,
});
export type ApiKind = 1 | 2 | 3;
export type Peer = { roles: number; active: boolean; operator: Address; endpoint: string; metadataURI: string };
export type Offer = { provider: Address; model: string; apiKind: number; inputPrice: bigint; outputPrice: bigint; active: boolean };
export type OfferWithId = Offer & { id: Hex; peer: Peer };
export type FundedRequest = { consumer: Address; provider: Address; offerId: Hex; promptHash: Hex; deposit: bigint; inputPrice: bigint; outputPrice: bigint; expiresAt: bigint; closed: boolean };
export type InferenceResult = { requestId: string; text: string; inputTokens: number; outputTokens: number; responseHash: Hex; amountWei: string; provider: Address; operator: Address; signature: Hex; responseSalt?: Hex };
export function contentHash(text: string): Hex { return keccak256(toBytes(text)); }
export function offerId(provider: Address, model: string): Hex {
  return keccak256(encodeAbiParameters([{type:'address'},{type:'string'}], [provider,model]));
}
export function quoteCost(inputTokens: bigint, outputTokens: bigint, inputPrice: bigint, outputPrice: bigint): bigint {
  return (inputTokens * inputPrice + outputTokens * outputPrice + 999_999n) / 1_000_000n;
}
export function escrowDomain(chainId: number, escrow: Address) {
  return { name: 'PeerTokensEscrow', version: '1', chainId, verifyingContract: escrow } as const;
}
export function identityDomain(chainId: number, registry: Address) {
  return { name: 'PeerTokensIdentity', version: '1', chainId, verifyingContract: registry } as const;
}
export function invoiceDomain(chainId: number, escrow: Address) {
  return { name: 'PeerTokensInvoice', version: '1', chainId, verifyingContract: escrow } as const;
}
export const inferenceTypes = { InferenceRequest: [
  {name:'requestId',type:'uint256'}, {name:'promptHash',type:'bytes32'}, {name:'maxOutputTokens',type:'uint256'},
] } as const;
export const usageTypes = { UsageReceipt: [
  {name:'requestId',type:'uint256'}, {name:'inputTokens',type:'uint256'}, {name:'outputTokens',type:'uint256'}, {name:'responseHash',type:'bytes32'},
] } as const;
export const identityTypes = { PeerIdentity: [
  {name:'challenge',type:'bytes32'}, {name:'provider',type:'address'}, {name:'registry',type:'address'},
] } as const;
export const invoiceTypes = { Invoice: [
  {name:'requestId',type:'uint256'}, {name:'responseHash',type:'bytes32'}, {name:'inputTokens',type:'uint256'}, {name:'outputTokens',type:'uint256'}, {name:'amountWei',type:'uint256'},
] } as const;
export function assertPublicChain(chainId: number): void {
  if (chainId !== MONAD_TESTNET_ID) throw new Error('Public deployment is restricted to Monad testnet (10143).');
}
export function validatePeerEndpoint(value: string): URL {
  const url = new URL(value);
  const loopback = ['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:'))) {
    throw new Error('Use a public HTTPS peer endpoint, or HTTP on localhost for development.');
  }
  return url;
}
