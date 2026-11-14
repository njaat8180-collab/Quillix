import { describe, expect, it } from 'vitest';
import {
  PROMPT_CACHE_LIMITS,
  PromptResultCache,
  chunkCachedResponse,
  promptResultCacheKey,
} from '../../shared/promptResultCache.js';

const baseKey = {
  providerId: 'ollama',
  model: 'qwen2.5-coder:3b',
  endpoint: 'http://localhost:11434',
  systemInstruction: 'You are QUILLIX.',
  prompt: 'explain this function',
  temperature: 0.2,
};

describe('prompt result cache (M5.6)', () => {
  it('keys on the full request identity', () => {
    const key = promptResultCacheKey(baseKey);
    expect(promptResultCacheKey(baseKey)).toBe(key);
    expect(promptResultCacheKey({ ...baseKey, prompt: 'different' })).not.toBe(key);
    expect(promptResultCacheKey({ ...baseKey, model: 'other' })).not.toBe(key);
    expect(promptResultCacheKey({ ...baseKey, providerId: 'universal' })).not.toBe(key);
    expect(promptResultCacheKey({ ...baseKey, endpoint: 'https://api.openai.com/v1' })).not.toBe(key);
    expect(promptResultCacheKey({ ...baseKey, systemInstruction: 'different' })).not.toBe(key);
    expect(promptResultCacheKey({ ...baseKey, temperature: 0.9 })).not.toBe(key);
    // Undefined optional fields are stable, not "undefined"-string noise.
    expect(promptResultCacheKey({ ...baseKey, systemInstruction: undefined })).toBe(
      promptResultCacheKey({ ...baseKey, systemInstruction: '' }),
    );
  });

  it('serves repeats inside the TTL and expires after it', () => {
    let now = 1000;
    const cache = new PromptResultCache({ maxEntries: 4, maxEntryChars: 1000, ttlMs: 500 }, () => now);
    cache.set('k', 'answer');
    expect(cache.get('k')).toBe('answer');
    now += 500;
    expect(cache.get('k')).toBeUndefined();
    expect(cache.stats()).toMatchObject({ entries: 0, hits: 1, misses: 1 });
  });

  it('bounds entries by count and size, and evicts oldest first', () => {
    let now = 0;
    const cache = new PromptResultCache({ maxEntries: 2, maxEntryChars: 10, ttlMs: 10_000 }, () => now);
    cache.set('a', 'first');
    cache.set('b', 'second');
    cache.get('a'); // refresh LRU: b becomes oldest
    cache.set('c', 'third');
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe('first');
    expect(cache.get('c')).toBe('third');
    expect(cache.stats().entries).toBe(2);
    expect(cache.stats().evictions).toBeGreaterThanOrEqual(1);
    // Oversized entries are never stored.
    cache.set('big', 'x'.repeat(11));
    expect(cache.get('big')).toBeUndefined();
    // Empty/whitespace answers are not cached.
    cache.set('blank', '   ');
    expect(cache.get('blank')).toBeUndefined();
  });

  it('replays cached answers as bounded non-empty chunks', () => {
    expect(chunkCachedResponse('abc', 2)).toEqual(['ab', 'c']);
    expect(chunkCachedResponse('', 2)).toEqual(['']);
    expect(chunkCachedResponse('x'.repeat(250)).length).toBe(Math.ceil(250 / 80));
    expect(PROMPT_CACHE_LIMITS.ttlMs).toBeGreaterThan(0);
  });
});
