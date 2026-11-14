import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { releaseSourceFingerprint } from './release-source-fingerprint.mjs';

test('release source fingerprint is stable and changes when a shipped runtime input changes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-release-fingerprint-'));
  try {
    fs.mkdirSync(path.join(root, 'src', 'server'), { recursive: true });
    fs.mkdirSync(path.join(root, 'src', 'server', '__tests__'), { recursive: true });
    fs.writeFileSync(path.join(root, 'package.json'), '{"name":"fixture"}');
    fs.writeFileSync(path.join(root, 'src', 'server', 'app.ts'), 'export const version = 1;');
    fs.writeFileSync(path.join(root, 'src', 'server', '__tests__', 'app.test.ts'), 'ignored test file');
    const initial = releaseSourceFingerprint(root);
    assert.match(initial, /^[a-f0-9]{64}$/);
    assert.equal(releaseSourceFingerprint(root), initial);
    fs.writeFileSync(path.join(root, 'src', 'server', 'app.ts'), 'export const version = 2;');
    assert.notEqual(releaseSourceFingerprint(root), initial);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('release artifact checker rejects missing and stale fingerprints before examining installer files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-release-check-'));
  try {
    const markerPath = path.join(root, '.quillix-smoke', 'package-output.json');
    fs.mkdirSync(path.dirname(markerPath), { recursive: true });
    const marker = {
      target: 'portable',
      outputDir: path.join(root, 'release', 'windows'),
      sourceFingerprint: '0'.repeat(64),
    };
    fs.writeFileSync(markerPath, JSON.stringify(marker));
    const checkScript = path.resolve('scripts/smoke/release-artifact-check.mjs');
    const runCheck = () => spawnSync(process.execPath, [checkScript], {
      // Generous budget: the check re-reads the release tree and computes a
      // source fingerprint. A tight budget kills it on a loaded host and
      // fails the test for reasons unrelated to the code under test.
      cwd: root, timeout: 30_000, encoding: 'utf8', windowsHide: true,
    });

    const stale = runCheck();
    assert.notEqual(stale.status, 0);
    assert.match(stale.stderr, /Packaged artifact is stale/);

    marker.sourceFingerprint = releaseSourceFingerprint(root);
    fs.writeFileSync(markerPath, JSON.stringify(marker));
    const current = runCheck();
    assert.notEqual(current.status, 0);
    assert.match(current.stderr, /Installer missing/);
    assert.doesNotMatch(current.stderr, /source fingerprint|artifact is stale/i);

    delete marker.sourceFingerprint;
    fs.writeFileSync(markerPath, JSON.stringify(marker));
    const legacy = runCheck();
    assert.notEqual(legacy.status, 0);
    assert.match(legacy.stderr, /no source fingerprint/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
