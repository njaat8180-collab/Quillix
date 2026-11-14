import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AgentEngine, classifyLocalFallbackReason, isProviderRateLimitError, usesCompactLocalToolSurface } from '../agentEngine.js';
import { ToolRegistry } from '../toolRegistry.js';
import { WorkspaceManager } from '../workspace.js';
import { TerminalService } from '../terminal.js';
import { GitService } from '../git.js';
import { CodebaseIndexer } from '../indexer.js';
import { SettingsStore, DEFAULT_SETTINGS } from '../settings.js';
import { WorkspaceVerifier } from '../verifier.js';
import type { AIProvider, AICompletionOptions } from '../qwen.js';
import type { ToolCall, ToolDefinition } from '../../shared/types.js';

const sourceFiles: Record<string, string> = {
  'index.html': '<!doctype html><html><head><link rel="stylesheet" href="style.css"></head><body><button id="calculate">Calculate</button><output id="result"></output><script src="script.js"></script></body></html>',
  'style.css': 'body { display: flex; justify-content: center; }',
  'script.js': 'document.getElementById("calculate").onclick = () => { document.getElementById("result").textContent = "42"; };',
};

class LocalModelMock implements AIProvider {
  private wroteScript = false;
  constructor(private mode: 'full' | 'incomplete' | 'plan' | 'repair' = 'full') {}
  async generateText(): Promise<string> { return 'Read-only plan'; }
  async generateStream(_prompt: string, _options: AICompletionOptions, onChunk: (chunk: string) => void): Promise<string> {
    onChunk('Read-only plan');
    return 'Read-only plan';
  }
  async chatWithTools() { return { text: 'No tools requested', toolCalls: undefined as ToolCall[] | undefined }; }
  async chatWithToolsStream(
    _messages: any[], _tools: ToolDefinition[], options: AICompletionOptions, onChunk: (chunk: string) => void
  ): Promise<{ text: string; toolCalls?: ToolCall[] }> {
    const schema = options.format as any;
    const filename = schema?.properties?.arguments?.properties?.filePath?.enum?.[0];
    if (this.mode === 'repair' && filename?.endsWith('script.js')) {
      const repairing = this.wroteScript;
      this.wroteScript = true;
      if (repairing) {
        const evidence = _messages.map(m => m.content).join('\n');
        expect(evidence).toContain('Repair this failing file');
        expect(evidence).toContain('FILE Calculator/index.html');
        expect(evidence).toContain('browser-dom');
      }
      return { text: JSON.stringify({ name: 'write_file', arguments: {
        filePath: filename,
        content: repairing ? sourceFiles['script.js'] : '<script>document.getElementById("missingButton").onclick = () => {};</script>',
      } }) };
    }
    const response = filename && !(this.mode === 'incomplete' && filename === 'style.css')
      ? JSON.stringify({ name: 'write_file', arguments: { filePath: filename, content: sourceFiles[filename] } })
      : 'The work is complete.';
    onChunk(response);
    return { text: response };
  }
}

class SarvamCompactRetryMock implements AIProvider {
  public calls = 0;
  public retryMessages: any[] = [];
  public retryOptions?: AICompletionOptions;
  async generateText(): Promise<string> { return 'Read-only plan'; }
  async generateStream(_prompt: string, _options: AICompletionOptions, onChunk: (chunk: string) => void): Promise<string> { onChunk('Read-only plan'); return 'Read-only plan'; }
  async chatWithTools(messages: any[], tools: ToolDefinition[], options: AICompletionOptions = {}) { return this.reply(messages, tools, options); }
  async chatWithToolsStream(messages: any[], tools: ToolDefinition[], options: AICompletionOptions, _onToken: (chunk: string) => void) {
    return this.reply(messages, tools, options);
  }
  private async reply(messages: any[], _tools: ToolDefinition[], options: AICompletionOptions) {
    this.calls++;
    if (this.calls === 1) throw new Error('Sarvam output was truncated; no tool was executed.');
    if (this.calls === 2) { this.retryMessages = messages; this.retryOptions = options; return { text: 'I will update the file now.', toolCalls: [] }; }
    const filePath = (options.format as any)?.properties?.arguments?.properties?.filePath?.enum?.[0] || 'index.html';
    const content: Record<string, string> = {
      'index.html': sourceFiles['index.html'],
      'style.css': sourceFiles['style.css'],
      'script.js': sourceFiles['script.js'],
    };
    return { text: '', toolCalls: [{ id: `sarvam-${this.calls}`, name: 'write_file', args: { filePath, content: content[filePath.split('/').pop() || filePath] || 'ok' } }] };
  }
}

class Qwen3TransportFallbackMock implements AIProvider {
  public nonStreamingCalls = 0;
  public streamingCalls = 0;
  async generateText(): Promise<string> { return ''; }
  async generateStream(_prompt: string, _options: AICompletionOptions, onChunk: (chunk: string) => void): Promise<string> { onChunk(''); return ''; }
  supportsToolJsonSchemaForModel(): boolean { return true; }
  async chatWithTools(_messages: any[], _tools: ToolDefinition[], _options: AICompletionOptions = {}) {
    this.nonStreamingCalls++;
    if (this.nonStreamingCalls <= 2) throw new Error('QUILLIX cannot connect to Ollama (fetch failed).');
    return { text: '', toolCalls: [{ id: `qwen3-${this.nonStreamingCalls}`, name: 'write_file', args: this.fileArgs(_options) }] };
  }
  async chatWithToolsStream(_messages: any[], _tools: ToolDefinition[], options: AICompletionOptions, _onToken: (chunk: string) => void) {
    this.streamingCalls++;
    return { text: '', toolCalls: [{ id: `qwen3-stream-${this.streamingCalls}`, name: 'write_file', args: this.fileArgs(options) }] };
  }
  private fileArgs(options: AICompletionOptions) {
    const filePath = (options.format as any)?.properties?.arguments?.properties?.filePath?.enum?.[0] || 'index.html';
    return { filePath, content: sourceFiles[filePath.split('/').pop() || filePath] || '<!doctype html><html><body>ok</body></html>' };
  }
}

class LocalFallbackRecoveryMock implements AIProvider {
  public calls = 0;
  public released: string[] = [];
  public options: AICompletionOptions[] = [];
  public streamingModels: string[] = [];
  async generateText(): Promise<string> { return ''; }
  async generateStream(_prompt: string, _options: AICompletionOptions, onChunk: (chunk: string) => void): Promise<string> { onChunk(''); return ''; }
  supportsToolJsonSchemaForModel(model?: string): boolean { return model === 'qwen3:latest'; }
  async getFallbackModel(): Promise<string | undefined> {
    return this.calls === 1 ? 'qwen2.5-coder:3b' : undefined;
  }
  async releaseModel(model?: string): Promise<void> {
    if (model) this.released.push(model);
  }
  async chatWithTools(_messages: any[], _tools: ToolDefinition[], options: AICompletionOptions = {}) {
    this.calls++;
    this.options.push(options);
    if (this.calls === 1) throw new Error('Ollama request timed out.');
    if (this.calls === 2) throw new Error('llama-server process has terminated: exit status 1');
    const target = _messages.at(-1)?.content.match(/(?:Project file now with one write_file tool:|Target:)\s*([\w./-]+\.(?:html|css|js))\b/i)?.[1];
    const filePath = (options.format as any)?.properties?.arguments?.properties?.filePath?.enum?.[0] || target || 'index.html';
    return { text: '', toolCalls: [{ id: `recovery-${this.calls}`, name: 'write_file', args: { filePath, content: sourceFiles[filePath.split('/').pop() || filePath] || '<!doctype html><html><body>ok</body></html>' } }] };
  }
  async chatWithToolsStream(_messages: any[], _tools: ToolDefinition[], options: AICompletionOptions, _onToken: (chunk: string) => void) {
    this.streamingModels.push(options.model || '');
    return this.chatWithTools(_messages, _tools, options);
  }
}

class TextOnlyBrainMock implements AIProvider {
  public readonly capabilities = { tools: false, streaming: true, reasoning: false };
  public receivedToolCounts: number[] = [];
  async generateText(): Promise<string> { return 'Text-only response'; }
  async generateStream(_prompt: string, _options: AICompletionOptions, onChunk: (chunk: string) => void): Promise<string> {
    onChunk('Text-only response');
    return 'Text-only response';
  }
  async chatWithTools(_messages: any[], tools: ToolDefinition[]) {
    this.receivedToolCounts.push(tools.length);
    return { text: '<tool_call>{\"name\":\"write_file\",\"arguments\":{\"filePath\":\"blocked.html\",\"content\":\"must not execute\"}}</tool_call>' };
  }
  async chatWithToolsStream(_messages: any[], tools: ToolDefinition[], _options: AICompletionOptions, _onChunk: (chunk: string) => void) {
    return this.chatWithTools(_messages, tools);
  }
}

class CompactToolSurfaceMock implements AIProvider {
  readonly capabilities = { tools: true, streaming: false, reasoning: false };
  readonly toolCounts: number[] = [];
  async generateText(): Promise<string> { return ''; }
  async generateStream(): Promise<string> { return ''; }
  async chatWithTools(_messages: any[], tools: ToolDefinition[], options: AICompletionOptions = {}) {
    this.toolCounts.push(tools.length);
    const filePath = (options.format as any)?.properties?.arguments?.properties?.filePath?.enum?.[0] || 'greet.cjs';
    return { text: '', toolCalls: [{ id: 'compact-write', name: 'write_file', args: {
      filePath, content: 'exports.greet = name => `Hello, ${String(name || "World").trim()}!`;\n',
    } }] };
  }
  async chatWithToolsStream(messages: any[], tools: ToolDefinition[], options: AICompletionOptions) {
    return this.chatWithTools(messages, tools, options);
  }
}

async function runScenario(mode: 'full' | 'incomplete' | 'plan' | 'repair', autoApplyDiffs = true) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-contract-'));
  const workspace = new WorkspaceManager(root);
  const terminal = new TerminalService();
  const git = new GitService(terminal);
  const indexer = new CodebaseIndexer(workspace, git);
  const settings = new SettingsStore(path.join(root, 'settings.json'));
  settings.update({ ...DEFAULT_SETTINGS, autoApplyDiffs, terminalApproval: true });
  const agent = new AgentEngine(
    new LocalModelMock(mode),
    new ToolRegistry(workspace, terminal, git, indexer, settings),
    indexer,
    new WorkspaceVerifier(workspace, terminal)
  );
  try {
    const result = await agent.run({
      userPrompt: 'Build a calculator website',
      mode: mode === 'plan' ? 'plan' : 'agent',
      conversationHistory: [],
      settings: { maxAutonomousTurns: 9, temperature: 0, autoApplyDiffs },
    });
    const paths = fs.readdirSync(root, { recursive: true }).map(String);
    return { result, paths };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

describe('Agent completeness and safety regression', () => {
  it('uses the compact tool surface for every Ollama tag, including latest aliases', () => {
    expect(usesCompactLocalToolSurface('ollama', 'qwen3:latest')).toBe(true);
    expect(usesCompactLocalToolSurface('ollama', 'custom-local-brain')).toBe(true);
    expect(usesCompactLocalToolSurface('universal', 'qwen3:latest')).toBe(false);
    expect(usesCompactLocalToolSurface('universal', 'qwen2.5-coder:1.5b')).toBe(false);
    expect(usesCompactLocalToolSurface(undefined, 'qwen2.5-coder:3b')).toBe(true);
  });

  it('classifies local fallback activity with the actual provider failure reason', () => {
    expect(classifyLocalFallbackReason('qwen:1.8b does not support tools')).toBe('unsupported tools');
    expect(classifyLocalFallbackReason('HTTP 429 rate limit')).toBe('rate limit');
    expect(classifyLocalFallbackReason('fetch failed: connection reset')).toBe('connection loss');
    expect(classifyLocalFallbackReason('Ollama request timed out')).toBe('timeout');
  });

  it('keeps the actual qwen3 latest first-call tool surface within the token budget', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-compact-surface-'));
    const workspace = new WorkspaceManager(root);
    const terminal = new TerminalService();
    const git = new GitService(terminal);
    const indexer = new CodebaseIndexer(workspace, git);
    const settings = new SettingsStore(path.join(root, 'settings.json'));
    settings.update({ ...DEFAULT_SETTINGS, autoApplyDiffs: true });
    const provider = new CompactToolSurfaceMock();
    const agent = new AgentEngine(provider, new ToolRegistry(workspace, terminal, git, indexer, settings), indexer, new WorkspaceVerifier(workspace, terminal));
    try {
      const result = await agent.run({
        userPrompt: 'Create a file named greet.cjs exporting greet(name).',
        mode: 'agent', provider: 'ollama', model: 'qwen3:latest', conversationHistory: [],
        settings: { maxAutonomousTurns: 4, temperature: 0, autoApplyDiffs: true },
      });
      expect(provider.toolCounts[0]).toBeLessThanOrEqual(12);
      expect(result.toolCalls.some(call => call.name === 'write_file')).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not compound adapter-owned rate-limit retries at the agent layer', () => {
    expect(isProviderRateLimitError(new Error('Universal API rate limit persisted after 2 retries.'))).toBe(true);
    expect(isProviderRateLimitError(new Error('HTTP 429: too many requests'))).toBe(true);
    expect(isProviderRateLimitError(new Error('connection reset by peer'))).toBe(false);
  });

  it('recovers a truncated Sarvam website tool turn with one compact file retry', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-sarvam-compact-'));
    const workspace = new WorkspaceManager(root);
    const terminal = new TerminalService();
    const git = new GitService(terminal);
    const indexer = new CodebaseIndexer(workspace, git);
    const settings = new SettingsStore(path.join(root, 'settings.json'));
    settings.update({ ...DEFAULT_SETTINGS, autoApplyDiffs: true });
    const provider = new SarvamCompactRetryMock();
    const agent = new AgentEngine(provider, new ToolRegistry(workspace, terminal, git, indexer, settings), indexer, new WorkspaceVerifier(workspace, terminal));
    try {
      const result = await agent.run({
        userPrompt: 'Create a polished notebook shop website with CSS animations.',
        mode: 'agent', provider: 'sarvam', model: 'sarvam-105b', conversationHistory: [],
        settings: { maxAutonomousTurns: 8, temperature: 0, autoApplyDiffs: true },
      });
      expect(provider.calls).toBeGreaterThanOrEqual(4);
      expect(provider.retryOptions?.maxOutputTokens).toBeLessThanOrEqual(3072);
      expect(provider.retryMessages.map(message => message.content).join('\n')).toMatch(/previous Sarvam response was truncated/i);
      expect(result.toolCalls.some(call => call.name === 'write_file')).toBe(true);
      expect(fs.readdirSync(root, { recursive: true }).map(String).some(file => file.endsWith('index.html'))).toBe(true);
      expect(result.finalText).not.toMatch(/Sarvam output was truncated/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('switches a Qwen3 new-file turn to streaming after repeated Ollama transport failures', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-qwen3-transport-'));
    const workspace = new WorkspaceManager(root);
    const terminal = new TerminalService();
    const git = new GitService(terminal);
    const indexer = new CodebaseIndexer(workspace, git);
    const settings = new SettingsStore(path.join(root, 'settings.json'));
    settings.update({ ...DEFAULT_SETTINGS, autoApplyDiffs: true });
    const provider = new Qwen3TransportFallbackMock();
    const agent = new AgentEngine(provider, new ToolRegistry(workspace, terminal, git, indexer, settings), indexer, new WorkspaceVerifier(workspace, terminal));
    try {
      const result = await agent.run({
        userPrompt: 'Build a polished calculator website.',
        mode: 'agent', model: 'qwen3:4b', conversationHistory: [],
        settings: { maxAutonomousTurns: 10, temperature: 0, autoApplyDiffs: true },
      });
      expect(provider.nonStreamingCalls).toBeGreaterThanOrEqual(2);
      expect(provider.streamingCalls).toBeGreaterThanOrEqual(1);
      expect(result.toolCalls.some(call => call.name === 'write_file')).toBe(true);
      expect(result.finalText).not.toMatch(/cannot connect to Ollama/i);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('gives an installed fallback brain one bounded Ollama worker-recovery retry', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-fallback-recovery-'));
    const workspace = new WorkspaceManager(root);
    const terminal = new TerminalService();
    const git = new GitService(terminal);
    const indexer = new CodebaseIndexer(workspace, git);
    const settings = new SettingsStore(path.join(root, 'settings.json'));
    settings.update({ ...DEFAULT_SETTINGS, autoApplyDiffs: true });
    const provider = new LocalFallbackRecoveryMock();
    const agent = new AgentEngine(provider, new ToolRegistry(workspace, terminal, git, indexer, settings), indexer, new WorkspaceVerifier(workspace, terminal));
    try {
      const result = await agent.run({
        userPrompt: 'Create a small calculator website.',
        mode: 'agent', model: 'qwen3:latest', conversationHistory: [],
        settings: { maxAutonomousTurns: 8, temperature: 0, autoApplyDiffs: true },
      });
      expect(provider.calls).toBeGreaterThanOrEqual(3);
      expect(provider.released).toEqual(['qwen3:latest']);
      expect(provider.options[0].format).toBeDefined();
      expect(provider.options[1]).toMatchObject({ model: 'qwen2.5-coder:3b' });
      expect(provider.options[1].format).toBeUndefined();
      expect(provider.streamingModels).toContain('qwen2.5-coder:3b');
      expect(result.toolCalls.some(call => call.name === 'write_file')).toBe(true);
      expect(result.finalText).not.toMatch(/cannot connect|worker-recovery/i);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('repairs broken browser JS with current HTML context and retests before completion', async () => {
    const { result } = await runScenario('repair');
    expect(result.toolCalls.filter(call => String(call.args.filePath).endsWith('script.js'))).toHaveLength(2);
    expect(result.phases.find(p => p.id === 'completion')?.status).toBe('completed');
    expect(result.projectReport?.verification.syntaxChecked).toBe(true);
    expect(result.activities.some(a => a.message.includes('Retesting after repair'))).toBe(true);
  });
  it('continues until every plain-website source file has been saved to disk', async () => {
    const { result, paths } = await runScenario('full');
    for (const file of Object.keys(sourceFiles)) expect(paths.some(p => p.endsWith(file))).toBe(true);
    expect(result.phases.find(p => p.id === 'completion')?.status).toBe('completed');
    expect(result.projectReport?.verification.executed).toBe(false);
    expect(result.projectReport?.verification.summary).toMatch(/not launched/i);
  });

  it('does not claim success when Qwen stops after one file', async () => {
    const { result, paths } = await runScenario('incomplete');
    expect(paths.some(p => p.endsWith('index.html'))).toBe(true);
    expect(paths.some(p => p.endsWith('style.css'))).toBe(false);
    expect(result.finalText).toMatch(/INCOMPLETE/);
    expect(result.phases.find(p => p.id === 'completion')?.status).toBe('failed');
  });

  it('does not run or report staged patches as applied', async () => {
    const { result, paths } = await runScenario('full', false);
    expect(paths.some(p => p.endsWith('index.html'))).toBe(false);
    expect(result.patches[0].applied).toBe(false);
    expect(result.finalText).toMatch(/PENDING REVIEW/);
    expect(result.projectReport).toBeUndefined();
  });

  it('does not create a project or invoke tools in PLAN mode', async () => {
    const { result, paths } = await runScenario('plan');
    expect(result.finalText).toBe('Read-only plan');
    expect(result.toolCalls).toEqual([]);
    expect(paths.filter(p => p !== 'settings.json')).toEqual([]);
  });

  it('honors a text-only brain capability and never executes returned tool-shaped text', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-text-only-brain-'));
    const workspace = new WorkspaceManager(root);
    const terminal = new TerminalService();
    const git = new GitService(terminal);
    const indexer = new CodebaseIndexer(workspace, git);
    const settings = new SettingsStore(path.join(root, 'settings.json'));
    settings.update({ ...DEFAULT_SETTINGS, autoApplyDiffs: true });
    const provider = new TextOnlyBrainMock();
    const agent = new AgentEngine(provider, new ToolRegistry(workspace, terminal, git, indexer, settings), indexer, new WorkspaceVerifier(workspace, terminal));
    try {
      const result = await agent.run({
        userPrompt: 'Create a file named blocked.html.',
        mode: 'agent', conversationHistory: [],
        settings: { maxAutonomousTurns: 2, temperature: 0, autoApplyDiffs: true },
      });
      // Text-only brains fail fast; repeating a request cannot make tools
      // appear and would only waste tokens or provider quota.
      expect(provider.receivedToolCounts).toEqual([0]);
      expect(result.toolCalls).toEqual([]);
      expect(fs.existsSync(path.join(root, 'blocked.html'))).toBe(false);
      expect(result.finalText).toMatch(/FAILED|INCOMPLETE/i);
      expect(result.activities.some((activity: any) => /text-only.*tools disabled|does not support coding tools/i.test(activity.message + ' ' + (activity.details || '')))).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
