import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CodebaseIndexer } from '../src/server/indexer.js';
import { WorkspaceManager } from '../src/server/workspace.js';
import { MAX_FILE_BYTES } from '../src/shared/largeFile.js';

/**
 * M8.9 — coverage for the two core modules that were still below the 80 %
 * line: `indexer.ts` (project metadata detection) and `workspace.ts` (the
 * verified write path).
 *
 * These tests only IMPORT the Cline-owned modules; they never edit them.
 * The point is to exercise the branches that no existing test ever reached,
 * because no test ever created a fixture project to analyse.
 */

const roots: string[] = [];

function makeWorkspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-core-'));
  roots.push(root);
  return root;
}

afterEach(() => {
  while (roots.length) {
    const root = roots.pop();
    if (!root) continue;
    try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

function write(root: string, relative: string, content: string): void {
  const full = path.join(root, relative);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
}

/** A git service that reports exactly what the test needs. */
function gitStub(options: { isRepo?: boolean; branch?: string; files?: string[] } = {}) {
  return {
    isGitRepo: async () => options.isRepo ?? false,
    getStatus: async () => ({ branch: options.branch ?? 'main', files: options.files ?? [] }),
  } as any;
}

describe('project metadata detection (indexer.ts)', () => {
  it('reads package.json scripts and dependencies', async () => {
    const root = makeWorkspace();
    write(root, 'package.json', JSON.stringify({
      name: 'demo',
      scripts: { build: 'tsc' },
      dependencies: { react: '^18.0.0' },
      devDependencies: { typescript: '^5.0.0' },
    }));
    const indexer = new CodebaseIndexer(new WorkspaceManager(root), gitStub());
    const meta = await indexer.analyzeProject();

    expect(meta.configFiles).toContain('package.json');
    expect(meta.scripts.build).toBe('tsc');
    expect(meta.dependencies.react).toBe('^18.0.0');
    expect(meta.devDependencies.typescript).toBe('^5.0.0');
  });

  it('composes the framework label instead of letting the last detector win', async () => {
    const root = makeWorkspace();
    write(root, 'package.json', JSON.stringify({
      dependencies: { react: '1', next: '1', express: '1', electron: '1' },
    }));
    const indexer = new CodebaseIndexer(new WorkspaceManager(root), gitStub());
    const meta = await indexer.analyzeProject();

    // A Next.js + Express repo is not an "Express API".
    expect(meta.framework).toContain('React');
    expect(meta.framework).toContain('Next.js');
    expect(meta.framework).toContain('Express (Full-Stack)');
    expect(meta.framework).toContain('(Electron Desktop)');
    expect(meta.framework).not.toBe('Express API');
  });

  it('labels a plain Express repository with the default framework label', async () => {
    const root = makeWorkspace();
    write(root, 'package.json', JSON.stringify({ dependencies: { express: '4' } }));
    const indexer = new CodebaseIndexer(new WorkspaceManager(root), gitStub());
    const meta = await indexer.analyzeProject();
    // The default framework label is non-empty, so the composed label is used
    // and the bare "Express API" label is never reached.
    expect(meta.framework).toBe('Plain / Vanilla + Express (Full-Stack)');
  });

  it('detects the package manager from the lock file', async () => {
    const pnpm = makeWorkspace();
    write(pnpm, 'package.json', '{}');
    write(pnpm, 'pnpm-lock.yaml', 'lockfileVersion: 6');
    expect((await new CodebaseIndexer(new WorkspaceManager(pnpm), gitStub()).analyzeProject()).packageManager).toBe('pnpm');

    const yarn = makeWorkspace();
    write(yarn, 'package.json', '{}');
    write(yarn, 'yarn.lock', '');
    expect((await new CodebaseIndexer(new WorkspaceManager(yarn), gitStub()).analyzeProject()).packageManager).toBe('yarn');

    const bun = makeWorkspace();
    write(bun, 'package.json', '{}');
    write(bun, 'bun.lockb', '');
    expect((await new CodebaseIndexer(new WorkspaceManager(bun), gitStub()).analyzeProject()).packageManager).toBe('bun');

    const npm = makeWorkspace();
    write(npm, 'package.json', '{}');
    expect((await new CodebaseIndexer(new WorkspaceManager(npm), gitStub()).analyzeProject()).packageManager).toBe('npm');
  });

  it('detects Python, Rust and Go projects', async () => {
    const python = makeWorkspace();
    write(python, 'requirements.txt', 'flask\n');
    const pythonMeta = await new CodebaseIndexer(new WorkspaceManager(python), gitStub()).analyzeProject();
    expect(pythonMeta.languages).toContain('Python');
    expect(pythonMeta.runtime).toBe('Python');
    expect(pythonMeta.packageManager).toBe('pip');
    expect(pythonMeta.configFiles).toContain('requirements.txt');

    const pyproject = makeWorkspace();
    write(pyproject, 'pyproject.toml', '[project]\n');
    expect((await new CodebaseIndexer(new WorkspaceManager(pyproject), gitStub()).analyzeProject()).configFiles).toContain('pyproject.toml');

    const rust = makeWorkspace();
    write(rust, 'Cargo.toml', '[package]\n');
    const rustMeta = await new CodebaseIndexer(new WorkspaceManager(rust), gitStub()).analyzeProject();
    expect(rustMeta.languages).toContain('Rust');
    expect(rustMeta.runtime).toBe('Cargo');
    expect(rustMeta.packageManager).toBe('cargo');

    const go = makeWorkspace();
    write(go, 'go.mod', 'module demo\n');
    const goMeta = await new CodebaseIndexer(new WorkspaceManager(go), gitStub()).analyzeProject();
    expect(goMeta.languages).toContain('Go');
    expect(goMeta.runtime).toBe('Go');
    expect(goMeta.packageManager).toBe('go');
  });

  it('lists config files, entry points and important directories', async () => {
    const root = makeWorkspace();
    for (const file of ['tsconfig.json', 'vite.config.ts', 'Dockerfile', '.env', '.env.example']) {
      write(root, file, '');
    }
    for (const entry of ['src/main.tsx', 'src/App.tsx', 'server.ts', 'main.py', 'main.go']) {
      write(root, entry, '');
    }
    for (const dir of ['src', 'electron', 'docs']) {
      fs.mkdirSync(path.join(root, dir), { recursive: true });
    }

    const meta = await new CodebaseIndexer(new WorkspaceManager(root), gitStub()).analyzeProject();
    expect(meta.configFiles).toEqual(expect.arrayContaining(['tsconfig.json', 'vite.config.ts', 'Dockerfile', '.env', '.env.example']));
    expect(meta.entryPoints).toEqual(expect.arrayContaining(['src/main.tsx', 'src/App.tsx', 'server.ts', 'main.py', 'main.go']));
    expect(meta.importantDirs).toEqual(expect.arrayContaining(['src', 'electron', 'docs']));
  });

  it('detects the languages present in the project tree', async () => {
    const root = makeWorkspace();
    const files = ['a.ts', 'b.tsx', 'c.js', 'd.jsx', 'e.py', 'f.rs', 'g.go', 'h.java', 'i.cs', 'j.html', 'k.css', 'l.json', 'm.md'];
    for (const file of files) write(root, path.join('src', file), '');

    const meta = await new CodebaseIndexer(new WorkspaceManager(root), gitStub()).analyzeProject();
    expect(meta.languages).toEqual(expect.arrayContaining([
      'TypeScript', 'TypeScript (React)', 'JavaScript', 'JavaScript (React)', 'Python',
      'Rust', 'Go', 'Java', 'C#', 'HTML', 'CSS', 'JSON', 'Markdown',
    ]));
  });

  it('survives a corrupt package.json instead of throwing', async () => {
    const root = makeWorkspace();
    write(root, 'package.json', '{ this is not json');
    const meta = await new CodebaseIndexer(new WorkspaceManager(root), gitStub()).analyzeProject();
    expect(meta.workspacePath).toBe(path.resolve(root));
    expect(meta.configFiles).not.toContain('package.json');
  });

  it('reports the git branch and the number of modified files', async () => {
    const root = makeWorkspace();
    const indexer = new CodebaseIndexer(new WorkspaceManager(root), gitStub({ isRepo: true, branch: 'feature/x', files: ['a.ts', 'b.ts'] }));
    const meta = await indexer.analyzeProject();
    expect(meta.isGitRepo).toBe(true);
    expect(meta.gitBranch).toBe('feature/x');
    expect(meta.gitModifiedCount).toBe(2);
  });
});

describe('verified workspace writes (workspace.ts)', () => {
  it('writes a file, creates missing parents and verifies it on disk', () => {
    const root = makeWorkspace();
    const workspace = new WorkspaceManager(root);
    const result = workspace.writeFile(path.join('nested', 'deep', 'note.txt'), 'hello');

    expect(result.success).toBe(true);
    expect(result.verified).toBe(true);
    expect(result.sizeBytes).toBe(5);
    expect(fs.readFileSync(path.join(root, 'nested', 'deep', 'note.txt'), 'utf8')).toBe('hello');
  });

  it('refuses a write that escapes the workspace', () => {
    const root = makeWorkspace();
    const workspace = new WorkspaceManager(root);
    const result = workspace.writeFile(path.join('..', 'escaped.txt'), 'nope');
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    expect(fs.existsSync(path.join(path.dirname(root), 'escaped.txt'))).toBe(false);
  });

  it('refuses an oversized write before touching the disk', () => {
    const root = makeWorkspace();
    const workspace = new WorkspaceManager(root);
    const huge = 'x'.repeat(MAX_FILE_BYTES + 1);
    const result = workspace.writeFile('huge.bin', huge);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/too large|limit|8 mb|8\.0 mb/i);
    expect(fs.existsSync(path.join(root, 'huge.bin'))).toBe(false);
  });

  it('creates a file once and refuses to overwrite it', () => {
    const root = makeWorkspace();
    const workspace = new WorkspaceManager(root);
    expect(workspace.createFile('new.txt', 'first').success).toBe(true);
    expect(fs.readFileSync(path.join(root, 'new.txt'), 'utf8')).toBe('first');

    const again = workspace.createFile('new.txt', 'second');
    expect(again.success).toBe(false);
    expect(again.error).toMatch(/already exists/i);
    // The original content is untouched.
    expect(fs.readFileSync(path.join(root, 'new.txt'), 'utf8')).toBe('first');
  });

  it('deletes a file and reports a missing target honestly', () => {
    const root = makeWorkspace();
    const workspace = new WorkspaceManager(root);
    write(root, 'gone.txt', 'x');
    expect(workspace.deleteFile('gone.txt').success).toBe(true);
    expect(fs.existsSync(path.join(root, 'gone.txt'))).toBe(false);

    const missing = workspace.deleteFile('gone.txt');
    expect(missing.success).toBe(false);
    expect(missing.error).toMatch(/does not exist/i);
  });

  it('refuses to delete the workspace root itself', () => {
    const root = makeWorkspace();
    const workspace = new WorkspaceManager(root);
    const result = workspace.deleteFile('.');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/workspace root/i);
    expect(fs.existsSync(root)).toBe(true);
  });

  it('renames a file and refuses a colliding or missing target', () => {
    const root = makeWorkspace();
    const workspace = new WorkspaceManager(root);
    write(root, 'from.txt', 'payload');
    write(root, 'taken.txt', 'other');

    expect(workspace.renameFile('from.txt', 'to.txt').success).toBe(true);
    expect(fs.readFileSync(path.join(root, 'to.txt'), 'utf8')).toBe('payload');
    expect(fs.existsSync(path.join(root, 'from.txt'))).toBe(false);

    const collision = workspace.renameFile('to.txt', 'taken.txt');
    expect(collision.success).toBe(false);
    expect(collision.error).toMatch(/already exists/i);

    const missing = workspace.renameFile('not-here.txt', 'whatever.txt');
    expect(missing.success).toBe(false);
    expect(missing.error).toMatch(/does not exist/i);
  });

  it('reads a file back and reports a missing one', () => {
    const root = makeWorkspace();
    const workspace = new WorkspaceManager(root);
    write(root, 'read.txt', 'content');
    expect(workspace.readFile('read.txt')).toMatchObject({ success: true, content: 'content' });

    const missing = workspace.readFile('absent.txt');
    expect(missing.success).toBe(false);
    expect(missing.error).toBeTruthy();
  });
});
