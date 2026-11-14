import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProviderRouter, SarvamProvider, hasSarvamKey, saveSarvamKey } from '../sarvam.js';
import type { AIProvider } from '../qwen.js';
import type { SettingsStore } from '../settings.js';

const previousKey = process.env.SARVAM_API_KEY;
const previousKeys = process.env.SARVAM_API_KEYS;
afterEach(() => {
  vi.unstubAllGlobals();
  if (previousKey === undefined) delete process.env.SARVAM_API_KEY;
  else process.env.SARVAM_API_KEY = previousKey;
  if (previousKeys === undefined) delete process.env.SARVAM_API_KEYS;
  else process.env.SARVAM_API_KEYS = previousKeys;
});

describe('Sarvam provider protection and API contract', () => {
  it('does not store a plaintext API key on non-Windows', () => {
    if (process.platform === 'win32') return;
    expect(() => saveSarvamKey('sample-key-for-test')).toThrow(/Secure API key storage/);
  });

  it('detects configured environment key without writing it to settings', () => {
    process.env.SARVAM_API_KEY = 'test-secret';
    expect(hasSarvamKey()).toBe(true);
  });

  it('sends the API key only in the upstream header and handles tool calls', async () => {
    process.env.SARVAM_API_KEY = 'test-secret';
    const fake = vi.fn(async (_url: string, init: RequestInit) => {
      const data = JSON.parse(String(init.body));
      expect(init.headers).toEqual(expect.objectContaining({'api-subscription-key':'test-secret'}));
      expect(data.model).toBe('sarvam-105b');
      expect(data.messages[0]).toMatchObject({role:'system',content:'You are a coder.'});
      expect(data.messages[1]).toMatchObject({role:'user',content:'Create index.html'});
      expect(data.tools[0].function.name).toBe('write_file');
      expect(String(init.body)).not.toContain('test-secret');
      return {ok:true,json:async()=>({choices:[{message:{content:'',tool_calls:[{id:'call1',function:{name:'write_file',arguments:'{"filePath":"index.html","content":"hello"}'}}]}}]})};
    });
    vi.stubGlobal('fetch', fake);
    const response = await new SarvamProvider().chatWithTools(
      [{role:'user',content:'Create index.html'}],
      [{name:'write_file',description:'Write a file',parameters:{type:'object',properties:{filePath:{type:'string'}}}}] as any,
      {systemInstruction: 'You are a coder.'},
    );
    expect(response.toolCalls).toEqual([{id:'call1',name:'write_file',args:{filePath:'index.html',content:'hello'}}]);
  });

  it('respects system instructions in normal chat', async () => {
    process.env.SARVAM_API_KEY = 'test-secret';
    vi.stubGlobal('fetch', vi.fn(async (_url:string, init:RequestInit) => {
      const payload = JSON.parse(String(init.body));
      expect(payload.messages).toEqual([{role:'system',content:'Reply in Hindi'},{role:'user',content:'Hello'}]);
      return {ok:true,json:async()=>({choices:[{message:{content:'नमस्ते'}}]})};
    }));
    const result = await new SarvamProvider().generateText('Hello',{systemInstruction:'Reply in Hindi'});
    expect(result).toBe('नमस्ते');
  });
  it('does not rotate Sarvam keys to work around a shared rate limit', async () => {
    process.env.SARVAM_API_KEY = 'primary-key';
    process.env.SARVAM_API_KEYS = 'backup-key';
    const observed: string[] = [];
    const fake = vi.fn(async (_url: string, init: RequestInit) => {
      observed.push(String((init.headers as Record<string, string>)['api-subscription-key']));
      return { ok: false, status: 429, headers: new Headers(), json: async () => ({}) };
    });
    vi.stubGlobal('fetch', fake);
    await expect(new SarvamProvider().generateText('hello')).rejects.toThrow(/HTTP 429/);
    expect(observed).toEqual(['primary-key', 'primary-key', 'primary-key']);
  });

  it('uses a Sarvam backup key after primary-key authentication rejection', async () => {
    process.env.SARVAM_API_KEY = 'primary-key';
    process.env.SARVAM_API_KEYS = 'backup-key';
    const observed: string[] = [];
    const fake = vi.fn(async (_url: string, init: RequestInit) => {
      observed.push(String((init.headers as Record<string, string>)['api-subscription-key']));
      return observed.length === 1
        ? { ok: false, status: 401, headers: new Headers(), json: async () => ({}) }
        : { ok: true, status: 200, headers: new Headers(), json: async () => ({ choices: [{ message: { content: 'recovered' } }] }) };
    });
    vi.stubGlobal('fetch', fake);
    await expect(new SarvamProvider().generateText('hello')).resolves.toBe('recovered');
    expect(observed).toEqual(['primary-key', 'backup-key']);
  });

  it('compacts older Sarvam context before sending a free-tier request', async () => {
    process.env.SARVAM_API_KEY = 'test-secret';
    vi.stubGlobal('fetch', vi.fn(async (_url:string, init:RequestInit) => {
      const payload = JSON.parse(String(init.body));
      expect(JSON.stringify(payload.messages).length).toBeLessThanOrEqual(60_000);
      expect(payload.messages.at(-1).content).toBe('latest request');
      return {ok:true,json:async()=>({choices:[{message:{content:'ok'}}]})};
    }));
    const history = Array.from({length: 20}, (_, index) => ({role: 'tool' as const, name: 'read_file', toolCallId: `call-${index}`, content: 'old tool result '.repeat(500)}));
    history.push({role: 'user', content: 'latest request'} as any);
    await new SarvamProvider().chatWithTools(history, []);
  });

  it('honors an explicit short timeout for Quick Connect checks', async () => {
    process.env.SARVAM_API_KEY = 'test-secret';
    vi.stubGlobal('fetch', vi.fn(async (_url:string, init:RequestInit) => {
      await new Promise<void>((resolve) => init.signal?.addEventListener('abort', () => resolve(), { once: true }));
      throw new DOMException('The operation was aborted.', 'AbortError');
    }));
    await expect(new SarvamProvider().generateText('Reply OK.', { timeoutSeconds: 5, maxOutputTokens: 8 }))
      .rejects.toThrow(/timed out|aborted/i);
  }, 8_000);

  it('accounts for large tool schemas when applying the request ceiling', async () => {
    process.env.SARVAM_API_KEY = 'test-secret';
    vi.stubGlobal('fetch', vi.fn(async (_url:string, init:RequestInit) => {
      const payload = JSON.parse(String(init.body));
      expect(JSON.stringify(payload.messages).length + JSON.stringify(payload.tools).length).toBeLessThanOrEqual(60_000);
      return {ok:true,json:async()=>({choices:[{message:{content:'ok'}}]})};
    }));
    const tools = [{name:'large_tool',description:'schema '.repeat(8_000),parameters:{type:'object',properties:{value:{type:'string'}}}}];
    await new SarvamProvider().chatWithTools([
      {role:'tool',name:'read_file',toolCallId:'old',content:'old result '.repeat(4_000)},
      {role:'user',content:'latest request'},
    ], tools as any);
  });

  it('never contacts Sarvam while Offline Mode is enabled', async () => {
    process.env.SARVAM_API_KEY = 'test-secret';
    const fetched = vi.fn(); vi.stubGlobal('fetch', fetched);
    const settings = {get:()=>({aiProvider:'sarvam',offlineMode:true})} as unknown as SettingsStore;
    const ollama = {generateText:vi.fn()} as unknown as AIProvider;
    const router = new ProviderRouter(ollama, settings);
    await expect(router.generateText('Hello')).rejects.toThrow(/Disable Offline Mode/);
    expect(fetched).not.toHaveBeenCalled();
  });
});
