import React, { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle, CalendarClock, CheckCircle2, Circle, Clock, Flag, RefreshCw, Target, XCircle,
  ChevronDown, ChevronUp, Zap, TrendingUp
} from "lucide-react";
import { api } from "../services/apiBridge.js";
import { parseMissionState, missionCountdown, gateSummary, testSummary, type MissionState, type MissionGateStatus, type MissionTestStatus } from "../shared/missionState.js";

const GATE_TONE: Record<MissionGateStatus, string> = {
  pass: "text-emerald-400",
  partial: "text-amber-400",
  blocked: "text-amber-400",
  open: "text-[#8b949e]",
  fail: "text-rose-400",
};

const TEST_TONE: Record<MissionTestStatus, string> = {
  pass: "text-emerald-400",
  fail: "text-rose-400",
  blocked: "text-amber-400",
  skipped: "text-[#8b949e]",
};

const SEVERITY_TONE: Record<string, string> = {
  critical: "text-rose-400",
  high: "text-rose-400",
  medium: "text-amber-400",
  low: "text-[#8b949e]",
};

export const GoalProgressSidebar: React.FC<{
  onClose?: () => void;
  initiallyCollapsed?: boolean;
}> = ({ onClose, initiallyCollapsed = false }) => {
  const [state, setState] = useState<MissionState | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [collapsedSections] = useState(() => ({
    gates: initiallyCollapsed,
    tests: initiallyCollapsed,
    blockers: false,
    activity: false,
    benchmarks: initiallyCollapsed,
    nextTasks: initiallyCollapsed,
  }));

  const load = useCallback(async () => {
    try {
      const next = await api.getMissionState();
      setState(next);
      setError(next ? null : "Mission state not initialized");
    } catch {
      setState(null);
      setError("Mission state could not be loaded");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    const refresh = window.setInterval(() => { void load(); }, 15000);
    return () => { window.clearInterval(tick); window.clearInterval(refresh); };
  }, [load]);

  const countdown = state ? missionCountdown(state.deadline, now) : null;
  const percent = state?.verifiedProgressPercent ?? 0;

  if (loading) {
    return (
      <div className="flex h-full flex-col overflow-hidden bg-[var(--bg)] p-3" aria-label="NUVRO AI goal progress">
        <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] pb-2">
          <strong className="font-bold text-[11px] text-[var(--text)]">Goal Progress</strong>
          <span className="text-[10px] font-mono text-[var(--text-muted)]">Loading…</span>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <p className="text-[var(--text-muted)]">Loading mission state…</p>
        </div>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="flex h-full flex-col overflow-hidden bg-[var(--bg)] p-3" aria-label="NUVRO AI goal progress">
        <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] pb-2">
          <strong className="font-bold text-[11px] text-[var(--text)]">Goal Progress</strong>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <p className="text-[10px] text-amber-200">Goal state not initialized</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[var(--bg)] text-[11px] text-[var(--text-muted)]" aria-label="NUVRO AI goal progress">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--surface)] px-3 py-2">
        <div className="flex items-center gap-2">
          <Target size={13} className="text-[var(--accent)]" />
          <strong className="font-bold uppercase tracking-[0.14em] text-[var(--text)]">Goal Progress</strong>
        </div>
        <div className="flex items-center gap-2">
          {countdown && (
            <span className="rounded-full border border-[var(--border)] px-2 py-0.5 font-mono text-[10px]">
              <Clock size={11} aria-hidden="true" />
              {countdown.days}d {String(countdown.hours).padStart(2, "0")}h {String(countdown.minutes).padStart(2, "0")}m
            </span>
          )}
          {onClose && (
            <button onClick={onClose} className="rounded p-1 hover:bg-[var(--hover)]" aria-label="Close goal progress">
              <XCircle size={12} />
            </button>
          )}
        </div>
      </div>

      <div className="border-b border-[var(--border)] bg-[var(--surface)] px-3 py-2">
        <div className="flex justify-between items-center mb-1">
          <span className="font-bold uppercase tracking-[0.12em] text-[var(--text)]">Verified Progress</span>
          <span className="font-mono text-[var(--accent)]">{percent}%</span>
        </div>
        <div className="h-1.5 rounded-full bg-[var(--border)] overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{ width: percent + "%", background: percent >= 75 ? "var(--accent)" : "var(--warning)" }}
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
          />
        </div>
        <p className="mt-0.5 font-mono text-[10px] text-[var(--text-muted)]">
          {state.counts?.completed ?? 0} / {state.counts?.total ?? 0} tasks completed
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-3">
        {state.currentTask && (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-muted)]">Current Task</p>
            <p className="mt-1 text-[var(--text)]">{state.currentTask}</p>
          </div>
        )}

        {state.nextTasks.length > 0 && (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-muted)]">Next Tasks</p>
            <ol className="list-decimal space-y-1 pl-4">
              {state.nextTasks.map((task, i) => <li key={i} className="text-[var(--text)]">{task}</li>)}
            </ol>
          </div>
        )}
      </div>

      <footer className="border-t border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[10px] text-[var(--text-muted)]">
        <p>Verified: {state.activity?.lastVerifiedAt ? new Date(state.activity.lastVerifiedAt).toLocaleString() : "Never"}</p>
      </footer>
    </div>
  );
};
