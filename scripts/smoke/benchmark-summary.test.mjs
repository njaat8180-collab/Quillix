import assert from 'node:assert/strict';
import test from 'node:test';
import { aggregateBenchmarkReports } from './benchmark-summary.ts';

test('attempted latency and token costs include failed trials without hiding successful-only metrics', () => {
  const summary = aggregateBenchmarkReports([
    { completed: true, checksPassed: true, durationMs: 100, estimatedTokensPerWrittenFile: 10, modelCalls: 1, observability: { tokenCountSource: 'estimate', estimatedTotalTokens: 10 }, tools: [{}], behavioralChecksPassed: true, tokenBudgetGuard: { pass: true }, independentCheck: { exitCode: 0 } },
    { completed: false, checksPassed: false, durationMs: 300, observability: { tokenCountSource: 'provider', actualTotalTokens: 30 }, modelCalls: 3, tools: [{}, {}, {}], behavioralChecksPassed: false, tokenBudgetGuard: { pass: true }, independentCheck: { exitCode: 1 }, browserCheck: { exitCode: 1 }, unexpectedlyChangedFiles: ['README.md'], unexpectedlyCreatedFiles: ['payload.txt'], forbiddenContentLeaks: ['CANARY'], phases: [{ id: 'fixes', status: 'completed' }] },
    { completed: true, checksPassed: true, durationMs: 200, estimatedTokensPerWrittenFile: 20, modelCalls: 2, observability: { tokenCountSource: 'estimate', estimatedTotalTokens: 20 }, tools: [{}, {}], behavioralChecksPassed: true, tokenBudgetGuard: { pass: true }, independentCheck: { exitCode: 0 }, phases: [{ id: 'fixes', status: 'completed' }] },
  ]);

  assert.equal(summary.total, 3);
  assert.equal(summary.passed, 2);
  assert.equal(summary.passRatePercent, 67);
  assert.equal(summary.medianDurationMs, 100);
  assert.equal(summary.attempted.total, 3);
  assert.equal(summary.attempted.medianDurationMs, 200);
  assert.equal(summary.attempted.p95DurationMs, 300);
  assert.equal(summary.attempted.p95ProviderOrEstimatedTokens, 30);
  assert.deepEqual(summary.attempted.tokenAccounting, { accountedRuns: 3, providerReportedRuns: 1, mixedReportedRuns: 0, estimatedRuns: 2, zeroCallRuns: 0, unaccountedRuns: 0, coveragePercent: 100 });
  assert.equal(summary.attempted.p95ModelCalls, 3);
  assert.deepEqual(summary.repair, { runsWithRepairPhase: 2, repairPhaseCount: 2, failedAfterRepairCount: 1 });
  assert.deepEqual(summary.regressions, {
    behavioralFailureRuns: 1,
    tokenBudgetFailureRuns: 0,
    independentCheckFailureRuns: 1,
    browserCheckFailureRuns: 1,
    protectedFileRegressionRuns: 1,
    unexpectedFileCreationRuns: 1,
    forbiddenLeakRuns: 1,
  });
});

test('a pre-provider failure is still counted as an attempt with zero tokens', () => {
  const summary = aggregateBenchmarkReports([{ completed: false, checksPassed: false, durationMs: 25, modelCalls: 0 }]);
  assert.equal(summary.attempted.total, 1);
  assert.equal(summary.attempted.medianDurationMs, 25);
  assert.equal(summary.attempted.medianProviderOrEstimatedTokens, 0);
  assert.equal(summary.repair.failedAfterRepairCount, 0);
  assert.equal(summary.regressions.independentCheckFailureRuns, 0, 'not-run checks are not recorded as failed checks');
  assert.deepEqual(summary.attempted.tokenAccounting, { accountedRuns: 1, providerReportedRuns: 0, mixedReportedRuns: 0, estimatedRuns: 0, zeroCallRuns: 1, unaccountedRuns: 0, coveragePercent: 100 });
});

test('missing token telemetry is reported as unaccounted instead of invented zero usage', () => {
  const summary = aggregateBenchmarkReports([{ completed: false, checksPassed: false, durationMs: 25, modelCalls: 2 }]);
  assert.equal(summary.attempted.medianProviderOrEstimatedTokens, 0, 'percentiles use only accounted attempts');
  assert.deepEqual(summary.attempted.tokenAccounting, { accountedRuns: 0, providerReportedRuns: 0, mixedReportedRuns: 0, estimatedRuns: 0, zeroCallRuns: 0, unaccountedRuns: 1, coveragePercent: 0 });
});
