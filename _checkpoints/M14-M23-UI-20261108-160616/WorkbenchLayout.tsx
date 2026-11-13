import React, { useEffect, useRef, useState } from 'react';
import { Activity, ArrowRight, Bot, Braces, Bug, Check, ChevronRight, Command, FileSearch, FolderOpen, GitBranch, PanelRightClose, PanelRightOpen, Search, Settings2, Target, TerminalSquare, X, Zap } from 'lucide-react';
import { api } from '../services/apiBridge.js';
import { MissionControlPanel } from './MissionControlPanel.js';
import type { ProviderHealthSummary } from '../shared/types.js';

export type WorkspaceCommand = 'explorer' | 'search' | 'git' | 'build' | 'debug' | 'terminal';

/** M7.5: how each provider availability state reads in the Studio monitor. */
const PROVIDER_HEALTH_LABELS: Record<ProviderHealthSummary['availability'], string> = {
  ok: 'healthy',
  throttled: 'throttled',
  auth: 'auth error',
  billing: 'billing issue',
  cooldown: 'cooldown',
  'circuit-open': 'circuit open',
  degraded: 'degraded',
  unknown: 'no data',
};

const PROVIDER_HEALTH_ICON_COLORS: Record<ProviderHealthSummary['availability'], string> = {
  ok: 'text-emerald-400',
  throttled: 'text-amber-400',
  auth: 'text-rose-400',
  billing: 'text-rose-400',
  cooldown: 'text-amber-400',
  'circuit-open': 'text-rose-400',
  degraded: 'text-amber-400',
  unknown: 'text-slate-500',
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
  /** Synchronized Turbo Speed control beside Agent and Chat in Studio. */
  turboSpeedMode?: boolean;
  onToggleTurboSpeed?: (next: boolean) => void;
}

/** A persistent editor/agent split. Only the panel width is stored locally. */
export function WorkbenchLayout(props: Props) {
  const [assistantOpen, setAssistantOpen] = useState(true);
  const [mobilePane, setMobilePane] = useState<'editor' | 'assistant'>('editor');
  const [width, setWidth] = useState(() => {
    try { return Math.min(560, Math.max(320, Number(localStorage.getItem('quillix_agent_width')) || 390)); } catch { return 390; }
  });
  const [palette, setPalette] = useState(false);
  const [missionOpen, setMissionOpen] = useState(false);
  const [providerHealth, setProviderHealth] = useState<ProviderHealthSummary | null>(null);
  const [pendingApprovals, setPendingApprovals] = useState<Array<{ id: string; kind: string; title: string; command?: string; reason?: string }>>([]);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const layout = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!props.active || !props.focusSignal) return;
    setAssistantOpen(true); setMobilePane('assistant');
    requestAnimationFrame(() => layout.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus());
  }, [props.focusSignal, props.active]);
  const project = props.root.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || 'Workspace';
  const revealCode = (command: WorkspaceCommand) => { setMobilePane('editor'); props.onCommand(command); };
  const commands = [
    { title: 'Search project files', detail: 'Find code across the workspace', icon: FileSearch, action: () => revealCode('search') },
    { title: 'Toggle terminal', detail: 'Commands and execution output', icon: TerminalSquare, action: () => revealCode('terminal') },
    { title: 'Build & tests', detail: 'Run and review project checks', icon: Check, action: () => revealCode('build') },
    { title: 'Debug Node script', detail: 'Launch, inspect and evaluate a local process', icon: Bug, action: () => revealCode('debug') },
    { title: 'Source control', detail: 'Review Git changes', icon: GitBranch, action: () => revealCode('git') },
    { title: 'Project explorer', detail: 'Browse the active workspace', icon: FolderOpen, action: () => revealCode('explorer') },
    { title: 'New agent chat', detail: 'Start a fresh conversation', icon: Bot, action: () => { setAssistantOpen(true); setMobilePane('assistant'); props.onNewChat(); } },
    { title: 'Mission control', detail: 'Deadline goal tracker: progress, gates, blockers, tests', icon: Target, action: () => { setMissionOpen(true); } },
    { title: 'Model & settings', detail: 'Configure providers and appearance', icon: Settings2, action: props.onSettings },
  ];
  const filtered = commands.filter(c => `${c.title} ${c.detail}`.toLowerCase().includes(query.toLowerCase()));
  const showPalette = () => { previousFocus.current = document.activeElement as HTMLElement; setQuery(''); setSelected(0); setPalette(true); };
  const closePalette = () => { setPalette(false); previousFocus.current?.focus(); };
  const invoke = (index: number) => { const command = filtered[index]; if (command) { closePalette(); command.action(); } };

  useEffect(() => {
    if (!props.active) return;
    const key = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'p') { event.preventDefault(); showPalette(); }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'm') { event.preventDefault(); setMissionOpen(true); }
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'l') {
        event.preventDefault(); setAssistantOpen(true); setMobilePane('assistant');
        requestAnimationFrame(() => layout.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus());
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [props.active]);
  useEffect(() => { try { localStorage.setItem('quillix_agent_width', String(width)); } catch { /* optional preference */ } }, [width]);

  // M7.5: show the live provider health summary in the Studio monitor footer.
  // Read-only observation — it never changes pacing, retries, or quota handling.
  useEffect(() => {
    if (!props.active) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const result = await api.getProviderHealth();
        if (cancelled) return;
        setProviderHealth(result.health ?? null);
      } catch {
        if (!cancelled) setProviderHealth(null);
      }
    };
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 5000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [props.active]);

  const providerHealthLabel = providerHealth
    ? `${PROVIDER_HEALTH_LABELS[providerHealth.availability]}${providerHealth.requests > 0 ? ` ${Math.round(providerHealth.successRate * 100)}%` : ''}${providerHealth.tokensPerSecond > 0 ? ` · ${Math.round(providerHealth.tokensPerSecond)} tok/s` : ''}`
    : '';
  const providerHealthDetails = providerHealth
    ? `Provider health: ${PROVIDER_HEALTH_LABELS[providerHealth.availability]} · ${providerHealth.successes}/${providerHealth.requests} successful · ${Math.round(providerHealth.averageLatencyMs)} ms latency · ${Math.round(providerHealth.averageFirstTokenMs)} ms to first token · ${Math.round(providerHealth.tokensPerSecond)} tok/s · ${providerHealth.effectiveIntervalMs} ms request interval · queue ${providerHealth.queueDepth} · recommended wait ${providerHealth.recommendedWaitMs} ms`
    : '';

  // M2.3: while the agent is waiting on the user, list the queued approvals and
  // offer batch resolution ("Approve all" / "Reject all"). Read-only listing plus
  // an explicit decision per click; it never approves anything by itself.
  useEffect(() => {
    if (!props.working) {
      setPendingApprovals(current => (current.length ? [] : current));
      return;
    }
    let cancelled = false;
    const poll = async () => {
      const approvals = await api.listPendingApprovals();
      if (cancelled) return;
      setPendingApprovals(approvals);
    };
    void poll();
    const timer = window.setInterval(() => { void poll(); }, 2000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [props.working]);

  const resolveAllApprovals = async (approved: boolean) => {
    if (!pendingApprovals.length) return;
    setPendingApprovals([]);
    await api.batchResolveApprovals(approved);
  };

  return <section ref={layout} className="q-workbench" aria-label="Coding studio" style={{ '--agent-width': `${width}px` } as React.CSSProperties}>
    <div className="q-workbench-toolbar">
      <div className="q-workbench-breadcrumb" title={props.root}><Braces size={16} /><span>{project}</span><ChevronRight size={12} /><span className="q-muted">workspace</span></div>
      <button className="q-command-trigger" onClick={showPalette} aria-label="Open command palette"><Search size={13} /><span>Search commands…</span><kbd>Ctrl Shift P</kbd></button>
      <div className="q-workbench-toolbar-actions">
        <button className="q-icon-button" onClick={() => revealCode('terminal')} aria-label="Toggle terminal" title="Toggle terminal"><TerminalSquare size={16} /></button>
        {(() => {
          const onToggleTurboSpeed = props.onToggleTurboSpeed;
          if (!onToggleTurboSpeed) return null;
          return (
            <button
              onClick={() => onToggleTurboSpeed(props.turboSpeedMode !== true)}
              aria-pressed={props.turboSpeedMode === true}
              aria-label={props.turboSpeedMode === true ? 'Turbo Speed ON: adaptive pacing active' : 'Turbo Speed OFF: conservative pacing'}
              title={props.turboSpeedMode === true ? 'Turbo Speed ON: adaptive pacing active, respects provider limits' : 'Turbo Speed OFF: conservative pacing'}
              className={`q-turbo-header-button ${props.turboSpeedMode === true ? 'q-turbo-header-on' : ''}`}
            >
              <Zap size={15} />
              <span className="q-turbo-header-state">{props.turboSpeedMode === true ? 'TURBO' : 'Turbo'}</span>
              {props.turboSpeedMode === true && <span className="q-turbo-pulse" aria-hidden="true" />}
            </button>
          );
        })()}
        <button className="q-icon-button" onClick={() => setMissionOpen(value => !value)} aria-pressed={missionOpen} aria-label={missionOpen ? 'Hide mission control' : 'Show mission control'} title="Mission control (deadline tracker)"><Target size={16} /></button>
        <button className="q-icon-button" onClick={() => { setAssistantOpen(value => !value); setMobilePane(assistantOpen ? 'editor' : 'assistant'); }} aria-label={assistantOpen ? 'Hide agent panel' : 'Show agent panel'} title="Agent panel (Ctrl+L)">{assistantOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}</button>
        <button className="q-icon-button" onClick={props.onClose} aria-label="Return to home" title="Return to home"><X size={15} /></button>
      </div>
    </div>
    <div className="q-mobile-tabs" role="tablist" aria-label="Workspace panels">
      <button role="tab" aria-selected={mobilePane === 'editor'} onClick={() => setMobilePane('editor')}><Braces size={14} /> Code</button>
      <button role="tab" aria-selected={mobilePane === 'assistant'} onClick={() => { setAssistantOpen(true); setMobilePane('assistant'); }}><Bot size={14} /> Agent {props.working && <span className="q-live-indicator" />}</button>
    </div>
    <div className={`q-workbench-panes q-mobile-${mobilePane} ${assistantOpen ? '' : 'q-agent-hidden'}`}>
      <div className="q-workbench-editor">{props.editor}</div>
      {assistantOpen && <>
        <div className="q-agent-divider" role="separator" tabIndex={0} aria-label="Resize agent panel" aria-orientation="vertical" aria-valuemin={320} aria-valuemax={560} aria-valuenow={width}
          onKeyDown={e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); setWidth(w => Math.min(560, Math.max(320, w + (e.key === 'ArrowLeft' ? 20 : -20)))); } }}
          onDoubleClick={() => setWidth(390)}
          onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); }}
          onPointerMove={e => { if (e.currentTarget.hasPointerCapture(e.pointerId) && layout.current) setWidth(Math.min(560, Math.max(320, layout.current.getBoundingClientRect().right - e.clientX))); }}
          onPointerUp={e => { if(e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }} />
        <div className="q-workbench-agent">{props.assistant}</div>
      </>}
      {missionOpen && (
        <div className="hidden w-[320px] shrink-0 flex-col border-l border-[var(--border)] bg-[var(--bg)] md:flex">
          <MissionControlPanel active={props.active} onClose={() => setMissionOpen(false)} />
        </div>
      )}
    </div>
    {props.working && pendingApprovals.length > 0 && (
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-amber-800 bg-amber-950/40 px-3 py-1.5 text-[11px] text-amber-100" role="region" aria-label="Pending approvals">
        <span className="min-w-0 truncate font-mono">
          {pendingApprovals.length} approval{pendingApprovals.length === 1 ? '' : 's'} waiting · {pendingApprovals[0].title}
          {pendingApprovals.length > 1 ? ` (+${pendingApprovals.length - 1} more)` : ''}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <button type="button" onClick={() => void resolveAllApprovals(true)} className="rounded border border-emerald-700 px-2 py-0.5 font-semibold text-emerald-300 hover:bg-emerald-900/40" aria-label={`Approve all ${pendingApprovals.length} pending approvals`}>Approve all</button>
          <button type="button" onClick={() => void resolveAllApprovals(false)} className="rounded border border-rose-700 px-2 py-0.5 font-semibold text-rose-300 hover:bg-rose-900/40" aria-label={`Reject all ${pendingApprovals.length} pending approvals`}>Reject all</button>
        </span>
      </div>
    )}
    <footer className="q-workbench-status">
      <span><GitBranch size={12} />{props.branch || 'Local workspace'}</span>
      <span className="q-workbench-task"><span className={props.working ? 'q-live-indicator' : 'q-idle-indicator'} />{props.working ? 'Agent working' : 'Ready'}{props.changedCount > 0 ? ` · ${props.changedCount} files touched this run` : ''}</span>
      <span className="q-workbench-model"><Bot size={12} />{props.model}</span>
      {providerHealth && (
        <span className="inline-flex items-center gap-1.5" title={providerHealthDetails} aria-label={providerHealthDetails}>
          <Activity size={12} className={PROVIDER_HEALTH_ICON_COLORS[providerHealth.availability]} aria-hidden="true" />
          {providerHealthLabel}
        </span>
      )}
      <button onClick={props.onSettings} title="Studio settings"><Settings2 size={12} /></button>
    </footer>
    {palette && props.active && <div className="q-palette-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) closePalette(); }}>
      <div ref={dialog} role="dialog" aria-modal="true" aria-label="Command palette" className="q-palette" onKeyDown={e => {
        if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
        if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(s => Math.min(s + 1, filtered.length - 1)); }
        if (e.key === 'ArrowUp') { e.preventDefault(); setSelected(s => Math.max(0, s - 1)); }
        if (e.key === 'Enter') { e.preventDefault(); invoke(selected); }
        if (e.key === 'Tab') {
          const focusable = Array.from(dialog.current?.querySelectorAll<HTMLElement>('input, button') || []);
          const first = focusable[0], last = focusable[focusable.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
          if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
        }
      }}>
        <div className="q-palette-input"><Command size={18} /><input autoFocus aria-label="Search commands" placeholder="What would you like to do?" value={query} onChange={e => { setQuery(e.target.value); setSelected(0); }} /><button onClick={closePalette} aria-label="Close command palette"><kbd>Esc</kbd></button></div>
        <div className="q-palette-list">{filtered.map((c, i) => <button key={c.title} className={selected === i ? 'q-palette-selected' : ''} onClick={() => invoke(i)} onMouseEnter={() => setSelected(i)}><c.icon size={17} /><span><strong>{c.title}</strong><small>{c.detail}</small></span><ArrowRight size={14} /></button>)}{!filtered.length && <p>No commands match “{query}”.</p>}</div>
        <div className="q-palette-hint">↑ ↓ navigate <span>Enter to open</span></div>
      </div>
    </div>}
  </section>;
}
