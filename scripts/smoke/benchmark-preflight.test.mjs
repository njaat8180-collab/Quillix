import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

const smokeTemp = path.resolve(import.meta.dirname, '../../.quillix-smoke');
fs.mkdirSync(smokeTemp, { recursive: true });

const resourcePauseEnv = {
  QUILLIX_MAX_CPU_PERCENT: '-1',
  QUILLIX_ENFORCE_RESOURCE_GUARD: '1',
};

test('coding benchmark records a resumable resource pause before starting a model', () => {
  const sandbox = fs.mkdtempSync(path.join(smokeTemp, 'benchmark-preflight-'));
  try {
    const summaryPath = path.join(sandbox, 'summary.json');
    const tsxCli = path.resolve('node_modules/tsx/dist/cli.mjs');
    const benchmarkScript = path.resolve('scripts/smoke/coding-benchmark.ts');
    const result = spawnSync(process.execPath, [tsxCli, benchmarkScript, 'short-open-file-follow-up'], {
      cwd: sandbox,
      timeout: 20_000,
      encoding: 'utf8',
      windowsHide: true,
      env: {
        ...process.env,
        ...resourcePauseEnv,
        OLLAMA_MODEL: 'qwen2.5-coder:1.5b',
        QUILLIX_BENCHMARK_RESOURCE_WAIT_MS: '0',
        QUILLIX_BENCHMARK_SUMMARY_PATH: summaryPath,
      },
    });

    assert.notEqual(result.status, 0, 'a resource-blocked benchmark must not report success');
    assert.ok(fs.existsSync(summaryPath), 'external summary must be written before the runner exits');
    const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
    assert.equal(summary.status, 'paused');
    assert.deepEqual(summary.caseIds, ['short-open-file-follow-up']);
    assert.deepEqual(summary.progress, { completed: 0, total: 1 });
    assert.equal(summary.model, 'qwen2.5-coder:1.5b');
    assert.equal(summary.preflight.status, 'paused');
    assert.ok(summary.preflight.waitedMs >= 0);
    assert.equal(summary.preflight.modelStarted, false);
    assert.match(summary.preflight.reason, /CPU/i);
    assert.deepEqual(summary.preflight.resume.arguments, ['short-open-file-follow-up']);
    assert.equal(summary.preflight.resume.environment.OLLAMA_MODEL, 'qwen2.5-coder:1.5b');
    assert.equal(summary.preflight.resume.environment.QUILLIX_BENCHMARK_RESOURCE_WAIT_MS, '0');
    assert.deepEqual(summary.reports, []);
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

test('public SWE-bench runner records a resumable preflight pause without loading Ollama', () => {
  const sandbox = fs.mkdtempSync(path.join(smokeTemp, 'swebench-preflight-'));
  const checkout = path.join(sandbox, 'repo');
  const output = path.join(sandbox, 'evaluation');
  fs.mkdirSync(checkout);
  try {
    const git = args => execFileSync('git', args, {cwd: checkout, encoding: 'utf8', windowsHide: true});
    git(['init']);
    git(['config', 'user.email', 'quillix-test@example.invalid']);
    git(['config', 'user.name', 'Quillix Test']);
    fs.writeFileSync(path.join(checkout, 'README.md'), 'fixture\n');
    git(['add', 'README.md']);
    git(['commit', '-m', 'fixture']);
    const baseCommit = git(['rev-parse', 'HEAD']).trim();
    const manifest = path.join(sandbox, 'task.json');
    fs.writeFileSync(manifest, JSON.stringify({instance_id:'fixture__repo-1', repo:'fixture/repo', base_commit:baseCommit, problem_statement:'Fix the fixture.'}));
    const script = path.resolve('scripts/smoke/run-swebench-task.ts');
    const tsxCli = path.resolve('node_modules/tsx/dist/cli.mjs');
    const result = spawnSync(process.execPath, [tsxCli, script, manifest, checkout, output], {
      cwd: process.cwd(), timeout: 20000, encoding: 'utf8', windowsHide: true,
      env: {...process.env, ...resourcePauseEnv, OLLAMA_MODEL:'qwen2.5-coder:1.5b'},
    });
    assert.notEqual(result.status, 0, 'resource gate must stop the run');
    const recordPath = path.join(output, 'preflight-paused.json');
    assert.ok(fs.existsSync(recordPath), result.stderr);
    const record = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
    assert.equal(record.status, 'PAUSED_RESOURCE_GUARD');
    assert.equal(record.instanceId, 'fixture__repo-1');
    assert.match(record.reason, /CPU/i);
    assert.ok(record.resourceSnapshot.memoryFreeBytes >= 0);
    assert.ok(record.resourceSnapshot.memoryUsedPercent >= 0 && record.resourceSnapshot.memoryUsedPercent <= 100);
    assert.ok(Number.isFinite(record.resourceSnapshot.sampledAt));
    assert.equal(fs.existsSync(path.join(output, 'prediction.jsonl')), false);
    assert.match(result.stderr, /no request was sent/i);
    const wrongManifest = path.join(sandbox, 'other-task.json');
    fs.writeFileSync(wrongManifest, JSON.stringify({instance_id:'fixture__repo-2', repo:'fixture/repo', base_commit:baseCommit, problem_statement:'Different task.'}));
    const wrongTask = spawnSync(process.execPath, [tsxCli, script, wrongManifest, checkout, output], {
      cwd: process.cwd(), timeout: 20000, encoding: 'utf8', windowsHide: true,
      env: {...process.env, ...resourcePauseEnv, OLLAMA_MODEL:'qwen2.5-coder:1.5b'},
    });
    assert.notEqual(wrongTask.status, 0);
    assert.match(wrongTask.stderr, /different public task/);
  } finally { fs.rmSync(sandbox, {recursive:true, force:true}); }
});
