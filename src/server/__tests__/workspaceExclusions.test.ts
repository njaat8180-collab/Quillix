import { describe, expect, it } from 'vitest';
import { isBackupTreeDirectory, isExcludedDiscoveryPath, isScratchSourceFile } from '../workspaceExclusions.js';

describe('workspace discovery exclusions', () => {
  it('matches every timestamped backup tree generically', () => {
    // The rule must not enumerate specific folders: each new snapshot created
    // by a future session has to be excluded without a code change.
    for (const name of [
      '_wip-backup-2026-11-14',
      '_wip-backup-2026-11-14-0425',
      '_wip-backup-2026-12-01-2359',
      '_wip_backup-2099-01-01',
      '_backup',
      '_backups',
      '_backup-anything',
      '_checkpoint',
      '_checkpoints',
      '_snapshot',
      '_snapshots',
    ]) {
      expect(isBackupTreeDirectory(name), name).toBe(true);
    }
  });

  it('does not treat ordinary source directories as backup trees', () => {
    for (const name of [
      'src',
      'server',
      '__tests__',
      'src/server/__tests__',
      'components',
      'scripts',
      'public',
      'docs',
      'backup',
      'backups',
      'my_backups',
    ]) {
      expect(isBackupTreeDirectory(name), name).toBe(false);
    }
  });

  it('flags only root-level scratch helpers that carry a source extension', () => {
    expect(isScratchSourceFile('_probe2.mjs')).toBe(true);
    expect(isScratchSourceFile('_dbg.py')).toBe(true);
    expect(isScratchSourceFile('_dbg3.py')).toBe(true);

    // `.txt` is not a source extension, so such a file was never a discovery
    // candidate in the first place and needs no scratch rule.
    expect(isScratchSourceFile('_scan.txt')).toBe(false);

    // Real product code must never be treated as scratch.
    expect(isScratchSourceFile('server.ts')).toBe(false);
    expect(isScratchSourceFile('src/server/_internal.ts')).toBe(false);
    expect(isScratchSourceFile('src/server/__tests__/helper.ts')).toBe(false);
    expect(isScratchSourceFile('package.json')).toBe(false);
  });

  it('rejects any path that leads into a backup tree', () => {
    expect(isExcludedDiscoveryPath('_wip-backup-2026-11-14-0425/live.ts')).toBe(true);
    expect(isExcludedDiscoveryPath('_wip-backup-2026-11-14-0425/untracked/src/live.ts')).toBe(true);
    expect(isExcludedDiscoveryPath('_checkpoints/INCIDENT/live.ts')).toBe(true);
    expect(isExcludedDiscoveryPath('nested/_backup/live.ts')).toBe(true);
    expect(isExcludedDiscoveryPath('_probe2.mjs')).toBe(true);

    expect(isExcludedDiscoveryPath('src/live.ts')).toBe(false);
    expect(isExcludedDiscoveryPath('src/server/__tests__/helper.ts')).toBe(false);
  });
});
