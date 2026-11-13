/**
 * M5.6: short-lived result cache for repeated chat prompts (token efficiency).
 *
 * Scope: the plain streaming chat endpoint only. Agent turns (which run tools
 * and write files) deliberately never use this cache — a stale answer there
 * could describe an out-of-date workspace. The cache key covers the provider,
 * model, endpoint, system instruction, temperature and the FULL prompt, so any
 * change in those produces a miss. Entries are bounded by count, size and TTL,
 * and every replay is disclosed to the client (`cached: true`) so a cached
 * answer is never presented as freshly generated.
 */

export const PROMPT_CACHE_LIMITS = {
  maxEntries: 64,
  maxEntryChars: 20_000,
  ttlMs: 5 * 60_000,
} as const;

/** Stable cache key for a chat generation. */
export function promptResultCacheKey(input: {
  providerId: string;
  model: string;
  endpoint: string;
  systemInstruction?: string;
  prompt: string;
  temperature?: number;
}): string {
  return JSON.stringify([
    String(input.providerId || ''),
    String(input.model || ''),
    String(input.endpoint || ''),
    String(input.systemInstruction || ''),
    Number.isFinite(input.temperature) ? Number(input.temperature) : null,
    String(input.prompt || ''),
  ]);
}

export interface PromptResultCacheStats {
  entries: number;
  hits: number;
  misses: number;
  evictions: number;
}

export class PromptResultCache {
  private readonly entries = new Map<string, { value: string; expiresAt: number }>();
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  constructor(
    private readonly limits: { maxEntries: number; maxEntryChars: number; ttlMs: number } = PROMPT_CACHE_LIMITS,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: string): string | undefined {
    const entry = this.entries.get(key);
    if (!entry) { this.misses++; return undefined; }
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      this.evictions++;
      this.misses++;
      return undefined;
    }
    // Refresh LRU position.
    this.entries.delete(key);
    this.entries.set(key, entry);
    this.hits++;
    return entry.value;
  }

  set(key: string, value: string): void {
    const text = String(value || '');
    if (!text.trim() || text.length > this.limits.maxEntryChars) return;
    this.entries.delete(key);
    this.entries.set(key, { value: text, expiresAt: this.now() + this.limits.ttlMs });
    while (this.entries.size > this.limits.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
      this.evictions++;
    }
  }

  clear(): void {
    this.entries.clear();
  }

  stats(): PromptResultCacheStats {
    return { entries: this.entries.size, hits: this.hits, misses: this.misses, evictions: this.evictions };
  }
}

/** Replay a cached answer as stream-like chunks so the client sees the same
 *  shape as a live response (bounded chunk size, never empty). */
export function chunkCachedResponse(text: string, chunkChars = 80): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += chunkChars) chunks.push(text.slice(i, i + chunkChars));
  return chunks.length ? chunks : [''];
}
