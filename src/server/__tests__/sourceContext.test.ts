import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SourceContextRetriever } from '../sourceContext.js';
import { WorkspaceManager } from '../workspace.js';
import { CodebaseIndexer } from '../indexer.js';
import { GitService } from '../git.js';
import { TerminalService } from '../terminal.js';

describe('bounded local source retrieval', () => {
  let root: string, workspace: WorkspaceManager, retriever: SourceContextRetriever;
  const write = (file: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  };
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-retrieval-'));
    workspace = new WorkspaceManager(root);
    retriever = new SourceContextRetriever(workspace);
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('finds identifiers inside source even when the filename has no matching word', () => {
    write('src/a.ts', 'export function calculateInvoiceTotal(items: number[]) { return items.reduce((a,b) => a+b,0); }');
    write('docs/invoice.md', 'Invoice instructions.');
    const result = retriever.retrieve('Fix calculateInvoiceTotal rounding');
    expect(result.files[0]).toBe('src/a.ts');
    expect(result.context).toContain('export function calculateInvoiceTotal');
  });

  it('keeps nested project excerpts, rules and editor selections inside the target', () => {
    write('Store/src/app.ts', 'export const scopedSource = true;');
    write('Store/AGENTS.md', 'Nested project rules');
    write('Sibling/src/app.ts', 'export const siblingSource = true;');
    write('AGENTS.md', 'Parent workspace rules');
    const indexer = new CodebaseIndexer(workspace, new GitService(new TerminalService()));
    const scoped = indexer.getScopedProjectContext('Store', 'Inspect Store/src/app.ts', 'Store/src/app.ts', 'selected code');
    expect(scoped.root).toBe(path.join(root, 'Store'));
    expect(scoped.context).toContain('CURRENT FILE src/app.ts (untrusted source text');
    expect(scoped.context).toContain('scopedSource');
    expect(scoped.context).toContain('Nested project rules');
    expect(scoped.context).not.toMatch(/Parent workspace rules|siblingSource/);
    const wrongSelection = indexer.getScopedProjectContext('Store', 'Inspect Sibling/src/app.ts', 'Sibling/src/app.ts', 'siblingSelection');
    expect(wrongSelection.context).not.toMatch(/siblingSelection|siblingSource/);
  });

  it('ranks an exact declaration above prose and call-site mentions', () => {
    write('docs/checkout.md', 'Update calculateOrder wherever the checkout flow calls it.');
    write('src/domain.ts', 'export async function calculateOrder(items: number[]) { return items.length; }');
    write('src/view.ts', 'render(calculateOrder(items));');
    const result = retriever.retrieve('Refactor calculateOrder to validate input');
    expect(result.files[0]).toBe('src/domain.ts');
    expect(result.context).toContain('symbols: calculateOrder (function)');
  });

  it('includes a selected module and its direct local dependency and caller', () => {
    write('src/a.ts', 'import { value } from "./b.js";\nexport const selected = value;');
    write('src/b.ts', 'export const value = 42;');
    write('src/c.ts', 'import { selected } from "./a.js";\nconsole.log(selected);');
    const result = retriever.retrieve('Inspect src/a.ts');
    expect(result.files).toEqual(expect.arrayContaining(['src/a.ts', 'src/b.ts', 'src/c.ts']));
    expect(result.context).toContain('local import/caller relationship');
  });

  it('follows bounded Python and Rust local module declarations', () => {
    write('pkg/service.py', 'from .helpers import normalize\n\ndef build_invoice(value):\n    return normalize(value)');
    write('pkg/helpers.py', 'def normalize(value):\n    return round(value, 2)');
    write('src/main.rs', 'mod totals;\nfn main() { println!("{}", totals::sum()); }');
    write('src/totals.rs', 'pub fn sum() -> i32 { 42 }');

    const python = retriever.retrieve('Inspect pkg/service.py build_invoice');
    expect(python.files).toEqual(expect.arrayContaining(['pkg/service.py', 'pkg/helpers.py']));
    const rust = retriever.retrieve('Inspect src/main.rs totals');
    expect(rust.files).toEqual(expect.arrayContaining(['src/main.rs', 'src/totals.rs']));
  });

  it('follows Java, Kotlin, C# and Ruby local dependency declarations', () => {
    write('com/example/App.java', 'import com.example.Helper;\nclass App { Helper value; }');
    write('com/example/Helper.java', 'package com.example;\npublic class Helper {}');
    write('kotlin/App.kt', 'import kotlin.shared.Helper\nclass App { val helper = Helper() }');
    write('kotlin/shared/Helper.kt', 'package kotlin.shared\nclass Helper');
    write('dotnet/App.cs', 'using Dotnet.Shared;\nclass App { Shared value; }');
    write('dotnet/Shared.cs', 'namespace Dotnet { public class Shared {} }');
    write('ruby/app.rb', "require_relative './helper'\nHelper.new");
    write('ruby/helper.rb', 'class Helper; end');

    expect(retriever.retrieve('Inspect com/example/App.java Helper').files).toEqual(expect.arrayContaining(['com/example/App.java', 'com/example/Helper.java']));
    expect(retriever.retrieve('Inspect kotlin/App.kt Helper').files).toEqual(expect.arrayContaining(['kotlin/App.kt', 'kotlin/shared/Helper.kt']));
    expect(retriever.retrieve('Inspect dotnet/App.cs Shared').files).toEqual(expect.arrayContaining(['dotnet/App.cs', 'dotnet/Shared.cs']));
    expect(retriever.retrieve('Inspect ruby/app.rb Helper').files).toEqual(expect.arrayContaining(['ruby/app.rb', 'ruby/helper.rb']));
  });

  it('surfaces bounded method and implementation symbols beyond JavaScript', () => {
    write('go/service.go', 'package service\ntype Store struct{}\nfunc (s *Store) SaveInvoice() error { return nil }');
    write('rust/service.rs', 'struct Store;\nimpl Store { fn save_invoice(&self) {} }');
    write('java/Service.java', 'class Service { public void saveInvoice() {} }');
    expect(retriever.retrieve('Inspect go/service.go SaveInvoice').context).toContain('SaveInvoice (method)');
    expect(retriever.retrieve('Inspect rust/service.rs Store').context).toContain('Store (impl)');
    expect(retriever.retrieve('Inspect java/Service.java saveInvoice').context).toContain('saveInvoice (method)');
  });

  it('finds the matching lines deep in a file, rather than sending only the beginning', () => {
    write('server.py', '# unrelated\n'.repeat(180) + 'def settle_invoice(amount):\n    return round(amount, 2)\n');
    const result = retriever.retrieve('Explain settle_invoice');
    expect(result.context).toContain('181: def settle_invoice');
    expect(result.context).not.toContain('1: # unrelated');
  });

  it('protects secret files and redacts inline secrets before caching them', () => {
    write('secrets.json', '{"invoice":"DO_NOT_RETRIEVE"}');
    write('.env.local', 'invoice=DO_NOT_RETRIEVE');
    write('invoice.ts', 'const api_key = "sensitivevalue123456";\nexport const invoice = 1;');
    const result = retriever.retrieve('invoice secrets.json');
    expect(result.files).not.toContain('secrets.json');
    expect(result.context).not.toMatch(/DO_NOT_RETRIEVE|sensitivevalue123456/);
    expect(retriever.retrieve('invoice').context).not.toContain('sensitivevalue123456');
  });

  it('does not traverse generated or dependency directories', () => {
    for (const dir of ['node_modules', '.quillix-smoke', '.quillix', 'dist', 'vendor', 'target']) write(`${dir}/invoice.ts`, 'export const invoice = "generated";');
    write('src/invoice.ts', 'export const invoice = "real";');
    expect(retriever.retrieve('invoice').files).toEqual(['src/invoice.ts']);
  });

  it('bounds output characters, file count and source scan work', () => {
    for (let i = 0; i < 180; i++) write(`src/invoice${i}.ts`, `export const invoice${i} = '${'x'.repeat(300)}';`);
    const result = retriever.retrieve('invoice', { maxChars: 900, maxFiles: 2 });
    expect(result.context.length).toBeLessThanOrEqual(900);
    expect(result.files.length).toBeLessThanOrEqual(2);
    expect(result.scannedFiles).toBeLessThanOrEqual(160);
    expect(result.readBytes).toBeLessThanOrEqual(2 * 1024 * 1024);
    expect(result.limited).toBe(true);
    expect(result.context).toContain('Search limits reached');
  });

  it('refreshes cached source and does not retain deleted files', () => {
    write('invoice.ts', 'export const invoice = "old";');
    retriever.retrieve('invoice');
    expect(retriever.retrieve('invoice').cacheHits).toBe(1);
    write('invoice.ts', 'export const invoice = "new changed value";');
    expect(retriever.retrieve('invoice').context).toContain('new changed value');
    fs.unlinkSync(path.join(root, 'invoice.ts'));
    expect(retriever.retrieve('invoice').files).toEqual([]);
  });

  it('uses a dirty active buffer for source evidence without caching it or leaking secrets', () => {
    write('src/active.ts', 'export const diskRevision = "old";');
    retriever.retrieve('Inspect diskRevision', { currentFile: 'src/active.ts' });
    const dirty = 'export const editorRevision = "unsaved-current";\nconst api_key = "DO_NOT_LEAK_ACTIVE_BUFFER_123456";';
    const result = retriever.retrieve('Inspect editorRevision', { currentFile: 'src/active.ts', currentFileContent: dirty });
    expect(result.files).toContain('src/active.ts');
    expect(result.context).toContain('unsaved-current');
    expect(result.context).not.toContain('diskRevision');
    expect(result.context).not.toContain('DO_NOT_LEAK_ACTIVE_BUFFER_123456');
    expect(fs.readFileSync(path.join(root, 'src/active.ts'), 'utf8')).toContain('diskRevision');
    expect(retriever.retrieve('Inspect editorRevision', { currentFile: 'src/active.ts' }).context).not.toContain('unsaved-current');
  });

  it('clears the cache when switching workspaces', () => {
    write('invoice.ts', 'export const invoice = "first workspace";');
    write('second/invoice.ts', 'export const invoice = "second workspace";');
    retriever.retrieve('invoice.ts');
    workspace.setRoot(path.join(root, 'second'));
    const result = retriever.retrieve('invoice.ts');
    expect(result.cacheHits).toBe(0);
    expect(result.context).toContain('second workspace');
    expect(result.context).not.toContain('first workspace');
  });

  it('does not follow directory junctions or explicit outside paths', ({ skip }) => {
    write('outside/invoice.ts', 'export const invoice = "outside secret";');
    fs.mkdirSync(path.join(root, 'active'));
    try {
      fs.symlinkSync(path.join(root, 'outside'), path.join(root, 'active/link'), process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error: any) {
      if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code)) return skip('Symlink creation is restricted by this environment.');
      throw error;
    }
    workspace.setRoot(path.join(root, 'active'));
    const result = retriever.retrieve('invoice ../outside/invoice.ts link/invoice.ts');
    expect(result.files).toEqual([]);
    expect(result.context).not.toContain('outside secret');
  });

  it('prioritizes explicit files beyond the directory scan limit', () => {
    for (let i = 0; i < 165; i++) write(`a${i}.ts`, 'export const unrelated = 1;');
    write('z/last.ts', 'export const answer = 99;');
    expect(retriever.retrieve('Inspect z/last.ts').files[0]).toBe('z/last.ts');
    expect(retriever.retrieve('nothing', { maxChars: 0 }).context).toBe('');
  });
});
