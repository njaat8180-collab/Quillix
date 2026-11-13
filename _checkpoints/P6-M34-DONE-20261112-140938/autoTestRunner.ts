import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import {
  autoTestShouldRun,
  resolveAutoTestPlan,
  summarizeAutoTestRun,
  type AutoTestCommand,
  type AutoTestPlan,
  type AutoTestRunSummary,
} from '../shared/autoTestOnSave.js';
import type { SettingsStore } from './settings.js';

/**
 * M3.4: run the workspace's own check (npm run lint/test) shortly after a save
 * and surface the result in the Build & Tests panel.
 *
 * Hardening posture:
 *  - strictly opt-in (settings.autoRunTestsOnSave, default OFF);
 *  - Offline Mode suppresses runs (npm may need the network);
 *  - the command is resolved ONLY from the workspace package.json scripts;
 *  - single-flight, debounced, bounded output, hard timeout, killed on timeout;
 *  - npm is spawned through Node itself (no shell, no .cmd quoting surface);
 *  - failures are advisory only: this never blocks a save.
 */
const RUN_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_CHARS = 200_000;
const HISTORY_LIMIT = 5;
const SAVE_DEBOUNCE_MS = 1500;

export class AutoTestRunner {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: { filePath: string } | null = null;
  private last: { at: number; filePath: string } | null = null;
  private child: ChildProcess | null = null;
  private history: AutoTestRunSummary[] = [];

  constructor(private readonly settings: SettingsStore) {}

  /** npm-cli.js resolved through this Node install; null when unavailable. */
  private npmCliPath(): string | null {
    const candidate = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
    return fs.existsSync(candidate) ? candidate : null;
  }

  private plan(): AutoTestPlan {
    const npmCli = this.npmCliPath();
    const enabled = this.settings.get().autoRunTestsOnSave === true;
    if (!npmCli) {
      return { enabled, command: null, reason: 'npm was not found next to this Node install, so automatic runs are unavailable.' };
    }
    const settings = this.settings.get();
    const root = settings.workspaceRoot;
    let packageJson: unknown = null;
    if (root) {
      try {
        const manifestPath = path.join(root, 'package.json');
        if (fs.existsSync(manifestPath)) packageJson = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      } catch {
        packageJson = null;
      }
    }
    return resolveAutoTestPlan({
      enabled,
      offlineMode: settings.offlineMode === true,
      packageJson,
      nodePath: process.execPath,
      npmCliPath: npmCli,
    });
  }

  /** Called after a successful workspace write; schedules a debounced run. */
  notifySave(filePath: string): void {
    if (this.settings.get().autoRunTestsOnSave !== true) return;
    const now = Date.now();
    if (!autoTestShouldRun(this.last, now, filePath)) return;
    if (this.timer) clearTimeout(this.timer);
    this.pending = { filePath };
    this.timer = setTimeout(() => {
      this.timer = null;
      const target = this.pending;
      this.pending = null;
      if (target) void this.run('save', target.filePath);
    }, SAVE_DEBOUNCE_MS);
    if (typeof this.timer?.unref === 'function') this.timer.unref();
  }

  async runNow(): Promise<AutoTestRunSummary | { skipped: string }> {
    return this.run('manual');
  }

  private async run(triggeredBy: 'save' | 'manual', filePath?: string): Promise<AutoTestRunSummary | { skipped: string }> {
    const plan = this.plan();
    if (!plan.command) return { skipped: plan.reason || 'Automatic test runs are unavailable.' };
    if (this.child) return { skipped: 'A check is already running.' };
    const command: AutoTestCommand = plan.command;
    const root = this.settings.get().workspaceRoot;
    if (!root) return { skipped: 'No workspace folder is open.' };
    this.last = { at: Date.now(), filePath: filePath || '' };
    const started = Date.now();
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const exitCode = await new Promise<number | null>(resolve => {
      let child: ChildProcess;
      try {
        child = spawn(command.argv[0], command.argv.slice(1), {
          cwd: root,
          shell: false,
          windowsHide: true,
          env: { ...process.env, CI: '1', FORCE_COLOR: '0', NPM_CONFIG_YES: 'true' },
        });
      } catch (error: any) {
        // A synchronous spawn failure (e.g. EFTYPE/ENOENT) must degrade to an
        // honest result, never crash the request handler or the server.
        stderr = (stderr + `\n[spawn error: ${error?.message || error}]`).slice(-MAX_OUTPUT_CHARS);
        resolve(null);
        return;
      }
      this.child = child;
      const append = (chunk: Buffer, sink: 'out' | 'err') => {
        const text = chunk.toString('utf8');
        if (sink === 'out') stdout = (stdout + text).slice(-MAX_OUTPUT_CHARS);
        else stderr = (stderr + text).slice(-MAX_OUTPUT_CHARS);
      };
      child.stdout?.on('data', chunk => append(chunk as Buffer, 'out'));
      child.stderr?.on('data', chunk => append(chunk as Buffer, 'err'));
      const hardTimeout = setTimeout(() => {
        timedOut = true;
        try { child.kill('SIGKILL'); } catch { /* already gone */ }
      }, RUN_TIMEOUT_MS);
      child.on('error', error => {
        clearTimeout(hardTimeout);
        stderr = (stderr + `\n[spawn error: ${error.message}]`).slice(-MAX_OUTPUT_CHARS);
        resolve(null);
      });
      child.on('close', code => {
        clearTimeout(hardTimeout);
        resolve(code);
      });
    });
    this.child = null;
    const summary = summarizeAutoTestRun({
      exitCode,
      durationMs: Date.now() - started,
      triggeredBy,
      filePath,
      stdout,
      stderr,
      timedOut,
    });
    this.history.unshift(summary);
    if (this.history.length > HISTORY_LIMIT) this.history.length = HISTORY_LIMIT;
    return summary;
  }

  status(): {
    available: boolean;
    enabled: boolean;
    commandLabel: string | null;
    reason: string | null;
    running: boolean;
    lastRun: AutoTestRunSummary | null;
    history: AutoTestRunSummary[];
  } {
    const plan = this.plan();
    return {
      available: Boolean(plan.command),
      enabled: this.settings.get().autoRunTestsOnSave === true,
      commandLabel: plan.command?.label ?? null,
      reason: plan.reason ?? null,
      running: Boolean(this.child),
      lastRun: this.history[0] ?? null,
      history: this.history,
    };
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending = null;
    if (this.child) {
      try { this.child.kill('SIGKILL'); } catch { /* already gone */ }
      this.child = null;
    }
  }
}