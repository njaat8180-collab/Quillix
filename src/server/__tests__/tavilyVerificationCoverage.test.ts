import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TavilyVerificationService, buildTavilyClaimReport, compareTavilyEvidence, extractTavilyClaims, tavilyCostPerCreditUsd } from '../tavilyVerification.js';

vi.mock('@tavily/core', () => ({
  tavily: () => ({
    search: async (query: string, options: Record<string, unknown>) => {
      const response = await fetch('https://tavily.test/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query, ...options }),
      });
      if (!response.ok) {
        const error = new Error(`Tavily HTTP ${response.status}`) as Error & { status: number };
        error.status = response.status;
        throw error;
      }
      return response.json();
    },
    extract: async (urls: string[], options: Record<string, unknown>) => {
      const response = await fetch('https://tavily.test/extract', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ urls, ...options }),
      });
      if (!response.ok) {
        const error = new Error(`Tavily HTTP ${response.status}`) as Error & { status: number };
        error.status = response.status;
        throw error;
      }
      return response.json();
    },
  }),
}));

const stateDirectories: string[] = [];

function makeStateDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-tavily-'));
  stateDirectories.push(directory);
  return directory;
}

function createService(readApiKey: () => string = () => 'test-key'): TavilyVerificationService {
  return new TavilyVerificationService({ stateDirectory: makeStateDirectory(), readApiKey });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
  while (stateDirectories.length) {
    fs.rmSync(stateDirectories.pop()!, { recursive: true, force: true });
  }
});

describe('Tavily verification service', () => {
  it('verifies an answer using stubbed search and extract HTTP responses', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const endpoint = String(url);
      if (endpoint.endsWith('/search')) {
        return new Response(JSON.stringify({
          query: 'current api',
          responseTime: 0.1,
          requestId: 'search-request',
          usage: { credits: 1 },
          results: [{
            title: 'Official API docs',
            url: 'https://docs.example.com/current-api',
            content: 'The current API is supported.',
            score: 0.95,
            publishedDate: '2026-01-01',
          }],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({
        requestId: 'extract-request',
        responseTime: 0.1,
        usage: { credits: 1 },
        failedResults: [],
        results: [{ url: 'https://docs.example.com/current-api', title: 'Official API docs', rawContent: 'The current API is supported.' }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await createService().verify({
      query: 'current api',
      answer: 'The current API is supported.',
    });

    expect(result.finding).toBe('supported');
    expect(result.sources[0]).toMatchObject({ domain: 'docs.example.com', official: true });
    expect(result.usage).toEqual({ searches: 1, extracts: 1, credits: 2, estimatedCostUsd: 0.016 });
    expect(result.claims[0]).toMatchObject({ text: 'The current API is supported.', timeSensitive: true, finding: 'supported' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects verification without an API key without making a request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const service = createService(() => '');

    await expect(service.verify({ query: 'current api', answer: 'Current information.' }))
      .rejects.toThrow('Save a Tavily API key first');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces an HTTP error from the Tavily API', async () => {
    const fetchMock = vi.fn(async () => new Response('server error', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    const service = createService();

    await expect(service.verify({ query: 'current api', answer: 'Current information.' }))
      .rejects.toThrow('Tavily verification failed');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('surfaces a malformed Tavily response', async () => {
    const fetchMock = vi.fn(async () => new Response('{not-json', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const service = createService();

    await expect(service.verify({ query: 'current api', answer: 'Current information.' }))
      .rejects.toThrow('Tavily verification failed');
  });

  it('returns an offline result without network access', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await createService().verify({ query: 'offline api check', answer: 'The offline API is unavailable.', offline: true });

    expect(result.finding).toBe('offline');
    expect(result.offlineFallback).toBe(true);
    expect(result.freshnessScore).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports configured state and usage without contacting the network', () => {
    const service = createService(() => 'configured');
    expect(service.isConfigured()).toBe(true);
    expect(service.usageSnapshot()).toMatchObject({ searches: 0, extracts: 0, credits: 0, verifications: 0 });
    expect(service.historySnapshot()).toEqual([]);
    expect(service.budgetStatus(5)).toMatchObject({ cap: 5, remaining: 5, allowed: true });
  });
});

describe('Tavily evidence and claim helpers', () => {
  it('extracts bounded unique source claims', () => {
    const claims = extractTavilyClaims('- First claim that is sufficiently long.\nSecond claim that is sufficiently long. First claim that is sufficiently long.');
    expect(claims).toEqual([
      'First claim that is sufficiently long.',
      'Second claim that is sufficiently long.',
    ]);
    expect(extractTavilyClaims('short')).toEqual([]);
  });

  it('compares claims against official source evidence', () => {
    const sources = [{
      title: 'Official docs',
      url: 'https://docs.example.com/api',
      domain: 'docs.example.com',
      official: true,
      content: 'The current API is supported.',
    }];
    expect(compareTavilyEvidence('The current API is supported.', sources).finding).toBe('supported');
    expect(compareTavilyEvidence('The old API is deprecated.', sources).finding).toBe('possibly_stale');
    expect(compareTavilyEvidence('Anything', []).finding).toBe('unverified');
  });

  it('builds low-confidence reports for non-time-sensitive claims', () => {
    const report = buildTavilyClaimReport('This package has a useful helper function.', [{
      title: 'Package docs',
      url: 'https://example.com/docs',
      domain: 'example.com',
      official: false,
      content: 'The helper function is useful.',
    }]);
    expect(report.claims).toHaveLength(1);
    expect(report.claims[0]).toMatchObject({ timeSensitive: false, finding: 'unverified', confidence: 0.2 });
    expect(report.freshnessScore).toBe(0);
  });

  it('uses a configured Tavily credit cost', () => {
    const previous = process.env.QUILLIX_TAVILY_COST_PER_CREDIT_USD;
    process.env.QUILLIX_TAVILY_COST_PER_CREDIT_USD = '0.02';
    expect(tavilyCostPerCreditUsd()).toBe(0.02);
    process.env.QUILLIX_TAVILY_COST_PER_CREDIT_USD = '-1';
    expect(tavilyCostPerCreditUsd()).toBe(0.008);
    if (previous === undefined) delete process.env.QUILLIX_TAVILY_COST_PER_CREDIT_USD;
    else process.env.QUILLIX_TAVILY_COST_PER_CREDIT_USD = previous;
  });
});
