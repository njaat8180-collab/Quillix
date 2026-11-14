import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PORT,
  MAX_PORT,
  MIN_PORT,
  parseEnvFilePort,
  parsePortValue,
  resolvePort,
} from '../platform/portConfig';

/**
 * The Electron shell and the HTTP server must resolve the same port. Before
 * this contract existed the shell accepted values such as `3000.5` or `70000`
 * while the server rejected them, which produced an endless "server never
 * became ready" startup loop with no explanation.
 */
describe('desktop/server port contract', () => {
  it('accepts only integers inside the valid TCP port range', () => {
    expect(parsePortValue('3000')).toBe(3000);
    expect(parsePortValue(' 3000 ')).toBe(3000);
    expect(parsePortValue('1')).toBe(MIN_PORT);
    expect(parsePortValue('65535')).toBe(MAX_PORT);
  });

  it('rejects every value the server would refuse', () => {
    expect(parsePortValue('0')).toBeNull();
    expect(parsePortValue('65536')).toBeNull();
    expect(parsePortValue('-1')).toBeNull();
    expect(parsePortValue('3000.5')).toBeNull();
    expect(parsePortValue('0x10')).toBeNull();
    expect(parsePortValue('3e3')).toBeNull();
    expect(parsePortValue('3000abc')).toBeNull();
    expect(parsePortValue('port')).toBeNull();
    expect(parsePortValue('')).toBeNull();
    expect(parsePortValue('   ')).toBeNull();
    expect(parsePortValue(undefined)).toBeNull();
    expect(parsePortValue(null)).toBeNull();
  });

  it('reads the PORT entry of a .env file the way dotenv does', () => {
    expect(parseEnvFilePort('PORT=3100\nOTHER=1')).toBe('3100');
    expect(parseEnvFilePort('PORT = 3100')).toBe('3100');
    expect(parseEnvFilePort('PORT="3100"')).toBe('3100');
    expect(parseEnvFilePort("PORT='3100'")).toBe('3100');
    expect(parseEnvFilePort('PORT=3100 # local only')).toBe('3100');
    expect(parseEnvFilePort('PORT=')).toBeNull();
    expect(parseEnvFilePort('OTHER=1')).toBeNull();
    expect(parseEnvFilePort(undefined)).toBeNull();
  });

  it('prefers the environment, then the .env file, then the default', () => {
    expect(resolvePort({ envPort: '4100', envFileContents: 'PORT=3100' })).toMatchObject({
      port: 4100,
      source: 'env',
      ok: true,
    });
    expect(resolvePort({ envFileContents: 'PORT=3100' })).toMatchObject({
      port: 3100,
      source: 'file',
      ok: true,
    });
    expect(resolvePort({})).toMatchObject({ port: DEFAULT_PORT, source: 'default', ok: true });
  });

  it('reports an invalid configured port instead of silently using another one', () => {
    const fromEnv = resolvePort({ envPort: '70000' });
    expect(fromEnv.ok).toBe(false);
    expect(fromEnv.port).toBe(DEFAULT_PORT);
    expect(fromEnv.invalidValue).toBe('70000');
    expect(fromEnv.reason).toMatch(/between 1 and 65535/);

    const fromFile = resolvePort({ envFileContents: 'PORT=not-a-port' });
    expect(fromFile.ok).toBe(false);
    expect(fromFile.source).toBe('file');
    expect(fromFile.invalidValue).toBe('not-a-port');
    expect(fromFile.reason).toMatch(/between 1 and 65535/);
  });

  it('treats an empty environment variable as unset', () => {
    expect(resolvePort({ envPort: '', envFileContents: 'PORT=3100' })).toMatchObject({
      port: 3100,
      source: 'file',
      ok: true,
    });
    expect(resolvePort({ envPort: '   ' })).toMatchObject({
      port: DEFAULT_PORT,
      source: 'default',
      ok: true,
    });
  });
});
