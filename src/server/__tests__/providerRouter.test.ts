import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ProviderRouter } from '../sarvam.js';
import { SettingsStore, DEFAULT_SETTINGS } from '../settings.js';
import { ResourceGuard } from '../resourceGuard.js';
import type { AIProvider } from '../qwen.js';

const fakeOllama = {} as AIProvider;
const temporary: string[] = [];
const temporaryRoot = path.join(process.cwd(), '.quillix-smoke', 'provider-router-tests');

function createTemporaryDirectory(prefix: string): string {
  fs.mkdirSync(temporaryRoot, { recursive: true });
  const directory = fs.mkdtempSync(path.join(temporaryRoot, prefix));
  temporary.push(directory);
  return directory;
}

afterEach(() => {
  vi.useRealTimers();
  for (const directory of temporary.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe('ProviderRouter brain capability propagation', () => {
  it('uses a consistent 4-second default for cloud requests and no pacing for Ollama', () => {
    const directory = createTemporaryDirectory('quillix-router-default-pacing-');
    const settings = new SettingsStore(path.join(directory, 'settings.json'));
    settings.update({ ...DEFAULT_SETTINGS, aiProvider: 'openai', offlineMode: false });
    const router = new ProviderRouter(fakeOllama, settings);
    expect(router.rateLimitStatus()).toMatchObject({ providerId: 'openai', offline: false, minIntervalMs: 4000 });
    settings.update({ ...DEFAULT_SETTINGS, aiProvider: 'ollama', offlineMode: true });
    expect(router.rateLimitStatus()).toMatchObject({ providerId: 'ollama', offline: true, minIntervalMs: 0 });
  });

  it('publishes the built-in brain catalog with explicit offline/online capabilities', () => {
    const directory = createTemporaryDirectory('quillix-router-catalog-');
    const settings = new SettingsStore(path.join(directory, 'settings.json'));
    const router = new ProviderRouter(fakeOllama, settings);
    const catalog = router.brainCatalog();
    expect(catalog.map(brain => brain.id)).toEqual(['ollama', 'sarvam', 'openai', 'grok', 'groq', 'nvidia', 'universal']);
    expect(catalog.find(brain => brain.id === 'ollama')).toMatchObject({ mode: 'offline', capabilities: { tools: true, streaming: true } });
    expect(catalog.find(brain => brain.id === 'openai')).toMatchObject({ mode: 'online', capabilities: { tools: true, streaming: true, reasoning: true } });
  });

  it('rejects an online brain before its provider factory can make a request in Offline Mode', async () => {
    const directory = createTemporaryDirectory('quillix-router-offline-');
    const settings = new SettingsStore(path.join(directory, 'settings.json'));
    settings.update({ ...DEFAULT_SETTINGS, aiProvider: 'openai', offlineMode: true });
    const router = new ProviderRouter(fakeOllama, settings);
    await expect(router.generateText('must not leave the machine')).rejects.toThrow(/Disable Offline Mode/);
  });

  it('exposes the selected Universal profile capabilities to the body and catalog', () => {
    const directory = createTemporaryDirectory('quillix-router-');
    const settings = new SettingsStore(path.join(directory, 'settings.json'));
    settings.update({
      ...DEFAULT_SETTINGS,
      aiProvider: 'universal',
      offlineMode: false,
      activeProviderProfile: 'local-no-tools',
      providerProfiles: [{
        id: 'local-no-tools',
        name: 'Local compatible endpoint',
        protocol: 'openai',
        endpoint: 'http://127.0.0.1:12345/v1',
        model: 'test-model',
        capabilities: { tools: false, streaming: false, reasoning: false },
      }],
    });
    const router = new ProviderRouter(fakeOllama, settings);
    expect(router.capabilities).toEqual({ tools: false, streaming: false, reasoning: false });
    expect(router.brainCatalog().find((brain) => brain.id === 'universal')?.capabilities)
      .toEqual({ tools: false, streaming: false, reasoning: false });
  });

  it('forwards optional local-brain release capability through the router', async () => {
    const directory = createTemporaryDirectory('quillix-router-release-');
    const released: string[] = [];
    const localBrain = { releaseModel: async (model?: string) => { if (model) released.push(model); } } as AIProvider;
    const settings = new SettingsStore(path.join(directory, 'settings.json'));
    settings.update({ ...DEFAULT_SETTINGS, aiProvider: 'ollama', offlineMode: true });
    await new ProviderRouter(localBrain, settings).releaseModel('qwen3:4b');
    expect(released).toEqual(['qwen3:4b']);
  });

  it('forwards optional fallback-brain warm-up without requiring online providers to implement it', async () => {
    const directory = createTemporaryDirectory('quillix-router-warmup-');
    const warmed: string[] = [];
    const localBrain = { warmUp: async (model?: string) => { if (model) warmed.push(model); } } as AIProvider;
    const settings = new SettingsStore(path.join(directory, 'settings.json'));
    settings.update({ ...DEFAULT_SETTINGS, aiProvider: 'ollama', offlineMode: true });
    await new ProviderRouter(localBrain, settings).warmUp('qwen3:4b', { retries: 0 });
    expect(warmed).toEqual(['qwen3:4b']);
  });

  it('exposes hot-pluggable brain registration through the body-facing router API', () => {
    const directory = createTemporaryDirectory('quillix-router-plugin-');
    const settings = new SettingsStore(path.join(directory, 'settings.json'));
    const router = new ProviderRouter(fakeOllama, settings);
    const dispose = router.registerBrain({
      id: 'plugin-brain', label: 'Plugin Brain', mode: 'offline',
      capabilities: { tools: true, streaming: true, reasoning: false }, create: () => fakeOllama,
    });
    expect(router.brainCatalog().some(brain => brain.id === 'plugin-brain')).toBe(true);
    settings.update({ ...DEFAULT_SETTINGS, aiProvider: 'plugin-brain', offlineMode: true });
    expect(dispose()).toBe(false);
    expect(router.brainCatalog().some(brain => brain.id === 'plugin-brain')).toBe(true);
    settings.update({ ...DEFAULT_SETTINGS, aiProvider: 'ollama', offlineMode: true });
    expect(dispose()).toBe(true);
    expect(router.brainCatalog().some(brain => brain.id === 'plugin-brain')).toBe(false);
  });

  it('falls back to the local Ollama brain on a cloud rate limit without forwarding the cloud model', async () => {
    const directory = createTemporaryDirectory('quillix-router-rate-fallback-');
    const calls: Array<{ model?: string; prompt?: string }> = [];
    const local = {
      capabilities: { tools: true, streaming: true, reasoning: false },
      async warmUp() {},
      async generateText(prompt: string, options?: any) { calls.push({ prompt, model: options?.model }); return 'local result'; },
      async chatWithToolsStream(_messages: any, _tools: any, options: any, onChunk: (chunk: string) => void) { calls.push({ model: options?.model }); onChunk('local stream'); return { text: 'local stream', toolCalls: [] }; },
    } as unknown as AIProvider;
    const settings = new SettingsStore(path.join(directory, 'settings.json'));
    settings.update({ ...DEFAULT_SETTINGS, aiProvider: 'rate-limited', model: 'qwen2.5-coder:3b', offlineMode: false });
    const router = new ProviderRouter(local, settings);
    router.registerBrain({ id: 'rate-limited', label: 'Rate limited test brain', mode: 'online', capabilities: { tools: true, streaming: true, reasoning: false }, create: () => ({
      async generateText() { throw new Error('HTTP 429: rate limit persisted'); },
      async generateStream() { throw new Error('HTTP 429: rate limit persisted'); },
      async chatWithTools() { throw new Error('HTTP 429: rate limit persisted'); },
      async chatWithToolsStream() { throw new Error('HTTP 429: rate limit persisted'); },
    } as AIProvider) });
    expect(await router.generateText('build a file', { model: 'cloud-model' })).toBe('local result');
    const chunks: string[] = [];
    const streamed = await router.chatWithToolsStream([{ role: 'user', content: 'build a file' }], [], { model: 'cloud-model' }, chunk => chunks.push(chunk));
    expect(streamed.text).toBe('local stream');
    expect(streamed.providerFallback).toEqual({ from: 'rate-limited', to: 'ollama', reason: 'rate_limit' });
    expect(chunks).toEqual(['local stream']);
    expect(calls).toEqual([
      { prompt: 'build a file', model: 'qwen2.5-coder:3b' },
      { model: 'qwen2.5-coder:3b' },
    ]);
  });

  it('keeps a provider Retry-After cooldown across turns and exposes it in rate-limit status', async () => {
    vi.useFakeTimers();
    const previousInterval = process.env.QUILLIX_ONLINE_MIN_INTERVAL_MS;
    process.env.QUILLIX_ONLINE_MIN_INTERVAL_MS = '0';
    try {
      const directory = createTemporaryDirectory('quillix-router-cooldown-');
      const localCalls: string[] = [];
      const local = {
        async warmUp() {},
        async generateText(prompt: string) { localCalls.push(prompt); return 'local fallback'; },
      } as unknown as AIProvider;
      const settings = new SettingsStore(path.join(directory, 'settings.json'));
      settings.update({ ...DEFAULT_SETTINGS, aiProvider: 'retry-after-test', model: 'qwen2.5-coder:1.5b', offlineMode: false });
      const router = new ProviderRouter(local, settings, () => directory,
        () => new ResourceGuard({ maxCpuPercent: 100 }));
      let onlineCalls = 0;
      router.registerBrain({
        id: 'retry-after-test', label: 'Retry-After test', mode: 'online',
        capabilities: { tools: true, streaming: true, reasoning: false },
        create: () => ({
          async generateText() {
            onlineCalls++;
            if (onlineCalls === 1) throw Object.assign(new Error('HTTP 429: rate limit'), { status: 429, retryAfterMs: 30_000 });
            return 'cloud recovered';
          },
        } as unknown as AIProvider),
      });

      await expect(router.generateText('first request')).resolves.toBe('local fallback');
      expect(localCalls).toEqual(['first request']);
      expect(router.rateLimitStatus()).toMatchObject({ cooldownUntil: Date.now() + 30_000, waitingMs: 30_000 });

      const nextTurn = router.generateText('next turn');
      await vi.advanceTimersByTimeAsync(0);
      expect(onlineCalls).toBe(1);
      expect(router.rateLimitStatus().queuedRequests).toBe(1);
      await vi.advanceTimersByTimeAsync(29_999);
      expect(onlineCalls).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      await expect(nextTurn).resolves.toBe('cloud recovered');
      expect(onlineCalls).toBe(2);
      expect(router.rateLimitStatus().cooldownUntil).toBeNull();
    } finally {
      if (previousInterval === undefined) delete process.env.QUILLIX_ONLINE_MIN_INTERVAL_MS;
      else process.env.QUILLIX_ONLINE_MIN_INTERVAL_MS = previousInterval;
    }
  });

  it('gates an explicit Ollama warm-up before loading a model', async () => {
    const directory = createTemporaryDirectory('quillix-router-warmup-guard-');
    const warmUp = vi.fn(async () => undefined);
    const settings = new SettingsStore(path.join(directory, 'settings.json'));
    settings.update({...DEFAULT_SETTINGS, aiProvider: 'ollama', offlineMode: true});
    const router = new ProviderRouter({warmUp} as unknown as AIProvider, settings, () => directory,
      () => new ResourceGuard({maxCpuPercent: -1}));

    await expect(router.warmUp('qwen2.5-coder:3b')).rejects.toThrow(/Resource guard prevented Ollama warm-up.*CPU/i);
    expect(warmUp).not.toHaveBeenCalled();
  });

  it('serializes online requests and applies the configured pacing interval', async () => {
    const previousInterval = process.env.QUILLIX_ONLINE_MIN_INTERVAL_MS;
    process.env.QUILLIX_ONLINE_MIN_INTERVAL_MS = '15';
    try {
      const directory = createTemporaryDirectory('quillix-router-pacing-');
      const started: number[] = [];
      let maximumObservedQueueDepth = 0;
      const settings = new SettingsStore(path.join(directory, 'settings.json'));
      settings.update({ ...DEFAULT_SETTINGS, aiProvider: 'paced-test', offlineMode: false });
      const router = new ProviderRouter(fakeOllama, settings);
      router.registerBrain({ id: 'paced-test', label: 'Paced test brain', mode: 'online', capabilities: { tools: true, streaming: true, reasoning: false }, create: () => ({
        async generateText() {
          started.push(Date.now());
          await new Promise(resolve => setTimeout(resolve, 5));
          maximumObservedQueueDepth = Math.max(maximumObservedQueueDepth, router.rateLimitStatus().queuedRequests);
          return 'ok';
        },
        async generateStream() { return 'ok'; },
        async chatWithTools() { return { text: 'ok', toolCalls: [] }; },
        async chatWithToolsStream() { started.push(Date.now()); return { text: 'ok', toolCalls: [] }; },
      } as AIProvider) });
      await Promise.all(Array.from({ length: 8 }, (_, index) => router.generateText(`request-${index + 1}`)));
      expect(started).toHaveLength(8);
      expect(maximumObservedQueueDepth).toBe(8);
      for (let index = 1; index < started.length; index++) {
        expect(started[index] - started[index - 1]).toBeGreaterThanOrEqual(12);
      }
    } finally {
      if (previousInterval === undefined) delete process.env.QUILLIX_ONLINE_MIN_INTERVAL_MS;
      else process.env.QUILLIX_ONLINE_MIN_INTERVAL_MS = previousInterval;
    }
  });

  it('lets Turbo overlap at most two online turns while retaining pacing', async () => {
    const previousInterval = process.env.QUILLIX_ONLINE_MIN_INTERVAL_MS;
    process.env.QUILLIX_ONLINE_MIN_INTERVAL_MS = '15';
    try {
      const directory = createTemporaryDirectory('quillix-router-turbo-overlap-');
      const settings = new SettingsStore(path.join(directory, 'settings.json'));
      settings.update({ ...DEFAULT_SETTINGS, aiProvider: 'turbo-overlap-test', offlineMode: false, turboSpeedMode: true });
      const router = new ProviderRouter(fakeOllama, settings);
      let active = 0;
      let maximumActive = 0;
      const starts: number[] = [];
      router.registerBrain({ id: 'turbo-overlap-test', label: 'Turbo overlap test', mode: 'online', capabilities: { tools: true, streaming: true, reasoning: false }, create: () => ({
        async generateText() {
          active += 1;
          maximumActive = Math.max(maximumActive, active);
          starts.push(Date.now());
          await new Promise(resolve => setTimeout(resolve, 80));
          active -= 1;
          return 'ok';
        },
        async generateStream() { return 'ok'; },
        async chatWithTools() { return { text: 'ok', toolCalls: [] }; },
        async chatWithToolsStream() { return { text: 'ok', toolCalls: [] }; },
      } as AIProvider) });
      await Promise.all(Array.from({ length: 4 }, () => router.generateText('turbo')));
      expect(maximumActive).toBe(2);
      for (let index = 1; index < starts.length; index++) expect(starts[index] - starts[index - 1]).toBeGreaterThanOrEqual(12);
    } finally {
      if (previousInterval === undefined) delete process.env.QUILLIX_ONLINE_MIN_INTERVAL_MS;
      else process.env.QUILLIX_ONLINE_MIN_INTERVAL_MS = previousInterval;
    }
  });

  it('removes the caller abort listener when a paced request finishes normally', async () => {
    const previousInterval = process.env.QUILLIX_ONLINE_MIN_INTERVAL_MS;
    process.env.QUILLIX_ONLINE_MIN_INTERVAL_MS = '1';
    try {
      const directory = createTemporaryDirectory('quillix-router-abort-cleanup-');
      const settings = new SettingsStore(path.join(directory, 'settings.json'));
      settings.update({...DEFAULT_SETTINGS, aiProvider: 'listener-cleanup-test', offlineMode: false});
      const router = new ProviderRouter(fakeOllama, settings);
      router.registerBrain({id: 'listener-cleanup-test', label: 'Listener cleanup test', mode: 'online', capabilities: {tools: true, streaming: true, reasoning: false}, create: () => ({
        async generateText() { return 'ok'; },
        async generateStream() { return 'ok'; },
        async chatWithTools() { return {text: 'ok', toolCalls: []}; },
        async chatWithToolsStream() { return {text: 'ok', toolCalls: []}; },
      } as AIProvider)});
      const controller = new AbortController();
      const addListener = vi.spyOn(controller.signal, 'addEventListener');
      const removeListener = vi.spyOn(controller.signal, 'removeEventListener');

      expect(await router.generateText('fast request', {signal: controller.signal})).toBe('ok');
      const abortCall = addListener.mock.calls.find(call => call[0] === 'abort');
      expect(abortCall).toBeDefined();
      expect(removeListener).toHaveBeenCalledWith('abort', abortCall?.[1]);
    } finally {
      if (previousInterval === undefined) delete process.env.QUILLIX_ONLINE_MIN_INTERVAL_MS;
      else process.env.QUILLIX_ONLINE_MIN_INTERVAL_MS = previousInterval;
    }
  });
});
