import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { createPublicClient, createWalletClient, http, isAddress, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { registryAbi, registryBytecode, escrowAbi, escrowBytecode } from '../src/shared/contracts.js';
import { assertPublicChain, monadTestnet, MONAD_RPC_URL } from '../src/shared/protocol.js';

// Deliberately no mainnet or arbitrary-chain deployment option.
const rpc = process.env.MONAD_RPC_URL || MONAD_RPC_URL;
const publicClient = createPublicClient({ chain: monadTestnet, transport: http(rpc) });
assertPublicChain(await publicClient.getChainId());
const key = process.env.DEPLOYER_PRIVATE_KEY;
if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
  throw new Error('Set DEPLOYER_PRIVATE_KEY locally in .env, or deploy through the app with your connected wallet. No secret is required in chat.');
}
const account = privateKeyToAccount(key as Hex);
const wallet = createWalletClient({ account, chain: monadTestnet, transport: http(rpc) });
if (await publicClient.getBalance({ address: account.address }) === 0n) {
  throw new Error(`Deployment wallet ${account.address} needs test MON. Use the official Monad testnet faucet.`);
}
let registry: Address;
const existing = process.env.REGISTRY_ADDRESS;
if (existing && isAddress(existing)) {
  registry = existing;
  if (!await publicClient.getCode({ address: registry })) throw new Error('REGISTRY_ADDRESS has no code on Monad testnet.');
  await publicClient.readContract({ address: registry, abi: registryAbi, functionName: 'peerCount' });
} else {
  const hash = await wallet.deployContract({ abi: registryAbi, bytecode: registryBytecode });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success' || !receipt.contractAddress) throw new Error('Registry deployment failed.');
  registry = receipt.contractAddress;
  await mkdir('deployments', { recursive: true });
  await writeFile('deployments/monad-testnet.partial.json', JSON.stringify({ chainId: 10143, registry, registryTransaction: hash }, null, 2) + '\n');
  console.log(`PeerRegistry: ${registry}`);
}
const hash = await wallet.deployContract({ abi: escrowAbi, bytecode: escrowBytecode, args: [registry] });
const receipt = await publicClient.waitForTransactionReceipt({ hash });
if (receipt.status !== 'success' || !receipt.contractAddress) {
  throw new Error(`Escrow deployment failed. Reuse registry ${registry} by setting REGISTRY_ADDRESS before retrying.`);
}
const escrow = receipt.contractAddress;
const deployment = { chainId: 10143, network: 'Monad Testnet', registry, escrow, escrowTransaction: hash, deployer: account.address, deployedAt: new Date().toISOString() };
await mkdir('deployments', { recursive: true });
await writeFile('deployments/monad-testnet.json', JSON.stringify(deployment, null, 2) + '\n');
console.log(`InferenceEscrow: ${escrow}`);
console.log('Deployment confirmed on Monad testnet. Public addresses saved to deployments/monad-testnet.json.');
console.log(`Set REGISTRY_ADDRESS and VITE_REGISTRY_ADDRESS to ${registry}; ESCROW_ADDRESS and VITE_ESCROW_ADDRESS to ${escrow}.`);
