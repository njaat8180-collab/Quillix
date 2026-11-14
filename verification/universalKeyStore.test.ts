/**
 * M8.9 — `src/server/universal.ts` credential-store coverage.
 *
 * The Universal provider persists API keys through Windows DPAPI into
 * `~/.quillix/`. Those functions were previously untested, which left the
 * single largest uncovered block in the module (lines ~402-508) — the code
 * that decides whether a credential is scoped to the right endpoint, whether
 * a saved key can be migrated, and whether a failover pool stays within its
 * limit.
 *
 * SAFETY: these functions write to the *real* user profile by default. A test
 * that called `saveUniversalKey()` unqualified would overwrite the developer's
 * own saved Universal API key. This file therefore redirects `os.homedir()`
 * to an isolated temporary directory by setting `USERPROFILE` BEFORE the
 * module is imported (Node's `os.homedir()` reads `USERPROFILE` on Windows at
 * call time, and `universal.ts` resolves its key path at module load).
 *
 * The module is imported dynamically so the environment override is in place
 * before `universal.ts` is evaluated.
 *
 * No Cline-owned file is modified by this test.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-universal-keyhome-'));
const previousUserProfile = process.env.USERPROFILE;
const previousSettingsPath = process.env.QUILLIX_SETTINGS_PATH;
const previousEnvKey = process.env.QUILLIX_UNIVERSAL_API_KEY;
const previousEnvEndpoint = process.env.QUILLIX_UNIVERSAL_API_ENDPOINT;
const previousEnvProtocol = process.env.QUILLIX_UNIVERSAL_API_PROTOCOL;
const previousEnvPool = process.env.QUILLIX_UNIVERSAL_API_KEYS;

// Redirect the profile BEFORE `universal.ts` is evaluated.
process.env.USERPROFILE = tempHome;
process.env.QUILLIX_SETTINGS_PATH = path.join(tempHome, 'settings.json');
delete process.env.QUILLIX_UNIVERSAL_API_KEY;
delete process.env.QUILLIX_UNIVERSAL_API_ENDPOINT;
delete process.env.QUILLIX_UNIVERSAL_API_PROTOCOL;
delete process.env.QUILLIX_UNIVERSAL_API_KEYS;

const universal = await import('../src/server/universal.js');
const sarvam = await import('../src/server/sarvam.js');

type KeyContext = { protocol: 'openai' | 'responses' | 'anthropic' | 'gemini'; endpoint: string };

const CONTEXT: KeyContext = { protocol: 'openai', endpoint: 'https://keys.example.com/v1' };
const OTHER_CONTEXT: KeyContext = { protocol: 'openai', endpoint: 'https://other.example.com/v1' };

const keyDir = path.join(tempHome, '.quillix');
const legacyKeyFile = path.join(keyDir, 'universal-key.dpapi.json');
const scopedFileFor = (context: KeyContext) =>
  path.join(keyDir, `provider-${createHash('sha256').update(universal.universalKeyScope(context)).digest('hex')}.dpapi.json`);
const scopedPoolFileFor = (context: KeyContext) =>
  path.join(keyDir, `provider-${createHash('sha256').update(universal.universalKeyScope(context)).digest('hex')}.pool.dpapi.json`);

const removeKeyFiles = () => {
  for (const file of [legacyKeyFile, scopedFileFor(CONTEXT), scopedPoolFileFor(CONTEXT)]) {
    try { fs.unlinkSync(file); } catch { /* absent */ }
  }
};

beforeAll(() => {
  fs.mkdirSync(keyDir, { recursive: true });
});

afterAll(() => {
  removeKeyFiles();
  fs.rmSync(tempHome, { recursive: true, force: true });
  if (previousUserProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = previousUserProfile;
  if (previousSettingsPath === undefined) delete process.env.QUILLIX_SETTINGS_PATH; else process.env.QUILLIX_SETTINGS_PATH = previousSettingsPath;
  if (previousEnvKey === undefined) delete process.env.QUILLIX_UNIVERSAL_API_KEY; else process.env.QUILLIX_UNIVERSAL_API_KEY = previousEnvKey;
  if (previousEnvEndpoint === undefined) delete process.env.QUILLIX_UNIVERSAL_API_ENDPOINT; else process.env.QUILLIX_UNIVERSAL_API_ENDPOINT = previousEnvEndpoint;
  if (previousEnvProtocol === undefined) delete process.env.QUILLIX_UNIVERSAL_API_PROTOCOL; else process.env.QUILLIX_UNIVERSAL_API_PROTOCOL = previousEnvProtocol;
  if (previousEnvPool === undefined) delete process.env.QUILLIX_UNIVERSAL_API_KEYS; else process.env.QUILLIX_UNIVERSAL_API_KEYS = previousEnvPool;
});

describe('Universal credential store — endpoint scoping', () => {
  it('scopes a key to the protocol and the NORMALIZED endpoint', () => {
    removeKeyFiles();
    expect(universal.universalKeyScope(CONTEXT)).toBe('openai::https://keys.example.com/v1');
    // A trailing slash must not create a second scope for the same provider.
    expect(universal.universalKeyScope({ protocol: 'openai', endpoint: 'https://keys.example.com/v1/' }))
      .toBe(universal.universalKeyScope(CONTEXT));
    // A different protocol on the same host is a different scope.
    expect(universal.universalKeyScope({ protocol: 'anthropic', endpoint: 'https://keys.example.com/v1' }))
      .not.toBe(universal.universalKeyScope(CONTEXT));
  });

  it('rejects an invalid endpoint instead of storing a key against it', () => {
    expect(() => universal.universalKeyScope({ protocol: 'openai', endpoint: 'not-a-url' }))
      .toThrow('Enter a valid API endpoint URL.');
  });
});

describe('Universal credential store — primary key lifecycle', () => {
  it('saves, reads back and clears a key for the exact endpoint', () => {
    removeKeyFiles();
    expect(universal.readUniversalKey(CONTEXT)).toBe('');
    expect(universal.hasUniversalKey(CONTEXT)).toBe(false);

    universal.saveUniversalKey('  sk-test-primary  ', CONTEXT);
    const stored = scopedFileFor(CONTEXT);
    expect(fs.existsSync(stored)).toBe(true);
    const record = JSON.parse(fs.readFileSync(stored, 'utf8'));
    expect(record.format).toBe('dpapi-current-user-v2');
    expect(record.scope).toBe(universal.universalKeyScope(CONTEXT));
    // The secret must never be written in plaintext.
    expect(fs.readFileSync(stored, 'utf8')).not.toContain('sk-test-primary');

    expect(universal.readUniversalKey(CONTEXT)).toBe('sk-test-primary');
    expect(universal.hasUniversalKey(CONTEXT)).toBe(true);

    universal.clearUniversalKey(CONTEXT);
    expect(fs.existsSync(stored)).toBe(false);
    expect(universal.readUniversalKey(CONTEXT)).toBe('');
  });

  it('refuses an empty, oversized or multi-line key', () => {
    removeKeyFiles();
    expect(() => universal.saveUniversalKey('', CONTEXT)).toThrow('Enter a valid API key.');
    expect(() => universal.saveUniversalKey('   ', CONTEXT)).toThrow('Enter a valid API key.');
    expect(() => universal.saveUniversalKey('x'.repeat(4097), CONTEXT)).toThrow('Enter a valid API key.');
    expect(() => universal.saveUniversalKey('sk-one\r\nsk-two', CONTEXT)).toThrow('Enter a valid API key.');
    expect(fs.existsSync(scopedFileFor(CONTEXT))).toBe(false);
  });

  it('does not hand a key saved for one endpoint to a different endpoint', () => {
    removeKeyFiles();
    universal.saveUniversalKey('sk-scoped-value', CONTEXT);
    // The scoped file of the OTHER endpoint does not exist, so the lookup
    // falls back to the legacy unscoped file — which is absent. The saved
    // secret must never leak to a different endpoint.
    expect(universal.readUniversalKey(OTHER_CONTEXT)).toBe('');
    // The key is still readable for the endpoint it was saved for.
    expect(universal.readUniversalKey(CONTEXT)).toBe('sk-scoped-value');

    // When the legacy unscoped file DOES exist and was written for another
    // endpoint, the mismatch must be reported instead of handing the key over.
    fs.mkdirSync(keyDir, { recursive: true });
    fs.writeFileSync(legacyKeyFile, JSON.stringify({
      format: 'dpapi-current-user-v2',
      scope: universal.universalKeyScope(CONTEXT),
      data: 'ciphertext',
    }));
    expect(() => universal.readUniversalKey(OTHER_CONTEXT)).toThrow(/belongs to a different endpoint/);
  });

  it('asks for a re-save when the stored record has a legacy format', () => {
    removeKeyFiles();
    fs.mkdirSync(keyDir, { recursive: true });
    fs.writeFileSync(scopedFileFor(CONTEXT), JSON.stringify({
      format: 'dpapi-current-user-v1',
      scope: universal.universalKeyScope(CONTEXT),
      data: 'legacy-ciphertext',
    }));
    expect(() => universal.readUniversalKey(CONTEXT)).toThrow(/needs migration/);
  });

  it('lets a deliberately configured environment variable override the stored key', () => {
    removeKeyFiles();
    universal.saveUniversalKey('sk-stored-value', CONTEXT);
    process.env.QUILLIX_UNIVERSAL_API_KEY = 'sk-env-value';
    process.env.QUILLIX_UNIVERSAL_API_ENDPOINT = CONTEXT.endpoint;
    process.env.QUILLIX_UNIVERSAL_API_PROTOCOL = CONTEXT.protocol;
    try {
      expect(universal.readUniversalKey(CONTEXT)).toBe('sk-env-value');
      // The environment override is scoped too — another endpoint must not
      // receive it.
      expect(universal.readUniversalKey(OTHER_CONTEXT)).toBe('');
    } finally {
      delete process.env.QUILLIX_UNIVERSAL_API_KEY;
      delete process.env.QUILLIX_UNIVERSAL_API_ENDPOINT;
      delete process.env.QUILLIX_UNIVERSAL_API_PROTOCOL;
    }
  });
});

describe('Universal credential store — failover pool', () => {
  it('adds, deduplicates and counts pool keys', () => {
    removeKeyFiles();
    expect(universal.readUniversalKeyPool(CONTEXT)).toEqual([]);
    expect(universal.universalKeyPoolCount(CONTEXT)).toBe(0);

    expect(universal.saveUniversalKeyToPool('sk-pool-one', CONTEXT)).toBe(1);
    expect(universal.saveUniversalKeyToPool('sk-pool-two', CONTEXT)).toBe(2);
    // The same key twice must not grow the pool.
    expect(universal.saveUniversalKeyToPool('sk-pool-two', CONTEXT)).toBe(2);
    expect(universal.universalKeyPoolCount(CONTEXT)).toBe(2);
    expect(universal.readUniversalKeyPool(CONTEXT)).toEqual(['sk-pool-one', 'sk-pool-two']);

    universal.clearUniversalKeyPool(CONTEXT);
    expect(universal.readUniversalKeyPool(CONTEXT)).toEqual([]);
  });

  it('caps the pool at 20 keys', () => {
    removeKeyFiles();
    // Seed a full 20-key pool as fixture state with ONE encryption round.
    // Saving 20 keys one by one would spawn 40 PowerShell DPAPI processes for
    // a single assertion.
    const seeded = Array.from({ length: 20 }, (_, index) => `sk-pool-${index}`);
    fs.mkdirSync(keyDir, { recursive: true });
    fs.writeFileSync(scopedPoolFileFor(CONTEXT), JSON.stringify({
      format: 'dpapi-current-user-v1-pool',
      scope: universal.universalKeyScope(CONTEXT),
      data: sarvam.dpapi('protect', JSON.stringify(seeded)),
    }));
    expect(universal.universalKeyPoolCount(CONTEXT)).toBe(20);
    expect(() => universal.saveUniversalKeyToPool('sk-pool-21', CONTEXT)).toThrow('A provider can have at most 20 failover keys.');
  });

  it('rejects an invalid pool key', () => {
    removeKeyFiles();
    expect(() => universal.saveUniversalKeyToPool('', CONTEXT)).toThrow('Enter a valid API key.');
    expect(() => universal.saveUniversalKeyToPool('x'.repeat(4097), CONTEXT)).toThrow('Enter a valid API key.');
    expect(() => universal.saveUniversalKeyToPool('sk-a\nsk-b', CONTEXT)).toThrow('Enter a valid API key.');
  });

  it('ignores a corrupt pool file instead of throwing', () => {
    removeKeyFiles();
    fs.mkdirSync(keyDir, { recursive: true });
    fs.writeFileSync(scopedPoolFileFor(CONTEXT), 'not-json-at-all');
    expect(universal.readUniversalKeyPool(CONTEXT)).toEqual([]);
    expect(universal.universalKeyPoolCount(CONTEXT)).toBe(0);
  });

  it('ignores a pool record whose scope does not match the endpoint', () => {
    removeKeyFiles();
    fs.mkdirSync(keyDir, { recursive: true });
    fs.writeFileSync(scopedPoolFileFor(CONTEXT), JSON.stringify({
      format: 'dpapi-current-user-v1-pool',
      scope: universal.universalKeyScope(OTHER_CONTEXT),
      data: 'ciphertext',
    }));
    expect(universal.readUniversalKeyPool(CONTEXT)).toEqual([]);
  });

  it('merges the primary key, the pool and the managed environment pool', () => {
    removeKeyFiles();
    universal.saveUniversalKey('sk-primary', CONTEXT);
    universal.saveUniversalKeyToPool('sk-pool', CONTEXT);
    process.env.QUILLIX_UNIVERSAL_API_KEYS = 'sk-env-a, sk-env-b\nsk-env-a';
    try {
      const keys = universal.readUniversalKeys(CONTEXT);
      expect(keys).toContain('sk-primary');
      expect(keys).toContain('sk-pool');
      expect(keys).toContain('sk-env-a');
      expect(keys).toContain('sk-env-b');
      expect(new Set(keys).size).toBe(keys.length);
    } finally {
      delete process.env.QUILLIX_UNIVERSAL_API_KEYS;
    }
  });

  it('clears the pool together with the primary key', () => {
    removeKeyFiles();
    universal.saveUniversalKey('sk-primary', CONTEXT);
    universal.saveUniversalKeyToPool('sk-pool', CONTEXT);
    universal.clearUniversalKey(CONTEXT);
    expect(universal.readUniversalKey(CONTEXT)).toBe('');
    expect(universal.readUniversalKeyPool(CONTEXT)).toEqual([]);
  });
});

describe('Universal credential store — legacy migration', () => {
  it('migrates a legacy unscoped key into the endpoint-scoped store exactly once', () => {
    removeKeyFiles();
    fs.mkdirSync(keyDir, { recursive: true });
    const legacyValue = 'sk-legacy-value';
    fs.writeFileSync(legacyKeyFile, JSON.stringify({
      format: 'dpapi-current-user-v1',
      data: sarvam.dpapi('protect', legacyValue),
    }));

    expect(universal.migrateLegacyUniversalKey(CONTEXT)).toBe(true);
    expect(universal.readUniversalKey(CONTEXT)).toBe(legacyValue);
    // A second migration attempt must be a no-op.
    expect(universal.migrateLegacyUniversalKey(CONTEXT)).toBe(false);
  });

  it('does not migrate a legacy record with an unknown format', () => {
    removeKeyFiles();
    fs.mkdirSync(keyDir, { recursive: true });
    fs.writeFileSync(legacyKeyFile, JSON.stringify({ format: 'dpapi-current-user-v0', data: 'ciphertext' }));
    expect(universal.migrateLegacyUniversalKey(CONTEXT)).toBe(false);
  });

  it('does nothing when there is no legacy key at all', () => {
    removeKeyFiles();
    expect(universal.migrateLegacyUniversalKey(CONTEXT)).toBe(false);
  });
});
