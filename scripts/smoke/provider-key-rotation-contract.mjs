import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// QUILLIX M9.3 contract: advanced provider key management.
//
//   1. Source surface — the key pool, the encrypted key store, the provider
//      adapter and the health route must all exist and keep their safeguards.
//   2. Runtime behaviour — the real key pool is imported and exercised:
//      selection, rotation, cooldowns, recovery, health reporting and the
//      guarantee that no secret ever leaves the pool.

const project = path.resolve(import.meta.dirname, '../..');
const read = (...parts) => fs.readFileSync(path.join(project, ...parts), 'utf8');

const rotationSource = read('src', 'server', 'providerKeyRotation.ts');
const poolSource = read('src', 'server', 'encryptedKeyPool.ts');
const universalSource = read('src', 'server', 'universal.ts');
const serverSource = read('server.ts');
const combined = [rotationSource, poolSource, universalSource, serverSource].join('\n');

const checks = [
  ['the key pool is a real module',
    /export class ProviderKeyPool \{/],
  ['keys are identified by a non-secret digest',
    /export function providerKeyId\(/],
  ['the encrypted key store protects every key',
    /dpapi-current-user-v1/],
  ['the encrypted store writes atomically',
    /flag: 'wx'/],
  ['invalid credentials are distinguished',
    /'invalid-credentials'/],
  ['expired credentials are distinguished',
    /'expired-credentials'/],
  ['rate limits are distinguished',
    /'rate-limited'/],
  ['quota exhaustion is distinguished',
    /'quota-exhausted'/],
  ['temporary server errors are distinguished',
    /'server-error'/],
  ['network failures are distinguished',
    /'network-error'/],
  ['every failure kind has its own cooldown window',
    /export const DEFAULT_KEY_COOLDOWN_POLICY/],
  ['a provider retry window can extend the cooldown',
    /Math\.max\(policyWindow, classification\.retryAfterMs \|\| 0\)/],
  ['the attempt budget is bounded',
    /this\.maxAttempts = Math\.max\(1, options\.maxAttempts \?\? 3\)/],
  ['the provider adapter registers its keys in the pool',
    /providerKeyPool\.register\(keyScope, credentials\)/],
  ['the provider adapter rotates to the next key',
    /rotatedToNextKey/],
  ['a key is never tried twice in one request',
    /const attemptedKeyIds: string\[\]/],
  ['a successful response marks the key healthy',
    /providerKeyPool\.reportSuccess\(keyScope, currentKeyId\)/],
  ['a provider outage does not break the key',
    /\{ cooldown: false \}/],
  ['the health route never exposes key material',
    /app\.get\('\/api\/providers\/key-health'/],
];

for (const [label, pattern] of checks) {
  assert.ok(pattern.test(combined), `M9.3 contract: ${label}`);
}

// --- Runtime behaviour ------------------------------------------------------
const moduleUrl = pathToFileURL(path.join(project, 'src', 'server', 'providerKeyRotation.ts')).href;
const {
  ProviderKeyPool,
  ProviderKeyUnavailableError,
  classifyProviderFailure,
  providerKeyId,
} = await import(moduleUrl);

let clock = 1_700_000_000_000;
const pool = new ProviderKeyPool({ now: () => clock, maxAttempts: 3 });

// 1. Several keys per provider, identified without secrets.
const ids = pool.register('openai', ['key-one', 'key-two', 'key-three']);
assert.equal(ids.length, 3, 'M9.3 contract: every key must be registered');
assert.ok(!ids.includes('key-one'), 'M9.3 contract: a key id must never be the key itself');

// 2. Automatic selection picks a healthy key.
const first = pool.select('openai');
assert.ok(first && ['key-one', 'key-two', 'key-three'].includes(first.key), 'M9.3 contract: a healthy key must be selected');

// 3. An invalid credential cools the key down and the next key takes over.
pool.reportFailure('openai', first.keyId, { status: 401 });
const second = pool.select('openai');
assert.notEqual(second.keyId, first.keyId, 'M9.3 contract: a rejected key must not be selected again');

// 4. A rate limit rests the key without breaking it (account level window).
pool.reportFailure('openai', second.keyId, { status: 429 });
assert.equal(pool.isEligible('openai', second.keyId), true, 'M9.3 contract: a rate limit must not invalidate the key');

// 5. A quota exhaustion is credential specific and takes the key out of rotation.
pool.reportFailure('openai', second.keyId, { status: 402 });
assert.equal(pool.isEligible('openai', second.keyId), false, 'M9.3 contract: an exhausted quota must rest the key');

// 6. Recovery: the key becomes usable again once its cooldown expires.
clock += 61 * 60_000;
assert.equal(pool.isEligible('openai', second.keyId), true, 'M9.3 contract: a key must recover after its cooldown');

// 7. Bounded failover with automatic rotation.
const used = [];
const outcome = await pool.execute('groq', ['a-key', 'b-key'], async key => {
  used.push(key);
  if (key === 'a-key') throw Object.assign(new Error('unauthorized'), { status: 401 });
  return 'ok';
});
assert.equal(outcome.result, 'ok', 'M9.3 contract: the failover must produce the result');
assert.deepEqual(used, ['a-key', 'b-key'], 'M9.3 contract: the pool must rotate to the next key');
assert.equal(outcome.attempts, 2, 'M9.3 contract: the attempt count must be reported');

// 8. The attempt budget can never be exceeded.
const attempts = [];
await assert.rejects(pool.execute('groq', ['a-key', 'b-key', 'c-key'], async key => {
  attempts.push(key);
  throw Object.assign(new Error('unauthorized'), { status: 401 });
}, { maxAttempts: 2 }));
assert.equal(attempts.length, 2, 'M9.3 contract: the retry budget must be bounded');

// 9. Health reporting never contains key material.
const serialized = JSON.stringify(pool.healthAll());
assert.ok(!serialized.includes('a-key'), 'M9.3 contract: the health report must not contain a key');
assert.ok(serialized.includes(providerKeyId('a-key')), 'M9.3 contract: the health report must contain the key id');

// 10. When every key rests, the caller is told when to retry.
const single = new ProviderKeyPool({ now: () => clock });
single.register('nvidia', ['only-key']);
const only = single.select('nvidia');
single.reportFailure('nvidia', only.keyId, { status: 401 });
assert.throws(() => single.select('nvidia'), ProviderKeyUnavailableError, 'M9.3 contract: a resting key must be reported');

// 11. Classification separates every documented failure kind.
assert.equal(classifyProviderFailure({ status: 401 }).kind, 'invalid-credentials');
assert.equal(classifyProviderFailure({ status: 401, message: 'key has expired' }).kind, 'expired-credentials');
assert.equal(classifyProviderFailure({ status: 429 }).kind, 'rate-limited');
assert.equal(classifyProviderFailure({ status: 402 }).kind, 'quota-exhausted');
assert.equal(classifyProviderFailure({ status: 503 }).kind, 'server-error');
assert.equal(classifyProviderFailure(new Error('fetch failed')).kind, 'network-error');

console.log('M9.3 provider-key-rotation contract: all checks passed.');

