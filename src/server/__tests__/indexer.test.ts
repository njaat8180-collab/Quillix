import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CodebaseIndexer } from '../indexer.js';
import { WorkspaceManager } from '../workspace.js';
import { GitService } from '../git.js';
import { TerminalService } from '../terminal.js';

/**
 * M8.9 — coverage for the codebase indexer.
 *
 * These are behavioural tests over real temporary directories: the analyser
 * must detect the stack, the entry points and the config files that are
 * actually on disk, and it must never leak content from outside the workspace.
 */
describe('CodebaseIndexer (M8.9)', () => {
  let root: string;
  let workspace: WorkspaceManager;
  let indexer: CodebaseIndexer;

  const write = (relative: string, content: string) => {
    const full = path.join(root, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf8');
  };

  const indexerFor = (dir: string) =>
    new CodebaseIndexer(new WorkspaceManager(dir), new GitService(new TerminalService()));

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-indexer-'));
    workspace = new WorkspaceManager(root);
    indexer = indexerFor(root);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  describe('analyzeProject', () => {
    it('detects a React + Express + Electron project from real files', async () => {
      write('package.json', JSON.stringify({
        scripts: { build: 'vite build', test: 'vitest run' },
        dependencies: { react: '^18.0.0', express: '^4.0.0', electron: '^30.0.0' },
        devDependencies: {},
      }));
      write('src/main.tsx', 'export const App = () => null;');
      write('server.ts', 'export const server = 1;');
      write('tsconfig.json', '{}');
      write('vite.config.ts', 'export default {};');
      write('Dockerfile', 'FROM node');
      write('src/helper.ts', 'export const x = 1;');

      const meta = await indexer.analyzeProject();

      expect(meta.framework).toContain('React');
      expect(meta.framework).toContain('Express');
      expect(meta.framework).toContain('Electron');
      expect(meta.runtime).toBe('Node.js');
      expect(meta.packageManager).toBe('npm');
      expect(meta.entryPoints).toContain('src/main.tsx');
      expect(meta.entryPoints).toContain('server.ts');
      expect(meta.configFiles).toContain('package.json');
      expect(meta.configFiles).toContain('tsconfig.json');
      expect(meta.configFiles).toContain('vite.config.ts');
      expect(meta.configFiles).toContain('Dockerfile');
      expect(meta.scripts.build).toBe('vite build');
      expect(meta.languages).toContain('TypeScript (React)');
      expect(meta.importantDirs).toContain('src');
    });

    it('detects a Python project and switches the runtime and package manager', async () => {
      write('requirements.txt', 'flask\n');
      write('main.py', 'print("hi")');
      write('pyproject.toml', '[project]\nname="x"\n');

      const meta = await indexer.analyzeProject();

      expect(meta.runtime).toBe('Python');
      expect(meta.packageManager).toBe('pip');
      expect(meta.languages).toContain('Python');
      expect(meta.configFiles).toContain('pyproject.toml');
      expect(meta.entryPoints).toContain('main.py');
    });

    it('detects Rust and Go projects', async () => {
      write('Cargo.toml', '[package]\nname="x"\n');
      write('src/main.rs', 'fn main() {}');
      const rustMeta = await indexer.analyzeProject();
      expect(rustMeta.runtime).toBe('Cargo');
      expect(rustMeta.packageManager).toBe('cargo');
      expect(rustMeta.languages).toContain('Rust');

      const goRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-go-'));
      try {
        fs.writeFileSync(path.join(goRoot, 'go.mod'), 'module x\n', 'utf8');
        fs.writeFileSync(path.join(goRoot, 'main.go'), 'package main\n', 'utf8');
        const goMeta = await indexerFor(goRoot).analyzeProject();
        expect(goMeta.runtime).toBe('Go');
        expect(goMeta.packageManager).toBe('go');
        expect(goMeta.languages).toContain('Go');
        expect(goMeta.entryPoints).toContain('main.go');
      } finally {
        fs.rmSync(goRoot, { recursive: true, force: true });
      }
    });

    it('detects the pnpm, yarn and bun package managers from their lockfiles', async () => {
      write('package.json', JSON.stringify({ dependencies: { vue: '^3.0.0' } }));
      write('pnpm-lock.yaml', 'lockfileVersion: 6\n');
      const pnpmMeta = await indexer.analyzeProject();
      expect(pnpmMeta.packageManager).toBe('pnpm');
      expect(pnpmMeta.framework).toBe('Vue');

      const yarnRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-yarn-'));
      try {
        fs.writeFileSync(path.join(yarnRoot, 'package.json'), '{}', 'utf8');
        fs.writeFileSync(path.join(yarnRoot, 'yarn.lock'), '', 'utf8');
        expect((await indexerFor(yarnRoot).analyzeProject()).packageManager).toBe('yarn');
      } finally {
        fs.rmSync(yarnRoot, { recursive: true, force: true });
      }

      const bunRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-bun-'));
      try {
        fs.writeFileSync(path.join(bunRoot, 'package.json'), '{}', 'utf8');
        fs.writeFileSync(path.join(bunRoot, 'bun.lock'), '', 'utf8');
        expect((await indexerFor(bunRoot).analyzeProject()).packageManager).toBe('bun');
      } finally {
        fs.rmSync(bunRoot, { recursive: true, force: true });
      }
    });

    it('survives a malformed package.json instead of throwing', async () => {
      write('package.json', '{ this is not json');
      const meta = await indexer.analyzeProject();
      expect(meta.name).toBe(path.basename(root));
      expect(meta.scripts).toEqual({});
    });

    it('reports a non-git workspace honestly', async () => {
      write('index.js', 'console.log(1)');
      const meta = await indexer.analyzeProject();
      expect(meta.isGitRepo).toBe(false);
      expect(meta.gitBranch).toBeUndefined();
      expect(meta.gitModifiedCount).toBe(0);
    });
  });

  describe('getFocusedContext', () => {
    it('includes the named file and redacts secrets from it', () => {
      write('src/app.ts', 'const apiKey = "sk-live-SECRETVALUE1234567890";\nconst port = 3000;');
      const context = indexer.getFocusedContext('update src/app.ts please');
      expect(context).toContain('src/app.ts');
      // The secret must be redacted, not echoed back to the model.
      expect(context).not.toContain('SECRETVALUE1234567890');
    });

    it('marks a file that could not be read instead of inventing content', () => {
      const context = indexer.getFocusedContext('edit missing/file.ts');
      expect(context).toContain('missing/file.ts');
      expect(context).toContain('use read_file before editing');
    });

    it('uses the unsaved editor buffer when one is supplied', () => {
      write('src/app.ts', 'const onDisk = 1;');
      const context = indexer.getFocusedContext(
        'edit src/app.ts',
        'src/app.ts',
        undefined,
        4000,
        undefined,
        'const unsavedBuffer = 2;',
      );
      expect(context).toContain('CURRENT UNSAVED EDITOR BUFFER');
      expect(context).toContain('unsavedBuffer');
    });

    it('includes the project rules file when one exists', () => {
      write('AGENTS.md', 'Always run the tests.');
      const context = indexer.getFocusedContext('do something');
      expect(context).toContain('Always run the tests.');
      expect(context).toContain('PROJECT CONTEXT AGENTS.md');
    });

    it('respects the maxChars budget', () => {
      write('big.ts', 'x'.repeat(50_000));
      const context = indexer.getFocusedContext('edit big.ts', 'big.ts', undefined, 500);
      expect(context.length).toBeLessThanOrEqual(500);
    });
  });

  describe('getScopedProjectContext', () => {
    it('refuses a target outside the workspace', () => {
      expect(() => indexer.getScopedProjectContext('../escape', 'x')).toThrow(/unavailable in this workspace/);
    });

    it('refuses a target that is not a directory', () => {
      write('file.txt', 'x');
      expect(() => indexer.getScopedProjectContext('file.txt', 'x')).toThrow(/unavailable in this workspace/);
    });

    it('scopes the context to a real nested project', () => {
      write('nested/package.json', JSON.stringify({ dependencies: { next: '^14.0.0' } }));
      write('nested/src/page.tsx', 'export default function Page() {}');
      const scoped = indexer.getScopedProjectContext('nested', 'update src/page.tsx');
      expect(scoped.root).toBe(path.join(root, 'nested'));
      expect(scoped.context).toContain('src/page.tsx');
      expect(scoped.context).toContain('Paths are relative to this project');
    });
  });

  describe('getFileEvidence', () => {
    it('returns redacted evidence and reports whether it is complete', () => {
      write('secret.ts', 'const token = "sk-live-ABCDEFGHIJKLMNOP1234";');
      const evidence = indexer.getFileEvidence('secret.ts');
      expect(evidence).toBeDefined();
      expect(evidence?.complete).toBe(true);
      expect(evidence?.content).not.toContain('ABCDEFGHIJKLMNOP1234');
    });

    it('returns undefined for a file that cannot be read', () => {
      expect(indexer.getFileEvidence('nope.ts')).toBeUndefined();
    });

    it('marks evidence as incomplete when it is truncated', () => {
      write('long.ts', 'y'.repeat(50_000));
      const evidence = indexer.getFileEvidence('long.ts', 100);
      expect(evidence?.complete).toBe(false);
      expect(evidence?.content.length).toBeLessThanOrEqual(100);
    });
  });

  describe('getCompressedContext', () => {
    it('summarises the project, the tree, the active file and the selection', async () => {
      write('package.json', JSON.stringify({ scripts: { build: 'vite build' } }));
      write('src/index.ts', 'export const main = 1;');
      write('PROJECT_RULES.md', 'Never force-push.');

      const context = await indexer.getCompressedContext('src/index.ts', 'const main = 1;');
      expect(context).toContain('## Project Overview');
      expect(context).toContain('Directory Structure');
      expect(context).toContain('## Active File: src/index.ts');
      expect(context).toContain('Never force-push.');
      expect(context).toContain('Selected Code Snippet');
    });

    it('truncates a very long active file instead of sending it whole', async () => {
      const manyLines = Array.from({ length: 500 }, (_, i) => `const v${i} = ${i};`).join('\n');
      write('src/huge.ts', manyLines);
      const context = await indexer.getCompressedContext('src/huge.ts');
      expect(context).toContain('lines truncated');
      expect(context.length).toBeLessThanOrEqual(14_000);
    });
  });

  it('exposes the workspace root and the task context', () => {
    expect(indexer.getWorkspaceRoot()).toBe(root);
    expect(typeof indexer.getTaskContext('find something')).toBe('string');
  });
});
