import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  readPackageManifest,
  readPackageScripts,
  readPackageTestScript,
  clearPackageManifestCache,
} from '../packageManifest.js';

describe('packageManifest', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-manifest-'));
    clearPackageManifestCache();
  });

  afterEach(() => {
    clearPackageManifestCache();
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });

  const writeManifest = (contents: string) =>
    fs.writeFileSync(path.join(root, 'package.json'), contents, 'utf8');

  it('returns undefined for a missing manifest', () => {
    expect(readPackageManifest(root)).toBeUndefined();
  });

  it('parses a valid manifest', () => {
    writeManifest(JSON.stringify({ name: 'demo', scripts: { test: 'vitest run' } }));
    const manifest = readPackageManifest(root);
    expect(manifest?.name).toBe('demo');
    expect(manifest?.scripts?.test).toBe('vitest run');
  });

  it('returns undefined for a malformed manifest instead of throwing', () => {
    writeManifest('{ this is not json');
    expect(readPackageManifest(root)).toBeUndefined();
  });

  it('returns undefined when the manifest is not an object', () => {
    writeManifest('"just a string"');
    expect(readPackageManifest(root)).toBeUndefined();
  });

  it('serves repeated reads from cache without re-parsing', () => {
    writeManifest(JSON.stringify({ name: 'cached', scripts: { test: 'npm test' } }));
    const first = readPackageManifest(root);
    const second = readPackageManifest(root);
    expect(first).toBe(second);
    expect(second?.name).toBe('cached');
  });

  it('picks up an edited manifest (mtime/size validation)', async () => {
    writeManifest(JSON.stringify({ name: 'before', scripts: { test: 'npm test' } }));
    expect(readPackageManifest(root)?.name).toBe('before');
    // Ensure the mtime actually differs on filesystems with coarse timestamps.
    await new Promise(resolve => setTimeout(resolve, 20));
    writeManifest(JSON.stringify({ name: 'after', scripts: { test: 'npm run test' } }));
    const updated = readPackageManifest(root);
    expect(updated?.name).toBe('after');
    expect(updated?.scripts?.test).toBe('npm run test');
  });

  it('reports a missing manifest after the file is deleted', () => {
    writeManifest(JSON.stringify({ name: 'gone' }));
    expect(readPackageManifest(root)?.name).toBe('gone');
    fs.rmSync(path.join(root, 'package.json'));
    expect(readPackageManifest(root)).toBeUndefined();
  });

  it('exposes script helpers with safe fallbacks', () => {
    expect(readPackageScripts(root)).toEqual({});
    expect(readPackageTestScript(root)).toBe('');
    writeManifest(JSON.stringify({ scripts: { test: 'vitest run' } }));
    expect(readPackageScripts(root)).toEqual({ test: 'vitest run' });
    expect(readPackageTestScript(root)).toBe('vitest run');
  });

  it('treats a non-string test script as absent', () => {
    writeManifest(JSON.stringify({ scripts: { test: 42 } }));
    expect(readPackageTestScript(root)).toBe('');
  });
});
