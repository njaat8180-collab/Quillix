/**
 * NVIDIA NIM multi-model selection, health tracking and failover (Part 4).
 *
 * Pure and dependency-free so selection/health logic is unit-tested with mocked
 * catalogs and injected clocks. It never invents model ids: the catalog comes
 * from the account's own `/v1/models` discovery, and an unknown or empty catalog
 * degrades to the configured single model instead of guessing.
 *
 * Rate-limit safety: a cooldown opened by one model on an endpoint applies to
 * every model on that endpoint, so failover can only pick a model that is
 * genuinely available — it never bypasses provider limits.
 */

export interface NimModelInfo {
  id: string;
  /** Context window in tokens when the catalog exposes it. */
  contextLength?: number;
  /** Model supports the tools/tool-calling surface. */
  tools?: boolean;
  /** Model supports streaming responses. */
  streaming?: boolean;
  /** Model supports the reasoning surface. */
  reasoning?: boolean;
  /** Owner/family reported by the catalog (e.g. "openai", "meta"). */
  ownedBy?: string;
}

export interface NimTaskRequirements {
  /** Estimated input tokens the task needs to fit. */
  estimatedInputTokens?: number;
  /** Task complexity, used to prefer stronger models for hard work. */
  complexity?: 'simple' | 'medium' | 'complex';
  /** Tool calling is required for this task. */
  requiresTools?: boolean;
  /** Streaming is required for this task. */
  requiresStreaming?: boolean;
}

export type NimFailureKind = 'rate-limit' | 'timeout' | 'server' | 'overload' | 'unavailable' | 'auth' | 'billing' | 'bad-request' | 'unknown';

/** Failure classes that a different model can plausibly recover from. */
export const NIM_FAILOVER_KINDS: readonly NimFailureKind[] = ['rate-limit', 'timeout', 'server', 'overload', 'unavailable'];

export interface NimModelHealth {
  successes: number;
  failures: number;
  rateLimits: number;
  timeouts: number;
  lastLatencyMs: number;
  averageLatencyMs: number;
  cooldownUntil: number;
  tokensPerSecond: number;
  lastFailureKind: NimFailureKind | null;
}

export function emptyNimHealth(): NimModelHealth {
  return {
    successes: 0, failures: 0, rateLimits: 0, timeouts: 0,
    lastLatencyMs: 0, averageLatencyMs: 0, cooldownUntil: 0, tokensPerSecond: 0,
    lastFailureKind: null,
  };
}

/** Parse an OpenAI-compatible `/v1/models` payload into a usable catalog. */
export function parseNimModelCatalog(payload: unknown): NimModelInfo[] {
  const root = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
  const entries = Array.isArray(root.data) ? root.data : Array.isArray(root.models) ? root.models : [];
  const catalog: NimModelInfo[] = [];
  for (const entry of entries) {
    const model = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
    const id = typeof model.id === 'string' ? model.id.trim() : '';
    if (!id) continue;
    const context = Number(model.context_length ?? model.max_context_length ?? model.contextLength);
    catalog.push({
      id,
      ...(Number.isFinite(context) && context > 0 ? { contextLength: Math.round(context) } : {}),
      tools: model.supports_tools === true || model.tools === true || undefined,
      streaming: model.supports_streaming === true || model.streaming === true || undefined,
      reasoning: model.supports_reasoning === true || model.reasoning === true || undefined,
      ...(typeof model.owned_by === 'string' && model.owned_by ? { ownedBy: model.owned_by } : {}),
    });
  }
  return dedupeModels(catalog);
}

function dedupeModels(models: NimModelInfo[]): NimModelInfo[] {
  const seen = new Set<string>();
  return models.filter(model => {
    if (seen.has(model.id)) return false;
    seen.add(model.id);
    return true;
  });
}

/**
 * A model is usable for this task only when it satisfies the hard requirements.
 * Unknown capability flags are treated as allowed, because a missing field must
 * not silently remove a model that may work (Part 4 G).
 */
export function isNimModelCompatible(model: NimModelInfo, requirements: NimTaskRequirements): boolean {
  if (requirements.estimatedInputTokens && model.contextLength && model.contextLength < requirements.estimatedInputTokens) return false;
  if (requirements.requiresTools && model.tools === false) return false;
  if (requirements.requiresStreaming && model.streaming === false) return false;
  return true;
}

export function nimModelNeedsCooldown(health: NimModelHealth | undefined, now: number): boolean {
  return !!health && health.cooldownUntil > now;
}

/** Preference score: lower is better. Simple tasks prefer availability, complex tasks prefer capability. */
export function scoreNimModel(model: NimModelInfo, health: NimModelHealth | undefined, requirements: NimTaskRequirements, now: number): number {
  let score = 0;
  if (nimModelNeedsCooldown(health, now)) score += 1000;
  const complexity = requirements.complexity || 'medium';
  if (complexity === 'complex') {
    if (model.contextLength) score += Math.max(0, 400_000 - Math.min(400_000, model.contextLength)) / 400_000 * 40;
    if (model.reasoning === true) score -= 12;
    if (model.tools === true) score -= 6;
  } else if (complexity === 'simple') {
    if (model.contextLength) score += Math.min(60, Math.max(0, model.contextLength / 20_000));
  }
  if (health) {
    score += health.failures * 3;
    score += health.rateLimits * 2;
    if (health.successes > 0) score -= Math.min(12, health.successes);
    if (health.averageLatencyMs > 0) score += Math.min(30, health.averageLatencyMs / 400);
  }
  return score;
}

export interface NimSelection {
  model: NimModelInfo;
  reason: 'priority' | 'healthy' | 'fallback' | 'configured';
  alternatives: NimModelInfo[];
}

/**
 * Choose the best model for the task. Order:
 *   1. the configured/priority model when it is healthy and compatible,
 *   2. any other healthy compatible catalog model,
 *   3. the configured model even while cooling down (reported as fallback),
 *   4. null when nothing is safe to try.
 */
export function selectNimModel(
  catalog: NimModelInfo[],
  health: Record<string, NimModelHealth>,
  requirements: NimTaskRequirements,
  options: { priority?: string[]; configured?: string; exclude?: string; now?: number } = {}
): NimSelection | null {
  const now = options.now ?? Date.now();
  const exclude = options.exclude?.trim();
  const models = dedupeModels(catalog).filter(model => !exclude || model.id !== exclude);
  if (!models.length) {
    const configured = options.configured?.trim();
    if (!configured) return null;
    return { model: { id: configured }, reason: 'configured', alternatives: [] };
  }
  const compatible = models.filter(model => isNimModelCompatible(model, requirements));
  const pool = compatible.length ? compatible : models;
  const healthy = pool.filter(model => !nimModelNeedsCooldown(health[model.id], now));

  const configured = options.configured?.trim();
  if (configured) {
    const pinned = pool.find(model => model.id === configured);
    if (pinned && !nimModelNeedsCooldown(health[pinned.id], now)) {
      return { model: pinned, reason: 'priority', alternatives: healthy.filter(model => model.id !== pinned.id) };
    }
  }
  for (const id of options.priority || []) {
    const match = pool.find(model => model.id === id);
    if (match && !nimModelNeedsCooldown(health[match.id], now)) {
      return { model: match, reason: 'priority', alternatives: healthy.filter(model => model.id !== match.id) };
    }
  }
  if (healthy.length) {
    const best = [...healthy].sort((a, b) =>
      scoreNimModel(a, health[a.id], requirements, now) - scoreNimModel(b, health[b.id], requirements, now) || a.id.localeCompare(b.id))[0];
    return { model: best, reason: 'healthy', alternatives: healthy.filter(model => model.id !== best.id) };
  }
  const cooling = [...pool].sort((a, b) =>
    (health[a.id]?.cooldownUntil ?? Infinity) - (health[b.id]?.cooldownUntil ?? Infinity) || a.id.localeCompare(b.id))[0];
  if (cooling) return { model: cooling, reason: 'fallback', alternatives: [] };
  return null;
}

/**
 * Next model to try after `currentModelId` failed. Returns null when no other
 * compatible model is available (the caller then preserves the task and reports).
 */
export function failoverNimModel(
  catalog: NimModelInfo[],
  health: Record<string, NimModelHealth>,
  requirements: NimTaskRequirements,
  currentModelId: string,
  options: { priority?: string[]; now?: number } = {}
): NimSelection | null {
  // The failing model must never be a candidate for its own replacement, and a
  // model that is still cooling down must never be retried.
  const now = options.now ?? Date.now();
  const selection = selectNimModel(catalog, health, requirements, { ...options, exclude: currentModelId, configured: undefined, now });
  if (!selection || selection.reason === 'fallback' || nimModelNeedsCooldown(health[selection.model.id], now)) return null;
  return selection;
}

/** Cooldown for a failure. Rate limits honour the provider window; others are short. */
export function nimCooldownMs(kind: NimFailureKind, attempt: number, retryAfterMs?: number): number {
  const jitter = Math.floor(Math.random() * 1_000);
  if (kind === 'rate-limit') return Math.max(retryAfterMs || 0, Math.min(60_000, 2_000 * Math.pow(2, Math.max(0, attempt))) + jitter);
  if (kind === 'timeout') return Math.min(15_000, 1_500 * Math.pow(2, Math.max(0, attempt)));
  if (kind === 'overload') return Math.min(20_000, 2_500 * Math.pow(2, Math.max(0, attempt)));
  if (kind === 'server') return Math.min(30_000, 3_000 * Math.pow(2, Math.max(0, attempt)));
  if (kind === 'unavailable') return Math.min(60_000, 5_000 * Math.pow(2, Math.max(0, attempt)));
  return 0; // auth / billing / bad-request must never trigger a model switch
}

export function noteNimSuccess(health: NimModelHealth | undefined, latencyMs: number, estimatedTokens = 0): NimModelHealth {
  const next = health ? { ...health } : emptyNimHealth();
  next.successes += 1;
  next.lastLatencyMs = Math.max(0, Math.round(latencyMs));
  next.averageLatencyMs = next.successes === 1
    ? next.lastLatencyMs
    : Math.round((next.averageLatencyMs * (next.successes - 1) + next.lastLatencyMs) / next.successes);
  next.tokensPerSecond = latencyMs > 0 && estimatedTokens > 0 ? Math.round((estimatedTokens / latencyMs) * 1000) : 0;
  next.cooldownUntil = 0;
  next.lastFailureKind = null;
  return next;
}

export function noteNimFailure(
  health: NimModelHealth | undefined,
  kind: NimFailureKind,
  now: number,
  attempt = 0,
  retryAfterMs = 0
): NimModelHealth {
  const next = health ? { ...health } : emptyNimHealth();
  next.failures += 1;
  next.lastFailureKind = kind;
  if (kind === 'rate-limit') next.rateLimits += 1;
  if (kind === 'timeout') next.timeouts += 1;
  // A zero-length cooldown (auth/billing/bad-request) must not stamp a timestamp.
  const cooldown = nimCooldownMs(kind, attempt, retryAfterMs);
  if (cooldown > 0) next.cooldownUntil = Math.max(next.cooldownUntil, now + cooldown);
  return next;
}

/** Classify a provider error message into a failure kind. */
export function classifyNimFailure(message: string): NimFailureKind {
  const text = String(message || '').toLowerCase();
  if (/\b429\b|rate limit|too many requests|quota exceeded/.test(text)) return 'rate-limit';
  if (/\b401\b|unauthor|invalid api key|authentication failed/.test(text)) return 'auth';
  if (/\b402\b|billing|insufficient (?:credit|funds|balance)/.test(text)) return 'billing';
  if (/\b400\b|bad request|invalid (?:request|argument|parameter)/.test(text)) return 'bad-request';
  if (/timeout|timed out|etimedout/.test(text)) return 'timeout';
  if (/overloaded|at capacity|\b503\b|too many concurrent/.test(text)) return 'overload';
  if (/\b5\d\d\b|internal server error|bad gateway|service unavailable/.test(text)) return 'server';
  if (/econnrefused|enotfound|econnreset|network error|unavailable|socket hang up/.test(text)) return 'unavailable';
  return 'unknown';
}

/** Only these failure kinds are worth trying another model for. */
export function isNimFailoverWorthy(kind: NimFailureKind): boolean {
  return NIM_FAILOVER_KINDS.includes(kind);
}


