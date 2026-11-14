import { afterEach, describe, expect, it, vi } from 'vitest';

const fileState = vi.hoisted(() => ({
  existsSync: vi.fn(() => false),
  unlinkSync: vi.fn(),
}));
const poolState = vi.hoisted(() => ({ keys: [] as string[] }));

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<any>('node:fs');
  return {
    ...actual,
    default: { ...actual.default, existsSync: fileState.existsSync, unlinkSync: fileState.unlinkSync },
    existsSync: fileState.existsSync,
    unlinkSync: fileState.unlinkSync,
  };
});
vi.mock('node:os', async () => {
  const actual = await vi.importActual<any>('node:os');
  return { ...actual, default: { ...actual.default, homedir: () => 'C:\\Users\\test-user' } };
});
vi.mock('../encryptedKeyPool.js', () => ({
  readEncryptedKeyPool: vi.fn(() => poolState.keys),
  saveEncryptedKeyToPool: vi.fn(() => 1),
  clearEncryptedKeyPool: vi.fn(),
  encryptedKeyPoolCount: vi.fn(() => poolState.keys.length),
}));

import {
  NVIDIA_DEFAULT_MODEL,
  cachedNimModels,
  clearNvidiaKey,
  createNimProvider,
  createNvidiaProvider,
  discoverNimModels,
  hasNvidiaKey,
  nimFailoverSnapshot,
  readNvidiaKey,
  readNvidiaKeys,
  saveNvidiaKey,
} from '../nvidia.js';
import type { QuillixSettings } from '../../shared/types.js';

const originalNvidiaKey = process.env.NVIDIA_API_KEY;
const originalNvidiaKeys = process.env.NVIDIA_API_KEYS;

afterEach(() => {
  vi.unstubAllGlobals();
  fileState.existsSync.mockReset().mockReturnValue(false);
  fileState.unlinkSync.mockReset();
  poolState.keys = [];
  if (originalNvidiaKey === undefined) delete process.env.NVIDIA_API_KEY;
  else process.env.NVIDIA_API_KEY = originalNvidiaKey;
  if (originalNvidiaKeys === undefined) delete process.env.NVIDIA_API_KEYS;
  else process.env.NVIDIA_API_KEYS = originalNvidiaKeys;
});

describe('NVIDIA key storage', () => {
  it('rejects empty, oversized and multiline API keys', () => {
    expect(() => saveNvidiaKey('')).toThrow(/valid NVIDIA API key/);
    expect(() => saveNvidiaKey('x'.repeat(4097))).toThrow(/valid NVIDIA API key/);
    expect(() => saveNvidiaKey('key\nsecond-line')).toThrow(/valid NVIDIA API key/);
  });

  it('falls back to the environment when no key file exists', () => {
    process.env.NVIDIA_API_KEY = 'environment-key';
    expect(readNvidiaKey()).toBe('environment-key');
  });

  it('reports whether an NVIDIA key exists', () => {
    delete process.env.NVIDIA_API_KEY;
    expect(hasNvidiaKey()).toBe(false);
    process.env.NVIDIA_API_KEY = 'configured';
    expect(hasNvidiaKey()).toBe(true);
  });

  it('clears the NVIDIA key file', () => {
    clearNvidiaKey();
    expect(fileState.unlinkSync).toHaveBeenCalledTimes(1);
    expect(fileState.unlinkSync.mock.calls[0][0]).toMatch(/nvidia-key\.dpapi\.json/);
  });

  it('deduplicates and caps the available NVIDIA key collection', () => {
    process.env.NVIDIA_API_KEY = 'primary';
    process.env.NVIDIA_API_KEYS = Array.from({ length: 25 }, (_, index) => `key-${index + 1}`).join(',');
    poolState.keys = ['pool-key', 'primary'];
    const keys = readNvidiaKeys();
    expect(keys).toHaveLength(20);
    expect(new Set(keys).size).toBe(20);
    expect(keys).toContain('pool-key');
    expect(keys).not.toContain('key-19');
  });
});

describe('NVIDIA NIM model discovery', () => {
  it('returns an error when no credentials are available', async () => {
    const result = await discoverNimModels(true, []);
    expect(result.error).toMatch(/Save NVIDIA API key first/);
    expect(result.source).toBe('cache');
    expect(result.models).toEqual([]);
  });

  it('discovers a live model catalog and then serves it from cache', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({
      data: [
        { id: 'nim/model-a', context_length: 128000, supports_tools: true, supports_streaming: true },
        { id: 'nim/model-b' },
      ],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetch);
    const live = await discoverNimModels(true, ['valid-key']);
    expect(live.source).toBe('live');
    expect(live.models.map(model => model.id)).toEqual(['nim/model-a', 'nim/model-b']);
    expect(cachedNimModels().map(model => model.id)).toEqual(['nim/model-a', 'nim/model-b']);
    const cached = await discoverNimModels(false, ['valid-key']);
    expect(cached.source).toBe('cache');
    expect(cached.models).toEqual(live.models);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('returns a safe error for an HTTP failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('remote secret', { status: 503 })));
    const result = await discoverNimModels(true, ['valid-key']);
    expect(result.error).toMatch(/HTTP 503/);
    expect(result.source).toBe('cache');
    expect(result.error).not.toContain('remote secret');
  });

  it('rejects an empty model catalog', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 })));
    const result = await discoverNimModels(true, ['valid-key']);
    expect(result.error).toMatch(/no usable models/);
    expect(result.models.map(model => model.id)).toEqual(['nim/model-a', 'nim/model-b']);
  });

  it('uses a second key after a 401 response', async () => {
    const authorizations: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      authorizations.push(new Headers(init?.headers).get('authorization') || '');
      if (authorizations.length === 1) return new Response('', { status: 401 });
      return new Response(JSON.stringify({ data: [{ id: 'nim/backup-model' }] }), { status: 200 });
    }));
    const result = await discoverNimModels(true, ['rejected-key', 'backup-key']);
    expect(authorizations).toEqual(['Bearer rejected-key', 'Bearer backup-key']);
    expect(result.source).toBe('live');
    expect(result.models.map(model => model.id)).toEqual(['nim/backup-model']);
  });

  it('reports an empty failover snapshot before provider creation', () => {
    const snapshot = nimFailoverSnapshot();
    expect(snapshot).toMatchObject({ active: '', models: {}, switches: [] });
  });
});

describe('NVIDIA provider construction', () => {
  const settings = {
    nvidiaModel: 'nvidia/test-model',
    turboSpeedMode: false,
    performanceMode: 'balanced',
    overdriveMode: false,
    offlineMode: false,
    promptCache: false,
  } as QuillixSettings;

  it('constructs the NVIDIA universal provider with the configured model', () => {
    const provider = createNvidiaProvider(() => settings);
    expect(provider.getSelectedModel()).toBe('nvidia/test-model');
    expect(provider.capabilities).toMatchObject({ tools: true, streaming: true });
  });

  it('constructs the NIM failover provider and publishes its snapshot', () => {
    const provider = createNimProvider(() => settings);
    expect(provider.getSelectedModel()).toBe('nvidia/test-model');
    expect(provider.activeModel()).toBe('nvidia/test-model');
    expect(nimFailoverSnapshot()).toMatchObject({ active: 'nvidia/test-model' });
  });

  it('uses the default NVIDIA model when none is configured', () => {
    const provider = createNvidiaProvider(() => ({ ...settings, nvidiaModel: '' }));
    expect(provider.getSelectedModel()).toBe(NVIDIA_DEFAULT_MODEL);
  });
});
