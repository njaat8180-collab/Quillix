import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// QUILLIX M9.6 contract: concurrent workspace safety.
//
// Two halves:
//   1. Source surface — the lock service, the server routes, the renderer
//      bridge and the write guard must all exist and keep their safeguards.
//   2. Runtime behaviour — the real lock module is imported and exercised on a
//      real temporary folder: claim, contention, stale takeover and release.
//
// The runtime half is what makes this a contract instead of a description: a
// source scan alone cannot prove that two instances cannot write at once.

const project = path.resolve(import.meta.dirname, '../..');
const read = (...parts) => fs.readFileSync(path.join(project, ...parts), 'utf8');

const lockSource = read('src', 'server', 'workspaceLock.ts');
const serverSource = read('server.ts');
const workspaceSource = read('src', 'server', 'workspace.ts');
const bridgeSource = read('src', 'services', 'apiBridge.ts');
const combinedSource = [lockSource, serverSource, workspaceSource, bridgeSource].join('\n');

const checks = [
  ['the lock service exists as its own module',
    /export async function acquireWorkspaceLock\(/],
  ['the lock is claimed with an exclusive create so only one process wins',
    /fs\.openSync\(location\.lockPath, 'wx'\)/],
  ['lock records are written atomically',
    /function writeFileAtomic\(/],
  ['the owner record identifies the process, host and session',
    /export interface WorkspaceLockOwner \{/],
  ['liveness is proven by an instance heartbeat, never by the pid alone',
    /function readInstanceHeartbeat\(/],
  ['a live pid is not sufficient evidence that a lock is stale',
    /if \(!isProcessAlive\(owner\.pid\)\)/],
  ['stale locks are detected and taken over',
    /takeoverStale/],
  ['acquisition is bounded so it can never deadlock',
    /acquireTimeoutMs/],
  ['only the owning session may release a lock',
    /if \(owner\.sessionId !== handle\.sessionId\) return false;/],
  ['the workspace write guard is exposed',
    /export function assertWorkspaceWritable\(/],
  ['every workspace mutation is guarded against a second instance',
    /private guardExclusiveWrite\(\)/],
  ['the server exposes the lock status route',
    /app\.get\('\/api\/workspace\/lock'/],
  ['the server exposes the lock claim route',
    /app\.post\('\/api\/workspace\/lock', requireAgentMode/],
  ['the server exposes the lock release route',
    /app\.post\('\/api\/workspace\/lock\/release'/],
  ['the server releases the lock on shutdown',
    /releaseAllWorkspaceLocks\(\)/],
  ['the renderer bridge can read the lock status',
    /public async getWorkspaceLockStatus\(\)/],
  ['the renderer bridge can claim the workspace',
    /public async acquireWorkspaceLock\(\)/],
];

for (const [label, pattern] of checks) {
  assert.ok(pattern.test(combinedSource), `M9.6 contract: ${label}`);
}

// --- Runtime behaviour ------------------------------------------------------
const moduleUrl = pathToFileURL(path.join(project, 'src', 'server', 'workspaceLock.ts')).href;
const {
  acquireWorkspaceLock,
  tryAcquireWorkspaceLock,
  releaseWorkspaceLock,
  getWorkspaceLockStatus,
  assertWorkspaceWritable,
  WorkspaceLockError,
} = await import(moduleUrl);

const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-lock-contract-')));
const otherWorkspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-lock-contract-')));

try {
  // 1. A fresh workspace is unlocked and writable.
  assert.equal(getWorkspaceLockStatus(workspace).held, false, 'M9.6 contract: a fresh workspace must be unlocked');
  assert.equal(assertWorkspaceWritable(workspace).ok, true, 'M9.6 contract: a fresh workspace must be writable');

  // 2. Claiming the workspace makes it visibly held.
  const handle = await acquireWorkspaceLock(workspace, { instanceId: 'contract-owner' });
  const status = getWorkspaceLockStatus(workspace);
  assert.equal(status.held, true, 'M9.6 contract: a claimed workspace must be reported as held');
  assert.equal(status.stale, false, 'M9.6 contract: a live claim must never be reported as stale');
  assert.equal(status.owner?.pid, process.pid, 'M9.6 contract: the owner record must carry the pid');

  // 3. A second instance cannot claim it and cannot write to it.
  const contender = await tryAcquireWorkspaceLock(workspace, { instanceId: 'contract-contender' });
  assert.equal(contender, null, 'M9.6 contract: a second instance must not be able to claim a locked workspace');
  let refused = null;
  try {
    await acquireWorkspaceLock(workspace, { instanceId: 'contract-contender', timeoutMs: 120 });
  } catch (error) {
    refused = error;
  }
  assert.ok(refused instanceof WorkspaceLockError, 'M9.6 contract: contention must raise a WorkspaceLockError');
  assert.equal(refused.code, 'timeout', 'M9.6 contract: contention must end in a timeout, never a hang');

  // 4. Independent workspaces never interfere with each other.
  const other = await acquireWorkspaceLock(otherWorkspace, { instanceId: 'contract-owner' });
  assert.equal(getWorkspaceLockStatus(otherWorkspace).held, true, 'M9.6 contract: separate workspaces must lock independently');
  assert.notEqual(other.lockPath, handle.lockPath, 'M9.6 contract: separate workspaces must use separate lock files');
  releaseWorkspaceLock(other);

  // 5. Releasing frees the workspace again.
  assert.equal(releaseWorkspaceLock(handle), true, 'M9.6 contract: the owner must be able to release its lock');
  assert.equal(getWorkspaceLockStatus(workspace).held, false, 'M9.6 contract: a released workspace must be unlocked');
  assert.equal(assertWorkspaceWritable(workspace).ok, true, 'M9.6 contract: a released workspace must be writable');

  // 6. A crash (no cleanup) must not block the workspace forever: the lock is
  //    recognised as stale and taken over.
  const crashed = await acquireWorkspaceLock(workspace, { instanceId: 'contract-crashed' });
  fs.rmSync(path.join(os.tmpdir(), 'quillix-workspace-locks', 'instances', 'contract-crashed.json'), { force: true });
  const recovered = await acquireWorkspaceLock(workspace, { instanceId: 'contract-next', timeoutMs: 2_000 });
  assert.notEqual(recovered.sessionId, crashed.sessionId, 'M9.6 contract: a crashed owner must not keep the workspace locked');
  releaseWorkspaceLock(recovered);
} finally {
  fs.rmSync(workspace, { recursive: true, force: true });
  fs.rmSync(otherWorkspace, { recursive: true, force: true });
}

console.log('M9.6 workspace-lock contract: all checks passed.');

