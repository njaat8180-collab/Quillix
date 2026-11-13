import {describe,it,expect,vi,afterEach} from 'vitest';
import {UniversalProvider,providerBudgetWaitMs,noteProviderBudgetRequest,normalizeProviderRateLimit,DEFAULT_UNIVERSAL_REQUEST_BUDGET} from '../universal.js';
const rpmConfig={protocol:'openai' as const,endpoint:'https://budget-rpm.example/v1',model:'vendor/model',offlineMode:false,auth:{type:'none' as const},requestBudget:{minRequestIntervalMs:0,maxRequestsPerMinute:1}};
const tpmConfig={protocol:'openai' as const,endpoint:'https://budget-tpm.example/v1',model:'vendor/model',offlineMode:false,auth:{type:'none' as const},requestBudget:{minRequestIntervalMs:0,maxTokensPerMinute:10_000}};
const tools=[{name:'write_file',description:'Write',category:'file' as const,permission:'write' as const,parameters:{type:'object' as const,properties:{}}}];
function okResponse(){return new Response(JSON.stringify({choices:[{message:{tool_calls:[{id:'a',function:{name:'write_file',arguments:'{"filePath":"index.html","content":"ok"}'}}]},finish_reason:'tool_calls'}]}));}
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
describe('provider budget window limiter',()=>{
  it('treats unset or zero ceilings as unlimited',()=>{
    expect(providerBudgetWaitMs('unlimited-a',undefined,1_000,0)).toBe(0);
    expect(providerBudgetWaitMs('unlimited-b',{maxRequestsPerMinute:0,maxTokensPerMinute:0},1_000,0)).toBe(0);
    expect(DEFAULT_UNIVERSAL_REQUEST_BUDGET.maxRequestsPerMinute).toBe(0);
    expect(DEFAULT_UNIVERSAL_REQUEST_BUDGET.maxTokensPerMinute).toBe(0);
  });
  it('normalizes declared ceilings defensively',()=>{
    expect(normalizeProviderRateLimit(undefined)).toBe(0);
    expect(normalizeProviderRateLimit('')).toBe(0);
    expect(normalizeProviderRateLimit('bad')).toBe(0);
    expect(normalizeProviderRateLimit(-5)).toBe(0);
    expect(normalizeProviderRateLimit(0)).toBe(0);
    expect(normalizeProviderRateLimit(12.4)).toBe(12);
    expect(normalizeProviderRateLimit(999_999)).toBe(100_000);
  });
  it('delays a burst beyond the per-minute request ceiling until the oldest entry expires',()=>{
    const key='rpm-window';
    noteProviderBudgetRequest(key,100,0);
    noteProviderBudgetRequest(key,100,10_000);
    expect(providerBudgetWaitMs(key,{maxRequestsPerMinute:2},100,20_000)).toBe(40_000);
    expect(providerBudgetWaitMs(key,{maxRequestsPerMinute:2},100,59_999)).toBe(1);
    expect(providerBudgetWaitMs(key,{maxRequestsPerMinute:2},100,60_001)).toBe(0);
  });
  it('lets requests through while the per-minute ceiling has headroom',()=>{
    const key='rpm-headroom';
    noteProviderBudgetRequest(key,100,0);
    expect(providerBudgetWaitMs(key,{maxRequestsPerMinute:3},100,30_000)).toBe(0);
  });
  it('delays when the per-minute token ceiling would be exceeded',()=>{
    const key='tpm-window';
    noteProviderBudgetRequest(key,15_000,0);
    expect(providerBudgetWaitMs(key,{maxTokensPerMinute:20_000},6_000,10_000)).toBe(50_000);
    expect(providerBudgetWaitMs(key,{maxTokensPerMinute:20_000},6_000,60_001)).toBe(0);
  });
  it('waits a full window for a single request larger than the token ceiling',()=>{
    const key='tpm-oversized';
    noteProviderBudgetRequest(key,30_000,0);
    expect(providerBudgetWaitMs(key,{maxTokensPerMinute:20_000},25_000,5_000)).toBe(55_000);
  });
  it('keeps independent endpoints on independent windows',()=>{
    noteProviderBudgetRequest('endpoint-a',100,0);
    expect(providerBudgetWaitMs('endpoint-b',{maxRequestsPerMinute:1},100,0)).toBe(0);
    expect(providerBudgetWaitMs('endpoint-a',{maxRequestsPerMinute:1},100,0)).toBe(60_000);
  });
  it('paces a live burst to the declared per-minute request ceiling',async()=>{
    vi.useFakeTimers();
    const fetcher=vi.fn().mockImplementation(()=>okResponse());
    vi.stubGlobal('fetch',fetcher);
    const provider=new UniversalProvider(()=>rpmConfig);
    const first=provider.chatWithTools([{role:'user',content:'Write the file'}],tools,{requiredToolName:'write_file'});
    await vi.advanceTimersByTimeAsync(0);
    await first;
    expect(fetcher).toHaveBeenCalledTimes(1);
    const second=provider.chatWithTools([{role:'user',content:'Write the file'}],tools,{requiredToolName:'write_file'});
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_001);
    await second;
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('paces a live burst to the declared per-minute token ceiling',async()=>{
    vi.useFakeTimers();
    const fetcher=vi.fn().mockImplementation(()=>okResponse());
    vi.stubGlobal('fetch',fetcher);
    const provider=new UniversalProvider(()=>tpmConfig);
    const first=provider.chatWithTools([{role:'user',content:'Write the file'}],tools,{requiredToolName:'write_file'});
    await vi.advanceTimersByTimeAsync(0);
    await first;
    expect(fetcher).toHaveBeenCalledTimes(1);
    const second=provider.chatWithTools([{role:'user',content:'Write the file'}],tools,{requiredToolName:'write_file'});
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_001);
    await second;
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
