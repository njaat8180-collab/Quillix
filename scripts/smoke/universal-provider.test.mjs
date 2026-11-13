import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { stripTypeScriptTypes } from 'node:module';
import { pathToFileURL } from 'node:url';
const root=path.resolve(import.meta.dirname,'../..');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'quillix-universal-test-'));
fs.writeFileSync(path.join(tmp,'package.json'),JSON.stringify({type:'module'}));
fs.mkdirSync(path.join(tmp,'shared'),{recursive:true});
const pacingSource=fs.readFileSync(path.join(root,'src','shared','providerPacing.ts'),'utf8');
fs.writeFileSync(path.join(tmp,'shared','providerPacing.js'),stripTypeScriptTypes(pacingSource,{mode:'transform'}));
// universal.ts reads the shared Overdrive flag so its pacing/cooldown bypasses
// follow live settings; keep that dependency beside the copied modules too.
const overdriveStateSource=fs.readFileSync(path.join(root,'src','shared','overdriveState.ts'),'utf8');
fs.writeFileSync(path.join(tmp,'shared','overdriveState.js'),stripTypeScriptTypes(overdriveStateSource,{mode:'transform'}));
// universal.ts also pulls settings.ts, which imports these shared helpers.
for(const name of ['modelDefaults','providerPresets']) {
  const source=fs.readFileSync(path.join(root,'src','shared',`${name}.ts`),'utf8');
  fs.writeFileSync(path.join(tmp,'shared',`${name}.js`),stripTypeScriptTypes(source,{mode:'transform'}));
}
for(const name of ['sarvam','resourceGuard','brainRegistry','universal','providerStream','providerProfiles','settings','rateLimitService','promptCache']) {
  const source=fs.readFileSync(path.join(root,'src','server',`${name}.ts`),'utf8').replaceAll("'../shared/","'./shared/").replaceAll('"../shared/','"./shared/');
  const js=stripTypeScriptTypes(source,{mode:'transform'});
  fs.writeFileSync(path.join(tmp,`${name}.js`),js);
}
const encryptedPoolSource=fs.readFileSync(path.join(root,'src','server','encryptedKeyPool.ts'),'utf8');
fs.writeFileSync(path.join(tmp,'encryptedKeyPool.js'),stripTypeScriptTypes(encryptedPoolSource,{mode:'transform'}));
const {UniversalProvider,validateUniversalEndpoint,universalKeyScope}=await import(pathToFileURL(path.join(tmp,'universal.js')).href);
process.env.QUILLIX_UNIVERSAL_API_KEY='test-universal-key';
const tool=[{name:'write_file',category:'file',description:'Write a file',permission:'write',parameters:{type:'object',properties:{filePath:{type:'string',description:'file'},content:{type:'string',description:'source'}},required:['filePath','content']}}];
const messages=[{role:'user',content:'create index.html'}];
function provider(protocol,endpoint){return new UniversalProvider(()=>({protocol,endpoint,model:'test-model',offlineMode:false}),()=> 'test-universal-key');}
const originalFetch=globalThis.fetch;
const calls=[];
globalThis.fetch=async(url,init)=>{
  calls.push({url:String(url),headers:init.headers,body:JSON.parse(init.body)});
  if(String(url).includes('anthropic')) return {ok:true,json:async()=>({content:[{type:'tool_use',id:'claude-1',name:'write_file',input:{filePath:'index.html',content:'hi'}}],stop_reason:'tool_use'})};
  if(String(url).includes('googleapis')) return {ok:true,json:async()=>({candidates:[{content:{parts:[{functionCall:{name:'write_file',args:{filePath:'index.html',content:'hi'}}}]},finishReason:'STOP'}]})};
  return {ok:true,json:async()=>({choices:[{message:{content:'',tool_calls:[{id:'openai-1',function:{name:'write_file',arguments:'{"filePath":"index.html","content":"hi"}'}}]},finish_reason:'tool_calls'}]})};
};
test.after(()=>{globalThis.fetch=originalFetch;delete process.env.QUILLIX_UNIVERSAL_API_KEY;fs.rmSync(tmp,{recursive:true,force:true});});
test('OpenAI-compatible API executes real tool format',async()=>{
 const result=await provider('openai','https://api.openai.com/v1').chatWithTools(messages,tool);
 assert.equal(result.toolCalls[0].name,'write_file');assert.equal(result.toolCalls[0].args.filePath,'index.html');
 assert.equal(calls.at(-1).url,'https://api.openai.com/v1/chat/completions');
 assert.equal(calls.at(-1).headers.Authorization,'Bearer test-universal-key');
 assert.equal(calls.at(-1).body.tools[0].function.name,'write_file');
 assert.equal(calls.at(-1).body.max_completion_tokens,8192);
});

test('provider request budget compacts context, caps output and spaces requests', async()=>{
  const calls=[];
  const original=globalThis.fetch;
  globalThis.fetch=async(_url,init)=>{calls.push(JSON.parse(init.body));return new Response(JSON.stringify({choices:[{message:{content:'OK'},finish_reason:'stop'}]}),{status:200,headers:{'content-type':'application/json'}})};
  try {
    const provider=new UniversalProvider(()=>({protocol:'openai',endpoint:'http://127.0.0.1:1',model:'budget-model',offlineMode:false,auth:{type:'none'},requestBudget:{maxInputChars:12000,maxOutputTokens:256,minRequestIntervalMs:10}}));
    const noisy=Array.from({length:20},(_,i)=>({role:'tool',content:'old tool result '.repeat(500),toolCallId:`call-${i}`}));
    noisy.push({role:'user',content:'latest request'});
    await provider.chatWithTools(noisy,[],{maxOutputTokens:4096});
    await provider.chatWithTools([{role:'user',content:'second'}],[],{maxOutputTokens:4096});
    assert.equal(calls[0].max_tokens,256);
    assert.ok(JSON.stringify(calls[0]).length<=14000);
    assert.equal(calls.length,2);
  } finally { globalThis.fetch=original; }
});

test('one endpoint never has overlapping in-flight requests, even when request spacing is zero', async()=>{
  const original=globalThis.fetch;
  let calls=0;
  let releaseFirstBody;
  let markFirstStarted;
  const firstStarted=new Promise(resolve=>{markFirstStarted=resolve;});
  const firstBody=new Promise(resolve=>{releaseFirstBody=resolve;});
  globalThis.fetch=async()=>{
    calls++;
    if(calls===1) markFirstStarted();
    return {ok:true,headers:{get:()=> 'application/json'},json:async()=>{
      if(calls===1) await firstBody;
      return {choices:[{message:{content:'OK'},finish_reason:'stop'}]};
    }};
  };
  try {
    const queued=provider('openai','http://127.0.0.1:8193').generateText('first');
    await firstStarted;
    const second=provider('openai','http://127.0.0.1:8193').generateText('second');
    await new Promise(resolve=>setTimeout(resolve,30));
    assert.equal(calls,1,'second fetch started before first response body completed');
    releaseFirstBody();
    await Promise.all([queued,second]);
    assert.equal(calls,2);
  } finally { releaseFirstBody(); globalThis.fetch=original; }
});

test('provider reset headers create a bounded cooldown instead of an immediate burst', async()=>{
  const calls=[]; const times=[];
  const original=globalThis.fetch;
  globalThis.fetch=async(_url,init)=>{calls.push(JSON.parse(init.body));times.push(Date.now());return new Response(JSON.stringify({choices:[{message:{content:'OK'},finish_reason:'stop'}]}),{status:200,headers:{'content-type':'application/json',...(times.length===1?{'x-ratelimit-remaining-requests':'0','x-ratelimit-reset-requests':'30ms'}:{})}})};
  try {
    const provider=new UniversalProvider(()=>({protocol:'openai',endpoint:'http://127.0.0.1:2',model:'reset-model',offlineMode:false,auth:{type:'none'},requestBudget:{minRequestIntervalMs:0}}));
    await provider.generateText('first'); await provider.generateText('second');
    assert.equal(calls.length,2); assert.ok(times[1]-times[0]>=25, `cooldown was ${times[1]-times[0]}ms`);
  } finally { globalThis.fetch=original; }
});
test('429 retry honors the provider reset window before retrying', async()=>{
  const times=[]; const original=globalThis.fetch;
  globalThis.fetch=async()=>{
    times.push(Date.now());
    if(times.length===1) return new Response(JSON.stringify({error:'rate limited'}),{status:429,headers:{'retry-after':'0.03','x-ratelimit-remaining-requests':'0','x-ratelimit-reset-requests':'30ms'}});
    return new Response(JSON.stringify({choices:[{message:{content:'recovered'},finish_reason:'stop'}]}),{status:200,headers:{'content-type':'application/json'}});
  };
  try {
    const provider=new UniversalProvider(()=>({protocol:'openai',endpoint:'http://127.0.0.1:3',model:'retry-model',offlineMode:false,auth:{type:'none'},requestBudget:{minRequestIntervalMs:0}}));
    await provider.generateText('retry after reset');
    assert.equal(times.length,2); assert.ok(times[1]-times[0]>=25, `retry ignored reset window: ${times[1]-times[0]}ms`);
  } finally { globalThis.fetch=original; }
});

test('429 without reset headers stops retries and installs a shared cooldown', async()=>{
  const calls=[];
  const original=globalThis.fetch;
  globalThis.fetch=async(_url,init)=>{calls.push(JSON.parse(init.body)); return new Response('',{status:429});};
  try {
    const provider=new UniversalProvider(()=>({protocol:'openai',endpoint:'http://127.0.0.1:3',model:'cooldown-model',offlineMode:false,auth:{type:'none'},requestBudget:{minRequestIntervalMs:0}}));
    await assert.rejects(provider.generateText('cooldown'));
    assert.equal(calls.length,1);
  } finally { globalThis.fetch=original; }
});
test('503 honors a long Retry-After without retrying early', async()=>{
  const calls=[]; const original=globalThis.fetch;
  globalThis.fetch=async()=>{calls.push(Date.now()); return new Response('',{status:503,headers:{'retry-after':'60'}});};
  try {
    const provider=new UniversalProvider(()=>({protocol:'openai',endpoint:'http://127.0.0.1:5',model:'busy-model',offlineMode:false,auth:{type:'none'},requestBudget:{minRequestIntervalMs:0}}));
    await assert.rejects(provider.generateText('respect provider delay'),/cooldown is active/i);
    assert.equal(calls.length,1);
  } finally { globalThis.fetch=original; }
});
test('retries a transient HTTP 500 once with the same request', async()=>{
  const calls=[]; const original=globalThis.fetch;
  globalThis.fetch=async(_url,init)=>{
    calls.push(JSON.parse(init.body));
    return calls.length===1
      ? new Response('',{status:500})
      : new Response(JSON.stringify({choices:[{message:{content:'recovered'},finish_reason:'stop'}]}),{status:200,headers:{'content-type':'application/json'}});
  };
  try {
    const provider=new UniversalProvider(()=>({protocol:'openai',endpoint:'http://127.0.0.1:6',model:'transient-500',offlineMode:false,auth:{type:'none'},requestBudget:{minRequestIntervalMs:0}}));
    assert.equal(await provider.generateText('retry transient failure'),'recovered');
    assert.equal(calls.length,2);
    assert.deepEqual(calls[1],calls[0]);
  } finally { globalThis.fetch=original; }
});
test('connection retries keep the same API key',async()=>{
  const headers=[]; const original=globalThis.fetch;
  globalThis.fetch=async(_url,init)=>{
    headers.push(init.headers.Authorization);
    if(headers.length===1) throw Object.assign(new Error('fetch failed'),{cause:{code:'ECONNRESET'}});
    return new Response(JSON.stringify({choices:[{message:{content:'recovered'},finish_reason:'stop'}]}),{status:200,headers:{'content-type':'application/json'}});
  };
  try {
    const provider=new UniversalProvider(()=>({protocol:'openai',endpoint:'http://127.0.0.1:4',model:'failover-model',offlineMode:false,requestBudget:{minRequestIntervalMs:0}}),()=>['primary-key','backup-key']);
    const result=await provider.generateText('recover after a transient connection failure');
    assert.equal(result,'recovered');
    assert.deepEqual(headers,['Bearer primary-key','Bearer primary-key']);
  } finally { globalThis.fetch=original; }
});
test('streaming provider errors fall back once to JSON without duplicating tool output', async()=>{
  const calls=[]; const original=globalThis.fetch;
  globalThis.fetch=async(url,init)=>{
    calls.push({url:String(url),body:JSON.parse(init.body)});
    if(calls.length===1) return new Response('data: {"error":{"message":"gateway stream failed"}}\n\n',{status:200,headers:{'content-type':'text/event-stream'}});
    return new Response(JSON.stringify({choices:[{message:{content:'',tool_calls:[{id:'fallback-1',function:{name:'write_file',arguments:'{"filePath":"index.html","content":"fallback"}'}}]},finish_reason:'tool_calls'}]}),{status:200,headers:{'content-type':'application/json'}});
  };
  try {
    const result=await provider('openai','https://api.openai.com/v1').chatWithToolsStream(messages,tool,{},()=>{});
    assert.equal(calls.length,2);
    assert.equal(calls[0].body.stream,true);
    assert.equal(calls[1].body.stream,undefined);
    assert.equal(result.toolCalls[0].args.content,'fallback');
    assert.deepEqual(result.providerFallback,{from:'stream',to:'json',reason:'stream_transport'});
  } finally { globalThis.fetch=original; }
});
test('partial streaming output fails closed instead of replaying a tool request', async()=>{
  let calls=0; const original=globalThis.fetch;
  globalThis.fetch=async()=>{
    calls++;
    return new Response('data: {"choices":[{"delta":{"content":"partial"}}]}\n\ndata: {"error":{"message":"late gateway failure"}}\n\n',{status:200,headers:{'content-type':'text/event-stream'}});
  };
  try {
    await assert.rejects(
      provider('openai','https://api.openai.com/v1').chatWithToolsStream(messages,tool,{},()=>{}),
      /Provider reported a streaming error/,
    );
    assert.equal(calls,1);
  } finally { globalThis.fetch=original; }
});
test('Anthropic Messages API uses native tool_use format',async()=>{
 const result=await provider('anthropic','https://api.anthropic.com/v1').chatWithTools(messages,tool);
 assert.equal(result.toolCalls[0].args.content,'hi');
 assert.equal(calls.at(-1).url,'https://api.anthropic.com/v1/messages');
 assert.equal(calls.at(-1).headers['x-api-key'],'test-universal-key');
});
test('Gemini generateContent uses functionDeclarations',async()=>{
 const result=await provider('gemini','https://generativelanguage.googleapis.com/v1beta').chatWithTools(messages,tool);
 assert.equal(result.toolCalls[0].name,'write_file');
 assert.equal(calls.at(-1).headers['x-goog-api-key'],'test-universal-key');
 assert.equal(calls.at(-1).body.tools[0].functionDeclarations[0].name,'write_file');
});
test('unsafe endpoints are rejected; localhost HTTP works',()=>{
 assert.throws(()=>validateUniversalEndpoint('http://some-remote-domain.example/v1','openai'),/HTTPS/);
 assert.throws(()=>validateUniversalEndpoint('https://key:pass@example.com/v1','openai'),/credentials/);
 assert.equal(validateUniversalEndpoint('http://127.0.0.1:1234/v1','openai'),'http://127.0.0.1:1234/v1');
});
test('offline mode blocks requests before network calls',async()=>{
 const blocked=new UniversalProvider(()=>({protocol:'openai',endpoint:'https://api.openai.com/v1',model:'test',offlineMode:true}));
 const before=calls.length;
 await assert.rejects(blocked.generateText('Hello'),/Offline Mode/);
 assert.equal(calls.length,before);
});
test('malformed tool args are rejected rather than silently executed',async()=>{
 globalThis.fetch=async()=>({ok:true,json:async()=>({choices:[{message:{tool_calls:[{function:{name:'write_file',arguments:'{malformed'}}]}}]})});
 await assert.rejects(provider('openai','https://api.openai.com/v1').chatWithTools(messages,tool),/invalid tool-call JSON/);
});


test('credential scope changes when switching the API protocol or endpoint',()=>{
 assert.equal(universalKeyScope({protocol:'openai',endpoint:'https://api.openai.com/v1'}),universalKeyScope({protocol:'openai',endpoint:'https://api.openai.com/v1/'}));
 assert.notEqual(universalKeyScope({protocol:'openai',endpoint:'https://api.openai.com/v1'}),universalKeyScope({protocol:'anthropic',endpoint:'https://api.openai.com/v1'}));
 assert.notEqual(universalKeyScope({protocol:'openai',endpoint:'https://api.openai.com/v1'}),universalKeyScope({protocol:'openai',endpoint:'https://other.example.com/v1'}));
});
test('rejects empty model replies instead of reporting a verified connection',async()=>{
 for (const [protocol,endpoint,response] of [
  ['openai','https://api.openai.com/v1',{choices:[{message:{content:''}}]}],
  ['anthropic','https://api.anthropic.com/v1',{content:[]}],
  ['gemini','https://generativelanguage.googleapis.com/v1beta',{candidates:[{content:{parts:[]},finishReason:'STOP'}]}],
 ]) {
  globalThis.fetch=async()=>({ok:true,json:async()=>response});
  await assert.rejects(provider(protocol,endpoint).generateText('Ping'),/no text or tool calls/i);
 }
});
test('credential-bearing requests forbid redirects',async()=>{
 globalThis.fetch=async(_url,init)=>{assert.equal(init.redirect,'error');return {ok:true,json:async()=>({choices:[{message:{content:'OK'}}]})};};
 assert.equal(await provider('openai','https://api.openai.com/v1').generateText('Ping'),'OK');
});


test('OpenAI Responses API supports native function_call items and tool outputs',async()=>{
 const invoked=[];
 globalThis.fetch=async(url,init)=>{
  const body=JSON.parse(init.body);invoked.push({url:String(url),body});
  if(invoked.length===1) return {ok:true,json:async()=>({status:'completed',output:[{type:'function_call',call_id:'call-42',name:'write_file',arguments:'{"filePath":"index.html","content":"Hello"}'}]})};
  return {ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'File verified'}]}]})};
 };
 const first=await provider('responses','https://api.openai.com/v1').chatWithTools(messages,tool);
 assert.equal(first.toolCalls[0].id,'call-42');
 assert.equal(first.toolCalls[0].name,'write_file');
 assert.equal(invoked[0].url,'https://api.openai.com/v1/responses');
 assert.equal(invoked[0].body.tools[0].type,'function');
 const next=await provider('responses','https://api.openai.com/v1').chatWithTools([
  ...messages,{role:'assistant',content:'',toolCalls:first.toolCalls},
  {role:'tool',name:'write_file',toolCallId:'call-42',content:'File created'},
 ],tool);
 assert.equal(next.text,'File verified');
 assert.equal(invoked[1].body.input.at(-1).type,'function_call_output');
 assert.equal(invoked[1].body.input.at(-1).call_id,'call-42');
 assert.equal(invoked[1].body.input.at(-1).output,'File created');
});
test('OpenAI Responses API never executes incomplete or empty tool replies',async()=>{
 globalThis.fetch=async()=>({ok:true,json:async()=>({status:'incomplete',output:[{type:'function_call',call_id:'bad',name:'write_file',arguments:'{}'}]})});
 await assert.rejects(provider('responses','https://api.openai.com/v1').chatWithTools(messages,tool),/did not complete/);
 globalThis.fetch=async()=>({ok:true,json:async()=>({status:'completed',output:[]})});
 await assert.rejects(provider('responses','https://api.openai.com/v1').generateText('Hello'),/no text or tool calls/);
});
