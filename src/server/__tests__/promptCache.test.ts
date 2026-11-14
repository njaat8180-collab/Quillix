import { afterEach, describe, expect, it } from 'vitest';
import {
  PROMPT_CACHE_TTL_MS,
  clearPromptCache,
  promptCacheKey,
  promptCacheStats,
  readPromptCache,
  writePromptCache,
} from '../promptCache.js';

const input = {
  endpoint: 'openai:https://api.openai.com/v1',
  model: 'gpt-oss-120b',
  messages: [{ role: 'user', content: 'hello' }],
  temperature: 0.2,
};

describe('prompt cache (M5.6)', () => {
  afterEach(() => clearPromptCache());

  it('keys are stable for identical requests and differ otherwise', () => {
    const a = promptCacheKey(input);
    expect(promptCacheKey({ ...input })).toBe(a);
    expect(promptCacheKey({ ...input, temperature: 0.9 })).not.toBe(a);
    expect(promptCacheKey({ ...input, model: 'other' })).not.toBe(a);
    expect(promptCacheKey({ ...input, messages: [{ role: 'user', content: 'hello!' }] })).not.toBe(a);
  });

  it('returns a stored result inside the TTL window', () => {
    const key = promptCacheKey(input);
    writePromptCache(key, { text: 'cached answer' });
    expect(readPromptCache(key)).toEqual({ text: 'cached answer' });
    expect(promptCacheStats().hits).toBe(1);
  });

  it('expires entries after the TTL and counts the miss', () => {
    const key = promptCacheKey(input);
    writePromptCache(key, { text: 'old answer' }, 1000, 0);
    expect(readPromptCache(key, 500)).toEqual({ text: 'old answer' });
    expect(readPromptCache(key, 5_000)).toBeNull();
    // expired entries are dropped on access, not kept around
    expect(promptCacheStats().entries).toBe(0);
  });

  it('keeps usage metadata alongside the text', () => {
    const key = promptCacheKey(input);
    writePromptCache(key, { text: 'answer', usage: { totalTokens: 42 } });
    expect(readPromptCache(key)).toEqual({ text: 'answer', usage: { totalTokens: 42 } });
  });

  it('never stores empty text and never grows past the entry limit', () => {
    const empty = promptCacheKey({ ...input, messages: [{ role: 'user', content: '' }] });
    writePromptCache(empty, { text: '   ' });
    expect(readPromptCache(empty)).toBeNull();
    for (let i = 0; i < 250; i++) {
      writePromptCache(promptCacheKey({ ...input, messages: [{ role: 'user', content: `q${i}` }] }), { text: `a${i}` });
    }
    expect(promptCacheStats().entries).toBeLessThanOrEqual(200);
    // the freshest entry survives the eviction
    const newest = promptCacheKey({ ...input, messages: [{ role: 'user', content: 'q249' }] });
    expect(readPromptCache(newest)).toEqual({ text: 'a249' });
  });

  it('has a bounded default TTL', () => {
    expect(PROMPT_CACHE_TTL_MS).toBeGreaterThan(60_000);
    expect(PROMPT_CACHE_TTL_MS).toBeLessThanOrEqual(30 * 60 * 1000);
  });
});
