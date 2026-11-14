import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  calculateReportedOutputTokensPerSecond,
  clearUniversalKey,
  clearUniversalKeyPool,
  compactUniversalUserContent,
  hasUniversalKey,
  migrateLegacyUniversalKey,
  normalizeProviderRateLimit,
  normalizeProviderRequestInterval,
  noteProviderBudgetRequest,
  overdriveRateLimitRetryMs,
  overdriveRateLimitWaitBudget,
  providerBudgetWaitMs,
  providerEnvironmentKeyPool,
  readUniversalKey,
  readUniversalKeyPool,
  readUniversalKeys,
  saveUniversalKey,
  saveUniversalKeyToPool,
  summarizeProviderHealth,
  trimUniversalMessagesForPayload,
  trimUniversalToolsForPayload,
  universalKeyPoolCount,
  universalKeyScope,
  universalPayloadTooLargeError,
  universalRetryDelayMs,
  validateUniversalEndpoint,
} from '../universal.js';

/**
 * M8.9 — coverage for the universal provider adapter's pacing, retry and
 * payload-trimming logic.
 *
 * These helpers decide whether a request is sent, delayed, retried, or
 * refused, so each one is pinned down here rather than left to chance.
 */
describe('universal provider pacing + payload helpers (M8.9)', () => {
  describe('normalizeProviderRequestInterval', () => {
    it('accepts a valid interval', () => {
      expect(normalizeProviderRequestInterval(1500)).toBe(1500);
      expect(normalizeProviderRequestInterval('2500')).toBe(2500);
    });

    it('falls back for a missing or invalid value', () => {
      expect(normalizeProviderRequestInterval(undefined)).toBeGreaterThan(0);
      expect(normalizeProviderRequestInterval('')).toBeGreaterThan(0);
      expect(normalizeProviderRequestInterval('not a number')).toBeGreaterThan(0);
      expect(normalizeProviderRequestInterval(-5)).toBeGreaterThan(0);
    });

    it('clamps an oversized interval to one minute', () => {
      expect(normalizeProviderRequestInterval(999_999)).toBe(60_000);
    });
  });

  describe('normalizeProviderRateLimit', () => {
    it('normalises a positive limit', () => {
      expect(normalizeProviderRateLimit(60)).toBe(60);
      expect(normalizeProviderRateLimit('30')).toBe(30);
    });

    it('treats a missing or non-positive limit as unlimited', () => {
      expect(normalizeProviderRateLimit(undefined)).toBe(0);
      expect(normalizeProviderRateLimit(0)).toBe(0);
      expect(normalizeProviderRateLimit(-1)).toBe(0);
      expect(normalizeProviderRateLimit('nope')).toBe(0);
    });

    it('clamps an absurd limit', () => {
      expect(normalizeProviderRateLimit(1_000_000)).toBe(100_000);
    });
  });

  describe('providerBudgetWaitMs / noteProviderBudgetRequest', () => {
    it('does not wait when no budget is declared', () => {
      expect(providerBudgetWaitMs('never-used-endpoint', undefined, 1000)).toBe(0);
      expect(providerBudgetWaitMs('never-used-endpoint', { maxRequestsPerMinute: 0, maxTokensPerMinute: 0 }, 1000)).toBe(0);
    });

    it('makes the caller wait once the per-minute request budget is spent', () => {
      const key = `budget-test-${Math.random()}`;
      const now = Date.now();
      const budget = { maxRequestsPerMinute: 2, maxTokensPerMinute: 0 };
      noteProviderBudgetRequest(key, 100, now);
      noteProviderBudgetRequest(key, 100, now);
      expect(providerBudgetWaitMs(key, budget, 100, now)).toBeGreaterThan(0);
    });

    it('makes the caller wait once the per-minute token budget is spent', () => {
      const key = `token-budget-test-${Math.random()}`;
      const now = Date.now();
      const budget = { maxRequestsPerMinute: 0, maxTokensPerMinute: 500 };
      noteProviderBudgetRequest(key, 400, now);
      expect(providerBudgetWaitMs(key, budget, 200, now)).toBeGreaterThan(0);
    });

    it('does not wait when the request fits the remaining budget', () => {
      const key = `fits-budget-test-${Math.random()}`;
      const now = Date.now();
      noteProviderBudgetRequest(key, 100, now);
      expect(providerBudgetWaitMs(key, { maxRequestsPerMinute: 10, maxTokensPerMinute: 1000 }, 100, now)).toBe(0);
    });
  });

  describe('universalRetryDelayMs', () => {
    it('backs off exponentially and stays inside the ceiling', () => {
      const first = universalRetryDelayMs(0, null, Date.now(), 0.5);
      const second = universalRetryDelayMs(1, null, Date.now(), 0.5);
      const huge = universalRetryDelayMs(20, null, Date.now(), 0.5);
      expect(second).toBeGreaterThan(first);
      expect(huge).toBeLessThanOrEqual(8_000);
      expect(first).toBeGreaterThanOrEqual(1_000);
    });

    it('honours a provider Retry-After in seconds', () => {
      expect(universalRetryDelayMs(0, '7', Date.now(), 0.5)).toBe(7_000);
    });

    it('honours a provider Retry-After as an HTTP date', () => {
      const now = Date.now();
      const later = new Date(now + 5_000).toUTCString();
      expect(universalRetryDelayMs(0, later, now, 0.5)).toBeGreaterThan(0);
    });

    it('falls back to the backoff for an unparseable Retry-After', () => {
      const delay = universalRetryDelayMs(0, 'not-a-date', Date.now(), 0.5);
      expect(delay).toBeGreaterThanOrEqual(250);
    });
  });

  describe('overdriveRateLimitRetryMs', () => {
    it('waits at least the provider-advertised window', () => {
      expect(overdriveRateLimitRetryMs(0, '30', 5_000)).toBe(30_000);
    });

    it('uses a short constant wait when the provider publishes no timing', () => {
      const wait = overdriveRateLimitRetryMs(0, null, 0);
      expect(wait).toBeGreaterThanOrEqual(250);
      expect(wait).toBeLessThanOrEqual(1_000);
    });

    it('never exceeds the hard overdrive ceiling', () => {
      expect(overdriveRateLimitRetryMs(0, '999999', 0)).toBe(10 * 60 * 1000);
    });

    it('respects the pacing floor even when the provider asks for less', () => {
      expect(overdriveRateLimitRetryMs(0, '1', 0)).toBe(1_000);
    });
  });

  describe('overdriveRateLimitWaitBudget', () => {
    it('reports the remaining budget', () => {
      const budget = overdriveRateLimitWaitBudget(0, 5_000);
      expect(budget.exhausted).toBe(false);
      expect(budget.waitMs).toBe(5_000);
    });

    it('reports exhaustion once the total wait ceiling is reached', () => {
      const budget = overdriveRateLimitWaitBudget(15 * 60 * 1000, 5_000);
      expect(budget.exhausted).toBe(true);
      expect(budget.waitMs).toBe(0);
    });
  });

  describe('validateUniversalEndpoint', () => {
    it('accepts an https endpoint', () => {
      expect(validateUniversalEndpoint('https://api.example.com/v1', 'openai')).toContain('https://api.example.com');
    });

    it('allows http only for loopback addresses', () => {
      expect(validateUniversalEndpoint('http://localhost:11434', 'openai')).toContain('localhost');
      expect(() => validateUniversalEndpoint('http://api.example.com', 'openai')).toThrow(/HTTPS/i);
    });

    it('rejects a malformed URL', () => {
      expect(() => validateUniversalEndpoint('not a url', 'openai')).toThrow(/valid API endpoint/i);
    });

    it('rejects credentials, fragments and query secrets', () => {
      expect(() => validateUniversalEndpoint('https://user:pass@api.example.com/v1', 'openai')).toThrow(/must not contain credentials/i);
      expect(() => validateUniversalEndpoint('https://api.example.com/v1#frag', 'openai')).toThrow(/must not contain credentials/i);
      expect(() => validateUniversalEndpoint('https://api.example.com/v1?key=abc', 'openai')).toThrow(/must not contain credentials/i);
    });

    it('rejects a Gemini model URL and expects the API root', () => {
      expect(() => validateUniversalEndpoint('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0:generateContent', 'gemini')).toThrow(/Gemini API root URL/i);
    });
  });

  describe('compactUniversalUserContent', () => {
    it('deduplicates repeated paragraphs', () => {
      const result = compactUniversalUserContent('same thing\n\nsame thing\n\nother', 10_000);
      expect(result.content).toBe('same thing\n\nother');
      expect(result.changed).toBe(true);
    });

    it('leaves a short message unchanged', () => {
      const result = compactUniversalUserContent('hello', 10_000);
      expect(result.content).toBe('hello');
      expect(result.changed).toBe(false);
    });

    it('trims an oversized message and marks the omission', () => {
      const result = compactUniversalUserContent('a'.repeat(5_000) + '\n\n' + 'b'.repeat(5_000), 1_000);
      expect(result.changed).toBe(true);
      expect(result.content.length).toBeLessThanOrEqual(1_000);
      expect(result.content).toMatch(/omitted middle text/i);
    });

    it('keeps headings and requirement lines when compacting', () => {
      const source = `# Title\n- must do X\n${'filler '.repeat(2000)}\n# Another\n- must do Y`;
      const result = compactUniversalUserContent(source, 800);
      expect(result.changed).toBe(true);
      expect(result.content).toContain('must do X');
    });

    it('never returns more than the budget, even a tiny one', () => {
      const result = compactUniversalUserContent('x'.repeat(1_000), 10);
      expect(result.content.length).toBeLessThanOrEqual(10);
      expect(result.changed).toBe(true);
    });
  });

  describe('trimUniversalMessagesForPayload', () => {
    it('keeps the system prompt and the latest user turn', () => {
      const messages = [
        { role: 'system' as const, content: 'system rules' },
        { role: 'user' as const, content: 'latest request' },
      ];
      const result = trimUniversalMessagesForPayload(messages, 10_000);
      expect(result.tooLarge).toBe(false);
      expect(result.messages.some(m => m.role === 'system')).toBe(true);
      expect(result.messages.some(m => m.content === 'latest request')).toBe(true);
    });

    it('drops older tool results first when the payload is too large', () => {
      const messages = [
        { role: 'system' as const, content: 'system rules' },
        { role: 'user' as const, content: 'first request' },
        { role: 'tool' as const, name: 'read_file', toolCallId: 'c1', content: 'x'.repeat(50_000) },
        { role: 'user' as const, content: 'latest request' },
      ];
      const result = trimUniversalMessagesForPayload(messages, 5_000);
      expect(result.tooLarge).toBe(false);
      expect(result.changed).toBe(true);
      expect(result.messages.some(m => m.role === 'tool')).toBe(false);
      expect(result.messages.some(m => m.content === 'latest request')).toBe(true);
    });

    it('reports tooLarge when even the protected content cannot fit', () => {
      const messages = [
        { role: 'system' as const, content: 's'.repeat(10_000) },
        { role: 'user' as const, content: 'latest request' },
      ];
      const result = trimUniversalMessagesForPayload(messages, 100);
      expect(result.tooLarge).toBe(true);
      expect(result.messages).toBe(messages);
    });

    it('removes duplicate conversational turns but keeps tool pairs', () => {
      const messages = [
        { role: 'system' as const, content: 'system rules' },
        { role: 'user' as const, content: 'same question' },
        { role: 'assistant' as const, content: 'same answer' },
        { role: 'user' as const, content: 'same question' },
        { role: 'assistant' as const, content: 'same answer' },
      ];
      const result = trimUniversalMessagesForPayload(messages, 10_000);
      expect(result.changed).toBe(true);
      expect(result.messages.filter(m => m.content === 'same question').length).toBe(1);
      expect(result.messages.filter(m => m.content === 'same answer').length).toBe(1);
    });
  });

  describe('trimUniversalToolsForPayload', () => {
    it('trims long descriptions and schema text', () => {
      const tools = [{
        name: 'read_file',
        description: 'd'.repeat(1_000),
        parameters: { type: 'object', properties: { path: { type: 'string', description: 'p'.repeat(500) } } },
      }] as any;
      const result = trimUniversalToolsForPayload(tools);
      expect(result.changed).toBe(true);
      expect(result.tools[0].description.length).toBe(600);
      expect(result.tools[0].parameters.properties.path.description.length).toBe(180);
    });

it('leaves a small tool schema alone', () => {
      const tools = [{ name: 'read_file', description: 'read', parameters: { type: 'object' } }] as any;
      const result = trimUniversalToolsForPayload(tools);
      expect(result.changed).toBe(false);
    });
  });

  describe('summarizeProviderHealth', () => {
    it('reports unknown before the first request', () => {
      const health = summarizeProviderHealth({});
      expect(health.availability).toBe('unknown');
      expect(health.requests).toBe(0);
      expect(health.successRate).toBe(0);
    });

    it('reports ok for a healthy provider', () => {
      const health = summarizeProviderHealth({ requests: 10, httpSuccesses: 10 });
      expect(health.availability).toBe('ok');
      expect(health.successRate).toBe(1);
      expect(health.failures).toBe(0);
    });

    it('reports the specific degraded state', () => {
      expect(summarizeProviderHealth({ requests: 4, httpSuccesses: 1, http429: 1 }).availability).toBe('throttled');
      expect(summarizeProviderHealth({ requests: 4, httpSuccesses: 1, http401: 1 }).availability).toBe('auth');
      expect(summarizeProviderHealth({ requests: 4, httpSuccesses: 1, http402: 1 }).availability).toBe('billing');
      expect(summarizeProviderHealth({ requests: 4, httpSuccesses: 1, circuitOpenUntil: Date.now() + 1000 }).availability).toBe('circuit-open');
      expect(summarizeProviderHealth({ requests: 4, httpSuccesses: 1, cooldownUntil: Date.now() + 1000 }).availability).toBe('cooldown');
      expect(summarizeProviderHealth({ requests: 4, httpSuccesses: 1, consecutiveServerFailures: 2 }).availability).toBe('degraded');
    });

    it('never reports a negative metric', () => {
      const health = summarizeProviderHealth({ requests: -5, httpSuccesses: -1, averageResponseLatencyMs: -10, tokensPerSecond: -3 });
      expect(health.requests).toBe(0);
      expect(health.successes).toBe(0);
      expect(health.averageLatencyMs).toBe(0);
      expect(health.tokensPerSecond).toBe(0);
    });
  });

  describe('calculateReportedOutputTokensPerSecond', () => {
    it('computes generated-token throughput', () => {
      expect(calculateReportedOutputTokensPerSecond(1_000, 2_000)).toBe(500);
    });

    it('returns zero instead of NaN or Infinity', () => {
      expect(calculateReportedOutputTokensPerSecond(0, 1000)).toBe(0);
      expect(calculateReportedOutputTokensPerSecond(1000, 0)).toBe(0);
      expect(calculateReportedOutputTokensPerSecond(Number.NaN, 1000)).toBe(0);
    });
  });

  describe('universalPayloadTooLargeError', () => {
    it('explains the failure and the way out', () => {
      const message = universalPayloadTooLargeError();
      expect(message).toMatch(/too large/i);
      expect(message).toMatch(/413/);
    });
  });

  describe('credential storage (M9.7-adjacent, security-critical)', () => {
    // A unique, non-routable endpoint guarantees the audit scope can never
    // collide with a real credential the developer has saved.
    const context = { protocol: 'openai' as const, endpoint: 'https://quillix-audit-test.invalid/v1' };
    const otherContext = { protocol: 'openai' as const, endpoint: 'https://quillix-audit-other.invalid/v1' };

    afterEach(() => {
      try { clearUniversalKey(context); } catch { /* nothing stored */ }
      try { clearUniversalKey(otherContext); } catch { /* nothing stored */ }
    });

    it('scopes a key to its protocol and endpoint', () => {
      expect(universalKeyScope(context)).toContain('openai::');
      expect(universalKeyScope(context)).not.toBe(universalKeyScope(otherContext));
      // A different protocol on the same URL is a different scope.
      expect(universalKeyScope(context)).not.toBe(universalKeyScope({ protocol: 'anthropic', endpoint: context.endpoint }));
    });

    it('saves, reads back and clears a key', () => {
      saveUniversalKey('sk-audit-1234567890', context);
      expect(readUniversalKey(context)).toBe('sk-audit-1234567890');
      expect(hasUniversalKey(context)).toBe(true);
      clearUniversalKey(context);
      expect(hasUniversalKey(context)).toBe(false);
    });

    it('rejects an invalid key instead of storing it', () => {
      expect(() => saveUniversalKey('', context)).toThrow(/valid API key/i);
      expect(() => saveUniversalKey('   ', context)).toThrow(/valid API key/i);
      expect(() => saveUniversalKey('key\nwith-newline', context)).toThrow(/valid API key/i);
      expect(() => saveUniversalKey('x'.repeat(4_097), context)).toThrow(/valid API key/i);
    });

    it('never exposes a key that belongs to another endpoint', () => {
      saveUniversalKey('sk-audit-scoped', context);
      // Reading a scope with no stored key must fail closed rather than fall
      // back to a credential that belongs to a different endpoint.
      let leaked = '';
      try {
        leaked = readUniversalKey(otherContext);
      } catch (error: any) {
        expect(String(error?.message || '')).toMatch(/different endpoint|needs migration/i);
      }
      expect(leaked).not.toBe('sk-audit-scoped');
    });

    it('keeps a failover pool per endpoint and deduplicates it', () => {
      expect(saveUniversalKeyToPool('key-one', context)).toBe(1);
      expect(saveUniversalKeyToPool('key-two', context)).toBe(2);
      expect(saveUniversalKeyToPool('key-one', context)).toBe(2);
      expect(universalKeyPoolCount(context)).toBe(2);
      expect(readUniversalKeyPool(context)).toEqual(expect.arrayContaining(['key-one', 'key-two']));
      clearUniversalKeyPool(context);
      expect(universalKeyPoolCount(context)).toBe(0);
    });

    it('rejects an invalid pool key', () => {
      expect(() => saveUniversalKeyToPool('', context)).toThrow(/valid API key/i);
      expect(() => saveUniversalKeyToPool('a\r\nb', context)).toThrow(/valid API key/i);
    });

    it('combines the primary key, the pool and the environment into one ordered list', () => {
      saveUniversalKey('primary-key', context);
      saveUniversalKeyToPool('pool-key', context);
      process.env.QUILLIX_UNIVERSAL_API_KEYS = 'env-key,env-key-two';
      try {
        const keys = readUniversalKeys(context);
        expect(keys[0]).toBe('primary-key');
        expect(keys).toContain('pool-key');
        expect(keys).toContain('env-key');
        // Duplicates are removed.
        expect(new Set(keys).size).toBe(keys.length);
      } finally {
        delete process.env.QUILLIX_UNIVERSAL_API_KEYS;
      }
    });

    it('builds an environment key pool without duplicates', () => {
      process.env.QUILLIX_AUDIT_POOL = 'a\nb\na';
      try {
        const pool = providerEnvironmentKeyPool('primary', 'QUILLIX_AUDIT_POOL');
        expect(pool).toEqual(['primary', 'a', 'b']);
      } finally {
        delete process.env.QUILLIX_AUDIT_POOL;
      }
    });

    it('never migrates a legacy key into an unrelated scope', () => {
      // `migrateLegacyUniversalKey` must refuse to move a stored credential to
      // a scope it does not belong to. It returns false for a modern (v2)
      // legacy record and never rewrites anything.
      const legacy = path.join(os.homedir(), '.quillix', 'universal-key.dpapi.json');
      if (!fs.existsSync(legacy)) {
        expect(migrateLegacyUniversalKey(context)).toBe(false);
        return;
      }
      const before = fs.readFileSync(legacy, 'utf8');
      expect(migrateLegacyUniversalKey(context)).toBe(false);
      expect(fs.readFileSync(legacy, 'utf8')).toBe(before);
    });
  });
});
