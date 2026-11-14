import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bug, CirclePause, CirclePlay, RefreshCw, Square, TerminalSquare } from 'lucide-react';
import type { ToolResult } from '../shared/types.js';
import { api } from '../services/apiBridge.js';

interface DebugSession {
  sessionId: string;
  status: string;
  filePath?: string;
  pid?: number;
  paused?: boolean;
  output?: string;
}

interface StackFrame {
  functionName: string;
  filePath: string;
  line: number;
  column: number;
}

interface Breakpoint {
  breakpointId: string;
  filePath: string;
  line: number;
  column: number;
}

interface DebuggerPanelProps {
  activeFilePath?: string | null;
  readOnly?: boolean;
}

/** A focused UI for the bundled Node debugger. All execution remains approval-gated by the tool registry. */
export const DebuggerPanel: React.FC<DebuggerPanelProps> = ({ activeFilePath, readOnly = false }) => {
  const [filePath, setFilePath] = useState(activeFilePath || '');
  const [argsText, setArgsText] = useState('[]');
  const [cwd, setCwd] = useState('');
  const [stopOnEntry, setStopOnEntry] = useState(true);
  const [session, setSession] = useState<DebugSession | null>(null);
  // Live session id for the unmount cleanup below. Reading it from state would
  // capture the mount-time value (always null) and leak the debuggee process.
  const sessionIdRef = useRef<string | null>(null);
  const [frames, setFrames] = useState<StackFrame[]>([]);
  const [breakpoints, setBreakpoints] = useState<Breakpoint[]>([]);
  const [breakpointLine, setBreakpointLine] = useState('');
  const [expression, setExpression] = useState('');
  const [evaluation, setEvaluation] = useState<unknown>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!session && activeFilePath) setFilePath(activeFilePath);
  }, [activeFilePath, session]);

  const running = Boolean(session && session.status !== 'stopped' && session.status !== 'exited');
  const paused = Boolean(session?.paused || session?.status === 'paused');
  const statusLabel = useMemo(() => {
    if (!session) return 'No session';
    return `${session.status}${session.pid ? ` · PID ${session.pid}` : ''}`;
  }, [session]);

  const invoke = async (name: string, args: Record<string, unknown>): Promise<ToolResult & { needsApproval?: boolean }> => {
    if (readOnly && name !== 'plugin_debug_stop') return { toolCallId: 'blocked', toolName: name, success: false, output: '', error: 'Debugger actions are disabled in Chat mode.', durationMs: 0 };
    let result = await api.executeTool(name, args);
    if (result.needsApproval && !result.success) {
      const approved = window.confirm(`Authorize ${name}?\n\n${result.error || result.output}\n\nThis runs a local Node process in the active workspace.`);
      if (approved) result = await api.executeTool(name, args, true);
    }
    return result;
  };

  const applyResult = (result: ToolResult & { needsApproval?: boolean }) => {
    if (!result.success) {
      setMessage(result.error || result.output || 'Debugger operation failed.');
      return null;
    }
    setMessage('');
    return result.data as any;
  };

  const launch = async () => {
    if (readOnly) return;
    if (busy || running) return;
    let args: unknown;
    try {
      args = JSON.parse(argsText || '[]');
      if (!Array.isArray(args) || args.some(arg => typeof arg !== 'string')) throw new Error('Arguments must be a JSON array of strings.');
    } catch (error: any) {
      setMessage(error.message || 'Arguments must be valid JSON.');
      return;
    }
    if (!filePath.trim()) { setMessage('Choose a workspace-relative .js, .mjs or .cjs file first.'); return; }
    setBusy(true); setMessage(''); setFrames([]); setBreakpoints([]); setEvaluation(null);
    try {
      const result = await invoke('plugin_debug_launch', { filePath: filePath.trim(), args, cwd: cwd.trim() || undefined, stopOnEntry });
      const data = applyResult(result);
      if (data) { setSession(data as DebugSession); setBreakpoints(Array.isArray(data.breakpoints) ? data.breakpoints as Breakpoint[] : []); }
    } catch (error: any) { setMessage(error.message || 'Could not launch the debugger.'); }
    finally { setBusy(false); }
  };

  const runSessionAction = async (name: 'plugin_debug_pause' | 'plugin_debug_continue' | 'plugin_debug_stop' | 'plugin_debug_step_over' | 'plugin_debug_step_into' | 'plugin_debug_step_out') => {
    if (readOnly && name !== 'plugin_debug_stop') return;
    if (!session || busy) return;
    setBusy(true);
    try {
      const result = await invoke(name, { sessionId: session.sessionId });
      const data = applyResult(result);
      if (data) {
        if (name === 'plugin_debug_stop' || data.status === 'stopped' || data.status === 'exited') {
          setSession(null); setFrames([]); setBreakpoints([]); setEvaluation(null);
        } else {
          setSession(data as DebugSession);
          if (Array.isArray(data.breakpoints)) setBreakpoints(data.breakpoints as Breakpoint[]);
        }
      }
    } catch (error: any) { setMessage(error.message || 'Debugger operation failed.'); }
    finally { setBusy(false); }
  };

  const refreshStack = async () => {
    if (!session || !paused || busy) return;
    setBusy(true);
    try {
      const result = await invoke('plugin_debug_stack', { sessionId: session.sessionId });
      const data = applyResult(result);
      if (data) { setFrames(Array.isArray(data.frames) ? data.frames as StackFrame[] : []); setSession(previous => previous ? { ...previous, status: data.status || previous.status, paused: true } : previous); }
    } catch (error: any) { setMessage(error.message || 'Could not read stack frames.'); }
    finally { setBusy(false); }
  };

  const evaluate = async () => {
    if (!session || !paused || !expression.trim() || busy) return;
    setBusy(true);
    try {
      const result = await invoke('plugin_debug_evaluate', { sessionId: session.sessionId, expression: expression.trim() });
      const data = applyResult(result);
      if (data) setEvaluation(data);
    } catch (error: any) { setMessage(error.message || 'Could not evaluate expression.'); }
    finally { setBusy(false); }
  };

  const setBreakpoint = async () => {
    if (!session || busy) return;
    const line = Number.parseInt(breakpointLine, 10);
    if (!Number.isInteger(line) || line < 1) { setMessage('Breakpoint line must be a positive integer.'); return; }
    setBusy(true);
    try {
      const result = await invoke('plugin_debug_set_breakpoint', { sessionId: session.sessionId, filePath: filePath.trim(), line });
      const data = applyResult(result);
      if (data) {
        setSession(data as DebugSession);
        setBreakpoints(Array.isArray(data.breakpoints) ? data.breakpoints as Breakpoint[] : []);
        setBreakpointLine('');
      }
    } catch (error: any) { setMessage(error.message || 'Could not set breakpoint.'); }
    finally { setBusy(false); }
  };

  const clearBreakpoint = async (breakpointId: string) => {
    if (!session || busy) return;
    setBusy(true);
    try {
      const result = await invoke('plugin_debug_clear_breakpoint', { sessionId: session.sessionId, breakpointId });
      const data = applyResult(result);
      if (data) {
        setSession(data as DebugSession);
        setBreakpoints(Array.isArray(data.breakpoints) ? data.breakpoints as Breakpoint[] : []);
      }
    } catch (error: any) { setMessage(error.message || 'Could not clear breakpoint.'); }
    finally { setBusy(false); }
  };

  useEffect(() => { sessionIdRef.current = session?.sessionId ?? null; }, [session]);

  useEffect(() => () => {
    // The cleanup is deliberately best-effort: closing the panel must not leave a child process behind.
    const sessionId = sessionIdRef.current;
    if (sessionId) void invoke('plugin_debug_stop', { sessionId }).catch(() => undefined);
  }, []);

  return (
    <div className="h-full flex flex-col bg-[var(--surface)] text-[var(--text)] text-xs overflow-hidden">
      <div className="px-3 py-2.5 border-b border-[var(--border)] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <Bug size={15} className="text-[var(--accent)]" />
          <div><div className="font-semibold">Node Debugger</div><div className="text-[10px] text-[var(--text-muted)]">Loopback inspector · workspace only</div></div>
        </div>
        <span className={`text-[10px] px-1.5 py-0.5 rounded ${running ? 'bg-[var(--accent-soft)] text-[var(--accent)]' : 'bg-[var(--surface-secondary)] text-[var(--text-muted)]'}`}>{statusLabel}</span>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="p-3 space-y-2 border-b border-[var(--border)]">
          <label className="block text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Entry file</label>
          <input aria-label="Debugger entry file" value={filePath} onChange={e => setFilePath(e.target.value)} disabled={running} placeholder="src/index.js" className="w-full px-2 py-1.5 rounded bg-[var(--surface-secondary)] border border-[var(--border)] outline-none focus:border-[var(--accent)] font-mono text-[11px]" />
          <div className="grid grid-cols-2 gap-2">
            <input aria-label="Debugger arguments JSON" value={argsText} onChange={e => setArgsText(e.target.value)} disabled={running} placeholder={'["--dev"]'} className="min-w-0 px-2 py-1.5 rounded bg-[var(--surface-secondary)] border border-[var(--border)] outline-none focus:border-[var(--accent)] font-mono text-[11px]" />
            <input aria-label="Debugger working directory" value={cwd} onChange={e => setCwd(e.target.value)} disabled={running} placeholder="cwd (optional)" className="min-w-0 px-2 py-1.5 rounded bg-[var(--surface-secondary)] border border-[var(--border)] outline-none focus:border-[var(--accent)] font-mono text-[11px]" />
          </div>
          <label className="flex items-center gap-2 text-[11px] text-[var(--text-muted)]"><input type="checkbox" checked={stopOnEntry} onChange={e => setStopOnEntry(e.target.checked)} disabled={running} /> Stop on entry</label>
          <div className="flex gap-1.5">
            <button onClick={launch} disabled={readOnly || busy || running} className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded text-white font-semibold disabled:opacity-40" style={{ background: 'var(--accent)' }}><CirclePlay size={13} /> Launch</button>
            {running && <button onClick={() => void runSessionAction(paused ? 'plugin_debug_continue' : 'plugin_debug_pause')} disabled={readOnly || busy} className="px-2 py-1.5 rounded border border-[var(--border)] hover:bg-[var(--hover)] disabled:opacity-40" title={paused ? 'Continue' : 'Pause'}>{paused ? <CirclePlay size={14} /> : <CirclePause size={14} />}</button>}
            {running && <button onClick={() => void runSessionAction('plugin_debug_stop')} disabled={busy} className="px-2 py-1.5 rounded border border-[var(--danger)]/40 text-[var(--danger)] hover:bg-[var(--danger)]/10 disabled:opacity-40" title="Stop debugger"><Square size={13} /></button>}
          </div>
          {message && <div role="alert" className="text-[10.5px] leading-relaxed text-[var(--danger)] px-2 py-1.5 rounded bg-[var(--danger)]/10 border border-[var(--danger)]/30">{message}</div>}
        </div>

        <section className="p-3 border-b border-[var(--border)]">
          <div className="flex items-center justify-between mb-2"><h3 className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-bold">Call stack</h3><button onClick={() => void refreshStack()} disabled={!paused || busy || readOnly} className="p-1 rounded hover:bg-[var(--hover)] disabled:opacity-30" title="Refresh stack"><RefreshCw size={12} /></button></div>
          {paused && <div className="flex gap-1.5 mb-2">
            <button onClick={() => void runSessionAction('plugin_debug_step_over')} disabled={busy} className="flex-1 px-2 py-1 rounded border border-[var(--border)] hover:bg-[var(--hover)] disabled:opacity-30">Over</button>
            <button onClick={() => void runSessionAction('plugin_debug_step_into')} disabled={busy} className="flex-1 px-2 py-1 rounded border border-[var(--border)] hover:bg-[var(--hover)] disabled:opacity-30">Into</button>
            <button onClick={() => void runSessionAction('plugin_debug_step_out')} disabled={busy} className="flex-1 px-2 py-1 rounded border border-[var(--border)] hover:bg-[var(--hover)] disabled:opacity-30">Out</button>
          </div>}
          {!paused ? <p className="text-[11px] text-[var(--text-muted)]">Pause at a breakpoint or on entry to inspect frames.</p> : frames.length === 0 ? <p className="text-[11px] text-[var(--text-muted)]">No frames loaded. Refresh the stack.</p> : <div className="space-y-1">{frames.map((frame, index) => <div key={`${frame.filePath}:${frame.line}:${index}`} className="rounded px-2 py-1.5 bg-[var(--surface-secondary)]"><div className="font-medium truncate">{frame.functionName}</div><div className="font-mono text-[10px] text-[var(--text-muted)] truncate">{frame.filePath}:{frame.line}:{frame.column}</div></div>)}</div>}
          <div className="mt-3 pt-2 border-t border-[var(--border)] space-y-1.5">
            <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-bold">Breakpoints</div>
            <div className="flex gap-1.5">
              <input aria-label="Breakpoint line" value={breakpointLine} onChange={e => setBreakpointLine(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void setBreakpoint(); }} disabled={!session || busy} placeholder="line" className="w-20 px-2 py-1.5 rounded bg-[var(--surface-secondary)] border border-[var(--border)] outline-none focus:border-[var(--accent)] font-mono text-[11px]" />
              <button onClick={() => void setBreakpoint()} disabled={!session || busy || !breakpointLine.trim()} className="flex-1 px-2 py-1.5 rounded border border-[var(--border)] hover:bg-[var(--hover)] disabled:opacity-30">Set on entry file</button>
            </div>
            {breakpoints.length > 0 && <div className="space-y-1">{breakpoints.map(point => <div key={point.breakpointId} className="flex items-center gap-2 rounded px-2 py-1 bg-[var(--surface-secondary)]"><span className="flex-1 min-w-0 font-mono text-[10px] truncate">{point.filePath}:{point.line}:{point.column}</span><button onClick={() => void clearBreakpoint(point.breakpointId)} disabled={busy} className="text-[10px] text-[var(--danger)] hover:underline disabled:opacity-30">Clear</button></div>)}</div>}
          </div>
        </section>

        <section className="p-3 border-b border-[var(--border)] space-y-2">
          <h3 className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-bold">Evaluate expression</h3>
          <div className="flex gap-1.5"><input aria-label="Debugger expression" value={expression} onChange={e => setExpression(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void evaluate(); }} disabled={!paused || busy} placeholder="answer + 1" className="flex-1 min-w-0 px-2 py-1.5 rounded bg-[var(--surface-secondary)] border border-[var(--border)] outline-none focus:border-[var(--accent)] font-mono text-[11px]" /><button onClick={() => void evaluate()} disabled={!paused || busy || !expression.trim()} className="px-2 rounded border border-[var(--border)] hover:bg-[var(--hover)] disabled:opacity-30">Run</button></div>
          {evaluation !== null && <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-words rounded bg-[#0d1117] text-[#c9d1d9] p-2 text-[10px]">{JSON.stringify(evaluation, null, 2)}</pre>}
        </section>

        <section className="p-3">
          <div className="flex items-center gap-2 mb-2"><TerminalSquare size={13} className="text-[var(--text-muted)]" /><h3 className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-bold">Process output</h3></div>
          <pre className="min-h-20 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-[#0d1117] text-[#c9d1d9] p-2 text-[10px]">{session?.output || 'No debugger output yet.'}</pre>
        </section>
      </div>
    </div>
  );
};
