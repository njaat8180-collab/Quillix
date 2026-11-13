import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const compareScript = path.resolve('scripts/smoke/compare-benchmark.mjs');

// Import the functions to test directly
import { wilsonInterval, intervalsOverlap } from './benchmark-statistics.mjs';

test('wilsonInterval computes correct 95% intervals for known cases', () => {
  // 100/100 -> should be near 1.0 with narrow interval
  const a = wilsonInterval(100, 100);
  assert.ok(a.lower >= 0.96 && a.lower <= 0.98, `lower=${a.lower}`);
  assert.ok(a.upper >= 0.99 && a.upper <= 1.0, `upper=${a.upper}`);

  // 0/100 -> should be near 0.0
  const b = wilsonInterval(0, 100);
  assert.ok(b.lower >= 0 && b.lower <= 0.02, `lower=${b.lower}`);
  assert.ok(b.upper >= 0.02 && b.upper <= 0.04, `upper=${b.upper}`);

  // 50/100 -> center near 0.5
  const c = wilsonInterval(50, 100);
  assert.ok(c.lower >= 0.40 && c.lower <= 0.42, `lower=${c.lower}`);
  assert.ok(c.upper >= 0.58 && c.upper <= 0.60, `upper=${c.upper}`);

  // Edge case: total=0
  const d = wilsonInterval(0, 0);
  assert.deepEqual(d, { lower: 0, upper: 0 });
  assert.throws(() => wilsonInterval(2, 1), RangeError);
  assert.throws(() => wilsonInterval(-1, 2), RangeError);
});

test('intervalsOverlap correctly detects overlap and separation', () => {
  assert.equal(intervalsOverlap({ lower: 0.4, upper: 0.6 }, { lower: 0.5, upper: 0.7 }), true);
  assert.equal(intervalsOverlap({ lower: 0.4, upper: 0.5 }, { lower: 0.6, upper: 0.8 }), false);
  assert.equal(intervalsOverlap({ lower: 0.3, upper: 0.7 }, { lower: 0.5, upper: 0.6 }), true);
  assert.equal(intervalsOverlap({ lower: 0.0, upper: 0.1 }, { lower: 0.9, upper: 1.0 }), false);
  // Edge: touching boundaries
  assert.equal(intervalsOverlap({ lower: 0.4, upper: 0.5 }, { lower: 0.5, upper: 0.6 }), true);
});

function runCompare(evaluatorFingerprint, transformBaseline = value => value, repeats = 3, quillixPassed = repeats) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-compare-contract-'));
  try {
    const reports = [];
    for (let i = 1; i <= repeats; i++) {
      reports.push({ case: 'unit-case', repetition: i });
    }
    const base = {
      protocol: 'quillix-coding-benchmark-v7',
      summarySchemaVersion: 3,
      caseSetFingerprint: 'same-cases',
      evaluatorContractFingerprint: 'evaluator-a',
      environment: { hardwareKey: 'same-hardware' },
      runSettings: { repeats, timeoutMs: 60000, acceptanceProvided: true },
      caseIds: ['unit-case'],
      reports,
      aggregate: {
        total: repeats, passed: quillixPassed, passRatePercent: Math.round((quillixPassed / repeats) * 100),
        attempted: { total: repeats, medianDurationMs: 1000, p95DurationMs: 1000, medianProviderOrEstimatedTokens: 100, p95ProviderOrEstimatedTokens: 100, medianModelCalls: 1, p95ModelCalls: 1, tokenAccounting: { accountedRuns: repeats, providerReportedRuns: 0, mixedReportedRuns: 0, estimatedRuns: repeats, zeroCallRuns: 0, unaccountedRuns: 0, coveragePercent: 100 } },
        repair: { runsWithRepairPhase: 0, repairPhaseCount: 0, failedAfterRepairCount: 0 },
        regressions: { behavioralFailureRuns: 0, tokenBudgetFailureRuns: 0, independentCheckFailureRuns: 0, browserCheckFailureRuns: 0, protectedFileRegressionRuns: 0, unexpectedFileCreationRuns: 0, forbiddenLeakRuns: 0 },
      },
    };
    const quillixFile = path.join(directory, 'quillix.json');
    const baselineFile = path.join(directory, 'baseline.json');
    fs.writeFileSync(quillixFile, JSON.stringify(base));
    fs.writeFileSync(baselineFile, JSON.stringify(transformBaseline({ ...base, evaluatorContractFingerprint: evaluatorFingerprint })));
    return spawnSync(process.execPath, [compareScript, quillixFile, baselineFile], { encoding: 'utf8', windowsHide: true });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test('benchmark summaries with the same evaluator contract remain comparable', () => {
  const result = runCompare('evaluator-a');
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /"status": "COMPARABLE"/);
  assert.match(result.stdout, /"metric": "attempted\.medianDurationMs"/);
  assert.match(result.stdout, /"tokenAccounting": \{\s+"accountedRuns": 3/);
});

test('pass-rate comparison reports Wilson intervals and marks overlapping low-sample results inconclusive', () => {
  const result = runCompare('evaluator-a', baseline => ({
    ...baseline,
    aggregate: { ...baseline.aggregate, passed: 0, passRatePercent: 0 },
  }));
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const summary = JSON.parse(result.stdout);
  const passRate = summary.metrics.find(metric => metric.metric === 'passRatePercent');
  assert.equal(passRate.better, 'inconclusive');
  assert.deepEqual(passRate.quillixWilson, { lower: 43.85, upper: 100 });
  assert.deepEqual(passRate.baselineWilson, { lower: 0, upper: 56.15 });
  assert.match(summary.notes, /not a significance test/i);
  assert.match(summary.notes, /correlated/i);
});

test('pass-rate comparison shows directional separation when Wilson intervals do not overlap', () => {
  const result = runCompare('evaluator-a', baseline => ({
    ...baseline,
    aggregate: { ...baseline.aggregate, passed: 50, passRatePercent: 50 },
  }), 100);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const passRate = JSON.parse(result.stdout).metrics.find(metric => metric.metric === 'passRatePercent');
  assert.equal(passRate.better, 'quillix');
  assert.ok(passRate.quillixWilson.lower > passRate.baselineWilson.upper);
});

test('benchmark summaries with a different evaluator contract are rejected as incomparable', () => {
  const result = runCompare('evaluator-b');
  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /"evaluator contract fingerprint missing or mismatched"/);
});

test('legacy benchmark summaries without an evaluator fingerprint are not comparable', () => {
  const result = runCompare(undefined);
  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /"evaluator contract fingerprint missing or mismatched"/);
});

test('summaries without schema 3 reporting metrics are not comparable', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-compare-legacy-schema-'));
  try {
    const current = {
      protocol: 'quillix-coding-benchmark-v7', caseSetFingerprint: 'same-cases', evaluatorContractFingerprint: 'evaluator-a',
      summarySchemaVersion: 3, environment: { hardwareKey: 'same-hardware' },
      runSettings: { repeats: 1, timeoutMs: 60000, acceptanceProvided: true }, caseIds: ['unit-case'],
      reports: [{ case: 'unit-case', repetition: 1 }],
      aggregate: { total: 1, passed: 1, passRatePercent: 100, attempted: { total: 1 }, repair: {}, regressions: {} },
    };
    const old = { ...current }; delete old.summarySchemaVersion;
    const currentFile = path.join(directory, 'current.json');
    const oldFile = path.join(directory, 'old.json');
    fs.writeFileSync(currentFile, JSON.stringify(current));
    fs.writeFileSync(oldFile, JSON.stringify(old));
    const comparison = spawnSync(process.execPath, [compareScript, currentFile, oldFile], { encoding: 'utf8', windowsHide: true });
    assert.equal(comparison.status, 1);
    assert.match(comparison.stdout, /summary schema is missing, stale, mismatched, or token accounting is incomplete/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('rejects a schema 3 label when attempted metrics are incomplete', () => {
  const result = runCompare('evaluator-a', baseline => ({
    ...baseline,
    aggregate: { ...baseline.aggregate, attempted: { total: 1 } },
  }));
  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /summary schema is missing, stale, mismatched, or token accounting is incomplete/);
});

test('rejects a schema 3 artifact when token telemetry is unaccounted', () => {
  const result = runCompare('evaluator-a', baseline => ({
    ...baseline,
    aggregate: { ...baseline.aggregate, attempted: { ...baseline.aggregate.attempted, tokenAccounting: { ...baseline.aggregate.attempted.tokenAccounting, accountedRuns: 0, estimatedRuns: 0, unaccountedRuns: 1, coveragePercent: 0 } } },
  }));
  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /token accounting is incomplete/);
});

test('rejects benchmark summaries with only 1 repeat', () => {
  const result = runCompare('evaluator-a', value => value, 1);
  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /"status": "NOT_COMPARABLE"/);
  assert.match(result.stdout, /"comparability": "at least three repeated trials per case are required"/);
});

test('rejects benchmark summaries with only 2 repeats', () => {
  const result = runCompare('evaluator-a', value => value, 2);
  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /"status": "NOT_COMPARABLE"/);
  assert.match(result.stdout, /"comparability": "at least three repeated trials per case are required"/);
});
