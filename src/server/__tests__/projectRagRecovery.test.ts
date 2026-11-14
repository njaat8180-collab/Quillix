import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ProjectRag } from '../projectRag.js';

// M9.2 — corrupt / stale / structurally-invalid / missing RAG index recovery.
// Roadmap acceptance: "delete .quillix/index -> auto-rebuild on next open". The
// RAG index is a rebuildable cache, so a bad on-disk index must never break
// retrieval: ProjectRag must silently rebuild from source and re-persist a valid
// index of the current version. loadIndex already guards JSON.parse + version +
// shape; these tests lock that behavior against regression.
describe('project RAG corrupt index recovery', () => {
  const roots: string[] = [];
  const makeRoot = () => {
    const root = fs.mkdtempSync(path.join(process.cwd(), '.test-tmp-rag-recovery-'));
    roots.push(root);
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'checkout.ts'),
      'export function updatedCheckoutTotal(cents: number) { return cents + 1199; }');
    return root;
  };
  const indexPathFor = (root: string) => path.join(root, '.quillix', 'rag-index.json');
  const writeIndexRaw = (root: string, contents: string) => {
    fs.mkdirSync(path.dirname(indexPathFor(root)), { recursive: true });
    fs.writeFileSync(indexPathFor(root), contents, 'utf8');
  };
  afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

  it('rebuilds and re-persists a valid index when the on-disk index is not valid JSON', () => {
    const root = makeRoot();
    writeIndexRaw(root, '{ this is : not json ]');

    const result = new ProjectRag(root).retrieve('updatedCheckoutTotal calculation', { maxChars: 1600, maxChunks: 2 });

    expect(result.files).toContain('src/checkout.ts');
    expect(result.context).toContain('updatedCheckoutTotal');
    const persisted = JSON.parse(fs.readFileSync(indexPathFor(root), 'utf8'));
    expect(persisted.version).toBe(7);
    expect(Array.isArray(persisted.chunks)).toBe(true);
    expect(persisted.chunks.some((chunk: { file: string }) => chunk.file === 'src/checkout.ts')).toBe(true);
  });

  it('rebuilds when a persisted index has an outdated version', () => {
    const root = makeRoot();
    writeIndexRaw(root, JSON.stringify({ version: 1, files: {}, chunks: [] }));

    const result = new ProjectRag(root).retrieve('updatedCheckoutTotal calculation', { maxChars: 1600, maxChunks: 2 });

    expect(result.context).toContain('updatedCheckoutTotal');
    expect(JSON.parse(fs.readFileSync(indexPathFor(root), 'utf8')).version).toBe(7);
  });

  it('rebuilds when a persisted index is structurally invalid (chunks is not an array)', () => {
    const root = makeRoot();
    writeIndexRaw(root, JSON.stringify({ version: 7, files: {}, chunks: 'not-an-array' }));

    const result = new ProjectRag(root).retrieve('updatedCheckoutTotal calculation', { maxChars: 1600, maxChunks: 2 });

    expect(result.context).toContain('updatedCheckoutTotal');
    const persisted = JSON.parse(fs.readFileSync(indexPathFor(root), 'utf8'));
    expect(Array.isArray(persisted.chunks)).toBe(true);
    expect(persisted.chunks.some((chunk: { file: string }) => chunk.file === 'src/checkout.ts')).toBe(true);
  });

  it('auto-rebuilds on next open after the index file is deleted', () => {
    const root = makeRoot();
    const first = new ProjectRag(root).retrieve('updatedCheckoutTotal calculation', { maxChars: 1600, maxChunks: 2 });
    expect(first.context).toContain('updatedCheckoutTotal');
    expect(fs.existsSync(indexPathFor(root))).toBe(true);

    // Simulate "delete .quillix/index -> reopen".
    fs.rmSync(indexPathFor(root), { force: true });
    const resumed = new ProjectRag(root).retrieve('updatedCheckoutTotal calculation', { maxChars: 1600, maxChunks: 2 });

    expect(resumed.files).toContain('src/checkout.ts');
    expect(resumed.context).toContain('updatedCheckoutTotal');
    expect(fs.existsSync(indexPathFor(root))).toBe(true);
  });
});
