import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';

/**
 * M3.6: Git Bisect Assist.
 *
 * The assistant drives `git bisect` on behalf of the user:
 *
 *   - it starts a session from a known-good and a known-bad revision,
 *   - it runs the configured test command at every candidate commit,
 *   - it classifies the result (good / bad / inconclusive),
 *   - it tracks the progress and reports the likely regression-introducing
 *     commit with an explanation,
 *   - it can recover an interrupted session, and
 *   - it always restores the repository to the state it found it in.
 *
 * Safety rules that are enforced in code, not in the UI:
 *
 *   1. The working tree must be clean before a session starts. Uncommitted
 *      work is never stashed, reset or overwritten behind the user's back.
 *   2. The original HEAD and branch are recorded, and `git bisect reset`
 *      restores them when the session ends — including after a failure.
 *   3. No history rewriting ever happens: no reset --hard, no rebase, no
 *      merge, no cherry-pick, no branch deletion, no force push.
 *   4. Every Git invocation is shell-free (`shell: false`) with an argument
 *      array, so a revision can never be interpreted as a shell command.
 *   5. The test command is bounded by a timeout and its output is truncated.
 */

export type BisectClassification = 'good' | 'bad' | 'inconclusive';

export interface BisectTestResult {
  exitCode: number | null;
  timedOut: boolean;
  stdoutTail: string;
  stderrTail: string;
  durationMs: number;
}

export interface BisectStep {
  commit: string;
  short: string;
  subject: string;
  classification: BisectClassification;
  reason: string;
  exitCode: number | null;
  at: string;
}

export interface BisectSession {
  id: string;
  workspace: string;
  good: string;
  bad: string;
  originalHead: string;
  originalBranch: string;
  testCommand: string;
  startedAt: string;
  status: 'running' | 'complete' | 'aborted' | 'failed';
  steps: BisectStep[];
  /** The likely regression-introducing commit (set when complete). */
  culprit?: { commit: string; short: string; subject: string; explanation: string };
  error?: string;
}

export interface BisectProgress {
  active: boolean;
  session: BisectSession | null;
  currentCommit?: string;
  currentShort?: string;
  currentSubject?: string;
  /** How many candidate commits are still untested. */
  remaining: number;
  tested: number;
  /** Rough number of steps a binary search needs for the whole range. */
  estimatedTotal: number;
  message: string;
}

export interface BisectOptions {
  /** Shell command that runs the project's tests. */
  testCommand: string;
  /** Maximum time a single test run may take. */
  timeoutMs?: number;
  /**
   * Extra exit codes that mean "this commit could not be evaluated" (skip).
   * Git's own convention (125) is always included.
   */
  inconclusiveExitCodes?: number[];
  /**
   * Output patterns that mean "this commit could not be evaluated" (skip),
   * for example a build that fails because a dependency is missing.
   */
  inconclusivePatterns?: string[];
}

interface GitResult { exitCode: number; stdout: string; stderr: string }

const DEFAULT_TIMEOUT_MS = 10 * 60_000;
const MAX_OUTPUT_CHARS = 200_000;
const INCONCLUSIVE_EXIT_CODE = 125;

/** Shell-free Git execution: arguments are never interpreted by a shell. */
async function executeGit(cwd: string, args: string[], timeoutMs = 60_000): Promise<GitResult> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let finished = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const finish = (result: GitResult) => {
      if (finished) return;
      finished = true;
      if (timeout) clearTimeout(timeout);
      resolve(result);
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn('git', args, {
        cwd,
        shell: false,
        windowsHide: true,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' },
      });
    } catch (err: any) {
      return finish({ exitCode: 1, stdout, stderr: String(err?.message || err) });
    }
    timeout = setTimeout(() => {
      child.kill('SIGKILL');
      finish({ exitCode: 124, stdout, stderr: `${stderr}\nGit timed out after ${timeoutMs / 1000}s.` });
    }, timeoutMs);
    child.stdout?.on('data', (data: Buffer) => { stdout += data.toString('utf8'); if (stdout.length > MAX_OUTPUT_CHARS) stdout = stdout.slice(-MAX_OUTPUT_CHARS / 2); });
    child.stderr?.on('data', (data: Buffer) => { stderr += data.toString('utf8'); if (stderr.length > MAX_OUTPUT_CHARS) stderr = stderr.slice(-MAX_OUTPUT_CHARS / 2); });
    child.once('error', (err) => finish({ exitCode: 1, stdout, stderr: `${stderr}\n${err.message}` }));
    child.once('close', (code) => finish({ exitCode: code ?? 1, stdout, stderr }));
  });
}

function sessionStorePath(workspace: string): string {
  const digest = createHash('sha256').update(path.resolve(workspace)).digest('hex').slice(0, 24);
  return path.join(os.homedir(), '.quillix', 'bisect', `${digest}.json`);
}

function readSessionFile(workspace: string): BisectSession | null {
  try {
    const file = sessionStorePath(workspace);
    if (!fs.existsSync(file)) return null;
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? (parsed as BisectSession) : null;
  } catch {
    return null;
  }
}

function writeSessionFile(session: BisectSession): void {
  const file = sessionStorePath(session.workspace);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(session, null, 2), { mode: 0o600, flag: 'wx' });
  fs.renameSync(tmp, file);
}

function clearSessionFile(workspace: string): void {
  try { fs.unlinkSync(sessionStorePath(workspace)); } catch (error: any) { if (error?.code !== 'ENOENT') throw error; }
}

/** A revision must look like a revision — never like a shell fragment. */
export function isSafeRevision(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 200) return false;
  if (/[\r\n\0]/.test(trimmed)) return false;
  // Refs, hashes and relative names only. Anything with a space, a leading
  // dash or a shell metacharacter is rejected.
  return /^[A-Za-z0-9][A-Za-z0-9._/@~^{}\-]*$/.test(trimmed);
}

/**
 * Run the configured test command and classify the result.
 *
 * A non-zero exit code means "bad" (the regression reproduces), a zero exit
 * code means "good". The caller can mark additional exit codes and output
 * patterns as inconclusive, which is what a build that cannot even start
 * looks like — it must not be mistaken for a regression.
 */
export async function runBisectTest(
  cwd: string,
  options: BisectOptions,
): Promise<{ result: BisectTestResult; classification: BisectClassification; reason: string }> {
  const command = String(options.testCommand || '').trim();
  if (!command) {
    return {
      result: { exitCode: null, timedOut: false, stdoutTail: '', stderrTail: '', durationMs: 0 },
      classification: 'inconclusive',
      reason: 'No test command is configured.',
    };
  }
  const startedAt = Date.now();
  const outcome = await new Promise<{ exitCode: number | null; timedOut: boolean; stdout: string; stderr: string }>((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let finished = false;
    const timeoutMs = Math.max(1_000, Math.min(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 60 * 60_000));
    let child: ReturnType<typeof spawn>;
    try {
      // The test command is user configured and may contain pipes/redirects,
      // so it is run through the platform shell — but only the *test* command
      // is, never a revision or any other Git input.
      const shell = process.platform === 'win32';
      child = spawn(command, {
        cwd,
        shell,
        windowsHide: true,
        env: { ...process.env, CI: '1', NO_COLOR: '1', FORCE_COLOR: '0' },
      });
    } catch (err: any) {
      return resolve({ exitCode: 1, timedOut: false, stdout, stderr: String(err?.message || err) });
    }
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
      try { if (process.platform === 'win32' && child.pid) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { shell: false, windowsHide: true }); } catch { /* best effort */ }
      if (!finished) {
        finished = true;
        resolve({ exitCode: 124, timedOut: true, stdout, stderr });
      }
    }, timeoutMs);
    child.stdout?.on('data', (data: Buffer) => { stdout += data.toString('utf8'); if (stdout.length > MAX_OUTPUT_CHARS) stdout = stdout.slice(-MAX_OUTPUT_CHARS / 2); });
    child.stderr?.on('data', (data: Buffer) => { stderr += data.toString('utf8'); if (stderr.length > MAX_OUTPUT_CHARS) stderr = stderr.slice(-MAX_OUTPUT_CHARS / 2); });
    child.once('error', (err) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({ exitCode: 1, timedOut: false, stdout, stderr: `${stderr}\n${err.message}` });
    });
    child.once('close', (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({ exitCode: code ?? 1, timedOut, stdout, stderr });
    });
  });

  const result: BisectTestResult = {
    exitCode: outcome.exitCode,
    timedOut: outcome.timedOut,
    stdoutTail: outcome.stdout.slice(-8_000),
    stderrTail: outcome.stderr.slice(-8_000),
    durationMs: Date.now() - startedAt,
  };

  const inconclusiveCodes = new Set<number>([INCONCLUSIVE_EXIT_CODE, ...(options.inconclusiveExitCodes ?? [])]);
  const patterns = (options.inconclusivePatterns ?? []).map(pattern => pattern.toLowerCase()).filter(Boolean);

  if (outcome.timedOut) {
    return { result, classification: 'inconclusive', reason: 'The test run timed out, so this commit could not be evaluated.' };
  }
  if (result.exitCode !== null && inconclusiveCodes.has(result.exitCode)) {
    return { result, classification: 'inconclusive', reason: `The test command exited with ${result.exitCode}, which marks the commit as untestable.` };
  }
  const combined = `${result.stdoutTail}\n${result.stderrTail}`.toLowerCase();
  const matched = patterns.find(pattern => combined.includes(pattern));
  if (matched) {
    return { result, classification: 'inconclusive', reason: `The test output matched "${matched}", so this commit could not be evaluated.` };
  }
  if (result.exitCode === 0) {
    return { result, classification: 'good', reason: 'The test command passed, so this commit does not contain the regression.' };
  }
  return { result, classification: 'bad', reason: `The test command failed with exit code ${result.exitCode}, so this commit reproduces the regression.` };
}

export class GitBisectService {
  /**
   * Start a bisect session.
   *
   * The working tree must be clean: a bisect checks out different commits, so
   * uncommitted work would be carried around (or lost). Instead of touching
   * it, the session is refused and the user is told what to do.
   */
  public async start(
    workspace: string,
    good: string,
    bad: string,
    options: BisectOptions,
  ): Promise<{ success: boolean; session?: BisectSession; error?: string }> {
    const root = path.resolve(workspace);
    if (!isSafeRevision(good) || !isSafeRevision(bad)) {
      return { success: false, error: 'The good and bad revisions must be plain commit references.' };
    }
    if (!String(options.testCommand || '').trim()) {
      return { success: false, error: 'Configure a test command before starting a bisect session.' };
    }
    const repo = await executeGit(root, ['rev-parse', '--is-inside-work-tree']);
    if (repo.exitCode !== 0 || repo.stdout.trim() !== 'true') {
      return { success: false, error: 'This workspace is not a Git repository.' };
    }
    // Refuse to run on top of uncommitted work.
    const status = await executeGit(root, ['status', '--porcelain']);
    if (status.exitCode !== 0) {
      return { success: false, error: 'Could not read the repository status.' };
    }
    if (status.stdout.trim().length > 0) {
      return {
        success: false,
        error: 'The working tree has uncommitted changes. Commit or stash them before starting a bisect session — Quillix never discards your work.',
      };
    }
    // Never nest a session inside another one.
    if (await isBisectActive(root)) {
      return { success: false, error: 'A bisect session is already running in this repository. Finish it first.' };
    }
    const head = await executeGit(root, ['rev-parse', 'HEAD']);
    if (head.exitCode !== 0) return { success: false, error: 'Could not read HEAD.' };
    const branch = await executeGit(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
    const originalHead = head.stdout.trim();
    const originalBranch = branch.exitCode === 0 ? branch.stdout.trim() : 'HEAD';

    // Resolve the revisions to stable commit ids. A relative revision such as
    // "HEAD" would otherwise move while the bisect checks out other commits,
    // which would corrupt the range the session is tracking.
    const resolvedGood = await executeGit(root, ['rev-parse', `${good.trim()}^{commit}`]);
    if (resolvedGood.exitCode !== 0) {
      return { success: false, error: `The known-good revision "${good.trim()}" could not be resolved in this repository.` };
    }
    const resolvedBad = await executeGit(root, ['rev-parse', `${bad.trim()}^{commit}`]);
    if (resolvedBad.exitCode !== 0) {
      return { success: false, error: `The known-bad revision "${bad.trim()}" could not be resolved in this repository.` };
    }
    const goodCommit = resolvedGood.stdout.trim();
    const badCommit = resolvedBad.stdout.trim();
    if (goodCommit === badCommit) {
      return { success: false, error: 'The known-good and known-bad revisions must be different commits.' };
    }

    // `git bisect start <bad> <good>` is atomic: either the session starts or
    // the repository is untouched.
    const start = await executeGit(root, ['bisect', 'start', badCommit, goodCommit]);
    if (start.exitCode !== 0) {
      const detail = (start.stderr || start.stdout).trim();
      await this.resetRepo(root);
      return { success: false, error: detail || 'Git could not start the bisect session.' };
    }

    const session: BisectSession = {
      id: createHash('sha256').update(`${root}:${originalHead}:${Date.now()}`).digest('hex').slice(0, 16),
      workspace: root,
      good: goodCommit,
      bad: badCommit,
      originalHead,
      originalBranch,
      testCommand: options.testCommand,
      startedAt: new Date().toISOString(),
      status: 'running',
      steps: [],
    };
    writeSessionFile(session);

    // A range that contains a single commit converges immediately: Git already
    // knows the answer without running a single test. Report it as such
    // instead of pretending a search is still running.
    const announced = parseCulpritCommit(`${start.stdout}\n${start.stderr}`);
    if (announced) {
      const culpritCommit = (await executeGit(root, ['rev-parse', `${announced}^{commit}`])).stdout.trim() || announced;
      const culpritShort = (await executeGit(root, ['rev-parse', '--short', culpritCommit])).stdout.trim();
      const culpritSubject = (await executeGit(root, ['log', '-1', '--format=%s', culpritCommit])).stdout.trim();
      session.status = 'complete';
      session.culprit = {
        commit: culpritCommit,
        short: culpritShort,
        subject: culpritSubject,
        explanation: buildCulpritExplanation(session, culpritShort, culpritSubject),
      };
      writeSessionFile(session);
    }
    return { success: true, session };
  }

  /** Restore the repository to the state it had before the session. */
  private async resetRepo(root: string): Promise<GitResult> {
    return executeGit(root, ['bisect', 'reset']);
  }

  /**
   * Run the test command on the current candidate and classify it.
   *
   * The classification is handed to Git (`git bisect good|bad|skip`), which
   * advances the search. When Git has narrowed the range down to a single
   * commit, the session completes and the culprit is reported.
   */
  public async step(workspace: string): Promise<{
    success: boolean;
    session?: BisectSession;
    progress?: BisectProgress;
    classification?: BisectClassification;
    error?: string;
  }> {
    const root = path.resolve(workspace);
    const session = readSessionFile(root);
    if (!session || session.status !== 'running') {
      return { success: false, error: 'No bisect session is running for this workspace.' };
    }
    const head = await executeGit(root, ['rev-parse', 'HEAD']);
    if (head.exitCode !== 0) {
      return { success: false, error: 'Could not read the current commit. The bisect session may have been reset.' };
    }
    const commit = head.stdout.trim();
    const subject = (await executeGit(root, ['log', '-1', '--format=%s', commit])).stdout.trim();
    const short = (await executeGit(root, ['rev-parse', '--short', commit])).stdout.trim();

    const options: BisectOptions = { testCommand: session.testCommand };
    const { result, classification, reason } = await runBisectTest(root, options);

    const step: BisectStep = {
      commit,
      short,
      subject,
      classification,
      reason,
      exitCode: result.exitCode,
      at: new Date().toISOString(),
    };
    session.steps.push(step);

    const mark = classification === 'good' ? 'good' : classification === 'bad' ? 'bad' : 'skip';
    const applied = await executeGit(root, ['bisect', mark]);
    if (applied.exitCode !== 0) {
      session.status = 'failed';
      session.error = (applied.stderr || applied.stdout).trim() || 'Git could not record the classification.';
      writeSessionFile(session);
      return { success: false, session, error: session.error };
    }

    // Git announces the culprit when the search converges. The exact wording
    // differs between Git versions ("first bad commit" / "first 'bad' commit").
    // Git does *not* move HEAD to the culprit, so the hash is read from the
    // message instead of from the checked-out commit.
    const output = `${applied.stdout}\n${applied.stderr}`;
    const announced = parseCulpritCommit(output);
    if (announced) {
      const culpritCommit = (await executeGit(root, ['rev-parse', `${announced}^{commit}`])).stdout.trim() || announced;
      const culpritShort = (await executeGit(root, ['rev-parse', '--short', culpritCommit])).stdout.trim();
      const culpritSubject = (await executeGit(root, ['log', '-1', '--format=%s', culpritCommit])).stdout.trim();
      session.status = 'complete';
      session.culprit = {
        commit: culpritCommit,
        short: culpritShort,
        subject: culpritSubject,
        explanation: buildCulpritExplanation(session, culpritShort, culpritSubject),
      };
      writeSessionFile(session);
      return { success: true, session, classification, progress: await this.progress(workspace) };
    }

    writeSessionFile(session);
    return { success: true, session, classification, progress: await this.progress(workspace) };
  }

  /** Progress of the current session (or of an interrupted one). */
  public async progress(workspace: string): Promise<BisectProgress> {
    const root = path.resolve(workspace);
    const session = readSessionFile(root);
    const active = await isBisectActive(root);
    if (!session) {
      return {
        active,
        session: null,
        remaining: 0,
        tested: 0,
        estimatedTotal: 0,
        message: active
          ? 'A bisect session is active in this repository, but Quillix has no record of it. Use "Recover" to restore the session or "Reset" to leave the session.'
          : 'No bisect session is running.',
      };
    }
    const tested = session.steps.length;
    // The commits Git may still test. `good..bad` contains every candidate
    // between the two boundaries (the known-bad commit included, because it is
    // the upper bound of the range). The number of *untested* candidates is
    // what the user cares about.
    const candidates = await executeGit(root, ['rev-list', '--count', `${session.good}..${session.bad}`]);
    const range = candidates.exitCode === 0 ? Number(candidates.stdout.trim()) || 0 : 0;
    const remaining = Math.max(0, range - tested);
    const estimatedTotal = range > 0 ? Math.ceil(Math.log2(range + 1)) : 0;
    const current = await executeGit(root, ['rev-parse', '--short', 'HEAD']);
    const subject = (await executeGit(root, ['log', '-1', '--format=%s'])).stdout.trim();
    return {
      active,
      session,
      currentCommit: current.exitCode === 0 ? current.stdout.trim() : undefined,
      currentShort: current.exitCode === 0 ? current.stdout.trim() : undefined,
      currentSubject: subject || undefined,
      remaining,
      tested,
      estimatedTotal,
      message: session.status === 'complete'
        ? `Bisect finished. The regression was introduced by ${session.culprit?.short ?? 'the reported commit'}.`
        : `Bisect in progress: ${tested} commit(s) tested, ${remaining} candidate(s) left.`,
    };
  }

  /**
   * Recover an interrupted session.
   *
   * The session file survives an application crash, so the recorded state can
   * be re-attached to the still-running Git bisect. If Git no longer has a
   * session (for example the user reset it manually), the repository is left
   * untouched and the caller is told the session can no longer continue.
   */
  public async recover(workspace: string): Promise<{ success: boolean; session?: BisectSession; error?: string }> {
    const root = path.resolve(workspace);
    const session = readSessionFile(root);
    if (!session) return { success: false, error: 'There is no bisect session to recover.' };
    const active = await isBisectActive(root);
    if (!active) {
      session.status = 'aborted';
      session.error = 'The Git bisect session is no longer active, so it cannot be continued.';
      writeSessionFile(session);
      return { success: false, session, error: session.error };
    }
    if (session.status === 'complete') {
      return { success: false, session, error: 'This bisect session has already finished and cannot be continued.' };
    }
    session.status = 'running';
    session.error = undefined;
    writeSessionFile(session);
    return { success: true, session };
  }

  /**
   * Finish the session and restore the repository.
   *
   * `git bisect reset` returns the working tree to the branch and commit the
   * session started from. No history is rewritten and no commit is dropped.
   */
  public async finish(workspace: string): Promise<{ success: boolean; session?: BisectSession; error?: string }> {
    const root = path.resolve(workspace);
    const session = readSessionFile(root);
    const reset = await this.resetRepo(root);
    if (reset.exitCode !== 0) {
      const detail = (reset.stderr || reset.stdout).trim();
      return { success: false, session: session ?? undefined, error: detail || 'Could not reset the bisect session.' };
    }
    if (session) {
      session.status = session.status === 'complete' ? 'complete' : 'aborted';
      writeSessionFile(session);
    }
    clearSessionFile(root);
    return { success: true, session: session ?? undefined };
  }

  /** Forget the session record without touching the repository. */
  public async abandon(workspace: string): Promise<{ success: boolean }> {
    clearSessionFile(path.resolve(workspace));
    return { success: true };
  }
}

/**
 * Whether Git currently has a bisect session in this repository.
 *
 * `git bisect log` exits with a non-zero status when no session is running,
 * so the exit code — not just the output — decides.
 */
async function isBisectActive(root: string): Promise<boolean> {
  const log = await executeGit(root, ['bisect', 'log']);
  if (log.exitCode !== 0) return false;
  return /bisect start/i.test(`${log.stdout}\n${log.stderr}`);
}

/**
 * Extract the culprit commit from Git's output.
 *
 * When the search converges, Git prints
 *   `<full-sha> is the first 'bad' commit`
 * but it does **not** move HEAD to that commit — HEAD stays on the last
 * tested candidate. The hash therefore has to be read from the message.
 */
export function parseCulpritCommit(output: string): string | null {
  const match = output.match(/([0-9a-f]{7,40})\s+is the first '?bad'? commit/i);
  return match ? match[1] : null;
}

/** Human readable explanation of the bisect result. */
export function buildCulpritExplanation(session: BisectSession, short: string, subject: string): string {
  const good = session.steps.filter(step => step.classification === 'good').length;
  const bad = session.steps.filter(step => step.classification === 'bad').length;
  const skipped = session.steps.filter(step => step.classification === 'inconclusive').length;
  const parts = [
    `${short} ("${subject}") is the first commit where the configured test command fails.`,
    `The search started from the known-good revision ${session.good} and the known-bad revision ${session.bad}.`,
    `${good} commit(s) were confirmed good and ${bad} commit(s) reproduced the regression.`,
  ];
  if (skipped > 0) parts.push(`${skipped} commit(s) could not be evaluated and were skipped.`);
  parts.push('Inspect this commit first: `git show ' + short + '`.');
  return parts.join(' ');
}





