import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('Windows package gate pauses before building when system limits are exceeded', () => {
  const tsxCli = path.resolve('node_modules/tsx/dist/cli.mjs');
  const gate = path.resolve('scripts/smoke/package-resource-preflight.ts');
  const result = spawnSync(process.execPath, [tsxCli, gate], {
    cwd: process.cwd(), timeout: 20_000, encoding: 'utf8', windowsHide: true,
    env: { ...process.env, QUILLIX_MAX_CPU_PERCENT: '-1', QUILLIX_ENFORCE_RESOURCE_GUARD: '1' },
  });
  assert.equal(result.status, 75, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /PAUSED_RESOURCE_GUARD/);
  assert.match(result.stderr, /blocked before build/i);
  const record = JSON.parse(result.stdout.trim().split(/\r?\n/).find(line => line.startsWith('{')));
  assert.match(record.reason, /CPU/i);
  assert.ok(record.snapshot.memoryFreeBytes >= 0);
  assert.ok(record.snapshot.memoryUsedPercent >= 0 && record.snapshot.memoryUsedPercent <= 100);
  assert.ok(Number.isFinite(record.snapshot.sampledAt));
});

test('Windows packager calls the shared resource gate in-process before building', () => {
  const packager = fs.readFileSync(path.resolve('scripts/smoke/package-win.mjs'), 'utf8');
  assert.match(packager, /import \{ tsImport \} from 'tsx\/esm\/api'/);
  assert.match(packager, /tsImport\('\.\/package-resource-preflight\.ts', import\.meta\.url\)/);
  assert.match(packager, /await checkPackageResources\(root\)/);
  assert.doesNotMatch(packager, /resourcePreflightCli/);
});
