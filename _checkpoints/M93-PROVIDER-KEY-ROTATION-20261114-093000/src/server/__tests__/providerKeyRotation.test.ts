import { describe, expect, it } from 'vitest';
import {
  ProviderKeyPool,
  ProviderKeyUnavailableError,
  classifyProviderFailure,
  providerKeyId,
  DEFAULT_KEY_COOLDOWN_POLICY,
} from '../providerKeyRotation.js';

// M9.3 — provider key rotation.
//
// The pool is driven by an injected clock, so every cooldown and recovery
// window is asserted exactly instead of being approximated with sleeps.

function makePool(now = { value: 1_700_000_000_000 }) {
  const pool = new ProviderKeyPool({ now: () => now.value, maxAttempts: 3 });
  return { pool, now };
}

describe('provider failure classification', () => {
  it('separates invalid credentials from expired credentials', () => {
    expect(classifyProviderFailure({ status: 401 }).kind).toBe('invalid-credentials');
    expect(classifyProviderFailure({ status: 403 }).kind).toBe('invalid-credentials');
    expect(classifyProviderFailure({ status: 401, message: 'the API key has expired' }).kind).toBe('expired-credentials');
    expect(classifyProviderFailure({ status: 403, message: 'subscription expired' }).kind).toBe('expired-credentials');
  });

  it('separates quota exhaustion from rate limiting', () => {
    expect(classifyProviderFailure({ status: 402 }).kind).toBe('quota-exhausted');
    expect(classifyProviderFailure({ status: 429, message: 'insufficient_quota' }).kind).toBe('quota-exhausted');
    expect(classifyProviderFailure({ status: 403, message: 'billing hard limit reached' }).kind).toBe('quota-exhausted');
    expect(classifyProviderFailure({ status: 429 }).kind).toBe('rate-limited');
    expect(classifyProviderFailure({ status: 429, message: 'rate limit exceeded' }).kind).toBe('rate-limited');
  });

  it('separates provider outages and network failures', () => {
    expect(classifyProviderFailure({ status: 500 }).kind).toBe('server-error');
    expect(classifyProviderFailure({ status: 503 }).kind).toBe('server-error');
    expect(classifyProviderFailure(new Error('fetch failed')).kind).toBe('network-error');
    expect(classifyProviderFailure(new Error('read ECONNRESET')).kind).toBe('network-error');
    expect(classifyProviderFailure(new Error('something odd')).kind).toBe('unknown');
  });

  it('only rotates for credential-specific failures', () => {
    expect(classifyProviderFailure({ status: 401 }).rotationWorthy).toBe(true);
    expect(classifyProviderFailure({ status: 402 }).rotationWorthy).toBe(true);
    expect(classifyProviderFailure({ status: 429, message: 'insufficient_quota' }).rotationWorthy).toBe(true);
    expect(classifyProviderFailure({ status: 500 }).rotationWorthy).toBe(false);
    expect(classifyProviderFailure(new Error('fetch failed')).rotationWorthy).toBe(false);
  });

  it('does not rotate on a plain rate limit — the window is shared by the account', () => {
    // Rotating keys here would not bypass the account level window and would
    // hide the real limit, so a plain 429 keeps the same key.
    expect(classifyProviderFailure({ status: 429 }).rotationWorthy).toBe(false);
    expect(classifyProviderFailure({ status: 429, message: 'rate limit exceeded' }).rotationWorthy).toBe(false);
  });

  it('honours a provider advertised retry window', () => {
    const classified = classifyProviderFailure({ status: 429, retryAfterMs: 45_000 });
    expect(classified.kind).toBe('rate-limited');
    expect(classified.retryAfterMs).toBe(45_000);
    expect(classifyProviderFailure({ status: 429, message: 'retry-after: 30' }).retryAfterMs).toBe(30_000);
  });
});

describe('provider key selection', () => {
  it('registers several keys for one provider and identifies them without secrets', () => {
    const { pool } = makePool();
    const ids = pool.register('openai', ['key-one', 'key-two', 'key-one']);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(providerKeyId('key-one'));
    expect(ids[0]).not.toContain('key-one');
  });

  it('selects the least recently used healthy key', () => {
    const { pool, now } = makePool();
    pool.register('openai', ['key-one', 'key-two']);
    const first = pool.select('openai');
    expect(first?.key).toBe('key-one');
    pool.reportSuccess('openai', first!.keyId);
    now.value += 1_000;
    const second = pool.select('openai');
    expect(second?.key).toBe('key-two');
  });

  it('skips a key that is cooling down', () => {
    const { pool } = makePool();
    pool.register('openai', ['key-one', 'key-two']);
    const first = pool.select('openai')!;
    pool.reportFailure('openai', first.keyId, { status: 401 });
    const second = pool.select('openai');
    expect(second?.keyId).not.toBe(first.keyId);
    expect(second?.key).toBe('key-two');
  });

  it('reports when every key is cooling down and when it recovers', () => {
    const { pool, now } = makePool();
    pool.register('openai', ['key-one']);
    const first = pool.select('openai')!;
    pool.reportFailure('openai', first.keyId, { status: 401 });

    let unavailable: unknown = null;
    try {
      pool.select('openai');
    } catch (error) {
      unavailable = error;
    }
    expect(unavailable).toBeInstanceOf(ProviderKeyUnavailableError);
    expect((unavailable as ProviderKeyUnavailableError).retryAt).toBe(now.value + DEFAULT_KEY_COOLDOWN_POLICY['invalid-credentials']);

    // Recovery: once the cooldown expires the key becomes usable again.
    now.value += DEFAULT_KEY_COOLDOWN_POLICY['invalid-credentials'] + 1;
    const recovered = pool.select('openai');
    expect(recovered?.keyId).toBe(first.keyId);
    const health = pool.health('openai');
    expect(health.keys[0].status).toBe('healthy');
    expect(health.keys[0].consecutiveFailures).toBe(0);
  });

  it('uses the provider retry window when it is longer than the default cooldown', () => {
    const { pool, now } = makePool();
    pool.register('openai', ['key-one', 'key-two']);
    const first = pool.select('openai')!;
    pool.reportFailure('openai', first.keyId, { status: 429, retryAfterMs: 5 * 60_000 });
    const state = pool.health('openai').keys.find(key => key.keyId === first.keyId)!;
    expect(state.cooldownUntil).toBe(now.value + 5 * 60_000);
  });

  it('rests a rate-limited key without taking it out of rotation', () => {
    const { pool } = makePool();
    pool.register('openai', ['key-one', 'key-two']);
    const first = pool.select('openai')!;
    pool.reportFailure('openai', first.keyId, { status: 429 });
    const health = pool.health('openai');
    const rested = health.keys.find(key => key.keyId === first.keyId)!;
    expect(rested.status).toBe('rate-limited');
    expect(rested.failureKind).toBe('rate-limited');
    // The key is not broken: it stays usable so the account level window is
    // honoured instead of being dodged with another key.
    expect(pool.isEligible('openai', first.keyId)).toBe(true);
  });
});

describe('provider key failover', () => {
  it('rotates to the next key after an authentication failure', async () => {
    const { pool } = makePool();
    const used: string[] = [];
    const outcome = await pool.execute('openai', ['key-one', 'key-two'], async key => {
      used.push(key);
      if (key === 'key-one') throw Object.assign(new Error('unauthorized'), { status: 401 });
      return 'ok';
    });
    expect(outcome.result).toBe('ok');
    expect(outcome.attempts).toBe(2);
    expect(used).toEqual(['key-one', 'key-two']);
  });

  it('rotates when the quota of one key is exhausted', async () => {
    const { pool } = makePool();
    const used: string[] = [];
    const outcome = await pool.execute('openai', ['key-one', 'key-two'], async key => {
      used.push(key);
      if (key === 'key-one') throw Object.assign(new Error('insufficient_quota'), { status: 429 });
      return 'ok';
    });
    expect(outcome.result).toBe('ok');
    expect(used).toEqual(['key-one', 'key-two']);
  });

  it('does not rotate on a plain rate limit', async () => {
    const { pool } = makePool();
    const used: string[] = [];
    await expect(pool.execute('openai', ['key-one', 'key-two'], async key => {
      used.push(key);
      throw Object.assign(new Error('rate limit exceeded'), { status: 429 });
    })).rejects.toBeTruthy();
    expect(used).toEqual(['key-one']);
  });

  it('does not rotate on a provider outage — the next key would fail the same way', async () => {
    const { pool } = makePool();
    const used: string[] = [];
    let failure: unknown = null;
    try {
      await pool.execute('openai', ['key-one', 'key-two'], async key => {
        used.push(key);
        throw Object.assign(new Error('service unavailable'), { status: 503 });
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeTruthy();
    expect(used).toEqual(['key-one']);
  });

  it('does not rotate on a network failure', async () => {
    const { pool } = makePool();
    const used: string[] = [];
    await expect(pool.execute('openai', ['key-one', 'key-two'], async key => {
      used.push(key);
      throw new Error('fetch failed');
    })).rejects.toBeTruthy();
    expect(used).toEqual(['key-one']);
  });

  it('stops after the attempt budget instead of looping forever', async () => {
    const { pool } = makePool();
    const used: string[] = [];
    await expect(pool.execute('openai', ['key-one', 'key-two', 'key-three', 'key-four'], async key => {
      used.push(key);
      throw Object.assign(new Error('unauthorized'), { status: 401 });
    }, { maxAttempts: 2 })).rejects.toBeTruthy();
    expect(used.length).toBe(2);
  });

  it('recovers a key after a temporary failure', async () => {
    const { pool, now } = makePool();
    pool.register('openai', ['key-one']);
    const first = pool.select('openai')!;
    pool.reportFailure('openai', first.keyId, { status: 500 });
    expect(pool.health('openai').healthy).toBe(0);

    now.value += DEFAULT_KEY_COOLDOWN_POLICY['server-error'] + 1;
    expect(pool.health('openai').healthy).toBe(1);
    const recovered = pool.select('openai');
    expect(recovered?.keyId).toBe(first.keyId);
  });

  it('records a successful request as healthy again', () => {
    const { pool } = makePool();
    pool.register('openai', ['key-one']);
    const first = pool.select('openai')!;
    pool.reportFailure('openai', first.keyId, { status: 401 });
    expect(pool.health('openai').coolingDown).toBe(1);
    pool.reportSuccess('openai', first.keyId);
    const health = pool.health('openai');
    expect(health.coolingDown).toBe(0);
    expect(health.healthy).toBe(1);
    expect(health.keys[0].failureKind).toBeUndefined();
  });
});

describe('provider key health reporting', () => {
  it('never exposes key material', () => {
    const { pool } = makePool();
    pool.register('openai', ['super-secret-key-value']);
    pool.select('openai');
    pool.reportFailure('openai', providerKeyId('super-secret-key-value'), { status: 401, message: 'invalid api key super-secret-key-value' });
    const serialized = JSON.stringify(pool.healthAll());
    expect(serialized).not.toContain('super-secret-key-value');
    expect(serialized).toContain(providerKeyId('super-secret-key-value'));
  });

  it('summarises every registered provider', () => {
    const { pool } = makePool();
    pool.register('openai', ['a', 'b']);
    pool.register('groq', ['c']);
    const summary = pool.healthAll();
    expect(summary).toHaveLength(2);
    const openai = summary.find(entry => entry.provider === 'openai')!;
    expect(openai.total).toBe(2);
    expect(openai.healthy).toBe(2);
  });

  it('forgets keys that are no longer configured', () => {
    const { pool } = makePool();
    pool.register('openai', ['key-one', 'key-two']);
    pool.select('openai');
    pool.register('openai', ['key-two']);
    const health = pool.health('openai');
    expect(health.total).toBe(1);
    expect(health.keys[0].keyId).toBe(providerKeyId('key-two'));
  });
});


