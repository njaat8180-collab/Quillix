import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const search = vi.fn();
const extract = vi.fn();
vi.mock('@tavily/core', () => ({ tavily: () => ({ search, extract }) }));

import { TavilyVerificationService, buildTavilyClaimReport } from '../tavilyVerification.js';

const testStateDirectory = path.join(process.cwd(), '.quillix-test', `tavily-${process.pid}`);
const createService = () => new TavilyVerificationService({
  stateDirectory: testStateDirectory,
  readApiKey: () => process.env.TAVILY_API_KEY?.trim() || '',
});

afterAll(() => {
  fs.rmSync(testStateDirectory, { recursive: true, force: true });
});

describe('Tavily stale-answer verification', () => {
  beforeEach(() => {
    fs.rmSync(testStateDirectory, { recursive: true, force: true });
    fs.mkdirSync(testStateDirectory, { recursive: true });
    search.mockReset();
    extract.mockReset();
    process.env.TAVILY_API_KEY = 'tvly-test-key';
  });

  it('fails closed in Offline Mode without contacting Tavily', async () => {
    const service = createService();
    const result = await service.verify({ query: 'What is the current API?', answer: 'old answer', offline: true });
    expect(result.finding).toBe('offline');
    expect(result.offlineFallback).toBe(true);
    expect(search).not.toHaveBeenCalled();
    expect(extract).not.toHaveBeenCalled();
  });

  it('searches, extracts selected sources, prioritizes official docs, and detects an unsupported version claim', async () => {
    search.mockResolvedValue({
      query: 'React current API', responseTime: 0.1, requestId: 'search-1', usage: { credits: 1 },
      results: [
        { title: 'Blog copy', url: 'https://blog.example.com/react', content: 'React v18 uses the old API.', score: 0.99, publishedDate: '2024-01-01' },
        { title: 'React docs', url: 'https://react.dev/reference/react', content: 'Use the current API.', score: 0.8, publishedDate: '2026-01-01' },
      ],
    });
    extract.mockResolvedValue({
      requestId: 'extract-1', responseTime: 0.2, usage: { credits: 1 }, failedResults: [],
      results: [{ url: 'https://react.dev/reference/react', title: 'React docs', rawContent: 'The current API is supported in React v19.' }],
    });
    const service = createService();
    const result = await service.verify({ query: 'React current API', answer: 'Use React v18 current API.' });
    expect(result.finding).toBe('possibly_stale');
    expect(result.sources[0].official).toBe(true);
    expect(result.usage).toEqual({ searches: 1, extracts: 1, credits: 2, estimatedCostUsd: 0.016 });
    expect(search).toHaveBeenCalledTimes(1);
    expect(extract).toHaveBeenCalledTimes(1);
  });

  it('reuses a fresh result without spending another search or extract call', async () => {
    search.mockResolvedValue({ query: 'cache test', responseTime: 0, requestId: 's', usage: { credits: 1 }, results: [{ title: 'Docs', url: 'https://docs.example.com/api', content: 'supported', score: 0.9 }] });
    extract.mockResolvedValue({ requestId: 'e', responseTime: 0, usage: { credits: 1 }, failedResults: [], results: [{ url: 'https://docs.example.com/api', rawContent: 'supported' }] });
    const service = createService();
    const first = await service.verify({ query: 'cache test', answer: 'supported' });
    const second = await service.verify({ query: 'cache test', answer: 'supported' });
    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(search).toHaveBeenCalledTimes(1);
    expect(extract).toHaveBeenCalledTimes(1);
  });

  it('extracts bounded time-sensitive claims and computes a freshness score', () => {
    const sources = [{
      title: 'Official API docs', url: 'https://docs.example.com/current', domain: 'docs.example.com', official: true,
      content: 'The current API is supported in version v19. The old API is deprecated and removed.',
    }];
    const report = buildTavilyClaimReport('Use the current API in version v19. The old API is deprecated.', sources);
    expect(report.claims).toHaveLength(2);
    expect(report.claims.every(claim => claim.timeSensitive)).toBe(true);
    expect(report.claims.some(claim => claim.finding === 'supported')).toBe(true);
    expect(report.claims[0].sourceUrls).toContain('https://docs.example.com/current');
    expect(report.freshnessScore).toBeGreaterThan(0);
  });

  it('keeps claim output bounded and fail-closed in offline mode', () => {
    const answer = Array.from({ length: 30 }, (_, index) => `Version ${index + 1} is current.`).join(' ');
    const report = buildTavilyClaimReport(answer, [], 'offline');
    expect(report.claims.length).toBeLessThanOrEqual(12);
    expect(report.claims.every(claim => claim.finding === 'offline')).toBe(true);
    expect(report.freshnessScore).toBe(0);
  });

  it('retries one transient Tavily rate limit without duplicating usage', async () => {
    const rateLimit = Object.assign(new Error('rate limited'), { status: 429, headers: { 'retry-after': '0' } });
    search.mockRejectedValueOnce(rateLimit).mockResolvedValueOnce({
      query: 'retry test', responseTime: 0, requestId: 'retry', usage: { credits: 2 },
      results: [{ title: 'Docs', url: 'https://docs.example.com/retry', content: 'The current API is supported.', score: 0.9 }],
    });
    extract.mockResolvedValue({ requestId: 'extract-retry', responseTime: 0, usage: { credits: 0 }, failedResults: [], results: [] });
    const service = createService();
    const result = await service.verify({ query: 'retry test', answer: 'The current API is supported.' });
    expect(result.finding).toBe('supported');
    expect(search).toHaveBeenCalledTimes(2);
    expect(result.usage.credits).toBe(2);
  });
});
