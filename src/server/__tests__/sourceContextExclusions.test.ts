import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SourceContextRetriever } from '../sourceContext.js';
import { WorkspaceManager } from '../workspace.js';

// M1.4 regression: agent checkpoint backups and build output must never enter
// the ranked codebase evidence. Before the fix, a `_checkpoints/` copy of a
// server file outranked the live source, so "where is X defined" pointed at a
// stale backup instead of the file the user edits.
const tempRoots: string[] = [];

function makeWorkspace(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-source-context-'));
  tempRoots.push(root);
  for (const [relative, content] of Object.entries(files)) {
    const full = path.join(root, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf8');
  }
  return root;
}

afterEach(() => {
  while (tempRoots.length) {
    const root = tempRoots.pop();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('source context exclusions', () => {
  it('never retrieves agent checkpoint backups, build output or dependencies', () => {
    const root = makeWorkspace({
      'src/live.ts': 'export function findMe() {\n  return "live source";\n}\n',
      '_checkpoints/INCIDENT/live.ts': 'export function findMe() {\n  return "stale backup";\n}\n',
      '_checkpoints/INCIDENT/notes.md': 'backup of the incident\n',
      'dist/bundle.js': 'function findMe(){return "built artifact"}\n',
      'node_modules/leftpad/index.js': 'module.exports = function findMe(){ return 1 }\n',
      'build/app.ts': 'export function findMe() { return "build output" }\n',
    });
    const report = new SourceContextRetriever(new WorkspaceManager(root)).retrieve('where is findMe defined');

    expect(report.files).toContain('src/live.ts');
    expect(report.files.some(file => file.includes('_checkpoints'))).toBe(false);
    expect(report.files.some(file => file.startsWith('dist/'))).toBe(false);
    expect(report.files.some(file => file.startsWith('node_modules/'))).toBe(false);
    expect(report.files.some(file => file.startsWith('build/'))).toBe(false);
    expect(report.context).not.toContain('stale backup');
    expect(report.context).not.toContain('built artifact');
    expect(report.context).not.toContain('backup of the incident');
    expect(report.context).toContain('live source');
  });

  it('keeps answering from live source when a checkpoint copy would otherwise outrank it', () => {
    const root = makeWorkspace({
      'src/server/widget.ts': 'export class Widget {\n  render() { return 1; }\n}\n',
      '_checkpoints/widget-before-refactor.ts': 'export class Widget {\n  render() { return 0; }\n}\n',
    });
    const report = new SourceContextRetriever(new WorkspaceManager(root)).retrieve('Widget render');

    expect(report.files).toEqual(['src/server/widget.ts']);
    expect(report.context).toContain('return 1');
    expect(report.context).not.toContain('return 0');
  });

  it('excludes release and cache directories as well', () => {
    const root = makeWorkspace({
      'src/entry.ts': 'export const entry = true;\n',
      'release/installer/entry.ts': 'export const entry = "packaged";\n',
      '.vite/deps/entry.ts': 'export const entry = "cached";\n',
      'out/entry.ts': 'export const entry = "compiled";\n',
    });
    const report = new SourceContextRetriever(new WorkspaceManager(root)).retrieve('entry');

    expect(report.files).toEqual(['src/entry.ts']);
    expect(report.context).not.toContain('packaged');
    expect(report.context).not.toContain('cached');
    expect(report.context).not.toContain('compiled');
  });

  it('never retrieves backup snapshot trees or root-level debug helpers', () => {
    // Regression: `_wip-backup-*` trees hold complete copies of live source
    // files. Before the fix they were walked like ordinary directories, so a
    // stale implementation could outrank the real code and produce
    // file:line answers pointing at obsolete code.
    const root = makeWorkspace({
      'src/live.ts': 'export function findMe() {\n  return "live source";\n}\n',
      '_wip-backup-2026-11-14/live.ts': 'export function findMe() {\n  return "stale wip backup";\n}\n',
      '_wip-backup-2026-11-14-0425/live.ts': 'export function findMe() {\n  return "stale timestamped backup";\n}\n',
      '_wip-backup-2026-11-14-0425/untracked/src/live.ts': 'export function findMe() {\n  return "stale nested backup";\n}\n',
      '_backup/live.ts': 'export function findMe() {\n  return "generic backup";\n}\n',
      '_probe2.mjs': 'export function findMe() { return "root debug helper"; }\n',
      '_dbg.py': 'def find_me():\n    return "root python debug helper"\n',
    });
    const report = new SourceContextRetriever(new WorkspaceManager(root)).retrieve('where is findMe defined');

    expect(report.files).toContain('src/live.ts');
    expect(report.files.some(file => file.includes('_wip-backup'))).toBe(false);
    expect(report.files.some(file => file.includes('_backup'))).toBe(false);
    expect(report.files.some(file => file.startsWith('_probe2.mjs'))).toBe(false);
    expect(report.files.some(file => file.startsWith('_dbg.py'))).toBe(false);
    expect(report.context).toContain('live source');
    expect(report.context).not.toContain('stale wip backup');
    expect(report.context).not.toContain('stale timestamped backup');
    expect(report.context).not.toContain('stale nested backup');
    expect(report.context).not.toContain('generic backup');
    expect(report.context).not.toContain('root debug helper');
    expect(report.context).not.toContain('root python debug helper');
  });

  it('rejects an explicitly named backup path instead of trusting it', () => {
    const root = makeWorkspace({
      'src/live.ts': 'export function findMe() {\n  return "live source";\n}\n',
      '_wip-backup-2026-11-14-0425/live.ts': 'export function findMe() {\n  return "stale named backup";\n}\n',
    });
    const report = new SourceContextRetriever(new WorkspaceManager(root)).retrieve('_wip-backup-2026-11-14-0425/live.ts findMe');

    expect(report.files.some(file => file.includes('_wip-backup'))).toBe(false);
    expect(report.context).not.toContain('stale named backup');
  });

  it('still returns legitimate underscore source paths', () => {
    // `__tests__` directories and nested underscore files are real product
    // code; the exclusion rules must not swallow them.
    const root = makeWorkspace({
      'src/server/__tests__/helper.ts': 'export const helper = true;\n',
      'src/server/_internal.ts': 'export const internal = true;\n',
    });
    const report = new SourceContextRetriever(new WorkspaceManager(root)).retrieve('helper internal');

    expect(report.files).toContain('src/server/__tests__/helper.ts');
    expect(report.files).toContain('src/server/_internal.ts');
  });
});