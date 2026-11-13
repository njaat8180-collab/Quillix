import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Cpu, MessageSquarePlus, History, Sparkles, ArrowUpRight, Code2, Bug, TestTube2, ChevronDown, Search, Trash2, Clock3, MessageCircle, X } from 'lucide-react';
import { AgentActivity, AgentMode, AgentPhase, ChatMessage, FilePatch } from '../shared/types.js';
import { ChatView, ApprovalCard } from './ChatView.js';
import { Composer } from './Composer.js';
import { OllamaState } from './TopHeader.js';
import { StoredChat } from '../chatStore.js';
import { QuillixMark } from './QuillixMark.js';
import { 
  staggerContainerFastVariants,
  messageVariants,
  slideUpVariants,
  popoverVariants,
  cardHoverVariants,
  fadeVariants,
  motionFadeIn,
  motionSlideUp,
} from '../animations/index.js';

export interface PendingApproval {
  approvalId: string;
  request: { kind: 'terminal' | 'git' | 'file'; title: string; command?: string; reason?: string };
}

interface ChatPanelProps {
  /** 'side' = narrow right rail inside the workspace view; 'page' = full chat page. */
  variant?: 'side' | 'page';
  messages: ChatMessage[];
  isWorking: boolean;
  activities: AgentActivity[];
  /** Live request-adaptive phase workflow state (agent runs). */
  phases?: AgentPhase[];
  /** Files written so far in the current live run. */
  liveFiles?: string[];
  streamingText: string;
  input: string;
  onInputChange: (value: string) => void;
  currentFile?: string;
  verificationCommand?: string;
  onVerificationCommandChange?: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  mode: AgentMode;
  onModeChange: (mode: AgentMode) => void;
  conversationMode: 'chat' | 'agent';
  conversationModeReady?: boolean;
  onConversationModeChange: (mode: 'chat' | 'agent') => void;
  pendingApproval: PendingApproval | null;
  onResolveApproval: (approved: boolean) => void;
  onViewPatch: (patch: FilePatch) => void;
  onRunAgain: () => void;
  onFixWithAgent?: (errorLog: string) => void;
  onRollback?: (taskId: string) => void;
  onResumeTask?: (taskId: string) => void;
  onNewChat: () => void;
  chats: StoredChat[];
  activeChatId: string | null;
  onSelectChat: (id: string) => void;
  onDeleteChat: (id: string) => void;
  ollama: OllamaState;
  model?: string;
  provider?: string;
  offlineMode?: boolean;
  sarvamKeyConfigured?: boolean;
  sarvamConnection?: 'untested' | 'checking' | 'connected' | 'failed';
  universalConnection?: 'untested' | 'checking' | 'connected' | 'failed';
  openaiConnection?: 'untested' | 'checking' | 'connected' | 'failed';
  nvidiaConnection?: 'untested' | 'checking' | 'connected' | 'failed';
  turboSpeedMode?: boolean;
  onToggleTurboSpeed?: (next: boolean) => void;
  /** M-TAVILY-3: Deep Research toggle for the next send. */
  researchMode?: boolean;
  onToggleResearch?: (next: boolean) => void;
}

/**
 * Right-side chat panel: the conversation with NUVRO AI (Normal Chat Mode and
 * Coding Agent Mode both live here). The center of the app stays reserved
 * for code; this panel is always available while the agent works.
 */
export const ChatPanel: React.FC<ChatPanelProps> = ({
  variant = 'side',
  messages,
  isWorking,
  activities,
  phases,
  liveFiles,
  streamingText,
  input,
  onInputChange,
  currentFile,
  verificationCommand,
  onVerificationCommandChange,
  onSend,
  onStop,
  mode,
  onModeChange,
  conversationMode,
  conversationModeReady = true,
  onConversationModeChange,
  pendingApproval,
  onResolveApproval,
  onViewPatch,
  onRunAgain,
  onFixWithAgent,
  onRollback,
  onResumeTask,
  onNewChat,
  chats,
  activeChatId,
  onSelectChat,
  onDeleteChat,
  ollama,
  model,
  provider = 'ollama',
  offlineMode = true,
  sarvamKeyConfigured = false,
  sarvamConnection = 'untested', universalConnection = 'untested', openaiConnection = 'untested', nvidiaConnection = 'untested',
  turboSpeedMode = false, onToggleTurboSpeed,
  researchMode = false, onToggleResearch,
}) => {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyQuery, setHistoryQuery] = useState('');
  const composerInputRef = useRef<HTMLTextAreaElement>(null);
  const historyTriggerRef = useRef<HTMLButtonElement>(null);

  // Keyboard accessibility for the history popover (WCAG dialog pattern):
  // Escape closes it and returns focus to the trigger.
  useEffect(() => {
    if (!historyOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setHistoryOpen(false);
      historyTriggerRef.current?.focus();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [historyOpen]);
  const isSarvam = provider === 'sarvam';
  const isUniversal = provider === 'universal';
  const isOpenAI = provider === 'openai';
  const isNvidia = provider === 'nvidia';
  const statusColor = isOpenAI ? (openaiConnection === 'connected' && !offlineMode ? 'var(--success)' : openaiConnection === 'failed' ? 'var(--danger)' : 'var(--warning)') : isNvidia ? (nvidiaConnection === 'connected' && !offlineMode ? 'var(--success)' : nvidiaConnection === 'failed' ? 'var(--danger)' : 'var(--warning)') : isUniversal ? (universalConnection === 'connected' && !offlineMode ? 'var(--success)' : universalConnection === 'failed' ? 'var(--danger)' : 'var(--warning)') : isSarvam
    ? (offlineMode || !sarvamKeyConfigured ? 'var(--warning)' : sarvamConnection === 'connected' ? 'var(--success)' : sarvamConnection === 'failed' ? 'var(--danger)' : 'var(--text-muted)')
    : ollama.state === 'connected' ? 'var(--success)' : ollama.state === 'model-missing' ? 'var(--warning)' : 'var(--danger)';
  const statusText = isOpenAI ? (offlineMode?'OpenAI blocked (offline)':openaiConnection==='connected'?'OpenAI · Verified':openaiConnection==='failed'?'OpenAI · Test failed':'OpenAI · Not verified') : isNvidia ? (offlineMode ? 'NVIDIA NIM blocked (offline)' : nvidiaConnection === 'connected' ? 'NVIDIA NIM · Verified' : nvidiaConnection === 'failed' ? 'NVIDIA NIM · Test failed' : 'NVIDIA NIM · Not verified') : isUniversal ? (offlineMode ? 'Universal API blocked (offline)' : universalConnection === 'connected' ? 'Universal API · Verified' : universalConnection === 'failed' ? 'Universal API · Test failed' : 'Universal API · Not verified') : isSarvam
    ? (offlineMode ? 'Sarvam blocked (offline)' : !sarvamKeyConfigured ? 'Sarvam · Key needed' : sarvamConnection === 'connected' ? 'Sarvam verified' : sarvamConnection === 'failed' ? 'Sarvam test failed' : 'Sarvam · Not verified')
    : ollama.state === 'connected' ? 'Ollama Connected' : ollama.state === 'model-missing' ? 'Model Not Found' : 'Ollama Disconnected';

  const activeChat = chats.find((c) => c.id === activeChatId) || null;
  const visibleChats = useMemo(() => {
    const query = historyQuery.trim().toLowerCase();
    return [...chats]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .filter((chat) => !query || chat.title.toLowerCase().includes(query) || chat.messages.some((message) => message.content.toLowerCase().includes(query)));
  }, [chats, historyQuery]);
  const otherCloud = provider === 'groq' || provider === 'grok';
  const badgeColor = otherCloud ? 'var(--warning)' : statusColor;
  const badgeText = otherCloud ? `${provider === 'groq' ? 'Groq' : 'Grok'} · ${offlineMode ? 'Blocked (offline)' : 'Verify in Settings'}` : statusText;
  const lastActivity = activities.length
    ? activities[activities.length - 1]
    : messages[messages.length - 1]?.activityLog?.slice(-1)[0];
  const latestObservability = [...messages].reverse().find((message) => message.observability)?.observability;
  const latestTokens = latestObservability?.actualTotalTokens ?? latestObservability?.estimatedTotalTokens;
  const tokenLabel = latestTokens === undefined
    ? null
    : `${latestTokens.toLocaleString()}${latestObservability?.tokenCountSource === 'estimate' ? ' est.' : ''}`;
  const activePhase = phases?.find((phase) => phase.status === 'in_progress') || phases?.find((phase) => phase.status === 'failed') || phases?.find((phase) => phase.status === 'pending');

  const emptyState = !messages.length && !isWorking ? (
    <motion.div
      key="welcome"
      className="q-agent-welcome"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.4 }}
    >
      <motion.div className="q-agent-welcome-icon" initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 300, damping: 15, delay: 0.2 }}><QuillixMark size={28} /></motion.div>
      <motion.span className="q-atlas-agent-kicker" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>A SECOND MIND. IN YOUR CORNER.</motion.span>
      <motion.h2 initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}>Big thought?<br /><em>Let's work it out.</em></motion.h2>
      <motion.p initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>Give me a little direction. We'll turn it into a clear next step.</motion.p>
      <motion.div className="q-agent-suggestions" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.45 }}>
        {[
          { label: 'Understand this project', prompt: 'Explain the architecture and main entry points of this project.', mode: 'ask' as AgentMode, icon: Code2 },
          { label: 'Debug an issue', prompt: 'Help me investigate a bug in this project. Here are the details: ', mode: 'debug' as AgentMode, icon: Bug },
          { label: 'Run project checks', prompt: 'Run the configured project tests and build. Investigate and repair any failures.', mode: 'agent' as AgentMode, icon: TestTube2 },
        ].map((item, index) => (
          <motion.button
            key={item.label}
            onClick={() => { onModeChange(item.mode); onInputChange(item.prompt); }}
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.5 + index * 0.1, type: 'spring', stiffness: 400, damping: 20 }}
            whileHover={{ scale: 1.02, y: -2 }}
            whileTap={{ scale: 0.98 }}
          >
            <item.icon size={14} />
            <span>{item.label}</span>
            <ArrowUpRight size={13} />
          </motion.button>
        ))}
      </motion.div>
      <motion.span className="q-agent-welcome-note" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6 }}>Your decisions. Real tools.<br />Every change, out in the open.</motion.span>
    </motion.div>
  ) : null;

  return (
    <motion.aside
      className={
        variant === 'page'
          ? 'flex-1 min-h-0 flex flex-col min-w-0 overflow-hidden bg-[var(--bg)]'
          : 'q-studio-chat w-full h-full min-h-0 bg-[var(--surface)] flex flex-col min-w-0 overflow-hidden'
      }
      aria-label="Chat"
      {...motionFadeIn}
    >
      {/* Chat header */}
      <motion.div className="q-chat-header px-3 sm:px-5 py-3 border-b border-[var(--border)] flex items-center gap-2 shrink-0" {...motionSlideUp}>
        <span className="text-[13px] font-semibold tracking-wide text-[var(--text)]">{variant === 'side' ? 'Agent' : 'QUILLIX'}</span>
        <div className="flex items-center gap-1 text-[11px] text-[var(--text-muted)] truncate">
          <Cpu size={11} style={{ color: badgeColor }} />
          <span style={{ color: badgeColor }} className="truncate">{badgeText}</span>
          {model && <span className="font-mono text-[10px] truncate hidden lg:inline">· {model}</span>}
        </div>

        <div className="flex-1" />

        {/* Animated chat history picker with inline actions. */}
        <div className="q-chat-history-wrap relative">
          <button
            type="button"
            ref={historyTriggerRef}
            onClick={() => setHistoryOpen((open) => !open)}
            className={`q-chat-history-trigger q-transition ${historyOpen ? 'q-chat-history-trigger-open' : ''}`}
            title={activeChat ? activeChat.title : 'Chat history'}
            aria-label="Chat history"
            aria-expanded={historyOpen}
            aria-haspopup="dialog"
          >
            <History size={12} />
            <span>{activeChat?.title || 'History'}</span>
            <ChevronDown size={12} className={historyOpen ? 'q-chat-history-chevron-open' : ''} />
          </button>
          {historyOpen && (
            <AnimatePresence mode="wait">
              <motion.div
                key="chat-history-popover"
                initial="hidden"
                animate="visible"
                exit="exit"
                variants={popoverVariants}
                className="q-chat-history-popover"
                role="dialog"
                aria-label="Chat history picker"
              >
                <motion.div className="q-chat-history-popover-head" {...motionFadeIn}>
                  <motion.div {...motionSlideUp}><span className="q-chat-history-kicker">CONVERSATIONS</span><strong>Chat history</strong></motion.div>
                  <motion.button type="button" onClick={() => setHistoryOpen(false)} className="q-chat-history-close" aria-label="Close chat history" whileHover={{ rotate: 90 }} whileTap={{ scale: 0.9 }}><X size={14} /></motion.button>
                </motion.div>
                <motion.div className="q-chat-history-search" {...motionSlideUp}>
                  <Search size={13} />
                  <motion.input autoFocus value={historyQuery} onChange={(event) => setHistoryQuery(event.target.value)} placeholder="Search chats…" aria-label="Search chats" whileFocus={{ scale: 1.01 }} />
                  {historyQuery && <motion.button type="button" onClick={() => setHistoryQuery('')} aria-label="Clear chat search" whileHover={{ rotate: 90 }} whileTap={{ scale: 0.9 }}><X size={12} /></motion.button>}
                </motion.div>
                <motion.div className="q-chat-history-list" variants={staggerContainerFastVariants}>
                  {!visibleChats.length ? (
                    <motion.div className="q-chat-history-empty" variants={fadeVariants}><MessageCircle size={18} /><span>{chats.length ? 'No matching chats' : 'No saved chats yet'}</span></motion.div>
                  ) : visibleChats.map((chat) => (
                    <motion.div key={chat.id} className={`q-chat-history-item ${chat.id === activeChatId ? 'q-chat-history-item-active' : ''}`} variants={cardHoverVariants} whileHover={{ x: 4 }}>
                      <motion.button type="button" className="q-chat-history-select" onClick={() => { onSelectChat(chat.id); setHistoryOpen(false); setHistoryQuery(''); }} whileTap={{ scale: 0.98 }}>
                        <span className="q-chat-history-item-icon"><MessageCircle size={13} /></span>
                        <span className="q-chat-history-item-copy"><strong>{chat.title}</strong><small><Clock3 size={10} /> {new Date(chat.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · {chat.messages.length} messages</small></span>
                      </motion.button>
                      <motion.button type="button" className="q-chat-history-delete" onClick={() => { onDeleteChat(chat.id); if (chat.id === activeChatId) setHistoryOpen(false); }} aria-label={`Delete chat ${chat.title}`} title="Delete chat" whileHover={{ scale: 1.2, rotate: 180 }} whileTap={{ scale: 0.8 }}><Trash2 size={13} /></motion.button>
                    </motion.div>
                  ))}
                </motion.div>
                <motion.button type="button" className="q-chat-history-new" onClick={() => { onNewChat(); setHistoryOpen(false); setHistoryQuery(''); }} whileHover={{ x: 4 }} whileTap={{ scale: 0.98 }}><MessageSquarePlus size={13} /> New conversation</motion.button>
              </motion.div>
            </AnimatePresence>
          )}
        </div>
        <motion.button
          onClick={onNewChat}
          className="q-transition p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--hover)]"
          title="New chat"
          aria-label="New chat"
          whileHover={{ scale: 1.1, rotate: 90 }}
          whileTap={{ scale: 0.9 }}
        >
          <MessageSquarePlus size={15} />
        </motion.button>
      </motion.div>

      {/* Current status strip: live state first, then compact evidence from the last run. */}
      <div
        className={`q-agent-status-strip ${pendingApproval && isWorking ? 'q-agent-status-awaiting' : ''}`}
        aria-live="polite"
        aria-atomic="true"
      >
        {isWorking ? (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
          >
            <motion.span className="q-agent-status-live" aria-hidden="true" animate={{ scale: [1, 1.3, 1] }} transition={{ duration: 1, repeat: Infinity }} />
            <motion.span className="q-agent-status-label" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }}>{`Agent ${mode.toUpperCase()} mode`}</motion.span>
            <motion.span className="q-agent-status-detail" title={lastActivity?.message || 'Working'} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 }}>{lastActivity?.message || 'Working…'}</motion.span>
          </motion.div>
        ) : lastActivity ? (
          <motion.span className="q-agent-status-detail" title={lastActivity.message} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>Idle · {lastActivity.message}</motion.span>
        ) : (
          <motion.span className="q-agent-status-detail" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>Ready for a task</motion.span>
        )}
        <AnimatePresence>
          {isWorking && activePhase && (
            <motion.span
              key="active-phase"
              className="q-agent-status-chip q-agent-status-phase"
              title={`Current phase: ${activePhase.title}`}
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 500, damping: 20 }}
            >
              {activePhase.title}
            </motion.span>
          )}
          {pendingApproval && isWorking && (
            <motion.span
              key="approval-needed"
              className="q-agent-status-chip q-agent-status-chip-warning"
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 500, damping: 20 }}
            >
              Approval needed
            </motion.span>
          )}
        </AnimatePresence>
        {!isWorking && latestObservability && (
          <motion.div className="q-agent-evidence" aria-label="Last run evidence" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
            {tokenLabel && <motion.span className="q-agent-status-chip" title="Provider-reported tokens when available; otherwise an estimate" whileHover={{ scale: 1.05 }}>{tokenLabel} tokens</motion.span>}
            {latestObservability.messageHistoryReductionPercent !== undefined && <motion.span className="q-agent-status-chip" title="Serialized provider message-array characters compared with the full conversation history. This is not provider-token savings; system instructions and tool schemas are excluded." whileHover={{ scale: 1.05 }}>History {latestObservability.messageHistoryReductionPercent >= 0 ? '−' : '+'}{Math.abs(latestObservability.messageHistoryReductionPercent).toFixed(0)}%</motion.span>}
            {latestObservability.verificationRuns > 0 && <motion.span className="q-agent-status-chip q-agent-status-chip-success" whileHover={{ scale: 1.05 }}>{latestObservability.verificationRuns} verified</motion.span>}
            {latestObservability.modelCalls !== undefined && <motion.span className="q-agent-status-chip" whileHover={{ scale: 1.05 }}>{latestObservability.modelCalls} model call{latestObservability.modelCalls === 1 ? '' : 's'}</motion.span>}
          </motion.div>
        )}
      </div>

      {/* Keep the empty-state onboarding inside the same scroll region as messages. */}
      <ChatView
        messages={messages}
        isWorking={isWorking}
        emptyState={emptyState}
        activities={activities}
        phases={phases}
        liveFiles={liveFiles}
        streamingText={streamingText}
        onViewPatch={onViewPatch}
        onContinue={() => {
          composerInputRef.current?.focus();
        }}
        onRunAgain={onRunAgain}
        onFixWithAgent={onFixWithAgent}
        onRollback={onRollback}
        onResumeTask={onResumeTask}
      />

      {/* Pending approval shown inline above the composer */}
      <AnimatePresence>
        {pendingApproval && isWorking && (
          <motion.div
            key="pending-approval"
            className="px-3 pb-2 shrink-0"
            initial={{ opacity: 0, y: -10, height: 0 }}
            animate={{ opacity: 1, y: 0, height: 'auto' }}
            exit={{ opacity: 0, y: 10, height: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
          >
            <ApprovalCard
              request={pendingApproval.request}
              onApprove={() => onResolveApproval(true)}
              onDeny={() => onResolveApproval(false)}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Composer */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
        <Composer
        value={input}
        onChange={onInputChange}
        currentFile={currentFile}
        verificationCommand={verificationCommand}
        onVerificationCommandChange={onVerificationCommandChange}
        onSend={onSend}
        onStop={onStop}
        isWorking={isWorking}
        mode={mode}
        onModeChange={onModeChange}
        conversationMode={conversationMode}
        conversationModeReady={conversationModeReady}
        onConversationModeChange={onConversationModeChange}
        provider={provider}
        offlineMode={offlineMode}
        turboSpeedMode={turboSpeedMode}
        onToggleTurboSpeed={onToggleTurboSpeed}
        researchMode={researchMode}
        onToggleResearch={onToggleResearch}
        turboSpeedLocked={isWorking}
        inputRef={composerInputRef}
        />
      </motion.div>
    </motion.aside>
  );
};
