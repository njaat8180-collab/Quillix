import { createHash } from 'node:crypto';

/**
 * M9.3: provider key rotation and health tracking.
 *
 * The encrypted key pool (`encryptedKeyPool.ts`) already stores several keys
 * per provider. What was missing is the *decision layer*:
 *
 *  - which key should be used next,
 *  - how long a key must rest after a specific kind of failure,
 *  - when a failure means "this key is bad" versus "the provider is busy",
 *  - and how to fail over without ever looping forever.
 *
 * This module provides that layer. It is deliberately free of any I/O so it
 * can be unit-tested deterministically, and it never stores or logs a secret:
 * keys are identified by a truncated SHA-256 digest (`keyId`), and the raw
 * value is only handed back to the caller that is about to use it.
 */

export type ProviderKeyFailureKind =
  /** The provider rejected the credential (401/403). */
  | 'invalid-credentials'
  /** The credential is valid in shape but no longer valid in time. */
  | 'expired-credentials'
  /** The provider asked us to slow down (429 / "rate limit"). */
  | 'rate-limited'
  /** The account has no credit / quota left (402, "insufficient quota"). */
  | 'quota-exhausted'
  /** The provider itself failed (5xx). */
  | 'server-error'
  /** The request never reached the provider (DNS, socket, timeout). */
  | 'network-error'
  /** Anything we could not classify. */
  | 'unknown';

export type ProviderKeyStatus = 'healthy' | 'cooldown' | 'rate-limited' | 'disabled';

export interface ProviderKeyCooldownPolicy {
  'invalid-credentials': number;
  'expired-credentials': number;
  'rate-limited': number;
  'quota-exhausted': number;
  'server-error': number;
  'network-error': number;
  'unknown': number;
}

/**
 * Default rest windows. Credential problems rest for a long time (the user
 * has to fix the key), quota problems rest for an hour (daily quotas reset),
 * while transport hiccups rest for seconds (the same key is fine again).
 */
export const DEFAULT_KEY_COOLDOWN_POLICY: ProviderKeyCooldownPolicy = {
  'invalid-credentials': 30 * 60_000,
  'expired-credentials': 15 * 60_000,
  'rate-limited': 60_000,
  'quota-exhausted': 60 * 60_000,
  'server-error': 30_000,
  'network-error': 15_000,
  'unknown': 30_000,
};

/** Upper bound for a provider-advertised `Retry-After` window. */
export const MAX_RETRY_AFTER_MS = 60 * 60_000;

export interface ProviderKeyState {
  /** Stable, non-secret identifier of the key. */
  keyId: string;
  status: ProviderKeyStatus;
  failureKind?: ProviderKeyFailureKind;
  /** Epoch milliseconds until which the key must not be used. */
  cooldownUntil?: number;
  consecutiveFailures: number;
  lastFailureAt?: number;
  lastSuccessAt?: number;
  requests: number;
  failures: number;
}

export interface ProviderKeyHealth {
  provider: string;
  total: number;
  healthy: number;
  coolingDown: number;
  disabled: number;
  activeKeyId?: string;
  /** Per-key state. Never contains key material. */
  keys: ProviderKeyState[];
}

export interface ProviderFailureSignal {
  /** HTTP status when the provider answered. */
  status?: number;
  /** Error text (never stored verbatim in the health summary). */
  message?: string;
  /** Provider-advertised wait window. */
  retryAfterMs?: number;
}

export interface ProviderFailureClassification {
  kind: ProviderKeyFailureKind;
  retryAfterMs: number;
  /** True when a different key of the same provider is worth trying. */
  rotationWorthy: boolean;
}

export class ProviderKeyUnavailableError extends Error {
  public readonly provider: string;
  public readonly retryAt: number;

  constructor(provider: string, retryAt: number) {
    super(`Every ${provider} API key is cooling down. Try again after ${new Date(retryAt).toISOString()}.`);
    this.name = 'ProviderKeyUnavailableError';
    this.provider = provider;
    this.retryAt = retryAt;
  }
}

/** Non-secret identifier for a key. */
export function providerKeyId(key: string): string {
  return createHash('sha256').update(String(key ?? ''), 'utf8').digest('hex').slice(0, 16);
}

function textOf(signal: ProviderFailureSignal | unknown): string {
  if (signal && typeof signal === 'object') {
    const record = signal as ProviderFailureSignal;
    if (typeof record.message === 'string' && record.message.trim()) return record.message;
    const error = record as any;
    const nested = error?.cause?.message || error?.error?.message;
    if (typeof nested === 'string') return nested;
    const message = error?.message;
    if (typeof message === 'string') return message;
  }
  if (typeof signal === 'string') return signal;
  return '';
}

function statusOf(signal: ProviderFailureSignal | unknown): number | undefined {
  if (signal && typeof signal === 'object') {
    const status = (signal as any).status ?? (signal as any).response?.status ?? (signal as any).statusCode;
    if (Number.isFinite(status)) return Number(status);
  }
  const match = /\bHTTP\s+(\d{3})\b/i.exec(textOf(signal));
  return match ? Number(match[1]) : undefined;
}

function retryAfterOf(signal: ProviderFailureSignal | unknown): number {
  if (signal && typeof signal === 'object') {
    const explicit = (signal as ProviderFailureSignal).retryAfterMs;
    if (Number.isFinite(explicit) && Number(explicit) > 0) return Math.min(Number(explicit), MAX_RETRY_AFTER_MS);
  }
  const text = textOf(signal);
  const seconds = /retry[-_ ]?after["'\s:=]+(\d+(?:\.\d+)?)/i.exec(text);
  if (seconds) return Math.min(Math.round(Number(seconds[1]) * 1000), MAX_RETRY_AFTER_MS);
  const minutes = /retry[-_ ]?after["'\s:=]+(\d+)\s*(?:min|minute)/i.exec(text);
  if (minutes) return Math.min(Number(minutes[1]) * 60_000, MAX_RETRY_AFTER_MS);
  return 0;
}

/**
 * Classify a provider failure.
 *
 * The order matters: a quota message inside a 403 is a quota problem, not an
 * invalid key, and an "expired" message inside a 401 is not a wrong key.
 */
export function classifyProviderFailure(signal: ProviderFailureSignal | unknown): ProviderFailureClassification {
  const status = statusOf(signal);
  const text = textOf(signal);
  const retryAfterMs = retryAfterOf(signal);

  const quotaWords = /insufficient[_ -]?quota|quota (?:exceeded|exhausted)|billing|credit balance|payment required|out of credits|spending limit/i;
  const expiredWords = /\bexpired\b|token[_ -]?expired|has expired|no longer valid|subscription (?:has )?expired/i;
  const authWords = /invalid[_ -]?(?:api[_ -]?)?key|incorrect api key|unauthorized|unauthenticated|authentication (?:failed|error)|not authenticated|api[_ -]?key.*(?:invalid|missing|not found)/i;
  const rateWords = /rate[_ -]?limit|too many requests|429|slow down|try again later/i;
  const networkWords = /fetch failed|econnreset|econnrefused|ehostunreach|enetunreach|etimedout|eai_again|socket hang up|network (?:error|is unreachable)|getaddrinfo|dns|timed? ?out|aborted/i;

  if (status === 402 || quotaWords.test(text)) {
    return { kind: 'quota-exhausted', retryAfterMs: retryAfterMs || 0, rotationWorthy: true };
  }
  if (status === 429) {
    // A plain rate limit is an *account* level window: the provider shares it
    // between the keys of the same account, so switching keys would not help
    // and would only hide the real limit. A quota exhaustion that arrives as
    // 429 (OpenAI's "insufficient_quota") is key-specific and does rotate.
    return { kind: 'rate-limited', retryAfterMs, rotationWorthy: false };
  }
  if (status === 401 || status === 403) {
    if (expiredWords.test(text)) return { kind: 'expired-credentials', retryAfterMs: 0, rotationWorthy: true };
    if (quotaWords.test(text)) return { kind: 'quota-exhausted', retryAfterMs: 0, rotationWorthy: true };
    return { kind: 'invalid-credentials', retryAfterMs: 0, rotationWorthy: true };
  }
  if (expiredWords.test(text)) return { kind: 'expired-credentials', retryAfterMs: 0, rotationWorthy: true };
  if (authWords.test(text)) return { kind: 'invalid-credentials', retryAfterMs: 0, rotationWorthy: true };
  if (rateWords.test(text)) return { kind: 'rate-limited', retryAfterMs, rotationWorthy: false };
  if (status !== undefined && status >= 500) return { kind: 'server-error', retryAfterMs: 0, rotationWorthy: false };
  if (networkWords.test(text)) return { kind: 'network-error', retryAfterMs: 0, rotationWorthy: false };
  return { kind: 'unknown', retryAfterMs: 0, rotationWorthy: false };
}

interface ProviderEntry {
  /** keyId -> raw key. The raw key never leaves this map. */
  secrets: Map<string, string>;
  states: Map<string, ProviderKeyState>;
  order: string[];
  activeKeyId?: string;
}

export interface ProviderKeyPoolOptions {
  /** Injectable clock so tests are deterministic. */
  now?: () => number;
  /** Override individual cooldown windows. */
  policy?: Partial<ProviderKeyCooldownPolicy>;
  /** Maximum number of keys tried by `execute`. */
  maxAttempts?: number;
}

export interface SelectedProviderKey {
  keyId: string;
  key: string;
}

export interface ProviderKeyExecutionResult<T> {
  result: T;
  keyId: string;
  attempts: number;
}

/**
 * Tracks the health of every key of every provider and decides which key
 * should be used next.
 */
export class ProviderKeyPool {
  private readonly providers = new Map<string, ProviderEntry>();
  private readonly now: () => number;
  private readonly policy: ProviderKeyCooldownPolicy;
  private readonly maxAttempts: number;

  constructor(options: ProviderKeyPoolOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.policy = { ...DEFAULT_KEY_COOLDOWN_POLICY, ...(options.policy ?? {}) };
    this.maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  }

  private entry(provider: string): ProviderEntry {
    const existing = this.providers.get(provider);
    if (existing) return existing;
    const created: ProviderEntry = { secrets: new Map(), states: new Map(), order: [] };
    this.providers.set(provider, created);
    return created;
  }

  /**
   * Register the key set of a provider. Keys that are no longer present are
   * forgotten (including their health), so a removed key cannot linger as a
   * cooldown entry.
   */
  register(provider: string, keys: string[]): string[] {
    const entry = this.entry(provider);
    const usable = (Array.isArray(keys) ? keys : [])
      .map(value => String(value ?? '').trim())
      .filter(value => value.length > 0);
    const unique: string[] = [];
    for (const value of usable) {
      if (!unique.includes(value)) unique.push(value);
    }
    const nextIds: string[] = [];
    for (const value of unique) {
      const keyId = providerKeyId(value);
      nextIds.push(keyId);
      entry.secrets.set(keyId, value);
      if (!entry.states.has(keyId)) {
        entry.states.set(keyId, {
          keyId,
          status: 'healthy',
          consecutiveFailures: 0,
          requests: 0,
          failures: 0,
        });
      }
    }
    for (const keyId of Array.from(entry.secrets.keys())) {
      if (!nextIds.includes(keyId)) {
        entry.secrets.delete(keyId);
        entry.states.delete(keyId);
      }
    }
    entry.order = nextIds;
    if (entry.activeKeyId && !nextIds.includes(entry.activeKeyId)) entry.activeKeyId = undefined;
    return nextIds;
  }

  /** True when the key is currently usable (healthy or cooldown expired). */
  isEligible(provider: string, keyId: string): boolean {
    const entry = this.providers.get(provider);
    const state = entry?.states.get(keyId);
    if (!state) return false;
    if (state.status === 'disabled') return false;
    if (state.status === 'rate-limited') {
      // A rate limit is an account level window: the key is not broken, it
      // must simply not be hammered. It stays eligible so the request keeps
      // using the same key and the provider's own window is honoured.
      const until = state.cooldownUntil ?? 0;
      if (until > this.now()) return true;
      state.status = 'healthy';
      state.failureKind = undefined;
      state.cooldownUntil = undefined;
      return true;
    }
    if (state.status === 'cooldown') {
      const until = state.cooldownUntil ?? 0;
      if (until > this.now()) return false;
      // The cooldown expired: the key becomes healthy again (recovery).
      state.status = 'healthy';
      state.failureKind = undefined;
      state.cooldownUntil = undefined;
      state.consecutiveFailures = 0;
    }
    return true;
  }

  /**
   * Pick the next key to use. Keys resting in a cooldown are skipped; when
   * every key rests, the one that recovers first is reported so the caller
   * can tell the user exactly when to retry.
   */
  select(provider: string, options: { exclude?: string[]; preferredKeyId?: string; allowUnavailable?: boolean } = {}): SelectedProviderKey | null {
    const entry = this.providers.get(provider);
    if (!entry || entry.order.length === 0) return null;
    const exclude = new Set(options.exclude ?? []);

    const eligible = entry.order.filter(keyId => !exclude.has(keyId) && this.isEligible(provider, keyId));
    if (eligible.length > 0) {
      // Prefer the requested key, then the least recently used healthy key so
      // the quota of one key is not burned before another is tried.
      const preferred = options.preferredKeyId && eligible.includes(options.preferredKeyId)
        ? options.preferredKeyId
        : eligible
          .slice()
          .sort((left, right) => {
            const leftState = entry.states.get(left)!;
            const rightState = entry.states.get(right)!;
            const leftUsed = leftState.lastSuccessAt ?? leftState.lastFailureAt ?? 0;
            const rightUsed = rightState.lastSuccessAt ?? rightState.lastFailureAt ?? 0;
            if (leftUsed !== rightUsed) return leftUsed - rightUsed;
            return entry.order.indexOf(left) - entry.order.indexOf(right);
          })[0];
      entry.activeKeyId = preferred;
      return { keyId: preferred, key: entry.secrets.get(preferred)! };
    }

    // Everything is cooling down: report the earliest recovery time.
    let retryAt = Number.POSITIVE_INFINITY;
    let earliestKeyId: string | undefined;
    for (const keyId of entry.order) {
      if (exclude.has(keyId)) continue;
      const state = entry.states.get(keyId)!;
      if (state.status === 'disabled') continue;
      const until = state.cooldownUntil ?? this.now();
      if (until < retryAt) {
        retryAt = until;
        earliestKeyId = keyId;
      }
    }
    if (!Number.isFinite(retryAt)) return null;
    // Callers that must keep serving (the provider adapter) can accept the key
    // that recovers first instead of failing the whole request.
    if (options.allowUnavailable && earliestKeyId) {
      return { keyId: earliestKeyId, key: entry.secrets.get(earliestKeyId)! };
    }
    throw new ProviderKeyUnavailableError(provider, retryAt);
  }

  /** Record a successful request: the key is healthy again. */
  reportSuccess(provider: string, keyId: string): ProviderKeyState | null {
    const entry = this.providers.get(provider);
    const state = entry?.states.get(keyId);
    if (!state) return null;
    state.status = 'healthy';
    state.failureKind = undefined;
    state.cooldownUntil = undefined;
    state.consecutiveFailures = 0;
    state.lastSuccessAt = this.now();
    state.requests += 1;
    entry!.activeKeyId = keyId;
    return state;
  }

  /** Record a failure and put the key into the matching cooldown. */
  reportFailure(
    provider: string,
    keyId: string,
    signal: ProviderFailureSignal | unknown,
    options: { cooldown?: boolean } = {},
  ): ProviderKeyState | null {
    const entry = this.providers.get(provider);
    const state = entry?.states.get(keyId);
    if (!state) return null;
    const classification = classifyProviderFailure(signal);
    const now = this.now();
    state.requests += 1;
    state.failures += 1;
    state.consecutiveFailures += 1;
    state.lastFailureAt = now;
    state.failureKind = classification.kind;
    if (options.cooldown === false) {
      // A transport or provider outage is not the key's fault: the failure is
      // recorded for the health report, but the key stays usable.
      state.status = 'healthy';
      state.cooldownUntil = undefined;
      return state;
    }
    const policyWindow = this.policy[classification.kind] ?? this.policy.unknown;
    const window = Math.max(policyWindow, classification.retryAfterMs || 0);
    state.cooldownUntil = now + window;
    // A rate limit rests the key without breaking it; a credential problem
    // takes it out of rotation until it recovers.
    state.status = classification.kind === 'rate-limited' ? 'rate-limited' : 'cooldown';
    if (entry!.activeKeyId === keyId) entry!.activeKeyId = undefined;
    return state;
  }

  /** Health snapshot for one provider (never contains key material). */
  health(provider: string): ProviderKeyHealth {
    const entry = this.providers.get(provider);
    const keys: ProviderKeyState[] = entry
      ? entry.order.map(keyId => ({ ...entry.states.get(keyId)! }))
      : [];
    return {
      provider,
      total: keys.length,
      healthy: keys.filter(key => this.isEligible(provider, key.keyId)).length,
      coolingDown: keys.filter(key => key.status === 'cooldown').length,
      disabled: keys.filter(key => key.status === 'disabled').length,
      activeKeyId: entry?.activeKeyId,
      keys,
    };
  }

  /** Health snapshot for every known provider. */
  healthAll(): ProviderKeyHealth[] {
    return Array.from(this.providers.keys()).map(provider => this.health(provider));
  }

  /** Forget the tracked state of one provider (or all of them). */
  reset(provider?: string): void {
    if (provider) this.providers.delete(provider);
    else this.providers.clear();
  }

  /**
   * Run an operation with automatic failover.
   *
   * The operation receives one key at a time. A failure that is specific to
   * the credential (invalid, expired, rate limited, quota exhausted) rotates
   * to the next eligible key; transport or provider failures are recorded but
   * do **not** rotate, because the next key would fail the same way. The
   * attempt count is bounded, so this can never loop forever.
   */
  async execute<T>(
    provider: string,
    keys: string[],
    operation: (key: string, keyId: string) => Promise<T>,
    options: { maxAttempts?: number } = {},
  ): Promise<ProviderKeyExecutionResult<T>> {
    this.register(provider, keys);
    const limit = Math.min(Math.max(1, options.maxAttempts ?? this.maxAttempts), this.maxAttempts);
    const attempted: string[] = [];
    let lastError: unknown = null;

    for (let attempt = 0; attempt < limit; attempt++) {
      let selection: SelectedProviderKey | null;
      try {
        selection = this.select(provider, { exclude: attempted });
      } catch (error) {
        if (error instanceof ProviderKeyUnavailableError) {
          if (lastError) throw lastError;
          throw error;
        }
        throw error;
      }
      if (!selection) break;
      attempted.push(selection.keyId);
      try {
        const result = await operation(selection.key, selection.keyId);
        this.reportSuccess(provider, selection.keyId);
        return { result, keyId: selection.keyId, attempts: attempted.length };
      } catch (error) {
        lastError = error;
        const classification = classifyProviderFailure(error);
        this.reportFailure(provider, selection.keyId, error);
        if (!classification.rotationWorthy) throw error;
        if (attempted.length >= limit) break;
      }
    }
    throw lastError ?? new Error(`${provider} API key rotation could not complete the request.`);
  }
}

/** Application-wide pool used by the providers and the health dashboard. */
export const providerKeyPool = new ProviderKeyPool();




