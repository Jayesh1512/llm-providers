import { constants } from 'node:fs';
import { mkdir,open,lstat,rename,unlink,realpath,readdir } from 'node:fs/promises';
import { resolve,join } from 'node:path';
import { randomBytes,randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AccountError } from './errors.js';

const token=z.string().min(1).max(32000);
const registration=z.object({
  credentialRef:z.string().uuid(),provider:z.literal('openai'),clientId:z.string().regex(/^oaiapp_[a-zA-Z0-9_-]{1,200}$/),subject:z.string().min(1).max(256),
  email:z.string().max(320).optional(),status:z.enum(['connected','expired','refreshing','reconnect_required','permission_required','signed_out','rate_limited','quota_limited','unavailable','restricted']),
  revision:z.number().int().nonnegative(),retryAt:z.number().int().nonnegative().optional(),remoteRevocationConfirmed:z.boolean().optional(),
  tokens:z.object({accessToken:token,refreshToken:token,idToken:token,scopes:z.array(z.string()).max(32),expiresAt:z.number().int().positive(),earliestRefreshAt:z.number().int().nonnegative(),nonce:token}).strict().optional(),
}).strict();
export type Registration=z.infer<typeof registration>;
const stateSchema=z.object({version:z.literal(1),operator:z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),hostId:z.string().uuid(),serviceId:z.string().regex(/^0x[0-9a-f]{64}$/),revision:z.number().int().nonnegative(),accounts:z.array(registration).max(32)}).strict();
type State=z.infer<typeof stateSchema>;
/** One writer per directory; atomic 0600 snapshots. Ordinary host storage, NOT a protected Lit store. */
export class AccountStore {
  private tail:Promise<unknown>=Promise.resolve();
  private failed=false;
  private closed=false;
  private constructor(readonly directory:string,private state:State,private lease:Awaited<ReturnType<typeof open>>){}
  static async open(directory:string):Promise<AccountStore>{
    const path=resolve(directory);let lease:Awaited<ReturnType<typeof open>>|undefined;
    try{
      await mkdir(path,{recursive:true,mode:0o700});
      const info=await lstat(path);
      if(!info.isDirectory()||info.isSymbolicLink()||info.mode&0o077||info.uid!==process.getuid?.()||await realpath(path)!==path)throw new Error('Unsafe directory');
      lease=await open(join(path,'.lock'),constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);
      await lease.writeFile(JSON.stringify({pid:process.pid}));await lease.sync();
      // Interrupted atomic writes can contain credentials. Remove them before serving this directory.
      for(const name of await readdir(path))if(/^\.snapshot-[0-9a-f-]{36}$/.test(name)){
        const stat=await lstat(join(path,name));
        if(!stat.isFile()||stat.isSymbolicLink()||stat.mode&0o077||stat.uid!==process.getuid?.())throw new Error('Unsafe interrupted snapshot');
        await unlink(join(path,name));
      }
      let state:State;
      try{
        const file=await open(join(path,'accounts.json'),constants.O_RDONLY|constants.O_NOFOLLOW);
        try{const stat=await file.stat();if(stat.mode&0o077||stat.uid!==process.getuid?.()||stat.size>2*1024*1024)throw new Error('Unsafe credential file');state=stateSchema.parse(JSON.parse(await file.readFile('utf8')));}finally{await file.close();}
      }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;state={version:1,hostId:randomUUID(),serviceId:'0x'+randomBytes(32).toString('hex'),revision:0,accounts:[]};}
      if(new Set(state.accounts.map(a=>a.credentialRef)).size!==state.accounts.length||new Set(state.accounts.map(a=>a.clientId)).size!==state.accounts.length)throw new Error('Duplicate registrations');
      const store=new AccountStore(path,state,lease);
      // A crash during rotation/revocation has an unknown remote result. Never reuse the old refresh token.
      await store.update(s=>{for(const a of s.accounts)if(a.status==='refreshing'){delete a.tokens;a.status='reconnect_required';a.revision++;}});
      return store;
    }catch{if(lease){await lease.close();await unlink(join(path,'.lock')).catch(()=>{});}throw new AccountError('storage_unavailable',503);}
  }
  snapshot():State{if(this.failed)throw new AccountError('storage_unavailable',503);return structuredClone(this.state);}
  async bindOperator(operator:string){await this.update(s=>{if(s.operator&&s.operator.toLowerCase()!==operator.toLowerCase())throw new AccountError('authorization_rejected',403);s.operator=operator.toLowerCase();});}
  update(change:(state:State)=>void):Promise<void>{
    const task=this.tail.then(async()=>{
      if(this.failed)throw new AccountError('storage_unavailable',503);
      const next=structuredClone(this.state);change(next);next.revision++;
      const parsed=stateSchema.parse(next);const temporary=join(this.directory,'.snapshot-'+randomUUID());
      try{
        const fd=await open(temporary,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);
        try{await fd.writeFile(JSON.stringify(parsed));await fd.sync();}finally{await fd.close();}
        await rename(temporary,join(this.directory,'accounts.json'));
        const directory=await open(this.directory,constants.O_RDONLY);try{await directory.sync();}finally{await directory.close();}
        this.state=parsed;
      }catch{this.failed=true;throw new AccountError('storage_unavailable',503);}finally{await unlink(temporary).catch(()=>{});}
    });
    this.tail=task.catch(()=>{});return task;
  }
  async changeAccount(ref:string,change:(account:Registration)=>void):Promise<void>{await this.update(s=>{const a=s.accounts.find(a=>a.credentialRef===ref);if(!a)throw new AccountError('invalid_request');change(a);a.revision++;});}
  async close(){if(this.closed)return;this.closed=true;await this.tail;await this.lease.close();await unlink(join(this.directory,'.lock'));this.failed=true;}
}
