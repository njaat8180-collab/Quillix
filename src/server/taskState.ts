import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { AgentObservability } from '../shared/types.js';

/**
 * NUVRO AI Task State Store (§21 — TASK MEMORY / RESUME)
 * ====================================================
 * Persistent, per-workspace record of every agent task: the user request, the
 * canonical project root, every file created/modified/deleted (verified),
 * every command executed with its real exit code, verification state, errors,
 * and retry counts. Persisted atomically in `<workspace>/.quillix/tasks.json`.
 *
 * This is what makes tasks RESUMABLE: after an interruption, the engine can
 * reload the last task's VERIFIED state (files that exist on disk) and
 * continue from there instead of redoing (or falsely skipping) work.
 */

export interface TaskCommandRecord {
  command: string;
  cwd: string;
  exitCode: number;
  durationMs: number;
  timestamp: number;
}

export type TaskStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export interface TaskRollbackEntry {
  filePath: string;
  existedBefore: boolean;
  snapshotFile: string;
  beforeHash: string;
  existsAfter: boolean;
  afterHash: string;
}

export interface TaskRollbackState {
  id: string;
  files: TaskRollbackEntry[];
  restoredAt?: number;
  conflictPaths?: string[];
}

export interface TaskToolMetric {
  calls: number;
  failures: number;
  totalDurationMs: number;
}

export interface TaskModelMetric {
  inputChars: number;
  outputChars: number;
  toolResultChars: number;
  contextCharsPeak: number;
  rawConversationChars?: number;
  sentMessageChars?: number;
  actualInputTokens?: number;
  actualOutputTokens?: number;
}

export type TaskObservability = AgentObservability & { byTool: Record<string, TaskToolMetric> };

export interface TaskRecord {
  id: string;
  /** Previous task whose verified checkpoint seeded this run. */
  resumedFromTaskId?: string;
  userRequest: string;
  mode: string;
  /** Canonical absolute project root when the task targets a project. */
  projectRoot?: string;
  projectName?: string;
  status: TaskStatus;
  createdAt: number;
  updatedAt: number;
  filesCreated: string[];
  filesModified: string[];
  filesDeleted: string[];
  commandsExecuted: TaskCommandRecord[];
  /** Verification state as recorded from the REAL verifier. */
  verification?: { summary: string; executed: boolean; exitCode?: number };
  errors: string[];
  retryCount: number;
  finalText?: string;
  /** Conflict-safe pre-change snapshots for this task's applied file edits. */
  rollback?: TaskRollbackState;
  /** Bounded, provider/model-aware run metrics for observability and resume diagnostics. */
  observability: TaskObservability;
}

const MAX_TASKS = 50;
const MAX_ERRORS_PER_TASK = 25;
const MAX_COMMANDS_PER_TASK = 200;

export class TaskStateStore {
  private storePath: string;
  private workspaceRoot: string;
  private tasks: TaskRecord[];

  constructor(workspaceRoot: string) {
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.storePath = path.join(this.workspaceRoot, '.quillix', 'tasks.json');
    this.tasks = this.load();
    this.recoverStaleRunningTasks();
  }

  /** Reload when the active workspace changes. */
  public rebind(workspaceRoot: string): void {
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.storePath = path.join(this.workspaceRoot, '.quillix', 'tasks.json');
    this.tasks = this.load();
    this.recoverStaleRunningTasks();
  }

  /**
   * A persisted `running` record cannot survive a server restart: the agent
   * controller and SSE stream that owned it are gone. Mark it terminal during
   * startup/rebind so the UI never blocks a new task on a dead process. The
   * record remains resumable by ID because its verified files and journal are
   * preserved.
   */
  private recoverStaleRunningTasks(): void {
    let changed = false;
    const now = Date.now();
    for (const task of this.tasks) {
      if (task.status !== 'running') continue;
      task.status = 'cancelled';
      task.updatedAt = now;
      task.finalText = task.finalText || 'Task was interrupted when the previous NUVRO AI session ended. Review the recorded files or resume it explicitly.';
      if (!task.errors.includes('Interrupted by a previous NUVRO AI session.')) task.errors.push('Interrupted by a previous NUVRO AI session.');
      if (task.observability && !task.observability.finishedAt) {
        task.observability.finishedAt = now;
        task.observability.durationMs = Math.max(0, now - task.observability.startedAt);
      }
      changed = true;
    }
    if (changed) this.save();
  }

  private load(): TaskRecord[] {
    try {
      const raw = fs.readFileSync(this.storePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter(
          (t: any) => t && typeof t.id === 'string' && typeof t.userRequest === 'string' && typeof t.status === 'string'
        );
      }
    } catch {
      // first run / unreadable — start fresh
    }
    return [];
  }

  /** Atomic persist: write to a temp file, then rename over the target. */
  private save(): void {
    try {
      fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
      const tmp = `${this.storePath}.tmp-${process.pid}-${Date.now()}`;
      fs.writeFileSync(tmp, JSON.stringify(this.tasks, null, 2), 'utf8');
      fs.renameSync(tmp, this.storePath);
    } catch {
      // Persistence is best-effort — an agent run must never crash on it.
    }
  }

  private hash(content: string): string {
    return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
  }

  private normalizeFilePath(filePath: string): string | undefined {
    const normalized = filePath.replace(/\\/g, '/').replace(/^\.\//, '');
    if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized) || normalized.split('/').includes('..')) return undefined;
    const absolute = path.resolve(this.workspaceRoot, normalized);
    const relative = path.relative(this.workspaceRoot, absolute);
    if (relative.startsWith('..') || path.isAbsolute(relative)) return undefined;
    return relative.replace(/\\/g, '/');
  }

  private rollbackDir(taskId: string): string {
    return path.join(path.dirname(this.storePath), 'rollback', taskId);
  }

  private writeSnapshot(filePath: string, content: string): void {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    try {
      fs.writeFileSync(tmp, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      fs.renameSync(tmp, filePath);
    } finally {
      try { fs.unlinkSync(tmp); } catch (error: any) { if (error?.code !== 'ENOENT') throw error; }
    }
  }

  private indexOf(id: string): number {
    return this.tasks.findIndex((t) => t.id === id);
  }

  private touch(task: TaskRecord): void {
    task.updatedAt = Date.now();
    this.save();
  }

  public startTask(userRequest: string, mode: string, metadata: { provider?: string; model?: string; capabilities?: { tools: boolean; streaming: boolean; reasoning: boolean }; resumedFromTaskId?: string } = {}): TaskRecord {
    const checkpoint = metadata.resumedFromTaskId ? this.resolveResumeCheckpoint(metadata.resumedFromTaskId) : undefined;
    if (checkpoint && 'error' in checkpoint) throw new Error(checkpoint.error);
    const startedAt = Date.now();
    const task: TaskRecord = {
      id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      ...(metadata.resumedFromTaskId ? { resumedFromTaskId: metadata.resumedFromTaskId } : {}),
      userRequest,
      mode,
      status: 'running',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      filesCreated: [],
      filesModified: [],
      filesDeleted: [],
      commandsExecuted: [],
      errors: [],
      retryCount: 0,
      rollback: { id: `rollback_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, files: [] },
      observability: {
        ...(metadata.provider ? { provider: metadata.provider } : {}),
        ...(metadata.model ? { model: metadata.model } : {}),
        ...(metadata.capabilities ? { capabilities: { ...metadata.capabilities } } : {}),
        startedAt,
        toolCalls: 0,
        toolFailures: 0,
        verificationRuns: 0,
        byTool: {},
      },
    };
    if (checkpoint) {
      const prior = checkpoint.task;
      task.projectName = prior.projectName;
      task.projectRoot = checkpoint.projectRoot;
      task.filesCreated = [...prior.filesCreated];
      task.filesModified = [...prior.filesModified];
      task.filesDeleted = [...prior.filesDeleted];
      task.commandsExecuted = [...prior.commandsExecuted].slice(-MAX_COMMANDS_PER_TASK);
      task.errors = [...prior.errors].slice(-MAX_ERRORS_PER_TASK);
      task.retryCount = prior.retryCount;
      task.verification = prior.verification ? { ...prior.verification } : undefined;
      task.rollback = prior.rollback ? JSON.parse(JSON.stringify(prior.rollback)) : task.rollback;
    }
    this.tasks.push(task);
    // Bound the store: oldest first.
    if (this.tasks.length > MAX_TASKS) this.tasks = this.tasks.slice(-MAX_TASKS);
    this.save();
    return task;
  }

  public setProject(taskId: string, projectName: string, projectRoot: string): void {
    const i = this.indexOf(taskId);
    if (i === -1) return;
    this.tasks[i].projectName = projectName;
    this.tasks[i].projectRoot = projectRoot;
    this.touch(this.tasks[i]);
  }

  public recordFileCreated(taskId: string, relPath: string): void {
    const i = this.indexOf(taskId);
    if (i === -1) return;
    if (!this.tasks[i].filesCreated.includes(relPath)) this.tasks[i].filesCreated.push(relPath);
    // A file can be created, retried, and then reported again by a provider;
    // keep the checkpoint a set-like list so the UI reflects unique files.
    this.tasks[i].filesCreated = [...new Set(this.tasks[i].filesCreated)];
    this.touch(this.tasks[i]);
  }

  public recordFileModified(taskId: string, relPath: string): void {
    const i = this.indexOf(taskId);
    if (i === -1) return;
    if (!this.tasks[i].filesModified.includes(relPath)) this.tasks[i].filesModified.push(relPath);
    this.touch(this.tasks[i]);
  }

  public recordFileDeleted(taskId: string, relPath: string): void {
    const i = this.indexOf(taskId);
    if (i === -1) return;
    if (!this.tasks[i].filesDeleted.includes(relPath)) this.tasks[i].filesDeleted.push(relPath);
    this.touch(this.tasks[i]);
  }

  /** Record the first on-disk version of a changed file and the latest version
   * produced by the task. Snapshot contents stay outside tasks.json so the
   * task index remains small; secret-looking paths are never snapshotted. */
  public recordRollback(taskId: string, patch: { filePath: string; changeType?: string; oldContent?: string; newContent?: string }): void {
    const i = this.indexOf(taskId);
    if (i === -1 || !patch || typeof patch.filePath !== 'string') return;
    const rel = this.normalizeFilePath(patch.filePath);
    if (!rel || this.isProtectedPath(rel)) return;
    const task = this.tasks[i];
    if (!task.rollback) task.rollback = { id: `rollback_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, files: [] };
    const existsAfter = patch.changeType !== 'deleted';
    const afterContent = typeof patch.newContent === 'string' ? patch.newContent : '';
    const existing = task.rollback.files.find((entry) => entry.filePath === rel);
    if (existing) {
      existing.existsAfter = existsAfter;
      existing.afterHash = existsAfter ? this.hash(afterContent) : '';
      this.touch(task);
      return;
    }
    const existedBefore = patch.changeType !== 'created';
    const beforeContent = typeof patch.oldContent === 'string' ? patch.oldContent : '';
    const snapshotFile = path.join('rollback', task.rollback.id, `${task.rollback.files.length}.snapshot`).replace(/\\/g, '/');
    try {
      this.writeSnapshot(path.join(this.workspaceRoot, '.quillix', snapshotFile), beforeContent);
      task.rollback.files.push({
        filePath: rel,
        existedBefore,
        snapshotFile,
        beforeHash: this.hash(beforeContent),
        existsAfter,
        afterHash: existsAfter ? this.hash(afterContent) : '',
      });
      this.touch(task);
    } catch {
      // A rollback snapshot is best-effort; never make a successful file edit
      // fail solely because the metadata volume is unavailable.
    }
  }

  public getRollback(taskId: string): TaskRollbackState | undefined {
    const task = this.getTask(taskId);
    return task?.rollback ? JSON.parse(JSON.stringify(task.rollback)) : undefined;
  }

  private isProtectedPath(rel: string): boolean {
    const base = path.basename(rel).toLowerCase();
    return base === '.env' || base.startsWith('.env.') || base === '.npmrc' || base === '.netrc' ||
      base === 'credentials.json' || base === 'secrets.json' || base.endsWith('.pem') || base.endsWith('.key') ||
      base.endsWith('.pfx') || base.endsWith('.p12') || /(^|\/)(secrets?|credentials)\.(json|ya?ml|toml|ini|txt)$/i.test(rel);
  }

  /** Restore a task's changes only when the current file still matches the
   * task-produced version. Manual edits become explicit conflicts instead of
   * being silently overwritten. */
  public rollbackTask(taskId: string): { success: boolean; restored: string[]; conflicts: string[]; error?: string } {
    const task = this.getTask(taskId);
    if (!task?.rollback || task.rollback.files.length === 0) return { success: false, restored: [], conflicts: [], error: 'No rollback snapshot is available for this task.' };
    const restored: string[] = [];
    const conflicts: string[] = [];
    try {
      for (const entry of [...task.rollback.files].reverse()) {
        const absolute = path.resolve(this.workspaceRoot, entry.filePath);
        const relative = path.relative(this.workspaceRoot, absolute);
        if (relative.startsWith('..') || path.isAbsolute(relative)) { conflicts.push(entry.filePath); continue; }
        const exists = fs.existsSync(absolute);
        const current = exists && fs.statSync(absolute).isFile() ? fs.readFileSync(absolute, 'utf8') : '';
        const currentHash = exists ? this.hash(current) : '';
        const unchanged = entry.existsAfter ? exists && currentHash === entry.afterHash : !exists;
        if (!unchanged) { conflicts.push(entry.filePath); continue; }
        if (!entry.existedBefore) {
          if (exists) fs.unlinkSync(absolute);
        } else {
          const snapshotPath = path.join(this.workspaceRoot, '.quillix', entry.snapshotFile);
          const before = fs.readFileSync(snapshotPath, 'utf8');
          this.writeSnapshot(absolute, before);
        }
        restored.push(entry.filePath);
      }
      task.rollback.restoredAt = Date.now();
      task.rollback.conflictPaths = conflicts;
      this.touch(task);
      return { success: conflicts.length === 0, restored, conflicts, error: conflicts.length ? 'Rollback stopped at files changed after the task; review conflicts before retrying.' : undefined };
    } catch (error: any) {
      task.rollback.conflictPaths = conflicts;
      this.touch(task);
      return { success: false, restored, conflicts, error: `Rollback failed: ${String(error?.message || error)}` };
    }
  }

  public recordCommand(taskId: string, rec: TaskCommandRecord): void {
    const i = this.indexOf(taskId);
    if (i === -1) return;
    const t = this.tasks[i];
    t.commandsExecuted.push(rec);
    if (t.commandsExecuted.length > MAX_COMMANDS_PER_TASK) t.commandsExecuted = t.commandsExecuted.slice(-MAX_COMMANDS_PER_TASK);
    this.touch(t);
  }

  public recordError(taskId: string, message: string): void {
    const i = this.indexOf(taskId);
    if (i === -1) return;
    const t = this.tasks[i];
    t.errors.push(message.slice(0, 300));
    if (t.errors.length > MAX_ERRORS_PER_TASK) t.errors = t.errors.slice(-MAX_ERRORS_PER_TASK);
    this.touch(t);
  }

  public recordRetry(taskId: string): void {
    const i = this.indexOf(taskId);
    if (i === -1) return;
    this.tasks[i].retryCount++;
    this.touch(this.tasks[i]);
  }

  public recordToolMetric(taskId: string, toolName: string, success: boolean, durationMs = 0): void {
    const i = this.indexOf(taskId);
    if (i === -1 || !toolName) return;
    const task = this.tasks[i];
    const metric = task.observability || (task.observability = {
      startedAt: task.createdAt,
      toolCalls: 0,
      toolFailures: 0,
      verificationRuns: 0,
      byTool: {},
    });
    const key = toolName.slice(0, 80);
    const byTool = metric.byTool[key] || (metric.byTool[key] = { calls: 0, failures: 0, totalDurationMs: 0 });
    byTool.calls += 1;
    byTool.totalDurationMs += Math.max(0, Number.isFinite(durationMs) ? durationMs : 0);
    metric.toolCalls += 1;
    if (!success) {
      byTool.failures += 1;
      metric.toolFailures += 1;
    }
    this.touch(task);
  }

  /** Persist provider-neutral model sizing so token efficiency survives reload. */
  public recordModelMetric(taskId: string, metric: TaskModelMetric): void {
    const i = this.indexOf(taskId);
    if (i === -1) return;
    const task = this.tasks[i];
    const observability = task.observability || (task.observability = {
      startedAt: task.createdAt,
      toolCalls: 0,
      toolFailures: 0,
      verificationRuns: 0,
      byTool: {},
    });
    observability.modelCalls = (observability.modelCalls || 0) + 1;
    observability.inputChars = (observability.inputChars || 0) + Math.max(0, metric.inputChars || 0);
    observability.outputChars = (observability.outputChars || 0) + Math.max(0, metric.outputChars || 0);
    observability.toolResultChars = (observability.toolResultChars || 0) + Math.max(0, metric.toolResultChars || 0);
    observability.contextCharsPeak = Math.max(observability.contextCharsPeak || 0, metric.contextCharsPeak || 0);
    if (metric.rawConversationChars !== undefined && metric.sentMessageChars !== undefined) {
      observability.rawConversationChars = (observability.rawConversationChars || 0) + Math.max(0, metric.rawConversationChars);
      observability.sentMessageChars = (observability.sentMessageChars || 0) + Math.max(0, metric.sentMessageChars);
      observability.messageHistoryReductionPercent = observability.rawConversationChars > 0
        ? Math.round((1 - observability.sentMessageChars / observability.rawConversationChars) * 1000) / 10
        : 0;
    }
    observability.estimatedInputTokens = Math.ceil((observability.inputChars || 0) / 4);
    observability.estimatedOutputTokens = Math.ceil((observability.outputChars || 0) / 4);
    observability.estimatedTotalTokens = (observability.estimatedInputTokens || 0) + (observability.estimatedOutputTokens || 0);
    if (metric.actualInputTokens !== undefined || metric.actualOutputTokens !== undefined) {
      observability.actualInputTokens = (observability.actualInputTokens || 0) + Math.max(0, metric.actualInputTokens || 0);
      observability.actualOutputTokens = (observability.actualOutputTokens || 0) + Math.max(0, metric.actualOutputTokens || 0);
      observability.actualTotalTokens = (observability.actualInputTokens || 0) + (observability.actualOutputTokens || 0);
      observability.tokenCountSource = observability.tokenCountSource && observability.tokenCountSource !== 'provider' ? 'mixed' : 'provider';
    } else {
      observability.tokenCountSource = observability.tokenCountSource === 'provider' ? 'mixed' : (observability.tokenCountSource || 'estimate');
    }
    this.touch(task);
  }

  public recordToolResultChars(taskId: string, chars: number): void {
    const i = this.indexOf(taskId);
    if (i === -1) return;
    const task = this.tasks[i];
    const observability = task.observability || (task.observability = {
      startedAt: task.createdAt,
      toolCalls: 0,
      toolFailures: 0,
      verificationRuns: 0,
      byTool: {},
    });
    observability.toolResultChars = (observability.toolResultChars || 0) + Math.max(0, chars || 0);
    this.touch(task);
  }

  public recordVerification(taskId: string, v: { summary: string; executed: boolean; exitCode?: number }): void {
    const i = this.indexOf(taskId);
    if (i === -1) return;
    this.tasks[i].verification = v;
    const metrics = this.tasks[i].observability || (this.tasks[i].observability = { startedAt: this.tasks[i].createdAt, toolCalls: 0, toolFailures: 0, verificationRuns: 0, byTool: {} });
    metrics.verificationRuns += 1;
    this.touch(this.tasks[i]);
  }

  public finishTask(taskId: string, status: TaskStatus, finalText?: string): void {
    const i = this.indexOf(taskId);
    if (i === -1) return;
    this.tasks[i].status = status;
    if (finalText !== undefined) this.tasks[i].finalText = finalText.slice(0, 4000);
    const metrics = this.tasks[i].observability || (this.tasks[i].observability = { startedAt: this.tasks[i].createdAt, toolCalls: 0, toolFailures: 0, verificationRuns: 0, byTool: {} });
    if (!metrics.finishedAt) {
      metrics.finishedAt = Date.now();
      metrics.durationMs = Math.max(0, metrics.finishedAt - metrics.startedAt);
    }
    this.touch(this.tasks[i]);
  }

  public listTasks(): TaskRecord[] {
    this.tasks = this.load();
    return [...this.tasks].sort((a, b) => b.createdAt - a.createdAt);
  }

  public getTask(id: string): TaskRecord | undefined {
    this.tasks = this.load();
    return this.tasks.find((t) => t.id === id);
  }

  public resolveResumeCheckpoint(id: string):
    { task: TaskRecord; projectRoot: string } | { status: 404 | 409; error: string } {
    const task = this.getTask(id);
    if (!task) return { status: 404, error: `Unknown task: ${id}` };
    if (task.status !== 'failed' && task.status !== 'cancelled') {
      return { status: 409, error: `Task is ${task.status} and cannot be resumed.` };
    }
    // A successor owns the inherited file and command journal. Replaying its
    // ancestor could overwrite work already done after the old checkpoint.
    if (this.tasks.some(candidate => candidate.resumedFromTaskId === id)) {
      return { status: 409, error: 'This checkpoint was already resumed. Use the latest task result to continue.' };
    }
    const projectRoot = path.resolve(this.workspaceRoot, task.projectRoot || '.');
    const insideWorkspace = (root: string, target: string) => {
      const relative = path.relative(root, target);
      return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
    };
    try {
      if (insideWorkspace(this.workspaceRoot, projectRoot) && fs.statSync(projectRoot).isDirectory() &&
          insideWorkspace(fs.realpathSync(this.workspaceRoot), fs.realpathSync(projectRoot))) {
        return { task, projectRoot };
      }
    } catch {
      // Missing or inaccessible checkpoint target.
    }
    return { status: 409, error: 'The checkpoint project directory is unavailable in this workspace.' };
  }

  /**
   * Return a compact, provider-neutral efficiency view for recent tasks.
   * Prompts, file contents and command strings are deliberately excluded: the
   * endpoint is for telemetry, not task replay or workspace disclosure.
   */
  public tokenEfficiencySummary(limit = 20): {
    success: true;
    sampleSize: number;
    completedTasks: number;
    verifiedTasks: number;
    totalTokens: number;
    totalModelCalls: number;
    totalToolCalls: number;
    totalVerificationRuns: number;
    totalVerifiedFiles: number;
    averageTokensPerVerifiedFile: number | null;
    medianTokens: number | null;
    p95Tokens: number | null;
    medianDurationMs: number | null;
    p95DurationMs: number | null;
    passRatePercent: number;
    tasks: Array<{
      id: string;
      status: TaskStatus;
      provider?: string;
      model?: string;
      tokens: number;
      tokenCountSource?: AgentObservability['tokenCountSource'];
      modelCalls: number;
      toolCalls: number;
      verificationRuns: number;
      verifiedFiles: number;
      durationMs?: number;
      byTool: Record<string, TaskToolMetric>;
    }>;
  } {
    const bounded = Math.min(100, Math.max(1, Math.floor(Number.isFinite(limit) ? limit : 20)));
    const recent = this.listTasks().filter((task) => task.observability).slice(0, bounded);
    const tasks = recent.map((task) => {
      const metrics = task.observability;
      const tokens = metrics.actualTotalTokens ?? metrics.estimatedTotalTokens ?? 0;
      return {
        id: task.id,
        status: task.status,
        ...(metrics.provider ? { provider: metrics.provider } : {}),
        ...(metrics.model ? { model: metrics.model } : {}),
        tokens: Math.max(0, tokens),
        ...(metrics.tokenCountSource ? { tokenCountSource: metrics.tokenCountSource } : {}),
        modelCalls: metrics.modelCalls || 0,
        toolCalls: metrics.toolCalls || 0,
        verificationRuns: metrics.verificationRuns || 0,
        verifiedFiles: task.filesCreated.length + task.filesModified.length + task.filesDeleted.length,
        byTool: Object.fromEntries(Object.entries(metrics.byTool || {}).map(([name, metric]) => [name, {
          calls: Math.max(0, metric.calls || 0),
          failures: Math.max(0, metric.failures || 0),
          totalDurationMs: Math.max(0, metric.totalDurationMs || 0),
        }])),
        ...(metrics.durationMs !== undefined ? { durationMs: metrics.durationMs } : {}),
      };
    });
    const totalVerifiedFiles = tasks.reduce((sum, task) => sum + task.verifiedFiles, 0);
    const totalTokens = tasks.reduce((sum, task) => sum + task.tokens, 0);
    const percentile = (values: number[], fraction: number): number | null => {
      const sorted = values.filter(value => Number.isFinite(value)).sort((a, b) => a - b);
      if (!sorted.length) return null;
      return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1))];
    };
    const durations = tasks.map(task => task.durationMs).filter((value): value is number => value !== undefined);
    return {
      success: true,
      sampleSize: tasks.length,
      completedTasks: tasks.filter((task) => task.status === 'completed').length,
      verifiedTasks: tasks.filter((task) => task.verificationRuns > 0 && task.verifiedFiles > 0).length,
      totalTokens,
      totalModelCalls: tasks.reduce((sum, task) => sum + task.modelCalls, 0),
      totalToolCalls: tasks.reduce((sum, task) => sum + task.toolCalls, 0),
      totalVerificationRuns: tasks.reduce((sum, task) => sum + task.verificationRuns, 0),
      totalVerifiedFiles,
      averageTokensPerVerifiedFile: totalVerifiedFiles > 0 ? Math.round(totalTokens / totalVerifiedFiles) : null,
      medianTokens: percentile(tasks.map(task => task.tokens), 0.5),
      p95Tokens: percentile(tasks.map(task => task.tokens), 0.95),
      medianDurationMs: percentile(durations, 0.5),
      p95DurationMs: percentile(durations, 0.95),
      passRatePercent: tasks.length ? Math.round((tasks.filter(task => task.status === 'completed').length / tasks.length) * 100) : 0,
      tasks,
    };
  }

  /** Most recent task that never reached a terminal status. */
  public getLatestIncomplete(): TaskRecord | undefined {
    this.tasks = this.load();
    for (let i = this.tasks.length - 1; i >= 0; i--) {
      if (this.tasks[i].status === 'running') return this.tasks[i];
    }
    return undefined;
  }

  /**
   * Builds the RESUME context for the model conversation from a task's
   * verified state: only files that ACTUALLY exist on disk are described as
   * done; the rest are listed as pending. Used to seed a resumed run so the
   * agent continues from the last verified point instead of redoing work.
   */
  public buildResumeContext(rec: TaskRecord): string {
    const parts: string[] = [
      `You are RESUMING an interrupted task (id ${rec.id}).`,
      `Original request: "${rec.userRequest}"`,
    ];
    if (rec.observability?.provider || rec.observability?.model || rec.observability?.capabilities) {
      const caps = rec.observability.capabilities;
      parts.push(`Previous brain: ${rec.observability.provider || 'unknown'}${rec.observability.model ? ` / ${rec.observability.model}` : ''}${caps ? ` (tools=${caps.tools}, streaming=${caps.streaming}, reasoning=${caps.reasoning})` : ''}`);
    }
    if (rec.projectName || rec.projectRoot) {
      parts.push(`Project: ${rec.projectName || ''} at ${rec.projectRoot || '(unknown root)'}`);
    }

    const existing = (files: string[]) => files.filter((f) => fs.existsSync(path.join(this.workspaceRoot, f)));
    const missing = (files: string[]) => files.filter((f) => !fs.existsSync(path.join(this.workspaceRoot, f)));

    const created = existing(rec.filesCreated);
    const createdMissing = missing(rec.filesCreated);
    if (created.length > 0) parts.push(`Files already created and verified on disk: ${created.join(', ')}`);
    if (createdMissing.length > 0) parts.push(`Files that were recorded as created but are NOT on disk (recreate them): ${createdMissing.join(', ')}`);
    const modified = existing(rec.filesModified).filter(file => !created.includes(file));
    const modifiedMissing = missing(rec.filesModified).filter(file => !createdMissing.includes(file));
    if (modified.length > 0) parts.push(`Files previously modified and still on disk: ${modified.join(', ')}`);
    if (modifiedMissing.length > 0) parts.push(`Files previously modified but now missing (investigate before recreating): ${modifiedMissing.join(', ')}`);
    if (rec.filesDeleted.length > 0) parts.push(`Files deleted during the task: ${rec.filesDeleted.join(', ')}`);
    if (rec.commandsExecuted.length > 0) {
      parts.push(
        `Commands already executed:\n${rec.commandsExecuted.map((c) => `- ${c.command} (exit ${c.exitCode})`).join('\n')}`
      );
    }
    if (rec.errors.length > 0) {
      parts.push(`Last recorded errors:\n${rec.errors.map((e) => `- ${e}`).join('\n')}`);
    }
    if (rec.verification) {
      parts.push(`Last verification: ${rec.verification.summary}`);
    }
    parts.push(
      'Continue the task from this VERIFIED state. Do not redo work whose results already exist on disk; verify files before rewriting them, complete the remaining work, and run validation before finishing.'
    );
    return parts.join('\n');
  }
}
