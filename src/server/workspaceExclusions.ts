/**
 * Discovery-time exclusions for stale workspace trees and scratch artifacts.
 *
 * The agent builds its evidence by walking the workspace. Backup snapshots
 * (`_wip-backup-*`, `_checkpoints`) contain complete copies of live source
 * files, so indexing them lets an obsolete implementation outrank the real
 * code and can answer "where is X defined?" with a checkpoint path. Root
 * scratch helpers (`_probe2.mjs`, `_dbg.py`) are debugging leftovers and are
 * never product code.
 *
 * The rules are intentionally generic: every timestamped backup folder matches
 * without being enumerated one by one.
 */

/**
 * A directory segment that identifies a backup/snapshot tree.
 *
 * Matches `_wip-backup-2026-11-14`, `_wip-backup-2026-11-14-0425`,
 * `_checkpoints`, `_backup`, `_snapshot` and any other suffix of those names.
 * It deliberately does NOT match ordinary source directories such as
 * `src/server/__tests__`.
 */
const BACKUP_TREE_SEGMENT = /^_(?:wip[-_]?)?(?:backup|backups|checkpoints?|snapshots?)(?:[-_][\w.-]*)?$/i;

/** Extensions treated as source by the workspace scanners (mirrors sourceContext). */
const SOURCE_EXTENSION = /\.(?:[cm]?[jt]sx?|py|go|rs|java|[ch](?:pp)?|cs|php|rb|swift|kt|sql|vue|svelte|html?|css|scss|jsonc?|ya?ml|toml|md)$/i;

/** Normalize any platform path to a POSIX-style workspace-relative path. */
const posix = (file: string): string => String(file || '').replace(/\\/g, '/').replace(/^\.\//, '');

/**
 * True when a single directory entry name denotes a backup/snapshot tree.
 * Used by directory walkers that only know the entry name.
 */
export function isBackupTreeDirectory(name: string): boolean {
  return BACKUP_TREE_SEGMENT.test(String(name || ''));
}

/**
 * True for root-level scratch/debug helpers that happen to carry a source
 * extension (`_probe2.mjs`, `_dbg.py`). Only the workspace root is considered:
 * a nested `_something.ts` may still be legitimate product code, and
 * `__tests__` directories are legitimate source trees.
 */
export function isScratchSourceFile(relativePath: string): boolean {
  const segments = posix(relativePath).split('/');
  if (segments.length !== 1) return false;
  const base = segments[0];
  return base.startsWith('_') && SOURCE_EXTENSION.test(base);
}

/**
 * True when a workspace-relative path points into a backup tree or is a
 * root-level scratch helper. Such paths must never be returned as source
 * discovery results.
 */
export function isExcludedDiscoveryPath(relativePath: string): boolean {
  const segments = posix(relativePath).split('/');
  if (segments.some(isBackupTreeDirectory)) return true;
  return isScratchSourceFile(relativePath);
}
