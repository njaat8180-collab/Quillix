import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, ChevronLeft, CircleSlash, Clock, FileEdit, FilePlus, History,
  Loader2, RefreshCw, RotateCcw, Terminal, Trash2, X, XCircle,
} from 'lucide-react';
import { api } from '../services/apiBridge.js';
import type { TaskHistoryCommand, TaskHistoryRecord } from '../shared/types.js';

interface Props {
  /** Only poll while the panel is actually visible. */
  active?: boolean;
  /** An agent run is active: rollback is disabled until it finishes. */
  working?: boolean;
  onClose?: () => void;
}

const STATUS_META: Record<TaskHistoryRecord['status'], { label: string; tone: string }> = {
  completed: { label: 'completed', tone: 'text-emerald-400' },
  failed: { label: 'failed', tone: 'text-rose-400' },
  cancelled: { label: 'cancelled', tone: 'text-amber-400' },
  running: { label: 'running', tone: 'text-amber-400' },
};

function StatusIcon({ status }: { status: TaskHistoryRecord['status'] }) {
  if (status === 'completed') return <CheckCircle2 size={12} className="text-emerald-400 shrink-0" aria-hidden="true" />;
  if (status === 'failed') return <XCircle size={12} className="text-rose-400 shrink-0" aria-hidden="true" />;
  if (status === 'running') return <Loader2 size={12} className="text-amber-400 animate-spin shrink-0" aria-hidden="true" />;
  return <CircleSlash size={12} className="text-amber-400 shrink-0" aria-hidden="true" />;
}

function relativeTime(timestamp: number, now: number): string {
  const delta = Math.max(0, now - timestamp);
  if (delta < 45_000) return 'just now';
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'yesterday' : `${days}d ago`;
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${Math.round(seconds % 60)}s`;
}

function formatClock(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/** QUILLIX TASK HISTORY — what the agent actually did, read back from the
 *  persisted task journal (`.quillix/tasks.json`). Every entry on the timeline
 *  was recorded during a real run; nothing here is estimated or simulated. */
export const TaskHistoryPanel: React.FC<Props> = ({ active = true, working = false, onClose }) => {
  const [tasks, setTasks] = useState<TaskHistoryRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [rollingBack, setRollingBack] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const next = await api.getTasks();
      setTasks(next);
      setError(null);
    } catch (err: any) {
      setError(err?.message || 'Task history could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (active) void load(); }, [active, load]);

  useEffect(() => {
    if (!active) return;
    const tick = window.setInterval(() => setNow(Date.now()), 15_000);
    const refresh = window.setInterval(() => { void load(); }, 15_000);
    return () => { window.clearInterval(tick); window.clearInterval(refresh); };
  }, [active, load]);

  const selected = useMemo(() => tasks.find(task => task.id === selectedId) || null, [tasks, selectedId]);

  // M7.6: aggregate summary from the persisted journal (real records only),
  // status filter and prompt search. Nothing here is estimated.
  const summary = useMemo(() => ({
    total: tasks.length,
    completed: tasks.filter(task => task.status === 'completed').length,
    failed: tasks.filter(task => task.status === 'failed').length,
    running: tasks.filter(task => task.status === 'running').length,
    files: tasks.reduce((sum, task) => sum + task.filesCreated.length + task.filesModified.length + task.filesDeleted.length, 0),
    toolCalls: tasks.reduce((sum, task) => sum + (task.observability?.toolCalls ?? 0), 0),
    modelCalls: tasks.reduce((sum, task) => sum + (task.observability?.modelCalls ?? 0), 0),
  }), [tasks]);
  const [filter, setFilter] = useState<'all' | 'completed' | 'failed' | 'running'>('all');
  const [query, setQuery] = useState('');
  const visibleTasks = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return tasks
      .filter(task => filter === 'all' || task.status === filter)
      .filter(task => !needle || task.userRequest.toLowerCase().includes(needle))
      .slice(0, 100);
  }, [tasks, filter, query]);

  /** Chronological timeline for one task, built only from recorded events:
   *  start → each executed command (timestamped) → recorded errors → the real
   *  verification result → end. File changes are grouped at their record time
   *  because the journal stores no per-file timestamp. */
  const timeline = useMemo(() => {
    if (!selected) return [] as Array<{ at: number; kind: string; label: string; detail?: string }>;
    const events: Array<{ at: number; kind: string; label: string; detail?: string }> = [
      { at: selected.createdAt, kind: 'start', label: `Task started (${selected.mode})`, detail: selected.userRequest },
    ];
    for (const command of [...selected.commandsExecuted].sort((a, b) => a.timestamp - b.timestamp)) {
      events.push({
        at: command.timestamp,
        kind: command.exitCode === 0 ? 'command' : 'command-failed',
        label: command.exitCode === 0 ? 'Command succeeded' : `Command failed (exit ${command.exitCode})`,
        detail: command.command,
      });
    }
    for (const error of selected.errors.slice(0, 10)) {
      events.push({ at: selected.updatedAt - 1, kind: 'error', label: 'Error recorded', detail: error });
    }
    if (selected.verification) {
      events.push({
        at: selected.updatedAt,
        kind: selected.verification.exitCode === 0 ? 'verification' : 'verification-failed',
        label: selected.verification.executed ? `Verification ${selected.verification.exitCode === 0 ? 'passed' : 'failed'}` : 'Verification recorded',
        detail: selected.verification.summary,
      });
    }
    events.push({
      at: selected.updatedAt,
      kind: selected.status === 'completed' ? 'end-ok' : selected.status === 'running' ? 'end-running' : 'end-bad',
      label: selected.status === 'completed' ? 'Task completed' : selected.status === 'running' ? 'Task running' : `Task ${selected.status}`,
      detail: formatDuration(selected.observability?.durationMs ?? Math.max(0, selected.updatedAt - selected.createdAt)),
    });
    return events.sort((a, b) => a.at - b.at);
  }, [selected]);

  const handleRollback = async (task: TaskHistoryRecord) => {
    const count = task.rollback?.files?.length ?? 0;
    const confirmed = window.confirm(
      `Roll back ${count} file${count === 1 ? '' : 's'} changed by this task?\n\n` +
      'Only files whose contents still match the task output are restored; manual edits are reported as conflicts.',
    );
    if (!confirmed) return;
    setRollingBack(true);
    setNote(null);
    try {
      const result = await api.rollbackTask(task.id);
      if (result.success) {
        const restored = result.restored?.length ?? 0;
        const conflicts = result.conflicts?.length ?? 0;
        setNote({
          tone: conflicts ? 'error' : 'ok',
          text: conflicts
            ? `Restored ${restored} file${restored === 1 ? '' : 's'}; ${conflicts} file${conflicts === 1 ? '' : 's'} kept manual edits.`
            : `Restored ${restored} file${restored === 1 ? '' : 's'} to their pre-task state.`,
        });
        await load();
      } else {
        setNote({ tone: 'error', text: result.error || 'Rollback was rejected.' });
      }
    } catch (err: any) {
      setNote({ tone: 'error', text: err?.message || 'Rollback failed.' });
    } finally {
      setRollingBack(false);
    }
  };

  if (!active) return null;

  const rollbackAvailable = (task: TaskHistoryRecord) =>
    !working && (task.rollback?.files?.length ?? 0) > 0 && !task.rollback?.restoredAt;

  return (
    <section className="q-task-history flex h-full flex-col overflow-hidden bg-[var(--bg)] text-[11px] text-[var(--text-muted)]" aria-label="QUILLIX task history">
      <header className="flex items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--surface)] px-3 py-2">
        <div className="flex items-center gap-2">
          {selected ? (
            <button
              onClick={() => { setSelectedId(null); setNote(null); }}
              className="q-transition p-1 rounded-lg text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--hover)]"
              aria-label="Back to all tasks"
              title="Back to all tasks"
            >
              <ChevronLeft size={13} />
            </button>
          ) : (
            <History size={13} className="text-[var(--accent)]" aria-hidden="true" />
          )}
          <strong className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--text)]">
            {selected ? 'Task Detail' : 'Task History'}
          </strong>
          {!selected && tasks.length > 0 && (
            <span className="rounded-full border border-[var(--border)] px-2 py-0.5 font-mono text-[10px] text-[var(--text-muted)]">
              {tasks.length} task{tasks.length === 1 ? '' : 's'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void load()}
            className="q-transition p-1 rounded-lg text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--hover)]"
            aria-label="Refresh task history"
            title="Refresh task history"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="q-transition p-1 rounded-lg text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--hover)]"
              aria-label="Close task history"
              title="Close task history"
            >
              <X size={13} />
            </button>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-auto">
        {loading && tasks.length === 0 ? (
          <div className="flex h-full items-center justify-center gap-2 text-[var(--text-muted)]">
            <Loader2 size={14} className="animate-spin" aria-hidden="true" />
            <span>Loading task history…</span>
          </div>
        ) : error && tasks.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <AlertTriangle size={16} className="text-rose-400" aria-hidden="true" />
            <span className="text-[var(--text-muted)]">{error}</span>
          </div>
        ) : !selected ? (
          tasks.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
              <History size={18} className="text-[var(--text-muted)]" aria-hidden="true" />
              <span className="text-[12px] font-medium text-[var(--text)]">No agent tasks recorded yet</span>
              <span className="text-[var(--text-muted)]">
                Every coding run in this workspace is journaled to <span className="font-mono">.quillix/tasks.json</span> and appears here with its files, commands and verification results.
              </span>
            </div>
          ) : (
            <>
            {/* M7.6: real aggregate summary + filter/search over the journal */}
            <div className="border-b border-[var(--border)] px-3 py-2">
              <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                <span className="rounded-full border border-[var(--border)] px-2 py-0.5 font-mono">{summary.total} task{summary.total === 1 ? '' : 's'}</span>
                <span className="rounded-full border border-emerald-800 px-2 py-0.5 font-mono text-emerald-400">{summary.completed} completed</span>
                {summary.failed > 0 && <span className="rounded-full border border-rose-800 px-2 py-0.5 font-mono text-rose-400">{summary.failed} failed</span>}
                {summary.running > 0 && <span className="rounded-full border border-amber-800 px-2 py-0.5 font-mono text-amber-400">{summary.running} running</span>}
                <span className="rounded-full border border-[var(--border)] px-2 py-0.5 font-mono">{summary.files} file change{summary.files === 1 ? '' : 's'}</span>
                <span className="rounded-full border border-[var(--border)] px-2 py-0.5 font-mono">{summary.toolCalls} tool call{summary.toolCalls === 1 ? '' : 's'}</span>
                <span className="rounded-full border border-[var(--border)] px-2 py-0.5 font-mono">{summary.modelCalls} model call{summary.modelCalls === 1 ? '' : 's'}</span>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <div className="flex items-center gap-1" role="group" aria-label="Filter tasks by status">
                  {(['all', 'completed', 'failed', 'running'] as const).map(option => (
                    <button
                      key={option}
                      onClick={() => setFilter(option)}
                      aria-pressed={filter === option}
                      className={`q-transition rounded-full px-2 py-0.5 text-[10px] font-medium ${filter === option ? 'bg-[var(--accent)] text-[var(--accent-ink)]' : 'border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)]'}`}
                    >
                      {option === 'all' ? 'All' : option}
                    </button>
                  ))}
                </div>
                <input
                  type="search"
                  value={query}
                  onChange={event => setQuery(event.target.value)}
                  placeholder="Search prompts…"
                  aria-label="Search task prompts"
                  className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-[10px] text-[var(--text)] outline-none focus:border-[var(--accent)]"
                />
              </div>
              {visibleTasks.length === 0 && (
                <p className="mt-2 text-[10px] text-[var(--text-muted)]">No tasks match this filter.</p>
              )}
            </div>
            <ul className="divide-y divide-[var(--border)]" role="list" aria-label="Recorded agent tasks">
              {visibleTasks.map(task => {
                const fileCount = task.filesCreated.length + task.filesModified.length + task.filesDeleted.length;
                const durationMs = task.observability?.durationMs ?? Math.max(0, task.updatedAt - task.createdAt);
                return (
                  <li key={task.id} role="listitem">
                    <button
                      onClick={() => { setSelectedId(task.id); setNote(null); }}
                      className="q-transition w-full px-3 py-2.5 text-left hover:bg-[var(--hover)]"
                    >
                      <div className="flex items-center gap-2">
                        <StatusIcon status={task.status} />
                        <span className="font-mono text-[10px] text-[var(--text-muted)]" title={new Date(task.createdAt).toLocaleString()}>
                          {formatClock(task.createdAt)}
                        </span>
                        <span className={`text-[10px] font-medium ${STATUS_META[task.status].tone}`}>{STATUS_META[task.status].label}</span>
                        <span className="ml-auto shrink-0 text-[10px] text-[var(--text-muted)]">{relativeTime(task.createdAt, now)}</span>
                      </div>
                      <div className="mt-1 text-[12px] font-medium text-[var(--text)]" title={task.userRequest}>
                        {truncate(task.userRequest, 96)}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-[var(--text-muted)]">
                        {task.projectName && <span className="truncate font-mono" title={task.projectRoot || task.projectName}>{task.projectName}</span>}
                        <span className="flex items-center gap-1"><Clock size={9} aria-hidden="true" />{formatDuration(durationMs)}</span>
                        {fileCount > 0 && <span>{fileCount} file{fileCount === 1 ? '' : 's'}</span>}
                        {task.commandsExecuted.length > 0 && <span>{task.commandsExecuted.length} command{task.commandsExecuted.length === 1 ? '' : 's'}</span>}
                        {task.retryCount > 0 && <span className="text-amber-400">{task.retryCount} retr{task.retryCount === 1 ? 'y' : 'ies'}</span>}
                        {task.observability?.model && <span className="truncate font-mono" title={task.observability.model}>{task.observability.model}</span>}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
            </>
          )
        ) : (
          <div className="px-3 py-3">
            <h3 className="text-[12px] font-medium leading-snug text-[var(--text)]" title={selected.userRequest}>{selected.userRequest}</h3>
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px]">
              <span className={`flex items-center gap-1 font-medium ${STATUS_META[selected.status].tone}`}>
                <StatusIcon status={selected.status} />
                {STATUS_META[selected.status].label}
              </span>
              <span className="text-[var(--text-muted)]">mode: <span className="font-mono">{selected.mode}</span></span>
              {selected.observability?.provider && <span className="text-[var(--text-muted)]">provider: <span className="font-mono">{selected.observability.provider}</span></span>}
              {selected.observability?.model && <span className="text-[var(--text-muted)]">model: <span className="font-mono">{selected.observability.model}</span></span>}
              {selected.projectName && <span className="text-[var(--text-muted)]">project: <span className="font-mono">{selected.projectName}</span></span>}
              <span className="flex items-center gap-1 text-[var(--text-muted)]"><Clock size={9} aria-hidden="true" />{formatDuration(selected.observability?.durationMs ?? Math.max(0, selected.updatedAt - selected.createdAt))}</span>
              {selected.resumedFromTaskId && (
                <span className="text-[var(--text-muted)]" title={selected.resumedFromTaskId}>resumed from <span className="font-mono">{truncate(selected.resumedFromTaskId, 12)}</span></span>
              )}
            </div>

            {note && (
              <div
                role="status"
                className={`mt-2 rounded-lg border px-2 py-1.5 text-[10px] ${
                  note.tone === 'ok'
                    ? 'border-emerald-800 bg-emerald-900/20 text-emerald-300'
                    : 'border-rose-800 bg-rose-900/20 text-rose-300'
                }`}
              >
                {note.text}
              </div>
            )}

            <ol className="mt-3 space-y-3 border-l border-[var(--border)] pl-3" role="list" aria-label="Task timeline">
              <li className="relative" role="listitem">
                <span className="absolute -left-[17px] top-1 h-1.5 w-1.5 rounded-full bg-[var(--accent)]" aria-hidden="true" />
                <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-muted)]">Started</div>
                <div className="text-[var(--text)]">{formatClock(selected.createdAt)} · agent began the request</div>
              </li>

              {selected.filesCreated.length > 0 && (
                <li className="relative" role="listitem">
                  <span className="absolute -left-[17px] top-1 h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
                  <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-emerald-400">Files created ({selected.filesCreated.length})</div>
                  <ul className="mt-0.5 space-y-0.5" role="list">
                    {selected.filesCreated.map(file => (
                      <li key={`created-${file}`} className="flex items-center gap-1.5 font-mono text-[10px] text-[var(--text)]" role="listitem">
                        <FilePlus size={10} className="shrink-0 text-emerald-400" aria-hidden="true" />
                        <span className="truncate" title={file}>{file}</span>
                      </li>
                    ))}
                  </ul>
                </li>
              )}

              {selected.filesModified.length > 0 && (
                <li className="relative" role="listitem">
                  <span className="absolute -left-[17px] top-1 h-1.5 w-1.5 rounded-full bg-amber-400" aria-hidden="true" />
                  <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-amber-400">Files modified ({selected.filesModified.length})</div>
                  <ul className="mt-0.5 space-y-0.5" role="list">
                    {selected.filesModified.map(file => (
                      <li key={`modified-${file}`} className="flex items-center gap-1.5 font-mono text-[10px] text-[var(--text)]" role="listitem">
                        <FileEdit size={10} className="shrink-0 text-amber-400" aria-hidden="true" />
                        <span className="truncate" title={file}>{file}</span>
                      </li>
                    ))}
                  </ul>
                </li>
              )}

              {selected.filesDeleted.length > 0 && (
                <li className="relative" role="listitem">
                  <span className="absolute -left-[17px] top-1 h-1.5 w-1.5 rounded-full bg-rose-400" aria-hidden="true" />
                  <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-rose-400">Files deleted ({selected.filesDeleted.length})</div>
                  <ul className="mt-0.5 space-y-0.5" role="list">
                    {selected.filesDeleted.map(file => (
                      <li key={`deleted-${file}`} className="flex items-center gap-1.5 font-mono text-[10px] text-[var(--text)]" role="listitem">
                        <Trash2 size={10} className="shrink-0 text-rose-400" aria-hidden="true" />
                        <span className="truncate" title={file}>{file}</span>
                      </li>
                    ))}
                  </ul>
                </li>
              )}

              {selected.commandsExecuted.length > 0 && (
                <li className="relative" role="listitem">
                  <span className="absolute -left-[17px] top-1 h-1.5 w-1.5 rounded-full bg-[var(--accent)]" aria-hidden="true" />
                  <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-muted)]">Commands run ({selected.commandsExecuted.length})</div>
                  <ul className="mt-1 space-y-1" role="list">
                    {[...selected.commandsExecuted]
                      .sort((a: TaskHistoryCommand, b: TaskHistoryCommand) => a.timestamp - b.timestamp)
                      .map((entry, index) => (
                        <li key={`command-${entry.timestamp}-${index}`} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1" role="listitem">
                          <div className="flex items-center gap-2">
                            <Terminal size={10} className="shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
                            <span className="font-mono text-[10px] text-[var(--text-muted)]">{formatClock(entry.timestamp)}</span>
                            <span
                              className={`rounded-full border px-1.5 py-0.5 font-mono text-[9px] ${
                                entry.exitCode === 0
                                  ? 'border-emerald-800 text-emerald-400'
                                  : 'border-rose-800 text-rose-400'
                              }`}
                              title={`Exit code ${entry.exitCode}`}
                            >
                              exit {entry.exitCode}
                            </span>
                            <span className="ml-auto shrink-0 font-mono text-[9px] text-[var(--text-muted)]">{formatDuration(entry.durationMs)}</span>
                          </div>
                          <div className="mt-0.5 break-all font-mono text-[10px] text-[var(--text)]" title={entry.command}>{entry.command}</div>
                        </li>
                      ))}
                  </ul>
                </li>
              )}

              {selected.errors.length > 0 && (
                <li className="relative" role="listitem">
                  <span className="absolute -left-[17px] top-1 h-1.5 w-1.5 rounded-full bg-rose-400" aria-hidden="true" />
                  <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-rose-400">Errors ({selected.errors.length})</div>
                  <ul className="mt-0.5 space-y-0.5" role="list">
                    {selected.errors.map((message, index) => (
                      <li key={`error-${index}`} className="flex items-start gap-1.5 text-[10px] text-[var(--text)]" role="listitem">
                        <AlertTriangle size={10} className="mt-0.5 shrink-0 text-rose-400" aria-hidden="true" />
                        <span title={message}>{truncate(message, 160)}</span>
                      </li>
                    ))}
                  </ul>
                </li>
              )}

              {selected.verification && (
                <li className="relative" role="listitem">
                  <span
                    className={`absolute -left-[17px] top-1 h-1.5 w-1.5 rounded-full ${
                      selected.verification.executed && selected.verification.exitCode === 0 ? 'bg-emerald-400' : 'bg-amber-400'
                    }`}
                    aria-hidden="true"
                  />
                  <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-muted)]">Verification</div>
                  <div className="flex items-start gap-1.5 text-[var(--text)]">
                    {selected.verification.executed && selected.verification.exitCode === 0
                      ? <CheckCircle2 size={11} className="mt-0.5 shrink-0 text-emerald-400" aria-hidden="true" />
                      : <AlertTriangle size={11} className="mt-0.5 shrink-0 text-amber-400" aria-hidden="true" />}
                    <span title={selected.verification.summary}>
                      {selected.verification.summary}
                      {!selected.verification.executed && ' (not executed)'}
                    </span>
                  </div>
                </li>
              )}

              <li className="relative" role="listitem">
                <span
                  className={`absolute -left-[17px] top-1 h-1.5 w-1.5 rounded-full ${
                    selected.status === 'completed' ? 'bg-emerald-400' : selected.status === 'failed' ? 'bg-rose-400' : 'bg-amber-400'
                  }`}
                  aria-hidden="true"
                />
                <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-muted)]">
                  Finished · {STATUS_META[selected.status].label}
                </div>
                <div className="text-[var(--text)]">{formatClock(selected.updatedAt)}</div>
                {selected.finalText && (
                  <div className="mt-0.5 text-[10px] text-[var(--text-muted)]" title={selected.finalText}>{truncate(selected.finalText, 400)}</div>
                )}
              </li>
            </ol>

            {selected.observability && (selected.observability.toolCalls > 0 || selected.retryCount > 0) && (
              <div className="mt-3 space-y-1.5">
                <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-muted)]">Tool usage</div>
                <div className="flex flex-wrap gap-1">
                  <span className="rounded-full border border-[var(--border)] px-2 py-0.5 font-mono text-[9px]">
                    {selected.observability.toolCalls} call{selected.observability.toolCalls === 1 ? '' : 's'}
                    {selected.observability.toolFailures > 0 && ` · ${selected.observability.toolFailures} failed`}
                  </span>
                  {selected.observability.verificationRuns > 0 && (
                    <span className="rounded-full border border-[var(--border)] px-2 py-0.5 font-mono text-[9px]">
                      {selected.observability.verificationRuns} verification run{selected.observability.verificationRuns === 1 ? '' : 's'}
                    </span>
                  )}
                  {selected.retryCount > 0 && (
                    <span className="rounded-full border border-amber-800 px-2 py-0.5 font-mono text-[9px] text-amber-400">
                      {selected.retryCount} retr{selected.retryCount === 1 ? 'y' : 'ies'}
                    </span>
                  )}
                </div>
                {selected.observability.byTool && Object.keys(selected.observability.byTool).length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(selected.observability.byTool)
                      .sort(([, a], [, b]) => b.calls - a.calls)
                      .slice(0, 12)
                      .map(([tool, metric]) => (
                        <span
                          key={tool}
                          className="rounded-full border border-[var(--border)] px-2 py-0.5 font-mono text-[9px]"
                          title={`${metric.calls} call${metric.calls === 1 ? '' : 's'}${metric.failures ? `, ${metric.failures} failed` : ''} · ${formatDuration(metric.totalDurationMs)}`}
                        >
                          {tool} ×{metric.calls}{metric.failures > 0 && <span className="text-rose-400"> ({metric.failures} fail)</span>}
                        </span>
                      ))}
                  </div>
                )}
              </div>
            )}

            {/* M7.6: chronological timeline of the recorded run */}
            {timeline.length > 0 && (
              <div className="mt-4 border-t border-[var(--border)] pt-3">
                <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-muted)]">Timeline</div>
                <ol className="mt-2 space-y-2" aria-label="Task event timeline">
                  {timeline.map((event, index) => {
                    const tone = event.kind === 'end-ok' || event.kind === 'command' || event.kind === 'verification'
                      ? 'text-emerald-400'
                      : event.kind === 'command-failed' || event.kind === 'error' || event.kind === 'verification-failed' || event.kind === 'end-bad'
                        ? 'text-rose-400'
                        : 'text-[var(--text-muted)]';
                    return (
                      <li key={`${event.kind}-${event.at}-${index}`} className="flex items-start gap-2">
                        <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${tone.replace('text-', 'bg-')}`} aria-hidden="true" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className={`font-medium ${tone}`}>{event.label}</span>
                            <span className="shrink-0 font-mono text-[9px] text-[var(--text-muted)]">{formatClock(event.at)}</span>
                          </div>
                          {event.detail && <div className="truncate font-mono text-[9px] text-[var(--text-muted)]" title={event.detail}>{truncate(event.detail, 120)}</div>}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </div>
            )}

            <div className="mt-4 flex items-center gap-2 border-t border-[var(--border)] pt-3">
              {rollbackAvailable(selected) ? (
                <button
                  onClick={() => void handleRollback(selected)}
                  disabled={rollingBack}
                  className="q-transition flex items-center gap-1.5 rounded-lg border border-rose-800 bg-rose-900/20 px-2.5 py-1.5 text-[11px] font-medium text-rose-300 hover:bg-rose-900/40 disabled:opacity-50"
                  aria-label={`Roll back ${selected.rollback?.files?.length ?? 0} files changed by this task`}
                  title="Restore files whose contents still match this task's output"
                >
                  {rollingBack ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : <RotateCcw size={12} aria-hidden="true" />}
                  Roll back {selected.rollback?.files?.length ?? 0} file{(selected.rollback?.files?.length ?? 0) === 1 ? '' : 's'}
                </button>
              ) : (
                <span className="text-[10px] text-[var(--text-muted)]">
                  {working
                    ? 'Rollback unlocks when the active task finishes.'
                    : selected.rollback?.restoredAt
                      ? 'Changes already rolled back.'
                      : 'No recorded file changes to roll back.'}
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
};
