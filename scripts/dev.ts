import 'dotenv/config';
import { createServer,type ViteDevServer } from 'vite';
import { developmentAccountHelper } from '../src/accounts/start.js';

let accounts:Awaited<ReturnType<typeof developmentAccountHelper>>|undefined,vite:ViteDevServer|undefined,closing=false;
const close=async()=>{if(closing)return;closing=true;await vite?.close();await accounts?.close();};
try{
  accounts=await developmentAccountHelper();
  vite=await createServer({server:{host:'127.0.0.1',port:5173,strictPort:true}});await vite.listen();vite.printUrls();
  console.info(`Local account helper ${accounts.owned?'started':'already running'} on 127.0.0.1:8791.`);
  process.once('SIGINT',()=>void close());process.once('SIGTERM',()=>void close());
}catch{await close();console.error('Local app startup failed. Check ports 5173/8791 and the account state-directory owner/lock.');process.exitCode=1;}
