import { afterEach, describe, expect, it, vi } from 'vitest';

const fileState = vi.hoisted(() => ({
  existsSync: vi.fn(() => false),
  unlinkSync: vi.fn(),
}));
const poolState = vi.hoisted(() => ({ keys: [] as string[] }));

vi.mock('fs', async () => {
  const actual = await vi.importActual<any>('fs');
  return {
    ...actual,
    default: { ...actual.default, existsSync: fileState.existsSync, unlinkSync: fileState.unlinkSync },
    existsSync: fileState.existsSync,
    unlinkSync: fileState.unlinkSync,
  };
});
vi.mock('os', async () => {
  const actual = await vi.importActual<any>('os');
  return { ...actual, default: { ...actual.default, homedir: () => 'C:\\Users\\test-user' } };
});
vi.mock('../encryptedKeyPool.js', () => ({
  readEncryptedKeyPool: vi.fn(() => poolState.keys),
  saveEncryptedKeyToPool: vi.fn(() => 1),
  clearEncryptedKeyPool: vi.fn(),
  encryptedKeyPoolCount: vi.fn(() => poolState.keys.length),
}));

import {
  checkWindowsSarvamStorage,
  clearSarvamKey,
  dpapi,
  hasSarvamKey,
  loadSarvamKeys,
  parseSarvamRetryAfterMs,
  saveSarvamKey,
} from '../sarvam.js';

const originalSarvamKey = process.env.SARVAM_API_KEY;
const originalSarvamKeys = process.env.SARVAM_API_KEYS;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  fileState.existsSync.mockReset().mockReturnValue(false);
  fileState.unlinkSync.mockReset();
  poolState.keys = [];
  if (originalSarvamKey === undefined) delete process.env.SARVAM_API_KEY;
  else process.env.SARVAM_API_KEY = originalSarvamKey;
  if (originalSarvamKeys === undefined) delete process.env.SARVAM_API_KEYS;
  else process.env.SARVAM_API_KEYS = originalSarvamKeys;
});

function spawnResult(overrides: Record<string, unknown> = {}) {
  return { status: 1, stdout: '', stderr: '', error: undefined, ...overrides } as any;
}

describe('Sarvam DPAPI runtime and candidates', () => {
  it('rejects secure storage on unsupported platforms', () => {
    expect(() => dpapi('protect', 'secret', { platform: 'linux' })).toThrow(/supported on Windows/);
  });

  it('reports that PowerShell was not found after ENOENT candidates', () => {
    const spawn = vi.fn(() => spawnResult({ error: Object.assign(new Error('missing'), { code: 'ENOENT' }) }));
    expect(() => dpapi('protect', 'secret', {
      platform: 'win32',
      env: { SystemRoot: 'C:\\Windows' },
      exists: () => true,
      spawn: spawn as any,
    })).toThrow(/PowerShell was not found/);
    expect(spawn).toHaveBeenCalled();
  });

  it('reports a secure-storage timeout', () => {
    const spawn = vi.fn(() => spawnResult({ error: Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }) }));
    expect(() => dpapi('protect', 'secret', {
      platform: 'win32', env: {}, exists: () => false, spawn: spawn as any,
    })).toThrow(/secure storage timed out/);
  });

  it('reports unavailable ProtectedData types', () => {
    const spawn = vi.fn(() => spawnResult({ stderr: 'DPAPI_ERROR:ProtectedDataTypeUnavailable' }));
    expect(() => dpapi('protect', 'secret', {
      platform: 'win32', env: {}, exists: () => false, spawn: spawn as any,
    })).toThrow(/DPAPI libraries could not be loaded/);
  });

  it('reports generic DPAPI failures without exposing stderr', () => {
    const spawn = vi.fn(() => spawnResult({ stderr: 'DPAPI_ERROR:CryptographicException secret-context' }));
    expect(() => dpapi('protect', 'secret', {
      platform: 'win32', env: {}, exists: () => false, spawn: spawn as any,
    })).toThrow(/Windows error type: CryptographicException/);
    try {
      dpapi('protect', 'secret', { platform: 'win32', env: {}, exists: () => false, spawn: spawn as any });
    } catch (error) {
      expect(String((error as Error).message)).not.toContain('secret-context');
    }
  });

  it('resolves absolute PowerShell candidates from SystemRoot and WINDIR', () => {
    const spawn = vi.fn(() => spawnResult({ error: Object.assign(new Error('missing'), { code: 'ENOENT' }) }));
    expect(() => dpapi('protect', 'secret', {
      platform: 'win32',
      env: { SystemRoot: 'C:\\Windows', WINDIR: 'D:\\Windows' },
      exists: file => file.includes('D:\\Windows\\System32'),
      spawn: spawn as any,
    })).toThrow(/PowerShell was not found/);
    const binaries = (spawn.mock.calls as any[][]).map(call => call[0]);
    expect(binaries).toContain('D:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    expect(binaries).toContain('powershell.exe');
    expect(binaries).toContain('pwsh.exe');
  });

  it('protects and unprotects a base64 round trip', () => {
    const spawn = vi.fn((_binary: string, args: string[]) => {
      const script = Buffer.from(args[4], 'base64').toString('utf16le');
      return spawnResult({
        status: 0,
        stdout: script.includes('::Protect') ? Buffer.from('protected').toString('base64') : Buffer.from('secret').toString('base64'),
      });
    });
    const runtime = { platform: 'win32' as NodeJS.Platform, env: {}, exists: () => false, spawn: spawn as any };
    const encrypted = dpapi('protect', 'secret', runtime);
    expect(encrypted).toBe(Buffer.from('protected').toString('base64'));
    expect(dpapi('unprotect', encrypted, runtime)).toBe('secret');
  });

  it('returns a safe storage diagnostic when secure storage is unavailable', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
    const result = checkWindowsSarvamStorage();
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/supported on Windows/);
  });
});

describe('Sarvam key storage validation and collection', () => {
  it('parses numeric, date and invalid Retry-After values', () => {
    const now = Date.parse('2026-01-01T00:00:00.000Z');
    expect(parseSarvamRetryAfterMs('1.5', now)).toBe(1500);
    expect(parseSarvamRetryAfterMs('2026-01-01T00:00:05.000Z', now)).toBe(5000);
    expect(parseSarvamRetryAfterMs('not-a-date', now)).toBe(0);
    expect(parseSarvamRetryAfterMs(null, now)).toBe(0);
  });

  it('rejects empty, oversized and multiline API keys', () => {
    expect(() => saveSarvamKey('')).toThrow(/Invalid Sarvam API key/);
    expect(() => saveSarvamKey('x'.repeat(1025))).toThrow(/Invalid Sarvam API key/);
    expect(() => saveSarvamKey('key\nsecond-line')).toThrow(/Invalid Sarvam API key/);
  });

  it('deduplicates and caps the available Sarvam key collection', () => {
    process.env.SARVAM_API_KEY = 'primary';
    process.env.SARVAM_API_KEYS = Array.from({ length: 25 }, (_, index) => `key-${index + 1}`).join(',');
    poolState.keys = ['pool-key', 'primary'];
    const keys = loadSarvamKeys();
    expect(keys).toHaveLength(20);
    expect(new Set(keys).size).toBe(20);
    expect(keys).toContain('pool-key');
    expect(keys).not.toContain('key-19');
  });

  it('reports whether a Sarvam key exists', () => {
    delete process.env.SARVAM_API_KEY;
    expect(hasSarvamKey()).toBe(false);
    process.env.SARVAM_API_KEY = 'configured';
    expect(hasSarvamKey()).toBe(true);
  });

  it('clears both current and legacy Sarvam key files', () => {
    clearSarvamKey();
    expect(fileState.unlinkSync).toHaveBeenCalledTimes(2);
    expect(fileState.unlinkSync.mock.calls.map(call => call[0]).join('|')).toMatch(/sarvam-key\.dpapi\.json.*sarvam-key\.json/);
  });
});
