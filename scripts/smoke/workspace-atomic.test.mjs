import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { WorkspaceManager } from '../../src/server/workspace.ts';

const smokeTemp = path.resolve(import.meta.dirname, '../../.quillix-smoke');
fs.mkdirSync(smokeTemp, { recursive: true });

test('create, overwrite and read-back verification actually persist file bytes', () => {
  const root = fs.mkdtempSync(path.join(smokeTemp, 'write-'));
  try {
    const workspace = new WorkspaceManager(root);
    const first = workspace.createFile('nested/index.html', '<h1>Hello</h1>');
    assert.equal(first.success, true);
    assert.equal(first.verified, true);
    assert.equal(workspace.readFile('nested/index.html').content, '<h1>Hello</h1>');
    const overwrite = workspace.writeFile('nested/index.html', '<h1>Changed</h1>');
    assert.equal(overwrite.success, true);
    assert.equal(overwrite.verified, true);
    assert.equal(workspace.readFile('nested/index.html').content, '<h1>Changed</h1>');
    assert.equal(workspace.createFile('nested/index.html', 'BAD').success, false);
    assert.equal(workspace.readFile('nested/index.html').content, '<h1>Changed</h1>');
    assert.equal(fs.readdirSync(path.join(root, 'nested')).filter(n => n.includes('quillix-tmp')).length, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a failed atomic write leaves no temporary files or corrupts an existing directory', () => {
  const root = fs.mkdtempSync(path.join(smokeTemp, 'write-fail-'));
  try {
    const workspace = new WorkspaceManager(root);
    fs.mkdirSync(path.join(root, 'folder'));
    const result = workspace.writeFile('folder', 'malicious');
    assert.equal(result.success, false);
    assert.equal(fs.statSync(path.join(root, 'folder')).isDirectory(), true);
    assert.equal(fs.readdirSync(root).filter(n => n.includes('quillix-tmp')).length, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('file-write tools reject outside-workspace paths and linked directory escapes', () => {
  const root = fs.mkdtempSync(path.join(smokeTemp, 'write-boundary-'));
  const outside = fs.mkdtempSync(path.join(smokeTemp, 'outside-'));
  try {
    const workspace = new WorkspaceManager(root);
    assert.equal(workspace.writeFile('../outside.txt', 'NO').success, false);
    // Windows directory symlinks require developer mode/admin rights; a
    // junction exercises the same escape boundary without that privilege.
    try {
      fs.symlinkSync(outside, path.join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
      if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code)) throw error;
      return;
    }
    assert.equal(workspace.writeFile('linked/outside.txt', 'NO').success, false);
    assert.equal(fs.existsSync(path.join(outside, 'outside.txt')), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); }
});
