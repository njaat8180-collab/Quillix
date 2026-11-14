/**
 * Process-level fault reporting.
 *
 * Two very different failure classes are handled here, and they must NOT
 * share the same policy:
 *
 * 1. **Unhandled promise rejection** — a promise was never awaited, but the
 *    surrounding application state is still well defined. The server can
 *    report the fault with a stack and keep serving. A stray rejection in a
 *    background task (a provider poll, a file watcher, a test runner) must
 *    not take down the whole desktop session.
 *
 * 2. **Uncaught exception** — the process was in an *undefined* state when
 *    the throw happened. Continuing to serve requests, watchers and agent
 *    tasks from that state risks silent data corruption: a half-written
 *    file, a half-applied patch, or a half-updated workspace index. Node's
 *    own default is to terminate for exactly this reason.
 *
 * Therefore uncaught exceptions are **fatal by default**: the fault is
 * reported with a stack, an optional graceful-shutdown hook runs (so the
 * server can stop listeners, kill terminal children and close watchers),
 * and only then does the process exit with a non-zero code.
 *
 * The Electron main process uses the same module so both sides of the app
 * report faults consistently, but each side chooses its own shutdown hook.
 *
 * The handlers are installed at most once per process.
 */
export interface FaultReporterOptions {
  /** Prefix used in the log line, e.g. `[quillix] [server]`. */
  label?: string;
  /** Sink for the formatted fault. Defaults to `console.error`. */
  log?: (message: string, error?: unknown) => void;
  /**
   * Graceful cleanup run *before* the process exits after an uncaught
   * exception. It must be synchronous or return a promise that is awaited
   * with a hard timeout, because the process is about to die.
   *
   * Use this to stop listeners, kill child processes and close watchers so
   * the exit does not leave orphaned resources behind.
   */
  onFatalError?: (error: unknown) => void | Promise<void>;
  /**
   * How long to wait for {@link FaultReporterOptions.onFatalError} before
   * exiting anyway. Defaults to 3000 ms.
   */
  fatalCleanupTimeoutMs?: number;
  /**
   * Exit code used after an uncaught exception. Defaults to 1.
   */
  fatalExitCode?: number;
  /**
   * Terminates the process after a fatal fault. Defaults to `process.exit`.
   * Injectable so the policy can be unit-tested without killing the runner.
   */
  exit?: (code: number) => void;
}

let installed = false;

/** Format an unknown throwable into a single log line with a stack. */
export function formatFault(label: string, kind: string, reason: unknown): string {
  const suffix = reason instanceof Error ? (reason.stack ?? reason.message) : String(reason);
  return `${label} ${kind}: ${suffix}`;
}

/**
 * Install the process-level fault handlers.
 *
 * Safe to call more than once — only the first call installs the handlers.
 * Returns a function that removes them again (used by tests).
 *
 * Policy:
 * - `unhandledRejection` → report and keep serving.
 * - `uncaughtException` → report, run the fatal cleanup hook, then exit.
 */
export function installFaultReporter(options: FaultReporterOptions = {}): () => void {
  const label = options.label ?? '[quillix]';
  const log = options.log ?? ((message: string, error?: unknown) => console.error(message, error ?? ''));
  const fatalCleanupTimeoutMs = Math.max(0, options.fatalCleanupTimeoutMs ?? 3000);
  const fatalExitCode = options.fatalExitCode ?? 1;
  const terminate = options.exit ?? ((code: number) => process.exit(code));

  if (installed) return () => {};
  installed = true;

  const onUnhandledRejection = (reason: unknown) => {
    // Report, but keep serving: one stray rejection in a background task must
    // not take down the whole desktop session. The application state is still
    // well defined here, unlike an uncaught exception.
    log(formatFault(label, 'unhandled rejection', reason));
  };

  // Shared across every uncaught exception: once the fatal path has been
  // triggered the process is dying, so the cleanup hook must run only once
  // and the exit must not be scheduled twice.
  let exiting = false;

  const onUncaughtException = (error: unknown) => {
    // FATAL by default. An uncaught exception leaves the process in an
    // undefined state — continuing to serve requests, watchers and agent
    // tasks from here risks silent data corruption (partially written
    // files, half-applied patches, a half-updated workspace index).
    log(formatFault(label, 'uncaught exception', error));

    if (exiting) return;

    const finish = () => {
      if (exiting) return;
      exiting = true;
      terminate(fatalExitCode);
    };

    const cleanup = options.onFatalError;
    if (!cleanup) {
      finish();
      return;
    }

    try {
      const result = cleanup(error);
      if (result && typeof (result as Promise<void>).then === 'function') {
        // Hard timeout: a hung cleanup must not prevent the exit.
        const timer = setTimeout(finish, fatalCleanupTimeoutMs);
        timer.unref?.();
        (result as Promise<void>).then(
          () => { clearTimeout(timer); finish(); },
          (cleanupError: unknown) => {
            clearTimeout(timer);
            log(formatFault(label, 'fatal cleanup failed', cleanupError));
            finish();
          },
        );
        return;
      }
      finish();
    } catch (cleanupError) {
      log(formatFault(label, 'fatal cleanup failed', cleanupError));
      finish();
    }
  };

  process.on('unhandledRejection', onUnhandledRejection);
  process.on('uncaughtException', onUncaughtException);

  return () => {
    process.off('unhandledRejection', onUnhandledRejection);
    process.off('uncaughtException', onUncaughtException);
    installed = false;
  };
}
