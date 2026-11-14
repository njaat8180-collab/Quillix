import { afterEach, describe, expect, it, vi } from 'vitest';
import { UniversalProvider } from '../universal.js';
import { clearPromptCache } from '../promptCache.js';

const base = {
  protocol: 'openai' as const,
  endpoint: 'https://runtime-additional.example/v1',
  model: 'vendor/model',
  offlineMode: false,
};

function sse(events: any[], done = false) {
  const raw = events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + (done ? 'data: [DONE]\n\n' : '');
  return new Response(raw, { headers: { 'content-type': 'text/event-stream' } });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  clearPromptCache();
});

describe('universal streaming responses', () => {
  it('parses OpenAI SSE content and tool-call arguments', async () => {
    const fetcher = vi.fn().mockResolvedValue(sse([
      { choices: [{ delta: { content: 'Hello ' } }] },
      { choices: [{ delta: { content: 'world' } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-o', function: { name: 'lookup', arguments: '{"path":"a"}' } }] }, finish_reason: 'tool_calls' }] },
    ]));
    vi.stubGlobal('fetch', fetcher);
    const chunks: string[] = [];
    const result = await new UniversalProvider(() => ({ ...base, auth: { type: 'none' } }), () => 'unused')
      .chatWithToolsStream([{ role: 'user', content: 'run' }], [], {}, chunk => chunks.push(chunk));
    expect(chunks).toEqual(['Hello ', 'world']);
    expect(result.toolCalls[0]).toMatchObject({ id: 'call-o', name: 'lookup', args: { path: 'a' } });
    expect(JSON.parse(String(fetcher.mock.calls[0][1].body)).stream).toBe(true);
  });

  it('parses Responses SSE and returns the completed native response', async () => {
    const final = {
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'done' }] }],
    };
    const fetcher = vi.fn().mockResolvedValue(sse([
      { type: 'response.output_text.delta', delta: 'done' },
      { type: 'response.completed', response: final },
    ]));
    vi.stubGlobal('fetch', fetcher);
    const chunks: string[] = [];
    const result = await new UniversalProvider(() => ({ ...base, protocol: 'responses', auth: { type: 'none' } }), () => 'unused')
      .chatWithToolsStream([{ role: 'user', content: 'run' }], [], {}, chunk => chunks.push(chunk));
    expect(chunks).toEqual(['done']);
    expect(result.text).toBe('done');
    expect(JSON.parse(String(fetcher.mock.calls[0][1].body)).stream).toBe(true);
  });

  it('parses Anthropic SSE text and native tool input', async () => {
    const fetcher = vi.fn().mockResolvedValue(sse([
      { type: 'message_start', message: { usage: { input_tokens: 2 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'call-a', name: 'lookup', input: {} } },
      { type: 'content_block_delta', index: 0, delta: { partial_json: '{"path":"a"}' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 3 } },
      { type: 'message_stop' },
    ]));
    vi.stubGlobal('fetch', fetcher);
    const result = await new UniversalProvider(() => ({ ...base, protocol: 'anthropic', auth: { type: 'none' } }), () => 'unused')
      .chatWithToolsStream([{ role: 'user', content: 'run' }], [], {}, () => {});
    expect(result.toolCalls[0]).toMatchObject({ id: 'call-a', name: 'lookup', args: { path: 'a' } });
    expect(JSON.parse(String(fetcher.mock.calls[0][1].body)).stream).toBe(true);
  });

  it('uses Gemini streamGenerateContent SSE and collects text', async () => {
    const fetcher = vi.fn().mockResolvedValue(sse([
      { candidates: [{ content: { parts: [{ text: 'gemini ' }] } }] },
      { candidates: [{ content: { parts: [{ text: 'answer' }] }, finishReason: 'STOP' }] },
    ]));
    vi.stubGlobal('fetch', fetcher);
    const chunks: string[] = [];
    const result = await new UniversalProvider(() => ({
      ...base,
      protocol: 'gemini',
      endpoint: 'https://runtime-additional.example/v1beta',
      auth: { type: 'none' },
    }), () => 'unused').chatWithToolsStream([{ role: 'user', content: 'run' }], [], {}, chunk => chunks.push(chunk));
    expect(chunks).toEqual(['gemini ', 'answer']);
    expect(result.text).toBe('gemini \nanswer');
    expect(fetcher.mock.calls[0][0]).toBe('https://runtime-additional.example/v1beta/models/vendor%2Fmodel:streamGenerateContent?alt=sse');
  });
});

describe('universal cancellation and deadlines', () => {
  it('cancels an active request when the caller aborts', async () => {
    const fetcher = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));
    vi.stubGlobal('fetch', fetcher);
    const controller = new AbortController();
    const p = new UniversalProvider(() => ({ ...base, endpoint: 'https://active-cancel.example/v1', auth: { type: 'none' } }), () => 'unused');
    const pending = p.generateText('run', { signal: controller.signal });
    await new Promise(resolve => setImmediate(resolve));
    controller.abort();
    await expect(pending).rejects.toThrow(/cancelled by caller/i);
    expect(p.diagnosticsSnapshot()).toMatchObject({ cancellations: 1, timeouts: 0 });
  });

  it('enforces the total timeout independently of stream inactivity', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));
    vi.stubGlobal('fetch', fetcher);
    const p = new UniversalProvider(() => ({ ...base, endpoint: 'https://total-deadline.example/v1', auth: { type: 'none' } }), () => 'unused');
    const pending = p.generateText('run', { timeoutSeconds: 60, totalTimeoutSeconds: 1 });
    const assertion = expect(pending).rejects.toThrow(/timed out after 1s \(total timeout\)/i);
    await vi.advanceTimersByTimeAsync(1_000);
    await assertion;
    expect(p.diagnosticsSnapshot()).toMatchObject({ cancellations: 0, timeouts: 1 });
  });

  it('re-arms the inactivity timeout after a valid streamed event', async () => {
    vi.useFakeTimers();
    let controller!: AbortSignal;
    const fetcher = vi.fn((_url: string, init: RequestInit) => {
      controller = init.signal as AbortSignal;
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    });
    vi.stubGlobal('fetch', fetcher);
    const p = new UniversalProvider(() => ({ ...base, endpoint: 'https://inactivity.example/v1', auth: { type: 'none' } }), () => 'unused');
    const pending = p.generateText('run', { timeoutSeconds: 5 });
    await vi.advanceTimersByTimeAsync(0);
    expect(controller.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(pending).rejects.toThrow(/timed out after 5s \(inactivity timeout\)/i);
  });
});

describe('universal request budgets and prompt cache', () => {
  it('truncates oversized input to the configured request budget', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] })));
    vi.stubGlobal('fetch', fetcher);
    const p = new UniversalProvider(() => ({
      ...base,
      endpoint: 'https://input-budget.example/v1',
      auth: { type: 'none' },
      requestBudget: { minRequestIntervalMs: 0, maxInputChars: 15_000 },
    }), () => 'unused');
    await p.chatWithTools([
      { role: 'system', content: 'Keep the safety instruction.' },
      { role: 'user', content: `old ${'context '.repeat(4_000)}\n\nFINAL REQUEST keep this` },
    ], []);
    const body = JSON.parse(String(fetcher.mock.calls[0][1].body));
    expect(JSON.stringify(body.messages).length).toBeLessThanOrEqual(15_000);
    expect(JSON.stringify(body.messages)).toContain('FINAL REQUEST keep this');
  });

  it('clamps output tokens to the profile ceiling', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] })));
    vi.stubGlobal('fetch', fetcher);
    const p = new UniversalProvider(() => ({
      ...base,
      endpoint: 'https://output-budget.example/v1',
      auth: { type: 'none' },
      requestBudget: { minRequestIntervalMs: 0, maxOutputTokens: 128 },
    }), () => 'unused');
    await p.generateText('run', { maxOutputTokens: 99_999 });
    expect(JSON.parse(String(fetcher.mock.calls[0][1].body)).max_tokens).toBe(128);
  });

  it('enforces the per-endpoint minimum interval between dispatches', async () => {
    vi.useFakeTimers();
    const times: number[] = [];
    const fetcher = vi.fn(async () => {
      times.push(Date.now());
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }));
    });
    vi.stubGlobal('fetch', fetcher);
    const p = new UniversalProvider(() => ({
      ...base,
      endpoint: 'https://minimum-interval.example/v1',
      auth: { type: 'none' },
      requestBudget: { minRequestIntervalMs: 250 },
    }), () => 'unused');
    const first = p.generateText('first');
    await vi.advanceTimersByTimeAsync(0);
    const second = p.generateText('second');
    await vi.advanceTimersByTimeAsync(249);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await Promise.all([first, second]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(times[1] - times[0]).toBe(250);
  });

  it('allows the configured concurrency while preserving dispatch spacing', async () => {
    vi.useFakeTimers();
    const releases: Array<(response: Response) => void> = [];
    const fetcher = vi.fn(() => new Promise<Response>(resolve => releases.push(resolve)));
    vi.stubGlobal('fetch', fetcher);
    const p = new UniversalProvider(() => ({
      ...base,
      endpoint: 'https://concurrency-budget.example/v1',
      auth: { type: 'none' },
      requestBudget: { minRequestIntervalMs: 50, maxConcurrentRequests: 2 },
    }), () => 'unused');
    const first = p.generateText('first');
    await vi.advanceTimersByTimeAsync(0);
    const second = p.generateText('second');
    await vi.advanceTimersByTimeAsync(50);
    expect(fetcher).toHaveBeenCalledTimes(2);
    releases.forEach(release => release(new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }))));
    await Promise.all([first, second]);
    expect(p.diagnosticsSnapshot()).toMatchObject({ maxConcurrentRequests: 2 });
  });

  it('serves a repeated plain prompt from cache and misses a different prompt', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'cached answer' } }] })));
    vi.stubGlobal('fetch', fetcher);
    const p = new UniversalProvider(() => ({
      ...base,
      endpoint: 'https://prompt-cache-additional.example/v1',
      auth: { type: 'none' },
      promptCache: true,
    }), () => 'unused');
    await expect(p.generateText('same prompt')).resolves.toBe('cached answer');
    await expect(p.generateText('same prompt')).resolves.toBe('cached answer');
    expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(p.generateText('different prompt')).resolves.toBe('cached answer');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(p.diagnosticsSnapshot().deduplicatedRequests).toBe(1);
  });

  it('does not cache tool-bearing requests', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'tool answer' } }] })));
    vi.stubGlobal('fetch', fetcher);
    const p = new UniversalProvider(() => ({
      ...base,
      endpoint: 'https://prompt-cache-tools.example/v1',
      auth: { type: 'none' },
      promptCache: true,
    }), () => 'unused');
    const tools = [{ name: 'lookup', description: 'Lookup', category: 'file' as const, permission: 'read' as const, parameters: { type: 'object' as const, properties: {} } }];
    await p.chatWithTools([{ role: 'user', content: 'same prompt' }], tools);
    await p.chatWithTools([{ role: 'user', content: 'same prompt' }], tools);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
