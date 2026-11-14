import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

/** Reproducible local-brain benchmark matrix; never contacts a cloud provider. */
const defaultModels = ['qwen2.5-coder:1.5b', 'qwen2.5-coder:3b', 'qwen3:4b'];
const defaultCases = [
  'greeting-module',
  'async-retry',
  'backend-refactor',
  'python-runtime-repair',
  'node-runtime-repair',
  'website-continuation-repair',
  'project-prompt-injection-boundary',
];
const models = (process.env.QUILLIX_MATRIX_MODELS || defaultModels.join(','))
  .split(',').map(value => value.trim()).filter(Boolean);
const cases = (process.env.QUILLIX_MATRIX_CASES || defaultCases.join(','))
  .split(',').map(value => value.trim()).filter(Boolean);
const repeats = process.env.QUILLIX_MATRIX_REPEATS || '3';
// CPU-only Qwen3 turns can legitimately need just over four minutes when a
// verifier-driven repair escalates to another installed brain. Keep the
// default bounded, but avoid classifying that known cold/repair path as a
// cancellation. A caller can still set QUILLIX_BENCHMARK_TIMEOUT_MS.
const explicitTimeout = process.env.QUILLIX_BENCHMARK_TIMEOUT_MS;
const dryRun = process.argv.includes('--dry-run');
const outputPath = path.resolve(process.env.QUILLIX_MATRIX_OUTPUT || path.join('.quillix-smoke', 'ollama-model-matrix.json'));
const tsxCli = path.resolve('node_modules/tsx/dist/cli.mjs');

const jobs = models.map(model => ({ model, cases, repeats }));
if (dryRun) {
  console.log(JSON.stringify({ mode: 'dry-run', jobs, outputPath }, null, 2));
  process.exit(0);
}

const matrix: Array<Record<string, unknown>> = [];
let matrixEnvironment: Record<string, unknown> | undefined;
for (const job of jobs) {
  const summaryPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-matrix-')), 'summary.json');
  const result = spawnSync(process.execPath, [tsxCli, 'scripts/smoke/coding-benchmark.ts', '--acceptance', ...job.cases], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      OLLAMA_MODEL: job.model,
      QUILLIX_BENCHMARK_REPEATS: job.repeats,
      QUILLIX_BENCHMARK_SUMMARY_PATH: summaryPath,
      QUILLIX_BENCHMARK_TIMEOUT_MS: explicitTimeout || (/^qwen3(?::|$)/i.test(job.model) ? '600000' : '240000'),
    },
    stdio: 'inherit',
    windowsHide: true,
  });
  let summary: Record<string, unknown> | undefined;
  try { summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8')); } catch { /* failed runs still get a useful matrix row */ }
  if (!matrixEnvironment && summary?.environment && typeof summary.environment === 'object') {
    matrixEnvironment = summary.environment as Record<string, unknown>;
  }
  const reports = Array.isArray(summary?.reports) ? summary.reports as Array<Record<string, any>> : [];
  const failedCases = reports
    .filter(report => !report.completed || !report.checksPassed)
    .map(report => ({
      case: report.case,
      repetition: report.repetition,
      completed: report.completed,
      checksPassed: report.checksPassed,
      error: report.error || report.finalText || report.independentCheck?.output || 'No case diagnostic was recorded.',
    }));
  matrix.push({
    model: job.model,
    protocol: typeof summary?.protocol === 'string' ? summary.protocol : undefined,
    summarySchemaVersion: typeof summary?.summarySchemaVersion === 'number' ? summary.summarySchemaVersion : undefined,
    evaluatorContractFingerprint: typeof summary?.evaluatorContractFingerprint === 'string' ? summary.evaluatorContractFingerprint : undefined,
    caseSetFingerprint: typeof summary?.caseSetFingerprint === 'string' ? summary.caseSetFingerprint : undefined,
    exitCode: result.status ?? 1,
    signal: result.signal || undefined,
    aggregate: summary?.aggregate || null,
    failedCases,
    summaryPath,
  });
}

const reference = matrix[0];
const provenanceConsistent = matrix.length === models.length && !!reference?.protocol && reference?.summarySchemaVersion === 3 && !!reference?.evaluatorContractFingerprint && !!reference?.caseSetFingerprint &&
  matrix.every(row => row.protocol === reference.protocol && row.summarySchemaVersion === reference.summarySchemaVersion && row.evaluatorContractFingerprint === reference.evaluatorContractFingerprint && row.caseSetFingerprint === reference.caseSetFingerprint);
const report = {
  createdAt: new Date().toISOString(),
  protocol: reference?.protocol || null,
  summarySchemaVersion: reference?.summarySchemaVersion || null,
  evaluatorContractFingerprint: reference?.evaluatorContractFingerprint || null,
  caseSetFingerprint: reference?.caseSetFingerprint || null,
  provenanceConsistent,
  models, cases, repeats: Number(repeats), environment: matrixEnvironment || null, matrix,
};
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  outputPath,
  matrix: matrix.map(row => ({
    model: row.model,
    exitCode: row.exitCode,
    summarySchemaVersion: row.summarySchemaVersion,
    aggregate: row.aggregate,
    failedCases: row.failedCases,
  })),
}, null, 2));
if (matrix.some(row => row.exitCode !== 0) || !provenanceConsistent) process.exitCode = 1;
