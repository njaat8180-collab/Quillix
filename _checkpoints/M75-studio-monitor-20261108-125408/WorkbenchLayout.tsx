import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, Bot, Braces, Bug, Check, ChevronRight, Command, FileSearch, FolderOpen, GitBranch, PanelRightClose, PanelRightOpen, Search, Settings2, TerminalSquare, X, Zap } from 'lucide-react';

export type WorkspaceCommand = 'explorer' | 'search' | 'git' | 'build' | 'debug' | 'terminal';

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
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'l') {
        event.preventDefault(); setAssistantOpen(true); setMobilePane('assistant');
        requestAnimationFrame(() => layout.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus());
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [props.active]);
  useEffect(() => { try { localStorage.setItem('quillix_agent_width', String(width)); } catch { /* optional preference */ } }, [width]);

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
    </div>
    <footer className="q-workbench-status">
      <span><GitBranch size={12} />{props.branch || 'Local workspace'}</span>
      <span className="q-workbench-task"><span className={props.working ? 'q-live-indicator' : 'q-idle-indicator'} />{props.working ? 'Agent working' : 'Ready'}{props.changedCount > 0 ? ` · ${props.changedCount} files touched this run` : ''}</span>
      <span className="q-workbench-model"><Bot size={12} />{props.model}</span>
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
