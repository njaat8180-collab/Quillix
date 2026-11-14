/**
 * QUILLIX hackathon demo readiness gate.
 *
 * Purpose: prove, with one command and no network/credentials, that the demo
 * surfaces actually work in the running product - on a machine that is under
 * RAM pressure and shared with other agents.
 *
 * This gate is ADDITIVE: it does not replace `test:backend:e2e` or
 * `test:agent-e2e` (those remain the authoritative real-server suites and are
 * tracked separately as blocker B18). It only boots the real built server with
 * local mocks and asserts that every demo-critical endpoint answers honestly.
 *
 * Usage:
 *   node scripts/smoke/hackathon-demo-gate.mjs
 *
 * Evidence artifact: .quillix-smoke/hackathon-demo-gate.json
 */
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const artifactDir = path.join(repoRoot, '.quillix-smoke');
const artifactPath = path.join(artifactDir, 'hackathon-demo-gate.json');
const REQUEST_TIMEOUT_MS = 60_000;
const READY_TIMEOUT_MS = 180_000;

const children = [];
const logs = [];

const freePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    server.close(() => resolve(port));
  });
});

const start = (name, file, env = {}) => {
  const child = spawn(process.execPath, [file], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  children.push(child);
  for (const stream of [child.stdout, child.stderr]) {
    stream?.on('data', b => logs.push(`${name}: ${b.toString('utf8').trimEnd()}`));
  }
  child.on('error', e => logs.push(`${name}: ${e.message}`));
  return child;
};

const stopAll = () => {
  for (const child of children) {
    try { child.kill(); } catch { /* already gone */ }
  }
};

const results = [];
const record = (name, ok, detail, extra = {}) => {
  results.push({ name, ok, detail, ...extra });
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${name}: ${detail}`);
  return ok;
};

const run = async () => {
  fs.mkdirSync(artifactDir, { recursive: true });

  const bundle = path.join(repoRoot, 'dist', 'server.cjs');
  if (!fs.existsSync(bundle)) {
    record('build artifact present', false, 'dist/server.cjs missing - run `npm run build` first');
    return false;
  }
  record('build artifact present', true, 'dist/server.cjs found');

  const apiPort = await freePort();
  const mockPort = await freePort();
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-demo-gate-'));
  const settingsPath = path.join(base, 'settings.json');

  start('mock-ollama', 'scripts/e2e/mock-ollama.cjs', { QUILLIX_MOCK_OLLAMA_PORT: String(mockPort) });
  start('server', path.relative(repoRoot, bundle), {
    NODE_ENV: 'production',
    PORT: String(apiPort),
    QUILLIX_SETTINGS_PATH: settingsPath,
  });

  const url = `http://127.0.0.1:${apiPort}`;
  const api = async (route, method = 'GET', body) => {
    const response = await fetch(url + route, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* non-JSON body */ }
    return { status: response.status, ok: response.ok, json, text: text.slice(0, 400) };
  };

  // readiness (generous: the box may be under RAM pressure)
  const started = Date.now();
  let ready = false;
  while (Date.now() - started < READY_TIMEOUT_MS) {
    try {
      const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(4000) });
      if (response.ok) { ready = true; break; }
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 500));
  }
  if (!record('server boots', ready, ready
    ? `real server healthy in ${((Date.now() - started) / 1000).toFixed(1)}s`
    : `server did not become healthy within ${READY_TIMEOUT_MS / 1000}s`)) return false;

  // point the product at the local mock provider (no network, no credentials)
  const settings = await api('/api/settings', 'PUT', {
    model: 'qwen2.5-coder:3b',
    ollamaBaseUrl: `http://127.0.0.1:${mockPort}`,
    autoApplyDiffs: true,
    terminalApproval: true,
    maxAutonomousTurns: 12,
  });
  if (!record('settings accept mock provider', settings.ok, `PUT /api/settings -> ${settings.status}`,
    { body: settings.json ?? settings.text })) return false;

  // use the real project as the workspace so the mission tracker and the
  // codebase index have something real to read (this is the demo workspace)
  const setRoot = await api('/api/workspace/set-root', 'POST', { targetPath: repoRoot });
  record('workspace root set to the project', setRoot.ok && setRoot.json?.success === true,
    `POST /api/workspace/set-root -> ${setRoot.status}; success=${setRoot.json?.success ?? 'n/a'}`,
    { body: setRoot.json ?? setRoot.text });

  const health = await api('/api/health');
  record('health endpoint', health.ok, `GET /api/health -> ${health.status}`, { body: health.json ?? health.text });

  const brains = await api('/api/brains');
  const brainIds = Array.isArray(brains.json?.brains) ? brains.json.brains.map(b => b.id) : [];
  record('provider brain catalog', brains.ok && brainIds.length >= 5,
    `GET /api/brains -> ${brains.status}; brains: ${brainIds.join(', ') || 'none'}`,
    { body: brains.json ?? brains.text });

  const tavily = await api('/api/verification/tavily', 'POST', {
    query: 'What is the current API version?', answer: 'This is a demo offline-safety check.',
  });
  record('Tavily fails closed without consent/key', tavily.ok && tavily.json?.result?.finding === 'offline',
    `POST /api/verification/tavily -> ${tavily.status}; finding=${tavily.json?.result?.finding ?? 'n/a'}, offlineFallback=${tavily.json?.result?.offlineFallback ?? 'n/a'}`,
    { body: tavily.json ?? tavily.text });

  const mission = await api('/api/mission/state');
  const missionState = mission.json?.state ?? mission.json ?? {};
  const gateIds = Array.isArray(missionState.releaseGates)
    ? missionState.releaseGates.map(g => `${g.id}:${g.status}`)
    : [];
  record('mission tracker readable', mission.ok && gateIds.length > 0,
    `GET /api/mission/state -> ${mission.status}; gates: ${gateIds.join(' ') || 'none'}`,
    { body: mission.json ?? mission.text });

  const codebase = await api('/api/codebase/answer?question=Where%20is%20the%20agent%20engine%20defined');
  const codebaseMatch = codebase.json?.match;
  const answerText = codebase.json?.text ?? '';
  record('codebase Q&A answers with file:line evidence',
    codebase.ok
      && codebase.json?.kind === 'definition'
      && typeof codebaseMatch?.file === 'string'
      && Number.isFinite(codebaseMatch?.line),
    `GET /api/codebase/answer -> ${codebase.status}; ${String(answerText).slice(0, 120) || 'no answer'}`,
    { body: codebase.json ?? codebase.text });

  const rateLimit = await api('/api/providers/rate-limit');
  record('rate-limit picture exposed', rateLimit.ok,
    `GET /api/providers/rate-limit -> ${rateLimit.status}`,
    { body: rateLimit.json ?? rateLimit.text });

  const selfHeal = await api('/api/agent/self-heal/history');
  record('self-healing history exposed', selfHeal.ok,
    `GET /api/agent/self-heal/history -> ${selfHeal.status}`,
    { body: selfHeal.json ?? selfHeal.text });

  const checkpoints = await api('/api/checkpoints');
  record('checkpoint store reachable', checkpoints.ok,
    `GET /api/checkpoints -> ${checkpoints.status}`,
    { body: checkpoints.json ?? checkpoints.text });

  const cache = await api('/api/metrics/prompt-cache');
  record('prompt-cache telemetry exposed', cache.ok,
    `GET /api/metrics/prompt-cache -> ${cache.status}`,
    { body: cache.json ?? cache.text });

  const agentStatus = await api('/api/agent/status');
  record('agent status observable', agentStatus.ok,
    `GET /api/agent/status -> ${agentStatus.status}`,
    { body: agentStatus.json ?? agentStatus.text });

  const diagnostics = await api('/api/providers/diagnostics');
  record('provider diagnostics exposed', diagnostics.ok,
    `GET /api/providers/diagnostics -> ${diagnostics.status}`,
    { body: diagnostics.json ?? diagnostics.text });

  const settingsRead = await api('/api/settings');
  const leaked = JSON.stringify(settingsRead.json ?? {}).match(/(sk-|api[_-]?key"\s*:\s*"[A-Za-z0-9]{12,})/i);
  record('settings read leaks no secret', settingsRead.ok && !leaked,
    `GET /api/settings -> ${settingsRead.status}; secret-shaped value in response: ${leaked ? 'YES' : 'no'}`);

  const passed = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;
  const artifact = {
    generatedAt: new Date().toISOString(),
    gate: 'hackathon-demo-readiness',
    note: 'Additive demo proof: boots the real built server with local mocks. It does not replace test:backend:e2e / test:agent-e2e (blocker B18).',
    totals: { checks: results.length, passed, failed },
    results,
    serverLog: logs.slice(-40),
  };
  fs.writeFileSync(artifactPath, JSON.stringify(artifact, null, 2));
  console.log(`\nDEMO GATE: ${passed}/${results.length} checks passed -> ${artifactPath}`);
  return failed === 0;
};

let ok = false;
try {
  ok = await run();
} catch (error) {
  record('demo gate execution', false, error instanceof Error ? error.message : String(error));
  const artifact = {
    generatedAt: new Date().toISOString(),
    gate: 'hackathon-demo-readiness',
    totals: { checks: results.length, passed: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length },
    results,
    serverLog: logs.slice(-40),
  };
  fs.mkdirSync(artifactDir, { recursive: true });
  fs.writeFileSync(artifactPath, JSON.stringify(artifact, null, 2));
} finally {
  stopAll();
}
process.exit(ok ? 0 : 1);
