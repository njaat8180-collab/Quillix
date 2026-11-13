import { afterEach, describe, expect, it, vi } from 'vitest';
import { discoverProviderModels } from '../providerModelCatalog.js';
import { formatProviderModelLabel } from '../../shared/providerModels.js';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

describe('provider model catalog', () => {
  it('discovers every page returned by an OpenAI-compatible catalog using the saved credential', async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer secret');
      if (!url.searchParams.has('after')) {
        return new Response(JSON.stringify({ data: [{ id: 'coder-a', supports_tools: true, context_length: 128000 }], has_more: true, last_id: 'coder-a' }), { status: 200 });
      }
      expect(url.searchParams.get('after')).toBe('coder-a');
      return new Response(JSON.stringify({ data: [{ id: 'coder-b', supports_tools: false, supports_streaming: true }], has_more: false }), { status: 200 });
    });
    globalThis.fetch = fetch as typeof fetch;

    const models = await discoverProviderModels({ protocol: 'openai', endpoint: 'https://models.example.test/v1', model: 'coder-a', offlineMode: false, auth: { type: 'bearer' } }, 'secret');
    expect(models).toEqual([
      { id: 'coder-a', tools: true, contextLength: 128000 },
      { id: 'coder-b', tools: false, streaming: true },
    ]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('uses the next saved credential for catalog discovery only after auth rejection', async () => {
    const authorization: string[] = [];
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      authorization.push(new Headers(init?.headers).get('authorization') || '');
      return authorization.length === 1
        ? new Response('', { status: 401 })
        : new Response(JSON.stringify({ data: [{ id: 'backup-visible-model', supports_tools: true }] }), { status: 200 });
    });
    globalThis.fetch = fetch as typeof fetch;
    const models = await discoverProviderModels(
      { protocol: 'openai', endpoint: 'https://backup-models.example.test/v1', model: 'configured', offlineMode: false, auth: { type: 'bearer' } },
      ['rejected-key', 'valid-backup'],
    );
    expect(authorization).toEqual(['Bearer rejected-key', 'Bearer valid-backup']);
    expect(models.map(model => model.id)).toEqual(['backup-visible-model']);
  });

  it('does not switch credentials to work around model-list rate limits', async () => {
    const authorization: string[] = [];
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      authorization.push(new Headers(init?.headers).get('authorization') || '');
      return new Response('', { status: 429 });
    });
    globalThis.fetch = fetch as typeof fetch;
    await expect(discoverProviderModels(
      { protocol: 'openai', endpoint: 'https://limited-models.example.test/v1', model: 'configured', offlineMode: false, auth: { type: 'bearer' } },
      ['primary', 'backup'],
    )).rejects.toThrow('HTTP 429');
    expect(authorization).toEqual(['Bearer primary']);
  });

  it('shows reported model capabilities without inventing unknown capabilities', () => {
    expect(formatProviderModelLabel({ id: 'acme/coder', tools: true, streaming: false, contextLength: 131072, reasoning: true }))
      .toBe('acme/coder · tools · no streaming · reasoning · 131k context');
    expect(formatProviderModelLabel({ id: 'acme/unknown' })).toBe('acme/unknown · capabilities unknown');
    expect(formatProviderModelLabel({ id: 'acme/text', tools: false })).toBe('acme/text · no tools · 2 capability flags unknown');
  });
});
