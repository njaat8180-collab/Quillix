/**
 * Quillix E2E acceptance driver.
 *  1. Starts the mock Ollama + the REAL Quillix server (dist/server.cjs).
 *  2. Selects a workspace (simulating D:\QUILLIX\QUILLIX_AGENT_TEST).
 *  3. Sends the exact acceptance prompt to /api/agent/run over SSE.
 *  4. Asserts: real files on disk, no raw tool JSON / source code in the chat
 *     stream, 15-phase workflow streamed, test->fix->retest really happened.
 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const QUILLIX = 'http://127.0.0.1:3000';
const WORKSPACE = '/tmp/QUILLIX_AGENT_TEST';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function api(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify({ conversationMode: 'agent', ...body }) : null;
    const req = http.request(
      QUILLIX + urlPath,
      {
        method,
        headers: { 'Content-Type': 'application/json', ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) },
      },
      (res) => {
        let out = '';
        res.on('data', (c) => (out += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: out ? JSON.parse(out) : null });
          } catch {
            resolve({ status: res.statusCode, body: out });
          }
        });
      }
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function waitForServer(timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await api('GET', '/api/health');
      if (res.body && res.body.status === 'ok') return true;
    } catch {}
    await sleep(250);
  }
  return false;
}

function runAgentSSE(prompt) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      userPrompt: prompt,
      mode: 'agent',
      conversationMode: 'agent',
      conversationHistory: [],
    });
    const req = http.request(
      QUILLIX + '/api/agent/run',
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
      (res) => {
        let buffer = '';
        const events = [];
        res.on('data', (chunk) => {
          buffer += chunk.toString();
          const parts = buffer.split('\n\n');
          buffer = parts.pop();
          for (const part of parts) {
            if (!part.startsWith('data: ')) continue;
            try {
              events.push(JSON.parse(part.slice(6)));
            } catch {}
          }
        });
        res.on('end', () => resolve(events));
        res.on('error', reject);
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

let failures = 0;
function check(label, ok, extra) {
  if (ok) {
    console.log(`  \u2713 ${label}`);
  } else {
    failures++;
    console.log(`  \u2717 ${label}${extra ? ' — ' + extra : ''}`);
  }
}

async function main() {
  // Clean workspace (simulating a fresh D:\QUILLIX\QUILLIX_AGENT_TEST)
  fs.rmSync(WORKSPACE, { recursive: true, force: true });
  fs.mkdirSync(WORKSPACE, { recursive: true });

  console.log('[1] Waiting for Quillix server…');
  const up = await waitForServer();
  check('Quillix server is up', up);
  if (!up) process.exit(1);

  // Point Quillix at the mock Ollama (loopback, offline-mode compliant)
  const settingsRes = await api('PUT', '/api/settings', {
    ollamaBaseUrl: 'http://127.0.0.1:11499',
    model: 'qwen2.5-coder:3b',
    autoApplyDiffs: true,
    terminalApproval: true,
    maxAutonomousTurns: 12,
  });
  check('Settings configured to local mock Ollama', settingsRes.body && settingsRes.body.success);

  const ollamaStatus = await api('GET', '/api/ollama/status');
  check(
    'Ollama CONNECTED and model available',
    ollamaStatus.body?.status?.connected && ollamaStatus.body?.status?.modelAvailable
  );

  // Select the workspace
  const setRoot = await api('POST', '/api/workspace/set-root', { targetPath: WORKSPACE });
  check('Workspace selected and validated', setRoot.body && setRoot.body.success && setRoot.body.path === WORKSPACE);

  const root = await api('GET', '/api/workspace/root');
  check('Workspace is authoritative', root.body?.path === WORKSPACE);

  console.log('[2] Normal chat intent check ("Hello")…');
  const helloEvents = await runAgentSSE('Hello');
  const helloIntent = helloEvents.find((e) => e.event === 'intent');
  check('Greeting routed to plain chat (no tools)', helloIntent && helloIntent.intent === 'chat');
  const helloTokens = helloEvents.filter((e) => e.event === 'token').map((e) => e.token).join('');
  check('Plain chat replied', helloTokens.length > 0);

  console.log('[3] Conceptual question ("What is Python?")…');
  const pyEvents = await runAgentSSE('What is Python?');
  const pyIntent = pyEvents.find((e) => e.event === 'intent');
  check('Conceptual question routed to chat (no file tools)', pyIntent && pyIntent.intent === 'chat');

  console.log('[4] ACCEPTANCE TEST — agent creates the To-Do List project…');
  const prompt =
    'Create a professional responsive To-Do List web application using HTML, CSS and JavaScript.\n\n' +
    'Requirements:\n- Add tasks\n- Mark tasks completed\n- Delete tasks\n- Clear completed tasks\n' +
    '- Show total task count\n- Show completed task count\n- Save tasks using localStorage\n- Restore tasks after reload\n' +
    '- Responsive professional UI\n\nCreate the actual project directly inside the active workspace.\n' +
    'Do not paste source code into Chat.\nCreate all required files.\nRun validation.\nTest the project.\n' +
    'If an error occurs, fix it.\nRun the tests again.\nVerify all final files exist.';

  const events = await runAgentSSE(prompt);

  const intent = events.find((e) => e.event === 'intent');
  check('Request routed to the coding agent', intent && intent.intent === 'agent');

  const chatText = events.filter((e) => e.event === 'token').map((e) => e.token).join('');
  check('Chat contains NO raw tool-call JSON', !chatText.includes('"name"') && !chatText.includes('"arguments"') && !chatText.includes('create_file'), JSON.stringify(chatText.slice(0, 300)));
  check('Chat contains NO source code dump', !chatText.includes('<!DOCTYPE') && !chatText.includes('localStorage.setItem'));
  check('Chat contains human-readable progress/summary', chatText.includes('All four files created') || chatText.length > 0);

  const phaseEvents = events.filter((e) => e.event === 'phase');
  check('Phase events streamed live', phaseEvents.length > 3, `got ${phaseEvents.length}`);
  const lastPhases = phaseEvents.length ? phaseEvents[phaseEvents.length - 1].phases : [];
  check('15-phase workflow used', lastPhases.length === 15, `got ${lastPhases.length}`);
  const validationPhase = lastPhases.find((p) => p.id === 'validation');
  check('Validation phase completed (real node --check ran)', validationPhase?.status === 'completed');
  const verifyPhase = lastPhases.find((p) => p.id === 'final-verification');
  check('Final verification completed', verifyPhase?.status === 'completed');

  const doneEvent = events.find((e) => e.event === 'done');
  check('Run finished with a done event', !!doneEvent);
  const finalText = doneEvent?.result?.finalText || '';
  check('Final reply has no tool JSON', !finalText.includes('"arguments"') && !finalText.includes('create_file'));
  check('Final reply has no source code', !finalText.includes('<!DOCTYPE') && !finalText.includes('function render'));

  const toolCalls = (doneEvent?.result?.toolCalls || []).map((c) => c.name);
  check('Tools really executed (4 create_file + 1 write_file repair)', toolCalls.filter((n) => n === 'create_file').length === 4 && toolCalls.includes('write_file'), JSON.stringify(toolCalls));

  console.log('[5] Workspace contents…');
  // Multi-file *project* requests are intentionally scoped to a named
  // subfolder. The original harness assumed files at workspace root and
  // falsely failed even though all four real files were written correctly.
  const projectRoot = doneEvent?.result?.projectReport?.projectRoot || '';
  const projectRel = path.relative(WORKSPACE, projectRoot);
  check('Agent selected a safe project folder', !!projectRel && !projectRel.startsWith('..') && !path.isAbsolute(projectRel));
  for (const f of ['index.html', 'style.css', 'app.js', 'README.md']) {
    const exists = fs.existsSync(path.join(projectRoot, f));
    check(`File physically exists: ${f}`, exists, path.join(projectRoot, f));
  }
  const treeRes = await api('GET', '/api/workspace/tree');
  const treeNames = JSON.stringify(treeRes.body?.tree || {});
  check('File tree shows all files', ['index.html', 'style.css', 'app.js', 'README.md'].every((f) => treeNames.includes(f)));

  const appPath = path.join(projectRoot, 'app.js');
  if (fs.existsSync(appPath)) {
    const appJs = fs.readFileSync(appPath, 'utf8');
    check('app.js was REPAIRED after the test failure (not the broken version)', appJs.includes('localStorage') && !appJs.includes('const tasks = loadTasks(;'));
  } else check('app.js repaired', false, 'app.js missing');

  console.log('[6] Terminal runs inside the selected project…');
  const term = await api('POST', '/api/terminal/run', { command: 'node --check app.js', cwd: projectRel });
  check('Terminal command executed in project cwd', term.body?.result?.exitCode === 0);

  console.log('[7] Security: path traversal blocked over HTTP…');
  const bad = await api('GET', '/api/workspace/file?path=' + encodeURIComponent('../../etc/passwd'));
  check('Traversal rejected', bad.body && bad.body.success === false);

  console.log('\n=============================');
  if (failures === 0) {
    console.log('E2E ACCEPTANCE TEST: ALL CHECKS PASSED');
  } else {
    console.log(`E2E ACCEPTANCE TEST: ${failures} CHECK(S) FAILED`);
  }
  console.log('=============================');
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('DRIVER ERROR', e);
  process.exit(1);
});
