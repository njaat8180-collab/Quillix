/** Offline integration checks with Node built-ins. No npm download required. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { buildSourceArchive } from '../../src/server/sourceArchive.ts';
import { PREVIEW_CONTENT_SECURITY_POLICY, isPreviewAssetAllowed } from '../../src/server/previewSafety.ts';
import { validateLocalApiRequest } from '../../src/server/localRequestSecurity.ts';
import { GitService } from '../../src/server/git.ts';
import { WorkspaceManager } from '../../src/server/workspace.ts';

const smokeTemp = path.resolve(import.meta.dirname, '../../.quillix-smoke');
fs.mkdirSync(smokeTemp, { recursive: true });
const temp = () => fs.mkdtempSync(path.join(smokeTemp, 'core-'));

function unzipLocalFiles(buffer) {
  let i = 0;
  const result = new Map();
  while (buffer.readUInt32LE(i) === 0x04034b50) {
    const method = buffer.readUInt16LE(i + 8);
    const length = buffer.readUInt32LE(i + 18);
    const nameLen = buffer.readUInt16LE(i + 26);
    const extraLen = buffer.readUInt16LE(i + 28);
    const name = buffer.subarray(i + 30, i + 30 + nameLen).toString('utf8');
    const dataOffset = i + 30 + nameLen + extraLen;
    const deflated = buffer.subarray(dataOffset, dataOffset + length);
    assert.equal(method, 8);
    result.set(name, inflateRawSync(deflated));
    i = dataOffset + length;
  }
  assert.equal(buffer.readUInt32LE(i), 0x02014b50);
  return result;
}

test('portable ZIP includes real source with valid deflate contents', () => {
  const root = temp();
  try {
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(path.join(root, 'src', 'main.js'), 'console.log("नमस्ते");\n');
    fs.writeFileSync(path.join(root, 'README.md'), 'Quillix offline coding agent');
    const archive = buildSourceArchive(root);
    assert.equal(archive.readUInt32LE(0), 0x04034b50);
    const result = unzipLocalFiles(archive);
    assert.equal(result.get('src/main.js').toString('utf8'), 'console.log("नमस्ते");\n');
    assert.equal(result.get('README.md').toString('utf8'), 'Quillix offline coding agent');
    assert.deepEqual(buildSourceArchive(root), archive, 'exports should be reproducible');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('portable ZIP excludes secrets, history, dependencies and symlink escapes', () => {
  const root = temp();
  const outside = temp();
  try {
    fs.writeFileSync(path.join(root, 'app.ts'), 'export const ok = true;');
    fs.writeFileSync(path.join(root, '.env'), 'SECRET=abc');
    fs.writeFileSync(path.join(root, '.env.example'), 'SECRET=placeholder');
    fs.writeFileSync(path.join(root, 'secrets.json'), '{"token":"abc"}');
    for (const d of ['.git', 'node_modules', '.quillix', 'dist', 'coverage']) {
      fs.mkdirSync(path.join(root, d));
      fs.writeFileSync(path.join(root, d, 'secret.txt'), 'hidden');
    }
    fs.writeFileSync(path.join(outside, 'outside.ts'), 'SECRET');
    try {
      fs.symlinkSync(outside, path.join(root, 'linked-outside'), process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
      if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code)) throw error;
    }
    const files = unzipLocalFiles(buildSourceArchive(root));
    assert.deepEqual([...files.keys()], ['app.ts']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('preview files cannot expose .env, internal state, git, builds or source secrets', () => {
  for (const file of ['site/index.html', 'site/styles.css', 'site/app.js', 'images/logo.png']) assert.equal(isPreviewAssetAllowed(file), true, file);
  for (const file of ['.env', '.git/config', '.quillix/tasks.json', 'site/.env', 'site/../.env', 'node_modules/a.js', 'dist/index.html', 'src/main.ts', 'key.pem', '']) assert.equal(isPreviewAssetAllowed(file), false, file);
  assert.match(PREVIEW_CONTENT_SECURITY_POLICY, /sandbox allow-scripts allow-forms/);
  assert.doesNotMatch(PREVIEW_CONTENT_SECURITY_POLICY, /allow-same-origin/);
});

test('local API rejects evil Origin, Host, and sandboxed origin', () => {
  assert.equal(validateLocalApiRequest('127.0.0.1:3000', 'http://127.0.0.1:3000', 3000), true);
  assert.equal(validateLocalApiRequest('localhost:3000', undefined, 3000), true);
  for (const [host, origin] of [
    ['evil.com:3000', undefined],
    ['127.0.0.1:3000', 'null'],
    ['127.0.0.1:3000', 'https://attacker.com'],
    ['127.0.0.1:3000', 'http://127.0.0.1:3001'],
    ['127.0.0.1:3000.evil.com', undefined],
  ]) assert.equal(validateLocalApiRequest(host, origin, 3000), false);
});


test('Git safely commits literal shell metacharacters without execution', { skip: spawnSync('git', ['--version']).status !== 0 }, async () => {
  const root = temp();
  const outside = temp();
  try {
    execFileSync('git', ['init', '-q', root]);
    execFileSync('git', ['config', 'user.name', 'Quillix Test'], { cwd: root });
    execFileSync('git', ['config', 'user.email', 'test@localhost'], { cwd: root });
    const malicious = 'hello $(touch injected).txt'; // legal on Windows; still shell-sensitive
    fs.writeFileSync(path.join(root, malicious), 'safe content');
    const git = new GitService(null);
    const stage = await git.add(root, malicious);
    assert.equal(stage.success, true, stage.output);
    const commit = await git.commit(root, 'Test $(touch commit_injected)');
    assert.equal(commit.success, true, commit.output);
    assert.equal(fs.existsSync(path.join(root, 'injected')), false);
    assert.equal(fs.existsSync(path.join(root, 'commit_injected')), false);
    const log = await git.getLog(root);
    assert.match(log[0].message, /\$\(touch/);
    assert.ok((await git.getStatus(root)).isGit);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('Git cannot stage or restore files outside the workspace', { skip: spawnSync('git', ['--version']).status !== 0 }, async () => {
  const root = temp();
  const outside = temp();
  try {
    execFileSync('git', ['init', '-q', root]);
    const git = new GitService(null);
    const attempts = ['../outside.txt', path.join(outside, 'file.txt'), ':!everything'];
    for (const value of attempts) {
      assert.equal((await git.add(root, value)).success, false, value);
      assert.equal((await git.restore(root, value)).success, false, value);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});


test('workspace search skips secrets, symlinks and hidden task memory', () => {
  const root = temp();
  const outside = temp();
  try {
    fs.writeFileSync(path.join(root, 'main.js'), 'export const greeting = "hello";');
    fs.writeFileSync(path.join(root, '.env'), 'VERY_SECRET_TOKEN');
    fs.writeFileSync(path.join(root, 'secrets.json'), 'VERY_SECRET_TOKEN');
    fs.mkdirSync(path.join(root, '.quillix'));
    fs.writeFileSync(path.join(root, '.quillix', 'memory.json'), 'VERY_SECRET_TOKEN');
    fs.writeFileSync(path.join(outside, 'escape.js'), 'VERY_SECRET_TOKEN');
    // Windows often blocks symlink creation unless Developer Mode is enabled.
    // Keep verifying secret exclusion even if this OS capability is unavailable.
    try {
      fs.symlinkSync(path.join(outside, 'escape.js'), path.join(root, 'link.js'), 'file');
    } catch (error) {
      if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code)) throw error;
    }
    const workspace = new WorkspaceManager(root);
    assert.equal(workspace.searchFiles('VERY_SECRET_TOKEN').matches.length, 0);
    const result = workspace.searchFiles('greeting');
    assert.equal(result.matches.length, 1);
    assert.equal(result.matches[0].filePath, 'main.js');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('workspace search handles zero-width expressions and bounds input', () => {
  const root = temp();
  try {
    fs.writeFileSync(path.join(root, 'text.txt'), 'needle on line one\n');
    const workspace = new WorkspaceManager(root);
    const regex = workspace.searchFiles('(?=needle)', { isRegex: true });
    assert.equal(regex.success, true);
    assert.equal(regex.matches.length, 1);
    assert.equal(workspace.searchFiles('a'.repeat(300)).success, false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('workspace read rejects oversized files without loading them', () => {
  const root = temp();
  try {
    fs.writeFileSync(path.join(root, 'big.js'), 'x');
    fs.truncateSync(path.join(root, 'big.js'), 9 * 1024 * 1024);
    const response = new WorkspaceManager(root).readFile('big.js');
    assert.equal(response.success, false);
    assert.match(response.error, /too large/i);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
