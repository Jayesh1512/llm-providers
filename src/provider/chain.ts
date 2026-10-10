import { createPublicClient, createWalletClient, defineChain, http, isAddressEqual, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { registryAbi, escrowAbi } from '../shared/contracts.js';
import { monadTestnet } from '../shared/protocol.js';
import { ProviderError } from './errors.js';
import type { ProviderChain, ProviderConfig } from './types.js';

export async function connectChain(config: ProviderConfig): Promise<ProviderChain> {
  if (config.chainId !== 10143 && !(config.localMode && config.chainId === 31337)) throw new Error('Supplier contracts must use Monad testnet; local 31337 requires explicit test mode.');
  const chain = config.chainId === 10143 ? monadTestnet : defineChain({
    id: 31337, name: 'Explicit local test chain', nativeCurrency: { name: 'Test ETH', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [config.rpcUrl] } }, testnet: true,
  });
  const publicClient = createPublicClient({ chain, transport: http(config.rpcUrl, { timeout: 15_000, retryCount: 1 }) });
  const wallet = createWalletClient({ account: privateKeyToAccount(config.privateKey), chain, transport: http(config.rpcUrl, { timeout: 15_000, retryCount: 1 }) });
  if (await publicClient.getChainId() !== config.chainId) throw new Error('Configured RPC chain ID does not match the allowed chain.');
  const [registryCode, escrowCode, escrowRegistry] = await Promise.all([
    publicClient.getCode({ address: config.registry }), publicClient.getCode({ address: config.escrow }),
    publicClient.readContract({ address: config.escrow, abi: escrowAbi, functionName: 'registry' }),
  ]);
  if (!registryCode || registryCode === '0x' || !escrowCode || escrowCode === '0x' || !isAddressEqual(escrowRegistry, config.registry)) throw new Error('Registry and escrow deployment configuration is invalid.');
  // Serialize relay transactions across requests to prevent reuse of one operator nonce.
  let relayQueue: Promise<unknown> = Promise.resolve();
  return {
    getRequestPrivacy: requestId => publicClient.readContract({ address: config.escrow, abi: escrowAbi, functionName: 'requestPrivacyConfig', args: [requestId] }),
    getPrivacyConfig: provider => publicClient.readContract({ address: config.registry, abi: registryAbi, functionName: 'privacyConfigHash', args: [provider] }),
    isPrivacyVerified: (provider, configHash) => publicClient.readContract({address:config.registry,abi:registryAbi,functionName:'isPrivacyVerified',args:[provider,configHash,config.escrow]}),
    getVerifiedEncryptionKeyHash: (provider, configHash) => publicClient.readContract({address:config.registry,abi:registryAbi,functionName:'privacyEncryptionKeyHash',args:[provider,configHash,config.escrow]}),
    async claimPrivate(requestId, authorization) {
      const operation = relayQueue.then(async () => {
        const simulation = await publicClient.simulateContract({address:config.escrow, abi:escrowAbi, functionName:'claimPrivate', args:[requestId,BigInt(authorization.maxOutputTokens),authorization.contextHash,authorization.signature], account:wallet.account});
        const hash = await wallet.writeContract(simulation.request);
        const receipt = await publicClient.waitForTransactionReceipt({hash, confirmations:config.localMode ? 1 : 2, timeout:90_000});
        if (receipt.status !== 'success') throw new Error('Private request acceptance failed.');
      });
      relayQueue = operation.catch(() => {});
      await operation;
    },
    getPass: passId => publicClient.readContract({ address: config.escrow, abi: escrowAbi, functionName: 'getPass', args: [passId] }),
    chargePass(charge): Promise<Hex> {
      const operation = relayQueue.then(async () => {
        const simulation = await publicClient.simulateContract({ address: config.escrow, abi: escrowAbi, functionName: 'chargePass', account: wallet.account, args: [charge.passId, charge.offerId, charge.callId, charge.inputTokens, charge.outputTokens] });
        const hash = await wallet.writeContract(simulation.request);
        const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 90_000 });
        if (receipt.status !== 'success') throw new ProviderError(502, 'charge_reverted', 'Pass charge reverted.');
        return hash;
      });
      relayQueue = operation.catch(() => {});
      return operation;
    },
    getRequest: requestId => publicClient.readContract({ address: config.escrow, abi: escrowAbi, functionName: 'getRequest', args: [requestId] }),
    getPeer: address => publicClient.readContract({ address: config.registry, abi: registryAbi, functionName: 'getPeer', args: [address] }),
    getOffer: id => publicClient.readContract({ address: config.registry, abi: registryAbi, functionName: 'getOffer', args: [id] }),
    settle(receipt): Promise<Hex> {
      const operation = relayQueue.then(async () => {
        try {
          const simulation = await publicClient.simulateContract({
            address: config.escrow, abi: escrowAbi, functionName: 'settle', account: wallet.account,
            args: [receipt.requestId, receipt.inputTokens, receipt.outputTokens, receipt.responseHash, receipt.signature],
          });
          const transactionHash = await wallet.writeContract(simulation.request);
          const transaction = await publicClient.waitForTransactionReceipt({ hash: transactionHash, timeout: 90_000 });
          if (transaction.status !== 'success') throw new ProviderError(502, 'settlement_reverted', 'Usage settlement reverted.');
          return transactionHash;
        } catch (error) {
          if (error instanceof ProviderError) throw error;
          throw new ProviderError(502, 'settlement_failed', 'Could not confirm usage settlement. Check the funded request on-chain before retrying.');
        }
      });
      relayQueue = operation.catch(() => {});
      return operation;
    },
  };
}
