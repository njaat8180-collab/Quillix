import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createTwoFilesPatch } from 'diff';
import { WorkspaceManager } from './workspace.js';

/**
 * M4.4: named checkpoints (restore points) for the workspace.
 *
 * A checkpoint is a bounded, local snapshot of the workspace's text files under
 * `.quillix/checkpoints/<id>/`. Restoring returns the workspace to that state
 * for every file the checkpoint captured. Nothing is ever uploaded, and secret
 * paths are never snapshotted (so they can never be restored or leaked).
 *
 * Storage bounds keep a runaway workspace from filling the disk: at most
 * MAX_FILES files, MAX_TOTAL_BYTES in total and MAX_FILE_BYTES per file;
 * generated directories are skipped exactly like the source exporter.
 */

export const CHECKPOINT_LIMITS = {
  maxFiles: 2000,
  maxTotalBytes: 64 * 1024 * 1024,
  maxFileBytes: 4 * 1024 * 1024,
  maxNameLength: 64,
  maxListed: 20,
  maxDiffChars: 200_000,
} as const;

const OMIT_DIRECTORIES = new Set([
  '.git', 'node_modules', 'dist', 'build', 'target', 'coverage', '.vite',
  '.next', '.venv', 'venv', '.idea', '__pycache__', '.quillix', '.quillix-smoke',
  '.quillix-test', '.quillix-test-temp', '.qa-dist',
]);

/** True when a workspace-relative path must never enter a checkpoint. */
export function isCheckpointSkippablePath(relPath: string): boolean {
  const rel = relPath.replace(/\\/g, '/');
  const segments = rel.split('/').filter(Boolean);
  if (segments.some(segment => OMIT_DIRECTORIES.has(segment) || segment.startsWith('.test-tmp'))) return true;
  const base = segments[segments.length - 1]?.toLowerCase() ?? '';
  if (!base) return true;
  if (base.startsWith('.env') || base.endsWith('.key') || base.endsWith('.pem') ||
      base.endsWith('.p12') || base.endsWith('.pfx') || base.endsWith('.log')) return true;
  return /^(?:id_rsa|id_ed25519|id_ecdsa|secrets|credentials)(?:\.|$)/i.test(base);
}

/** Checkpoint names are labels only: bounded, single-line, no path characters. */
export function sanitizeCheckpointName(name: unknown): string {
  const cleaned = String(name ?? '').replace(/[\r\n\t]/g, ' ').replace(/[\\/:*?"<>|]/g, '-').trim();
  return cleaned.slice(0, CHECKPOINT_LIMITS.maxNameLength);
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export interface CheckpointFileMeta {
  filePath: string;
  bytes: number;
  hash: string;
  snapshot: string;
}

export interface CheckpointMeta {
  id: string;
  name: string;
  createdAt: number;
  root: string;
  fileCount: number;
  totalBytes: number;
  truncated: boolean;
  files: CheckpointFileMeta[];
}

export interface CheckpointSummary {
  id: string;
  name: string;
  createdAt: number;
  fileCount: number;
  totalBytes: number;
  truncated: boolean;
}

export interface CheckpointRestoreResult {
  success: boolean;
  restored: string[];
  conflicts: string[];
  error?: string;
}

export class CheckpointStore {
  constructor(private readonly workspace: WorkspaceManager) {}

  private root(): string {
    return this.workspace.getRoot();
  }

  private dir(id: string): string {
    return path.join(this.root(), '.quillix', 'checkpoints', id);
  }

  private metaPath(id: string): string {
    return path.join(this.dir(id), 'manifest.json');
  }

  private isSafeId(id: string): boolean {
    // Generated ids are `checkpoint_<base36>_<suffix>`; this still blocks any
    // path separator or traversal attempt.
    return /^checkpoint_[a-z0-9_]{6,48}$/.test(id);
  }

  /** Walk the workspace and write a bounded snapshot. */
  create(name: unknown): CheckpointSummary {
    const root = this.root();
    const id = `checkpoint_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const dir = this.dir(id);
    const filesDir = path.join(dir, 'files');
    fs.mkdirSync(filesDir, { recursive: true });
    const files: CheckpointFileMeta[] = [];
    let totalBytes = 0;
    let truncated = false;
    const visit = (current: string): void => {
      if (files.length >= CHECKPOINT_LIMITS.maxFiles || totalBytes >= CHECKPOINT_LIMITS.maxTotalBytes) { truncated = true; return; }
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        if (files.length >= CHECKPOINT_LIMITS.maxFiles || totalBytes >= CHECKPOINT_LIMITS.maxTotalBytes) { truncated = true; return; }
        const full = path.join(current, entry.name);
        const rel = path.relative(root, full).replace(/\\/g, '/');
        if (entry.isDirectory()) { if (!isCheckpointSkippablePath(rel)) visit(full); continue; }
        if (!entry.isFile() || entry.isSymbolicLink()) continue;
        if (isCheckpointSkippablePath(rel)) continue;
        if (fs.statSync(full).size > CHECKPOINT_LIMITS.maxFileBytes) { truncated = true; continue; }
        try {
          const content = fs.readFileSync(full, 'utf8');
          if (content.indexOf('\u0000') !== -1) continue; // binary: skip
          const bytes = Buffer.byteLength(content, 'utf8');
          if (totalBytes + bytes > CHECKPOINT_LIMITS.maxTotalBytes) { truncated = true; continue; }
          const snapshot = `files/${files.length}.snapshot`;
          fs.writeFileSync(path.join(dir, snapshot), content, 'utf8');
          files.push({ filePath: rel, bytes, hash: sha256(content), snapshot });
          totalBytes += bytes;
        } catch {
          // An unreadable file is skipped rather than failing the checkpoint.
        }
      }
    };
    visit(root);
    const meta: CheckpointMeta = {
      id,
      name: sanitizeCheckpointName(name) || `Checkpoint ${new Date().toLocaleString()}`,
      createdAt: Date.now(),
      root,
      fileCount: files.length,
      totalBytes,
      truncated,
      files,
    };
    fs.writeFileSync(this.metaPath(id), JSON.stringify(meta), 'utf8');
    return { id: meta.id, name: meta.name, createdAt: meta.createdAt, fileCount: meta.fileCount, totalBytes: meta.totalBytes, truncated: meta.truncated };
  }

  list(): CheckpointSummary[] {
    const dir = path.join(this.root(), '.quillix', 'checkpoints');
    if (!fs.existsSync(dir)) return [];
    const summaries: CheckpointSummary[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !this.isSafeId(entry.name)) continue;
      try {
        const meta = JSON.parse(fs.readFileSync(this.metaPath(entry.name), 'utf8')) as CheckpointMeta;
        summaries.push({ id: meta.id, name: meta.name, createdAt: meta.createdAt, fileCount: meta.fileCount, totalBytes: meta.totalBytes, truncated: meta.truncated });
      } catch {
        // A corrupt manifest is skipped, not fatal.
      }
    }
    return summaries.sort((a, b) => b.createdAt - a.createdAt).slice(0, CHECKPOINT_LIMITS.maxListed);
  }

  private readMeta(id: string): CheckpointMeta | null {
    if (!this.isSafeId(id)) return null;
    try {
      return JSON.parse(fs.readFileSync(this.metaPath(id), 'utf8')) as CheckpointMeta;
    } catch {
      return null;
    }
  }

  get(id: string): CheckpointMeta | null {
    const meta = this.readMeta(id);
    return meta ? { ...meta, files: meta.files.map(file => ({ ...file })) } : null;
  }

  /** Restore every captured file to its checkpoint contents. Returns which
   *  files were written and which were skipped (unreadable, outside the
   *  workspace, or secret paths). Files created after the checkpoint are left
   *  alone and reported, never deleted. */
  restore(id: string): CheckpointRestoreResult {
    const meta = this.readMeta(id);
    if (!meta) return { success: false, restored: [], conflicts: [], error: 'Checkpoint not found.' };
    const restored: string[] = [];
    const conflicts: string[] = [];
    try {
      for (const file of meta.files) {
        const absolute = path.resolve(this.root(), file.filePath);
        const relative = path.relative(this.root(), absolute);
        if (relative.startsWith('..') || path.isAbsolute(relative) || isCheckpointSkippablePath(file.filePath)) {
          conflicts.push(file.filePath);
          continue;
        }
        try {
          const content = fs.readFileSync(path.join(this.dir(id), file.snapshot), 'utf8');
          fs.mkdirSync(path.dirname(absolute), { recursive: true });
          fs.writeFileSync(absolute, content, 'utf8');
          restored.push(file.filePath);
        } catch {
          conflicts.push(file.filePath);
        }
      }
      return { success: conflicts.length === 0, restored, conflicts, error: conflicts.length ? `${conflicts.length} file(s) could not be restored.` : undefined };
    } catch (error: any) {
      return { success: false, restored, conflicts, error: `Restore failed: ${String(error?.message || error)}` };
    }
  }

  /** Unified diff between the checkpoint snapshot and the current file. */
  diff(id: string, filePath: string): { success: boolean; diff?: string; error?: string } {
    const meta = this.readMeta(id);
    if (!meta) return { success: false, error: 'Checkpoint not found.' };
    const file = meta.files.find(entry => entry.filePath === filePath.replace(/\\/g, '/'));
    if (!file) return { success: false, error: 'That file is not part of this checkpoint.' };
    try {
      const before = fs.readFileSync(path.join(this.dir(id), file.snapshot), 'utf8');
      const absolute = path.resolve(this.root(), file.filePath);
      const relative = path.relative(this.root(), absolute);
      if (relative.startsWith('..') || path.isAbsolute(relative)) return { success: false, error: 'Invalid file path.' };
      const after = fs.existsSync(absolute) ? fs.readFileSync(absolute, 'utf8') : '';
      const patch = createTwoFilesPatch(`checkpoint/${file.filePath}`, `workspace/${file.filePath}`, before, after, undefined, undefined, { context: 3 });
      return { success: true, diff: patch.length > CHECKPOINT_LIMITS.maxDiffChars ? patch.slice(0, CHECKPOINT_LIMITS.maxDiffChars) + '\n… [diff truncated]' : patch };
    } catch (error: any) {
      return { success: false, error: String(error?.message || error) };
    }
  }

  remove(id: string): { success: boolean; error?: string } {
    if (!this.isSafeId(id)) return { success: false, error: 'Invalid checkpoint id.' };
    try {
      fs.rmSync(this.dir(id), { recursive: true, force: true });
      return { success: true };
    } catch (error: any) {
      return { success: false, error: String(error?.message || error) };
    }
  }
}