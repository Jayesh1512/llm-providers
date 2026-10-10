import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { importBytes } from 'ipfs-unixfs-importer';
import { fixedSize } from 'ipfs-unixfs-importer/chunker';
import { balanced } from 'ipfs-unixfs-importer/layout';
import { parsePrivacyConfig, configHash, contextSchema, envelopeSchema } from './protocol.js';
import { runtimePolicySchema, VerifiedLitChannel } from './lit-channel.js';
import { APPROVED_PRIVACY_CONFIGS } from './trust.js';

try{
  const file=process.argv[2];if(!file)throw new Error('Consumer-owned release config required.');
  const local=JSON.parse(await readFile(file,'utf8')) as {policy:unknown;runtime:unknown;actionFile:string;encryptedCredentials:Record<string,unknown>};
  const policy=parsePrivacyConfig(local.policy);const runtime=runtimePolicySchema.parse(local.runtime);
  if(!APPROVED_PRIVACY_CONFIGS.includes(configHash(policy))||runtime.id!==policy.runtimePolicyId)throw new Error('Unapproved privacy release.');
  const code=await readFile(local.actionFile,'utf8');
  const {cid}=await importBytes(new TextEncoder().encode(code),{put:async cid=>cid},{cidVersion:0,rawLeaves:false,leafType:'file',chunker:fixedSize({chunkSize:262144}),layout:balanced({maxChildrenPerNode:174})});
  if(cid.toString()!==policy.actionId)throw new Error('Immutable action source substituted.');
  const usageKey=process.env.LIT_USAGE_API_KEY;if(!usageKey)throw new Error('Execute-only billing key required.');
  const allowedOrigins=(process.env.ALLOWED_ORIGINS??'http://localhost:5173').split(',').map(v=>v.trim());
  let channel:VerifiedLitChannel|undefined;
  const server=createServer(async(request,response)=>{
    const json=(status:number,value:unknown)=>{response.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});response.end(JSON.stringify(value));};
    try{
      if(request.headers.host!=='127.0.0.1:8790')throw new Error('Host denied.');
      const origin=request.headers.origin;
      if(!origin||!allowedOrigins.includes(origin))throw new Error('Origin denied.');
      response.setHeader('access-control-allow-origin',origin);response.setHeader('vary','Origin');
      if(request.method==='OPTIONS'){response.setHeader('access-control-allow-headers','Content-Type');response.setHeader('access-control-allow-methods','GET,POST,OPTIONS');response.writeHead(204);response.end();return;}
      if(request.method==='GET'&&request.url==='/privacy/config'){json(200,policy);return;}
      if(request.method!=='POST'||!['/privacy/attest','/privacy/infer'].includes(request.url??''))throw new Error('Encrypted route required.');
      if(request.headers['content-type']!=='application/json')throw new Error('JSON required.');
      const chunks:Buffer[]=[];let size=0;for await(const chunk of request){size+=chunk.length;if(size>500000)throw new Error('Size limit.');chunks.push(Buffer.from(chunk));}
      const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));const context=contextSchema.parse(body.context);
      if(context.chainId!==10143||context.configHash!==configHash(policy))throw new Error('Wrong request network/policy.');
      if(request.url==='/privacy/attest'){
        channel=await VerifiedLitChannel.open(runtime,usageKey);
        const binding=await channel.execute(code,{operation:'key',policy,context});
        json(200,{binding,verifiedAt:channel.report.verifiedAt,runtimePolicyId:runtime.id});return;
      }
      if(!channel||Date.now()-channel.report.verifiedAt>60000)throw new Error('No verified Lit channel.');
      const envelope=envelopeSchema.parse(body.envelope);
      json(200,await channel.execute(code,{operation:'infer',policy,context,envelope,credentials:local.encryptedCredentials}));
    }catch{json(400,{error:'private_client_rejected'});}
  });
  server.requestTimeout=180000;server.headersTimeout=10000;server.maxHeadersCount=32;server.listen(8790,'127.0.0.1');
  for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>server.close());
}catch{console.error('Consumer Lit client refused startup. Requires an approved release, pinned full verifier, encrypted credentials and execute-only Lit billing access.');process.exitCode=1;}
