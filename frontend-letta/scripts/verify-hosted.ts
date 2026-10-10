/** Static hosted smoke checks only. Account APIs, wallets and vendor actions are never invoked. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE||'/tmp/llm-ui-work/node_modules/playwright/index.mjs').href);
const base=process.env.PUBLIC_FRONTEND_URL||'https://llm-providers-letta.vercel.app';
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const checks:string[]=[];const errors:string[]=[];
try{
 for(const width of [1440,390]){
  const ctx=await browser.newContext({viewport:{width,height:width===1440?1000:844},reducedMotion:'reduce'});
  await ctx.route('http://127.0.0.1:8791/**',route=>{throw new Error('Hosted frontend must not contact the account helper.');});
  const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
  for(const route of ['/', '/demo']){
   const response=await page.goto(base+route,{waitUntil:'networkidle',timeout:45000});assert.equal(response?.status(),200);await page.evaluate(()=>document.fonts.ready);
   if(route==='/'){assert.equal(await page.getByRole('button',{name:'Add OpenAI API key',exact:true}).isDisabled(),true);await page.getByText('Connect accounts in your local workspace.',{exact:true}).waitFor();await page.getByRole('tab',{name:'Consumers',exact:true}).click();assert.equal(await page.locator('.model-choice select').inputValue(),'');await page.getByRole('tab',{name:'Providers',exact:true}).click();}
   else{await page.getByRole('heading',{name:'Personal mini chat',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Connect ChatGPT',exact:true}).isDisabled(),true);assert.equal(await page.getByRole('button',{name:'Authorize local session',exact:true}).isDisabled(),true);await page.getByText('Not configured · backend contract pending',{exact:true}).waitFor();await page.getByText('Live ChatGPT sign-in is unconfirmed.',{exact:false}).waitFor();}
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   await page.screenshot({path:path.resolve(`frontend-letta/screenshots/hosted-${width===1440?'desktop':'mobile'}-${route==='/'?'home':'demo'}.png`),fullPage:true});checks.push(`${width}px ${route} HTTP200, hosted account gating, no overflow`);
  }await ctx.close();
 }assert.deepEqual(errors,[]);await fs.writeFile('frontend-letta/screenshots/hosted-validation.json',JSON.stringify({base,checks,pageErrors:errors},null,2));console.log({base,checks,pageErrors:errors});
}finally{await browser.close();}
