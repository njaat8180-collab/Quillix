import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('deterministic Tavily demo separates fixture operations from real usage', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-tavily-demo-contract-'));
  const outputPath = path.join(tempRoot, 'demo.json');
  try {
    const tsxCli = path.resolve('node_modules/tsx/dist/cli.mjs');
    const demoScript = path.resolve('scripts/smoke/tavily-hackathon-demo.ts');
    const result = spawnSync(process.execPath, [tsxCli, demoScript], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 20_000,
      windowsHide: true,
      env: { ...process.env, QUILLIX_DEMO_APPROVE: 'true', QUILLIX_TAVILY_DEMO_OUTPUT: outputPath },
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const report = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
    assert.equal(report.final, 'verified');
    assert.equal(report.transport, 'deterministic-fixture (no Tavily credits spent)');
    assert.deepEqual(report.usage, { searches: 0, extracts: 0, credits: 0, estimatedCostUsd: 0 });
    assert.deepEqual(report.simulatedOperations, { searches: 1, extracts: 1, transport: 'fixture-only' });
    assert.ok(report.stages.every(stage => stage.status === 'passed'));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
