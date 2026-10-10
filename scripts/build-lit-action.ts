import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { importBytes } from 'ipfs-unixfs-importer';
import { fixedSize } from 'ipfs-unixfs-importer/chunker';
import { balanced } from 'ipfs-unixfs-importer/layout';
import { createHash } from 'node:crypto';
import { manifestSchema } from '../src/privacy/lit-action.js';

const input=process.argv[2];if(!input)throw new Error('Pass a public immutable action manifest JSON; never include API keys.');
const manifest=manifestSchema.parse(JSON.parse(await readFile(input,'utf8')));
const result=await build({entryPoints:['src/privacy/lit-action.ts'],bundle:true,write:false,platform:'browser',target:'es2022',format:'iife',globalName:'LLMProvidersLit',minify:true,legalComments:'eof'});
const source=result.outputFiles[0].text+'\nconst MANIFEST='+JSON.stringify(manifest)+';\nasync function main(params){return LLMProvidersLit.runLitAction(MANIFEST,params)}\n';
const {cid}=await importBytes(new TextEncoder().encode(source),{put:async cid=>cid},{cidVersion:0,rawLeaves:false,leafType:'file',chunker:fixedSize({chunkSize:262144}),layout:balanced({maxChildrenPerNode:174})});
await mkdir('privacy-artifacts',{recursive:true});
await writeFile('privacy-artifacts/action.js',source);
await writeFile('privacy-artifacts/release.json',JSON.stringify({backend:'lit-chipotle',actionId:cid.toString(),sha256:createHash('sha256').update(source).digest('hex'),sourceBytes:Buffer.byteLength(source),manifest},null,2)+'\n');
console.log(`Built immutable Lit Action ${cid}. Local artifact only; no enrollment, billing or public transaction.`);
