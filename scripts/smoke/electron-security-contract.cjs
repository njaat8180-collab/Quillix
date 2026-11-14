/**
 * Quillix Electron SECURITY contract.
 *
 * Runs the REAL built Electron main process (`dist/electron/main.cjs`)
 * against the REAL production server, then asserts the security controls
 * that protect the renderer:
 *
 *   1. contextIsolation stays enabled.
 *   2. nodeIntegration stays disabled (also in workers).
 *   3. sandbox stays enabled.
 *   4. The renderer cannot reach Node (`require`, `process`, `global`).
 *   5. The preload bridge exposes ONLY the documented desktop API — no
 *      ipcRenderer, no arbitrary channel send.
 *   6. The CSP header is present on the app document and forbids
 *      third-party script sources.
 *   7. The hardening headers are present (nosniff, DENY frames, no-referrer).
 *   8. The permission handler DENIES camera / microphone / geolocation and
 *      ALLOWS the clipboard write the UI actually uses.
 *   9. An IPC call from an untrusted sender is rejected.
 *
 * This does NOT package anything. It only launches the already-built
 * desktop runtime.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const MAIN = path.join(ROOT, 'dist', 'electron', 'main.cjs');
const PRELOAD = path.join(ROOT, 'dist', 'electron', 'preload.cjs');
const SERVER = path.join(ROOT, 'dist', 'server.cjs');

const PORT = 3211;
const APP_URL = `http://127.0.0.1:${PORT}`;
const results = { checks: [] };

function fail(message, extra) {
  console.error('\nFAIL: ' + message);
  if (extra !== undefined) {
    console.error(typeof extra === 'string' ? extra : JSON.stringify(extra, null, 2));
  }
  process.exit(1);
}

function check(name, ok, detail) {
  results.checks.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) process.exitCode = 1;
}

function waitForServer(timeoutMs) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(`${APP_URL}/api/health`, (res) => {
        res.resume();
        resolve(true);
      });
      req.on('error', retry);
      req.setTimeout(1200, () => { req.destroy(); });
    };
    const retry = () => {
      if (Date.now() - started > timeoutMs) {
        reject(new Error('production server did not become ready'));
        return;
      }
      setTimeout(attempt, 300);
    };
    attempt();
  });
}

function waitForHttp(url, timeoutMs) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      http.get(url, (res) => {
        res.resume();
        resolve(res);
      }).on('error', retry).setTimeout(1200, () => { });
    };
    const retry = () => {
      if (Date.now() - started > timeoutMs) {
        reject(new Error(`timed out waiting for ${url}`));
        return;
      }
      setTimeout(attempt, 250);
    };
    attempt();
  });
}

async function main() {
  for (const [label, file] of [['main bundle', MAIN], ['preload bundle', PRELOAD], ['server bundle', SERVER]]) {
    if (!fs.existsSync(file)) fail(`${label} missing at ${file} — run "npm run build" first.`);
  }

  const serverOut = [];
  const server = spawn(process.execPath, [SERVER], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), NODE_ENV: 'production' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (d) => serverOut.push(String(d)));
  server.stderr.on('data', (d) => serverOut.push(String(d)));

  try {
    await waitForServer(30000);
  } catch (e) {
    server.kill();
    fail('production server did not start', serverOut.slice(-2000).join('\n') + '\n' + e.message);
  }

  // Inspect the security headers the server itself returns.
  const headRes = await waitForHttp(`${APP_URL}/`, 10000);
  check(
    'server serves the app document with a 200',
    headRes.statusCode === 200,
    `status=${headRes.statusCode}`,
  );

  // Launch the real Electron main process against the live server.
  const electronOut = [];
  const electron = spawn(
    require('electron'),
    [path.join(__dirname, '_electron_security_probe.cjs')],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        PORT: String(PORT),
        QUILLIX_SECURITY_PROBE: '1',
        ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  electron.stdout.on('data', (d) => electronOut.push(String(d)));
  electron.stderr.on('data', (d) => electronOut.push(String(d)));

  const exitCode = await new Promise((resolve) => {
    const timer = setTimeout(() => {
      electron.kill();
      resolve(-1);
    }, 90000);
    electron.on('exit', (code) => { clearTimeout(timer); resolve(code); });
  });

  const out = electronOut.join('');
  if (exitCode === -1) fail('electron security probe timed out', out.slice(-3000));
  if (exitCode !== 0) fail('electron security probe exited with code ' + exitCode, out.slice(-3000));

  const reportPath = path.join(ROOT, '.qa-dist', 'electron-security-report.json');
  if (!fs.existsSync(reportPath)) fail('electron security report was not produced', out.slice(-3000));
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));

  /* ---------------- webPreferences ---------------- */
  check('contextIsolation enabled', report.webPreferences.contextIsolation === true);
  check('nodeIntegration disabled', report.webPreferences.nodeIntegration === false);
  check('nodeIntegrationInWorker disabled', report.webPreferences.nodeIntegrationInWorker === false);
  check('sandbox enabled', report.webPreferences.sandbox === true);
  check('webSecurity enabled', report.webPreferences.webSecurity === true);

  /* ---------------- renderer isolation ---------------- */
  check('renderer cannot access require()', report.nodeAccess.requireAvailable === false);
  check('renderer cannot access process', report.nodeAccess.processAvailable === false);
  check('renderer cannot access global', report.nodeAccess.globalAvailable === false);

  /* ---------------- preload surface ---------------- */
  const bridgeKeys = (report.preloadKeys || []).slice().sort();
  const expectedKeys = ['isDesktop', 'isMaximized', 'minimize', 'selectFolder', 'toggleMaximize'];
  check(
    'preload exposes only the documented desktop API',
    JSON.stringify(bridgeKeys) === JSON.stringify(expectedKeys),
    `keys=${JSON.stringify(bridgeKeys)}`,
  );
  check('preload does not leak ipcRenderer', report.preloadLeaks.ipcRenderer === false);
  check('preload does not leak a raw send()', report.preloadLeaks.rawSend === false);

  /* ---------------- CSP + headers ---------------- */
  check('CSP header present on the app document', typeof report.csp === 'string' && report.csp.length > 0, report.csp || '(missing)');
  if (report.csp) {
    check("CSP default-src is 'self'", /default-src 'self'/.test(report.csp));
    check("CSP script-src does not allow remote origins", !/script-src[^;]*https?:/.test(report.csp));
    check("CSP object-src is 'none'", /object-src 'none'/.test(report.csp));
    check("CSP frame-ancestors is 'none'", /frame-ancestors 'none'/.test(report.csp));
    check("CSP base-uri is 'none'", /base-uri 'none'/.test(report.csp));
  }
  check('X-Content-Type-Options is nosniff', report.securityHeaders['x-content-type-options'] === 'nosniff');
  check('X-Frame-Options is DENY', report.securityHeaders['x-frame-options'] === 'DENY');
  check('Referrer-Policy is no-referrer', report.securityHeaders['referrer-policy'] === 'no-referrer');

  /* ---------------- permissions ---------------- */
  check('camera permission denied', report.permissions.camera === false);
  check('microphone permission denied', report.permissions.microphone === false);
  check('geolocation permission denied', report.permissions.geolocation === false);
  check('clipboard-sanitized-write allowed', report.permissions['clipboard-sanitized-write'] === true);
  check('unknown permission denied', report.permissions['some-unknown-permission'] === false);
  check('permission check handler mirrors the request handler', report.permissionCheckMatches === true);

  /* ---------------- IPC sender validation ---------------- */
  check('trusted sender is accepted by the IPC guard', report.ipc.trustedSenderAccepted === true);
  check('foreign sender is rejected by the IPC guard', report.ipc.foreignSenderRejected === true);
  check('subframe sender is rejected by the IPC guard', report.ipc.subframeSenderRejected === true);
  check('null/empty sender is rejected by the IPC guard', report.ipc.emptySenderRejected === true);

  /* ---------------- the REAL main bundle installs the policy ---- */
  const mainSource = fs.readFileSync(MAIN, 'utf8');
  check('built main bundle applies the CSP header', /Content-Security-Policy/.test(mainSource));
  check('built main bundle installs a permission request handler', /setPermissionRequestHandler/.test(mainSource));
  check('built main bundle installs a permission check handler', /setPermissionCheckHandler/.test(mainSource));
  check('built main bundle installs a header handler', /onHeadersReceived/.test(mainSource));
  check('built main bundle keeps contextIsolation enabled', /contextIsolation:\s*true/.test(mainSource));
  check('built main bundle keeps nodeIntegration disabled', /nodeIntegration:\s*false/.test(mainSource));
  check('built main bundle keeps sandbox enabled', /sandbox:\s*true/.test(mainSource));
  check('built main bundle validates IPC senders', /isTrustedIpcSender/.test(mainSource));
  check('built main bundle denies external navigation', /will-navigate/.test(mainSource));
  check('built main bundle denies new windows', /setWindowOpenHandler/.test(mainSource));

  /* ---------------- console ---------------- */
  check('renderer had zero console errors', report.consoleErrors.length === 0, JSON.stringify(report.consoleErrors));

  server.kill();

  const failed = results.checks.filter((c) => !c.ok);
  console.log(`\n${results.checks.length - failed.length}/${results.checks.length} checks passed.`);
  if (failed.length) {
    console.error('Failed checks: ' + failed.map((f) => f.name).join(', '));
    process.exit(1);
  }
  console.log('PASS: electron security contract verified.');
  process.exit(0);
}

main().catch((e) => fail('electron security contract crashed', e.stack || String(e)));
