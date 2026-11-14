import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { tavily, type TavilySearchResponse, type TavilyExtractResponse, type TavilyClient } from '@tavily/core';
import { dpapi } from './sarvam.js';
import {
  WEB_SEARCH_LIMITS,
  boundPageContent,
  boundSnippet,
  dailyBucket,
  formatCitations,
  isSearchQueryAllowed,
  sanitizeFetchUrls,
  sanitizeSearchQuery,
  withinSearchBudget,
} from '../shared/webSearchPolicy.js';
import { readEnvNumber } from '../shared/envNumbers.js';
import { redactSensitiveText } from '../shared/secretRedaction.js';

export type TavilyFinding = 'supported' | 'possibly_stale' | 'contradicted' | 'unverified' | 'offline';
export type TavilySource = {
  title: string;
  url: string;
  domain: string;
  score?: number;
  publishedDate?: string;
  content?: string;
  rawContent?: string;
  official: boolean;
};
export type TavilyClaim = {
  text: string;
  timeSensitive: boolean;
  finding: TavilyFinding;
  confidence: number;
  sourceUrls: string[];
};
export type TavilyVerificationResult = {
  id: string;
  query: string;
  answer: string;
  finding: TavilyFinding;
  explanation: string;
  suggestedAction?: string;
  sources: TavilySource[];
  searchedAt: string;
  cached: boolean;
  usage: { searches: number; extracts: number; credits: number; estimatedCostUsd: number };
  claims: TavilyClaim[];
  freshnessScore: number;
  offlineFallback?: boolean;
};
export type TavilyHistoryEntry = {
  id: string;
  queryPreview: string;
  finding: TavilyFinding;
  explanation: string;
  freshnessScore: number;
  sourceUrls: string[];
  searchedAt: string;
  cached: boolean;
  usage: TavilyVerificationResult['usage'];
};

type StoredUsage = { searches: number; extracts: number; credits: number; estimatedCostUsd: number; verifications: number; updatedAt: string; daily?: { date: string; searches: number; extracts: number } };
type CacheRecord = { expiresAt: number; result: TavilyVerificationResult };
type SearchCacheRecord = { expiresAt: number; result: TavilyWebSearchResult };
type ExtractCacheRecord = { expiresAt: number; result: TavilyWebExtractResult };

/** Result of a plain web search (M-TAVILY-1). */
export type TavilyWebSearchResult = {
  query: string;
  answer?: string;
  results: TavilySource[];
  citations: string;
  usage: { searches: number; extracts: number; credits: number; estimatedCostUsd: number };
  searchedAt: string;
  cached: boolean;
};

/** Result of fetching a page into context (M-TAVILY-2). */
export type TavilyWebExtractResult = {
  pages: Array<{ url: string; title: string; content: string }>;
  failedUrls: string[];
  usage: { searches: number; extracts: number; credits: number; estimatedCostUsd: number };
  fetchedAt: string;
  cached: boolean;
};

const stateDir = process.env.QUILLIX_STATE_DIR?.trim()
  ? path.resolve(process.env.QUILLIX_STATE_DIR.trim())
  : path.join(os.homedir(), '.quillix');
const keyFile = path.join(stateDir, 'tavily-key.dpapi.json');
const CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_CACHE_ENTRIES = 64;
const cache = new Map<string, CacheRecord>();
const TAVILY_MAX_ATTEMPTS = 2;

function safeTavilyError(action: 'verification' | 'search' | 'extract', error: unknown): Error {
  const value = error as any;
  const status = Number(value?.status ?? value?.statusCode ?? value?.response?.status);
  if (Number.isInteger(status) && status >= 400 && status <= 599) {
    return new Error(`Tavily ${action} failed (HTTP ${status}). Check the API key, account access and endpoint.`);
  }
  const detail = redactSensitiveText(String(value?.message || error || ''));
  if (/^Save a Tavily API key first/i.test(detail)) return new Error(detail);
  return new Error(`Tavily ${action} failed. Check the API key, endpoint and network connection.`);
}

function configuredTavilyBaseUrl(): string | undefined {
  const raw = process.env.QUILLIX_TAVILY_BASE_URL?.trim();
  if (!raw) return undefined;
  let url: URL;
  try { url = new URL(raw); }
  catch { throw new Error('QUILLIX_TAVILY_BASE_URL must be a valid HTTPS URL or a loopback HTTP URL.'); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname.toLowerCase());
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
      url.username || url.password || url.search || url.hash) {
    throw new Error('QUILLIX_TAVILY_BASE_URL must use HTTPS (HTTP is allowed only on loopback) and must not contain credentials, query, or fragment data.');
  }
  return url.toString().replace(/\/+$/, '');
}

/** Tavily's current pay-as-you-go reference is $0.008 per credit. Allow an
 * account-specific override because plan pricing and currency can differ. */
export function tavilyCostPerCreditUsd(): number {
  return readEnvNumber('QUILLIX_TAVILY_COST_PER_CREDIT_USD', 0.008, { min: 0 });
}

function cleanKey(value: string): string {
  const key = String(value || '').trim();
  if (!key || key.length > 4096 || /[\r\n]/.test(key)) throw new Error('Enter a valid Tavily API key.');
  return key;
}

export function saveTavilyKey(value: string): void {
  const key = cleanKey(value);
  const encrypted = dpapi('protect', key);
  if (dpapi('unprotect', encrypted) !== key) throw new Error('Windows secure storage verification failed for Tavily key.');
  fs.mkdirSync(stateDir, { recursive: true });
  const temp = `${keyFile}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify({ format: 'dpapi-current-user-v1', data: encrypted }), { mode: 0o600, flag: 'wx' });
    fs.renameSync(temp, keyFile);
  } finally {
    try { fs.unlinkSync(temp); } catch (error: any) { if (error?.code !== 'ENOENT') throw error; }
  }
}

export function readTavilyKey(): string {
  if (!fs.existsSync(keyFile)) return process.env.TAVILY_API_KEY?.trim() || '';
  const record = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
  if (record?.format !== 'dpapi-current-user-v1' || typeof record.data !== 'string') throw new Error('Saved Tavily key format is invalid.');
  return dpapi('unprotect', record.data);
}

export function hasTavilyKey(): boolean { try { return !!readTavilyKey(); } catch { return false; } }
export function clearTavilyKey(): void { try { fs.unlinkSync(keyFile); } catch (error: any) { if (error?.code !== 'ENOENT') throw error; } }

function loadUsage(directory = stateDir): StoredUsage {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(directory, 'tavily-usage.json'), 'utf8'));
    if (value && typeof value === 'object') return { searches: Number(value.searches) || 0, extracts: Number(value.extracts) || 0, credits: Number(value.credits) || 0, estimatedCostUsd: Number(value.estimatedCostUsd) || 0, verifications: Number(value.verifications) || 0, updatedAt: String(value.updatedAt || ''), daily: normalizeDaily(value.daily) };
  } catch { /* first run or a recoverable telemetry file error */ }
  return { searches: 0, extracts: 0, credits: 0, estimatedCostUsd: 0, verifications: 0, updatedAt: '', daily: { date: dailyBucket(), searches: 0, extracts: 0 } };
}

/** Daily buckets reset when the local date changes; a corrupt bucket is ignored. */
function normalizeDaily(value: unknown): { date: string; searches: number; extracts: number } {
  const today = dailyBucket();
  if (value && typeof value === 'object' && (value as any).date === today) {
    return { date: today, searches: Number((value as any).searches) || 0, extracts: Number((value as any).extracts) || 0 };
  }
  return { date: today, searches: 0, extracts: 0 };
}

function recordUsage(searches: number, extracts: number, credits: number, directory = stateDir): StoredUsage {
  const current = loadUsage(directory);
  const daily = current.daily ?? { date: dailyBucket(), searches: 0, extracts: 0 };
  const next = { searches: current.searches + searches, extracts: current.extracts + extracts, credits: current.credits + credits, estimatedCostUsd: current.estimatedCostUsd + credits * tavilyCostPerCreditUsd(), verifications: current.verifications + 1, updatedAt: new Date().toISOString(), daily: { date: daily.date, searches: daily.searches + searches, extracts: daily.extracts + extracts } };
  try {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'tavily-usage.json'), JSON.stringify(next, null, 2), { mode: 0o600 });
  } catch { /* telemetry must never break verification */ }
  return next;
}

function loadHistory(directory = stateDir): TavilyHistoryEntry[] {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(directory, 'tavily-history.json'), 'utf8'));
    return Array.isArray(value) ? value.filter(entry => entry && typeof entry.id === 'string').slice(0, 50) : [];
  } catch { return []; }
}

function recordHistory(result: TavilyVerificationResult, directory = stateDir): void {
  const entry: TavilyHistoryEntry = {
    id: result.id,
    queryPreview: result.query.slice(0, 160),
    finding: result.finding,
    explanation: result.explanation.slice(0, 500),
    freshnessScore: result.freshnessScore,
    sourceUrls: result.sources.slice(0, 5).map(source => source.url),
    searchedAt: result.searchedAt,
    cached: result.cached,
    usage: result.usage,
  };
  try {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'tavily-history.json'), JSON.stringify([entry, ...loadHistory(directory)].slice(0, 50), null, 2), { mode: 0o600 });
  } catch { /* durable audit history must never break the verification result */ }
}

function hostOf(url: string): string {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ''; }
}

function isOfficialSource(url: string, query: string): boolean {
  const host = hostOf(url);
  if (!host) return false;
  if (/^(docs?|developer|api)\./.test(host) || /\.github\.com$/.test(host) || /\.(gov|edu)$/.test(host)) return true;
  const queryTerms = query.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) || [];
  const hostnameWithoutWww = host.replace(/^www\./, '');
  return queryTerms.some(term => hostnameWithoutWww === `${term}.dev` || hostnameWithoutWww.startsWith(`${term}.`) || hostnameWithoutWww.includes(`${term}js.`));
}

function sourceFromSearch(result: any, query: string): TavilySource {
  return { title: String(result.title || result.url || 'Untitled source'), url: String(result.url || ''), domain: hostOf(String(result.url || '')), score: Number.isFinite(result.score) ? result.score : undefined, publishedDate: result.publishedDate || undefined, content: String(result.content || ''), official: isOfficialSource(String(result.url || ''), query) };
}

function cacheKey(query: string, answer: string, urls: string[]): string {
  return createHash('sha256').update(JSON.stringify({ query: query.trim(), answer: answer.trim(), urls: [...urls].sort() })).digest('hex');
}

function retryAfterMs(error: any, attempt: number): number {
  const header = error?.headers?.['retry-after'] ?? error?.headers?.get?.('retry-after') ?? error?.response?.headers?.get?.('retry-after');
  const parsed = Number(header);
  if (Number.isFinite(parsed) && parsed >= 0) return Math.min(2_000, parsed > 20 ? parsed * 1_000 : parsed);
  return Math.min(2_000, 250 * (2 ** attempt));
}

function isTransientTavilyError(error: any): boolean {
  const status = Number(error?.status ?? error?.statusCode ?? error?.response?.status);
  return status === 408 || status === 409 || status === 429 || status >= 500 || /timeout|timed out|fetch failed|network|econnreset|temporar|overload|rate.?limit/i.test(String(error?.message || error));
}

async function withTavilyRetry<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < TAVILY_MAX_ATTEMPTS; attempt += 1) {
    try { return await operation(); } catch (error) {
      lastError = error;
      if (attempt + 1 >= TAVILY_MAX_ATTEMPTS || !isTransientTavilyError(error)) throw error;
      await new Promise(resolve => setTimeout(resolve, retryAfterMs(error, attempt)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Tavily request failed.');
}

export function compareTavilyEvidence(answer: string, sources: TavilySource[]): { finding: TavilyFinding; explanation: string } {
  const corpus = sources.map(source => `${source.title}\n${source.content || ''}\n${source.rawContent || ''}`).join('\n').toLowerCase();
  const officialSources = sources.filter(source => source.official);
  const trustedCorpus = (officialSources.length ? officialSources : sources).map(source => `${source.title}\n${source.content || ''}\n${source.rawContent || ''}`).join('\n').toLowerCase();
  const normalizedAnswer = answer.toLowerCase();
  if (!sources.length || !corpus.trim()) return { finding: 'unverified', explanation: 'Tavily returned no usable source content for comparison.' };
  const staleSignals = /\b(deprecated|obsolete|removed|end[- ]of[- ]life|unsupported|legacy|no longer supported|use .+ instead)\b/i;
  const answerHasStaleClaim = staleSignals.test(answer);
  const sourceConfirmsStale = staleSignals.test(trustedCorpus);
  const versionMentions = normalizedAnswer.match(/\b(?:v|version\s*)\d+(?:\.\d+){0,3}\b/gi) || [];
  const versionSupported = versionMentions.length === 0 || versionMentions.some(version => trustedCorpus.includes(version.toLowerCase()));
  if (answerHasStaleClaim && !sourceConfirmsStale) return { finding: 'possibly_stale', explanation: 'The answer contains deprecation or support claims that the retrieved current sources do not corroborate.' };
  if (!versionSupported) return { finding: 'possibly_stale', explanation: 'A version-specific claim in the answer was not found in the retrieved current sources; verify the exact installed version before applying it.' };
  if (!answerHasStaleClaim && sourceConfirmsStale && /\b(current|supported|recommended|safe|use)\b/i.test(answer)) return { finding: 'contradicted', explanation: 'The answer presents the claim as current or supported, while trusted retrieved sources contain deprecation or removal language.' };
  if (answerHasStaleClaim && sourceConfirmsStale && /\b(current|supported|recommended|safe)\b/i.test(answer)) return { finding: 'contradicted', explanation: 'The answer presents a deprecated or legacy claim as current or supported, while trusted retrieved sources say it is deprecated or removed.' };
  if (answerHasStaleClaim && sourceConfirmsStale) return { finding: 'supported', explanation: 'The retrieved sources contain matching deprecation/support language for the answer.' };
  return { finding: 'supported', explanation: 'The answer is supported by the retrieved source material, but citations remain available for human review.' };
}

const timeSensitiveClaim = /\b(?:current|latest|newest|today|now|recent|version|v\d|deprecated|obsolete|removed|supported|recommended|release|breaking|end[- ]of[- ]life|no longer)\b|(?:वर्तमान|नवीनतम|नया|नवीन|आज|संस्करण|समर्थित|अनुशंसित|पुराना)/i;

/** Split an answer into bounded, reviewable claims without another model call. */
export function extractTavilyClaims(answer: string): string[] {
  return [...new Set(String(answer || '').replace(/\s+/g, ' ').split(/(?<=[.!?।])\s+|\n+/)
    .map(claim => claim.trim().replace(/^[\-*\d.)]+\s*/, ''))
    .filter(claim => claim.length >= 12)
    .slice(0, 12))];
}

function claimConfidence(finding: TavilyFinding, sources: TavilySource[], claim: string): number {
  if (finding === 'contradicted') return 0.95;
  if (finding === 'supported') return Math.min(0.98, 0.65 + (sources.some(source => source.official) ? 0.25 : 0.1));
  if (finding === 'possibly_stale') return 0.65;
  if (finding === 'offline') return 0;
  return claim ? 0.2 : 0;
}

export function buildTavilyClaimReport(answer: string, sources: TavilySource[], fallbackFinding?: TavilyFinding): { claims: TavilyClaim[]; freshnessScore: number } {
  const claims = extractTavilyClaims(answer).map(text => {
    const timeSensitive = timeSensitiveClaim.test(text);
    const evidence = fallbackFinding === 'offline'
      ? { finding: 'offline' as TavilyFinding, explanation: 'Offline Mode blocks freshness verification.' }
      : timeSensitive
        ? compareTavilyEvidence(text, sources)
        : { finding: 'unverified' as TavilyFinding, explanation: 'This claim was not classified as time-sensitive; no freshness score was asserted.' };
    const related = sources.filter(source => {
      const terms = text.toLowerCase().match(/[a-z][a-z0-9-]{3,}/g) || [];
      const content = `${source.title} ${source.content || ''} ${source.rawContent || ''}`.toLowerCase();
      return terms.filter(term => content.includes(term)).length >= Math.min(2, terms.length || 1);
    });
    return { text, timeSensitive, finding: evidence.finding, confidence: claimConfidence(evidence.finding, related.length ? related : sources, text), sourceUrls: (related.length ? related : sources).slice(0, 3).map(source => source.url) };
  });
  const scored = claims.filter(claim => claim.timeSensitive);
  const value = (finding: TavilyFinding) => finding === 'supported' ? 1 : finding === 'possibly_stale' ? 0.35 : finding === 'unverified' ? 0.2 : 0;
  return { claims, freshnessScore: scored.length ? Math.round((scored.reduce((sum, claim) => sum + value(claim.finding), 0) / scored.length) * 100) : 0 };
}

export class TavilyVerificationService {
  private readonly stateDirectory: string;
  private readonly readApiKey: () => string;
  private readonly clientFactory: (apiKey: string) => TavilyClient;
  private readonly searchCache = new Map<string, SearchCacheRecord>();
  private readonly extractCache = new Map<string, ExtractCacheRecord>();

  constructor(options: { stateDirectory?: string; readApiKey?: () => string; clientFactory?: (apiKey: string) => TavilyClient } = {}) {
    this.stateDirectory = options.stateDirectory || stateDir;
    this.readApiKey = options.readApiKey || readTavilyKey;
    // QUILLIX_TAVILY_BASE_URL allows a corporate proxy, a self-hosted gateway
    // or a local test double; unset means the real api.tavily.com.
    const baseUrl = configuredTavilyBaseUrl();
    this.clientFactory = options.clientFactory || ((apiKey: string) => tavily({ apiKey, clientSource: 'quillix', ...(baseUrl ? { apiBaseURL: baseUrl } : {}) }));
  }

  private client(): TavilyClient {
    const apiKey = this.readApiKey();
    if (!apiKey) throw new Error('Save a Tavily API key first, or set TAVILY_API_KEY for this session.');
    return this.clientFactory(apiKey);
  }

  private boundedSearchCache(): void {
    while (this.searchCache.size > MAX_CACHE_ENTRIES) this.searchCache.delete(this.searchCache.keys().next().value!);
    while (this.extractCache.size > MAX_CACHE_ENTRIES) this.extractCache.delete(this.extractCache.keys().next().value!);
  }

  /** Today's search budget status for the UI and the tools. */
  public budgetStatus(cap: number = WEB_SEARCH_LIMITS.dailySearchBudget): { date: string; searches: number; extracts: number; cap: number; remaining: number; allowed: boolean } {
    const usage = loadUsage(this.stateDirectory);
    const daily = usage.daily ?? { date: dailyBucket(), searches: 0, extracts: 0 };
    const boundedCap = Number.isFinite(cap) && cap >= 0 ? Math.floor(cap) : WEB_SEARCH_LIMITS.dailySearchBudget;
    return {
      date: daily.date,
      searches: daily.searches,
      extracts: daily.extracts,
      cap: boundedCap,
      remaining: Math.max(0, boundedCap - daily.searches),
      allowed: withinSearchBudget({ date: daily.date, searches: daily.searches, cap: boundedCap }),
    };
  }

  /** Clear cached searches/extracts (Settings action; also frees credits). */
  public clearWebCaches(): void {
    this.searchCache.clear();
    this.extractCache.clear();
  }

  public isConfigured(): boolean { try { return !!this.readApiKey(); } catch { return false; } }
  public usageSnapshot(): StoredUsage { return loadUsage(this.stateDirectory); }
  public historySnapshot(): TavilyHistoryEntry[] { return loadHistory(this.stateDirectory); }

  public async verify(input: { query: string; answer?: string; urls?: string[]; force?: boolean; offline?: boolean }): Promise<TavilyVerificationResult> {
    const query = String(input.query || '').trim().slice(0, 800);
    const answer = String(input.answer || '').trim().slice(0, 20_000);
    if (!query) throw new Error('A verification query is required.');
    const key = cacheKey(query, answer, input.urls || []);
    const cached = !input.force ? cache.get(key) : undefined;
    if (cached && cached.expiresAt > Date.now()) return { ...cached.result, cached: true };
    if (input.offline) {
      const report = buildTavilyClaimReport(answer, [], 'offline');
      const offlineResult: TavilyVerificationResult = { id: randomUUID(), query, answer, finding: 'offline', explanation: 'Offline Mode blocks Tavily network access. No freshness claim was made.', sources: [], searchedAt: new Date().toISOString(), cached: false, usage: { searches: 0, extracts: 0, credits: 0, estimatedCostUsd: 0 }, ...report, offlineFallback: true };
      recordHistory(offlineResult, this.stateDirectory);
      return offlineResult;
    }
    const apiKey = this.readApiKey();
    if (!apiKey) throw new Error('Save a Tavily API key first, or set TAVILY_API_KEY for this session.');
    const client = this.client();
    let search: TavilySearchResponse;
    let extracts: TavilyExtractResponse | undefined;
    try {
      // @tavily/core expects `timeout` in seconds (1–120), not milliseconds.
      search = await withTavilyRetry(() => client.search(query, { searchDepth: 'advanced', maxResults: 5, includeAnswer: false, includeRawContent: false, includeUsage: true, timeout: 20 }));
      const sources = (search.results || []).map(result => sourceFromSearch(result, query)).filter(source => source.url).sort((a, b) => Number(b.official) - Number(a.official) || (b.score || 0) - (a.score || 0));
      const requestedUrls = (input.urls || []).filter(url => /^https?:\/\//i.test(url)).slice(0, 5);
      const extractUrls = [...new Set([...requestedUrls, ...sources.slice(0, 2).map(source => source.url)])].slice(0, 5);
      if (extractUrls.length) extracts = await withTavilyRetry(() => client.extract(extractUrls, { extractDepth: 'basic', format: 'markdown', includeUsage: true, timeout: 20 }));
      const extractedByUrl = new Map((extracts?.results || []).map(result => [result.url, result.rawContent]));
      const merged = sources.map(source => ({ ...source, rawContent: extractedByUrl.get(source.url) })).slice(0, 5);
      const evidence = compareTavilyEvidence(answer, merged);
      const claimReport = buildTavilyClaimReport(answer, merged, evidence.finding);
      const usage = { searches: 1, extracts: extracts ? 1 : 0, credits: Number(search.usage?.credits || 0) + Number(extracts?.usage?.credits || 0), estimatedCostUsd: (Number(search.usage?.credits || 0) + Number(extracts?.usage?.credits || 0)) * tavilyCostPerCreditUsd() };
      recordUsage(usage.searches, usage.extracts, usage.credits, this.stateDirectory);
      const suggestedAction = evidence.finding === 'possibly_stale' || evidence.finding === 'contradicted'
        ? 'Review the cited official source, propose the smallest correction, then use QUILLIX approval and run the relevant tests before applying it.'
        : evidence.finding === 'unverified'
          ? 'Do not present this claim as current; ask for a trusted URL or a narrower query.'
          : undefined;
      const result: TavilyVerificationResult = { id: randomUUID(), query, answer, finding: evidence.finding, explanation: evidence.explanation, ...(suggestedAction ? { suggestedAction } : {}), sources: merged, searchedAt: new Date().toISOString(), cached: false, usage, ...claimReport };
      recordHistory(result, this.stateDirectory);
      cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, result });
      while (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
      return result;
    } catch (error: any) {
      throw safeTavilyError('verification', error);
    }
  }

  /**
   * M-TAVILY-1: a plain, bounded web search. Read-only; never edits files.
   * The query is sanitized (secrets/paths stripped) before it leaves the host.
   */
  public async search(input: { query: string; maxResults?: number; offline?: boolean; force?: boolean }): Promise<TavilyWebSearchResult> {
    const query = sanitizeSearchQuery(input.query);
    if (!isSearchQueryAllowed(query)) throw new Error('A search query of at least 2 safe characters is required.');
    const maxResults = Math.max(1, Math.min(WEB_SEARCH_LIMITS.maxResults, Math.floor(Number(input.maxResults) || WEB_SEARCH_LIMITS.maxResults)));
    const key = `search:${query}:${maxResults}`;
    if (!input.force) {
      const cached = this.searchCache.get(key);
      if (cached && cached.expiresAt > Date.now()) return { ...cached.result, cached: true };
    }
    if (input.offline) {
      return { query, results: [], citations: '', usage: { searches: 0, extracts: 0, credits: 0, estimatedCostUsd: 0 }, searchedAt: new Date().toISOString(), cached: false };
    }
    try {
      const client = this.client();
      const response = await withTavilyRetry(() => client.search(query, { searchDepth: 'basic', maxResults, includeAnswer: true, includeRawContent: false, includeUsage: true, timeout: 20 }));
      const results = (response.results || [])
        .map(result => ({ ...sourceFromSearch(result, query), content: boundSnippet(result.content) }))
        .filter(source => source.url)
        .sort((a, b) => Number(b.official) - Number(a.official) || (b.score || 0) - (a.score || 0))
        .slice(0, maxResults);
      const credits = Number(response.usage?.credits || 0);
      recordUsage(1, 0, credits, this.stateDirectory);
      const result: TavilyWebSearchResult = {
        query,
        ...(typeof response.answer === 'string' && response.answer.trim() ? { answer: boundSnippet(response.answer, 1200) } : {}),
        results,
        citations: formatCitations(results),
        usage: { searches: 1, extracts: 0, credits, estimatedCostUsd: credits * tavilyCostPerCreditUsd() },
        searchedAt: new Date().toISOString(),
        cached: false,
      };
      this.searchCache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, result });
      this.boundedSearchCache();
      return result;
    } catch (error: any) {
      throw safeTavilyError('search', error);
    }
  }

  /**
   * M-TAVILY-2: fetch a few http(s) pages into bounded context so the agent can
   * read documentation while coding. Read-only; content is size-bounded.
   */
  public async extract(input: { urls: string[]; offline?: boolean; force?: boolean }): Promise<TavilyWebExtractResult> {
    const urls = sanitizeFetchUrls(input.urls);
    if (!urls.length) throw new Error('At least one http(s) URL is required.');
    const key = `extract:${urls.join('|')}`;
    if (!input.force) {
      const cached = this.extractCache.get(key);
      if (cached && cached.expiresAt > Date.now()) return { ...cached.result, cached: true };
    }
    if (input.offline) {
      return { pages: [], failedUrls: urls, usage: { searches: 0, extracts: 0, credits: 0, estimatedCostUsd: 0 }, fetchedAt: new Date().toISOString(), cached: false };
    }
    try {
      const client = this.client();
      const response = await withTavilyRetry(() => client.extract(urls, { extractDepth: 'basic', format: 'markdown', includeUsage: true, timeout: 25 }));
      const failed = new Set((response.failedResults || []).map((entry: any) => String(entry?.url || '')));
      const pages = (response.results || [])
        .filter((entry: any) => typeof entry?.url === 'string' && !failed.has(String(entry.url)))
        .map((entry: any) => ({ url: String(entry.url), title: boundSnippet(entry.title || entry.url, 120), content: boundPageContent(entry.rawContent) }))
        .slice(0, WEB_SEARCH_LIMITS.maxUrlsPerFetch);
      const credits = Number(response.usage?.credits || 0);
      recordUsage(0, 1, credits, this.stateDirectory);
      const result: TavilyWebExtractResult = {
        pages,
        failedUrls: urls.filter(url => failed.has(url) || !pages.some(page => page.url === url)),
        usage: { searches: 0, extracts: 1, credits, estimatedCostUsd: credits * tavilyCostPerCreditUsd() },
        fetchedAt: new Date().toISOString(),
        cached: false,
      };
      this.extractCache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, result });
      this.boundedSearchCache();
      return result;
    } catch (error: any) {
      throw safeTavilyError('extract', error);
    }
  }
}
