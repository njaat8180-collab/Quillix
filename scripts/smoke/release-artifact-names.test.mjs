import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { expectedArtifactNames, resolveInstaller, resolveUnpackedExecutable } from './release-artifact-names.mjs';

const releaseCheck = path.resolve('scripts/smoke/release-artifact-check.mjs');
const projectRoot = path.resolve(import.meta.dirname, '../..');

test('derives artifact names from the real electron-builder productName', () => {
  const names = expectedArtifactNames(projectRoot, 'nsis');
  const builder = JSON.parse(fs.readFileSync(path.join(projectRoot, 'electron-builder.json'), 'utf8'));
  assert.equal(names.productName, builder.productName);
  assert.equal(names.unpackedExecutable, `${builder.productName}.exe`);
  assert.equal(names.installer, `${builder.productName} Setup ${names.version}.exe`);

  const portable = expectedArtifactNames(projectRoot, 'portable');
  assert.equal(portable.installer, `${builder.productName} ${portable.version}.exe`);
});

test('resolver prefers the real product name and falls back to the legacy spelling', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-resolve-'));
  try {
    const release = path.join(root, 'release');
    fs.mkdirSync(release, { recursive: true });
    const names = expectedArtifactNames(projectRoot, 'nsis');

    // Legacy spelling still resolves (artifact produced before the rename).
    const legacy = path.join(release, 'Quillix Setup 1.2.0.exe');
    fs.writeFileSync(legacy, 'x');
    assert.equal(resolveInstaller(release, projectRoot, 'nsis'), legacy);

    // The real product name wins when both are present.
    const real = path.join(release, names.installer);
    fs.writeFileSync(real, 'x');
    assert.equal(resolveInstaller(release, projectRoot, 'nsis'), real);

    const unpacked = path.join(release, 'win-unpacked');
    fs.mkdirSync(unpacked, { recursive: true });
    const legacyExe = path.join(unpacked, 'Quillix.exe');
    fs.writeFileSync(legacyExe, 'x');
    assert.equal(resolveUnpackedExecutable(unpacked, projectRoot), legacyExe);
    const realExe = path.join(unpacked, names.unpackedExecutable);
    fs.writeFileSync(realExe, 'x');
    assert.equal(resolveUnpackedExecutable(unpacked, projectRoot), realExe);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('release artifact check still fails when the installer is absent', () => {
  // The gate must not be weakened into an unconditional pass: with a valid
  // fingerprint but no installer on disk it has to fail.
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-release-missing-'));
  try {
    fs.mkdirSync(path.join(cwd, '.quillix-smoke'), { recursive: true });
    fs.mkdirSync(path.join(cwd, 'release', 'windows'), { recursive: true });
    const fingerprint = spawnSync(process.execPath, [
      path.join(projectRoot, 'scripts', 'smoke', 'release-fingerprint-probe.mjs'),
      cwd,
    ], { encoding: 'utf8', windowsHide: true }).stdout.trim();
    assert.match(fingerprint, /^[a-f0-9]{64}$/i);

    fs.writeFileSync(path.join(cwd, '.quillix-smoke', 'package-output.json'), JSON.stringify({
      outputDir: path.join(cwd, 'release', 'windows'),
      target: 'nsis',
      sourceFingerprint: fingerprint,
    }));

    const result = spawnSync(process.execPath, [releaseCheck], { cwd, encoding: 'utf8', windowsHide: true });
    assert.notEqual(result.status, 0, 'gate must fail when the installer is missing');
    assert.match(result.stderr, /Installer missing/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
