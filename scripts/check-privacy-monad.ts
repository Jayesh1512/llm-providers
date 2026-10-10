import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { encodeAbiParameters, encodeFunctionData, sha256, type Hex } from 'viem';
import { proofVerifierAbi, proofVerifierBytecode } from '../src/shared/attestation-contracts.js';
import { MONAD_RPC_URL } from '../src/shared/protocol.js';

// Read-only eth_call/eth_estimateGas. No signer, broadcast, funded account, deployment or third-party billing.
const rpc=process.env.MONAD_RPC_URL??MONAD_RPC_URL;
let sequence=0;
async function call(method:string,params:unknown[]):Promise<Hex>{
  const response=await fetch(rpc,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++sequence,method,params}),signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error(`RPC HTTP ${response.status}`);
  const json=await response.json() as {result?:Hex;error?:{code:number;message:string}};
  if(json.error||!json.result)throw new Error(`${method}: ${json.error?.code} ${json.error?.message??'missing result'}`);
  return json.result;
}
if(Number(BigInt(await call('eth_chainId',[])))!==10143)throw new Error('Monad testnet 10143 only.');
const word=(n:bigint)=>n.toString(16).padStart(64,'0');
const precompiles=[['0x0000000000000000000000000000000000000006','0x'+word(1n)+word(2n)+word(0n)+word(0n),'0x'+word(1n)+word(2n)],['0x0000000000000000000000000000000000000007','0x'+word(1n)+word(2n)+word(1n),'0x'+word(1n)+word(2n)],['0x0000000000000000000000000000000000000008','0x','0x'+word(1n)]];
const observations=[];
for(const [to,data,expected]of precompiles){const actual=await call('eth_call',[{to,data},'latest']);if(actual!==expected)throw new Error(`Unexpected precompile ${to} result.`);observations.push({address:to,passed:true});}
const sizes:Record<string,{runtimeBytes:number;initcodeBytes:number}>={};
for(const name of ['PeerRegistry','InferenceEscrow','ZkDcapGatewayVerifier','RiscZeroGroth16Verifier']){
  const artifact=JSON.parse(await readFile(`out/${name}.sol/${name}.json`,'utf8'));
  const runtimeBytes=(artifact.deployedBytecode.object.length-2)/2,initcodeBytes=(artifact.bytecode.object.length-2)/2;
  if(runtimeBytes>24576||initcodeBytes>49152)throw new Error(`${name} exceeds conservative EIP170/EIP3860 limits.`);
  sizes[name]={runtimeBytes,initcodeBytes};
}
const roots=encodeAbiParameters([{type:'bytes32'},{type:'bytes32'}],['0xa54dc85ac99f851c92d7c96d7318af41dbe7c0194edfcc37eb4d422a998c1f56','0x04446e66d300eb7fb45c9726bb53c793dda407a62e9601618bb43c5c14657ac0']);
const code=await call('eth_call',[{data:proofVerifierBytecode+roots.slice(2),gas:'0xf42400'},'latest']);
// Temporary state override only. This address is not a deployment or a project contract address.
const to='0x00000000000000000000000000000000fffe0001';
const override={[to]:{code}};
const source=await readFile('test/fixtures/ArchivedAutomataDcapReceipt.sol','utf8');
function fixture(name:string):Hex{const hex=new RegExp(name+'\\s*=\\s*(?:hex"([0-9a-f]+)"|0x([0-9a-f]+))').exec(source);if(!hex)throw new Error('Bad public fixture');return ('0x'+(hex[1]??hex[2])) as Hex;}
const data=encodeFunctionData({abi:proofVerifierAbi,functionName:'verify',args:[fixture('SEAL'),fixture('IMAGE_ID'),sha256(fixture('JOURNAL'))]});
let proof:Record<string,unknown>;
try{
  await call('eth_call',[{to,data,gas:'0xf42400'},'latest',override]);
  const gas=await call('eth_estimateGas',[{to,data},'latest',override]);
  proof={archivedHardwareProofCryptography:true,gasEstimate:Number(BigInt(gas)),stateOverrideOnly:true,productionGatewayAccepted:false};
}catch(error){proof={stateOverrideProofCheckUnavailable:String(error),productionGatewayAccepted:false};}
const report={checkedAt:new Date().toISOString(),chainId:10143,rpc,precompiles:observations,sizes,proof,transactionsSent:0};
await mkdir('privacy-artifacts',{recursive:true});await writeFile('privacy-artifacts/monad-feasibility.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
