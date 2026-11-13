/**
 * M3.4 end-to-end: boots the built production server over an isolated temp
 * workspace and proves the auto-run-on-save pipeline with REAL process spawns:
 *   1. status resolves the command from the workspace package.json;
 *   2. a manual run executes npm and reports a real exit code;
 *   3. a real save schedules the automatic run and it lands in the status.
 * Never touches the user's settings or workspace.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-auto-test-'));
const port = Number(process.env.QUILLIX_AUTO_TEST_PORT || 3017);
const origin = `http://127.0.0.1:${port}`;
let server;
const logs = [];

const request = async (route, body, method = 'POST') => {
  const payload = body === undefined ? undefined : { conversationMode: 'agent', ...body };
  const response = await fetch(`${origin}${route}`, {
    method: body === undefined ? 'GET' : method,
    headers: { 'Content-Type': 'application/json', Origin: origin },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    signal: AbortSignal.timeout(180_000),
  });
  return { status: response.status, data: await response.json().catch(() => ({})) };
};
const waitFor = async (predicate, description, attempts = 40) => {
  for (let i = 0; i < attempts; i++) {
    const value = await predicate();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error(`Timed out waiting for: ${description}`);
};

try {
  fs.writeFileSync(path.join(temporary, 'package.json'), JSON.stringify({ name: 'auto-test-fixture', private: true, scripts: { lint: 'node -e "process.exit(0)"', test: 'node -e "process.exit(0)"' } }, null, 2));
  fs.writeFileSync(path.join(temporary, 'app.ts'), 'export const answer: number = 42;\n');
  fs.writeFileSync(path.join(temporary, 'settings.json'), JSON.stringify({ offlineMode: false, autoApplyDiffs: false, autoRunTestsOnSave: true, workspaceRoot: temporary }, null, 2));

  server = spawn(process.execPath, [path.join(project, 'dist', 'server.cjs')], {
    cwd: project,
    windowsHide: true,
    env: { ...process.env, NODE_ENV: 'production', PORT: String(port), QUILLIX_SETTINGS_PATH: path.join(temporary, 'settings.json') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', chunk => logs.push(chunk.toString()));
  server.stderr.on('data', chunk => logs.push(chunk.toString()));

  await waitFor(async () => {
    if (server.exitCode !== null) throw new Error(`Server exited: ${logs.join('').slice(-2000)}`);
    try { return (await request('/api/health')).data.status === 'ok'; } catch { return false; }
  }, 'server readiness');

  // 1. The command resolves from the workspace's own package.json.
  const status = await request('/api/editor/auto-test');
  assert.equal(status.data.success, true, JSON.stringify(status.data));
  assert.equal(status.data.enabled, true);
  assert.equal(status.data.available, true);
  assert.equal(status.data.commandLabel, 'npm run lint', JSON.stringify(status.data));

  // 2. A manual run really spawns npm and reports a real exit code.
  const manual = await request('/api/editor/auto-test', { runNow: true });
  assert.equal(manual.data.success, true, JSON.stringify(manual.data));
  assert.equal(manual.data.run.triggeredBy, 'manual');
  assert.equal(manual.data.run.exitCode, 0, JSON.stringify(manual.data.run));
  assert.equal(manual.data.run.ok, true);

  // 3. A real save schedules the automatic run, and it lands in the status.
  // Respect the pacing floor first: a save immediately after a run is (by
  // design) suppressed, so wait past the minimum gap before saving.
  await new Promise(resolve => setTimeout(resolve, 5000));
  const save = await request('/api/workspace/file', { filePath: 'app.ts', content: 'export const answer: number = 43;\n' });
  assert.equal(save.data.success, true, JSON.stringify(save.data));
  const afterSave = await waitFor(async () => {
    const current = await request('/api/editor/auto-test');
    return current.data.lastRun?.triggeredBy === 'save' ? current : false;
  }, 'save-triggered automatic run');
  assert.equal(afterSave.data.lastRun.exitCode, 0, JSON.stringify(afterSave.data.lastRun));
  assert.equal(afterSave.data.lastRun.filePath, 'app.ts');

  console.log('PASS: auto-run on save end-to-end (command resolution, real npm spawn, save-triggered run, bounded status).');
} finally {
  if (server && server.exitCode === null) {
    server.kill();
    await new Promise(resolve => { server.once('exit', resolve); setTimeout(resolve, 3000).unref(); });
  }
  fs.rmSync(temporary, { recursive: true, force: true });
}
