import type { Address, Hex } from 'viem';
import type { FundedRequest as SharedRequest, Peer, Offer } from '../shared/protocol.js';
import type { UpstreamAuthentication } from '../shared/accounts.js';

export type ApiKind = 1 | 2 | 3;
export interface ModelConfig {
  model: string;
  apiKind: ApiKind;
  upstreamModel: string;
  baseUrl: string;
  apiKeyEnv: string;
  authentication?: UpstreamAuthentication;
}
export interface ProviderConfig {
  provider: Address;
  privateKey: Hex;
  registry: Address;
  escrow: Address;
  chainId: number;
  rpcUrl: string;
  models: ModelConfig[];
  allowedOrigins: string[];
  stateDir: string;
  accountStateDir?:string;
  port: number;
  maxOutputTokens: number;
  maxPromptBytes: number;
  upstreamTimeoutMs: number;
  maxStateEntries: number;
  localMode: boolean;
}
export type PeerRecord = Peer;
export type OfferRecord = Offer;
export type FundedRequest = SharedRequest;
export interface UsageReceipt {
  requestId: bigint;
  inputTokens: bigint;
  outputTokens: bigint;
  responseHash: Hex;
  signature: Hex;
}
export interface PassRecord { consumer: Address; provider: Address; keyHash: Hex; deposit: bigint; spent: bigint; maxInputPrice: bigint; maxOutputPrice: bigint; maxCallCost: bigint; expiresAt: bigint; closed: boolean }
export interface PassCharge { passId: bigint; offerId: Hex; callId: Hex; inputTokens: bigint; outputTokens: bigint }
export interface ProviderChain {
  getPass(passId: bigint): Promise<PassRecord>;
  chargePass(charge: PassCharge): Promise<Hex>;
  getRequestPrivacy(requestId: bigint): Promise<Hex>;
  getPrivacyConfig(provider: Address): Promise<Hex>;
  isPrivacyVerified(provider: Address, configHash: Hex): Promise<boolean>;
  getVerifiedEncryptionKeyHash(provider: Address, configHash: Hex): Promise<Hex>;
  claimPrivate(requestId: bigint, authorization: {maxOutputTokens:number; contextHash:Hex; signature:Hex}): Promise<void>;
  getRequest(requestId: bigint): Promise<FundedRequest>;
  getPeer(address: Address): Promise<PeerRecord>;
  getOffer(offerId: Hex): Promise<OfferRecord>;
  settle(receipt: UsageReceipt): Promise<Hex>;
}
export interface InferenceInput {
  requestId: string;
  prompt: string;
  maxOutputTokens: number;
  signature: Hex;
}
export interface UpstreamResult { text: string; inputTokens: number; outputTokens: number }
export interface Invoice extends UpstreamResult {
  responseSalt?: Hex;
  requestId: string;
  responseHash: Hex;
  amountWei: string;
  provider: Address;
  operator: Address;
  signature: Hex;
}
export interface InferenceState {
  status: 'pending' | 'done' | 'failed';
  promptHash: Hex;
  maxOutputTokens: number;
  invoice?: Invoice;
}
export interface StateStore {
  get(requestId: string): InferenceState | undefined;
  set(requestId: string, state: InferenceState): Promise<void>;
}
