import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (process.env.QUILLIX_ALLOW_PACKAGED_LAUNCH !== '1') {
  console.error('PACKAGED DEBUGGER NOT RUN: set QUILLIX_ALLOW_PACKAGED_LAUNCH=1 to explicitly launch the shipped Quillix app.');
  process.exit(2);
}

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let packageOutput = path.join(project, 'release', 'windows');
try {
  const marker = JSON.parse(fs.readFileSync(path.join(project, '.quillix-smoke', 'package-output.json'), 'utf8'));
  if (typeof marker.outputDir === 'string' && path.isAbsolute(marker.outputDir)) packageOutput = marker.outputDir;
} catch { /* default release output remains authoritative when no package marker exists */ }
const unpacked = path.join(packageOutput, 'win-unpacked');
const executable = path.join(unpacked, 'Quillix.exe');
const port = 3099;
const origin = `http://127.0.0.1:${port}`;
const settings = path.join(os.tmpdir(), `quillix-packaged-debug-${process.pid}.json`);
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-packaged-profile-'));
let desktop;

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const launchPackagedDesktop = async () => {
  const env = { ...process.env, PORT: String(port), QUILLIX_SETTINGS_PATH: settings };
  // A parent Electron/Codex process may export this flag. It is valid for
  // Electron's own node runtime, but makes a packaged executable launch
  // nondeterministic during acceptance.
  delete env.ELECTRON_RUN_AS_NODE;
  const spawnAttempt = (useShell = false) => new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(executable, [`--user-data-dir=${userData}`], {
        cwd: unpacked,
        windowsHide: false,
        env,
        shell: useShell,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      reject(error);
      return;
    }
    // On Windows, spawn() can return successfully and emit UNKNOWN/EPERM
    // asynchronously (for example while the freshly packaged executable is
    // still being released by antivirus or a previous Electron child). Wait
    // for the real spawn event so the bounded retry below can handle it.
    const onSpawn = () => { child.removeListener('error', onError); resolve(child); };
    const onError = (error) => { child.removeListener('spawn', onSpawn); reject(error); };
    child.__quillixStdout = [];
    child.__quillixStderr = [];
    child.stdout?.on('data', chunk => child.__quillixStdout.push(String(chunk)));
    child.stderr?.on('data', chunk => child.__quillixStderr.push(String(chunk)));
    child.once('spawn', onSpawn);
    child.once('error', onError);
  });
  let lastError;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      return await spawnAttempt(attempt > 0 && process.platform === 'win32');
    } catch (error) {
      lastError = error;
      const code = String(error?.code || '');
      if (process.platform !== 'win32' || !/^(?:UNKNOWN|EPERM|EBUSY)$/i.test(code) || attempt === 7) throw error;
      await wait(500 * (attempt + 1));
    }
  }
  throw lastError || new Error('Packaged Quillix launch failed.');
};

const request = async (route, body, method = 'POST') => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(`${origin}${route}`, {
        method: body === undefined ? 'GET' : method,
        headers: { 'Content-Type': 'application/json', Origin: origin },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        // Tool-backed debugger operations can legitimately take longer than
        // the health probe, especially on a cold packaged Electron process.
        // Keep the probe responsive while giving execution requests enough
        // time to complete instead of aborting a healthy debugger session.
        signal: AbortSignal.timeout(route === '/api/health' ? 15000 : 60000),
      });
      const data = await response.json();
      return { status: response.status, data };
    } catch (error) {
      const message = String(error?.cause?.code || error?.code || error?.message || error);
      if (attempt >= 2 || !/(?:ECONNRESET|ECONNREFUSED|fetch failed|socket hang up)/i.test(message)) throw error;
      await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
  throw new Error(`Packaged request failed: ${route}`);
};

const invoke = async (name, args = {}, approved = false) => (await request('/api/tools/execute', { name, args, approved, conversationMode: 'agent' })).data;
const assertOk = (value, message) => { if (!value) throw new Error(message); };

async function removeTempDirectory(directory) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      fs.rmSync(directory, { recursive: true, force: true });
      return true;
    } catch (error) {
      if (!['EBUSY', 'EPERM', 'ENOTEMPTY'].includes(error?.code)) throw error;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
  // Chromium can keep a cache journal open briefly after taskkill. The
  // profile is disposable, so a delayed cleanup is preferable to failing a
  // successful packaged acceptance run.
  console.warn(`Packaged profile cleanup deferred: ${directory}`);
  return false;
}

try {
  desktop = await launchPackagedDesktop();
  let ready = false;
  for (let attempt = 0; attempt < 180; attempt += 1) {
    if (desktop.exitCode !== null) {
      const stdout = desktop.__quillixStdout?.join('').trim();
      const stderr = desktop.__quillixStderr?.join('').trim();
      if (desktop.exitCode === 4551 && /Device Guard policy/i.test(stderr || '')) {
        throw new Error('PACKAGED DEBUGGER BLOCKED BY WINDOWS DEVICE GUARD (exit 4551). Re-run this acceptance suite on a machine where the packaged executable is permitted, or have IT allow the signed Quillix binary.');
      }
      throw new Error(`Packaged Quillix exited during startup (${desktop.exitCode}).${stderr ? ` stderr: ${stderr}` : ''}${stdout ? ` stdout: ${stdout}` : ''}`);
    }
    try {
      if ((await request('/api/health')).data.status === 'ok') { ready = true; break; }
    } catch { /* Electron and its local server are still starting. */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assertOk(ready, 'Packaged app did not expose /api/health.');

  const root = project;
  const rebound = await request('/api/workspace/set-root', { targetPath: root });
  assertOk(rebound.data.success, `Workspace rebind failed: ${JSON.stringify(rebound.data)}`);

  const lsp = await request('/api/extensions/lsp-stdio', {
    id: 'packaged_mock',
    command: process.execPath,
    args: [path.join(project, 'scripts', 'smoke', 'mock-lsp-stdio.mjs')],
  });
  assertOk(lsp.data.success, `Packaged LSP connection failed: ${JSON.stringify(lsp.data)}`);
  const tools = (await request('/api/tools/list')).data.tools.map(tool => tool.name);
  for (const name of [
    'plugin_lsp_packaged_mock_definition', 'plugin_lsp_packaged_mock_references',
    'plugin_lsp_packaged_mock_diagnostics', 'plugin_lsp_packaged_mock_hover',
    'plugin_lsp_packaged_mock_completion', 'plugin_lsp_packaged_mock_rename_preview',
    'plugin_lsp_packaged_mock_workspace_symbols', 'plugin_lsp_packaged_mock_document_symbols',
  ]) assertOk(tools.includes(name), `Missing packaged LSP tool: ${name}`);
  const completion = await invoke('plugin_lsp_packaged_mock_completion', { filePath: 'src/server/nodeDebugger.ts', line: 1, column: 1 });
  assertOk(completion.success, `Packaged completion failed: ${JSON.stringify(completion)}`);

  const launch = await invoke('plugin_debug_launch', { filePath: 'scripts/smoke/mock-lsp-stdio.mjs', stopOnEntry: true }, true);
  assertOk(launch.success, `Packaged debugger launch failed: ${JSON.stringify(launch)}`);
  const sessionId = launch.data.sessionId;
  const breakpoint = await invoke('plugin_debug_set_breakpoint', { sessionId, filePath: 'scripts/smoke/mock-lsp-stdio.mjs', line: 20 }, true);
  assertOk(breakpoint.success, `Packaged breakpoint failed: ${JSON.stringify(breakpoint)}`);
  const listed = await invoke('plugin_debug_breakpoints', { sessionId });
  assertOk(listed.success && listed.data.breakpoints.length === 1, `Packaged breakpoint list failed: ${JSON.stringify(listed)}`);
  const stepped = await invoke('plugin_debug_step_over', { sessionId }, true);
  assertOk(stepped.success, `Packaged step-over failed: ${JSON.stringify(stepped)}`);
  const cleared = await invoke('plugin_debug_clear_breakpoint', { sessionId, breakpointId: breakpoint.data.breakpointId }, true);
  assertOk(cleared.success, `Packaged breakpoint clear failed: ${JSON.stringify(cleared)}`);
  const stopped = await invoke('plugin_debug_stop', { sessionId }, true);
  assertOk(stopped.success, `Packaged debugger stop failed: ${JSON.stringify(stopped)}`);

  console.log(JSON.stringify({ rootRebind: true, lspTools: 8, completion: true, debugger: 'launch/set/list/step/clear/stop', sessionId }));
} finally {
  if (desktop && desktop.exitCode === null) {
    await new Promise(resolve => {
      const killer = spawn('taskkill', ['/PID', String(desktop.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      killer.once('exit', resolve);
      killer.once('error', resolve);
    });
  }
  fs.rmSync(settings, { force: true });
  await removeTempDirectory(userData);
}
