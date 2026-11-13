import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CheckpointStore, isCheckpointSkippablePath, sanitizeCheckpointName } from '../checkpoints.js';
import { WorkspaceManager } from '../workspace.js';

describe('named checkpoints (M4.4)', () => {
  let root: string;
  let store: CheckpointStore;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(process.cwd(), '.test-tmp-checkpoints-'));
    store = new CheckpointStore(new WorkspaceManager(root));
    fs.writeFileSync(path.join(root, 'app.ts'), 'export const version = 1;\n');
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'util.ts'), 'export const helper = () => 1;\n');
  });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it('sanitizes names and skips secret or generated paths', () => {
    expect(sanitizeCheckpointName('  Before refactor  ')).toBe('Before refactor');
    expect(sanitizeCheckpointName('a/b\\c:d*e?f"g<h>i|j')).toBe('a-b-c-d-e-f-g-h-i-j');
    expect(sanitizeCheckpointName('x'.repeat(200)).length).toBe(64);
    expect(sanitizeCheckpointName(undefined)).toBe('');
    expect(isCheckpointSkippablePath('.env')).toBe(true);
    expect(isCheckpointSkippablePath('config/secrets.json')).toBe(true);
    expect(isCheckpointSkippablePath('certs/localhost.pem')).toBe(true);
    expect(isCheckpointSkippablePath('node_modules/x/index.js')).toBe(true);
    expect(isCheckpointSkippablePath('dist/bundle.js')).toBe(true);
    expect(isCheckpointSkippablePath('.quillix/rag-index.json')).toBe(true);
    expect(isCheckpointSkippablePath('.test-tmp-coding-workflow-abc/x.ts')).toBe(true);
    expect(isCheckpointSkippablePath('output.log')).toBe(true);
    expect(isCheckpointSkippablePath('src/app.ts')).toBe(false);
    expect(isCheckpointSkippablePath('README.md')).toBe(false);
  });

  it('creates a bounded snapshot that never contains secrets or generated dirs', () => {
    fs.writeFileSync(path.join(root, '.env'), 'SECRET=do-not-capture');
    fs.mkdirSync(path.join(root, 'node_modules', 'pkg'), { recursive: true });
    fs.writeFileSync(path.join(root, 'node_modules', 'pkg', 'index.js'), 'module.exports = 1;');
    const summary = store.create('Before refactor');
    expect(summary.name).toBe('Before refactor');
    expect(summary.fileCount).toBe(2); // app.ts + src/util.ts only
    expect(summary.truncated).toBe(false);
    const meta = store.get(summary.id)!;
    expect(meta.files.map(f => f.filePath).sort()).toEqual(['app.ts', 'src/util.ts']);
    expect(meta.files.every(f => /^[a-f0-9]{64}$/.test(f.hash))).toBe(true);
    // Snapshots live under the workspace .quillix volume.
    expect(fs.existsSync(path.join(root, '.quillix', 'checkpoints', summary.id, 'manifest.json'))).toBe(true);
  });

  it('lists newest first and is bounded', () => {
    const first = store.create('one');
    const second = store.create('two');
    const list = store.list();
    expect(list.map(c => c.id)).toEqual([second.id, first.id]);
    expect(list[0].name).toBe('two');
    // Unknown/corrupt ids are ignored, not fatal.
    fs.mkdirSync(path.join(root, '.quillix', 'checkpoints', 'not-a-checkpoint'), { recursive: true });
    expect(store.list()).toHaveLength(2);
  });

  it('restores captured files to their checkpoint contents', () => {
    const created = store.create('Before refactor');
    fs.writeFileSync(path.join(root, 'app.ts'), 'export const version = 2; // broken\n');
    fs.writeFileSync(path.join(root, 'src', 'util.ts'), 'export const helper = () => 2;\n');
    const result = store.restore(created.id);
    expect(result.success).toBe(true);
    expect(result.restored.sort()).toEqual(['app.ts', 'src/util.ts']);
    expect(fs.readFileSync(path.join(root, 'app.ts'), 'utf8')).toBe('export const version = 1;\n');
    expect(fs.readFileSync(path.join(root, 'src', 'util.ts'), 'utf8')).toBe('export const helper = () => 1;\n');
  });

  it('leaves files created after the checkpoint untouched and reports them', () => {
    const created = store.create('snapshot');
    fs.writeFileSync(path.join(root, 'app.ts'), 'changed\n');
    fs.writeFileSync(path.join(root, 'later.ts'), 'new file\n');
    const result = store.restore(created.id);
    expect(result.restored).toContain('app.ts');
    expect(result.restored).not.toContain('later.ts');
    expect(fs.readFileSync(path.join(root, 'later.ts'), 'utf8')).toBe('new file\n');
  });

  it('diffs a captured file against the current workspace state', () => {
    const created = store.create('before');
    fs.writeFileSync(path.join(root, 'app.ts'), 'export const version = 2;\n');
    const diff = store.diff(created.id, 'app.ts');
    expect(diff.success).toBe(true);
    expect(diff.diff).toContain('-export const version = 1;');
    expect(diff.diff).toContain('+export const version = 2;');
    expect(store.diff(created.id, 'missing.ts').success).toBe(false);
    expect(store.diff('checkpoint_doesnotexist', 'app.ts').success).toBe(false);
  });

  it('rejects unknown ids for restore/remove and removes cleanly', () => {
    expect(store.restore('checkpoint_nope').success).toBe(false);
    expect(store.remove('checkpoint_nope').success).toBe(false);
    expect(store.remove('../escape').success).toBe(false);
    const created = store.create('temp');
    expect(store.remove(created.id).success).toBe(true);
    expect(store.list()).toHaveLength(0);
    // The snapshots themselves are gone, not just the manifest.
    expect(fs.existsSync(path.join(root, '.quillix', 'checkpoints', created.id))).toBe(false);
  });
});
