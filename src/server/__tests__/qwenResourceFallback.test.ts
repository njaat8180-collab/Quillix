import { afterEach, describe, expect, it, vi } from 'vitest';
import { OllamaQwenProvider } from '../qwen.js';

describe('resource-aware Ollama fallback selection', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('selects the smaller installed brain when resource pressure caused the fallback', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      models: [
        { name: 'qwen2.5-coder:3b' },
        { name: 'qwen2.5-coder:1.5b' },
        { name: 'qwen3:4b' },
      ],
    }), { status: 200, headers: { 'content-type': 'application/json' } })));
    const provider = new OllamaQwenProvider({ model: 'qwen2.5-coder:3b', offlineMode: true });
    await expect(provider.getFallbackModel('qwen2.5-coder:3b', new Error('Resource guard could not start the model request safely: RAM 92%')))
      .resolves.toBe('qwen2.5-coder:1.5b');
  });

  it('keeps the quality-oriented fallback order for ordinary transport failures', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      models: [{ name: 'qwen2.5-coder:3b' }, { name: 'qwen3:4b' }, { name: 'qwen2.5-coder:1.5b' }],
    }), { status: 200, headers: { 'content-type': 'application/json' } })));
    const provider = new OllamaQwenProvider({ model: 'qwen2.5-coder:3b', offlineMode: true });
    await expect(provider.getFallbackModel('qwen2.5-coder:3b', new Error('request timed out')))
      .resolves.toBe('qwen3:4b');
  });

  it('does not escalate the smallest brain while memory is constrained', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      models: [{ name: 'qwen2.5-coder:1.5b' }, { name: 'qwen2.5-coder:3b' }],
    }), { status: 200, headers: { 'content-type': 'application/json' } })));
    const provider = new OllamaQwenProvider({ model: 'qwen2.5-coder:1.5b', offlineMode: true });
    await expect(provider.getFallbackModel('qwen2.5-coder:1.5b', new Error('Resource guard could not start the model request safely: RAM 91%')))
      .resolves.toBeUndefined();
  });
});
