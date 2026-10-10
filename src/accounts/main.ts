import 'dotenv/config';
import { startAccountHelper } from './start.js';

try{
  const service=await startAccountHelper();
  console.info('Local account helper listening on 127.0.0.1:8791. A fresh directory initializes through your wallet signature.');
  let closing=false;const stop=async()=>{if(closing)return;closing=true;await service.close().catch(()=>{process.exitCode=1;});};
  service.server.on('error',()=>{console.error('Local account helper could not serve requests.');process.exitCode=1;void stop();});
  process.once('SIGINT',()=>void stop());process.once('SIGTERM',()=>void stop());
}catch{console.error('Local account helper refused startup. Check port 8791 and the account state-directory owner/permissions/lock.');process.exitCode=1;}
