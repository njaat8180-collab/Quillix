import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_LEASE_TTL_MS,
  WORKSPACE_LEASE_FILE,
  acquireWorkspaceLease,
  isLeaseExpired,
  normalizeWorkspaceRoot,
  readWorkspaceLease,
  releaseWorkspaceLease,
  renewWorkspaceLease,
  workspaceLeasePath,
} from '../platform/workspaceLease';

/**
 * M9.6 — concurrent workspace safety.
 *
 * Two Quillix instances must never write to the same workspace: their file
 * writes, task checkpoints and agent edits race each other and silently
 * corrupt the user's project. The port check only stops two instances that
 * share a port; the same folder can be opened on a different port, or by the
 * desktop shell and a CLI server at once.
 */

const roots: string[] = [];

function makeWorkspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-lease-'));
  roots.push(root);
  return root;
}

afterEach(() => {
  while (roots.length) {
    const root = roots.pop();
    if (!root) continue;
    try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

const OWNER_A = 'instance-a';
const OWNER_B = 'instance-b';

describe('workspace lease (M9.6)', () => {
  it('stores the lease inside the workspace\'s own .quillix folder', () => {
    const root = makeWorkspace();
    expect(workspaceLeasePath(root)).toBe(path.join(root, '.quillix', WORKSPACE_LEASE_FILE));
    // `.gitignore` already excludes `**/.quillix/`, so the lease never lands
    // in the user's repository.
    expect(workspaceLeasePath(root).includes(`${path.sep}.quillix${path.sep}`)).toBe(true);
  });

  it('grants a free workspace to the first instance', () => {
    const root = makeWorkspace();
    const result = acquireWorkspaceLease({ root, ownerId: OWNER_A });
    expect(result.acquired).toBe(true);
    expect(result.lease?.ownerId).toBe(OWNER_A);
    expect(result.lease?.root).toBe(normalizeWorkspaceRoot(root));
    expect(fs.existsSync(workspaceLeasePath(root))).toBe(true);
  });

  it('refuses a workspace that another live instance already owns', () => {
    const root = makeWorkspace();
    expect(acquireWorkspaceLease({ root, ownerId: OWNER_A }).acquired).toBe(true);

    const second = acquireWorkspaceLease({ root, ownerId: OWNER_B });
    expect(second.acquired).toBe(false);
    expect(second.error).toMatch(/already using this workspace/i);
    // The original owner keeps the lease.
    expect(readWorkspaceLease(root)?.ownerId).toBe(OWNER_A);
  });

  it('never hands the same workspace to two owners, even for the same owner id', () => {
    const root = makeWorkspace();
    const first = acquireWorkspaceLease({ root, ownerId: OWNER_A });
    const second = acquireWorkspaceLease({ root, ownerId: OWNER_A });
    expect(first.acquired).toBe(true);
    // A second request from the same id must not create a second lease file
    // or overwrite the live one.
    expect(second.acquired).toBe(false);
    expect(readWorkspaceLease(root)?.ownerId).toBe(OWNER_A);
    expect(fs.readdirSync(path.join(root, '.quillix')).filter(name => name.endsWith('.json'))).toEqual([WORKSPACE_LEASE_FILE]);
  });

  it('takes over a lease whose owner died without releasing it', () => {
    const root = makeWorkspace();
    const abandoned = acquireWorkspaceLease({
      root,
      ownerId: OWNER_A,
      now: Date.now() - (DEFAULT_LEASE_TTL_MS * 10),
      ttlMs: 1,
    });
    expect(abandoned.acquired).toBe(true);

    const takeover = acquireWorkspaceLease({ root, ownerId: OWNER_B, now: Date.now() });
    expect(takeover.acquired).toBe(true);
    expect(takeover.lease?.ownerId).toBe(OWNER_B);
  });

  it('treats a corrupt lease file as no lease at all', () => {
    const root = makeWorkspace();
    fs.mkdirSync(path.join(root, '.quillix'), { recursive: true });
    fs.writeFileSync(workspaceLeasePath(root), '{not json', 'utf8');

    const result = acquireWorkspaceLease({ root, ownerId: OWNER_B });
    expect(result.acquired).toBe(true);
    expect(result.lease?.ownerId).toBe(OWNER_B);
  });

  it('renews the lease only for the owner and extends its expiry', () => {
    const root = makeWorkspace();
    const start = Date.now();
    const original = acquireWorkspaceLease({ root, ownerId: OWNER_A, now: start, ttlMs: 1000 });
    expect(original.acquired).toBe(true);

    const byOther = renewWorkspaceLease({ root, ownerId: OWNER_B, now: start + 100 });
    expect(byOther.acquired).toBe(false);
    expect(byOther.error).toMatch(/lost the workspace lease/i);

    const byOwner = renewWorkspaceLease({ root, ownerId: OWNER_A, now: start + 500, ttlMs: 1000 });
    expect(byOwner.acquired).toBe(true);
    expect(Date.parse(byOwner.lease!.expiresAt)).toBeGreaterThan(Date.parse(original.lease!.expiresAt));
  });

  it('releases the workspace so another instance can take it', () => {
    const root = makeWorkspace();
    acquireWorkspaceLease({ root, ownerId: OWNER_A });

    const refused = releaseWorkspaceLease({ root, ownerId: OWNER_B });
    expect(refused.released).toBe(false);
    expect(fs.existsSync(workspaceLeasePath(root))).toBe(true);

    const released = releaseWorkspaceLease({ root, ownerId: OWNER_A });
    expect(released.released).toBe(true);
    expect(fs.existsSync(workspaceLeasePath(root))).toBe(false);

    expect(acquireWorkspaceLease({ root, ownerId: OWNER_B }).acquired).toBe(true);
  });

  it('releasing an already released lease is not an error', () => {
    const root = makeWorkspace();
    acquireWorkspaceLease({ root, ownerId: OWNER_A });
    expect(releaseWorkspaceLease({ root, ownerId: OWNER_A }).released).toBe(true);
    expect(releaseWorkspaceLease({ root, ownerId: OWNER_A }).released).toBe(true);
  });

  it('resolves different spellings of one folder to the same lease', () => {
    const root = makeWorkspace();
    expect(normalizeWorkspaceRoot(`${root}${path.sep}`)).toBe(normalizeWorkspaceRoot(root));
    expect(normalizeWorkspaceRoot(path.join(root, '.', '..', path.basename(root)))).toBe(normalizeWorkspaceRoot(root));

    acquireWorkspaceLease({ root, ownerId: OWNER_A });
    const other = acquireWorkspaceLease({ root: `${root}${path.sep}`, ownerId: OWNER_B });
    expect(other.acquired).toBe(false);
  });

  it('expires a lease only after its ttl, and treats an unreadable expiry as expired', () => {
    const now = Date.now();
    expect(isLeaseExpired(null, now)).toBe(true);
    expect(isLeaseExpired({
      version: 1,
      root: 'C:/x',
      ownerId: 'a',
      ownerPid: 1,
      ownerHost: 'h',
      acquiredAt: new Date(now).toISOString(),
      heartbeatAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 1000).toISOString(),
    }, now)).toBe(false);
    expect(isLeaseExpired({
      version: 1,
      root: 'C:/x',
      ownerId: 'a',
      ownerPid: 1,
      ownerHost: 'h',
      acquiredAt: 'not-a-date',
      heartbeatAt: 'not-a-date',
      expiresAt: 'not-a-date',
    }, now)).toBe(true);
  });
});
