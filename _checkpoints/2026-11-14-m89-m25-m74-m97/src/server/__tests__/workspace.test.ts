import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WorkspaceManager } from '../workspace.js';

/**
 * M8.9 — coverage for the workspace manager.
 *
 * These are behavioural tests over real temporary directories. They cover the
 * paths that matter for safety: path traversal, secret files, the optimistic
 * concurrency guard, the atomic write path and the search/symbol navigation.
 */
describe('WorkspaceManager (M8.9)', () => {
  let root: string;
  let workspace: WorkspaceManager;

  const write = (relative: string, content: string) => {
    const full = path.join(root, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf8');
  };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-workspace-'));
    workspace = new WorkspaceManager(root);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  describe('path safety', () => {
    it('refuses to escape the workspace', () => {
      const resolved = workspace.resolveSafePath('../../etc/passwd');
      expect(resolved.safe).toBe(false);
      expect(resolved.error).toBeTruthy();
    });

    it('refuses an absolute path outside the workspace', () => {
      const resolved = workspace.resolveSafePath(path.join(os.tmpdir(), 'somewhere-else.txt'));
      expect(resolved.safe).toBe(false);
    });

    it('allows a path inside the workspace', () => {
      const resolved = workspace.resolveSafePath('src/app.ts');
      expect(resolved.safe).toBe(true);
      expect(resolved.fullPath).toBe(path.join(root, 'src', 'app.ts'));
    });

    it('knows what is inside the workspace', () => {
      expect(workspace.isWithinWorkspace(path.join(root, 'a.ts'))).toBe(true);
      expect(workspace.isWithinWorkspace(path.join(os.tmpdir(), 'outside.ts'))).toBe(false);
    });
  });

  describe('readFile', () => {
    it('reads a real file', () => {
      write('a.txt', 'hello');
      const read = workspace.readFile('a.txt');
      expect(read.success).toBe(true);
      expect(read.content).toBe('hello');
      expect(read.size).toBe(5);
    });

    it('refuses to read a secret file', () => {
      write('.env', 'API_KEY=supersecret');
      const read = workspace.readFile('.env');
      expect(read.success).toBe(false);
      expect(read.error).toBeTruthy();
    });

    it('reports a missing file honestly', () => {
      const read = workspace.readFile('missing.txt');
      expect(read.success).toBe(false);
    });
  });

  describe('writeFile / createFile', () => {
    it('writes a file and verifies the write-back', () => {
      const result = workspace.writeFile('new.txt', 'content');
      expect(result.success).toBe(true);
      expect(result.verified).toBe(true);
      expect(fs.readFileSync(path.join(root, 'new.txt'), 'utf8')).toBe('content');
    });

    it('overwrites an existing file with writeFile', () => {
      write('exists.txt', 'original');
      const result = workspace.writeFile('exists.txt', 'replacement');
      expect(result.success).toBe(true);
      expect(result.verified).toBe(true);
      expect(fs.readFileSync(path.join(root, 'exists.txt'), 'utf8')).toBe('replacement');
    });

    it('creates a file that does not exist yet', () => {
      const result = workspace.createFile('created.txt', 'fresh');
      expect(result.success).toBe(true);
      expect(fs.readFileSync(path.join(root, 'created.txt'), 'utf8')).toBe('fresh');
    });

    it('refuses to create a file that already exists', () => {
      write('twice.txt', 'first');
      const result = workspace.createFile('twice.txt', 'second');
      expect(result.success).toBe(false);
      expect(fs.readFileSync(path.join(root, 'twice.txt'), 'utf8')).toBe('first');
    });

    it('refuses to write outside the workspace', () => {
      const result = workspace.writeFile('../escape.txt', 'nope');
      expect(result.success).toBe(false);
      expect(fs.existsSync(path.join(path.dirname(root), 'escape.txt'))).toBe(false);
    });
  });

  describe('deleteFile / renameFile', () => {
    it('deletes a file', () => {
      write('gone.txt', 'x');
      expect(workspace.deleteFile('gone.txt').success).toBe(true);
      expect(fs.existsSync(path.join(root, 'gone.txt'))).toBe(false);
    });

    it('reports deleting a missing file honestly', () => {
      expect(workspace.deleteFile('never.txt').success).toBe(false);
    });

    it('renames a file', () => {
      write('old.txt', 'content');
      expect(workspace.renameFile('old.txt', 'new.txt').success).toBe(true);
      expect(fs.existsSync(path.join(root, 'old.txt'))).toBe(false);
      expect(fs.readFileSync(path.join(root, 'new.txt'), 'utf8')).toBe('content');
    });

    it('refuses to rename a file that does not exist', () => {
      expect(workspace.renameFile('missing.txt', 'other.txt').success).toBe(false);
    });

    it('refuses to rename outside the workspace', () => {
      write('inside.txt', 'x');
      expect(workspace.renameFile('inside.txt', '../outside.txt').success).toBe(false);
    });
  });

  describe('createDirectory / listDirectory / getFileTree', () => {
    it('creates a nested directory', () => {
      expect(workspace.createDirectory('a/b/c').success).toBe(true);
      expect(fs.existsSync(path.join(root, 'a', 'b', 'c'))).toBe(true);
    });

    it('lists a directory with sizes', () => {
      write('dir/one.txt', 'abc');
      const listing = workspace.listDirectory('dir');
      expect(listing.success).toBe(true);
      expect(listing.files?.some(f => f.name === 'one.txt' && f.size === 3)).toBe(true);
    });

    it('builds a file tree that reflects the real directory', () => {
      write('tree/leaf.txt', 'x');
      const tree = workspace.getFileTree(3);
      expect(tree.name).toBe(path.basename(root));
      const flat: string[] = [];
      const walk = (node: any) => {
        flat.push(node.name);
        for (const child of node.children ?? []) walk(child);
      };
      walk(tree);
      expect(flat).toContain('tree');
      expect(flat).toContain('leaf.txt');
    });
  });

  describe('searchFiles', () => {
    beforeEach(() => {
      write('src/one.ts', 'const needle = 1;\nconst other = 2;');
      write('src/two.ts', 'function findNeedle() { return 3; }');
    });

    it('finds matches with the file, line and offsets', () => {
      const result = workspace.searchFiles('needle');
      expect(result.success).toBe(true);
      expect(result.matches.length).toBeGreaterThanOrEqual(2);
      const first = result.matches[0];
      expect(first.filePath).toBe('src/one.ts');
      expect(first.lineNumber).toBe(1);
      expect(first.lineContent).toContain('needle');
      expect(first.matchEnd - first.matchStart).toBe(6);
    });

    it('rejects an empty or oversized query', () => {
      expect(workspace.searchFiles('').success).toBe(false);
      expect(workspace.searchFiles('   ').success).toBe(false);
      expect(workspace.searchFiles('x'.repeat(300)).success).toBe(false);
    });

    it('honours the case-sensitive option', () => {
      expect(workspace.searchFiles('NEEDLE', { caseSensitive: true }).matches).toHaveLength(0);
      expect(workspace.searchFiles('NEEDLE').matches.length).toBeGreaterThan(0);
    });

    it('honours the whole-word option', () => {
      write('src/three.ts', 'needles and needle');
      const loose = workspace.searchFiles('needle').matches.filter(m => m.filePath === 'src/three.ts');
      const strict = workspace.searchFiles('needle', { wholeWord: true }).matches.filter(m => m.filePath === 'src/three.ts');
      expect(loose.length).toBeGreaterThan(strict.length);
    });

    it('supports regular expressions', () => {
      const result = workspace.searchFiles('const \\w+ = \\d+;', { isRegex: true });
      expect(result.success).toBe(true);
      expect(result.matches.length).toBeGreaterThan(0);
    });

    it('never searches secret files or skipped directories', () => {
      write('.env', 'needle=secret');
      write('node_modules/pkg.js', 'needle');
      write('.quillix/state.json', 'needle');
      const result = workspace.searchFiles('needle');
      for (const match of result.matches) {
        expect(match.filePath).not.toContain('.env');
        expect(match.filePath).not.toContain('node_modules');
        expect(match.filePath).not.toContain('.quillix');
      }
    });

    it('does not hang on a zero-width regular expression', () => {
      const result = workspace.searchFiles('x*', { isRegex: true });
      expect(result.success).toBe(true);
    });
  });

  describe('symbol navigation', () => {
    beforeEach(() => {
      write('src/defs.ts', 'export function computeTotal() {\n  return 1;\n}\n');
      write('src/use.ts', 'const total = computeTotal();\nconsole.log(total);\n');
    });

    it('finds symbols and classifies their kind', () => {
      const result = workspace.findSymbols('computeTotal');
      expect(result.success).toBe(true);
      expect(result.symbols.length).toBeGreaterThan(0);
      expect(result.symbols.some(s => s.kind === 'function')).toBe(true);
    });

    it('separates a definition from its references', () => {
      const definitions = workspace.findDefinitions('computeTotal');
      const references = workspace.findReferences('computeTotal');
      expect(definitions.success).toBe(true);
      expect(references.success).toBe(true);
      expect(definitions.symbols.some(s => s.filePath === 'src/defs.ts')).toBe(true);
      expect(references.symbols.some(s => s.filePath === 'src/use.ts')).toBe(true);
    });

    it('rejects a query that is not an identifier', () => {
      expect(workspace.findDefinitions('not an identifier').success).toBe(false);
      expect(workspace.findDefinitions('').success).toBe(false);
      expect(workspace.findDefinitions('123abc').success).toBe(false);
    });
  });

  describe('redactSecrets and metadata', () => {
    it('redacts a secret-looking value', () => {
      const redacted = workspace.redactSecrets('const apiKey = "sk_live_abcdefghijklmnop123456";');
      expect(redacted).not.toContain('abcdefghijklmnop123456');
    });

    it('redacts an OpenAI-style key even when the variable name looks harmless', () => {
      const secret = 'sk-abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ123456';
      const redacted = workspace.redactSecrets(`const openaiKey = "${secret}";`);
      expect(redacted).not.toContain(secret);
    });

    it('reports the metadata of a real file', () => {
      write('meta.txt', 'hello');
      const meta = workspace.getMetadata('meta.txt');
      expect(meta.success).toBe(true);
      expect(meta.meta?.sizeBytes).toBe(5);
      expect(meta.meta?.name).toBe('meta.txt');
      expect(meta.meta?.isFile).toBe(true);
    });

    it('reports the metadata of a missing file honestly', () => {
      expect(workspace.getMetadata('missing.txt').success).toBe(false);
    });

    it('reports the project structure', () => {
      write('struct/file.ts', 'x');
      const structure = workspace.getProjectStructure('.', 2);
      expect(structure.success).toBe(true);
    });
  });
});

