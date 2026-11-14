import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {AgentEngine} from '../../src/server/agentEngine.js';
import {OllamaQwenProvider, type AIProvider} from '../../src/server/qwen.js';
import {WorkspaceManager} from '../../src/server/workspace.js';
import {TerminalService} from '../../src/server/terminal.js';
import {GitService} from '../../src/server/git.js';
import {CodebaseIndexer} from '../../src/server/indexer.js';
import {SettingsStore} from '../../src/server/settings.js';
import {ToolRegistry} from '../../src/server/toolRegistry.js';
import {WorkspaceVerifier} from '../../src/server/verifier.js';
import {TaskStateStore} from '../../src/server/taskState.js';
import {ProjectMemory} from '../../src/server/projectMemory.js';
import {ResourceGuard} from '../../src/server/resourceGuard.js';
import {selectedProviderConfig} from '../../src/server/providerProfiles.js';
import {readUniversalKeys, type UniversalKeyContext, UniversalProvider} from '../../src/server/universal.js';

const [manifestFile, checkout, outputDirectory, checkCommand] = process.argv.slice(2);
if (!manifestFile || !checkout || !outputDirectory) {
  throw new Error('Usage: tsx scripts/smoke/run-swebench-task.ts <manifest.json> <checkout> <output-directory> [native-check-command]');
}
const task = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
if (!/^[\w.-]+__[\w.-]+-\d+$/.test(task.instance_id) || !/^[a-f0-9]{40}$/.test(task.base_commit) ||
    typeof task.problem_statement !== 'string' || !task.problem_statement.trim()) throw new Error('Invalid public task manifest');
const root = fs.realpathSync(checkout);
const output = path.resolve(outputDirectory);
const git = (args: string[], env = process.env) => execFileSync('git', args, {cwd: root, env, encoding: 'utf8', windowsHide: true});
if (fs.realpathSync(git(['rev-parse', '--show-toplevel']).trim()) !== root) throw new Error('Checkout must be a Git repository root');
if (git(['rev-parse', 'HEAD']).trim() !== task.base_commit) throw new Error('Checkout does not match the task base commit');
if (git(['status', '--porcelain']).trim()) throw new Error('Use a clean isolated checkout for each public benchmark attempt');
if (!path.relative(root, output).startsWith('..')) throw new Error('Keep evaluation output outside the agent checkout');
fs.mkdirSync(output, {recursive: true});
for (const completedArtifact of ['prediction.jsonl', 'result.json']) {
  if (fs.existsSync(path.join(output, completedArtifact))) {
    throw new Error(`Evaluation output already contains ${completedArtifact}; use a fresh directory for a new attempt.`);
  }
}
const existingPausePath = path.join(output, 'preflight-paused.json');
if (fs.existsSync(existingPausePath)) {
  const previous = JSON.parse(fs.readFileSync(existingPausePath, 'utf8'));
  if (previous.status !== 'PAUSED_RESOURCE_GUARD' || previous.instanceId !== task.instance_id ||
      previous.baseCommit !== task.base_commit || previous.repo !== task.repo) {
    throw new Error('Evaluation output has a resource-pause record for a different public task; use a fresh directory.');
  }
}
const requestedBenchmarkProvider = process.env.QUILLIX_BENCHMARK_PROVIDER || 'ollama';
if (!['ollama', 'universal'].includes(requestedBenchmarkProvider)) throw new Error('QUILLIX_BENCHMARK_PROVIDER must be ollama or universal.');
const benchmarkProvider = requestedBenchmarkProvider as 'ollama' | 'universal';
let model = process.env.OLLAMA_MODEL || 'qwen2.5-coder:3b';
process.env.QUILLIX_PUBLIC_BENCHMARK = '1';
// Public long-horizon runs must reach the installed fallback model instead of
// spending the entire task budget on one cold local model turn. Local models
// can legitimately stay silent while loading a large repository context; the
// 240s ceiling is still bounded, while avoiding a false early failure before
// the first native tool call is emitted.
if (!process.env.QUILLIX_BENCHMARK_FIRST_TURN_TIMEOUT_SECONDS) process.env.QUILLIX_BENCHMARK_FIRST_TURN_TIMEOUT_SECONDS = '240';
const timeout = Number(process.env.QUILLIX_BENCHMARK_TIMEOUT_MS || 300000);
if (!Number.isFinite(timeout) || timeout < 1000 || timeout > 600000) throw new Error('Task timeout must be 1000–600000ms');
// Preserve benchmark evidence when the user or the resource guard interrupts
// a long local run. A raw SIGINT used to terminate this harness before it
// could write prediction.jsonl/result.json, which made a recoverable stop look
// like a missing run. The agent still receives an AbortSignal and no user
// processes are touched.
let externallyInterrupted = false;
const stopController = new AbortController();
const onExternalStop = () => {
  externallyInterrupted = true;
  stopController.abort();
  console.log('External stop received; preserving the verified checkpoint and benchmark report.');
};
process.once('SIGINT', onExternalStop);
process.once('SIGTERM', onExternalStop);
const boundedSignal = (durationMs: number) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), durationMs);
  const relay = () => controller.abort();
  stopController.signal.addEventListener('abort', relay, {once: true});
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      stopController.signal.removeEventListener('abort', relay);
    },
  };
};
let ai: AIProvider;
let universalBenchmarkConfig: ReturnType<typeof selectedProviderConfig> | undefined;
if (benchmarkProvider === 'universal') {
  const userSettings = new SettingsStore().get();
  universalBenchmarkConfig = selectedProviderConfig(userSettings);
  if (userSettings.offlineMode || universalBenchmarkConfig.offlineMode) throw new Error('Universal benchmark mode requires NUVRO AI Online Mode.');
  if (!/^https:\/\//i.test(universalBenchmarkConfig.endpoint)) throw new Error('Universal benchmark mode requires a trusted HTTPS endpoint.');
  model = process.env.QUILLIX_BENCHMARK_MODEL?.trim() || universalBenchmarkConfig.model;
  if (!model) throw new Error('Universal benchmark mode requires a configured model ID.');
  const keyContext: UniversalKeyContext = {protocol: universalBenchmarkConfig.protocol, endpoint: universalBenchmarkConfig.endpoint};
  const keys = readUniversalKeys(keyContext);
  if (!keys.length) throw new Error('No saved API key is configured for the active Universal API endpoint.');
  ai = new UniversalProvider(
    () => ({...universalBenchmarkConfig!, model, offlineMode: false, capabilities: {tools: true, streaming: true, reasoning: false}}),
    () => keys,
  );
} else {
  ai = new OllamaQwenProvider({model, offlineMode: true});
}
const resourceGuard = new ResourceGuard();
const initialGate = await resourceGuard.waitUntilSafe(root, {
  maxWaitMs: 0,
});
if (!initialGate.allowed) {
  const preflight = {
    status: 'PAUSED_RESOURCE_GUARD',
    instanceId: task.instance_id,
    repo: task.repo,
    baseCommit: task.base_commit,
    model,
    reason: initialGate.reason || 'system resources are constrained',
    resourceSnapshot: initialGate.snapshot,
    recordedAt: new Date().toISOString(),
    resume: 'Re-run this exact manifest and checkout after resources recover; no model was loaded and no prediction was created.',
  };
  fs.writeFileSync(path.join(output, 'preflight-paused.json'), JSON.stringify(preflight, null, 2) + '\n');
    console.error(`Public benchmark paused before provider startup; no request was sent. Checkpoint: ${path.join(output, 'preflight-paused.json')}`);
  process.exitCode = 75;
  process.exit();
}
if (benchmarkProvider === 'ollama') await (ai as OllamaQwenProvider).warmUp();
const nativeCheck = checkCommand || (typeof task.native_check_command === 'string' ? task.native_check_command : '');
const verificationBrief = nativeCheck
  ? 'A required acceptance command is configured by the harness. Do not read, modify, or recreate the harness script. After the first focused edit, run the configured acceptance command immediately, use its real output to repair the source, and rerun it before reporting completion.'
  : 'Run the configured project checks after the focused edit before reporting completion.';
const workspace = new WorkspaceManager(root);
const terminal = new TerminalService();
const gitService = new GitService(terminal);
const indexer = new CodebaseIndexer(workspace, gitService);
const settings = new SettingsStore(path.join(root, '.quillix/settings.json'));
settings.update({offlineMode: benchmarkProvider === 'ollama', autoApplyDiffs: true, terminalApproval: true});
const engine = new AgentEngine(ai, new ToolRegistry(workspace, terminal, gitService, indexer, settings), indexer,
  new WorkspaceVerifier(workspace, terminal), new ProjectMemory(root), undefined, new TaskStateStore(root));
const started = Date.now();
let result: Awaited<ReturnType<AgentEngine['run']>> | undefined;
let error: string | undefined;
try {
  const firstRun = boundedSignal(timeout);
  try {
    result = await engine.run({
      userPrompt: 'Fix the existing repository issue below. Inspect relevant code, implement the correction in this checkout, and preserve existing APIs and unrelated behavior. ' + verificationBrief + '\n\n' + task.problem_statement,
      mode: 'agent', provider: benchmarkProvider, model, conversationHistory: [],
      settings: {maxAutonomousTurns: 12, temperature: 0.15, autoApplyDiffs: true},
      verificationCommands: nativeCheck ? [nativeCheck] : [], signal: firstRun.signal,
      requestApproval: async request => request.command === nativeCheck || /^node --check [\w./-]+$/.test(request.command || ''),
      onActivity: activity => console.log(`[${Math.round((Date.now() - started) / 1000)}s] ${activity.message}`),
    });
  } finally {
    firstRun.cleanup();
  }
  // A long repository task can spend its first budget on inspection or a
  // failed patch. Continue from the persisted task journal instead of
  // replaying the full problem as a fresh request. The second run gets its
  // own bounded budget and only runs after an honest timeout/cancellation.
  if (benchmarkProvider === 'ollama' && result.cancelled && result.taskId && !externallyInterrupted && process.env.QUILLIX_DISABLE_BENCHMARK_RESUME !== '1') {
    const localAi = ai as OllamaQwenProvider;
    const resumeTimeout = Number(process.env.QUILLIX_BENCHMARK_RESUME_TIMEOUT_MS || Math.min(timeout, 300000));
    if (!Number.isFinite(resumeTimeout) || resumeTimeout < 1000 || resumeTimeout > 600000) throw new Error('Resume timeout must be 1000–600000ms');
    // A cancelled run may have been interrupted while a larger local model
    // was resident. Prefer an explicitly configured resume brain, otherwise
    // use the installed 1.5b coder only when the initial brain was the 3b
    // coder. This keeps resume resource-aware without changing normal runs or
    // guessing a model that Ollama does not report as installed.
    const requestedResumeModel = process.env.QUILLIX_BENCHMARK_RESUME_MODEL?.trim();
    const preferredResumeModel = requestedResumeModel || (/^qwen2\.5-coder:3b$/i.test(model) ? 'qwen2.5-coder:1.5b' : model);
    const resumeStatus = await localAi.getStatus(preferredResumeModel);
    const resumeModel = resumeStatus.modelAvailable ? preferredResumeModel : model;
    if (resumeModel !== model) {
      await localAi.releaseModel(model);
      const resumeGate = await resourceGuard.waitUntilSafe(root, {
        maxWaitMs: 0,
      });
      if (!resumeGate.allowed) throw new Error(`Public benchmark resume paused before model warm-up: ${resumeGate.reason || 'system resources are constrained'}`);
      localAi.configure({model: resumeModel});
      await localAi.warmUp(resumeModel, {timeoutSeconds: 90, retries: 0});
      console.log(`[${Math.round((Date.now() - started) / 1000)}s] Resume model downgraded to installed ${resumeModel} for resource safety`);
    }
    console.log(`[${Math.round((Date.now() - started) / 1000)}s] Resuming persisted task ${result.taskId} from its verified checkpoint`);
    const resumeRun = boundedSignal(resumeTimeout);
    try {
      result = await engine.run({
        // Keep the original issue terms in the resume query. RAG retrieval is
        // intentionally prompt-driven; a generic "resume" string otherwise
        // selects an unrelated file on the second run and loses the repair
        // target even though the checkpoint itself is valid.
        userPrompt: 'Resume the interrupted repository repair from the saved checkpoint. Inspect only the recorded failing source and continue the pending correction. ' + verificationBrief + '\n\nOriginal issue terms for retrieval:\n' + task.problem_statement,
        mode: 'agent', provider: benchmarkProvider, model: resumeModel, resumeTaskId: result.taskId,
        conversationHistory: [], settings: {maxAutonomousTurns: 8, temperature: 0.1, autoApplyDiffs: true},
        verificationCommands: nativeCheck ? [nativeCheck] : [],
        requestApproval: async request => request.command === nativeCheck || /^node --check [\w./-]+$/.test(request.command || ''),
        signal: resumeRun.signal,
        onActivity: activity => console.log(`[resume ${Math.round((Date.now() - started) / 1000)}s] ${activity.message}`),
      });
    } finally {
      resumeRun.cleanup();
    }
  }
} catch (cause: any) {
  error = String(cause?.message || cause);
} finally {
  process.removeListener('SIGINT', onExternalStop);
  process.removeListener('SIGTERM', onExternalStop);
}
// A separate temporary Git index includes newly created source files without
// changing the real staging area. Exclude NUVRO AI's task logs and caches.
const temporaryIndex = path.join(output, `index-${randomUUID()}`);
let patch: string;
try {
  const env = {...process.env, GIT_INDEX_FILE: temporaryIndex};
  git(['read-tree', 'HEAD'], env);
  git(['add', '-A', '--', '.', ':(top,exclude).quillix'], env);
  patch = git(['diff', '--cached', '--binary', 'HEAD'], env);
} finally { fs.rmSync(temporaryIndex, {force: true}); }
const prediction = {instance_id: task.instance_id, model_name_or_path: 'quillix/' + model, model_patch: patch};
fs.writeFileSync(path.join(output, 'prediction.jsonl'), JSON.stringify(prediction) + '\n', {flag: 'wx'});
const report = {instanceId: task.instance_id, repo: task.repo, baseCommit: task.base_commit,
  source: task.source, provider: benchmarkProvider, model, durationMs: Date.now() - started, officialGrade: 'NOT_GRADED',
  nativeCheckConfigured: !!nativeCheck, cancelled: result?.cancelled, verified: result?.verified ?? false,
  files: result?.verifiedFiles || [], observability: result?.observability, phases: result?.phases,
  finalText: result?.finalText, error, patchBytes: Buffer.byteLength(patch)};
fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(report, null, 2) + '\n', {flag: 'wx'});
console.log(JSON.stringify({instanceId: task.instance_id, verified: report.verified, officialGrade: report.officialGrade, patchBytes: report.patchBytes, output}));
if (externallyInterrupted) process.exitCode = 130;
else if (!report.verified || !patch.trim()) process.exitCode = 1;
