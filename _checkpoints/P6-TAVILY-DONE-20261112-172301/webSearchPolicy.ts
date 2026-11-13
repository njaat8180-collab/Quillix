/**
 * Web search / fetch policy for the Tavily-powered tools (M-TAVILY-*).
 *
 * Pure, testable rules shared by the Tavily service, the agent tools and the
 * research endpoint:
 *  - queries are bounded and stripped of anything that looks like a secret or a
 *    local path (a search query must never leak a credential or the user's
 *    filesystem layout to a third party);
 *  - results, snippets and fetched pages are bounded before they can reach the
 *    model or the UI;
 *  - a daily search budget protects free-tier credits;
 *  - citations have one canonical compact format the model can quote.
 */

export const WEB_SEARCH_LIMITS = {
  maxQueryChars: 400,
  maxResults: 5,
  maxSnippetChars: 500,
  maxPageChars: 20_000,
  maxUrlsPerFetch: 3,
  dailySearchBudget: 50,
} as const;

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\bsk-[A-Za-z0-9_-]{12,}\b/g, '[redacted-key]'],
  [/\b(?:gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,})\b/g, '[redacted-token]'],
  [/\bBearer\s+[A-Za-z0-9._-]{12,}/gi, 'Bearer [redacted]'],
  [/\b(api[_-]?key|token|secret|password|passwd|pwd)\s*[:=]\s*\S+/gi, '$1=[redacted]'],
  [/\b[A-Za-z]:\\[^\s]+/g, '[redacted-path]'],          // C:\Users\...
  [/(?:^|\s)\/(?:home|Users|etc|var|opt|tmp)\/[^\s]+/g, ' [redacted-path]'],
];

/** Bounded, secret-free search query. Empty when nothing safe remains. */
export function sanitizeSearchQuery(raw: unknown): string {
  let value = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!value) return '';
  for (const [pattern, replacement] of SECRET_PATTERNS) value = value.replace(pattern, replacement);
  return value.slice(0, WEB_SEARCH_LIMITS.maxQueryChars).trim();
}

/** True when the query is safe to send to a network search provider. */
export function isSearchQueryAllowed(raw: unknown): boolean {
  return sanitizeSearchQuery(raw).length >= 2;
}

/** Only http(s) URLs, bounded, de-duplicated. */
export function sanitizeFetchUrls(raw: unknown, max = WEB_SEARCH_LIMITS.maxUrlsPerFetch): string[] {
  if (!Array.isArray(raw)) return [];
  const urls = raw
    .filter((url): url is string => typeof url === 'string')
    .map(url => url.trim())
    .filter(url => /^https?:\/\//i.test(url) && url.length <= 2048);
  return [...new Set(urls)].slice(0, Math.max(1, max));
}

/** Today's date bucket key (local time), e.g. 2026-11-12. */
export function dailyBucket(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export interface SearchBudgetInput { date: string; searches: number; cap: number }

/** True while today's search count is under the cap. */
export function withinSearchBudget(input: SearchBudgetInput): boolean {
  const cap = Number.isFinite(input.cap) && input.cap >= 0 ? Math.floor(input.cap) : WEB_SEARCH_LIMITS.dailySearchBudget;
  return input.searches < cap;
}

export function searchBudgetMessage(searches: number, cap: number): string {
  return `Daily web search budget reached (${searches}/${cap}). Raise the limit in Settings (Tavily) to continue today.`;
}

export interface CitationSource {
  title?: string;
  url: string;
  domain?: string;
  official?: boolean;
}

/** Canonical compact citation line: `[1] Title — domain`. */
export function formatCitation(index: number, source: CitationSource): string {
  const title = String(source.title || source.url || 'Untitled').replace(/\s+/g, ' ').slice(0, 120);
  const domain = source.domain || '';
  return `[${index}] ${title}${domain ? ` — ${domain}` : ''}`;
}

/** A bounded, citable source list for a tool result or research summary. */
export function formatCitations(sources: CitationSource[], max = WEB_SEARCH_LIMITS.maxResults): string {
  return sources.slice(0, max).map((source, index) => formatCitation(index + 1, source)).join('\n');
}

/** Bounded snippet for model context / UI display. */
export function boundSnippet(text: unknown, max: number = WEB_SEARCH_LIMITS.maxSnippetChars): string {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim();
  const limit = Math.max(1, Math.floor(max));
  return value.length > limit ? value.slice(0, limit) + '…' : value;
}

/** Bounded fetched-page content. */
export function boundPageContent(text: unknown, max: number = WEB_SEARCH_LIMITS.maxPageChars): string {
  const value = String(text ?? '').replace(/\r/g, '');
  const limit = Math.max(1, Math.floor(max));
  return value.length > limit ? value.slice(0, limit) + '\n… [page truncated]' : value;
}
