import {selectedProviderConfig} from './src/server/providerProfiles.js';
import 'dotenv/config';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
// NOTE: vite is imported lazily (dev mode only) so the production server never
// loads the bundler — faster startup and a smaller runtime footprint.
import { WorkspaceManager } from './src/server/workspace.js';
import { TerminalService } from './src/server/terminal.js';
import { GitService } from './src/server/git.js';
import { TaskBranchStore, isTaskBranchName, taskBranchName } from './src/server/taskBranches.js';
import { CodebaseIndexer } from './src/server/indexer.js';
import { collectEditorProject } from './src/server/editorProject.js';
import { ToolRegistry } from './src/server/toolRegistry.js';
import { OllamaQwenProvider } from './src/server/qwen.js';
import { ProviderRouter, SarvamProvider, saveSarvamKey, clearSarvamKey, hasSarvamKey, saveSarvamFailoverKey, clearSarvamFailoverKeys, sarvamFailoverKeyCount } from './src/server/sarvam.js';
import { UniversalProvider, saveUniversalKey, clearUniversalKey, hasUniversalKey, migrateLegacyUniversalKey, saveUniversalKeyToPool, clearUniversalKeyPool, universalKeyPoolCount, readUniversalKeys } from './src/server/universal.js';
import { discoverProviderModels } from './src/server/providerModelCatalog.js';
import { safeProviderError } from './src/server/providerErrors.js';
import { selfHealHistory } from './src/server/selfHealingRuntime.js';
import { PreviewSessionService, validatePreviewEntry } from './src/server/previewSession.js';
import { inspectBrowserAssets, inspectBrowserScripts } from './src/server/browserChecks.js';
import {createOpenAIProvider, saveOpenAIKey, clearOpenAIKey, hasOpenAIKey, readOpenAIKeys, OPENAI_API_ENDPOINT, saveOpenAIFailoverKey, clearOpenAIFailoverKeys, openAIFailoverKeyCount} from './src/server/openai.js';
import {createGrokProvider, saveGrokKey, clearGrokKey, hasGrokKey, readGrokKeys, GROK_API_ENDPOINT, saveGrokFailoverKey, clearGrokFailoverKeys, grokFailoverKeyCount} from './src/server/grok.js';
import {createGroqProvider, saveGroqKey, clearGroqKey, hasGroqKey, readGroqKeys, GROQ_API_ENDPOINT, saveGroqFailoverKey, clearGroqFailoverKeys, groqFailoverKeyCount} from './src/server/groq.js';
import {createNvidiaProvider, saveNvidiaKey, clearNvidiaKey, hasNvidiaKey, saveNvidiaFailoverKey, clearNvidiaFailoverKeys, nvidiaFailoverKeyCount, discoverNimModels, nimFailoverSnapshot} from './src/server/nvidia.js';
import { AgentEngine } from './src/server/agentEngine.js';
import { DiagnosticsService } from './src/server/diagnostics.js';
import { SettingsStore } from './src/server/settings.js';
import { setOverdriveActive } from './src/shared/overdriveState.js';
import { ProjectRag } from './src/server/projectRag.js';
import { listPendingApprovals, resolveApprovalBatch } from './src/server/approvalBatch.js';
import { answerCodebaseQuestion } from './src/server/codebaseQa.js';
import { AutoTestRunner } from './src/server/autoTestRunner.js';
import { CheckpointStore } from './src/server/checkpoints.js';
import { WorkspaceVerifier } from './src/server/verifier.js';
import { routeConversationIntent } from './src/server/intentRouter.js';
import { approvedHtmlStageContinuation } from './src/server/projectContract.js';
import { ProjectMemory } from './src/server/projectMemory.js';
import { TaskStateStore } from './src/server/taskState.js';
import { LanguageRunnerRegistry, ProjectRunService } from './src/server/languageRunners.js';
import { QuillixSettings, FilePatch, AgentMode } from './src/shared/types.js';
import type { ToolDefinition } from './src/shared/types.js';
import { validateLocalApiRequest } from './src/server/localRequestSecurity.js';
import { normalizeVerificationCommands } from './src/shared/verificationCommands.js';
import { parseConversationMode } from './src/shared/conversationModeStorage.js';
import { parseMissionState, MISSION_STATE_PATH } from './src/shared/missionState.js';
import { rateLimitService, rateLimitScopeFor } from './src/server/rateLimitService.js';
import { PromptResultCache, promptResultCacheKey, chunkCachedResponse } from './src/shared/promptResultCache.js';
import { formatCitations, searchBudgetMessage } from './src/shared/webSearchPolicy.js';
import { RESEARCH_LIMITS, buildResearchEvidenceBlock, clampResearchQueries, researchSynthesisInstruction } from './src/shared/researchPlan.js';
import { buildSourceArchive } from './src/server/sourceArchive.js';
import { PREVIEW_CONTENT_SECURITY_POLICY, isPreviewAssetAllowed } from './src/server/previewSafety.js';
import { BUILTIN_CODING_PLUGINS } from './src/server/builtinPlugins.js';
import { SourceContextRetriever } from './src/server/sourceContext.js';
import { buildInlineCompletionPrompt, cleanInlineCompletion, trimCompletionContext } from './src/shared/inlineCompletion.js';
import { TavilyVerificationService, saveTavilyKey, clearTavilyKey, hasTavilyKey } from './src/server/tavilyVerification.js';

const universalKeyContext = selectedProviderConfig;

/** System prompt for Normal Chat mode — conversational, never tool-driven. */
const CHAT_SYSTEM_PROMPT = `You are NUVRO AI, an AI coding assistant using the user-selected provider. Do not claim a provider is connected without verification.

This is a normal conversation. Answer clearly, warmly and helpfully in the user's language.
Do NOT attempt any file, terminal, or project operations and do not mention tools — this message is handled in plain Chat mode. If the user asks for a workspace change, explain briefly that Chat mode is read-only and ask them to switch the visible Chat/Agent toggle to Agent mode; never imply that Chat mode will switch itself.`;

/** System prompt when the user is in Agent mode, but a message was answered conversationally. */
const AGENT_CHAT_SYSTEM_PROMPT = `You are NUVRO AI, an AI coding assistant.
The user is in Agent mode. Answer clearly, warmly and helpfully in the user's language.
Do NOT tell the user to switch to Agent mode (they already have Agent mode selected). If the user asked for a change to code or files, explain the recommended changes directly and suggest which file to apply them to.`;

/** Pending approval requests from running agent sessions (id -> resolver). */
const pendingApprovals = new Map<
  string,
  { resolve: (approved: boolean) => void; request: { kind: 'terminal' | 'git' | 'file'; title: string; command?: string; reason?: string } }
>();

function isLoopbackAddress(remoteAddress: string | undefined): boolean {
  if (!remoteAddress) return false;
  const normalized = remoteAddress.replace(/^::ffff:/, '').toLowerCase();
  return normalized === '127.0.0.1' || normalized === '::1' || normalized === 'localhost';
}

/** Keep long model generations alive through Electron/browser/proxy idle timers. */
function startSseKeepAlive(res: Response): () => void {
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  const timer = setInterval(() => {
    if (res.writableEnded || res.destroyed) return;
    try { res.write(': quillix-keepalive\n\n'); } catch { /* close handler aborts the provider */ }
  }, 15000);
  timer.unref?.();
  return () => clearInterval(timer);
}

async function startServer() {
  const app = express();
  let agentBusy = false;
  let activeAgentController: AbortController | null = null;
  let agentStartedAt: number | null = null;
  let agentStopRequestedAt: number | null = null;
  let inlineCompletionBusy = false;
  // NUVRO AI's control API is localhost-only by default. Never bind 0.0.0.0 —
  // this API can read/write files, run terminal commands, and execute tools.
  const HOST = '127.0.0.1';
  const PORT = Number(process.env.PORT || 3000);
  if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) throw new Error('PORT must be an integer between 1 and 65535.');

  app.use(express.json({ limit: '50mb' }));
  const requireAgentMode = (req: Request, res: Response, next: NextFunction) => {
    const conversationMode = parseConversationMode(req.body?.conversationMode);
    if (!conversationMode) {
      return res.status(400).json({ success: false, error: 'An explicit conversationMode of "chat" or "agent" is required for workspace mutations.' });
    }
    if (conversationMode === 'chat') {
      return res.status(409).json({ success: false, error: 'Workspace mutations are disabled in Chat mode. Switch to Agent mode to continue.' });
    }
    next();
  };
  app.use(['/api/workspace/set-root', '/api/workspace/create-project', '/api/project/open', '/api/settings', '/api/providers/sarvam/key', '/api/providers/sarvam/failover-key', '/api/providers/sarvam/failover-keys', '/api/providers/openai/key', '/api/providers/openai/failover-key', '/api/providers/openai/failover-keys', '/api/providers/grok/key', '/api/providers/grok/failover-key', '/api/providers/grok/failover-keys', '/api/providers/groq/key', '/api/providers/groq/failover-key', '/api/providers/groq/failover-keys', '/api/providers/nvidia/key', '/api/providers/nvidia/failover-key', '/api/providers/nvidia/failover-keys', '/api/providers/universal/key', '/api/providers/tavily/key'], (req, res, next) => {
    if (agentBusy && req.method !== 'GET') return res.status(409).json({ success: false, error: 'Wait for the active task to finish or stop it before changing the workspace or settings.' });
    next();
  });

  // --- SECURITY MIDDLEWARE -------------------------------------------------
  // 1) The NUVRO AI API must only be reachable from the local machine.
  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    if (!isLoopbackAddress(req.socket.remoteAddress) ||
        !validateLocalApiRequest(req.headers.host, req.headers.origin, PORT)) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden: NUVRO AI only accepts requests from its local application origin.',
      });
    }
    next();
  });

  // --- CORE SERVICES ------------------------------------------------------
  const settingsStore = new SettingsStore();
  const initialSettings = settingsStore.get();
  try {
    migrateLegacyUniversalKey(universalKeyContext(initialSettings));
  } catch {
    // Keep the legacy ciphertext untouched: never discard credentials on a
    // transient Windows DPAPI failure. User can re-save from Home/Settings.
    console.warn('NUVRO AI: legacy Universal key migration pending. Re-save the key if needed.');
  }


  // Restore the last user-selected workspace so the project survives restarts.
  const initialWorkspaceRoot =
    initialSettings.workspaceRoot && fs.existsSync(initialSettings.workspaceRoot)
      ? initialSettings.workspaceRoot
      : process.cwd();
  const workspaceManager = new WorkspaceManager(initialWorkspaceRoot);
  const terminalService = new TerminalService();
  const gitService = new GitService(terminalService);
  // One agent task = one git branch (Cursor-style). Remembers the base branch
  // per workspace so task work can be merged back or discarded.
  const taskBranchStore = new TaskBranchStore();
  const codebaseIndexer = new CodebaseIndexer(workspaceManager, gitService);
// One shared project RAG index (M1.5) so a save from the editor and the next
// agent retrieval see exactly the same incremental state.
const projectRag = new ProjectRag(workspaceManager.getRoot());
  const sourceContextRetriever = new SourceContextRetriever(workspaceManager);
  // M3.4: opt-in automatic project checks after a save (Build & Tests panel).
  const autoTestRunner = new AutoTestRunner(settingsStore);
  // M4.4: named workspace checkpoints (restore points) with diffs.
  const checkpointStore = new CheckpointStore(workspaceManager);
  // M5.6: short-lived result cache for repeated chat prompts (token
  // efficiency). Agent turns never use it; every replay is disclosed.
  const promptResultCache = new PromptResultCache();
  const ollamaProvider = new OllamaQwenProvider({
    baseUrl: initialSettings.ollamaBaseUrl,
    model: initialSettings.model,
    offlineMode: initialSettings.offlineMode,
  });
  const aiProvider = new ProviderRouter(ollamaProvider, settingsStore, () => workspaceManager.getRoot());
  const tavilyVerification = new TavilyVerificationService();
  const toolRegistry = new ToolRegistry(workspaceManager, terminalService, gitService, codebaseIndexer, settingsStore, tavilyVerification);
  const workspaceVerifier = new WorkspaceVerifier(workspaceManager, terminalService);
  const projectMemory = new ProjectMemory(workspaceManager.getRoot());
  const taskStateStore = new TaskStateStore(workspaceManager.getRoot());
  const projectRunService = new ProjectRunService();
  const agentEngine = new AgentEngine(
    aiProvider,
    toolRegistry,
    codebaseIndexer,
    workspaceVerifier,
    projectMemory,
    async (command, cwd, timeoutMs) => {
      const res = await terminalService.executeCommand(command, cwd, undefined, timeoutMs, 'agent');
      return { exitCode: res.exitCode, output: `${res.stdout}\n${res.stderr}` };
    },
    taskStateStore,
    tavilyVerification,
    () => settingsStore.get().offlineMode,
    projectRag,
  );
  const diagnosticsService = new DiagnosticsService(terminalService, ollamaProvider);

  // Keep the AI provider in sync with persisted settings changes.
  settingsStore.onChange((s) => {
    try {
      ollamaProvider.configure({ baseUrl: s.ollamaBaseUrl, model: s.model, offlineMode: s.offlineMode });
    } catch (err: any) {
      console.warn('NUVRO AI: failed to reconfigure Ollama provider:', err?.message);
    }
    // Overdrive Mode removes every app-imposed delay — pacing, declared
    // quota windows, header-derived spacing, fallback cooldowns and the
    // resource gate's waits — for the agent, router and transport alike.
    setOverdriveActive(s.overdriveMode === true);
  });
  setOverdriveActive(settingsStore.get().overdriveMode === true);

  app.post('/api/extensions/mcp',async(req,res)=>{
    if(agentBusy) return res.status(409).json({success:false,error:'Wait for the active task.'});
    if(settingsStore.get().offlineMode) return res.status(400).json({success:false,error:'Disable Offline Mode to connect MCP.'});
    try {
      const context={protocol:'openai' as const,endpoint:req.body.endpoint};
      if(req.body.key) saveUniversalKey(req.body.key,context);
      const {readUniversalKey}=await import('./src/server/universal.js');
      res.json({success:true,tools:await toolRegistry.extensions.connectMCP(req.body.id,req.body.endpoint,req.body.authenticated?()=>readUniversalKey(context):undefined)});
    }
    catch(e:any) {res.status(400).json({success:false,error:e.message});}
  });
  app.post('/api/extensions/mcp-stdio',async(req,res)=>{
    if(agentBusy) return res.status(409).json({success:false,error:'Wait for the active task.'});
    try {
      const id=typeof req.body?.id==='string'?req.body.id:'';
      const command=typeof req.body?.command==='string'?req.body.command:'';
      const args=Array.isArray(req.body?.args)?req.body.args:[];
      const environment=req.body?.environment && typeof req.body.environment==='object' && !Array.isArray(req.body.environment)?req.body.environment:{};
      const tools=await toolRegistry.extensions.connectMCPStdio(id,command,args,environment);
      res.json({success:true,tools});
    } catch(e:any) {res.status(400).json({success:false,error:e?.message||'Could not connect local MCP server.'});}
  });
  app.post('/api/extensions/lsp-stdio',async(req,res)=>{
    if(agentBusy) return res.status(409).json({success:false,error:'Wait for the active task.'});
    try {
      const id=typeof req.body?.id==='string'?req.body.id:'';
      const command=typeof req.body?.command==='string'?req.body.command:'';
      const args=Array.isArray(req.body?.args)?req.body.args:[];
      const tools=await toolRegistry.extensions.connectLSPStdio(id,command,args,workspaceManager.getRoot());
      res.json({success:true,tools});
    } catch(e:any) {res.status(400).json({success:false,error:e?.message||'Could not connect local language server.'});}
  });
  app.get('/api/extensions/catalog',(_req,res)=> {
    const available = new Set(toolRegistry.getToolDefinitions().map(t => t.name));
    const core = BUILTIN_CODING_PLUGINS.map(p => ({ ...p, tools: p.tools.filter(t => available.has(t)), offline: p.id !== 'quillix-mcp', enabled: true, manageable: false })).filter(p => p.tools.length);
    res.json({success:true,plugins:[...toolRegistry.codingPlugins.catalog(), ...core]});
  });
  app.put('/api/extensions/coding/:id', requireAgentMode, (req, res) => {
    if (agentBusy) return res.status(409).json({ success: false, error: 'Wait for the active task before changing coding plugins.' });
    const plugin = toolRegistry.codingPlugins.catalog().find(p => p.id === req.params.id);
    if (!plugin || typeof req.body.enabled !== 'boolean') return res.status(400).json({ success: false, error: 'Valid bundled plugin ID and boolean enabled are required.' });
    const disabled = new Set(settingsStore.get().disabledCodingPlugins || []);
    if (req.body.enabled) disabled.delete(plugin.id); else disabled.add(plugin.id);
    const result = settingsStore.update({ disabledCodingPlugins: [...disabled] });
    if (!result.success) return res.status(500).json(result);
    res.json({ success: true, plugins: toolRegistry.codingPlugins.catalog() });
  });
  app.get('/api/providers/usage',async(_req,res)=>{
    try {res.json({success:true,usage:await aiProvider.usageSnapshot()});}catch {res.json({success:true,usage:[]});}
  });
  app.get('/api/providers/rate-limit', async (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    const status = aiProvider.rateLimitStatus();
    let providerDiagnostics: any;
    try { providerDiagnostics = (await aiProvider.diagnosticsSnapshot()).providerDiagnostics; }
    catch { /* Keep the lightweight pacing response available during diagnostics failures. */ }
    const managedPacing = status.providerManagedPacing && providerDiagnostics
      ? {
          minIntervalMs:providerDiagnostics.effectiveRequestIntervalMs,
          queuedRequests:providerDiagnostics.queuedRequests,
          lastRequestAt:providerDiagnostics.lastRequestAt,
          nextRequestAt:providerDiagnostics.nextRequestAt,
          cooldownUntil:providerDiagnostics.cooldownUntil || providerDiagnostics.circuitOpenUntil,
          waitingMs:providerDiagnostics.waitingMs,
        }
      : {};
    // Part 2: the centralized RPM/TPM/day quota + shared cooldown, so every
    // component (Settings, Cockpit, footer) reads one picture.
    const settings = settingsStore.get();
    const activeScope = settings.aiProvider === 'universal'
      ? rateLimitScopeFor(String(settings.universalProtocol || 'openai'), String(settings.universalEndpoint || ''))
      : null;
    const quota = {
      scopes: rateLimitService.scopesSnapshot(),
      ...(activeScope ? { active: rateLimitService.snapshot(activeScope) } : {}),
    };
    res.json({ success: true, ...status, ...managedPacing, quota, ...(providerDiagnostics ? { providerDiagnostics } : {}) });
  });
  app.get('/api/providers/diagnostics', async (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    try { res.json({ success: true, ...await aiProvider.diagnosticsSnapshot() }); }
    catch { res.status(503).json({ success: false, error: 'Provider diagnostics are temporarily unavailable.' }); }
  });
  // QUILLIX MISSION CONTROL: persisted deadline goal state. Read-only — the
  // tracker never mutates progress; sessions rewrite the JSON file itself.
  app.get('/api/mission/state', (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const root = (workspaceManager.getRoot() || process.cwd()).trim() || process.cwd();
      const file = path.join(root, ...MISSION_STATE_PATH);
      if (!fs.existsSync(file)) {
        return res.status(404).json({ success: false, error: 'Mission state is not initialized for this workspace.' });
      }
      res.json({ success: true, path: file, state: parseMissionState(JSON.parse(fs.readFileSync(file, 'utf8'))) });
    } catch {
      res.status(503).json({ success: false, error: 'Mission state could not be read.' });
    }
  });
  // Brain catalog is metadata only: factories and credentials never cross
  // the local API boundary. The body/UI can discover capabilities without
  // coupling itself to provider implementation names.
  app.get('/api/brains', (_req, res) => {
    res.json({ success: true, brains: aiProvider.brainCatalog(), active: settingsStore.get().aiProvider || 'ollama' });
  });
  app.post('/api/extensions/plugin',async(req,res)=>{
    if(agentBusy) return res.status(409).json({success:false,error:'Wait for the active task.'});
    if(settingsStore.get().offlineMode) return res.status(400).json({success:false,error:'Disable Offline Mode to connect plugins.'});
    try {
      const context={protocol:'openai' as const,endpoint:req.body.endpoint};
      if(req.body.key) saveUniversalKey(req.body.key,context);
      const {readUniversalKey}=await import('./src/server/universal.js');
      res.json({success:true,tools:toolRegistry.extensions.connectPlugin(req.body.id,req.body.endpoint,req.body.tools,req.body.authenticated?()=>readUniversalKey(context):undefined)});
    }catch(e:any) {res.status(400).json({success:false,error:e.message});}
  });
  // --- SETTINGS -----------------------------------------------------------
  app.get('/api/settings', (_req: Request, res: Response) => {
    const current = settingsStore.get();
    res.json({ success: true, settings: { ...current, sarvamKeyConfigured: hasSarvamKey(), openaiKeyConfigured:hasOpenAIKey(), grokKeyConfigured:hasGrokKey(), groqKeyConfigured:hasGroqKey(), nvidiaKeyConfigured:hasNvidiaKey(), sarvamKeyPoolCount:sarvamFailoverKeyCount(), openaiKeyPoolCount:openAIFailoverKeyCount(), grokKeyPoolCount:grokFailoverKeyCount(), groqKeyPoolCount:groqFailoverKeyCount(), nvidiaKeyPoolCount:nvidiaFailoverKeyCount(), universalKeyConfigured: hasUniversalKey(universalKeyContext(current)), universalKeyPoolCount: universalKeyPoolCount(universalKeyContext(current)), tavilyKeyConfigured: hasTavilyKey() } });
  });

  app.put('/api/settings', (req: Request, res: Response) => {
    const patch = req.body || {};
    // Validate the Ollama URL against the provider BEFORE persisting, so an
    // invalid or non-loopback URL is rejected with a clear message.
    // Reconfigure for model-only changes too. Without this, the settings UI
    // could verify one model while the live provider kept using the previous
    // model and reported a misleading Model Not Found error.
    if (patch.ollamaBaseUrl !== undefined || patch.offlineMode !== undefined || patch.model !== undefined) {
      const prospective: QuillixSettings = { ...settingsStore.get(), ...patch };
      try {
        ollamaProvider.configure({
          baseUrl: prospective.ollamaBaseUrl,
          model: prospective.model,
          offlineMode: prospective.offlineMode,
        });
      } catch (err: any) {
        return res.status(400).json({ success: false, error: err?.message || 'Invalid settings.' });
      }
    }
    const result = settingsStore.update(patch);
    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error });
    }
    res.json({ success: true, settings: { ...result.settings, sarvamKeyConfigured: hasSarvamKey(), openaiKeyConfigured:hasOpenAIKey(), grokKeyConfigured:hasGrokKey(), groqKeyConfigured:hasGroqKey(), nvidiaKeyConfigured:hasNvidiaKey(), sarvamKeyPoolCount:sarvamFailoverKeyCount(), openaiKeyPoolCount:openAIFailoverKeyCount(), grokKeyPoolCount:grokFailoverKeyCount(), groqKeyPoolCount:groqFailoverKeyCount(), nvidiaKeyPoolCount:nvidiaFailoverKeyCount(), universalKeyConfigured: hasUniversalKey(universalKeyContext(result.settings!)), universalKeyPoolCount: universalKeyPoolCount(universalKeyContext(result.settings!)), tavilyKeyConfigured: hasTavilyKey() } });
  });

  app.post('/api/providers/tavily/key', (req: Request, res: Response) => {
    try {
      if (typeof req.body?.key !== 'string') return res.status(400).json({ success: false, error: 'Tavily API key required.' });
      saveTavilyKey(req.body.key);
      res.json({ success: true, configured: true });
    } catch (error: any) { res.status(400).json({ success: false, error: error?.message || 'Could not secure Tavily API key.' }); }
  });
  app.delete('/api/providers/tavily/key', (_req: Request, res: Response) => {
    try { clearTavilyKey(); res.json({ success: true, configured: hasTavilyKey() }); }
    catch { res.status(500).json({ success: false, error: 'Could not remove stored Tavily API key.' }); }
  });
  app.get('/api/verification/tavily/usage', (_req: Request, res: Response) => res.json({ success: true, usage: tavilyVerification.usageSnapshot() }));
  app.get('/api/verification/tavily/history', (_req: Request, res: Response) => res.json({ success: true, history: tavilyVerification.historySnapshot() }));
  // M-TAVILY-3: Deep Research. Plans a few bounded queries with the model,
  // searches each with Tavily, then synthesizes a cited answer over SSE.
  // Gated like the web tools: Agent mode, explicit consent, Offline Mode and
  // the daily budget all apply, and every failure is streamed as an event.
  app.post('/api/research', requireAgentMode, async (req: Request, res: Response) => {
    const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
    if (!prompt) return res.status(400).json({ success: false, error: 'A research question is required.' });
    const settings = settingsStore.get();
    const blocked = (message: string) => {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
      res.end();
    };
    if (settings.offlineMode) return blocked('Offline Mode blocks web research. Enable Online Mode to research with Tavily.');
    if (settings.tavilyNetworkConsent !== true) return blocked('Tavily network use is off. Turn on "Allow web search and page fetch" in Settings → Tavily first.');
    if (!tavilyVerification.budgetStatus(settings.tavilyDailySearchCap).allowed) {
      const budget = tavilyVerification.budgetStatus(settings.tavilyDailySearchCap);
      return blocked(searchBudgetMessage(budget.searches, budget.cap));
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    const stopKeepAlive = startSseKeepAlive(res);
    const send = (event: Record<string, unknown>) => res.write(`data: ${JSON.stringify(event)}\n\n`);

    try {
      // 1. Plan: the model proposes a bounded set of sub-queries.
      const planPrompt = [
        'You are a research planner. Given the user question, output ONLY a JSON array of at most 5 short, specific web search queries that together answer it.',
        'No prose, no markdown fences. Example: ["query one","query two"]',
        '',
        'Question:',
        prompt.slice(0, 4000),
      ].join('\n');
      const planText = await aiProvider.generateText(planPrompt, {
        model: settings.model,
        temperature: 0.1,
        maxOutputTokens: 300,
        contextWindow: 4096,
        timeoutSeconds: 30,
        priority: 'low',
        systemInstruction: 'You output only a JSON array of search queries.',
      });
      let parsedQueries: unknown = [];
      try {
        const match = String(planText || '').match(/\[[\s\S]*\]/);
        parsedQueries = match ? JSON.parse(match[0]) : [];
      } catch { parsedQueries = []; }
      const queries = clampResearchQueries(parsedQueries);
      if (!queries.length) {
        send({ error: 'The planner produced no usable search queries for this question.' });
        res.end();
        return;
      }
      send({ type: 'plan', queries });

      // 2. Search each query (bounded by the daily budget inside the tools).
      const evidence: Array<{ query: string; citations: string }> = [];
      const sources: Array<{ title: string; url: string; domain: string; official: boolean }> = [];
      for (const query of queries) {
        const budget = tavilyVerification.budgetStatus(settings.tavilyDailySearchCap);
        if (!budget.allowed) {
          send({ type: 'budget', message: searchBudgetMessage(budget.searches, budget.cap) });
          break;
        }
        const result = await tavilyVerification.search({ query, offline: settings.offlineMode });
        evidence.push({ query, citations: result.citations });
        for (const source of result.results) sources.push({ title: source.title, url: source.url, domain: source.domain, official: source.official });
        send({ type: 'search', query, citations: result.citations, cached: result.cached, usage: result.usage });
      }
      if (!evidence.some(entry => entry.citations.trim())) {
        send({ error: 'No web evidence was retrieved, so no cited answer can be produced.' });
        res.end();
        return;
      }

      // 3. Synthesize with citations over the bounded evidence block.
      const evidenceBlock = buildResearchEvidenceBlock(evidence);
      let streamed = '';
      await aiProvider.generateStream(
        [
          `Question: ${prompt.slice(0, 4000)}`,
          '',
          'Retrieved evidence:',
          evidenceBlock,
          '',
          researchSynthesisInstruction(),
        ].join('\n'),
        { temperature: 0.2, model: settings.model },
        chunk => { streamed += chunk; send({ type: 'answer', chunk }); },
      );
      send({ type: 'done', sources: sources.slice(0, RESEARCH_LIMITS.maxSourcesShown), queries, citations: formatCitations(sources) });
      res.end();
    } catch (error: any) {
      send({ error: String(error?.message || error) || 'Research failed.' });
      res.end();
    } finally {
      stopKeepAlive();
    }
  });

  // M-TAVILY-5: today's web-search budget + cached-entry maintenance.
  app.get('/api/verification/tavily/budget', (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, budget: tavilyVerification.budgetStatus(settingsStore.get().tavilyDailySearchCap), consent: settingsStore.get().tavilyNetworkConsent === true, offlineMode: settingsStore.get().offlineMode === true });
  });
  app.post('/api/verification/tavily/cache-clear', (_req: Request, res: Response) => {
    tavilyVerification.clearWebCaches();
    res.json({ success: true, budget: tavilyVerification.budgetStatus(settingsStore.get().tavilyDailySearchCap) });
  });
  app.post('/api/verification/tavily', async (req: Request, res: Response) => {
    if (agentBusy) return res.status(409).json({ success: false, error: 'Wait for the active task to finish.' });
    try {
      const result = await tavilyVerification.verify({ query: req.body?.query, answer: req.body?.answer, urls: req.body?.urls, force: req.body?.force === true, offline: settingsStore.get().offlineMode });
      res.json({ success: true, result });
    } catch (error: any) { res.status(502).json({ success: false, error: error?.message || 'Tavily verification failed.' }); }
  });

  app.post('/api/providers/sarvam/key', (req: Request, res: Response) => {
    try {
      if(typeof req.body?.key !== 'string') return res.status(400).json({success:false,error:'API key required.'});
      saveSarvamKey(req.body.key);
      return res.json({success:true,configured:true});
    } catch(e:any) { return res.status(400).json({success:false,error:e.message}); }
  });
  app.delete('/api/providers/sarvam/key', (_req: Request, res: Response) => {
    try {
      clearSarvamKey();
      res.json({ success: true, configured: hasSarvamKey() });
    } catch { res.status(500).json({ success: false, error: 'Unable to remove the stored Sarvam key.' }); }
  });
  const failoverRoutes: Array<[string, (key:string)=>number, ()=>void, ()=>number]> = [
    ['sarvam', saveSarvamFailoverKey, clearSarvamFailoverKeys, sarvamFailoverKeyCount],
    ['openai', saveOpenAIFailoverKey, clearOpenAIFailoverKeys, openAIFailoverKeyCount],
    ['grok', saveGrokFailoverKey, clearGrokFailoverKeys, grokFailoverKeyCount],
    ['groq', saveGroqFailoverKey, clearGroqFailoverKeys, groqFailoverKeyCount],
  ];
  for (const [provider, save, clear, count] of failoverRoutes) {
    app.post(`/api/providers/${provider}/failover-key`, (req: Request, res: Response) => {
      try {
        if (typeof req.body?.key !== 'string') return res.status(400).json({success:false,error:'Failover API key required.'});
        return res.json({success:true,count:save(req.body.key)});
      } catch (error:any) { return res.status(400).json({success:false,error:error?.message || 'Could not secure failover API key.'}); }
    });
    app.delete(`/api/providers/${provider}/failover-keys`, (_req: Request, res: Response) => {
      try { clear(); return res.json({success:true,count:0}); }
      catch { return res.status(500).json({success:false,error:'Could not remove failover API keys.'}); }
    });
  }
  // Explicit, user-initiated health check. Sends a small request (which may use
  // API credits). Never exposes the key or upstream response body to the UI.
  app.post('/api/providers/sarvam/test', async (_req: Request, res: Response) => {
    if (agentBusy) return res.status(409).json({ success: false, error: 'Wait for the active agent task to finish.' });
    if (settingsStore.get().offlineMode) return res.status(409).json({ success: false, error: 'Turn off Offline Mode to test Sarvam.' });
    if (!hasSarvamKey()) return res.status(400).json({ success: false, error: 'Save your Sarvam API key first.' });
    try {
      const answer = await new SarvamProvider().generateText('Reply with OK.', { timeoutSeconds: 12, maxOutputTokens: 64, reasoningEffort: 'none' });
      if (!answer.trim()) return res.status(502).json({ success: false, error: 'Sarvam responded with no text. The model connection is not verified.' });
      res.json({ success: true, status: 'connected', model: 'sarvam-105b' });
    } catch (err: any) {
      const raw = String(err?.message || 'Connection failed');
      const safe = /^(Sarvam request failed \(HTTP \d+\)|Sarvam connection timed out|Sarvam network connection failed|Sarvam returned invalid JSON|Sarvam returned no text or tool calls)/.test(raw)
        ? raw : 'Sarvam connection failed. Check internet, API key and model access.';
      res.status(502).json({ success: false, error: safe });
    }
  });

  // Dedicated OpenAI keys never share the Universal API's configurable endpoint.
  app.post('/api/providers/openai/key', (req:Request,res:Response)=>{
    try {
      if (typeof req.body?.key !== 'string') return res.status(400).json({success:false,error:'OpenAI API key required.'});
      saveOpenAIKey(req.body.key);
      return res.json({success:true,configured:true});
    } catch(e:any) {return res.status(400).json({success:false,error:String(e?.message||'Could not secure OpenAI API key.')});}
  });
  app.delete('/api/providers/openai/key', (_req:Request,res:Response)=>{
    try {clearOpenAIKey();return res.json({success:true,configured:hasOpenAIKey()});}
    catch {return res.status(500).json({success:false,error:'Could not remove stored OpenAI key.'});}
  });
  app.post('/api/providers/openai/test',async (_req:Request,res:Response)=>{
    if (agentBusy) return res.status(409).json({success:false,error:'Wait for active agent task to finish.'});
    const s=settingsStore.get();
    if(s.offlineMode) return res.status(409).json({success:false,error:'Disable Offline Mode to use OpenAI.'});
    if(!hasOpenAIKey()) return res.status(400).json({success:false,error:'Save OpenAI API key first.'});
    try {
      const text = await createOpenAIProvider(()=>s).generateText('Reply OK.',{maxOutputTokens:256,timeoutSeconds:25});
      if(!text.trim()) return res.status(502).json({success:false,error:'OpenAI response was empty; connection not verified.'});
      return res.json({success:true,status:'connected',model:s.openaiModel});
    } catch(e:any) {
      // Never surface upstream error bodies, headers or secrets to the browser.
      return res.status(502).json({success:false,error:safeProviderError(e?.message, 'OpenAI')});
    }
  });
  app.post('/api/providers/grok/key',(req:Request,res:Response)=>{try{if(typeof req.body?.key!=='string')return res.status(400).json({success:false,error:'Grok API key required.'});saveGrokKey(req.body.key);res.json({success:true,configured:true});}catch(e:any){res.status(400).json({success:false,error:e.message||'Could not secure Grok API key.'});}});
  app.delete('/api/providers/grok/key',(_req:Request,res:Response)=>{try{clearGrokKey();res.json({success:true,configured:hasGrokKey()});}catch{res.status(500).json({success:false,error:'Could not remove stored Grok key.'});}});
  app.post('/api/providers/grok/test',async(_req:Request,res:Response)=>{const s=settingsStore.get();if(s.offlineMode)return res.status(409).json({success:false,error:'Disable Offline Mode to use Grok.'});if(!hasGrokKey())return res.status(400).json({success:false,error:'Save Grok API key first.'});try{const text=await createGrokProvider(()=>s).generateText('Reply OK.',{maxOutputTokens:64,timeoutSeconds:25});if(!text.trim())throw new Error('empty');res.json({success:true,status:'connected',model:s.grokModel});}catch(e:any){res.status(502).json({success:false,error:safeProviderError(e?.message, 'Grok')});}});
  app.post('/api/providers/groq/key',(req:Request,res:Response)=>{try{if(typeof req.body?.key!=='string')return res.status(400).json({success:false,error:'Groq API key required.'});saveGroqKey(req.body.key);res.json({success:true,configured:true});}catch(e:any){res.status(400).json({success:false,error:e.message||'Could not secure Groq API key.'});}});
  app.delete('/api/providers/groq/key',(_req:Request,res:Response)=>{try{clearGroqKey();res.json({success:true,configured:hasGroqKey()});}catch{res.status(500).json({success:false,error:'Could not remove stored Groq key.'});}});
  app.post('/api/providers/groq/test',async(_req:Request,res:Response)=>{const s=settingsStore.get();if(s.offlineMode)return res.status(409).json({success:false,error:'Disable Offline Mode to use Groq.'});if(!hasGroqKey())return res.status(400).json({success:false,error:'Save Groq API key first.'});try{const text=await createGroqProvider(()=>s).generateText('Reply OK.',{maxOutputTokens:64,timeoutSeconds:25});if(!text.trim())throw new Error('empty');res.json({success:true,status:'connected',model:s.groqModel});}catch(e:any){res.status(502).json({success:false,error:safeProviderError(e?.message, 'Groq')});}});
  app.post('/api/providers/nvidia/key',(req:Request,res:Response)=>{try{if(typeof req.body?.key!=='string')return res.status(400).json({success:false,error:'NVIDIA API key required.'});saveNvidiaKey(req.body.key);res.json({success:true,configured:true});}catch(e:any){res.status(400).json({success:false,error:e.message||'Could not secure NVIDIA API key.'});}});
  app.delete('/api/providers/nvidia/key',(_req:Request,res:Response)=>{try{clearNvidiaKey();res.json({success:true,configured:hasNvidiaKey()});}catch{res.status(500).json({success:false,error:'Could not remove stored NVIDIA API key.'});}});
  app.post('/api/providers/nvidia/failover-key',(req:Request,res:Response)=>{try{if(typeof req.body?.key!=='string')return res.status(400).json({success:false,error:'NVIDIA failover API key required.'});res.json({success:true,count:saveNvidiaFailoverKey(req.body.key)});}catch(e:any){res.status(400).json({success:false,error:e.message||'Could not secure NVIDIA failover key.'});}});
  app.delete('/api/providers/nvidia/failover-keys',(_req:Request,res:Response)=>{try{clearNvidiaFailoverKeys();res.json({success:true,count:0});}catch{res.status(500).json({success:false,error:'Could not remove NVIDIA failover keys.'});}});
   app.post('/api/providers/nvidia/test',async(_req:Request,res:Response)=>{const s=settingsStore.get();if(s.offlineMode)return res.status(409).json({success:false,error:'Disable Offline Mode to use NVIDIA.'});if(!hasNvidiaKey())return res.status(400).json({success:false,error:'Save NVIDIA API key first.'});try{const text=await createNvidiaProvider(()=>s).generateText('Reply OK.',{maxOutputTokens:16,timeoutSeconds:12,reasoningEffort:'none',priority:'low'});if(!text.trim())throw new Error('empty');res.json({success:true,status:'connected',model:s.nvidiaModel});}catch(e:any){res.status(502).json({success:false,error:safeProviderError(e?.message,'NVIDIA NIM')});}});
  // Live model discovery for the NVIDIA account (no guessed model ids).
  app.get('/api/providers/nvidia/models',async(req:Request,res:Response)=>{
    const s=settingsStore.get();
    if(s.offlineMode)return res.status(409).json({success:false,error:'Disable Offline Mode to use NVIDIA.',models:[]});
    const refresh=String(req.query?.refresh||'')==='1';
    try{
      const result=await discoverNimModels(refresh);
      res.json({success:!result.error,source:result.source,fetchedAt:result.fetchedAt,models:result.models,error:result.error});
    }catch(e:any){res.status(502).json({success:false,models:[],error:safeProviderError(e?.message,'NVIDIA NIM')});}
  });
  // Failover + per-model health for the dashboard.
  app.get('/api/providers/nvidia/health',(_req:Request,res:Response)=>{
    try{res.json({success:true,...nimFailoverSnapshot()});}catch(e:any){res.status(500).json({success:false,error:safeProviderError(e?.message,'NVIDIA NIM')});}
  });

  app.post('/api/providers/universal/key', (req: Request, res: Response) => {
    try {
      if(typeof req.body?.key !== 'string') return res.status(400).json({success:false,error:'API key required.'});
      saveUniversalKey(req.body.key, universalKeyContext(settingsStore.get()));
      return res.json({success:true,configured:true});
    } catch(e:any) {return res.status(400).json({success:false,error:String(e?.message||'Secure key storage unavailable.')});}
  });
  app.post('/api/providers/universal/failover-key', (req: Request, res: Response) => {
    try {
      if (typeof req.body?.key !== 'string') return res.status(400).json({ success: false, error: 'Failover API key required.' });
      const count = saveUniversalKeyToPool(req.body.key, universalKeyContext(settingsStore.get()));
      return res.json({ success: true, count });
    } catch (e: any) { return res.status(400).json({ success: false, error: String(e?.message || 'Could not secure failover key.') }); }
  });
  app.delete('/api/providers/universal/failover-keys', (_req: Request, res: Response) => {
    try { const context = universalKeyContext(settingsStore.get()); clearUniversalKeyPool(context); return res.json({ success: true, count: 0 }); }
    catch { return res.status(500).json({ success: false, error: 'Could not remove failover keys.' }); }
  });
  app.delete('/api/providers/universal/key', (req:Request,res:Response)=>{
    try {
      const settings=settingsStore.get();
      const profileId=typeof req.body?.profileId==='string' ? req.body.profileId : '';
      const profile=profileId ? settings.providerProfiles?.find(candidate=>candidate.id===profileId) : undefined;
      clearUniversalKey(profile || selectedProviderConfig(settings));
      res.json({success:true,configured:hasUniversalKey(universalKeyContext(settings))});
    }
    catch {res.status(500).json({success:false,error:'Could not remove universal API key.'});}
  });
  app.post('/api/providers/universal/test', async (_req:Request,res:Response)=>{
    if(agentBusy) return res.status(409).json({success:false,error:'Wait for the active task to finish.'});
    const s=settingsStore.get();
    if(s.offlineMode) return res.status(409).json({success:false,error:'Disable Offline Mode to use Universal API.'});
    if(selectedProviderConfig(s).auth?.type!=='none' && !hasUniversalKey(universalKeyContext(s))) return res.status(400).json({success:false,error:'Save your Universal API key first.'});
    try {
      const config = selectedProviderConfig(s);
      const universal=new UniversalProvider(()=>config);
      const answer = await universal.generateText('Reply OK.',{maxOutputTokens:config.protocol==='responses'?256:64,timeoutSeconds:25,reasoningEffort:'none'});
      if (!answer.trim()) return res.status(502).json({success:false,error:'Universal API returned no text; connection not verified.'});
      let toolsVerified = false;
      if (config.capabilities?.tools === true) {
        // A harmless native function probe prevents a profile from being
        // marked fully connected when its model accepts text but rejects the
        // tool contract needed by NUVRO AI's coding body. The probe is never
        // registered with the workspace and is never executed.
        const probe: ToolDefinition = {
          name: 'quillix_connection_probe',
          description: 'Connection test only. Return this function call exactly once; do not perform any other action.',
          category: 'code',
          permission: 'read',
          parameters: { type: 'object', properties: {} },
        };
        const toolResult = await universal.chatWithTools(
          [{ role: 'user', content: 'Call quillix_connection_probe exactly once to verify native tool calling. Do not answer with prose.' }],
          [probe],
          { maxOutputTokens: config.protocol === 'responses' ? 256 : 128, timeoutSeconds: 25, reasoningEffort: 'none' },
        );
        toolsVerified = Array.isArray(toolResult.toolCalls) && toolResult.toolCalls.some(call => call.name === probe.name);
        if (!toolsVerified) {
          return res.status(502).json({
            success: false,
            status: 'text_connected_tools_unverified',
            model: config.model,
            error: 'Text connection succeeded, but this model did not return the native tool call required for coding tasks. Turn off “function calling” for chat-only use, or choose a tool-capable model.',
          });
        }
      }
      res.json({success:true,status:'connected',model:config.model,capabilities:{text:true,tools:config.capabilities?.tools === true ? toolsVerified : false}});
    } catch(e:any) {
      res.status(502).json({success:false,error:safeProviderError(e?.message, 'Universal')});
    }
  });
  app.get('/api/providers/universal/models', async (req:Request,res:Response)=>{
    const settings=settingsStore.get();
    if(settings.offlineMode) return res.status(409).json({success:false,models:[],error:'Disable Offline Mode to discover provider models.'});
    try {
      const config=selectedProviderConfig(settings);
      const keys=readUniversalKeys(config);
      if(config.auth?.type!=='none'&&!keys.length) return res.status(400).json({success:false,models:[],error:'Save the API key for this provider endpoint first.'});
      const models=await discoverProviderModels(config,config.auth?.type==='none'?'':keys,{forceRefresh:String(req.query?.refresh||'')==='1'});
      return res.json({success:true,models});
    } catch(error:any) {
      return res.status(502).json({success:false,models:[],error:safeProviderError(error?.message,'provider model discovery')});
    }
  });
  app.get('/api/providers/models', async (req:Request,res:Response)=>{
    const settings=settingsStore.get();
    if(settings.offlineMode) return res.status(409).json({success:false,models:[],error:'Disable Offline Mode to discover cloud models.'});
    try {
      let endpoint=''; let keys:string[]=[];
      if(settings.aiProvider==='openai') { endpoint=OPENAI_API_ENDPOINT; keys=readOpenAIKeys(); }
      else if(settings.aiProvider==='groq') { endpoint=GROQ_API_ENDPOINT; keys=readGroqKeys(); }
      else if(settings.aiProvider==='grok') { endpoint=GROK_API_ENDPOINT; keys=readGrokKeys(); }
      else return res.status(400).json({success:false,models:[],error:'Use this provider’s model discovery control in Settings.'});
      if(!keys.length) return res.status(400).json({success:false,models:[],error:'Save this provider’s API key first.'});
      const models=await discoverProviderModels({protocol:'openai',endpoint,model:'',offlineMode:false,auth:{type:'bearer'}},keys,{forceRefresh:String(req.query?.refresh||'')==='1'});
      return res.json({success:true,models});
    } catch(error:any) {
      return res.status(502).json({success:false,models:[],error:safeProviderError(error?.message,'provider model discovery')});
    }
  });

  // --- AGENT APPROVAL RESOLUTION -------------------------------------------
  // The agent loop blocks on dangerous operations until the user answers here.
  app.post('/api/agent/approve', requireAgentMode, (req: Request, res: Response) => {
    const { approvalId, approved } = req.body || {};
    const pending = pendingApprovals.get(approvalId);
    if (!pending) {
      return res.status(404).json({ success: false, error: 'Approval request not found or already answered.' });
    }
    pendingApprovals.delete(approvalId);
    pending.resolve(!!approved);
    res.json({ success: true });
  });

  // M2.3: a changeset review needs to see and answer many queued approvals at
  // once ("Approve all" / "Reject all"), including a chosen subset.
  app.get('/api/agent/approvals', requireAgentMode, (_req: Request, res: Response) => {
    res.json({ success: true, approvals: listPendingApprovals(pendingApprovals.entries()) });
  });

  app.post('/api/agent/approvals/batch', requireAgentMode, (req: Request, res: Response) => {
    const { approved, ids } = req.body || {};
    const selection = Array.isArray(ids)
      ? ids.filter((id: unknown): id is string => typeof id === 'string' && id.trim().length > 0)
      : undefined;
    const result = resolveApprovalBatch(pendingApprovals, approved !== false, selection);
    res.json({ success: true, approved: approved !== false, ...result });
  });

  // Part 3: the terminal self-healing history — what was repaired
  // automatically, what was skipped and why. Read-only: the repairs run
  // inside the agent loop, this endpoint only reports them.
  app.get('/api/agent/self-heal/history', (req: Request, res: Response) => {
    const requested = Number((req.query as any)?.limit);
    const limit = Number.isFinite(requested) && requested > 0 ? Math.min(100, Math.floor(requested)) : 20;
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, entries: selfHealHistory(limit) });
  });

  // Stop is intentionally outside the busy-state write guard. The browser
  // may have lost the SSE stream while the server-side agent is still waiting
  // on a provider; this endpoint gives the user an explicit recovery path.
  app.post('/api/agent/stop', (_req: Request, res: Response) => {
    if (!agentBusy || !activeAgentController) return res.json({ success: true, stopped: false });
    agentStopRequestedAt = Date.now();
    activeAgentController.abort();
    res.json({ success: true, stopped: true });
  });

  // Read-only recovery/status endpoint. The renderer can distinguish a real
  // running task from a stale local UI state before retrying settings or
  // workspace changes, while the stop action remains the only mutation.
  app.get('/api/agent/status', (_req: Request, res: Response) => {
    res.json({
      success: true,
      busy: agentBusy,
      stopping: agentBusy && !!activeAgentController?.signal.aborted,
      startedAt: agentStartedAt,
      stopRequestedAt: agentStopRequestedAt,
    });
  });

  // Health check
  app.get('/api/health', (req: Request, res: Response) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  });

  // Export current application source, not dependencies or sensitive local data.
  // The archive is generated natively by Node on Windows (no Python required).
  app.get('/api/download-zip', (_req: Request, res: Response) => {
    try {
      const archive = buildSourceArchive(workspaceManager.getRoot());
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', 'attachment; filename="quillix-workspace.zip"');
      res.setHeader('Cache-Control', 'no-store');
      res.end(archive);
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Diagnostics
  app.get('/api/diagnostics/health', async (req: Request, res: Response) => {
    try {
      const items = await diagnosticsService.runHealthCheck(workspaceManager.getRoot());
      res.json({ success: true, items });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Workspace - Tree
  app.get('/api/workspace/editor-project', async (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const snapshot = await collectEditorProject(workspaceManager);
      if (snapshot.root !== workspaceManager.getRoot()) return res.status(409).json({ success: false, error: 'Workspace changed; refresh source context.' });
      res.json({ success: true, ...snapshot });
    } catch {
      res.status(500).json({ success: false, error: 'Unable to load editor project context.' });
    }
  });

  // Fast, insertion-only AI completion for the editor. This is deliberately
  // separate from the autonomous agent: it never writes files, calls tools, or
  // claims verification. A single in-flight request prevents a slow local 3B
  // model from creating a queue while the user is still typing.
  app.post('/api/editor/inline-completion', async (req: Request, res: Response) => {
    if (inlineCompletionBusy) return res.status(429).json({ success: false, error: 'Another inline completion is still running.' });
    const body = req.body || {};
    const filePath = typeof body.filePath === 'string' ? body.filePath.trim() : '';
    const language = typeof body.language === 'string' ? body.language.slice(0, 32) : 'plaintext';
    const prefix = typeof body.prefix === 'string' ? body.prefix : '';
    const suffix = typeof body.suffix === 'string' ? body.suffix : '';
    if (!filePath || prefix.length > 12000 || suffix.length > 4000) {
      return res.status(400).json({ success: false, error: 'Invalid inline completion context.' });
    }
    const safe = workspaceManager.resolveSafePath(filePath);
    if (!safe.safe || WorkspaceManager.isSecretPath(filePath)) {
      return res.status(400).json({ success: false, error: 'Inline completion is not available for this path.' });
    }
    const settings = settingsStore.get();
    const controller = new AbortController();
    inlineCompletionBusy = true;
    res.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });
    try {
      const related = sourceContextRetriever.retrieve(filePath, { currentFile: filePath, maxChars: 2200, maxFiles: 2 }).context;
      const prompt = buildInlineCompletionPrompt({
        filePath,
        language,
        prefix: trimCompletionContext(prefix, 4200),
        suffix: trimCompletionContext(suffix, 1200),
        relatedContext: related,
      });
      const text = await aiProvider.generateText(prompt, {
        model: typeof body.model === 'string' && body.model.trim() ? body.model.trim() : settings.model,
        temperature: 0.1,
        maxOutputTokens: 192,
        contextWindow: 4096,
        timeoutSeconds: 12,
        priority: 'low',
        signal: controller.signal,
        systemInstruction: 'You are a low-latency code completion engine. Output only insertion text. Never output markdown, explanations, tool calls, or unrelated code.',
      });
      res.json({ success: true, completion: cleanInlineCompletion(text) });
    } catch (error: any) {
      if (!res.headersSent) res.status(502).json({ success: false, error: error?.message || 'Inline completion failed.' });
    } finally {
      inlineCompletionBusy = false;
    }
  });

  // M4.4: named checkpoints — create / list / detail / diff / restore / remove.
  app.get('/api/checkpoints', (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, checkpoints: checkpointStore.list() });
  });

  app.post('/api/checkpoints', requireAgentMode, (req: Request, res: Response) => {
    if (agentBusy) return res.status(409).json({ success: false, error: 'Wait for the active task to finish before creating a checkpoint.' });
    try {
      const checkpoint = checkpointStore.create(req.body?.name);
      res.json({ success: true, checkpoint });
    } catch (error: any) {
      res.status(500).json({ success: false, error: String(error?.message || error) });
    }
  });

  app.get('/api/checkpoints/:id', (req: Request, res: Response) => {
    const checkpoint = checkpointStore.get(req.params.id);
    if (!checkpoint) return res.status(404).json({ success: false, error: 'Checkpoint not found.' });
    res.json({ success: true, checkpoint });
  });

  app.get('/api/checkpoints/:id/diff', (req: Request, res: Response) => {
    const filePath = typeof req.query.path === 'string' ? req.query.path : '';
    if (!filePath) return res.status(400).json({ success: false, error: 'path is required' });
    const result = checkpointStore.diff(req.params.id, filePath);
    res.status(result.success ? 200 : 404).json(result);
  });

  app.post('/api/checkpoints/:id/restore', requireAgentMode, (req: Request, res: Response) => {
    if (agentBusy) return res.status(409).json({ success: false, error: 'Wait for the active task to finish before restoring a checkpoint.' });
    const result = checkpointStore.restore(req.params.id);
    if (result.restored.length) projectRag.invalidate();
    res.status(result.success ? 200 : 409).json(result);
  });

  app.delete('/api/checkpoints/:id', requireAgentMode, (req: Request, res: Response) => {
    if (agentBusy) return res.status(409).json({ success: false, error: 'Wait for the active task to finish before removing a checkpoint.' });
    const result = checkpointStore.remove(req.params.id);
    res.status(result.success ? 200 : 404).json(result);
  });

  // M3.4: automatic project checks after save — status (GET) + manual run (POST).
  // The on/off toggle itself travels through the normal settings channel
  // (PUT /api/settings) so it inherits the same validation and busy-guard.
  app.get('/api/editor/auto-test', (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, ...autoTestRunner.status() });
  });

  app.post('/api/editor/auto-test', async (req: Request, res: Response) => {
    const body = req.body || {};
    if (body.runNow !== true) {
      return res.status(400).json({ success: false, error: 'Send { runNow: true } to run the check now.' });
    }
    const outcome = await autoTestRunner.runNow();
    if ('skipped' in outcome) {
      return res.json({ success: false, skipped: outcome.skipped, ...autoTestRunner.status() });
    }
    res.json({ success: true, run: outcome, ...autoTestRunner.status() });
  });

  app.get('/api/workspace/tree', (req: Request, res: Response) => {
    try {
      const depth = req.query.depth ? parseInt(req.query.depth as string, 10) : 6;
      const tree = workspaceManager.getFileTree(depth);
      res.json({ success: true, tree, root: workspaceManager.getRoot() });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Workspace - Current root (lightweight: no tree walk) + recent list
  app.get('/api/workspace/root', (req: Request, res: Response) => {
    res.json({
      success: true,
      path: workspaceManager.getRoot(),
      recent: settingsStore.get().recentWorkspaces || [],
    });
  });

  // Records a workspace folder as the most recently used one.
  const recordRecentWorkspace = (folderPath: string) => {
    const current = settingsStore.get();
    const recent = [folderPath, ...(current.recentWorkspaces || []).filter((p) => p !== folderPath)].slice(0, 6);
    settingsStore.update({ workspaceRoot: folderPath, recentWorkspaces: recent });
  };

  // Workspace - Set Root
  app.post('/api/workspace/set-root', async (req: Request, res: Response) => {
    const { targetPath } = req.body;
    if (!targetPath) return res.status(400).json({ success: false, error: 'targetPath required' });
    const result = workspaceManager.setRoot(targetPath);
    // Persist the selected workspace so it is restored on the next start.
    if (result.success) {
      await toolRegistry.setWorkspaceRoot(result.path);
      recordRecentWorkspace(result.path);
      projectMemory.rebind(result.path);
      taskStateStore.rebind(result.path);
      projectRag.rebind(result.path);
    }
    res.json(result);
  });

  // ---- TASKS (§21 — persistent task memory / resume) -----------------------
  app.get('/api/tasks', (_req: Request, res: Response) => {
    res.json({ success: true, tasks: taskStateStore.listTasks() });
  });

  app.get('/api/tasks/latest-incomplete', (_req: Request, res: Response) => {
    res.json({ success: true, task: taskStateStore.getLatestIncomplete() || null });
  });

  app.get('/api/tasks/:id', (req: Request, res: Response) => {
    const task = taskStateStore.getTask(req.params.id);
    if (!task) return res.status(404).json({ success: false, error: `Unknown task: ${req.params.id}` });
    res.json({ success: true, task });
  });

  // Token-efficiency telemetry is intentionally aggregate-only. It exposes
  // no prompts, source contents, commands or secrets and remains useful after
  // the renderer has reloaded because TaskStateStore persists the metrics.
  // M5.6: chat result-cache telemetry for the Performance dashboard.
  app.get('/api/metrics/prompt-cache', (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    const stats = promptResultCache.stats();
    const lookups = stats.hits + stats.misses;
    res.json({ success: true, enabled: settingsStore.get().chatResultCache !== false, cache: stats, hitRate: lookups ? stats.hits / lookups : 0 });
  });
  app.get('/api/metrics/token-efficiency', (req: Request, res: Response) => {
    const rawLimit = Number(req.query.limit ?? 20);
    res.json(taskStateStore.tokenEfficiencySummary(Number.isFinite(rawLimit) ? rawLimit : 20));
  });

  // Task-scoped conflict-safe rollback. This restores only files whose current
  // contents still match the completed task output; manual edits are reported
  // as conflicts instead of being overwritten.
  app.get('/api/tasks/:id/rollback', (req: Request, res: Response) => {
    const task = taskStateStore.getTask(req.params.id);
    if (!task) return res.status(404).json({ success: false, error: `Unknown task: ${req.params.id}` });
    const rollback = taskStateStore.getRollback(req.params.id);
    res.json({ success: true, available: !!rollback?.files.length, rollback: rollback || null });
  });
  app.post('/api/tasks/:id/rollback', requireAgentMode, (req: Request, res: Response) => {
    if (agentBusy) return res.status(409).json({ success: false, error: 'Wait for the active task to finish before rolling back.' });
    const task = taskStateStore.getTask(req.params.id);
    if (!task) return res.status(404).json({ success: false, error: `Unknown task: ${req.params.id}` });
    const result = taskStateStore.rollbackTask(req.params.id);
    res.status(result.success ? 200 : 409).json(result);
  });

  // M2.4: undo the most recent agent changeset in one action. Picks the newest
  // task that still has unrestored rollback snapshots, then performs the same
  // conflict-safe restore as the per-task endpoint.
  app.post('/api/tasks/undo-last-changeset', requireAgentMode, (req: Request, res: Response) => {
    if (agentBusy) return res.status(409).json({ success: false, error: 'Wait for the active task to finish before undoing its changeset.' });
    const candidates = taskStateStore.listTasks().filter((task) => (task.rollback?.files.length ?? 0) > 0 && !task.rollback?.restoredAt);
    const latest = candidates[0];
    if (!latest) {
      return res.status(404).json({ success: false, error: 'No agent changeset is available to undo.' });
    }
    const result = taskStateStore.rollbackTask(latest.id);
    res.status(result.success ? 200 : 409).json({ ...result, taskId: latest.id, userRequest: latest.userRequest });
  });

  // Resume an interrupted task: returns the verified-state resume context the
  // agent will use (the client then POSTs /api/agent/run with resumeTaskId).
  app.post('/api/tasks/:id/resume-context', (req: Request, res: Response) => {
    const checkpoint = taskStateStore.resolveResumeCheckpoint(req.params.id);
    if ('error' in checkpoint) return res.status(checkpoint.status).json({ success: false, error: checkpoint.error });
    const { task } = checkpoint;
    const resumePrompt =
      (typeof req.body?.userPrompt === 'string' && req.body.userPrompt.trim()) ||
      `Continue the interrupted task: ${task.userRequest}`;
    res.json({
      success: true,
      taskId: task.id,
      resumePrompt,
      resumeContext: taskStateStore.buildResumeContext(task),
    });
  });

  // Workspace - Create New Project (native folder picker chose the parent)
  app.post('/api/workspace/create-project', requireAgentMode, async (req: Request, res: Response) => {
    const { parentPath, projectName } = req.body || {};
    if (!parentPath || typeof parentPath !== 'string') {
      return res.status(400).json({ success: false, error: 'parentPath required' });
    }
    if (!projectName || typeof projectName !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9 ._()-]*$/.test(projectName.trim()) || /^\.{1,2}$/.test(projectName.trim())) {
      return res.status(400).json({ success: false, error: 'Invalid project name: use letters, digits, spaces, dots, dashes, parentheses or underscores.' });
    }
    try {
      const resolvedParent = path.resolve(parentPath);
      if (!fs.existsSync(resolvedParent) || !fs.statSync(resolvedParent).isDirectory()) {
        return res.status(400).json({ success: false, error: `Parent folder does not exist: ${resolvedParent}` });
      }
      const projectDir = path.join(resolvedParent, projectName.trim());
      if (fs.existsSync(projectDir)) {
        return res.status(409).json({ success: false, error: `Folder already exists: ${projectDir}` });
      }
      fs.mkdirSync(projectDir, { recursive: true });
      const result = workspaceManager.setRoot(projectDir);
      if (!result.success) {
        return res.status(500).json({ success: false, error: result.error });
      }
      await toolRegistry.setWorkspaceRoot(result.path);
      recordRecentWorkspace(result.path);
      projectMemory.rebind(result.path);
      taskStateStore.rebind(result.path);
      projectRag.rebind(result.path);
      res.json({ success: true, path: result.path });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // Workspace - Read File
  app.get('/api/workspace/file', (req: Request, res: Response) => {
    const filePath = req.query.path as string;
    if (!filePath) return res.status(400).json({ success: false, error: 'path query required' });
    const result = workspaceManager.readFile(filePath);
    res.json(result);
  });

  // M1.5: incremental RAG index observability + explicit invalidation.
  app.get('/api/project/rag/status', (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, root: workspaceManager.getRoot(), ...projectRag.status() });
  });
  // The renderer may also ask for a targeted refresh after an external save.
  app.post('/api/project/rag/invalidate', requireAgentMode, (req: Request, res: Response) => {
    const filePath = req.body?.filePath;
    if (filePath !== undefined && (typeof filePath !== 'string' || !filePath.trim())) {
      return res.status(400).json({ success: false, error: 'filePath must be a non-empty string when provided' });
    }
    const removed = projectRag.invalidate(typeof filePath === 'string' ? filePath : undefined);
    res.json({ success: true, removed });
  });

  // M1.4: live codebase Q&A. Answers "where is X defined?" with file:line plus a
  // bounded snippet, using the ranked source-context files and a symbol-precise
  // scan. It reports "not found" rather than guessing a location.
  app.get('/api/codebase/answer', requireAgentMode, (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    const question = typeof req.query.question === 'string' ? req.query.question.trim() : '';
    if (!question) return res.status(400).json({ success: false, error: 'question query parameter is required' });
    try {
      const root = workspaceManager.getRoot();
      const evidence = codebaseIndexer.sources.retrieve(question, { maxFiles: 6, maxChars: 6000 });
      const documents: Array<{ file: string; content: string }> = [];
      for (const relative of evidence.files.slice(0, 6)) {
        const read = workspaceManager.readFile(relative);
        if (read.success && typeof read.content === 'string') documents.push({ file: relative, content: read.content.slice(0, 120_000) });
      }
      const answer = answerCodebaseQuestion(question, documents);
      res.json({ success: true, question, root, ...answer });
    } catch {
      res.status(503).json({ success: false, error: 'Codebase answer is temporarily unavailable.' });
    }
  });

  // Workspace - Write / Create File
  app.post('/api/workspace/file', requireAgentMode, (req: Request, res: Response) => {
    const { filePath, content, isNew, expectedContent } = req.body || {};
    if (typeof filePath !== 'string' || !filePath.trim() || typeof content !== 'string') {
      return res.status(400).json({ success: false, error: 'filePath and content are required strings' });
    }
    // Optimistic concurrency: never overwrite an external agent edit with an
    // older unsaved editor buffer. Checking and writing are both synchronous.
    if (!isNew && expectedContent !== undefined) {
      if (typeof expectedContent !== 'string') {
        return res.status(400).json({ success: false, error: 'expectedContent must be a string' });
      }
      const current = workspaceManager.readFile(filePath);
      if (!current.success || current.content !== expectedContent) {
        return res.status(409).json({
          success: false,
          error: 'Save conflict: this file changed on disk since you opened it. Copy your unsaved edits before reloading.',
        });
      }
    }
    const result = isNew
      ? workspaceManager.createFile(filePath, content)
      : workspaceManager.writeFile(filePath, content);
    // M1.5: drop this file's cached chunks so the next retrieval re-reads it
    // immediately instead of waiting for a full rebuild.
    if (result?.success !== false) projectRag.invalidate(filePath);
    // M3.4: schedule the opt-in automatic check for this save. Advisory only —
    // it can never block or fail the save itself.
    if (result?.success !== false) autoTestRunner.notifySave(filePath);
    res.json(result);
  });

  // Workspace - Delete File
  app.delete('/api/workspace/file', requireAgentMode, (req: Request, res: Response) => {
    const filePath = req.body?.filePath || (req.query.path as string);
    if (!filePath) return res.status(400).json({ success: false, error: 'filePath required' });
    const result = workspaceManager.deleteFile(filePath);
    if (result?.success !== false) projectRag.invalidate();
    res.json(result);
  });

  // Workspace - Rename File
  app.post('/api/workspace/rename', requireAgentMode, (req: Request, res: Response) => {
    const { oldPath, newPath } = req.body;
    if (!oldPath || !newPath) return res.status(400).json({ success: false, error: 'oldPath and newPath required' });
    const result = workspaceManager.renameFile(oldPath, newPath);
    res.json(result);
  });

  // Workspace - Search
  app.get('/api/workspace/search', (req: Request, res: Response) => {
    const query = req.query.q as string;
    if (!query) return res.json({ success: true, matches: [] });
    const caseSensitive = req.query.caseSensitive === 'true';
    const wholeWord = req.query.wholeWord === 'true';
    const isRegex = req.query.isRegex === 'true';
    const result = workspaceManager.searchFiles(query, { caseSensitive, wholeWord, isRegex });
    res.json(result);
  });

  // Project Metadata
  app.get('/api/project/meta', async (req: Request, res: Response) => {
    try {
      const meta = await codebaseIndexer.analyzeProject();
      res.json({ success: true, meta });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Terminal Execution
  app.post('/api/terminal/run', requireAgentMode, async (req: Request, res: Response) => {
    const { command, cwd, shell, approved } = req.body;
    if (!command || typeof command !== 'string') {
      return res.status(400).json({ success: false, error: 'command required' });
    }

    // The terminal cwd must always stay inside the active workspace.
    let targetCwd = workspaceManager.getRoot();
    if (cwd && typeof cwd === 'string' && cwd.trim()) {
      const resolved = path.resolve(workspaceManager.getRoot(), cwd.trim());
      if (!workspaceManager.isWithinWorkspace(resolved)) {
        return res.status(403).json({
          success: false,
          error: 'Operation blocked: path is outside the active workspace. (terminal working directory)',
        });
      }
      targetCwd = resolved;
    }

    // Dangerous commands require explicit approval when Terminal Approval is ON.
    const { risk, reason } = TerminalService.classifyRisk(command);
    if (risk !== 'SAFE' && settingsStore.get().terminalApproval && !approved) {
      return res.status(403).json({
        success: false,
        needsApproval: true,
        risk,
        reason,
        error: `Command blocked: "${command}" requires approval (${risk}). Approve it in the NUVRO AI UI to run it.`,
      });
    }

    const result = await terminalService.executeCommand(command, targetCwd, shell);
    res.json({ success: true, result });
  });

  // Terminal Risk Check
  app.post('/api/terminal/check-risk', (req: Request, res: Response) => {
    const { command } = req.body;
    const riskInfo = TerminalService.classifyRisk(command || '');
    res.json({ success: true, ...riskInfo });
  });

  // Terminal - STOP the currently running command process(es)
  app.post('/api/terminal/stop', (_req: Request, res: Response) => {
    const stopped = terminalService.stopActive();
    res.json({ success: true, stopped });
  });

  // Terminal Execution History (agent + user commands, newest last)
  app.get('/api/terminal/history', (req: Request, res: Response) => {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
    res.json({ success: true, history: terminalService.getHistory(limit) });
  });

  // ==========================================================================
  // PROJECT SYSTEM - language detection, RUN lifecycle, memory, preview
  // ==========================================================================

  /** Resolves a project root (relative to workspace, or absolute inside it). */
  const resolveProjectRoot = (rawRoot: unknown): { root: string; error?: string } => {
    if (typeof rawRoot !== 'string' || !rawRoot.trim()) {
      return { root: workspaceManager.getRoot() };
    }
    const check = workspaceManager.resolveSafePath(rawRoot.trim());
    return check.safe
      ? { root: check.fullPath }
      : { root: workspaceManager.getRoot(), error: check.error };
  };

  // Project - Detect language / entry point / build & run commands
  app.get('/api/project/detect', (req: Request, res: Response) => {
    const { root: rootAbs, error } = resolveProjectRoot(req.query.root);
    if (error) return res.status(400).json({ success: false, error });
    try {
      const profile = LanguageRunnerRegistry.detect(rootAbs);
      res.json({ success: true, root: rootAbs, profile });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Project - Start the RUN (spawns the real process via the language runner)
  app.post('/api/project/run', requireAgentMode, (req: Request, res: Response) => {
    const { root: rootAbs, error } = resolveProjectRoot(req.body?.root);
    if (error) return res.status(400).json({ success: false, error });
    try {
      const profile = LanguageRunnerRegistry.detect(rootAbs);
      if (profile.previewable && !profile.runCommand) {
        return res.json({
          success: true,
          previewOnly: true,
          root: rootAbs,
          previewEntry: profile.previewEntry,
          profile,
        });
      }
      const run = projectRunService.start(rootAbs, profile);
      if ('error' in run) {
        return res.status(400).json({ success: false, error: run.error, root: rootAbs, profile });
      }
      projectMemory.updateFromProfile(path.basename(rootAbs), rootAbs, profile);
      res.json({ success: true, run, profile, root: rootAbs });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Project - Run status (poll for live output / exit code)
  app.get('/api/project/run/status', (req: Request, res: Response) => {
    if (typeof req.query.id === 'string' && req.query.id) {
      const run = projectRunService.status(req.query.id);
      return res.json({ success: true, run: run || null });
    }
    const { root: rootAbs } = resolveProjectRoot(req.query.root);
    const run = projectRunService.findByRoot(rootAbs);
    res.json({ success: true, run: run || null });
  });

  // Project - Stop a running project
  app.post('/api/project/run/stop', (req: Request, res: Response) => {
    const id = req.body?.id;
    if (typeof id !== 'string' || !id) return res.status(400).json({ success: false, error: 'id required' });
    const stopped = projectRunService.stop(id);
    res.json({ success: true, stopped });
  });

  // Project - Memory (which projects exist, which is active)
  app.get('/api/project/memory', (_req: Request, res: Response) => {
    res.json({ success: true, memory: projectMemory.getSnapshot() });
  });

  // Project - Set the active project explicitly (RUN button / tree click)
  app.post('/api/project/open', (req: Request, res: Response) => {
    const { root } = req.body || {};
    const { root: rootAbs, error } = resolveProjectRoot(root);
    if (error) return res.status(400).json({ success: false, error });
    const rec = projectMemory.setActive(path.basename(rootAbs), rootAbs);
    res.json({ success: true, project: rec });
  });

  // ==========================================================================
  // BUILT-IN PREVIEW - serves workspace files for the web preview iframe.
  // Loopback-only (same /api security via the /api middleware? No - /preview
  // has its own check), path-traversal-safe, correct MIME types.
  // ==========================================================================
  let previewServerReady = false;
  let previewServerError = '';
  const previewSessionService = new PreviewSessionService(() => previewServerReady);
  const MIME_TYPES: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.htm': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.mp4': 'video/mp4',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
  };

  // Websites may use localStorage/cookies and still must not inherit the
  // NUVRO AI API's privileged origin. Host previews on a SECOND ephemeral local
  // port. API cross-origin checks block scripts in these websites from using
  // the file, terminal, or settings endpoints.
  const previewApp = express();
  const servePreviewAsset = (req: Request, res: Response, dedicated: boolean): void => {
    const addressPort = dedicated ? (previewServer.address() as import('net').AddressInfo | null)?.port : PORT;
    if (!isLoopbackAddress(req.socket.remoteAddress) || !addressPort ||
        !validateLocalApiRequest(req.headers.host, req.headers.origin, addressPort)) {
      res.status(403).send('Forbidden: invalid local preview origin.');
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.status(405).send('Preview files are read-only.');
      return;
    }
    // Legacy /preview on the API origin remains sandboxed (opaque origin).
    // New windows use the isolated preview origin, where localStorage works.
    if (!dedicated) res.setHeader('Content-Security-Policy', PREVIEW_CONTENT_SECURITY_POLICY);
    else res.setHeader('Content-Security-Policy', `object-src 'none'; base-uri 'none'; frame-ancestors http://${HOST}:${PORT} http://localhost:${PORT}`);
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    let rel: string;
    try {
      rel = decodeURIComponent(req.path.startsWith('/') ? req.path.slice(1) : req.path);
    } catch {
      res.status(400).send('Invalid preview path.');
      return;
    }
    if (!isPreviewAssetAllowed(rel) || WorkspaceManager.isSecretPath(rel)) {
      res.status(403).send('Blocked: private or unsupported preview file.');
      return;
    }
    const check = workspaceManager.resolveSafePath(rel);
    if (!check.safe) {
      res.status(403).send('Blocked: outside active workspace.');
      return;
    }
    let stat: fs.Stats;
    try { stat = fs.statSync(check.fullPath); }
    catch { res.status(404).send('Not found.'); return; }
    const target = stat.isDirectory() ? path.join(check.fullPath, 'index.html') : check.fullPath;
    try {
      const targetCheck = workspaceManager.resolveSafePath(path.relative(workspaceManager.getRoot(), target));
      if (!targetCheck.safe || !fs.statSync(target).isFile()) {
        res.status(403).send('Blocked preview target.');
        return;
      }
    } catch {
      res.status(404).send('Not found.');
      return;
    }
    const ext = path.extname(target).toLowerCase();
    if (!MIME_TYPES[ext]) { res.status(403).send('Blocked file type.'); return; }
    res.setHeader('Content-Type', MIME_TYPES[ext]);
    res.sendFile(target);
  };

  previewApp.use('/preview', (req: Request, res: Response) => servePreviewAsset(req, res, true));
  const previewServer = previewApp.listen(0, HOST, () => {
    const address = previewServer.address() as import('net').AddressInfo;
    previewServerReady = true;
    previewServerError = '';
    console.log(`NUVRO AI isolated web preview at http://${HOST}:${address.port}`);
  });
  previewServer.on('error', (error) => {
    previewServerReady = false;
    previewServerError = `Preview server failed to start: ${error.message}`;
    console.error('NUVRO AI preview server:', error.message);
  });
  // The old API-hosted path is restricted for compatibility with links from
  // previous releases. It never provides localStorage to generated code.
  app.use('/preview', (req: Request, res: Response) => servePreviewAsset(req, res, false));
  app.get('/api/preview/origin', (_req: Request, res: Response) => {
    const address = previewServer.address();
    if (!address || typeof address === 'string' || !previewServerReady) return res.status(503).json({ success: false, error: previewServerError || 'Preview server is still starting.' });
    res.json({ success: true, origin: `http://${HOST}:${address.port}` });
  });
  app.post('/api/preview/start', requireAgentMode, (req: Request, res: Response) => {
    const { root: rootAbs, error } = resolveProjectRoot(req.body?.root);
    if (error) return res.status(400).json({ success: false, error });
    const validation = validatePreviewEntry(rootAbs, req.body?.entry || 'index.html');
    if (!validation.ok) return res.status(400).json({ success: false, error: validation.error });
    let html = '';
    try { html = fs.readFileSync(validation.fullPath, 'utf8'); }
    catch { return res.status(400).json({ success: false, error: `Preview entry could not be read: ${validation.entry}` }); }
    const readLocal = (relativePath: string): string | undefined => {
      const target = path.resolve(rootAbs, ...relativePath.replace(/\\/g, '/').split('/'));
      const relative = path.relative(rootAbs, target);
      if (relative.startsWith('..') || path.isAbsolute(relative)) return undefined;
      try { return fs.readFileSync(target, 'utf8'); } catch { return undefined; }
    };
    const issues = [...inspectBrowserAssets(validation.entry, html, readLocal), ...inspectBrowserScripts(validation.entry, html, readLocal)];
    if (issues.length) return res.status(422).json({ success: false, error: `Preview validation failed: ${issues[0].error}`, issues: issues.slice(0, 8) });
    const started = previewSessionService.start(rootAbs, validation.entry);
    if ('error' in started) return res.status(503).json({ success: false, error: started.error });
    const address = previewServer.address() as import('net').AddressInfo | null;
    if (!address) return res.status(503).json({ success: false, error: 'Preview server is not available.' });
    const rootRelative = path.relative(workspaceManager.getRoot(), rootAbs).replace(/\\/g, '/');
    const previewPath = `/preview/${[rootRelative, validation.entry].filter(Boolean).map((part) => part.split('/').map(encodeURIComponent).join('/')).join('/')}`;
    res.json({ success: true, session: started, origin: `http://${HOST}:${address.port}`, previewPath });
  });
  app.get('/api/preview/status', (req: Request, res: Response) => {
    const id = typeof req.query.id === 'string' ? req.query.id : '';
    if (!id) return res.status(400).json({ success: false, error: 'Preview session id required.' });
    res.json({ success: true, session: previewSessionService.status(id) || null });
  });
  app.post('/api/preview/stop', (req: Request, res: Response) => {
    const id = typeof req.body?.id === 'string' ? req.body.id : '';
    if (!id) return res.status(400).json({ success: false, error: 'Preview session id required.' });
    res.json({ success: true, stopped: previewSessionService.stop(id) });
  });

  // Git Endpoints
  app.get('/api/git/status', async (req: Request, res: Response) => {
    try {
      const status = await gitService.getStatus(workspaceManager.getRoot());
      res.json({ success: true, status });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get('/api/git/diff', async (req: Request, res: Response) => {
    try {
      const staged = req.query.staged === 'true';
      const diff = await gitService.getDiff(workspaceManager.getRoot(), staged);
      res.json({ success: true, diff });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get('/api/git/log', async (req: Request, res: Response) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 10;
      const log = await gitService.getLog(workspaceManager.getRoot(), limit);
      res.json({ success: true, log });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/git/stage', requireAgentMode, async (req: Request, res: Response) => {
    const { filePath } = req.body;
    const result = await gitService.add(workspaceManager.getRoot(), filePath || '.');
    res.json(result);
  });

  app.post('/api/git/commit', requireAgentMode, async (req: Request, res: Response) => {
    const { message, authorized } = req.body;
    if (!message) return res.status(400).json({ success: false, error: 'message required' });

    // Real authorization enforcement: commits require an explicit user decision.
    if (settingsStore.get().gitApproval && !authorized) {
      return res.status(403).json({
        success: false,
        needsAuthorization: true,
        error: 'Commit blocked: committing requires explicit user authorization in NUVRO AI.',
      });
    }

    const result = await gitService.commit(workspaceManager.getRoot(), message);
    res.json(result);
  });

  app.post('/api/git/restore', requireAgentMode, async (req: Request, res: Response) => {
    const { filePath, authorized } = req.body;
    if (!filePath) return res.status(400).json({ success: false, error: 'filePath required' });

    // Restoring discards uncommitted changes — destructive, enforce approval.
    if (settingsStore.get().gitApproval && !authorized) {
      return res.status(403).json({
        success: false,
        needsAuthorization: true,
        error: 'Restore blocked: discarding changes requires explicit user authorization in NUVRO AI.',
      });
    }

    const result = await gitService.restore(workspaceManager.getRoot(), filePath);
    res.json(result);
  });

  // --- Task branches: one agent task = one git branch, Cursor-style ------------
  app.get('/api/git/branches', async (req: Request, res: Response) => {
    try {
      const root = workspaceManager.getRoot();
      const branches = await gitService.listBranches(root);
      const current = branches.find((b) => b.current)?.name || await gitService.getBranch(root);
      const record = taskBranchStore.get(root);
      res.json({
        success: true,
        branches,
        current,
        taskBranch: record && record.branch === current ? record : null,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/git/branch', requireAgentMode, async (req: Request, res: Response) => {
    const { name } = req.body;
    if (!name || typeof name !== 'string' || !/^[A-Za-z0-9._/-]{1,120}$/.test(name) || name.startsWith('-')) {
      return res.status(400).json({ success: false, output: 'Invalid branch name.' });
    }
    const result = await gitService.checkout(workspaceManager.getRoot(), name, true);
    res.json(result);
  });

  app.post('/api/git/checkout', requireAgentMode, async (req: Request, res: Response) => {
    const { name } = req.body;
    if (!name || typeof name !== 'string' || name.startsWith('-')) {
      return res.status(400).json({ success: false, output: 'Invalid branch name.' });
    }
    const result = await gitService.checkout(workspaceManager.getRoot(), name, false);
    res.json(result);
  });

  /** Cut a fresh task branch from the current HEAD (or keep the active one). */
  app.post('/api/git/task-branch', requireAgentMode, async (req: Request, res: Response) => {
    const { title } = req.body || {};
    const root = workspaceManager.getRoot();
    try {
      if (!(await gitService.isGitRepo(root))) {
        return res.json({ success: false, error: 'Not a git repository — task branches need git.' });
      }
      const settings = settingsStore.get();
      const prefix = settings.taskBranchPrefix || 'nuvro';
      const current = await gitService.getBranch(root);
      const record = taskBranchStore.get(root);

      if (!settings.branchPerTask) {
        return res.json({ success: true, skipped: true, branch: current, base: current });
      }
      // Already working on this workspace's task branch: keep it.
      if (record && record.branch === current) {
        return res.json({ success: true, existing: true, branch: record.branch, base: record.base });
      }
      // On a branch that already looks like a task branch (e.g. after the
      // store was lost): adopt it instead of nesting task branches. Infer the
      // merge-back target from main/master when the record is gone.
      if (isTaskBranchName(current, prefix)) {
        const branches = await gitService.listBranches(root);
        const fallbackBase = ['main', 'master'].find((name) => branches.some((b) => b.name === name)) || current;
        const base = record?.base && record.base !== current ? record.base : fallbackBase;
        taskBranchStore.set(root, { branch: current, base, createdAt: record?.createdAt || Date.now(), title: record?.title });
        return res.json({ success: true, existing: true, branch: current, base });
      }

      let name = '';
      for (let attempt = 0; attempt < 6 && !name; attempt++) {
        const candidate = taskBranchName(prefix, String(title || 'task'), Math.random().toString(36).slice(2, 8));
        if (!(await gitService.hasBranch(root, candidate))) name = candidate;
      }
      if (!name) return res.json({ success: false, error: 'Could not find a free task branch name.' });

      const created = await gitService.checkout(root, name, true);
      if (!created.success) return res.json({ success: false, error: created.output || 'Branch creation failed.' });

      taskBranchStore.set(root, {
        branch: name,
        base: current || 'main',
        createdAt: Date.now(),
        title: String(title || '').slice(0, 120),
      });
      res.json({ success: true, branch: name, base: current || 'main' });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /** Commit task work, return to the base branch and merge it back. */
  app.post('/api/git/finish-task', requireAgentMode, async (req: Request, res: Response) => {
    const { message, authorized } = req.body || {};
    const root = workspaceManager.getRoot();
    try {
      const record = taskBranchStore.get(root);
      const current = await gitService.getBranch(root);
      if (!record || record.branch !== current) {
        return res.json({ success: false, error: 'This workspace is not on a task branch.' });
      }
      if (settingsStore.get().gitApproval && !authorized) {
        return res.status(403).json({
          success: false,
          needsAuthorization: true,
          error: 'Finish task blocked: merging into the base branch requires explicit user authorization.',
        });
      }
      let note = '';
      const status = await gitService.getStatus(root);
      if (status.files.length) {
        const staged = await gitService.add(root, '.');
        if (!staged.success) return res.json({ success: false, error: staged.output });
        const commitMessage = String(message || '').trim() || `task: ${record.title || record.branch}`;
        const committed = await gitService.commit(root, commitMessage);
        if (!committed.success && !/nothing to commit/i.test(committed.output)) {
          return res.json({ success: false, error: committed.output });
        }
        note = committed.output;
      }
      const back = await gitService.checkout(root, record.base, false);
      if (!back.success) {
        return res.json({ success: false, error: `Work is committed on ${record.branch}, but switching back to ${record.base} failed: ${back.output}` });
      }
      const merged = await gitService.mergeBranch(root, record.branch, `Merge task branch ${record.branch}`);
      if (!merged.success) {
        return res.json({ success: false, conflict: true, error: `Merge into ${record.base} has conflicts — resolve them in the editor, then commit.`, output: merged.output });
      }
      await gitService.deleteBranch(root, record.branch, true);
      taskBranchStore.clear(root);
      res.json({ success: true, branch: record.branch, base: record.base, output: `${note}\n${merged.output}`.trim() });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /** Throw away all task-branch work and return to the base branch. */
  app.post('/api/git/discard-task', requireAgentMode, async (req: Request, res: Response) => {
    const { authorized } = req.body || {};
    const root = workspaceManager.getRoot();
    try {
      if (settingsStore.get().gitApproval && !authorized) {
        return res.status(403).json({
          success: false,
          needsAuthorization: true,
          error: 'Discard task blocked: deleting a task branch and its changes requires explicit user authorization.',
        });
      }
      const record = taskBranchStore.get(root);
      const current = await gitService.getBranch(root);
      if (!record || record.branch !== current) {
        return res.json({ success: false, error: 'This workspace is not on a task branch.' });
      }
      const reset = await gitService.discardWorkingChanges(root);
      if (!reset.success) return res.json({ success: false, error: reset.output });
      const back = await gitService.checkout(root, record.base, false);
      if (!back.success) return res.json({ success: false, error: `Could not switch back to ${record.base}: ${back.output}` });
      const removed = await gitService.deleteBranch(root, record.branch, true);
      taskBranchStore.clear(root);
      res.json({ success: true, branch: record.branch, base: record.base, output: `${back.output} ${removed.output}`.trim() });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Tool Registry
  app.get('/api/tools/list', (req: Request, res: Response) => {
    res.json({ success: true, tools: toolRegistry.getToolDefinitions() });
  });

  app.post('/api/tools/execute', async (req: Request, res: Response) => {
    const { name, args, approved } = req.body;
    if (!name) return res.status(400).json({ success: false, error: 'Tool name required' });
    const toolDefinition = toolRegistry.getToolDefinitions().find(tool => tool.name === name);
    if (toolDefinition && toolDefinition.permission !== 'read') {
      const conversationMode = parseConversationMode(req.body?.conversationMode);
      if (!conversationMode) {
        return res.status(400).json({ success: false, error: 'An explicit conversationMode of "chat" or "agent" is required for workspace tools.' });
      }
      if (conversationMode === 'chat') {
        return res.status(409).json({ success: false, error: 'Workspace mutation tools are disabled in Chat mode. Switch to Agent mode to continue.' });
      }
    }
    const toolCallId = `manual_${Date.now()}`;
    // Manual tool execution is only allowed for the local NUVRO AI app (enforced
    // by the localhost middleware above). Dangerous operations additionally
    // require the caller to pass approved: true after user confirmation.
    const result = await toolRegistry.executeTool(toolCallId, name, args || {}, { preApproved: !!approved });
    if (result.needsApproval && !result.success) {
      return res.status(403).json({ ...result, needsApproval: true });
    }
    res.json(result);
  });

  // Local Ollama connection status
  app.get('/api/ollama/status', async (req: Request, res: Response) => {
    try {
      const model =
        typeof req.query.model === 'string' && req.query.model.trim() ? req.query.model.trim() : undefined;
      const status = await ollamaProvider.getStatus(model);
      res.json({ success: true, status });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // AI Chat Plain Stream (SSE)
  app.post('/api/chat/stream', async (req: Request, res: Response) => {
    const { prompt, options } = req.body;
    if (!prompt) return res.status(400).json({ error: 'Prompt is required' });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    const stopKeepAlive = startSseKeepAlive(res);

    const settings = settingsStore.get();
    // M5.6: identical repeated chat prompts inside the TTL replay the previous
    // answer instead of spending tokens again. Agent turns never reach here.
    const cacheKey = promptResultCacheKey({
      providerId: String(settings.aiProvider || ''),
      model: String(options?.model || settings.model || ''),
      endpoint: String(settings.aiProvider === 'ollama' ? settings.ollamaBaseUrl : settings.universalEndpoint || ''),
      systemInstruction: typeof options?.systemInstruction === 'string' ? options.systemInstruction : '',
      prompt: String(prompt),
      temperature: options?.temperature ?? settings.temperature,
    });
    const cached = settings.chatResultCache !== false ? promptResultCache.get(cacheKey) : undefined;
    if (cached !== undefined) {
      try {
        for (const chunk of chunkCachedResponse(cached)) {
          res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
        }
        res.write(`data: ${JSON.stringify({ done: true, cached: true, cache: promptResultCache.stats() })}\n\n`);
        res.end();
      } finally {
        stopKeepAlive();
      }
      return;
    }

    let assembled = '';
    try {
      await aiProvider.generateStream(
        prompt,
        {
          ...options,
          temperature: options?.temperature ?? settingsStore.get().temperature,
          onRateLimit: ({ retryAt, detail, attempt }: { retryAt: number; detail: string; attempt: number }) => {
            const waitSeconds = Math.max(1, Math.ceil((retryAt - Date.now()) / 1000));
            res.write(`data: ${JSON.stringify({
              rateLimit: { retryAt, waitSeconds, detail, attempt },
              activity: { id: `rl_${Date.now()}`, timestamp: Date.now(), type: 'rate_limited', message: `Rate limit hit — retrying automatically in ~${waitSeconds}s (attempt ${attempt + 1})` },
            })}\n\n`);
          },
        },
        (chunk) => {
          assembled += chunk;
          res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
        }
      );
      if (settings.chatResultCache !== false) promptResultCache.set(cacheKey, assembled);
      res.write(`data: ${JSON.stringify({ done: true, cached: false, cache: promptResultCache.stats() })}\n\n`);
      res.end();
    } catch (err: any) {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    } finally {
      stopKeepAlive();
    }
  });

  // Autonomous Agent Loop Execution (SSE Stream for Real-time Activity & Tooling)
  app.post('/api/agent/run', async (req: Request, res: Response) => {
    if (agentBusy) return res.status(409).json({ error: 'Another task is running. Wait or stop it first.' });
    if (typeof req.body?.userPrompt !== 'string' || !req.body.userPrompt.trim()) return res.status(400).json({ error: 'A non-empty userPrompt is required.' });
    if (req.body?.currentFileContent !== undefined && (typeof req.body.currentFileContent !== 'string' || req.body.currentFileContent.length > 1_000_000)) {
      return res.status(400).json({ error: 'The active editor buffer must be text no larger than 1,000,000 characters.' });
    }
    let verificationCommands: string[];
    try { verificationCommands = normalizeVerificationCommands(req.body.verificationCommands); }
    catch (error: any) { return res.status(400).json({ error: error.message }); }
    const { userPrompt, mode, currentFile, currentFileContent, selectedText, conversationHistory, model } = req.body;
    // Conversation mode is an explicit safety boundary, not merely a UI hint.
    // A stale renderer, replayed request, or project-memory override must not
    // turn Chat mode into a mutating coding run.
    const conversationMode = parseConversationMode(req.body?.conversationMode);
    if (!conversationMode) {
      return res.status(400).json({ error: 'An explicit conversationMode of "chat" or "agent" is required.' });
    }
    const requestedMode = (typeof mode === 'string' && mode) || 'agent';
    const resumeTaskId = req.body.resumeTaskId;
    if (resumeTaskId !== undefined) {
      if (typeof resumeTaskId !== 'string' || !resumeTaskId.trim()) {
        return res.status(400).json({ error: 'A non-empty resumeTaskId is required.' });
      }
      if (conversationMode === 'chat' ||
          (conversationMode !== 'agent' && ['ask', 'review', 'plan', 'analyze'].includes(requestedMode))) {
        return res.status(409).json({ error: 'Switch to Agent mode to resume a checkpoint.' });
      }
      const checkpoint = taskStateStore.resolveResumeCheckpoint(resumeTaskId);
      if ('error' in checkpoint) return res.status(checkpoint.status).json({ error: checkpoint.error });
    }
    agentBusy = true;
    agentStartedAt = Date.now();
    agentStopRequestedAt = null;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    const stopKeepAlive = startSseKeepAlive(res);

    let isClientClosed = false;
    let startedTaskId: string | undefined;

    // Aborting this controller cancels the active Ollama request immediately.
    // NOTE: req.on('close') fires as soon as the request body is complete, NOT
    // when the client disconnects — res.on('close') with writableEnded is the
    // correct disconnect signal for SSE.
    const abortController = new AbortController();
    activeAgentController = abortController;
    res.on('close', () => {
      if (!res.writableEnded) {
        isClientClosed = true;
        abortController.abort();
      }
    });

    try {
      const settings = settingsStore.get();

      // --- Intent routing: Normal Chat vs Coding Agent -----------------
      // The default 'agent' mode auto-classifies the prompt so a plain
      // greeting NEVER executes tools. Read-only Ask/Plan/Review remain chat;
      // actionable selected-file edits are promoted by the renderer to Agent.
      const recentHistory = Array.isArray(conversationHistory) ? conversationHistory : [];
      const hasProjectContext = !!projectMemory.getActive() || recentHistory.some((entry: any) =>
        typeof entry?.content === 'string' && /PROJECT ROOT:|Files written:|Files created:|Changed Files|Files changed on disk|Task (?:finished|completed|incomplete|failed)|task execution finished|project is complete|approval needed for phase|phase \d+/i.test(entry.content)
      );
      const promptText = userPrompt || '';
      const route = routeConversationIntent(promptText, {
        conversationMode,
        workflowMode: requestedMode,
        hasProjectContext,
        currentFile: typeof currentFile === 'string' && currentFile.trim() ? currentFile : undefined,
        approvedContinuation: Boolean(approvedHtmlStageContinuation(promptText, recentHistory)),
        resumeRequested: Boolean(resumeTaskId),
        matchesRememberedProject: () => Boolean(projectMemory.resolveReference(promptText)),
      });

      const send = (data: unknown) => {
        if (!isClientClosed) res.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      send({ event: 'intent', intent: route.kind, reason: route.reason });
      if (route.kind === 'chat') {
        // Pure conversational reply — no tools are passed to the model at all,
        // so normal chat can never trigger file, terminal, or project changes.
        send({
          event: 'activity',
          activity: {
            id: `act_chat_${Date.now()}`,
            timestamp: Date.now(),
            type: 'thinking',
            message: `Chat mode — ${route.reason}`,
          },
        });

        const historyText = (Array.isArray(conversationHistory) ? conversationHistory : [])
          .filter((h: any) => (h.role === 'user' || h.role === 'assistant') && typeof h.content === 'string')
          .slice(-6)
          .map((h: any) => `${h.role === 'user' ? 'User' : 'NUVRO AI'}: ${h.content}`)
          .join('\n');
        const prompt = historyText
          ? `Conversation so far:\n${historyText}\n\nUser: ${userPrompt}`
          : (userPrompt || '');

        const finalText = await aiProvider.generateStream(
          prompt,
          {
            model: model || settings.model,
            temperature: settings.temperature,
            systemInstruction: conversationMode === 'agent' ? AGENT_CHAT_SYSTEM_PROMPT : CHAT_SYSTEM_PROMPT,
            signal: abortController.signal,
            onProviderModelSwitch: ({ from, to, reason }) => send({ event: 'activity', activity: {
              id: `act_model_switch_${Date.now()}`, timestamp: Date.now(), type: 'thinking',
              message: `Model ${from} failed (${reason}) — continuing with ${to} on the same provider API`,
            } }),
          },
          (chunk) => send({ event: 'token', token: chunk })
        );

        send({
          event: 'done',
          result: {
            finalText,
            activities: [],
            plan: [],
            patches: [] as FilePatch[],
            toolCalls: [],
            toolResults: [],
            cancelled: false,
          },
        });
        res.end();
        return;
      }

      const executionMode: AgentMode = resumeTaskId || (conversationMode === 'agent' && ['ask', 'review', 'plan'].includes(requestedMode))
        ? 'agent'
        : requestedMode as AgentMode;
      const result = await agentEngine.run({
        userPrompt: userPrompt || 'Analyze project status',
        mode: executionMode,
        currentFile,
        currentFileContent,
        selectedText,
        verificationCommands,
        conversationHistory: conversationHistory || [],
        ...(resumeTaskId ? { resumeTaskId } : {}),
        model: model || settings.model,
        provider: settings.aiProvider || 'ollama',
        settings: {
          maxAutonomousTurns: settings.maxAutonomousTurns,
          temperature: settings.temperature,
          autoApplyDiffs: settings.autoApplyDiffs,
        },
        signal: abortController.signal,
        isCancelled: () => isClientClosed,
        onTaskStarted: (taskId) => {
          startedTaskId = taskId;
          send({ event: 'task_started', taskId });
        },
        onActivity: (activity) => {
          if (!isClientClosed) {
            res.write(`data: ${JSON.stringify({ event: 'activity', activity })}\n\n`);
          }
        },
        onPlanUpdate: (plan) => {
          if (!isClientClosed) {
            res.write(`data: ${JSON.stringify({ event: 'plan', plan })}\n\n`);
          }
        },
        onPhaseUpdate: (phases) => {
          if (!isClientClosed) {
            res.write(`data: ${JSON.stringify({ event: 'phase', phases })}\n\n`);
          }
        },
        onPatchGenerated: (patch) => {
          if (!isClientClosed) {
            res.write(`data: ${JSON.stringify({ event: 'patch', patch })}\n\n`);
          }
        },
        onToken: (token) => {
          if (!isClientClosed) {
            res.write(`data: ${JSON.stringify({ event: 'token', token })}\n\n`);
          }
        },
        requestApproval: (request) => {
          // Stream the approval request to the UI and block until the user answers.
          return new Promise<boolean>((resolve) => {
            if (isClientClosed || abortController.signal.aborted) return resolve(false);
            const approvalId = `appr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            pendingApprovals.set(approvalId, { resolve, request });
            if (!isClientClosed) {
              res.write(`data: ${JSON.stringify({ event: 'approval', approvalId, request })}\n\n`);
            }
            // Auto-deny when the client disconnects while a request is pending.
            res.on('close', () => {
              if (!res.writableEnded && pendingApprovals.has(approvalId)) {
                pendingApprovals.delete(approvalId);
                resolve(false);
              }
            });
          });
        },
      });

      if (!isClientClosed) {
        res.write(
          `data: ${JSON.stringify({
            event: 'done',
            result: { ...result, patches: (result.patches as FilePatch[]) || [] },
          })}\n\n`
        );
        res.end();
      }
    } catch (err: any) {
      // Finalize the exact task allocated by this stream even if the client
      // disconnected. A process restart should not be required to resume it.
      let interruptedTask = startedTaskId ? taskStateStore.getTask(startedTaskId) : undefined;
      if (interruptedTask?.status === 'running') {
        try {
          taskStateStore.finishTask(interruptedTask.id, abortController.signal.aborted ? 'cancelled' : 'failed', String(err?.message || err));
          interruptedTask = taskStateStore.getTask(interruptedTask.id);
        } catch {
          interruptedTask = undefined;
        }
      }
      if (interruptedTask?.status !== 'failed' && interruptedTask?.status !== 'cancelled') interruptedTask = undefined;
      if (!isClientClosed) {
        res.write(`data: ${JSON.stringify({
          event: 'error',
          error: err.message,
          ...(interruptedTask ? { taskId: interruptedTask.id, resumable: true } : {}),
        })}\n\n`);
        res.end();
      }
    } finally {
      stopKeepAlive();
      agentBusy = false;
      agentStartedAt = null;
      agentStopRequestedAt = null;
      if (activeAgentController === abortController) activeAgentController = null;
    }
  });

  // Vite middleware setup
  if (process.env.NODE_ENV !== 'production') {
    app.use('/monaco/vs', express.static(path.resolve('node_modules/monaco-editor/min/vs')));
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = __dirname;
    app.use(express.static(distPath));
    app.get('*', (req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = app.listen(PORT, HOST, () => {
    console.log(`NUVRO AI Server running on http://${HOST}:${PORT} (localhost only)`);
  });

  // Warm the local model after the API is listening. This keeps startup
  // responsive while removing the cold-load penalty from the first coding
  // request. It is best-effort: Ollama may be started after NUVRO AI.
  if (initialSettings.aiProvider === 'ollama' && process.env.QUILLIX_PREWARM_OLLAMA !== 'false') {
    const warmup = setTimeout(() => {
      void ollamaProvider.warmUp().catch(() => {
        // A missing/stopped Ollama instance is reported by the normal status
        // endpoint; startup must never fail just because local AI is offline.
      });
    }, 250);
    warmup.unref?.();
  }

  // Clean startup failure handling: report EADDRINUSE clearly instead of
  // crashing with an unhandled error, then exit with a distinct code.
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(
        `\nQuillix could not start: port ${PORT} on ${HOST} is already in use.\n` +
          `If another NUVRO AI instance is already running, use it or stop it first.\n` +
          `If an unrelated application is using the port, close it or change PORT in .env.\n`
      );
      process.exitCode = 1;
    } else {
      console.error(`NUVRO AI server failed to start: ${err.message}`);
      process.exitCode = 1;
    }
  });

  // Graceful shutdown: stop listening and terminate any running terminal
  // child processes so no orphans are left behind.
  const shutdown = (signal: string) => {
    if ((shutdown as any).done) return;
    (shutdown as any).done = true;
    console.log(`\nQuillix server shutting down (${signal})...`);
    try {
      terminalService.killAll();
      projectRunService.stopAll();
      toolRegistry.extensions.closeAll();
    } catch {
      // best effort
    }
    previewServerReady = false;
    previewSessionService.stopAll();
    previewServer.close();
    server.close(() => process.exit(0));
    // Safety net if close hangs on open keep-alive connections.
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Orphan watchdog: when launched by the Electron desktop app, exit if the
  // parent process dies so no NUVRO AI server is left running after a crash
  // or force-kill of the window.
  const parentPid = process.env.QUILLIX_PARENT_PID;
  if (parentPid && Number(parentPid)) {
    const checkParent = () => {
      try {
        process.kill(Number(parentPid), 0); // signal 0 = liveness probe only
      } catch {
        console.log('NUVRO AI server: parent process exited — shutting down.');
        shutdown('parent-gone');
      }
    };
    setInterval(checkParent, 2000);
    checkParent();
  }
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exitCode = 1;
});
