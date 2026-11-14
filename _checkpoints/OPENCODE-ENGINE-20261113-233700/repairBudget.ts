/**
 * One shared, bounded budget for validation and runtime self-repair.
 * A retry is not a success: only a changed file followed by passing checks
 * may close an error. Consecutive no-change attempts stop expensive loops.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const MAX_AUTOMATIC_REPAIR_ATTEMPTS = 20;

export class RepairBudget {
  public attempts = 0;
  public stagnantAttempts = 0;
  public readonly maxAttempts: number;
  private readonly maxStagnantAttempts: number;

  constructor(maxAttempts = MAX_AUTOMATIC_REPAIR_ATTEMPTS, maxStagnantAttempts = 2) {
    this.maxAttempts = maxAttempts;
    this.maxStagnantAttempts = maxStagnantAttempts;
  }

  public canAttempt(): boolean {
    return this.attempts < this.maxAttempts && this.stagnantAttempts < this.maxStagnantAttempts;
  }

  public claimAttempt(): number | null {
    if (!this.canAttempt()) return null;
    return ++this.attempts;
  }

  public observeFileChanges(before: string, after: string): boolean {
    const changed = before !== after;
    this.stagnantAttempts = changed ? 0 : this.stagnantAttempts + 1;
    return changed;
  }

  public stopReason(): string {
    if (this.attempts >= this.maxAttempts) return `Reached ${this.maxAttempts} repair attempts`;
    if (this.stagnantAttempts >= this.maxStagnantAttempts) return 'Stopped because consecutive repair attempts made no file changes';
    return '';
  }
}

/** Hash real file bytes (not timestamps) to detect ineffective rewrites. */
export function fingerprintWrittenFiles(workspaceRoot: string, paths: Iterable<string>): string {
  const hash = createHash('sha256');
  const root = path.resolve(workspaceRoot);
  let rootReal: string;
  try { rootReal = fs.realpathSync(root); } catch { return hash.digest('hex'); }
  for (const rel of [...paths].sort()) {
    const full = path.resolve(root, rel);
    const inside = path.relative(root, full);
    if (inside.startsWith('..') || path.isAbsolute(inside)) continue;
    if (/(^|[\\/])\.env(?:\.|$)/i.test(rel) || /\.(?:pem|key|pfx|p12)$/i.test(rel)) continue;
    hash.update(rel);
    try {
      const targetReal = fs.realpathSync(full);
      if (targetReal !== rootReal && !targetReal.startsWith(rootReal + path.sep)) {
        hash.update('outside-symlink');
        continue;
      }
      const stat = fs.statSync(full);
      if (!stat.isFile()) { hash.update('not-file'); continue; }
      hash.update(fs.readFileSync(full));
    } catch {
      hash.update('missing');
    }
  }
  return hash.digest('hex');
}
