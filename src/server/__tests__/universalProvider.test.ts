import {describe,it,expect,vi,afterEach,afterAll} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// UniversalProvider consults live settings for its prompt cache. Contract
// tests must never depend on the developer's real settings file: point the
// settings store at an isolated temp file with defaults (promptCache off) so
// every plain-chat call reaches the mocked fetch deterministically.
const isolatedSettingsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-universal-settings-'));
const isolatedSettingsPath = path.join(isolatedSettingsDir, 'settings.json');
fs.writeFileSync(isolatedSettingsPath, JSON.stringify({ promptCache: false }));
const previousSettingsPath = process.env.QUILLIX_SETTINGS_PATH;
process.env.QUILLIX_SETTINGS_PATH = isolatedSettingsPath;
afterAll(() => {
  if (previousSettingsPath === undefined) delete process.env.QUILLIX_SETTINGS_PATH;
  else process.env.QUILLIX_SETTINGS_PATH = previousSettingsPath;
  fs.rmSync(isolatedSettingsDir, { recursive: true, force: true });
});
import {UniversalProvider,providerEnvironmentKeyPool,universalRetryDelayMs,UNIVERSAL_MAX_TRANSIENT_RETRIES,UNIVERSAL_MAX_QUEUED_REQUESTS_PER_ENDPOINT,DEFAULT_UNIVERSAL_REQUEST_BUDGET,normalizeProviderRequestInterval,trimUniversalMessagesForPayload,trimUniversalToolsForPayload,compactUniversalUserContent,universalPayloadTooLargeError,overdriveRateLimitRetryMs,overdriveRateLimitWaitBudget,OVERDRIVE_MAX_RATE_LIMIT_WAIT_MS,OVERDRIVE_MAX_TOTAL_RATE_LIMIT_WAIT_MS,OVERDRIVE_MAX_RATE_LIMIT_RETRIES} from '../universal.js';
import {validateProfiles,selectedProviderConfig} from '../providerProfiles.js';
import {collectProviderStream} from '../providerStream.js';
import {ExtensionTools} from '../extensionTools.js';
import {ChatResponseRouter} from '../chatResponseRouter.js';
import {getProviderPreset} from '../../shared/providerPresets.js';
import {setOverdriveActive} from '../../shared/overdriveState.js';
import {DEFAULT_ONLINE_PROVIDER_MIN_INTERVAL_MS} from '../../shared/providerPacing.js';
const config={protocol:'openai' as const,endpoint:'https://custom.example/v1',model:'user/model',offlineMode:false,requestBudget:{minRequestIntervalMs:0}};
function stream(events:any[],done=true) {
  const raw=events.map(e=>'data: '+JSON.stringify(e)+'\n\n').join('')+(done?'data: [DONE]\n\n':'');
  const bytes=new TextEncoder().encode(raw);
  return new Response(new ReadableStream({start(c){for(let i=0;i<bytes.length;i+=3)c.enqueue(bytes.slice(i,i+3));c.close();}}),{headers:{'content-type':'text/event-stream'}});
}
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
describe('universal provider',()=>{
  it('normalizes invalid provider pacing configuration without disabling the queue', () => {
    expect(normalizeProviderRequestInterval(undefined)).toBe(4_000);
    expect(normalizeProviderRequestInterval('')).toBe(4_000);
    expect(normalizeProviderRequestInterval('bad')).toBe(4_000);
    expect(normalizeProviderRequestInterval('-1')).toBe(4_000);
    expect(normalizeProviderRequestInterval('0')).toBe(0);
    expect(normalizeProviderRequestInterval('1250.4')).toBe(1_250);
    expect(normalizeProviderRequestInterval('999999')).toBe(60_000);
    expect(normalizeProviderRequestInterval('bad', Number.NaN)).toBe(4_000);
  });
  it('uses consistent 4-second default cloud pacing while keeping retries conservative', () => {
    expect(DEFAULT_ONLINE_PROVIDER_MIN_INTERVAL_MS).toBe(4000);
    expect(DEFAULT_UNIVERSAL_REQUEST_BUDGET.minRequestIntervalMs).toBe(4000);
    expect(universalRetryDelayMs(0, null)).toBeGreaterThanOrEqual(1000);
    expect(selectedProviderConfig({ universalEndpoint: config.endpoint, universalProtocol: 'openai', universalModel: config.model, offlineMode: false } as any).requestBudget?.minRequestIntervalMs).toBe(4000);
    expect(selectedProviderConfig({ universalEndpoint: 'https://integrate.api.nvidia.com/v1', universalProtocol: 'openai', universalModel: 'model', offlineMode: false } as any).requestBudget?.minRequestIntervalMs).toBe(4000);
  });

  it('sends a required named tool instead of allowing a prose-only auto response', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({choices:[{message:{tool_calls:[{id:'a',function:{name:'write_file',arguments:'{"filePath":"index.html","content":"ok"}'}}]},finish_reason:'tool_calls'}]})));
    vi.stubGlobal('fetch',fetcher);
    const provider = new UniversalProvider(()=>({...config,auth:{type:'none' as const},requestBudget:{minRequestIntervalMs:0}}));
    await provider.chatWithTools([{role:'user',content:'Write the file'}], [{name:'write_file',description:'Write',category:'file',permission:'write',parameters:{type:'object',properties:{}}}],
      {requiredToolName:'write_file'});
    expect(JSON.parse(fetcher.mock.calls[0][1].body).tool_choice).toEqual({type:'function',function:{name:'write_file'}});
  });
  it('forces the named tool in Responses API requests', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({status:'completed',output:[{type:'function_call',call_id:'edit-1',name:'edit_file',arguments:'{}'}]})));
    vi.stubGlobal('fetch',fetcher);
    const provider = new UniversalProvider(()=>({...config,protocol:'responses',auth:{type:'none' as const},requestBudget:{minRequestIntervalMs:0}}));
    await provider.chatWithTools([{role:'user',content:'Edit the source'}], [{name:'edit_file',description:'Edit',category:'file',permission:'write',parameters:{type:'object',properties:{}}}], {requiredToolName:'edit_file'});
    const body = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(body.tool_choice).toEqual({type:'function',name:'edit_file'});
    expect(body.tools.map((tool: {name:string}) => tool.name)).toEqual(['edit_file']);
  });
  it('forces exactly the named tool in Anthropic Messages requests', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({content:[{type:'tool_use',id:'edit-1',name:'edit_file',input:{}}],stop_reason:'tool_use'})));
    vi.stubGlobal('fetch',fetcher);
    const provider = new UniversalProvider(()=>({...config,protocol:'anthropic',auth:{type:'none' as const},requestBudget:{minRequestIntervalMs:0}}),()=> 'test');
    await provider.chatWithTools([{role:'user',content:'Edit the source'}], [{name:'edit_file',description:'Edit',category:'file',permission:'write',parameters:{type:'object',properties:{}}}], {requiredToolName:'edit_file'});
    const body = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(body.tool_choice).toEqual({type:'tool',name:'edit_file',disable_parallel_tool_use:true});
    expect(body.tools.map((tool: {name:string}) => tool.name)).toEqual(['edit_file']);
  });
  it('restricts Gemini function calling to the required tool', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({candidates:[{content:{parts:[{functionCall:{name:'edit_file',args:{}}}]},finishReason:'STOP'}]})));
    vi.stubGlobal('fetch',fetcher);
    const provider = new UniversalProvider(()=>({...config,protocol:'gemini',endpoint:'https://generativelanguage.googleapis.com/v1beta',auth:{type:'none' as const},requestBudget:{minRequestIntervalMs:0}}),()=> 'test');
    await provider.chatWithTools([{role:'user',content:'Edit the source'}], [{name:'edit_file',description:'Edit',category:'file',permission:'write',parameters:{type:'object',properties:{}}}], {requiredToolName:'edit_file'});
    const body = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(body.toolConfig.functionCallingConfig).toEqual({mode:'ANY',allowedFunctionNames:['edit_file']});
    expect(body.tools[0].functionDeclarations.map((tool: {name:string}) => tool.name)).toEqual(['edit_file']);
  });
  it('fails before network I/O when a required tool is missing for any protocol', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch',fetcher);
    const provider = new UniversalProvider(()=>({...config,protocol:'anthropic',auth:{type:'none' as const},requestBudget:{minRequestIntervalMs:0}}));
    await expect(provider.chatWithTools([{role:'user',content:'Edit'}],[],{requiredToolName:'edit_file'})).rejects.toThrow('required tool is unavailable');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('serializes concurrent requests for the same provider/model before applying pacing', async () => {
    vi.useFakeTimers();
    const startedAt: number[] = [];
    const fetcher = vi.fn().mockImplementation(async () => {
      startedAt.push(Date.now());
      return new Response(JSON.stringify({choices:[{message:{content:'ok'}}]}));
    });
    vi.stubGlobal('fetch', fetcher);
    const provider = new UniversalProvider(() => ({...config, auth:{type:'none' as const}, requestBudget:{minRequestIntervalMs:50}}));
    const first = provider.generateText('one');
    const second = provider.generateText('two');
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1_000);
    await Promise.all([first, second]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(startedAt[1] - startedAt[0]).toBeGreaterThanOrEqual(50);
  });
  it('allows two overlapping Turbo requests while preserving endpoint dispatch spacing', async () => {
    vi.useFakeTimers();
    const startedAt: number[] = [];
    const pending: Array<(response: Response) => void> = [];
    const fetcher = vi.fn().mockImplementation(() => new Promise<Response>(resolve => {
      startedAt.push(Date.now());
      pending.push(resolve);
    }));
    vi.stubGlobal('fetch', fetcher);
    const provider = new UniversalProvider(() => ({ ...config, endpoint: 'https://turbo-overlap.example/v1', auth: { type: 'none' as const }, requestBudget: { minRequestIntervalMs: 50, maxConcurrentRequests: 2 } }));
    const first = provider.generateText('one');
    await vi.advanceTimersByTimeAsync(0);
    const second = provider.generateText('two');
    await vi.advanceTimersByTimeAsync(50);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(provider.diagnosticsSnapshot()).toMatchObject({ activeRequests: 2, maxConcurrentRequests: 2 });
    expect(startedAt[1] - startedAt[0]).toBeGreaterThanOrEqual(50);
    for (const resolve of pending) resolve(new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] })));
    await Promise.all([first, second]);
  });
  it('keeps endpoint concurrency single-flight when a request or token ceiling is declared', async () => {
    vi.useFakeTimers();
    const pending: Array<(response: Response) => void> = [];
    const fetcher = vi.fn().mockImplementation(() => new Promise<Response>(resolve => pending.push(resolve)));
    vi.stubGlobal('fetch', fetcher);
    const provider = new UniversalProvider(() => ({ ...config, endpoint: 'https://turbo-budgeted.example/v1', auth: { type: 'none' as const }, requestBudget: {
      minRequestIntervalMs: 50, maxRequestsPerMinute: 20, maxTokensPerMinute: 100_000, maxConcurrentRequests: 2,
    } }));
    const first = provider.generateText('one');
    await vi.advanceTimersByTimeAsync(0);
    const second = provider.generateText('two');
    await vi.advanceTimersByTimeAsync(100);
    expect(fetcher).toHaveBeenCalledTimes(1);
    pending.shift()!(new Response(JSON.stringify({ choices: [{ message: { content: 'first' } }] })));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledTimes(2);
    pending.shift()!(new Response(JSON.stringify({ choices: [{ message: { content: 'second' } }] })));
    await Promise.all([first, second]);
  });
  it('shares pacing across model IDs on the same provider endpoint', async () => {
    vi.useFakeTimers();
    const startedAt: number[] = [];
    const fetcher = vi.fn().mockImplementation(async () => {
      startedAt.push(Date.now());
      return new Response(JSON.stringify({choices:[{message:{content:'ok'}}]}));
    });
    vi.stubGlobal('fetch', fetcher);
    let model = 'user/model-a';
    const provider = new UniversalProvider(() => ({...config, endpoint:'https://429-shared.example/v1', model, auth:{type:'none' as const}, requestBudget:{minRequestIntervalMs:50}}));
    const first = provider.generateText('one');
    model = 'user/model-b';
    const second = provider.generateText('two');
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1_000);
    await Promise.all([first, second]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetcher.mock.calls[0][1].body).model).toBe('user/model-a');
    expect(JSON.parse(fetcher.mock.calls[1][1].body).model).toBe('user/model-b');
    expect(startedAt[1] - startedAt[0]).toBeGreaterThanOrEqual(50);
  });
  it('cancels a request while it is waiting for the provider endpoint slot', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({choices:[{message:{content:'ok'}}]})));
    vi.stubGlobal('fetch', fetcher);
    const provider = new UniversalProvider(() => ({...config, endpoint:'https://cancel-queue.example/v1', auth:{type:'none' as const}, requestBudget:{minRequestIntervalMs:1_000}}));
    const first = provider.generateText('first');
    await vi.advanceTimersByTimeAsync(0);
    const controller = new AbortController();
    const second = provider.generateText('second', {signal:controller.signal});
    const cancelled = expect(second).rejects.toThrow(/cancelled/i);
    controller.abort();
    await cancelled;
    await first;
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('shares Retry-After cooldown across models and keeps retries in the endpoint queue', async () => {
    vi.useFakeTimers();
    const startedAt: number[] = [];
    const seenModels: string[] = [];
    const fetcher = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      startedAt.push(Date.now());
      const model = JSON.parse(String(init.body)).model;
      seenModels.push(model);
      if (model === 'user/model-a' && seenModels.filter(value => value === model).length === 1) {
        return new Response('', {status: 429, headers:{'retry-after':'30'}});
      }
      return new Response(JSON.stringify({choices:[{message:{content:'ok'}}]}));
    });
    vi.stubGlobal('fetch', fetcher);
    let model = 'user/model-a';
    const provider = new UniversalProvider(() => ({...config, endpoint:'https://429-shared.example/v1', model, auth:{type:'none' as const}, requestBudget:{minRequestIntervalMs:50}}));
    const first = provider.generateText('one');
    const firstAssertion = expect(first).rejects.toThrow(/rate limit is still active/i);
    await vi.advanceTimersByTimeAsync(0);
    model = 'user/model-b';
    const second = provider.generateText('two');
    const secondAssertion = expect(second).resolves.toBe('ok');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.runAllTimersAsync();
    await Promise.all([firstAssertion, secondAssertion]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(startedAt[1] - startedAt[0]).toBeGreaterThanOrEqual(30_000);
    expect(seenModels).toContain('user/model-b');
  });
  it('lets the first same-endpoint failover model retry immediately after a model 429', async () => {
    const endpoint = 'https://model-failover-cooldown.example/v1';
    const startedAt: number[] = [];
    const fetcher = vi.fn().mockImplementation(async () => {
      startedAt.push(Date.now());
      return startedAt.length === 1
        ? new Response('', { status: 429, headers: { 'retry-after': '30' } })
        : new Response(JSON.stringify({ choices: [{ message: { content: 'alternate answer' } }] }));
    });
    vi.stubGlobal('fetch', fetcher);
    const provider = new UniversalProvider(() => ({ ...config, endpoint, auth: { type: 'none' as const }, requestBudget: { minRequestIntervalMs: 0 } }));
    await expect(provider.generateText('hello', { model: 'model-a', providerModelFailover: true })).rejects.toThrow(/rate limit/i);
    await expect(provider.generateText('hello', {
      model: 'model-b', providerModelFailover: true, providerModelFailoverCooldownBypass: true,
    })).resolves.toBe('alternate answer');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(startedAt[1] - startedAt[0]).toBeLessThan(2_000);
  });
  it('streams fragmented UTF-8 and assembles tool arguments before execution',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(stream([
      {choices:[{delta:{content:'你好'}}]},
      {choices:[{delta:{tool_calls:[{index:0,id:'a',function:{name:'read_file',arguments:'{"file'}}]}}]},
      {choices:[{delta:{tool_calls:[{index:0,function:{arguments:'Path":"x"}'}}]},finish_reason:'tool_calls'}]},
      {usage:{prompt_tokens:10,completion_tokens:5},choices:[]}
    ])));
    const provider=new UniversalProvider(()=>({...config,inputCostPerMillion:1,outputCostPerMillion:2}),()=> 'test');
    const chunks:string[]=[];
    const result=await provider.chatWithToolsStream([{role:'user',content:'read'}],[],{},t=>chunks.push(t));
    expect(chunks).toEqual(['你好']);expect(result.toolCalls[0].args).toEqual({filePath:'x'});
    expect(provider.usage[0].estimatedCost).toBe(0.00002);
  });
  it('rejects interrupted streams and malformed arguments',async()=>{
    await expect(collectProviderStream(stream([{choices:[{delta:{content:'partial'}}]}],false),'openai',()=>{})).rejects.toThrow('before completion');
  });
  it('accepts a valid OpenAI-compatible finish event even when [DONE] is omitted',async()=>{
    const chunks:string[]=[];
    const result=await collectProviderStream(stream([{choices:[{delta:{content:'complete'},finish_reason:'stop'}]}],false),'openai',t=>chunks.push(t));
    expect(result.choices[0].message.content).toBe('complete');
    expect(chunks).toEqual(['complete']);
  });
  it('supports unauthenticated custom endpoints and omits unsupported tools',async()=>{
    const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({choices:[{message:{content:'ok'}}]})));vi.stubGlobal('fetch',fetcher);
    const p=new UniversalProvider(()=>({...config,auth:{type:'none'},capabilities:{tools:false,streaming:false,reasoning:false}}),()=>{throw new Error('Must not read key');});
    expect(p.capabilities).toEqual({tools:false,streaming:false,reasoning:false});
    await p.chatWithTools([{role:'user',content:'hello'}],[{name:'anything'} as any]);
    const request=fetcher.mock.calls[0][1];expect(fetcher.mock.calls[0][0]).toBe('https://custom.example/v1/chat/completions');expect(request.headers.Authorization).toBeUndefined();expect(JSON.parse(request.body).model).toBe('user/model');expect(JSON.parse(request.body).tools).toBeUndefined();
  });
  it('maps preset endpoint, bearer auth and exact model into the request',async()=>{
    const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({choices:[{message:{content:'ok'}}]})));vi.stubGlobal('fetch',fetcher);
    const preset=getProviderPreset('nvidia-nim');
    await new UniversalProvider(()=>({protocol:preset.protocol,endpoint:preset.defaultEndpoint,model:preset.defaultModel,offlineMode:false}),()=> 'nvapi-test-key').generateText('hello');
    const [url,request]=fetcher.mock.calls[0];
    expect(url).toBe('https://integrate.api.nvidia.com/v1/chat/completions');
    expect(request.headers.Authorization).toBe('Bearer nvapi-test-key');
    expect(JSON.parse(request.body).model).toBe('openai/gpt-oss-120b');
  });
  it('reports a clear failed connection for provider authorization errors',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({error:'invalid key'}),{status:401})));
    await expect(new UniversalProvider(()=>({...config,model:'deepseek-flash'}),()=> 'bad-key').generateText('hello')).rejects.toThrow('HTTP 401');
  });
  it('trims oldest tool/history context while preserving system instructions and the latest request',()=>{
    const messages=[
      {role:'system' as const,content:'Never reveal secrets.'},
      {role:'user' as const,content:'old request '.repeat(20)},
      {role:'tool' as const,toolCallId:'old-call',name:'read_file',content:'old tool output '.repeat(20)},
      {role:'assistant' as const,content:'old answer '.repeat(20)},
      {role:'user' as const,content:'LATEST REQUEST — keep this exact text.'},
    ];
    const trimmed=trimUniversalMessagesForPayload(messages,260);
    expect(trimmed.changed).toBe(true);
    expect(trimmed.messages.find(m=>m.role==='system')?.content).toBe('Never reveal secrets.');
    expect(trimmed.messages.find(m=>m.role==='user'&&m.content.startsWith('LATEST'))?.content).toBe('LATEST REQUEST — keep this exact text.');
    expect(trimmed.messages.some(m=>m.role==='tool')).toBe(false);
  });
  it('removes exact duplicate conversational turns but preserves tool-call messages',()=>{
    const toolCall = {id:'call-1',name:'read_file',args:{filePath:'index.html'}};
    const messages=[
      {role:'system' as const,content:'Use tools safely.'},
      {role:'user' as const,content:'Create the page.'},
      {role:'assistant' as const,content:'I will inspect the page.'},
      {role:'user' as const,content:'Create the page.'},
      {role:'assistant' as const,content:'I will inspect the page.',toolCalls:[toolCall]},
      {role:'tool' as const,toolCallId:'call-1',name:'read_file',content:'source'},
      {role:'user' as const,content:'Now verify it.'},
    ];
    const trimmed=trimUniversalMessagesForPayload(messages,20_000);
    expect(trimmed.changed).toBe(true);
    expect(trimmed.messages.filter(m=>m.role==='user'&&m.content==='Create the page.')).toHaveLength(1);
    expect(trimmed.messages.filter(m=>m.role==='assistant'&&m.content==='I will inspect the page.')).toHaveLength(2);
    expect(trimmed.messages.find(m=>m.role==='assistant'&&m.toolCalls)?.toolCalls).toEqual([toolCall]);
    expect(trimmed.messages.some(m=>m.role==='tool'&&m.toolCallId==='call-1')).toBe(true);
  });
  it('compacts duplicated oversized pasted prompts while preserving the execution tail',()=>{
    const section = '# COSMOS FORGE\n\n- Create an interactive universe creator with editable planets and presets.\n- Verify the application locally.\n';
    const result = compactUniversalUserContent(`${section.repeat(40)}\nFINAL EXECUTION COMMAND\nBegin implementing COSMOS FORGE now.`, 2200);
    expect(result.changed).toBe(true);
    expect(result.content.length).toBeLessThanOrEqual(2200);
    expect(result.content).toContain('FINAL EXECUTION COMMAND');
    expect(result.content).toContain('Create an interactive universe creator');
  });
  it('deduplicates short repeated instructions and stays inside a small request budget',()=>{
    const short = 'Keep implementation code in files.\n\nUse the active project.\n\nKeep implementation code in files.';
    const compactShort = compactUniversalUserContent(short, 1000);
    expect(compactShort.content.match(/Keep implementation code in files\./g)).toHaveLength(1);

    const long = Array.from({length: 30}, (_, index) => `SECTION ${index}\n${'Distinct requirement. '.repeat(100)}`).join('\n\n');
    const compactLong = compactUniversalUserContent(long, 2200);
    expect(compactLong.content.length).toBeLessThanOrEqual(2200);
    expect(compactLong.content).toContain('omitted middle text');
    expect(compactLong.content).toContain('SECTION 29');
  });
  it('compacts an oversized latest user request before declaring the protected context impossible',()=>{
    const latest = 'Build COSMOS FORGE with interactive planets and local persistence.\n\n'.repeat(400);
    const result = trimUniversalMessagesForPayload([
      {role:'system',content:'Use tools safely and verify every change.'},
      {role:'user',content:latest + 'FINAL EXECUTION COMMAND: implement now.'},
    ], 8_000);
    expect(result.tooLarge).toBe(false);
    expect(result.changed).toBe(true);
    expect(result.messages.at(-1)?.content).toContain('FINAL EXECUTION COMMAND');
    expect(result.messages.at(-1)?.content.length).toBeLessThanOrEqual(8_000);
  });
  it('proactively bounds tool and nested parameter descriptions',()=>{
    const tools=[{name:'write_file',description:'D'.repeat(2_000),parameters:{type:'object',description:'P'.repeat(600),properties:{content:{type:'string',description:'C'.repeat(500)}}}}] as any;
    const result=trimUniversalToolsForPayload(tools);
    expect(result.changed).toBe(true);
    expect(result.tools[0].description.length).toBe(600);
    expect((result.tools[0].parameters as any).description.length).toBe(180);
    expect((result.tools[0].parameters as any).properties.content.description.length).toBe(180);
  });
  it('retries HTTP 413 only after reducing context and preserves the latest prompt',async()=>{
    const fetcher=vi.fn().mockResolvedValueOnce(new Response('',{status:413})).mockResolvedValueOnce(new Response(JSON.stringify({choices:[{message:{content:'recovered'}}]})));vi.stubGlobal('fetch',fetcher);
    const history=[
      {role:'system' as const,content:'Keep safety instructions.'},
      {role:'user' as const,content:'old context '.repeat(700)},
      {role:'assistant' as const,content:'old answer '.repeat(700)},
      {role:'user' as const,content:'LATEST REQUEST — do not drop this.'},
    ];
    await expect(new UniversalProvider(()=>config,()=> 'test').chatWithTools(history,[])).resolves.toMatchObject({text:'recovered'});
    expect(fetcher).toHaveBeenCalledTimes(2);
    const second=JSON.parse(fetcher.mock.calls[1][1].body);
    expect(second.messages.some((m:any)=>m.role==='system'&&m.content==='Keep safety instructions.')).toBe(true);
    expect(second.messages.some((m:any)=>m.role==='user'&&m.content==='LATEST REQUEST — do not drop this.')).toBe(true);
    expect(second.messages.some((m:any)=>m.content.includes('old context'))).toBe(false);
  });
  it('does not retry an HTTP 413 unchanged and reports an actionable limit',async()=>{
    const fetcher=vi.fn().mockResolvedValue(new Response('',{status:413}));vi.stubGlobal('fetch',fetcher);
    await expect(new UniversalProvider(()=>config,()=> 'test').generateText('one small request')).rejects.toThrow(universalPayloadTooLargeError());
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('supports header and Basic credentials without changing the adapter',async()=>{
    const fetcher=vi.fn().mockImplementation(async()=>new Response(JSON.stringify({choices:[{message:{content:'ok'}}]})));vi.stubGlobal('fetch',fetcher);
    for(const auth of [{type:'header' as const,header:'api-key'},{type:'basic' as const}]) await new UniversalProvider(()=>({...config,auth}),()=> 'user:secret').generateText('hi');
    expect(fetcher.mock.calls[0][1].headers['api-key']).toBe('user:secret');expect(fetcher.mock.calls[1][1].headers.Authorization).toBe('Basic '+Buffer.from('user:secret').toString('base64'));
  });
  it('retries transient HTTP errors but never replays emitted streams',async()=>{
    vi.useFakeTimers();
    const fetcher=vi.fn().mockResolvedValueOnce(new Response('',{status:503})).mockResolvedValueOnce(new Response(JSON.stringify({choices:[{message:{content:'recovered'}}]})));vi.stubGlobal('fetch',fetcher);
    const pending=new UniversalProvider(()=>config,()=> 'test').generateText('hi');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await pending).toBe('recovered');expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('surfaces a transport failure immediately when the same-provider model failover wrapper is active', async () => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    vi.stubGlobal('fetch', fetcher);
    const provider = new UniversalProvider(() => ({ ...config, endpoint: 'https://failover-transport.example/v1', auth: { type: 'none' as const }, requestBudget: { minRequestIntervalMs: 0 } }));
    await expect(provider.generateText('hello', { providerModelFailover: true })).rejects.toThrow(/universal api network error/i);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('opens a short circuit after persistent server errors and probes again after cooldown', async () => {
    vi.useFakeTimers();
    const endpoint = 'https://circuit-breaker.example/v1';
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response('', {status:500}))
      .mockResolvedValueOnce(new Response('', {status:500}))
      .mockResolvedValueOnce(new Response('', {status:500}))
      .mockResolvedValueOnce(new Response(JSON.stringify({choices:[{message:{content:'recovered'}}]})));
    vi.stubGlobal('fetch', fetcher);
    const provider = new UniversalProvider(() => ({...config, endpoint, auth:{type:'none' as const}, requestBudget:{minRequestIntervalMs:0}}));
    const first = provider.generateText('first');
    const firstAssertion = expect(first).rejects.toThrow(/after 2 retries/i);
    await vi.advanceTimersByTimeAsync(10_000);
    await firstAssertion;
    const circuitOpenUntil = provider.diagnosticsSnapshot().circuitOpenUntil;
    if (typeof circuitOpenUntil !== 'number') throw new Error('Expected the provider circuit to be open.');
    expect(circuitOpenUntil).toBeGreaterThan(Date.now());

    const recovery = provider.generateText('after cooldown');
    const recoveryAssertion = expect(recovery).resolves.toBe('recovered');
    await vi.advanceTimersByTimeAsync(circuitOpenUntil - Date.now() - 1);
    expect(fetcher).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    await recoveryAssertion;
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(provider.diagnosticsSnapshot().consecutiveServerFailures).toBe(0);
  });
  it('does not rotate API keys to work around a provider rate limit', async () => {
    vi.useFakeTimers();
    const observedKeys:string[]=[];
    const observedBodies:string[]=[];
    const fetcher=vi.fn().mockImplementation(async (_url:string, init:RequestInit) => { observedKeys.push(String((init.headers as Record<string,string>).Authorization)); observedBodies.push(String(init.body)); return observedKeys.length===1 ? new Response('',{status:429,headers:{'retry-after':'1'}}) : new Response(JSON.stringify({choices:[{message:{content:'recovered'}}]})); });vi.stubGlobal('fetch',fetcher);
    const pending=new UniversalProvider(()=>({...config,endpoint:'https://key-pool-retry.example/v1'}),()=>['primary-key','backup-key']).generateText('hi');
    await vi.advanceTimersByTimeAsync(60_000);
    await expect(pending).resolves.toBe('recovered');
    expect(observedKeys).toEqual(['Bearer primary-key','Bearer primary-key']);
    expect(observedBodies[1]).toBe(observedBodies[0]);
  });
  it('tries the next credential after an explicit authentication rejection', async () => {
    const observedKeys:string[]=[];
    const fetcher=vi.fn().mockImplementation(async (_url:string, init:RequestInit) => {
      observedKeys.push(String((init.headers as Record<string,string>).Authorization));
      return observedKeys.length === 1
        ? new Response(JSON.stringify({error:'invalid key'}),{status:401})
        : new Response(JSON.stringify({choices:[{message:{content:'recovered'}}]}));
    });
    vi.stubGlobal('fetch',fetcher);
    await expect(new UniversalProvider(()=>({...config,endpoint:'https://key-pool-auth.example/v1'}),()=>['primary-key','backup-key']).generateText('hi')).resolves.toBe('recovered');
    expect(observedKeys).toEqual(['Bearer primary-key','Bearer backup-key']);
  });
  it.each([[402, /credits are exhausted/i], [401, /rejected the API key/i], [403, /denied access/i]])(
    'explains provider HTTP %i without retrying when no backup credential exists', async (status, message) => {
      const fetcher = vi.fn().mockResolvedValue(new Response('', {status}));
      vi.stubGlobal('fetch', fetcher);
      await expect(new UniversalProvider(() => ({...config, endpoint:`https://provider-http-${status}.example/v1`}), () => ['primary']).generateText('hi')).rejects.toThrow(message);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(fetcher.mock.calls[0][1].headers.Authorization).toBe('Bearer primary');
    },
  );
  it('builds a bounded deduplicated environment key pool without exposing values', () => {
    const previous = process.env.QUILLIX_TEST_PROVIDER_KEYS;
    process.env.QUILLIX_TEST_PROVIDER_KEYS = 'backup-a, backup-b\nbackup-a';
    try { expect(providerEnvironmentKeyPool('primary', 'QUILLIX_TEST_PROVIDER_KEYS')).toEqual(['primary', 'backup-a', 'backup-b']); }
    finally { if (previous === undefined) delete process.env.QUILLIX_TEST_PROVIDER_KEYS; else process.env.QUILLIX_TEST_PROVIDER_KEYS = previous; }
  });
  it('uses jittered 1s then 2s exponential delays and respects Retry-After',()=>{
    expect(universalRetryDelayMs(0,null,Date.now(),0.5)).toBe(1000);
    expect(universalRetryDelayMs(1,null,Date.now(),0.5)).toBe(2000);
    expect(universalRetryDelayMs(0,'1.5')).toBe(1500);
    expect(universalRetryDelayMs(0,'60')).toBe(60000);
    expect(universalRetryDelayMs(0,'0')).toBe(250);
  });
  it('uses the provider window exactly in Overdrive with no jitter and no growth',()=>{
    expect(overdriveRateLimitRetryMs(0,'2',0)).toBe(2000);
    expect(overdriveRateLimitRetryMs(1,'2',0)).toBe(2000);
    expect(overdriveRateLimitRetryMs(3,'7.5',0)).toBe(7500);
    expect(overdriveRateLimitRetryMs(0,'0',0)).toBe(250);
    expect(overdriveRateLimitRetryMs(0,null,0)).toBe(250);
    expect(overdriveRateLimitRetryMs(1,null,0)).toBe(500);
    expect(overdriveRateLimitRetryMs(0,null,5_000)).toBe(5_000);
    expect(overdriveRateLimitRetryMs(0,'900',0)).toBe(OVERDRIVE_MAX_RATE_LIMIT_WAIT_MS);
    const future=new Date(Date.now()+4_000).toUTCString();
    expect(Math.abs(overdriveRateLimitRetryMs(0,future,0)-4_000)).toBeLessThanOrEqual(1_000);
  });
  it('exhausts rate-limit retries with a clear quota error',async()=>{
    vi.useFakeTimers();
    const fetcher=vi.fn().mockResolvedValue(new Response('',{status:429,headers:{'Retry-After':'1'}}));vi.stubGlobal('fetch',fetcher);
    const pending=new UniversalProvider(()=>({...config,endpoint:'https://retry-budget.example/v1'}),()=> 'test').generateText('hi');
    const assertion=expect(pending).rejects.toThrow(/rate limit is still active/i);
    await vi.advanceTimersByTimeAsync(60_000);
    await assertion;
    expect(fetcher).toHaveBeenCalledTimes(UNIVERSAL_MAX_TRANSIENT_RETRIES+1);
  });
  it('serves a rate limit to the exact advertised window in Overdrive Mode', async () => {
    setOverdriveActive(true);
    try {
      vi.useFakeTimers();
      let observedCalls = 0;
      const events: Array<{ retryAt: number; at: number; attempt: number }> = [];
      const fetcher = vi.fn().mockImplementation(async () => observedCalls++
        ? new Response(JSON.stringify({ choices: [{ message: { content: 'recovered' } }] }))
        : new Response('', { status: 429, headers: { 'Retry-After': '1' } }));
      vi.stubGlobal('fetch', fetcher);
      const pending = new UniversalProvider(
        () => ({ ...config, endpoint: 'https://overdrive-429.example/v1', overdriveMode: true }),
        () => 'test',
      ).generateText('hi', { onRateLimit: e => events.push({ retryAt: e.retryAt, at: Date.now(), attempt: e.attempt }) });
      const assertion = expect(pending).resolves.toBe('recovered');
      await vi.advanceTimersByTimeAsync(60_000);
      await assertion;
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(events).toHaveLength(1);
      expect(events[0].retryAt - events[0].at).toBe(1_000);
    } finally { setOverdriveActive(false); }
  });
  it('retries a headerless 429 on the minimal floor in Overdrive Mode instead of recording QUILLIX\'s fallback cooldown', async () => {
    setOverdriveActive(true);
    try {
      vi.useFakeTimers();
      const fetcher = vi.fn()
        .mockResolvedValueOnce(new Response('', { status: 429 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: 'recovered' } }] })));
      vi.stubGlobal('fetch', fetcher);
      const pending = new UniversalProvider(
        () => ({ ...config, endpoint: 'https://overdrive-headerless.example/v1', auth: { type: 'none' as const }, requestBudget: { minRequestIntervalMs: 0 }, overdriveMode: true }),
      ).generateText('hi');
      const assertion = expect(pending).resolves.toBe('recovered');
      await vi.advanceTimersByTimeAsync(2_000);
      await assertion;
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally { setOverdriveActive(false); }
  });
  it('keeps every retry inside one bounded total wait so a request cannot freeze the app', () => {
    expect(overdriveRateLimitWaitBudget(0, 600_000)).toEqual({ waitMs: 600_000, exhausted: false });
    expect(overdriveRateLimitWaitBudget(800_000, 600_000)).toEqual({ waitMs: 100_000, exhausted: false });
    expect(overdriveRateLimitWaitBudget(OVERDRIVE_MAX_TOTAL_RATE_LIMIT_WAIT_MS - 1, 600_000)).toEqual({ waitMs: 250, exhausted: false });
    expect(overdriveRateLimitWaitBudget(OVERDRIVE_MAX_TOTAL_RATE_LIMIT_WAIT_MS, 600_000)).toEqual({ waitMs: 0, exhausted: true });
    expect(overdriveRateLimitWaitBudget(OVERDRIVE_MAX_TOTAL_RATE_LIMIT_WAIT_MS + 600_000, 600_000)).toEqual({ waitMs: 0, exhausted: true });
  });
  it('backs off headerless 429s across turns and avoids repeating the same failed request', async () => {
    vi.useFakeTimers();
    const endpoint = 'https://headerless-429.example/v1';
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: 'recovered' } }] })));
    vi.stubGlobal('fetch', fetcher);
    const provider = new UniversalProvider(() => ({ ...config, endpoint, auth: { type: 'none' as const }, requestBudget: { minRequestIntervalMs: 0 } }));

    const first = provider.generateText('first');
    const firstAssertion = expect(first).rejects.toThrow(/rate limit is still active/i);
    await vi.advanceTimersByTimeAsync(0);
    await firstAssertion;
    expect(fetcher).toHaveBeenCalledTimes(1);

    const next = provider.generateText('next');
    const nextAssertion = expect(next).resolves.toBe('recovered');
    await vi.advanceTimersByTimeAsync(29_999);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await nextAssertion;
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('honors a long compound reset window without sending repeated quota requests', async () => {
    vi.useFakeTimers();
    const endpoint = 'https://long-reset.example/v1';
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'x-ratelimit-remaining-requests': '0', 'x-ratelimit-reset-requests': '1m0s' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: 'recovered' } }] })));
    vi.stubGlobal('fetch', fetcher);
    const provider = new UniversalProvider(() => ({ ...config, endpoint, requestBudget: { minRequestIntervalMs: 0 } }), () => 'test');

    const first = provider.generateText('first request');
    const firstAssertion = expect(first).rejects.toThrow(/rate limit is still active/i);
    await vi.advanceTimersByTimeAsync(0);
    await firstAssertion;
    expect(fetcher).toHaveBeenCalledTimes(1);

    const next = provider.generateText('next request');
    await vi.advanceTimersByTimeAsync(59_999);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(next).resolves.toBe('recovered');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('uses advertised remaining-request capacity to speed up safely within the reset window', async () => {
    vi.useFakeTimers();
    const endpoint = 'https://adaptive-pacing.example/v1';
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: 'first' } }] }), {
        headers: { 'x-ratelimit-remaining-requests': '120', 'x-ratelimit-reset-requests': '60' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: 'second' } }] })));
    vi.stubGlobal('fetch', fetcher);
    const provider = new UniversalProvider(() => ({ ...config, endpoint, auth: { type: 'none' as const }, requestBudget: { minRequestIntervalMs: DEFAULT_ONLINE_PROVIDER_MIN_INTERVAL_MS } }));

    await expect(provider.generateText('first')).resolves.toBe('first');
    const second = provider.generateText('second');
    const secondAssertion = expect(second).resolves.toBe('second');
    await vi.advanceTimersByTimeAsync(499);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await secondAssertion;
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('keeps Turbo pacing within a tighter provider-advertised request limit', async () => {
    vi.useFakeTimers();
    const endpoint = 'https://turbo-adaptive-pacing.example/v1';
    const startedAt: number[] = [];
    const fetcher = vi.fn().mockImplementation(async () => {
      startedAt.push(Date.now());
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
        headers: startedAt.length === 1
          ? { 'x-ratelimit-remaining-requests': '120', 'x-ratelimit-reset-requests': '60' }
          : {},
      });
    });
    vi.stubGlobal('fetch', fetcher);
    const provider = new UniversalProvider(() => ({
      ...config,
      endpoint,
      auth: { type: 'none' as const },
      requestBudget: { minRequestIntervalMs: 250 },
    }));

    await expect(provider.generateText('first')).resolves.toBe('ok');
    const second = provider.generateText('second');
    const secondAssertion = expect(second).resolves.toBe('ok');
    await vi.advanceTimersByTimeAsync(499);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await secondAssertion;
    expect(startedAt[1] - startedAt[0]).toBeGreaterThanOrEqual(500);
  });
  it('paces against token quota when that is tighter than the request quota', async () => {
    vi.useFakeTimers();
    const endpoint = 'https://adaptive-token-pacing.example/v1';
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: 'first' } }] }), {
        headers: {
          'x-ratelimit-remaining-requests': '120', 'x-ratelimit-reset-requests': '60',
          'x-ratelimit-remaining-tokens': '10000', 'x-ratelimit-reset-tokens': '60',
        },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: 'second' } }] })));
    vi.stubGlobal('fetch', fetcher);
    const provider = new UniversalProvider(() => ({ ...config, endpoint, auth: { type: 'none' as const }, requestBudget: { minRequestIntervalMs: DEFAULT_ONLINE_PROVIDER_MIN_INTERVAL_MS } }));

    await expect(provider.generateText('first', {maxOutputTokens: 1024})).resolves.toBe('first');
    const second = provider.generateText('second', {maxOutputTokens: 1024});
    const secondAssertion = expect(second).resolves.toBe('second');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2_000);
    await secondAssertion;
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('bounds the number of pending requests per provider endpoint', async () => {
    vi.useFakeTimers();
    const endpoint = 'https://bounded-queue.example/v1';
    const controllers = Array.from({length: UNIVERSAL_MAX_QUEUED_REQUESTS_PER_ENDPOINT + 1}, () => new AbortController());
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new Error('aborted')), {once: true});
    }));
    vi.stubGlobal('fetch', fetcher);
    const provider = new UniversalProvider(() => ({ ...config, endpoint, auth: { type: 'none' as const }, requestBudget: { minRequestIntervalMs: 0 } }));
    const pending = controllers.map((controller, index) => provider.generateText(`queued ${index}`, {signal: controller.signal}));
    const overflowAssertion = expect(pending.at(-1)).rejects.toThrow(/queue is full/i);
    await vi.advanceTimersByTimeAsync(0);
    await overflowAssertion;
    controllers.forEach(controller => controller.abort());
    await Promise.allSettled(pending);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('serves queued interactive requests before background requests', async () => {
    const endpoint = 'https://priority-queue.example/v1';
    const sentPrompts: string[] = [];
    let finishFirst!: (response: Response) => void;
    const fetcher = vi.fn((_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      const prompt = body.messages.at(-1).content;
      sentPrompts.push(prompt);
      if (sentPrompts.length === 1) return new Promise<Response>(resolve => { finishFirst = resolve; });
      return Promise.resolve(new Response(JSON.stringify({choices:[{message:{content:prompt}}]})));
    });
    vi.stubGlobal('fetch', fetcher);
    const provider = new UniversalProvider(() => ({...config, endpoint, auth:{type:'none' as const}, requestBudget:{minRequestIntervalMs:0}}));
    const active = provider.generateText('active');
    await new Promise(resolve => setImmediate(resolve));
    const low = provider.generateText('background', {priority:'low'});
    const high = provider.generateText('interactive', {priority:'high'});
    await new Promise(resolve => setImmediate(resolve));
    finishFirst(new Response(JSON.stringify({choices:[{message:{content:'active'}}]})));
    await expect(active).resolves.toBe('active');
    await expect(Promise.all([low, high])).resolves.toEqual(['background','interactive']);
    expect(sentPrompts).toEqual(['active','interactive','background']);
  });
  it('does not delay or retry non-retryable provider errors',async()=>{
    const fetcher=vi.fn().mockResolvedValue(new Response('',{status:401}));vi.stubGlobal('fetch',fetcher);
    await expect(new UniversalProvider(()=>({...config,endpoint:'https://permanent-auth.example/v1'}),()=> 'bad').generateText('hi')).rejects.toThrow('HTTP 401');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('tracks non-secret request, latency, and provider usage diagnostics', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{message:{content:'measured'},finish_reason:'stop'}],
      usage: {prompt_tokens: 12, completion_tokens: 7},
    }), {headers:{'content-type':'application/json'}}));
    vi.stubGlobal('fetch', fetcher);
    const provider = new UniversalProvider(() => ({...config, endpoint:'https://diagnostics.example/v1', auth:{type:'none' as const}}));
    await expect(provider.generateText('private prompt is not retained')).resolves.toBe('measured');
    expect(provider.diagnosticsSnapshot()).toMatchObject({requests:1, httpSuccesses:1, retries:0, inputTokens:12, outputTokens:7});
    expect(provider.diagnosticsSnapshot().averageResponseLatencyMs).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(provider.diagnosticsSnapshot())).not.toContain('private prompt');
  });
  it('deduplicates only identical in-flight text requests, without caching completed answers', async () => {
    let finishFirst!: (response: Response) => void;
    let calls = 0;
    const successfulResponse = () => new Response(JSON.stringify({choices:[{message:{content:'one response'}}]}), {headers:{'content-type':'application/json'}});
    const fetcher = vi.fn(() => {
      calls++;
      return calls === 1 ? new Promise<Response>(resolve => { finishFirst = resolve; }) : Promise.resolve(successfulResponse());
    });
    vi.stubGlobal('fetch', fetcher);
    const provider = new UniversalProvider(() => ({...config, endpoint:'https://inflight-dedupe.example/v1', auth:{type:'none' as const}}));
    const first = provider.generateText('same read-only prompt');
    const second = provider.generateText('same read-only prompt');
    await new Promise(resolve => setImmediate(resolve));
    expect(fetcher).toHaveBeenCalledTimes(1);
    finishFirst(successfulResponse());
    await expect(Promise.all([first, second])).resolves.toEqual(['one response', 'one response']);
    expect(provider.diagnosticsSnapshot()).toMatchObject({requests:1, deduplicatedRequests:1});
    await expect(provider.generateText('same read-only prompt')).resolves.toBe('one response');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('does not deduplicate across provider credential changes', async () => {
    let credential = 'account-a-key';
    let resolveFirst!: (response: Response) => void;
    const fetcher = vi.fn((_url: string, init: RequestInit) => {
      const authorization = new Headers(init.headers).get('authorization');
      if (authorization === 'Bearer account-a-key') return new Promise<Response>(resolve => { resolveFirst = resolve; });
      return Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content: 'account-b answer' } }] })));
    });
    vi.stubGlobal('fetch', fetcher);
    const provider = new UniversalProvider(
      () => ({ ...config, endpoint: 'https://credential-dedupe.example/v1' }),
      () => credential,
    );
    const first = provider.generateText('same prompt');
    await new Promise(resolve => setImmediate(resolve));
    credential = 'account-b-key';
    const second = provider.generateText('same prompt');
    await new Promise(resolve => setImmediate(resolve));
    expect(fetcher).toHaveBeenCalledTimes(1);
    resolveFirst(new Response(JSON.stringify({ choices: [{ message: { content: 'account-a answer' } }] })));
    await expect(first).resolves.toBe('account-a answer');
    await expect(second).resolves.toBe('account-b answer');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('cancels while waiting between rate-limit retries',async()=>{
    vi.useFakeTimers();
    const fetcher=vi.fn().mockResolvedValue(new Response('',{status:429,headers:{'Retry-After':'1'}}));vi.stubGlobal('fetch',fetcher);
    const controller=new AbortController();
    const pending=new UniversalProvider(()=>({...config,endpoint:'https://cancel-retry.example/v1'}),()=> 'test').generateText('hi',{signal:controller.signal});
    const assertion=expect(pending).rejects.toThrow(/cancelled/i);
    await vi.advanceTimersByTimeAsync(100);
    controller.abort();
    await assertion;
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('enforces a total request deadline and records the timeout', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new Error('aborted')), {once:true});
    }));
    vi.stubGlobal('fetch', fetcher);
    const provider = new UniversalProvider(() => ({...config, endpoint:'https://total-timeout.example/v1', auth:{type:'none' as const}}));
    const pending = provider.generateText('wait forever', {totalTimeoutSeconds:1});
    const assertion = expect(pending).rejects.toThrow(/timed out after 1s \(total timeout\)/i);
    await vi.advanceTimersByTimeAsync(1_000);
    await assertion;
    expect(provider.diagnosticsSnapshot()).toMatchObject({timeouts: 1, cancellations: 0});
  });
  it('honors an explicit short timeout for fast connection checks',async()=>{
    vi.useFakeTimers();
    const fetcher=vi.fn().mockImplementation(async(_url:string,init:RequestInit)=>new Promise((_resolve,reject)=>{
      init.signal?.addEventListener('abort',()=>reject(new Error('aborted')), {once:true});
    }));
    vi.stubGlobal('fetch',fetcher);
    const provider = new UniversalProvider(()=>({...config,endpoint:'https://timeout-provider.example/v1'}),()=> 'test');
    const pending=provider.generateText('Reply OK.',{timeoutSeconds:5,maxOutputTokens:16});
    const assertion=expect(pending).rejects.toThrow(/timed out after 5s \(inactivity timeout\)/i);
    await vi.advanceTimersByTimeAsync(5000);
    await assertion;
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(provider.diagnosticsSnapshot()).toMatchObject({timeouts: 1, cancellations: 0});
  });
  it('preserves a provider timeout when caller cancellation arrives afterward', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new Error('aborted')), {once:true});
    }));
    vi.stubGlobal('fetch', fetcher);
    const controller = new AbortController();
    const provider = new UniversalProvider(() => ({...config, endpoint:'https://abort-race.example/v1', auth:{type:'none' as const}}));
    const pending = provider.generateText('wait for timeout', {timeoutSeconds:5, signal:controller.signal});
    const assertion = expect(pending).rejects.toThrow(/timed out after 5s \(inactivity timeout\)/i);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5_000);
    controller.abort();
    await assertion;
    expect(provider.diagnosticsSnapshot()).toMatchObject({timeouts: 1, cancellations: 0});
  });
  it('blocks an already aborted request',async()=>{
    vi.stubGlobal('fetch',vi.fn(async(_url,init)=>{if(init.signal.aborted)throw new Error('aborted');return new Response('{}');}));
    const provider = new UniversalProvider(()=>config,()=> 'test');
    await expect(provider.generateText('hi',{signal:AbortSignal.abort()})).rejects.toThrow('cancelled by caller');
    expect(provider.diagnosticsSnapshot()).toMatchObject({timeouts: 0, cancellations: 1});
  });
  it('validates native Anthropic and Gemini stream completion',async()=>{
    const anthropic=stream([{type:'message_start',message:{usage:{input_tokens:3}}},{type:'content_block_start',index:0,content_block:{type:'tool_use',id:'t',name:'read',input:{}}},{type:'content_block_delta',index:0,delta:{partial_json:'{"x":1}'}},{type:'content_block_stop',index:0},{type:'message_delta',delta:{stop_reason:'tool_use'},usage:{output_tokens:4}},{type:'message_stop'}],false);
    expect((await collectProviderStream(anthropic,'anthropic',()=>{})).content[0].input).toEqual({x:1});
    const gemini=stream([{candidates:[{content:{parts:[{text:'hi'}]}}]},{candidates:[{finishReason:'STOP'}]}],false);
    expect((await collectProviderStream(gemini,'gemini',()=>{})).candidates[0].finishReason).toBe('STOP');
  });
  it('applies safe defaults when settings select an unconfigured Universal provider', async () => {
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 2, completion_tokens: 1 } }), { headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetcher);
    const settings = { universalEndpoint: config.endpoint, universalModel: config.model, universalProtocol: config.protocol, offlineMode: false } as any;
    const selected = selectedProviderConfig(settings);
    const provider = new UniversalProvider(() => ({ ...selected, auth: { type: 'none' } }), () => 'unused');
    await provider.chatWithTools([
      { role: 'user', content: 'old context '.repeat(6000) },
      { role: 'assistant', content: 'keep this recent context' },
      { role: 'user', content: 'answer briefly' },
    ], []);
    const request = JSON.parse(String(fetcher.mock.calls[0][1].body));
    expect(JSON.stringify(request.messages).length).toBeLessThanOrEqual(60_000);
    expect(request.max_tokens).toBe(4_096);
  });
  it('persists validated custom request budgets for saved profiles', () => {
    const [profile] = validateProfiles([{
      id: 'budgeted', name: 'Budgeted', protocol: 'openai', endpoint: 'https://example.com/v1', model: 'model',
      requestBudget: { maxInputChars: 12000, maxOutputTokens: 700, minRequestIntervalMs: 1500 },
    }]);
    expect(profile.requestBudget).toEqual({ maxInputChars: 12000, maxOutputTokens: 700, minRequestIntervalMs: 1500, maxConcurrentRequests: 1 });
  });
  it('profiles accept arbitrary model IDs and strip secrets from settings',()=>{
    const profiles=validateProfiles([{...config,id:'custom',name:'Mine',apiKey:'never-persist',auth:{type:'bearer',secret:'hidden'}}]);
    expect(JSON.stringify(profiles)).not.toContain('hidden');expect(JSON.stringify(profiles)).not.toContain('never-persist');
    expect(selectedProviderConfig({providerProfiles:profiles,activeProviderProfile:'custom',offlineMode:false} as any).model).toBe('user/model');
    expect(()=>validateProfiles([...profiles,...profiles])).toThrow('unique');
  });
  it('executes registered plugins independently of a provider',async()=>{
    const ext=new ExtensionTools();ext.register({definition:{name:'plugin_test',description:'test',parameters:{type:'object',properties:{}},permission:'read',category:'project'},invoke:async()=> 'actual output'});
    expect(await ext.get('plugin_test')!.invoke({})).toBe('actual output');
  });
  it('replays signed thinking blocks on Anthropic tool followups',async()=>{
    const blocks=[{type:'thinking',thinking:'reason',signature:'signed'},{type:'tool_use',id:'call',name:'lookup',input:{x:1}}];
    const fetcher=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({content:blocks,stop_reason:'tool_use'}))).mockResolvedValueOnce(new Response(JSON.stringify({content:[{type:'text',text:'done'}]})));vi.stubGlobal('fetch',fetcher);
    const p=new UniversalProvider(()=>({...config,protocol:'anthropic',capabilities:{tools:true,streaming:true,reasoning:true},reasoningEffort:'low'}),()=> 'test');
    const first=await p.chatWithTools([{role:'user',content:'lookup'}],[]);
    await p.chatWithTools([{role:'user',content:'lookup'},{role:'assistant',content:'',toolCalls:first.toolCalls},{role:'tool',toolCallId:'call',name:'lookup',content:'found'}],[]);
    const body=JSON.parse(fetcher.mock.calls[1][1].body);expect(body.messages[1].content).toEqual(blocks);expect(body.thinking.budget_tokens).toBe(1024);
  });
  it('retains normalized conversation when switching API protocols',async()=>{
    const fetcher=vi.fn().mockImplementation(async()=>new Response(JSON.stringify({candidates:[{content:{parts:[{text:'remembered'}]},finishReason:'STOP'}]})));vi.stubGlobal('fetch',fetcher);
    const history=[{role:'user' as const,content:'remember my project'},{role:'assistant' as const,content:'project noted'},{role:'user' as const,content:'continue'}];
    await new UniversalProvider(()=>({...config,protocol:'gemini'}),()=> 'test').chatWithTools(history,[]);
    expect(JSON.parse(fetcher.mock.calls[0][1].body).contents.map((c:any)=>c.parts[0].text)).toEqual(history.map(m=>m.content));
  });
  it('bridges real HTTP plugin invocations',async()=>{
    const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({answer:42})));vi.stubGlobal('fetch',fetcher);
    const ext=new ExtensionTools();ext.connectPlugin('demo','https://plugin.example/api',[{name:'lookup',description:'lookup',parameters:{type:'object',properties:{}},category:'project',permission:'read'}]);
    expect(await ext.get('plugin_demo_lookup')!.invoke({query:'test'})).toContain('42');expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({tool:'lookup',arguments:{query:'test'}});
  });
  it('uses native completed Responses events and refuses incomplete events',async()=>{
    const final={status:'completed',output:[{type:'message',content:[{type:'output_text',text:'done'}]}]};
    const chunks:string[]=[];expect(await collectProviderStream(stream([{type:'response.output_text.delta',delta:'done'},{type:'response.completed',response:final}],false),'responses',t=>chunks.push(t))).toEqual(final);expect(chunks).toEqual(['done']);
    await expect(collectProviderStream(stream([{type:'response.incomplete'}],false),'responses',()=>{})).rejects.toThrow('did not complete');
  });
  it('routes ordinary provider text to chat and only explicit tools to execution',()=>{
    const router=new ChatResponseRouter(new Set(['write_file']));
    const plain=router.route('Here is the explanation.\n```js\nconsole.log(1)\n```');
    expect(plain.chatText).toContain('console.log(1)');expect(plain.toolCalls).toHaveLength(0);
    const action=router.route('<tool_call>{"name":"write_file","arguments":{"filePath":"x","content":"ok"}}</tool_call>');
    expect(action.chatText).toBe('');expect(action.toolCalls[0].name).toBe('write_file');
  });
  it('initializes MCP and bridges discovery and calls',async()=>{
    const methods:string[]=[];vi.stubGlobal('fetch',vi.fn(async(_url,init)=>{
      const body=JSON.parse(init.body);methods.push(body.method);
      const result=body.method==='tools/list'?{tools:[{name:'lookup',inputSchema:{type:'object',properties:{}},description:'lookup'}]}:body.method==='tools/call'?{content:[{type:'text',text:'live result'}]}:{};
      return body.id?new Response(JSON.stringify({jsonrpc:'2.0',id:body.id,result})):new Response(null,{status:202});
    }));
    const ext=new ExtensionTools();await ext.connectMCP('demo','https://mcp.example/api');expect(await ext.get('mcp_demo_lookup')!.invoke({})).toContain('live result');expect(methods).toEqual(['initialize','notifications/initialized','tools/list','tools/call']);
  });
});
