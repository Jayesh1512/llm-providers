import { createParser } from 'eventsource-parser';
import { parseUpstreamResponse } from '../provider/adapters.js';
import type { UpstreamResult } from '../provider/types.js';
import { OfficialOpenAI,OPENAI_OAUTH,limitedJson } from './openai.js';
import { AccountError } from './errors.js';

function failure(status:number,code?:unknown):AccountError{
  if(code==='subscription_sharing_usage_limit_exceeded')return new AccountError('quota_limited',429);
  if(status===429)return new AccountError('rate_limited',429);
  if(status===403||['subscription_sharing_user_not_eligible','subscription_sharing_route_not_supported','subscription_sharing_unsupported_capability','chatpass_v2_scope_not_authorized','chatpass_v2_invalid_authorization_context'].includes(String(code)))return new AccountError('restricted',403);
  return new AccountError('unavailable',503);
}
/** Public Responses OAuth path only. Deltas are not success; no retry and no alternative credentials. */
export async function callOAuthResponses(upstream:OfficialOpenAI,accessToken:string,model:string,prompt:string,maxOutputTokens:number,cancel:AbortSignal):Promise<UpstreamResult>{
  const signal=AbortSignal.any([cancel,AbortSignal.timeout(60000)]);
  try{
    const response=await upstream.fetch(OPENAI_OAUTH.resource+'/responses',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${accessToken}`},body:JSON.stringify({model,input:[{role:'user',content:prompt}],max_output_tokens:maxOutputTokens,store:false,stream:true}),signal});
    if(!response.ok){let code:unknown;try{code=(await limitedJson(response) as {error?:{code?:unknown}}).error?.code;}catch{}throw failure(response.status,code);}
    if(!response.body||!response.headers.get('content-type')?.toLowerCase().startsWith('text/event-stream'))throw new AccountError('unavailable',502);
    let completed:UpstreamResult|undefined,failed:AccountError|undefined,terminal=false,total=0;
    const parser=createParser({onEvent:event=>{
      if(event.data==='[DONE]')return;
      let data:Record<string,unknown>;try{data=JSON.parse(event.data);}catch{failed=new AccountError('unavailable',502);return;}
      if(!data||typeof data!=='object'||typeof data.type!=='string'||event.event&&event.event!==data.type){failed=new AccountError('unavailable',502);return;}
      if(data.type==='response.failed'||data.type==='error'||data.type==='response.incomplete'){
        const result=data.response as {error?:{code?:unknown}}|undefined;
        failed=failure(503,result?.error?.code??data.code);terminal=true;return;
      }
      if(data.type==='response.completed'){
        if(terminal){failed=new AccountError('unavailable',502);return;}terminal=true;
        const result=data.response as {status?:unknown;model?:unknown;id?:unknown}|undefined;
        if(result?.status!=='completed'||typeof result.id!=='string'||!result.id||result.model!==model){failed=new AccountError('unavailable',502);return;}
        try{completed=parseUpstreamResponse(2,result);if(completed.outputTokens>maxOutputTokens)failed=new AccountError('unavailable',502);}catch{failed=new AccountError('unavailable',502);}
      }
    },onError:()=>{failed=new AccountError('unavailable',502);}});
    const reader=response.body.getReader();const decoder=new TextDecoder('utf-8',{fatal:true});
    try{
      for(;;){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>4*1024*1024){await reader.cancel();throw new AccountError('unavailable',502);}parser.feed(decoder.decode(value,{stream:true}));if(failed){await reader.cancel();throw failed;}}
      parser.feed(decoder.decode());
      if(signal.aborted||failed||!completed)throw failed??new AccountError('unavailable',502);
      return completed;
    }finally{reader.releaseLock();}
  }catch(error){if(error instanceof AccountError)throw error;throw new AccountError('unavailable',503);}
}
