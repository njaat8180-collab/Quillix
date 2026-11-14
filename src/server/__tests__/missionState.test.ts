import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  computeVerifiedProgressPercent,
  gateSummary,
  missionCountdown,
  parseMissionState,
  testSummary,
  MISSION_STATE_PATH,
  MISSION_STATE_VERSION,
} from '../../shared/missionState.js';

const valid = {
  schemaVersion: 1,
  mission: 'QUILLIX > CURSOR',
  startedAt: '2026-11-08T00:00:00+05:30',
  deadline: '2026-11-11T23:59:00+05:30',
  counts: { completed: 40, inProgress: 4, pending: 23, total: 67 },
  phase: { id: 'P1', title: 'Foundation & recovery', note: 'audit' },
  currentTask: 'Mission Control tracker',
  releaseGates: [
    { id: 'G3', title: 'Build succeeds', status: 'pass', detail: 'build EXIT 0' },
    { id: 'G1', title: 'No known critical bugs', status: 'open' },
    { id: 'G7', title: 'Windows package verified', status: 'open', detail: 'package:win pending' },
  ],
  tests: [
    { name: 'tsc', status: 'pass', at: '2026-11-08T07:14:00Z' },
    { name: 'benchmark-artifact', status: 'blocked', detail: 'needs live Ollama' },
    { name: 'no-status' },
  ],
  blockers: [
    { id: 'B1', severity: 'medium', title: 'Agent Mail server down', approvalRequired: true },
    { severity: 'high', title: 'entry with no id' },
  ],
  nextTasks: ['P2.1 auto-repair', '  '],
};

describe('parseMissionState', () => {
  it('parses a well-formed state file', () => {
    const state = parseMissionState(valid);
    expect(state.mission).toBe('QUILLIX > CURSOR');
    expect(state.deadline).toBe('2026-11-11T23:59:00+05:30');
    expect(state.counts).toEqual({ completed: 40, inProgress: 4, pending: 23, total: 67 });
    expect(state.phase).toMatchObject({ id: 'P1', title: 'Foundation & recovery', note: 'audit' });
    expect(state.currentTask).toBe('Mission Control tracker');
    expect(state.degraded).toBe(false);
  });

  it('derives verified progress from counts when the file omits it', () => {
    const state = parseMissionState({ ...valid, verifiedProgressPercent: undefined });
    expect(state.verifiedProgressPercent).toBe(60);
  });

  it('derives progress from the item counts when total is missing', () => {
    expect(computeVerifiedProgressPercent({ completed: 40, inProgress: 4, pending: 23, total: 0 })).toBe(60);
    expect(computeVerifiedProgressPercent({ completed: 0, inProgress: 0, pending: 0, total: 0 })).toBe(0);
  });

  it('degrades missing/corrupt files to explicit defaults without throwing', () => {
    for (const raw of [undefined, null, 'nope', 42, [], {}]) {
      const state = parseMissionState(raw);
      expect(state.degraded).toBe(true);
      expect(state.counts.total).toBe(0);
      expect(state.verifiedProgressPercent).toBe(0);
      expect(state.currentTask).toBe('—');
      expect(state.releaseGates).toEqual([]);
    }
  });

  it('keeps a newer schemaVersion instead of silently downgrading it', () => {
    const state = parseMissionState({ ...valid, schemaVersion: MISSION_STATE_VERSION + 5 });
    expect(state.schemaVersion).toBe(MISSION_STATE_VERSION + 5);
    // ...and still normalizes the rest so the tracker keeps working.
    expect(state.counts.total).toBe(67);
    expect(state.mission).toBe('QUILLIX > CURSOR');
  });

  it('rejects unknown statuses instead of passing them through', () => {
    const state = parseMissionState({
      ...valid,
      releaseGates: [{ id: 'G1', title: 'x', status: 'wishful' }],
      tests: [{ name: 't', status: 'probably-fine' }],
      blockers: [{ id: 'B1', severity: 'imminent', title: 'x' }],
    });
    expect(state.releaseGates[0]?.status).toBe('open');
    expect(state.tests[0]?.status).toBe('skipped');
    expect(state.blockers[0]?.severity).toBe('low');
  });

  it('drops malformed entries and keeps the valid ones', () => {
    const state = parseMissionState(valid);
    expect(state.blockers).toEqual([{ id: 'B1', severity: 'medium', title: 'Agent Mail server down', approvalRequired: true }]);
    expect(state.tests.map(t => t.status)).toEqual(['pass', 'blocked', 'skipped']);
    expect(state.nextTasks).toEqual(['P2.1 auto-repair']);
  });

  it('drops invalid dates rather than rendering NaN', () => {
    const state = parseMissionState({ ...valid, deadline: '11/11/2026-ish', startedAt: 12345 });
    expect(state.deadline).toBeNull();
    expect(state.startedAt).toBeNull();
  });

  it('reads the persisted mission state (live when present, fixture otherwise)', () => {
    // The persisted mission state is intentionally gitignored (`**/.quillix/`),
    // so a fresh clone or a fresh git worktree carries no mission state at all.
    // Validate the live operator state when the tree has it and the tracked
    // fixture otherwise, so this case is reproducible on every checkout instead
    // of failing purely because of the environment.
    const live = path.join(process.cwd(), ...MISSION_STATE_PATH);
    const fixture = path.join(process.cwd(), 'scripts', 'smoke', 'fixtures', 'mission', 'goal-state.json');
    const file = fs.existsSync(live) ? live : fixture;
    expect(fs.existsSync(file)).toBe(true);
    const persisted = JSON.parse(fs.readFileSync(file, 'utf8'));
    const state = parseMissionState(persisted);
    expect(state.mission).toBe('QUILLIX > CURSOR');
    expect(state.counts).toEqual(persisted.counts);
    expect(state.counts.completed + state.counts.inProgress + state.counts.pending).toBe(state.counts.total);
    expect(state.verifiedProgressPercent).toBe(computeVerifiedProgressPercent(state.counts));
    expect(state.releaseGates).not.toEqual([]);
    // The fixture must never claim a Cursor baseline it did not measure.
    expect(persisted.benchmarks.cursorBaseline).toBe('not-collected');
    // A critical blocker always needs an approval.
    for (const blocker of persisted.blockers) {
      if (blocker.severity === 'critical') expect(blocker.approvalRequired).toBe(true);
    }
  });
});

describe('missionCountdown', () => {
  const deadline = '2026-11-11T23:59:00+05:30';
  it('counts down from a now before the deadline', () => {
    const result = missionCountdown(deadline, Date.parse('2026-11-08T12:45:00+05:30'));
    expect(result.expired).toBe(false);
    expect(result.days).toBe(3);
    expect(result.hours).toBe(11);
    expect(result.minutes).toBe(14);
    expect(result.critical).toBe(false);
  });
  it('flags the final 24 hours as critical', () => {
    const result = missionCountdown(deadline, Date.parse('2026-11-11T00:00:00+05:30'));
    expect(result.critical).toBe(true);
    expect(result.expired).toBe(false);
  });
  it('reports expiry at or after the deadline', () => {
    const result = missionCountdown(deadline, Date.parse('2026-11-12T00:00:00+05:30'));
    expect(result.expired).toBe(true);
    expect(result.critical).toBe(true);
  });
  it('is inert for a missing or unparseable deadline', () => {
    expect(missionCountdown(null).expired).toBe(false);
    expect(missionCountdown('soon').expired).toBe(false);
  });
});

describe('summaries', () => {
  it('counts gates by status', () => {
    const summary = gateSummary(parseMissionState(valid).releaseGates);
    expect(summary).toEqual({ open: 2, pass: 1, partial: 0, fail: 0, blocked: 0 });
  });
  it('counts test results by status', () => {
    const summary = testSummary(parseMissionState(valid).tests);
    expect(summary).toEqual({ pass: 1, fail: 0, blocked: 1, skipped: 1 });
  });
});
