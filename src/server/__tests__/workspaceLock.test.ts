import { describe, expect, it, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  acquireWorkspaceLock,
  tryAcquireWorkspaceLock,
  releaseWorkspaceLock,
  getWorkspaceLockStatus,
  assertWorkspaceWritable,
  forceReleaseStaleLock,
  refreshInstanceHeartbeat,
  workspaceLockFilePath,
  writeWorkspaceLockOwnerFile,
  WorkspaceLockError,
  type WorkspaceLockOwner,
} from '../workspaceLock.js';
import { WorkspaceManager } from '../workspace.js';

// M9.6 — concurrent workspace safety.
//
// Every case below runs against a real temporary directory: the lock file, the
// instance heartbeat registry and the workspace writes are all real files on
// disk. Nothing here is mocked, so a passing test proves the behaviour on the
// same Windows filesystem the application uses.

const createdRoots: string[] = [];

function makeRoot(): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-wslock-')));
  createdRoots.push(root);
  return root;
}

function instanceHeartbeatFile(instanceId: string): string {
  return path.join(os.tmpdir(), 'quillix-workspace-locks', 'instances', `${instanceId}.json`);
}

/**
 * Write a lock record owned by a *different* instance and (optionally) keep
 * that instance alive by publishing a fresh heartbeat.
 */
function foreignOwner(root: string, options: { alive?: boolean; instanceId?: string } = {}): WorkspaceLockOwner {
  const instanceId = options.instanceId ?? randomUUID();
  const owner: WorkspaceLockOwner = {
    sessionId: randomUUID(),
    instanceId,
    pid: process.pid,
    processStartedAt: new Date(Date.now() - 60_000).toISOString(),
    hostname: os.hostname(),
    username: 'other-instance',
    appVersion: '1.2.0',
    workspace: root,
    acquiredAt: new Date().toISOString(),
    heartbeatAt: new Date().toISOString(),
  };
  writeWorkspaceLockOwnerFile(root, owner);
  if (options.alive !== false) refreshInstanceHeartbeat(instanceId);
  return owner;
}

afterEach(() => {
  for (const root of createdRoots.splice(0)) {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

describe('workspace lock — acquisition and release', () => {
  it('acquires a lock, reports it as held and releases it cleanly', async () => {
    const root = makeRoot();
    const before = getWorkspaceLockStatus(root);
    expect(before.held).toBe(false);
    expect(before.stale).toBe(false);

    const handle = await acquireWorkspaceLock(root, { instanceId: randomUUID() });
    expect(handle.sessionId).toBeTruthy();
    expect(fs.existsSync(workspaceLockFilePath(root))).toBe(true);

    const during = getWorkspaceLockStatus(root);
    expect(during.held).toBe(true);
    expect(during.stale).toBe(false);
    expect(during.owner?.sessionId).toBe(handle.sessionId);
    expect(during.owner?.pid).toBe(process.pid);
    expect(during.owner?.hostname).toBe(os.hostname());

    expect(releaseWorkspaceLock(handle)).toBe(true);
    expect(fs.existsSync(workspaceLockFilePath(root))).toBe(false);
    expect(getWorkspaceLockStatus(root).held).toBe(false);
  });

  it('records ownership metadata without storing anything secret', async () => {
    const root = makeRoot();
    const handle = await acquireWorkspaceLock(root, { instanceId: randomUUID() });
    const raw = fs.readFileSync(handle.lockPath, 'utf8');
    const parsed = JSON.parse(raw);
    expect(Object.keys(parsed).sort()).toEqual([
      'acquiredAt', 'appVersion', 'heartbeatAt', 'hostname', 'instanceId',
      'pid', 'processStartedAt', 'sessionId', 'username', 'workspace',
    ]);
    expect(raw).not.toMatch(/api[_-]?key|secret|token|password/i);
    releaseWorkspaceLock(handle);
  });

  it('is re-entrant for the owning instance instead of deadlocking', async () => {
    const root = makeRoot();
    const instanceId = randomUUID();
    const first = await acquireWorkspaceLock(root, { instanceId });
    const second = await acquireWorkspaceLock(root, { instanceId });
    expect(second.sessionId).toBe(first.sessionId);
    releaseWorkspaceLock(first);
    expect(getWorkspaceLockStatus(root).held).toBe(false);
  });

  it('refuses to release a lock that belongs to another session', async () => {
    const root = makeRoot();
    const owner = foreignOwner(root);
    const handle = await acquireWorkspaceLock(root, { instanceId: randomUUID(), timeoutMs: 0 })
      .catch(() => null);
    expect(handle).toBeNull();

    const impostor = {
      sessionId: randomUUID(),
      instanceId: randomUUID(),
      workspace: root,
      lockPath: workspaceLockFilePath(root),
      owner: { ...owner, sessionId: randomUUID() },
      acquiredAtMs: Date.now(),
    };
    expect(releaseWorkspaceLock(impostor)).toBe(false);
    expect(getWorkspaceLockStatus(root).held).toBe(true);
  });
});

describe('workspace lock — contention', () => {
  it('refuses a second acquisition while another live instance holds the lock', async () => {
    const root = makeRoot();
    const owner = foreignOwner(root);

    const attempt = await tryAcquireWorkspaceLock(root, { instanceId: randomUUID() });
    expect(attempt).toBeNull();

    let failure: unknown = null;
    try {
      await acquireWorkspaceLock(root, { instanceId: randomUUID(), timeoutMs: 120 });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(WorkspaceLockError);
    const lockError = failure as WorkspaceLockError;
    expect(lockError.code).toBe('timeout');
    expect(lockError.owner?.sessionId).toBe(owner.sessionId);
    expect(lockError.message).toMatch(/locked by another QUILLIX instance/i);
    expect(lockError.message).not.toMatch(/api[_-]?key|secret/i);
  });

  it('times out instead of hanging forever (no deadlock)', async () => {
    const root = makeRoot();
    foreignOwner(root);
    const startedAt = Date.now();
    await expect(acquireWorkspaceLock(root, { instanceId: randomUUID(), timeoutMs: 200 }))
      .rejects.toBeInstanceOf(WorkspaceLockError);
    expect(Date.now() - startedAt).toBeLessThan(5_000);
  });

  it('lets exactly one of two concurrent acquisitions win', async () => {
    const root = makeRoot();
    const results = await Promise.allSettled([
      acquireWorkspaceLock(root, { instanceId: randomUUID(), timeoutMs: 400 }),
      acquireWorkspaceLock(root, { instanceId: randomUUID(), timeoutMs: 400 }),
    ]);
    const fulfilled = results.filter(result => result.status === 'fulfilled');
    const rejected = results.filter(result => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    releaseWorkspaceLock((fulfilled[0] as PromiseFulfilledResult<any>).value);
  });

  it('keeps locks for separate workspaces independent', async () => {
    const first = makeRoot();
    const second = makeRoot();
    const handleA = await acquireWorkspaceLock(first, { instanceId: randomUUID() });
    const handleB = await acquireWorkspaceLock(second, { instanceId: randomUUID() });
    expect(handleA.lockPath).not.toBe(handleB.lockPath);
    expect(getWorkspaceLockStatus(first).held).toBe(true);
    expect(getWorkspaceLockStatus(second).held).toBe(true);
    releaseWorkspaceLock(handleA);
    releaseWorkspaceLock(handleB);
  });
});

describe('workspace lock — stale detection and crash recovery', () => {
  it('does not treat a live PID as proof that a lock is stale', async () => {
    const root = makeRoot();
    // The owner PID is alive (it is this process), but the owner never
    // published a heartbeat: the process died without cleaning up.
    foreignOwner(root, { alive: false });

    const status = getWorkspaceLockStatus(root);
    expect(status.held).toBe(false);
    expect(status.stale).toBe(true);

    const handle = await acquireWorkspaceLock(root, { instanceId: randomUUID(), timeoutMs: 500 });
    expect(handle.owner.sessionId).not.toBe(status.owner?.sessionId);
    releaseWorkspaceLock(handle);
  });

  it('recovers a lock left behind by a crashed instance', async () => {
    const root = makeRoot();
    const instanceId = randomUUID();
    const owner = foreignOwner(root, { instanceId });
    // Simulate the crash: the heartbeat stops being refreshed.
    const heartbeatFile = instanceHeartbeatFile(instanceId);
    const record = JSON.parse(fs.readFileSync(heartbeatFile, 'utf8'));
    record.heartbeatAt = new Date(Date.now() - 10 * 60_000).toISOString();
    fs.writeFileSync(heartbeatFile, JSON.stringify(record));

    const status = getWorkspaceLockStatus(root, { staleAfterMs: 30_000 });
    expect(status.held).toBe(false);
    expect(status.stale).toBe(true);

    const handle = await acquireWorkspaceLock(root, { instanceId: randomUUID(), staleAfterMs: 30_000, timeoutMs: 1_000 });
    expect(handle.owner.instanceId).not.toBe(owner.instanceId);
    releaseWorkspaceLock(handle);
  });

  it('never steals a lock whose owner is still heart-beating', async () => {
    const root = makeRoot();
    foreignOwner(root);
    const status = getWorkspaceLockStatus(root);
    expect(status.held).toBe(true);
    expect(status.stale).toBe(false);
    expect(forceReleaseStaleLock(root)).toBe(false);
    expect(fs.existsSync(workspaceLockFilePath(root))).toBe(true);
  });

  it('force releases a lock that is provably stale', async () => {
    const root = makeRoot();
    foreignOwner(root, { alive: false });
    expect(getWorkspaceLockStatus(root).stale).toBe(true);
    expect(forceReleaseStaleLock(root)).toBe(true);
    expect(fs.existsSync(workspaceLockFilePath(root))).toBe(false);
  });

  it('refreshes the heartbeat while the lock is held', async () => {
    const root = makeRoot();
    const handle = await acquireWorkspaceLock(root, { instanceId: randomUUID(), heartbeatIntervalMs: 250 });
    const first = getWorkspaceLockStatus(root).owner?.heartbeatAt;
    await new Promise(resolve => setTimeout(resolve, 700));
    const second = getWorkspaceLockStatus(root).owner?.heartbeatAt;
    expect(Date.parse(second as string)).toBeGreaterThan(Date.parse(first as string));
    releaseWorkspaceLock(handle);
  });
});

describe('workspace lock — write protection', () => {
  it('allows writes when no other instance holds the workspace', () => {
    const root = makeRoot();
    const guard = assertWorkspaceWritable(root);
    expect(guard.ok).toBe(true);
    expect(guard.status.held).toBe(false);
  });

  it('refuses writes while another live instance owns the workspace', () => {
    const root = makeRoot();
    foreignOwner(root);
    const guard = assertWorkspaceWritable(root);
    expect(guard.ok).toBe(false);
    expect(guard.error).toMatch(/locked by another QUILLIX instance/i);
    expect(guard.owner?.username).toBe('other-instance');
  });

  it('allows the owning instance to keep writing', async () => {
    const root = makeRoot();
    const handle = await acquireWorkspaceLock(root);
    const guard = assertWorkspaceWritable(root);
    expect(guard.ok).toBe(true);
    releaseWorkspaceLock(handle);
  });

  it('blocks real workspace mutations from a second instance and restores them after release', () => {
    const root = makeRoot();
    const manager = new WorkspaceManager(root);
    fs.writeFileSync(path.join(root, 'existing.txt'), 'original');

    const owner = foreignOwner(root);
    const blockedWrite = manager.writeFile('existing.txt', 'overwritten');
    expect(blockedWrite.success).toBe(false);
    expect(blockedWrite.error).toMatch(/locked by another QUILLIX instance/i);
    expect(fs.readFileSync(path.join(root, 'existing.txt'), 'utf8')).toBe('original');

    expect(manager.createFile('new.txt', 'x').success).toBe(false);
    expect(manager.deleteFile('existing.txt').success).toBe(false);
    expect(manager.renameFile('existing.txt', 'renamed.txt').success).toBe(false);
    expect(fs.existsSync(path.join(root, 'renamed.txt'))).toBe(false);

    // A live owner must never be force-released by another instance.
    expect(forceReleaseStaleLock(root)).toBe(false);
    expect(manager.writeFile('existing.txt', 'still-blocked').success).toBe(false);

    // The other instance crashes: its heartbeat stops, the lock becomes stale
    // and the workspace recovers automatically.
    fs.rmSync(instanceHeartbeatFile(owner.instanceId), { force: true });
    const unlocked = manager.writeFile('existing.txt', 'updated');
    expect(unlocked.success).toBe(true);
    expect(fs.readFileSync(path.join(root, 'existing.txt'), 'utf8')).toBe('updated');
  });

  it('does not block writes once the other instance stops heart-beating', () => {
    const root = makeRoot();
    const manager = new WorkspaceManager(root);
    foreignOwner(root, { alive: false });
    const result = manager.writeFile('recovered.txt', 'ok');
    expect(result.success).toBe(true);
    expect(fs.readFileSync(path.join(root, 'recovered.txt'), 'utf8')).toBe('ok');
  });
});


