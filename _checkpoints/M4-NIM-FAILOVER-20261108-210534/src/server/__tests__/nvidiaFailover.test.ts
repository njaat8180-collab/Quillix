import { describe, expect, it } from 'vitest';
import { NimFailoverProvider, type NimFailoverDelegate } from '../nvidiaFailover.js';
import type { NimModelInfo } from '../nimModels.js';

const catalog: NimModelInfo[] = [
  { id: 'nim/model-a', contextLength: 128_000, tools: true, streaming: true, reasoning: true },
  { id: 'nim/model-b', contextLength: 32_000, tools: true, streaming: true },
  { id: 'nim/model-c', contextLength: 32_000, tools: true, streaming: true },
];

/** A delegate whose behaviour is scripted per model, like a flaky provider.
 * It models the real UniversalProvider wiring: the wrapper tells it which model
 * to use through `onModel`, and it reads that back for every attempt. */
function scriptedDelegate(plan: Record<string, string>): { delegate: NimFailoverDelegate; attempts: string[]; sink: (model: string) => void } {
  const attempts: string[] = [];
  let current = 'nim/model-a';
  const sink = (model: string) => { current = model; };
  const delegate = {
    getSelectedModel: () => current,
    capabilities: { tools: true, streaming: true, reasoning: false },
    diagnosticsSnapshot: () => ({ requests: attempts.length }),
    generateText: async (prompt: string) => {
      const model = delegate.getSelectedModel();
      attempts.push(model);
      const outcome = plan[model];
      if (typeof outcome === 'string') throw new Error(outcome);
      return `answer from ${model} for ${prompt.length} chars`;
    },
    generateStream: async (_prompt: string, _options: unknown, onChunk: (chunk: string) => void) => {
      const model = delegate.getSelectedModel();
      attempts.push(model);
      const outcome = plan[model];
      if (typeof outcome === 'string') throw new Error(outcome);
      onChunk(`chunk from ${model}`);
      return `chunk from ${model}`;
    },
    chatWithTools: async (messages: Array<{ content: string }>) => {
      const model = delegate.getSelectedModel();
      attempts.push(model);
      const outcome = plan[model];
      if (typeof outcome === 'string') throw new Error(outcome);
      return { text: `reply from ${model} for ${messages.length}`, toolCalls: [] };
    },
  };
  return { delegate: delegate as unknown as NimFailoverDelegate, attempts, sink };
}

const baseOptions = { models: () => catalog };

describe('NimFailoverProvider', () => {
  it('uses the healthy model without switching', async () => {
    const { delegate, attempts, sink } = scriptedDelegate({});
    const provider = new NimFailoverProvider(delegate, { ...baseOptions, onModel: sink }, 'nim/model-a');
    const text = await provider.generateText('hello');
    expect(text).toContain('nim/model-a');
    expect(attempts).toEqual(['nim/model-a']);
    expect(provider.describeFailover().switches).toEqual([]);
  });

  it('switches to another healthy model after a 503 and finishes the task', async () => {
    const { delegate, attempts, sink } = scriptedDelegate({ 'nim/model-a': 'HTTP 503 Service Unavailable' });
    const provider = new NimFailoverProvider(delegate, { ...baseOptions, onModel: sink }, 'nim/model-a');
    const text = await provider.generateText('write a function');
    expect(text).toContain('nim/model-');
    expect(attempts.length).toBeGreaterThan(1);
    const { switches, active } = provider.describeFailover();
    expect(switches).toHaveLength(1);
    expect(switches[0].from).toBe('nim/model-a');
    expect(active).not.toBe('nim/model-a');
  });

  it('switches after a timeout and after a 429', async () => {
    for (const failure of ['Request timeout after 120s', 'HTTP 429 Too Many Requests']) {
      const { delegate, attempts, sink } = scriptedDelegate({ 'nim/model-a': failure });
      const provider = new NimFailoverProvider(delegate, { ...baseOptions, onModel: sink }, 'nim/model-a');
      await provider.generateText('hello');
      expect(attempts).toHaveLength(2);
      expect(provider.describeFailover().switches[0].reason).toBeTruthy();
    }
  });

  it('does NOT switch for auth, billing or bad-request failures', async () => {
    for (const failure of ['HTTP 401 Unauthorized: invalid api key', 'HTTP 402 Payment Required', 'HTTP 400 Bad Request']) {
      const { delegate, attempts, sink } = scriptedDelegate({ 'nim/model-a': failure });
      const provider = new NimFailoverProvider(delegate, { ...baseOptions, onModel: sink }, 'nim/model-a');
      await expect(provider.generateText('hello')).rejects.toThrow();
      expect(attempts).toEqual(['nim/model-a']);
      expect(provider.describeFailover().switches).toEqual([]);
    }
  });

  it('never re-uses the failing model and stops when everything has failed', async () => {
    const { delegate, attempts, sink } = scriptedDelegate({
      'nim/model-a': 'HTTP 503 Service Unavailable',
      'nim/model-b': 'HTTP 503 Service Unavailable',
      'nim/model-c': 'HTTP 503 Service Unavailable',
    });
    const provider = new NimFailoverProvider(delegate, { ...baseOptions, onModel: sink, maxSwitches: 3 }, 'nim/model-a');
    await expect(provider.generateText('hello')).rejects.toThrow('503');
    expect(new Set(attempts).size).toBe(attempts.length);
    expect(attempts.length).toBeLessThanOrEqual(4);
  });

  it('falls back to the configured model when the catalog is not discovered', async () => {
    const { delegate, attempts, sink } = scriptedDelegate({});
    const provider = new NimFailoverProvider(delegate, { models: () => [], onModel: sink }, 'openai/gpt-oss-120b');
    const text = await provider.generateText('hello');
    expect(text).toContain('openai/gpt-oss-120b');
    expect(attempts).toEqual(['openai/gpt-oss-120b']);
  });

  it('reports model health for the dashboard', async () => {
    const { delegate, sink } = scriptedDelegate({ 'nim/model-a': 'HTTP 429 Too Many Requests' });
    const provider = new NimFailoverProvider(delegate, { ...baseOptions, onModel: sink }, 'nim/model-a');
    await provider.generateText('hello');
    const health = provider.healthSnapshot();
    const failed = health.models.find(model => model.id === 'nim/model-a');
    expect(failed?.failures).toBe(1);
    expect(failed?.rateLimits).toBe(1);
    expect(health.models.some(model => model.successes === 1)).toBe(true);
    expect(health.switches).toHaveLength(1);
  });
});

describe('NimFailoverProvider streaming and task preservation', () => {
  it('fails over before the first token and does not duplicate output', async () => {
    const { delegate, attempts, sink } = scriptedDelegate({ 'nim/model-a': 'HTTP 503 Service Unavailable' });
    const provider = new NimFailoverProvider(delegate, { ...baseOptions, onModel: sink }, 'nim/model-a');
    const chunks: string[] = [];
    const text = await provider.generateStream('hello', {}, chunk => chunks.push(chunk));
    expect(chunks).toEqual(['chunk from nim/model-b']);
    expect(attempts).toEqual(['nim/model-a', 'nim/model-b']);
    expect(text).toContain('nim/model-b');
  });

  it('never duplicates streamed output when a failure happens after tokens', async () => {
    let current = 'nim/model-a';
    const delegate = {
      getSelectedModel: () => current,
      diagnosticsSnapshot: () => ({}),
      generateText: async () => 'unused',
      chatWithTools: async () => ({ text: '', toolCalls: [] }),
      generateStream: async (_p: string, _o: unknown, onChunk: (chunk: string) => void) => {
        onChunk('partial ');
        throw new Error('connection dropped mid-stream');
      },
    } as unknown as NimFailoverDelegate;
    const provider = new NimFailoverProvider(delegate, { ...baseOptions, onModel: (model) => { current = model; } }, 'nim/model-a');
    const chunks: string[] = [];
    await expect(provider.generateStream('hello', {}, chunk => chunks.push(chunk))).rejects.toThrow('mid-stream');
    expect(chunks).toEqual(['partial ']);
    expect(provider.describeFailover().switches).toEqual([]);
  });

  it('preserves the conversation and tool payload across a switch', async () => {
    const seen: Array<{ messages: unknown[]; tools: unknown[] }> = [];
    let current = 'nim/model-a';
    const delegate = {
      getSelectedModel: () => current,
      diagnosticsSnapshot: () => ({}),
      generateText: async () => 'unused',
      generateStream: async () => 'unused',
      chatWithTools: async (messages: unknown[], tools: unknown[]) => {
        const model = delegate.getSelectedModel();
        seen.push({ messages, tools });
        if (model === 'nim/model-a') throw new Error('HTTP 500 Internal Server Error');
        return { text: 'done', toolCalls: [] };
      },
    } as unknown as NimFailoverDelegate;
    const provider = new NimFailoverProvider(delegate, { ...baseOptions, onModel: (model) => { current = model; } }, 'nim/model-a');
    const messages = [{ role: 'user' as const, content: 'add tests' }];
    const tools = [{ name: 'write_file' }];
    const result = await provider.chatWithTools(messages, tools as never, {});
    expect(result.text).toBe('done');
    expect(seen).toHaveLength(2);
    // identical payload on both attempts: the task is preserved, nothing is re-run
    expect(seen[0]).toEqual(seen[1]);
    expect(seen[0].messages).toEqual(messages);
    expect(seen[0].tools).toEqual(tools);
  });

  it('fails over a streamed tool turn before the first token', async () => {
    let current = 'nim/model-a';
    const seen: string[] = [];
    const delegate = {
      getSelectedModel: () => current,
      diagnosticsSnapshot: () => ({}),
      generateText: async () => 'unused',
      generateStream: async () => 'unused',
      chatWithTools: async () => ({ text: '', toolCalls: [] }),
      chatWithToolsStream: async (_m: unknown, _t: unknown, _o: unknown, onToken: (token: string) => void) => {
        const model = delegate.getSelectedModel();
        seen.push(model);
        if (model === 'nim/model-a') throw new Error('HTTP 429 Too Many Requests');
        onToken('tool chunk');
        return { text: `reply from ${model}`, toolCalls: [] };
      },
    } as unknown as NimFailoverDelegate;
    const provider = new NimFailoverProvider(delegate, { ...baseOptions, onModel: (model) => { current = model; } }, 'nim/model-a');
    const tokens: string[] = [];
    const result = await provider.chatWithToolsStream([{ role: 'user', content: 'hi' }], [], {}, token => tokens.push(token));
    expect(seen).toEqual(['nim/model-a', 'nim/model-b']);
    expect(tokens).toEqual(['tool chunk']);
    expect(result.text).toContain('nim/model-b');
  });

  it('exposes diagnostics and the selected model', async () => {
    const { delegate, sink } = scriptedDelegate({});
    const provider = new NimFailoverProvider(delegate, { ...baseOptions, onModel: sink }, 'nim/model-a');
    expect(provider.getSelectedModel()).toBe('nim/model-a');
    const snapshot = provider.diagnosticsSnapshot() as unknown as { requests: number; nim: { active: string } };
    expect(snapshot.nim.active).toBe('nim/model-a');
    expect(provider.capabilities).toMatchObject({ tools: true });
  });
});
