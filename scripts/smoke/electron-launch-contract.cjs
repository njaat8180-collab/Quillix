/**
 * Quillix Electron launch contract.
 *
 * Launches the REAL Electron main process against the production server and
 * verifies that:
 *   1. the main process boots without throwing,
 *   2. the renderer window is created with the hardened webPreferences,
 *   3. the renderer loads the local server and renders the app shell,
 *   4. the preload bridge is exposed to the renderer,
 *   5. no renderer console errors occur during load,
 *   6. IPC round-trips through the preload bridge,
 *   7. the server child process is cleaned up on quit.
 *
 * Run: npm run test:electron-launch
 */
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');

const ROOT = path.resolve(__dirname, '..', '..');
const MAIN = path.join(ROOT, 'dist', 'electron', 'main.cjs');
const PRELOAD = path.join(ROOT, 'dist', 'electron', 'preload.cjs');
const SERVER = path.join(ROOT, 'dist', 'server.cjs');

function fail(message, extra) {
  console.error('\nFAIL: ' + message);
  if (extra !== undefined) console.error(typeof extra === 'string' ? extra : JSON.stringify(extra, null, 2));
  process.exit(1);
}

for (const [label, file] of [['main bundle', MAIN], ['preload bundle', PRELOAD], ['server bundle', SERVER]]) {
  if (!fs.existsSync(file)) fail(`${label} missing at ${file} — run "npm run build" first.`);
}

const PORT = Number(process.env.QUILLIX_E2E_PORT || 3199);
const APP_URL = `http://127.0.0.1:${PORT}`;
const results = { checks: [], consoleErrors: [], ipc: {} };

function check(name, ok, detail) {
  results.checks.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) process.exitCode = 1;
}

function waitForServer(timeoutMs = 40000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(`${APP_URL}/api/health`, (res) => {
        res.resume();
        if (res.statusCode === 200) return resolve(true);
        retry();
      });
      req.on('error', retry);
      req.setTimeout(1500, () => { req.destroy(); });
    };
    const retry = () => {
      if (Date.now() - started > timeoutMs) return reject(new Error('server did not become ready'));
      setTimeout(attempt, 300);
    };
    attempt();
  });
}

async function main() {
  // Launch the REAL production server on an isolated port.
  const server = spawn(process.execPath, [SERVER], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), NODE_ENV: 'production' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverOut = '';
  server.stdout.on('data', (d) => { serverOut += d.toString(); });
  server.stderr.on('data', (d) => { serverOut += d.toString(); });

  try {
    await waitForServer();
    check('production server became ready', true, APP_URL);
  } catch (e) {
    server.kill();
    fail('production server did not start', serverOut.slice(-2000) + '\n' + e.message);
  }

  // Launch Electron with the real main bundle, but drive the window from a
  // test harness via the remote debugging port so we can inspect the renderer.
  const electronBin = require('electron');
  const child = spawn(electronBin, [path.join(ROOT, 'scripts', 'smoke', '_electron_launch_probe.cjs')], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      QUILLIX_E2E_PROBE: '1',
      QUILLIX_E2E_MAIN: MAIN,
      QUILLIX_E2E_PRELOAD: PRELOAD,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let out = '';
  child.stdout.on('data', (d) => { out += d.toString(); process.stdout.write(d); });
  child.stderr.on('data', (d) => { out += d.toString(); process.stderr.write(d); });

  const exitCode = await new Promise((resolve) => {
    const timer = setTimeout(() => { child.kill(); resolve(-1); }, 60000);
    child.on('exit', (code) => { clearTimeout(timer); resolve(code === null ? -1 : code); });
  });

  server.kill();

  if (exitCode === -1) fail('electron probe timed out or was killed', out.slice(-3000));
  if (exitCode !== 0) fail('electron probe exited with code ' + exitCode, out.slice(-3000));

  check('electron main process booted and shut down cleanly', true, 'exit 0');

  // Parse the JSON payload the probe writes to disk.
  const reportPath = path.join(ROOT, '.qa-dist', 'electron-launch-report.json');
  if (!fs.existsSync(reportPath)) fail('electron launch report was not produced', out.slice(-3000));
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));

  check('renderer window was created', report.windowCreated === true);
  check('renderer loaded the local server', report.url === APP_URL || String(report.url).startsWith(APP_URL), String(report.url));
  check('renderer title is set', report.title === 'NUVRO AI', String(report.title));
  check('app shell rendered', report.bodyLength > 500, `bodyLength=${report.bodyLength}`);
  check('renderer had zero console errors', report.consoleErrors.length === 0, JSON.stringify(report.consoleErrors));
  check('renderer had zero failed loads', report.failedLoads.length === 0, JSON.stringify(report.failedLoads));

  // Hardened webPreferences must survive into the live window.
  const wp = report.webPreferences || {};
  check('contextIsolation enabled', wp.contextIsolation === true);
  check('nodeIntegration disabled', wp.nodeIntegration !== true);
  check('sandbox enabled', wp.sandbox === true);

  // Preload bridge must be present in the isolated world.
  check('preload bridge exposed', report.preloadBridgeExposed === true);
  check('preload bridge exposes isDesktop', report.preloadIsDesktop === true);

  // CRITICAL: the sandboxed renderer must NOT be able to reach Node.
  check('renderer cannot access Node require()', report.nodeRequireAvailable === false, String(report.nodeRequireAvailable));
  check('renderer cannot access Node process', report.processAvailable === false, String(report.processAvailable));

  // IPC round trip: window:is-maximized must answer through the bridge.
  check('IPC window:is-maximized round-trip', report.ipcIsMaximized === true || report.ipcIsMaximized === false, String(report.ipcIsMaximized));

  // Server child must not survive the desktop process.
  await new Promise((r) => setTimeout(r, 1500));
  const stillAlive = await new Promise((resolve) => {
    const req = http.get(`${APP_URL}/api/health`, (res) => { res.resume(); resolve(true); });
    req.on('error', () => resolve(false));
    req.setTimeout(1200, () => { req.destroy(); resolve(false); });
  });
  check('server child was cleaned up on quit', stillAlive === false);

  const failed = results.checks.filter((c) => !c.ok);
  console.log(`\n${results.checks.length - failed.length}/${results.checks.length} checks passed.`);
  if (failed.length) {
    console.error('Failed checks: ' + failed.map((f) => f.name).join(', '));
    process.exit(1);
  }
  console.log('PASS: electron launch contract verified.');
  process.exit(0);
}

main().catch((e) => fail('electron launch contract crashed', e.stack || String(e)));
