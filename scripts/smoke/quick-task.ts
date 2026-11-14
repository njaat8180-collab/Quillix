import fs from 'node:fs';
import path from 'node:path';
import { OllamaQwenProvider, type AIProvider } from '../../src/server/qwen.js';
import { AgentEngine } from '../../src/server/agentEngine.js';
import { WorkspaceManager } from '../../src/server/workspace.js';
import { TerminalService } from '../../src/server/terminal.js';
import { GitService } from '../../src/server/git.js';
import { CodebaseIndexer } from '../../src/server/indexer.js';
import { SettingsStore } from '../../src/server/settings.js';
import { ToolRegistry } from '../../src/server/toolRegistry.js';
import { WorkspaceVerifier } from '../../src/server/verifier.js';

const label = process.argv[2] || 'after';
if (!/^[a-z-]+$/.test(label)) throw new Error('Use a short lowercase benchmark label.');
const parent = path.resolve('.quillix-smoke'); fs.mkdirSync(parent, { recursive: true });
const root = fs.mkdtempSync(path.join(parent, `quick-${label}-`));
const model = process.env.OLLAMA_MODEL || 'qwen2.5-coder:3b';
const local = new OllamaQwenProvider({ model, offlineMode: true });
const calls: Array<{ inputChars: number; durationMs?: number; firstTokenMs?: number }> = [];
const ai: AIProvider = {
  generateText: (...args) => local.generateText(...args),
  generateStream: (...args) => local.generateStream(...args),
  chatWithTools: (...args) => local.chatWithTools(...args),
  async chatWithToolsStream(messages, tools, options, onToken) {
    const started = performance.now();
    const record: typeof calls[number] = { inputChars: JSON.stringify({ messages, tools, system: options.systemInstruction }).length };
    calls.push(record);
    try { return await local.chatWithToolsStream(messages, tools, options, token => {
      record.firstTokenMs ??= Math.round(performance.now() - started); onToken(token);
    }); } finally { record.durationMs = Math.round(performance.now() - started); }
  },
};
const workspace = new WorkspaceManager(root), terminal = new TerminalService(), git = new GitService(terminal);
const indexer = new CodebaseIndexer(workspace, git), verifier = new WorkspaceVerifier(workspace, terminal);
const settings = new SettingsStore(path.join(root, '.quillix/settings.json'));
settings.update({ offlineMode: true, autoApplyDiffs: true, temperature: 0.15 });
const engine = new AgentEngine(ai, new ToolRegistry(workspace, terminal, git, indexer, settings), indexer, verifier);
const prompt = process.env.QUILLIX_QUICK_PROMPT || 'Create index.html page with Hello World but add high CSS and animation. Keep it self-contained, accessible, responsive and concise. No external libraries.';
console.log(`Benchmark ${label}: ${model}\nWorkspace: ${root}`);
const started = performance.now();
try {
  const result = await engine.run({ userPrompt: prompt, mode: 'agent', model, conversationHistory: [], settings: { maxAutonomousTurns: 4, temperature: 0.15, autoApplyDiffs: true }, signal: AbortSignal.timeout(180000), onActivity: activity => console.log(`[${Math.round((performance.now() - started) / 1000)}s] ${activity.message}`) });
  const checks = await verifier.verifyFiles(result.verifiedFiles, prompt);
  const report = { label, model, durationMs: Math.round(performance.now() - started), modelCalls: calls.length, calls, observability: result.observability, estimatedTotalTokens: result.observability?.estimatedTotalTokens || 0, completed: !result.cancelled && result.phases.at(-1)?.status === 'completed' && !result.phases.some(p => p.status === 'failed'), checksPassed: result.verifiedFiles.length > 0 && checks.verified.length > 0 && checks.allOk, files: result.verifiedFiles, phases: result.phases, finalText: result.finalText };
  fs.writeFileSync(path.join(root, 'benchmark.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (!report.completed || !report.checksPassed) process.exitCode = 1;
} catch (error: any) {
  const report = { label, model, durationMs: Math.round(performance.now() - started), modelCalls: calls.length, calls, error: error.message };
  fs.writeFileSync(path.join(root, 'benchmark.json'), JSON.stringify(report, null, 2));
  console.error(JSON.stringify(report, null, 2)); process.exitCode = 1;
}
