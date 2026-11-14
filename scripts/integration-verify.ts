/**
 * NUVRO AI integration verification.
 *
 * Runs the REAL NUVRO AI server (server.ts) against a FAKE local Ollama
 * (an HTTP stub on 127.0.0.1:11434) and verifies the key behaviours
 * end-to-end over the actual HTTP API:
 *
 *   1. Ollama connection + model detection
 *   2. Normal chat ("Hi", "What is Python?", "Explain React.") → NO tools
 *   3. Workspace selection, recent workspaces, root endpoint, persistence
 *   4. Multi-file project creation ("shooting game") — real files on disk
 *   5. PART 14 WORKFLOW: "Create a Python calculator project with app.py and
 *      test_app.py. Run the tests and fix any failures." — the tests are
 *      REALLY executed (python3 -m unittest) in the selected workspace, the
 *      output is fed back to the model, and the result is verified.
 *   6. Sabotage app.py → "Run the tests and fix the failure." → the agent
 *      sees the REAL failing test output, repairs app.py, re-runs the tests
 *      and they pass — verified on disk.
 *   7. Terminal history records agent commands with exit codes
 *   8. .env / secret files protected from the AI
 *   9. "Model not found: …" error when the model is not installed
 *  10. Intent router unit checks
 *
 * Usage: HOME=$(mktemp -d) npx tsx scripts/integration-verify.ts
 */
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { installFetchShim } from './verify-fetch-shim.js';

// Install BEFORE the NUVRO AI server module is imported.
installFetchShim();

const QUIX = 'http://127.0.0.1:3000';

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function getJson(url: string): Promise<any> {
  const res = await fetch(url);
  return res.json();
}

async function postJson(url: string, body: any): Promise<any> {
  const payload = { conversationMode: 'agent', ...body };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return res.json();
}

/** Collect the full SSE stream of an /api/agent/run call into parsed events. */
async function runAgent(userPrompt: string, mode = 'agent'): Promise<any[]> {
  const res = await fetch(`${QUIX}/api/agent/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userPrompt, mode, conversationMode: 'agent' }),
  });
  const text = await res.text();
  const events: any[] = [];
  for (const line of text.split('\n\n')) {
    if (!line.startsWith('data: ')) continue;
    try {
      events.push(JSON.parse(line.slice(6)));
    } catch {
      /* ignore */
    }
  }
  return events;
}

/* ------------------------------------------------------------------ */
/* Fake Ollama                                                          */
/* ------------------------------------------------------------------ */

const APP_PY = [
  '"""NUVRO AI Calculator."""',
  '',
  '',
  'def add(a, b):',
  '    return a + b',
  '',
  '',
  'def subtract(a, b):',
  '    return a - b',
  '',
  '',
  'if __name__ == "__main__":',
  '    print("Calculator ready:", add(2, 3))',
].join('\n');

const TEST_APP_PY = [
  'import unittest',
  'from app import add, subtract',
  '',
  '',
  'class TestCalculator(unittest.TestCase):',
  '    def test_add(self):',
  '        self.assertEqual(add(2, 3), 5)',
  '',
  '    def test_subtract(self):',
  '        self.assertEqual(subtract(5, 3), 2)',
  '',
  '',
  'if __name__ == "__main__":',
  '    unittest.main()',
].join('\n');

const fake = {
  models: ['qwen2.5-coder:3b'],
  lastRequestHadTools: null as boolean | null,
};

interface FakeMessage {
  role: string;
  content?: string;
  tool_name?: string;
}

/** The scripted-but-reactive agent: decisions are made from the REAL tool
 * results the server feeds back (test output, exit codes, file writes). */
function decideAgentAction(messages: FakeMessage[]): { text?: string; tool?: { name: string; arguments: any } } {
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.content || '';
  const toolMsgs = messages.filter((m) => m.role === 'tool');
  const lastToolContent = toolMsgs[toolMsgs.length - 1]?.content || '';

  const runTests = { tool: { name: 'run_command', arguments: { command: 'python3 -m unittest test_app -v' } } };
  const writeAppPy = { tool: { name: 'write_file', arguments: { filePath: 'app.py', content: APP_PY } } };

  const calcScenario = /create a python calculator/i.test(lastUser);
  const fixScenario = /run the tests and fix/i.test(lastUser);
  const gameScenario = /shooting game/i.test(lastUser);

  // Multi-file project creation: create every file, then finish.
  if (gameScenario) {
    const gameFiles: Array<[string, string]> = [
      ['index.html', '<html><body>Shooting Game</body></html>'],
      ['style.css', 'body { background: #000; }'],
      ['script.js', 'console.log("shooting game ready");'],
    ];
    const created = toolMsgs.filter((m) =>
      /Successfully created file (index\.html|style\.css|script\.js)/.test(m.content || '')
    ).length;
    if (created < gameFiles.length) {
      const [filePath, content] = gameFiles[created];
      return { tool: { name: 'create_file', arguments: { filePath, content } } };
    }
    return { text: 'Shooting game created: index.html, style.css, script.js.' };
  }

  // The last operation was a REAL test run: pass → finish, fail → repair.
  if (/Command: python3 -m unittest/.test(lastToolContent)) {
    if (/Exit Code: 0/.test(lastToolContent)) {
      return { text: 'All tests passed. The calculator project is verified and complete.' };
    }
    return writeAppPy; // repair app.py with the correct implementation
  }

  // The last operation was writing app.py: run tests once test_app.py exists.
  if (/Successfully wrote .*app\.py|Successfully created file app\.py/.test(lastToolContent)) {
    if (toolMsgs.some((m) => /test_app\.py/.test(m.content || ''))) {
      return runTests;
    }
    return { tool: { name: 'create_file', arguments: { filePath: 'test_app.py', content: TEST_APP_PY } } };
  }

  // The last operation was creating test_app.py → run the tests.
  if (/Successfully created file test_app\.py/.test(lastToolContent)) {
    return runTests;
  }

  // Fresh start.
  if (calcScenario) {
    return { tool: { name: 'create_file', arguments: { filePath: 'app.py', content: APP_PY } } };
  }
  if (fixScenario) {
    return runTests;
  }
  return { text: 'Done.' };
}

const ollamaServer = http.createServer((req, res) => {
  if (req.url === '/api/tags') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ models: fake.models.map((m) => ({ name: m })) }));
    return;
  }
  if (req.url === '/api/chat') {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      let payload: any = {};
      try {
        payload = JSON.parse(body);
      } catch {
        /* ignore */
      }
      const hasTools = Array.isArray(payload.tools) && payload.tools.length > 0;
      fake.lastRequestHadTools = hasTools;
      res.setHeader('Content-Type', 'application/x-ndjson');
      const line = (obj: unknown) => res.write(JSON.stringify(obj) + '\n');

      if (!hasTools) {
        // Normal chat mode: plain streamed text, no tools.
        line({ message: { content: 'Hello! How' } });
        line({ message: { content: ' can I help you?' } });
        line({ done: true });
        res.end();
        return;
      }

      // Coding agent mode: react to the real conversation state.
      const decision = decideAgentAction((payload.messages || []) as FakeMessage[]);
      if (decision.tool) {
        line({ message: { content: `Executing ${decision.tool.name}...` } });
        line({ message: { tool_calls: [{ function: { name: decision.tool.name, arguments: decision.tool.arguments } }] } });
      } else if (decision.text) {
        line({ message: { content: decision.text } });
      }
      line({ done: true });
      res.end();
    });
    return;
  }
  res.statusCode = 404;
  res.end('{}');
});

/* ------------------------------------------------------------------ */
/* Main                                                                 */
/* ------------------------------------------------------------------ */

async function main() {
  const tempBase = fs.mkdtempSync(path.join(os.tmpdir(), 'qx-verify-'));
  const workspaceDir = path.join(tempBase, 'AGENT_TEST');
  const gameDir = path.join(tempBase, 'ShootingGame');
  const parentDir = path.join(tempBase, 'Projects');
  fs.mkdirSync(workspaceDir, { recursive: true });
  fs.mkdirSync(gameDir, { recursive: true });
  fs.mkdirSync(parentDir, { recursive: true });

  await new Promise<void>((resolve) => ollamaServer.listen(11434, '127.0.0.1', resolve));
  console.log('fake Ollama listening on 127.0.0.1:11434');

  process.env.NODE_ENV = 'production';
  await import('../server.js');
  console.log('NUVRO AI server started on 127.0.0.1:3000');

  // Wait for readiness
  for (let i = 0; i < 50; i++) {
    try {
      const h = await getJson(`${QUIX}/api/health`);
      if (h.status === 'ok') break;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  console.log('\n[1] Ollama connection & model detection');
  {
    const status = await getJson(`${QUIX}/api/ollama/status`);
    check('Ollama connected', status.success && status.status.connected === true);
    check('Model qwen2.5-coder:3b available', status.status.modelAvailable === true);
  }

  console.log('\n[2] Normal chat — never triggers tools');
  {
    for (const prompt of ['Hi', 'What is Python?', 'Explain React.']) {
      const events = await runAgent(prompt);
      const intent = events.find((e) => e.event === 'intent');
      const done = events.find((e) => e.event === 'done');
      const toolActivities = events.filter((e) => e.event === 'activity' && e.activity?.message?.startsWith('Calling tool'));
      check(`"${prompt}" → chat`, intent?.intent === 'chat');
      check(`"${prompt}" → streamed reply`, typeof done?.result?.finalText === 'string' && done.result.finalText.length > 0);
      check(`"${prompt}" → no tool executed`, toolActivities.length === 0);
    }
    check('no tools passed to the model in chat mode', fake.lastRequestHadTools === false);
  }

  console.log('\n[3] Workspace selection, root endpoint & recents');
  {
    const res = await postJson(`${QUIX}/api/workspace/set-root`, { targetPath: workspaceDir });
    check('set-root accepted', res.success === true, JSON.stringify(res));
    const rootRes = await getJson(`${QUIX}/api/workspace/root`);
    check('GET /api/workspace/root returns active workspace', rootRes.success && rootRes.path === workspaceDir, `path=${rootRes.path}`);
    check('recent workspaces recorded', Array.isArray(rootRes.recent) && rootRes.recent.includes(workspaceDir));
    const settings = fs.readFileSync(path.join(os.homedir(), '.quillix', 'settings.json'), 'utf8');
    check('workspace persisted to settings (survives restart)', settings.includes(workspaceDir.replace(/\\/g, '\\\\')));
  }

  console.log('\n[4] Coding agent — multi-file project creation (real files on disk)');
  {
    // separate workspace for the game scenario
    await postJson(`${QUIX}/api/workspace/set-root`, { targetPath: gameDir });
    const events = await runAgent('Build a shooting game from scratch.');
    const intent = events.find((e) => e.event === 'intent');
    const patches = events.filter((e) => e.event === 'patch');
    check('classified as agent', intent?.intent === 'agent');
    check('index.html written to the workspace', fs.existsSync(path.join(gameDir, 'index.html')));
    check('multi-file project (3 files)', patches.length === 3, `patches=${patches.length}`);
  }

  console.log('\n[5] PART 14 — Python calculator with REAL test execution');
  {
    // Back to the main AGENT_TEST workspace
    await postJson(`${QUIX}/api/workspace/set-root`, { targetPath: workspaceDir });

    const events = await runAgent(
      'Create a Python calculator project with app.py and test_app.py. Run the tests and fix any failures.'
    );
    const intent = events.find((e) => e.event === 'intent');
    const done = events.find((e) => e.event === 'done');
    const toolResults: any[] = done?.result?.toolResults || [];

    check('classified as agent', intent?.intent === 'agent');
    check('app.py physically exists in the workspace', fs.existsSync(path.join(workspaceDir, 'app.py')));
    check('test_app.py physically exists in the workspace', fs.existsSync(path.join(workspaceDir, 'test_app.py')));
    check(
      'app.py content is real code',
      fs.readFileSync(path.join(workspaceDir, 'app.py'), 'utf8').includes('def add(a, b):')
    );

    const testRun = toolResults.find(
      (t) => t.toolName === 'run_command' && /unittest/.test(t.output || '')
    );
    check('tests were ACTUALLY executed (real command)', !!testRun, JSON.stringify(toolResults.map((t) => t.toolName)));
    check('tests passed (exit code 0)', testRun?.success === true && /Exit Code: 0/.test(testRun.output));
    check(
      'agent verified completion only after passing tests',
      /complete|passed/i.test(done?.result?.finalText || '')
    );

    const hist = await getJson(`${QUIX}/api/terminal/history`);
    const agentCmds = (hist.history || []).filter((h: any) => h.source === 'agent');
    check('agent command recorded in terminal history', agentCmds.some((h: any) => /unittest/.test(h.command)));
    check('command executed with cwd = active workspace', agentCmds.every((h: any) => h.cwd === workspaceDir));
  }

  console.log('\n[6] PART 14 — break the code, agent must detect, fix and re-verify');
  {
    // Intentionally break add(): a + b  →  a - b
    const broken = APP_PY.replace('return a + b', 'return a - b');
    fs.writeFileSync(path.join(workspaceDir, 'app.py'), broken);
    // The replacement has the same byte length and may land in the same
    // second — clear Python's bytecode cache so the next run recompiles the
    // sabotaged source instead of reusing the stale .pyc.
    fs.rmSync(path.join(workspaceDir, '__pycache__'), { recursive: true, force: true });
    const brokenOnDisk = fs.readFileSync(path.join(workspaceDir, 'app.py'), 'utf8');
    check(
      'sabotage applied (add returns a - b)',
      /def add\(a, b\):\s*\n\s*return a - b/.test(brokenOnDisk)
    );

    const events = await runAgent('Run the tests and fix the failure.');
    const done = events.find((e) => e.event === 'done');
    const toolResults: any[] = done?.result?.toolResults || [];
    const testRuns = toolResults.filter((t) => t.toolName === 'run_command' && /unittest/.test(t.output || ''));

    check('agent ran the failing tests first', testRuns.length >= 1 && /Exit Code: [1-9]/.test(testRuns[0]?.output || ''));
    check('agent saw the REAL failure output', /FAILED|AssertionError/.test(testRuns[0]?.output || ''));
    check('agent repaired app.py', fs.readFileSync(path.join(workspaceDir, 'app.py'), 'utf8').includes('return a + b'));
    check('agent re-ran the tests', testRuns.length >= 2, `runs=${testRuns.length}`);
    check('re-run passed (exit code 0)', /Exit Code: 0/.test(testRuns[testRuns.length - 1]?.output || ''));
    check(
      'no false success claim — final text follows real result',
      /passed|complete/i.test(done?.result?.finalText || '')
    );
  }

  console.log('\n[7] Secret file protection');
  {
    fs.writeFileSync(path.join(workspaceDir, '.env'), 'SECRET_TOKEN=supersecret');
    const fileRes = await getJson(`${QUIX}/api/workspace/file?path=${encodeURIComponent('.env')}`);
    check('.env read blocked over API', fileRes.success === false && /Protected file/i.test(fileRes.error || ''));
    const toolRes = await postJson(`${QUIX}/api/tools/execute`, { name: 'read_file', args: { filePath: '.env' } });
    check('.env read blocked for the AI agent', toolRes.success === false && /Protected file/i.test(toolRes.output || toolRes.error || ''));
    const traversal = await postJson(`${QUIX}/api/tools/execute`, { name: 'read_file', args: { filePath: '../../etc/passwd' } });
    check('path traversal rejected', traversal.success === false && /outside the active workspace/i.test(traversal.output || traversal.error || ''));
  }

  console.log('\n[7b] File tools — create/read/update/move against the ACTIVE workspace');
  {
    await postJson(`${QUIX}/api/workspace/set-root`, { targetPath: workspaceDir });
    const mk = await postJson(`${QUIX}/api/tools/execute`, { name: 'create_directory', args: { dirPath: 'src/utils' } });
    check('create_directory works in workspace', mk.success === true);
    const wf = await postJson(`${QUIX}/api/tools/execute`, {
      name: 'write_file',
      args: { filePath: 'src/utils/helper.py', content: 'def greet():\n    return "hi"\n' },
    });
    check('write_file with auto-created parent dirs', wf.success === true && fs.existsSync(path.join(workspaceDir, 'src/utils/helper.py')));
    const rf = await postJson(`${QUIX}/api/tools/execute`, { name: 'read_file', args: { filePath: 'src/utils/helper.py' } });
    check('read_file returns real content', rf.success === true && rf.output.includes('def greet'));
    const uf = await postJson(`${QUIX}/api/tools/execute`, {
      name: 'write_file',
      args: { filePath: 'src/utils/helper.py', content: 'def greet():\n    return "hello"\n' },
    });
    check('update_file modifies the physical file', uf.success === true && fs.readFileSync(path.join(workspaceDir, 'src/utils/helper.py'), 'utf8').includes('hello'));
    const mv = await postJson(`${QUIX}/api/tools/execute`, {
      name: 'move_file',
      args: { oldPath: 'src/utils/helper.py', newPath: 'src/helpers.py' },
    });
    check('move_file works', mv.success === true && fs.existsSync(path.join(workspaceDir, 'src/helpers.py')) && !fs.existsSync(path.join(workspaceDir, 'src/utils/helper.py')));
    const outside = await postJson(`${QUIX}/api/tools/execute`, {
      name: 'write_file',
      args: { filePath: '../../outside-escape.txt', content: 'nope' },
    });
    check('write outside workspace rejected', outside.success === false);
  }

  console.log('\n[8] Model validation — clear "Model not found" error');
  {
    fake.models = []; // model disappears
    const events = await runAgent('Hi');
    const err = events.find((e) => e.event === 'error');
    check(
      'clear Model not found error',
      !!err && /Model not found: qwen2\.5-coder:1\.5b/.test(err.error),
      `error=${err?.error}`
    );
  fake.models = ['qwen2.5-coder:3b'];
  }

  console.log('\n[9] Create New Project + persistence');
  {
    const res = await postJson(`${QUIX}/api/workspace/create-project`, {
      parentPath: parentDir,
      projectName: 'MyGame',
    });
    check('project folder created', res.success === true && fs.existsSync(path.join(parentDir, 'MyGame')));
    const tree = await getJson(`${QUIX}/api/workspace/tree`);
    check('new project became active workspace', tree.root === path.join(parentDir, 'MyGame'), `root=${tree.root}`);
    const rootRes = await getJson(`${QUIX}/api/workspace/root`);
    check('recent workspaces updated (newest first)', rootRes.recent[0] === path.join(parentDir, 'MyGame'));
    const dupe = await postJson(`${QUIX}/api/workspace/create-project`, {
      parentPath: parentDir,
      projectName: 'MyGame',
    });
    check('duplicate project rejected', dupe.success === false);
    const bad = await postJson(`${QUIX}/api/workspace/create-project`, {
      parentPath: parentDir,
      projectName: '../evil',
    });
    check('path traversal in project name rejected', bad.success === false);
  }

  console.log('\n[10] Intent router unit checks');
  {
    const { classifyIntent } = await import('../src/server/intentRouter.js');
    const chats = [
      'Hi',
      'Hello',
      'How are you?',
      'Who are you?',
      'What is Python?',
      'Explain React.',
      'Give me advice about my project',
      'Explain Python classes.',
    ];
    const agents = [
      'Create a Python calculator.',
      'Build a shooting game from scratch.',
      'Fix this project.',
      'Add login functionality.',
      'Create a React app.',
      'Run the tests.',
      'Build this project.',
      'Create these files.',
      'Fix the login bug.',
      'Fix the errors in my project.',
    ];
    check('all chat examples → chat', chats.every((c) => classifyIntent(c).kind === 'chat'));
    check('all agent examples → agent', agents.every((a) => classifyIntent(a).kind === 'agent'));
    check('ambiguous input defaults to chat', classifyIntent('hmm interesting').kind === 'chat');
  }

  console.log(`\n========================================`);
  console.log(`RESULTS: ${pass} passed, ${fail} failed`);
  if (failures.length) {
    for (const f of failures) console.log(`  ✗ ${f}`);
    process.exitCode = 1;
  }
  process.exit(process.exitCode || 0);
}

main().catch((err) => {
  console.error('verification crashed:', err);
  process.exit(1);
});
