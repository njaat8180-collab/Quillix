import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * One agent task = one git branch, Cursor-style.
 *
 * The store remembers, per workspace, which branch is the current "task branch"
 * and which branch it was cut from, so the work can be finished (committed and
 * merged back) or discarded from anywhere in the app.
 */
export interface TaskBranchRecord {
  /** The task branch itself, e.g. "nuvro/stacnery-shop-a1b2c3". */
  branch: string;
  /** The branch the task branch was created from (merge-back target). */
  base: string;
  createdAt: number;
  title?: string;
}

const MAX_SLUG = 40;

/** Lowercase, dash-separated, git-ref-safe slug from a free-form task title. */
export function slugifyTaskTitle(title: string): string {
  const slug = (title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG)
    .replace(/-+$/g, '');
  return slug || 'task';
}

/** Branch name for a task: "<prefix>/<slug>-<shortId>" (shortId keeps names unique). */
export function taskBranchName(prefix: string, title: string, shortId: string): string {
  const safePrefix = (prefix || 'nuvro').replace(/[^A-Za-z0-9._/-]/g, '').replace(/^\/+|\/+$/g, '') || 'nuvro';
  const safeId = (shortId || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 8) || Math.random().toString(36).slice(2, 8);
  return `${safePrefix}/${slugifyTaskTitle(title)}-${safeId}`;
}

/** True when a branch name looks like a task branch for this prefix. */
export function isTaskBranchName(name: string, prefix = 'nuvro'): boolean {
  const safePrefix = (prefix || 'nuvro').replace(/[^A-Za-z0-9._/-]/g, '').replace(/^\/+|\/+$/g, '') || 'nuvro';
  return !!name && name.startsWith(`${safePrefix}/`);
}

export class TaskBranchStore {
  private readonly filePath: string;
  private records: Record<string, TaskBranchRecord> = {};

  constructor(filePath?: string) {
    this.filePath = filePath || process.env.QUILLIX_TASK_BRANCH_PATH || path.join(os.homedir(), '.quillix', 'task-branches.json');
    this.load();
  }

  private load(): void {
    try {
      if (!fs.existsSync(this.filePath)) return;
      const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) this.records = raw as Record<string, TaskBranchRecord>;
    } catch { this.records = {}; }
  }

  private persist(): void {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.records, null, 2));
      fs.renameSync(tmp, this.filePath);
    } catch { /* memory-only is fine; the UI can still show the live branch */ }
  }

  public get(workspaceRoot: string): TaskBranchRecord | null {
    return this.records[workspaceRoot] || null;
  }

  public set(workspaceRoot: string, record: TaskBranchRecord): void {
    this.records[workspaceRoot] = record;
    this.persist();
  }

  public clear(workspaceRoot: string): void {
    if (this.records[workspaceRoot]) {
      delete this.records[workspaceRoot];
      this.persist();
    }
  }
}
