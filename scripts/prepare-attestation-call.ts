import { readFile } from 'node:fs/promises';
import { encodeFunctionData, isAddress, type Address, type Hex } from 'viem';
import { z } from 'zod';
import { registryAbi } from '../src/shared/contracts.js';
import { attestationAbi } from '../src/shared/attestation-contracts.js';

// Wallet-reviewable calldata only; never signs, sends a transaction or trusts a 'verified' flag.
const [operation,file]=process.argv.slice(2);
if(!file||!['configure','challenge','submit'].includes(operation))throw new Error('Usage: configure|challenge|submit public-input.json');
const input=JSON.parse(await readFile(file,'utf8'));
if(!isAddress(input.to))throw new Error('Explicit Monad contract address required.');
const hash=z.string().regex(/^0x[0-9a-f]{64}$/).transform(v=>v as Hex);
const address=z.string().refine(isAddress).transform(v=>v as Address);
const identitySchema=z.object({provider:address,operator:address,configHash:hash,actionIdHash:hash,actionKeyHash:hash,encryptionKeyHash:hash,tlsCertificateHash:hash}).strict();
let data:Hex;
if(operation==='configure'){
  const policy=z.object({escrow:address,revoker:address,measurements:hash,minimumTcb:z.number().int().positive().max(2**32-1)}).strict().parse(input.policy);
  data=encodeFunctionData({abi:registryAbi,functionName:'configurePrivacyVerifier',args:[policy.escrow,policy.revoker,policy.measurements,policy.minimumTcb]});
}else if(operation==='challenge'){
  data=encodeFunctionData({abi:attestationAbi,functionName:'beginVerification',args:[identitySchema.parse(input.identity)]});
}else{
  const proof=z.object({programId:z.literal('65ca60d4fce9aed394c4363c4cc550e781995c296eefe9f93858689078ccf82e'),seal:z.string().regex(/^0x[0-9a-f]{520}$/),journal:z.string().regex(/^0x[0-9a-f]+$/).max(8194),onchainVerified:z.literal(false)}).strict().parse(input.proof);
  data=encodeFunctionData({abi:attestationAbi,functionName:'submitGateway',args:[identitySchema.parse(input.identity),hash.parse(input.challenge),proof.seal as Hex,proof.journal as Hex]});
}
console.log(JSON.stringify({chainId:10143,to:input.to,data,value:'0x0',unsigned:true,transactionSent:false},null,2));
