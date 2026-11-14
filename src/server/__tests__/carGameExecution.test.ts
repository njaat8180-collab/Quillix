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
import { classifyIntent } from '../intentRouter.js';
import { ToolCall, ToolDefinition, AgentPhase } from '../../shared/types.js';

/**
 * Regression tests for the REAL execution path:
 *
 *   user request → intent → project decision → planning → model request →
 *   tool-call generation → parser → registry → filesystem → python runner →
 *   error/fix/retest → verification → completion
 *
 * The scripted provider mimics qwen2.5-coder:3b behaviour, including its
 * tendency to ANSWER "help me build X" conversationally first.
 */
class ScriptedProvider implements AIProvider {
  public turns: Array<Array<Record<string, any>>> = [];

  constructor(
    private script: Array<{ text: string; toolCalls?: ToolCall[]; reject?: Error }>
  ) {}

  async generateText(): Promise<string> {
    throw new Error('not used');
  }
  async generateStream(): Promise<string> {
    throw new Error('not used');
  }
  async chatWithTools(_m: unknown, _t: ToolDefinition[]) {
    const next = this.script.shift() || { text: 'Done.' };
    if (next.reject) throw next.reject;
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
    if (next.reject) throw next.reject;
    for (const ch of next.text) onToken(ch);
    return { text: next.text, toolCalls: next.toolCalls };
  }
}

const MAIN_PY = [
  '"""CarGame — a tiny terminal racing demo (stdlib only)."""',
  'import random',
  '',
  '',
  'def main():',
  "    print('CAR GAME')",
  "    print('Steer with A/D. Dodge the obstacles!')",
  '    score = 0',
  '    road = [\".\"] * 20',
  '    for tick in range(3):',
  "        road[random.randint(0, 19)] = 'X'",
  "        print(''.join(road))",
  '        score += 10',
  "    print(f'Game over. Score: {score}')",
  '',
  '',
  "if __name__ == '__main__':",
  '    main()',
].join('\n');

describe('Python car-game request: real execution path', () => {
  let testDir: string;
  let workspace: WorkspaceManager;
  let memory: ProjectMemory;
  let phaseSnapshots: AgentPhase[][];

  const buildEngine = (provider: AIProvider) => {
    const settings = new SettingsStore(path.join(testDir, '.quillix-test-settings.json'));
    settings.update({ ...DEFAULT_SETTINGS, autoApplyDiffs: true, terminalApproval: false });
    const terminal = new TerminalService();
    const git = new GitService(terminal);
    const indexer = new CodebaseIndexer(workspace, git);
    const registry = new ToolRegistry(workspace, terminal, git, indexer, settings);
    const verifier = new WorkspaceVerifier(workspace, terminal);
    return new AgentEngine(provider, registry, indexer, verifier, memory);
  };

  const run = (engine: AgentEngine, userPrompt: string, settings = { maxAutonomousTurns: 6, temperature: 0.2, autoApplyDiffs: true }) =>
    engine.run({
      userPrompt,
      mode: 'agent',
      conversationHistory: [],
      settings,
      onPhaseUpdate: (phases) => phaseSnapshots.push([...phases]),
    });

  const phase = (id: string): AgentPhase | undefined => {
    const last = phaseSnapshots[phaseSnapshots.length - 1] || [];
    return last.find((p) => p.id === id);
  };

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-cargame-'));
    workspace = new WorkspaceManager(testDir);
    memory = new ProjectMemory(testDir);
    phaseSnapshots = [];
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('routes "Help me build a car game using Python" to the agent + project pipeline', () => {
    const intent = classifyIntent('Help me build a car game using Python');
    expect(intent.kind).toBe('agent');
  });

  it('A/C: conversational first turn → engine REDIRECTS the model to tools → project is really built and run', async () => {
    const provider = new ScriptedProvider([
      // Turn 1 — the model explains instead of building (small-model behaviour)
      {
        text:
          "I'd be happy to help you build a car game using Python! Here's how you could approach it: " +
          'you could use the pygame library and create a Game class with an update loop...',
      },
      // Turn 2 — after the nudge the model actually creates the files
      {
        text:
          'Creating the project files now.\n' +
          `{"tool": "create_file", "arguments": {"filePath": "main.py", "content": ${JSON.stringify(MAIN_PY)}}}\n` +
          '{"tool": "create_file", "arguments": {"filePath": "README.md", "content": "# CarGame\\n\\nA tiny Python car game. Run: python main.py\\n"}}',
      },
      // Turn 3 — final summary after tool results came back
      { text: 'The CarGame project is complete. main.py runs a small terminal car game.' },
    ]);
    const engine = buildEngine(provider);
    const result = await run(engine, 'Help me build a car game using Python');

    // The engine redirected the model instead of accepting the stop.
    expect(provider.turns.length).toBe(3);
    // (the scripted provider stores a live reference to the conversation
    // array, so assert by content, not by "last message at the time")
    expect(
      provider.turns[1].some((m) => m.role === 'user' && String(m.content).includes('hands-on coding task'))
    ).toBe(true);

    // Project folder named from the task, files physically on disk.
    const root = path.join(testDir, 'CarGame');
    expect(fs.existsSync(root)).toBe(true);
    expect(fs.existsSync(path.join(root, 'main.py'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'README.md'))).toBe(true);
    expect(result.verifiedFiles.length).toBe(2);

    // Tool calls executed with results returned into the conversation.
    expect(result.toolCalls.length).toBe(2);
    expect(result.toolResults.every((r) => r.success)).toBe(true);
    const toolMsgs = provider.turns[2].filter((m) => m.role === 'tool');
    expect(toolMsgs.length).toBe(2);

    // Python runner invoked: real execution, exit code captured.
    expect(result.projectReport?.profile?.language).toBe("python");
    expect(result.projectReport?.verification.executed).toBe(true);
    expect(result.projectReport?.verification.exitCode).toBe(0);
    expect(result.projectReport?.verification.summary).toMatch(/executed successfully/);
    expect(result.projectReport?.verification.summary).toMatch(/python/);

    // Phases: implementation/build/test completed, phase 15 COMPLETED.
    expect(phase('implement-core')?.status).toBe('completed');
    expect(phase('build')?.status).toBe('completed');
    expect(phase('final-verification')?.status).toBe('completed');
    expect(phase('completion')?.status).toBe('completed');

    // Report with absolute paths.
    expect(result.finalText).toContain('PROJECT ROOT:');
    expect(result.finalText).toContain(root);

    // Memory recorded the python project.
    expect(memory.getActive()?.name).toBe('CarGame');
  });

  it('B: model never executes tools → run is honestly FAILED, never "(not needed)" and never COMPLETED', async () => {
    let chatterStep = 0;
    const chatter = () => ({
      text: `Sure! Step ${++chatterStep}: to build a car game you will want to install Python and a library like pygame, then create a game loop...`,
    });
    const provider = new ScriptedProvider([chatter(), chatter(), chatter(), chatter(), chatter(), chatter()]);
    const engine = buildEngine(provider);
    const result = await run(engine, 'Help me build a car game using Python');

    // Two nudges happened, then the engine gave up honestly.
    expect(provider.turns.length).toBeGreaterThanOrEqual(3);
    expect(result.verifiedFiles.length).toBe(0);
    expect(fs.readdirSync(path.join(testDir, 'CarGame')).length).toBe(0);

    // The final response is a FAILURE, not fake success.
    expect(result.finalText).toContain('Task FAILED');
    expect(result.finalText).toContain('no files were written to disk');
    expect(result.finalText).not.toContain('Task completed.');

    // Required phases are FAILED — never skipped/"not needed".
    for (const id of ['structure', 'implement-core', 'implement-features', 'validation', 'build', 'testing', 'completion']) {
      expect(phase(id)?.status).toBe('failed');
    }
    const notNeeded = (phaseSnapshots[phaseSnapshots.length - 1] || []).filter(
      (p) => p.detail === 'Not needed for this request'
    );
    expect(notNeeded.length).toBe(0);

    // No project report was fabricated for the empty folder.
    expect(result.projectReport).toBeUndefined();
  });

  it('D: an Ollama timeout FAILS the run — it can never complete', async () => {
    const provider = new ScriptedProvider([
      { text: '', reject: new Error('Ollama request timed out after 300 seconds of NO STREAMED DATA.') },
    ]);
    const engine = buildEngine(provider);

    await expect(run(engine, 'Help me build a car game using Python')).rejects.toThrow(/timed out/);

    // Phases at throw time: something FAILED, nothing beyond it COMPLETED.
    const last = phaseSnapshots[phaseSnapshots.length - 1] || [];
    expect(last.some((p) => p.status === 'failed')).toBe(true);
    expect(last.filter((p) => p.status === 'completed').length).toBeLessThan(last.length);
    expect(phase('completion')?.status).not.toBe('completed');
  });

  it('reports a deadline abort distinctly from an explicit user stop', async () => {
    const provider = new ScriptedProvider([{ text: 'unused' }]);
    const engine = buildEngine(provider);
    const controller = new AbortController();
    controller.abort(new DOMException('The operation timed out.', 'TimeoutError'));
    const result = await engine.run({
      userPrompt: 'Help me build a car game using Python',
      mode: 'agent',
      conversationHistory: [],
      settings: { maxAutonomousTurns: 6, temperature: 0.2, autoApplyDiffs: true },
      signal: controller.signal,
    });
    expect(result.cancelled).toBe(true);
    expect(result.finalText).toMatch(/timed out/i);
    expect(result.activities.some(activity => activity.type === 'error' && /timed out/i.test(activity.message))).toBe(true);
    expect(result.activities.some(activity => /stopped by user/i.test(activity.message))).toBe(false);
  });

  it('E: normal conversation does not create files or folders', async () => {
    const provider = new ScriptedProvider([{ text: "Hi! I'm QUILLIX, your local coding agent. How can I help today?" }]);
    const engine = buildEngine(provider);
    const result = await run(engine, 'hello, how are you?');

    expect(classifyIntent('hello, how are you?').kind).toBe('chat');
    expect(result.toolCalls.length).toBe(0);
    const created = fs.readdirSync(testDir).filter((f) => !f.startsWith('.'));
    expect(created).toEqual([]);
  });
});
