import { Agent, request } from 'node:https';
import { connect, checkServerIdentity } from 'node:tls';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import { verifyAttestation, verifyQuote, CHIPOTLE_ATTESTATION_POLICY, type AttestationReport } from '@lit-protocol/keychain';

export const LIT_ORIGIN='https://api.chipotle.litprotocol.com';
const hex32=z.string().regex(/^[0-9a-f]{64}$/);
const measurement=z.string().regex(/^[0-9a-f]{96}$/);
export const runtimePolicySchema=z.object({
  id:z.string().min(1).max(128),appId:z.literal('3f91deaf16ff7c823ee65081d6bafa1ceea05ffc'),
  composeHash:hex32,osImageHash:hex32,mrKms:z.string().min(1).max(256),
  measurements:z.object({mrtd:measurement,rtmr0:measurement,rtmr1:measurement,rtmr2:measurement,rtmr3:measurement}).strict(),
  // Consumer-owned, independently reviewed dstack-verifier binary; never provider input.
  verifierPath:z.string().startsWith('/'),verifierSha256:hex32,
}).strict();
export type RuntimePolicy=z.infer<typeof runtimePolicySchema>;
export function enforceRuntimeReport(report:AttestationReport,policy:RuntimePolicy,certificate:string,now=Date.now()):void{
  if(report.origin!==LIT_ORIGIN||report.appId!==policy.appId||report.composeHash!==policy.composeHash||report.osImageHash!==policy.osImageHash||report.mrKms!==policy.mrKms||report.tlsCertificateSha256!==certificate||now-report.verifiedAt>60000||report.verifiedAt>now+5000||Object.keys(policy.measurements).some(k=>report.measurements[k as keyof typeof policy.measurements]!==policy.measurements[k as keyof typeof policy.measurements])||!report.checks.includes('tls-certificate-in-tee'))throw new Error('Lit runtime is not approved.');
}
async function observedCertificate():Promise<string>{
  return new Promise((resolve,reject)=>{
    const socket=connect({host:'api.chipotle.litprotocol.com',port:443,servername:'api.chipotle.litprotocol.com',rejectUnauthorized:true});
    socket.setTimeout(10000,()=>socket.destroy(new Error('Lit TLS timeout.')));
    socket.once('error',reject);
    socket.once('secureConnect',()=>{const cert=socket.getPeerCertificate();if(!socket.authorized||!cert.raw){socket.destroy();reject(new Error('Untrusted Lit TLS.'));return;}resolve(createHash('sha256').update(cert.raw).digest('hex'));socket.end();});
  });
}
/** Every application TLS connection checks the attested leaf, rather than trusting a separate probe alone. */
export function certificateVerifier(expected:string){return (host:string,cert:Parameters<typeof checkServerIdentity>[1])=>{
  const error=checkServerIdentity(host,cert);if(error)return error;
  if(!cert.raw||createHash('sha256').update(cert.raw).digest('hex')!==expected)return new Error('Lit TLS certificate substituted.');
};}
function pinnedJson(path:string,certificate:string,body?:unknown,usageKey?:string):Promise<unknown>{
  if(!path.startsWith('/')||path.includes('://'))throw new Error('Invalid Lit API path.');
  const agent=new Agent({keepAlive:false,checkServerIdentity:certificateVerifier(certificate),rejectUnauthorized:true});
  return new Promise((resolve,reject)=>{
    const req=request(`${LIT_ORIGIN}${path}`,{agent,method:body?'POST':'GET',headers:{'content-type':'application/json',...(usageKey?{'x-api-key':usageKey,'x-privacy-mode':'true'}:{})}},res=>{
      const chunks:Buffer[]=[];let total=0;
      res.on('data',(chunk:Buffer)=>{total+=chunk.length;if(total>16*1024*1024){res.destroy(new Error('Lit reply limit.'));return;}chunks.push(chunk);});
      res.once('error',reject);res.once('end',()=>{agent.destroy();if(res.statusCode!==200){reject(new Error('Lit request rejected.'));return;}try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{reject(new Error('Invalid Lit response.'));}});
    });
    req.setTimeout(180000,()=>req.destroy(new Error('Lit timeout.')));req.once('error',error=>{agent.destroy();reject(error);});req.end(body?JSON.stringify(body):undefined);
  });
}
function verifierRequest(attestation:Record<string,unknown>,quote:string):unknown{
  const events=JSON.parse(String(attestation.event_log)) as Record<string,unknown>[];
  for(const event of events)if(event.digest===''&&event.event_type===0x08000001){
    const prefix=Buffer.alloc(4);prefix.writeUInt32LE(0x08000001);
    event.digest=createHash('sha384').update(Buffer.concat([prefix,Buffer.from(':'+String(event.event)+':'),Buffer.from(String(event.event_payload),'hex')])).digest('hex');
  }
  return {quote:quote.replace(/^0x/,''),event_log:JSON.stringify(events),vm_config:attestation.vm_config,attestation:null};
}
/** Policy over a result from the independently pinned full verifier, never a supplier verdict. */
export function enforceFullVerification(value:unknown,reportData:string):void{
  const result=z.object({is_valid:z.literal(true),details:z.object({
    quote_verified:z.literal(true),event_log_verified:z.literal(true),os_image_hash_verified:z.literal(true),
    tcb_status:z.literal('UpToDate'),advisory_ids:z.array(z.string()).length(0),
    report_data:z.literal(reportData),os_image_is_dev:z.boolean().nullable().optional(),
  }).passthrough()}).passthrough().parse(value);
  if(result.details.os_image_is_dev===true)throw new Error('Development Lit OS refused.');
}
async function verifyCollateral(policy:RuntimePolicy,attestation:Record<string,unknown>,quotes:string[]):Promise<void>{
  if(createHash('sha256').update(await readFile(policy.verifierPath)).digest('hex')!==policy.verifierSha256)throw new Error('Unapproved collateral verifier.');
  const dir=await mkdtemp(join(tmpdir(),'llm-lit-verification-'));
  try{
    for(const [i,quote]of quotes.entries()){
      const parsed=verifyQuote(quote);
      if(BigInt('0x'+parsed.tdAttributes.match(/../g)!.reverse().join(''))&1n)throw new Error('Debug Lit quote refused.');
      if(Object.keys(policy.measurements).some(k=>parsed.measurements[k as keyof typeof policy.measurements]!==policy.measurements[k as keyof typeof policy.measurements]))throw new Error('Lit evidence measurements differ.');
      const input=join(dir,`quote-${i}.json`);await writeFile(input,JSON.stringify(verifierRequest(attestation,quote)),{mode:0o600});
      await promisify(execFile)(policy.verifierPath,['--verify',input],{timeout:60000,maxBuffer:1024*1024,env:{PATH:'/usr/bin:/bin'}});
      const result=JSON.parse(await readFile(input+'.verification.json','utf8'));
      enforceFullVerification(result,parsed.reportData);
    }
  }finally{await rm(dir,{recursive:true,force:true});}
}
export class VerifiedLitChannel{
  private constructor(private readonly certificate:string,readonly report:AttestationReport,private readonly usageKey:string){}
  static async open(policyValue:unknown,usageKey:string):Promise<VerifiedLitChannel>{
    const policy=runtimePolicySchema.parse(policyValue);
    if(!usageKey||usageKey.length>512)throw new Error('Execute-only Lit billing credential required.');
    const certificate=await observedCertificate();
    const report=await verifyAttestation(LIT_ORIGIN,CHIPOTLE_ATTESTATION_POLICY,{tlsCertificateSha256:certificate,timeoutMs:15000});
    enforceRuntimeReport(report,policy,certificate);
    // SDK omits Intel collateral/revocation; require the approved full verifier for BOTH quotes.
    const attestation=await pinnedJson('/attestation',certificate) as Record<string,unknown>;
    const evidence=await pinnedJson('/evidences/quote.json',certificate) as {quote:string};
    await verifyCollateral(policy,attestation,[String(attestation.quote),evidence.quote]);
    return new VerifiedLitChannel(certificate,{...report,verifiedAt:Date.now()},usageKey);
  }
  async execute(code:string,params:unknown):Promise<unknown>{
    if(Date.now()-this.report.verifiedAt>60000)throw new Error('Lit verification expired.');
    const value=await pinnedJson('/core/v1/lit_action',this.certificate,{code,js_params:params},this.usageKey) as {has_error?:boolean;response?:{ok?:boolean;result?:unknown}};
    if(value.has_error!==false||value.response?.ok!==true)throw new Error('Lit private action rejected.');
    return value.response.result;
  }
}
