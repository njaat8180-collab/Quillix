import React, { useEffect, useRef, useState } from "react";
import { Activity, ArrowRight, Bot, Braces, Bug, Check, ChevronRight, Command, FileSearch, FolderOpen, GitBranch, History, PanelRightClose, PanelRightOpen, Search, Settings2, Target, TerminalSquare, X, Zap, Monitor } from "lucide-react";
import { api } from "../services/apiBridge.js";
import { MissionControlPanel } from "./MissionControlPanel.js";
import { GoalProgressSidebar } from "./GoalProgressSidebar.js";
import { PerformanceMonitor } from "./PerformanceMonitor.js";
import { DeveloperCockpit } from "./DeveloperCockpit.js";
import { TaskHistoryPanel } from "./TaskHistoryPanel.js";
import type { ProviderHealthSummary } from "../shared/types.js";

export type WorkspaceCommand = "explorer" | "search" | "git" | "build" | "debug" | "terminal";

const PROVIDER_HEALTH_LABELS: Record<ProviderHealthSummary["availability"], string> = {
  ok: "healthy",
  throttled: "throttled",
  auth: "auth error",
  billing: "billing issue",
  cooldown: "cooldown",
  "circuit-open": "circuit open",
  degraded: "degraded",
  unknown: "no data",
};

const PROVIDER_HEALTH_ICON_COLORS: Record<ProviderHealthSummary["availability"], string> = {
  ok: "text-emerald-400",
  throttled: "text-amber-400",
  auth: "text-rose-400",
  billing: "text-rose-400",
  cooldown: "text-amber-400",
  "circuit-open": "text-rose-400",
  degraded: "text-amber-400",
  unknown: "text-slate-500",
};

interface Props {
  active: boolean;
  root: string;
  model: string;
  branch?: string;
  working: boolean;
  changedCount: number;
  focusSignal?: number;
  editor: React.ReactNode;
  assistant: React.ReactNode;
  onCommand: (command: WorkspaceCommand) => void;
  onSettings: () => void;
  onNewChat: () => void;
  onClose: () => void;
  turboSpeedMode?: boolean;
  onToggleTurboSpeed?: (next: boolean) => void;
}

export function WorkbenchLayout(props: Props) {
  const [assistantOpen, setAssistantOpen] = useState(true);
  const [mobilePane, setMobilePane] = useState<"editor" | "assistant">("editor");
  const [width, setWidth] = useState(() => {
    try { return Math.min(560, Math.max(320, Number(localStorage.getItem("quillix_agent_width")) || 390)); } catch { return 390; }
  });
  const [palette, setPalette] = useState(false);
  const [missionOpen, setMissionOpen] = useState(false);
  const [goalProgressOpen, setGoalProgressOpen] = useState(false);
  const [cockpitOpen, setCockpitOpen] = useState(false);
  const [taskHistoryOpen, setTaskHistoryOpen] = useState(false);
  const [providerHealth, setProviderHealth] = useState<ProviderHealthSummary | null>(null);
  const [pendingApprovals, setPendingApprovals] = useState<Array<{ id: string; kind: string; title: string; command?: string; reason?: string }>>([]);
  const [resolvingApprovals, setResolvingApprovals] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const layout = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  // Poll provider health for footer status
  useEffect(() => {
    const fetchHealth = async () => {
      try {
        const result = await api.getProviderHealth();
        if (result.success && result.health) {
          setProviderHealth(result.health);
        }
      } catch { /* ignore */ }
    };
    fetchHealth();
    const interval = setInterval(fetchHealth, 5000);
    return () => clearInterval(interval);
  }, []);

  // Keep the Studio review bar synchronized with approval requests that are
  // blocking an active agent run. Stop polling immediately when the run ends.
  useEffect(() => {
    if (!props.working) {
      setPendingApprovals(current => (current.length ? [] : current));
      return;
    }
    let cancelled = false;
    const poll = async () => {
      try {
        const approvals = await api.listPendingApprovals();
        if (!cancelled) setPendingApprovals(approvals);
      } catch {
        // Server restarting or offline: keep the last known snapshot and
        // retry on the next tick instead of raising an unhandled rejection.
      }
    };
    void poll();
    const timer = window.setInterval(() => { void poll(); }, 2000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [props.working]);

  useEffect(() => {
    if (!props.active || !props.focusSignal) return;
    setAssistantOpen(true); setMobilePane("assistant");
    requestAnimationFrame(() => layout.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus());
  }, [props.focusSignal, props.active]);

  const openSidePanel = (panel: "mission" | "goal" | "cockpit" | "history") => {
    const current = missionOpen ? "mission" : goalProgressOpen ? "goal" : cockpitOpen ? "cockpit" : taskHistoryOpen ? "history" : null;
    const next = current === panel ? null : panel;
    setMissionOpen(next === "mission");
    setGoalProgressOpen(next === "goal");
    setCockpitOpen(next === "cockpit");
    setTaskHistoryOpen(next === "history");
  };
  const project = props.root.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "Workspace";
  const revealCode = (command: WorkspaceCommand) => { setMobilePane("editor"); props.onCommand(command); };
  const commands = [
    { title: "Search project files", detail: "Find code across the workspace", icon: FileSearch, action: () => revealCode("search") },
    { title: "Toggle terminal", detail: "Commands and execution output", icon: TerminalSquare, action: () => revealCode("terminal") },
    { title: "Build & tests", detail: "Run and review project checks", icon: Check, action: () => revealCode("build") },
    { title: "Debug Node script", detail: "Launch, inspect and evaluate a local process", icon: Bug, action: () => revealCode("debug") },
    { title: "Source control", detail: "Review Git changes", icon: GitBranch, action: () => revealCode("git") },
    { title: "Project explorer", detail: "Browse the active workspace", icon: FolderOpen, action: () => revealCode("explorer") },
    { title: "New agent chat", detail: "Start a fresh conversation", icon: Bot, action: () => { setAssistantOpen(true); setMobilePane("assistant"); props.onNewChat(); } },
    { title: "Mission control", detail: "Deadline goal tracker: progress, gates, blockers, tests", icon: Target, action: () => openSidePanel("mission") },
    { title: "Task history", detail: "Everything the agent did: files, commands, errors, verification", icon: History, action: () => openSidePanel("history") },
    { title: "Goal progress", detail: "Persistent deadline tracker with verified progress", icon: Zap, action: () => openSidePanel("goal") },
    { title: "Developer Cockpit", detail: "Real-time system diagnostics: CPU, memory, providers, git, builds, debug tools", icon: Monitor, action: () => openSidePanel("cockpit") },
    { title: "Model & settings", detail: "Configure providers and appearance", icon: Settings2, action: props.onSettings },
  ];
  const filtered = commands.filter(c => `${c.title} ${c.detail}`.toLowerCase().includes(query.toLowerCase()));
  const showPalette = () => { previousFocus.current = document.activeElement as HTMLElement; setQuery(""); setSelected(0); setPalette(true); };
  const closePalette = () => { setPalette(false); previousFocus.current?.focus(); };
  const invoke = (i: number) => { const cmd = filtered[i]; if (cmd) { cmd.action(); closePalette(); } };
  const providerHealthLabel = providerHealth ? PROVIDER_HEALTH_LABELS[providerHealth.availability] : "";
  const providerHealthDetails = providerHealth
    ? `Provider: ${providerHealthLabel} · Tokens/s: ${providerHealth.tokensPerSecond.toFixed(1)} · Latency: ${providerHealth.averageLatencyMs}ms · Success: ${(providerHealth.successRate * 100).toFixed(0)}% · Queue: ${providerHealth.queueDepth}`
    : "";

  // Per-item approval resolution (multi-file changesets: one file at a time).
  const resolveApprovals = async (approved: boolean, ids: string[]) => {
    if (resolvingApprovals || ids.length === 0) return;
    setResolvingApprovals(true);
    try {
      const result = await api.batchResolveApprovals(approved, ids);
      if (result) {
        setPendingApprovals(await api.listPendingApprovals());
      }
    } finally {
      setResolvingApprovals(false);
    }
  };

  // Footer approval bar actions
  const resolveAllApprovals = async (approved: boolean) => {
    if (resolvingApprovals || pendingApprovals.length === 0) return;
    setResolvingApprovals(true);
    try {
      const result = await api.batchResolveApprovals(approved);
      if (result) {
        // Refresh instead of assuming every request was still queued. A run
        // may finish or remove an approval between the last poll and click.
        setPendingApprovals(await api.listPendingApprovals());
      }
    } finally {
      setResolvingApprovals(false);
    }
  };

  return (
    <section className="q-workbench h-full w-full flex flex-col overflow-hidden bg-[var(--bg)]" role="region" aria-label="Workbench">
      <div className="flex h-full flex-col overflow-hidden" ref={layout}>
        <header className="q-workbench-header flex-shrink-0 flex items-center justify-between gap-2 border-b border-[var(--border)] px-3 py-1.5">
          <div className="flex items-center gap-2 min-w-0">
            <div className="flex items-center gap-1.5">
              <div className="w-6 h-6 rounded-lg flex items-center justify-center text-white shrink-0 bg-[var(--accent)]">
                <Bot size={12} aria-hidden="true" />
              </div>
              <span className="font-semibold text-[12px] truncate">{project}</span>
            </div>
            <div className="hidden md:flex items-center gap-1 border-l border-[var(--border)] pl-3">
              {props.branch && (
                <span className="flex items-center gap-1 text-[11px] text-[var(--text-muted)]">
                  <GitBranch size={12} /> {props.branch}
                </span>
              )}
              {props.working && (
                <span className="flex items-center gap-1 text-[11px] text-emerald-400">
                  <Activity size={12} className="animate-spin" aria-hidden="true" /> Agent working
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5 ml-auto">
            {props.onToggleTurboSpeed && (
              <button
                onClick={() => props.onToggleTurboSpeed?.(props.turboSpeedMode !== true)}
                aria-pressed={props.turboSpeedMode === true}
                aria-label={props.turboSpeedMode === true ? "Turbo Speed ON" : "Turbo Speed OFF"}
                title={props.turboSpeedMode === true ? "Turbo Speed ON (1s adaptive pacing)" : "Turbo Speed OFF"}
                className={`q-transition px-2 py-1 rounded-md text-[11px] font-bold flex items-center gap-1 border ${
                  props.turboSpeedMode === true
                    ? "bg-[var(--accent)] text-[var(--accent-ink)] border-[var(--accent)]"
                    : "text-[var(--text-muted)] border-[var(--border)] hover:bg-[var(--hover)]"
                }`}
              >
                <Zap size={12} />
                <span>{props.turboSpeedMode === true ? "TURBO" : "Turbo"}</span>
              </button>
            )}
            <button
              onClick={() => openSidePanel("cockpit")}
              className={`q-transition p-1.5 rounded-lg ${
                cockpitOpen
                  ? "text-[var(--accent)] bg-[var(--accent-soft)] border border-[var(--accent)]"
                  : "text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--hover)]"
              }`}
              aria-label="Developer Cockpit"
              title="Developer Cockpit (Real-time telemetry, resources, git, and debugger)"
            >
              <Monitor size={14} />
            </button>
            <button
              onClick={() => openSidePanel("mission")}
              className={`q-transition p-1.5 rounded-lg ${
                missionOpen
                  ? "text-[var(--accent)] bg-[var(--accent-soft)] border border-[var(--accent)]"
                  : "text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--hover)]"
              }`}
              aria-label="Mission Control"
              title="Mission Control (Deadline and verification status)"
            >
              <Target size={14} />
            </button>
            <button
              onClick={() => openSidePanel("history")}
              className={`q-transition p-1.5 rounded-lg ${
                taskHistoryOpen
                  ? "text-[var(--accent)] bg-[var(--accent-soft)] border border-[var(--accent)]"
                  : "text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--hover)]"
              }`}
              aria-label="Task History"
              title="Task History (what the agent did in this workspace)"
            >
              <History size={14} />
            </button>
            <button
              onClick={showPalette}
              className="q-transition p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--hover)]"
              aria-label="Open command palette (Ctrl+K)"
              title="Command palette (Ctrl+K)"
            >
              <Command size={14} />
            </button>
            <button
              onClick={() => setAssistantOpen((prev) => !prev)}
              className="q-transition p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--hover)] hidden lg:inline-flex"
              aria-label={assistantOpen ? "Collapse assistant panel" : "Expand assistant panel"}
              title={assistantOpen ? "Collapse assistant panel" : "Expand assistant panel"}
            >
              {assistantOpen ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}
            </button>
            <button
              onClick={props.onSettings}
              className="q-transition p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--hover)]"
              aria-label="Settings"
              title="Settings"
            >
              <Settings2 size={14} />
            </button>
          </div>
        </header>

        {/* Main content area */}
        <main className="flex-1 flex overflow-hidden relative">
          {/* Left: Editor tabs area (placeholder for EditorArea) */}
          <div className="flex-1 flex flex-col min-w-0 relative" role="region" aria-label="Editor">
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
              {props.editor}
            </div>
          </div>

          {/* Right: Assistant panel */}
          {assistantOpen && (
            <div className="hidden lg:flex w-[min(380px,36vw)] min-w-[300px] min-h-0 flex-col border-l border-[var(--border)] bg-[var(--surface)]" role="complementary" aria-label="Assistant">
              <div className="flex-1 overflow-hidden">
                {props.assistant}
              </div>
            </div>
          )}

          {/* Mobile: switch between editor and assistant */}
          {mobilePane === "assistant" && assistantOpen && (
            <div className="lg:hidden fixed inset-0 z-40 flex flex-col bg-[var(--bg)]" role="dialog" aria-label="Assistant">
              <header className="flex items-center justify-between border-b border-[var(--border)] p-2">
                <span className="font-medium text-[12px]">Assistant</span>
                <button onClick={() => setMobilePane("editor")} className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--hover)]" aria-label="Back to editor">
                  <X size={16} />
                </button>
              </header>
              <div className="flex-1 overflow-auto">
                {props.assistant}
              </div>
            </div>
          )}

          {(missionOpen || goalProgressOpen || cockpitOpen || taskHistoryOpen) && (
            <aside className="absolute inset-y-0 right-0 z-30 flex w-[min(400px,100%)] flex-col border-l border-[var(--border)] bg-[var(--surface)] shadow-2xl" role="complementary" aria-label="Side panels">
              {missionOpen && <MissionControlPanel active={true} onClose={() => setMissionOpen(false)} />}
              {goalProgressOpen && <GoalProgressSidebar onClose={() => setGoalProgressOpen(false)} />}
              {cockpitOpen && <DeveloperCockpit active={true} onClose={() => setCockpitOpen(false)} />}
              {taskHistoryOpen && <TaskHistoryPanel active={true} working={props.working} onClose={() => setTaskHistoryOpen(false)} />}
            </aside>
          )}
        </main>

        {/* Approval bar (footer, above status bar) */}
        {pendingApprovals.length > 0 && (
          <div className="flex-shrink-0 border-t border-[var(--border)] bg-[var(--surface)] px-3 py-2" role="region" aria-label="Pending approvals">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-[11px]">
                <Activity size={12} className="text-amber-400 animate-pulse" aria-hidden="true" />
                <span className="font-medium text-amber-300">{pendingApprovals.length} approval{pendingApprovals.length !== 1 ? "s" : ""} pending</span>
              </div>
              <div className="flex items-center gap-1.5">
                <button onClick={() => void resolveAllApprovals(true)} disabled={resolvingApprovals} className="px-2 py-1 text-[11px] rounded bg-emerald-900/30 text-emerald-300 hover:bg-emerald-900/50 border border-emerald-800 transition-colors disabled:opacity-50" aria-label={`Approve all ${pendingApprovals.length} pending approvals`}>
                  Approve all
                </button>
                <button onClick={() => void resolveAllApprovals(false)} disabled={resolvingApprovals} className="px-2 py-1 text-[11px] rounded bg-rose-900/30 text-rose-300 hover:bg-rose-900/50 border border-rose-800 transition-colors disabled:opacity-50" aria-label={`Reject all ${pendingApprovals.length} pending approvals`}>
                  Reject all
                </button>
              </div>
            </div>
            {/* M2.3 multi-file changeset review: grouped summary + per-item resolve */}
            <div className="mt-1.5 flex items-center gap-2 text-[10px] text-[var(--text-muted)]">
              {(() => { const fileChanges = pendingApprovals.filter(a => a.kind === "file"); const commands = pendingApprovals.filter(a => a.kind === "terminal"); const gitActions = pendingApprovals.filter(a => a.kind === "git"); return (
                <>
                  {fileChanges.length > 0 && <span className="px-1.5 py-0.5 rounded bg-amber-900/30 text-amber-200">{fileChanges.length} file change{fileChanges.length !== 1 ? "s" : ""}</span>}
                  {commands.length > 0 && <span className="px-1.5 py-0.5 rounded bg-[var(--bg)] border border-[var(--border)]">{commands.length} command{commands.length !== 1 ? "s" : ""}</span>}
                  {gitActions.length > 0 && <span className="px-1.5 py-0.5 rounded bg-[var(--bg)] border border-[var(--border)]">{gitActions.length} git action{gitActions.length !== 1 ? "s" : ""}</span>}
                  {fileChanges.length > 0 && <button onClick={() => void resolveApprovals(true, fileChanges.map(a => a.id))} disabled={resolvingApprovals} className="px-1.5 py-0.5 rounded bg-emerald-900/30 text-emerald-300 hover:bg-emerald-900/50 border border-emerald-800 disabled:opacity-50" aria-label="Approve all pending file changes">Approve file changes</button>}
                </>
              ); })()}
            </div>
            <div className="mt-1.5 max-h-32 overflow-auto space-y-1" role="list" aria-label="Approval details">
              {pendingApprovals.map((a, i) => (
                <div key={a.id} className="p-1.5 rounded bg-[var(--bg)] border border-[var(--border)] text-[10px]" role="listitem">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[var(--text)]">{a.kind}</span>
                        <span className="text-[var(--text-muted)] truncate">{a.title}</span>
                      </div>
                      {a.command && <div className="font-mono text-[var(--text-muted)] truncate">{a.command}</div>}
                      {a.reason && <div className="text-[var(--text-muted)] truncate">{a.reason}</div>}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => void resolveApprovals(true, [a.id])} disabled={resolvingApprovals} className="px-1.5 py-0.5 rounded bg-emerald-900/30 text-emerald-300 hover:bg-emerald-900/50 border border-emerald-800 disabled:opacity-50" aria-label={`Approve: ${a.title}`}>Approve</button>
                      <button onClick={() => void resolveApprovals(false, [a.id])} disabled={resolvingApprovals} className="px-1.5 py-0.5 rounded bg-rose-900/30 text-rose-300 hover:bg-rose-900/50 border border-rose-800 disabled:opacity-50" aria-label={`Reject: ${a.title}`}>Reject</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer status bar */}
        <footer className="q-workbench-footer flex-shrink-0 flex items-center justify-between gap-2 border-t border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-[11px]" role="contentinfo" aria-label="Workbench status">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex items-center gap-1.5 text-[var(--text-muted)]">
              <span className="font-mono text-[10px] truncate max-w-[160px]" title={props.root}>{props.root}</span>
            </div>
            <div className="hidden sm:flex items-center gap-1.5 text-[var(--text-muted)]">
              <span className="font-mono">{props.model}</span>
            </div>
            {providerHealthDetails && (
              <span className="hidden md:inline-flex items-center gap-1.5 text-[var(--text-muted)]" title={providerHealthDetails} aria-label={providerHealthDetails}>
                <span className={`inline-flex items-center gap-1 ${PROVIDER_HEALTH_ICON_COLORS[providerHealth?.availability || "unknown"]}`}>
                  <Activity size={10} aria-hidden="true" />
                  <span className="font-medium">{providerHealthLabel}</span>
                </span>
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 ml-auto">
            <PerformanceMonitor compact={true} />
            <div className="hidden sm:flex items-center gap-1.5 text-[var(--text-muted)]">
              <span className="font-mono text-[10px]">{props.changedCount} change{props.changedCount !== 1 ? "s" : ""}</span>
            </div>
          </div>
        </footer>
      </div>

      {/* Command Palette */}
      {palette && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-20" role="dialog" aria-modal="true" aria-label="Command palette">
          <div className="absolute inset-0 bg-[var(--overlay)]" onClick={closePalette} aria-hidden="true" />
          <div className="relative z-10 w-[560px] max-w-[90vw] rounded-xl bg-[var(--surface)] border border-[var(--border)] shadow-2xl overflow-hidden animate-fade-in" ref={dialog}>
            <div className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2">
              <Command size={16} className="text-[var(--accent)] shrink-0" aria-hidden="true" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") closePalette();
                  else if (e.key === "ArrowDown") { e.preventDefault(); setSelected(s => Math.min(s + 1, filtered.length - 1)); }
                  else if (e.key === "ArrowUp") { e.preventDefault(); setSelected(s => Math.max(s - 1, 0)); }
                  else if (e.key === "Enter") { e.preventDefault(); invoke(selected); }
                }}
                placeholder="Type a command…"
                className="flex-1 bg-transparent border-none text-[13px] text-[var(--text)] placeholder-[var(--text-muted)] focus:outline-none"
                autoFocus
                aria-label="Search commands"
                aria-controls="command-list"
                aria-activedescendant={filtered[selected] ? `cmd-${selected}` : undefined}
              />
              <kbd className="px-1.5 py-0.5 text-[10px] text-[var(--text-muted)] bg-[var(--bg)] rounded border border-[var(--border)]">Ctrl+K</kbd>
            </div>
            <ul id="command-list" role="listbox" className="max-h-[360px] overflow-auto" aria-label="Available commands">
              {filtered.length === 0 ? (
                <li className="px-3 py-4 text-center text-[var(--text-muted)] text-[12px]" role="option" aria-disabled="true">No commands match</li>
              ) : (
                filtered.map((cmd, i) => (
                  <li
                    key={cmd.title}
                    id={`cmd-${i}`}
                    role="option"
                    aria-selected={i === selected}
                    className={`px-3 py-2.5 flex items-center gap-3 transition-colors cursor-pointer ${i === selected ? "bg-[var(--hover)]" : ""}`}
                    onClick={() => invoke(i)}
                    onMouseEnter={() => setSelected(i)}
                  >
                    <cmd.icon size={16} className="text-[var(--text-muted)] shrink-0" aria-hidden="true" />
                    <div className="flex-1 min-w-0 text-left">
                      <div className="text-[12px] font-medium text-[var(--text)] truncate">{cmd.title}</div>
                      <div className="text-[10px] text-[var(--text-muted)] truncate">{cmd.detail}</div>
                    </div>
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>
      )}

      {/* Mobile drawer overlay */}
      {assistantOpen && mobilePane === "editor" && (
        <div className="lg:hidden fixed inset-0 z-20 bg-black/50" onClick={() => { setAssistantOpen(false); setMobilePane("editor"); }} aria-hidden="true" />
      )}
    </section>
  );
}
