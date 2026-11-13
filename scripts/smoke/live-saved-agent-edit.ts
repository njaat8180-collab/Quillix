import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AgentEngine } from '../../src/server/agentEngine.js';
import { CodebaseIndexer } from '../../src/server/indexer.js';
import { GitService } from '../../src/server/git.js';
import { SettingsStore } from '../../src/server/settings.js';
import { ToolRegistry } from '../../src/server/toolRegistry.js';
import { TerminalService } from '../../src/server/terminal.js';
import { WorkspaceManager } from '../../src/server/workspace.js';
import { WorkspaceVerifier } from '../../src/server/verifier.js';
import { ProjectMemory } from '../../src/server/projectMemory.js';
import { selectedProviderConfig } from '../../src/server/providerProfiles.js';
import { readUniversalKeys, type UniversalKeyContext, UniversalProvider } from '../../src/server/universal.js';
import { redactSensitiveText } from '../../src/shared/secretRedaction.js';

const settings = new SettingsStore().get();
const config = selectedProviderConfig(settings);
if (settings.offlineMode || config.offlineMode) throw new Error('Live agent edit requires Online Mode.');
if (!/^https:\/\//i.test(config.endpoint)) throw new Error('Live agent edit requires a trusted HTTPS endpoint.');
const keyContext: UniversalKeyContext = { protocol: config.protocol, endpoint: config.endpoint };
const keys = readUniversalKeys(keyContext);
if (!keys.length) throw new Error('No saved key is configured for the active Universal API endpoint.');

const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
const runRoot = path.join(process.cwd(), '.quillix-smoke', 'live-saved-agent-edit', runId);
const workspaceRoot = path.join(runRoot, 'workspace');
fs.mkdirSync(workspaceRoot, { recursive: true });
fs.writeFileSync(path.join(workspaceRoot, 'index.html'), '<!doctype html>\n<html><head><link rel="stylesheet" href="style.css"></head><body><main class="hero"><h1>Northstar</h1><p>Explore the collection.</p></main></body></html>\n');
const initialCss = '.hero { width: 960px; margin: 80px auto; padding: 64px; background: #eef2ff; }\n';
fs.writeFileSync(path.join(workspaceRoot, 'style.css'), initialCss);

const workspace = new WorkspaceManager(workspaceRoot);
const terminal = new TerminalService();
const git = new GitService(terminal);
const indexer = new CodebaseIndexer(workspace, git);
const taskSettings = new SettingsStore(path.join(workspaceRoot, '.quillix', 'settings.json'));
taskSettings.update({ autoApplyDiffs: true, terminalApproval: false, maxAutonomousTurns: 8 });
const tools = new ToolRegistry(workspace, terminal, git, indexer, taskSettings);
const memory = new ProjectMemory(workspaceRoot);
memory.setActive('Northstar', workspaceRoot);
const provider = new UniversalProvider(
  () => ({ ...config, capabilities: { tools: true, streaming: true, reasoning: false } }),
  () => keys,
);
const engine = new AgentEngine(provider, tools, indexer, new WorkspaceVerifier(workspace, terminal), memory);
const startedAt = Date.now();
const locale = process.env.QUILLIX_LIVE_AGENT_LOCALE === 'hi' ? 'hi' : 'en';
const firstPrompt = locale === 'hi'
  ? 'इस पेज को मोबाइल पर responsive बनाओ। Desktop design बनाए रखो और खुले हुए stylesheet को update करो।'
  : 'Make this page responsive on mobile. Preserve the desktop design and update the open stylesheet.';
const initialHistory = [
  { id: 'prior-user', role: 'user' as const, content: 'Create a Northstar landing page with a hero section.', timestamp: 1 },
  { id: 'prior-assistant', role: 'assistant' as const, content: 'The page is built. Its styles are in style.css.', timestamp: 2 },
];
const first = await engine.run({
  userPrompt: firstPrompt,
  mode: 'agent',
  currentFile: 'style.css',
  conversationHistory: initialHistory,
  provider: 'universal',
  model: config.model,
});
const firstHandoff = first.verified === true && (first.verifiedFiles || []).includes('style.css')
  ? 'Verified outcome: style.css now adapts the Northstar hero for mobile and preserves the desktop design.'
  : first.finalText.slice(0, 500);
const secondPrompt = locale === 'hi'
  ? 'इस पेज में सचमुच का <button type="button">Sign In</button> जोड़ो, link नहीं।'
  : 'Add a real <button type="button">Sign In</button> element to this page, not a link.';
const second = await engine.run({
  userPrompt: secondPrompt,
  mode: 'agent',
  currentFile: 'index.html',
  conversationHistory: [
    ...initialHistory,
    { id: 'first-followup', role: 'user', content: firstPrompt, timestamp: 3 },
    { id: 'first-result', role: 'assistant', content: firstHandoff, timestamp: 4 },
  ],
  provider: 'universal',
  model: config.model,
});
const secondHandoff = second.verified === true && (second.verifiedFiles || []).includes('index.html')
  ? 'Verified outcome: index.html now has the sign-in button; style.css remains linked.'
  : second.finalText.slice(0, 500);
const thirdPrompt = locale === 'hi'
  ? 'मौजूदा sign-in button के लिए app.js में click handler बनाओ, उसे index.html में link करो और click पर is-active class toggle करो। style.css को बिल्कुल मत बदलो।'
  : 'Add an app.js click handler for the existing sign-in button, link it from index.html, and toggle is-active on click. Do not modify style.css.';
const cssBeforeThird = fs.readFileSync(path.join(workspaceRoot, 'style.css'), 'utf8');
const third = await engine.run({
  userPrompt: thirdPrompt,
  mode: 'agent',
  currentFile: 'index.html',
  conversationHistory: [
    ...initialHistory,
    { id: 'first-followup', role: 'user', content: firstPrompt, timestamp: 3 },
    { id: 'first-result', role: 'assistant', content: firstHandoff, timestamp: 4 },
    { id: 'second-followup', role: 'user', content: secondPrompt, timestamp: 5 },
    { id: 'second-result', role: 'assistant', content: secondHandoff, timestamp: 6 },
  ],
  provider: 'universal',
  model: config.model,
});

const finalCss = fs.readFileSync(path.join(workspaceRoot, 'style.css'), 'utf8');
const finalHtml = fs.readFileSync(path.join(workspaceRoot, 'index.html'), 'utf8');
const finalJs = fs.existsSync(path.join(workspaceRoot, 'app.js')) ? fs.readFileSync(path.join(workspaceRoot, 'app.js'), 'utf8') : '';
const cssFiles = first.verifiedFiles || [];
const htmlFiles = second.verifiedFiles || [];
const integrationFiles = third.verifiedFiles || [];
const responsiveEvidence = /@media|clamp\(|\bmin\(/i.test(finalCss);
const buttonEvidence = /<button\b[^>]*>[\s\S]*?(?:sign|log)[ -]?in[\s\S]*?<\/button>/i.test(finalHtml);
const scriptLinkEvidence = /<script\b[^>]*src=["'](?:\.\/)?app\.js["']/i.test(finalHtml);
const clickHandlerEvidence = /addEventListener\s*\(\s*["']click["'][\s\S]*classList\.toggle\s*\(\s*["']is-active["']/i.test(finalJs);
const cssUnchanged = finalCss === cssBeforeThird;
const verified = first.verified === true && cssFiles.includes('style.css') && responsiveEvidence &&
  second.verified === true && htmlFiles.includes('index.html') && buttonEvidence &&
  third.verified === true && integrationFiles.includes('index.html') && integrationFiles.includes('app.js') &&
  scriptLinkEvidence && clickHandlerEvidence && cssUnchanged && /href=["']style\.css["']/i.test(finalHtml);
const usage = provider.usage.reduce((total, item) => ({
  inputTokens: total.inputTokens + (item.inputTokens || 0),
  outputTokens: total.outputTokens + (item.outputTokens || 0),
}), { inputTokens: 0, outputTokens: 0 });
const taskMetrics = (result: typeof first) => {
  const metrics = result.observability;
  if (!metrics) return undefined;
  return {
    modelCalls: metrics.modelCalls,
    toolCalls: metrics.toolCalls,
    toolFailures: metrics.toolFailures,
    verificationRuns: metrics.verificationRuns,
    durationMs: metrics.durationMs,
    providerInputTokens: metrics.actualInputTokens,
    providerOutputTokens: metrics.actualOutputTokens,
    tokenCountSource: metrics.tokenCountSource,
    inputChars: metrics.inputChars,
    sentMessageChars: metrics.sentMessageChars,
    rawConversationChars: metrics.rawConversationChars,
    contextCharsPeak: metrics.contextCharsPeak,
    messageHistoryReductionPercent: metrics.messageHistoryReductionPercent,
  };
};
const taskTrace = (result: typeof first) => (result.toolResults || []).map(item => ({
  toolName: item.toolName,
  ...(typeof item.data?.filePath === 'string' ? { filePath: item.data.filePath } : {}),
  success: item.success,
  durationMs: item.durationMs,
  ...(item.error ? { error: redactSensitiveText(String(item.error)).slice(0, 240) } : {}),
}));
const report = {
  status: verified ? 'PASS' : 'FAIL',
  provider: 'universal',
  endpoint: new URL(config.endpoint).origin,
  model: config.model,
  locale,
  scenario: 'three sequential follow-ups with compact verified handoffs: selected CSS edit, HTML feature, then linked multi-file JavaScript behavior',
  turns: [
    { prompt: firstPrompt, verified: first.verified, verifiedFiles: cssFiles, responsiveEvidence, handoffChars: firstHandoff.length, metrics: taskMetrics(first) },
    { prompt: secondPrompt, verified: second.verified, verifiedFiles: htmlFiles, buttonEvidence, handoffChars: secondHandoff.length, metrics: taskMetrics(second), toolTrace: taskTrace(second) },
    { prompt: thirdPrompt, verified: third.verified, verifiedFiles: integrationFiles, scriptLinkEvidence, clickHandlerEvidence, cssUnchanged, metrics: taskMetrics(third), toolTrace: taskTrace(third) },
  ],
  cssLinkPreserved: /href=["']style\.css["']/i.test(finalHtml),
  cssUnchangedDuringIntegration: cssUnchanged,
  responsiveEvidence,
  modelCalls: provider.usage.length,
  usage,
  elapsedMs: Date.now() - startedAt,
  toolNames: [...new Set([...(first.toolResults || []), ...(second.toolResults || []), ...(third.toolResults || [])].map(item => item.toolName))],
  reportPath: path.join(runRoot, 'report.json'),
};
fs.writeFileSync(report.reportPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
if (!verified) process.exitCode = 1;
