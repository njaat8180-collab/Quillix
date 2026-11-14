import fs from 'node:fs';
import path from 'node:path';

const file = path.resolve('.quillix-smoke', 'ollama-model-matrix.json');

// The matrix is a REAL measured artifact: 3 models x 7 cases x 3 repeats =
// 63 live local-model runs produced by `npm run benchmark:matrix`. It is
// intentionally git-ignored, so it cannot exist on a clean checkout or on a
// machine without a running Ollama instance.
//
// When the artifact is ABSENT there is nothing to validate and nothing to
// fabricate. Report an explicit BLOCKED result (exit 0, like the
// `test:live-tavily` credential-free skip) instead of crashing with ENOENT
// and aborting the whole acceptance run.
//
// When the artifact IS present it is validated in full and a stale or
// invalid matrix still FAILS the gate. The strictness is never weakened.
if (!fs.existsSync(file)) {
  console.log(JSON.stringify({
    status: 'BLOCKED',
    reason: 'Benchmark matrix artifact is absent; run `npm run benchmark:matrix` against a live local Ollama instance to produce it.',
    artifact: file,
    models: 3,
    uniqueCases: 7,
    repeats: 3,
    totalRuns: 63,
  }));
  process.exit(0);
}
const report = JSON.parse(fs.readFileSync(file, 'utf8'));
const expectedModels = ['qwen2.5-coder:1.5b', 'qwen2.5-coder:3b', 'qwen3:4b'];
const expectedCases = ['greeting-module', 'async-retry', 'backend-refactor', 'python-runtime-repair', 'node-runtime-repair', 'website-continuation-repair', 'project-prompt-injection-boundary'];
if (report.protocol !== 'quillix-coding-benchmark-v7') throw new Error('Benchmark matrix protocol is stale or missing.');
if (report.summarySchemaVersion !== 3) throw new Error('Benchmark matrix summary schema is stale or missing.');
if (!/^[a-f0-9]{64}$/i.test(report.evaluatorContractFingerprint || '')) throw new Error('Benchmark matrix evaluator contract fingerprint is missing.');
if (!/^[a-f0-9]{64}$/i.test(report.caseSetFingerprint || '')) throw new Error('Benchmark matrix case-set fingerprint is missing.');
if (report.provenanceConsistent !== true) throw new Error('Benchmark matrix is missing consistent per-model provenance.');
if (!Number.isInteger(report.repeats) || report.repeats < 3 || report.repeats > 5) throw new Error('Benchmark matrix must include at least three repeated trials per model/case.');
if (JSON.stringify(report.models) !== JSON.stringify(expectedModels)) throw new Error('Benchmark model matrix does not match the required representative models.');
if (JSON.stringify(report.cases) !== JSON.stringify(expectedCases)) throw new Error('Benchmark case matrix does not match the required representative cases.');
if (!report.environment?.hardwareKey || !report.environment?.platform || !report.environment?.arch) throw new Error('Benchmark matrix is missing environment hardware metadata.');
if (!Array.isArray(report.matrix) || report.matrix.length !== expectedModels.length) throw new Error('Benchmark matrix must contain one result per model.');
for (const row of report.matrix) {
  if (row.protocol !== report.protocol || row.summarySchemaVersion !== report.summarySchemaVersion || row.evaluatorContractFingerprint !== report.evaluatorContractFingerprint || row.caseSetFingerprint !== report.caseSetFingerprint) {
    throw new Error(`Benchmark provenance mismatch for ${row.model || 'unknown model'}.`);
  }
  const expectedRuns = expectedCases.length * report.repeats;
  if (row.exitCode !== 0 || row.aggregate?.total !== expectedRuns || row.aggregate?.passed !== expectedRuns || row.aggregate?.passRatePercent !== 100 || row.failedCases?.length) {
    throw new Error(`Benchmark failed for ${row.model || 'unknown model'}.`);
  }
  const attempted = row.aggregate?.attempted;
  const attemptedMetrics = ['total', 'medianDurationMs', 'p95DurationMs', 'medianProviderOrEstimatedTokens', 'p95ProviderOrEstimatedTokens', 'medianModelCalls', 'p95ModelCalls'];
  if (!attempted || attemptedMetrics.some(key => !Number.isFinite(attempted[key])) || attempted.total !== expectedRuns) {
    throw new Error(`Benchmark attempted-run metrics are missing or incomplete for ${row.model || 'unknown model'}.`);
  }
  const tokenAccounting = attempted.tokenAccounting;
  const accountingCounts = ['accountedRuns', 'providerReportedRuns', 'mixedReportedRuns', 'estimatedRuns', 'zeroCallRuns', 'unaccountedRuns'];
  if (!tokenAccounting || accountingCounts.some(key => !Number.isInteger(tokenAccounting[key]) || tokenAccounting[key] < 0) ||
      accountingCounts.slice(1).reduce((sum, key) => sum + tokenAccounting[key], 0) !== expectedRuns ||
      tokenAccounting.accountedRuns !== expectedRuns || tokenAccounting.unaccountedRuns !== 0 || tokenAccounting.coveragePercent !== 100) {
    throw new Error(`Token accounting is incomplete for ${row.model || 'unknown model'}.`);
  }
  const repair = row.aggregate?.repair;
  if (!repair || !['runsWithRepairPhase', 'repairPhaseCount', 'failedAfterRepairCount'].every(key => Number.isFinite(repair[key])) || repair.failedAfterRepairCount !== 0) {
    throw new Error(`Benchmark repair summary is missing or reports unresolved repairs for ${row.model || 'unknown model'}.`);
  }
  const regressions = row.aggregate?.regressions;
  const regressionMetrics = ['behavioralFailureRuns', 'tokenBudgetFailureRuns', 'independentCheckFailureRuns', 'browserCheckFailureRuns', 'protectedFileRegressionRuns', 'unexpectedFileCreationRuns', 'forbiddenLeakRuns'];
  if (!regressions || regressionMetrics.some(key => !Number.isFinite(regressions[key]) || regressions[key] !== 0)) {
    throw new Error(`Benchmark regression summary is missing or reports a regression for ${row.model || 'unknown model'}.`);
  }
}
console.log(JSON.stringify({ status: 'PASS', models: expectedModels.length, uniqueCases: expectedCases.length, repeats: report.repeats, summarySchemaVersion: report.summarySchemaVersion, totalRuns: expectedModels.length * expectedCases.length * report.repeats, hardwareKey: report.environment.hardwareKey, artifact: file }));
