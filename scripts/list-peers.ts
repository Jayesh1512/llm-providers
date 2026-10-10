import { createPublicClient, http, formatEther, type Address } from 'viem';
import { registryAbi } from '../src/shared/contracts.js';
import { monadTestnet, MONAD_RPC_URL } from '../src/shared/protocol.js';

const registry = process.argv[2] as Address;
if (!registry) throw new Error('Usage: tsx scripts/list-peers.ts <registry-address>');
const c = createPublicClient({ chain: monadTestnet, transport: http(process.env.MONAD_RPC_URL || MONAD_RPC_URL) });
const read = (functionName: string, args: unknown[] = []) => c.readContract({ address: registry, abi: registryAbi, functionName, args } as never) as Promise<any>;
const n = Number(await read('peerCount'));
console.log(`peers: ${n}`);
for (let i = 0; i < n; i++) { const a = await read('peerAt', [BigInt(i)]); console.log(a, await read('getPeer', [a])); }
const m = Number(await read('offerCount'));
console.log(`offers: ${m}`);
for (let i = 0; i < m; i++) { const o = await read('getOffer', [await read('offerIdAt', [BigInt(i)])]); console.log(o.provider, o.model, `active=${o.active}`, `in=${formatEther(o.inputPrice)} out=${formatEther(o.outputPrice)}`); }
