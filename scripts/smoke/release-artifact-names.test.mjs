import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { releaseArtifactNames, firstExistingArtifact } from './release-artifact-names.mjs';

// The release gates must verify the artifact the PACKAGER produced. These
// tests lock that contract: the names come from electron-builder.json /
// package.json, so a product rename cannot silently break the release gate.

const fixtureRoot = (files) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-artifact-names-'));
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return root;
};

test('artifact names follow the packager product name and version', () => {
  const root = fixtureRoot({
    'electron-builder.json': JSON.stringify({ productName: 'NUVRO AI' }),
    'package.json': JSON.stringify({ version: '1.2.0' }),
  });
  try {
    const names = releaseArtifactNames(root);
    assert.equal(names.productName, 'NUVRO AI');
    assert.equal(names.version, '1.2.0');
    assert.ok(names.nsis.includes('NUVRO AI Setup 1.2.0.exe'));
    assert.ok(names.portable.includes('NUVRO AI 1.2.0.exe'));
    assert.ok(names.executable.includes('NUVRO AI.exe'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('artifact names honour an explicit artifactName template', () => {
  const root = fixtureRoot({
    'electron-builder.json': JSON.stringify({
      productName: 'NUVRO AI',
      nsis: { artifactName: '${productName}-${version}-setup.exe' },
    }),
    'package.json': JSON.stringify({ version: '2.0.1' }),
  });
  try {
    const names = releaseArtifactNames(root);
    assert.ok(names.nsis.includes('NUVRO AI-2.0.1-setup.exe'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a legacy artifact still verifies after the product was renamed', () => {
  const root = fixtureRoot({
    'electron-builder.json': JSON.stringify({ productName: 'NUVRO AI' }),
    'package.json': JSON.stringify({ version: '1.2.0' }),
  });
  try {
    const names = releaseArtifactNames(root);
    assert.ok(names.nsis.includes('Quillix Setup 1.2.0.exe'));
    assert.ok(names.portable.includes('Quillix 1.2.0.exe'));
    assert.ok(names.executable.includes('Quillix.exe'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('missing configuration falls back to the legacy names without throwing', () => {
  const root = fixtureRoot({});
  try {
    const names = releaseArtifactNames(root);
    assert.equal(names.productName, 'Quillix');
    assert.ok(names.nsis.includes('Quillix Setup 0.0.0.exe'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the first existing artifact wins and a missing one reports the preferred name', () => {
  const root = fixtureRoot({});
  try {
    fs.writeFileSync(path.join(root, 'Quillix Setup 1.2.0.exe'), 'legacy');
    const chosen = firstExistingArtifact(root, ['NUVRO AI Setup 1.2.0.exe', 'Quillix Setup 1.2.0.exe']);
    assert.equal(path.basename(chosen), 'Quillix Setup 1.2.0.exe');
    const missing = firstExistingArtifact(root, ['NUVRO AI Setup 1.2.0.exe']);
    assert.equal(path.basename(missing), 'NUVRO AI Setup 1.2.0.exe');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
