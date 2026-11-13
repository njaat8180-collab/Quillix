import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { extractCodeForKnownFile, extractToolCallsFromText, sanitizeChatText, ChatStreamFilter } from '../toolCallParser.js';
import { classifyRequestKind, buildPhasePlan, PhaseTracker, toolCategory } from '../phases.js';
import { WorkspaceVerifier } from '../verifier.js';
import { AgentEngine } from '../agentEngine.js';
import { ToolRegistry } from '../toolRegistry.js';
import { WorkspaceManager } from '../workspace.js';
import { TerminalService } from '../terminal.js';
import { GitService } from '../git.js';
import { CodebaseIndexer } from '../indexer.js';
import { SettingsStore, DEFAULT_SETTINGS } from '../settings.js';
import { ProjectMemory } from '../projectMemory.js';
import { AIProvider } from '../qwen.js';
import { ToolCall, ToolDefinition, AgentPhase } from '../../shared/types.js';

const KNOWN_TOOLS = new Set<string>([
  'read_file',
  'write_file',
  'create_file',
  'create_directory',
  'list_directory',
  'run_command',
  'run_tests',
  'run_build',
]);

describe('ToolCall text parser (the #1 bug fix)', () => {
  it('should parse a bare tool-call JSON written as text', () => {
    const text = `Sure, I will create the file now.
{"name": "create_file", "arguments": {"filePath": "index.html", "content": "<html></html>"}}
Done!`;
    const { calls, cleanedText } = extractToolCallsFromText(text, KNOWN_TOOLS);
    expect(calls.length).toBe(1);
    expect(calls[0].name).toBe('create_file');
    expect(calls[0].args.filePath).toBe('index.html');
    expect(cleanedText).not.toContain('create_file');
    expect(cleanedText).toContain('Sure');
    expect(cleanedText).toContain('Done!');
  });

  it('should parse tool calls inside ```json fences', () => {
    const text = 'I will create the project.\n```json\n{"name": "create_directory", "arguments": {"dirPath": "src"}}\n```\nOkay.';
    const { calls, cleanedText } = extractToolCallsFromText(text, KNOWN_TOOLS);
    expect(calls.length).toBe(1);
    expect(calls[0].name).toBe('create_directory');
    expect(cleanedText).not.toContain('dirPath');
  });

  it('should parse tool calls from an array of objects', () => {
    const text = `[{\"name\":\"create_file\",\"arguments\":{\"filePath\":\"a.txt\",\"content\":\"a\"}},{\"name\":\"create_file\",\"arguments\":{\"filePath\":\"b.txt\",\"content\":\"b\"}}]`;
    const { calls } = extractToolCallsFromText(text, KNOWN_TOOLS);
    expect(calls.length).toBe(2);
    expect(calls[1].args.filePath).toBe('b.txt');
  });

  it('should not treat JSON explanations with unknown tools as tool calls', () => {
    const text = 'The format looks like {"name": "some_random_tool", "arguments": {"x": 1}} in OpenAI style.';
    const { calls } = extractToolCallsFromText(text, KNOWN_TOOLS);
    expect(calls.length).toBe(0);
  });

  it('should parse Ollama-style {"function": {"name", "arguments"}} fragments', () => {
    const text = '{"function": {"name": "list_directory", "arguments": {"dirPath": "."}}}';
    const { calls } = extractToolCallsFromText(text, KNOWN_TOOLS);
    expect(calls.length).toBe(1);
    expect(calls[0].name).toBe('list_directory');
  });

  it('sanitizeChatText hides large code blocks but keeps small ones', () => {
    const small = 'Example:\n```js\nconsole.log(1);\n```\nThat is it.';
    const big =
      'Here is the file:\n```html\n' + Array.from({ length: 40 }, (_, i) => `<div>line ${i}</div>`).join('\n') + '\n```';
    const smallOut = sanitizeChatText(small, KNOWN_TOOLS);
    expect(smallOut).toContain('console.log(1)');
    const bigOut = sanitizeChatText(big, KNOWN_TOOLS);
    expect(bigOut).not.toContain('<div>line 5</div>');
    expect(bigOut).toContain('block written to the workspace');
  });

  it('can hide even short code blocks when the caller is in Agent mode', () => {
    const source = 'Updated stylesheet:\n```css\n.hero{color:red}\n```\nDone.';
    const sanitized = sanitizeChatText(source, KNOWN_TOOLS, {hideCodeBlocks: true});
    expect(sanitized).not.toContain('.hero{color:red}');
    expect(sanitized).toContain('Code block withheld from Agent chat');
    expect(sanitized).toContain('Done.');
  });
});

describe('ChatStreamFilter (live chat sanitization)', () => {
  it('suppresses tool-call JSON lines and large fences while streaming', () => {
    const filter = new ChatStreamFilter(KNOWN_TOOLS);
    let visible = '';
    const modelText =
      'I will create it.\n' +
      '{"name": "create_file", "arguments": {"filePath": "x.txt", "content": "hi"}}\n' +
      '```js\n' +
      Array.from({ length: 20 }, (_, i) => `// line ${i}`).join('\n') +
      '\n```\n' +
      'All done.';
    for (const token of modelText.match(/[\s\S]/g)!) visible += filter.push(token);
    visible += filter.flush();
    expect(visible).toContain('I will create it.');
    expect(visible).not.toContain('create_file');
    expect(visible).not.toContain('// line 5');
    expect(visible).toContain('All done.');
  });

  it('keeps small code fences visible', () => {
    const filter = new ChatStreamFilter(KNOWN_TOOLS);
    let visible = '';
    const modelText = 'Example:\n```js\nconsole.log("hi");\n```\nEnd.';
    for (const token of modelText.match(/[\s\S]/g)!) visible += filter.push(token);
    visible += filter.flush();
    expect(visible).toContain('console.log("hi")');
  });

  it('withholds short implementation fences in Agent mode while streaming', () => {
    const filter = new ChatStreamFilter(KNOWN_TOOLS, {hideCodeBlocks: true});
    let visible = '';
    const modelText = 'Update applied:\n```css\n.hero{color:red}\n```\nDone.';
    for (const token of modelText.match(/[\s\S]/g)!) visible += filter.push(token);
    visible += filter.flush();
    expect(visible).not.toContain('.hero{color:red}');
    expect(visible).toContain('Code block withheld from Agent chat');
    expect(visible).toContain('Done.');
  });

  it('routes a clearly unfenced implementation block to the known file target', () => {
    const source = 'I applied the stylesheet update:\r\nbody {\r\n  background: #111;\r\n  color: white;\r\n}\r\n';
    const parsed = extractCodeForKnownFile(source, 'src/styles.css');
    expect(parsed.calls).toHaveLength(1);
    expect(parsed.calls[0].name).toBe('write_file');
    expect(parsed.calls[0].args.filePath).toBe('src/styles.css');
    expect(parsed.calls[0].args.content).toBe('body {\n  background: #111;\n  color: white;\n}');
    expect(parsed.cleanedText).toContain('I applied the stylesheet update:');
    expect(parsed.cleanedText).not.toContain('background: #111');
  });

  it('withholds raw source from Agent final text while preserving ordinary explanation', () => {
    const answer = 'Done.\nconst count = 3;\nconsole.log(count);\nThe change is ready.';
    const visible = sanitizeChatText(answer, KNOWN_TOOLS, {hideCodeBlocks: true});
    expect(visible).toContain('Done.');
    expect(visible).toContain('Unfenced source withheld from Agent chat');
    expect(visible).toContain('The change is ready.');
    expect(visible).not.toContain('console.log(count)');
  });

  it('withholds raw source before it reaches Agent chat during streaming', () => {
    const filter = new ChatStreamFilter(KNOWN_TOOLS, {hideCodeBlocks: true});
    let visible = '';
    const modelText = 'Updated CSS:\nbody {\n  color: white;\n}\nDone.';
    for (const token of modelText.match(/[\s\S]/g)!) visible += filter.push(token);
    expect(visible).not.toContain('body {');
    expect(visible).not.toContain('color: white');
    visible += filter.flush();
    expect(visible).toContain('Unfenced source withheld from Agent chat');
    expect(visible).toContain('Done.');
    expect(visible).not.toContain('body {');
  });
});

describe('Phase system (10-15 real phases)', () => {
  it('classifies request kinds', () => {
    expect(classifyRequestKind('Create a professional To-Do List web application using HTML, CSS and JavaScript.')).toBe('project');
    expect(classifyRequestKind('creeate a ai harnase using html css js')).toBe('project');
    expect(classifyRequestKind('Fix the failing test in the login component')).toBe('fix');
    expect(classifyRequestKind('अब इसका background में ये image लगा दो')).toBe('fix');
    expect(classifyRequestKind('इसमें login और sign-in जोड़ दो')).toBe('fix');
    expect(classifyRequestKind('What does this codebase do overall?')).toBe('analyze');
  });

  it('builds 15 phases for projects and 10 for fixes', () => {
    expect(buildPhasePlan('project').length).toBe(15);
    expect(buildPhasePlan('fix').length).toBe(10);
    expect(buildPhasePlan('analyze').length).toBe(10);
  });

  it('advances phases only from real tool executions', () => {
    const tracker = new PhaseTracker('project');
    tracker.observe('understand');
    let phases = tracker.getPhases();
    expect(phases[0].status).toBe('in_progress'); // understand started

    tracker.observe('inspect');
    phases = tracker.getPhases();
    expect(phases[0].status).toBe('completed');
    expect(phases[1].status).toBe('in_progress');

    tracker.observe('plan');
    tracker.observe('write', 'index.html');
    phases = tracker.getPhases();
    expect(phases[1].status).toBe('completed'); // inspect
    expect(phases[2].status).toBe('completed'); // plan
    // No create_directory ran -> the structure phase is honestly skipped
    expect(phases[3].status).toBe('skipped');
    expect(phases[4].status).toBe('in_progress'); // Core Implementation

    // No testing ran -> finalize must honestly skip, not fake
    const final = tracker.finalize(true);
    const testingPhase = final.find((p) => p.id === 'testing');
    expect(testingPhase?.status).toBe('skipped');
    const corePhase = final.find((p) => p.id === 'implement-core');
    expect(corePhase?.status).toBe('completed'); // settleInProgress completed it
  });

  it('maps tool names to categories', () => {
    expect(toolCategory('create_file')).toBe('write');
    expect(toolCategory('run_tests')).toBe('test');
    expect(toolCategory('list_directory')).toBe('inspect');
  });

  it('recovers an intermediate failed phase after a later verified repair', () => {
    const tracker = new PhaseTracker('fix', 'Fix retry.cjs and run tests');
    tracker.complete('understand');
    tracker.complete('inspect');
    tracker.complete('diagnose');
    tracker.fail('validate', 'first generated edit was invalid');
    tracker.complete('apply', 'corrected source written');
    tracker.complete('testing', 'configured test passed');
    tracker.complete('report');
    tracker.recoverFailures();
    const final = tracker.finalize(true);
    expect(final.some(phase => phase.status === 'failed')).toBe(false);
    expect(final.find(phase => phase.id === 'validate')?.detail).toContain('Recovered');
  });

  it('reports unobserved adaptive phases as skipped instead of fake failures', () => {
    const tracker = new PhaseTracker('project', 'Create a hello world HTML page');
    tracker.complete('understand', 'Request classified');
    tracker.complete('inspect', 'Workspace inspected');
    tracker.complete('structure', 'Target folder verified');
    tracker.observe('write', 'index.html');
    const final = tracker.finalize(true);
    expect(final.some(phase => phase.status === 'failed')).toBe(false);
    expect(final.find(phase => phase.id === 'testing')?.status).toBe('skipped');
    expect(final.find(phase => phase.id === 'testing')?.detail).toContain('Not required');
    expect(final.find(phase => phase.id === 'implement-core')?.status).toBe('completed');
  });
});

describe('WorkspaceVerifier (real test -> fix -> retest)', () => {
  let testDir: string;
  let workspace: WorkspaceManager;
  let verifier: WorkspaceVerifier;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-verify-'));
    workspace = new WorkspaceManager(testDir);
    verifier = new WorkspaceVerifier(workspace, new TerminalService());
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('detects broken JavaScript with node --check', async () => {
    workspace.createFile('broken.js', 'function broken( {\n  return ;;;\n');
    const report = await verifier.verifyFiles(['broken.js']);
    expect(report.allOk).toBe(false);
    expect(report.failures.length).toBeGreaterThan(0);
    expect(report.failures[0].filePath).toBe('broken.js');
  });

  it('passes valid JavaScript', async () => {
    workspace.createFile('good.js', 'function good() {\n  return 42;\n}\n');
    const report = await verifier.verifyFiles(['good.js']);
    expect(report.failures).toEqual([]);
  });

  it('detects invalid JSON', async () => {
    workspace.createFile('data.json', '{ not valid json ]');
    const report = await verifier.verifyFiles(['data.json']);
    expect(report.allOk).toBe(false);
  });

  it('flags missing files (never claim a file exists when it does not)', async () => {
    const report = await verifier.verifyFiles(['missing.js']);
    expect(report.allOk).toBe(false);
    expect(report.failures[0].error).toContain('does not exist');
  });

  it('rejects an empty file list instead of treating no output as success', async () => {
    const report = await verifier.verifyFiles([]);
    expect(report.allOk).toBe(false);
    expect(report.failures[0].check).toBe('verification-input');
  });

  it('detects unbalanced HTML tags', async () => {
    workspace.createFile('page.html', '<html><body><div></body></html>');
    const report = await verifier.verifyFiles(['page.html']);
    expect(report.allOk).toBe(false);
  });

  it('accepts ordinary HTML comments while checking tag balance', async () => {
    workspace.createFile('page.html', '<html><body><main><!-- cards are rendered by script --><h1>Store</h1></main></body></html>');
    const report = await verifier.verifyFiles(['page.html']);
    expect(report.verified.find(check => check.check === 'html-balance')?.ok).toBe(true);
    expect(report.allOk).toBe(true);
  });

  it('ignores angle-bracket strings inside inline scripts and styles', async () => {
    workspace.createFile('game.html', '<!doctype html><html><head><style>.empty::before{content:"<empty>"}</style></head><body><main id="game"></main><script>const marker = "<empty>"; document.querySelector("#game");</script></body></html>');
    const report = await verifier.verifyFiles(['game.html']);
    expect(report.verified.find(check => check.check === 'html-balance')?.ok).toBe(true);
    expect(report.failures).toEqual([]);
  });
});

/** Scripted AI provider simulating qwen2.5-coder:3b writing tool calls AS TEXT. */
class ScriptedTextToolProvider implements AIProvider {
  public messagesSeen: unknown[] = [];
  public toolNamesSeen: string[][] = [];

  constructor(private script: Array<{ text: string | ((messages: unknown) => string) }>) {}

  async generateText(): Promise<string> {
    throw new Error('not used');
  }
  async generateStream(): Promise<string> {
    throw new Error('not used');
  }
  async chatWithTools(messages: unknown) {
    const next = this.script.shift() || { text: 'Done.' };
    const text = typeof next.text === 'function' ? next.text(messages) : next.text;
    return { text, toolCalls: undefined };
  }
  async chatWithToolsStream(
    _messages: unknown,
    _tools: ToolDefinition[],
    _options: unknown,
    onToken: (t: string) => void
  ): Promise<{ text: string; toolCalls?: ToolCall[] }> {
    this.messagesSeen.push(_messages);
    this.toolNamesSeen.push(_tools.map(tool => tool.name));
    const next = this.script.shift() || { text: 'Done.' };
    const text = typeof next.text === 'function' ? next.text(_messages) : next.text;
    // Stream the text token by token like Ollama would.
    for (const ch of text) onToken(ch);
    return { text, toolCalls: undefined };
  }
}

describe('AgentEngine end-to-end (tool calls as text are EXECUTED, not shown)', () => {
  let testDir: string;
  let workspace: WorkspaceManager;

  const buildEngine = (script: Array<{ text: string | ((messages: unknown) => string) }>, memory?: ProjectMemory) => {
    const settingsPath = path.join(testDir, '.quillix-test-settings.json');
    const settings = new SettingsStore(settingsPath);
    settings.update({ ...DEFAULT_SETTINGS, autoApplyDiffs: true, terminalApproval: false });
    const terminal = new TerminalService();
    const git = new GitService(terminal);
    const indexer = new CodebaseIndexer(workspace, git);
    const registry = new ToolRegistry(workspace, terminal, git, indexer, settings);
    const verifier = new WorkspaceVerifier(workspace, terminal);
    const provider = new ScriptedTextToolProvider(script);
    return { engine: new AgentEngine(provider, registry, indexer, verifier, memory), provider };
  };

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-agent-'));
    workspace = new WorkspaceManager(testDir);
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('never sends inline credentials to the provider and restores opaque handles on write', async () => {
    const secret = 'sk_live_abcdefghijklmnop123456';
    fs.writeFileSync(path.join(testDir, 'config.ts'), `export const apiKey = "${secret}";\nexport const label = "before";\n`);
    const { engine, provider } = buildEngine([
      { text: '{"name":"read_file","arguments":{"filePath":"config.ts"}}' },
      { text: (messages) => {
        const transcript = JSON.stringify(messages);
        const handle = transcript.match(/__QUILLIX_SECRET_PROVIDER_KEY_[a-f0-9]+__/i)?.[0];
        if (!handle) throw new Error('Provider context did not contain the redacted credential handle.');
        return JSON.stringify({ name: 'write_file', arguments: {
          filePath: 'config.ts',
          content: `export const apiKey = "${handle}";\nexport const label = "after";\n`,
        } });
      } },
      { text: 'Updated config.ts and preserved its credential.' },
    ]);

    const result = await engine.run({
      userPrompt: 'Update the label in config.ts to after while preserving the existing setting.',
      mode: 'agent',
      conversationHistory: [],
      settings: { maxAutonomousTurns: 5, temperature: 0, autoApplyDiffs: true },
    });
    const providerTranscript = JSON.stringify(provider.messagesSeen);
    const diskContent = fs.readFileSync(path.join(testDir, 'config.ts'), 'utf8');
    expect(providerTranscript).not.toContain(secret);
    expect(providerTranscript).toContain('__QUILLIX_SECRET_');
    expect(diskContent).toContain(secret);
    expect(diskContent).toContain('label = "after"');
    expect(result.toolResults.some((tool) => tool.toolName === 'write_file' && tool.success)).toBe(true);
  });

  it('forces creation of an explicitly requested missing file after read_file reports it absent', async () => {
    const html = '<!doctype html><html><body><main><button type="button" class="sign-in">Sign In</button></main></body></html>';
    fs.writeFileSync(path.join(testDir, 'index.html'), html);
    const memory = new ProjectMemory(testDir);
    memory.setActive('Northstar', testDir);
    const { engine, provider } = buildEngine([
      { text: '{"name":"read_file","arguments":{"filePath":"app.js"}}' },
      { text: JSON.stringify({ name: 'create_file', arguments: { filePath: 'app.js', content: 'document.querySelector(".sign-in")?.addEventListener("click", () => {});' } }) },
      { text: JSON.stringify({ name: 'edit_file', arguments: { filePath: 'index.html', oldString: '</body>', newString: '<script src="app.js"></script></body>' } }) },
      { text: 'Created app.js, linked it from index.html, and preserved style.css.' },
    ], memory);

    const result = await engine.run({
      userPrompt: 'मौजूदा sign-in button के लिए app.js में click handler बनाओ, उसे index.html में link करो और style.css बिल्कुल मत बदलो।',
      mode: 'agent',
      currentFile: 'index.html',
      conversationHistory: [],
      settings: { maxAutonomousTurns: 6, temperature: 0, autoApplyDiffs: true },
    });

    expect(provider.toolNamesSeen[1]).toEqual(['create_file']);
    expect(provider.toolNamesSeen[2]).toEqual(['edit_file']);
    expect(fs.existsSync(path.join(testDir, 'app.js'))).toBe(true);
    expect(fs.readFileSync(path.join(testDir, 'app.js'), 'utf8')).toContain('addEventListener');
    expect(fs.readFileSync(path.join(testDir, 'index.html'), 'utf8')).toContain('<script src="app.js"></script>');
    expect(result.toolResults.some(tool => tool.toolName === 'create_file' && tool.success)).toBe(true);
  });

  it('executes tool calls written as text and creates REAL files (no JSON in chat)', async () => {
    const script = [
      {
        text:
          'I will create the todo app files now.\n' +
          JSON.stringify({ name: 'create_file', arguments: { filePath: 'index.html', content: '<html><head><title>Todo</title><link rel="stylesheet" href="style.css"></head><body><main><h1>Todo tasks</h1><button onclick="addTask()">Add task</button></main><script src="script.js"></script></body></html>' } }) + '\n' +
          '{"name": "create_file", "arguments": {"filePath": "script.js", "content": "function addTask() { return 1; }\\nconsole.log(\'ready\');\\n"}}\n' +
          '{"name": "create_file", "arguments": {"filePath": "README.md", "content": "# Todo app\\n"}}',
      },
      {
        text:
          '```json\n' +
          '{"name": "create_file", "arguments": {"filePath": "style.css", "content": "body { margin: 0; }\\n@media (max-width: 700px) { main { padding: 1rem; } }\\n"}}\n' +
          '```\nAll four files are ready.',
      },
      { text: 'The project is complete: index.html, script.js, style.css and README.md exist in the workspace.' },
    ];

    const { engine } = buildEngine(script);
    const streamedPhases: AgentPhase[][] = [];
    const tokens: string[] = [];
    let lastPhases: AgentPhase[] = [];

    const result = await engine.run({
      userPrompt: 'Create a professional responsive To-Do List web application using HTML, CSS and JavaScript.',
      mode: 'agent',
      conversationHistory: [],
      settings: { maxAutonomousTurns: 6, temperature: 0.2, autoApplyDiffs: true },
      onToken: (t) => tokens.push(t),
      onPhaseUpdate: (phases) => {
        streamedPhases.push(phases);
        lastPhases = phases;
      },
    });

    // 1. The real files exist on disk — inside the DEDICATED project folder
    //    created for this request (§4: <workspace>/<ProjectName>).
    const projectRoot = result.projectReport?.projectRoot;
    expect(projectRoot).toBeTruthy();
    expect(fs.existsSync(projectRoot!)).toBe(true);
    for (const f of ['index.html', 'script.js', 'style.css', 'README.md']) {
      expect(fs.existsSync(path.join(projectRoot!, f))).toBe(true);
    }
    // The project report reflects REAL filesystem state
    expect(result.projectReport!.files.length).toBeGreaterThanOrEqual(4);
    expect(result.projectReport!.files.every((f) => f.exists)).toBe(true);
    expect(result.projectReport!.fileTree).toContain('index.html');

    // 2. Chat never saw the raw tool-call JSON or the code content
    const chatText = tokens.join('');
    expect(chatText).not.toContain('"name"');
    expect(chatText).not.toContain('create_file');
    expect(chatText).not.toContain('<html>');
    expect(chatText).toContain('All four files are ready.');

    // 3. The final reply is clean
    expect(result.finalText).not.toContain('create_file');
    expect(result.finalText).not.toContain('"arguments"');

    // 4. Tool calls were really executed (paths routed into the project folder)
    expect(result.toolCalls.length).toBe(4);
    expect(result.toolResults.every((r) => r.success)).toBe(true);
    expect(result.verifiedFiles.sort()).toEqual(
      ['README.md', 'script.js', 'index.html', 'style.css'].map((f) => `${path.basename(projectRoot!)}/${f}`).sort()
    );
    // The final reply carries the file-location report with absolute paths
    expect(result.finalText).toContain('PROJECT ROOT:');
    expect(result.finalText).toContain(projectRoot!);

    // 5. Phases now reflect THIS request, not a hardcoded 15-step template.
    expect(lastPhases.length).toBeGreaterThanOrEqual(7);
    expect(lastPhases.length).toBeLessThan(15);
    const core = lastPhases.find((p) => p.id === 'implement-core');
    expect(core?.status).toBe('completed');
    // Validation ran for real (node --check on app.js)
    const validationPhase = lastPhases.find((p) => p.id === 'validation');
    expect(validationPhase?.status).toBe('completed');
    // Without an explicit build/run requirement there is no invented phase.
    const buildPhase = lastPhases.find((p) => p.id === 'build');
    expect(buildPhase).toBeUndefined();

    // 6. Patches recorded
    expect(result.patches.length).toBe(4);
  });

  it('does not complete a multi-file request when the model stops after one file', async () => {
    const { engine } = buildEngine([{ text: '<tool_call>{"name":"write_file","arguments":{"filePath":"index.html","content":"<html><body>Test</body></html>"}}</tool_call>' }]);
    const result = await engine.run({ userPrompt: 'Create a website with index.html and style.css.', mode: 'agent', conversationHistory: [], settings: { maxAutonomousTurns: 4, temperature: 0, autoApplyDiffs: true } });
    expect(result.finalText).toContain('INCOMPLETE');
    expect(result.finalText).toContain('style.css');
    expect(result.phases.find(p => p.id === 'completion')?.status).toBe('failed');
  });

  it('runs the mandatory test -> fix -> retest cycle when a generated file is broken', async () => {
    const script = [
      {
        text:
          '{"name": "create_file", "arguments": {"filePath": "broken.js", "content": "function broken( {\\n  return ;;;\\n"}}',
      },
      {
        text:
          'The validation error was a missing parenthesis. Writing the corrected file.\n' +
          '{"name": "write_file", "arguments": {"filePath": "broken.js", "content": "function broken() {\\n  return 7;\\n}\\n"}}',
      },
      { text: 'Fixed and verified.' },
    ];

    const { engine } = buildEngine(script);
    const result = await engine.run({
      userPrompt: 'Create a small JavaScript utility module.',
      mode: 'agent',
      conversationHistory: [],
      settings: { maxAutonomousTurns: 8, temperature: 0.2, autoApplyDiffs: true },
    });

    // The broken file was really repaired on disk (inside its project folder)
    const projectRoot = result.projectReport?.projectRoot;
    expect(projectRoot).toBeTruthy();
    const fixed = fs.readFileSync(path.join(projectRoot!, 'broken.js'), 'utf8');
    expect(fixed).toContain('function broken()');

    // The engine ran the automatic verification (test) twice: fail then pass
    const testActivities = result.activities.filter(
      (a) => a.message.toLowerCase().includes('validation') || a.message.toLowerCase().includes('retest')
    );
    expect(testActivities.length).toBeGreaterThan(0);

    // Retest passed: final verification phase completed
    const verifyPhase = result.phases.find((p) => p.id === 'final-verification');
    expect(verifyPhase?.status).toBe('completed');
  });
});
