/**
 * Electron launch probe — runs INSIDE the Electron main process.
 *
 * Creates the same hardened BrowserWindow configuration as
 * `electron/main.ts` (contextIsolation, sandbox, no nodeIntegration), loads
 * the local Quillix server, exercises the preload bridge, and writes a JSON
 * report to disk for `electron-launch-contract.cjs` to assert on.
 *
 * Invoked by electron-launch-contract.cjs; not a standalone entry point.
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

app.disableHardwareAcceleration();

const PORT = Number(process.env.PORT || 3199);
const APP_URL = `http://127.0.0.1:${PORT}`;
const PRELOAD = process.env.QUILLIX_E2E_PRELOAD;
const REPORT = path.join(process.cwd(), '.qa-dist', 'electron-launch-report.json');

const consoleErrors = [];
const failedLoads = [];

// Mirror the IPC handlers registered by electron/main.ts so the preload
// bridge can be exercised for real. Same channels, same return shapes.
let mainWindow = null;
ipcMain.handle('dialog:select-folder', async () => null);
ipcMain.handle('window:minimize', () => { if (mainWindow) mainWindow.minimize(); return true; });
ipcMain.handle('window:toggle-maximize', () => {
  if (!mainWindow) return false;
  if (mainWindow.isMaximized()) mainWindow.unmaximize(); else mainWindow.maximize();
  return mainWindow.isMaximized();
});
ipcMain.handle('window:is-maximized', () => Boolean(mainWindow && mainWindow.isMaximized()));

function writeReport(report) {
  fs.mkdirSync(path.dirname(REPORT), { recursive: true });
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
}

async function main() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
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

  mainWindow = win;
  win.webContents.on('console-message', (event) => {
    // Electron >=37 passes (event, level, message, line, sourceId).
    const level = typeof event === 'object' && event && 'level' in event ? event.level : arguments[1];
    const message = typeof event === 'object' && event && 'message' in event ? event.message : arguments[2];
    if (level === 'error' || level === 3) consoleErrors.push(String(message));
  });
  win.webContents.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL) => {
    failedLoads.push({ errorCode, errorDescription, validatedURL });
  });

  await win.loadURL(APP_URL);
  // Give React a moment to mount.
  await new Promise((r) => setTimeout(r, 2500));

  const result = await win.webContents.executeJavaScript(`(async () => {
    const bridge = window.quillixDesktop;
    let ipcIsMaximized = null;
    try {
      // The preload exposes the window controls as top-level methods.
      ipcIsMaximized = await bridge.isMaximized();
    } catch (e) {
      ipcIsMaximized = 'error: ' + String(e && e.message || e);
    }
    return {
      url: location.href,
      title: document.title,
      bodyLength: document.body ? document.body.innerHTML.length : 0,
      rootChildren: document.getElementById('root') ? document.getElementById('root').children.length : 0,
      preloadBridgeExposed: !!bridge,
      preloadIsDesktop: !!(bridge && bridge.isDesktop === true),
      ipcIsMaximized,
      hasQuillixDesktopGlobal: typeof window.quillixDesktop !== 'undefined',
      nodeRequireAvailable: typeof window.require !== 'undefined',
      processAvailable: typeof window.process !== 'undefined',
    };
  })()`);

  // webPreferences as actually configured on the live window.
  const wp = win.webContents.getLastWebPreferences
    ? win.webContents.getLastWebPreferences()
    : {};

  writeReport({
    windowCreated: true,
    url: result.url,
    title: result.title,
    bodyLength: result.bodyLength,
    rootChildren: result.rootChildren,
    preloadBridgeExposed: result.preloadBridgeExposed,
    preloadIsDesktop: result.preloadIsDesktop,
    ipcIsMaximized: result.ipcIsMaximized,
    hasQuillixDesktopGlobal: result.hasQuillixDesktopGlobal,
    nodeRequireAvailable: result.nodeRequireAvailable,
    processAvailable: result.processAvailable,
    webPreferences: {
      contextIsolation: wp.contextIsolation,
      nodeIntegration: wp.nodeIntegration,
      sandbox: wp.sandbox,
      webSecurity: wp.webSecurity,
    },
    consoleErrors,
    failedLoads,
  });

  win.destroy();
}

app.whenReady()
  .then(() => main().then(() => app.quit()).catch((err) => {
    writeReport({ windowCreated: false, error: String(err && err.stack || err), consoleErrors, failedLoads });
    console.error(err);
    app.exit(1);
  }));
