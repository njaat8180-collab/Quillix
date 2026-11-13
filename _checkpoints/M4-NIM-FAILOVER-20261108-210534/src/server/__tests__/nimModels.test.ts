import { describe, expect, it } from 'vitest';
import {
  classifyNimFailure,
  emptyNimHealth,
  failoverNimModel,
  isNimFailoverWorthy,
  isNimModelCompatible,
  nimCooldownMs,
  noteNimFailure,
  noteNimSuccess,
  parseNimModelCatalog,
  selectNimModel,
  type NimModelInfo,
} from '../nimModels.js';

const catalog: NimModelInfo[] = [
  { id: 'nvidia/model-a', contextLength: 128_000, tools: true, streaming: true, reasoning: true, ownedBy: 'nvidia' },
  { id: 'nvidia/model-b', contextLength: 32_000, tools: true, streaming: true, ownedBy: 'nvidia' },
  { id: 'nvidia/model-c', contextLength: 16_000, tools: false, streaming: true, ownedBy: 'nvidia' },
];

const NOW = 1_700_000_000_000;

describe('parseNimModelCatalog', () => {
  it('parses an OpenAI-compatible /v1/models payload', () => {
    const models = parseNimModelCatalog({
      data: [
        { id: 'nvidia/model-a', context_length: 131072, supports_tools: true, supports_streaming: true, owned_by: 'nvidia' },
        { id: 'nvidia/model-b' },
        { id: '' },
        { notAModel: true },
      ],
    });
    expect(models.map(model => model.id)).toEqual(['nvidia/model-a', 'nvidia/model-b']);
    expect(models[0]).toMatchObject({ contextLength: 131072, tools: true, streaming: true, ownedBy: 'nvidia' });
    expect(models[1].contextLength).toBeUndefined();
  });

  it('never throws on malformed payloads and never invents ids', () => {
    for (const payload of [undefined, null, 42, 'nope', [], {}, { data: 'nope' }, { data: [null, 1, 'x'] }]) {
      expect(parseNimModelCatalog(payload)).toEqual([]);
    }
  });

  it('de-duplicates repeated ids', () => {
    expect(parseNimModelCatalog({ data: [{ id: 'm' }, { id: 'm' }, { id: 'm' }] }).map(model => model.id)).toEqual(['m']);
  });
});

describe('isNimModelCompatible', () => {
  const model = { id: 'm', contextLength: 32_000, tools: true, streaming: true };

  it('accepts a model that satisfies the requirements', () => {
    expect(isNimModelCompatible(model, { estimatedInputTokens: 30_000, requiresTools: true, requiresStreaming: true })).toBe(true);
  });

  it('rejects a model that cannot hold the context or lacks tools', () => {
    expect(isNimModelCompatible(model, { estimatedInputTokens: 40_000 })).toBe(false);
    expect(isNimModelCompatible({ id: 'x', tools: false }, { requiresTools: true })).toBe(false);
  });

  it('does not reject when the catalog simply omits a capability flag', () => {
    expect(isNimModelCompatible({ id: 'x' }, { requiresTools: true, requiresStreaming: true, estimatedInputTokens: 100_000 })).toBe(true);
  });
});

describe('selectNimModel', () => {
  it('honours the configured model while it is healthy', () => {
    const selection = selectNimModel(catalog, {}, { complexity: 'simple' }, { configured: 'nvidia/model-b', now: NOW });
    expect(selection).toMatchObject({ model: { id: 'nvidia/model-b' }, reason: 'priority' });
  });

  it('skips a cooling-down model instead of using it', () => {
    const health = { 'nvidia/model-b': { ...emptyNimHealth(), cooldownUntil: NOW + 60_000 } };
    const selection = selectNimModel(catalog, health, { complexity: 'simple' }, { configured: 'nvidia/model-b', now: NOW });
    expect(selection?.reason).toBe('healthy');
    expect(selection?.model.id).not.toBe('nvidia/model-b');
  });

  it('prefers the priority list over scoring', () => {
    const selection = selectNimModel(catalog, {}, { complexity: 'simple' }, { priority: ['nvidia/model-c'], now: NOW });
    expect(selection?.model.id).toBe('nvidia/model-c');
    expect(selection?.reason).toBe('priority');
  });

  it('prefers stronger models for complex tasks', () => {
    expect(selectNimModel(catalog, {}, { complexity: 'complex' }, { now: NOW })?.model.id).toBe('nvidia/model-a');
  });

  it('respects the context requirement even for a complex task', () => {
    expect(selectNimModel(catalog, {}, { complexity: 'complex', estimatedInputTokens: 100_000 }, { now: NOW })?.model.id).toBe('nvidia/model-a');
    expect(selectNimModel(catalog, {}, { complexity: 'simple', estimatedInputTokens: 500_000 }, { now: NOW })).not.toBeNull();
  });

  it('reports a fallback when every model is cooling down', () => {
    const health = {
      'nvidia/model-a': { ...emptyNimHealth(), cooldownUntil: NOW + 90_000 },
      'nvidia/model-b': { ...emptyNimHealth(), cooldownUntil: NOW + 10_000 },
      'nvidia/model-c': { ...emptyNimHealth(), cooldownUntil: NOW + 90_000 },
    };
    const selection = selectNimModel(catalog, health, { complexity: 'simple' }, { configured: 'nvidia/model-a', now: NOW });
    expect(selection?.reason).toBe('fallback');
    // the model whose cooldown expires first is reported, never a silent "healthy"
    expect(selection?.model.id).toBe('nvidia/model-b');
  });

  it('uses the configured model when the catalog is unavailable (no invented ids)', () => {
    expect(selectNimModel([], {}, { complexity: 'simple' }, { configured: 'openai/gpt-oss-120b', now: NOW }))
      .toEqual({ model: { id: 'openai/gpt-oss-120b' }, reason: 'configured', alternatives: [] });
  });

  it('returns null when there is no catalog and no configured model', () => {
    expect(selectNimModel([], {}, {}, { now: NOW })).toBeNull();
  });
});

describe('failoverNimModel', () => {
  it('moves to another healthy compatible model after a failure', () => {
    const selection = failoverNimModel(catalog, {}, { complexity: 'simple' }, 'nvidia/model-a', { now: NOW });
    expect(selection?.model.id).toBeTruthy();
    expect(selection?.model.id).not.toBe('nvidia/model-a');
  });

  it('does not fail over onto a model that is cooling down', () => {
    const health = {
      'nvidia/model-b': { ...emptyNimHealth(), cooldownUntil: NOW + 60_000 },
      'nvidia/model-c': { ...emptyNimHealth(), cooldownUntil: NOW + 60_000 },
    };
    expect(failoverNimModel(catalog, health, { complexity: 'simple' }, 'nvidia/model-b', { now: NOW })?.model.id).toBe('nvidia/model-a');
  });

  it('returns null when there is no other compatible model', () => {
    expect(failoverNimModel([{ id: 'only' }], {}, { complexity: 'simple' }, 'only', { now: NOW })).toBeNull();
  });
});

describe('failure classification', () => {
  it('classifies provider errors precisely', () => {
    expect(classifyNimFailure('HTTP 429 Too Many Requests')).toBe('rate-limit');
    expect(classifyNimFailure('Rate limit exceeded for model')).toBe('rate-limit');
    expect(classifyNimFailure('HTTP 401 Unauthorized: invalid api key')).toBe('auth');
    expect(classifyNimFailure('HTTP 402 Payment Required')).toBe('billing');
    expect(classifyNimFailure('HTTP 400 Bad Request: invalid parameter')).toBe('bad-request');
    expect(classifyNimFailure('Request timeout after 120s')).toBe('timeout');
    expect(classifyNimFailure('Model is overloaded / at capacity')).toBe('overload');
    expect(classifyNimFailure('HTTP 503 Service Unavailable')).toBe('overload');
    expect(classifyNimFailure('HTTP 500 Internal Server Error')).toBe('server');
    expect(classifyNimFailure('ECONNREFUSED 127.0.0.1:443')).toBe('unavailable');
    expect(classifyNimFailure('something odd happened')).toBe('unknown');
  });

  it('only fails over for transient kinds', () => {
    expect(isNimFailoverWorthy(classifyNimFailure('429'))).toBe(true);
    expect(isNimFailoverWorthy(classifyNimFailure('timeout'))).toBe(true);
    expect(isNimFailoverWorthy(classifyNimFailure('503'))).toBe(true);
    expect(isNimFailoverWorthy(classifyNimFailure('401 invalid api key'))).toBe(false);
    expect(isNimFailoverWorthy(classifyNimFailure('402 billing'))).toBe(false);
    expect(isNimFailoverWorthy(classifyNimFailure('400 bad request'))).toBe(false);
  });
});

describe('cooldowns and health', () => {
  it('never cools down on auth, billing or bad-request failures', () => {
    for (const kind of ['auth', 'billing', 'bad-request'] as const) expect(nimCooldownMs(kind, 0)).toBe(0);
  });

  it('honours Retry-After for rate limits and grows with attempts', () => {
    expect(nimCooldownMs('rate-limit', 0, 30_000)).toBeGreaterThanOrEqual(30_000);
    expect(nimCooldownMs('rate-limit', 2)).toBeGreaterThan(nimCooldownMs('rate-limit', 0));
  });

  it('keeps cooldowns bounded', () => {
    expect(nimCooldownMs('rate-limit', 99)).toBeLessThanOrEqual(61_000);
    expect(nimCooldownMs('server', 99)).toBeLessThanOrEqual(30_000);
    expect(nimCooldownMs('unavailable', 99)).toBeLessThanOrEqual(60_000);
  });

  it('tracks successes, latency and tokens per second', () => {
    const first = noteNimSuccess(emptyNimHealth(), 1_000, 500);
    expect(first).toMatchObject({ successes: 1, averageLatencyMs: 1_000, tokensPerSecond: 500, cooldownUntil: 0 });
    const second = noteNimSuccess(first, 3_000, 1_500);
    expect(second.successes).toBe(2);
    expect(second.averageLatencyMs).toBe(2_000);
  });

  it('opens and extends cooldowns on failure and records the kind', () => {
    const failed = noteNimFailure(emptyNimHealth(), 'rate-limit', NOW, 0);
    expect(failed).toMatchObject({ failures: 1, rateLimits: 1, lastFailureKind: 'rate-limit' });
    expect(failed.cooldownUntil).toBeGreaterThan(NOW);
    expect(noteNimFailure(failed, 'rate-limit', NOW, 3).cooldownUntil).toBeGreaterThan(failed.cooldownUntil);
  });

  it('does not open a cooldown for auth failures', () => {
    const health = noteNimFailure(emptyNimHealth(), 'auth', NOW);
    expect(health.cooldownUntil).toBe(0);
    expect(health.lastFailureKind).toBe('auth');
  });
});