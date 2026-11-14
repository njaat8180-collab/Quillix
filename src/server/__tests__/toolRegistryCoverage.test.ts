import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CHUNK_TRANSFER_LIMITS, ToolRegistry } from '../toolRegistry.js';
import { WorkspaceManager } from '../workspace.js';
import { TerminalService } from '../terminal.js';
import { GitService } from '../git.js';
import { CodebaseIndexer } from '../indexer.js';
import { DEFAULT_SETTINGS, SettingsStore } from '../settings.js';

describe('ToolRegistry coverage', () => {
  let root: string;
  let workspace: WorkspaceManager;
  let terminal: TerminalService;
  let settings: SettingsStore;
  let registry: ToolRegistry;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-tool-registry-'));
    workspace = new WorkspaceManager(root);
    terminal = new TerminalService();
    const git = new GitService(terminal);
    const indexer = new CodebaseIndexer(workspace, git);
    settings = new SettingsStore(path.join(root, '.settings.json'));
    settings.update({ ...DEFAULT_SETTINGS, autoApplyDiffs: true, terminalApproval: false, offlineMode: true });
    registry = new ToolRegistry(workspace, terminal, git, indexer, settings);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('constructs the registry and exposes the workspace root', () => {
    expect(registry.getWorkspaceRoot()).toBe(workspace.getRoot());
    expect(registry.codingPlugins).toBeDefined();
    expect(registry.extensions).toBeDefined();
  });

  it('exposes unique tool definitions with schemas and permissions', () => {
    const definitions = registry.getToolDefinitions();
    const names = definitions.map(definition => definition.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain('read_file');
    expect(names).toContain('write_file');
    expect(names).toContain('list_directory');
    expect(names).toContain('search_files');
    const read = definitions.find(definition => definition.name === 'read_file');
    expect(read?.category).toBe('file');
    expect(read?.permission).toBe('read');
    expect(read?.parameters.required).toEqual(['filePath']);
    expect(read?.parameters.properties.filePath.type).toBe('string');
  });

  it('rejects unknown tools and non-object arguments', async () => {
    const unknown = await registry.executeTool('call-1', 'does_not_exist', {});
    expect(unknown.success).toBe(false);
    expect(unknown.error).toContain('Unknown tool');

    const invalid = await registry.executeTool('call-2', 'read_file', [] as any);
    expect(invalid.success).toBe(false);
    expect(invalid.error).toBe('Invalid tool arguments: expected a JSON object.');
  });

  it('reports missing and blank required arguments', async () => {
    const missing = await registry.executeTool('call-1', 'read_file', {});
    expect(missing.success).toBe(false);
    expect(missing.error).toContain("requires a non-empty string argument 'filePath'");

    const blank = await registry.executeTool('call-2', 'write_file', { filePath: ' ', content: 'x' });
    expect(blank.success).toBe(false);
    expect(blank.error).toContain("requires a non-empty string argument 'filePath'");
  });

  it('writes, reads, appends, and edits files in the workspace', async () => {
    const written = await registry.executeTool('call-1', 'write_file', {
      filePath: 'src/app.ts',
      content: 'export const value = 1;\n',
    });
    expect(written.success).toBe(true);
    expect(fs.readFileSync(path.join(root, 'src/app.ts'), 'utf8')).toBe('export const value = 1;\n');

    const read = await registry.executeTool('call-2', 'read_file', { filePath: 'src/app.ts' });
    expect(read.success).toBe(true);
    expect(read.output).toContain('export const value');
    expect(read.data).toMatchObject({ filePath: 'src/app.ts' });

    const appended = await registry.executeTool('call-3', 'append_file', {
      filePath: 'src/app.ts',
      content: 'export const other = 2;\n',
    });
    expect(appended.success).toBe(true);
    expect(fs.readFileSync(path.join(root, 'src/app.ts'), 'utf8')).toContain('other = 2');

    const edited = await registry.executeTool('call-4', 'edit_file', {
      filePath: 'src/app.ts',
      oldString: 'value = 1',
      newString: 'value = 3',
    });
    expect(edited.success).toBe(true);
    expect(fs.readFileSync(path.join(root, 'src/app.ts'), 'utf8')).toContain('value = 3');
  });

  it('recovers a fenced model source wrapper for source files', async () => {
    const result = await registry.executeTool('call-1', 'write_file', {
      filePath: 'wrapped.ts',
      content: '```ts\nexport const wrapped = true;\n```',
    });
    expect(result.success).toBe(true);
    expect(fs.readFileSync(path.join(root, 'wrapped.ts'), 'utf8')).toBe('export const wrapped = true;');
    expect(result.output).toContain('Recovered an outer model source wrapper');
  });

  it('returns file operation errors without throwing', async () => {
    const read = await registry.executeTool('call-1', 'read_file', { filePath: 'missing.txt' });
    expect(read.success).toBe(false);
    expect(read.error).toBeTruthy();

    const append = await registry.executeTool('call-2', 'append_file', {
      filePath: 'missing.txt',
      content: 'text',
    });
    expect(append.success).toBe(false);

    const edit = await registry.executeTool('call-3', 'edit_file', {
      filePath: 'missing.txt',
      oldString: 'old',
      newString: 'new',
    });
    expect(edit.success).toBe(false);
  });

  it('rejects ambiguous, missing, and no-op edits', async () => {
    fs.writeFileSync(path.join(root, 'repeat.txt'), 'x x\n');
    const ambiguous = await registry.executeTool('call-1', 'edit_file', {
      filePath: 'repeat.txt',
      oldString: 'x',
      newString: 'y',
    });
    expect(ambiguous.success).toBe(false);
    expect(ambiguous.error).toContain('Ambiguous');

    const missingNew = await registry.executeTool('call-2', 'edit_file', {
      filePath: 'repeat.txt',
      oldString: 'x',
    });
    expect(missingNew.success).toBe(false);
    expect(missingNew.error).toContain('newString');

    const noChange = await registry.executeTool('call-3', 'edit_file', {
      filePath: 'repeat.txt',
      oldString: 'x x',
      newString: 'x x',
    });
    expect(noChange.success).toBe(false);
    expect(noChange.error).toBe('No source change');
  });

  it('rejects an edit that breaks JavaScript syntax', async () => {
    fs.writeFileSync(path.join(root, 'broken.js'), 'const value = 1;\n');
    const result = await registry.executeTool('call-1', 'edit_file', {
      filePath: 'broken.js',
      oldString: 'const value = 1;',
      newString: 'const value = ;',
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe('Edit would break source syntax');
    expect(fs.readFileSync(path.join(root, 'broken.js'), 'utf8')).toBe('const value = 1;\n');
  });

  it('lists directories and searches file contents', async () => {
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(path.join(root, 'src', 'needle.txt'), 'find this needle\n');
    fs.writeFileSync(path.join(root, 'src', 'other.txt'), 'nothing here\n');

    const listed = await registry.executeTool('call-1', 'list_directory', { dirPath: 'src' });
    expect(listed.success).toBe(true);
    expect(listed.output).toContain('[FILE] needle.txt');
    expect(listed.data).toHaveLength(2);

    const searched = await registry.executeTool('call-2', 'search_files', { query: 'needle' });
    expect(searched.success).toBe(true);
    expect(searched.output).toContain('needle.txt');
    expect(searched.output).toContain('find this needle');

    const missing = await registry.executeTool('call-3', 'search_files', { query: 'not-present' });
    expect(missing.success).toBe(true);
    expect(missing.output).toContain('No matches found');
  });

  it('normalizes tool and argument aliases before dispatch', async () => {
    const result = await registry.executeTool('call-1', 'file_write', {
      path: 'alias.txt',
      content: 'alias content',
    });
    expect(result.success).toBe(true);
    expect(result.toolName).toBe('write_file');
    expect(fs.readFileSync(path.join(root, 'alias.txt'), 'utf8')).toBe('alias content');
  });

  it('routes relative paths into a project prefix', async () => {
    const result = await registry.executeTool('call-1', 'write_file', {
      filePath: 'index.html',
      content: '<main>Project</main>',
    }, { projectPrefix: 'Calculator', projectLayout: 'plain-web' });
    expect(result.success).toBe(true);
    expect(fs.readFileSync(path.join(root, 'Calculator', 'index.html'), 'utf8')).toContain('Project');
  });

  it('blocks paths outside the workspace and protected secret mutations', async () => {
    const outside = await registry.executeTool('call-1', 'read_file', { filePath: '../outside.txt' });
    expect(outside.success).toBe(false);
    expect(outside.error).toContain('outside the active workspace');

    fs.writeFileSync(path.join(root, '.env'), 'TOKEN=secret\n');
    const secret = await registry.executeTool('call-2', 'write_file', {
      filePath: '.env',
      content: 'TOKEN=changed\n',
    });
    expect(secret.success).toBe(false);
    expect(secret.error).toContain('Protected secret file mutation blocked');
    expect(fs.readFileSync(path.join(root, '.env'), 'utf8')).toBe('TOKEN=secret\n');
  });

  it('stages writes when auto apply is disabled', async () => {
    const staged = await registry.executeTool('call-1', 'write_file', {
      filePath: 'staged.txt',
      content: 'staged content',
    }, { autoApplyDiffs: false });
    expect(staged.success).toBe(true);
    expect(staged.staged).toBe(true);
    expect(staged.output).toContain('NOT applied');
    expect(fs.existsSync(path.join(root, 'staged.txt'))).toBe(false);
  });

  it('assembles chunks in order and completes the file', async () => {
    const first = await registry.executeTool('call-1', 'write_file_chunk', {
      filePath: 'chunked.txt',
      content: 'first ',
      transferId: 'transfer-1',
      chunkIndex: 0,
      totalChunks: 3,
      final: false,
    });
    expect(first.success).toBe(true);

    const outOfOrder = await registry.executeTool('call-2', 'write_file_chunk', {
      filePath: 'chunked.txt',
      content: 'wrong ',
      transferId: 'transfer-1',
      chunkIndex: 2,
      totalChunks: 3,
      final: true,
    });
    expect(outOfOrder.success).toBe(false);
    expect(outOfOrder.error).toBe('Out-of-order chunk');

    const middle = await registry.executeTool('call-3', 'write_file_chunk', {
      filePath: 'chunked.txt',
      content: 'second ',
      transferId: 'transfer-1',
      chunkIndex: 1,
      totalChunks: 3,
      final: false,
    });
    expect(middle.success).toBe(true);

    const final = await registry.executeTool('call-4', 'write_file_chunk', {
      filePath: 'chunked.txt',
      content: 'third',
      transferId: 'transfer-1',
      chunkIndex: 2,
      totalChunks: 3,
      final: true,
    });
    expect(final.success).toBe(true);
    expect(fs.readFileSync(path.join(root, 'chunked.txt'), 'utf8')).toBe('first second third');
    expect(CHUNK_TRANSFER_LIMITS.maxChunks).toBe(512);
  });

  it('rejects invalid chunk metadata and final flags', async () => {
    const invalid = await registry.executeTool('call-1', 'write_file_chunk', {
      filePath: 'chunked.txt',
      content: 'x',
      transferId: 'transfer-1',
      chunkIndex: 0,
      totalChunks: 2,
      final: true,
    });
    expect(invalid.success).toBe(false);
    expect(invalid.error).toBe('Invalid final flag');
  });

  it('validates run_command and dispatches a safe mocked command', async () => {
    const invalid = await registry.executeTool('call-1', 'run_command', { command: ' ' });
    expect(invalid.success).toBe(false);
    expect(invalid.error).toContain('Invalid command');

    const outside = await registry.executeTool('call-2', 'run_command', {
      command: 'echo safe',
      cwd: '..',
    });
    expect(outside.success).toBe(false);
    expect(outside.error).toContain('outside the active workspace');

    const execute = vi.spyOn(terminal, 'executeCommand').mockResolvedValue({
      exitCode: 0,
      stdout: 'safe output',
      stderr: '',
      durationMs: 1,
      command: 'echo safe',
      cwd: root,
    } as any);
    const result = await registry.executeTool('call-3', 'run_command', { command: 'echo safe' });
    expect(result.success).toBe(true);
    expect(result.output).toContain('safe output');
    expect(execute).toHaveBeenCalledOnce();
  });

  it('surfaces a workspace write failure', async () => {
    vi.spyOn(workspace, 'writeFile').mockReturnValue({ success: false, error: 'disk unavailable' } as any);
    const result = await registry.executeTool('call-1', 'write_file', {
      filePath: 'failure.txt',
      content: 'content',
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe('disk unavailable');
  });
});
