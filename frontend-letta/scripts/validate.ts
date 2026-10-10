/** Isolated browser fixtures. No real wallet, vendor account, helper mutation or chain write. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { decodeFunctionData, encodeFunctionResult, parseEther, zeroAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { registryAbi, escrowAbi } from '../../src/shared/contracts';
const playwrightPath = process.env.PLAYWRIGHT_MODULE || '/tmp/llm-ui-work/node_modules/playwright/index.mjs';
const { chromium } = await import(pathToFileURL(playwrightPath).href);
const base = process.env.FRONTEND_URL || 'http://127.0.0.1:5174';
const out = path.resolve('frontend-letta/screenshots');
await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const checks:string[]=[];
const mark=(label:string)=>checks.push(label);
const wallet=privateKeyToAccount(`0x${'12'.repeat(32)}`);
const registry=`0x${'11'.repeat(20)}`,escrow=`0x${'22'.repeat(20)}`;
const suppliers=[`0x${'33'.repeat(20)}`,`0x${'44'.repeat(20)}`];
const ids=[`0x${'55'.repeat(32)}`,`0x${'66'.repeat(32)}`];
const exactModel='openai/gpt-6.1-sol';
let removed=false;let saved:any[]=[];let keySaves=0;let catalogFailure=false;let signedPurpose='';let paidCalls=0;let chainWrites=0;
const errors:string[]=[];let demoFixture=false;let consentComplete=false;let fixtureInferences=0;let consentCalls=0;let rejectConsent=false;let delayedInference=false;let unknownDiagnostic=false;
async function fixtureContext(width=1440,height=1000){
 const ctx=await browser.newContext({viewport:{width,height},deviceScaleFactor:1,reducedMotion:'reduce'});
 await ctx.addInitScript('window.__name = (target) => target;');
 await ctx.exposeFunction('fixtureSign',async(data:any)=>{signedPurpose=data.message?.purpose||'';return wallet.signTypedData(data)});
 await ctx.addInitScript(({address,registry,escrow}:any)=>{
  localStorage.setItem('llm-providers:contracts:10143',JSON.stringify({registry,escrow}));
  let current=address;const listeners:Record<string,Function[]>={};
  (window as any).fixtureWalletChange=(next:string)=>{current=next;for(const f of listeners.accountsChanged||[])f([next]);};
  (window as any).ethereum={on:(event:string,f:Function)=>(listeners[event]??=[]).push(f),removeListener:(event:string,f:Function)=>listeners[event]=listeners[event]?.filter(v=>v!==f),request:async({method,params}:any)=>{
   if(method==='eth_accounts'||method==='eth_requestAccounts')return [current];
   if(method==='eth_chainId')return '0x279f';
   if(method==='eth_signTypedData_v4')return (window as any).fixtureSign(JSON.parse(params[1]));
   throw new Error(`Fixture blocks wallet method ${method}`);
  }};
 },{address:wallet.address,registry,escrow});
 await ctx.route('**/*',async(route:any)=>{
  const req=route.request(),url=new URL(req.url());
  if(url.origin===base)return route.continue();
  if(url.hostname==='127.0.0.1'&&url.port==='8791'){
   const body=req.postDataJSON?.()||{};let result:any;
   const p=url.pathname.split('/').at(-1);
   if(req.method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':base,'access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'content-type,authorization'}});
   if(p==='info')result={operator:null,initializationRequired:true,oauthDiagnostics:'stages-v1',serviceId:`0x${'77'.repeat(32)}`};
   else if(p==='challenge')result={operator:body.operator,initializing:true,origin:base,serviceId:`0x${'77'.repeat(32)}`,challenge:`0x${'88'.repeat(32)}`,expiresAt:Math.floor(Date.now()/1000)+60};
   else if(p==='session')result={session:'FIXTURE-MEMORY-SESSION',expiresAt:Math.floor(Date.now()/1000)+600};
   else if(p==='status')result={accounts:demoFixture&&consentComplete?[{credentialRef:'fixture-oauth',provider:'openai',kind:'chatgpt-oauth',billingSource:'chatgpt-plan',usage:'personal-local',accountLabel:'Fixture owner',workspaceLabel:'Fixture workspace',status:'connected'}]:[]};
   else if(p==='connect'){consentCalls++;result={attemptId:'fixture-attempt',authorizationUrl:'https://auth.openai.com/api/accounts/authorize?client_id=fixture'};}
   else if(p==='attempt'){consentComplete=!rejectConsent;result=rejectConsent?{status:'rejected',diagnostic:unknownDiagnostic?{stage:'unexpected',reason:'FIXTURE_TOKEN'}:{stage:'identity',reason:'identity_nonce',callbackUrl:'https://callback.invalid/?code=FIXTURE_CODE',token:'FIXTURE_TOKEN'}}:{status:'connected'};}
   else if(p==='models')result={models:[{slug:'gpt-6.1-sol',displayName:'Fixture Sol'},{slug:'gpt-6-luna',displayName:'Fixture Luna'}]};
   else if(p==='api-keys')result={credentials:saved};
   else if(p==='save'){
    assert.equal(body.apiKey,'fixture-key-never-a-real-secret');
    keySaves++;assert.equal(body.discoverModels,true);assert.equal(body.model,undefined);assert.equal(body.upstreamModel,undefined);
    const models=['gpt-6.1-sol','gpt-6-astra','gpt-6-luna'].map(id=>({model:'openai/'+id,upstreamModel:id,apiKind:2,providerModelConfig:{model:'openai/'+id,upstreamModel:id,apiKind:2,baseUrl:body.baseUrl,apiKeyEnv:'',authentication:{kind:'api-key',provider:'openai',billingSource:'api-credits',credentialRef:'fixture-ref'}}}));
    saved=[{credentialRef:'fixture-ref',provider:'openai',baseUrl:body.baseUrl,credentialLabel:'••••ret',validation:'unverified',kind:'api-key',billingSource:'api-credits',catalog:{source:'openai-models',capabilityPolicy:'openai-text-2026-10-10',status:'ready',discoveredAt:Math.floor(Date.now()/1000),models,unsupported:[{id:'gpt-image-1',reason:'non_text_or_specialized'}]}}];result={credential:saved[0]};
   }else if(p==='discover'){assert.equal(body.credentialRef,'fixture-ref');if(catalogFailure){saved[0].catalog={...saved[0].catalog,status:'failed',error:'forbidden',models:[]};}result={credential:saved[0]};
   }else if(p==='remove'){saved=[];result={removed:true};}
   else if(p==='lock')result={locked:true};
   else if(p==='infer'){if(demoFixture){fixtureInferences++;if(delayedInference)await new Promise(resolve=>setTimeout(resolve,800));assert.equal(body.usage,'personal-local');assert.equal(body.privateMode,false);result={result:{text:'Synthetic fixture response. No vendor call.',inputTokens:12,outputTokens:8},marketplaceInvoice:false};}else{paidCalls++;return route.abort();}}
   else result={message:'Fixture intentionally does not execute consent or inference'};
   return route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':base},body:JSON.stringify(result)});
  }
  if(req.method()==='POST'&&url.hostname.includes('monad')){
   const requests=req.postDataJSON();
   const respond=(r:any)=>{
    let result:any='0x';
    if(r.method==='eth_chainId')result='0x279f';
    else if(r.method==='eth_getCode')result='0x60016000';
    else if(r.method==='eth_call'){
     const abi=r.params[0].to.toLowerCase()===escrow?escrowAbi:registryAbi;
     const call=decodeFunctionData({abi,data:r.params[0].data});let value:any;
     if(call.functionName==='registry')value=registry;
     else if(call.functionName==='peerCount')value=3n;
     else if(call.functionName==='offerCount')value=2n;
     else if(call.functionName==='peerAt')value=[...suppliers,wallet.address][Number(call.args?.[0])];
     else if(call.functionName==='offerIdAt')value=ids[Number(call.args?.[0])];
     else if(call.functionName==='getPeer'){const addr=String(call.args?.[0]);value={roles:addr.toLowerCase()===wallet.address.toLowerCase()?2:1,active:true,operator:wallet.address,endpoint:'http://127.0.0.1:8787',metadataURI:''};}
     else if(call.functionName==='getOffer'){const i=ids.indexOf(String(call.args?.[0]));value={provider:suppliers[i],model:exactModel,apiKind:2,inputPrice:parseEther(i?'0.2':'0.1'),outputPrice:parseEther(i?'0.8':'0.4'),active:!(removed&&i===0)};}
     else if(call.functionName==='credits')value=0n;
     else throw new Error(`Unexpected fixture read ${call.functionName}`);
     result=encodeFunctionResult({abi,functionName:call.functionName,result:value} as any);
    }else {chainWrites++;throw new Error(`Fixture blocks chain method ${r.method}`);}
    return {jsonrpc:'2.0',id:r.id,result};
   };
   return route.fulfill({contentType:'application/json',body:JSON.stringify(Array.isArray(requests)?requests.map(respond):respond(requests))});
  }
  if(url.pathname.includes('/infer'))paidCalls++;
  return route.abort();
 });return ctx;
}
try{
 // Real empty screen: public catalog remains unchecked without configured contracts.
 const ctx=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
 const p=await ctx.newPage();p.on('pageerror',(e:any)=>errors.push(e.message));
 await p.goto(base);await p.evaluate(()=>document.fonts.ready);
 await p.getByRole('tab',{name:'Providers',exact:true}).waitFor();
 await p.screenshot({path:path.join(out,'desktop-providers.png'),fullPage:true});
 await p.getByRole('tab',{name:'Providers',exact:true}).focus();await p.keyboard.press('ArrowRight');
 assert.equal(await p.getByRole('tab',{name:'Consumers',exact:true}).getAttribute('aria-selected'),'true');
 assert.equal(await p.locator('.model-choice select').inputValue(),'');
 assert.equal(await p.locator('.provider-choice select').isDisabled(),true);
 assert.equal(await p.locator('.model-choice select').locator('option').count(),16);
 assert.match(await p.locator('.model-choice select').textContent(),/availability unchecked/);
 mark('Primary keyboard tabs and truthful unchecked 15-model catalog');
 await p.screenshot({path:path.join(out,'desktop-consumers.png'),fullPage:true});
 await p.getByRole('tab',{name:'Consumers',exact:true}).focus();await p.keyboard.press('Home');
 await p.getByRole('tab',{name:'OAuth',exact:true}).click();assert.equal(await p.getByRole('button',{name:'Connect Claude',exact:true}).isDisabled(),true);
 await p.getByRole('button',{name:'Use Claude API key',exact:true}).click();await p.locator('input[type="password"]').fill('fixture-key-never-a-real-secret');
 await p.getByRole('button',{name:'Cancel',exact:true}).click();await p.getByRole('button',{name:'Add Claude API key',exact:true}).click();assert.equal(await p.locator('input[type="password"]').inputValue(),'');
 await p.locator('input[type="password"]').fill('fixture-key-never-a-real-secret');await p.getByRole('tab',{name:'OAuth',exact:true}).click();await p.getByRole('tab',{name:'API keys',exact:true}).click();await p.getByRole('button',{name:'Add Claude API key',exact:true}).click();assert.equal(await p.locator('input[type="password"]').inputValue(),'');
 mark('Claude OAuth disabled, API-key alternative works, secrets clear on cancel and nested tab change');
 await ctx.close();
 const mobile=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});const mp=await mobile.newPage();await mp.goto(base);await mp.evaluate(()=>document.fonts.ready);
 await mp.screenshot({path:path.join(out,'mobile-providers.png'),fullPage:true});assert.equal(await mp.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await mp.getByRole('tab',{name:'Consumers',exact:true}).click();await mp.screenshot({path:path.join(out,'mobile-consumers.png'),fullPage:true});assert.equal(await mp.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);mark('390px provider and consumer screens fit viewport');await mobile.close();
 const fctx=await fixtureContext();const fp=await fctx.newPage();fp.on('pageerror',(e:any)=>errors.push(e.message));await fp.goto(base);
 await fp.getByRole('tab',{name:'Consumers',exact:true}).click();await fp.locator('.model-choice select').selectOption(exactModel);
 await fp.locator('.provider-choice select').waitFor({state:'visible'});await fp.waitForFunction(()=>!document.querySelector<HTMLSelectElement>('.provider-choice select')?.disabled);
 assert.equal(await fp.locator('.provider-choice select').inputValue(),'');
 const optionText=await fp.locator('.provider-choice select').textContent();assert.match(optionText,/input 0.1 \/ output 0.4/);assert.match(optionText,/input 0.2 \/ output 0.8/);
 await fp.locator('.provider-choice select').selectOption(ids[0]);await fp.getByLabel('Prompt',{exact:true}).fill('Fixture prompt; never sent upstream.');await fp.getByLabel('Maximum budget (test MON)',{exact:true}).fill('0.03');
 await fp.locator('.request-options summary').click();assert.equal(await fp.getByLabel('Prompt privacy',{exact:true}).locator('option[value="private"]').evaluate((e:HTMLOptionElement)=>e.disabled),true);assert.equal(await fp.getByLabel('Output token limit',{exact:true}).inputValue(),'1024');
 await fp.evaluate(()=>{const b=document.createElement('div');b.textContent='BROWSER FIXTURE — synthetic registry, wallet and prices. No live inference or payments.';b.style.cssText='background:#f3dfa4;color:#201900;padding:12px 24px;font:14px sans-serif';document.body.prepend(b);});
 await fp.screenshot({path:path.join(out,'desktop-fixture-request.png'),fullPage:true});
 await fp.locator('.model-choice select').selectOption('anthropic/claude-opus-5-5');assert.equal(await fp.locator('.provider-choice select').inputValue(),'');assert.equal(await fp.locator('.provider-choice select').isDisabled(),true);
 await fp.locator('.model-choice select').selectOption(exactModel);await fp.locator('.provider-choice select').selectOption(ids[0]);removed=true;await fp.getByRole('button',{name:'Refresh providers',exact:true}).click();await fp.waitForFunction(()=>document.querySelector<HTMLSelectElement>('.provider-choice select')?.options.length===2);assert.equal(await fp.locator('.provider-choice select').inputValue(),'');
 mark('Fixture exact peer dropdown, separate rates, model-change and supplier-removal clear choice; no fallback; private blocked');
 await fp.getByRole('tab',{name:'Providers',exact:true}).click();await fp.getByRole('button',{name:'Add OpenAI API key',exact:true}).click();await fp.locator('input[type="password"]').fill('fixture-key-never-a-real-secret');assert.equal(await fp.getByRole('textbox',{name:/^Exact upstream model ID/}).count(),0);await fp.getByRole('button',{name:'Save API key & load models',exact:true}).click();await fp.getByText('Saved locally · unverified',{exact:true}).waitFor();assert.equal(signedPurpose,'Initialize local account management for this wallet');
 assert.equal(await fp.locator('input[type="password"]').count(),0);assert.equal(await fp.evaluate(()=>JSON.stringify({...localStorage})).then((v:string)=>v.includes('fixture-key-never-a-real-secret')||v.includes('FIXTURE-MEMORY-SESSION')),false);
 assert.equal(await fp.locator('.catalog-model').count(),3);assert.equal(await fp.locator('#publish-offer button.button').first().isDisabled(),true);
 await fp.getByRole('button',{name:'Prepare offer for gpt-6-astra',exact:true}).click();assert.equal(await fp.getByLabel('Public model identifier',{exact:true}).inputValue(),'openai/gpt-6-astra');assert.equal(await fp.getByLabel('Public model identifier',{exact:true}).getAttribute('readonly'),'');assert.equal(await fp.getByLabel('Input test MON / 1M tokens',{exact:true}).inputValue(),'');await fp.getByLabel('Input test MON / 1M tokens',{exact:true}).fill('0.2');await fp.getByLabel('Output test MON / 1M tokens',{exact:true}).fill('0.8');
 await fp.getByRole('button',{name:'Prepare offer for gpt-6-luna',exact:true}).click();assert.equal(await fp.getByLabel('Public model identifier',{exact:true}).inputValue(),'openai/gpt-6-luna');assert.equal(await fp.getByLabel('Input test MON / 1M tokens',{exact:true}).inputValue(),'');
 await fp.screenshot({path:path.join(out,'desktop-fixture-catalog.png'),fullPage:true});
 const mc=await fixtureContext(390,844);const mcp=await mc.newPage();await mcp.goto(base);await mcp.getByRole('button',{name:'Unlock saved accounts',exact:true}).click();await mcp.getByRole('button',{name:'Prepare offer for gpt-6-luna',exact:true}).click();await mcp.evaluate(()=>{const b=document.createElement('div');b.textContent='ISOLATED CATALOG FIXTURE — synthetic wallet and metadata';b.style.cssText='padding:12px;background:#f3dfa4;color:#201900';document.body.prepend(b);});await mcp.screenshot({path:path.join(out,'mobile-fixture-catalog.png'),fullPage:true});assert.equal(await mcp.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await mc.close();
 catalogFailure=true;await fp.getByRole('button',{name:'Refresh catalog',exact:true}).click();await fp.getByText(/Discovery failed \(forbidden\)/).waitFor();assert.equal(await fp.locator('.catalog-model').count(),0);assert.equal(await fp.getByLabel('Public model identifier',{exact:true}).inputValue(),'');assert.equal(keySaves,1);mark('One protected key save exposes all three authenticated fixture text models; exact per-model config/prices require explicit preparation; failed ref-only discovery clears prepared selection');
 await fp.getByRole('button',{name:'Remove key',exact:true}).click();await fp.getByRole('button',{name:'Confirm removal',exact:true}).click();await fp.getByText('No accounts saved.',{exact:false}).waitFor();mark('Actual imported client handles fixture signed initialization, masked unverified save/list/remove; no browser secret/session storage');
 await fp.getByRole('button',{name:'Add OpenAI API key',exact:true}).click();await fp.locator('input[type="password"]').fill('fixture-key-never-a-real-secret');await fp.evaluate(()=> (window as any).fixtureWalletChange(`0x${'99'.repeat(20)}`));await fp.waitForFunction(()=>!document.querySelector('input[type="password"]'));await fp.getByRole('button',{name:'Add OpenAI API key',exact:true}).click();assert.equal(await fp.locator('input[type="password"]').inputValue(),'');mark('Wallet change locks accounts and clears typed secret');
 assert.equal(paidCalls,0);assert.equal(chainWrites,0);assert.deepEqual(errors,[]);mark('Zero paid inference, zero chain writes, zero page errors');await fctx.close();
 demoFixture=true;const dctx=await fixtureContext();const dp=await dctx.newPage();dp.on('pageerror',(e:any)=>errors.push(e.message));await dp.goto(base+'/demo');await dp.getByRole('heading',{name:'Personal mini chat',exact:true}).waitFor();assert.equal(consentCalls,0);assert.equal(await dp.getByRole('button',{name:'Send prompt',exact:true}).isDisabled(),true);const de=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});const dep=await de.newPage();await dep.goto(base+'/demo');await dep.evaluate(()=>document.fonts.ready);await dep.screenshot({path:path.join(out,'desktop-demo.png'),fullPage:true});await de.close();const me=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});const mep=await me.newPage();await mep.goto(base+'/demo');await mep.evaluate(()=>document.fonts.ready);await mep.screenshot({path:path.join(out,'mobile-demo.png'),fullPage:true});assert.equal(await mep.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await me.close();
 await dp.getByRole('button',{name:'Authorize local session',exact:true}).click();await dp.getByRole('button',{name:'Refresh connection status',exact:true}).waitFor();assert.equal(consentCalls,0);const popupPromise=dp.waitForEvent('popup');await dp.getByRole('button',{name:'Connect ChatGPT',exact:true}).click();const pop=await popupPromise;await dp.getByRole('button',{name:'Load account models',exact:true}).waitFor();await pop.close();assert.equal(consentCalls,1);await dp.getByRole('button',{name:'Load account models',exact:true}).click();await dp.waitForFunction(()=>document.querySelector<HTMLSelectElement>('select[aria-label="Exact account model"]')?.options.length===3);assert.equal(await dp.getByLabel('Exact account model',{exact:true}).inputValue(),'');await dp.getByLabel('Exact account model',{exact:true}).selectOption('gpt-6.1-sol');await dp.getByLabel('Message',{exact:true}).fill('Synthetic personal prompt');await dp.getByRole('button',{name:'Send prompt',exact:true}).click();await dp.getByText('Synthetic fixture response. No vendor call.',{exact:true}).waitFor();assert.equal(fixtureInferences,1);assert.match(await dp.locator('.chat-message.assistant').textContent(),/input 12 \/ output 8/);await dp.evaluate(()=>{const b=document.createElement('div');b.textContent='ISOLATED OAUTH / CHAT FIXTURE — no real sign-in or vendor usage';b.style.cssText='padding:12px;background:#f3dfa4;color:#201900';document.body.prepend(b);});await dp.screenshot({path:path.join(out,'desktop-demo-fixture-chat.png'),fullPage:true});delayedInference=true;await dp.getByLabel('Message',{exact:true}).fill('Stopped fixture prompt');await dp.getByRole('button',{name:'Send prompt',exact:true}).focus();await dp.keyboard.press('Enter');await dp.getByRole('button',{name:'Stop waiting',exact:true}).click();await dp.getByText('Stopped displaying this request.',{exact:false}).waitFor();await dp.waitForFunction(()=>!document.querySelector('.chat-loading'));assert.equal(await dp.locator('.chat-message.assistant').count(),1);delayedInference=false;mark('Demo keyboard submit, loading and Stop waiting ignore late output without claiming upstream cancellation');const dm=await fixtureContext(390,844);const dmp=await dm.newPage();await dmp.goto(base+'/demo');await dmp.getByRole('button',{name:'Authorize local session',exact:true}).click();await dmp.getByRole('button',{name:'Load account models',exact:true}).click();await dmp.waitForFunction(()=>document.querySelector<HTMLSelectElement>('select[aria-label="Exact account model"]')?.options.length===3);await dmp.getByLabel('Exact account model',{exact:true}).selectOption('gpt-6.1-sol');await dmp.getByLabel('Message',{exact:true}).fill('Synthetic personal prompt');await dmp.getByRole('button',{name:'Send prompt',exact:true}).click();await dmp.getByText('Synthetic fixture response. No vendor call.',{exact:true}).waitFor();await dmp.evaluate(()=>{const b=document.createElement('div');b.textContent='ISOLATED OAUTH / CHAT FIXTURE — no real login or inference';b.style.cssText='padding:12px;background:#f3dfa4;color:#201900';document.body.prepend(b);});await dmp.screenshot({path:path.join(out,'mobile-demo-fixture-chat.png'),fullPage:true});assert.equal(await dmp.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await dm.close();await dp.getByRole('button',{name:'Disconnect',exact:true}).click();await dp.waitForFunction(()=>document.querySelectorAll('.chat-message').length===0);assert.equal(await dp.locator('.chat-message').count(),0);assert.equal(await dp.getByLabel('Exact account model',{exact:true}).inputValue(),'');mark('Personal demo: manual fixture consent only, explicit session and exact model, no fake pre-signin, transient single-turn chat/completed usage, endpoint blocked, disconnect clears chat');await dctx.close();
 const race=await fixtureContext();const rp=await race.newPage();rp.on('pageerror',(e:any)=>errors.push(e.message));await rp.goto(base);await rp.getByRole('button',{name:'Unlock saved accounts',exact:true}).click();await rp.getByRole('button',{name:'Load available models',exact:true}).click();await rp.waitForFunction(()=>document.querySelector<HTMLSelectElement>('.personal-use select')?.options.length===3);await rp.locator('.personal-use select').selectOption('gpt-6.1-sol');await rp.locator('.personal-use textarea').fill('Delayed fixture owner prompt');delayedInference=true;await rp.getByRole('button',{name:'Send using my ChatGPT plan',exact:true}).click();await rp.evaluate(()=> (window as any).fixtureWalletChange(`0x${'99'.repeat(20)}`));await rp.waitForFunction(()=>!document.querySelector('.personal-use'));await rp.waitForTimeout(950);assert.equal(await rp.locator('.personal-use').count(),0);assert.equal(await rp.getByText('Synthetic fixture response. No vendor call.',{exact:true}).count(),0);delayedInference=false;await race.close();mark('Delayed personal inference after wallet change cannot restore prior owner model, prompt or answer');
 rejectConsent=true;consentComplete=false;const rejected=await fixtureContext();const rj=await rejected.newPage();await rj.goto(base+'/demo');await rj.getByRole('button',{name:'Authorize local session',exact:true}).click();await rj.getByRole('button',{name:'Refresh connection status',exact:true}).waitFor();const rejectedPopup=rj.waitForEvent('popup');await rj.getByRole('button',{name:'Connect ChatGPT',exact:true}).click();const rpop=await rejectedPopup;await rj.getByText('OpenAI consent rejected. Stage: identity. Reason: identity_nonce.',{exact:true}).waitFor();await rpop.close();assert.equal((await rj.locator('body').textContent()).includes('FIXTURE_TOKEN'),false);unknownDiagnostic=true;const secondPopup=rj.waitForEvent('popup');await rj.getByRole('button',{name:'Connect ChatGPT',exact:true}).click();const sp=await secondPopup;await rj.getByText('Consent rejected or expired. Check the helper diagnostics before another attempt.',{exact:true}).waitFor();await sp.close();assert.equal((await rj.locator('body').textContent()).includes('FIXTURE_TOKEN'),false);assert.equal(await rj.getByRole('button',{name:'Load account models',exact:true}).count(),0);mark('Rejected OAuth shows only bounded stage/reason; no callback code, URL or token display');await rejected.close();assert.deepEqual(errors,[]);
 await fs.writeFile(path.join(out,'validation.json'),JSON.stringify({kind:'isolated-browser-fixtures',base,checks,paidCalls,chainWrites,pageErrors:errors},null,2));console.log(JSON.stringify({checks,paidCalls,chainWrites,pageErrors:errors},null,2));
}catch(error){const pages=browser.contexts().flatMap((c:any)=>c.pages());const last=pages.at(-1);if(last){console.log('Fixture failure page:',await last.locator('body').innerText());console.log('Page errors:',errors);await last.screenshot({path:path.join(out,'validation-failure.png'),fullPage:true});}throw error;}finally{await browser.close();}
