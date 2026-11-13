import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { AgentEngine } from '../agentEngine.js';
import { ToolRegistry } from '../toolRegistry.js';
import { WorkspaceManager } from '../workspace.js';
import { TerminalService } from '../terminal.js';
import { GitService } from '../git.js';
import { CodebaseIndexer } from '../indexer.js';
import { SettingsStore, DEFAULT_SETTINGS } from '../settings.js';
import { WorkspaceVerifier } from '../verifier.js';
import { ProjectMemory } from '../projectMemory.js';
import { AIProvider } from '../qwen.js';
import { extractToolCallsFromText, extractExplicitCodeFileCalls, extractCodeForKnownFile, sanitizeChatText } from '../toolCallParser.js';
import { ToolCall, ToolDefinition } from '../../shared/types.js';

const KNOWN_TOOLS = new Set<string>([
  'read_file',
  'write_file',
  'create_file',
  'delete_file',
  'create_directory',
  'list_directory',
  'run_command',
]);

/**
 * Recording AI provider: captures the conversation of EVERY turn so tests can
 * prove tool RESULTS were injected back into the model context, and supports
 * scripted replies with either text-emitted tool calls or NATIVE tool_calls.
 */
class RecordingProvider implements AIProvider {
  /** The messages array of each model call (turn 1, 2, ...). */
  public turns: Array<Array<Record<string, any>>> = [];

  constructor(private script: Array<{ text: string; toolCalls?: ToolCall[] }>) {}

  async generateText(): Promise<string> {
    throw new Error('not used');
  }
  async generateStream(): Promise<string> {
    throw new Error('not used');
  }
  async chatWithTools(_m: unknown, _t: ToolDefinition[]) {
    const next = this.script.shift() || { text: 'Done.' };
    return { text: next.text, toolCalls: next.toolCalls };
  }
  async chatWithToolsStream(
    messages: any,
    _tools: ToolDefinition[],
    _options: unknown,
    onToken: (t: string) => void
  ): Promise<{ text: string; toolCalls?: ToolCall[] }> {
    this.turns.push(messages);
    const next = this.script.shift() || { text: 'Done.' };
    for (const ch of next.text) onToken(ch);
    return { text: next.text, toolCalls: next.toolCalls };
  }
}

describe('NUVRO AI tool-call contract (deterministic structured format)', () => {
  let testDir: string;
  let workspace: WorkspaceManager;
  let memory: ProjectMemory;

  const buildEngine = (provider: AIProvider) => {
    const settingsPath = path.join(testDir, '.quillix-test-settings.json');
    const settings = new SettingsStore(settingsPath);
    settings.update({ ...DEFAULT_SETTINGS, autoApplyDiffs: true, terminalApproval: false });
    const terminal = new TerminalService();
    const git = new GitService(terminal);
    const indexer = new CodebaseIndexer(workspace, git);
    const registry = new ToolRegistry(workspace, terminal, git, indexer, settings);
    const verifier = new WorkspaceVerifier(workspace, terminal);
    return new AgentEngine(provider, registry, indexer, verifier, memory);
  };

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-contract-'));
    workspace = new WorkspaceManager(testDir);
    memory = new ProjectMemory(testDir);
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('B: parses the mandated {"tool":"file_write","arguments":{"path":…}} envelope', () => {
    const text =
      'I will create the file now.\n' +
      '{"tool": "file_write", "arguments": {"path": "test.html", "content": "<html></html>"}}\n' +
      'Done.';
    const { calls, cleanedText } = extractToolCallsFromText(text, KNOWN_TOOLS);
    expect(calls.length).toBe(1);
    expect(calls[0].name).toBe('write_file'); // alias normalized
    expect(calls[0].args.filePath).toBe('test.html'); // path → filePath
    expect(calls[0].args.content).toBe('<html></html>');
    expect(cleanedText).not.toContain('file_write');
    expect(cleanedText).toContain('Done.');
  });

  it('B: parses {"tool": …} with inline arguments and fenced variants', () => {
    const inline = '{"tool": "create_directory", "dirPath": "src"}';
    const r1 = extractToolCallsFromText(inline, KNOWN_TOOLS);
    expect(r1.calls[0].name).toBe('create_directory');

    const fenced =
      'Creating now.\n```json\n{"tool": "file_write", "arguments": {"path": "a.txt", "content": "hi"}}\n```\nAll set.';
    const r2 = extractToolCallsFromText(fenced, KNOWN_TOOLS);
    expect(r2.calls.length).toBe(1);
    expect(r2.calls[0].name).toBe('write_file');
    expect(r2.cleanedText).not.toContain('arguments');
  });

  it('routes explicitly named Markdown code blocks to files while preserving prose', () => {
    const response = [
      'Phase 2 is ready. I am updating the storefront files.',
      '## MicrosoftStore/index.html',
      '```html',
      '<main><h1>Store</h1></main>',
      '```',
      'The HTML update is ready for verification.',
    ].join('\n');
    const parsed = extractExplicitCodeFileCalls(response);
    expect(parsed.calls).toHaveLength(1);
    expect(parsed.calls[0].name).toBe('write_file');
    expect(parsed.calls[0].args.filePath).toBe('MicrosoftStore/index.html');
    expect(parsed.calls[0].args.content).toContain('<h1>Store</h1>');
    expect(parsed.cleanedText).toContain('Phase 2 is ready');
    expect(parsed.cleanedText).toContain('ready for verification');
    expect(parsed.cleanedText).not.toContain('<main>');
  });

  it('routes one unlabeled implementation block only to an authoritative known file', () => {
    const response = 'Here is the updated implementation:\n```html\n<!doctype html><main>Updated</main>\n```\nI applied the change.';
    const routed = extractCodeForKnownFile(response, 'index.html');
    expect(routed.calls).toHaveLength(1);
    expect(routed.calls[0].args.filePath).toBe('index.html');
    expect(routed.calls[0].args.content).toContain('<main>Updated</main>');
    expect(routed.cleanedText).toContain('I applied the change.');
    expect(extractCodeForKnownFile('```html\n<main>one</main>\n```\n```css\nmain{}\n```', 'index.html').calls).toHaveLength(0);
  });

  it('K: rejects unknown tools, non-object arguments, and missing required args — safely', async () => {
    // Unknown tool in text: ignored by the parser, never executed.
    const bogus = 'Try this: {"name": "totally_unknown_tool", "arguments": {"filePath": "x.txt"}}';
    const parsed = extractToolCallsFromText(bogus, KNOWN_TOOLS);
    expect(parsed.calls.length).toBe(0);

    // Malformed text arguments abort the turn before returning ANY executable
    // calls. The engine reports an error instead of executing a partial batch.
    const script = [
      { text: '{"tool": "file_write", "arguments": "not-an-object"}' },
      { text: 'Understood, the arguments were invalid.' },
    ];
    const engine = buildEngine(new RecordingProvider(script));
    await expect(engine.run({
      userPrompt: 'Write a file',
      mode: 'agent',
      conversationHistory: [],
      settings: { maxAutonomousTurns: 4, temperature: 0.2, autoApplyDiffs: true },
    })).rejects.toThrow(/Invalid JSON arguments/);

    // Missing required argument via the native tool_calls path.
    const native = new RecordingProvider([
      { text: '', toolCalls: [{ id: 'c1', name: 'create_file', args: {} }] },
      { text: 'The tool reported a validation error.' },
    ]);
    const engine2 = buildEngine(native);
    const result2 = await engine2.run({
      userPrompt: 'Create a file',
      mode: 'agent',
      conversationHistory: [],
      settings: { maxAutonomousTurns: 4, temperature: 0.2, autoApplyDiffs: true },
    });
    expect(result2.toolResults[0].success).toBe(false);
    expect(result2.toolResults[0].error).toContain('filePath');
    // Nothing was created on disk in this test.
    expect(fs.readdirSync(testDir).filter((f) => !f.startsWith('.'))).toEqual([]);
  });

  it('A/C/D/E/F/G: full single-file flow — tool call executes, result returns to the model, model continues', async () => {
    const provider = new RecordingProvider([
      {
        // Turn 1 — the mandated envelope, written as text (small-model style)
        text:
          'I will create the file now.\n' +
          '{"tool": "file_write", "arguments": {"path": "test.html", "content": "<!DOCTYPE html>\\n<html><head><title>Test</title></head><body><h1>Hello</h1></body></html>"}}',
      },
      {
        // Turn 2 — the model CONTINUES after receiving the tool result
        text: 'The file test.html has been created and verified. It contains a simple HTML page.',
      },
    ]);
    const engine = buildEngine(provider);

    const result = await engine.run({
      userPrompt: 'Create a file named test.html containing a simple HTML page.',
      mode: 'agent',
      conversationHistory: [],
      settings: { maxAutonomousTurns: 5, temperature: 0.2, autoApplyDiffs: true },
    });

    // D: the file physically exists on disk (at the workspace root — a single
    // named file is not a project, so no project folder is created).
    const abs = path.join(testDir, 'test.html');
    expect(fs.existsSync(abs)).toBe(true);
    expect(fs.readFileSync(abs, 'utf8')).toContain('<h1>Hello</h1>');
    expect(fs.readdirSync(testDir).filter((f) => f.endsWith('.html'))).toEqual(['test.html']);

    // C: the alias tool call really executed
    expect(result.toolCalls[0].name).toBe('write_file');
    expect(result.toolResults[0].success).toBe(true);

    // E: the tool result was injected back into the model conversation
    expect(provider.turns.length).toBe(2);
    const toolMessages = provider.turns[1].filter((m) => m.role === 'tool');
    expect(toolMessages.length).toBeGreaterThanOrEqual(1);
    expect(toolMessages[0].name).toBe('write_file');
    expect(String(toolMessages[0].content)).toContain('test.html');
    expect(String(toolMessages[0].content)).toContain('Successfully');

    // F: the model continued and produced the final response
    expect(result.finalText).toContain('created');
    expect(result.verifiedFiles).toContain('test.html');

    // G: no raw tool JSON in the final response or streamed chat
    expect(result.finalText).not.toContain('"tool"');
    expect(result.finalText).not.toContain('"arguments"');
    expect(result.finalText).not.toContain('<h1>');
    expect(result.observability?.modelCalls).toBe(2);
    expect(result.observability?.inputChars).toBeGreaterThan(0);
    expect(result.observability?.outputChars).toBeGreaterThan(0);
    expect(result.observability?.estimatedTotalTokens).toBeGreaterThan(0);
    expect(result.observability?.contextCharsPeak).toBeGreaterThan(0);
  });

  it('C: NATIVE tool_calls with aliases (file_write + path) also execute', async () => {
    const provider = new RecordingProvider([
      {
        text: '',
        toolCalls: [
          { id: 'c1', name: 'file_write', args: { path: 'native.txt', content: 'native tool call works' } },
        ],
      },
      { text: 'native.txt created via the native tool-call protocol.' },
    ]);
    const engine = buildEngine(provider);
    const result = await engine.run({
      userPrompt: 'Create a file named native.txt containing the text native tool call works',
      mode: 'agent',
      conversationHistory: [],
      settings: { maxAutonomousTurns: 4, temperature: 0.2, autoApplyDiffs: true },
    });

    expect(fs.existsSync(path.join(testDir, 'native.txt'))).toBe(true);
    expect(fs.readFileSync(path.join(testDir, 'native.txt'), 'utf8')).toBe('native tool call works');
    expect(result.toolResults[0].success).toBe(true);
  });

  it('H: "Create a calculator project." builds Calculator/index.html + style.css + script.js', async () => {
    const html = '<!DOCTYPE html>\n<html><head><link rel="stylesheet" href="style.css"></head><body><div id="display"></div><script src="script.js"></script></body></html>';
    const script = [
      {
        text:
          'Building the calculator project.\n' +
          '{"name": "create_file", "arguments": {"filePath": "index.html", "content": "' + html.replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"}}\n' +
          '{"name": "create_file", "arguments": {"filePath": "style.css", "content": "body { font-family: sans-serif; }"}}\n' +
          '{"name": "create_file", "arguments": {"filePath": "script.js", "content": "console.log(\'calculator ready\');"}}',
      },
      { text: 'The calculator project is complete with all three files.' },
    ];
    const provider = new RecordingProvider(script);
    const engine = buildEngine(provider);

    const result = await engine.run({
      userPrompt: 'Create a calculator project.',
      mode: 'agent',
      conversationHistory: [],
      settings: { maxAutonomousTurns: 6, temperature: 0.2, autoApplyDiffs: true },
    });

    // Project folder with all three files
    const root = path.join(testDir, 'Calculator');
    expect(fs.existsSync(root)).toBe(true);
    for (const f of ['index.html', 'style.css', 'script.js']) {
      expect(fs.existsSync(path.join(root, f))).toBe(true);
    }

    // Report with the exact absolute project root + paths
    expect(result.projectReport?.projectRoot).toBe(root);
    expect(result.finalText).toContain('PROJECT ROOT:');
    expect(result.finalText).toContain(root);
    // Verification ran (HTML balance check + previewable detection)
    expect(result.projectReport?.verification.executed).toBe(false);
    expect(result.projectReport?.verification.summary).toContain('preview');

    // Memory recorded the project
    expect(memory.getActive()?.name).toBe('Calculator');
  });

  it('G: sanitizeChatText strips every known tool-call shape from chat', () => {
    const dirty =
      'Here you go.\n' +
      '{"tool": "file_write", "arguments": {"path": "x.txt", "content": "1"}}\n' +
      '{"name": "create_file", "arguments": {"filePath": "y.txt"}}\n' +
      '{"function": {"name": "list_directory", "arguments": {"dirPath": "."}}}';
    const clean = sanitizeChatText(dirty, KNOWN_TOOLS);
    expect(clean).not.toContain('file_write');
    expect(clean).not.toContain('create_file');
    expect(clean).not.toContain('list_directory');
    expect(clean).toContain('Here you go.');
  });
});
