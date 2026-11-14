/**
 * M-TAVILY-3 end-to-end: Deep Research against the built server with a local
 * mock model (planning + synthesis) and a local mock Tavily (search).
 * Proves: the plan event, bounded searches with citations, a streamed cited
 * answer, the done event with sources, and the consent/offline gates.
 * No network, no real credits.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startMockTavily } from './mock-tavily.mjs';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-research-'));
const modelPort = 3220;
const tavilyPort = 3221;
const port = 3222;
const origin = `http://127.0.0.1:${port}`;
const settingsPath = path.join(temporary, 'settings.json');
let server, mockTavily, mockModel;

const writeSettings = (extra = {}) => fs.writeFileSync(settingsPath, JSON.stringify({
  offlineMode: false,
  tavilyNetworkConsent: true,
  tavilyDailySearchCap: 5,
  autoApplyDiffs: false,
  aiProvider: 'ollama',
  model: 'qwen2.5-coder:3b',
  ollamaBaseUrl: `http://127.0.0.1:${modelPort}`,
  workspaceRoot: temporary,
  ...extra,
}, null, 2));

/** Minimal Ollama-shaped model: plans queries, then writes a cited answer. */
const startMockModel = () => new Promise(resolve => {
  mockModel = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/api/tags') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ models: [{ name: 'qwen2.5-coder:3b' }] }));
      return;
    }
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      let parsed = {};
      try { parsed = JSON.parse(body || '{}'); } catch { /* keep defaults */ }
      const text = (parsed.messages || []).map(m => String(m.content || '')).join('\n');
      const stream = parsed.stream !== false;
      const reply = text.includes('research planner')
        ? '["React 19 use hook syntax", "React 19 release notes"]'
        : 'React 19 ships the use() hook [1]. It reads a resource such as a Promise during render [2].\n\nSources:\n[1] React 19 use() reference — react.dev\n[2] React blog: React 19 — react.dev';
      const chunks = reply.match(/[\s\S]{1,40}/g) || [reply];
      res.writeHead(200, { 'Content-Type': stream ? 'application/x-ndjson' : 'application/json' });
      if (stream) {
        for (const chunk of chunks) res.write(JSON.stringify({ message: { role: 'assistant', content: chunk }, done: false }) + '\n');
        res.write(JSON.stringify({ message: { role: 'assistant', content: '' }, done: true }) + '\n');
        res.end();
      } else {
        res.end(JSON.stringify({ message: { role: 'assistant', content: reply }, done: true }));
      }
    });
  });
  mockModel.listen(modelPort, '127.0.0.1', () => resolve(mockModel));
});

const request = async (route, body, method = 'POST') => {
  const payload = body === undefined ? undefined : { conversationMode: 'agent', ...body };
  const response = await fetch(`${origin}${route}`, {
    method: body === undefined ? 'GET' : method,
    headers: { 'Content-Type': 'application/json', Origin: origin },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    signal: AbortSignal.timeout(90_000),
  });
  return { status: response.status, data: await response.json().catch(() => ({})) };
};

const waitFor = async (predicate, description, attempts = 45) => {
  for (let i = 0; i < attempts; i++) {
    const value = await predicate();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error(`Timed out waiting for: ${description}`);
};

/** Read the research SSE stream straight from the endpoint (no renderer bridge). */
const readResearchEvents = async (prompt) => {
  const response = await fetch(`${origin}/api/research`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ conversationMode: 'agent', prompt }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!response.body) throw new Error('Research stream unavailable.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const events = [];
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const raw = buffer.slice(0, boundary).trim();
      buffer = buffer.slice(boundary + 2);
      if (raw.startsWith('data:')) {
        try { events.push(JSON.parse(raw.slice(5).trim())); } catch { /* keep-alive frame */ }
      }
      boundary = buffer.indexOf('\n\n');
    }
  }
  return events;
};

const bootServer = async () => {
  server = spawn(process.execPath, [path.join(project, 'dist', 'server.cjs')], {
    cwd: project,
    windowsHide: true,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(port),
      QUILLIX_SETTINGS_PATH: settingsPath,
      QUILLIX_TAVILY_BASE_URL: `http://127.0.0.1:${tavilyPort}`,
      TAVILY_API_KEY: 'test-key-not-real',
      QUILLIX_STATE_DIR: path.join(temporary, '.quillix-home'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  server.stdout.on('data', chunk => { logs += chunk; });
  server.stderr.on('data', chunk => { logs += chunk; });
  await waitFor(async () => {
    if (server.exitCode !== null) throw new Error(`Server exited: ${logs.slice(-2000)}`);
    try { return (await request('/api/health')).data.status === 'ok'; } catch { return false; }
  }, 'server readiness');
};

const restartServer = async () => {
  server.kill();
  await new Promise(resolve => server.once('exit', resolve));
  await bootServer();
};

try {
  fs.writeFileSync(path.join(temporary, 'app.ts'), 'export const answer = 42;\n');
  writeSettings();
  mockTavily = await startMockTavily(tavilyPort);
  await startMockModel();
  await bootServer();

  // 1. Full research flow: plan -> searches -> cited answer -> sources.
  const events = await readResearchEvents('What is the React 19 use() hook?');
  const plan = events.find(event => event.type === 'plan');
  assert.ok(plan, 'a plan event is streamed');
  assert.deepEqual(plan.queries, ['React 19 use hook syntax', 'React 19 release notes']);
  const searches = events.filter(event => event.type === 'search');
  assert.equal(searches.length, 2, 'each planned query is searched');
  assert.match(searches[0].citations, /\[1\] React 19 use\(\) reference — react\.dev/);
  const answers = events.filter(event => event.type === 'answer');
  assert.ok(answers.length > 1, 'the answer streams in chunks');
  const done = events.find(event => event.type === 'done');
  assert.ok(done, 'a done event closes the stream');
  assert.ok(Array.isArray(done.sources) && done.sources.length >= 2, 'sources accompany the answer');
  assert.equal(done.sources[0].official, true);
  assert.equal(done.sources[0].url, 'https://react.dev/reference/react/use');
  assert.match(done.citations, /\[2\] React blog: React 19/);
  assert.ok(!events.some(event => event.error), JSON.stringify(events.find(event => event.error)));

  // 2. Budget metered the two real searches.
  const budget = await request('/api/verification/tavily/budget');
  assert.equal(budget.data.budget.searches, 2, JSON.stringify(budget.data));

  // 3. Consent off -> honest streamed error.
  writeSettings({ tavilyNetworkConsent: false });
  await restartServer();
  const noConsent = await readResearchEvents('react hooks');
  assert.ok(noConsent.some(event => /Tavily network use is off/.test(String(event.error || ''))), JSON.stringify(noConsent));

  // 4. Offline Mode blocks research.
  writeSettings({ tavilyNetworkConsent: true, offlineMode: true });
  await restartServer();
  const offline = await readResearchEvents('react hooks');
  assert.ok(offline.some(event => /Offline Mode blocks web research/.test(String(event.error || ''))), JSON.stringify(offline));

  // 5. Chat mode is rejected at the door.
  const chatMode = await fetch(`${origin}/api/research`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversationMode: 'chat', prompt: 'x' }) });
  assert.equal(chatMode.status, 409);

  console.log('PASS: deep research end-to-end (plan, bounded cited searches, streamed cited answer, sources, budget metering, consent/offline/mode gates).');
} finally {
  if (server && server.exitCode === null) {
    server.kill();
    await new Promise(resolve => { server.once('exit', resolve); setTimeout(resolve, 3000).unref(); });
  }
  if (mockTavily) await new Promise(resolve => mockTavily.close(resolve));
  if (mockModel) await new Promise(resolve => mockModel.close(resolve));
  fs.rmSync(temporary, { recursive: true, force: true });
}
