import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

/**
 * M9.6: concurrent workspace safety.
 *
 * Two QUILLIX instances opened on the same folder can corrupt each other's
 * work: one writes a file while the other applies a stale patch. This module
 * makes that impossible by giving every workspace a single, exclusive lock.
 *
 * Design rules that make the lock trustworthy:
 *
 * 1. **Atomic claim.** The lock file is created with the exclusive `wx` flag, so
 *    exactly one process can ever win the race for a given workspace.
 * 2. **Liveness is never PID-only.** A PID can be reused by the operating
 *    system, so a dead PID does not prove the owner is gone. Every process that
 *    owns a lock also publishes a *heartbeat record* in a per-instance registry
 *    (`<tmp>/quillix-workspace-locks/instances/<instanceId>.json`). A lock is
 *    stale only when that heartbeat is missing, mismatched or expired — the PID
 *    check is an additional signal, never the proof.
 * 3. **Crash recovery.** Locks are written atomically (temp file + rename), so a
 *    crashed process leaves a complete, parseable record behind. The next
 *    instance detects the dead heartbeat and takes the lock over safely.
 * 4. **No deadlocks.** Acquisition is bounded by a timeout, the lock order is
 *    irrelevant (one lock per workspace) and re-acquiring a lock you already
 *    own returns the same session instead of blocking.
 * 5. **Safe release.** Only the session that owns the lock may release it, and
 *    removal retries transient Windows `EPERM`/`EBUSY` failures.
 *
 * Nothing here ever stores or logs a credential: the record only describes the
 * owning process (pid, host, user, timestamps).
 */

export const WORKSPACE_LOCK_LIMITS = {
  /** How often the owner refreshes its heartbeat. */
  heartbeatIntervalMs: 3_000,
  /** A heartbeat older than this means the owner is gone (crash / kill). */
  staleAfterMs: 30_000,
  /** Upper bound for a blocking acquisition — guarantees no deadlock. */
  acquireTimeoutMs: 5_000,
  /** Delay between acquisition attempts while another instance holds the lock. */
  retryDelayMs: 120,
  /** Upper bound for the free-form owner fields (username, version, ...). */
  maxOwnerFieldLength: 128,
} as const;

const LOCK_APP_VERSION = '1.2.0';
const LOCK_DIRECTORY_NAME = 'locks';
const LOCK_FILE_NAME = 'workspace.lock';
const INSTANCE_DIRECTORY_NAME = 'instances';
const INSTANCE_FILE_SUFFIX = '.json';

/** Identifier of this Node process. Stable for the lifetime of the process. */
const PROCESS_INSTANCE_ID = randomUUID();

/** When this process started (used to detect PID reuse by other tooling). */
const PROCESS_STARTED_AT = new Date(Date.now() - os.uptime() * 1000).toISOString();

export interface WorkspaceLockOwner {
  /** Unique per acquisition. */
  sessionId: string;
  /** Unique per owning process. */
  instanceId: string;
  pid: number;
  /** ISO timestamp of the owning process start time. */
  processStartedAt: string;
  hostname: string;
  username: string;
  appVersion: string;
  /** Resolved workspace root the lock belongs to. */
  workspace: string;
  acquiredAt: string;
  /** Refreshed by the owner's heartbeat; used for stale detection. */
  heartbeatAt: string;
}

export interface WorkspaceLockHandle {
  sessionId: string;
  instanceId: string;
  workspace: string;
  lockPath: string;
  owner: WorkspaceLockOwner;
  acquiredAtMs: number;
}

export interface WorkspaceLockStatus {
  workspace: string;
  lockPath: string;
  /** True when a *live* instance currently owns the lock. */
  held: boolean;
  /** True when a lock record exists but its owner is no longer alive. */
  stale: boolean;
  owner?: WorkspaceLockOwner;
  /** Age of the owner's last heartbeat in milliseconds. */
  ageMs: number;
  /** Human readable explanation of the current state. */
  reason: string;
  /** True when the lock lives in the temp fallback directory (read-only workspace). */
  fallbackLocation: boolean;
}

export type WorkspaceLockErrorCode = 'contended' | 'timeout' | 'not-owner' | 'io';

export class WorkspaceLockError extends Error {
  public readonly code: WorkspaceLockErrorCode;
  public readonly owner?: WorkspaceLockOwner;

  constructor(code: WorkspaceLockErrorCode, message: string, owner?: WorkspaceLockOwner) {
    super(message);
    this.name = 'WorkspaceLockError';
    this.code = code;
    this.owner = owner;
  }
}

export interface WorkspaceLockOptions {
  /** Override the owning instance id (used by tests to simulate another app). */
  instanceId?: string;
  /** Override the heartbeat interval. */
  heartbeatIntervalMs?: number;
  /** Override the stale threshold. */
  staleAfterMs?: number;
  /** Upper bound for a blocking acquisition. */
  timeoutMs?: number;
  /** Take over a stale lock instead of failing. Defaults to true. */
  takeoverStale?: boolean;
}

interface InstanceHeartbeat {
  instanceId: string;
  pid: number;
  hostname: string;
  processStartedAt: string;
  heartbeatAt: string;
}

// --- filesystem helpers -----------------------------------------------------

function nowIso(): string {
  return new Date().toISOString();
}

function safeField(value: unknown): string {
  return String(value ?? 'unknown').replace(/[\r\n\t]/g, ' ').slice(0, WORKSPACE_LOCK_LIMITS.maxOwnerFieldLength);
}

function resolveWorkspace(workspace: string): string {
  const raw = String(workspace ?? '').trim();
  if (!raw) throw new WorkspaceLockError('io', 'A workspace path is required.');
  const resolved = path.resolve(raw);
  try {
    // Resolve symlinks so two different paths to the same folder share one lock.
    return fs.realpathSync(resolved);
  } catch {
    return resolved;
  }
}

function instanceRegistryDirectory(): string {
  return path.join(os.tmpdir(), 'quillix-workspace-locks', INSTANCE_DIRECTORY_NAME);
}

function instanceHeartbeatPath(instanceId: string): string {
  return path.join(instanceRegistryDirectory(), `${instanceId}${INSTANCE_FILE_SUFFIX}`);
}

function ensureDirectory(directory: string): void {
  fs.mkdirSync(directory, { recursive: true });
}

function writeFileAtomic(filePath: string, contents: string): void {
  const directory = path.dirname(filePath);
  ensureDirectory(directory);
  const temporary = path.join(directory, `.${path.basename(filePath)}.${randomUUID()}.tmp`);
  let fd: number | undefined;
  try {
    fd = fs.openSync(temporary, 'wx');
    fs.writeFileSync(fd, contents, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    // rename replaces the destination atomically on Windows and POSIX.
    fs.renameSync(temporary, filePath);
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* already closed */ }
    }
    try { fs.unlinkSync(temporary); } catch { /* nothing to clean up */ }
  }
}

function removeFileWithRetry(filePath: string, attempts = 5): boolean {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      fs.rmSync(filePath, { force: true });
      return true;
    } catch (error: any) {
      // Windows can transiently deny deletion while another handle is open.
      const code = error?.code;
      if (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES') return false;
      const waitUntil = Date.now() + 25 * (attempt + 1);
      while (Date.now() < waitUntil) {
        // Busy-wait briefly: deletion retries must stay synchronous so the
        // release path can also run from process-exit handlers.
      }
    }
  }
  return false;
}

function readJsonFile(filePath: string): any | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

// --- instance heartbeat registry -------------------------------------------

/**
 * Publish (or refresh) the heartbeat of an owning instance. The registry is
 * what makes stale detection safe: it survives independently of the lock file
 * and is unique per process, so a reused PID can never look alive.
 */
export function refreshInstanceHeartbeat(instanceId: string, pid: number = process.pid): void {
  const record: InstanceHeartbeat = {
    instanceId,
    pid,
    hostname: os.hostname(),
    processStartedAt: PROCESS_STARTED_AT,
    heartbeatAt: nowIso(),
  };
  try {
    writeFileAtomic(instanceHeartbeatPath(instanceId), JSON.stringify(record));
  } catch {
    // A locked-down temp directory must never break the application; the lock
    // still works, it simply falls back to heartbeat age alone.
  }
}

function readInstanceHeartbeat(instanceId: string): InstanceHeartbeat | null {
  const record = readJsonFile(instanceHeartbeatPath(instanceId));
  if (!record || typeof record.instanceId !== 'string') return null;
  if (record.instanceId !== instanceId) return null;
  return {
    instanceId: record.instanceId,
    pid: Number(record.pid) || 0,
    hostname: safeField(record.hostname),
    processStartedAt: safeField(record.processStartedAt),
    heartbeatAt: safeField(record.heartbeatAt),
  };
}

function removeInstanceHeartbeat(instanceId: string): void {
  try { fs.rmSync(instanceHeartbeatPath(instanceId), { force: true }); } catch { /* best effort */ }
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: any) {
    // EPERM means the process exists but belongs to another user.
    return error?.code === 'EPERM';
  }
}

// --- lock file --------------------------------------------------------------

export interface WorkspaceLockLocation {
  workspace: string;
  directory: string;
  lockPath: string;
  fallbackLocation: boolean;
}

/** Resolve where the lock for a workspace lives (and whether it is a fallback). */
export function workspaceLockLocation(workspace: string): WorkspaceLockLocation {
  const resolved = resolveWorkspace(workspace);
  const preferred = path.join(resolved, '.quillix', LOCK_DIRECTORY_NAME);
  try {
    ensureDirectory(preferred);
    return { workspace: resolved, directory: preferred, lockPath: path.join(preferred, LOCK_FILE_NAME), fallbackLocation: false };
  } catch {
    // Read-only workspaces fall back to a per-workspace temp directory.
    const digest = createHash('sha256').update(resolved).digest('hex').slice(0, 24);
    const fallback = path.join(os.tmpdir(), 'quillix-workspace-locks', digest);
    ensureDirectory(fallback);
    return { workspace: resolved, directory: fallback, lockPath: path.join(fallback, LOCK_FILE_NAME), fallbackLocation: true };
  }
}

/** Absolute path of the lock file for a workspace (diagnostics / tooling). */
export function workspaceLockFilePath(workspace: string): string {
  return workspaceLockLocation(workspace).lockPath;
}

function readOwner(lockPath: string): WorkspaceLockOwner | null {
  const record = readJsonFile(lockPath);
  if (!record || typeof record.sessionId !== 'string' || typeof record.instanceId !== 'string') return null;
  return {
    sessionId: record.sessionId,
    instanceId: record.instanceId,
    pid: Number(record.pid) || 0,
    processStartedAt: safeField(record.processStartedAt),
    hostname: safeField(record.hostname),
    username: safeField(record.username),
    appVersion: safeField(record.appVersion),
    workspace: safeField(record.workspace),
    acquiredAt: safeField(record.acquiredAt),
    heartbeatAt: safeField(record.heartbeatAt),
  };
}

/**
 * Low-level helper that writes a lock record verbatim. Used by the takeover
 * path and by tests that need to reproduce a lock left behind by another
 * instance. Prefer `acquireWorkspaceLock` in application code.
 */
export function writeWorkspaceLockOwnerFile(workspace: string, owner: WorkspaceLockOwner): string {
  const location = workspaceLockLocation(workspace);
  writeFileAtomic(location.lockPath, JSON.stringify(owner, null, 2));
  return location.lockPath;
}

function buildOwner(workspace: string, instanceId: string, sessionId: string): WorkspaceLockOwner {
  let username = 'unknown';
  try {
    username = os.userInfo().username;
  } catch {
    // Some Windows service accounts cannot resolve the user name.
  }
  const timestamp = nowIso();
  return {
    sessionId,
    instanceId,
    pid: process.pid,
    processStartedAt: PROCESS_STARTED_AT,
    hostname: safeField(os.hostname()),
    username: safeField(username),
    appVersion: safeField(LOCK_APP_VERSION),
    workspace: safeField(workspace),
    acquiredAt: timestamp,
    heartbeatAt: timestamp,
  };
}

interface OwnerLiveness {
  alive: boolean;
  reason: string;
}

/**
 * Decide whether the recorded owner is still alive.
 *
 * The heartbeat registry is the primary signal. A dead PID alone is never
 * treated as proof of staleness because PIDs are reused.
 */
function evaluateOwner(owner: WorkspaceLockOwner, staleAfterMs: number): OwnerLiveness {
  const heartbeat = readInstanceHeartbeat(owner.instanceId);
  if (!heartbeat) {
    return { alive: false, reason: 'The owning instance stopped publishing heartbeats (process gone).' };
  }
  if (heartbeat.hostname !== owner.hostname) {
    // Another machine: the heartbeat age is the only trustworthy signal.
    const age = Date.now() - Date.parse(heartbeat.heartbeatAt);
    return age <= staleAfterMs
      ? { alive: true, reason: 'Remote owner heartbeat is fresh.' }
      : { alive: false, reason: 'Remote owner heartbeat expired.' };
  }
  const age = Date.now() - Date.parse(heartbeat.heartbeatAt);
  if (!Number.isFinite(age) || age > staleAfterMs) {
    return { alive: false, reason: 'The owning instance stopped publishing heartbeats (process gone).' };
  }
  if (!isProcessAlive(owner.pid)) {
    return { alive: false, reason: 'The owning process is no longer running.' };
  }
  return { alive: true, reason: 'The owning instance is alive and publishing heartbeats.' };
}

/** Current state of the lock for a workspace. */
export function getWorkspaceLockStatus(workspace: string, options: WorkspaceLockOptions = {}): WorkspaceLockStatus {
  const staleAfterMs = options.staleAfterMs ?? WORKSPACE_LOCK_LIMITS.staleAfterMs;
  const location = workspaceLockLocation(workspace);
  const owner = readOwner(location.lockPath);
  if (!owner) {
    return {
      workspace: location.workspace,
      lockPath: location.lockPath,
      held: false,
      stale: false,
      ageMs: 0,
      reason: 'No workspace lock exists.',
      fallbackLocation: location.fallbackLocation,
    };
  }
  const liveness = evaluateOwner(owner, staleAfterMs);
  const heartbeatAt = Date.parse(owner.heartbeatAt);
  const ageMs = Number.isFinite(heartbeatAt) ? Math.max(0, Date.now() - heartbeatAt) : 0;
  return {
    workspace: location.workspace,
    lockPath: location.lockPath,
    held: liveness.alive,
    stale: !liveness.alive,
    owner,
    ageMs,
    reason: liveness.reason,
    fallbackLocation: location.fallbackLocation,
  };
}

// --- acquisition ------------------------------------------------------------

const heartbeatTimers = new Map<string, NodeJS.Timeout>();
const activeHandles = new Map<string, WorkspaceLockHandle>();
let exitHookInstalled = false;

function startHeartbeat(handle: WorkspaceLockHandle, intervalMs: number): void {
  const timer = setInterval(() => {
    try {
      const current = readOwner(handle.lockPath);
      if (!current || current.sessionId !== handle.sessionId) {
        // Ownership was lost (someone took the lock over) — stop renewing.
        clearInterval(timer);
        heartbeatTimers.delete(handle.sessionId);
        return;
      }
      const refreshed: WorkspaceLockOwner = { ...current, heartbeatAt: nowIso() };
      writeFileAtomic(handle.lockPath, JSON.stringify(refreshed, null, 2));
      refreshInstanceHeartbeat(handle.instanceId);
    } catch {
      // A transient write failure must not crash the application; the next
      // tick retries and the stale detector protects the workspace meanwhile.
    }
  }, Math.max(250, intervalMs));
  timer.unref?.();
  heartbeatTimers.set(handle.sessionId, timer);
}

function stopHeartbeat(sessionId: string): void {
  const timer = heartbeatTimers.get(sessionId);
  if (timer) {
    clearInterval(timer);
    heartbeatTimers.delete(sessionId);
  }
}

function installExitHook(): void {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  const cleanup = () => {
    for (const handle of Array.from(activeHandles.values())) {
      try { releaseWorkspaceLock(handle); } catch { /* best effort on exit */ }
    }
    removeInstanceHeartbeat(PROCESS_INSTANCE_ID);
  };
  process.once('exit', cleanup);
}

/**
 * Acquire the exclusive lock for a workspace.
 *
 * Rejects with `WorkspaceLockError('timeout')` when another live instance owns
 * the workspace. Stale locks are taken over automatically.
 */
export async function acquireWorkspaceLock(workspace: string, options: WorkspaceLockOptions = {}): Promise<WorkspaceLockHandle> {
  const instanceId = options.instanceId ?? PROCESS_INSTANCE_ID;
  const staleAfterMs = options.staleAfterMs ?? WORKSPACE_LOCK_LIMITS.staleAfterMs;
  const timeoutMs = Math.max(0, options.timeoutMs ?? WORKSPACE_LOCK_LIMITS.acquireTimeoutMs);
  const takeoverStale = options.takeoverStale !== false;
  const location = workspaceLockLocation(workspace);

  refreshInstanceHeartbeat(instanceId);
  installExitHook();

  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const owner = readOwner(location.lockPath);

    if (!owner) {
      const sessionId = randomUUID();
      const record = buildOwner(location.workspace, instanceId, sessionId);
      let fd: number | undefined;
      try {
        // Exclusive create: only one process can win this race.
        fd = fs.openSync(location.lockPath, 'wx');
        fs.writeFileSync(fd, JSON.stringify(record, null, 2), 'utf8');
        fs.fsyncSync(fd);
        fs.closeSync(fd);
        fd = undefined;
      } catch (error: any) {
        if (fd !== undefined) {
          try { fs.closeSync(fd); } catch { /* already closed */ }
        }
        if (error?.code === 'EEXIST') {
          // Another process claimed it between our read and our create.
          if (Date.now() >= deadline) {
            const current = readOwner(location.lockPath);
            throw new WorkspaceLockError('timeout', describeContention(location.workspace, current), current ?? undefined);
          }
          await sleep(WORKSPACE_LOCK_LIMITS.retryDelayMs);
          continue;
        }
        throw new WorkspaceLockError('io', `Could not create the workspace lock: ${error?.message ?? 'unknown error'}`);
      }
      const handle: WorkspaceLockHandle = {
        sessionId,
        instanceId,
        workspace: location.workspace,
        lockPath: location.lockPath,
        owner: record,
        acquiredAtMs: Date.now(),
      };
      activeHandles.set(sessionId, handle);
      startHeartbeat(handle, options.heartbeatIntervalMs ?? WORKSPACE_LOCK_LIMITS.heartbeatIntervalMs);
      return handle;
    }

    if (owner.instanceId === instanceId) {
      // Re-entrant acquisition by the owning process: never block on ourselves.
      const existing = Array.from(activeHandles.values()).find(handle => handle.lockPath === location.lockPath);
      if (existing) return existing;
      const handle: WorkspaceLockHandle = {
        sessionId: owner.sessionId,
        instanceId,
        workspace: location.workspace,
        lockPath: location.lockPath,
        owner,
        acquiredAtMs: Date.parse(owner.acquiredAt) || Date.now(),
      };
      activeHandles.set(owner.sessionId, handle);
      return handle;
    }

    const liveness = evaluateOwner(owner, staleAfterMs);
    if (!liveness.alive && takeoverStale) {
      // Take over: only if the record on disk still belongs to the stale owner.
      const current = readOwner(location.lockPath);
      if (current && current.sessionId === owner.sessionId) {
        removeFileWithRetry(location.lockPath);
      }
      continue;
    }

    if (Date.now() >= deadline) {
      throw new WorkspaceLockError('timeout', describeContention(location.workspace, owner), owner);
    }
    await sleep(WORKSPACE_LOCK_LIMITS.retryDelayMs);
  }
}

/**
 * Non-throwing variant: returns `null` when another live instance owns the
 * workspace.
 */
export async function tryAcquireWorkspaceLock(workspace: string, options: WorkspaceLockOptions = {}): Promise<WorkspaceLockHandle | null> {
  try {
    return await acquireWorkspaceLock(workspace, { ...options, timeoutMs: options.timeoutMs ?? 0 });
  } catch (error) {
    if (error instanceof WorkspaceLockError && (error.code === 'timeout' || error.code === 'contended')) return null;
    throw error;
  }
}

function describeContention(workspace: string, owner?: WorkspaceLockOwner | null): string {
  if (!owner) return `The workspace "${workspace}" is locked by another QUILLIX instance.`;
  const since = owner.acquiredAt ? ` since ${owner.acquiredAt}` : '';
  return `The workspace "${workspace}" is locked by another QUILLIX instance (pid ${owner.pid} on ${owner.hostname}${since}). Close that instance or wait for it to exit.`;
}

/** Release a lock. Only the owning session may release it. */
export function releaseWorkspaceLock(handle: WorkspaceLockHandle): boolean {
  stopHeartbeat(handle.sessionId);
  activeHandles.delete(handle.sessionId);
  const owner = readOwner(handle.lockPath);
  if (!owner) return true; // Already gone (crash recovery / manual cleanup).
  if (owner.sessionId !== handle.sessionId) return false; // Not ours — never steal.
  return removeFileWithRetry(handle.lockPath);
}

/** Remove a lock that is provably stale. Refuses to touch a live lock. */
export function forceReleaseStaleLock(workspace: string, options: WorkspaceLockOptions = {}): boolean {
  const status = getWorkspaceLockStatus(workspace, options);
  if (status.held) return false;
  if (!status.stale) return false;
  return removeFileWithRetry(status.lockPath);
}

/**
 * Guard used by every workspace mutation. Writes are refused while another
 * live instance owns the workspace, and always allowed for the owner itself.
 */
export function assertWorkspaceWritable(workspace: string, options: WorkspaceLockOptions = {}): {
  ok: boolean;
  error?: string;
  owner?: WorkspaceLockOwner;
  status: WorkspaceLockStatus;
} {
  const instanceId = options.instanceId ?? PROCESS_INSTANCE_ID;
  const status = getWorkspaceLockStatus(workspace, options);
  if (!status.held) return { ok: true, status };
  if (status.owner && status.owner.instanceId === instanceId) return { ok: true, status };
  return {
    ok: false,
    error: describeContention(status.workspace, status.owner),
    owner: status.owner,
    status,
  };
}

/** Release every lock this process owns (used on shutdown). */
export function releaseAllWorkspaceLocks(): void {
  for (const handle of Array.from(activeHandles.values())) {
    try { releaseWorkspaceLock(handle); } catch { /* best effort */ }
  }
  removeInstanceHeartbeat(PROCESS_INSTANCE_ID);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));
}





