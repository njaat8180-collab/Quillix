/**
 * M4.4 end-to-end: boots the built production server over an isolated temp
 * workspace and proves the checkpoint flow with real files:
 *   create → list → detail → diff → modify → restore → remove.
 * Never touches the user's settings or workspace.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-checkpoints-'));
const port = Number(process.env.QUILLIX_CHECKPOINT_PORT || 3018);
const origin = `http://127.0.0.1:${port}`;
let server;

const request = async (route, body, method = 'POST') => {
  const payload = body === undefined ? undefined : { conversationMode: 'agent', ...body };
  const response = await fetch(`${origin}${route}`, {
    method: body === undefined ? 'GET' : method,
    headers: { 'Content-Type': 'application/json', Origin: origin },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    signal: AbortSignal.timeout(60_000),
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
  fs.writeFileSync(path.join(temporary, 'app.ts'), 'export const version = 1;\n');
  fs.writeFileSync(path.join(temporary, '.env'), 'SECRET=do-not-capture');
  fs.mkdirSync(path.join(temporary, 'src'), { recursive: true });
  fs.writeFileSync(path.join(temporary, 'src', 'util.ts'), 'export const helper = () => 1;\n');
  fs.writeFileSync(path.join(temporary, 'settings.json'), JSON.stringify({ offlineMode: true, autoApplyDiffs: false, workspaceRoot: temporary }, null, 2));

  server = spawn(process.execPath, [path.join(project, 'dist', 'server.cjs')], {
    cwd: project,
    windowsHide: true,
    env: { ...process.env, NODE_ENV: 'production', PORT: String(port), QUILLIX_SETTINGS_PATH: path.join(temporary, 'settings.json') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  server.stdout.on('data', chunk => { logs += chunk; });
  server.stderr.on('data', chunk => { logs += chunk; });

  await waitFor(async () => {
    if (server.exitCode !== null) throw new Error(`Server exited: ${logs.slice(-2000)}`);
    try { return (await request('/api/health')).data.status === 'ok'; } catch { return false; }
  }, 'server readiness');

  // 1. Create a named checkpoint.
  const created = await request('/api/checkpoints', { name: 'Before refactor' });
  assert.equal(created.data.success, true, JSON.stringify(created.data));
  assert.equal(created.data.checkpoint.name, 'Before refactor');
  // app.ts + src/util.ts + this fixture's own settings.json; .env is excluded.
  assert.equal(created.data.checkpoint.fileCount, 3, JSON.stringify(created.data.checkpoint));
  const checkpointId = created.data.checkpoint.id;
  const detail = await request(`/api/checkpoints/${checkpointId}`);
  assert.equal(detail.data.checkpoint.files.length, 3, JSON.stringify(detail.data.checkpoint));
  assert.ok(!detail.data.checkpoint.files.some(f => f.filePath === '.env'), 'a secret path was captured');

  // 2. List.
  const list = await request('/api/checkpoints');
  assert.equal(list.data.checkpoints.length, 1);
  assert.equal(list.data.checkpoints[0].id, checkpointId);

  // 3. Diff after a real modification.
  fs.writeFileSync(path.join(temporary, 'app.ts'), 'export const version = 2;\n');
  const diff = await request(`/api/checkpoints/${checkpointId}/diff?path=app.ts`);
  assert.equal(diff.data.success, true, JSON.stringify(diff.data));
  assert.match(diff.data.diff, /-export const version = 1;/);
  assert.match(diff.data.diff, /\+export const version = 2;/);

  // 4. Restore returns the file to the checkpoint state.
  const restored = await request(`/api/checkpoints/${checkpointId}/restore`, {});
  assert.equal(restored.data.success, true, JSON.stringify(restored.data));
  assert.deepEqual(restored.data.restored.sort(), ['app.ts', 'settings.json', 'src/util.ts']);
  assert.equal(fs.readFileSync(path.join(temporary, 'app.ts'), 'utf8'), 'export const version = 1;\n');
  // The secret file was never captured, so it is never restored or exposed.
  assert.equal(fs.readFileSync(path.join(temporary, '.env'), 'utf8'), 'SECRET=do-not-capture');

  // 5. Chat mode is rejected for mutations; unknown ids fail honestly.
  const chatMode = await fetch(`${origin}/api/checkpoints`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversationMode: 'chat', name: 'nope' }) });
  assert.equal(chatMode.status, 409, 'checkpoint creation must require Agent mode');
  assert.match((await chatMode.json()).error, /Agent mode/);
  const unknown = await request('/api/checkpoints/checkpoint_missing/restore', {});
  assert.equal(unknown.status, 409);
  assert.match(unknown.data.error, /not found/i);

  // 6. Remove.
  const removed = await request(`/api/checkpoints/${checkpointId}`, {}, 'DELETE');
  assert.equal(removed.data.success, true, JSON.stringify(removed.data));
  assert.equal((await request('/api/checkpoints')).data.checkpoints.length, 0);

  console.log('PASS: named checkpoints end-to-end (create, list, diff, restore, secret exclusion, mode guard, remove).');
} finally {
  if (server && server.exitCode === null) {
    server.kill();
    await new Promise(resolve => { server.once('exit', resolve); setTimeout(resolve, 3000).unref(); });
  }
  fs.rmSync(temporary, { recursive: true, force: true });
}
