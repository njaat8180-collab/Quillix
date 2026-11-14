import { afterEach, describe, expect, it, vi } from 'vitest';
import { discoverNimModels } from '../nvidia.js';

const originalFetch = globalThis.fetch;
afterEach(() => {
  vi.unstubAllGlobals();
  globalThis.fetch = originalFetch;
});

describe('NVIDIA model catalog credentials', () => {
  it('uses a backup key after an authentication rejection', async () => {
    const auth: string[] = [];
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      auth.push(new Headers(init?.headers).get('authorization') || '');
      return auth.length === 1
        ? new Response('', { status: 401 })
        : new Response(JSON.stringify({ data: [{ id: 'nim/available-model', supports_tools: true, supports_streaming: true }] }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetch);
    const result = await discoverNimModels(true, ['rejected-primary', 'valid-backup']);
    expect(auth).toEqual(['Bearer rejected-primary', 'Bearer valid-backup']);
    expect(result.models.map(model => model.id)).toContain('nim/available-model');
    expect(result.error).toBeUndefined();
  });

  it('does not try another key to evade NVIDIA rate limits', async () => {
    const auth: string[] = [];
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      auth.push(new Headers(init?.headers).get('authorization') || '');
      return new Response('', { status: 429 });
    });
    vi.stubGlobal('fetch', fetch);
    const result = await discoverNimModels(true, ['primary', 'backup']);
    expect(auth).toEqual(['Bearer primary']);
    expect(result.error).toMatch(/HTTP 429/);
  });
});
