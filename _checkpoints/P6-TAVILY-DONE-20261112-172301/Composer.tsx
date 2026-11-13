import React, { useId, useRef, useState } from "react";
import { ArrowUp, Square, MessageCircle, Wrench, Zap, Globe } from "lucide-react";
import { AgentMode } from "../shared/types.js";

const MODES: Array<{ id: AgentMode; label: string; title: string }> = [
  { id: "agent", label: "Agent", title: "Execute tasks autonomously" },
  { id: "ask", label: "Ask", title: "Answer questions without modifying code" },
  { id: "plan", label: "Plan", title: "Analyze and produce an implementation plan" },
  { id: "debug", label: "Debug", title: "Investigate and fix errors" },
];
interface ComposerProps {
  value: string;
  currentFile?: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  isWorking: boolean;
  mode: AgentMode;
  onModeChange: (mode: AgentMode) => void;
  conversationMode: "chat" | "agent";
  conversationModeReady?: boolean;
  onConversationModeChange: (mode: "chat" | "agent") => void;
  provider?: string;
  offlineMode?: boolean;
  verificationCommand?: string;
  onVerificationCommandChange?: (value: string) => void;
  turboSpeedMode?: boolean;
  onToggleTurboSpeed?: (next: boolean) => void;
  turboSpeedLocked?: boolean;
  /** M-TAVILY-3: research mode routes the next send through Deep Research. */
  researchMode?: boolean;
  onToggleResearch?: (next: boolean) => void;
  /** Lets the parent focus the message input without querying the DOM. */
  inputRef?: React.RefObject<HTMLTextAreaElement | null>;
}

export const Composer: React.FC<ComposerProps> = ({
  value,
  currentFile,
  onChange,
  onSend,
  onStop,
  isWorking,
  mode,
  onModeChange,
  conversationMode,
  conversationModeReady = true,
  onConversationModeChange,
  provider = "ollama",
  offlineMode = true,
  verificationCommand = "",
  onVerificationCommandChange,
  turboSpeedMode = false,
  onToggleTurboSpeed,
  turboSpeedLocked = false,
  researchMode = false,
  onToggleResearch,
  inputRef,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messageInputRef = inputRef ?? textareaRef;
  const verificationId = useId();
  const modeTabRefs = useRef(new Map<AgentMode, HTMLButtonElement | null>());
  const [verificationOpen, setVerificationOpen] = useState(false);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!isWorking && value.trim()) onSend();
    }
  };

  // WAI-ARIA keyboard patterns for the custom controls in this composer:
  // radiogroups and tablists move selection with arrow keys.
  const conversationModes: Array<"chat" | "agent"> = ["chat", "agent"];
  const onConversationModeKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const current = conversationModes.indexOf(conversationMode);
    const next = conversationModes[(current + (event.key === "ArrowRight" ? 1 : conversationModes.length - 1)) % conversationModes.length];
    if (next !== conversationMode) onConversationModeChange(next);
  };

  const onAgentModeKeyDown = (event: React.KeyboardEvent, index: number) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next = MODES[(index + (event.key === "ArrowRight" ? 1 : MODES.length - 1)) % MODES.length];
    if (next.id !== mode) {
      onModeChange(next.id);
      requestAnimationFrame(() => modeTabRefs.current.get(next.id)?.focus());
    }
  };

  return (
    <div className="px-4 sm:px-6 pb-4 pt-2 shrink-0">
      <div className="max-w-3xl mx-auto">
        <div
          className="q-composer rounded-2xl border border-[var(--border)] bg-[var(--composer-bg)] shadow-lg focus-within:border-[var(--accent)] q-transition overflow-hidden"
          style={{ boxShadow: "var(--shadow)" }}
        >
          {/* Explicit conversation mode: this is the authoritative Chat vs
              Agent switch. The finer workflow tabs remain available only in
              Agent mode and cannot override Chat mode. */}
          <div className="q-conversation-mode-row" role="group" aria-label="Conversation mode" aria-busy={!conversationModeReady}>
            <span className="q-conversation-mode-label">WORKSPACE MODE</span>
            <div className="q-conversation-mode-toggle" role="radiogroup" aria-label="Choose Chat or Agent mode">
              <button
                type="button"
                role="radio"
                aria-checked={conversationMode === "chat"}
                disabled={!conversationModeReady}
                onClick={() => onConversationModeChange("chat")}
                className={`q-conversation-mode-button ${conversationMode === "chat" ? "q-conversation-mode-active" : ""}`}
                title="Chat only: no files, terminal, preview or workspace changes"
              >
                <MessageCircle size={12} /> Chat
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={conversationMode === "agent"}
                disabled={!conversationModeReady}
                onClick={() => onConversationModeChange("agent")}
                className={`q-conversation-mode-button ${conversationMode === "agent" ? "q-conversation-mode-active" : ""}`}
                title="Agent: tools, file edits, terminal, preview"
              >
                <Wrench size={12} /> Agent
              </button>
            </div>
            {onToggleTurboSpeed && (
              <div className="q-turbo-toggle" role="switch" aria-checked={turboSpeedMode === true}>
                <button
                  type="button"
                  role="switch"
                  aria-checked={turboSpeedMode === true}
                  disabled={turboSpeedLocked === true}
                  onClick={() => onToggleTurboSpeed(turboSpeedMode !== true)}
                  title={turboSpeedMode === true ? "Turbo Speed ON: adaptive pacing active (respects provider limits)" : "Turbo Speed OFF: conservative pacing"}
                  className={`q-turbo-toggle-button ${turboSpeedMode === true ? "q-turbo-toggle-on" : ""}`}
                >
                  <Zap size={13} className="q-turbo-toggle-icon" />
                  <span className="q-turbo-toggle-text">Turbo Speed</span>
                  <span className="q-turbo-toggle-state">{turboSpeedMode === true ? "ON" : "OFF"}</span>
                </button>
                {turboSpeedMode === true && <span className="q-turbo-pulse" aria-hidden="true" />}
              </div>
            )}
            {onToggleResearch && (
              <button
                type="button"
                role="switch"
                aria-checked={researchMode === true}
                disabled={offlineMode === true || !conversationModeReady}
                onClick={() => onToggleResearch(researchMode !== true)}
                title={offlineMode === true ? 'Deep Research needs Online Mode and Tavily consent (Settings → Tavily)' : researchMode === true ? 'Deep Research ON: this question is researched on the web and answered with citations' : 'Deep Research OFF: answer without web research'}
                className={`flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold q-transition ${researchMode === true ? 'text-white' : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--hover)]'}`}
                style={researchMode === true ? { background: 'var(--accent)', color: 'var(--accent-ink)' } : undefined}
              >
                <Globe size={13} />
                <span>Research</span>
                <span className="opacity-70">{researchMode === true ? 'ON' : 'OFF'}</span>
              </button>
            )}
            <span className={`q-conversation-mode-state ${conversationMode === "chat" ? "q-conversation-mode-chat" : ""}`}>
              {!conversationModeReady ? "Loading saved mode…" : conversationMode === "chat" ? "Chat only" : "Tools enabled"}
            </span>
          </div>

          {conversationMode === "agent" && <div className="flex items-center gap-1 px-3 pt-1.5 flex-wrap" role="tablist" aria-label="Agent workflow">
            {MODES.map((m) => (
              <button key={m.id} role="tab" aria-selected={mode === m.id} onClick={() => onModeChange(m.id)} title={m.title}
                className={`px-2.5 py-1 rounded-full text-[11px] font-semibold q-transition ${mode === m.id ? "text-white" : "text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--hover)]"}`}
                style={mode === m.id ? { background: "var(--accent)", color: "var(--accent-ink)" } : undefined}>{m.label}</button>
            ))}
          </div>
          }

          {currentFile && <p className="mx-4 mt-2 truncate text-[10px] text-[var(--text-muted)]" title={currentFile}>Saved file context · {currentFile}</p>}
          <textarea
            ref={messageInputRef}
            rows={2}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="A thought, a bug, a wild idea…"
            aria-label="Message NUVRO AI"
            className="w-full bg-transparent px-4 py-3 text-sm text-[var(--text)] placeholder-[var(--text-muted)] outline-none resize-none min-h-[56px]"
            disabled={isWorking || !conversationModeReady}
          />

          {onVerificationCommandChange && ["agent", "debug", "edit"].includes(mode) && (
            <details className="mx-3 mb-2 rounded-lg border border-[var(--border)] text-[11px]">
              <summary
                className="cursor-pointer px-2 py-1.5 text-[var(--text-muted)]"
                aria-expanded={verificationOpen}
                onClick={(e) => {
                  e.preventDefault();
                  setVerificationOpen(!verificationOpen);
                }}
              >
                Acceptance check{verificationCommand.trim() ? " · configured" : " · optional"}
              </summary>
              <div className="px-2 pb-2">
                <label className="block text-[var(--text-muted)] mb-1" htmlFor={verificationId}>Test command for this workspace session</label>
                <input id={verificationId} aria-label="Acceptance check command" value={verificationCommand}
                  onChange={event => onVerificationCommandChange(event.target.value)} disabled={isWorking} maxLength={2000}
                  placeholder="e.g. python -m pytest or node --test"
                  className="w-full min-w-0 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-2 text-[var(--text)] outline-none focus:border-[var(--accent)]" />
                <p className="mt-1 text-[var(--text-muted)]">Runs after edits and repairs through normal permissions. Cleared when switching folders; do not enter secrets.</p>
              </div>
            </details>
          )}

          <div className="flex items-center justify-between px-3 pb-2.5">
            <span className="text-[10px] text-[var(--text-muted)]">
              Enter to send · Shift + Enter for a new line
            </span>
            {isWorking ? (
              <button
                onClick={onStop}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-white text-xs font-semibold q-transition hover:opacity-90"
                style={{ background: "var(--danger)" }}
                aria-label="Stop generating"
              >
                <Square size={12} />
                Stop
              </button>
            ) : (
              <button
                onClick={onSend}
                disabled={!value.trim() || !conversationModeReady}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-white text-xs font-semibold q-transition disabled:opacity-40 hover:opacity-90"
                style={{ background: "var(--accent)", color: "var(--accent-ink)" }}
                aria-label="Send message"
              >
                <ArrowUp size={13} />
                Send
              </button>
            )}
          </div>
        </div>
        <p className="text-center text-[10px] text-[var(--text-muted)] mt-2">
          {provider === "ollama" ? "Your local model. Your workspace. Approve consequential actions before execution." : offlineMode ? "Cloud requests are blocked by Offline Mode." : "Your selected cloud provider may consume credits. Review changes before running code."}
        </p>
      </div>
    </div>
  );
};
