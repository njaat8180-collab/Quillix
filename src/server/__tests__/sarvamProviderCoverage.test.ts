import { afterEach, describe, expect, it, vi } from 'vitest';

const fileState = vi.hoisted(() => ({ existsSync: vi.fn(() => false) }));
const poolState = vi.hoisted(() => ({ keys: [] as string[] }));

vi.mock('fs', async () => {
  const actual = await vi.importActual<any>('fs');
  return {
    ...actual,
    default: { ...actual.default, existsSync: fileState.existsSync },
    existsSync: fileState.existsSync,
  };
});
vi.mock('../encryptedKeyPool.js', () => ({
  readEncryptedKeyPool: vi.fn(() => poolState.keys),
  saveEncryptedKeyToPool: vi.fn(() => 1),
  clearEncryptedKeyPool: vi.fn(),
  encryptedKeyPoolCount: vi.fn(() => poolState.keys.length),
}));

import { ProviderRouter, SarvamProvider } from '../sarvam.js';
import type { AIProvider } from '../qwen.js';
import type { SettingsStore } from '../settings.js';

const originalSarvamKey = process.env.SARVAM_API_KEY;
const originalSarvamKeys = process.env.SARVAM_API_KEYS;

afterEach(() => {
  vi.unstubAllGlobals();
  fileState.existsSync.mockReset().mockReturnValue(false);
  poolState.keys = [];
  if (originalSarvamKey === undefined) delete process.env.SARVAM_API_KEY;
  else process.env.SARVAM_API_KEY = originalSarvamKey;
  if (originalSarvamKeys === undefined) delete process.env.SARVAM_API_KEYS;
  else process.env.SARVAM_API_KEYS = originalSarvamKeys;
});

function response(status: number, payload?: unknown, headers: Record<string, string> = {}) {
  return new Response(payload === undefined ? '' : JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

const tool = {
  name: 'write_file',
  description: 'Write a file',
  parameters: { type: 'object', properties: { filePath: { type: 'string' } } },
};

async function withSarvamKey<T>(run: () => Promise<T>): Promise<T> {
  process.env.SARVAM_API_KEY = 'test-secret';
  return run();
}

describe('SarvamProvider error and response contracts', () => {
  it('fails when no Sarvam key is configured', async () => {
    delete process.env.SARVAM_API_KEY;
    await expect(new SarvamProvider().generateText('hello')).rejects.toThrow(/API key missing/);
  });

  it('rejects a required tool that is unavailable', async () => {
    await withSarvamKey(async () => {
      vi.stubGlobal('fetch', vi.fn());
      await expect(new SarvamProvider().chatWithTools(
        [{ role: 'user', content: 'hello' }],
        [tool] as any,
        { requiredToolName: 'missing_tool' },
      )).rejects.toThrow(/tool is unavailable/);
    });
  });

  it.each([
    [400, /Invalid API request/],
    [401, /key rejected/],
    [404, /endpoint not found/],
    [422, /format rejected/],
    [500, /temporarily unavailable/],
  ])('maps HTTP %s to a safe provider error', async (status, expected) => {
    await withSarvamKey(async () => {
      vi.stubGlobal('fetch', vi.fn(async () => response(status, { error: 'remote secret' })));
      await expect(new SarvamProvider().generateText('hello')).rejects.toThrow(expected);
    });
  });

  it('reports invalid JSON responses', async () => {
    await withSarvamKey(async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('not-json', { status: 200, headers: { 'content-type': 'application/json' } })));
      await expect(new SarvamProvider().generateText('hello')).rejects.toThrow(/invalid JSON/);
    });
  });

  it('reports empty provider responses', async () => {
    await withSarvamKey(async () => {
      vi.stubGlobal('fetch', vi.fn(async () => response(200, { choices: [] })));
      await expect(new SarvamProvider().generateText('hello')).rejects.toThrow(/empty response/);
    });
  });

  it('rejects truncated responses before tool execution', async () => {
    await withSarvamKey(async () => {
      vi.stubGlobal('fetch', vi.fn(async () => response(200, {
        choices: [{ finish_reason: 'length', message: { content: 'partial', tool_calls: [] } }],
      })));
      await expect(new SarvamProvider().chatWithTools(
        [{ role: 'user', content: 'hello' }], [tool] as any,
      )).rejects.toThrow(/truncated before a complete tool call/);
    });
  });

  it('joins typed text parts into the provider text', async () => {
    await withSarvamKey(async () => {
      vi.stubGlobal('fetch', vi.fn(async () => response(200, {
        choices: [{ message: { content: [{ type: 'text', text: 'hello ' }, { type: 'text', text: 'world' }] } }],
      })));
      await expect(new SarvamProvider().generateText('hello')).resolves.toBe('hello world');
    });
  });

  it('rejects responses with no text and no tool calls', async () => {
    await withSarvamKey(async () => {
      vi.stubGlobal('fetch', vi.fn(async () => response(200, { choices: [{ message: { content: '   ' } }] })));
      await expect(new SarvamProvider().generateText('hello')).rejects.toThrow(/no text or tool calls/);
    });
  });

  it('rejects malformed tool-call JSON', async () => {
    await withSarvamKey(async () => {
      vi.stubGlobal('fetch', vi.fn(async () => response(200, {
        choices: [{ message: { content: '', tool_calls: [{ id: 'call-1', function: { name: 'write_file', arguments: '{broken' } }] } }],
      })));
      await expect(new SarvamProvider().chatWithTools(
        [{ role: 'user', content: 'hello' }], [tool] as any,
      )).rejects.toThrow(/malformed tool-call JSON/);
    });
  });

  it('rejects non-object tool-call arguments', async () => {
    await withSarvamKey(async () => {
      vi.stubGlobal('fetch', vi.fn(async () => response(200, {
        choices: [{ message: { content: '', tool_calls: [{ id: 'call-1', function: { name: 'write_file', arguments: '["bad"]' } }] } }],
      })));
      await expect(new SarvamProvider().chatWithTools(
        [{ role: 'user', content: 'hello' }], [tool] as any,
      )).rejects.toThrow(/must be a JSON object/);
    });
  });

  it('rejects unknown tool names', async () => {
    await withSarvamKey(async () => {
      vi.stubGlobal('fetch', vi.fn(async () => response(200, {
        choices: [{ message: { content: '', tool_calls: [{ id: 'call-1', function: { name: 'delete_everything', arguments: '{}' } }] } }],
      })));
      await expect(new SarvamProvider().chatWithTools(
        [{ role: 'user', content: 'hello' }], [tool] as any,
      )).rejects.toThrow(/unavailable tool delete_everything/);
    });
  });

  it('rejects duplicate tool-call IDs', async () => {
    await withSarvamKey(async () => {
      vi.stubGlobal('fetch', vi.fn(async () => response(200, {
        choices: [{ message: { content: '', tool_calls: [
          { id: 'same-id', function: { name: 'write_file', arguments: '{}' } },
          { id: 'same-id', function: { name: 'write_file', arguments: '{}' } },
        ] } }],
      })));
      await expect(new SarvamProvider().chatWithTools(
        [{ role: 'user', content: 'hello' }], [tool] as any,
      )).rejects.toThrow(/duplicate tool-call IDs/);
    });
  });

  it('maps network TypeErrors to a connectivity error', async () => {
    await withSarvamKey(async () => {
      vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
      await expect(new SarvamProvider().generateText('hello')).rejects.toThrow(/network connection failed/);
    });
  });

  it('reports cancellation for an already-aborted request', async () => {
    await withSarvamKey(async () => {
      const controller = new AbortController();
      controller.abort();
      vi.stubGlobal('fetch', vi.fn());
      await expect(new SarvamProvider().generateText('hello', { signal: controller.signal })).rejects.toThrow(/cancelled/);
    });
  });

  it('maps an abort error to a timeout failure', async () => {
    await withSarvamKey(async () => {
      vi.stubGlobal('fetch', vi.fn(async () => { throw new DOMException('aborted', 'AbortError'); }));
      await expect(new SarvamProvider().generateText('hello')).rejects.toThrow(/connection timed out/);
    });
  });
});

describe('ProviderRouter selection, catalog and fallback behavior', () => {
  function routerWith(settings: Record<string, unknown>, ollama: Partial<AIProvider> = {}) {
    const settingsStore = { get: () => settings } as unknown as SettingsStore;
    return new ProviderRouter(ollama as AIProvider, settingsStore);
  }

  it('selects the requested or configured model for Ollama', async () => {
    const router = routerWith({ aiProvider: 'ollama', model: 'local-model' });
    await expect(router.getSelectedModel()).resolves.toBe('local-model');
    await expect(router.getSelectedModel('requested-model')).resolves.toBe('requested-model');
  });

  it('delegates selected-model lookup to an online provider', async () => {
    const router = routerWith({ aiProvider: 'online-test', model: 'ignored' });
    router.registerBrain({
      id: 'online-test', label: 'Online test', mode: 'online',
      capabilities: { tools: true, streaming: true, reasoning: true },
      create: () => ({ getSelectedModel: (requested?: string) => `online:${requested || 'default'}` } as AIProvider),
    });
    await expect(router.getSelectedModel('chosen')).resolves.toBe('online:chosen');
  });

  it('publishes built-in and registered brains with capabilities', () => {
    const router = routerWith({ aiProvider: 'ollama' });
    expect(router.brainCatalog().map(brain => brain.id)).toEqual([
      'ollama', 'sarvam', 'openai', 'grok', 'groq', 'nvidia', 'universal',
    ]);
    expect(router.capabilities).toEqual({ tools: true, streaming: true, reasoning: false });
  });

  it('keeps an active plugin registered until the active provider changes', () => {
    const settings = { aiProvider: 'plugin-test' };
    const router = routerWith(settings);
    const dispose = router.registerBrain({
      id: 'plugin-test', label: 'Plugin test', mode: 'offline',
      capabilities: { tools: true, streaming: true, reasoning: false },
      create: () => ({ generateText: async () => 'plugin' } as unknown as AIProvider),
    });
    expect(dispose()).toBe(false);
    settings.aiProvider = 'ollama';
    expect(dispose()).toBe(true);
    expect(router.brainCatalog().some(brain => brain.id === 'plugin-test')).toBe(false);
  });

  it('reports provider rate-limit status', () => {
    const router = routerWith({ aiProvider: 'ollama', offlineMode: true });
    expect(router.rateLimitStatus()).toMatchObject({
      providerId: 'ollama',
      offline: true,
      minIntervalMs: 0,
      providerManagedPacing: false,
    });
  });

  it('falls back locally on a rate limit with fallback metadata', async () => {
    const local = {
      async warmUp() {},
      async chatWithTools() { return { text: 'local', toolCalls: [] }; },
    } as unknown as AIProvider;
    const router = routerWith({ aiProvider: 'limited-test', model: 'local-model', offlineMode: false }, local);
    router.registerBrain({
      id: 'limited-test', label: 'Limited test', mode: 'online',
      capabilities: { tools: true, streaming: true, reasoning: false },
      create: () => ({ chatWithTools: async () => { throw new Error('HTTP 429 rate limit'); } } as unknown as AIProvider),
    });
    const result = await router.chatWithTools([{ role: 'user', content: 'hello' }], []);
    expect(result.text).toBe('local');
    expect(result.providerFallback).toEqual({ from: 'limited-test', to: 'ollama', reason: 'rate_limit' });
  });

  it('rejects an online provider request in offline mode', async () => {
    const router = routerWith({ aiProvider: 'openai', offlineMode: true });
    await expect(router.generateText('hello')).rejects.toThrow(/Disable Offline Mode/);
  });
});
