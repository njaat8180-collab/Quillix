import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { CHUNK_TRANSFER_LIMITS, ToolRegistry } from '../toolRegistry.js';
import { WorkspaceManager } from '../workspace.js';
import { TerminalService } from '../terminal.js';
import { GitService } from '../git.js';
import { CodebaseIndexer } from '../indexer.js';
import { SettingsStore, DEFAULT_SETTINGS } from '../settings.js';
import { WorkspaceVerifier } from '../verifier.js';

/**
 * Real-agent guarantees that must hold for EVERY write:
 *
 *  §4  READ-BACK VERIFICATION — a file write only succeeds when the file
 *      exists on disk, is non-empty (when content was non-empty), and the
 *      bytes read back match what was requested.
 *  §5  NO PLACEHOLDER CODE — a code file that is empty, only comments, or
 *      only a stub (pass / TODO / "coming soon") FAILS verification, so the
 *      task can never be reported complete on top of it.
 *  §2  Real append/edit file operations on the actual filesystem.
 */

describe('Write-back verification + placeholder rejection (§2 §4 §5)', () => {
  let testDir: string;
  let workspace: WorkspaceManager;
  let registry: ToolRegistry;
  let verifier: WorkspaceVerifier;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(process.cwd(), '.test-tmp-writeback-'));
    workspace = new WorkspaceManager(testDir);
    const settings = new SettingsStore(path.join(testDir, '.quillix-test-settings.json'));
    settings.update({ ...DEFAULT_SETTINGS, autoApplyDiffs: true, terminalApproval: false });
    const terminal = new TerminalService();
    const git = new GitService(terminal);
    const indexer = new CodebaseIndexer(workspace, git);
    registry = new ToolRegistry(workspace, terminal, git, indexer, settings);
    verifier = new WorkspaceVerifier(workspace, terminal);
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  const exec = (name: string, args: Record<string, any>) =>
    registry.executeTool(`tc_${name}_${Math.random().toString(36).slice(2, 6)}`, name, args);

  it('rejects ambiguous replacements unless replaceAll is explicitly requested', async () => {
    await exec('write_file', { filePath: 'safe.cjs', content: 'exports.a = 1; exports.b = 1;' });
    const rejected = await exec('edit_file', { filePath: 'safe.cjs', oldString: '= 1', newString: '= 2' });
    expect(rejected.success).toBe(false);
    expect(rejected.output).toContain('Ambiguous');
    expect(workspace.readFile('safe.cjs').content).toBe('exports.a = 1; exports.b = 1;');
    const applied = await exec('edit_file', { filePath: 'safe.cjs', oldString: '= 1', newString: '= 2', replaceAll: true });
    expect(applied.success).toBe(true);
    expect(workspace.readFile('safe.cjs').content).toBe('exports.a = 2; exports.b = 2;');
  });

  it('preserves valid JS and JSON when an edit would break syntax', async () => {
    for (const [filePath, content, oldString, newString] of [
      ['safe.cjs', 'exports.value = () => 1;', '() => 1', '() => {'],
      ['safe.json', '{"value": 1}', '1', 'oops'],
      ['safe.ts', 'export const n: number = 1;', '= 1', '= ;'],
    ]) {
      await exec('write_file', { filePath, content });
      const result = await exec('edit_file', { filePath, oldString, newString });
      expect(result.success).toBe(false);
      expect(result.output).toContain('Syntax preflight');
      expect(workspace.readFile(filePath).content).toBe(content);
    }
  });

  it('requires an explicit replacement, rejects no-op edits and permits intended deletion', async () => {
    await exec('write_file', { filePath: 'safe.cjs', content: 'exports.a = 1; exports.b = 2;' });
    expect((await exec('edit_file', { filePath: 'safe.cjs', oldString: 'exports.a = 1;' })).success).toBe(false);
    expect((await exec('edit_file', { filePath: 'safe.cjs', oldString: '1', newString: '1' })).success).toBe(false);
    expect((await exec('edit_file', { filePath: 'safe.cjs', oldString: ' exports.b = 2;', newString: '' })).success).toBe(true);
    expect(workspace.readFile('safe.cjs').content).toBe('exports.a = 1;');
  });

  it('still permits repairing a source file that was already syntactically broken', async () => {
    await exec('write_file', { filePath: 'broken.cjs', content: 'exports.a = ;' });
    expect((await exec('edit_file', { filePath: 'broken.cjs', oldString: '= ;', newString: '= 1;' })).success).toBe(true);
    expect(workspace.readFile('broken.cjs').content).toBe('exports.a = 1;');
  });

  // ------------------------------------------------------------------ §4 ---

  it('write_file reports read-back verification and the disk content matches exactly', async () => {
    const code = [
      'import pygame',
      'WIDTH = 800',
      'def main():',
      '    pygame.init()',
      '    screen = pygame.display.set_mode((WIDTH, 600))',
      '    pygame.display.set_caption("Car Game")',
      '    running = True',
      '    while running:',
      '        for event in pygame.event.get():',
      '            if event.type == pygame.QUIT:',
      '                running = False',
      '    pygame.quit()',
      'main()',
    ].join('\n');
    const res = await exec('write_file', { filePath: 'game/main.py', content: code });
    expect(res.success).toBe(true);
    expect(res.output).toContain('read back from disk and verified');
    // The filesystem is the source of truth: exact bytes on disk.
    expect(fs.readFileSync(path.join(testDir, 'game', 'main.py'), 'utf8')).toBe(code);
    expect(fs.statSync(path.join(testDir, 'game', 'main.py')).size).toBeGreaterThan(0);
  });

  it('workspace.writeFile fails a write when the content read back from disk differs', () => {
    // Sanity-check the verification layer itself with an artificial tamper.
    const res = workspace.writeFile('ok.txt', 'hello world');
    expect(res.success).toBe(true);
    expect(res.verified).toBe(true);
    expect(res.sizeBytes).toBe('hello world'.length);

    // A path pointing at a DIRECTORY cannot be written: the write fails
    // honestly (EISDIR) instead of claiming success.
    fs.mkdirSync(path.join(testDir, 'adir'));
    const bad = workspace.writeFile('adir', 'this should not verify');
    expect(bad.success).toBe(false);
    expect(bad.verified).not.toBe(true);
  });

  it('refuses to replace an existing protected secret file through regular or chunked writes', async () => {
    const secretPath = path.join(testDir, '.env');
    fs.writeFileSync(secretPath, 'API_KEY=keep-this-value\n');
    const regular = await exec('write_file', { filePath: '.env', content: 'API_KEY=overwritten\n' });
    const chunked = await exec('write_file_chunk', {
      filePath: '.env', content: 'API_KEY=overwritten\n', transferId: 'secret-transfer', chunkIndex: 0, totalChunks: 1, final: true,
    });
    expect(regular.success).toBe(false);
    expect(regular.error).toMatch(/protected secret file mutation blocked/i);
    expect(chunked.success).toBe(false);
    expect(chunked.error).toMatch(/protected secret file mutation blocked/i);
    expect(fs.readFileSync(secretPath, 'utf8')).toBe('API_KEY=keep-this-value\n');
  });

  it('append_file physically appends to the real file on disk', async () => {
    await exec('write_file', { filePath: 'notes/lines.txt', content: 'first line\n' });
    const res = await exec('append_file', { filePath: 'notes/lines.txt', content: 'second line\n' });
    expect(res.success).toBe(true);
    expect(res.output).toContain('read back from disk and verified');
    expect(fs.readFileSync(path.join(testDir, 'notes', 'lines.txt'), 'utf8')).toBe('first line\nsecond line\n');
  });

  it('append_file fails for a file that does not exist', async () => {
    const res = await exec('append_file', { filePath: 'missing.txt', content: 'x' });
    expect(res.success).toBe(false);
  });

  it('write_file_chunk writes ordered chunks and rejects duplicates/out-of-order chunks', async () => {
    fs.mkdirSync(path.join(testDir, 'chunked'), { recursive: true });
    fs.writeFileSync(path.join(testDir, 'chunked', 'app.cjs'), 'exports.original = true;');
    const first = await exec('write_file_chunk', { filePath: 'chunked/app.cjs', content: 'exports.a = ', transferId: 'transfer-1', chunkIndex: 0, totalChunks: 2, final: false });
    expect(first.success).toBe(true);
    expect(first.output).toContain('Chunk 1/2 written');
    const duplicate = await exec('write_file_chunk', { filePath: 'chunked/app.cjs', content: 'exports.a = ', transferId: 'transfer-1', chunkIndex: 0, totalChunks: 2, final: false });
    expect(duplicate.success).toBe(true);
    expect(duplicate.output).toContain('already applied');
    const outOfOrder = await exec('write_file_chunk', { filePath: 'chunked/app.cjs', content: '1;', transferId: 'transfer-1', chunkIndex: 2, totalChunks: 3, final: false });
    expect(outOfOrder.success).toBe(false);
    // Rebind a fresh registry to simulate an app restart. The persisted
    // checkpoint must still make the next chunk idempotent and ordered.
    const restartedSettings = new SettingsStore(path.join(testDir, '.quillix-test-settings.json'));
    const restartedTerminal = new TerminalService();
    const restartedGit = new GitService(restartedTerminal);
    const restartedRegistry = new ToolRegistry(workspace, restartedTerminal, restartedGit, new CodebaseIndexer(workspace, restartedGit), restartedSettings);
    const final = await restartedRegistry.executeTool('tc_chunk_final', 'write_file_chunk', { filePath: 'chunked/app.cjs', content: '1;', transferId: 'transfer-1', chunkIndex: 1, totalChunks: 2, final: true });
    expect(final.success).toBe(true);
    expect(final.output).toContain('transfer completed');
    expect((final.data as any).oldContent).toBe('exports.original = true;');
    expect((final.data as any).newContent).toBe('exports.a = 1;');
    expect(fs.readFileSync(path.join(testDir, 'chunked', 'app.cjs'), 'utf8')).toBe('exports.a = 1;');
  });

  it('bounds chunk bytes and declared chunk counts before any file write', async () => {
    const tooLarge = await exec('write_file_chunk', {
      filePath: 'oversized.cjs', content: 'x'.repeat(CHUNK_TRANSFER_LIMITS.maxChunkBytes + 1),
      transferId: 'oversized', chunkIndex: 0, totalChunks: 1, final: true,
    });
    expect(tooLarge.success).toBe(false);
    expect(tooLarge.error).toMatch(/invalid chunk metadata/i);
    expect(fs.existsSync(path.join(testDir, 'oversized.cjs'))).toBe(false);

    const tooManyChunks = await exec('write_file_chunk', {
      filePath: 'too-many.cjs', content: 'x', transferId: 'too-many',
      chunkIndex: 0, totalChunks: CHUNK_TRANSFER_LIMITS.maxChunks + 1, final: false,
    });
    expect(tooManyChunks.success).toBe(false);
    expect(tooManyChunks.error).toMatch(/invalid chunk metadata/i);
    expect(fs.existsSync(path.join(testDir, 'too-many.cjs'))).toBe(false);
  });

  it('caps concurrently checkpointed chunk transfers', async () => {
    for (let index = 0; index < CHUNK_TRANSFER_LIMITS.maxTransfers; index++) {
      const accepted = await exec('write_file_chunk', {
        filePath: `pending-${index}.cjs`, content: `part-${index}`,
        transferId: `pending-${index}`, chunkIndex: 0, totalChunks: 2, final: false,
      });
      expect(accepted.success).toBe(true);
    }
    const overflow = await exec('write_file_chunk', {
      filePath: 'pending-overflow.cjs', content: 'extra',
      transferId: 'pending-overflow', chunkIndex: 0, totalChunks: 2, final: false,
    });
    expect(overflow.success).toBe(false);
    expect(overflow.error).toMatch(/transfer limit reached/i);
    expect(fs.existsSync(path.join(testDir, 'pending-overflow.cjs'))).toBe(false);
  });

  it('checkpoints staged chunks across restart and returns one final review patch without touching disk', async () => {
    fs.mkdirSync(path.join(testDir, 'chunked'), { recursive: true });
    const target = path.join(testDir, 'chunked', 'staged.cjs');
    fs.writeFileSync(target, 'exports.original = true;');
    const stagedSettings = new SettingsStore(path.join(testDir, '.quillix-staged-settings.json'));
    stagedSettings.update({ ...DEFAULT_SETTINGS, autoApplyDiffs: false, terminalApproval: false });
    const makeRegistry = () => {
      const terminal = new TerminalService();
      const git = new GitService(terminal);
      return new ToolRegistry(workspace, terminal, git, new CodebaseIndexer(workspace, git), stagedSettings);
    };
    const first = await makeRegistry().executeTool('tc_stage_0', 'write_file_chunk', {
      filePath: 'chunked/staged.cjs', content: 'exports.value = ', transferId: 'staged-transfer', chunkIndex: 0, totalChunks: 2, final: false,
    });
    expect(first.success).toBe(true);
    expect(first.staged).not.toBe(true);
    expect(first.output).toContain('checkpointed');
    expect(fs.readFileSync(target, 'utf8')).toBe('exports.original = true;');

    const final = await makeRegistry().executeTool('tc_stage_1', 'write_file_chunk', {
      filePath: 'chunked/staged.cjs', content: '42;', transferId: 'staged-transfer', chunkIndex: 1, totalChunks: 2, final: true,
    });
    expect(final.success).toBe(true);
    expect(final.staged).toBe(true);
    expect((final.data as any).filePath).toBe('chunked/staged.cjs');
    expect((final.data as any).oldContent).toBe('exports.original = true;');
    expect((final.data as any).newContent).toBe('exports.value = 42;');
    expect((final.data as any).complete).toBe(true);
    expect(fs.readFileSync(target, 'utf8')).toBe('exports.original = true;');
  });

  it('detects external edits against the original file while staged chunks are pending', async () => {
    const target = path.join(testDir, 'staged-conflict.cjs');
    fs.writeFileSync(target, 'original');
    const stagedSettings = new SettingsStore(path.join(testDir, '.quillix-staged-conflict-settings.json'));
    stagedSettings.update({ ...DEFAULT_SETTINGS, autoApplyDiffs: false, terminalApproval: false });
    const terminal = new TerminalService();
    const git = new GitService(terminal);
    const stagedRegistry = new ToolRegistry(workspace, terminal, git, new CodebaseIndexer(workspace, git), stagedSettings);
    const first = await stagedRegistry.executeTool('tc_stage_conflict_0', 'write_file_chunk', {
      filePath: 'staged-conflict.cjs', content: 'new-', transferId: 'staged-conflict', chunkIndex: 0, totalChunks: 2, final: false,
    });
    expect(first.success).toBe(true);
    fs.writeFileSync(target, 'user edit');
    const next = await stagedRegistry.executeTool('tc_stage_conflict_1', 'write_file_chunk', {
      filePath: 'staged-conflict.cjs', content: 'value', transferId: 'staged-conflict', chunkIndex: 1, totalChunks: 2, final: true,
    });
    expect(next.success).toBe(false);
    expect(next.error).toMatch(/changed during transfer/i);
    expect(fs.readFileSync(target, 'utf8')).toBe('user edit');
  });

  it('does not acknowledge a staged chunk when its recovery checkpoint cannot be persisted', async () => {
    const target = path.join(testDir, 'staged-checkpoint-failure.cjs');
    fs.writeFileSync(target, 'original');
    // A file at the metadata directory path makes checkpoint creation fail
    // deterministically without relying on OS-specific permission behavior.
    fs.writeFileSync(path.join(testDir, '.quillix'), 'not a directory');
    const stagedSettings = new SettingsStore(path.join(testDir, '.quillix-staged-failure-settings.json'));
    stagedSettings.update({ ...DEFAULT_SETTINGS, autoApplyDiffs: false, terminalApproval: false });
    const terminal = new TerminalService();
    const git = new GitService(terminal);
    const stagedRegistry = new ToolRegistry(workspace, terminal, git, new CodebaseIndexer(workspace, git), stagedSettings);
    const result = await stagedRegistry.executeTool('tc_stage_checkpoint_failure', 'write_file_chunk', {
      filePath: 'staged-checkpoint-failure.cjs', content: 'new-', transferId: 'unpersisted-transfer', chunkIndex: 0, totalChunks: 2, final: false,
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/checkpoint could not be persisted/i);
    expect(fs.readFileSync(target, 'utf8')).toBe('original');
  });

  it('rolls back an applied chunk when its recovery checkpoint cannot be persisted', async () => {
    const target = path.join(testDir, 'chunk-checkpoint-failure.cjs');
    fs.writeFileSync(target, 'exports.original = true;');
    // Make the checkpoint parent unusable while keeping the target writable.
    fs.writeFileSync(path.join(testDir, '.quillix'), 'not a directory');
    const result = await exec('write_file_chunk', {
      filePath: 'chunk-checkpoint-failure.cjs', content: 'exports.changed = true;',
      transferId: 'applied-checkpoint-failure', chunkIndex: 0, totalChunks: 2, final: false,
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/checkpoint could not be persisted/i);
    expect((result.data as any).rolledBack).toBe(true);
    expect(fs.readFileSync(target, 'utf8')).toBe('exports.original = true;');
  });

  it('reports stale recovery metadata if final checkpoint cleanup fails after the file is written', async () => {
    const target = path.join(testDir, 'chunk-cleanup-warning.cjs');
    fs.writeFileSync(target, 'exports.original = true;');
    const first = await exec('write_file_chunk', {
      filePath: 'chunk-cleanup-warning.cjs', content: 'exports.value = ',
      transferId: 'cleanup-warning', chunkIndex: 0, totalChunks: 2, final: false,
    });
    expect(first.success).toBe(true);

    const rename = fs.renameSync;
    let calls = 0;
    vi.spyOn(fs, 'renameSync').mockImplementation(((...args: Parameters<typeof fs.renameSync>) => {
      calls += 1;
      if (calls === 2) throw new Error('simulated checkpoint cleanup failure');
      return rename(...args);
    }) as typeof fs.renameSync);
    try {
      const final = await exec('write_file_chunk', {
        filePath: 'chunk-cleanup-warning.cjs', content: '42;',
        transferId: 'cleanup-warning', chunkIndex: 1, totalChunks: 2, final: true,
      });
      expect(final.success).toBe(true);
      expect((final.data as any).checkpointRemoved).toBe(false);
      expect(final.output).toMatch(/recovery checkpoint could not be removed/i);
      expect(fs.readFileSync(target, 'utf8')).toBe('exports.value = 42;');
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('pauses a chunk transfer if the target file changes outside the transfer', async () => {
    const first = await exec('write_file_chunk', { filePath: 'chunked/conflict.cjs', content: 'exports.value = ', transferId: 'transfer-conflict', chunkIndex: 0, totalChunks: 2, final: false });
    expect(first.success).toBe(true);
    fs.writeFileSync(path.join(testDir, 'chunked', 'conflict.cjs'), 'user edit');
    const next = await exec('write_file_chunk', { filePath: 'chunked/conflict.cjs', content: '42;', transferId: 'transfer-conflict', chunkIndex: 1, totalChunks: 2, final: true });
    expect(next.success).toBe(false);
    expect(next.error).toMatch(/changed during transfer/i);
    expect(fs.readFileSync(path.join(testDir, 'chunked', 'conflict.cjs'), 'utf8')).toBe('user edit');
  });

  it('edit_file replaces text in the real file on disk', async () => {
    await exec('write_file', {
      filePath: 'src/calc.py',
      content: 'def add(a, b):\n    return a - b  # bug\n',
    });
    const res = await exec('edit_file', {
      filePath: 'src/calc.py',
      oldString: 'return a - b  # bug',
      newString: 'return a + b',
    });
    expect(res.success).toBe(true);
    expect(fs.readFileSync(path.join(testDir, 'src', 'calc.py'), 'utf8')).toBe('def add(a, b):\n    return a + b\n');
  });

  it('edit_file fails honestly when oldString is not in the file', async () => {
    await exec('write_file', { filePath: 'src/calc.py', content: 'x = 1\n' });
    const res = await exec('edit_file', { filePath: 'src/calc.py', oldString: 'NOT PRESENT', newString: 'y' });
    expect(res.success).toBe(false);
    // File untouched.
    expect(fs.readFileSync(path.join(testDir, 'src', 'calc.py'), 'utf8')).toBe('x = 1\n');
  });

  it('append/edit tool aliases normalize to the canonical tools', async () => {
    await exec('write_file', { filePath: 'alias.txt', content: 'A' });
    const a = await exec('append', { path: 'alias.txt', content: 'B' });
    expect(a.success).toBe(true);
    const e = await exec('replace_text', { path: 'alias.txt', old_string: 'AB', new_string: 'ABC' });
    expect(e.success).toBe(true);
    expect(fs.readFileSync(path.join(testDir, 'alias.txt'), 'utf8')).toBe('ABC');
  });

  // ------------------------------------------------------------------ §5 ---

  const placeholderCase = (name: string, fileName: string, content: string) =>
    it(`rejects placeholder content: ${name}`, async () => {
      // Note: an empty "implementation" cannot even be written through the
      // write_file tool (non-empty content is required) — so an empty file
      // only reaches the verifier when created directly on disk.
      if (content === '') {
        workspace.createFile(fileName, '');
      } else {
        await exec('write_file', { filePath: fileName, content });
      }
      const report = await verifier.verifyFiles([fileName]);
      expect(report.allOk).toBe(false);
      const failure = report.failures.find((f) => f.check === 'placeholder-content');
      expect(failure).toBeDefined();
      expect(failure?.error).toMatch(/no implementation/i);
    });

  placeholderCase('empty Python file created directly on disk', 'main.py', '');
  placeholderCase('TODO-only Python file', 'main.py', '# TODO\n# implementation goes here\n');
  placeholderCase('pass-only Python file', 'main.py', 'def run():\n    pass\n');
  placeholderCase('comments-only JavaScript file', 'app.js', '// TODO: implement the game\n// coming soon\n');
  placeholderCase('coming-soon print stub', 'main.py', 'print("Coming soon")\n');
  placeholderCase('docstring-only Python file', 'main.py', '"""Placeholder module."""\n');

  it('accepts a genuinely implemented file (no false positives on real code)', async () => {
    const files: Array<[string, string]> = [
      ['real.py', 'def add(a, b):\n    return a + b\n'],
      ['real.js', 'function add(a, b) {\n  return a + b;\n}\nmodule.exports = { add };\n'],
      ['index.html', '<!doctype html>\n<html><head><title>T</title></head><body><h1>App</h1></body></html>\n'],
      ['style.css', 'body { margin: 0; font-family: sans-serif; }\n'],
    ];
    for (const [name, content] of files) {
      await exec('write_file', { filePath: name, content });
    }
    const report = await verifier.verifyFiles(files.map(([n]) => n));
    expect(report.failures.filter((f) => f.check === 'placeholder-content')).toHaveLength(0);
  });

  it('exempts legitimately-empty package markers (__init__.py, .gitkeep)', async () => {
    await exec('write_file', { filePath: 'pkg/__init__.py', content: '' });
    const report = await verifier.verifyFiles(['pkg/__init__.py']);
    expect(report.failures.filter((f) => f.check === 'placeholder-content')).toHaveLength(0);
  });

  it('does not apply placeholder rules to non-code files (README.md)', async () => {
    await exec('write_file', { filePath: 'README.md', content: '# TODO app\nComing soon.\n' });
    const report = await verifier.verifyFiles(['README.md']);
    expect(report.failures.filter((f) => f.check === 'placeholder-content')).toHaveLength(0);
  });
});
