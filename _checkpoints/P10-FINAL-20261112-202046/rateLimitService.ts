/**
 * Centralized rate-limit service (Part 2).
 *
 * Every component that talks to a provider (the universal transport, the
 * provider router, the NIM failover wrapper, the Tavily verifier) used to
 * keep its own private counters and cooldown maps. That made the effective
 * limit unknowable: two components could each believe they had half the
 * quota, and a `Retry-After` sent to one was invisible to the other.
 *
 * This module is the single owner of the quota state:
 *  - a per-scope rolling minute window for requests (RPM) and tokens (TPM),
 *  - a per-scope rolling day window for the same two counters,
 *  - a shared cooldown that every component reads *and* writes, so one 429
 *    stops traffic on that scope for every caller,
 *  - `Retry-After` / `x-ratelimit-*` header parsing in one place.
 *
 * The service is deliberately conservative and fail-safe:
 *  - it never *raises* a provider's own limits — it only enforces the
 *    ceilings the provider advertises or the operator declares,
 *  - it never blocks a scope that has no declared or advertised ceiling,
 *  - the clock is injected, so the behaviour is deterministic in tests.
 */

export interface RateLimitCeilings {
  /** Maximum requests per rolling minute. `0`/undefined means unlimited. */
  maxRequestsPerMinute?: number;
  /** Maximum tokens per rolling minute. `0`/undefined means unlimited. */
  maxTokensPerMinute?: number;
  /** Maximum requests per rolling day. `0`/undefined means unlimited. */
  maxRequestsPerDay?: number;
  /** Maximum tokens per rolling day. `0`/undefined means unlimited. */
  maxTokensPerDay?: number;
}

export interface RateLimitDecision {
  /** True when the request may be sent now. */
  allowed: boolean;
  /** Milliseconds the caller must wait before retrying (0 when allowed). */
  waitMs: number;
  /** Which limit produced the wait — shown in diagnostics. */
  reason: 'ok' | 'requests-per-minute' | 'tokens-per-minute' | 'requests-per-day' | 'tokens-per-day' | 'cooldown';
}

export interface RateLimitSnapshot {
  scope: string;
  requestsInWindow: number;
  tokensInWindow: number;
  requestsInDay: number;
  tokensInDay: number;
  /** Declared or learned ceilings currently in force. */
  ceilings: Required<RateLimitCeilings>;
  /** When the shared cooldown ends (0 when there is none). */
  cooldownUntil: number;
  /** Next time a request may be sent (0 when it may be sent now). */
  nextAllowedAt: number;
  /** Provider-advertised remaining requests/tokens, when the provider sent them. */
  providerRemainingRequests?: number;
  providerRemainingTokens?: number;
  /** When the provider's advertised window resets (0 when unknown). */
  providerResetAt: number;
  updatedAt: number;
}

export interface RateLimitUsage {
  requests: number;
  tokens: number;
}

interface WindowEntry {
  at: number;
  tokens: number;
}

interface ScopeState {
  minute: WindowEntry[];
  day: WindowEntry[];
  cooldownUntil: number;
  providerRemainingRequests?: number;
  providerRemainingTokens?: number;
  providerResetAt: number;
  updatedAt: number;
  ceilings: Required<RateLimitCeilings>;
}

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const MAX_WINDOW_ENTRIES = 4_096;
const MAX_SCOPES = 512;

export function normalizeRateLimitCeiling(value: unknown): number {
  const raw = value === undefined || value === null || value === '' ? Number.NaN : Number(value);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.min(10_000_000, Math.round(raw));
}

/**
 * Parse a provider `Retry-After` value (delta-seconds or an HTTP date) into
 * milliseconds. Returns 0 for missing or malformed values so a bad header can
 * never stall the caller forever.
 */
export function parseRetryAfterMs(value: string | null | undefined, now = Date.now()): number {
  if (value === null || value === undefined) return 0;
  const raw = String(value).trim();
  if (!raw) return 0;
  if (/^\d+(\.\d+)?$/.test(raw)) return Math.max(0, Math.round(Number(raw) * 1_000));
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, parsed - now);
}

/**
 * Parse an `x-ratelimit-reset-*` style value. Providers send either a delta
 * ("1.5s", "2m", "500ms"), a bare number of seconds, or an HTTP date.
 */
export function parseResetMs(value: string | null | undefined, now = Date.now()): number {
  if (value === null || value === undefined) return 0;
  const raw = String(value).trim();
  if (!raw) return 0;
  const durationParts = [...raw.matchAll(/(\d+(?:\.\d+)?)\s*(ms|s|m|h)/g)];
  // A single unit ("45s", "2m") is the most common provider form; compounds
  // ("1h30m") are handled by the same reducer when they reconstruct the raw
  // value exactly.
  if (durationParts.length >= 1 && durationParts.map(part => part[0]).join('') === raw) {
    return Math.max(0, Math.round(durationParts.reduce((total, part) => {
      const multiplier = part[2] === 'ms' ? 1 : part[2] === 's' ? 1000 : part[2] === 'm' ? 60_000 : 3_600_000;
      return total + Number(part[1]) * multiplier;
    }, 0)));
  }
  if (/^\d+(\.\d+)?$/.test(raw)) return Math.max(0, Math.round(Number(raw) * 1_000));
  const date = Date.parse(raw);
  if (!Number.isFinite(date)) return 0;
  return Math.max(0, date - now);
}

/** Normalize the rate-limit headers a provider may send. */
export function parseRateLimitHeaders(
  headers: { get(name: string): string | null } | null | undefined,
  now = Date.now(),
): {
  remainingRequests?: number;
  remainingTokens?: number;
  resetMs: number;
  retryAfterMs: number;
} {
  if (!headers || typeof headers.get !== 'function') return { resetMs: 0, retryAfterMs: 0 };
  const remainingRequestsRaw = headers.get('x-ratelimit-remaining-requests');
  const remainingTokensRaw = headers.get('x-ratelimit-remaining-tokens');
  const remainingRequests = remainingRequestsRaw === null ? undefined : Number(remainingRequestsRaw);
  const remainingTokens = remainingTokensRaw === null ? undefined : Number(remainingTokensRaw);
  const resetMs = Math.max(
    parseResetMs(headers.get('x-ratelimit-reset-requests'), now),
    parseResetMs(headers.get('x-ratelimit-reset-tokens'), now),
  );
  const retryAfterMs = parseRetryAfterMs(headers.get('retry-after'), now);
  return {
    ...(Number.isFinite(remainingRequests as number) ? { remainingRequests } : {}),
    ...(Number.isFinite(remainingTokens as number) ? { remainingTokens } : {}),
    resetMs,
    retryAfterMs,
  };
}

export interface RateLimitServiceOptions {
  now?: () => number;
  /** Maximum number of tracked scopes (oldest idle scopes are evicted). */
  maxScopes?: number;
}

/**
 * The shared quota owner. One instance is exported for the whole process so
 * every component enforces the same effective limit.
 */
export class RateLimitService {
  private readonly scopes = new Map<string, ScopeState>();
  private readonly now: () => number;
  private readonly maxScopes: number;

  constructor(options: RateLimitServiceOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.maxScopes = Math.max(1, Math.min(MAX_SCOPES, options.maxScopes ?? MAX_SCOPES));
  }

  private state(scope: string): ScopeState {
    const existing = this.scopes.get(scope);
    if (existing) {
      // Refresh LRU position.
      this.scopes.delete(scope);
      this.scopes.set(scope, existing);
      return existing;
    }
    if (this.scopes.size >= this.maxScopes) {
      const oldest = this.scopes.keys().next();
      if (!oldest.done) this.scopes.delete(oldest.value);
    }
    const created: ScopeState = {
      minute: [],
      day: [],
      cooldownUntil: 0,
      providerResetAt: 0,
      updatedAt: this.now(),
      ceilings: { maxRequestsPerMinute: 0, maxTokensPerMinute: 0, maxRequestsPerDay: 0, maxTokensPerDay: 0 },
    };
    this.scopes.set(scope, created);
    return created;
  }

  private prune(state: ScopeState, now: number): void {
    state.minute = state.minute.filter(entry => entry.at > now - MINUTE_MS);
    state.day = state.day.filter(entry => entry.at > now - DAY_MS);
    while (state.minute.length > MAX_WINDOW_ENTRIES) state.minute.shift();
    while (state.day.length > MAX_WINDOW_ENTRIES) state.day.shift();
  }

  /**
   * Declare the ceilings that apply to a scope. Declared ceilings are always
   * enforced; a provider-advertised ceiling is *learned* and only tightens
   * the declared value — the service never raises a limit the operator set.
   */
  public declareCeilings(scope: string, ceilings: RateLimitCeilings, now = this.now()): Required<RateLimitCeilings> {
    const state = this.state(scope);
    state.updatedAt = now;
    state.ceilings = {
      maxRequestsPerMinute: normalizeRateLimitCeiling(ceilings.maxRequestsPerMinute),
      maxTokensPerMinute: normalizeRateLimitCeiling(ceilings.maxTokensPerMinute),
      maxRequestsPerDay: normalizeRateLimitCeiling(ceilings.maxRequestsPerDay),
      maxTokensPerDay: normalizeRateLimitCeiling(ceilings.maxTokensPerDay),
    };
    return state.ceilings;
  }

  /** The ceilings currently in force for a scope. */
  public ceilingsFor(scope: string): Required<RateLimitCeilings> {
    return this.scopes.get(scope)?.ceilings ?? {
      maxRequestsPerMinute: 0,
      maxTokensPerMinute: 0,
      maxRequestsPerDay: 0,
      maxTokensPerDay: 0,
    };
  }

  /**
   * Record that a request was sent. The caller must do this *after* the
   * request was dispatched, so the window reflects real traffic.
   */
  public record(scope: string, usage: RateLimitUsage, now = this.now()): void {
    const state = this.state(scope);
    this.prune(state, now);
    const tokens = Math.max(0, Math.round(usage.tokens || 0));
    const entry: WindowEntry = { at: now, tokens };
    state.minute.push(entry);
    state.day.push(entry);
    state.updatedAt = now;
  }

  /**
   * Record a provider response. A 429 (or any response that carries a
   * `Retry-After` / exhausted remaining counter) opens a shared cooldown for
   * the scope so *every* component stops sending to that provider.
   */
  public noteResponse(
    scope: string,
    response: { status: number; headers?: { get(name: string): string | null } | null },
    now = this.now(),
  ): { cooldownUntil: number; retryAfterMs: number } {
    const state = this.state(scope);
    state.updatedAt = now;
    const parsed = parseRateLimitHeaders(response.headers, now);
    if (parsed.remainingRequests !== undefined) state.providerRemainingRequests = parsed.remainingRequests;
    if (parsed.remainingTokens !== undefined) state.providerRemainingTokens = parsed.remainingTokens;
    if (parsed.resetMs > 0) state.providerResetAt = now + parsed.resetMs;

    const exhausted = parsed.remainingRequests === 0 || parsed.remainingTokens === 0;
    const isRateLimited = response.status === 429 || (exhausted && parsed.resetMs > 0);
    if (!isRateLimited) return { cooldownUntil: state.cooldownUntil, retryAfterMs: 0 };

    // Prefer the provider's own window; fall back to a short conservative
    // cooldown so one 429 cannot turn into a retry storm.
    const fallbackMs = response.status === 429 ? 30_000 : 5_000;
    const cooldownMs = Math.max(parsed.retryAfterMs, parsed.resetMs, fallbackMs);
    state.cooldownUntil = Math.max(state.cooldownUntil, now + cooldownMs);
    return { cooldownUntil: state.cooldownUntil, retryAfterMs: parsed.retryAfterMs };
  }

  /** Open a cooldown for a scope explicitly (used by failover and the router). */
  public noteCooldown(scope: string, until: number, now = this.now()): number {
    const state = this.state(scope);
    state.cooldownUntil = Math.max(state.cooldownUntil, until);
    state.updatedAt = now;
    return state.cooldownUntil;
  }

  public cooldownUntil(scope: string): number {
    return this.scopes.get(scope)?.cooldownUntil || 0;
  }

  /**
   * Decide whether a request may be sent now. The wait is the longest of all
   * applicable limits, so a scope is never released before *every* ceiling is
   * satisfied.
   */
  public check(scope: string, ceilings: RateLimitCeilings = {}, estimatedTokens = 0, now = this.now()): RateLimitDecision {
    const state = this.state(scope);
    this.prune(state, now);
    const demand = Math.max(0, Math.round(estimatedTokens || 0));

    // Declared ceilings always win; a provider-advertised ceiling may only
    // tighten them (the service never raises an operator's limit).
    const declared = state.ceilings;
    const effective: Required<RateLimitCeilings> = {
      maxRequestsPerMinute: normalizeRateLimitCeiling(ceilings.maxRequestsPerMinute) || declared.maxRequestsPerMinute,
      maxTokensPerMinute: normalizeRateLimitCeiling(ceilings.maxTokensPerMinute) || declared.maxTokensPerMinute,
      maxRequestsPerDay: normalizeRateLimitCeiling(ceilings.maxRequestsPerDay) || declared.maxRequestsPerDay,
      maxTokensPerDay: normalizeRateLimitCeiling(ceilings.maxTokensPerDay) || declared.maxTokensPerDay,
    };
    const maxRequestsPerMinute = effective.maxRequestsPerMinute;
    const maxTokensPerMinute = effective.maxTokensPerMinute;
    const maxRequestsPerDay = effective.maxRequestsPerDay;
    const maxTokensPerDay = effective.maxTokensPerDay;

    let waitMs = 0;
    let reason: RateLimitDecision['reason'] = 'ok';

    const cooldownUntil = state.cooldownUntil;
    if (cooldownUntil > now) {
      waitMs = cooldownUntil - now;
      reason = 'cooldown';
    }

    if (maxRequestsPerMinute && state.minute.length >= maxRequestsPerMinute) {
      // The oldest entry in the window is the one that frees a slot.
      const oldest = state.minute[state.minute.length - maxRequestsPerMinute];
      const candidate = Math.max(0, oldest.at + MINUTE_MS - now);
      if (candidate > waitMs) { waitMs = candidate; reason = 'requests-per-minute'; }
    }

    if (maxTokensPerMinute) {
      const tokensInWindow = state.minute.reduce((total, entry) => total + entry.tokens, 0);
      if (tokensInWindow + demand > maxTokensPerMinute) {
        const candidate = this.waitForTokenHeadroom(state.minute, tokensInWindow, demand, maxTokensPerMinute, MINUTE_MS, now);
        if (candidate > waitMs) { waitMs = candidate; reason = 'tokens-per-minute'; }
      }
    }

    if (maxRequestsPerDay && state.day.length >= maxRequestsPerDay) {
      const oldest = state.day[state.day.length - maxRequestsPerDay];
      const candidate = Math.max(0, oldest.at + DAY_MS - now);
      if (candidate > waitMs) { waitMs = candidate; reason = 'requests-per-day'; }
    }

    if (maxTokensPerDay) {
      const tokensInDay = state.day.reduce((total, entry) => total + entry.tokens, 0);
      if (tokensInDay + demand > maxTokensPerDay) {
        const candidate = this.waitForTokenHeadroom(state.day, tokensInDay, demand, maxTokensPerDay, DAY_MS, now);
        if (candidate > waitMs) { waitMs = candidate; reason = 'tokens-per-day'; }
      }
    }

    return { allowed: waitMs <= 0, waitMs, reason };
  }

  /**
   * Milliseconds until enough tokens have left the window. A single request
   * larger than the whole ceiling waits for the oldest entry so the caller
   * gets the fullest possible window instead of stalling forever.
   */
  private waitForTokenHeadroom(
    entries: WindowEntry[],
    tokensInWindow: number,
    demand: number,
    ceiling: number,
    windowMs: number,
    now: number,
  ): number {
    let released = 0;
    for (const entry of entries) {
      released += entry.tokens;
      if (tokensInWindow - released + demand <= ceiling) {
        return Math.max(0, entry.at + windowMs - now);
      }
    }
    return entries.length ? Math.max(0, entries[0].at + windowMs - now) : 0;
  }

  /** A snapshot of one scope, for diagnostics and the Studio dashboard. */
  public snapshot(scope: string, ceilings: RateLimitCeilings = {}, now = this.now()): RateLimitSnapshot {
    const state = this.state(scope);
    this.prune(state, now);
    const decision = this.check(scope, ceilings, 0, now);
    return {
      scope,
      requestsInWindow: state.minute.length,
      tokensInWindow: state.minute.reduce((total, entry) => total + entry.tokens, 0),
      requestsInDay: state.day.length,
      tokensInDay: state.day.reduce((total, entry) => total + entry.tokens, 0),
      ceilings: {
        maxRequestsPerMinute: normalizeRateLimitCeiling(ceilings.maxRequestsPerMinute),
        maxTokensPerMinute: normalizeRateLimitCeiling(ceilings.maxTokensPerMinute),
        maxRequestsPerDay: normalizeRateLimitCeiling(ceilings.maxRequestsPerDay),
        maxTokensPerDay: normalizeRateLimitCeiling(ceilings.maxTokensPerDay),
      },
      cooldownUntil: state.cooldownUntil,
      nextAllowedAt: decision.allowed ? 0 : now + decision.waitMs,
      ...(state.providerRemainingRequests !== undefined ? { providerRemainingRequests: state.providerRemainingRequests } : {}),
      ...(state.providerRemainingTokens !== undefined ? { providerRemainingTokens: state.providerRemainingTokens } : {}),
      providerResetAt: state.providerResetAt,
      updatedAt: state.updatedAt,
    };
  }

  /** All tracked scopes — used by the diagnostics endpoint. */
  public scopesSnapshot(): string[] {
    return [...this.scopes.keys()];
  }

  /** Forget a scope (used when a provider profile is removed). */
  public forget(scope: string): void {
    this.scopes.delete(scope);
  }

  public clear(): void {
    this.scopes.clear();
  }
}

/**
 * The process-wide rate-limit service. Every component shares this instance,
 * so one provider's 429 stops traffic everywhere for that scope.
 */
export const rateLimitService = new RateLimitService();

/** Canonical scope key for a provider endpoint (protocol + endpoint). */
export function rateLimitScopeFor(protocol: string, endpoint: string): string {
  return `${protocol}:${String(endpoint || '').replace(/\/+$/, '').toLowerCase()}`;
}



