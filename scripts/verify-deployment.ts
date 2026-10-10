import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createPublicClient, getAddress, http, isAddress, zeroAddress, type Address } from 'viem';
import { registryAbi, escrowAbi } from '../src/shared/contracts.js';
import { monadTestnet, MONAD_RPC_URL, MONAD_TESTNET_ID } from '../src/shared/protocol.js';

const deploymentPath = fileURLToPath(new URL('../deployments/monad-testnet.json', import.meta.url));
const usage = 'Usage: npm run verify:monad -- <registry-address> <escrow-address>';

export function parseDeploymentAddresses(args: string[]): { registry: Address; escrow: Address } {
  if (args.length !== 2) throw new Error(usage);
  if (args.some(address => !isAddress(address, { strict: true }) || address.toLowerCase() === zeroAddress)) {
    throw new Error(`Provide two valid, nonzero public contract addresses. ${usage}`);
  }
  const [registry, escrow] = args.map(address => getAddress(address));
  if (registry === escrow) throw new Error('Registry and escrow must be distinct contract addresses.');
  return { registry, escrow };
}

export async function verifyDeployment(args: string[]): Promise<void> {
  const { registry, escrow } = parseDeploymentAddresses(args);
  // Only the public RPC URL is consulted. No dotenv import, signer, or credential is needed.
  const client = createPublicClient({ chain: monadTestnet, transport: http(process.env.MONAD_RPC_URL || MONAD_RPC_URL) });
  const actualChainId = await client.getChainId();
  if (actualChainId !== MONAD_TESTNET_ID) {
    throw new Error(`RPC returned chain ${actualChainId}; verification requires Monad testnet (10143).`);
  }
  const blockNumber = await client.getBlockNumber();
  const [registryCode, escrowCode] = await Promise.all([
    client.getCode({ address: registry, blockNumber }),
    client.getCode({ address: escrow, blockNumber }),
  ]);
  if (!registryCode || registryCode === '0x') throw new Error('Registry address has no deployed code on Monad testnet.');
  if (!escrowCode || escrowCode === '0x') throw new Error('Escrow address has no deployed code on Monad testnet.');

  const [linkedRegistry, peerCount, offerCount, nextRequestId] = await Promise.all([
    client.readContract({ address: escrow, abi: escrowAbi, functionName: 'registry', blockNumber }),
    client.readContract({ address: registry, abi: registryAbi, functionName: 'peerCount', blockNumber }),
    client.readContract({ address: registry, abi: registryAbi, functionName: 'offerCount', blockNumber }),
    client.readContract({ address: escrow, abi: escrowAbi, functionName: 'nextRequestId', blockNumber }),
  ]);
  if (getAddress(linkedRegistry) !== registry) throw new Error('Escrow registry does not match the supplied PeerRegistry address.');
  if (nextRequestId < 1n) throw new Error('Escrow nextRequestId must be at least 1.');

  let existing: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(await readFile(deploymentPath, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Existing deployment file must contain a JSON object.');
    existing = parsed as Record<string, unknown>;
    if (existing.chainId !== undefined && existing.chainId !== MONAD_TESTNET_ID) throw new Error('Existing deployment file is for a different chain; it was not overwritten.');
    for (const [field, address] of [['registry', registry], ['escrow', escrow]] as const) {
      if (existing[field] !== undefined && (typeof existing[field] !== 'string' || existing[field].toLowerCase() !== address.toLowerCase())) {
        throw new Error(`Existing deployment ${field} differs; the file was not overwritten. Archive it before recording a different deployment.`);
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const deployment = {
    ...existing, // Preserve original deployment timestamps, deployer, and transaction hashes.
    chainId: MONAD_TESTNET_ID,
    network: 'Monad Testnet',
    registry,
    escrow,
    verifiedAt: new Date().toISOString(),
    verificationBlock: blockNumber.toString(),
    peerCount: peerCount.toString(),
    offerCount: offerCount.toString(),
    nextRequestId: nextRequestId.toString(),
  };
  await mkdir(dirname(deploymentPath), { recursive: true });
  await writeFile(deploymentPath, JSON.stringify(deployment, null, 2) + '\n');
  console.log(`Verified Monad testnet contracts at block ${blockNumber}.`);
  console.log(`PeerRegistry: ${registry} (${peerCount} peers, ${offerCount} offers)`);
  console.log(`InferenceEscrow: ${escrow} (next request ${nextRequestId})`);
  console.log('Public deployment data saved to deployments/monad-testnet.json. No transaction was sent.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await verifyDeployment(process.argv.slice(2));
  } catch (error) {
    // RPC exceptions can contain full transport URLs. Print only our actionable public errors.
    const message = error instanceof Error && error.constructor === Error
      ? error.message
      : 'Verification failed while reading the RPC or deployment file. Check public addresses, RPC availability, and file permissions.';
    console.error(message);
    process.exitCode = 1;
  }
}
