/** Live Ollama interrupted-task resume benchmark. It never touches the user workspace. */
import fs from 'node:fs';
import path from 'node:path';
import { OllamaQwenProvider } from '../../src/server/qwen.js';
import { AgentEngine } from '../../src/server/agentEngine.js';
import { WorkspaceManager } from '../../src/server/workspace.js';
import { TerminalService } from '../../src/server/terminal.js';
import { GitService } from '../../src/server/git.js';
import { CodebaseIndexer } from '../../src/server/indexer.js';
import { SettingsStore } from '../../src/server/settings.js';
import { ToolRegistry } from '../../src/server/toolRegistry.js';
import { WorkspaceVerifier } from '../../src/server/verifier.js';
import { TaskStateStore } from '../../src/server/taskState.js';

const model = process.env.OLLAMA_MODEL || 'qwen2.5-coder:3b';
const timeoutMs = Number(process.env.QUILLIX_RESUME_BENCHMARK_TIMEOUT_MS || 240000);
const root = fs.mkdtempSync(path.resolve('.quillix-smoke', 'resume-benchmark-'));
fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ private: true, scripts: { test: 'node acceptance.cjs' } }));
fs.writeFileSync(path.join(root, 'first.cjs'), 'exports.first = () => "old";\n');
fs.writeFileSync(path.join(root, 'second.cjs'), 'const { first } = require("./first.cjs");\nexports.second = () => `${first()} second`;\n');
fs.writeFileSync(path.join(root, 'acceptance.cjs'), 'const assert=require("node:assert/strict"); const {first}=require("./first.cjs"); const {second}=require("./second.cjs"); assert.equal(first(),"ready"); assert.equal(second(),"ready second"); console.log("PASS: resumed two-file project");\n');

const build = (tasks: TaskStateStore, provider: OllamaQwenProvider) => {
  const workspace = new WorkspaceManager(root);
  const terminal = new TerminalService();
  const git = new GitService(terminal);
  const indexer = new CodebaseIndexer(workspace, git);
  const settings = new SettingsStore(path.join(root, '.quillix', 'settings.json'));
  settings.update({ offlineMode: true, autoApplyDiffs: true, terminalApproval: true });
  return new AgentEngine(provider, new ToolRegistry(workspace, terminal, git, indexer, settings), indexer, new WorkspaceVerifier(workspace, terminal), undefined, undefined, tasks);
};

const controller = new AbortController();
const provider = new OllamaQwenProvider({ model, offlineMode: true });
await provider.warmUp();
const firstStore = new TaskStateStore(root);
const firstEngine = build(firstStore, provider);
let interrupted = false;
const started = Date.now();
const first = await firstEngine.run({
  userPrompt: 'Repair this existing two-file CommonJS project. Update first.cjs so first() returns "ready", preserve exports, ensure second.cjs continues to use first() and returns "ready second", then run node acceptance.cjs. Edit real files only.',
  mode: 'agent', provider: 'ollama', model, conversationHistory: [],
  verificationCommands: ['node acceptance.cjs'],
  settings: { maxAutonomousTurns: 8, temperature: 0.15, autoApplyDiffs: true },
  signal: controller.signal,
  requestApproval: async request => request.command === 'node acceptance.cjs',
  onActivity: activity => {
    console.log(`[initial ${Math.round((Date.now() - started) / 1000)}s] ${activity.message}`);
    if (!interrupted && /Applied changes to /.test(activity.message)) {
      interrupted = true;
      controller.abort();
    }
  },
});
if (!first.taskId || !interrupted) throw new Error(`Initial run did not produce an interrupted checkpoint (task=${first.taskId || 'none'}, interrupted=${interrupted})`);

await provider.releaseModel(model);
const resumedStore = new TaskStateStore(root);
const resumedEngine = build(resumedStore, provider);
const resumed = await resumedEngine.run({
  userPrompt: 'Resume the interrupted project from its verified checkpoint. first.cjs is already verified on disk; do not edit or rewrite it. Inspect only the remaining project state, run node acceptance.cjs, and repair a real failing source only if the acceptance output proves one is still needed.',
  mode: 'agent', provider: 'ollama', model, resumeTaskId: first.taskId,
  conversationHistory: [], verificationCommands: ['node acceptance.cjs'],
  settings: { maxAutonomousTurns: 8, temperature: 0.1, autoApplyDiffs: true },
  signal: AbortSignal.timeout(timeoutMs),
  requestApproval: async request => request.command === 'node acceptance.cjs',
  onActivity: activity => console.log(`[resume ${Math.round((Date.now() - started) / 1000)}s] ${activity.message}`),
});

const acceptance = await import('node:child_process').then(({ execFileSync }) => execFileSync(process.execPath, ['acceptance.cjs'], { cwd: root, encoding: 'utf8' }));
const resumedRecord = resumedStore.getTask(resumed.taskId || '');
const report = {
  protocol: 'quillix-interrupted-resume-v1', model, root, initialTaskId: first.taskId, resumedTaskId: resumed.taskId,
  initialCancelled: first.cancelled, resumedFromTaskId: resumedRecord?.resumedFromTaskId,
  verified: resumed.verified && !resumed.cancelled && String(acceptance).includes('PASS: resumed two-file project'),
  initialFiles: first.verifiedFiles, resumedFiles: resumed.verifiedFiles, durationMs: Date.now() - started,
};
fs.writeFileSync(path.join(root, 'resume-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
if (!report.verified) process.exitCode = 1;
