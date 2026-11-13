// Production HTTP wiring test with a deterministic local provider. Not an AI-quality benchmark.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-verification-http-'));
const port = Number(process.env.QUILLIX_VERIFY_TEST_PORT || 3019), origin = `http://127.0.0.1:${port}`;
let server, logs = '', turns = 0, stage = 'setup';
const requests = [];
const provider = http.createServer(async (request, response) => {
  if (request.url === '/api/tags') {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ models: [{ name: 'qwen2.5-coder:3b' }] }));
    return;
  }
  if (request.url !== '/api/chat') { response.writeHead(404).end(); return; }
  let body = '';
  for await (const chunk of request) body += chunk;
  const payload = JSON.parse(body);
  requests.push(payload);
  // Server startup may warm the configured Ollama model with a tool-less
  // request. Do not let that warm-up consume the deterministic tool script.
  // Only tool-enabled agent turns are part of this fixture.
  if (!Array.isArray(payload.tools) || payload.tools.length === 0) {
    response.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
    response.end(JSON.stringify({ message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop' }) + '\n');
    return;
  }
  const call = turns++ === 0
    ? { name: 'write_file', arguments: { filePath: 'greet.cjs', content: 'exports.greet = name => `Hello, ${name.trim() || "World"}!`;' } }
    : { name: 'edit_file', arguments: { filePath: 'greet.cjs', oldString: 'name =>', newString: '(name = "") =>' } };
  response.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
  response.end(JSON.stringify({ message: { role: 'assistant', content: '', tool_calls: [{ function: call }] }, done: true, done_reason: 'stop' }) + '\n');
});
const request = async (body, label = 'agent run') => {
  try {
    return await fetch(`${origin}/api/agent/run`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({ conversationMode: 'agent', ...body }), signal: AbortSignal.timeout(30000),
    });
  } catch (error) {
    throw new Error(`${label} request failed after ${turns} mock tool turns; captured provider requests=${requests.length}; server output: ${logs || '(empty)'}`, { cause: error });
  }
};
try {
  let occupied = false;
  try { await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(300) }); occupied = true; } catch { /* unused */ }
  assert.equal(occupied, false, `Port ${port} is occupied; use QUILLIX_VERIFY_TEST_PORT.`);
  await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
  const workspace = path.join(temporary, 'workspace');
  fs.mkdirSync(workspace);
  fs.writeFileSync(path.join(workspace, 'suite.cjs'), 'const a = require("node:assert/strict"); a.equal(require("./greet.cjs").greet(),"Hello, World!"); console.log("Behavior passed");');
  const settingsPath = path.join(temporary, 'settings.json');
  fs.writeFileSync(settingsPath, JSON.stringify({ aiProvider: 'ollama', model: 'qwen2.5-coder:3b', offlineMode: true,
    ollamaBaseUrl: `http://127.0.0.1:${provider.address().port}`, autoApplyDiffs: true, terminalApproval: true, workspaceRoot: workspace }));
  server = spawn(process.execPath, ['dist/server.cjs'], { cwd: project, windowsHide: true,
    env: { ...process.env, NODE_ENV: 'production', PORT: String(port), QUILLIX_SETTINGS_PATH: settingsPath }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', chunk => { logs = (logs + chunk).slice(-6000); });
  server.stderr.on('data', chunk => { logs = (logs + chunk).slice(-6000); });
  let ready = false;
  for (let i = 0; i < 60; i++) {
    if (server.exitCode !== null) throw new Error(`Production test server exited: ${logs}`);
    try { ready = (await fetch(`${origin}/api/health`)).ok; if (ready) break; } catch { /* booting */ }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  assert.ok(ready, logs);
  stage = 'invalid-command validation';
  const invalid = await request({ userPrompt: 'Create greet.cjs', verificationCommands: 'node suite.cjs' }, stage);
  assert.equal(invalid.status, 400);
  assert.match((await invalid.json()).error, /verificationCommands/);
  stage = 'verified agent run';
  const response = await request({ userPrompt: 'Create greet.cjs. Export a named greeting function via exports.greet, handling missing names.',
    mode: 'agent', conversationHistory: [], model: 'qwen2.5-coder:3b', verificationCommands: ['node suite.cjs'] });
  assert.equal(response.status, 200);
  stage = 'read final SSE response';
  const events = (await response.text()).split('\n\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6)));
  assert.equal(events.some(event => event.event === 'error'), false, JSON.stringify(events.at(-1)));
  const result = events.find(event => event.event === 'done')?.result;
  assert.ok(result, 'Missing terminal SSE result');
  assert.deepEqual(result.toolResults.filter(tool => tool.toolName === 'run_command').map(tool => tool.success), [false, true]);
  assert.equal(result.phases.some(phase => phase.status === 'failed'), false, result.finalText);
  assert.match(result.finalText, /User acceptance checks passed/);
  // Server startup may warm the configured Ollama model with a tool-less
  // request. Count only the two tool-enabled agent turns under test.
  const agentRequests = requests.filter(request => Array.isArray(request.tools) && request.tools.length > 0);
  assert.equal(agentRequests.length, 2);
  assert.deepEqual(agentRequests[1].format.properties.name.enum, ['edit_file']);
  assert.match(fs.readFileSync(path.join(workspace, 'greet.cjs'), 'utf8'), /name = ""/);
  console.log('PASS: production API validation, SSE, actual Node assertion failure -> targeted edit -> passing retest, and final acceptance reporting (deterministic provider).');
} catch (error) {
  console.error(`Verification HTTP failure at ${stage}; mock tool turns=${turns}; provider requests=${requests.length}; server output: ${logs || '(empty)'}`);
  throw error;
} finally {
  if (server && server.exitCode === null) {
    server.kill();
    await new Promise(resolve => { server.once('exit', resolve); setTimeout(resolve, 3000).unref(); });
  }
  await new Promise(resolve => provider.close(resolve));
  // Only the exact mkdtemp fixture owned by this test is removed.
  fs.rmSync(temporary, { recursive: true, force: true });
}
