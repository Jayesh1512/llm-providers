import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { PrivacyGateway } from './gateway.js';

async function readJson(request:IncomingMessage):Promise<unknown> {
  if (request.headers['content-type']?.split(';')[0] !== 'application/json') throw new Error('JSON required.');
  const chunks:Buffer[]=[]; let total=0;
  for await(const chunk of request){total+=chunk.length;if(total>140000)throw new Error('Privacy request too large.');chunks.push(Buffer.from(chunk));}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function json(response:ServerResponse,status:number,value:unknown){
  response.writeHead(status,{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'});
  response.end(JSON.stringify(value));
}
/** LOCAL TEST HARNESS ONLY. Constructing a gateway on an ordinary host provides no privacy. */
export function createPrivacyServer(gateway:PrivacyGateway){
  const server=createServer(async(request,response)=>{
    try{
      const path=request.url;
      if(request.method==='GET'&&path==='/privacy/config'){json(response,200,gateway.policy);return;}
      if(request.method==='POST'&&path==='/privacy/attest'){json(response,200,await gateway.attest(await readJson(request)));return;}
      if(request.method==='POST'&&path==='/privacy/infer'){json(response,200,await gateway.infer(await readJson(request)));return;}
      json(response,404,{error:'encrypted_endpoint_required'});
    }catch{json(response,400,{error:'private_request_rejected'});}
  });
  server.requestTimeout=180000;server.headersTimeout=10000;server.maxHeadersCount=32;
  return server;
}
/** LOCAL TEST HARNESS ONLY: opaque loopback relay, not the production Lit connection. */
export function createPrivacyRelay(destination:string,allowedOrigins:readonly string[]){
  const url=new URL(destination);
  if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw new Error('Test relay requires a fixed loopback destination.');
  const server=createServer(async(request,response)=>{
    try{
      const origin=request.headers.origin;
      if(origin){if(!allowedOrigins.includes(origin))throw new Error('Origin denied.');response.setHeader('access-control-allow-origin',origin);response.setHeader('vary','Origin');}
      if(request.method==='OPTIONS'){response.setHeader('access-control-allow-methods','GET, POST, OPTIONS');response.setHeader('access-control-allow-headers','Content-Type');response.writeHead(204);response.end();return;}
      const path=request.url;
      if(!((request.method==='GET'&&path==='/privacy/config')||(request.method==='POST'&&(path==='/privacy/attest'||path==='/privacy/infer')))){json(response,404,{error:'encrypted_endpoint_required'});return;}
      const body=request.method==='POST'?await readJson(request):undefined;
      // Shape checks prevent accidental plaintext at this relay; enclave validates cryptography.
      if(path==='/privacy/infer'&&(!body||typeof body!=='object'||'prompt' in body||!('envelope' in body)||!('context' in body)))throw new Error('Encrypted envelope required.');
      const upstream=await fetch(`${url.origin}${path}`,{method:request.method,headers:body?{'content-type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(180000)});
      if(!upstream.body)throw new Error('Empty reply.');
      const chunks:Uint8Array[]=[];let size=0;
      for await(const chunk of upstream.body as unknown as AsyncIterable<Uint8Array>){size+=chunk.length;if(size>4300000)throw new Error('Reply too large.');chunks.push(chunk);}
      json(response,upstream.ok?200:400,JSON.parse(Buffer.concat(chunks).toString('utf8')));
    }catch{json(response,400,{error:'private_relay_unavailable'});}
  });
  server.requestTimeout=180000;server.headersTimeout=10000;server.maxHeadersCount=32;
  return server;
}
