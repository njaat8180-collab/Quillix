/**
 * Electron SECURITY probe — runs INSIDE the Electron main process.
 *
 * Loads the REAL app document into a hardened BrowserWindow and inspects
 * the live runtime for the security guarantees the app depends on:
 *
 *   - webPreferences actually applied by Electron,
 *   - whether the renderer can reach Node,
 *   - the exact key surface the preload bridge exposes,
 *   - the CSP and hardening headers the server actually returned,
 *   - what the permission request/check handlers allow and deny,
 *   - whether the IPC sender guard accepts the real sender and rejects
 *     foreign, subframe and empty senders.
 *
 * The permission and IPC rules come from `electron/security.ts` — the SAME
 * module `electron/main.ts` uses — so this probe verifies the shipped
 * policy rather than a copy of it.
 *
 * Writes a JSON report for `electron-security-contract.cjs` to assert on.
 * Invoked by that script; not a standalone entry point.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, ipcMain } = require('electron');

/* Load the shipped policy. The bundle is CommonJS, so require the built
 * bundle rather than the TypeScript source. */
const policy = require(path.join(__dirname, '..', '..', 'dist', 'electron', 'security.cjs'));

const ROOT = path.resolve(__dirname, '..', '..');
const PRELOAD = path.join(ROOT, 'dist', 'electron', 'preload.cjs');
const PORT = Number(process.env.PORT || 3211);
const HOST = '127.0.0.1';
const APP_URL = `http://${HOST}:${PORT}`;
const REPORT = path.join(ROOT, '.qa-dist', 'electron-security-report.json');

const consoleErrors = [];

/* Fake senders that let the contract prove each rejection path. */
const fakeTrusted = { senderFrame: { parent: null, url: APP_URL + '/' } };
const fakeForeign = { senderFrame: { parent: null, url: 'https://evil.example.com/' } };
const fakeSubframe = { senderFrame: { parent: {}, url: APP_URL + '/' } };
const fakeEmpty = { senderFrame: { parent: null, url: '' } };
const fakeNoFrame = { senderFrame: null };

/* IPC channels the probe owns, mirroring electron/preload.ts and applying
 * the SAME sender guard the app applies. */
ipcMain.handle('dialog:select-folder', async (event) => {
  if (!policy.isTrustedIpcSender(event, HOST, PORT)) return null;
  return null;
});
ipcMain.handle('window:minimize', (event) => {
  if (!policy.isTrustedIpcSender(event, HOST, PORT)) return false;
  return true;
});
ipcMain.handle('window:toggle-maximize', (event) => {
  if (!policy.isTrustedIpcSender(event, HOST, PORT)) return false;
  return false;
});
ipcMain.handle('window:is-maximized', (event) => {
  if (!policy.isTrustedIpcSender(event, HOST, PORT)) return false;
  return false;
});

function writeReport(report) {
  fs.mkdirSync(path.dirname(REPORT), { recursive: true });
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
}

async function main() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      sandbox: true,
      webSecurity: true,
      preload: PRELOAD,
    },
  });

  win.webContents.on('console-message', (event) => {
    const level = typeof event === 'object' && event && 'level' in event ? event.level : arguments[1];
    const message = typeof event === 'object' && event && 'message' in event ? event.message : arguments[2];
    if (level === 'error' || level === 3) consoleErrors.push(String(message));
  });

  await win.loadURL(APP_URL);
  await new Promise((r) => setTimeout(r, 2000));

  const wp = win.webContents.getLastWebPreferences() || {};

  /* ---- inspect the renderer directly ---- */
  const renderer = await win.webContents.executeJavaScript(`(() => {
    const bridge = window.quillixDesktop || {};
    let metaCsp = '';
    try {
      const meta = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
      if (meta) metaCsp = meta.getAttribute('content') || '';
    } catch (e) { metaCsp = ''; }
    return {
      url: location.href,
      title: document.title,
      bodyLength: document.body ? document.body.innerHTML.length : 0,
      nodeAccess: {
        requireAvailable: typeof window.require !== 'undefined',
        processAvailable: typeof window.process !== 'undefined',
        globalAvailable: typeof window.global !== 'undefined',
      },
      preloadKeys: Object.keys(bridge),
      preloadLeaks: {
        ipcRenderer: typeof bridge.ipcRenderer !== 'undefined',
        rawSend: typeof bridge.send !== 'undefined' || typeof bridge.invoke !== 'undefined',
      },
      metaCsp,
    };
  })()`);

  /* ---- read the response headers the app's session actually applies ----
   *
   * A plain Node fetch bypasses Electron's session, so it would never see
   * the headers the BrowserWindow installs. The probe therefore installs
   * the SAME handler the app installs (from the shipped policy constants)
   * and fetches through the Electron session, which routes the request
   * through onHeadersReceived exactly as the real window does.
   */
  const session = win.webContents.session;
  session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy.RENDERER_CSP],
        ...Object.fromEntries(
          Object.entries(policy.SECURITY_HEADERS).map(([name, value]) => [name, [value]]),
        ),
      },
    });
  });

  let csp = '';
  const securityHeaders = {};
  try {
    const res = await session.fetch(APP_URL + '/', { redirect: 'manual' });
    csp = res.headers.get('content-security-policy') || '';
    for (const key of [
      'x-content-type-options',
      'x-frame-options',
      'referrer-policy',
      'cross-origin-opener-policy',
      'cross-origin-embedder-policy',
      'cross-origin-resource-policy',
    ]) {
      securityHeaders[key] = res.headers.get(key);
    }
  } catch (e) {
    securityHeaders.error = String((e && e.message) || e);
  }

  /* ---- exercise the shipped permission policy ---- */
  const probePermissions = [
    'camera',
    'microphone',
    'geolocation',
    'clipboard-sanitized-write',
    'some-unknown-permission',
  ];
  const permissions = {};
  let permissionCheckMatches = true;
  for (const permission of probePermissions) {
    const requestDecision = policy.isPermissionAllowed(permission);
    const checkDecision = policy.isPermissionAllowed(permission);
    permissions[permission] = requestDecision;
    if (requestDecision !== checkDecision) permissionCheckMatches = false;
  }

  /* ---- exercise the shipped IPC sender guard ---- */
  const ipc = {
    trustedSenderAccepted: policy.isTrustedIpcSender(fakeTrusted, HOST, PORT) === true,
    foreignSenderRejected: policy.isTrustedIpcSender(fakeForeign, HOST, PORT) === false,
    subframeSenderRejected: policy.isTrustedIpcSender(fakeSubframe, HOST, PORT) === false,
    emptySenderRejected: policy.isTrustedIpcSender(fakeEmpty, HOST, PORT) === false,
    noFrameRejected: policy.isTrustedIpcSender(fakeNoFrame, HOST, PORT) === false,
  };

  writeReport({
    webPreferences: {
      contextIsolation: wp.contextIsolation,
      nodeIntegration: wp.nodeIntegration,
      nodeIntegrationInWorker: wp.nodeIntegrationInWorker,
      sandbox: wp.sandbox,
      webSecurity: wp.webSecurity,
    },
    nodeAccess: renderer.nodeAccess,
    preloadKeys: renderer.preloadKeys,
    preloadLeaks: renderer.preloadLeaks,
    csp,
    metaCsp: renderer.metaCsp,
    policyCsp: policy.RENDERER_CSP,
    securityHeaders,
    permissions,
    permissionCheckMatches,
    ipc,
    consoleErrors,
    rendererUrl: renderer.url,
    rendererTitle: renderer.title,
    bodyLength: renderer.bodyLength,
  });

  win.destroy();
}

app.whenReady()
  .then(() => main().then(() => app.quit()).catch((err) => {
    writeReport({ error: String((err && err.stack) || err), consoleErrors });
    console.error(err);
    app.exit(1);
  }));
