/**
 * Persisted mission goal state (QUILLIX MISSION CONTROL).
 *
 * The deadline mission keeps a single machine-readable source of truth at
 * `.quillix/mission/goal-state.json`. This module is the one place that
 * reads it: purely defensive, never throws, and never invents values.
 * A partially written or unknown-shape file degrades to explicit defaults so
 * the tracker always renders something truthful instead of crashing.
 */

export const MISSION_STATE_VERSION = 1;

/** Path of the persisted state file, relative to a workspace root. */
export const MISSION_STATE_PATH = ['.quillix', 'mission', 'goal-state.json'] as const;

export type MissionGateStatus = 'open' | 'pass' | 'partial' | 'fail' | 'blocked';
export type MissionTestStatus = 'pass' | 'fail' | 'blocked' | 'skipped';
export type MissionBlockerSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface MissionCounts {
  completed: number;
  inProgress: number;
  pending: number;
  total: number;
}

export interface MissionGate {
  id: string;
  title: string;
  status: MissionGateStatus;
  detail?: string;
}

export interface MissionTestResult {
  name: string;
  status: MissionTestStatus;
  detail?: string;
  at?: string;
}

export interface MissionBlocker {
  id: string;
  severity: MissionBlockerSeverity;
  title: string;
  approvalRequired: boolean;
}

export interface MissionPhase {
  id: string;
  title: string;
  startedAt: string | null;
  endsAt: string | null;
  note?: string;
}

export interface MissionState {
  schemaVersion: number;
  mission: string;
  startedAt: string | null;
  deadline: string | null;
  releaseTarget: string | null;
  phase: MissionPhase;
  currentTask: string;
  counts: MissionCounts;
  /** Derived from counts unless the file already carries an explicit value. */
  verifiedProgressPercent: number;
  nextTasks: string[];
  blockers: MissionBlocker[];
  tests: MissionTestResult[];
  benchmarks: { cursorBaseline: string; harnessVerified: boolean; note?: string };
  activity: { lastVerifiedAt: string | null; current: string; note?: string };
  latestCheckpoint: string;
  nextPlannedTask: string;
  releaseGates: MissionGate[];
  /** True when defaults were substituted (file missing fields / wrong shape). */
  degraded: boolean;
}

const DEFAULT_COUNTS: MissionCounts = { completed: 0, inProgress: 0, pending: 0, total: 0 };

const GATE_STATUSES: MissionGateStatus[] = ['open', 'pass', 'partial', 'fail', 'blocked'];
const TEST_STATUSES: MissionTestStatus[] = ['pass', 'fail', 'blocked', 'skipped'];
const SEVERITIES: MissionBlockerSeverity[] = ['low', 'medium', 'high', 'critical'];

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function num(value: unknown, fallback: number): number {
  const parsed = typeof value === 'string' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : fallback;
}

function iso(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : value;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** A plain object worth reading fields from (arrays and null are not). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Percent of roadmap items with verified evidence, derived from the counts. */
export function computeVerifiedProgressPercent(counts: MissionCounts): number {
  const total = counts.total > 0 ? counts.total : counts.completed + counts.inProgress + counts.pending;
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((counts.completed / total) * 100)));
}

export interface MissionCountdown {
  totalMs: number;
  days: number;
  hours: number;
  minutes: number;
  expired: boolean;
  /** Under 24 hours until the deadline. */
  critical: boolean;
}

export function missionCountdown(deadlineIso: string | null, now: number = Date.now()): MissionCountdown {
  const empty: MissionCountdown = { totalMs: 0, days: 0, hours: 0, minutes: 0, expired: false, critical: false };
  if (!deadlineIso) return empty;
  const target = Date.parse(deadlineIso);
  if (Number.isNaN(target)) return empty;
  const totalMs = target - now;
  if (totalMs <= 0) return { ...empty, expired: true, critical: true };
  return {
    totalMs,
    days: Math.floor(totalMs / 86_400_000),
    hours: Math.floor((totalMs % 86_400_000) / 3_600_000),
    minutes: Math.floor((totalMs % 3_600_000) / 60_000),
    expired: false,
    critical: totalMs <= 86_400_000,
  };
}

export function gateSummary(gates: MissionGate[]): Record<MissionGateStatus, number> {
  const summary: Record<MissionGateStatus, number> = { open: 0, pass: 0, partial: 0, fail: 0, blocked: 0 };
  for (const gate of gates) if (GATE_STATUSES.includes(gate.status)) summary[gate.status] += 1;
  return summary;
}

export function testSummary(tests: MissionTestResult[]): Record<MissionTestStatus, number> {
  const summary: Record<MissionTestStatus, number> = { pass: 0, fail: 0, blocked: 0, skipped: 0 };
  for (const test of tests) if (TEST_STATUSES.includes(test.status)) summary[test.status] += 1;
  return summary;
}

/**
 * Forward-compatible parse. Missing/unknown fields fall back to explicit
 * defaults; a newer `schemaVersion` is kept as-is (never silently downgraded)
 * while the rest is still normalized so the tracker keeps working.
 */
export function parseMissionState(raw: unknown): MissionState {
  const input = (isRecord(raw) && Object.keys(raw).length > 0 ? raw : {}) as Record<string, unknown>;
  const degraded = !isRecord(raw) || Object.keys(raw).length === 0;
  const rawCounts = (input.counts && typeof input.counts === 'object' ? input.counts : {}) as Record<string, unknown>;
  const counts: MissionCounts = {
    completed: num(rawCounts.completed, DEFAULT_COUNTS.completed),
    inProgress: num(rawCounts.inProgress, DEFAULT_COUNTS.inProgress),
    pending: num(rawCounts.pending, DEFAULT_COUNTS.pending),
    total: num(rawCounts.total, 0),
  };
  const rawPhase = (input.phase && typeof input.phase === 'object' ? input.phase : {}) as Record<string, unknown>;
  const rawBenchmarks = (input.benchmarks && typeof input.benchmarks === 'object' ? input.benchmarks : {}) as Record<string, unknown>;
  const rawActivity = (input.activity && typeof input.activity === 'object' ? input.activity : {}) as Record<string, unknown>;

  return {
    schemaVersion: num(input.schemaVersion, MISSION_STATE_VERSION),
    mission: str(input.mission, 'QUILLIX'),
    startedAt: iso(input.startedAt),
    deadline: iso(input.deadline),
    releaseTarget: iso(input.releaseTarget),
    phase: {
      id: str(rawPhase.id, 'P1'),
      title: str(rawPhase.title, 'Unknown phase'),
      startedAt: iso(rawPhase.startedAt),
      endsAt: iso(rawPhase.endsAt),
      ...(str(rawPhase.note, '') ? { note: str(rawPhase.note, '') } : {}),
    },
    currentTask: str(input.currentTask, '—'),
    counts,
    verifiedProgressPercent: num(input.verifiedProgressPercent, computeVerifiedProgressPercent(counts)),
    nextTasks: list(input.nextTasks).filter((item): item is string => typeof item === 'string' && !!item.trim()),
    blockers: list(input.blockers).flatMap((item) => {
      const entry = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
      const id = str(entry.id, '');
      if (!id) return [];
      const severity = SEVERITIES.includes(entry.severity as MissionBlockerSeverity)
        ? (entry.severity as MissionBlockerSeverity)
        : 'low';
      return [{ id, severity, title: str(entry.title, 'Untitled blocker'), approvalRequired: entry.approvalRequired === true }];
    }),
    tests: list(input.tests).flatMap((item) => {
      const entry = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
      const name = str(entry.name, '');
      if (!name) return [];
      const status = TEST_STATUSES.includes(entry.status as MissionTestStatus) ? (entry.status as MissionTestStatus) : 'skipped';
      const detail = str(entry.detail, '');
      const at = iso(entry.at);
      return [{ name, status, ...(detail ? { detail } : {}), ...(at ? { at } : {}) }];
    }),
    benchmarks: {
      cursorBaseline: str(rawBenchmarks.cursorBaseline, 'not-collected'),
      harnessVerified: rawBenchmarks.harnessVerified === true,
      ...(str(rawBenchmarks.note, '') ? { note: str(rawBenchmarks.note, '') } : {}),
    },
    activity: {
      lastVerifiedAt: iso(rawActivity.lastVerifiedAt),
      current: str(rawActivity.current, '—'),
      ...(str(rawActivity.note, '') ? { note: str(rawActivity.note, '') } : {}),
    },
    latestCheckpoint: str(input.latestCheckpoint, '—'),
    nextPlannedTask: str(input.nextPlannedTask, '—'),
    releaseGates: list(input.releaseGates).flatMap((item) => {
      const entry = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
      const id = str(entry.id, '');
      if (!id) return [];
      const status = GATE_STATUSES.includes(entry.status as MissionGateStatus) ? (entry.status as MissionGateStatus) : 'open';
      const detail = str(entry.detail, '');
      return [{ id, title: str(entry.title, 'Untitled gate'), status, ...(detail ? { detail } : {}) }];
    }),
    degraded,
  };
}