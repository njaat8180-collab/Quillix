/** Provider adapters for user-configured cloud coding models.
 * Keys are never persisted in settings.json and never sent to the renderer.
 * Supported protocols: OpenAI-compatible chat completions, Anthropic Messages,
 * and Gemini generateContent. The requested model must exist at the provider;
 * NUVRO AI does not claim access to any particular proprietary model.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectProviderStream } from './providerStream.js';
import { randomUUID, createHash } from 'node:crypto';
import { dpapi } from './sarvam.js';
import { rateLimitService } from './rateLimitService.js';
import type { AICompletionOptions, AIProvider, ProviderCapabilities, ProviderUsage } from './qwen.js';
import type { ToolCall, ToolDefinition, ProviderHealthSummary } from '../shared/types.js';
import { DEFAULT_ONLINE_PROVIDER_MIN_INTERVAL_MS, getEffectiveProviderIntervalMs } from '../shared/providerPacing.js';
import { isOverdriveActive } from '../shared/overdriveState.js';
import { SettingsStore } from './settings.js';

export type UniversalProtocol = 'openai' | 'responses' | 'anthropic' | 'gemini';
export type ProviderRequestBudget = {
  /** Approximate serialized request ceiling; older tool/context messages are compacted before sending. */
  maxInputChars?: number;
  /** Provider-safe output ceiling; never claims to increase the provider quota. */
  maxOutputTokens?: number;
/** Minimum spacing between requests for this provider endpoint. */
  minRequestIntervalMs?: number;
  /** Maximum overlapping requests; Turbo uses a small bounded value only. */
  maxConcurrentRequests?: number;
  /** Declared provider request ceiling per rolling 60s window; 0/unset means no declared ceiling. */
  maxRequestsPerMinute?: number;
  /** Declared provider token ceiling per rolling 60s window; 0/unset means no declared ceiling. */
  maxTokensPerMinute?: number;
};
export function normalizeProviderRequestInterval(value: unknown, fallback = DEFAULT_ONLINE_PROVIDER_MIN_INTERVAL_MS): number {
  const configured = value === undefined || value === null || value === '' ? Number.NaN : Number(value);
  const safeFallback = Number.isFinite(fallback) && fallback >= 0 ? Math.min(60_000, Math.round(fallback)) : DEFAULT_ONLINE_PROVIDER_MIN_INTERVAL_MS;
  if (!Number.isFinite(configured) || configured < 0) return safeFallback;
  return Math.min(60_000, Math.round(configured));
}
/** Conservative defaults for providers whose account/model limits are unknown.
 * These reduce avoidable free-tier failures without pretending to bypass a
 * provider's actual quota or context window. A provider profile may override
 * them when its documented limits are larger or smaller.
 */
export const DEFAULT_UNIVERSAL_REQUEST_BUDGET: Required<ProviderRequestBudget> = {
  maxInputChars: 60_000,
  maxOutputTokens: 4_096,
  // Pace cloud/free-tier requests conservatively. Ollama does not use this
  // adapter, and a provider profile may opt into a stricter interval.
  // Keep a small safety gap for free/low-quota providers while avoiding an
  // unnecessarily sluggish queue. Transient network retries use short jitter.
  minRequestIntervalMs: normalizeProviderRequestInterval(process.env.QUILLIX_UNIVERSAL_MIN_INTERVAL_MS),
  // No declared per-minute request ceiling by default; header-derived adaptive
  // pacing still applies. Profiles may declare stricter ceilings.
  maxRequestsPerMinute: 0,
  maxTokensPerMinute: 0,
  maxConcurrentRequests: 1,
};
export type ProviderConfig = {protocol:UniversalProtocol;endpoint:string;model:string;offlineMode:boolean;auth?:{type:'bearer'|'header'|'basic'|'none';header?:string};capabilities?:ProviderCapabilities;reasoningEffort?:'none'|'low'|'high'|'max';reasoningBudget?:number;inputCostPerMillion?:number;outputCostPerMillion?:number;requestBudget?:ProviderRequestBudget;/** Overdrive Mode: every app-imposed delay is removed; only provider-side limits remain. */overdriveMode?:boolean};
export type UniversalMessage = {role:'system'|'assistant'|'user'|'tool';content:string;toolCallId?:string;name?:string;toolCalls?:ToolCall[]};
export const UNIVERSAL_MAX_TRANSIENT_RETRIES = 2;
export const UNIVERSAL_RETRY_MIN_MS = 1_000;
export const UNIVERSAL_RETRY_MAX_MS = 8_000;
export const UNIVERSAL_MAX_QUEUED_REQUESTS_PER_ENDPOINT = 64;
export const UNIVERSAL_MAX_PROVIDER_COOLDOWN_MS = 24 * 60 * 60 * 1_000;
// Overdrive Mode: a rate limit is not a failure to recover from later, it is
// a wait to serve. Retry through several provider windows with the exact
// advertised wait (no jitter, no backoff growth) so the request completes the
// moment the window reopens.
export const OVERDRIVE_MAX_RATE_LIMIT_RETRIES = 6;
export const OVERDRIVE_MAX_RATE_LIMIT_WAIT_MS = 10 * 60 * 1_000;
// Overdrive concurrency ceiling. The per-endpoint queue clamps lower for
// normal profiles; overdrive allows overlapping parallel requests.
export const OVERDRIVE_MAX_CONCURRENT_REQUESTS = 8;
const keyFile = path.join(os.homedir(), '.quillix', 'universal-key.dpapi.json');
const lastRequestAt = new Map<string, number>();
const providerCooldownUntil = new Map<string, number>();
const providerAdaptiveIntervals = new Map<string, { intervalMs: number; expiresAt: number }>();
const providerQueueDepth = new Map<string, number>();
const providerServerFailures = new Map<string, number>();
const providerCircuitUntil = new Map<string, number>();
const UNIVERSAL_CIRCUIT_FAILURE_THRESHOLD = 3;
const UNIVERSAL_CIRCUIT_OPEN_MS = 30_000;
// Quotas and Retry-After windows are often shared across model IDs on one
// provider endpoint. Pace every dispatch at endpoint scope and bound the active
// request count; only the failover wrapper's first alternate probe may skip a
// newly recorded cooldown. Different provider endpoints remain independent.
type ProviderSlotWaiter = {
  priority: 'high' | 'low';
  sequence: number;
  minimumIntervalMs: number;
  maxConcurrentRequests: number;
  bypassCooldown?: boolean;
  signal?: AbortSignal;
  resolve: (release: () => void) => void;
  reject: (error: Error) => void;
  onAbort?: () => void;
};
type ProviderSlotQueue = { activeCount: number; timer?: ReturnType<typeof setTimeout>; waiters: ProviderSlotWaiter[] };
const providerSlotQueues = new Map<string, ProviderSlotQueue>();
let providerQueueSequence = 0;

function providerResetMs(value: string | null | undefined, now = Date.now()): number {
  if (!value?.trim()) return 0;
  const raw = value.trim().toLowerCase();
  const unit = raw.match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h)$/);
  if (unit) {
    const multiplier = unit[2] === 'ms' ? 1 : unit[2] === 's' ? 1000 : unit[2] === 'm' ? 60_000 : 3_600_000;
    return Math.max(0, Math.round(Number(unit[1]) * multiplier));
  }
  const durationParts = [...raw.matchAll(/(\d+(?:\.\d+)?)\s*(ms|s|m|h)/g)];
  if (durationParts.length > 1 && durationParts.map(part => part[0]).join('') === raw) {
    return Math.max(0, Math.round(durationParts.reduce((total, part) => {
      const multiplier = part[2] === 'ms' ? 1 : part[2] === 's' ? 1000 : part[2] === 'm' ? 60_000 : 3_600_000;
      return total + Number(part[1]) * multiplier;
    }, 0)));
  }
  if (/^\d+(?:\.\d+)?$/.test(raw)) return Math.max(0, Math.round(Number(raw) * 1000));
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : 0;
}

function noteProviderCooldown(key: string, response: Response): void {
  const remainingRequests = response.headers?.get('x-ratelimit-remaining-requests');
  const remainingTokens = response.headers?.get('x-ratelimit-remaining-tokens');
  const requestReset = providerResetMs(response.headers?.get('x-ratelimit-reset-requests'));
  const tokenReset = providerResetMs(response.headers?.get('x-ratelimit-reset-tokens'));
  const retryAfter = providerResetMs(response.headers?.get('retry-after'));
  const reset = Math.max(requestReset, tokenReset, retryAfter);
  const exhausted = remainingRequests === '0' || remainingTokens === '0' || response.status === 429;
  const retryableServerFailure = [500, 502, 503, 504, 529].includes(response.status);
  const nvidiaEndpoint = key.toLowerCase().includes('integrate.api.nvidia.com');
  const shouldCool = exhausted && (reset > 0 || response.status === 429 || remainingRequests === '0' || remainingTokens === '0')
    || retryableServerFailure && retryAfter > 0;
  if (!shouldCool) return;
  // Overdrive Mode: only a provider-advertised window may gate the request.
  // NUVRO AI's conservative fallback cooldown (30s/60s for a header-less 429)
  // is an app-imposed delay, so it is not recorded; the request retries with
  // the minimal floor and the provider itself enforces the real limit.
  if (isOverdriveActive() && reset <= 0) return;
  if (shouldCool) {
    // Free endpoints sometimes omit both Retry-After and reset headers. A
    // short conservative cooldown prevents NUVRO AI from immediately sending
    // another request burst and turning one 429 into a quota storm.
    const fallbackCooldown = response.status === 429 ? (nvidiaEndpoint ? 60_000 : 30_000)
      : exhausted && !reset ? (nvidiaEndpoint ? 30_000 : 5_000) : 0;
    const cooldownMs = reset > 0 ? reset : fallbackCooldown;
    providerCooldownUntil.set(key, Math.max(providerCooldownUntil.get(key) || 0, Date.now() + Math.min(cooldownMs, UNIVERSAL_MAX_PROVIDER_COOLDOWN_MS)));
  }
}

function noteProviderPacing(key: string, response: Response, estimatedTokens: number): void {
  const remainingRaw = response.headers?.get('x-ratelimit-remaining-requests');
  const remaining = remainingRaw === null ? Number.NaN : Number(remainingRaw);
  const remainingTokenRaw = response.headers?.get('x-ratelimit-remaining-tokens');
  const remainingTokens = remainingTokenRaw === null ? Number.NaN : Number(remainingTokenRaw);
  const requestResetMs = providerResetMs(response.headers?.get('x-ratelimit-reset-requests'));
  const tokenResetMs = providerResetMs(response.headers?.get('x-ratelimit-reset-tokens'));
  const limits: number[] = [];
  if (Number.isFinite(remaining) && remaining > 0 && requestResetMs > 0) limits.push(requestResetMs / remaining);
  if (Number.isFinite(remainingTokens) && remainingTokens > 0 && tokenResetMs > 0 && estimatedTokens > 0) {
    limits.push(tokenResetMs * estimatedTokens / remainingTokens);
  }
  const resetMs = Math.max(requestResetMs, tokenResetMs);
  if (!limits.length || resetMs <= 0) return;
  // Pace against whichever advertised limit is tighter. Estimate token demand
  // conservatively from serialized input plus the requested output budget.
  const intervalMs = Math.min(60_000, Math.max(250, Math.ceil(Math.max(...limits))));
  providerAdaptiveIntervals.set(key, { intervalMs, expiresAt: Date.now() + resetMs });
}

function noteProviderServerFailure(key: string): void {
  const failures = (providerServerFailures.get(key) || 0) + 1;
  providerServerFailures.set(key, failures);
  if (failures >= UNIVERSAL_CIRCUIT_FAILURE_THRESHOLD) {
    providerCircuitUntil.set(key, Math.max(providerCircuitUntil.get(key) || 0, Date.now() + UNIVERSAL_CIRCUIT_OPEN_MS));
  }
}

function noteProviderServerSuccess(key: string): void {
  providerServerFailures.delete(key);
  providerCircuitUntil.delete(key);
}

/** Declared per-profile provider ceilings enforced over a rolling 60s window.
 * Interval pacing spaces requests; these ceilings bound the volume a profile
 * may claim per minute, so a burst cannot spend a provider quota faster than
 * the profile declares. `0` (or unset) means no declared ceiling and leaves
 * header-derived adaptive pacing as the only governor. */
type ProviderBudgetWindowEntry = { at: number; tokens: number };
const providerBudgetWindows = new Map<string, ProviderBudgetWindowEntry[]>();
const PROVIDER_BUDGET_WINDOW_MS = 60_000;
const PROVIDER_BUDGET_MAX_WINDOW_ENTRIES = 4_096;

export function normalizeProviderRateLimit(value: unknown): number {
  const raw = value === undefined || value === null || value === '' ? Number.NaN : Number(value);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.min(100_000, Math.round(raw));
}

function pruneProviderBudgetWindow(key: string, now: number): ProviderBudgetWindowEntry[] {
  const entries = (providerBudgetWindows.get(key) || []).filter(entry => entry.at > now - PROVIDER_BUDGET_WINDOW_MS);
  while (entries.length > PROVIDER_BUDGET_MAX_WINDOW_ENTRIES) entries.shift();
  providerBudgetWindows.set(key, entries);
  return entries;
}

/** Milliseconds the next request for this endpoint must wait for its rolling window. */
export function providerBudgetWaitMs(key: string, budget: ProviderRequestBudget | undefined, estimatedTokens: number, now = Date.now()): number {
  const maxRequests = normalizeProviderRateLimit(budget?.maxRequestsPerMinute);
  const maxTokens = normalizeProviderRateLimit(budget?.maxTokensPerMinute);
  if (!maxRequests && !maxTokens) return 0;
  const entries = pruneProviderBudgetWindow(key, now);
  const demand = Math.max(0, Math.round(estimatedTokens));
  let waitMs = 0;
  if (maxRequests && entries.length >= maxRequests) {
    const oldestOfWindow = entries[entries.length - maxRequests];
    waitMs = Math.max(waitMs, oldestOfWindow.at + PROVIDER_BUDGET_WINDOW_MS - now);
  }
  if (maxTokens) {
    const tokensInWindow = entries.reduce((total, entry) => total + entry.tokens, 0);
    if (tokensInWindow + demand > maxTokens) {
      let released = 0;
      let resolved = false;
      for (let index = 0; index < entries.length; index++) {
        released += entries[index].tokens;
        if (tokensInWindow - released + demand <= maxTokens) {
          waitMs = Math.max(waitMs, entries[index].at + PROVIDER_BUDGET_WINDOW_MS - now);
          resolved = true;
          break;
        }
      }
      // A single request larger than the whole ceiling cannot fit even an empty
      // window; waiting for the oldest entry to expire still grants the
      // fullest possible window rather than stalling the turn forever.
      if (!resolved && entries.length) waitMs = Math.max(waitMs, entries[0].at + PROVIDER_BUDGET_WINDOW_MS - now);
    }
  }
  return Math.max(0, waitMs);
}

function effectiveProviderIntervalMs(key: string, minimumIntervalMs: number, now = Date.now()): number {
  const configured = normalizeProviderRequestInterval(minimumIntervalMs);
  // Overdrive Mode: provider headers may describe the limit, but the spacing
  // they imply is NUVRO AI's own throttle. Overdrive fires the next request
  // immediately; an actual 429 is served by the exact-retry loop instead.
  if (isOverdriveActive()) return configured;
  const adaptive = providerAdaptiveIntervals.get(key);
  if (!adaptive) return configured;
  if (adaptive.expiresAt <= now) {
    providerAdaptiveIntervals.delete(key);
    return configured;
  }
  // The default interval is a conservative fallback that provider headers may
  // safely improve. Explicit faster settings (including Turbo's 1000ms floor)
  // remain a floor, while tighter advertised limits always take precedence.
  return configured === DEFAULT_ONLINE_PROVIDER_MIN_INTERVAL_MS
    ? adaptive.intervalMs
    : Math.max(configured, adaptive.intervalMs);
}

/** Record a sent request (send time + conservative token estimate) in the window. */
export function noteProviderBudgetRequest(key: string, estimatedTokens: number, now = Date.now()): void {
  const entries = pruneProviderBudgetWindow(key, now);
  entries.push({ at: now, tokens: Math.max(0, Math.round(estimatedTokens)) });
  providerBudgetWindows.set(key, entries);
}

function waitForProviderSlot(key: string, minimumIntervalMs = 0, signal?: AbortSignal, priority: 'high' | 'low' = 'high', bypassCooldown = false, maxConcurrentRequests = 1, overdrive = false): Promise<() => void> {
  if (signal?.aborted) return Promise.reject(new Error('Universal API request cancelled while waiting for provider pacing.'));
  const depth = providerQueueDepth.get(key) || 0;
  if (depth >= UNIVERSAL_MAX_QUEUED_REQUESTS_PER_ENDPOINT) {
    return Promise.reject(new Error('Provider request queue is full. Wait for an active request to finish, then retry.'));
  }
  const queue = providerSlotQueues.get(key) || {activeCount:0, waiters:[]};
  providerSlotQueues.set(key, queue);
  providerQueueDepth.set(key, depth + 1);
  return new Promise<() => void>((resolve, reject) => {
    const waiter: ProviderSlotWaiter = {
      priority, sequence: providerQueueSequence++,
      minimumIntervalMs: Math.max(0, Math.min(60_000, Math.round(minimumIntervalMs))),
      maxConcurrentRequests: Math.max(1, Math.min(overdrive ? OVERDRIVE_MAX_CONCURRENT_REQUESTS : 4, Math.round(maxConcurrentRequests) || 1)),
      bypassCooldown,
      signal, resolve, reject,
    };
    waiter.onAbort = () => {
      const index = queue.waiters.indexOf(waiter);
      if (index < 0) return;
      queue.waiters.splice(index, 1);
      signal?.removeEventListener('abort', waiter.onAbort!);
      const remaining = Math.max(0, (providerQueueDepth.get(key) || 1) - 1);
      if (remaining) providerQueueDepth.set(key, remaining); else providerQueueDepth.delete(key);
      if (queue.timer) { clearTimeout(queue.timer); queue.timer = undefined; }
      if (queue.activeCount === 0 && queue.waiters.length === 0) providerSlotQueues.delete(key);
      reject(new Error('Universal API request cancelled while waiting for provider pacing.'));
      pumpProviderQueue(key);
    };
    signal?.addEventListener('abort', waiter.onAbort, {once:true});
    queue.waiters.push(waiter);
    // A newly queued failover may be eligible sooner than a timer created for
    // a normal request. Re-evaluate the now-prioritized queue head.
    if (queue.timer) { clearTimeout(queue.timer); queue.timer = undefined; }
    pumpProviderQueue(key);
  });
}

function pumpProviderQueue(key: string): void {
  const queue = providerSlotQueues.get(key);
  if (!queue || queue.timer || !queue.waiters.length) return;
  queue.waiters.sort((a, b) => a.priority === b.priority ? a.sequence - b.sequence : a.priority === 'high' ? -1 : 1);
  const next = queue.waiters[0];
  if (queue.activeCount >= next.maxConcurrentRequests) return;
  if (next.signal?.aborted) { next.onAbort?.(); return; }
  const interval = effectiveProviderIntervalMs(key, next.minimumIntervalMs);
  const now = Date.now();
  const previous = lastRequestAt.get(key) || 0;
  const cooldownWait = next.bypassCooldown ? 0 : (providerCooldownUntil.get(key) || 0) - now;
  const waitMs = Math.max(0, previous + interval - now, cooldownWait, (providerCircuitUntil.get(key) || 0) - now);
  if (waitMs > 0) {
    queue.timer = setTimeout(() => { queue.timer = undefined; pumpProviderQueue(key); }, waitMs);
    return;
  }
  queue.waiters.shift();
  next.signal?.removeEventListener('abort', next.onAbort!);
  queue.activeCount += 1;
  lastRequestAt.set(key, Date.now());
  let released = false;
  next.resolve(() => {
    if (released) return;
    released = true;
    queue.activeCount = Math.max(0, queue.activeCount - 1);
    const remaining = Math.max(0, (providerQueueDepth.get(key) || 1) - 1);
    if (remaining) providerQueueDepth.set(key, remaining); else providerQueueDepth.delete(key);
    if (!queue.waiters.length && queue.activeCount === 0) providerSlotQueues.delete(key);
    else pumpProviderQueue(key);
  });
  pumpProviderQueue(key);
}

/**
 * Keep provider throttling polite and bounded. Retry-After may be either a
 * delta-seconds value or an HTTP date; provider outages must never make the
 * client sleep unboundedly or hammer a rate-limited endpoint.
 */
export function universalRetryDelayMs(attempt: number, retryAfter: string | null | undefined, now = Date.now(), random = Math.random()): number {
  const jitter = 0.8 + Math.max(0, Math.min(1, Number.isFinite(random) ? random : 0.5)) * 0.4;
  const exponential = Math.max(UNIVERSAL_RETRY_MIN_MS, Math.min(UNIVERSAL_RETRY_MAX_MS, Math.round(UNIVERSAL_RETRY_MIN_MS * (2 ** Math.max(0, attempt)) * jitter)));
  if (!retryAfter?.trim()) return exponential;
  const value = retryAfter.trim();
  const seconds = /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : NaN;
  const dateMs = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
  if (!Number.isFinite(dateMs)) return exponential;
  // A provider's Retry-After is authoritative. Oversized values are not
  // slept through in a foreground request; the shared cooldown is retained
  // and the request is surfaced for later resume.
  return Math.max(250, Math.round(dateMs));
}

/**
 * Overdrive rate-limit wait: the provider's advertised reset, to the second.
 * No jitter, no exponential growth, no app-side floor — the retry fires the
 * moment the window reopens. Falls back to a short, constant wait only when
 * the provider publishes no timing information at all.
 */
export function overdriveRateLimitRetryMs(attempt: number, retryAfter: string | null | undefined, providerWaitMs: number, now = Date.now()): number {
  const advertised = universalRetryDelayMs(attempt, retryAfter, now, 0.5);
  const wait = Math.max(providerWaitMs, retryAfter?.trim() ? advertised : Math.min(1_000, 250 * (attempt + 1)));
  return Math.min(OVERDRIVE_MAX_RATE_LIMIT_WAIT_MS, Math.max(250, Math.round(wait)));
}

function universalTransientError(status: number, retries: number): string {
  if (status === 429) return 'Universal API rate limit is still active. NUVRO AI will respect the provider cooldown; retry later or check provider quota.';
  if (retries === 0) return `Universal API returned HTTP ${status}. The provider cooldown is active; retry later. Check endpoint, model name, access and credits.`;
  return `Universal API returned HTTP ${status} after ${retries} retries. Check endpoint, model name, access and credits.`;
}

export type UniversalKeyContext = { protocol: UniversalProtocol; endpoint: string };

/** API credentials are scoped to a validated API URL + protocol. A user may
 * change model IDs within a provider, but changing provider/URL requires a
 * different key. This prevents forwarding an existing key to a new endpoint.
 */
export function universalKeyScope(context: UniversalKeyContext): string {
  return `${context.protocol}::${validateUniversalEndpoint(context.endpoint, context.protocol)}`;
}

export function saveUniversalKey(value: string, context: UniversalKeyContext): void {
  const key = typeof value === 'string' ? value.trim() : '';
  if (!key || key.length > 4096 || /[\r\n]/.test(key)) throw new Error('Enter a valid API key.');
  const scope = universalKeyScope(context);
  const keyFile = scopedKeyFile(context);
  const encrypted = dpapi('protect', key);
  if (dpapi('unprotect', encrypted) !== key) throw new Error('Windows secure key verification failed. Previous key was not changed.');
  fs.mkdirSync(path.dirname(keyFile), {recursive:true});
  const tmp = `${keyFile}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify({format:'dpapi-current-user-v2', scope, data:encrypted}), {mode:0o600, flag:'wx'});
    fs.renameSync(tmp, keyFile);
  } finally {
    try { fs.unlinkSync(tmp); } catch (err:any) {if(err?.code!=='ENOENT') throw err;}
  }
}
export function clearUniversalKey(context?:UniversalKeyContext): void {
  if(context && fs.existsSync(keyFile)) {const record=JSON.parse(fs.readFileSync(keyFile,'utf8'));if(record.scope===universalKeyScope(context)) fs.unlinkSync(keyFile);}
  try {fs.unlinkSync(context ? scopedKeyFile(context) : keyFile);} catch(err:any) {if(err?.code!=='ENOENT') throw err;}
  if (context) clearUniversalKeyPool(context);
}
function scopedKeyFile(context:UniversalKeyContext) {return path.join(path.dirname(keyFile), `provider-${createHash("sha256").update(universalKeyScope(context)).digest("hex")}.dpapi.json`);}
function scopedKeyPoolFile(context:UniversalKeyContext) {return path.join(path.dirname(keyFile), `provider-${createHash("sha256").update(universalKeyScope(context)).digest("hex")}.pool.dpapi.json`);}
export function readUniversalKey(context: UniversalKeyContext): string {
  const scoped = scopedKeyFile(context);
  const keyFile = fs.existsSync(scoped) ? scoped : path.join(os.homedir(), ".quillix", "universal-key.dpapi.json");
  // A deliberately configured environment variable overrides stored keys.
  // Only configure this for a trusted endpoint you control.
  if (process.env.QUILLIX_UNIVERSAL_API_KEY?.trim() && process.env.QUILLIX_UNIVERSAL_API_ENDPOINT && universalKeyScope(context)===universalKeyScope({protocol:(process.env.QUILLIX_UNIVERSAL_API_PROTOCOL||'openai') as UniversalProtocol,endpoint:process.env.QUILLIX_UNIVERSAL_API_ENDPOINT})) return process.env.QUILLIX_UNIVERSAL_API_KEY.trim();
  if (!fs.existsSync(keyFile)) return '';
  const record = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
  if (record?.format !== 'dpapi-current-user-v2' || typeof record.data !== 'string')
    throw new Error('Legacy Universal key needs migration. Restart NUVRO AI or save your key again.');
  if (record.scope !== universalKeyScope(context))
    throw new Error('The saved Universal API key belongs to a different endpoint. Save a key for this API provider before connecting.');
  return dpapi('unprotect', record.data);
}
/**
 * Optional same-provider failover pool. The primary credential remains the
 * encrypted Windows-stored key; additional credentials may be supplied via
 * QUILLIX_UNIVERSAL_API_KEYS for managed deployments. They are never logged
 * or exposed to the renderer. Account-level quotas are still shared by the
 * provider and are not bypassed by rotating keys.
 */
export function readUniversalKeys(context: UniversalKeyContext): string[] {
  const primary = readUniversalKey(context);
  const pool = readUniversalKeyPool(context);
  const configured = (process.env.QUILLIX_UNIVERSAL_API_KEYS || '')
    .split(/[\r\n,;]+/)
    .map(value => value.trim())
    .filter(Boolean);
  return [...new Set([primary, ...pool, ...configured].filter(key => key.length > 0))];
}

/** Optional managed-deployment pool for dedicated providers. The encrypted
 * primary credential remains first; environment backups are never persisted,
 * logged or returned to the renderer. */
export function providerEnvironmentKeyPool(primary: string, envName: string): string[] {
  const values = [primary, ...(process.env[envName] || '').split(/[\r\n,;]+/g)]
    .map(value => value.trim()).filter(Boolean);
  return [...new Set(values)].slice(0, 20);
}
export function readUniversalKeyPool(context: UniversalKeyContext): string[] {
  const file = scopedKeyPoolFile(context);
  if (!fs.existsSync(file)) return [];
  try {
    const record = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (record?.format !== 'dpapi-current-user-v1-pool' || record.scope !== universalKeyScope(context) || typeof record.data !== 'string') return [];
    const values = JSON.parse(dpapi('unprotect', record.data));
    return Array.isArray(values) ? [...new Set(values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 4096).map(value => value.trim()))] : [];
  } catch { return []; }
}
export function saveUniversalKeyToPool(value: string, context: UniversalKeyContext): number {
  const key = typeof value === 'string' ? value.trim() : '';
  if (!key || key.length > 4096 || /[\r\n]/.test(key)) throw new Error('Enter a valid API key.');
  const scope = universalKeyScope(context);
  const values = [...new Set([...readUniversalKeyPool(context), key])];
  if (values.length > 20) throw new Error('A provider can have at most 20 failover keys.');
  const file = scopedKeyPoolFile(context);
  const encrypted = dpapi('protect', JSON.stringify(values));
  if (JSON.parse(dpapi('unprotect', encrypted)).length !== values.length) throw new Error('Windows secure key verification failed.');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  try { fs.writeFileSync(tmp, JSON.stringify({ format: 'dpapi-current-user-v1-pool', scope, data: encrypted }), { mode: 0o600, flag: 'wx' }); fs.renameSync(tmp, file); }
  finally { try { fs.unlinkSync(tmp); } catch (err: any) { if (err?.code !== 'ENOENT') throw err; } }
  return values.length;
}
export function clearUniversalKeyPool(context: UniversalKeyContext): void { try { fs.unlinkSync(scopedKeyPoolFile(context)); } catch (err: any) { if (err?.code !== 'ENOENT') throw err; } }
export function hasUniversalKey(context: UniversalKeyContext): boolean {try {return !!readUniversalKey(context);} catch {return false;} }
export function universalKeyPoolCount(context: UniversalKeyContext): number { return readUniversalKeyPool(context).length; }

/** Migrate an existing Windows DPAPI encrypted key without displaying it.
 * This is invoked once at startup against the previously persisted settings;
 * it never forwards a legacy key to a different endpoint.
 */
export function migrateLegacyUniversalKey(context: UniversalKeyContext): boolean {
  if(fs.existsSync(scopedKeyFile(context))) return false;
  if (!fs.existsSync(keyFile)) return false;
  const record = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
  if (record?.format !== 'dpapi-current-user-v1' || typeof record.data !== 'string') return false;
  const oldKey = dpapi('unprotect', record.data);
  if (!oldKey) throw new Error('Existing Universal API key could not be decrypted.');
  saveUniversalKey(oldKey, context);
  return true;
}

export function validateUniversalEndpoint(endpoint:string, protocol:UniversalProtocol): string {
  let url:URL;
  try { url=new URL(endpoint.trim()); } catch {throw new Error('Enter a valid API endpoint URL.');}
  if (url.username || url.password || url.hash || url.search) throw new Error('API URL must not contain credentials, fragments, or query secrets.');
  const loopback = ['localhost','127.0.0.1','[::1]'].includes(url.hostname.toLowerCase());
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) throw new Error('Cloud API URLs must use HTTPS; HTTP is only allowed for localhost.');
  if (!url.hostname) throw new Error('API endpoint hostname required.');
  // For native Gemini API, endpoint is the API root, not a model path.
  if (protocol==='gemini' && /\/(models\/|generateContent)/i.test(url.pathname)) throw new Error('Use the Gemini API root URL, not a specific model URL.');
  return url.toString().replace(/\/+$/, '');
}

function parsedArguments(value: unknown):Record<string,unknown>{
  let object:unknown=value;
  if(typeof value==='string') { try {object=JSON.parse(value);} catch {throw new Error('Model returned invalid tool-call JSON. No tool was executed.');} }
  if(!object || typeof object!=='object'||Array.isArray(object)) throw new Error('Model returned non-object tool arguments. No tool was executed.');
  return object as Record<string,unknown>;
}
function functions(tools:ToolDefinition[]) {return tools.map(t=>({type:'function',function:{name:t.name,description:t.description,parameters:t.parameters}}));}
function toOpenAI(messages:UniversalMessage[]) {
  return messages.map(m=>m.role==='tool'
    ? {role:'tool',content:m.content,tool_call_id:m.toolCallId || ''}
    : {...{role:m.role,content:m.content},...(m.toolCalls?.length?{tool_calls:m.toolCalls.map(c=>({id:c.id,type:'function',function:{name:c.name,arguments:JSON.stringify(c.args)}}))}: {})});
}
/** OpenAI Responses API uses typed function_call / function_call_output input
 * items rather than Chat Completions tool messages.
 */
function toResponses(messages:UniversalMessage[]) {
  const input: any[] = [];
  for (const m of messages) {
    const native=m.toolCalls?.find(c=>c.providerMetadata?.protocol==='responses')?.providerMetadata;
    if(native) {input.push(...native.blocks);continue;}
    if (m.content && m.role !== 'tool') input.push({ role: m.role, content: m.content });
    for (const call of m.toolCalls || []) input.push({type:'function_call',call_id:call.id,name:call.name,arguments:JSON.stringify(call.args)});
    if (m.role === 'tool') input.push({type:'function_call_output',call_id:m.toolCallId || '',output:m.content});
  }
  return input;
}
function toAnthropic(messages:UniversalMessage[]) {
  const system = messages.filter(m=>m.role==='system').map(m=>m.content).join('\n\n');
  const converted: Array<{role:'user'|'assistant';content:any}> = [];
  for(const m of messages) {
    if(m.role==='system') continue;
    if(m.role==='tool') {converted.push({role:'user',content:[{type:'tool_result',tool_use_id:m.toolCallId || '',content:m.content}]});continue;}
    const native=m.toolCalls?.find(c=>c.providerMetadata?.protocol==='anthropic')?.providerMetadata;
    if(native) {converted.push({role:'assistant',content:native.blocks});continue;}
    const blocks:any[]=[];
    if(m.content) blocks.push({type:'text',text:m.content});
    for(const c of m.toolCalls||[]) blocks.push({type:'tool_use',id:c.id,name:c.name,input:c.args});
    converted.push({role:m.role,content:blocks.length?blocks:[{type:'text',text:' '}]});
  }
  return {system, messages:converted};
}
function toGemini(messages:UniversalMessage[]) {
  const system = messages.filter(m=>m.role==='system').map(m=>m.content).join('\n\n');
  const contents:any[]=[];
  for(const m of messages) {
    if(m.role==='system') continue;
    if(m.role==='tool') {contents.push({role:'user',parts:[{functionResponse:{name:m.name||'tool',response:{result:m.content}}}]});continue;}
    const native=m.toolCalls?.find(c=>c.providerMetadata?.protocol==='gemini')?.providerMetadata;
    if(native) {contents.push({role:'model',parts:native.blocks});continue;}
    const parts:any[]=[];
    if(m.content) parts.push({text:m.content});
    for(const c of m.toolCalls||[]) parts.push({functionCall:{name:c.name,args:c.args}});
    contents.push({role:m.role==='assistant'?'model':'user',parts:parts.length?parts:[{text:' '} ]});
  }
  return {system,contents};
}

function universalMessageSize(message: UniversalMessage): number {
  return message.content.length + (message.toolCalls?.reduce((n, call) => n + call.name.length + JSON.stringify(call.args).length, 0) || 0) + 80;
}

/**
 * Compact a single oversized user request without touching the task record.
 * Large pasted prompts commonly contain a duplicated master prompt; removing
 * repeated paragraphs first preserves much more intent than a blind tail cut.
 * The tail is prioritized so the latest execution directive survives. If the
 * middle must be omitted, the marker tells the model not to invent its content.
 */
export function compactUniversalUserContent(content: string, maxChars: number): { content: string; changed: boolean } {
  const normalize = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase();
  const paragraphs = content.split(/\n{2,}/);
  const seen = new Set<string>();
  const deduped = paragraphs.filter((paragraph) => {
    const key = normalize(paragraph);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).join('\n\n');
  if (deduped.length <= maxChars) return { content: deduped, changed: deduped !== content };

  const headingsAndRequirements = deduped.split('\n').filter((line) =>
    /^\s*(?:#{1,6}\s|[-*]\s|\d+[.)]\s|\*\*[^*]+\*\*\s*$)/.test(line)
  ).join('\n');
  const compact = headingsAndRequirements.length >= Math.min(2000, maxChars * 0.35)
    ? headingsAndRequirements
    : deduped;
  if (compact.length <= maxChars) return { content: compact, changed: compact !== content };

  const marker = '\n\n[NUVRO AI omitted middle text to fit provider size limits; do not assume omitted requirements.]\n\n';
  if (maxChars <= marker.length) return { content: marker.slice(0, Math.max(0, maxChars)), changed: true };
  const contentBudget = maxChars - marker.length;
  const tailSize = Math.ceil(contentBudget * 0.36);
  const headSize = contentBudget - tailSize;
  const finalParagraph = compact.split(/\n{2,}/).at(-1) || '';
  let tail = compact.slice(-tailSize);
  if (finalParagraph.length > tailSize) {
    const excerptMarker = '\n[…middle omitted…]\n';
    const excerptBudget = tailSize - excerptMarker.length;
    const finalHeadSize = Math.ceil(excerptBudget * 0.4);
    const finalTailSize = excerptBudget - finalHeadSize;
    tail = `${finalParagraph.slice(0, finalHeadSize)}${excerptMarker}${compact.slice(-finalTailSize)}`;
  }
  return { content: `${compact.slice(0, headSize)}${marker}${tail}`, changed: true };
}

/**
 * Reduce a rejected context payload without losing the safety prompt or the
 * latest user request. Older tool results are the cheapest context to drop;
 * older conversation turns are removed only after those results. A result
 * with `tooLarge=true` means the protected system/latest-user content alone
 * cannot fit and must be reported instead of silently truncating the request.
 */
export function trimUniversalMessagesForPayload(messages: UniversalMessage[], maxChars = 120_000): {messages: UniversalMessage[]; changed: boolean; tooLarge: boolean} {
  const latestUser = [...messages].map((message, index) => ({message, index})).reverse().find(({message}) => message.role === 'user')?.index ?? -1;
  const systemSize = messages.reduce((sum, message) => message.role === 'system' ? sum + universalMessageSize(message) : sum, 0);
  const latestBudget = Math.max(4_000, maxChars - systemSize - 2_000);
  const prepared = messages.map((message, index) => {
    if (index !== latestUser || message.role !== 'user') return message;
    const compacted = compactUniversalUserContent(message.content, latestBudget);
    return compacted.changed ? {...message, content: compacted.content} : message;
  });
  // Repeated conversational acknowledgements are common after a provider
  // retry. Keep the newest exact copy, but never deduplicate tool messages or
  // messages carrying tool calls because their IDs form the execution pair.
  const duplicateIndexes = new Set<number>();
  const seenTurns = new Set<string>();
  for (let index = prepared.length - 1; index >= 0; index--) {
    const message = prepared[index];
    if (message.role === 'system' || message.role === 'tool' || message.toolCalls?.length) continue;
    const key = `${message.role}:${message.content.trim()}`;
    if (seenTurns.has(key)) duplicateIndexes.add(index);
    else seenTurns.add(key);
  }
  const deduplicated = prepared.filter((_, index) => !duplicateIndexes.has(index));
  const latestUserAfterDedup = [...deduplicated].map((message, index) => ({message, index})).reverse().find(({message}) => message.role === 'user')?.index ?? -1;
  const protectedIndexes = new Set(deduplicated.map((message, index) => message.role === 'system' || index === latestUserAfterDedup ? index : -1).filter(index => index >= 0));
  const protectedSize = deduplicated.reduce((sum, message, index) => protectedIndexes.has(index) ? sum + universalMessageSize(message) : sum, 0);
  if (protectedSize > maxChars) return {messages, changed: false, tooLarge: true};
  const removable = deduplicated
    .map((message, index) => ({message, index}))
    .filter(({index}) => !protectedIndexes.has(index))
    .sort((a, b) => Number(b.message.role === 'tool') - Number(a.message.role === 'tool') || a.index - b.index);
  const kept = deduplicated.map((message, index) => ({message, index}));
  let size = deduplicated.reduce((sum, message) => sum + universalMessageSize(message), 0);
  const removedToolCallIds = new Set<string>();
  for (const item of removable) {
    if (size <= maxChars) break;
    const position = kept.findIndex(candidate => candidate.index === item.index);
    if (position < 0) continue;
    kept.splice(position, 1);
    size -= universalMessageSize(item.message);
    if (item.message.role === 'tool' && item.message.toolCallId) removedToolCallIds.add(item.message.toolCallId);
  }
  const compacted = kept
    .map(({message}) => removedToolCallIds.size && message.toolCalls?.length
      ? {...message, toolCalls: message.toolCalls.filter(call => !removedToolCallIds.has(call.id))}
      : message)
    .filter(message => message.role !== 'assistant' || message.content.trim() || message.toolCalls?.length);
  return {messages: compacted, changed: duplicateIndexes.size > 0 || compacted.length !== messages.length || compacted.some((message, index) => message !== messages[index]), tooLarge: false};
}

export function trimUniversalToolsForPayload(tools: ToolDefinition[]): {tools: ToolDefinition[]; changed: boolean} {
  const trimSchema = (value: any, depth = 0): any => {
    if (!value || typeof value !== 'object' || depth > 8) return value;
    if (Array.isArray(value)) return value.map(item => trimSchema(item, depth + 1));
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
      key,
      key === 'description' && typeof entry === 'string' ? entry.slice(0, 180) : trimSchema(entry, depth + 1),
    ]));
  };
  const trimmed = tools.map(tool => ({
    ...tool,
    description: typeof tool.description === 'string' ? tool.description.slice(0, 600) : tool.description,
    parameters: trimSchema(tool.parameters),
  }));
  return {
    tools: trimmed,
    changed: trimmed.some((tool, index) =>
      tool.description !== tools[index].description || JSON.stringify(tool.parameters) !== JSON.stringify(tools[index].parameters),
    ),
  };
}

export function universalPayloadTooLargeError(): string {
  return 'Universal API rejected this request as too large (HTTP 413). NUVRO AI removed older history/tool output once, but the system instructions and latest request still need to fit. Reduce selected files/context or use a model with a larger context limit.';
}

function applyUniversalPayload(body: any, protocol: UniversalProtocol, messages: UniversalMessage[], tools: ToolDefinition[]): void {
  if (protocol === 'openai') {
    body.messages = toOpenAI(messages);
    if (tools.length) body.tools = functions(tools); else delete body.tools;
    return;
  }
  if (protocol === 'responses') {
    body.input = toResponses(messages);
    if (tools.length) body.tools = tools.map(t => ({type:'function',name:t.name,description:t.description,parameters:t.parameters,strict:false})); else delete body.tools;
    return;
  }
  if (protocol === 'anthropic') {
    const content = toAnthropic(messages);
    body.messages = content.messages;
    if (content.system) body.system = content.system; else delete body.system;
    if (tools.length) body.tools = tools.map(t => ({name:t.name,description:t.description,input_schema:t.parameters})); else delete body.tools;
    return;
  }
  const content = toGemini(messages);
  body.contents = content.contents;
  if (content.system) body.systemInstruction = {parts:[{text:content.system}]}; else delete body.systemInstruction;
  if (tools.length) body.tools = [{functionDeclarations:tools.map(t => ({name:t.name,description:t.description,parameters:t.parameters}))}]; else delete body.tools;
}

/**
 * Fold a diagnostics snapshot into a compact health/throughput summary (M7.5,
 * phases 13/17). Pure and defensive: every field is optional so a partial
 * snapshot (e.g., before the first request) yields `unknown` instead of NaN.
 * Observational only — it does not alter pacing, retries, or quota handling.
 */
export function summarizeProviderHealth(snapshot: {
  requests?: number; httpSuccesses?: number; http429?: number; http401?: number; http402?: number; http403?: number;
  averageResponseLatencyMs?: number; averageTimeToFirstTokenMs?: number; tokensPerSecond?: number;
  effectiveRequestIntervalMs?: number; queuedRequests?: number; waitingMs?: number;
  cooldownUntil?: number | null; circuitOpenUntil?: number | null; consecutiveServerFailures?: number;
}): ProviderHealthSummary {
  const requests = Math.max(0, Number(snapshot.requests || 0));
  const successes = Math.max(0, Number(snapshot.httpSuccesses || 0));
  const rateLimited = Number(snapshot.http429 || 0) > 0;
  const authError = Number(snapshot.http401 || 0) > 0 || Number(snapshot.http403 || 0) > 0;
  const billing = Number(snapshot.http402 || 0) > 0;
  const failures = Math.max(0, requests - successes);
  const successRate = requests ? Math.round((successes / requests) * 100) / 100 : 0;
  const circuitOpen = snapshot.circuitOpenUntil != null;
  const cooldown = !circuitOpen && snapshot.cooldownUntil != null;
  let availability: ProviderHealthSummary['availability'] = 'unknown';
  if (requests > 0) {
    if (circuitOpen) availability = 'circuit-open';
    else if (billing) availability = 'billing';
    else if (authError) availability = 'auth';
    else if (cooldown) availability = 'cooldown';
    else if (rateLimited) availability = 'throttled';
    else if (Number(snapshot.consecutiveServerFailures || 0) > 0) availability = 'degraded';
    else availability = 'ok';
  }
  return {
    requests, successes, failures, successRate,
    rateLimited, authError, billing,
    averageLatencyMs: Math.max(0, Number(snapshot.averageResponseLatencyMs || 0)),
    averageFirstTokenMs: Math.max(0, Number(snapshot.averageTimeToFirstTokenMs || 0)),
    tokensPerSecond: Math.max(0, Number(snapshot.tokensPerSecond || 0)),
    effectiveIntervalMs: Math.max(0, Number(snapshot.effectiveRequestIntervalMs || 0)),
    queueDepth: Math.max(0, Number(snapshot.queuedRequests || 0)),
    recommendedWaitMs: Math.max(0, Number(snapshot.waitingMs || 0)),
    availability,
  };
}

/** Provider-reported generated-token throughput; prompt tokens are excluded. */
export function calculateReportedOutputTokensPerSecond(outputTokens: number, generationMs: number): number {
  const output = Math.max(0, Number(outputTokens) || 0);
  const duration = Math.max(0, Number(generationMs) || 0);
  return output > 0 && duration > 0 ? Math.round(output * 100_000 / duration) / 100 : 0;
}

export class UniversalProvider implements AIProvider {
  public getSelectedModel(): string { return this.config().model.trim(); }
  constructor(private readonly config:()=>ProviderConfig, private readonly credential:()=>string | string[] = () => readUniversalKeys(this.config())){}
  public readonly usage: Array<{model:string;inputTokens:number;outputTokens:number;estimatedCost?:number}> = [];
  private readonly diagnostics = {
    requests: 0, httpSuccesses: 0, http429: 0, http402: 0, http401: 0, http403: 0, deduplicatedRequests: 0,
    retries: 0, cancellations: 0, timeouts: 0, queueWaitMs: 0, latencyMs: 0, latencySamples: 0,
    firstTokenMs: 0, firstTokenSamples: 0, inputTokens: 0, outputTokens: 0, generationMs: 0,
  };
  private readonly inflightTextRequests = new Map<string, Promise<string>>();
  public diagnosticsSnapshot() {
    const d = this.diagnostics;
    let endpointKey = '';
    let effectiveRequestIntervalMs = 0;
    let maxConcurrentRequests = 1;
    try {
      const cfg = this.config();
      endpointKey = `${cfg.protocol}:${validateUniversalEndpoint(cfg.endpoint, cfg.protocol)}`;
      maxConcurrentRequests = cfg.overdriveMode === true
        ? Math.max(1, Math.min(OVERDRIVE_MAX_CONCURRENT_REQUESTS, Math.round(cfg.requestBudget?.maxConcurrentRequests || 1)))
        : cfg.requestBudget?.maxRequestsPerMinute || cfg.requestBudget?.maxTokensPerMinute
        ? 1 : Math.max(1, Math.min(4, Math.round(cfg.requestBudget?.maxConcurrentRequests || 1)));
      const settingsForDiag = (() => { try { return new SettingsStore().get(); } catch { return undefined; } })();
      const dynamicInterval = settingsForDiag ? getEffectiveProviderIntervalMs({ turboSpeedMode: settingsForDiag.turboSpeedMode, performanceMode: settingsForDiag.performanceMode }) : undefined;
      const configured = normalizeProviderRequestInterval(
        cfg.requestBudget?.minRequestIntervalMs,
        dynamicInterval ?? DEFAULT_ONLINE_PROVIDER_MIN_INTERVAL_MS,
      );
      effectiveRequestIntervalMs = effectiveProviderIntervalMs(endpointKey, configured);
    } catch { /* Invalid config has no endpoint-scoped diagnostics. */ }
    const cooldownUntil = endpointKey ? providerCooldownUntil.get(endpointKey) || 0 : 0;
    const circuitUntil = endpointKey ? providerCircuitUntil.get(endpointKey) || 0 : 0;
    const lastAt = endpointKey ? lastRequestAt.get(endpointKey) || 0 : 0;
    const nextRequestAt = Math.max(lastAt ? lastAt + effectiveRequestIntervalMs : 0, cooldownUntil, circuitUntil);
    const waitingMs = nextRequestAt > Date.now() ? nextRequestAt - Date.now() : 0;
    const averageResponseLatencyMs = d.latencySamples ? Math.round(d.latencyMs / d.latencySamples) : 0;
    const averageTimeToFirstTokenMs = d.firstTokenSamples ? Math.round(d.firstTokenMs / d.firstTokenSamples) : 0;
    const tokensPerSecond = calculateReportedOutputTokensPerSecond(d.outputTokens, d.generationMs);
    const consecutiveServerFailures = endpointKey ? providerServerFailures.get(endpointKey) || 0 : 0;
    const cooldownUntilValue = cooldownUntil > Date.now() ? cooldownUntil : null;
    const circuitOpenUntil = circuitUntil > Date.now() ? circuitUntil : null;
    const health = summarizeProviderHealth({
      requests: d.requests, httpSuccesses: d.httpSuccesses, http429: d.http429, http401: d.http401, http402: d.http402, http403: d.http403,
      averageResponseLatencyMs, averageTimeToFirstTokenMs, tokensPerSecond, effectiveRequestIntervalMs,
      queuedRequests: endpointKey ? providerQueueDepth.get(endpointKey) || 0 : 0, waitingMs,
      cooldownUntil: cooldownUntilValue, circuitOpenUntil, consecutiveServerFailures,
    });
    return {
      ...d,
      averageResponseLatencyMs,
      averageTimeToFirstTokenMs,
      tokensPerSecond,
      consecutiveServerFailures,
      circuitOpenUntil,
      cooldownUntil: cooldownUntilValue,
      queuedRequests: endpointKey ? providerQueueDepth.get(endpointKey) || 0 : 0,
      activeRequests: endpointKey ? providerSlotQueues.get(endpointKey)?.activeCount || 0 : 0,
      maxConcurrentRequests,
      lastRequestAt: lastAt || null,
      effectiveRequestIntervalMs,
      nextRequestAt: nextRequestAt > Date.now() ? nextRequestAt : null,
      waitingMs,
      health,
    };
  }
  public get capabilities(): ProviderCapabilities {
    const configured = this.config().capabilities;
    return {
      tools: configured?.tools !== false,
      streaming: configured?.streaming !== false,
      reasoning: configured?.reasoning === true,
    };
  }
  private async completion(messages:UniversalMessage[], tools:ToolDefinition[], options:AICompletionOptions={}, onChunk?:(text:string)=>void) {
    const cfg=this.config();
    options={...options,reasoningEffort:options.reasoningEffort??cfg.reasoningEffort};
    if(cfg.offlineMode) throw new Error('Turn off Offline Mode before using Universal API.');
    const endpoint=validateUniversalEndpoint(cfg.endpoint,cfg.protocol);
    const model=cfg.model.trim();
    if(!model || model.length>200) throw new Error('Enter the exact model name.');
    tools=cfg.capabilities?.tools===false?[]:tools;
    if(cfg.capabilities?.tools===false) messages=messages.map(m=>m.role==='tool'?{role:'user',content:`Tool ${m.name||''} result: ${m.content}`}:{role:m.role,content:m.content+(m.toolCalls?.length?'\nPrevious tool calls: '+JSON.stringify(m.toolCalls.map(c=>({name:c.name,args:c.args}))):'')});
    const streaming=!!onChunk && cfg.capabilities?.streaming!==false;
    const credentialValue = cfg.auth?.type === 'none' ? [''] : this.credential();
    const credentials = (Array.isArray(credentialValue) ? credentialValue : [credentialValue]).map(value => String(value).trim()).filter(Boolean);
    if (cfg.auth?.type === 'none') credentials.unshift('');
    let credentialIndex = 0;
    let key = credentials[credentialIndex] || '';
    if(!key && cfg.auth?.type!=='none') throw new Error('Save a Universal API key before using this provider.');
    const requestStartedAt = Date.now();
    this.diagnostics.requests++;
    const controller = new AbortController();
    let releaseProviderSlot:(()=>void)|null=null;
    // Cloud models may spend a long time thinking before their first token.
    // Keep a bounded inactivity timeout, but re-arm it on every valid stream event.
    // Normal coding turns get a generous inactivity window, while explicit
    // connection checks must be allowed to fail fast. Provider test routes
    // pass a short timeout so a slow/unsupported model cannot freeze Quick
    // Connect for three minutes.
    const timeoutMs=options.timeoutSeconds !== undefined
      ? Math.min(600000,Math.max(5000,options.timeoutSeconds*1000))
      : 180000;
    let timeoutKind: 'inactivity' | 'total' | undefined;
    let abortCause: 'caller' | 'timeout' | undefined;
    const totalTimeoutMs = Number.isFinite(options.totalTimeoutSeconds) && (options.totalTimeoutSeconds || 0) > 0
      ? Math.min(600_000, Math.max(1_000, (options.totalTimeoutSeconds || 0) * 1_000))
      : undefined;
    const abortError = () => abortCause === 'caller'
      ? new Error('Universal API request cancelled by caller.')
      : abortCause === 'timeout' && timeoutKind
        ? new Error(`Universal API request timed out after ${Math.ceil((timeoutKind === 'total' ? totalTimeoutMs! : timeoutMs) / 1000)}s (${timeoutKind} timeout).`)
        : new Error('Universal API request was aborted.');
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let totalTimeout: ReturnType<typeof setTimeout> | undefined;
    const abortForTimeout = (kind: 'inactivity' | 'total') => {
      if (controller.signal.aborted) return;
      timeoutKind = kind;
      abortCause = 'timeout';
      controller.abort(new Error(`Universal API ${kind} timeout.`));
    };
    const rearmTimeout=()=>{if(timeout) clearTimeout(timeout);timeout=setTimeout(()=>abortForTimeout('inactivity'),timeoutMs);};
    rearmTimeout();
    if (totalTimeoutMs !== undefined) {
      totalTimeout = setTimeout(() => abortForTimeout('total'), totalTimeoutMs);
    }
    let firstTokenRecorded = false;
    const recordFirstToken = () => {
      if (firstTokenRecorded) return;
      firstTokenRecorded = true;
      this.diagnostics.firstTokenMs += Date.now() - requestStartedAt;
      this.diagnostics.firstTokenSamples++;
    };
    const cancel=()=>{
      if (controller.signal.aborted) return;
      abortCause = 'caller';
      controller.abort(options.signal?.reason || new Error('Caller cancelled the request.'));
    };
    options.signal?.addEventListener('abort',cancel,{once:true});
    if(options.signal?.aborted) cancel();
    try {
      let msgs=options.systemInstruction && !messages.some(m=>m.role==='system'&&m.content===options.systemInstruction)
        ? [{role:'system' as const,content:options.systemInstruction},...messages] : messages;
      const requestBudget = cfg.requestBudget;
      if (requestBudget?.maxInputChars && Number.isFinite(requestBudget.maxInputChars)) {
        // The provider limit covers messages *and* the function schema. Keep
        // schema bytes out of the message budget so a large pasted request
        // cannot pass our local check and still receive HTTP 413 upstream.
        const maxInputChars = Math.round(requestBudget.maxInputChars);
        const initialToolSchemaChars = tools.length ? JSON.stringify(tools).length : 0;
        if (initialToolSchemaChars > Math.max(4_000, maxInputChars * 0.22)) {
          tools = trimUniversalToolsForPayload(tools).tools;
        }
        const toolSchemaChars = tools.length ? JSON.stringify(tools).length : 0;
        const messageBudget = Math.max(12_000, Math.round(requestBudget.maxInputChars) - toolSchemaChars - 2_000);
        const compacted = trimUniversalMessagesForPayload(msgs, messageBudget);
        if (compacted.tooLarge) throw new Error('Provider context budget is smaller than the protected instructions and latest request. Select fewer files or use a larger-context model.');
        msgs = compacted.messages;
      }
      const rateLimitScope = `${cfg.protocol}:${endpoint}`;
      // Overdrive Mode removes app-imposed delays: no endpoint spacing, no
      // declared rolling-quota wait, no resource-safety pause. Provider-side
      // latency and limits (including Retry-After cooldowns) still apply.
      const overdrive = cfg.overdriveMode === true;
      const maxTokens=Math.min(options.maxOutputTokens || 8192, requestBudget?.maxOutputTokens || Number.MAX_SAFE_INTEGER);
      const isOfficialReasoningChat = cfg.capabilities?.reasoning===true;
      if (options.requiredToolName && !tools.some(tool => tool.name === options.requiredToolName)) {
        throw new Error('The required tool is unavailable in this provider request.');
      }
      let url=endpoint, body:any, headers:Record<string,string>={'Content-Type':'application/json'};
      let payloadTrimAttempt = 0;
      if(cfg.protocol==='openai') {
        // Accept explicit /chat/completions, API roots (/v1) and generic /v1 custom endpoints.
        if(!/\/chat\/completions$/i.test(url)) url += '/chat/completions';
        body={model,messages:toOpenAI(msgs),...(url.startsWith('https://api.openai.com/')?{max_completion_tokens:maxTokens}:{max_tokens:maxTokens}), ...((tools.length>0)?{tools:functions(tools),tool_choice:options.requiredToolName ? {type:'function',function:{name:options.requiredToolName}} : 'auto'}:{}),...(!isOfficialReasoningChat && options.temperature!==undefined?{temperature:options.temperature}:{})};
      } else if(cfg.protocol==='responses') {
        if(!/\/responses$/i.test(url)) url += '/responses';
        body={model,input:toResponses(msgs),max_output_tokens:maxTokens,
          ...(cfg.capabilities?.reasoning?{store:false,include:['reasoning.encrypted_content']} : {}),
          ...(tools.length ? {tools:tools.map(t=>({type:'function',name:t.name,description:t.description,parameters:t.parameters,strict:false})),
            ...(options.requiredToolName?{tool_choice:{type:'function',name:options.requiredToolName}}:{})} : {})};
      } else if(cfg.protocol==='anthropic') {
        if(!/\/messages$/i.test(url)) url+='/messages';
        const content=toAnthropic(msgs);
        headers['anthropic-version']='2023-06-01';
        body={model,max_tokens:maxTokens,messages:content.messages,...(content.system?{system:content.system}:{}), ...(tools.length?{tools:tools.map(t=>({name:t.name,description:t.description,input_schema:t.parameters})),
          ...(options.requiredToolName?{tool_choice:{type:'tool',name:options.requiredToolName,disable_parallel_tool_use:true}}:{})}:{})};
      } else {
        url+=`/models/${encodeURIComponent(model)}:generateContent`;
        const content=toGemini(msgs);
        body={contents:content.contents,...(content.system?{systemInstruction:{parts:[{text:content.system}]}}:{}),generationConfig:{maxOutputTokens:maxTokens},...(tools.length?{tools:[{functionDeclarations:tools.map(t=>({name:t.name,description:t.description,parameters:t.parameters}))}],
          ...(options.requiredToolName?{toolConfig:{functionCallingConfig:{mode:'ANY',allowedFunctionNames:[options.requiredToolName]}}}:{})}:{})};
      }
      if(cfg.capabilities?.reasoning && options.reasoningEffort) {
        if(cfg.protocol==='responses') body.reasoning={effort:options.reasoningEffort};
        if(cfg.protocol==='openai') body.reasoning_effort=options.reasoningEffort;
        if(cfg.protocol==='anthropic' && options.reasoningEffort!=='none') body.thinking={type:'enabled',budget_tokens:Math.min(maxTokens-1,cfg.reasoningBudget||1024)};
        if(cfg.protocol==='gemini') body.generationConfig.thinkingConfig={thinkingBudget:options.reasoningEffort==='none'?0:cfg.reasoningBudget||1024};
      }
      if(streaming) {
        if(cfg.protocol==='gemini') url=url.replace(':generateContent',':streamGenerateContent')+'?alt=sse';
        else body.stream=true;
        if(cfg.protocol==='openai') body.stream_options={include_usage:true};
      }
      const applyCredential = () => {
        key = credentials[credentialIndex] || '';
        delete headers.Authorization; delete headers['x-api-key']; delete headers['x-goog-api-key'];
        if (cfg.auth?.type === 'none') return;
        if (cfg.auth?.type === 'bearer') headers.Authorization = `Bearer ${key}`;
        else if (cfg.auth?.type === 'basic') headers.Authorization = `Basic ${Buffer.from(key).toString('base64')}`;
        else if (cfg.auth?.type === 'header') {
          const header = cfg.auth.header || 'x-api-key';
          if (!/^[a-zA-Z0-9-]+$/.test(header) || /^(host|content-length|content-type|connection)$/i.test(header)) throw new Error('Invalid authentication header.');
          headers[header] = key;
        } else if (cfg.protocol === 'anthropic') headers['x-api-key'] = key;
        else if (cfg.protocol === 'gemini') headers['x-goog-api-key'] = key;
        else headers.Authorization = `Bearer ${key}`;
      };
      let response:Response;
      let retriesPerformed = 0;
      try {
        for(let attempt=0;;attempt++) {
          retriesPerformed = attempt;
          if (attempt > 0) this.diagnostics.retries++;
          try {
            // Every retry re-enters the shared endpoint queue. Without this,
            // retrying turns bypass normal pacing and can collide with other
            // queued models just as a provider's quota is exhausted.
            const queuedAt = Date.now();
            const requestIntervalMs = requestBudget?.minRequestIntervalMs;
            const maxConcurrentRequests = requestBudget?.maxRequestsPerMinute || requestBudget?.maxTokensPerMinute
              ? 1 : requestBudget?.maxConcurrentRequests ?? 1;
            releaseProviderSlot=await waitForProviderSlot(rateLimitScope, requestIntervalMs, controller.signal, options.priority || 'high', options.providerModelFailoverCooldownBypass === true, maxConcurrentRequests, overdrive);
            this.diagnostics.queueWaitMs += Date.now() - queuedAt;
            // Declared per-profile ceilings are checked after the endpoint slot
            // is held so the recorded send time reflects actual dispatch, and
            // every retry re-enters the check like the pacing queue above.
            // Overdrive skips this app-side window wait; the provider's own
            // 429 responses still pace the request through exact retries.
            const estimatedRequestTokens = Math.ceil(JSON.stringify(body).length / 4 + maxTokens);
            const budgetWaitMs = overdrive ? 0 : providerBudgetWaitMs(rateLimitScope, requestBudget, estimatedRequestTokens);
            if (budgetWaitMs > 0) {
              await new Promise<void>((resolve, reject) => {
                const abort = () => { clearTimeout(timer); reject(new Error('Universal API request cancelled while waiting for the provider budget window.')); };
                const timer = setTimeout(() => { controller.signal.removeEventListener('abort', abort); resolve(); }, budgetWaitMs);
                controller.signal.addEventListener('abort', abort, { once: true });
                if (controller.signal.aborted) abort();
              });
            }
            noteProviderBudgetRequest(rateLimitScope, estimatedRequestTokens);
            applyCredential();
            response=await fetch(url,{method:'POST',headers,body:JSON.stringify(body),signal:controller.signal,redirect:'error'});
          } catch (error:any) {
            releaseProviderSlot?.();
            releaseProviderSlot=null;
            // Retry transient transport failures with the same credential;
            // credentials only advance after an explicit authentication rejection.
            const message=String(error?.cause?.code || error?.code || error?.message || error);
            const transientConnection=/(?:ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENETUNREACH|ETIMEDOUT|fetch failed|socket hang up|network)/i.test(message);
            if (transientConnection && !controller.signal.aborted) noteProviderServerFailure(rateLimitScope);
            if (transientConnection && options.providerModelFailover !== true && attempt<UNIVERSAL_MAX_TRANSIENT_RETRIES && !controller.signal.aborted) {
              // Overdrive removes the exponential/jittered backoff: retry on
              // the minimal floor only. If the network is truly down the next
              // attempt fails fast and the error surfaces immediately.
              const delay = isOverdriveActive() ? Math.min(1_000, 250 * (attempt + 1)) : universalRetryDelayMs(attempt, null);
              await new Promise<void>((resolve,reject)=>{
                const abort=()=>{clearTimeout(timer);reject(new Error('Cancelled'));};
                const timer=setTimeout(()=>{controller.signal.removeEventListener('abort',abort);resolve();},delay);
                controller.signal.addEventListener('abort',abort,{once:true});
                if(controller.signal.aborted) abort();
              });
              continue;
            }
            throw error;
          }
          if (response.ok) {
            this.diagnostics.httpSuccesses++;
            noteProviderServerSuccess(rateLimitScope);
          } else if ([500,502,503,504,529].includes(response.status)) {
            noteProviderServerFailure(rateLimitScope);
          }
          if (response.status === 429) this.diagnostics.http429++;
          if (response.status === 402) this.diagnostics.http402++;
          if (response.status === 401) this.diagnostics.http401++;
          if (response.status === 403) this.diagnostics.http403++;
          noteProviderPacing(rateLimitScope, response, Math.ceil(JSON.stringify(body).length / 4 + maxTokens));
          noteProviderCooldown(rateLimitScope, response);
          // Part 2: mirror real endpoint traffic into the shared rate-limit
          // service, so RPM/TPM/day counters and a 429 cooldown are one quota
          // picture visible to every component (not this file's private map).
          rateLimitService.record(rateLimitScope, { requests: 1, tokens: Math.ceil(JSON.stringify(body).length / 4 + maxTokens) });
          rateLimitService.noteResponse(rateLimitScope, response);
          if ([401, 403].includes(response.status) && credentialIndex + 1 < credentials.length) {
            await response.body?.cancel();
            releaseProviderSlot?.();
            releaseProviderSlot = null;
            credentialIndex += 1;
            this.diagnostics.retries++;
            attempt -= 1;
            continue;
          }
          if(response.status===413 && payloadTrimAttempt===0) {
            const nextMessages=trimUniversalMessagesForPayload(msgs,Math.max(12_000,Math.floor(JSON.stringify(body).length*0.55)));
            const nextTools=trimUniversalToolsForPayload(tools);
            if(!nextMessages.changed&&!nextTools.changed) break;
            await response.body?.cancel();
            releaseProviderSlot?.();
            releaseProviderSlot=null;
            msgs=nextMessages.messages;
            tools=nextTools.tools;
            applyUniversalPayload(body,cfg.protocol,msgs,tools);
            payloadTrimAttempt++;
            continue;
          }
          if (options.providerModelFailover === true && [429,500,502,503,504,529].includes(response.status)) {
            // Let the same-endpoint failover wrapper try a compatible model
            // promptly instead of spending the caller's retry budget here.
            await response.body?.cancel();
            releaseProviderSlot?.();
            releaseProviderSlot = null;
            break;
          }
          const overdriveRateLimit = overdrive && response.status === 429;
          const advertisedWait = overdriveRateLimit
            ? overdriveRateLimitRetryMs(attempt, response.headers?.get('retry-after'), Math.max(0, (providerCooldownUntil.get(rateLimitScope) || 0) - Date.now()))
            : 0;
          if (overdriveRateLimit) options.onRateLimit?.({
            retryAt: Date.now() + advertisedWait,
            detail: 'provider quota window',
            attempt,
          });
          if (![429,500,502,503,504,529].includes(response.status)
            || attempt >= (overdriveRateLimit ? OVERDRIVE_MAX_RATE_LIMIT_RETRIES : UNIVERSAL_MAX_TRANSIENT_RETRIES)) break;
          const providerWait = Math.max(0, (providerCooldownUntil.get(rateLimitScope) || 0) - Date.now());
          // Do not send another request before a provider-advertised reset.
          // Short transient windows can be retried, but longer quota windows
          // are surfaced immediately and shared with subsequent turns.
          // Overdrive serves the wait instead: it retries the exact moment
          // the provider's window reopens, through several windows if needed.
          if (!overdriveRateLimit && providerWait > UNIVERSAL_RETRY_MAX_MS) {
            await response.body?.cancel();
            releaseProviderSlot?.();
            releaseProviderSlot = null;
            break;
          }
          // A free-tier 429 often supplies a reset window longer than the
          // normal transient backoff. Waiting for that advertised window
          // prevents an immediate retry burst that only repeats the quota
          // failure; the cooldown is bounded by noteProviderCooldown().
          const delay=response.status===429
            ? (overdriveRateLimit
                ? advertisedWait
                : Math.max(universalRetryDelayMs(attempt,response.headers?.get('retry-after')), providerWait))
            : universalRetryDelayMs(attempt,response.headers?.get('retry-after'));
          await response.body?.cancel();
          releaseProviderSlot?.();
          releaseProviderSlot=null;
          await new Promise<void>((resolve,reject)=>{
            const abort=()=>{clearTimeout(timer);reject(new Error('Cancelled'));};
            const timer=setTimeout(()=>{controller.signal.removeEventListener('abort',abort);resolve();},delay);
            controller.signal.addEventListener('abort',abort,{once:true});if(controller.signal.aborted) abort();
          });
        }
      }
      catch(e:any) {
        if(controller.signal.aborted) throw abortError();
        if (/Provider request queue is full/i.test(String(e?.message || ''))) throw e;
        if (options.providerModelFailover === true && /(?:ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENETUNREACH|ETIMEDOUT|fetch failed|socket hang up|network)/i.test(String(e?.cause?.code || e?.code || e?.message || e))) {
          throw new Error('Universal API network error. Check the provider endpoint and internet connection.');
        }
        throw new Error('Could not reach Universal API endpoint. Check URL and internet connection.');
      }
      if(response.status===413) throw new Error(universalPayloadTooLargeError());
      if(!response.ok) {
        if (response.status === 402) throw new Error('NVIDIA/provider credits are exhausted or billing is required (HTTP 402). Check the account balance or billing settings; NUVRO AI will not switch to a local model.');
        if (response.status === 401) throw new Error('Provider rejected the API key (HTTP 401). Check the key and its account.');
        if (response.status === 403) throw new Error('Provider denied access (HTTP 403). Check model access, account permissions, and endpoint.');
        throw new Error([429,500,502,503,504,529].includes(response.status)
          ? universalTransientError(response.status, retriesPerformed)
          : `Universal API returned HTTP ${response.status}. Check endpoint, model name, access and credits.`);
      }
      let data:any;
      try {data=streaming && response.headers?.get('content-type')?.includes('text/event-stream') ? await collectProviderStream(response,cfg.protocol,chunk=>{recordFirstToken();onChunk!(chunk);},rearmTimeout) : await response.json();
        if(onChunk && !response.headers?.get('content-type')?.includes('text/event-stream')) { /* JSON fallback is emitted after validation below. */ }
      }
      catch(e:any) {
        if(controller.signal.aborted) throw abortError();
        throw new Error(`Universal API response failed: ${e.message}`);
      }
      const u=data.usage||data.usageMetadata;
      const usage: ProviderUsage | undefined = u ? {
        inputTokens: Number(u.prompt_tokens??u.input_tokens??u.promptTokenCount??0),
        outputTokens: Number(u.completion_tokens??u.output_tokens??u.candidatesTokenCount??0),
      } : undefined;
      if(u) {const inputTokens=Number(u.prompt_tokens??u.input_tokens??u.promptTokenCount??0),outputTokens=Number(u.completion_tokens??u.output_tokens??u.candidatesTokenCount??0);
        this.diagnostics.inputTokens += inputTokens;
        this.diagnostics.outputTokens += outputTokens;
        if (outputTokens > 0) this.diagnostics.generationMs += Date.now() - requestStartedAt;
        this.usage.push({model,inputTokens,outputTokens,...(cfg.inputCostPerMillion!==undefined&&cfg.outputCostPerMillion!==undefined?{estimatedCost:(inputTokens*cfg.inputCostPerMillion+outputTokens*cfg.outputCostPerMillion)/1e6}:{})});if(this.usage.length>1000)this.usage.shift();}

      if(cfg.protocol==='openai') {
        const choice=data?.choices?.[0];
        if(!choice?.message) throw new Error('Universal API returned an empty response.');
        if(choice.finish_reason==='length') throw new Error('Universal API output truncated. No incomplete tool call executed.');
        const raw=choice.message.tool_calls;
        if(raw!==undefined&&!Array.isArray(raw)) throw new Error('Universal API returned malformed tool calls.');
        const text=typeof choice.message.content==='string'?choice.message.content:'';
        if(!text.trim() && !(raw?.length)) throw new Error('Universal API returned no text or tool calls. Connection is unverified.');
        return {text, toolCalls:(raw||[]).map((t:any)=>{
          if(!t?.function?.name) throw new Error('Universal API returned an unnamed tool.');
          return {id:t.id||randomUUID(),name:t.function.name,args:parsedArguments(t.function.arguments)};
        }) as ToolCall[], ...(usage ? { usage } : {})};
      }
      if(cfg.protocol==='responses') {
        if(data?.status && data.status !== 'completed') throw new Error('OpenAI Responses API did not complete. No incomplete tool call executed.');
        if(!Array.isArray(data?.output)) throw new Error('OpenAI Responses API returned an invalid response.');
        const text=data.output.filter((v:any)=>v?.type==='message')
          .flatMap((v:any)=>Array.isArray(v.content)?v.content:[])
          .filter((v:any)=>v.type==='output_text' && typeof v.text==='string')
          .map((v:any)=>v.text).join('\n') || (typeof data.output_text==='string'?data.output_text:'');
        const toolCalls=data.output.filter((v:any)=>v?.type==='function_call').map((v:any)=>{
          if(!v.name || !v.call_id) throw new Error('OpenAI Responses API returned an incomplete function call.');
          return {id:v.call_id,name:v.name,args:parsedArguments(v.arguments),providerMetadata:{protocol:'responses',blocks:data.output}};
        }) as ToolCall[];
        if(!text.trim() && toolCalls.length===0) throw new Error('OpenAI Responses API returned no text or tool calls. Connection is unverified.');
        return {text,toolCalls, ...(usage ? { usage } : {})};
      }
      if(cfg.protocol==='anthropic') {
        if(!Array.isArray(data?.content)) throw new Error('Anthropic returned an invalid response.');
        if(data.stop_reason==='max_tokens') throw new Error('Anthropic output truncated. No incomplete tool call executed.');
        const text=data.content.filter((v:any)=>v.type==='text').map((v:any)=>v.text||'').join('\n');
        const toolCalls=data.content.filter((v:any)=>v.type==='tool_use').map((v:any)=>({id:v.id||randomUUID(),name:v.name,args:parsedArguments(v.input),providerMetadata:{protocol:'anthropic',blocks:data.content.map(({_json,...b}:any)=>b)}})) as ToolCall[];
        if(!text.trim() && toolCalls.length===0) throw new Error('Anthropic returned no text or tool calls. Connection is unverified.');
        return {text,toolCalls, ...(usage ? { usage } : {})};
      }
      const candidate=data?.candidates?.[0];
      if(!candidate?.content?.parts) throw new Error('Gemini returned an empty or blocked response.');
      if(candidate.finishReason==='MAX_TOKENS') throw new Error('Gemini output truncated. No incomplete tool call executed.');
      const parts=candidate.content.parts as any[];
      const text=parts.filter(p=>typeof p.text==='string'&&!p.thought).map(p=>p.text).join('\n');
      const toolCalls=parts.filter(p=>p.functionCall).map(p=>({id:randomUUID(),name:p.functionCall.name,args:parsedArguments(p.functionCall.args),providerMetadata:{protocol:'gemini',blocks:parts}})) as ToolCall[];
      if(!text.trim() && toolCalls.length===0) throw new Error('Gemini returned no text or tool calls. Connection is unverified.');
      return {text,toolCalls, ...(usage ? { usage } : {})};
    } finally {
      releaseProviderSlot?.();
      if(timeout) clearTimeout(timeout);
      if(totalTimeout) clearTimeout(totalTimeout);
      options.signal?.removeEventListener('abort',cancel);
      this.diagnostics.latencyMs += Date.now() - requestStartedAt;
      this.diagnostics.latencySamples++;
      if(controller.signal.aborted) {
        if(abortCause === 'caller') this.diagnostics.cancellations++;
        else if(abortCause === 'timeout') this.diagnostics.timeouts++;
      }
    }
  }
  generateText(prompt:string,options:AICompletionOptions={}){
    if (options.signal) return this.completion([{role:'user',content:prompt}],[],options).then(r=>r.text);
    let requestKey: string;
    try {
      const cfg = this.config();
      const currentCredential = cfg.auth?.type === 'none' ? [] : this.credential();
      const credentialValues = (Array.isArray(currentCredential) ? currentCredential : [currentCredential]).map(value => String(value).trim());
      const credentialFingerprint = createHash('sha256').update(credentialValues.join('\n')).digest('hex');
      requestKey = createHash('sha256').update(JSON.stringify({
        protocol: cfg.protocol,
        endpoint: cfg.endpoint,
        credentialFingerprint,
        model: options.model || cfg.model,
        offlineMode: cfg.offlineMode,
        capabilities: cfg.capabilities,
        requestBudget: cfg.requestBudget,
        prompt,
        options,
      })).digest('hex');
    } catch {
      return this.completion([{role:'user',content:prompt}],[],options).then(r=>r.text);
    }
    const existing = this.inflightTextRequests.get(requestKey);
    if (existing) { this.diagnostics.deduplicatedRequests++; return existing; }
    const pending = this.completion([{role:'user',content:prompt}],[],options).then(r=>r.text);
    this.inflightTextRequests.set(requestKey, pending);
    const clear = () => { if (this.inflightTextRequests.get(requestKey) === pending) this.inflightTextRequests.delete(requestKey); };
    void pending.then(clear, clear);
    return pending;
  }
  private isRecoverableStreamFailure(error: unknown): boolean {
    return /streaming error|stream ended|before completion|no body|network|connection reset|fetch failed|socket/i.test(String((error as any)?.message || error || ''));
  }
  async generateStream(prompt:string,options:AICompletionOptions,onChunk:(text:string)=>void){
    let emitted=false;
    try {
      const r=await this.completion([{role:'user',content:prompt}],[],options,t=>{emitted=true;onChunk(t);});
      if(!emitted&&r.text)onChunk(r.text);
      return r.text;
    } catch(error) {
      if(emitted||!this.isRecoverableStreamFailure(error)) throw error;
      const fallback=await this.completion([{role:'user',content:prompt}],[],options);
      if(fallback.text) onChunk(fallback.text);
      return fallback.text;
    }
  }
  chatWithTools(messages:UniversalMessage[],tools:ToolDefinition[],options:AICompletionOptions={}){return this.completion(messages,tools,options);}
  async chatWithToolsStream(messages:UniversalMessage[],tools:ToolDefinition[],options:AICompletionOptions,onChunk:(text:string)=>void){
    let emitted=false;
    try {
      const result=await this.completion(messages,tools,options,t=>{emitted=true;onChunk(t);});
      if(!emitted&&result.text)onChunk(result.text);
      return result;
    } catch(error) {
      if(emitted||!this.isRecoverableStreamFailure(error)) throw error;
      const fallback=await this.completion(messages,tools,options);
      if(fallback.text) onChunk(fallback.text);
      return { ...fallback, providerFallback: { from: 'stream', to: 'json', reason: 'stream_transport' as const } };
    }
  }
}
