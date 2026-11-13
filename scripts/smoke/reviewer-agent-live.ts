import fs from 'node:fs';
import path from 'node:path';
import { AgentEngine } from '../../src/server/agentEngine.js';
import { OllamaQwenProvider } from '../../src/server/qwen.js';
import { WorkspaceManager } from '../../src/server/workspace.js';
import { TerminalService } from '../../src/server/terminal.js';
import { GitService } from '../../src/server/git.js';
import { CodebaseIndexer } from '../../src/server/indexer.js';
import { ToolRegistry } from '../../src/server/toolRegistry.js';
import { SettingsStore } from '../../src/server/settings.js';
import { WorkspaceVerifier } from '../../src/server/verifier.js';

const model = process.env.OLLAMA_MODEL || 'qwen2.5-coder:1.5b';
const provider = new OllamaQwenProvider({ model, offlineMode: true });
const status = await provider.getStatus();
if (!status.connected || !status.modelAvailable) throw new Error(`Ollama/model unavailable: ${status.details}`);

const outputRoot = path.resolve('.quillix-smoke');
fs.mkdirSync(outputRoot, { recursive: true });
const workspaceRoot = fs.mkdtempSync(path.join(outputRoot, 'review-agent-live-'));
const ws = new WorkspaceManager(workspaceRoot);
const terminal = new TerminalService();
const git = new GitService(terminal);
const indexer = new CodebaseIndexer(ws, git);
const settings = new SettingsStore(path.join(workspaceRoot, '.quillix', 'settings.json'));
settings.update({ aiProvider: 'ollama', model, offlineMode: true, temperature: 0, autoApplyDiffs: true, terminalApproval: false });
const verifier = new WorkspaceVerifier(ws, terminal);
const engine = new AgentEngine(provider, new ToolRegistry(ws, terminal, git, indexer, settings), indexer, verifier);
const reviewerEvents: string[] = [];
const started = Date.now();

let result: Awaited<ReturnType<AgentEngine['run']>> | undefined;
let runError: string | undefined;
try { result = await engine.run({
  userPrompt: 'Create a small, real Node.js arithmetic utility project with package.json, src.js exporting add and subtract, and src.test.js using node:test. Include an npm test script and run it. Keep all files concise.',
  mode: 'agent',
  model,
  provider: 'ollama',
  conversationHistory: [],
  settings: { maxAutonomousTurns: 8, temperature: 0, autoApplyDiffs: true },
  signal: AbortSignal.timeout(240_000),
  onActivity(activity) {
    console.log(`[${Math.round((Date.now() - started) / 1000)}s] ${activity.message}`);
    if (/Independent Reviewer|Reviewer findings/i.test(activity.message)) reviewerEvents.push(activity.message);
  },
}); } catch (error) {
  runError = String((error as Error)?.message || error);
}

const report = {
  model,
  workspaceRoot,
  durationMs: Date.now() - started,
  status: runError ? (/resource guard/i.test(runError) ? 'PAUSED_RESOURCE_GUARD' : 'FAILED') : 'COMPLETED',
  error: runError,
  reviewerInvoked: reviewerEvents.some(message => /Independent Reviewer is checking/.test(message)),
  reviewerEvents,
  modelCalls: result?.observability?.modelCalls || 0,
  actualTokenCount: result?.observability?.actualTotalTokens,
  tokenCountSource: result?.observability?.tokenCountSource,
  files: result?.verifiedFiles || [],
  verified: result?.verified || false,
  phaseStates: result?.phases.map(phase => ({ id: phase.id, status: phase.status })) || [],
  finalText: result?.finalText,
  taskId: result?.taskId,
};
const reportPath = path.join(workspaceRoot, 'review-agent-live-report.json');
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, reportPath }, null, 2));
if (!report.reviewerInvoked || !result?.verified || result.cancelled || runError) process.exitCode = /resource guard/i.test(runError || '') ? 75 : 1;

