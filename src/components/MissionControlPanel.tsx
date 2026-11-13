import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle, CalendarClock, CheckCircle2, Circle, Clock, Flag, RefreshCw, Target, XCircle,
} from 'lucide-react';
import { api } from '../services/apiBridge.js';
import { gateSummary, missionCountdown, testSummary, type MissionGateStatus, type MissionState, type MissionTestStatus } from '../shared/missionState.js';

interface Props {
  /** Only poll while the tracker is actually visible. */
  active?: boolean;
  onClose?: () => void;
}

const GATE_TONE: Record<MissionGateStatus, string> = {
  pass: 'text-emerald-400',
  partial: 'text-amber-400',
  blocked: 'text-amber-400',
  open: 'text-[#8b949e]',
  fail: 'text-rose-400',
};

const TEST_TONE: Record<MissionTestStatus, string> = {
  pass: 'text-emerald-400',
  fail: 'text-rose-400',
  blocked: 'text-amber-400',
  skipped: 'text-[#8b949e]',
};

const SEVERITY_TONE: Record<string, string> = {
  critical: 'text-rose-400',
  high: 'text-rose-400',
  medium: 'text-amber-400',
  low: 'text-[#8b949e]',
};

/** QUILLIX MISSION CONTROL — the live deadline tracker. Everything shown is
 * read from the persisted `.quillix/mission/goal-state.json`; nothing here is
 * estimated, simulated, or claimed about background activity. */
export const MissionControlPanel: React.FC<Props> = ({ active = true, onClose }) => {
  const [state, setState] = useState<MissionState | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await api.getMissionState();
      setState(next);
      setError(next ? null : 'Mission state unavailable — checked .quillix/mission/goal-state.json.');
    } catch {
      setState(null);
      setError('Mission state could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (active) void load(); }, [active, load]);

  useEffect(() => {
    if (!active) return;
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    const refresh = window.setInterval(() => { void load(); }, 15000);
    return () => { window.clearInterval(tick); window.clearInterval(refresh); };
  }, [active, load]);

  if (!active) return null;

  const countdown = state ? missionCountdown(state.deadline, now) : null;
  const gates = state ? gateSummary(state.releaseGates) : null;
  const tests = state ? testSummary(state.tests) : null;
  const percent = state?.verifiedProgressPercent ?? 0;
  const counts = state?.counts;

  return (
    <section className="q-mission-control flex h-full flex-col overflow-hidden bg-[var(--bg)] text-[11px] text-[var(--text-muted)]" aria-label="NUVRO AI mission control">
      <header className="flex items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--surface)] px-3 py-2">
        <div className="flex items-center gap-2">
          <Target size={13} className="text-[var(--accent)]" />
          <strong className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--text)]">Mission Control</strong>
          <span className="text-[10px] text-[var(--text-muted)]">{state?.mission ?? 'QUILLIX'}</span>
        </div>
        <div className="flex items-center gap-2">
          {countdown && (
            <span
              className={`flex items-center gap-1 rounded-full border border-[var(--border)] px-2 py-0.5 font-mono text-[10px] ${
                countdown.expired ? 'border-rose-800 text-rose-400' : countdown.critical ? 'border-amber-800 text-amber-400' : 'text-[var(--text)]'
              }`}
              title={`Deadline: ${state?.deadline ?? 'not set'}`}
            >
              <Clock size={11} aria-hidden="true" />
              {countdown.expired
                ? 'DEADLINE PASSED'
                : `${countdown.days}d ${String(countdown.hours).padStart(2, '0')}h ${String(countdown.minutes).padStart(2, '0')}m`}
            </span>
          )}
          <button onClick={() => void load()} className="rounded p-1 hover:bg-[var(--hover)]" aria-label="Refresh mission state" title="Refresh mission state">
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          </button>
          {onClose && (
            <button onClick={onClose} className="rounded p-1 hover:bg-[var(--hover)]" aria-label="Close mission control" title="Close mission control">
              <XCircle size={12} />
            </button>
          )}
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {error && (
          <p className="flex items-start gap-2 rounded-lg border border-amber-800 bg-amber-950/40 p-2 text-[10px] text-amber-200">
            <AlertTriangle size={12} className="mt-0.5 shrink-0" />
            {error}
          </p>
        )}
        {/* Verified progress — derived from the persisted counts, never estimated. */}
        <div>
          <div className="mb-1 flex items-baseline justify-between">
            <span className="text-[10px] font-bold uppercase tracking-[0.12em]">Verified progress</span>
            <span className="font-mono text-[11px] text-[var(--text)]">{percent}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#21262d]" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="Verified mission progress">
            <div className="h-full rounded-full bg-emerald-500" style={{ width: `${percent}%` }} />
          </div>
          {counts && (
            <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px]">
              <span>done <strong className="text-emerald-400">{counts.completed}</strong></span>
              <span>active <strong className="text-amber-400">{counts.inProgress}</strong></span>
              <span>pending <strong className="text-[var(--text)]">{counts.pending}</strong></span>
              <span>total {counts.total}</span>
            </p>
          )}
        </div>

        {/* Phase and current task */}
        {state && (
          <div className="rounded-lg border border-[var(--border)] p-2">
            <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em]">
              <Flag size={11} aria-hidden="true" /> Phase {state.phase.id} — {state.phase.title}
            </p>
            <p className="mt-1 text-[var(--text)]"><strong className="font-semibold">Current:</strong> {state.currentTask}</p>
            <p className="mt-0.5"><strong className="font-semibold">Next:</strong> {state.nextPlannedTask}</p>
          </div>
        )}
        {/* Release gates */}
        {state && state.releaseGates.length > 0 && (
          <div>
            <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.12em]">Release gates</p>
            <ul className="space-y-1">
              {state.releaseGates.map(gate => (
                <li key={gate.id} className="flex items-start justify-between gap-2">
                  <span className="flex min-w-0 items-start gap-1.5">
                    {gate.status === 'pass'
                      ? <CheckCircle2 size={12} className="mt-px shrink-0 text-emerald-400" aria-hidden="true" />
                      : gate.status === 'open' || gate.status === 'partial'
                        ? <Circle size={12} className="mt-px shrink-0 text-amber-400" aria-hidden="true" />
                        : <AlertTriangle size={12} className="mt-px shrink-0 text-[var(--text-muted)]" aria-hidden="true" />}
                    <span className="min-w-0">
                      <span className="text-[var(--text)]">{gate.title}</span>
                      {gate.detail && <span className="block truncate font-mono text-[10px] text-[var(--text-muted)]">{gate.detail}</span>}
                    </span>
                  </span>
                  <span className={`shrink-0 font-mono uppercase ${GATE_TONE[gate.status]}`}>{gate.status}</span>
                </li>
              ))}
            </ul>
            {gates && (
              <p className="mt-1 font-mono text-[10px] text-[var(--text-muted)]">
                {gates.pass} pass · {gates.partial} partial · {gates.blocked} blocked · {gates.open} open{gates.fail ? ` · ${gates.fail} FAIL` : ''}
              </p>
            )}
          </div>
        )}

        {/* Test results */}
        {state && state.tests.length > 0 && (
          <div>
            <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.12em]">Test results</p>
            <ul className="space-y-1">
              {state.tests.map(test => (
                <li key={test.name} className="flex items-start justify-between gap-2">
                  <span className="min-w-0 font-mono text-[var(--text)]">{test.name}{test.detail ? <span className="ml-1 text-[var(--text-muted)]">· {test.detail}</span> : null}</span>
                  <span className={`shrink-0 font-mono uppercase ${TEST_TONE[test.status]}`}>{test.status}</span>
                </li>
              ))}
            </ul>
            {tests && (
              <p className="mt-1 font-mono text-[10px] text-[var(--text-muted)]">
                {tests.pass} pass · {tests.blocked} blocked · {tests.fail} fail · {tests.skipped} n/a
              </p>
            )}
          </div>
        )}
        {/* Blockers */}
        {state && state.blockers.length > 0 && (
          <div>
            <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.12em]">Active blockers</p>
            <ul className="space-y-1">
              {state.blockers.map(blocker => (
                <li key={blocker.id} className="flex items-start justify-between gap-2">
                  <span className="min-w-0">
                    <span className="font-mono text-[var(--text-muted)]">{blocker.id}</span> <span className="text-[var(--text)]">{blocker.title}</span>
                    {blocker.approvalRequired && <span className="ml-1 rounded border border-amber-800 px-1 text-[9px] text-amber-400">approval required</span>}
                  </span>
                  <span className={`shrink-0 font-mono uppercase ${SEVERITY_TONE[blocker.severity] ?? 'text-[var(--text-muted)]'}`}>{blocker.severity}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Development activity + checkpoints */}
        {state && (
          <div>
            <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.12em]">Development activity</p>
            <p className="text-[var(--text)]">{state.activity.current}</p>
            <p className="mt-0.5 flex items-center gap-1.5">
              <CalendarClock size={11} aria-hidden="true" /> last verified {state.activity.lastVerifiedAt ?? '—'}
            </p>
            <p className="mt-0.5"><strong className="font-semibold">Checkpoint:</strong> <span className="font-mono">{state.latestCheckpoint}</span></p>
            {state.activity.note && <p className="mt-0.5 text-[var(--text-muted)]">{state.activity.note}</p>}
          </div>
        )}

        {/* Cursor benchmark */}
        {state && (
          <div>
            <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.12em]">Cursor benchmark</p>
            <p className="text-[var(--text)]">Cursor baseline: <strong className="font-semibold">{state.benchmarks.cursorBaseline}</strong></p>
            <p className="mt-0.5">NUVRO AI harness: {state.benchmarks.harnessVerified ? 'verified' : 'unverified'} · no Cursor numbers are claimed</p>
            {state.benchmarks.note && <p className="mt-0.5 text-[var(--text-muted)]">{state.benchmarks.note}</p>}
          </div>
        )}

        {/* Next tasks */}
        {state && state.nextTasks.length > 0 && (
          <div>
            <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.12em]">Next tasks</p>
            <ol className="list-decimal space-y-1 pl-4">
              {state.nextTasks.map(task => <li key={task} className="text-[var(--text)]">{task}</li>)}
            </ol>
          </div>
        )}
      </div>
    </section>
  );
};
