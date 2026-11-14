import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, beforeEach, expect, it } from 'vitest';

let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-compare-')); });
afterEach(() => { fs.rmSync(root, {recursive: true, force: true}); });

const summary = {
  protocol: 'quillix-coding-benchmark-v7',
  summarySchemaVersion: 3,
  caseSetFingerprint: 'b'.repeat(64), evaluatorContractFingerprint: 'a'.repeat(64),
  environment: { hardwareKey: 'same-machine' },
  runSettings: {repeats: 3, timeoutMs: 180000, acceptanceProvided: true},
  caseIds: ['frontend', 'backend'], reports: [
    {case: 'frontend', repetition: 1}, {case: 'frontend', repetition: 2}, {case: 'frontend', repetition: 3},
    {case: 'backend', repetition: 1}, {case: 'backend', repetition: 2}, {case: 'backend', repetition: 3},
  ],
  aggregate: {
    total: 6, passed: 3, passRatePercent: 50,
    attempted: {
      total: 6, medianDurationMs: 1500, p95DurationMs: 2000,
      medianProviderOrEstimatedTokens: 150, p95ProviderOrEstimatedTokens: 200,
      medianModelCalls: 1.5, p95ModelCalls: 2,
      tokenAccounting: { accountedRuns: 6, providerReportedRuns: 0, mixedReportedRuns: 0, estimatedRuns: 6, zeroCallRuns: 0, unaccountedRuns: 0, coveragePercent: 100 },
    },
    repair: { runsWithRepairPhase: 1, repairPhaseCount: 1, failedAfterRepairCount: 0 },
    regressions: { behavioralFailureRuns: 0, tokenBudgetFailureRuns: 0, independentCheckFailureRuns: 0, browserCheckFailureRuns: 0, protectedFileRegressionRuns: 0, unexpectedFileCreationRuns: 0, forbiddenLeakRuns: 0 },
  },
};
function compare(baseline: typeof summary) {
  const files = [summary, baseline].map((s, i) => {
    const file = path.join(root, i + '.json');
    fs.writeFileSync(file, JSON.stringify(s));
    return file;
  });
  const run = spawnSync(process.execPath, ['scripts/smoke/compare-benchmark.mjs', ...files], {encoding: 'utf8'});
  return {status: run.status, result: JSON.parse(run.stdout)};
}
it('compares like-for-like scores and reports equal results as a tie', () => {
  const {status, result} = compare(summary);
  expect(status).toBe(0);
  expect(result.status).toBe('COMPARABLE');
  expect(result.metrics.find((m: {metric: string}) => m.metric === 'passRatePercent').better).toBe('tie');
  expect(result.metrics.find((m: {metric: string}) => m.metric === 'attempted.medianDurationMs').better).toBe('tie');
  expect(result.metrics.find((m: {metric: string}) => m.metric === 'repair.runsWithRepairPhase').better).toBe('informational');
});
it('rejects duplicate cases, partial runs and a different time limit', () => {
  for (const baseline of [
    {...summary, reports: [summary.reports[0], summary.reports[0]]},
    {...summary, reports: summary.reports.slice(0, 1)},
    {...summary, runSettings: {...summary.runSettings, timeoutMs: 300000}},
  ]) {
    expect(compare(baseline)).toMatchObject({status: 1, result: {status: 'NOT_COMPARABLE'}});
  }
});

it('rejects a baseline captured on different hardware', () => {
  const {status, result} = compare({...summary, environment: {hardwareKey: 'different-machine'}});
  expect(status).toBe(1);
  expect(result.status).toBe('NOT_COMPARABLE');
  expect(result.comparability).toMatch(/hardware/i);
});
