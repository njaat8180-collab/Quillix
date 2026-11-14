/**
 * Auto-run project checks after a save (M3.4).
 *
 * Pure planning + pacing logic only: the runtime in
 * `src/server/autoTestRunner.ts` executes the resolved command. The command can
 * ONLY ever be a script that already exists in the workspace's own
 * package.json (`test` or `lint`) — no user string is ever executed, so this
 * stays a reviewable, bounded convenience and never a shell injection surface.
 *
 * Default posture is OFF: running a project's test suite on every save is
 * surprising and expensive, so it is strictly opt-in from the Build & Tests
 * panel. Offline Mode additionally suppresses runs, because `npm run` may reach
 * the network to install dependencies.
 */

export const AUTO_TEST_DEBOUNCE_MS = 1500;
/** Minimum gap between two automatic runs, even across different files. */
export const AUTO_TEST_MIN_GAP_MS = 4000;
/** Repeated saves of the SAME file inside this window do not re-trigger, even
 *  after the minimum gap: rapid successive saves of one file are one edit. */
export const AUTO_TEST_SAME_FILE_WINDOW_MS = 10_000;

export interface AutoTestCommand {
  /** Manifest script name that was resolved: 'lint' or 'test'. */
  script: 'lint' | 'test';
  label: string;
  /** Full argv (no shell): [nodePath, npmCliPath, 'run', script]. */
  argv: string[];
}

/** Pick the fastest safe project check from the workspace's own package.json.
 *  Prefers `lint` (fast, deterministic) over `test`; never invents commands.
 *  npm runs through this Node executable, so no shell or .cmd is involved. */
export function pickAutoTestCommand(packageJson: unknown, nodePath = process.execPath, npmCliPath = 'npm-cli.js'): AutoTestCommand | null {
  const scripts = (packageJson && typeof packageJson === 'object'
    ? (packageJson as { scripts?: unknown }).scripts
    : null) as Record<string, unknown> | null;
  if (!scripts || typeof scripts !== 'object') return null;
  const hasScript = (name: 'lint' | 'test') => typeof scripts[name] === 'string' && (scripts[name] as string).trim().length > 0;
  if (hasScript('lint')) return { script: 'lint', label: 'npm run lint', argv: [nodePath, npmCliPath, 'run', 'lint'] };
  if (hasScript('test')) return { script: 'test', label: 'npm test', argv: [nodePath, npmCliPath, 'run', 'test'] };
  return null;
}

export interface AutoTestPlan {
  enabled: boolean;
  command: AutoTestCommand | null;
  /** Present when auto-run is unavailable; shown honestly in the UI. */
  reason?: string;
}

export function resolveAutoTestPlan(input: {
  enabled: boolean;
  offlineMode: boolean;
  packageJson: unknown;
  nodePath?: string;
  npmCliPath?: string;
}): AutoTestPlan {
  if (!input.enabled) return { enabled: false, command: null, reason: 'Auto-run on save is off. Turn it on in Build & Tests.' };
  const command = pickAutoTestCommand(input.packageJson, input.nodePath, input.npmCliPath);
  if (!command) {
    return {
      enabled: true,
      command: null,
      reason: 'No runnable check found: this project has no package.json "lint" or "test" script.',
    };
  }
  if (input.offlineMode) {
    return {
      enabled: true,
      command,
      reason: 'Offline Mode is on, so automatic runs are paused (npm may need the network). Run checks manually instead.',
    };
  }
  return { enabled: true, command };
}

export interface AutoTestPacingState {
  at: number;
  filePath: string;
}

/** Debounce + same-file dedupe: true when this save should schedule a run. */
export function autoTestShouldRun(
  last: AutoTestPacingState | null,
  now: number,
  filePath: string,
  debounceMs: number = AUTO_TEST_DEBOUNCE_MS,
): boolean {
  if (!last) return true;
  if (now - last.at < AUTO_TEST_MIN_GAP_MS) return false;
  if (last.filePath === filePath && now - last.at < AUTO_TEST_SAME_FILE_WINDOW_MS) return false;
  return now - last.at >= debounceMs;
}

export interface AutoTestRunSummary {
  ok: boolean;
  exitCode: number | null;
  durationMs: number;
  triggeredBy: 'save' | 'manual';
  filePath?: string;
  stdoutTail: string;
  stderrTail: string;
  timedOut: boolean;
}

/** Bounded, display-safe summary of one run (never grows without limit). */
export function summarizeAutoTestRun(input: {
  exitCode: number | null;
  durationMs: number;
  triggeredBy: 'save' | 'manual';
  filePath?: string;
  stdout?: string;
  stderr?: string;
  timedOut?: boolean;
  maxChars?: number;
}): AutoTestRunSummary {
  const maxChars = Math.max(200, Math.min(20_000, Math.floor(input.maxChars ?? 4000)));
  const tail = (value: string | undefined) => {
    const text = String(value || '').replace(/\r/g, '');
    if (text.length <= maxChars) return text;
    // Exactly maxChars total: truncation marker + the newest maxChars-1 chars.
    return '\u2026' + text.slice(text.length - (maxChars - 1));
  };
  return {
    ok: input.exitCode === 0 && !input.timedOut,
    exitCode: input.exitCode,
    durationMs: Math.max(0, Math.floor(input.durationMs)),
    triggeredBy: input.triggeredBy,
    ...(input.filePath ? { filePath: input.filePath } : {}),
    stdoutTail: tail(input.stdout),
    stderrTail: tail(input.stderr),
    timedOut: Boolean(input.timedOut),
  };
}

/** One-line status for the panel header, e.g. "npm run lint · last run passed". */
export function formatAutoTestLabel(command: AutoTestCommand | null, last: AutoTestRunSummary | null): string {
  const base = command ? command.label : 'auto-run';
  if (!last) return base;
  return `${base} · last run ${last.ok ? 'passed' : 'failed'}`;
}
