import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AIProvider } from '../qwen.js';
import { ProviderModelFailover } from '../providerModelFailover.js';
import { discoverProviderModels } from '../providerModelCatalog.js';

const config = { protocol: 'openai' as const, endpoint: 'https://api.example.test/v1', model: 'model-a', offlineMode: false, auth: { type: 'bearer' as const } };
const originalFetch = globalThis.fetch;

function fixture(overrides: Partial<AIProvider> = {}, endpoint = config.endpoint) {
  const attempts: string[] = [];
  const attemptOptions: Array<{ failover?: boolean; cooldownBypass?: boolean }> = [];
  const delegate: AIProvider = {
    getSelectedModel: model => model || config.model,
    generateText: async (_prompt, options) => {
      attempts.push(options?.model || '');
      attemptOptions.push({ failover: options?.providerModelFailover, cooldownBypass: options?.providerModelFailoverCooldownBypass });
      if (options?.model === 'model-a') throw new Error('HTTP 429 Too Many Requests');
      return 'alternate answer';
    },
    generateStream: async (_prompt, options, onChunk) => {
      attempts.push(options?.model || '');
      onChunk('partial answer');
      throw new Error('HTTP 503 Service Unavailable');
    },
    chatWithTools: async (_messages, _tools, options) => {
      attempts.push(options?.model || '');
      return { text: 'ok', toolCalls: [{ id: '1', name: 'run', args: {} }] };
    },
    chatWithToolsStream: async (_messages, _tools, options, onToken) => {
      attempts.push(options?.model || '');
      onToken('partial');
      throw new Error('HTTP 429 Too Many Requests');
    },
    ...overrides,
  };
  const provider = new ProviderModelFailover(delegate, { config: () => ({ ...config, endpoint }), credential: () => 'secret' });
  return { provider, attempts, attemptOptions };
}

function catalogFetch(endpoint = config.endpoint) {
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    if (String(input) !== `${endpoint}/models`) throw new Error('unexpected endpoint');
    return new Response(JSON.stringify({ data: [
      { id: 'model-a', supports_tools: true, supports_streaming: true },
      { id: 'model-no-stream', supports_tools: true, supports_streaming: false },
      { id: 'model-no-tools', supports_tools: false, supports_streaming: true },
      { id: 'model-b', supports_tools: true, supports_streaming: true, context_length: 128000 },
    ] }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  globalThis.fetch = fetch as typeof fetch;
  return fetch;
}

afterEach(() => { globalThis.fetch = originalFetch; });

describe('ProviderModelFailover', () => {
  it('retries a rate-limited request on a model from the same endpoint', async () => {
    const fetch = catalogFetch();
    const { provider, attempts, attemptOptions } = fixture();
    const switched = vi.fn();
    const answer = await provider.generateText('hello', { onProviderModelSwitch: switched });
    expect(answer).toBe('alternate answer');
    expect(attempts).toEqual(['model-a', 'model-no-stream']);
    expect(attemptOptions).toEqual([
      { failover: true, cooldownBypass: false },
      { failover: true, cooldownBypass: true },
    ]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(switched).toHaveBeenCalledWith(expect.objectContaining({ from: 'model-a', to: 'model-no-stream' }));
  });

  it('uses the fresh Settings catalog for failover when the endpoint starts rate-limiting', async () => {
    const endpoint = 'https://prewarmed-catalog.example.test/v1';
    catalogFetch(endpoint);
    await discoverProviderModels({ ...config, endpoint }, 'secret', { forceRefresh: true });
    const noAdditionalCatalogRequest = vi.fn(async () => { throw new Error('model discovery should use its warm cache'); });
    globalThis.fetch = noAdditionalCatalogRequest as typeof fetch;
    const { provider, attempts } = fixture({}, endpoint);
    await expect(provider.generateText('hello')).resolves.toBe('alternate answer');
    expect(attempts).toEqual(['model-a', 'model-no-stream']);
    expect(noAdditionalCatalogRequest).not.toHaveBeenCalled();
  });

  it('does not replay a stream after output has reached the caller', async () => {
    const fetch = catalogFetch();
    const { provider, attempts } = fixture();
    const chunks: string[] = [];
    await expect(provider.generateStream('hello', {}, chunk => chunks.push(chunk))).rejects.toThrow('503');
    expect(chunks).toEqual(['partial answer']);
    expect(attempts).toEqual(['model-a']);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('retries a stream on a streaming-capable model when failure happens before any chunk', async () => {
    const endpoint = 'https://stream-compatible.example.test/v1';
    catalogFetch(endpoint);
    const attempts: string[] = [];
    const { provider } = fixture({
      generateStream: async (_prompt, options, onChunk) => {
        const model = options.model || '';
        attempts.push(model);
        if (model === 'model-a') throw new Error('HTTP 429 Too Many Requests');
        onChunk(`answer from ${model}`);
        return `answer from ${model}`;
      },
    }, endpoint);
    const chunks: string[] = [];
    const answer = await provider.generateStream('hello', {}, chunk => chunks.push(chunk));
    expect(attempts).toEqual(['model-a', 'model-no-tools']);
    expect(answer).toBe('answer from model-no-tools');
    expect(chunks).toEqual(['answer from model-no-tools']);
  });

  it('does not replay a streamed tool turn after user-visible text', async () => {
    const fetch = catalogFetch();
    const { provider, attempts } = fixture();
    const tokens: string[] = [];
    await expect(provider.chatWithToolsStream([], [], {}, token => tokens.push(token))).rejects.toThrow('429');
    expect(tokens).toEqual(['partial']);
    expect(attempts).toEqual(['model-a']);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('chooses only models compatible with both tools and streaming', async () => {
    const endpoint = 'https://compatible.example.test/v1';
    catalogFetch(endpoint);
    const attempts: string[] = [];
    const { provider } = fixture({
      chatWithToolsStream: async (_messages, _tools, options) => {
        const model = options.model || '';
        attempts.push(model);
        if (model === 'model-a') throw new Error('HTTP 503 Service Unavailable');
        return { text: '', toolCalls: [{ id: 'call-1', name: 'run', args: {} }] };
      },
    }, endpoint);
    const result = await provider.chatWithToolsStream([], [], {}, () => {});
    expect(attempts).toEqual(['model-a', 'model-b']);
    expect(result.toolCalls?.[0]?.name).toBe('run');
  });

  it('includes tool schema and system instructions when filtering by model context size', async () => {
    const endpoint = 'https://context-compatible.example.test/v1';
    const fetch = vi.fn(async () => new Response(JSON.stringify({ data: [
      { id: 'model-a', supports_tools: true, supports_streaming: true },
      { id: 'model-small-context', supports_tools: true, supports_streaming: true, context_length: 2048 },
      { id: 'model-with-room', supports_tools: true, supports_streaming: true, context_length: 4096 },
      { id: 'model-no-tools', supports_tools: false, supports_streaming: true, context_length: 8192 },
    ] }), { status: 200 }));
    globalThis.fetch = fetch as typeof fetch;
    const attempts: string[] = [];
    const { provider } = fixture({
      chatWithTools: async (_messages, _tools, options) => {
        attempts.push(options?.model || '');
        if (options?.model === 'model-a') throw new Error('HTTP 400: context length exceeded for model');
        return { text: 'ok', toolCalls: [{ id: 'call-1', name: 'run', args: {} }] };
      },
    }, endpoint);
    const tools = [{ name: 'run', category: 'code' as const, permission: 'read' as const, description: 'large tool schema '.repeat(300), parameters: { type: 'object' as const, properties: { value: { type: 'string', description: 'value' } } } }];
    await provider.chatWithTools([{ role: 'user', content: 'do it' }], tools, { systemInstruction: 'protected system instructions '.repeat(100), maxOutputTokens: 128 });
    expect(attempts).toEqual(['model-a', 'model-with-room']);
  });
});
