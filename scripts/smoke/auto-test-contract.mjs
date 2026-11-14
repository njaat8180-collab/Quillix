import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// M3.4 auto-run-on-save contract: the check must be opt-in, resolved only from
// the workspace package.json, advisory after a save, and honestly unavailable
// when paused (Offline Mode / no scripts / no npm). Fails on a tree without it.
const root = process.cwd();
const server = fs.readFileSync(path.join(root, 'server.ts'), 'utf8');
const shared = fs.readFileSync(path.join(root, 'src', 'shared', 'autoTestOnSave.ts'), 'utf8');
const runner = fs.readFileSync(path.join(root, 'src', 'server', 'autoTestRunner.ts'), 'utf8');
const bridge = fs.readFileSync(path.join(root, 'src', 'services', 'apiBridge.ts'), 'utf8');
const panel = fs.readFileSync(path.join(root, 'src', 'components', 'BuildTestPanel.tsx'), 'utf8');
const settings = fs.readFileSync(path.join(root, 'src', 'server', 'settings.ts'), 'utf8');
const types = fs.readFileSync(path.join(root, 'src', 'shared', 'types.ts'), 'utf8');

// --- shared planning surface ---
assert.match(shared, /export function pickAutoTestCommand\(/, 'shared module resolves the command from the manifest');
assert.match(shared, /export function resolveAutoTestPlan\(/, 'shared module resolves enablement + offline pause');
assert.match(shared, /export function autoTestShouldRun\(/, 'shared module owns the pacing decision');
assert.match(shared, /export function summarizeAutoTestRun\(/, 'shared module bounds run summaries');
assert.match(shared, /Offline Mode is on/, 'Offline Mode pause reason is explicit');

// --- runtime hardening ---
assert.match(runner, /shell: false/, 'the check is spawned without a shell');
assert.match(runner, /RUN_TIMEOUT_MS = 120_000/, 'a hard timeout bounds every run');
assert.match(runner, /HISTORY_LIMIT = 5/, 'history is bounded');
assert.match(runner, /MAX_OUTPUT_CHARS = 200_000/, 'captured output is bounded');
assert.match(runner, /npm-cli\.js/, 'npm runs through Node, not a shell .cmd');

// --- server wiring ---
assert.match(server, /const autoTestRunner = new AutoTestRunner\(settingsStore\);/, 'server instantiates the runner');
assert.match(server, /autoTestRunner\.notifySave\(filePath\);/, 'saves schedule the automatic check');
assert.match(server, /\/api\/editor\/auto-test/, 'auto-test endpoints exist');
assert.match(server, /settingsStore\.update\(\{ autoRunTestsOnSave|runNow !== true/, 'the endpoint validates its request');

// --- settings: opt-in default ---
assert.match(types, /autoRunTestsOnSave\?: boolean;/, 'settings type carries the flag');
assert.match(settings, /autoRunTestsOnSave: false,/, 'the flag defaults to OFF (opt-in)');
assert.match(settings, /autoRunTestsOnSave: s\.autoRunTestsOnSave === true,/, 'the flag is sanitized on load');

// --- renderer ---
assert.match(bridge, /getAutoTestStatus\(\)/, 'apiBridge exposes status');
assert.match(bridge, /runAutoTestNow\(\)/, 'apiBridge exposes the manual run');
assert.match(panel, /api\.getAutoTestStatus\(\)/, 'Build & Tests panel reads status');
assert.match(panel, /api\.runAutoTestNow\(\)/, 'Build & Tests panel can run the check now');
assert.match(panel, /api\.updateSettings\(\{ autoRunTestsOnSave: next \}\)/, 'the toggle travels through the normal settings channel');
assert.match(panel, /aria-label="Toggle automatic checks after save"/, 'the toggle is labelled for screen readers');
assert.doesNotMatch(panel, /api\.updateSettings\(\{ autoRunTestsOnSave: true \}\)[^)]*\)\s*;\s*\/\//, 'no silent always-on toggle');

console.log(JSON.stringify({ status: 'PASS', files: ['src/shared/autoTestOnSave.ts', 'src/server/autoTestRunner.ts', 'server.ts', 'src/components/BuildTestPanel.tsx', 'src/services/apiBridge.ts', 'src/server/settings.ts'], checks: 24 }));
