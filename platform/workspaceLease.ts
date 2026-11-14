import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

/**
 * M9.6 — concurrent workspace safety.
 *
 * Two Quillix instances must never write to the same workspace at the same
 * time: their file writes, task checkpoints and agent edits race each other
 * and silently corrupt the user's project. The port check only stops two
 * instances that share a port; the same workspace can be opened on a different
 * port, or by the desktop shell and a CLI server at once.
 *
 * The lease is a small, exclusive file under the workspace's own
 * `<workspace>/.quillix/` directory — the same place Quillix already keeps
 * `tasks.json` and `memory.json`. The repository's `.gitignore` already
 * excludes every `.quillix` directory, so the lease never pollutes it.
 *
 * Acquisition is an exclusive create (`wx`): the operating system decides the
 * winner, so two processes racing for the same workspace cannot both win. A
 * lease whose heartbeat is older than the TTL belongs to an instance that died
 * and may be taken over.
 */

export interface WorkspaceLease {
  /** Schema version of the lease file. */
  version: 1;
  /** Absolute, normalized workspace root this lease covers. */
  root: string;
  /** Unique id of the instance that owns the lease. */
  ownerId: string;
  /** Process id of the owner, for diagnostics only. */
  ownerPid: number;
  /** Host name of the owner, for diagnostics only. */
  ownerHost: string;
  /** ISO timestamp of the first acquisition. */
  acquiredAt: string;
  /** ISO timestamp of the last heartbeat. */
  heartbeatAt: string;
  /** ISO timestamp after which the lease is considered abandoned. */
  expiresAt: string;
}

export interface LeaseResult {
  /** True when this instance now owns the workspace. */
  acquired: boolean;
  /** The lease that is in effect (owned by this instance or by the other one). */
  lease: WorkspaceLease | null;
  /** Actionable message when `acquired` is false. */
  error?: string;
}

export interface LeaseOptions {
  /** Workspace root the lease covers. */
  root: string;
  /** Unique id of the requesting instance. */
  ownerId: string;
  /** Current time in epoch milliseconds. Injectable so tests stay deterministic. */
  now?: number;
  /** How long the lease stays valid without a heartbeat. */
  ttlMs?: number;
  /** Owner process id. Injectable for tests. */
  pid?: number;
  /** Owner host name. Injectable for tests. */
  host?: string;
}

/** Default lease lifetime. Long enough to survive a GC pause, short enough to
 *  release the workspace shortly after a crashed instance disappears. */
export const DEFAULT_LEASE_TTL_MS = 30_000;

/** File name of the lease inside `<workspace>/.quillix/`. */
export const WORKSPACE_LEASE_FILE = 'workspace.lease.json';

/**
 * Normalize a path so two spellings of the same folder (different case, a
 * trailing separator, a `..` segment) resolve to one lease on Windows.
 */
export function normalizeWorkspaceRoot(root: string): string {
  const resolved = path.resolve(root || process.cwd());
  const normalized = path.normalize(resolved);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

/** Absolute path of the lease file for a workspace root. */
export function workspaceLeasePath(root: string): string {
  return path.join(path.resolve(root || process.cwd()), '.quillix', WORKSPACE_LEASE_FILE);
}

function readLeaseFile(file: string): WorkspaceLease | null {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.version !== 1 || typeof parsed.ownerId !== 'string' || typeof parsed.root !== 'string') return null;
    if (typeof parsed.heartbeatAt !== 'string' || typeof parsed.expiresAt !== 'string') return null;
    return parsed as WorkspaceLease;
  } catch {
    // A missing, unreadable or corrupt lease file is treated as "no lease".
    return null;
  }
}

/** Read the lease currently in effect for a workspace, if any. */
export function readWorkspaceLease(root: string): WorkspaceLease | null {
  return readLeaseFile(workspaceLeasePath(root));
}

/**
 * True when the lease is past its expiry and may be taken over.
 * A lease without a parseable expiry is treated as expired so a corrupt file
 * can never lock a workspace forever.
 */
export function isLeaseExpired(lease: WorkspaceLease | null, now: number = Date.now()): boolean {
  if (!lease) return true;
  const expiresAt = Date.parse(lease.expiresAt);
  if (!Number.isFinite(expiresAt)) return true;
  return expiresAt <= now;
}

/** Human-readable, actionable reason for a busy workspace. */
export function describeLeaseOwner(lease: WorkspaceLease | null): string {
  if (!lease) return 'The workspace lease could not be read.';
  const pid = Number.isFinite(lease.ownerPid) ? ` (pid ${lease.ownerPid})` : '';
  const host = lease.ownerHost && lease.ownerHost !== os.hostname() ? ` on ${lease.ownerHost}` : '';
  return `Another NUVRO AI instance${pid}${host} is already using this workspace.`;
}

function buildLease(options: LeaseOptions, now: number, ttlMs: number): WorkspaceLease {
  const iso = new Date(now).toISOString();
  return {
    version: 1,
    root: normalizeWorkspaceRoot(options.root),
    ownerId: options.ownerId,
    ownerPid: options.pid ?? process.pid,
    ownerHost: options.host ?? os.hostname(),
    acquiredAt: iso,
    heartbeatAt: iso,
    expiresAt: new Date(now + ttlMs).toISOString(),
  };
}

/**
 * Try to take ownership of a workspace.
 *
 * Succeeds when no live lease exists. An expired lease (the previous owner
 * died) is taken over. Returns `acquired: false` with an actionable error when
 * another live instance holds the workspace.
 */
export function acquireWorkspaceLease(options: LeaseOptions): LeaseResult {
  const now = options.now ?? Date.now();
  const ttlMs = options.ttlMs ?? DEFAULT_LEASE_TTL_MS;
  const file = workspaceLeasePath(options.root);
  const lease = buildLease(options, now, ttlMs);

  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  } catch {
    // The lease directory could not be created; the exclusive create below
    // will fail with the real reason.
  }

  // Fast path: exclusive create. The OS arbitrates the race.
  try {
    const fd = fs.openSync(file, 'wx', 0o600);
    try {
      fs.writeFileSync(fd, JSON.stringify(lease, null, 2), { encoding: 'utf8' });
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    return { acquired: true, lease };
  } catch (error: any) {
    if (error?.code !== 'EEXIST') {
      return {
        acquired: false,
        lease: null,
        error: `The workspace lease could not be created (${error?.message || 'unknown error'}).`,
      };
    }
  }

  // Someone holds it. Read the current lease and decide.
  const existing = readLeaseFile(file);
  if (!isLeaseExpired(existing, now)) {
    return {
      acquired: false,
      lease: existing,
      error: `${describeLeaseOwner(existing)} Stop that instance, or choose a different folder.`,
    };
  }

  // The lease is abandoned. Take it over: remove the stale file and create a
  // fresh one exclusively. If another process wins this narrow race, its
  // exclusive create fails and we report the workspace as busy.
  try {
    fs.unlinkSync(file);
  } catch (error: any) {
    if (error?.code !== 'ENOENT') {
      return {
        acquired: false,
        lease: existing,
        error: `The stale workspace lease could not be replaced (${error?.message || 'unknown error'}).`,
      };
    }
  }

  try {
    const fd = fs.openSync(file, 'wx', 0o600);
    try {
      fs.writeFileSync(fd, JSON.stringify(lease, null, 2), { encoding: 'utf8' });
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    return { acquired: true, lease };
  } catch (error: any) {
    const winner = readLeaseFile(file);
    return {
      acquired: false,
      lease: winner,
      error: error?.code === 'EEXIST'
        ? `${describeLeaseOwner(winner)} Another instance took the workspace at the same moment.`
        : `The workspace lease could not be created (${error?.message || 'unknown error'}).`,
    };
  }
}

/**
 * Extend the lease this instance owns. Fails when the lease was taken over
 * by another instance, which the caller must surface.
 */
export function renewWorkspaceLease(options: LeaseOptions): LeaseResult {
  const now = options.now ?? Date.now();
  const ttlMs = options.ttlMs ?? DEFAULT_LEASE_TTL_MS;
  const file = workspaceLeasePath(options.root);
  const existing = readLeaseFile(file);
  if (!existing) {
    return { acquired: false, lease: null, error: 'The workspace lease is gone; it will be re-acquired.' };
  }
  if (existing.ownerId !== options.ownerId) {
    return {
      acquired: false,
      lease: existing,
      error: `${describeLeaseOwner(existing)} This instance lost the workspace lease.`,
    };
  }
  const renewed: WorkspaceLease = {
    ...existing,
    heartbeatAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttlMs).toISOString(),
  };
  try {
    const tmp = `${file}.tmp-${process.pid}-${randomUUID()}`;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const fd = fs.openSync(tmp, 'wx', 0o600);
    try {
      fs.writeFileSync(fd, JSON.stringify(renewed, null, 2), { encoding: 'utf8' });
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, file);
    return { acquired: true, lease: renewed };
  } catch (error: any) {
    try { fs.unlinkSync(`${file}.tmp-${process.pid}`); } catch { /* best effort */ }
    return {
      acquired: false,
      lease: existing,
      error: `The workspace lease could not be renewed (${error?.message || 'unknown error'}).`,
    };
  }
}

/** Release the lease, but only when this instance owns it. */
export function releaseWorkspaceLease(options: Pick<LeaseOptions, 'root' | 'ownerId'>): { released: boolean; error?: string } {
  const file = workspaceLeasePath(options.root);
  const existing = readLeaseFile(file);
  if (!existing) return { released: true };
  if (existing.ownerId !== options.ownerId) return { released: false, error: 'The workspace lease belongs to another instance.' };
  try {
    fs.unlinkSync(file);
    return { released: true };
  } catch (error: any) {
    if (error?.code === 'ENOENT') return { released: true };
    return { released: false, error: error?.message || 'The workspace lease could not be released.' };
  }
}
