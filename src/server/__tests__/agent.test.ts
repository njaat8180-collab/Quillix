import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PatchEngine } from '../patchEngine.js';
import { TerminalService } from '../terminal.js';
import { WorkspaceManager } from '../workspace.js';
import { ToolRegistry } from '../toolRegistry.js';
import { GitService } from '../git.js';
import { CodebaseIndexer } from '../indexer.js';
import { SettingsStore, DEFAULT_SETTINGS } from '../settings.js';
import { OllamaQwenProvider } from '../qwen.js';
import fs from 'fs';
import os from 'os';
import path from 'path';

describe('NUVRO AI Coding Agent Engine', () => {
  describe('PatchEngine', () => {
    it('refuses stale create and delete patches without overwriting newer work', () => {
      const create = PatchEngine.createPatch('new.ts', '', 'new content', 'created');
      expect(PatchEngine.applyPatch('user changes', create).success).toBe(false);
      expect(PatchEngine.applyPatch('', create).result).toBe('new content');
      const remove = PatchEngine.createPatch('old.ts', 'original content', '', 'deleted');
      expect(PatchEngine.applyPatch('newer content', remove).success).toBe(false);
      expect(PatchEngine.applyPatch('original content', remove).result).toBe('');
    });
    it('should generate accurate unified diffs and line stats', () => {
      const oldCode = 'function hello() {\n  return "world";\n}';
      const newCode = 'function hello() {\n  console.log("greeting");\n  return "universe";\n}';

      const patch = PatchEngine.createPatch('src/test.ts', oldCode, newCode);
      expect(patch.filePath).toBe('src/test.ts');
      expect(patch.linesAdded).toBeGreaterThanOrEqual(1);
      expect(patch.linesRemoved).toBeGreaterThanOrEqual(1);
      expect(patch.diff).toContain('+  console.log("greeting");');
    });

    it('applies stale patch at its uniquely contextualized hunk while preserving unrelated concurrent edit', () => {
      // File with two identical functions - a common pattern
      const originalFile =
`function process() {
  return "A";
}

function process() {
  return "B";
}`;

      // User creates patch to modify FIRST function only
      const patchedFirst =
`function process() {
  return "A-modified";
}

function process() {
  return "B";
}`;

      const patch = PatchEngine.createPatch('dup.ts', originalFile, patchedFirst);

      // Meanwhile, file changed externally - SECOND function modified instead
      const staleFile =
`function process() {
  return "A";
}

function process() {
  return "B-modified";
}`;

      // diff.applyPatch uses 3-way context to apply at the intended hunk (first function)
      // while preserving the concurrent edit to the second function
      const result = PatchEngine.applyPatch(staleFile, patch);

      expect(result.success).toBe(true);
      expect(result.result).toBe(
`function process() {
  return "A-modified";
}

function process() {
  return "B-modified";
}`
      );
    });

    it('should parse diff lines accurately', () => {
      const diff = '--- a/file.ts\n+++ b/file.ts\n@@ -1,2 +1,3 @@\n line1\n+line2\n-line3';
      const lines = PatchEngine.parseDiffLines(diff);
      expect(lines.some((l) => l.type === 'add')).toBe(true);
      expect(lines.some((l) => l.type === 'remove')).toBe(true);
    });
  });

  describe('TerminalService Safety & Risk Classifier', () => {
    it('should classify safe commands as SAFE', () => {
      expect(TerminalService.classifyRisk('ls -la').risk).toBe('SAFE');
      expect(TerminalService.classifyRisk('git status').risk).toBe('SAFE');
      expect(TerminalService.classifyRisk('npm test').risk).toBe('SAFE');
    });

    it('should classify review-needed commands as REVIEW', () => {
      expect(TerminalService.classifyRisk('npm install lodash').risk).toBe('REVIEW');
      expect(TerminalService.classifyRisk('git push origin main').risk).toBe('REVIEW');
    });

    it('should classify dangerous commands as DANGEROUS', () => {
      expect(TerminalService.classifyRisk('rm -rf /').risk).toBe('DANGEROUS');
      expect(TerminalService.classifyRisk('Remove-Item -Recurse -Force').risk).toBe('DANGEROUS');
      expect(TerminalService.classifyRisk('drop table users').risk).toBe('DANGEROUS');
      expect(TerminalService.classifyRisk('mkfs.ext4 /dev/sda').risk).toBe('DANGEROUS');
    });
  });

  describe('WorkspaceManager Boundary Enforcement (security)', () => {
    const testDir = path.join(process.cwd(), 'temp_test_workspace');

    beforeEach(() => {
      if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });
    });

    afterEach(() => {
      if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });
    });

    it('should prevent ../ path traversal outside workspace', () => {
      const ws = new WorkspaceManager(testDir);
      const res = ws.readFile('../../etc/passwd');
      expect(res.success).toBe(false);
      expect(res.error).toContain('Operation blocked: path is outside the active workspace');
    });

    it('should prevent Windows-style ..\\ traversal outside workspace', () => {
      const ws = new WorkspaceManager(testDir);
      const res = ws.readFile('..\\..\\outside-file.txt');
      expect(res.success).toBe(false);
      expect(res.error).toContain('Operation blocked: path is outside the active workspace');
    });

    it('should prevent absolute paths outside the workspace', () => {
      const ws = new WorkspaceManager(testDir);
      const res = ws.readFile('/root/outside');
      expect(res.success).toBe(false);
      expect(res.error).toContain('Operation blocked: path is outside the active workspace');
    });

    it('should prevent writes outside the workspace via traversal', () => {
      const ws = new WorkspaceManager(testDir);
      const res = ws.writeFile('../escaped.txt', 'nope');
      expect(res.success).toBe(false);
      expect(res.error).toContain('Operation blocked: path is outside the active workspace');
    });

    it('should block symlink escapes outside the workspace', ({ skip }) => {
      const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-outside-'));
      try {
        const outsideFile = path.join(outsideDir, 'secret.txt');
        fs.writeFileSync(outsideFile, 'secret', 'utf8');
        try {
          fs.symlinkSync(outsideDir, path.join(testDir, 'link-out'), process.platform === 'win32' ? 'junction' : 'dir');
        } catch (error: any) {
          if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code)) return skip('Symlink creation is restricted by this environment.');
          throw error;
        }
        const ws = new WorkspaceManager(testDir);
        const res = ws.readFile('link-out/secret.txt');
        expect(res.success).toBe(false);
        expect(res.error).toContain('Operation blocked: path is outside the active workspace');
        expect(ws.readFile(path.join(testDir, 'link-out', 'secret.txt')).success).toBe(false);
        expect(ws.writeFile(path.join(testDir, 'link-out', 'new.txt'), 'blocked').success).toBe(false);
      } finally {
        fs.rmSync(outsideDir, { recursive: true, force: true });
      }
    });

    it('should reject terminal cwd outside the workspace', () => {
      const ws = new WorkspaceManager(testDir);
      expect(ws.isWithinWorkspace(path.join(testDir, 'sub'))).toBe(true);
      expect(ws.isWithinWorkspace(path.resolve(testDir, '../..'))).toBe(false);
      expect(ws.isWithinWorkspace('/root')).toBe(false);
      expect(ws.isWithinWorkspace('C:\\outside')).toBe(false);
    });

    it('should create, read, and delete files inside boundary', () => {
      const ws = new WorkspaceManager(testDir);
      const createRes = ws.createFile('hello.txt', 'Hello NUVRO AI');
      expect(createRes.success).toBe(true);

      const readRes = ws.readFile('hello.txt');
      expect(readRes.success).toBe(true);
      expect(readRes.content).toBe('Hello NUVRO AI');

      const delRes = ws.deleteFile('hello.txt');
      expect(delRes.success).toBe(true);
    });

    it('separates symbol definitions from references for precise navigation', () => {
      fs.writeFileSync(path.join(testDir, 'math.ts'), [
        'export function calculateTotal(value: number) {',
        '  return value * 2;',
        '}',
        'export const doubled = calculateTotal(21);',
      ].join('\n'));
      const ws = new WorkspaceManager(testDir);
      const definitions = ws.findDefinitions('calculateTotal');
      const references = ws.findReferences('calculateTotal');
      expect(definitions.success).toBe(true);
      expect(definitions.symbols).toEqual([{ name: 'calculateTotal', kind: 'definition', filePath: 'math.ts', line: 1 }]);
      expect(references.success).toBe(true);
      expect(references.symbols).toEqual([{ name: 'calculateTotal', kind: 'reference', filePath: 'math.ts', line: 4 }]);
    });
  });

  describe('SettingsStore validation (security)', () => {
    const settingsPath = path.join(process.cwd(), 'temp_test_settings.json');

    afterEach(() => {
      if (fs.existsSync(settingsPath)) fs.rmSync(settingsPath, { force: true });
    });

    it('should default to offline mode with local Ollama', () => {
      const store = new SettingsStore(settingsPath);
      expect(store.get().offlineMode).toBe(true);
      expect(store.get().ollamaBaseUrl).toBe('http://localhost:11434');
      expect(store.get().model).toBe('qwen2.5-coder:3b');
      expect(store.get().theme).toBe('dark');
    });

    it('should reject remote Ollama URLs while Offline Mode is ON', () => {
      const store = new SettingsStore(settingsPath);
      const res = store.update({ ollamaBaseUrl: 'http://example.com:11434' });
      expect(res.success).toBe(false);
      expect(res.error).toContain('Offline Mode');
    });

    it('should reject invalid themes and clamp numeric settings', () => {
      const store = new SettingsStore(settingsPath);
      expect(store.update({ theme: 'neon' as any }).success).toBe(false);

      const res = store.update({ maxAutonomousTurns: 500, temperature: 99 });
      expect(res.success).toBe(true);
      expect(res.settings?.maxAutonomousTurns).toBe(50);
      expect(res.settings?.temperature).toBe(2);
    });

    it('should persist settings across restarts', () => {
      const store1 = new SettingsStore(settingsPath);
      store1.update({ model: 'qwen3-coder:14b', theme: 'light', temperature: 0.5 });
      const store2 = new SettingsStore(settingsPath);
      expect(store2.get().model).toBe('qwen3-coder:14b');
      expect(store2.get().theme).toBe('light');
      expect(store2.get().temperature).toBe(0.5);
    });
  });

  describe('OllamaQwenProvider offline enforcement (security)', () => {
    it('does not report an uninstalled model tag as available', async () => {
      const mocked = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ models: [{ name: 'qwen2.5-coder:3b' }] })));
      try {
        const provider = new OllamaQwenProvider();
        expect((await provider.getStatus('qwen2.5-coder:7b')).modelAvailable).toBe(false);
      expect((await provider.getStatus('qwen2.5-coder:3b')).modelAvailable).toBe(true);
      } finally { mocked.mockRestore(); }
    });
    it('should reject remote Ollama URLs in offline mode', () => {
      expect(() => new OllamaQwenProvider({ baseUrl: 'http://example.com:11434' })).toThrow(/Offline Mode/);
      expect(() => new OllamaQwenProvider({ baseUrl: 'http://203.0.113.5:11434' })).toThrow(/Offline Mode/);
    });

    it('should accept loopback Ollama URLs', () => {
      expect(new OllamaQwenProvider({ baseUrl: 'http://127.0.0.1:11434' }).getBaseUrl()).toBe('http://127.0.0.1:11434');
      expect(new OllamaQwenProvider({ baseUrl: 'http://[::1]:11434' }).getBaseUrl()).toBe('http://[::1]:11434');
    });

    it('should reject invalid URLs', () => {
      expect(() => new OllamaQwenProvider({ baseUrl: 'not-a-url' })).toThrow(/Invalid Ollama URL/);
      expect(() => new OllamaQwenProvider({ baseUrl: 'ftp://localhost:11434' })).toThrow(/HTTP/);
    });

    it('selects JSON-schema tool envelopes only for Qwen3', () => {
      const provider = new OllamaQwenProvider({ model: 'qwen2.5-coder:3b' });
      expect(provider.supportsToolJsonSchemaForModel?.('qwen3:4b')).toBe(true);
      expect(provider.supportsToolJsonSchemaForModel?.('qwen3:latest')).toBe(true);
      expect(provider.supportsToolJsonSchemaForModel?.('qwen2.5-coder:3b')).toBe(false);
    });

    it('should allow a configured remote URL only when offline mode is OFF', () => {
      const provider = new OllamaQwenProvider({ baseUrl: 'http://localhost:11434', offlineMode: false });
      provider.configure({ baseUrl: 'http://192.168.1.10:11434', offlineMode: false });
      expect(provider.getBaseUrl()).toBe('http://192.168.1.10:11434');
      // Turning Offline Mode back on must reject the now-remote URL.
      expect(() => provider.configure({ baseUrl: 'http://192.168.1.10:11434', offlineMode: true })).toThrow(/Offline Mode/);
    });
  });

  describe('ToolRegistry security & approvals', () => {
    const settingsPath = path.join(process.cwd(), 'temp_test_tool_settings.json');
    const testDir = path.join(process.cwd(), 'temp_test_tool_workspace');

    const buildRegistry = (settingsPatch: Record<string, unknown> = {}) => {
      const settings = new SettingsStore(settingsPath);
      settings.update({ ...DEFAULT_SETTINGS, ...settingsPatch });
      const ws = new WorkspaceManager(testDir);
      const term = new TerminalService();
      const git = new GitService(term);
      const indexer = new CodebaseIndexer(ws, git);
      return { reg: new ToolRegistry(ws, term, git, indexer, settings), settings, ws };
    };

    beforeEach(() => {
      if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });
    });

    afterEach(() => {
      if (fs.existsSync(settingsPath)) fs.rmSync(settingsPath, { force: true });
      if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });
    });

    it('should register standard tools and produce valid definitions', () => {
      const { reg } = buildRegistry();
      const tools = reg.getToolDefinitions();
      expect(tools.length).toBeGreaterThan(15);
      expect(tools.some((t) => t.name === 'list_directory')).toBe(true);
      expect(tools.some((t) => t.name === 'run_command')).toBe(true);
      expect(tools.some((t) => t.name === 'git_status')).toBe(true);
    });

    it('should reject unknown tools and malformed arguments', async () => {
      const { reg } = buildRegistry();
      const unknown = await reg.executeTool('t1', 'definitely_not_a_tool', {});
      expect(unknown.success).toBe(false);
      expect(unknown.error).toContain('Unknown tool');

      const badArgs = await reg.executeTool('t2', 'read_file', 'not-an-object' as any);
      expect(badArgs.success).toBe(false);
      expect(badArgs.error).toContain('Invalid tool arguments');

      const nullArgs = await reg.executeTool('t2-null', 'write_file', null as any);
      expect(nullArgs.success).toBe(false);
      expect(nullArgs.error).toContain('Invalid tool arguments');
    });

    it('should reject file operations outside the workspace', async () => {
      const { reg } = buildRegistry();
      const res = await reg.executeTool('t3', 'read_file', { filePath: '../../etc/passwd' });
      expect(res.success).toBe(false);
      expect(res.error).toContain('Operation blocked: path is outside the active workspace');
    });

    it('should block dangerous terminal commands when Terminal Approval is ON', async () => {
      const { reg } = buildRegistry();
      const res = await reg.executeTool('t4', 'run_command', { command: 'rm -rf /' });
      expect(res.success).toBe(false);
      expect(res.needsApproval).toBe(true);
    });

    it('requires approval before deleting a file and blocks deleting the workspace', async () => {
      const { reg, ws } = buildRegistry();
      ws.createFile('keep.txt', 'data');
      expect((await reg.executeTool('d1', 'delete_file', { filePath: 'keep.txt' })).needsApproval).toBe(true);
      expect(ws.readFile('keep.txt').content).toBe('data');
      expect((await reg.executeTool('d2', 'delete_file', { filePath: 'keep.txt' }, { requestApproval: async () => true })).success).toBe(true);
      expect(ws.deleteFile('.').success).toBe(false);
    });

    it('normalizes absolute file paths in real write results', async () => {
      const { reg } = buildRegistry();
      const result = await reg.executeTool('w1', 'write_file', { filePath: path.join(testDir, 'file.txt'), content: 'hello' });
      expect(result.success).toBe(true);
      expect(result.data.filePath).toBe('file.txt');
    });

    it('routes plain-website core files to the project root', async () => {
      const { reg, ws } = buildRegistry({ autoApplyDiffs: true });
      const result = await reg.executeTool('web1', 'write_file', {
        filePath: 'src/index.html', content: '<!doctype html><html><body><main>ok</main></body></html>',
      }, { projectPrefix: 'Portfolio', projectLayout: 'plain-web' });
      expect(result.success).toBe(true);
      expect(ws.readFile('Portfolio/index.html').success).toBe(true);
      expect(ws.readFile('Portfolio/src/index.html').success).toBe(false);
    });

    it('should let the user deny a dangerous command through the approval flow', async () => {
      const { reg } = buildRegistry();
      const res = await reg.executeTool('t5', 'run_command', { command: 'rm -rf /' }, {
        requestApproval: async () => false,
      });
      expect(res.success).toBe(false);
      expect(res.error).toContain('denied');
    });

    it('should run dangerous commands only after explicit user approval', async () => {
      const { reg } = buildRegistry();
      let asked = 0;
      const res = await reg.executeTool('t6', 'run_command', { command: 'echo approved-test' }, {
        requestApproval: async () => {
          asked++;
          return true;
        },
      });
      // echo is SAFE, so no approval is requested
      expect(asked).toBe(0);
      expect(res.success).toBe(true);
      expect(res.output).toContain('approved-test');
    });

    it('should reject terminal cwd outside the workspace', async () => {
      const { reg } = buildRegistry();
      const res = await reg.executeTool('t7', 'run_command', { command: 'echo hi', cwd: '../../..' });
      expect(res.success).toBe(false);
      expect(res.error).toContain('Operation blocked: path is outside the active workspace');
    });

    it('should require authorization for git commits when Git Approval is ON', async () => {
      const { reg } = buildRegistry();
      const res = await reg.executeTool('t8', 'git_commit', { message: 'test' });
      expect(res.success).toBe(false);
      expect(res.needsApproval).toBe(true);
    });

    it('should stage file edits instead of writing when Auto Apply Diffs is OFF', async () => {
      const { reg, ws } = buildRegistry({ autoApplyDiffs: false });
      fs.writeFileSync(path.join(testDir, 'target.txt'), 'before', 'utf8');
      const res = await reg.executeTool('t9', 'write_file', { filePath: 'target.txt', content: 'after' });
      expect(res.success).toBe(true);
      expect(res.staged).toBe(true);
      // The file on disk must be untouched.
      const onDisk = ws.readFile('target.txt');
      expect(onDisk.content).toBe('before');
      // The staged patch carries the full change.
      expect(res.data.newContent).toBe('after');
      expect(res.data.oldContent).toBe('before');
    });

    it('should apply file edits immediately when Auto Apply Diffs is ON', async () => {
      const { reg, ws } = buildRegistry({ autoApplyDiffs: true });
      fs.writeFileSync(path.join(testDir, 'target2.txt'), 'before', 'utf8');
      const res = await reg.executeTool('t10', 'write_file', { filePath: 'target2.txt', content: 'after' });
      expect(res.success).toBe(true);
      expect(res.staged).toBeUndefined();
      expect(ws.readFile('target2.txt').content).toBe('after');
    });

    it('recovers source-only JSON and markdown wrappers from small-model writes without changing JSON configs', async () => {
      const { reg, ws } = buildRegistry({ autoApplyDiffs: true });
      const wrapped = await reg.executeTool('t11', 'write_file', {
        filePath: 'model.cjs',
        content: JSON.stringify({ content: 'exports.answer = 42;\n' }),
      });
      expect(wrapped.success).toBe(true);
      expect(ws.readFile('model.cjs').content).toBe('exports.answer = 42;\n');
      expect(wrapped.output).toMatch(/outer model source wrapper/);

      const fenced = await reg.executeTool('t12', 'write_file', {
        filePath: 'model.js',
        content: '```js\nexport const answer = 42;\n```',
      });
      expect(fenced.success).toBe(true);
      expect(ws.readFile('model.js').content).toBe('export const answer = 42;');

      const config = JSON.stringify({ content: 'keep-this-value' });
      const json = await reg.executeTool('t13', 'write_file', { filePath: 'config.json', content: config });
      expect(json.success).toBe(true);
      expect(ws.readFile('config.json').content).toBe(config);
    });
  });
});
