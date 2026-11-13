import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { collectEditorProject, EDITOR_PROJECT_LIMITS } from '../editorProject.js';
import { WorkspaceManager } from '../workspace.js';
import { mergeEditorSources } from '../../services/editorIntelligence.js';

describe('bounded editor project source context', () => {
  let root: string;
  const write = (name: string, content: string) => {
    const destination = path.join(root, name);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, content);
  };
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-editor-project-')); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it('loads unopened nested JS/TS modules and redacts embedded credentials', async () => {
    write('src/money.ts', 'export const toCents = (n: number) => Math.round(n * 100);');
    write('src/main.mjs', 'const token = "not-a-real-secret-value";');
    write('src/app.cts', 'export const x = 1;');
    const result = await collectEditorProject(new WorkspaceManager(root));
    expect(result.files.map(file => file.filePath)).toEqual(['src/app.cts', 'src/main.mjs', 'src/money.ts']);
    expect(result.files[1].content).not.toContain('not-a-real-secret-value');
    expect(result.limited).toBe(false);
  });
  it('excludes dependencies, hidden/protected files, binary content and oversized sources', async () => {
    write('node_modules/dep/index.ts', 'export const secret = 1');
    write('.private/config.ts', 'const privateData = 1');
    write('dist/bundle.js', 'const generated = 1');
    write('credentials.ts', 'const token = "private-value"');
    write('binary.ts', '\0not source');
    write('huge.ts', 'x'.repeat(EDITOR_PROJECT_LIMITS.fileBytes + 1));
    write('real.ts', 'export const okay = true;');
    const result = await collectEditorProject(new WorkspaceManager(root));
    expect(result.files.map(file => file.filePath)).toEqual(['real.ts']);
    expect(result.limited).toBe(true);
  });
  it('bounds source count and total returned bytes', async () => {
    for (let i = 0; i < EDITOR_PROJECT_LIMITS.files + 4; i++) write(`file${i}.ts`, 'export const n = 1;');
    const result = await collectEditorProject(new WorkspaceManager(root));
    expect(result.files).toHaveLength(EDITOR_PROJECT_LIMITS.files);
    expect(result.readBytes).toBeLessThanOrEqual(EDITOR_PROJECT_LIMITS.totalBytes);
    expect(result.limited).toBe(true);
  });
  it('stops at the cumulative byte budget even below the file count limit', async () => {
    for (let i = 0; i < 35; i++) write(`module${i}.ts`, 'x'.repeat(EDITOR_PROJECT_LIMITS.fileBytes));
    const result = await collectEditorProject(new WorkspaceManager(root));
    expect(result.readBytes).toBe(EDITOR_PROJECT_LIMITS.totalBytes);
    expect(result.files).toHaveLength(32);
    expect(result.limited).toBe(true);
  });
  it('refreshes modified/deleted files and stays bound to the requested workspace', async () => {
    write('a.ts', 'export const n = 1;');
    const workspace = new WorkspaceManager(root);
    expect((await collectEditorProject(workspace)).files[0].content).toContain('1');
    write('a.ts', 'export const n = 2;');
    expect((await collectEditorProject(workspace)).files[0].content).toContain('2');
    fs.unlinkSync(path.join(root, 'a.ts'));
    expect((await collectEditorProject(workspace)).files).toEqual([]);
    write('other/a.ts', 'export const n = 3;');
    const pending = collectEditorProject(workspace);
    workspace.setRoot(path.join(root, 'other'));
    expect((await pending).root).toBe(root);
  });
  it('skips linked directories even when their contents are source code', async ({ skip }) => {
    write('original/a.ts', 'export const n = 1;');
    try {
      fs.symlinkSync(path.join(root, 'original'), path.join(root, 'alias'), process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error: any) {
      if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code)) return skip('Symlink creation is restricted by this environment.');
      throw error;
    }
    const result = await collectEditorProject(new WorkspaceManager(root));
    expect(result.files.map(file => file.filePath)).toEqual(['original/a.ts']);
  });
  it('keeps unsaved open buffers authoritative over project snapshots', () => {
    const merged = mergeEditorSources([{ filePath: 'a.ts', content: 'old' }, { filePath: 'b.ts', content: 'dependency' }], [{ filePath: 'a.ts', content: 'unsaved' }]);
    expect(merged).toEqual([{ filePath: 'a.ts', content: 'unsaved' }, { filePath: 'b.ts', content: 'dependency' }]);
  });
});
