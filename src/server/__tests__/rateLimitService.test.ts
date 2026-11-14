import { describe, expect, it } from 'vitest';
import {
  RateLimitService,
  normalizeRateLimitCeiling,
  parseRateLimitHeaders,
  parseResetMs,
  parseRetryAfterMs,
  rateLimitScopeFor,
} from '../rateLimitService.js';

const NOW = 1_700_000_000_000;
const headers = (map: Record<string, string>) => ({ get: (name: string) => map[name] ?? null });

describe('rate limiting: window math', () => {
  it('normalizes ceilings: junk means unlimited, huge clamps', () => {
    expect(normalizeRateLimitCeiling(undefined)).toBe(0);
    expect(normalizeRateLimitCeiling('')).toBe(0);
    expect(normalizeRateLimitCeiling(-5)).toBe(0);
    expect(normalizeRateLimitCeiling(Number.NaN)).toBe(0);
    expect(normalizeRateLimitCeiling('12.7')).toBe(13);
    expect(normalizeRateLimitCeiling(99_999_999)).toBe(10_000_000);
  });

  it('never blocks a scope without ceilings (fail-safe)', () => {
    const service = new RateLimitService({ now: () => NOW });
    for (let i = 0; i < 50; i++) {
      expect(service.check('open', {}, 1000, NOW).allowed).toBe(true);
      service.record('open', { requests: 1, tokens: 1000 }, NOW);
    }
    expect(service.snapshot('open', {}, NOW).requestsInWindow).toBe(50);
  });

  it('enforces requests-per-minute and releases exactly on the window edge', () => {
    const service = new RateLimitService({ now: () => NOW });
    const ceilings = { maxRequestsPerMinute: 2 };
    expect(service.check('rpm', ceilings, 0, NOW).allowed).toBe(true);
    service.record('rpm', { requests: 1, tokens: 0 }, NOW);
    expect(service.check('rpm', ceilings, 0, NOW).allowed).toBe(true);
    service.record('rpm', { requests: 1, tokens: 0 }, NOW);
    const blocked = service.check('rpm', ceilings, 0, NOW);
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toBe('requests-per-minute');
    expect(blocked.waitMs).toBe(60_000);
    expect(service.check('rpm', ceilings, 0, NOW + 59_999).allowed).toBe(false);
    expect(service.check('rpm', ceilings, 0, NOW + 60_000).allowed).toBe(true);
  });

  it('enforces tokens-per-minute with headroom release', () => {
    const service = new RateLimitService({ now: () => NOW });
    const ceilings = { maxTokensPerMinute: 1000 };
    service.record('tpm', { requests: 1, tokens: 600 }, NOW);
    expect(service.check('tpm', ceilings, 300, NOW).allowed).toBe(true);
    service.record('tpm', { requests: 1, tokens: 300 }, NOW);
    const blocked = service.check('tpm', ceilings, 200, NOW);
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toBe('tokens-per-minute');
    expect(blocked.waitMs).toBe(60_000);
    expect(service.check('tpm', ceilings, 200, NOW + 60_000).allowed).toBe(true);
  });

  it('enforces daily requests and daily tokens', () => {
    const service = new RateLimitService({ now: () => NOW });
    service.record('day', { requests: 1, tokens: 500 }, NOW);
    expect(service.check('day', { maxRequestsPerDay: 1 }, 0, NOW).reason).toBe('requests-per-day');
    expect(service.check('day', { maxTokensPerDay: 400 }, 0, NOW).reason).toBe('tokens-per-day');
    expect(service.check('day', { maxRequestsPerDay: 1 }, 0, NOW + 24 * 60 * 60 * 1000).allowed).toBe(true);
  });

  it('takes the longest wait across every applicable limit', () => {
    const service = new RateLimitService({ now: () => NOW });
    service.record('mix', { requests: 1, tokens: 100 }, NOW);
    service.noteCooldown('mix', NOW + 5_000, NOW);
    const decision = service.check('mix', { maxRequestsPerMinute: 1, maxTokensPerMinute: 50 }, 0, NOW);
    expect(decision.allowed).toBe(false);
    // The RPM window edge (60s) is longer than the 5s cooldown here, and the
    // wait is the longest of every applicable limit.
    expect(decision.waitMs).toBe(60_000);
    expect(decision.reason).toBe('requests-per-minute');
  });

  it('shares one cooldown across every caller of the scope', () => {
    const service = new RateLimitService({ now: () => NOW });
    const response = { status: 429, headers: headers({ 'retry-after': '30' }) };
    const result = service.noteResponse('shared', response, NOW);
    expect(result.retryAfterMs).toBe(30_000);
    expect(service.cooldownUntil('shared')).toBe(NOW + 30_000);
    expect(service.check('shared', {}, 0, NOW + 1).reason).toBe('cooldown');
    expect(service.check('shared', {}, 0, NOW + 30_000).allowed).toBe(true);
  });

  it('opens a cooldown when the provider reports exhausted remaining requests', () => {
    const service = new RateLimitService({ now: () => NOW });
    service.noteResponse('exhausted', {
      status: 200,
      headers: headers({ 'x-ratelimit-remaining-requests': '0', 'x-ratelimit-reset-requests': '45s' }),
    }, NOW);
    expect(service.cooldownUntil('exhausted')).toBe(NOW + 45_000);
    const snapshot = service.snapshot('exhausted', {}, NOW);
    expect(snapshot.providerRemainingRequests).toBe(0);
    expect(snapshot.providerResetAt).toBe(NOW + 45_000);
  });

  it('falls back to a conservative cooldown for a bare 429', () => {
    const service = new RateLimitService({ now: () => NOW });
    service.noteResponse('bare', { status: 429, headers: null }, NOW);
    expect(service.cooldownUntil('bare')).toBe(NOW + 30_000);
  });

  it('keeps a declared ceiling authoritative and never raises it', () => {
    const service = new RateLimitService({ now: () => NOW });
    service.declareCeilings('declared', { maxRequestsPerMinute: 5 }, NOW);
    service.record('declared', { requests: 1, tokens: 0 }, NOW);
    expect(service.check('declared', { maxRequestsPerMinute: 50 }, 0, NOW).allowed).toBe(true);
    expect(service.ceilingsFor('declared').maxRequestsPerMinute).toBe(5);
  });

  it('bounds tracked scopes so an endpoint sweep cannot grow forever', () => {
    const service = new RateLimitService({ now: () => NOW, maxScopes: 3 });
    for (let i = 0; i < 10; i++) service.record(`scope-${i}`, { requests: 1, tokens: 1 }, NOW + i);
    expect(service.scopesSnapshot().length).toBeLessThanOrEqual(3);
    service.clear();
    expect(service.scopesSnapshot()).toHaveLength(0);
  });

  it('reports an honest snapshot for the dashboard', () => {
    const service = new RateLimitService({ now: () => NOW });
    service.record('dash', { requests: 1, tokens: 120 }, NOW);
    service.record('dash', { requests: 1, tokens: 80 }, NOW + 10);
    const snapshot = service.snapshot('dash', { maxRequestsPerMinute: 10, maxTokensPerMinute: 500 }, NOW + 20);
    expect(snapshot).toMatchObject({
      scope: 'dash',
      requestsInWindow: 2,
      tokensInWindow: 200,
      requestsInDay: 2,
      tokensInDay: 200,
      nextAllowedAt: 0,
      cooldownUntil: 0,
    });
    expect(snapshot.ceilings.maxRequestsPerMinute).toBe(10);
  });
});

describe('rate limiting: provider header parsing', () => {
  it('parses Retry-After as delta-seconds or HTTP date', () => {
    expect(parseRetryAfterMs('30', NOW)).toBe(30_000);
    expect(parseRetryAfterMs('1.5', NOW)).toBe(1_500);
    expect(parseRetryAfterMs(new Date(NOW + 5_000).toUTCString(), NOW)).toBeGreaterThan(4_000);
    expect(parseRetryAfterMs('garbage', NOW)).toBe(0);
    expect(parseRetryAfterMs(null, NOW)).toBe(0);
    expect(parseRetryAfterMs(undefined, NOW)).toBe(0);
  });

  it('parses reset durations, bare seconds and dates', () => {
    expect(parseResetMs('1.5s', NOW)).toBe(1_500);
    expect(parseResetMs('500ms', NOW)).toBe(500);
    expect(parseResetMs('2m', NOW)).toBe(120_000);
    expect(parseResetMs('1h30m', NOW)).toBe(5_400_000);
    expect(parseResetMs('45', NOW)).toBe(45_000);
    expect(parseResetMs(new Date(NOW + 2_000).toUTCString(), NOW)).toBeGreaterThan(1_000);
    expect(parseResetMs('later', NOW)).toBe(0);
  });

  it('normalizes the full rate-limit header set', () => {
    const parsed = parseRateLimitHeaders(headers({
      'x-ratelimit-remaining-requests': '42',
      'x-ratelimit-remaining-tokens': '9000',
      'x-ratelimit-reset-requests': '1s',
      'x-ratelimit-reset-tokens': '2s',
      'retry-after': '3',
    }), NOW);
    expect(parsed.remainingRequests).toBe(42);
    expect(parsed.remainingTokens).toBe(9_000);
    expect(parsed.resetMs).toBe(2_000);
    expect(parsed.retryAfterMs).toBe(3_000);
    expect(parseRateLimitHeaders(null, NOW)).toEqual({ resetMs: 0, retryAfterMs: 0 });
    expect(parseRateLimitHeaders({ get: () => null }, NOW)).toEqual({ resetMs: 0, retryAfterMs: 0 });
  });

  it('builds a canonical scope key per endpoint', () => {
    expect(rateLimitScopeFor('openai', 'https://API.openai.com/v1/')).toBe('openai:https://api.openai.com/v1');
    expect(rateLimitScopeFor('ollama', 'http://localhost:11434')).toBe('ollama:http://localhost:11434');
  });
});
