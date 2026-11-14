import { afterEach, describe, expect, it, vi } from 'vitest';
import { UniversalProvider } from '../universal.js';

type Protocol = 'openai' | 'responses' | 'anthropic' | 'gemini';

const base = {
  endpoint: 'https://protocols.example/api',
  model: 'vendor/model',
  offlineMode: false,
};

let endpointSequence = 0;

function provider(protocol: Protocol, auth: any = { type: 'none' as const }, requestBudget: any = { minRequestIntervalMs: 0 }) {
  const suffix = ++endpointSequence;
  return new UniversalProvider(() => ({
    ...base,
    protocol,
    endpoint: protocol === 'gemini' ? `https://protocols-${suffix}.example/v1beta` : `https://protocols-${suffix}.example/api`,
    auth,
    requestBudget,
  }), () => 'credential');
}

function tool() {
  return {
    name: 'lookup',
    description: 'Look up a value',
    category: 'file' as const,
    permission: 'read' as const,
    parameters: { type: 'object' as const, properties: { path: { type: 'string' as const, description: 'Path to inspect' } }, required: ['path'] },
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('universal protocol request construction', () => {
  it('builds an OpenAI chat-completions request with bearer auth, model, temperature and function schema', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] })));
    vi.stubGlobal('fetch', fetcher);
    await provider('openai', { type: 'bearer' }).chatWithTools(
      [{ role: 'system', content: 'Be exact' }, { role: 'user', content: 'Find it' }],
      [tool()],
      { temperature: 0.2 },
    );
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toMatch(/^https:\/\/protocols-\d+\.example\/api\/chat\/completions$/);
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer credential');
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe('vendor/model');
    expect(body.temperature).toBe(0.2);
    expect(body.max_tokens).toBe(8192);
    expect(body.messages).toEqual([
      { role: 'system', content: 'Be exact' },
      { role: 'user', content: 'Find it' },
    ]);
    expect(body.tools).toEqual([{ type: 'function', function: { name: 'lookup', description: 'Look up a value', parameters: tool().parameters } }]);
  });

  it('builds an OpenAI Responses request with typed function tools', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }] })));
    vi.stubGlobal('fetch', fetcher);
    await provider('responses').chatWithTools([{ role: 'user', content: 'Find it' }], [tool()]);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toMatch(/^https:\/\/protocols-\d+\.example\/api\/responses$/);
    const body = JSON.parse(String(init.body));
    expect(body.input).toEqual([{ role: 'user', content: 'Find it' }]);
    expect(body.tools).toEqual([{ type: 'function', name: 'lookup', description: 'Look up a value', parameters: tool().parameters, strict: false }]);
  });

  it('builds an Anthropic Messages request with system text and input_schema', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ content: [{ type: 'text', text: 'ok' }] })));
    vi.stubGlobal('fetch', fetcher);
    await provider('anthropic', { type: 'header', header: 'x-api-key' }).chatWithTools(
      [{ role: 'system', content: 'First rule' }, { role: 'system', content: 'Second rule' }, { role: 'user', content: 'Find it' }],
      [tool()],
    );
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toMatch(/^https:\/\/protocols-\d+\.example\/api\/messages$/);
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('credential');
    expect((init.headers as Record<string, string>)['anthropic-version']).toBe('2023-06-01');
    const body = JSON.parse(String(init.body));
    expect(body.system).toBe('First rule\n\nSecond rule');
    expect(body.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: 'Find it' }] }]);
    expect(body.tools).toEqual([{ name: 'lookup', description: 'Look up a value', input_schema: tool().parameters }]);
  });

  it('builds a Gemini generateContent request with function declarations and model path', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }] })));
    vi.stubGlobal('fetch', fetcher);
    await provider('gemini', { type: 'none' }).chatWithTools([{ role: 'user', content: 'Find it' }], [tool()]);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toMatch(/^https:\/\/protocols-\d+\.example\/v1beta\/models\/vendor%2Fmodel:generateContent$/);
    const body = JSON.parse(String(init.body));
    expect(body.contents).toEqual([{ role: 'user', parts: [{ text: 'Find it' }] }]);
    expect(body.tools).toEqual([{ functionDeclarations: [{ name: 'lookup', description: 'Look up a value', parameters: tool().parameters }] }]);
  });

  it('does not duplicate explicit protocol endpoint suffixes', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] })));
    vi.stubGlobal('fetch', fetcher);
    const p = new UniversalProvider(() => ({ ...base, protocol: 'openai', endpoint: 'https://protocols.example/v1/chat/completions', auth: { type: 'none' } }), () => 'unused');
    await p.generateText('hello');
    expect(fetcher.mock.calls[0][0]).toBe('https://protocols.example/v1/chat/completions');
  });
});

describe('universal response and tool normalization', () => {
  it('normalizes OpenAI tool calls and accepts object or JSON-string arguments', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { tool_calls: [
        { id: 'one', function: { name: 'first', arguments: { x: 1 } } },
        { id: 'two', function: { name: 'second', arguments: '{"y":2}' } },
      ] } }],
    })));
    vi.stubGlobal('fetch', fetcher);
    const result = await provider('openai').chatWithTools([{ role: 'user', content: 'run tools' }], []);
    expect(result.toolCalls.map(call => call.args)).toEqual([{ x: 1 }, { y: 2 }]);
  });

  it('normalizes Responses, Anthropic and Gemini tool calls', async () => {
    const responses = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: 'completed',
      output: [{ type: 'function_call', call_id: 'call-r', name: 'lookup', arguments: '{"path":"a"}' }],
    })));
    vi.stubGlobal('fetch', responses);
    const responsesResult = await provider('responses').chatWithTools([{ role: 'user', content: 'run' }], []);
    expect(responsesResult.toolCalls[0]).toMatchObject({ id: 'call-r', name: 'lookup', args: { path: 'a' } });

    const anthropic = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      content: [{ type: 'tool_use', id: 'call-a', name: 'lookup', input: { path: 'b' } }],
    })));
    vi.stubGlobal('fetch', anthropic);
    const anthropicResult = await provider('anthropic').chatWithTools([{ role: 'user', content: 'run' }], []);
    expect(anthropicResult.toolCalls[0]).toMatchObject({ id: 'call-a', name: 'lookup', args: { path: 'b' } });

    const gemini = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ functionCall: { name: 'lookup', args: { path: 'c' } } }] }, finishReason: 'STOP' }],
    })));
    vi.stubGlobal('fetch', gemini);
    const geminiResult = await provider('gemini').chatWithTools([{ role: 'user', content: 'run' }], []);
    expect(geminiResult.toolCalls[0]).toMatchObject({ name: 'lookup', args: { path: 'c' } });
  });

  it('rejects invalid and non-object tool arguments without executing them', async () => {
    const invalid = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { tool_calls: [{ id: 'one', function: { name: 'lookup', arguments: '{broken' } }] } }],
    })));
    vi.stubGlobal('fetch', invalid);
    await expect(provider('openai').chatWithTools([{ role: 'user', content: 'run' }], [])).rejects.toThrow('invalid tool-call JSON');

    const nonObject = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { tool_calls: [{ id: 'one', function: { name: 'lookup', arguments: '[1,2]' } }] } }],
    })));
    vi.stubGlobal('fetch', nonObject);
    await expect(provider('openai').chatWithTools([{ role: 'user', content: 'run' }], [])).rejects.toThrow('non-object tool arguments');
  });

  it('rejects truncated responses for each protocol', async () => {
    const cases: Array<[Protocol, any, RegExp]> = [
      ['openai', { choices: [{ message: { content: 'partial' }, finish_reason: 'length' }] }, /output truncated/i],
      ['responses', { status: 'incomplete', output: [] }, /did not complete/i],
      ['anthropic', { content: [{ type: 'text', text: 'partial' }], stop_reason: 'max_tokens' }, /output truncated/i],
      ['gemini', { candidates: [{ content: { parts: [{ text: 'partial' }] }, finishReason: 'MAX_TOKENS' }] }, /output truncated/i],
    ];
    for (const [protocol, payload, message] of cases) {
      const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(payload)));
      vi.stubGlobal('fetch', fetcher);
      await expect(provider(protocol).chatWithTools([{ role: 'user', content: 'run' }], [])).rejects.toThrow(message);
    }
  });
});

describe('universal HTTP errors and credentials', () => {
  it.each([
    [400, /HTTP 400/],
    [404, /HTTP 404/],
    [422, /HTTP 422/],
  ])('maps HTTP %i without retrying', async (status, message) => {
    const fetcher = vi.fn().mockResolvedValue(new Response('', { status }));
    vi.stubGlobal('fetch', fetcher);
    await expect(provider('openai').chatWithTools([{ role: 'user', content: 'run' }], [])).rejects.toThrow(message);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('maps HTTP 500 after exhausting transient retries', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockResolvedValue(new Response('', { status: 500 }));
    vi.stubGlobal('fetch', fetcher);
    const pending = provider('openai').generateText('run');
    const assertion = expect(pending).rejects.toThrow(/HTTP 500 after 2 retries/i);
    await vi.advanceTimersByTimeAsync(60_000);
    await assertion;
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('honors Retry-After when recovering from HTTP 429', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'retry-after': '2' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: 'recovered' } }] })));
    vi.stubGlobal('fetch', fetcher);
    const pending = provider('openai').generateText('run');
    const assertion = expect(pending).resolves.toBe('recovered');
    await vi.advanceTimersByTimeAsync(1_999);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('rotates to a backup key after HTTP 403 and exhausts all keys with a clear error', async () => {
    const observed: string[] = [];
    const fetcher = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      observed.push(String((init.headers as Record<string, string>).Authorization));
      return new Response('', { status: 403 });
    });
    vi.stubGlobal('fetch', fetcher);
    const p = new UniversalProvider(() => ({ ...base, protocol: 'openai', auth: { type: 'bearer' } }), () => ['primary', 'backup']);
    await expect(p.generateText('run')).rejects.toThrow(/denied access/i);
    expect(observed).toEqual(['Bearer primary', 'Bearer backup']);
  });

  it('reports credential exhaustion after HTTP 401 on the last key', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('', { status: 401 }));
    vi.stubGlobal('fetch', fetcher);
    const p = new UniversalProvider(() => ({ ...base, protocol: 'openai', auth: { type: 'bearer' } }), () => ['primary', 'backup']);
    await expect(p.generateText('run')).rejects.toThrow(/rejected the API key/i);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('rejects offline mode before any network request', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const p = new UniversalProvider(() => ({ ...base, protocol: 'openai', offlineMode: true }), () => 'credential');
    await expect(p.generateText('run')).rejects.toThrow(/Turn off Offline Mode/i);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
