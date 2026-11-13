/**
 * M-TAVILY end-to-end: boots the built production server against a LOCAL mock
 * Tavily (QUILLIX_TAVILY_BASE_URL) and proves, with real HTTP calls:
 *   1. web_search returns bounded, cited results — and the query that actually
 *      left the app was sanitized (no secret key in it);
 *   2. a repeated query is served from cache (no second provider call);
 *   3. web_fetch returns bounded page content and reports failed URLs;
 *   4. Offline Mode, missing consent and a zero budget each block honestly;
 *   5. Budget/usage endpoints report the metered searches.
 * Never touches the user's settings, workspace or Tavily credits.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startMockTavily, receivedRequests } from './mock-tavily.mjs';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-tavily-'));
const mockPort = 3210;
const port = 3211;
const origin = `http://127.0.0.1:${port}`;
const settingsPath = path.join(temporary, 'settings.json');
let server, mock;

const writeSettings = (extra = {}) => fs.writeFileSync(settingsPath, JSON.stringify({
  offlineMode: false,
  tavilyNetworkConsent: true,
  tavilyDailySearchCap: 5,
  autoApplyDiffs: false,
  workspaceRoot: temporary,
  ...extra,
}, null, 2));

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

const waitFor = async (predicate, description, attempts = 45) => {
  for (let i = 0; i < attempts; i++) {
    const value = await predicate();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error(`Timed out waiting for: ${description}`);
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
      QUILLIX_TAVILY_BASE_URL: `http://127.0.0.1:${mockPort}`,
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
  mock = await startMockTavily(mockPort);

  // 1. web_search with a secret-shaped token in the query.
  await bootServer();
  const search = await request('/api/tools/execute', { name: 'web_search', args: { query: 'React 19 use hook syntax api_key=SUPERSECRET12345' } });
  assert.equal(search.data.success, true, JSON.stringify(search.data));
  const payload = JSON.parse(search.data.output);
  assert.equal(payload.results.length, 3);
  assert.equal(payload.results[0].official, true, 'official docs sort first');
  assert.match(payload.citations, /\[1\] React 19 use\(\) reference — react\.dev/);
  assert.equal(payload.cached, false);
  // What actually reached the (mock) provider was sanitized.
  const searchCall = receivedRequests.find(entry => entry.route === '/search');
  assert.ok(searchCall, 'the provider was called');
  assert.match(searchCall.body.query, /\[redacted\]/);
  assert.doesNotMatch(searchCall.body.query, /SUPERSECRET12345/, 'a secret-shaped token must never leave the app');

  // 2. Repeat -> cache hit, no second provider call.
  const before = receivedRequests.length;
  const cached = await request('/api/tools/execute', { name: 'web_search', args: { query: 'React 19 use hook syntax api_key=SUPERSECRET12345' } });
  assert.equal(cached.data.success, true, JSON.stringify(cached.data));
  assert.equal(JSON.parse(cached.data.output).cached, true);
  assert.equal(receivedRequests.length, before, 'a cached search must not call the provider again');

  // 3. Budget + usage endpoints metered the single real search.
  const budget = await request('/api/verification/tavily/budget');
  assert.equal(budget.data.success, true, JSON.stringify(budget.data));
  assert.equal(budget.data.budget.searches, 1);
  assert.equal(budget.data.budget.cap, 5);
  assert.equal(budget.data.consent, true);
  const usage = await request('/api/verification/tavily/usage');
  assert.ok((usage.data.usage?.searches || 0) >= 1);

  // 4. web_fetch returns bounded content and reports failures.
  const fetched = await request('/api/tools/execute', { name: 'web_fetch', args: { urls: ['https://react.dev/reference/react/use', 'https://missing.example/docs'] } });
  assert.equal(fetched.data.success, true, JSON.stringify(fetched.data));
  const fetchPayload = JSON.parse(fetched.data.output);
  assert.equal(fetchPayload.pages.length, 1);
  assert.equal(fetchPayload.failedUrls[0], 'https://missing.example/docs');
  assert.ok(fetchPayload.pages[0].chars > 0 && fetchPayload.pages[0].chars <= 20000);

  // 5. Chat mode blocks the network tool.
  const chatMode = await fetch(`${origin}/api/tools/execute`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversationMode: 'chat', name: 'web_search', args: { query: 'react' } }) });
  assert.equal(chatMode.status, 409, 'network tools require Agent mode');

  // 6. Missing consent blocks with a Settings pointer.
  writeSettings({ tavilyNetworkConsent: false });
  await restartServer();
  const noConsent = await request('/api/tools/execute', { name: 'web_search', args: { query: 'react hooks' } });
  assert.equal(noConsent.data.success, false, JSON.stringify(noConsent.data));
  assert.match(noConsent.data.error, /Tavily network use is off/);
  assert.match(noConsent.data.error, /Settings/);

  // 7. A zero budget blocks with the budget message.
  writeSettings({ tavilyNetworkConsent: true, tavilyDailySearchCap: 0 });
  await restartServer();
  const noBudget = await request('/api/tools/execute', { name: 'web_search', args: { query: 'react hooks' } });
  assert.equal(noBudget.data.success, false, JSON.stringify(noBudget.data));
  assert.match(noBudget.data.error, /Daily web search budget reached \(1\/0\)/, 'today\'s metered usage persists across restarts and blocks at the new cap');

  // 8. Offline Mode blocks before any network call.
  writeSettings({ offlineMode: true });
  await restartServer();
  const offline = await request('/api/tools/execute', { name: 'web_search', args: { query: 'react hooks' } });
  assert.equal(offline.data.success, false, JSON.stringify(offline.data));
  assert.match(offline.data.error, /Offline Mode blocks Tavily network access/);

  console.log('PASS: Tavily web tools end-to-end (sanitized queries, bounded cited results, cache hit, fetch bounds, consent/budget/offline gates, metered budget).');
} finally {
  if (server && server.exitCode === null) {
    server.kill();
    await new Promise(resolve => { server.once('exit', resolve); setTimeout(resolve, 3000).unref(); });
  }
  if (mock) await new Promise(resolve => mock.close(resolve));
  fs.rmSync(temporary, { recursive: true, force: true });
}
