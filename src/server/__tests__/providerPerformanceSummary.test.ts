import { describe, expect, it } from 'vitest';
import { calculateReportedOutputTokensPerSecond, summarizeProviderHealth } from '../universal.js';

// M7.5 / phases 13 & 17 — a compact, decision-ready health view derived from
// the existing provider diagnostics (purely observational; never bypasses
// quota/billing). Feeds the Studio performance monitor and the benchmarks.
describe('provider health summary', () => {
  it('calculates generated throughput from output tokens only', () => {
    expect(calculateReportedOutputTokensPerSecond(40, 2_000)).toBe(20);
    expect(calculateReportedOutputTokensPerSecond(0, 2_000)).toBe(0);
    expect(calculateReportedOutputTokensPerSecond(40, 0)).toBe(0);
  });

  it('reports ok for a clean, all-success snapshot', () => {
    const h = summarizeProviderHealth({ requests: 10, httpSuccesses: 10, averageResponseLatencyMs: 200, tokensPerSecond: 50, effectiveRequestIntervalMs: 250, waitingMs: 0 });
    expect(h.availability).toBe('ok');
    expect(h.successRate).toBe(1);
    expect(h.failures).toBe(0);
    expect(h.averageLatencyMs).toBe(200);
    expect(h.effectiveIntervalMs).toBe(250);
    expect(h.recommendedWaitMs).toBe(0);
  });

  it('classifies throttled / auth / billing from status counters', () => {
    expect(summarizeProviderHealth({ requests: 5, httpSuccesses: 4, http429: 1 }).availability).toBe('throttled');
    expect(summarizeProviderHealth({ requests: 2, httpSuccesses: 0, http401: 1 }).availability).toBe('auth');
    expect(summarizeProviderHealth({ requests: 2, httpSuccesses: 0, http403: 1 }).availability).toBe('auth');
    expect(summarizeProviderHealth({ requests: 2, httpSuccesses: 0, http402: 1 }).availability).toBe('billing');
  });

  it('prioritizes circuit-open, then cooldown and degraded', () => {
    expect(summarizeProviderHealth({ requests: 3, httpSuccesses: 0, http429: 3, circuitOpenUntil: Date.now() + 5000 }).availability).toBe('circuit-open');
    expect(summarizeProviderHealth({ requests: 3, httpSuccesses: 1, cooldownUntil: Date.now() + 3000 }).availability).toBe('cooldown');
    expect(summarizeProviderHealth({ requests: 3, httpSuccesses: 1, consecutiveServerFailures: 2 }).availability).toBe('degraded');
  });

  it('is unknown with no requests and computes failure count/success rate', () => {
    expect(summarizeProviderHealth({}).availability).toBe('unknown');
    const h = summarizeProviderHealth({ requests: 4, httpSuccesses: 1 });
    expect(h.successRate).toBe(0.25);
    expect(h.failures).toBe(3);
  });

  it('carries recommended wait and queue depth through', () => {
    const h = summarizeProviderHealth({ requests: 1, httpSuccesses: 0, http429: 1, waitingMs: 1500, queuedRequests: 3 });
    expect(h.recommendedWaitMs).toBe(1500);
    expect(h.queueDepth).toBe(3);
    expect(h.rateLimited).toBe(true);
  });
});
