import { afterEach, describe, expect, it, vi } from 'vitest';
import { OllamaQwenProvider } from '../qwen.js';

const model = 'qwen2.5-coder:3b';

function tagsResponse(models: string[] = [model]): Response {
  return new Response(JSON.stringify({ models: models.map(name => ({ name })) }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function streamResponse(lines: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(line));
      controller.close();
    },
  });
  return new Response(body, { status: 200 });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('OllamaQwenProvider public behavior', () => {
  it('reports the configured model and provider capabilities', () => {
    const provider = new OllamaQwenProvider({ model, offlineMode: true });
    expect(provider.getSelectedModel()).toBe(model);
    expect(provider.getSelectedModel('qwen3:4b')).toBe('qwen3:4b');
    expect(provider.capabilities).toEqual({ tools: true, streaming: true, reasoning: false });
    expect(provider.supportsToolJsonSchema).toBe(false);
    expect(provider.supportsToolJsonSchemaForModel('qwen3:4b')).toBe(true);
    expect(provider.supportsToolJsonSchemaForModel('qwen2.5-coder:3b')).toBe(false);
  });

  it('generates text and sends the expected chat request', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(tagsResponse())
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: { content: 'Hello' } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const provider = new OllamaQwenProvider({ model, offlineMode: true });
    await expect(provider.generateText('Hi', { systemInstruction: 'Be brief', temperature: 0.2, maxOutputTokens: 64 }))
      .resolves.toBe('Hello');
    const request = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(request).toMatchObject({
      model,
      stream: false,
      messages: [{ role: 'system', content: 'Be brief' }, { role: 'user', content: 'Hi' }],
      options: { temperature: 0.2, num_predict: 64 },
    });
  });

  it('reports a missing Ollama connection without attempting a chat request', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    vi.stubGlobal('fetch', fetchMock);
    const provider = new OllamaQwenProvider({ model, offlineMode: true });
    await expect(provider.generateText('Hi')).rejects.toThrow('NUVRO AI cannot connect to Ollama');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('maps an Ollama HTTP error body to its error message', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(tagsResponse())
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'model is busy' }), { status: 503 })));
    const provider = new OllamaQwenProvider({ model, offlineMode: true });
    await expect(provider.generateText('Hi')).rejects.toThrow('model is busy');
  });

  it('rejects invalid JSON returned by Ollama', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(tagsResponse())
      .mockResolvedValueOnce(new Response('{not-json}', { status: 200 })));
    const provider = new OllamaQwenProvider({ model, offlineMode: true });
    await expect(provider.generateText('Hi')).rejects.toThrow(/invalid response \(HTTP 200\)/);
  });

  it('returns text without tool calls when Ollama does not request tools', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(tagsResponse())
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: { content: 'No tools needed' } }), { status: 200 })));
    const provider = new OllamaQwenProvider({ model, offlineMode: true });
    const result = await provider.chatWithTools([{ role: 'user', content: 'Hello' }], []);
    expect(result.text).toBe('No tools needed');
    expect(result.toolCalls).toBeUndefined();
  });

  it('parses object and JSON string tool arguments', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(tagsResponse())
      .mockResolvedValueOnce(new Response(JSON.stringify({
        message: {
          content: '',
          tool_calls: [
            { function: { name: 'write_file', arguments: { filePath: 'a.js', content: 'ok' } } },
            { function: { name: 'read_file', arguments: '{"filePath":"b.js"}' } },
          ],
        },
      }), { status: 200 })));
    const provider = new OllamaQwenProvider({ model, offlineMode: true });
    const result = await provider.chatWithTools([{ role: 'user', content: 'Edit' }], []);
    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls?.[0].args).toEqual({ filePath: 'a.js', content: 'ok' });
    expect(result.toolCalls?.[1].args).toEqual({ filePath: 'b.js' });
  });

  it('uses empty arguments when a non-streaming tool call has malformed JSON', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(tagsResponse())
      .mockResolvedValueOnce(new Response(JSON.stringify({
        message: { tool_calls: [{ function: { name: 'write_file', arguments: '{broken' } }] },
      }), { status: 200 })));
    const provider = new OllamaQwenProvider({ model, offlineMode: true });
    const result = await provider.chatWithTools([{ role: 'user', content: 'Edit' }], []);
    expect(result.toolCalls?.[0].args).toEqual({});
  });

  it('streams generated text through the callback', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(tagsResponse())
      .mockResolvedValueOnce(streamResponse([
        `${JSON.stringify({ message: { content: 'Hel' } })}\n`,
        `${JSON.stringify({ response: 'lo' })}\n`,
      ])));
    const provider = new OllamaQwenProvider({ model, offlineMode: true });
    const chunks: string[] = [];
    await expect(provider.generateStream('Hi', {}, chunk => chunks.push(chunk))).resolves.toBe('Hello');
    expect(chunks).toEqual(['Hel', 'lo']);
  });

  it('accumulates streaming tool-call fragments and reports usage', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(tagsResponse())
      .mockResolvedValueOnce(streamResponse([
        `${JSON.stringify({ message: { tool_calls: [{ function: { name: 'write_file', arguments: '{"filePath":' } }] } })}\n`,
        `${JSON.stringify({ message: { tool_calls: [{ function: { name: 'write_file', arguments: '"main.js"}' } }] }, prompt_eval_count: 4, eval_count: 2 })}\n`,
      ])));
    const provider = new OllamaQwenProvider({ model, offlineMode: true });
    const tokens: string[] = [];
    const result = await provider.chatWithToolsStream(
      [{ role: 'user', content: 'Write a file' }],
      [],
      {},
      token => tokens.push(token),
    );
    expect(tokens).toEqual([]);
    expect(result.toolCalls?.[0].name).toBe('write_file');
    expect(result.toolCalls?.[0].args).toEqual({ filePath: 'main.js' });
    expect(result.usage).toEqual({ inputTokens: 4, outputTokens: 2 });
  });

  it('ignores malformed unnamed streaming tool fragments', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(tagsResponse())
      .mockResolvedValueOnce(streamResponse([
        `${JSON.stringify({ message: { tool_calls: [{ function: { name: '', arguments: '{}' } }] } })}\n`,
      ])));
    const provider = new OllamaQwenProvider({ model, offlineMode: true });
    const result = await provider.chatWithToolsStream([{ role: 'user', content: 'Write' }], [], {}, () => {});
    expect(result.toolCalls).toBeUndefined();
  });

  it('selects the installed 3B coder as fallback from the 1.5B coder', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(tagsResponse(['qwen2.5-coder:1.5b', 'qwen2.5-coder:3b'])));
    const provider = new OllamaQwenProvider({ model: 'qwen2.5-coder:1.5b', offlineMode: true });
    await expect(provider.getFallbackModel('qwen2.5-coder:1.5b', new Error('network unavailable')))
      .resolves.toBe('qwen2.5-coder:3b');
  });

  it('does not use a configured larger fallback while resources are constrained', async () => {
    const previous = process.env.QUILLIX_OLLAMA_FALLBACK_MODEL;
    process.env.QUILLIX_OLLAMA_FALLBACK_MODEL = 'qwen3:4b';
    try {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(tagsResponse(['qwen2.5-coder:1.5b', 'qwen3:4b'])));
      const provider = new OllamaQwenProvider({ model: 'qwen2.5-coder:1.5b', offlineMode: true });
      await expect(provider.getFallbackModel('qwen2.5-coder:1.5b', new Error('resource guard: RAM 95%')))
        .resolves.toBeUndefined();
    } finally {
      if (previous === undefined) delete process.env.QUILLIX_OLLAMA_FALLBACK_MODEL;
      else process.env.QUILLIX_OLLAMA_FALLBACK_MODEL = previous;
    }
  });
});
