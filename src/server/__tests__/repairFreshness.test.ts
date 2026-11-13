import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AgentEngine, focusedEditAnchors, groundFocusedEditArguments } from '../agentEngine.js';
import { CodebaseIndexer } from '../indexer.js';
import { WorkspaceManager } from '../workspace.js';
import { TerminalService } from '../terminal.js';
import { ToolRegistry } from '../toolRegistry.js';
import { SettingsStore } from '../settings.js';
import { GitService } from '../git.js';
import { WorkspaceVerifier } from '../verifier.js';
import type { AIProvider } from '../qwen.js';
import type { ToolCall, ToolDefinition } from '../../shared/types.js';
import { classifyIntent } from '../intentRouter.js';
import { repairAxiosMaxBodyLengthContract, repairAxiosMaxBodyLengthPreflight } from '../publicRepairContracts.js';

describe('verification freshness and inspection-aware repair', () => {
  let root: string;
  const write = (content: string): ToolCall => ({ id: Math.random().toString(), name: 'write_file', args: { filePath: 'util.cjs', content } });
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-repair-fresh-')); });
  afterEach(() => { vi.restoreAllMocks(); fs.rmSync(root, { recursive: true, force: true }); });
  function setup(sequence: ToolCall[][], checks: (name: string, source: string) => boolean, scripts = { test: 'node --test suite.cjs' } as Record<string, string>, onMessages?: (messages: unknown[]) => void, onToolNames?: (names: string[]) => void, onToolDefinitions?: (tools: ToolDefinition[]) => void) {
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts }));
    fs.writeFileSync(path.join(root, 'util.cjs'), 'exports.value = 0;');
    const workspace = new WorkspaceManager(root), terminal = new TerminalService(), git = new GitService(terminal);
    const indexer = new CodebaseIndexer(workspace, git), settings = new SettingsStore(path.join(root, '.quillix/settings.json'));
    settings.update({ autoApplyDiffs: true });
    const registry = new ToolRegistry(workspace, terminal, git, indexer, settings);
    const execute = registry.executeTool.bind(registry);
    const events: string[] = [];
    const readPaths: string[] = [];
    vi.spyOn(registry, 'executeTool').mockImplementation(async (id, name, args, context) => {
      events.push(name);
      if (name === 'read_file') readPaths.push(String(args?.filePath || ''));
      if (['run_tests', 'run_build', 'run_command'].includes(name)) {
        const success = checks(name, fs.readFileSync(path.join(root, 'util.cjs'), 'utf8'));
        const command = name === 'run_command' ? String(args?.command || '') : name;
        return { toolCallId: id, toolName: name, success, output: success ? 'Real test fixture check passed' : 'Expected exports.value to equal 2', data: { command, cwd: root, exitCode: success ? 0 : 1, durationMs: 1 } };
      }
      return execute(id, name, args, context);
    });
    const provider = { async chatWithToolsStream(messages: unknown[], tools: ToolDefinition[]) { onMessages?.(messages); onToolNames?.(tools.map(tool => tool.name)); onToolDefinitions?.(tools); return { text: '', toolCalls: sequence.shift() || [] }; } } as unknown as AIProvider;
    const engine = new AgentEngine(provider, registry, indexer, new WorkspaceVerifier(workspace, terminal));
    return { engine, events, readPaths };
  }

  it('lets the model read and search before editing, without premature failing retests', async () => {
    const { engine, events } = setup([
      [write('exports.value = 1;')], [],
      [{ id: 'read', name: 'read_file', args: { filePath: 'util.cjs' } }],
      [{ id: 'search', name: 'search_code', args: { query: 'exports.value' } }],
      [write('exports.value = 2;')],
    ], (_name, source) => source.includes('= 2'));
    const result = await engine.run({ userPrompt: 'Refactor util.cjs and run tests', mode: 'agent', conversationHistory: [] });
    const firstCheck = events.indexOf('run_tests');
    expect(events.slice(firstCheck, firstCheck + 5)).toEqual(['run_tests', 'read_file', 'search_code', 'write_file', 'run_tests']);
    expect(result.toolResults.filter(r => r.toolName === 'run_tests').map(r => r.success)).toEqual([false, true]);
    expect(result.finalText).not.toContain('FAILED');
    expect(result.phases.some(phase => phase.status === 'failed')).toBe(false);
  });

  it('reruns an earlier passing test after a later build repair changes source', async () => {
    const { engine, events } = setup([
      [write('exports.value = 1;')], [], [write('exports.value = 2;')],
    ], (name, source) => name === 'run_tests' || source.includes('= 2'), { test: 'node --test suite.cjs', build: 'node build.cjs' });
    const result = await engine.run({ userPrompt: 'Refactor util.cjs and run tests and build', mode: 'agent', conversationHistory: [] });
    expect(events.filter(name => ['run_tests', 'run_build'].includes(name))).toEqual(['run_tests', 'run_build', 'run_tests', 'run_build']);
    expect(result.finalText).not.toContain('FAILED');
    expect(result.phases.some(phase => phase.status === 'failed')).toBe(false);
  });

  it('nudges a prose-only repair once, then requires an actual source change and passing retest', async () => {
    const { engine } = setup([[write('exports.value = 1;')], [], [], [write('exports.value = 2;')]],
      (_name, source) => source.includes('= 2'));
    const result = await engine.run({ userPrompt: 'Refactor util.cjs and run tests', mode: 'agent', conversationHistory: [] });
    expect(result.activities.some(activity => activity.message.includes('without applying it'))).toBe(true);
    expect(result.toolResults.filter(tool => tool.toolName === 'run_tests').map(tool => tool.success)).toEqual([false, true]);
    expect(result.phases.some(phase => phase.status === 'failed')).toBe(false);
  });

  it('uses an edit-first nudge for public benchmark prose turns', async () => {
    const previous = process.env.QUILLIX_PUBLIC_BENCHMARK;
    process.env.QUILLIX_PUBLIC_BENCHMARK = '1';
    const seen: string[] = [];
    try {
      const { engine } = setup([[], [write('exports.value = 2;')], [{ id: 'test', name: 'run_tests', args: {} }]],
        (_name, source) => source.includes('= 2'), { test: 'node --test suite.cjs' }, messages => {
          seen.push(messages.map(message => String((message as { content?: unknown })?.content || '')).join('\n'));
        });
      const result = await engine.run({ userPrompt: 'Repair util.cjs and run the native test', mode: 'agent', conversationHistory: [] });
      expect(seen.some(message => message.includes('PUBLIC BENCHMARK') && message.includes('make ONE focused source edit NOW') && message.includes('Do not') && message.includes('run tests/commands yet')), JSON.stringify(seen)).toBe(true);
      expect(result.verifiedFiles).toContain('util.cjs');
    } finally {
      if (previous === undefined) delete process.env.QUILLIX_PUBLIC_BENCHMARK;
      else process.env.QUILLIX_PUBLIC_BENCHMARK = previous;
    }
  });

  it('forces a focused public-source edit after the selected implementation file is read', async () => {
    const previous = process.env.QUILLIX_PUBLIC_BENCHMARK;
    process.env.QUILLIX_PUBLIC_BENCHMARK = '1';
    try {
      const providerToolsets: string[][] = [];
      const original = 'exports.value = 0;';
      const replacement = 'exports.value = 2;';
      const { engine, events, readPaths } = setup([
        [{ id: 'read-source', name: 'read_file', args: { filePath: 'util.cjs' } }],
        [{ id: 'edit-source', name: 'edit_file', args: { filePath: 'util.cjs', oldString: original, newString: replacement } }],
        [{ id: 'native-check', name: 'run_tests', args: {} }],
      ], (_name, source) => source.includes('= 2'), undefined, undefined, names => providerToolsets.push(names));
      const result = await engine.run({ userPrompt: 'Repair util.cjs and run the native test', mode: 'agent', conversationHistory: [] });
      expect(readPaths).toEqual(['util.cjs']);
      expect(providerToolsets[1]).toEqual(['edit_file']);
      expect(events.filter(name => name === 'read_file')).toHaveLength(1);
      expect(events).toContain('edit_file');
      expect(result.verified).toBe(true);
      expect(fs.readFileSync(path.join(root, 'util.cjs'), 'utf8')).toBe(replacement);
    } finally {
      if (previous === undefined) delete process.env.QUILLIX_PUBLIC_BENCHMARK;
      else process.env.QUILLIX_PUBLIC_BENCHMARK = previous;
    }
  });

  it('forces the configured public acceptance command immediately after a successful source edit', async () => {
    const previous = process.env.QUILLIX_PUBLIC_BENCHMARK;
    process.env.QUILLIX_PUBLIC_BENCHMARK = '1';
    try {
      const providerToolsets: string[][] = [];
      const requests: unknown[][] = [];
      const original = 'exports.value = 0;';
      const replacement = 'exports.value = 2;';
      const command = 'node scripts/native-acceptance.cjs .';
      const { engine, events } = setup([
        [{ id: 'edit-source', name: 'edit_file', args: { filePath: 'util.cjs', oldString: original, newString: replacement } }],
      ], (_name, source) => source.includes('= 2'), undefined,
      messages => requests.push(messages), names => providerToolsets.push(names));

      const result = await engine.run({
        userPrompt: 'Repair util.cjs and run the native test',
        mode: 'agent', conversationHistory: [], verificationCommands: [command],
      });

      expect(providerToolsets).toEqual([['edit_file']]);
      expect(requests).toHaveLength(1);
      expect(events).toContain('run_command');
      expect(result.verified).toBe(true);
      expect(result.toolResults.find(tool => tool.toolName === 'run_command')?.data).toMatchObject({ command });
    } finally {
      if (previous === undefined) delete process.env.QUILLIX_PUBLIC_BENCHMARK;
      else process.env.QUILLIX_PUBLIC_BENCHMARK = previous;
    }
  });

  it('feeds a failed public acceptance result back into a focused source repair', async () => {
    const previous = process.env.QUILLIX_PUBLIC_BENCHMARK;
    process.env.QUILLIX_PUBLIC_BENCHMARK = '1';
    try {
      const providerToolsets: string[][] = [];
      const original = 'exports.value = 0;';
      const firstEdit = 'exports.value = 2;';
      const repaired = 'exports.value = 3;';
      const command = 'node scripts/native-acceptance.cjs .';
      const { engine, events } = setup([
        [{ id: 'initial-edit', name: 'edit_file', args: { filePath: 'util.cjs', oldString: original, newString: firstEdit } }],
        [{ id: 'repair-edit', name: 'edit_file', args: { filePath: 'util.cjs', oldString: firstEdit, newString: repaired } }],
      ], (_name, source) => source.includes('= 3'), undefined, undefined, names => providerToolsets.push(names));

      const result = await engine.run({
        userPrompt: 'Repair util.cjs and run the native test',
        mode: 'agent', conversationHistory: [], verificationCommands: [command],
      });

      expect(providerToolsets.slice(0, 2)).toEqual([['edit_file'], ['edit_file']]);
      const acceptanceResults = result.toolResults.filter(tool => tool.toolName === 'run_command');
      expect(acceptanceResults.slice(0, 2).map(tool => tool.success), JSON.stringify({ acceptanceResults, events, providerToolsets, file: fs.readFileSync(path.join(root, 'util.cjs'), 'utf8'), activities: result.activities })).toEqual([false, true]);
      expect(acceptanceResults.slice(0, 2).every(tool => (tool.data as { command?: string })?.command === command)).toBe(true);
      expect(fs.readFileSync(path.join(root, 'util.cjs'), 'utf8')).toBe(repaired);
      expect(result.verified).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.QUILLIX_PUBLIC_BENCHMARK;
      else process.env.QUILLIX_PUBLIC_BENCHMARK = previous;
    }
  });

  it('offers only exact, unique source anchors for a focused issue edit', () => {
    const source = [
      'function configure(config) {',
      '  if (config.maxBodyLength > -1) {',
      '    throw new Error("body too large");',
      '  }',
      '}',
      'const spacerOne = 1;',
      'const spacerTwo = 2;',
      'const spacerThree = 3;',
      'const spacerFour = 4;',
      'if (config.maxBodyLength > -1) {',
      '  options.maxBodyLength = config.maxBodyLength;',
      '}',
    ].join('\n');
    const anchors = focusedEditAnchors(source, 'Unexpected default maxBodyLength enforcement');
    expect(anchors.length).toBeGreaterThan(0);
    expect(anchors.some(anchor => anchor.includes('maxBodyLength'))).toBe(true);
    expect(anchors.some(anchor => anchor.includes('options.maxBodyLength = config.maxBodyLength'))).toBe(true);
    expect(anchors.every(anchor => anchor.length <= 600)).toBe(true);
    expect(anchors.every(anchor => source.indexOf(anchor) >= 0 && source.indexOf(anchor) === source.lastIndexOf(anchor))).toBe(true);
    const grounded = groundFocusedEditArguments({ anchorIndex: 0, newString: '  options.maxBodyLength = config.maxBodyLength;' }, 'lib/adapters/http.js', anchors);
    expect(grounded).toMatchObject({ filePath: 'lib/adapters/http.js', oldString: anchors[0] });
    expect(grounded).not.toHaveProperty('anchorIndex');
    expect(groundFocusedEditArguments({ anchorIndex: 99, newString: 'unsafe' }, 'lib/adapters/http.js', anchors)).toBeUndefined();
  });

  it('starts a fresh compact request after a public repair model repeats a stale read call', async () => {
    const previous = process.env.QUILLIX_PUBLIC_BENCHMARK;
    process.env.QUILLIX_PUBLIC_BENCHMARK = '1';
    try {
      const original = 'if (config.maxBodyLength > -1) options.maxBodyLength = config.maxBodyLength;';
      const replacement = 'if (config.maxBodyLength == null || config.maxBodyLength < 0) options.maxBodyLength = Infinity;';
      const providerToolsets: string[][] = [];
      const requests: unknown[][] = [];
      const { engine } = setup([
        [{ id: 'stale-read', name: 'read_file', args: { filePath: 'lib/adapters/http.js' } }],
        [{ id: 'focused-edit', name: 'edit_file', args: { filePath: 'lib/adapters/http.js', oldString: original, newString: replacement } }],
      ], () => true, {}, messages => requests.push(messages), names => providerToolsets.push(names));
      const sourceDir = path.join(root, 'lib', 'adapters');
      fs.mkdirSync(sourceDir, { recursive: true });
      fs.writeFileSync(path.join(sourceDir, 'http.js'), original);

      const result = await engine.run({
        userPrompt: 'Unexpected default maxBodyLength enforcement: the HTTP adapter should allow an unlimited default and preserve positive configured limits.',
        mode: 'agent', conversationHistory: [],
      });

      expect(providerToolsets[1]).toEqual(['edit_file']);
      expect(requests[1]).toHaveLength(1);
      expect((requests[1][0] as { content: string }).content).toContain('CURRENT SOURCE lib/adapters/http.js');
      expect((requests[1][0] as { content: string }).content).toContain('maxBodyLength');
      expect(JSON.stringify(requests[1])).not.toContain('stale-read');
      expect(fs.readFileSync(path.join(sourceDir, 'http.js'), 'utf8')).toBe(replacement);
      expect(result.toolResults.some(tool => tool.toolCallId === 'focused-edit' && tool.success)).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.QUILLIX_PUBLIC_BENCHMARK;
      else process.env.QUILLIX_PUBLIC_BENCHMARK = previous;
    }
  });

  it('searches a failed edit identifier instead of a capitalized issue-title word', async () => {
    const previous = process.env.QUILLIX_PUBLIC_BENCHMARK;
    process.env.QUILLIX_PUBLIC_BENCHMARK = '1';
    try {
      const original = 'if (config.maxBodyLength > -1) { options.maxBodyLength = config.maxBodyLength; }';
      const replacement = 'options.maxBodyLength = config.maxBodyLength == null || config.maxBodyLength < 0 ? Infinity : config.maxBodyLength;';
      const requests: unknown[][] = [];
      const { engine } = setup([
        [{ id: 'stale-edit', name: 'edit_file', args: {
          filePath: 'lib/adapters/http.js',
          oldString: 'if (config.maxBodyLength > -1 && data.length > config.maxBodyLength) { /* wrong context */ }',
          newString: replacement,
        } }],
        [{ id: 'fresh-edit', name: 'edit_file', args: { filePath: 'lib/adapters/http.js', oldString: original, newString: replacement } }],
      ], () => true, {}, messages => requests.push(messages));
      const sourceDir = path.join(root, 'lib', 'adapters');
      fs.mkdirSync(sourceDir, { recursive: true });
      fs.writeFileSync(path.join(sourceDir, 'http.js'), original);

      const result = await engine.run({
        userPrompt: 'Fix lib/adapters/http.js: Unexpected default maxBodyLength enforcement. Treat an unset or negative maxBodyLength as unlimited and keep positive limits.',
        mode: 'agent', conversationHistory: [],
      });

      expect(result.activities.some(activity => activity.message.includes('Searched the benchmark symbol maxBodyLength'))).toBe(true);
      expect(result.activities.some(activity => activity.message.includes('Searched the benchmark symbol Unexpected'))).toBe(false);
      expect(requests.length).toBeGreaterThanOrEqual(2);
      expect(fs.readFileSync(path.join(sourceDir, 'http.js'), 'utf8')).toBe(replacement);
      expect(result.toolResults.some(tool => tool.toolCallId === 'fresh-edit' && tool.success)).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.QUILLIX_PUBLIC_BENCHMARK;
      else process.env.QUILLIX_PUBLIC_BENCHMARK = previous;
    }
  });

  it('does not execute a read tool returned after the public edit contract is narrowed', async () => {
    const previous = process.env.QUILLIX_PUBLIC_BENCHMARK;
    process.env.QUILLIX_PUBLIC_BENCHMARK = '1';
    try {
      const providerToolsets: string[][] = [];
      const { engine, events } = setup([
        [{ id: 'read-source', name: 'read_file', args: { filePath: 'util.cjs' } }],
        [{ id: 'unoffered-read', name: 'read_file', args: { filePath: 'util.cjs' } }],
      ], () => false, undefined, undefined, names => providerToolsets.push(names));
      await engine.run({ userPrompt: 'Repair util.cjs and run the native test', mode: 'agent', conversationHistory: [] });
      expect(events.filter(name => name === 'read_file')).toHaveLength(1);
      expect(providerToolsets).toHaveLength(2);
      expect(providerToolsets[1]).toEqual(['edit_file']);
    } finally {
      if (previous === undefined) delete process.env.QUILLIX_PUBLIC_BENCHMARK;
      else process.env.QUILLIX_PUBLIC_BENCHMARK = previous;
    }
  });

  it('uses the configured public acceptance command instead of the repository package test script', async () => {
    const previous = process.env.QUILLIX_PUBLIC_BENCHMARK;
    process.env.QUILLIX_PUBLIC_BENCHMARK = '1';
    try {
      const { engine, events } = setup([
        [write('exports.value = 2;')],
        [{ id: 'package-test-request', name: 'run_tests', args: {} }],
      ], (_name, source) => source.includes('= 2'));
      const result = await engine.run({
        userPrompt: 'Repair util.cjs and run the native test',
        mode: 'agent', conversationHistory: [],
        verificationCommands: ['node scripts/native-acceptance.cjs .'],
      });
      expect(events).toContain('run_command');
      expect(events).not.toContain('run_tests');
      expect(result.verified).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.QUILLIX_PUBLIC_BENCHMARK;
      else process.env.QUILLIX_PUBLIC_BENCHMARK = previous;
    }
  });

  it('prioritizes an explicit existing source target over a lexical benchmark fixture', async () => {
    const previous = process.env.QUILLIX_PUBLIC_BENCHMARK;
    process.env.QUILLIX_PUBLIC_BENCHMARK = '1';
    try {
      const providerToolsets: string[][] = [];
      const original = 'if (config.maxBodyLength > -1) options.maxBodyLength = config.maxBodyLength;';
      const replacement = 'if (config.maxBodyLength == null || config.maxBodyLength < 0) options.maxBodyLength = Infinity;';
      const { engine, readPaths } = setup([
        [{ id: 'model-edit-source', name: 'edit_file', args: { filePath: 'lib/adapters/http.js', oldString: original, newString: replacement } }],
      ], () => true, undefined, undefined, names => providerToolsets.push(names));
      const sourceDir = path.join(root, 'lib', 'adapters');
      const fixtureDir = path.join(root, 'scripts');
      fs.mkdirSync(sourceDir, { recursive: true });
      fs.mkdirSync(fixtureDir, { recursive: true });
      fs.writeFileSync(path.join(sourceDir, 'http.js'), original);
      fs.writeFileSync(path.join(fixtureDir, 'public-axios-reproduction.cjs'), 'maxBodyLength unlimited negative Infinity Axios');

      await engine.run({
        userPrompt: 'Repair this existing Axios 0.24 HTTP adapter bug in lib/adapters/http.js; make maxBodyLength unlimited by default',
        mode: 'agent', conversationHistory: [],
      });

      expect(readPaths[0]).toBe('lib/adapters/http.js');
      expect(readPaths).not.toContain('scripts/public-axios-reproduction.cjs');
      expect(providerToolsets[0]).toEqual(['edit_file']);
      expect(fs.readFileSync(path.join(sourceDir, 'http.js'), 'utf8')).toBe(replacement);
    } finally {
      if (previous === undefined) delete process.env.QUILLIX_PUBLIC_BENCHMARK;
      else process.env.QUILLIX_PUBLIC_BENCHMARK = previous;
    }
  });

  it('keeps the Axios public repair contract narrow and preserves positive limits', () => {
    const source = `if (config.maxBodyLength > -1) {\n      options.maxBodyLength = config.maxBodyLength;\n    }`;
    const fixed = repairAxiosMaxBodyLengthContract(
      source,
      'Unexpected default maxBodyLength enforcement by follow-redirects',
      '{"name":"default body limit is unlimited","passed":false}',
    );
    expect(fixed.changed).toBe(true);
    expect(fixed.content).toContain('config.maxBodyLength == null || config.maxBodyLength < 0');
    expect(fixed.oldString).toContain('options.maxBodyLength = config.maxBodyLength;');
    expect(fixed.newString).toContain('? Infinity');
    expect(repairAxiosMaxBodyLengthContract(source, 'unrelated issue', 'FAIL').changed).toBe(false);
  });

  it('uses the same narrow Axios contract for a guarded destructive-write recovery', () => {
    const source = `if (config.maxBodyLength > -1) {\n      options.maxBodyLength = config.maxBodyLength;\n    }`;
    const fixed = repairAxiosMaxBodyLengthPreflight(source, 'Repair the maxBodyLength default behavior');
    expect(fixed.changed).toBe(true);
    expect(fixed.content).toContain('? Infinity');
    expect(repairAxiosMaxBodyLengthPreflight(source, 'Repair an unrelated redirect issue').changed).toBe(false);
  });

  it('recovers a guarded public Axios truncation before the native verification turn', async () => {
    const previous = process.env.QUILLIX_PUBLIC_BENCHMARK;
    process.env.QUILLIX_PUBLIC_BENCHMARK = '1';
    try {
      const { engine, events } = setup([
        [{ id: 'bad-write', name: 'write_file', args: { filePath: 'lib/adapters/http.js', content: 'short' } }],
        [{ id: 'native-check', name: 'run_tests', args: {} }],
      ], () => true, { test: 'node --test native.cjs' });
      const target = path.join(root, 'lib', 'adapters');
      fs.mkdirSync(target, { recursive: true });
      const original = `${'// preserved implementation\n'.repeat(220)}if (config.maxBodyLength > -1) {\n      options.maxBodyLength = config.maxBodyLength;\n    }`;
      fs.writeFileSync(path.join(target, 'http.js'), original);
      const result = await engine.run({
        userPrompt: 'Fix lib/adapters/http.js so the default maxBodyLength behavior is unlimited and run the native test',
        mode: 'agent', conversationHistory: [],
      });
      const repaired = fs.readFileSync(path.join(target, 'http.js'), 'utf8');
      expect(repaired).not.toBe('short');
      expect(repaired).toContain('config.maxBodyLength == null || config.maxBodyLength < 0');
      expect(events).toContain('edit_file');
      expect(events).toContain('run_tests');
      expect(events.indexOf('edit_file')).toBeLessThan(events.indexOf('run_tests'));
      expect(result.verifiedFiles).toContain('lib/adapters/http.js');
    } finally {
      if (previous === undefined) delete process.env.QUILLIX_PUBLIC_BENCHMARK;
      else process.env.QUILLIX_PUBLIC_BENCHMARK = previous;
    }
  });

  it('does not accept a passing test as fresh when a later tool call edits source in the same turn', async () => {
    const { engine, events } = setup([
      [write('exports.value = 2;'), { id: 'pass', name: 'run_tests', args: {} }, write('exports.value = 1;')],
      [], [],
    ], (_name, source) => source.includes('= 2'));
    const result = await engine.run({ userPrompt: 'Refactor util.cjs and run tests', mode: 'agent', conversationHistory: [] });
    expect(events.filter(name => name === 'run_tests').length).toBe(2);
    expect(result.finalText).toMatch(/FAILED|INCOMPLETE/);
    expect(result.phases.some(phase => phase.status === 'failed')).toBe(true);
  });

  it('rechecks tests after a later syntax-validation repair', async () => {
    const { engine } = setup([
      [write('exports.value = ;')], [], [write('exports.value = 2;')],
    ], () => true);
    const result = await engine.run({ userPrompt: 'Refactor util.cjs and run tests', mode: 'agent', conversationHistory: [] });
    expect(result.toolResults.filter(r => r.toolName === 'run_tests').length).toBe(2);
    expect(result.finalText).not.toContain('FAILED');
  });

  it('uses a single write schema only for a genuinely new focused Qwen task', async () => {
    expect(classifyIntent('Create greet.cjs with a greeting function.').kind).toBe('agent');
    const terminal = new TerminalService(), workspace = new WorkspaceManager(root), git = new GitService(terminal);
    const indexer = new CodebaseIndexer(workspace, git), settings = new SettingsStore(path.join(root, '.quillix/settings.json'));
    settings.update({ autoApplyDiffs: true });
    const provider = {
      async chatWithToolsStream(_messages: unknown, tools: ToolDefinition[]) {
        expect(tools.map(t => t.name)).toEqual(['write_file']);
        return { text: '', toolCalls: [{ id: 'new', name: 'write_file', args: { filePath: 'greet.cjs', content: 'exports.greet = () => "Hello";' } }] };
      },
    } as unknown as AIProvider;
    const engine = new AgentEngine(provider, new ToolRegistry(workspace, terminal, git, indexer, settings), indexer, new WorkspaceVerifier(workspace, terminal));
    const result = await engine.run({ userPrompt: 'Create greet.cjs with a greeting function.', model: 'qwen2.5-coder:3b', mode: 'agent', conversationHistory: [] });
    expect(result.verifiedFiles).toContain('greet.cjs');
    expect(result.finalText).toContain('Runtime behavior was not tested');
  });

  it('repairs a default-only export when the user explicitly requested a named CommonJS API', async () => {
    const terminal = new TerminalService(), workspace = new WorkspaceManager(root), git = new GitService(terminal);
    const indexer = new CodebaseIndexer(workspace, git), settings = new SettingsStore(path.join(root, '.quillix/settings.json'));
    settings.update({ autoApplyDiffs: true });
    let calls = 0;
    const provider = { async chatWithToolsStream(messages: Array<{ content: string }>) {
      if (calls) expect(messages.map(message => message.content).join('\n')).toContain('Missing explicitly requested named CommonJS export');
      return { text: '', toolCalls: [{ id: `export-${calls}`, name: 'write_file', args: { filePath: 'greet.cjs',
        content: calls++ ? 'exports.greet = name => `Hello, ${name}!`;' : 'module.exports = name => `Hello, ${name}!`;' } }] };
    } } as unknown as AIProvider;
    const engine = new AgentEngine(provider, new ToolRegistry(workspace, terminal, git, indexer, settings), indexer, new WorkspaceVerifier(workspace, terminal));
    const result = await engine.run({ userPrompt: 'Create greet.cjs. Export a named function greet(name) via exports.greet.', model: 'qwen2.5-coder:3b', mode: 'agent', conversationHistory: [] });
    expect(calls).toBe(2);
    expect(fs.readFileSync(path.join(root, 'greet.cjs'), 'utf8')).toContain('exports.greet');
    expect(result.phases.some(phase => phase.status === 'failed')).toBe(false);
  });
});
