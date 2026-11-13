/** Dependency-free Sarvam protocol regression: never execute invalid tool calls. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSarvamRetryAfterMs, SarvamProvider } from '../../src/server/sarvam.ts';

const tools = [{ name: 'write_file', description: 'Write a workspace file', parameters: {type:'object',properties:{filePath:{type:'string'},content:{type:'string'}}} }];

async function mockProviderReply(toolCalls, finishReason = undefined) {
  const priorKey = process.env.SARVAM_API_KEY;
  const originalFetch = globalThis.fetch;
  process.env.SARVAM_API_KEY = 'local-test-only';
  let request;
  globalThis.fetch = async (_url, init) => {
    request = JSON.parse(init.body);
    assert.equal(init.headers['api-subscription-key'], 'local-test-only');
    return {ok:true, json:async () => ({choices:[{message:{content:'',tool_calls:toolCalls}, finish_reason:finishReason}]})};
  };
  try {
    return {result: await new SarvamProvider().chatWithTools([{role:'user',content:'create a page'}],tools,{systemInstruction:'Use tools to write files.'}), request};
  } finally {
    globalThis.fetch = originalFetch;
    if (priorKey === undefined) delete process.env.SARVAM_API_KEY;
    else process.env.SARVAM_API_KEY = priorKey;
  }
}

test('Sarvam sends coding system instructions and safely parses a valid tool call', async () => {
  const {result,request} = await mockProviderReply([{id:'valid-1',function:{name:'write_file',arguments:'{"filePath":"index.html","content":"Hello"}'}}]);
  assert.equal(request.messages[0].role,'system');
  assert.equal(request.messages[0].content,'Use tools to write files.');
  assert.equal(request.tools[0].function.name,'write_file');
  assert.deepEqual(result.toolCalls,[{id:'valid-1',name:'write_file',args:{filePath:'index.html',content:'Hello'}}]);
});

test('Sarvam accepts structured object arguments as well as JSON strings', async () => {
  const {result} = await mockProviderReply([{id:'object-1',function:{name:'write_file',arguments:{filePath:'index.html',content:'Hello'}}}]);
  assert.equal(result.toolCalls[0].args.filePath, 'index.html');
});

test('Sarvam refuses malformed tool JSON instead of running write_file with empty arguments', async () => {
  await assert.rejects(mockProviderReply([{id:'bad-1',function:{name:'write_file',arguments:'{"filePath":"index.html",'}}]),/malformed tool-call JSON/);
});

test('Sarvam refuses missing or non-object tool arguments', async () => {
  await assert.rejects(mockProviderReply([{id:'bad-2',function:{name:'write_file'}}]),/without valid JSON arguments/);
  await assert.rejects(mockProviderReply([{id:'bad-3',function:{name:'write_file',arguments:'[]'}}]),/must be a JSON object/);
});


test('Sarvam refuses incomplete or nameless native calls instead of dropping them', async () => {
  const valid = {id:'ok',function:{name:'write_file',arguments:{filePath:'safe.txt',content:'x'}}};
  for (const invalid of [{id:'bad'}, {function:{arguments:'{}'}}, null, {function:{name:'',arguments:'{}'}}]) {
    await assert.rejects(mockProviderReply([valid, invalid]), /(incomplete|unnamed) tool call/);
  }
});

test('Sarvam refuses wrong tool_calls envelope shape', async () => {
  await assert.rejects(mockProviderReply({function:{name:'write_file',arguments:'{}'}}),/invalid tool_calls/);
});

test('Sarvam rejects truncated responses before any tool action can be returned', async () => {
  await assert.rejects(mockProviderReply([{id:'ok',function:{name:'write_file',arguments:'{}'}}],'length'),/output was truncated/);
});

// The agent's missing-file turn must retain native file tools instead of
// silently turning a tool action into a bare JSON response.
test('missing-file agent recovery retains native file tools', async () => {
  const fs = await import('node:fs');
  const engine = fs.readFileSync(new URL('../../src/server/agentEngine.ts', import.meta.url), 'utf8');
  assert.match(engine, /Never drop the actual file tools during missing-file recovery/);
  assert.match(engine, /chatWithToolsStream\(\s*providerMessages,\s*\/\//);
  assert.match(engine, /requiredToolName:\s*'write_file'/);
  assert.doesNotMatch(engine, /missingNext\s*\?\s*\[\]\s*:\s*toolDefs/);
});

test('Sarvam forces write_file and keeps tools available while filling missing files', async () => {
  const priorKey = process.env.SARVAM_API_KEY;
  const originalFetch = globalThis.fetch;
  process.env.SARVAM_API_KEY = 'dummy-key';
  let payload;
  globalThis.fetch = async (_url, init) => {
    payload = JSON.parse(init.body);
    return {ok:true,json:async()=>({choices:[{message:{tool_calls:[{id:'call-1',function:{name:'write_file',arguments:JSON.stringify({filePath:'index.html',content:'<h1>Hello</h1>'})}}]},finish_reason:'tool_calls'}]})};
  };
  try {
    const result = await new SarvamProvider().chatWithTools([{role:'user',content:'Create index.html'}],tools,{requiredToolName:'write_file',format:{type:'object',properties:{}}});
    assert.deepEqual(payload.tool_choice,{type:'function',function:{name:'write_file'}});
    assert.equal(payload.tools[0].function.name,'write_file');
    assert.equal(Object.hasOwn(payload,'response_format'),false,'native tool calls must not compete with response_format');
    assert.equal(result.toolCalls[0].args.content,'<h1>Hello</h1>');
  } finally {
    globalThis.fetch=originalFetch;
    if (priorKey === undefined) delete process.env.SARVAM_API_KEY;
    else process.env.SARVAM_API_KEY=priorKey;
  }
});

test('Sarvam tool-result conversation preserves matching tool IDs and nullable tool-only content', async () => {
  const oldKey = process.env.SARVAM_API_KEY;
  const oldFetch=globalThis.fetch;
  process.env.SARVAM_API_KEY='dummy-key';
  let payload;
  globalThis.fetch=async(_url,init)=>{payload=JSON.parse(init.body);return{ok:true,json:async()=>({choices:[{message:{content:'done'},finish_reason:'stop'}]})}};
  try {
    await new SarvamProvider().chatWithTools([
      {role:'user',content:'make a file'},
      {role:'assistant',content:'Executing 1 tool(s)',toolCalls:[{id:'call-1',name:'write_file',args:{filePath:'index.html',content:'hi'}}]},
      {role:'tool',toolCallId:'call-1',content:'file written'},
    ],tools,{});
    assert.equal(payload.messages[1].content,null);
    assert.equal(payload.messages[1].tool_calls[0].id,'call-1');
    assert.equal(payload.messages[2].tool_call_id,'call-1');
    assert.equal(payload.messages[2].role,'tool');
  } finally {globalThis.fetch=oldFetch;if(oldKey===undefined) delete process.env.SARVAM_API_KEY;else process.env.SARVAM_API_KEY=oldKey;}
});

test('Sarvam returns actionable sanitized auth failure and never retries 403',async()=>{
  const oldKey=process.env.SARVAM_API_KEY, oldFetch=globalThis.fetch;
  process.env.SARVAM_API_KEY='dummy-key';let hits=0;
  globalThis.fetch=async()=>{hits++;return{ok:false,status:403}};
  try{
    await assert.rejects(new SarvamProvider().generateText('hello'),/HTTP 403.*API key rejected/);
    assert.equal(hits,1);
  }finally{globalThis.fetch=oldFetch;if(oldKey===undefined) delete process.env.SARVAM_API_KEY;else process.env.SARVAM_API_KEY=oldKey;}
});

test('Sarvam retries a transient 503 only once before returning a tool call',async()=>{
  const oldKey=process.env.SARVAM_API_KEY,oldFetch=globalThis.fetch;
  process.env.SARVAM_API_KEY='dummy-key';let hits=0;
  globalThis.fetch=async()=>{hits++; if(hits===1)return{ok:false,status:503};return{ok:true,json:async()=>({choices:[{message:{tool_calls:[{id:'call1',function:{name:'write_file',arguments:'{"filePath":"index.html","content":"ok"}'}}]}}]})}};
  try{
    const r=await new SarvamProvider().chatWithTools([{role:'user',content:'create file'}],tools,{});
    assert.equal(hits,2);assert.equal(r.toolCalls.length,1);
  }finally{globalThis.fetch=oldFetch;if(oldKey===undefined) delete process.env.SARVAM_API_KEY;else process.env.SARVAM_API_KEY=oldKey;}
});

async function withSarvamMock(reply, run) {
  const key = process.env.SARVAM_API_KEY;
  const cap = process.env.SARVAM_MAX_TOKENS;
  const savedFetch = globalThis.fetch;
  process.env.SARVAM_API_KEY = 'quillix-test-key';
  delete process.env.SARVAM_MAX_TOKENS;
  const requests = [];
  globalThis.fetch = async (_url, init) => {
    requests.push(init);
    assert.equal(init.headers['api-subscription-key'], 'quillix-test-key');
    assert.equal(init.redirect, 'error', 'Never redirect API key to a different host');
    return reply(requests.length, JSON.parse(init.body));
  };
  try { await run(requests); }
  finally {
    globalThis.fetch = savedFetch;
    if (key === undefined) delete process.env.SARVAM_API_KEY; else process.env.SARVAM_API_KEY = key;
    if (cap === undefined) delete process.env.SARVAM_MAX_TOKENS; else process.env.SARVAM_MAX_TOKENS = cap;
  }
}

const okText = {ok:true,status:200,json:async()=>({choices:[{message:{content:'OK'}, finish_reason:'stop'}]})};

test('Starter Sarvam budget defaults to 4096, not an unsupported 8192', async () => {
  await withSarvamMock(() => okText, async calls => {
    const provider = new SarvamProvider();
    assert.equal(await provider.generateText('hello'), 'OK');
    assert.equal(JSON.parse(calls[0].body).max_tokens, 4096);
    assert.equal(JSON.parse(calls[0].body).reasoning_effort, 'low');
    assert.equal(await provider.generateText('hello', {maxOutputTokens:99999}), 'OK');
    assert.equal(JSON.parse(calls[1].body).max_tokens, 4096);
    assert.equal(await provider.generateText('hello', {maxOutputTokens:128, reasoningEffort:'none'}), 'OK');
    assert.equal(JSON.parse(calls[2].body).max_tokens, 128);
    assert.equal(JSON.parse(calls[2].body).reasoning_effort, null);
  });
});

test('Sarvam tool turns disable invisible reasoning by default so tool JSON fits the output budget', async () => {
  await withSarvamMock(() => ({ok:true,status:200,json:async()=>({choices:[{message:{content:null,tool_calls:[{id:'write-1',function:{name:'write_file',arguments:'{"filePath":"index.html","content":"safe"}'}}]}, finish_reason:'tool_calls'}]})}), async calls => {
    await new SarvamProvider().chatWithTools([{role:'user',content:'create index.html'}], tools);
    assert.equal(JSON.parse(calls[0].body).reasoning_effort, null);
    assert.equal(JSON.parse(calls[0].body).parallel_tool_calls, false);
  });
});

test('Pro-token-budget is an explicit environment opt-in; malformed caps fail safely', async () => {
  await withSarvamMock(() => okText, async calls => {
    process.env.SARVAM_MAX_TOKENS = '16384';
    assert.equal(await new SarvamProvider().generateText('hello', {maxOutputTokens:8192}), 'OK');
    assert.equal(JSON.parse(calls[0].body).max_tokens, 8192);
    process.env.SARVAM_MAX_TOKENS = 'garbage';
    assert.equal(await new SarvamProvider().generateText('hello'), 'OK');
    assert.equal(JSON.parse(calls[1].body).max_tokens, 4096);
  });
});

test('A successful HTTP status without text/tool calls is a failed model response', async () => {
  await withSarvamMock(() => ({ok:true,status:200,json:async()=>({choices:[{message:{content:null},finish_reason:'stop'}]})}), async () => {
    await assert.rejects(new SarvamProvider().generateText('hello'), /no text or tool calls/);
  });
});

test('Sarvam permits tool-only replies and structured text parts', async () => {
  await withSarvamMock((hit) => ({ok:true,status:200,json:async() => ({choices:[{message:hit===1
    ? {content:null,tool_calls:[{id:'write-1',function:{name:'write_file',arguments:'{"filePath":"index.html","content":"safe"}'}}]}
    : {content:[{type:'text',text:'Hello '},{type:'text',text:'world'}]},finish_reason:hit===1?'tool_calls':'stop'}]})}), async () => {
    const provider = new SarvamProvider();
    const answer = await provider.chatWithTools([{role:'user',content:'create'}],tools);
    assert.equal(answer.toolCalls.length,1);
    assert.equal(answer.text,'');
    assert.equal(await provider.generateText('hello'),'Hello world');
  });
});

test('Unknown functions and duplicate tool call IDs are rejected before execution', async () => {
  const good = {id:'same',function:{name:'write_file',arguments:'{"filePath":"index.html","content":"safe"}'}};
  await withSarvamMock(hit=>({ok:true,status:200,json:async()=>({choices:[{message:{content:null,tool_calls:hit===1?[good,{...good}]:[{id:'other',function:{name:'rm_all_files',arguments:'{}'}}]}}]})}), async () => {
    const provider = new SarvamProvider();
    await assert.rejects(provider.chatWithTools([{role:'user',content:'create'}],tools),/duplicate tool-call IDs/);
    await assert.rejects(provider.chatWithTools([{role:'user',content:'create'}],tools),/unavailable tool/);
  });
});

test('Transient 429 is retried a bounded number of times, but an extended Retry-After is not hammered', async () => {
  await withSarvamMock(hit => hit < 3 ? {ok:false,status:429,headers:{get:()=> '0'}} : okText, async calls => {
    assert.equal(await new SarvamProvider().generateText('hello'),'OK');
    assert.equal(calls.length,3);
  });
  await withSarvamMock(() => ({ok:false,status:429,headers:{get:()=> '60'}}), async calls => {
    await assert.rejects(new SarvamProvider().generateText('hello'), /HTTP 429/);
    assert.equal(calls.length,1);
  });
  const futureDate = new Date(Date.now() + 60_000).toUTCString();
  await withSarvamMock(() => ({ok:false,status:429,headers:{get:()=> futureDate}}), async calls => {
    await assert.rejects(new SarvamProvider().generateText('hello'), /HTTP 429/);
    assert.equal(calls.length,1, 'an HTTP-date Retry-After must not be ignored and hammered');
  });
});

test('Sarvam parses Retry-After delta seconds, HTTP dates and invalid values safely', () => {
  const now = Date.UTC(2026, 10, 5, 12, 0, 0);
  assert.equal(parseSarvamRetryAfterMs('2.5', now), 2_500);
  assert.equal(parseSarvamRetryAfterMs(new Date(now + 12_000).toUTCString(), now), 12_000);
  assert.equal(parseSarvamRetryAfterMs(new Date(now - 12_000).toUTCString(), now), 0);
  assert.equal(parseSarvamRetryAfterMs('not a date', now), 0);
  assert.equal(parseSarvamRetryAfterMs(null, now), 0);
});

test('Auth 403 and invalid model 404 are never retried', async () => {
  for (const status of [403,404]) {
    await withSarvamMock(() => ({ok:false,status}), async calls => {
      await assert.rejects(new SarvamProvider().generateText('hello'),new RegExp(`HTTP ${status}`));
      assert.equal(calls.length,1);
    });
  }
});

test('Already-cancelled Sarvam requests do not invoke the network', async () => {
  await withSarvamMock(() => {throw new Error('Must not call fetch');}, async calls => {
    const controller = new AbortController(); controller.abort();
    await assert.rejects(new SarvamProvider().generateText('hello',{signal:controller.signal}),/cancelled/);
    assert.equal(calls.length,0);
  });
});
