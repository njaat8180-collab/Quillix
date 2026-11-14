import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { cleanupIncompleteNsisArtifacts } from './cleanup-incomplete-nsis.mjs';

const withTempDir = async run => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-nsis-cleanup-'));
  try { await run(directory); }
  finally { fs.rmSync(directory, { recursive: true, force: true }); }
};

test('removes only undersized NSIS installer and its regular blockmap after fallback', async () => {
  await withTempDir(directory => {
    const installer = path.join(directory, 'Quillix Setup 1.2.0.exe');
    const blockmap = `${installer}.blockmap`;
    fs.writeFileSync(installer, Buffer.alloc(4096));
    fs.writeFileSync(blockmap, '{}');

    const removed = cleanupIncompleteNsisArtifacts(directory);

    assert.deepEqual(removed, [installer, blockmap]);
    assert.equal(fs.existsSync(installer), false);
    assert.equal(fs.existsSync(blockmap), false);
  });
});

test('also cleans an undersized installer named after the real productName', async () => {
  // electron-builder names the NSIS installer after the builder productName
  // ("NUVRO AI Setup 1.2.0.exe"). The cleanup used to hardcode the old
  // "Quillix Setup 1.2.0.exe" spelling and therefore never removed an
  // incomplete installer produced by the current packager.
  await withTempDir(directory => {
    const builder = JSON.parse(fs.readFileSync(path.resolve('electron-builder.json'), 'utf8'));
    const pkg = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'));
    const installer = path.join(directory, `${builder.productName} Setup ${pkg.version}.exe`);
    const blockmap = `${installer}.blockmap`;
    fs.writeFileSync(installer, Buffer.alloc(4096));
    fs.writeFileSync(blockmap, '{}');

    const removed = cleanupIncompleteNsisArtifacts(directory);

    assert.deepEqual(removed, [installer, blockmap]);
    assert.equal(fs.existsSync(installer), false);
    assert.equal(fs.existsSync(blockmap), false);
  });
});

test('preserves a valid NSIS installer and its blockmap', async () => {
  await withTempDir(directory => {
    const installer = path.join(directory, 'Quillix Setup 1.2.0.exe');
    const blockmap = `${installer}.blockmap`;
    fs.writeFileSync(installer, Buffer.alloc(10 * 1024 * 1024));
    fs.writeFileSync(blockmap, '{}');

    assert.deepEqual(cleanupIncompleteNsisArtifacts(directory), []);
    assert.equal(fs.statSync(installer).size, 10 * 1024 * 1024);
    assert.equal(fs.existsSync(blockmap), true);
  });
});

test('leaves missing outputs and non-file paths alone', async () => {
  await withTempDir(directory => {
    assert.deepEqual(cleanupIncompleteNsisArtifacts(directory), []);
    fs.mkdirSync(path.join(directory, 'Quillix Setup 1.2.0.exe'));
    assert.deepEqual(cleanupIncompleteNsisArtifacts(directory), []);
    assert.equal(fs.statSync(path.join(directory, 'Quillix Setup 1.2.0.exe')).isDirectory(), true);
  });
});

test('runs cleanup only after the portable fallback succeeds', () => {
  const source = fs.readFileSync(path.join(import.meta.dirname, 'package-win.mjs'), 'utf8');
  const successGate = source.indexOf("if (result.status !== 0) process.exit(result.status ?? 1);");
  const cleanup = source.indexOf('if (nsisFallbackOutput) {');
  assert.ok(successGate >= 0 && cleanup > successGate, 'cleanup must follow the successful package status gate');
  assert.match(source, /cleanupIncompleteNsisArtifacts\(nsisFallbackOutput\)/);
});
