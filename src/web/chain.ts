import { createPublicClient, createWalletClient, custom, getAddress, http, isAddress, parseEventLogs, type Address, type EIP1193Provider, type Hex } from 'viem';
import { registryAbi, registryBytecode, escrowAbi, escrowBytecode } from '../shared/contracts';
import { MONAD_RPC_URL, MONAD_TESTNET_ID, monadTestnet, type OfferWithId, type Peer } from '../shared/protocol';

declare global { interface Window { ethereum?: EIP1193Provider } }
export const publicClient = createPublicClient({ chain: {...monadTestnet,contracts:{multicall3:{address:'0xcA11bde05977b3631167028862bE2a173976CA11'}}}, batch:{multicall:{wait:30}}, transport: http(import.meta.env.VITE_MONAD_RPC_URL || MONAD_RPC_URL,{batch:{wait:30},retryCount:5,retryDelay:400}) });
export type Addresses = { registry?: Address; escrow?: Address };
const addressKey = `llm-providers:contracts:${MONAD_TESTNET_ID}`;
function address(value: unknown): Address | undefined { return typeof value === 'string' && isAddress(value) ? getAddress(value) : undefined; }
export function loadAddresses(): Addresses {
  let saved: Addresses = {};
  try { saved = JSON.parse(localStorage.getItem(addressKey) || '{}'); } catch { /* Recover through Advanced settings. */ }
  return { registry: address(import.meta.env.VITE_REGISTRY_ADDRESS) || address(saved.registry), escrow: address(import.meta.env.VITE_ESCROW_ADDRESS) || address(saved.escrow) };
}
export function saveAddresses(value: Addresses) { localStorage.setItem(addressKey, JSON.stringify(value)); }
export function walletClient() {
  if (!window.ethereum) throw new Error('Install an injected EVM wallet, then connect it here.');
  return createWalletClient({ chain: monadTestnet, transport: custom(window.ethereum) });
}
export async function connectWallet(): Promise<Address> {
  const [account] = await walletClient().requestAddresses();
  if (!account) throw new Error('The wallet did not return an account.');
  return account;
}
export async function walletChainId(): Promise<number> { return walletClient().getChainId(); }
export async function switchNetwork() {
  const wallet = walletClient();
  try { await wallet.switchChain({ id: MONAD_TESTNET_ID }); }
  catch (error) {
    const code = (error as { code?: number; cause?: {code?:number} }).code ?? (error as {cause?:{code?:number}}).cause?.code;
    if (code !== 4902 && !String(error).includes('not been added')) throw error;
    await wallet.addChain({ chain: monadTestnet });
    await wallet.switchChain({ id: MONAD_TESTNET_ID });
  }
}
export async function requireWallet(account?: Address) {
  if (!account) throw new Error('Connect your wallet first.');
  const wallet = walletClient();
  if (await wallet.getChainId() !== MONAD_TESTNET_ID) throw new Error('Switch your wallet to Monad testnet (10143) before continuing.');
  const [current] = await wallet.getAddresses();
  if (!current || current.toLowerCase() !== account.toLowerCase()) throw new Error('The wallet account changed. Reconnect before continuing.');
  return wallet;
}
export async function verifyContracts(value: Addresses): Promise<void> {
  if (!value.registry || !value.escrow) throw new Error('Set up both the peer registry and request escrow in Network.');
  const [registryCode, escrowCode, chainId] = await Promise.all([publicClient.getBytecode({address:value.registry}),publicClient.getBytecode({address:value.escrow}),publicClient.getChainId()]);
  if (chainId !== MONAD_TESTNET_ID) throw new Error('The configured RPC is not Monad testnet (10143).');
  if (!registryCode || registryCode === '0x' || !escrowCode || escrowCode === '0x') throw new Error('No contract exists at one of these Monad testnet addresses. Check both addresses.');
  const linked = await publicClient.readContract({address:value.escrow,abi:escrowAbi,functionName:'registry'});
  if (linked.toLowerCase() !== value.registry.toLowerCase()) throw new Error('This escrow belongs to a different peer registry.');
  await publicClient.readContract({address:value.registry,abi:registryAbi,functionName:'peerCount'});
}
export async function deployContracts(account: Address, current: Addresses, onProgress: (value: Addresses, text:string) => void): Promise<Addresses> {
  const wallet = await requireWallet(account);
  if (await publicClient.getChainId() !== MONAD_TESTNET_ID) throw new Error('Deployment requires the Monad testnet RPC.');
  const result = {...current};
  if (!result.registry) {
    onProgress(result,'Confirm the peer registry deployment in your wallet.');
    const hash = await wallet.deployContract({account,abi:registryAbi,bytecode:registryBytecode});
    onProgress(result,'Waiting for the registry deployment to confirm…');
    const receipt = await publicClient.waitForTransactionReceipt({hash});
    if (receipt.status !== 'success' || !receipt.contractAddress) throw new Error('Registry deployment failed.');
    result.registry = receipt.contractAddress;
    saveAddresses(result);
    onProgress({...result},'Registry deployed. Confirm the escrow deployment in your wallet.');
  } else if (!await publicClient.getBytecode({address:result.registry})) throw new Error('The saved registry has no deployed code.');
  if (!result.escrow) {
    const hash = await wallet.deployContract({account,abi:escrowAbi,bytecode:escrowBytecode,args:[result.registry]});
    onProgress(result,'Waiting for the escrow deployment to confirm…');
    const receipt = await publicClient.waitForTransactionReceipt({hash});
    if (receipt.status !== 'success' || !receipt.contractAddress) throw new Error('Escrow deployment failed. Your deployed registry has been saved; retry to deploy only the escrow.');
    result.escrow = receipt.contractAddress;
    saveAddresses(result);
  }
  await verifyContracts(result);
  onProgress({...result},'Both contracts are ready on Monad testnet.');
  return result;
}
export async function readNetwork(value: Addresses) {
  await verifyContracts(value);
  const registry = value.registry!;
  const [peerCount,offerCount] = await Promise.all([
    publicClient.readContract({address:registry,abi:registryAbi,functionName:'peerCount'}),
    publicClient.readContract({address:registry,abi:registryAbi,functionName:'offerCount'}),
  ]);
  const peers: {address:Address; peer:Peer}[] = [];
  const offers: OfferWithId[] = [];
  for (let start = 0n; start < peerCount; start += 40n) {
    const length = Number(peerCount-start > 40n ? 40n : peerCount-start);
    const batch = await Promise.all(Array.from({length},async (_,index) => {
      const owner = await publicClient.readContract({address:registry,abi:registryAbi,functionName:'peerAt',args:[start+BigInt(index)]});
      const peer = await publicClient.readContract({address:registry,abi:registryAbi,functionName:'getPeer',args:[owner]});
      return {address:owner,peer};
    }));
    peers.push(...batch);
  }
  for (let start = 0n; start < offerCount; start += 40n) {
    const length = Number(offerCount-start > 40n ? 40n : offerCount-start);
    const batch = await Promise.all(Array.from({length},async (_,index) => {
      const id = await publicClient.readContract({address:registry,abi:registryAbi,functionName:'offerIdAt',args:[start+BigInt(index)]});
      const offer = await publicClient.readContract({address:registry,abi:registryAbi,functionName:'getOffer',args:[id]});
      const peer = peers.find(p=>p.address.toLowerCase() === offer.provider.toLowerCase())?.peer;
      return peer ? {...offer,id,peer} : undefined;
    }));
    offers.push(...batch.filter((offer): offer is OfferWithId => !!offer));
  }
  return { peers,offers };
}
export async function confirmTransaction(hash: Hex) {
  const receipt = await publicClient.waitForTransactionReceipt({hash});
  if (receipt.status !== 'success') throw new Error('The transaction reverted. Review the current chain state and retry.');
  return receipt;
}
export function fundedId(logs: Parameters<typeof parseEventLogs>[0]['logs']): bigint {
  const events = parseEventLogs({abi:escrowAbi,eventName:'RequestFunded',logs});
  if (!events.length) throw new Error('Funding confirmed, but its request ID could not be decoded. Find the RequestFunded event in the explorer.');
  return events[0].args.requestId;
}
