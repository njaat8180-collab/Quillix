import fs from 'node:fs';
import path from 'node:path';
import { isPreviewAssetAllowed } from './previewSafety.js';

export type PreviewSessionStatus = 'starting' | 'ready' | 'stopped' | 'failed';

export interface PreviewSessionInfo {
  id: string;
  root: string;
  entry: string;
  status: PreviewSessionStatus;
  error?: string;
  startedAt: number;
  endedAt?: number;
}

export function validatePreviewEntry(root: string, rawEntry: unknown): { ok: true; entry: string; fullPath: string } | { ok: false; error: string } {
  if (typeof rawEntry !== 'string' || !rawEntry.trim()) return { ok: false, error: 'Preview entry file is required.' };
  const entry = path.posix.normalize(rawEntry.trim().replace(/\\/g, '/')).replace(/^\.\//, '');
  if (!entry || entry === '.' || entry.startsWith('../') || entry === '..' || entry.startsWith('/') || !isPreviewAssetAllowed(entry)) {
    return { ok: false, error: 'Preview entry must be a project-local HTML file.' };
  }
  if (!/\.html?$/i.test(entry)) return { ok: false, error: 'Preview entry must be an HTML file.' };
  const fullPath = path.resolve(root, ...entry.split('/'));
  const relative = path.relative(path.resolve(root), fullPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return { ok: false, error: 'Preview entry escapes the project.' };
  try {
    if (!fs.statSync(fullPath).isFile()) return { ok: false, error: `Preview entry is not a file: ${entry}` };
  } catch {
    return { ok: false, error: `Preview entry was not found: ${entry}` };
  }
  return { ok: true, entry, fullPath };
}

export class PreviewSessionService {
  private readonly sessions = new Map<string, PreviewSessionInfo>();
  private readonly activeByTarget = new Map<string, string>();

  constructor(private readonly isServerReady: () => boolean = () => true) {}

  start(root: string, entry: string, validationError?: string): PreviewSessionInfo | { error: string } {
    if (!this.isServerReady()) return { error: 'Preview server is unavailable. Check for a local port conflict and restart QUILLIX.' };
    if (validationError) return { error: validationError };
    const target = `${path.resolve(root)}\0${entry}`;
    const existingId = this.activeByTarget.get(target);
    if (existingId) return this.publicInfo(this.sessions.get(existingId)!);
    const info: PreviewSessionInfo = {
      id: `preview_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      root: path.resolve(root),
      entry,
      status: 'ready',
      startedAt: Date.now(),
    };
    this.sessions.set(info.id, info);
    this.activeByTarget.set(target, info.id);
    return this.publicInfo(info);
  }

  status(id: string): PreviewSessionInfo | undefined {
    const info = this.sessions.get(id);
    return info ? this.publicInfo(info) : undefined;
  }

  stop(id: string): boolean {
    const info = this.sessions.get(id);
    if (!info || info.status === 'stopped') return false;
    info.status = 'stopped';
    info.endedAt = Date.now();
    this.activeByTarget.delete(`${info.root}\0${info.entry}`);
    return true;
  }

  stopAll(): void {
    for (const id of this.sessions.keys()) this.stop(id);
  }

  private publicInfo(info: PreviewSessionInfo): PreviewSessionInfo {
    return { ...info };
  }
}
