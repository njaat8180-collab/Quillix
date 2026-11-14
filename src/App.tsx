import React, { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { TopHeader, OllamaState, MainView } from './components/TopHeader.js';
// Heavy overlays are loaded on demand so the first-paint chunk stays small.
const SettingsScreen = lazy(() => import('./components/SettingsScreen.js').then(m => ({ default: m.SettingsScreen })));
import { AtlasDashboard as DashboardView } from './components/AtlasDashboard.js';
import { ActionHub } from './components/ActionHub.js';
import { WorkspaceView } from './components/WorkspaceView.js';
import { WorkbenchLayout, WorkspaceCommand } from './components/WorkbenchLayout.js';
import { ChatPanel, PendingApproval } from './components/ChatPanel.js';
const OnboardingFlow = lazy(() => import('./components/OnboardingFlow.js').then(m => ({ default: m.OnboardingFlow })));
// DiffViewer is small (5.9 KB) and is also statically imported by
// WorkspaceView, so it stays a static import — a dynamic import here would be
// flagged as ineffective by the bundler.
import { DiffViewer } from './components/DiffViewer.js';
import { useCommandPalette, CommandPaletteProvider } from './components/CommandPaletteState.js';
const CommandPalette = lazy(() => import('./components/CommandPalette.js').then(m => ({ default: m.CommandPalette })));
import {
  AgentActivity,
  AgentMode,
  AgentPhase,
  ChatMessage,
  FilePatch,
  ProjectMetadata,
  QuillixSettings,
  ToolResult,
} from './shared/types.js';
import { api } from './services/apiBridge.js';
import { StoredChat, loadChats, saveChat, deleteChat, createChat } from './chatStore.js';
import { isMutationRequest } from './shared/writeIntent.js';
import { conversationModeFromStorageEvent, readConversationMode, writeConversationMode } from './shared/conversationModeStorage.js';
import { pageVariants, motionPage, modalVariants, modalBackdropVariants } from './animations/index.js';
import { AmbientGrid, AmbientOrbs, AmbientParticles, AmbientNoise } from './components/AmbientEffects.js';

export default function App() {
  // --- Workspace & settings ---
  const [projectMeta, setProjectMeta] = useState<ProjectMetadata | null>(null);
  const [settings, setSettings] = useState<QuillixSettings | null>(null);
  const [ollama, setOllama] = useState<OllamaState>({ state: 'unknown' });
  // Sarvam status only becomes connected after an actual connection test.
  const [sarvamConnection, setSarvamConnection] = useState<'untested' | 'checking' | 'connected' | 'failed'>('untested');
  const [universalConnection, setUniversalConnection] = useState<'untested' | 'checking' | 'connected' | 'failed'>('untested');
  const [openaiConnection,setOpenAIConnection]=useState<'untested'|'checking'|'connected'|'failed'>('untested');
  const [grokConnection,setGrokConnection]=useState<'untested'|'checking'|'connected'|'failed'>('untested');
  const [nvidiaConnection,setNvidiaConnection]=useState<'untested'|'checking'|'connected'|'failed'>('untested');
  const [groqConnection,setGroqConnection]=useState<'untested'|'checking'|'connected'|'failed'>('untested');
  const [workspaceRoot, setWorkspaceRoot] = useState('');
  const [recentWorkspaces, setRecentWorkspaces] = useState<string[]>([]);
  const ollamaCheckInFlight = useRef(false);

  // --- Chat state ---
  const [chats, setChats] = useState<StoredChat[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // Live mirror of messages: async completions must append to the *current*
  // list, never to a run-start snapshot, or messages added mid-stream are lost.
  const messagesRef = useRef<ChatMessage[]>(messages);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  const [input, setInput] = useState('');
  const [activeEditorFile, setActiveEditorFile] = useState<string | null>(null);
  const activeEditorBufferRef = useRef<{ file: string; content: string; dirty: boolean } | null>(null);
  useEffect(() => { setActiveEditorFile(null); }, [workspaceRoot]);
  const [verificationCommand, setVerificationCommand] = useState('');
  useEffect(() => { setVerificationCommand(''); }, [workspaceRoot]);
  const [mode, setMode] = useState<AgentMode>('agent');
  const [conversationMode, setConversationMode] = useState<'chat' | 'agent'>('agent');
  const [conversationModeWorkspaceRoot, setConversationModeWorkspaceRoot] = useState('');
  const conversationModeReady = Boolean(workspaceRoot && conversationModeWorkspaceRoot === workspaceRoot);
  const [isWorking, setIsWorking] = useState(false);
  const [activities, setActivities] = useState<AgentActivity[]>([]);
  const [phases, setPhases] = useState<AgentPhase[]>([]);
  const [liveFiles, setLiveFiles] = useState<string[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const isWorkingRef = useRef(false);
  const lastPromptRef = useRef<string>('');

  // --- Layout / overlays ---
  const [view, setView] = useState<MainView>('dashboard');
  const [autoCreateSignal, setAutoCreateSignal] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [studioVisited, setStudioVisited] = useState(false);
  const [editorDirty, setEditorDirty] = useState(false);
  const [agentFocusSignal, setAgentFocusSignal] = useState(0);
  const [workspaceCommand, setWorkspaceCommand] = useState<{ action: WorkspaceCommand; nonce: number } | null>(null);
  const studioActive = workspaceOpen || view === 'workspace';
  useEffect(() => { if (studioActive) setStudioVisited(true); }, [studioActive]);
  const [viewingPatch, setViewingPatch] = useState<FilePatch | null>(null);

  // --- Command Palette ---
  const commandPalette = useCommandPalette();

  // --- Workspace <-> agent integration ---
  const [workspaceRefresh, setWorkspaceRefresh] = useState(0);
  const [focusFileRequest, setFocusFileRequest] = useState<{ path: string; nonce: number } | null>(null);
  const [agentBanner, setAgentBanner] = useState<string | null>(null);

  const refreshProjectMeta = useCallback(() => {
    api
      .getProjectMeta()
      .then((res) => {
        if (res.success) setProjectMeta(res.meta);
      })
      .catch(() => {});
  }, []);

  const refreshWorkspaceState = useCallback(() => {
    api
      .getWorkspaceRoot()
      .then((res) => {
        if (res.success) {
          api.setConversationModeContext(res.path, readConversationMode(res.path, () => window.localStorage));
          setWorkspaceRoot(res.path);
          setRecentWorkspaces(res.recent || []);
        }
      })
      .catch(() => {});
  }, []);

  // --- Initialization ---
  useEffect(() => {
    setChats(loadChats());
    api
      .getSettings()
      .then((res) => {
        if (res.success && res.settings) {
          setSettings(res.settings);
          // Show onboarding for first-time users
          if (!res.settings.hasCompletedOnboarding) {
            setShowOnboarding(true);
          }
        }
      })
      .catch(() => {});
    refreshProjectMeta();
    refreshWorkspaceState();
  }, [refreshProjectMeta, refreshWorkspaceState]);

  // The explicit Chat/Agent choice is scoped to the active workspace and
  // survives reloads. It is deliberately separate from the finer-grained
  // Ask/Plan/Debug workflow tabs so a user can never accidentally turn Chat
  // mode back into a mutating agent request through a keyword heuristic.
  useEffect(() => {
    if (!workspaceRoot) {
      setConversationModeWorkspaceRoot('');
      return;
    }
    const savedMode = readConversationMode(workspaceRoot, () => window.localStorage);
    api.setConversationModeContext(workspaceRoot, savedMode);
    setConversationMode(savedMode);
    setConversationModeWorkspaceRoot(workspaceRoot);
  }, [workspaceRoot]);

  // Keep other NUVRO AI windows on the same workspace in sync with the visible
  // mode lock. A remote switch to Chat also cancels this window's active run.
  useEffect(() => {
    if (!workspaceRoot) return;
    const onStorage = (event: StorageEvent) => {
      const next = conversationModeFromStorageEvent(workspaceRoot, event.key, event.newValue);
      if (!next) return;
      if (next === 'chat' && isWorking) {
        void api.stopAgent().catch(() => {});
        abortControllerRef.current?.abort();
        abortControllerRef.current = null;
      }
      api.setConversationModeContext(workspaceRoot, next);
      setConversationMode(next);
      setAgentBanner(next === 'chat'
        ? 'Chat mode selected in another NUVRO AI window. Workspace tools are disabled.'
        : 'Agent mode selected in another NUVRO AI window.');
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [workspaceRoot, isWorking]);

  const handleConversationModeChange = useCallback((next: 'chat' | 'agent') => {
    if (!workspaceRoot || !conversationModeReady) return;
    if (next === 'chat' && isWorking) {
      setAgentBanner('Stopping the active coding run before switching to Chat mode…');
      void api.stopAgent().catch(() => { /* the local abort below still closes this run */ });
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
    }
    api.setConversationModeContext(workspaceRoot, next);
    setConversationMode(next);
    const saved = writeConversationMode(workspaceRoot, next, () => window.localStorage);
    if (!saved) {
      setAgentBanner(`${next === 'chat' ? 'Chat' : 'Agent'} mode is active for this session, but browser storage is unavailable; after reload NUVRO AI will fail safe into Chat mode.`);
    } else if (next === 'chat') setAgentBanner('Chat mode: tools and workspace changes are disabled.');
    else setAgentBanner('Agent mode: actionable requests will edit and verify the active project.');
  }, [workspaceRoot, conversationModeReady, isWorking]);

  const handleTurboSpeedToggle = useCallback(async (next: boolean) => {
    if (!settings) return;
    const result = await api.updateSettings({ turboSpeedMode: next });
    if (result.success && result.settings) {
      setSettings(result.settings);
    }
  }, [settings]);

  const handleSettingsChanged = useCallback(async (partial: Partial<QuillixSettings>) => {
    if (!settings) return;
    const result = await api.updateSettings(partial);
    if (result.success && result.settings) {
      setSettings(result.settings);
    }
  }, [settings]);

  // Reconcile renderer state with the server-side agent lock after reloads or
  // an SSE disconnect. Without this, the UI can say Ready while settings are
  // correctly rejected by a still-running server task (or keep showing busy
  // after the server has finished).
  // Mirror isWorking into a ref so the status sync reacts to the committed
  // value instead of a stale closure, and never runs side effects from inside
  // a state updater (React may invoke updaters more than once).
  useEffect(() => { isWorkingRef.current = isWorking; }, [isWorking]);
  useEffect(() => {
    let mounted = true;
    const syncAgentStatus = async () => {
      try {
        const status = await api.getAgentStatus();
        if (!mounted) return;
        setIsWorking((current) => {
          if (status.busy && !current) return true;
          if (!status.busy && current && !abortControllerRef.current) return false;
          return current;
        });
        if (status.busy && !isWorkingRef.current) {
          setAgentBanner(status.stopping ? 'Stopping the active server taskâ€¦' : 'An agent task is already running on the serverâ€¦');
        } else if (!status.busy && isWorkingRef.current && !abortControllerRef.current) {
          setAgentBanner(null);
        }
      } catch {
        // The normal request/error flow remains authoritative if the server
        // is restarting; do not manufacture a busy state from a failed probe.
      }
    };
    void syncAgentStatus();
    const timer = window.setInterval(() => { void syncAgentStatus(); }, 3000);
    return () => window.clearInterval(timer);
  }, []);

  const refreshOllama = useCallback(async () => {
    // A stalled local service must never leave the global status pill in the
    // indefinite "Checking" state or allow overlapping status probes to pile
    // up while Ollama is loading a model. The server also has a bounded
    // upstream timeout; this client bound covers a dead renderer/API route.
    if (ollamaCheckInFlight.current) return;
    ollamaCheckInFlight.current = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    try {
      const res = await api.getOllamaStatus(settings?.model, controller.signal);
      if (res.success && res.status?.connected && res.status?.modelAvailable) {
        setOllama({ state: 'connected', model: res.status.model });
      } else if (res.success && res.status?.connected) {
        const installed = Array.isArray(res.status.availableModels) ? res.status.availableModels : [];
        const fallback = installed.find((name:string) => /qwen.*coder|qwen3/i.test(name)) || installed[0];
        if (fallback && fallback !== settings?.model) {
          const saved = await api.updateSettings({model: fallback});
          if (saved.success && saved.settings) {
            setSettings(saved.settings);
            setOllama({state:'connected', model:fallback, details:`Selected installed Ollama model ${fallback}.`});
            return;
          }
        }
        setOllama({ state: 'model-missing', model: res.status.model, details: `${res.status.details}${installed.length ? `\nInstalled models: ${installed.join(', ')}` : ''}` });
      } else if (res.success && res.status) {
        setOllama({ state: 'disconnected', details: res.status.details });
      } else {
        setOllama({
          state: 'disconnected',
          details:
            'NUVRO AI cannot connect to Ollama.\nStart Ollama and make sure your local Qwen model is installed.',
        });
      }
    } catch {
      setOllama({ state: 'disconnected', details: 'NUVRO AI cannot connect to Ollama.' });
    } finally {
      window.clearTimeout(timeout);
      ollamaCheckInFlight.current = false;
    }
  }, [settings?.model]);

  useEffect(() => {
    void refreshOllama();
    // Ollama can be started after NUVRO AI, and a model may finish loading
    // after the first probe. Keep the badge truthful without hammering the
    // service; the in-flight guard makes the interval idempotent.
    const timer = window.setInterval(() => { void refreshOllama(); }, 15000);
    return () => window.clearInterval(timer);
  }, [refreshOllama]);

  // A connection badge is evidence for the exact current provider
  // configuration, not a permanent claim. Reset it whenever the selected
  // provider, endpoint, model, or credential state changes.
  useEffect(() => {
    setSarvamConnection('untested');
    setUniversalConnection('untested');
    setOpenAIConnection('untested');
    setGrokConnection('untested');
    setNvidiaConnection('untested');
    setGroqConnection('untested');
  }, [
    settings?.aiProvider,
    settings?.offlineMode,
    settings?.model,
    settings?.openaiModel,
    settings?.grokModel,
    settings?.groqModel,
    settings?.universalProtocol,
    settings?.universalEndpoint,
    settings?.universalModel,
    settings?.activeProviderProfile,
    settings?.sarvamKeyConfigured,
    settings?.openaiKeyConfigured,
    settings?.grokKeyConfigured,
    settings?.groqKeyConfigured,
    settings?.universalKeyConfigured,
  ]);

  // --- Chat persistence helpers ---
  const persistMessages = useCallback((chatId: string, title: string, msgs: ChatMessage[]) => {
    setChats((prev) => {
      const existing = prev.find((c) => c.id === chatId);
      const updated: StoredChat = {
        id: chatId,
        title: existing?.title && existing.title !== 'New chat' ? existing.title : title,
        createdAt: existing?.createdAt || Date.now(),
        updatedAt: Date.now(),
        messages: msgs,
      };
      return saveChat(updated);
    });
  }, []);

  // M-TAVILY-3: Deep Research — plan, search, cited synthesis (SSE).
  const [researchMode, setResearchMode] = useState(false);
  const runResearch = useCallback(async (prompt: string) => {
    if (isWorking) return;
    if (!workspaceRoot || !conversationModeReady) {
      setAgentBanner('Loading the active workspace and its saved Chat/Agent mode…');
      return;
    }
    let chatId = activeChatId;
    if (!chatId) {
      const chat = createChat(prompt);
      chatId = chat.id;
      setActiveChatId(chat.id);
      setChats((prev) => [chat, ...prev]);
    }
    const userMessage: ChatMessage = { id: `msg_${Date.now()}`, role: 'user', content: prompt, timestamp: Date.now() };
    const researchMessageId = `msg_${Date.now()}_research`;
    const withBase = [...messages, userMessage];
    setMessages(withBase);
    persistMessages(chatId, prompt, withBase);
    setIsWorking(true);
    setActivities([]);
    setPhases([]);
    setAgentBanner('Researching the web…');
    lastPromptRef.current = prompt;

    const patch = (content: string, sources?: ChatMessage['sources']) => {
      setMessages(prev => [...prev.filter(m => m.id !== researchMessageId), { id: researchMessageId, role: 'assistant', content, timestamp: Date.now(), ...(sources && sources.length ? { sources } : {}) }]);
    };

    let answer = '';
    let citedSources: ChatMessage['sources'] = [];
    try {
      await api.runResearch(prompt, event => {
        if (event.type === 'plan') {
          setAgentBanner(`Researching ${Array.isArray(event.queries) ? event.queries.length : 0} planned queries…`);
          patch('', undefined);
        } else if (event.type === 'search') {
          const line = `• ${event.query}\n${event.citations}\n`;
          patch(answer + line);
        } else if (event.type === 'budget') {
          patch(`${answer}\n\n${event.message}`);
        } else if (event.type === 'answer') {
          answer += event.chunk || '';
          patch(answer);
        } else if (event.type === 'done') {
          citedSources = Array.isArray(event.sources) ? event.sources : [];
          patch(answer, citedSources);
        } else if (event.error) {
          patch(`${answer}\n\nResearch could not be completed: ${event.error}`);
        }
      });
      const finalMessages = [...withBase, { id: researchMessageId, role: 'assistant' as const, content: answer || 'Research produced no answer.', timestamp: Date.now(), ...(citedSources && citedSources.length ? { sources: citedSources } : {}) }];
      setMessages(finalMessages);
      persistMessages(chatId, prompt, finalMessages);
    } catch (error: any) {
      const failed = `${answer}\n\nResearch failed: ${String(error?.message || error)}`;
      patch(failed);
      persistMessages(chatId, prompt, [...withBase, { id: researchMessageId, role: 'assistant', content: failed, timestamp: Date.now() }]);
    } finally {
      setIsWorking(false);
      setAgentBanner('');
    }
  }, [activeChatId, conversationModeReady, createChat, isWorking, messages, persistMessages, workspaceRoot]);

  // --- Send message (SSE agent/chat run) ---
  const runAgent = useCallback(
    async (prompt: string, resumeTaskId?: string) => {
      if (isWorking) return;
      if (!workspaceRoot || !conversationModeReady) {
        setAgentBanner('Loading the active workspace and its saved Chat/Agent modeâ€¦');
        return;
      }
      // Resuming a saved checkpoint is still an Agent action. Never let the
      // resume shortcut silently override the user's explicit Chat lock.
      if (resumeTaskId && conversationMode !== 'agent') {
        setAgentBanner('Switch to Agent mode to resume this coding task. Chat mode keeps workspace tools disabled.');
        return;
      }
      const activeEditorBuffer = activeEditorBufferRef.current;
      if (activeEditorBuffer?.dirty && activeEditorBuffer.file === activeEditorFile && activeEditorBuffer.content.length > 1_000_000) {
        setAgentBanner('Save the active file before running the agent; its unsaved buffer exceeds the 1,000,000-character context limit.');
        return;
      }
      // Ask and Plan are intentionally read-only, but users often leave the
      // mode there and then issue an imperative coding request. Promote only
      // unambiguous mutations so code goes into files instead of the chat,
      // while genuine questions/plans remain read-only.
      const effectiveMode: AgentMode = resumeTaskId ? 'agent' : conversationMode === 'chat'
        ? 'ask'
        : (mode === 'ask' || mode === 'plan') && isMutationRequest(prompt, {currentFile: activeEditorFile}) ? 'agent' : mode;
      if (conversationMode === 'agent' && effectiveMode !== mode) {
        setMode(effectiveMode);
        setAgentBanner('Coding request detected â€” switched to Agent mode so files can be changed.');
      }

      let chatId = activeChatId;
      if (!chatId) {
        const chat = createChat(prompt);
        chatId = chat.id;
        setActiveChatId(chat.id);
        setChats((prev) => [chat, ...prev]);
      }

      const userMessage: ChatMessage = {
        id: `msg_${Date.now()}`,
        role: 'user',
        content: prompt,
        timestamp: Date.now(),
      };

      const currentMessages = [...messages, userMessage];
      setMessages(currentMessages);
      persistMessages(chatId, prompt, currentMessages);

      // Cursor-style workflow: one agent task = one git branch. The branch is
      // cut before the agent writes anything so all task changes stay isolated
      // until the user finishes (merge back) or discards the task.
      if (conversationMode === 'agent' && !resumeTaskId && settings?.branchPerTask !== false) {
        try {
          const branchRes = await api.gitTaskBranch(prompt);
          if (!branchRes.success && branchRes.error && !/not a git repository/i.test(branchRes.error)) {
            setAgentBanner(`Task branch: ${branchRes.error}`);
          }
        } catch {
          // Branch creation is best-effort — the task itself must still run.
        }
      }

      setIsWorking(true);
      setActivities([]);
      setPhases([]);
      setLiveFiles([]);
      setStreamingText('');
      setAgentBanner('Thinkingâ€¦');
      lastPromptRef.current = prompt;

      const controller = new AbortController();
      abortControllerRef.current = controller;

      let accumulatedPatches: FilePatch[] = [];
      let localActivities: AgentActivity[] = [];
      let localStreamingText = '';
      let localToolResults: ToolResult[] = [];
      let startedTaskId: string | undefined;

      try {
        const response = await fetch('/api/agent/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            userPrompt: prompt,
            currentFile: activeEditorFile || undefined,
            ...(activeEditorBuffer?.dirty && activeEditorBuffer.file === activeEditorFile
              ? { currentFileContent: activeEditorBuffer.content }
              : {}),
            mode: effectiveMode,
            // The server enforces this lock too; UI state alone must never be
            // the only boundary that separates conversational text from
            // workspace mutations.
            conversationMode,
            conversationHistory: messages.slice(-8),
            model: settings?.model,
            ...(resumeTaskId ? { resumeTaskId } : {}),
            verificationCommands: ['agent', 'debug', 'edit'].includes(effectiveMode) && verificationCommand.trim() ? [verificationCommand.trim()] : [],
          }),
        });

        if (!response.ok || !response.body) {
          const detail = await response.json().catch(() => null);
          throw new Error(detail?.error || `Agent request failed (HTTP ${response.status}): ${response.statusText}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let receivedTerminalEvent = false;

        // Append from the live messages list (not the run-start snapshot) so
        // messages added while the SSE stream ran — e.g. a rollback card or a
        // chat switch — are not dropped from the UI or the saved chat.
        const finalize = (assistantMessage: ChatMessage | null) => {
          setMessages((prev) => (assistantMessage ? [...prev, assistantMessage] : prev));
          if (assistantMessage && chatId) {
            persistMessages(chatId, prompt, [...messagesRef.current, assistantMessage]);
          }
        };

        while (!receivedTerminalEvent) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            let data: any;
            try {
              data = JSON.parse(line.slice(6));
            } catch {
              continue;
            }

            if (data.event === 'task_started' && typeof data.taskId === 'string') {
              startedTaskId = data.taskId;
            } else if (data.event === 'intent') {
              // Server-side chat/agent classification (informational).
            } else if (data.event === 'token') {
              localStreamingText += data.token || '';
              setStreamingText(localStreamingText);
            } else if (data.event === 'activity') {
              localActivities = [...localActivities, data.activity];
              setActivities(localActivities);
              const act: AgentActivity = data.activity;
              if (act.type === 'editing_file' || act.type === 'applying_patch') {
                const m = /(?:changes for|Applied changes to|Change staged for review:\s*)(.+)$/.exec(act.message);
                if (m) setAgentBanner(`NUVRO AI is editing ${m[1].trim()}â€¦`);
              } else if (act.type === 'running_command' || act.type === 'running_tests') {
                setAgentBanner(act.message);
              } else if (act.type === 'thinking' || act.type === 'planning') {
                setAgentBanner(act.message);
              }
            } else if (data.event === 'plan') {
              // Plans are folded into the result card; not shown permanently.
            } else if (data.event === 'phase') {
              if (Array.isArray(data.phases)) setPhases(data.phases);
            } else if (data.event === 'patch') {
              accumulatedPatches.push(data.patch);
              setLiveFiles((prev) => (prev.includes(data.patch.filePath) ? prev : [...prev, data.patch.filePath]));
              // Watch the coding process live: open the file in the editor
              // (visible whenever the workspace view is open).
              setFocusFileRequest({ path: data.patch.filePath, nonce: Date.now() });
              setAgentBanner(`NUVRO AI is editing ${data.patch.filePath}â€¦`);
            } else if (data.event === 'approval') {
              setPendingApproval({ approvalId: data.approvalId, request: data.request });
            } else if (data.event === 'done') {
              receivedTerminalEvent = true;
              const result = data.result || {};
              localToolResults = result.toolResults || localToolResults;
              const assistantMessage: ChatMessage = {
                id: `msg_assistant_${Date.now()}`,
                role: 'assistant',
                content:
                  result.finalText ||
                  (result.cancelled
                    ? 'Task cancelled.'
                    : result.patches?.length
                      ? 'Task completed. Review the changes below and apply the ones you want.'
                      : 'Task completed.'),
                timestamp: Date.now(),
                patches:
                  (result.patches && result.patches.length > 0 ? result.patches : accumulatedPatches)?.map(
                    (p: FilePatch) => ({ ...p, applied: p.applied === true })
                  ) || undefined,
                toolResults: localToolResults,
                verified: result.verified === true,
                resumable: result.resumable === true,
                plan: result.plan,
                phases: Array.isArray(result.phases) ? result.phases : undefined,
                activityLog: result.activities || localActivities,
                taskId: typeof result.taskId === 'string' ? result.taskId : undefined,
                observability: result.observability,
                rollback: result.rollback,
              };
              finalize(assistantMessage);
            } else if (data.event === 'error') {
              receivedTerminalEvent = true;
              const errorMessage: ChatMessage = {
                id: `msg_err_${Date.now()}`,
                role: 'assistant',
                content: `âŒ ${data.error || 'The agent run failed.'}`,
                timestamp: Date.now(),
                patches: accumulatedPatches,
                activityLog: localActivities,
                taskId: typeof data.taskId === 'string' ? data.taskId : undefined,
                resumable: data.resumable === true,
              };
              finalize(errorMessage);
            }
            if (receivedTerminalEvent) break;
          }
        }
        if (!receivedTerminalEvent) throw new Error('Connection ended before verification completed. Files may already have changed; review the recorded changes before continuing.');
      } catch (err: any) {
        const cancelled = err.name === 'AbortError';
        const interruptedMessage: ChatMessage = {
          id: `msg_${cancelled ? 'cancel' : 'err'}_${Date.now()}`,
          role: 'assistant',
          content: cancelled ? 'Cancelled.' : `âŒ ${err.message || 'Failed to run the agent.'}`,
          timestamp: Date.now(),
          patches: accumulatedPatches,
          activityLog: localActivities,
          // Only use the ID acknowledged by this stream. A resume request
          // may fail before creating a new task, leaving the old card valid.
          ...(startedTaskId ? { taskId: startedTaskId, resumable: true } : {}),
        };
        setMessages((prev) => [...prev, interruptedMessage]);
        if (chatId) persistMessages(chatId, prompt, [...messagesRef.current, interruptedMessage]);
      } finally {
        setIsWorking(false);
        setStreamingText('');
        setPendingApproval(null);
        setAgentBanner(null);
        abortControllerRef.current = null;
        // Files/structure may have changed â€” refresh the explorer & project meta.
        setWorkspaceRefresh((n) => n + 1);
        refreshProjectMeta();
        refreshWorkspaceState();
      }
    },
    [isWorking, workspaceRoot, conversationModeReady, activeChatId, messages, mode, conversationMode, settings?.model, verificationCommand, activeEditorFile, persistMessages, refreshProjectMeta, refreshWorkspaceState]
  );

  const handleStop = () => {
    void api.stopAgent().catch(() => { /* the local fetch abort below is still safe */ });
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
  };

  const handleApproval = async (approved: boolean) => {
    if (!pendingApproval) return;
    const { approvalId } = pendingApproval;
    setPendingApproval(null);
    try {
      const allow = approved && conversationMode === 'agent';
      if (approved && !allow) {
        setAgentBanner('Switch to Agent mode before approving a workspace or terminal action.');
      }
      await api.approveAgent(approvalId, allow);
    } catch {
      // If the request already resolved, ignore.
    }
  };

  const handleRollback = async (taskId: string) => {
    if (conversationMode !== 'agent') {
      setAgentBanner('Switch to Agent mode before rolling back workspace files.');
      return;
    }
    if (!window.confirm('Restore the files changed by this task? Manual edits detected after the task will be preserved as conflicts.')) return;
    try {
      const result = await api.rollbackTask(taskId);
      const content = result.success
        ? `Rollback complete. Restored ${result.restored?.length || 0} file(s).`
        : `Rollback stopped safely: ${result.error || 'review the reported conflicts.'}${result.conflicts?.length ? ` Conflicts: ${result.conflicts.join(', ')}` : ''}`;
      const message: ChatMessage = { id: `msg_rollback_${Date.now()}`, role: 'assistant', content, timestamp: Date.now() };
      setMessages((prev) => [...prev, message]);
      if (activeChatId) persistMessages(activeChatId, lastPromptRef.current, [...messages, message]);
      setWorkspaceRefresh((n) => n + 1);
      refreshProjectMeta();
      refreshWorkspaceState();
    } catch (error: any) {
      setMessages((prev) => [...prev, { id: `msg_rollback_error_${Date.now()}`, role: 'assistant', content: `âŒ Rollback failed: ${error?.message || 'request failed.'}`, timestamp: Date.now() }]);
    }
  };

  const handleResumeTask = (taskId: string) => {
    runAgent('Continue this task from its saved checkpoint. Inspect current files, preserve completed work, finish the remaining steps, and verify the result.', taskId);
  };

  // --- Patch apply / reject (Auto Apply Diffs OFF flow) ---
  const handleApplyPatch = async (patch: FilePatch) => {
    if (conversationMode !== 'agent') {
      setAgentBanner('Switch to Agent mode before applying code changes to workspace files.');
      setViewingPatch(null);
      return;
    }
    try {
      const content = patch.newContent || '';
      const isNew = patch.changeType === 'created';
      const res = await api.writeFile(patch.filePath, content, isNew);
      if (res.success) {
        setMessages((prev) =>
          prev.map((m) =>
            m.patches
              ? { ...m, patches: m.patches.map((p) => (p.filePath === patch.filePath ? { ...p, applied: true } : p)) }
              : m
          )
        );
        setViewingPatch(null);
        setWorkspaceRefresh((n) => n + 1);
        refreshProjectMeta();
      }
    } catch (err) {
      console.error('Failed to apply patch:', err);
    }
  };

  const handleRejectPatch = (patch: FilePatch) => {
    setMessages((prev) =>
      prev.map((m) => (m.patches ? { ...m, patches: m.patches.filter((p) => p.filePath !== patch.filePath) } : m))
    );
    setViewingPatch(null);
  };

  // --- Navigation ---
  const handleNewChat = () => {
    setActiveChatId(null);
    setMessages([]);
    setActivities([]);
    setInput('');
  };

  const handleSelectChat = (id: string) => {
    const chat = chats.find((c) => c.id === id);
    if (!chat) return;
    setActiveChatId(id);
    setMessages(chat.messages);
    setActivities([]);
  };

  const handleDeleteChat = (id: string) => {
    const remaining = deleteChat(id);
    setChats(remaining);
    if (activeChatId === id) handleNewChat();
  };

  // --- Workspace operations (shared by Dashboard, Action and the workspace view) ---
  const handleOpenWorkspace = useCallback(async () => {
    if (isWorking) {
      window.alert('Finish or stop the active agent task before switching workspaces.');
      return;
    }
    if (editorDirty && !window.confirm('Discard unsaved editor changes and open another workspace?')) return;
    try {
      let folder: string | null = null;
      if (api.isDesktopApp()) {
        folder = await api.selectNativeFolder();
      } else {
        const typed = window.prompt('Enter the full path of the project folder to open:');
        folder = typed && typed.trim() ? typed.trim() : null;
      }
      if (!folder) return;
      const res = await api.setRoot(folder);
      if (!res.success) throw new Error(res.error || 'NUVRO AI could not set that folder as the workspace.');

      const selectedRoot = res.path || folder;
      setWorkspaceRoot(selectedRoot);
      setRecentWorkspaces(previous => [selectedRoot, ...previous.filter(item => item !== selectedRoot)].slice(0, 6));
      api.setConversationModeContext(selectedRoot, readConversationMode(selectedRoot, () => window.localStorage));
      setWorkspaceRefresh((n) => n + 1);
      refreshProjectMeta();
      refreshWorkspaceState();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      window.alert(`Could not open workspace: ${detail}`);
    }
  }, [editorDirty, isWorking, refreshProjectMeta, refreshWorkspaceState]);

  const handleCreateProject = useCallback(
    async (parentPath: string, projectName: string): Promise<{ success: boolean; error?: string }> => {
      if (editorDirty && !window.confirm('Discard unsaved editor changes and create another project?')) return { success: false, error: 'Workspace change cancelled. Save your editor changes first.' };
      const res = await api.createProject(parentPath, projectName);
      if (res.success) {
        setWorkspaceRefresh((n) => n + 1);
        refreshProjectMeta();
        refreshWorkspaceState();
      }
      return res;
    },
    [editorDirty, refreshProjectMeta, refreshWorkspaceState]
  );

  const handleSelectRecentWorkspace = useCallback(
    async (folder: string) => {
      if (isWorking) {
        window.alert('Finish or stop the active agent task before switching workspaces.');
        return;
      }
      if (editorDirty && !window.confirm('Discard unsaved editor changes and switch workspace?')) return;
      try {
        const res = await api.setRoot(folder);
        if (!res.success) throw new Error(res.error || 'Could not switch to that workspace.');
        const selectedRoot = res.path || folder;
        setWorkspaceRoot(selectedRoot);
        setRecentWorkspaces(previous => [selectedRoot, ...previous.filter(item => item !== selectedRoot)].slice(0, 6));
        api.setConversationModeContext(selectedRoot, readConversationMode(selectedRoot, () => window.localStorage));
        setWorkspaceRefresh((n) => n + 1);
        refreshProjectMeta();
        refreshWorkspaceState();
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        window.alert(`Could not switch workspace: ${detail}`);
      }
    },
    [editorDirty, isWorking, refreshProjectMeta, refreshWorkspaceState]
  );

  const handleQuickAction = (prompt: string) => {
    setInput(prompt);
    setView('workspace');
    setAgentFocusSignal(value => value + 1);
    setTimeout(() => {
      document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message NUVRO AI"]')?.focus();
    }, 50);
  };

  const handleFixWithAgent = (errorLog: string) => {
    setMode('debug');
    setView('chat');
    runAgent(`Autonomous repair request for a test/build failure:\n\n${errorLog}`);
  };

  const recentActivities =
    activities.length > 0 ? activities : messages[messages.length - 1]?.activityLog || [];

  const chatPanel = (
    <ChatPanel
      variant={studioActive ? 'side' : 'page'}
      messages={messages}
      isWorking={isWorking}
      activities={activities}
      phases={phases}
      liveFiles={liveFiles}
      streamingText={streamingText}
      input={input}
      onInputChange={setInput}
      currentFile={activeEditorFile || undefined}
      verificationCommand={verificationCommand}
      onVerificationCommandChange={setVerificationCommand}
      onSend={() => {
        if (input.trim()) {
          const prompt = input.trim();
          setInput('');
          if (researchMode) void runResearch(prompt);
          else runAgent(prompt);
        }
      }}
      onStop={handleStop}
      mode={mode}
      onModeChange={setMode}
      conversationMode={conversationMode}
      conversationModeReady={conversationModeReady}
      onConversationModeChange={handleConversationModeChange}
      pendingApproval={pendingApproval}
      onResolveApproval={handleApproval}
      onViewPatch={setViewingPatch}
      onRunAgain={() => {
        if (lastPromptRef.current) runAgent(lastPromptRef.current);
      }}
      onFixWithAgent={handleFixWithAgent}
      onRollback={handleRollback}
      onResumeTask={handleResumeTask}
      onNewChat={handleNewChat}
      chats={chats}
      activeChatId={activeChatId}
      onSelectChat={handleSelectChat}
      onDeleteChat={handleDeleteChat}
      ollama={ollama}
       model={settings?.aiProvider === 'sarvam' ? 'sarvam-105b' : settings?.aiProvider === 'universal' ? (settings.providerProfiles?.find(p=>p.id===settings.activeProviderProfile)?.model || settings.universalModel) : settings?.aiProvider === 'openai' ? settings?.openaiModel : settings?.aiProvider === 'grok' ? settings?.grokModel : settings?.aiProvider === 'groq' ? settings?.groqModel : settings?.aiProvider === 'nvidia' ? settings?.nvidiaModel : settings?.model}
      provider={settings?.aiProvider || 'ollama'}
      offlineMode={settings?.offlineMode !== false}
      sarvamKeyConfigured={settings?.sarvamKeyConfigured}
      sarvamConnection={sarvamConnection}
        universalConnection={universalConnection}
        openaiConnection={openaiConnection}
       nvidiaConnection={nvidiaConnection}
      turboSpeedMode={settings?.turboSpeedMode === true}
      onToggleTurboSpeed={handleTurboSpeedToggle}
      researchMode={researchMode}
      onToggleResearch={setResearchMode}
    />
  );

  return (
      <CommandPaletteProvider>
    <div className="relative flex flex-col h-screen overflow-hidden bg-[var(--bg)] text-[var(--text)]">
      <AmbientGrid size={40} color="var(--border)" className="absolute inset-0 opacity-40" />
      <AmbientOrbs count={3} theme="dark" className="absolute inset-0" />
      <AmbientParticles count={18} className="absolute inset-0" />
      <AmbientNoise opacity={0.015} className="absolute inset-0" />
      <TopHeader
        ollama={ollama}
        provider={settings?.aiProvider || 'ollama'}
        sarvamKeyConfigured={settings?.sarvamKeyConfigured}
        sarvamConnection={sarvamConnection}
        universalConnection={universalConnection}
        openaiConnection={openaiConnection}
        grokConnection={grokConnection}
        groqConnection={groqConnection}
         nvidiaConnection={nvidiaConnection}
        offlineMode={settings?.offlineMode !== false}
        activeView={view}
        onNavigate={setView}
        onOpenSettings={() => setSettingsOpen(true)}
        turboSpeedMode={settings?.turboSpeedMode === true}
        onToggleTurboSpeed={handleTurboSpeedToggle}
      />

      {/* Primary experience: Dashboard | Chat | Action */}
      <AnimatePresence>
        {view === 'dashboard' && (
          <motion.div key="dashboard" {...motionPage} className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden">
            <DashboardView
              ollama={ollama}
              model={settings?.aiProvider === 'universal' ? (settings.providerProfiles?.find(p=>p.id===settings.activeProviderProfile)?.model || settings.universalModel) : settings?.aiProvider === 'openai' ? settings.openaiModel : settings?.aiProvider === 'grok' ? settings.grokModel : settings?.aiProvider === 'groq' ? settings.groqModel : settings?.aiProvider === 'nvidia' ? settings.nvidiaModel : settings?.model}
              provider={settings?.aiProvider || 'ollama'}
              sarvamKeyConfigured={settings?.sarvamKeyConfigured}
              sarvamConnection={sarvamConnection}
            universalConnection={universalConnection}
            openaiConnection={openaiConnection}
            grokConnection={grokConnection}
            groqConnection={groqConnection}
            nvidiaConnection={nvidiaConnection}
              offlineMode={settings?.offlineMode !== false}
              workspaceRoot={workspaceRoot}
              recentWorkspaces={recentWorkspaces}
              recentActivities={recentActivities}
              projectMeta={projectMeta}
              onQuickAction={(action) => handleQuickAction(action.prompt)}
              onOpenWorkspace={handleOpenWorkspace}
              onCreateProject={() => {
                setView('action');
                setAutoCreateSignal((n) => n + 1);
              }}
              onOpenChat={() => setView('workspace')}
              onOpenSettings={() => setSettingsOpen(true)}
              settings={settings}
              onSettingsChanged={setSettings}
              onToggleTurboSpeed={handleTurboSpeedToggle}
               onConnectionChange={(provider, status) => provider === 'sarvam' ? setSarvamConnection(status) : provider === 'openai' ? setOpenAIConnection(status) : provider === 'grok' ? setGrokConnection(status) : provider === 'nvidia' ? setNvidiaConnection(status) : provider === 'groq' ? setGroqConnection(status) : setUniversalConnection(status)}
              onRefreshOllama={refreshOllama}
              onSelectRecentWorkspace={handleSelectRecentWorkspace}
            />
          </motion.div>
        )}

        {view === 'chat' && (
          <motion.div key="chat" {...motionPage} className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden">
            {chatPanel}
          </motion.div>
        )}

        {view === 'action' && (
          <motion.div key="action" {...motionPage} className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden">
            <ActionHub
              workspaceRoot={workspaceRoot}
              autoCreateSignal={autoCreateSignal}
              onOpenWorkspace={handleOpenWorkspace}
              onCreateProject={handleCreateProject}
              onOpenExplorer={() => setWorkspaceOpen(true)}
              onOpenTerminal={() => setWorkspaceOpen(true)}
              onOpenSettings={() => setSettingsOpen(true)}
              onFixWithAgent={handleFixWithAgent}
              onWorkspaceChanged={refreshWorkspaceState}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Workspace view (explorer + editor + terminal) â€” opened from Action */}
      {(studioVisited || studioActive) && (
        <AnimatePresence mode="wait">
          <motion.div
            key={studioActive ? 'workspace-open' : 'workspace-closed'}
            initial="initial"
            animate="animate"
            exit="exit"
            variants={pageVariants}
            className={studioActive ? (workspaceOpen ? 'fixed inset-0 z-40 flex flex-col bg-[var(--bg)]' : 'flex flex-1 min-h-0 flex-col') : 'hidden'}>
          <WorkbenchLayout
            active={studioActive}
            root={workspaceRoot}
            model={settings?.aiProvider === 'ollama' ? settings.model : settings?.aiProvider === 'openai' ? settings.openaiModel || 'OpenAI' : settings?.aiProvider === 'grok' ? settings.grokModel || 'Grok' : settings?.aiProvider === 'groq' ? settings.groqModel || 'Groq' : settings?.aiProvider === 'nvidia' ? settings.nvidiaModel || 'NVIDIA NIM' : settings?.aiProvider === 'universal' ? settings.universalModel || 'Universal API' : settings?.aiProvider || 'Checking modelâ€¦'}
            branch={projectMeta?.gitBranch}
            working={isWorking}
            changedCount={liveFiles.length}
            focusSignal={agentFocusSignal}
            onCommand={action => setWorkspaceCommand({ action, nonce: Date.now() })}
            onSettings={() => setSettingsOpen(true)}
            onNewChat={handleNewChat}
            onClose={() => { setWorkspaceOpen(false); setView('dashboard'); }}
            assistant={studioActive ? chatPanel : null}
            turboSpeedMode={settings?.turboSpeedMode === true}
            onToggleTurboSpeed={handleTurboSpeedToggle}
            editor={
            <WorkspaceView
              key={workspaceRoot}
              onDirtyChange={setEditorDirty}
              onActiveFileChange={setActiveEditorFile}
              onActiveBufferChange={(file, content, dirty) => {
                activeEditorBufferRef.current = file && content !== null ? { file, content, dirty } : null;
              }}
              active={studioActive}
              conversationModeReady={conversationModeReady}
              conversationMode={conversationMode}
              commandRequest={workspaceCommand}
              onInlineRequest={(prompt, selected, file) => {
                setInput(`${prompt}\n\nFile: ${file}${selected ? `\nSelected code:\n${selected.slice(0, 5000)}` : ''}`);
                setMode(/^explain/i.test(prompt) ? 'ask' : 'agent');
                setAgentFocusSignal(value => value + 1);
              }}
              onFixWithAgent={(log) => {
                setInput(`Diagnose and fix this project failure, then rerun the failing check:\n\n${log}`);
                setMode('debug');
                setAgentFocusSignal(value => value + 1);
              }}
              agentActivities={recentActivities}
              agentBanner={agentBanner}
              focusFileRequest={focusFileRequest}
              refreshSignal={workspaceRefresh}
              agentBusy={isWorking}
              showWelcome={false}
              projectMeta={projectMeta}
              onWorkspaceChanged={() => {
                refreshProjectMeta();
                refreshWorkspaceState();
              }}
            />
            }
          />
        </motion.div>
        </AnimatePresence>
      )}

      {/* --- Overlays --- */}
      <Suspense fallback={null}>
      <SettingsScreen
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        onSettingsChanged={setSettings}
        sarvamConnection={sarvamConnection}
        universalConnection={universalConnection}
        openaiConnection={openaiConnection}
        grokConnection={grokConnection}
        nvidiaConnection={nvidiaConnection}
        onSarvamConnectionChange={setSarvamConnection}
        onUniversalConnectionChange={setUniversalConnection}
        onOpenAIConnectionChange={setOpenAIConnection}
        onGrokConnectionChange={setGrokConnection}
        onNvidiaConnectionChange={setNvidiaConnection}
        ollama={ollama}
        onRefreshOllama={refreshOllama}
      />
      </Suspense>

      <Suspense fallback={null}>
      {viewingPatch && (
        <AnimatePresence mode="wait">
          <motion.div
            key="diff-viewer-backdrop"
            initial="hidden"
            animate="visible"
            exit="exit"
            variants={modalBackdropVariants}
            className="fixed inset-0 z-50 bg-black/60"
            onClick={() => setViewingPatch(null)}
          />
          <motion.div
            key="diff-viewer"
            initial="hidden"
            animate="visible"
            exit="exit"
            variants={modalVariants}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
          >
            <motion.div
              className="w-full max-w-4xl h-[80vh] flex flex-col rounded-2xl overflow-hidden border border-[var(--border)]"
              variants={modalVariants}
            >
              <DiffViewer
                patch={viewingPatch}
                onApply={handleApplyPatch}
                onReject={handleRejectPatch}
                onClose={() => setViewingPatch(null)}
              />
            </motion.div>
          </motion.div>
        </AnimatePresence>
      )}
      </Suspense>

      {/* Command Palette */}
      <Suspense fallback={null}>
      <CommandPalette
        isOpen={commandPalette.isOpen}
        onClose={commandPalette.close}
        onExecuteAction={(actionId) => {
          // Handle built-in actions
          switch (actionId) {
            case 'nav.open-workspace':
              handleOpenWorkspace();
              break;
            case 'nav.file-explorer':
              setWorkspaceOpen(true);
              break;
            case 'nav.go-to-file':
              // Trigger file search in workspace
              setWorkspaceOpen(true);
              setTimeout(() => {
                document.querySelector<HTMLInputElement>('input[placeholder*="Search files"]')?.focus();
              }, 50);
              break;
            case 'nav.go-to-symbol':
              // Trigger symbol search in editor
              setWorkspaceOpen(true);
              break;
            case 'editor.new-file':
              // Focus editor and trigger new file
              setWorkspaceOpen(true);
              break;
            case 'editor.save':
              // Save active file
              if (activeEditorFile) {
                const editorArea = document.querySelector('[data-testid="editor-area"]') as any;
                // This will be handled by the editor
              }
              break;
            case 'editor.toggle-terminal':
              setWorkspaceOpen(true);
              break;
            case 'editor.toggle-sidebar':
              setWorkspaceOpen(!workspaceOpen);
              break;
            case 'ai.inline-prompt':
              // Trigger inline AI in editor
              setWorkspaceOpen(true);
              break;
            case 'ai.chat':
              setView('workspace');
              break;
            case 'project.run':
              runAgent('Run the project using the configured run command.');
              break;
            case 'project.build':
              runAgent('Build the project using the configured build command.');
              break;
            case 'project.test':
              runAgent('Run tests for the project.');
              break;
            case 'project.create':
              setView('action');
              setAutoCreateSignal(n => n + 1);
              break;
            case 'project.settings':
              setSettingsOpen(true);
              break;
            case 'settings.open':
              setSettingsOpen(true);
              break;
            case 'help.shortcuts':
              setSettingsOpen(true);
              // Navigate to shortcuts tab
              break;
            default:
              // Custom actions will be handled by their onExecute
              break;
          }
        }}
        customActions={[]}
        workspaceRoot={workspaceRoot}
        activeFile={activeEditorFile || undefined}
        hasActiveProject={!!workspaceRoot}
      />

      </Suspense>

      {/* Onboarding Flow */}
      <Suspense fallback={null}>
      {showOnboarding && (
        <OnboardingFlow
          settings={settings!}
          onSettingsChanged={handleSettingsChanged}
          onComplete={() => setShowOnboarding(false)}
          onSkip={() => setShowOnboarding(false)}
        />
      )}
      </Suspense>
    </div>
      </CommandPaletteProvider>
  );
}
