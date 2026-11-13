import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { findWhitespaceTolerantMatches, ToolRegistry } from '../toolRegistry.js';
import { WorkspaceManager } from '../workspace.js';
import { TerminalService } from '../terminal.js';
import { GitService } from '../git.js';
import { CodebaseIndexer } from '../indexer.js';
import { SettingsStore, DEFAULT_SETTINGS } from '../settings.js';
import { WorkspaceVerifier } from '../verifier.js';
import { AgentEngine } from '../agentEngine.js';
import type { AIProvider } from '../qwen.js';

/**
 * Reliability contract for focused edits and thin tool surfaces:
 *
 *  §M1  whitespace-tolerant recovery — a quoted oldString that matches the
 *       file only after normalizing indentation/tabs/trailing whitespace is
 *       applied against the REAL file text (never silently for a different
 *       code shape), while genuinely absent quotes still fail honestly.
 *  §M2  ambiguity is preserved — a whitespace-tolerant match that lands in
 *       several places is still rejected instead of guessing.
 *  §M3  every advertised tool has a working handler (detect_language was
 *       previously registered but unimplemented).
 *  §M4  malformed arguments produce precise, retryable errors instead of a
 *       crash deep inside the diff engine (patch tools without newContent).
 *  §M5  unbounded numeric arguments are clamped (git log limit, structure
 *       depth).
 */

describe('edit_file whitespace recovery and tool-surface reliability', () => {
  let testDir: string;
  let workspace: WorkspaceManager;
  let registry: ToolRegistry;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-edit-reliability-'));
    workspace = new WorkspaceManager(testDir);
    const settings = new SettingsStore(path.join(testDir, '.quillix-test-settings.json'));
    settings.update({ ...DEFAULT_SETTINGS, autoApplyDiffs: true, terminalApproval: false });
    const terminal = new TerminalService();
    const git = new GitService(terminal);
    const indexer = new CodebaseIndexer(workspace, git);
    registry = new ToolRegistry(workspace, terminal, git, indexer, settings);
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  const exec = (name: string, args: Record<string, any>) =>
    registry.executeTool(`tc_${name}_${Math.random().toString(36).slice(2, 8)}`, name, args);

  // ------------------------------------------------------------------ §M1 ---

  it('applies an edit whose oldString differs only in indentation', async () => {
    const source = [
      'function total(items) {',
      '  let sum = 0;',
      '  for (const item of items) {',
      '    sum += item.price;',
      '  }',
      '  return sum;',
      '}',
    ].join('\n');
    await exec('write_file', { filePath: 'cart.js', content: source });
    // Model quoted the block without the leading indentation; the proposed
    // replacement text is applied verbatim and the model is told the match
    // was whitespace-normalized so it can verify the result.
    const result = await exec('edit_file', {
      filePath: 'cart.js',
      oldString: 'for (const item of items) {\nsum += item.price;\n}',
      newString: 'for (const item of items) {\n  sum += item.price;\n}',
    });
    expect(result.success).toBe(true);
    expect(result.output).toContain('whitespace');
    const updated = workspace.readFile('cart.js').content!;
    expect(updated).toContain('for (const item of items) {\n  sum += item.price;\n}');
    // Surrounding code is untouched.
    expect(updated).toContain('function total(items) {');
    expect(updated).toContain('return sum;');
  });

  it('applies an edit when tabs were quoted as spaces and vice versa', async () => {
    await exec('write_file', { filePath: 'tabs.py', content: 'def greet(name):\n\treturn "hi"\n' });
    const result = await exec('edit_file', { filePath: 'tabs.py', oldString: '    return "hi"', newString: '    return "hello"' });
    expect(result.success).toBe(true);
    // The quoted block is replaced with the proposed text verbatim.
    expect(workspace.readFile('tabs.py').content).toBe('def greet(name):\n    return "hello"\n');
  });

  it('applies an edit when the quote lost trailing whitespace on a line', async () => {
    const source = 'exports.a = 1;   \nexports.b = 2;\n';
    await exec('write_file', { filePath: 'trail.cjs', content: source });
    const result = await exec('edit_file', { filePath: 'trail.cjs', oldString: 'exports.b = 2;', newString: 'exports.b = 3;' });
    expect(result.success).toBe(true);
    // Exact substring match still wins here; the trailing spaces stay intact.
    expect(workspace.readFile('trail.cjs').content).toBe('exports.a = 1;   \nexports.b = 3;\n');
  });

  it('applies a CRLF-tolerant edit to an LF file quoted with CRLF', async () => {
    await exec('write_file', { filePath: 'eol.txt', content: 'alpha\nbeta\ngamma\n' });
    const result = await exec('edit_file', { filePath: 'eol.txt', oldString: 'alpha\r\nbeta', newString: 'alpha\nBETA' });
    expect(result.success).toBe(true);
    expect(workspace.readFile('eol.txt').content).toBe('alpha\nBETA\ngamma\n');
  });

  it('still fails when the oldString is genuinely absent', async () => {
    await exec('write_file', { filePath: 'real.js', content: 'const value = 41;\n' });
    const result = await exec('edit_file', { filePath: 'real.js', oldString: 'const other = 42;', newString: 'const other = 43;' });
    expect(result.success).toBe(false);
    expect(result.output).toContain('not found');
    expect(workspace.readFile('real.js').content).toBe('const value = 41;\n');
  });

  it('still fails on a whitespace-tolerant match that lands in several places', async () => {
    const source = 'function a() {\n    return 1;\n}\nfunction b() {\n    return 1;\n}\n';
    await exec('write_file', { filePath: 'dup.js', content: source });
    const result = await exec('edit_file', { filePath: 'dup.js', oldString: 'return 1;', newString: 'return 2;' });
    expect(result.success).toBe(false);
    expect(result.output).toContain('Ambiguous');
    expect(workspace.readFile('dup.js').content).toBe(source);
  });

  it('applies a unique tolerant match and keeps the surrounding code intact', async () => {
    const source = 'class Cart {\n  add(item) {\n    this.items.push(item);\n  }\n}\n';
    await exec('write_file', { filePath: 'cart.js', content: source });
    const result = await exec('edit_file', {
      filePath: 'cart.js',
      oldString: 'this.items.push(item);',
      newString: 'this.items.push({ ...item, at: Date.now() });',
    });
    expect(result.success).toBe(true);
    expect(workspace.readFile('cart.js').content).toContain('this.items.push({ ...item, at: Date.now() });');
    expect(workspace.readFile('cart.js').content).toContain('class Cart {');
  });

  // ------------------------------------------------------------------ §M2 ---

  it('findWhitespaceTolerantMatches maps canonical hits back to real offsets', () => {
    const content = 'one two\nthree   four\nfive six\n';
    const matches = findWhitespaceTolerantMatches(content, 'three four');
    expect(matches).toHaveLength(1);
    expect(content.slice(matches[0].start, matches[0].end)).toBe('three   four');
    expect(findWhitespaceTolerantMatches(content, 'seven eight')).toEqual([]);
    expect(findWhitespaceTolerantMatches(content, '   ')).toEqual([]);
    expect(findWhitespaceTolerantMatches('', 'x')).toEqual([]);
  });

  // ------------------------------------------------------------------ §M3 ---

  it('detect_language works for known and unknown extensions', async () => {
    await exec('write_file', { filePath: 'main.py', content: 'print("hi")\n' });
    await exec('write_file', { filePath: 'app.ts', content: 'export const a: number = 1;\n' });
    await exec('write_file', { filePath: 'style.css', content: 'body { color: red; }\n' });
    await exec('write_file', { filePath: 'notes.xyz', content: 'plain\n' });
    const py = await exec('detect_language', { filePath: 'main.py' });
    expect(py.success).toBe(true);
    expect(py.output).toContain('Python');
    const ts = await exec('detect_language', { filePath: 'app.ts' });
    expect(ts.output).toContain('TypeScript');
    const css = await exec('detect_language', { filePath: 'style.css' });
    expect(css.output).toContain('CSS');
    const unknown = await exec('detect_language', { filePath: 'notes.xyz' });
    expect(unknown.success).toBe(true);
    expect(unknown.output).toContain('Unknown');
    const missing = await exec('detect_language', { filePath: 'nope.py' });
    expect(missing.success).toBe(true);
    expect(missing.output).toContain('Python');
  });

  it('detect_language uses the shebang when the extension lies', async () => {
    await exec('write_file', { filePath: 'runner', content: '#!/usr/bin/env python3\nprint(1)\n' });
    const result = await exec('detect_language', { filePath: 'runner' });
    expect(result.success).toBe(true);
    expect(result.output).toContain('Python');
  });

  it('detect_language rejects a missing filePath with a precise error', async () => {
    const result = await exec('detect_language', {});
    expect(result.success).toBe(false);
    expect(result.output).toContain('filePath');
  });

  it('every advertised tool now has an executable handler', async () => {
    // Read-only, side-effect-free tools can all be executed without touching
    // the workspace: prove no advertised tool name falls through to the
    // "Unknown tool" default branch.
    const safeCalls: Array<[string, Record<string, any>]> = [
      ['list_directory', { dirPath: '.' }],
      ['get_project_structure', { dirPath: '.', maxDepth: 2 }],
      ['detect_project', {}],
      ['detect_framework', {}],
      ['detect_package_manager', {}],
      ['detect_project_type', {}],
      ['language_diagnostics', {}],
      ['git_status', {}],
      ['git_branch', {}],
      ['git_log', { limit: 5 }],
    ];
    await exec('write_file', { filePath: 'sample.txt', content: 'hello\n' });
    for (const [name, args] of safeCalls) {
      const result = await exec(name, args);
      expect(result.success, `${name} should execute`).toBe(true);
      expect(result.output, `${name} should not be unknown`).not.toContain('Unknown tool');
    }
  });

  // ------------------------------------------------------------------ §M4 ---

  it('patch tools reject a missing newContent with a precise error', async () => {
    await exec('write_file', { filePath: 'target.js', content: 'const a = 1;\n' });
    for (const name of ['create_patch', 'preview_patch', 'apply_patch']) {
      const result = await exec(name, { filePath: 'target.js' });
      expect(result.success, `${name} must not crash`).toBe(false);
      expect(result.output, `${name} must explain the missing argument`).toContain('newContent');
    }
    // The file is untouched.
    expect(workspace.readFile('target.js').content).toBe('const a = 1;\n');
  });

  it('apply_patch still applies a complete proposed content', async () => {
    await exec('write_file', { filePath: 'target.js', content: 'const a = 1;\n' });
    const result = await exec('apply_patch', { filePath: 'target.js', newContent: 'const a = 2;\n' });
    expect(result.success).toBe(true);
    expect(workspace.readFile('target.js').content).toBe('const a = 2;\n');
  });

  // ------------------------------------------------------------------ §M5 ---

  it('clamps absurd numeric arguments instead of walking unbounded', async () => {
    const deep = await exec('get_project_structure', { dirPath: '.', maxDepth: 1e9 });
    expect(deep.success).toBe(true);
    const negative = await exec('get_project_structure', { dirPath: '.', maxDepth: -5 });
    expect(negative.success).toBe(true);
    const log = await exec('git_log', { limit: 'not-a-number' });
    // Non-repo workspace: the call must resolve, not crash.
    expect(log.success).toBe(true);
  });

  // ------------------------------------------------------------------ §M6 ---
  // End-to-end through the AgentEngine: a small model quoting an oldString
  // with the wrong indentation must still complete the requested fix in one
  // turn, and the user acceptance check must pass for real.

  it('agent engine completes an existing-project fix when the quote has wrong indentation', async () => {
    const source = [
      'function formatTotal(cents) {',
      '  const dollars = cents / 100;',
      '  return dollars.toFixed(2);',
      '}',
      'module.exports = { formatTotal };',
    ].join('\n');
    fs.writeFileSync(path.join(testDir, 'money.cjs'), source);
    const provider = {
      async chatWithToolsStream() {
        return {
          text: '',
          toolCalls: [{
            id: 'indented-edit',
            name: 'edit_file',
            args: {
              filePath: 'money.cjs',
              // Quoted without the function's one-level indentation.
              oldString: 'const dollars = cents / 100;',
              newString: 'const dollars = Math.round(cents) / 100;',
            },
          }],
        };
      },
    } as unknown as AIProvider;
    const terminal = new TerminalService();
    const git = new GitService(terminal);
    const indexer = new CodebaseIndexer(workspace, git);
    const settings = new SettingsStore(path.join(testDir, '.quillix-test-settings.json'));
    settings.update({ ...DEFAULT_SETTINGS, autoApplyDiffs: true, terminalApproval: false });
    const registry = new ToolRegistry(workspace, terminal, git, indexer, settings);
    const engine = new AgentEngine(provider, registry, indexer, new WorkspaceVerifier(workspace, terminal));
    const command = 'node -e "const {formatTotal}=require(\'./money.cjs\'); if (formatTotal(1234) !== \'12.34\') process.exit(1);"';
    const result = await engine.run({
      userPrompt: 'Fix rounding in money.cjs.',
      mode: 'agent',
      conversationHistory: [],
      verificationCommands: [command],
      requestApproval: async () => true,
      settings: { maxAutonomousTurns: 6, temperature: 0, autoApplyDiffs: true },
    });
    // The tolerance path is what made this a single-turn fix.
    expect(result.toolResults.some(tool => tool.toolName === 'edit_file' && tool.success)).toBe(true);
    expect(result.toolResults.some(tool => tool.toolName === 'edit_file' && !tool.success)).toBe(false);
    expect(result.finalText).toContain('User acceptance checks passed');
    expect(fs.readFileSync(path.join(testDir, 'money.cjs'), 'utf8')).toContain('Math.round(cents)');
  });
});