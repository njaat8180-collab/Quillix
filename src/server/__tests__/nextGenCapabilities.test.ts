import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ToolRegistry } from '../toolRegistry.js';
import { WorkspaceManager } from '../workspace.js';
import { TerminalService } from '../terminal.js';
import { GitService } from '../git.js';
import { CodebaseIndexer } from '../indexer.js';
import { SettingsStore, DEFAULT_SETTINGS } from '../settings.js';
import { TaskStateStore } from '../taskState.js';
import { AgentEngine } from '../agentEngine.js';
import { WorkspaceVerifier } from '../verifier.js';
import { ProjectMemory } from '../projectMemory.js';
import { AIProvider } from '../qwen.js';
import { ToolCall, ToolDefinition } from '../../shared/types.js';

/**
 * Next-generation agent capabilities:
 *   §4  get_file_metadata / get_project_structure / compare_files / verify_file
 *   §16 language-aware run_tests
 *   §21 persistent task state + resume
 *   §29 atomic writes
 *   §37 false-completion prevention (a failed write can NEVER become COMPLETE)
 */

class ScriptedProvider implements AIProvider {
  public readonly capturedMessages: any[] = [];
  constructor(private script: Array<{ text: string; toolCalls?: ToolCall[] }>) {}
  async generateText(): Promise<string> { throw new Error('not used'); }
  async generateStream(): Promise<string> { throw new Error('not used'); }
  async chatWithTools(): Promise<{ text: string; toolCalls?: ToolCall[] }> { throw new Error('not used'); }
  async chatWithToolsStream(
    _messages: any,
    _tools: ToolDefinition[],
    _options: unknown,
    onToken: (t: string) => void
  ): Promise<{ text: string; toolCalls?: ToolCall[] }> {
    this.capturedMessages.push(_messages);
    const next = this.script.shift() || { text: 'Done.' };
    for (const ch of next.text) onToken(ch);
    return { text: next.text, toolCalls: next.toolCalls };
  }
}

describe('Next-gen agent capabilities (§4 §16 §21 §29 §37)', () => {
  let testDir: string;
  let workspace: WorkspaceManager;
  let registry: ToolRegistry;
  let memory: ProjectMemory;

  const buildRegistry = () => {
    const settings = new SettingsStore(path.join(testDir, '.quillix-test-settings.json'));
    settings.update({ ...DEFAULT_SETTINGS, autoApplyDiffs: true, terminalApproval: false });
    const terminal = new TerminalService();
    const git = new GitService(terminal);
    const indexer = new CodebaseIndexer(workspace, git);
    return new ToolRegistry(workspace, terminal, git, indexer, settings);
  };

  const buildEngine = (provider: AIProvider, tasks: TaskStateStore) => {
    const settings = new SettingsStore(path.join(testDir, '.quillix-test-settings.json'));
    settings.update({ ...DEFAULT_SETTINGS, autoApplyDiffs: true, terminalApproval: false });
    const terminal = new TerminalService();
    const git = new GitService(terminal);
    const indexer = new CodebaseIndexer(workspace, git);
    const verifier = new WorkspaceVerifier(workspace, terminal);
    return new AgentEngine(provider, registry, indexer, verifier, memory, undefined, tasks);
  };

  const exec = (name: string, args: Record<string, any>) =>
    registry.executeTool(`tc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, name, args);

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(process.cwd(), '.test-tmp-nextgen-'));
    workspace = new WorkspaceManager(testDir);
    registry = buildRegistry();
    memory = new ProjectMemory(testDir);
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  // ------------------------------------------------------------------ §4 ---

  it('get_file_metadata returns REAL stat data for a file on disk', async () => {
    const content = 'print("hello")\n';
    await exec('write_file', { filePath: 'app/main.py', content });
    const res = await exec('get_file_metadata', { filePath: 'app/main.py' });
    expect(res.success).toBe(true);
    const meta = res.data as any;
    expect(meta.sizeBytes).toBe(content.length);
    expect(meta.absolutePath).toBe(path.join(testDir, 'app', 'main.py'));
    expect(meta.isFile).toBe(true);
    expect(meta.isDirectory).toBe(false);
    expect(typeof meta.modified).toBe('string');
  });

  it('get_file_metadata fails honestly for a missing file', async () => {
    const res = await exec('get_file_metadata', { filePath: 'nope.txt' });
    expect(res.success).toBe(false);
  });

  it('get_project_structure renders the real tree with counts', async () => {
    await exec('write_file', { filePath: 'proj/main.py', content: 'x = 1\n' });
    await exec('write_file', { filePath: 'proj/utils/helpers.py', content: 'y = 2\n' });
    const res = await exec('get_project_structure', { dirPath: 'proj' });
    expect(res.success).toBe(true);
    const out = res.output as string;
    expect(out).toContain('main.py');
    expect(out).toContain('helpers.py');
    const data = res.data as any;
    expect(data.fileCount).toBe(2);
    expect(data.directoryCount).toBe(1);
  });

  it('compare_files distinguishes identical and differing files with a real diff', async () => {
    await exec('write_file', { filePath: 'a.txt', content: 'one\ntwo\n' });
    await exec('write_file', { filePath: 'b.txt', content: 'one\nTWO\n' });
    const same = await exec('compare_files', { filePathA: 'a.txt', filePathB: 'a.txt' });
    expect(same.success).toBe(true);
    expect(same.output).toContain('IDENTICAL');
    const diff = await exec('compare_files', { filePathA: 'a.txt', filePathB: 'b.txt' });
    expect(diff.success).toBe(true);
    expect(diff.output).toContain('+TWO');
    expect(diff.output).toContain('-two');
  });

  it('verify_file passes real code, fails missing files, placeholders, and wrong expected content', async () => {
    await exec('write_file', { filePath: 'good.py', content: 'def add(a, b):\n    return a + b\n' });
    const good = await exec('verify_file', { filePath: 'good.py' });
    expect(good.success).toBe(true);
    expect(good.output).toContain('PASS');

    const missing = await exec('verify_file', { filePath: 'ghost.py' });
    expect(missing.success).toBe(false);
    expect(missing.output).toContain('VERIFICATION FAILED');

    workspace.createFile('stub.py', '');
    const stub = await exec('verify_file', { filePath: 'stub.py' });
    expect(stub.success).toBe(false);
    expect(String(stub.output)).toMatch(/no implementation/i);

    const wrong = await exec('verify_file', { filePath: 'good.py', expectedContent: 'NOT IN THIS FILE' });
    expect(wrong.success).toBe(false);
    expect(wrong.output).toContain('Expected content present: NO');
  });

  // ----------------------------------------------------------------- §16 ---

  it('run_tests reports honestly when a detected non-Node project has no test suite', async () => {
    await exec('write_file', { filePath: 'PyTool/main.py', content: 'print("hi")\n' });
    const res = await exec('run_tests', { }, );
    // No configured test suite: fail clearly instead of running an unrelated
    // npm command in a Python/empty workspace and claiming verification.
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/No test suite configured/i);
    expect(res.output).toMatch(/No test command configured/i);
  });

  it('run_tests uses the detected project profile command for a Python project with tests', async () => {
    await exec('write_file', { filePath: 'PyCalc/calc.py', content: 'def add(a, b):\n    return a + b\n' });
    await exec('write_file', { filePath: 'PyCalc/test_calc.py', content: 'from calc import add\n\nassert add(1, 2) == 3\n' });
    const res = await registry.executeTool('tc_pytest', 'run_tests', {}, { projectPrefix: 'PyCalc' });
    // The REAL profile test command for python (python3 -m pytest) must be the
    // command actually executed — visible in the command output record.
    expect(String(res.output)).toContain('-m pytest');
    expect(String(res.output)).toContain('cwd');
  });

  // ----------------------------------------------------------------- §29 ---

  it('atomic writes leave no temp files behind and fully replace content', async () => {
    await exec('write_file', { filePath: 'f.txt', content: 'version 1' });
    await exec('write_file', { filePath: 'f.txt', content: 'version 2 with more data' });
    const leftovers = fs.readdirSync(testDir).filter((f) => f.includes('quillix-tmp'));
    expect(leftovers).toHaveLength(0);
    expect(fs.readFileSync(path.join(testDir, 'f.txt'), 'utf8')).toBe('version 2 with more data');
  });

  // ----------------------------------------------------------------- §21 ---

  it('TaskStateStore persists across restarts and builds a verified resume context', async () => {
    const store = new TaskStateStore(testDir);
    const task = store.startTask('Help me to build a Python car game', 'agent', { provider: 'ollama', model: 'qwen3:4b', capabilities: { tools: true, streaming: true, reasoning: false } });
    store.setProject(task.id, 'CarGame', path.join(testDir, 'CarGame'));
    store.recordFileCreated(task.id, 'CarGame/main.py');
    store.recordFileCreated(task.id, 'CarGame/README.md');
    fs.mkdirSync(path.join(testDir, 'CarGame'), { recursive: true });
    fs.writeFileSync(path.join(testDir, 'CarGame', 'main.py'), 'print("game")\n');
    // README.md was never actually written.
    store.recordCommand(task.id, { command: 'python3 -m py_compile main.py', cwd: path.join(testDir, 'CarGame'), exitCode: 0, durationMs: 42, timestamp: Date.now() });
    store.recordError(task.id, 'py_compile failed first: SyntaxError');
    store.recordRetry(task.id);
    store.recordToolMetric(task.id, 'read_file', true, 12);
    store.recordToolMetric(task.id, 'run_tests', false, 34);
    store.recordVerification(task.id, { summary: 'one failed verification', executed: true, exitCode: 1 });

    // Simulate a restart: a NEW store instance reading the same file.
    const store2 = new TaskStateStore(testDir);
    const reloaded = store2.getTask(task.id);
    expect(reloaded).toBeDefined();
    expect(reloaded?.userRequest).toBe('Help me to build a Python car game');
    expect(reloaded?.filesCreated).toContain('CarGame/main.py');
    expect(reloaded?.retryCount).toBe(1);
    expect(reloaded?.commandsExecuted).toHaveLength(1);
    expect(reloaded?.observability.provider).toBe('ollama');
    expect(reloaded?.observability.model).toBe('qwen3:4b');
    expect(reloaded?.observability.capabilities).toEqual({ tools: true, streaming: true, reasoning: false });
    expect(reloaded?.observability.toolCalls).toBe(2);
    expect(reloaded?.observability.toolFailures).toBe(1);
    expect(reloaded?.observability.byTool.run_tests.totalDurationMs).toBe(34);
    expect(reloaded?.observability.verificationRuns).toBe(1);

    const ctx = store2.buildResumeContext(reloaded!);
    expect(ctx).toContain('RESUMING');
    expect(ctx).toContain('Previous brain: ollama / qwen3:4b (tools=true, streaming=true, reasoning=false)');
    expect(ctx).toContain('already created and verified on disk: CarGame/main.py');
    expect(ctx).toContain('NOT on disk (recreate them): CarGame/README.md');
    expect(ctx).toContain('exit 0');

    store2.finishTask(task.id, 'completed', 'done');
    expect(store2.getTask(task.id)?.status).toBe('completed');
    expect(store2.listTasks()[0].id).toBe(task.id);
  });

  it('agent run records the task lifecycle from real execution (§21 + §20)', async () => {
    const tasks = new TaskStateStore(testDir);
    const provider = new ScriptedProvider([
      {
        text: 'Creating the calculator.',
        toolCalls: [
          {
            id: 'c1',
            name: 'create_file',
            args: { filePath: 'main.py', content: 'def add(a, b):\n    return a + b\n\nif __name__ == "__main__":\n    print(add(2, 3))\n' },
          } as any,
        ],
      },
      { text: 'Calculator created and verified.' },
    ]);
    const engine = buildEngine(provider, tasks);
    const result = await engine.run({
      userPrompt: 'Create a Python calculator',
      mode: 'agent',
      conversationHistory: [],
      settings: { maxAutonomousTurns: 6, temperature: 0.2, autoApplyDiffs: true },
    });

    expect(result.verifiedFiles.length).toBeGreaterThan(0);
    // The file the engine reported as written must exist on disk at the exact
    // workspace-relative path recorded.
    for (const rel of result.verifiedFiles) {
      expect(fs.existsSync(path.join(testDir, rel))).toBe(true);
      expect(fs.statSync(path.join(testDir, rel)).size).toBeGreaterThan(0);
    }
    const createdRel = result.verifiedFiles.find((f) => f.endsWith('main.py'));
    expect(createdRel).toBeDefined();
    expect(fs.readFileSync(path.join(testDir, createdRel!), 'utf8')).toContain('def add');

    const rec = tasks.listTasks()[0];
    expect(rec.status).toBe('completed');
    expect(rec.userRequest).toBe('Create a Python calculator');
    expect(rec.filesCreated.length + rec.filesModified.length).toBeGreaterThan(0);
    expect(rec.verification).toBeDefined();
    expect(typeof rec.verification?.executed).toBe('boolean');
    expect(rec.observability.toolCalls).toBeGreaterThan(0);
    expect(rec.observability.provider).toBeUndefined();
    expect(rec.observability.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.observability?.toolCalls).toBeGreaterThan(0);
    expect(result.observability?.verificationRuns).toBeGreaterThan(0);
    expect(rec.finalText).toContain('Calculator created');
  });

  it('resumeTaskId injects verified resume state into the next provider turn', async () => {
    const tasks = new TaskStateStore(testDir);
    const prior = tasks.startTask('Create a file named pending.cjs that exports the number 42.', 'agent');
    tasks.recordFileCreated(prior.id, 'Calculator/main.py');
    fs.mkdirSync(path.join(testDir, 'Calculator'), { recursive: true });
    fs.writeFileSync(path.join(testDir, 'Calculator', 'main.py'), 'print(42)\n');
    tasks.recordCommand(prior.id, { command: 'python -m py_compile main.py', cwd: path.join(testDir, 'Calculator'), exitCode: 0, durationMs: 4, timestamp: Date.now() });
    tasks.setProject(prior.id, 'Calculator', path.join(testDir, 'Calculator'));
    tasks.finishTask(prior.id, 'failed', 'Provider disconnected');
    fs.mkdirSync(path.join(testDir, 'Unrelated'));
    memory.setActive('Unrelated', path.join(testDir, 'Unrelated'));

    const provider = new ScriptedProvider([{ text: '', toolCalls: [{
      id: 'resume-write', name: 'write_file', args: { filePath: 'pending.cjs', content: 'module.exports = 42;\n' },
    }] }]);
    const engine = buildEngine(provider, tasks);
    const resumed = await engine.run({
      userPrompt: 'Continue this project safely.',
      mode: 'agent',
      conversationHistory: [],
      resumeTaskId: prior.id,
      settings: { maxAutonomousTurns: 1, temperature: 0.2, autoApplyDiffs: true },
    });

    const serialized = JSON.stringify(provider.capturedMessages[0] || []);
    expect(serialized).toContain('RESUMING');
    expect(serialized).toContain('already created and verified on disk: Calculator/main.py');
    expect(serialized).toContain('python -m py_compile main.py (exit 0)');
    expect(serialized).toContain('Current resume instruction: Continue this project safely.');
    expect(resumed.activities.some(activity => activity.message.startsWith('Resuming in checkpoint project Calculator'))).toBe(true);
    const resumedRecord = tasks.listTasks()[0];
    expect(resumedRecord.resumedFromTaskId).toBe(prior.id);
    expect(resumedRecord.projectRoot).toBe(path.join(testDir, 'Calculator'));
    expect(resumedRecord.userRequest).toBe(prior.userRequest);
    expect(resumedRecord.filesCreated).toContain('Calculator/main.py');
    expect(resumedRecord.commandsExecuted[0].command).toContain('py_compile');
    expect(fs.readFileSync(path.join(testDir, 'Calculator', 'pending.cjs'), 'utf8')).toContain('42');
    expect(fs.existsSync(path.join(testDir, 'Unrelated', 'pending.cjs'))).toBe(false);
  });

  it('keeps only the newest checkpoint eligible to resume across restart', () => {
    const tasks = new TaskStateStore(testDir);
    const first = tasks.startTask('Build the example', 'agent');
    tasks.finishTask(first.id, 'failed');
    const second = tasks.startTask(first.userRequest, 'agent', { resumedFromTaskId: first.id });
    expect(() => tasks.startTask(first.userRequest, 'agent', { resumedFromTaskId: first.id })).toThrow(/already resumed/);

    const restarted = new TaskStateStore(testDir);
    expect(restarted.resolveResumeCheckpoint(first.id)).toMatchObject({ status: 409 });
    expect(restarted.resolveResumeCheckpoint(second.id)).toMatchObject({ task: { id: second.id, status: 'cancelled' } });
    const last = restarted.startTask(first.userRequest, 'agent', { resumedFromTaskId: second.id });
    restarted.finishTask(last.id, 'completed');
    expect(restarted.resolveResumeCheckpoint(second.id)).toMatchObject({ status: 409 });
    expect(restarted.resolveResumeCheckpoint(last.id)).toMatchObject({ status: 409 });
    expect(restarted.listTasks()).toHaveLength(3);
  });

  // ----------------------------------------------------------------- §37 ---

  it('a failed write can NEVER become COMPLETE — false-completion prevention', async () => {
    // The model writes to a path that escapes the workspace: the safety layer
    // blocks every attempt — a REAL filesystem-level failure.
    const tasks = new TaskStateStore(testDir);
    const provider = new ScriptedProvider([
      {
        text: 'Creating project.',
        toolCalls: [
          { id: 'f1', name: 'create_file', args: { filePath: '../../etc_car_game.py', content: 'def main():\n    pass\n' } } as any,
        ],
      },
      {
        text: 'Retrying.',
        toolCalls: [
          { id: 'f2', name: 'create_file', args: { filePath: '../../outside.py', content: 'def main():\n    pass\n' } } as any,
        ],
      },
      { text: 'Giving up — could not write the file.' },
    ]);
    const engine = buildEngine(provider, tasks);
    const result = await engine.run({
      userPrompt: 'Create a Python car game',
      mode: 'agent',
      conversationHistory: [],
      settings: { maxAutonomousTurns: 6, temperature: 0.2, autoApplyDiffs: true },
    });

    // NO file was written, so the run is FAILED — never COMPLETE.
    expect(result.verifiedFiles.length).toBe(0);
    const completion = result.phases.find((p) => p.id === 'completion');
    expect(completion?.status).toBe('failed');
    expect(result.finalText).toContain('Task FAILED');
    // The persistent task record tells the same truth.
    const rec = tasks.listTasks()[0];
    expect(rec.status).toBe('failed');
    expect(rec.filesCreated).toHaveLength(0);
    expect(rec.errors.length).toBeGreaterThan(0);
  });
});
