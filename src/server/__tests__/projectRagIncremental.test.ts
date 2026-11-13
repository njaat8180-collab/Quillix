import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProjectRag } from '../projectRag.js';

// M1.5: incremental re-index. Editing one file must re-read exactly that file
// (chunks for every other file are reused), an explicit invalidation must force
// a re-read even when mtime/size did not change, and deletions must disappear
// from retrieval.
let root: string;
const roots: string[] = [];

const write = (relative: string, content: string) => {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
};

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-rag-incremental-'));
  roots.push(root);
});

afterEach(() => {
  for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('incremental re-index (M1.5)', () => {
  it('builds the index once, then reuses every cached file on the next retrieval', () => {
    write('alpha.ts', 'export const alphaToken = 1;\nexport function alphaHelper() { return alphaToken; }\n');
    write('beta.ts', 'export const betaToken = 2;\n');
    write('gamma.py', 'def gamma_helper():\n    return 3\n');
    const rag = new ProjectRag(root);
    rag.retrieve('alpha beta gamma', { maxChunks: 8 });

    const first = rag.status();
    expect(first.files).toBeGreaterThanOrEqual(3);
    expect(first.cachedFiles).toBe(0);
    expect(first.reindexedFiles).toBe(first.files);

    rag.retrieve('alpha beta gamma', { maxChunks: 8 });
    const second = rag.status();
    expect(second.cachedFiles).toBe(first.files);
    expect(second.reindexedFiles).toBe(0);
  });

  it('re-reads only the edited file after a single-file change', () => {
    const files = Array.from({ length: 8 }, (_, i) => `mod_${i}.ts`);
    files.forEach((file, i) => write(file, `export const value_${i} = ${i};\n`));
    const rag = new ProjectRag(root);
    rag.retrieve('mod_0 mod_7', { maxChunks: 8 });
    const baseline = rag.status();
    expect(baseline.reindexedFiles).toBe(files.length);

    write('mod_3.ts', 'export const value_3 = 3333;\nexport const extra_3 = "added";\n');
    const after = rag.retrieve('mod_3 extra_3', { maxChunks: 8 });

    const refreshed = rag.status();
    expect(refreshed.reindexedFiles).toBe(1);
    expect(refreshed.cachedFiles).toBe(files.length - 1);
    expect(after.context).toContain('extra_3');
    expect(after.files).toContain('mod_3.ts');
  });

  it('forces a re-read of one file through invalidate() even when metadata is unchanged', () => {
    write('stable.ts', 'export const first = 1;\n');
    write('other.ts', 'export const second = 2;\n');
    const rag = new ProjectRag(root);
    rag.retrieve('first second', { maxChunks: 8 });
    expect(rag.status().reindexedFiles).toBe(2);

    // Rewrite identical content and restore mtime, so only an explicit
    // invalidation can guarantee the index sees fresh bytes.
    const before = fs.statSync(path.join(root, 'stable.ts')).mtimeMs;
    write('stable.ts', 'export const first = 1;\n');
    fs.utimesSync(path.join(root, 'stable.ts'), new Date(before), new Date(before));

    expect(rag.invalidate('stable.ts')).toBe(1);
    expect(rag.status().reindexedFiles).toBe(1);

    const refreshed = rag.retrieve('first second', { maxChunks: 8 });
    expect(refreshed.context).toContain('export const first = 1;');
    expect(rag.status().reindexedFiles).toBe(1);
    expect(rag.status().cachedFiles).toBe(1);
  });

  it('drops a deleted file from the index', () => {
    write('keep.ts', 'export const keepToken = 1;\n');
    write('doomed.ts', 'export const doomedToken = 2;\n');
    const rag = new ProjectRag(root);
    rag.retrieve('keepToken doomedToken', { maxChunks: 8 });
    expect(rag.status().files).toBe(2);

    fs.rmSync(path.join(root, 'doomed.ts'));
    const result = rag.retrieve('doomedToken', { maxChunks: 8 });
    expect(rag.status().files).toBe(1);
    expect(result.files).not.toContain('doomed.ts');
    expect(result.context).not.toContain('doomedToken');
  });

  it('invalidating everything forces one full rebuild, then caching resumes', () => {
    write('one.ts', 'export const one = 1;\n');
    write('two.ts', 'export const two = 2;\n');
    const rag = new ProjectRag(root);
    rag.retrieve('one two', { maxChunks: 8 });

    expect(rag.invalidate()).toBe(2);
    expect(rag.status().files).toBe(0);
    const rebuilt = rag.retrieve('one two', { maxChunks: 8 });
    expect(rebuilt.files.length).toBe(2);
    expect(rag.status().reindexedFiles).toBe(2);
    expect(rag.status().cachedFiles).toBe(0);

    rag.retrieve('one two', { maxChunks: 8 });
    expect(rag.status().cachedFiles).toBe(2);
  });

  it('keeps the persisted index consistent so a restart does not rebuild everything', () => {
    write('persist.ts', 'export const persistToken = 1;\n');
    write('sibling.ts', 'export const siblingToken = 2;\n');
    const first = new ProjectRag(root);
    first.retrieve('persistToken siblingToken', { maxChunks: 8 });

    const reloaded = new ProjectRag(root);
    reloaded.retrieve('persistToken siblingToken', { maxChunks: 8 });
    const status = reloaded.status();
    expect(status.cachedFiles).toBe(2);
    expect(status.reindexedFiles).toBe(0);
  });

  it('re-indexes a large workspace incrementally (one file), not by rebuilding', () => {
    const total = 160;
    for (let i = 0; i < total; i += 1) write(`bulk_${i}.ts`, `export const bulk_${i} = ${i};\nexport function helper_${i}() { return bulk_${i}; }\n`);
    const rag = new ProjectRag(root);
    rag.retrieve('bulk helper', { maxChunks: 8 });
    const first = rag.status();
    expect(first.files).toBe(total);
    expect(first.reindexedFiles).toBe(total);

    write('bulk_77.ts', 'export const bulk_77 = 770077;\nexport const lateEdit = true;\n');
    const startedAt = Date.now();
    const after = rag.retrieve('lateEdit bulk', { maxChunks: 8 });
    const elapsedMs = Date.now() - startedAt;

    // Exactly one file is re-read: this is incremental, not a rebuild.
    expect(rag.status().reindexedFiles).toBe(1);
    expect(rag.status().cachedFiles).toBe(total - 1);
    expect(after.context).toContain('lateEdit');
    // Generous wall-clock guard: the host is slow and may be loaded.
    expect(elapsedMs).toBeLessThan(8000);
  });
});
