/**
 * NUVRO AI — bounded desktop shutdown.
 *
 * Hardening rationale
 * -------------------
 * The desktop app spawns the NUVRO AI server as a child process. On quit the
 * old code called `child.kill()` once and returned. That is unbounded:
 *
 *   - `child.kill()` asks the child to stop. A child that is mid-write, stuck
 *     on a socket, or holding an open handle can ignore it, and Electron then
 *     waits for a process that is never going to exit. The user sees a window
 *     that refuses to close.
 *   - There was no escalation, so a child that ignored the graceful request
 *     stayed alive forever.
 *   - There was no deadline, so "the app will not quit" was possible.
 *
 * This module makes the shutdown bounded and observable:
 *
 *   1. Ask the child to stop (SIGTERM / `SIGTERM`).
 *   2. If it has not exited within the grace window, escalate to SIGKILL.
 *   3. If it still has not exited within the force window, report `timedOut`
 *      so the caller can hard-exit the app instead of hanging.
 *
 * The clock and the exit probe are injectable, so the behaviour can be proven
 * by tests in milliseconds instead of by waiting on a real process.
 */

/** The part of a child process this module needs. */
export interface ShutdownChild {
  kill(signal?: NodeJS.Signals | number): boolean;
  /** `null` while the child is running, a number once it has exited. */
  readonly exitCode?: number | null;
  readonly killed?: boolean;
}

export interface BoundedShutdownOptions {
  /** How long the child may take to exit after the graceful request. */
  graceMs?: number;
  /** How long the child may take to exit after the forced kill. */
  forceMs?: number;
  /** How often the exit state is re-checked while waiting. */
  pollMs?: number;
  /** Injectable wait, so tests do not spend real time. */
  wait?: (ms: number) => Promise<void>;
  /** Injectable exit probe, so tests can drive the state machine. */
  hasExited?: (child: ShutdownChild) => boolean;
  /** Optional log sink. */
  onLog?: (message: string) => void;
}

export interface BoundedShutdownResult {
  /** True when the child is gone. */
  exited: boolean;
  /** True when the forced kill was needed. */
  escalated: boolean;
  /** True when the child outlived both windows and had to be abandoned. */
  timedOut: boolean;
  /** The signals that were sent, in order. */
  signals: string[];
}

const DEFAULT_GRACE_MS = 3_000;
const DEFAULT_FORCE_MS = 1_500;
const DEFAULT_POLL_MS = 50;

function defaultHasExited(child: ShutdownChild): boolean {
  return child.exitCode !== undefined && child.exitCode !== null;
}

function defaultWait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Wait for the child to exit, polling on a fixed slice. The slice loop (rather
 * than a single sleep) means a child that exits promptly is noticed promptly,
 * and it keeps the wait deterministic when `wait` is injected.
 */
async function waitForExit(
  child: ShutdownChild,
  windowMs: number,
  hasExited: (child: ShutdownChild) => boolean,
  wait: (ms: number) => Promise<void>,
  pollMs: number,
): Promise<boolean> {
  if (hasExited(child)) return true;
  let waited = 0;
  while (waited < windowMs) {
    const slice = Math.min(pollMs, windowMs - waited);
    await wait(slice);
    waited += slice;
    if (hasExited(child)) return true;
  }
  return hasExited(child);
}

/**
 * Stop a child process within a bounded time, escalating if it does not
 * cooperate. Never throws: a shutdown must not fail because a kill failed.
 */
export async function shutdownChildBounded(
  child: ShutdownChild,
  options: BoundedShutdownOptions = {},
): Promise<BoundedShutdownResult> {
  const graceMs = Math.max(0, options.graceMs ?? DEFAULT_GRACE_MS);
  const forceMs = Math.max(0, options.forceMs ?? DEFAULT_FORCE_MS);
  const pollMs = Math.max(1, options.pollMs ?? DEFAULT_POLL_MS);
  const wait = options.wait ?? defaultWait;
  const hasExited = options.hasExited ?? defaultHasExited;
  const log = options.onLog;
  const signals: string[] = [];

  // Already gone: do not send a signal to a dead pid.
  if (hasExited(child)) {
    return { exited: true, escalated: false, timedOut: false, signals };
  }

  signals.push('SIGTERM');
  log?.(`requesting graceful shutdown (SIGTERM), grace ${graceMs}ms`);
  try { child.kill('SIGTERM'); } catch (err: any) { log?.(`graceful shutdown signal failed: ${err?.message || err}`); }

  if (await waitForExit(child, graceMs, hasExited, wait, pollMs)) {
    return { exited: true, escalated: false, timedOut: false, signals };
  }

  // The child ignored the request. Escalate instead of waiting forever.
  signals.push('SIGKILL');
  log?.(`graceful shutdown timed out after ${graceMs}ms; escalating to SIGKILL`);
  try { child.kill('SIGKILL'); } catch (err: any) { log?.(`forced shutdown signal failed: ${err?.message || err}`); }

  const exited = await waitForExit(child, forceMs, hasExited, wait, pollMs);
  if (!exited) {
    log?.(`server process did not exit within ${graceMs + forceMs}ms; the caller must force-exit`);
  }
  return { exited, escalated: true, timedOut: !exited, signals };
}
