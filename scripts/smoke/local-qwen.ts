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
import { ResourceGuard } from '../../src/server/resourceGuard.js';

// Real-model acceptance check. Each run owns a fresh workspace, never the
// user's saved settings, selected provider, or existing project files.
async function main() {
  const ai = new OllamaQwenProvider({ model: process.env.OLLAMA_MODEL || 'qwen2.5-coder:3b' });
  const status = await ai.getStatus();
  if (!status.connected || !status.modelAvailable) throw new Error(status.details);
  const parent = path.resolve('test');
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'qwen-acceptance-'));
  const preflightGuard = new ResourceGuard();
  const preflight = await preflightGuard.waitUntilSafe(root, {
    maxWaitMs: 0,
  });
  if (!preflight.allowed) {
    const report = {
      status: 'PAUSED_RESOURCE_GUARD',
      model: status.model,
      workspace: root,
      reason: preflight.reason || 'system resources are constrained',
      resourceSnapshot: preflight.snapshot,
      recordedAt: new Date().toISOString(),
      resume: 'Re-run after resources recover; no model was warmed and no live task was started.',
    };
    fs.writeFileSync(path.join(root, 'acceptance-report.json'), JSON.stringify(report, null, 2));
    console.error(`Live Qwen acceptance paused before model warm-up. Checkpoint: ${path.join(root, 'acceptance-report.json')}\nReason: ${report.reason}`);
    process.exitCode = 75;
    return;
  }
  await ai.warmUp(status.model);
  const ws = new WorkspaceManager(root);
  const terminal = new TerminalService();
  const git = new GitService(terminal);
  const indexer = new CodebaseIndexer(ws, git);
  const settings = new SettingsStore(path.join(root, '.quillix', 'smoke-settings.json'));
  const saved = settings.update({ aiProvider: 'ollama', model: status.model, temperature: 0, autoApplyDiffs: true });
  if (!saved.success) throw new Error(saved.error);
  const verifier = new WorkspaceVerifier(ws, terminal);
  const engine = new AgentEngine(ai, new ToolRegistry(ws, terminal, git, indexer, settings), indexer, verifier);
  console.log(`Model: ${status.model}\nWorkspace: ${root}`);
  const prompt = 'Build a complete tiny website with index.html, style.css and script.js. HTML must link both files. Include a main heading, a paragraph id="message", and a button id="updateButton". The button changes the paragraph text when clicked. Use matching IDs, plain JavaScript without script tags in script.js, and real CSS styling. Keep each file short. Write all files with tools.';
  const result = await engine.run({
    userPrompt: prompt, mode: 'agent', conversationHistory: [], model: status.model,
    settings: { maxAutonomousTurns: 10, temperature: 0, autoApplyDiffs: true },
    signal: AbortSignal.timeout(8 * 60_000),
    onActivity: activity => console.log(`[${activity.type}] ${activity.message}`),
  });
  const checks = await verifier.verifyFiles(result.verifiedFiles, prompt);
  const complete = result.phases.find(p => p.id === 'completion')?.status === 'completed';
  const report = { model: status.model, workspace: root, complete, checks, result };
  fs.writeFileSync(path.join(root, 'acceptance-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ complete, allChecksPassed: checks.allOk, files: result.verifiedFiles, failures: checks.failures }, null, 2));
  if (!complete || !checks.allOk) process.exitCode = 1;
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
