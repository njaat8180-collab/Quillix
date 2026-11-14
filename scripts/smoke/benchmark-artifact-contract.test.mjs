import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const contractScript = path.resolve('scripts/smoke/benchmark-artifact-contract.mjs');
const models = ['qwen2.5-coder:1.5b', 'qwen2.5-coder:3b', 'qwen3:4b'];
const cases = ['greeting-module', 'async-retry', 'backend-refactor', 'python-runtime-repair', 'node-runtime-repair', 'website-continuation-repair', 'project-prompt-injection-boundary'];
const protocol = 'quillix-coding-benchmark-v7';
const summarySchemaVersion = 3;
const repeats = 3;
const evaluatorContractFingerprint = 'a'.repeat(64);
const caseSetFingerprint = 'b'.repeat(64);

function runContract(mutator = value => value) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-benchmark-artifact-'));
  try {
    fs.mkdirSync(path.join(cwd, '.quillix-smoke'), { recursive: true });
    const report = {
      protocol, summarySchemaVersion, evaluatorContractFingerprint, caseSetFingerprint, provenanceConsistent: true,
      models, cases, repeats, environment: { hardwareKey: 'test-machine', platform: 'win32', arch: 'x64' },
      matrix: models.map(model => ({
        model, protocol, summarySchemaVersion, evaluatorContractFingerprint, caseSetFingerprint, exitCode: 0,
        aggregate: {
          total: cases.length * repeats, passed: cases.length * repeats, passRatePercent: 100,
          attempted: { total: cases.length * repeats, medianDurationMs: 1000, p95DurationMs: 2000, medianProviderOrEstimatedTokens: 100, p95ProviderOrEstimatedTokens: 200, medianModelCalls: 2, p95ModelCalls: 4, tokenAccounting: { accountedRuns: cases.length * repeats, providerReportedRuns: 0, mixedReportedRuns: 0, estimatedRuns: cases.length * repeats, zeroCallRuns: 0, unaccountedRuns: 0, coveragePercent: 100 } },
          repair: { runsWithRepairPhase: 1, repairPhaseCount: 1, failedAfterRepairCount: 0 },
          regressions: { behavioralFailureRuns: 0, tokenBudgetFailureRuns: 0, independentCheckFailureRuns: 0, browserCheckFailureRuns: 0, protectedFileRegressionRuns: 0, unexpectedFileCreationRuns: 0, forbiddenLeakRuns: 0 },
        },
        failedCases: [],
      })),
    };
    fs.writeFileSync(path.join(cwd, '.quillix-smoke', 'ollama-model-matrix.json'), JSON.stringify(mutator(report)));
    return spawnSync(process.execPath, [contractScript], { cwd, encoding: 'utf8', windowsHide: true });
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

test('reports an explicit BLOCKED result when the live matrix artifact is absent', () => {
  // The matrix is a real measured artifact (63 live local-model runs) and is
  // intentionally git-ignored. Its absence must be reported honestly, never
  // fabricated into a PASS and never crash the acceptance run with ENOENT.
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-benchmark-absent-'));
  try {
    const result = spawnSync(process.execPath, [contractScript], { cwd, encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /"status":"BLOCKED"/);
    assert.match(result.stdout, /"totalRuns":63/);
    assert.doesNotMatch(result.stdout, /"status":"PASS"/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('accepts only a complete v7 model matrix with matching evaluator provenance', () => {
  const result = runContract();
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /"status":"PASS"/);
  assert.match(result.stdout, /"totalRuns":63/);
});

test('rejects old protocol and missing evaluator provenance', () => {
  const result = runContract(report => ({ ...report, protocol: 'quillix-coding-benchmark-v5', evaluatorContractFingerprint: null }));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /protocol is stale or missing/);
});

test('rejects per-model evaluator provenance drift', () => {
  const result = runContract(report => ({
    ...report,
    matrix: report.matrix.map((row, index) => index ? row : { ...row, evaluatorContractFingerprint: 'c'.repeat(64) }),
  }));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /provenance mismatch/);
});

test('rejects per-model summary-schema drift', () => {
  const result = runContract(report => ({
    ...report,
    matrix: report.matrix.map((row, index) => index ? row : { ...row, summarySchemaVersion: 1 }),
  }));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /provenance mismatch/);
});

test('rejects a single-trial benchmark artifact', () => {
  const result = runContract(report => ({
    ...report,
    repeats: 1,
    matrix: report.matrix.map(row => ({ ...row, aggregate: { total: cases.length, passed: cases.length, passRatePercent: 100 } })),
  }));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /at least three repeated trials/);
});

test('rejects a pass-rate-only artifact that lacks attempted, repair, and regression metrics', () => {
  const result = runContract(report => ({
    ...report,
    matrix: report.matrix.map(row => ({ ...row, aggregate: { total: cases.length * repeats, passed: cases.length * repeats, passRatePercent: 100 } })),
  }));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /attempted-run metrics are missing or incomplete/);
});

test('rejects an artifact whose token accounting coverage is incomplete', () => {
  const result = runContract(report => ({
    ...report,
    matrix: report.matrix.map(row => ({ ...row, aggregate: { ...row.aggregate, attempted: { ...row.aggregate.attempted, tokenAccounting: { ...row.aggregate.attempted.tokenAccounting, unaccountedRuns: 1, accountedRuns: cases.length * repeats - 1, estimatedRuns: cases.length * repeats - 1, coveragePercent: 98 } } } })),
  }));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Token accounting is incomplete/);
});

