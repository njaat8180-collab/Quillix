import { createHash } from 'node:crypto';

/**
 * Prompt deduplication cache (M5.6).
 *
 * An identical prompt (same endpoint, model, messages and temperature) that is
 * repeated inside the TTL window is answered from memory instead of hitting the
 * provider again. This only ever applies to plain chat completions — agent
 * turns carry tools, and cached tool results would corrupt the agent loop.
 *
 * The cache is process-local and bounded: stale and oldest entries are evicted,
 * so it can never grow without limit or outlive its usefulness.
 */

export interface CachedPromptResult {
  text: string;
  usage?: unknown;
}

export interface PromptCacheKeyInput {
  endpoint: string;
  model: string;
  messages: unknown;
  temperature?: unknown;
}

export const PROMPT_CACHE_TTL_MS = 10 * 60 * 1000;
export const PROMPT_CACHE_MAX_ENTRIES = 200;

interface PromptCacheEntry {
  result: CachedPromptResult;
  expiresAt: number;
  storedAt: number;
}

const store = new Map<string, PromptCacheEntry>();
let hits = 0;
let misses = 0;

/** Stable cache key for a completion request. */
export function promptCacheKey(input: PromptCacheKeyInput): string {
  return createHash('sha256')
    .update(JSON.stringify([input.endpoint, input.model, input.messages, input.temperature ?? null]))
    .digest('hex');
}

/** Read a fresh entry (expired entries are dropped on access). */
export function readPromptCache(key: string, now = Date.now()): CachedPromptResult | null {
  const entry = store.get(key);
  if (!entry) { misses++; return null; }
  if (entry.expiresAt <= now) {
    store.delete(key);
    misses++;
    return null;
  }
  hits++;
  return entry.result;
}

/** Store a result; evicts expired entries first, then the oldest. */
export function writePromptCache(
  key: string,
  result: CachedPromptResult,
  ttlMs: number = PROMPT_CACHE_TTL_MS,
  now = Date.now(),
): void {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) return;
  if (typeof result?.text !== 'string' || !result.text.trim()) return;
  for (const [existingKey, entry] of store) {
    if (entry.expiresAt <= now) store.delete(existingKey);
  }
  while (store.size >= PROMPT_CACHE_MAX_ENTRIES) {
    const oldestKey = store.keys().next().value;
    if (oldestKey === undefined) break;
    store.delete(oldestKey);
  }
  store.set(key, { result, expiresAt: now + ttlMs, storedAt: now });
}

export function clearPromptCache(): void {
  store.clear();
  hits = 0;
  misses = 0;
}

export function promptCacheStats(): { entries: number; hits: number; misses: number; hitRate: number } {
  const total = hits + misses;
  return { entries: store.size, hits, misses, hitRate: total ? hits / total : 0 };
}
