import { afterEach, describe, expect, it, vi } from 'vitest';
import { OllamaQwenProvider } from '../qwen.js';

afterEach(() => vi.restoreAllMocks());

describe('local Ollama stream integrity', () => {
  it('rejects malformed transport JSON before executing any tools', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ models: [{ name: 'qwen2.5-coder:3b' }] })))
      .mockResolvedValueOnce(new Response('{invalid}\n'));
    const provider = new OllamaQwenProvider();
    await expect(provider.chatWithToolsStream([{ role: 'user', content: 'Build a website' }], [], {}, () => {}))
      .rejects.toThrow(/malformed streaming JSON/);
  });

  it('accepts valid streamed output and reports complete tool arguments', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ models: [{ name: 'qwen2.5-coder:3b' }] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: { content: '', tool_calls: [{ function: { name: 'write_file', arguments: { filePath: 'main.js', content: 'console.log(42)' } } }] }, prompt_eval_count: 31, eval_count: 17, done: true }) + '\n'));
    const provider = new OllamaQwenProvider();
    const result = await provider.chatWithToolsStream([{ role: 'user', content: 'Write a script' }], [], {}, () => {});
    expect(result.toolCalls?.[0].args.filePath).toBe('main.js');
    expect(result.usage).toEqual({ inputTokens: 31, outputTokens: 17 });
  });

  it('stops reading after a complete required tool call', async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(
          JSON.stringify({ message: { tool_calls: [{ function: { name: 'write_file', arguments: { filePath: 'main.js', content: 'ok' } } }] }, done: false }) + '\n' +
          JSON.stringify({ message: { content: 'trailing explanation that should not be consumed' }, done: true }) + '\n',
        ));
        controller.close();
      },
    });
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ models: [{ name: 'qwen2.5-coder:3b' }] })))
      .mockResolvedValueOnce(new Response(body));
    const tokens: string[] = [];
    const provider = new OllamaQwenProvider();
    const result = await provider.chatWithToolsStream(
      [{ role: 'user', content: 'Write a script' }],
      [],
      { requiredToolName: 'write_file' },
      token => tokens.push(token),
    );
    expect(result.toolCalls?.[0].args.filePath).toBe('main.js');
    expect(tokens.join('')).not.toContain('trailing explanation');
  });

  it('enforces a separate total deadline while chunks keep arriving slowly', async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const timer = setInterval(() => {
          controller.enqueue(encoder.encode(JSON.stringify({ message: { content: 'x' }, done: false }) + '\n'));
        }, 10);
        setTimeout(() => {
          clearInterval(timer);
          controller.error(new DOMException('The operation was aborted.', 'AbortError'));
        }, 500);
      },
    });
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ models: [{ name: 'qwen2.5-coder:3b' }] })))
      .mockResolvedValueOnce(new Response(body));
    const provider = new OllamaQwenProvider();
    await expect(provider.chatWithToolsStream(
      [{ role: 'user', content: 'Write a large file' }],
      [],
      { timeoutSeconds: 1, totalTimeoutSeconds: 0.05 },
      () => {},
    )).rejects.toThrow(/total generation time/);
  });

  it('uses the bounded Qwen coding profile without requiring a fine-tune', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ models: [{ name: 'qwen2.5-coder:3b' }] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: { content: 'done' }, done: true }) + '\n'));
    const provider = new OllamaQwenProvider();
    await provider.chatWithToolsStream(
      [{ role: 'user', content: 'Improve this function' }],
      [],
      { model: 'qwen2.5-coder:3b', contextWindow: 6144, maxOutputTokens: 2560, temperature: 0.15 },
      () => {},
    );
    const request = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(request.keep_alive).toBe('10m');
    expect(request.options).toMatchObject({
      num_ctx: 6144,
      num_predict: 2560,
      top_p: 0.9,
      top_k: 40,
      min_p: 0.05,
      repeat_penalty: 1.05,
      temperature: 0.15,
    });
  });

  it('selects only an installed local coding fallback after a timeout', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ models: [
        { name: 'qwen3:4b' },
        { name: 'qwen2.5-coder:3b' },
      ] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ models: [
        { name: 'qwen3:4b' },
        { name: 'qwen2.5-coder:3b' },
      ] })));
    const provider = new OllamaQwenProvider({ model: 'qwen3:4b' });
    await expect(provider.getFallbackModel('qwen3:4b', new Error('Ollama request timed out')))
      .resolves.toBe('qwen2.5-coder:3b');
    await expect(provider.getFallbackModel('qwen3:4b', new Error('invalid tool arguments')))
      .resolves.toBeUndefined();
  });

  it('falls back from an installed non-tool Ollama model to an installed coding brain', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ models: [
        { name: 'qwen:1.8b' },
        { name: 'qwen2.5-coder:3b' },
      ] })));
    const provider = new OllamaQwenProvider({ model: 'qwen:1.8b' });
    await expect(provider.getFallbackModel('qwen:1.8b', new Error('qwen:1.8b does not support tools')))
      .resolves.toBe('qwen2.5-coder:3b');
  });

  it('best-effort unloads the previous local brain before fallback switching', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ done: true })));
    const provider = new OllamaQwenProvider({ model: 'qwen3:4b' });
    await provider.releaseModel('qwen3:4b');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(request).toMatchObject({ model: 'qwen3:4b', keep_alive: 0, stream: false });
  });

  it('can use the installed 1.5B brain as a final bounded repair fallback after 3B timeout', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ models: [
        { name: 'qwen2.5-coder:3b' },
        { name: 'qwen2.5-coder:1.5b' },
      ] })));
    const provider = new OllamaQwenProvider({ model: 'qwen2.5-coder:3b' });
    await expect(provider.getFallbackModel('qwen2.5-coder:3b', new Error('validation repair timed out')))
      .resolves.toBe('qwen2.5-coder:1.5b');
  });

  it('prefers an installed stronger local 4B brain before the tiny fallback', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ models: [
        { name: 'qwen2.5-coder:3b' },
        { name: 'qwen3:4b' },
        { name: 'qwen2.5-coder:1.5b' },
      ] })));
    const provider = new OllamaQwenProvider({ model: 'qwen2.5-coder:3b' });
    await expect(provider.getFallbackModel('qwen2.5-coder:3b', new Error('validation repair timed out')))
      .resolves.toBe('qwen3:4b');
  });

  it('honors an installed fallback override for latency-sensitive offline repair', async () => {
    const previous = process.env.QUILLIX_OLLAMA_FALLBACK_MODEL;
    process.env.QUILLIX_OLLAMA_FALLBACK_MODEL = 'qwen2.5-coder:1.5b';
    try {
      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(new Response(JSON.stringify({ models: [
          { name: 'qwen2.5-coder:3b' },
          { name: 'qwen3:4b' },
          { name: 'qwen2.5-coder:1.5b' },
        ] })));
      const provider = new OllamaQwenProvider({ model: 'qwen2.5-coder:3b' });
      await expect(provider.getFallbackModel('qwen2.5-coder:3b', new Error('validation repair quality escalation')))
        .resolves.toBe('qwen2.5-coder:1.5b');
    } finally {
      if (previous === undefined) delete process.env.QUILLIX_OLLAMA_FALLBACK_MODEL;
      else process.env.QUILLIX_OLLAMA_FALLBACK_MODEL = previous;
    }
  });

  it('permits one installed stronger brain after a bounded validation quality failure', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ models: [
        { name: 'qwen2.5-coder:3b' },
        { name: 'qwen3:4b' },
      ] })));
    const provider = new OllamaQwenProvider({ model: 'qwen2.5-coder:3b' });
    await expect(provider.getFallbackModel('qwen2.5-coder:3b', new Error('validation repair quality escalation')))
      .resolves.toBe('qwen3:4b');
  });

  it('retries a bounded warm-up after a cold-load timeout', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ models: [{ name: 'qwen2.5-coder:3b' }] })))
      .mockRejectedValueOnce(Object.assign(new Error('abort'), { name: 'AbortError' }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: { content: 'OK' }, done: true })));
    const provider = new OllamaQwenProvider();
    await provider.warmUp('qwen2.5-coder:3b', { timeoutSeconds: 5, retries: 1, backoffMs: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const warmupRequest = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(warmupRequest.options).toEqual({ num_ctx: 2048, num_predict: 1, temperature: 0 });
  });

  it('cancels warm-up backoff instead of starting another model request', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ models: [{ name: 'qwen2.5-coder:3b' }] })))
      .mockRejectedValueOnce(Object.assign(new Error('abort'), { name: 'AbortError' }));
    const controller = new AbortController();
    const provider = new OllamaQwenProvider();
    const pending = provider.warmUp('qwen2.5-coder:3b', { timeoutSeconds: 5, retries: 1, backoffMs: 1000, signal: controller.signal });
    setTimeout(() => controller.abort(), 10);
    await expect(pending).rejects.toThrow(/cancelled/);
  });
});
