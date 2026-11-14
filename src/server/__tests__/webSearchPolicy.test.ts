import { describe, expect, it } from 'vitest';
import {
  WEB_SEARCH_LIMITS,
  boundPageContent,
  boundSnippet,
  dailyBucket,
  formatCitation,
  formatCitations,
  isSearchQueryAllowed,
  sanitizeFetchUrls,
  sanitizeSearchQuery,
  searchBudgetMessage,
  withinSearchBudget,
} from '../../shared/webSearchPolicy.js';

describe('web search policy', () => {
  it('sanitizes queries: bounded, secret-free, path-free', () => {
    expect(sanitizeSearchQuery('  React   19 use hook  ')).toBe('React 19 use hook');
    expect(sanitizeSearchQuery('key is sk-abcdefghijklmnopqrstuvwx now')).toBe('key is [redacted-key] now');
    expect(sanitizeSearchQuery('Authorization: Bearer abcdefghijklmnopqrst')).toBe('Authorization: Bearer [redacted]');
    expect(sanitizeSearchQuery('compare D:\\QUILLIX\\project\\app.ts with react')).toBe('compare [redacted-path] with react');
    expect(sanitizeSearchQuery('check /home/ana/project/app.ts docs')).toBe('check [redacted-path] docs');
    expect(sanitizeSearchQuery('api_key=SUPERSECRETVALUE123 query')).toBe('api_key=[redacted] query');
    expect(sanitizeSearchQuery('x'.repeat(1000)).length).toBe(WEB_SEARCH_LIMITS.maxQueryChars);
    expect(sanitizeSearchQuery('   ')).toBe('');
    expect(sanitizeSearchQuery(undefined)).toBe('');
    expect(isSearchQueryAllowed('react hooks')).toBe(true);
    expect(isSearchQueryAllowed(' a ')).toBe(false);
    expect(isSearchQueryAllowed('sk-abcdefghijklmnopqrstuvwx')).toBe(true); // still a query, but redacted inside
  });

  it('accepts only bounded http(s) fetch URLs', () => {
    expect(sanitizeFetchUrls(['https://react.dev/reference', 'http://example.com', 'ftp://nope', 'javascript:alert(1)']))
      .toEqual(['https://react.dev/reference', 'http://example.com']);
    expect(sanitizeFetchUrls(['https://a.com', 'https://a.com', 'https://b.com'])).toEqual(['https://a.com', 'https://b.com']);
    expect(sanitizeFetchUrls(['https://a.com', 'https://b.com', 'https://c.com', 'https://d.com'])).toHaveLength(WEB_SEARCH_LIMITS.maxUrlsPerFetch);
    expect(sanitizeFetchUrls('not-an-array')).toEqual([]);
    expect(sanitizeFetchUrls([123, null])).toEqual([]);
  });

  it('enforces the daily search budget honestly', () => {
    expect(withinSearchBudget({ date: '2026-11-12', searches: 49, cap: 50 })).toBe(true);
    expect(withinSearchBudget({ date: '2026-11-12', searches: 50, cap: 50 })).toBe(false);
    expect(withinSearchBudget({ date: '2026-11-12', searches: 0, cap: 0 })).toBe(false);
    expect(searchBudgetMessage(50, 50)).toMatch(/Daily web search budget reached \(50\/50\)/);
    expect(dailyBucket(new Date(2026, 10, 12))).toBe('2026-11-12');
    expect(dailyBucket(new Date(2026, 0, 1))).toBe('2026-01-01');
  });

  it('formats bounded citations the model can quote', () => {
    expect(formatCitation(1, { title: 'React Docs', url: 'https://react.dev/x', domain: 'react.dev' })).toBe('[1] React Docs — react.dev');
    expect(formatCitation(2, { url: 'https://x.dev/y' })).toBe('[2] https://x.dev/y');
    const citations = formatCitations([
      { title: 'A', url: 'https://a.dev', domain: 'a.dev' },
      { title: 'B', url: 'https://b.dev', domain: 'b.dev' },
    ]);
    expect(citations.split('\n')).toEqual(['[1] A — a.dev', '[2] B — b.dev']);
    expect(boundSnippet('x'.repeat(50), 10)).toBe('x'.repeat(10) + '…');
    expect(boundSnippet('short')).toBe('short');
    expect(boundPageContent('x'.repeat(50), 10)).toContain('[page truncated]');
    expect(boundPageContent('short')).toBe('short');
  });
});
