import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { isAddress, type Address } from 'viem';
import { offerId } from '../src/shared/protocol.js';
import { commitment, randomHash } from '../src/privacy/protocol.js';

const [provider,model,file]=process.argv.slice(2);
const key=process.env.UPSTREAM_API_KEY;
if(!provider||!isAddress(provider)||!model||!file||!key||key.length>4096)throw new Error('Pass provider address, exact public model ID, private output path; set UPSTREAM_API_KEY locally.');
const salt=randomHash();
const credentialCommitment=commitment('credential',key,salt,offerId(provider as Address,model));
await mkdir(dirname(file),{recursive:true,mode:0o700});
await writeFile(file,JSON.stringify({provider,model,key,salt}),{mode:0o600,flag:'wx'});
console.log(JSON.stringify({model,credentialCommitment})); // public commitment only, no key or salt.
