/**
 * NUVRO AI — Electron main process.
 *
 * Startup flow:
 *   1. Acquire the single-instance lock (a second launch just focuses the
 *      existing window instead of fighting over the port).
 *   2. Check whether a NUVRO AI server is already serving on 127.0.0.1:3000.
 *        - Yes  -> reuse it (no second server, no EADDRINUSE).
 *        - No   -> check whether the port is occupied by something else.
 *                    - Occupied by a non-NUVRO AI app -> clear error, quit.
 *                    - Free -> spawn the bundled NUVRO AI server as a child
 *                      process and wait until /api/health responds.
 *   3. Open the native BrowserWindow pointing at http://127.0.0.1:3000.
 *
 * The renderer never gets privileged Node access: it talks to the local
 * server over HTTP exactly like the browser build does.
 */
import { app, BrowserWindow, dialog, shell, ipcMain, session } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { ChildProcess, spawn } from 'child_process';
import path from 'path';
import os from 'os';
import { resolvePort } from '../platform/portConfig.js';
import { formatServerDiagnostics, sanitizeServerDiagnostic } from '../platform/diagnostics.js';
import { isTrustedIpcSender } from '../platform/ipcGuard.js';

const HOST = '127.0.0.1';

/** Read the project `.env` file (dev checkout only; the packaged app has none). */
function readEnvFile(): string | null {
  try {
    const fs = require('fs') as typeof import('fs');
    const envPath = path.join(app.getAppPath(), '.env');
    if (!fs.existsSync(envPath)) return null;
    return fs.readFileSync(envPath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Resolve the port exactly the way the server does: process.env.PORT first,
 * then the project's .env file, then 3000. A configured but invalid value is
 * reported instead of being silently replaced — the server rejects anything
 * outside 1..65535, so a mismatch would only produce a confusing startup
 * failure.
 */
const portResolution = resolvePort({ envPort: process.env.PORT, envFileContents: readEnvFile() });
const PORT = portResolution.port;
const APP_URL = `http://${HOST}:${PORT}`;
const PORT_CONFIG_ERROR = portResolution.ok ? null : portResolution.reason ?? 'PORT is not a valid port number.';
const READY_TIMEOUT_MS = 45000;

/** Origins an IPC message may legitimately come from. */
const TRUSTED_ORIGINS = [`http://${HOST}:${PORT}`, `http://localhost:${PORT}`];

/**
 * Permissions NUVRO AI legitimately needs. It is a local coding workspace:
 * the camera, microphone, geolocation, notifications and every other device
 * permission are denied, so no page in the window can ask for them.
 */
const ALLOWED_PERMISSIONS = new Set(['clipboard-read', 'clipboard-sanitized-write', 'fullscreen']);

let mainWindow: BrowserWindow | null = null;
let serverProcess: ChildProcess | null = null;
let ownsServerProcess = false; // true only if THIS instance spawned the server
let appIsQuitting = false;
let serverStartupFailed: string | null = null;
let serverRestartAttempts = 0;
let lastServerErrors: string[] = [];

  /* ------------------------------------------------------------------ */
/* Logging                                                             */
/* ------------------------------------------------------------------ */

function log(...args: unknown[]): void {
  console.log('[nuvro-ai]', ...args);
}

/* ------------------------------------------------------------------ */
/* Local server management                                             */
/* ------------------------------------------------------------------ */

/** True if the URL belongs to this app's local server. */
function isLocalAppUrl(url: string): boolean {
  return (
    url.startsWith(`${APP_URL}/`) || url === APP_URL ||
    url.startsWith(`http://localhost:${PORT}/`) || url === `http://localhost:${PORT}`
  );
}

/** Fetch helper with a short timeout (main-process fetch). */
async function fetchJson(url: string, timeoutMs = 1500): Promise<any | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Detect an already-running NUVRO AI server. /api/settings is the NUVRO AI
 * fingerprint: it only responds on a NUVRO AI backend.
 */
async function isQuillixRunning(): Promise<boolean> {
  const data = await fetchJson(`${APP_URL}/api/settings`);
  return Boolean(data && data.success === true && data.settings && typeof data.settings.model === 'string');
}

/** True if something (anything) is listening on the app port. */
async function isPortOccupied(): Promise<boolean> {
  const data = await fetchJson(`${APP_URL}/api/health`, 800);
  if (data) return true;
  // The occupant may not speak HTTP on /api/health; do a raw TCP check too.
  return await new Promise<boolean>((resolve) => {
    const net = require('net') as typeof import('net');
    const socket = new net.Socket();
    socket.setTimeout(800);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => resolve(false));
    socket.connect(PORT, HOST);
  });
}

/** Resolve the bundled server entry (works dev and packaged). */
function serverEntryPath(): string {
  // __dirname = <app>/dist/electron in dev, <resources>/app.asar/dist/electron when packed.
  return path.join(__dirname, '..', 'server.cjs');
}

/** Spawn the NUVRO AI server as a child process (runs as plain Node). */
function startServerProcess(): ChildProcess {
  const entry = serverEntryPath();
  const cwd = app.isPackaged ? os.homedir() : process.cwd();

  const child = spawn(process.execPath, [entry], {
    cwd,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(PORT),
      // Run the Electron binary as a plain Node runtime for the server child.
      ELECTRON_RUN_AS_NODE: '1',
      // The server watches this PID and exits if the desktop app dies,
      // so no orphaned server is left behind.
      QUILLIX_PARENT_PID: String(process.pid),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  ownsServerProcess = true;

  child.on('error', (error) => {
    serverStartupFailed = `Could not start the NUVRO AI server: ${error.message}`;
    log(serverStartupFailed);
  });

  child.stdout!.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString().split('\n')) {
      if (line.trim()) log('[server]', line);
    }
  });
  child.stderr!.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString().split('\n')) {
      if (line.trim()) {
        lastServerErrors = [...lastServerErrors, line.trim().slice(0, 500)].slice(-12);
        console.error('[quillix] [server]', line);
      }
    }
  });

  child.on('exit', (code, signal) => {
    if (!ownsServerProcess) return;
    if (appIsQuitting) return;
    if (serverProcess && serverProcess !== child) return;

    if (!mainWindow) {
      // Startup phase failure (e.g. port stolen between probe and listen).
      serverStartupFailed = `The NUVRO AI server exited during startup (code ${code}).`;
      return;
    }

    // The server died while the app was running. Give transient Electron/Node
    // child failures one automatic recovery before interrupting the user.
    log(`server exited unexpectedly (code ${code}, signal ${signal})`);
    serverProcess = null;
    if (serverRestartAttempts < 1 && mainWindow) {
      serverRestartAttempts += 1;
      setTimeout(() => { void restartServerAndReload(); }, 300);
      return;
    }
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'error',
      title: 'NUVRO AI',
      message: 'The NUVRO AI server stopped unexpectedly.',
      detail: `Exit code: ${code}. The desktop window cannot work without it.${(() => {
        const diagnostics = formatServerDiagnostics(lastServerErrors);
        return diagnostics ? `\n\nServer diagnostics:\n${diagnostics}` : '';
      })()}`,
      buttons: ['Restart NUVRO AI', 'Quit'],
      defaultId: 0,
      noLink: true,
    });
    if (choice === 0) {
      restartServerAndReload();
    } else {
      appIsQuitting = true;
      app.quit();
    }
  });

  return child;
}

async function restartServerAndReload(): Promise<void> {
  log('restarting server and reloading window...');
  serverStartupFailed = null;
  serverProcess = startServerProcess();
  const ready = await waitForServer();
  if (ready && mainWindow) {
    serverRestartAttempts = 0;
    lastServerErrors = [];
    mainWindow.loadURL(APP_URL);
  } else {
    showErrorAndQuit(
      'NUVRO AI could not restart its local server.',
      serverStartupFailed || 'The server did not become ready in time.'
    );
  }
}

/** Poll /api/health until the server responds or the child dies. */
async function waitForServer(): Promise<boolean> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (serverStartupFailed) return false;
    const health = await fetchJson(`${APP_URL}/api/health`, 1000);
    if (health && health.status === 'ok') return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

function stopServerProcess(): void {
  if (serverProcess && ownsServerProcess) {
    log('stopping NUVRO AI server...');
    try {
      const child = serverProcess;
      // Detach exit handling so quit is not interrupted.
      serverProcess = null;
      ownsServerProcess = false;
      child.removeAllListeners('exit');
      child.kill();
    } catch (err) {
      log('error stopping server:', err);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

function showErrorAndQuit(title: string, detail: string): void {
  log(`FATAL: ${title} ${detail}`);
  appIsQuitting = true;
  // A native dialog is visible to anyone looking at the screen: never show a
  // raw stack trace, absolute path or credential there.
  dialog.showErrorBox(title, sanitizeServerDiagnostic(detail, 600) || 'No further details are available.');
  stopServerProcess();
  app.quit();
}

/* ------------------------------------------------------------------ */
/* Permissions                                                         */
/* ------------------------------------------------------------------ */

/**
 * Deny every device permission by default. NUVRO AI never asks for the
 * camera, the microphone, geolocation or notifications, so a page that tries
 * to is refused instead of being prompted for.
 */
function installPermissionGuards(): void {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(ALLOWED_PERMISSIONS.has(permission));
  });
  ses.setPermissionCheckHandler((_webContents, permission) => ALLOWED_PERMISSIONS.has(permission));
}

/* ------------------------------------------------------------------ */
/* IPC sender validation                                               */
/* ------------------------------------------------------------------ */

/**
 * Reject IPC messages that did not come from the local NUVRO AI page.
 * Without this check any renderer that ends up in the window could open the
 * native folder picker or drive the window controls.
 */
function assertTrustedIpcSender(event: IpcMainInvokeEvent): void {
  const senderUrl = typeof event?.sender?.getURL === 'function' ? event.sender.getURL() : null;
  const frameUrl = event?.senderFrame?.url ?? null;
  if (!isTrustedIpcSender({ senderUrl, frameUrl }, TRUSTED_ORIGINS)) {
    throw new Error('NUVRO AI rejected an IPC request from an untrusted sender.');
  }
}

/* ------------------------------------------------------------------ */
/* Window                                                              */
/* ------------------------------------------------------------------ */

function appIconPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'icon.png')
    : path.join(app.getAppPath(), 'build', 'icon.png');
}

/* ------------------------------------------------------------------ */
/* Native dialogs (folder picker)                                      */
/* ------------------------------------------------------------------ */

/**
 * Native "Open Project Folder" picker. Returns the chosen absolute path or
 * null when cancelled. The renderer then sets it as the active workspace
 * through the local server API — the main process never touches the
 * workspace itself.
 */
ipcMain.handle('dialog:select-folder', async (event: IpcMainInvokeEvent): Promise<string | null> => {
  assertTrustedIpcSender(event);
  const win = BrowserWindow.getFocusedWindow() || mainWindow;
  if (!win) return null;
  const result = await dialog.showOpenDialog(win, {
    title: 'Open Project Folder',
    message: 'Choose the project folder NUVRO AI should work in',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

// Small, explicit window-control bridge for the renderer title controls.
ipcMain.handle('window:minimize', (event: IpcMainInvokeEvent) => {
  assertTrustedIpcSender(event);
  mainWindow?.minimize();
  return true;
});
ipcMain.handle('window:toggle-maximize', (event: IpcMainInvokeEvent) => {
  assertTrustedIpcSender(event);
  if (!mainWindow) return false;
  if (mainWindow.isMaximized()) mainWindow.unmaximize(); else mainWindow.maximize();
  return mainWindow.isMaximized();
});
ipcMain.handle('window:is-maximized', (event: IpcMainInvokeEvent) => {
  assertTrustedIpcSender(event);
  return Boolean(mainWindow?.isMaximized());
});

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'NUVRO AI — Local AI Coding Agent',
    backgroundColor: '#0b0e14',
    icon: appIconPath(),
    show: false, // shown on ready-to-show to avoid a white flash
    autoHideMenuBar: true,
    webPreferences: {
      // Hardened renderer: no Node, no remote, isolated context.
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      sandbox: true,
      webSecurity: true,
      // Desktop-only bridge for native folder dialogs.
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    // NUVRO AI starts minimized by default so a background coding workspace
    // does not interrupt the user's current work. The title control can
    // restore and maximize it whenever needed.
    mainWindow?.minimize();
    log('window shown minimized');
  });

  mainWindow.webContents.on('did-finish-load', () => {
    log('NUVRO AI UI loaded');
  });

  // Keep the app local: block in-window navigation away from the local server.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isLocalAppUrl(url)) {
      event.preventDefault();
      log('blocked navigation to', url);
    }
  });

  // New windows are never allowed; external http(s) links open in the
  // system browser instead of hijacking the NUVRO AI window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!isLocalAppUrl(url) && /^https?:\/\//i.test(url)) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // The renderer never needs a <webview>: refuse to attach one so a hostile
  // page cannot spawn an unsandboxed child view.
  mainWindow.webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
    log('blocked a webview attachment');
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.loadURL(APP_URL);
}

/* ------------------------------------------------------------------ */
/* App lifecycle                                                       */
/* ------------------------------------------------------------------ */

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  // Another NUVRO AI desktop instance is already running.
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    try {
      log('starting NUVRO AI desktop...');

      // A configured PORT that the server would reject must not start a
      // half-working desktop app: fail with an actionable message instead.
      if (PORT_CONFIG_ERROR) {
        showErrorAndQuit(
          'NUVRO AI cannot start: invalid PORT.',
          `${PORT_CONFIG_ERROR}\n\nFix the PORT value in the NUVRO AI .env file (or your environment) and start NUVRO AI again.`,
        );
        return;
      }

      installPermissionGuards();

      if (await isQuillixRunning()) {
        log(`found an existing NUVRO AI server on ${APP_URL} — reusing it`);
      } else if (await isPortOccupied()) {
        showErrorAndQuit(
          `NUVRO AI cannot start: port ${PORT} is already in use.`,
          `Another application (not NUVRO AI) is listening on ${HOST}:${PORT}.\n\nClose that application and start NUVRO AI again, or change PORT in the NUVRO AI .env file.`
        );
        return;
      } else {
        log(`starting local NUVRO AI server (${APP_URL})...`);
        serverProcess = startServerProcess();
        const ready = await waitForServer();
        if (!ready) {
          const nowRunning = await isQuillixRunning();
          if (nowRunning) {
            log('another NUVRO AI instance won the port race — reusing its server');
          } else {
            showErrorAndQuit(
              'NUVRO AI could not start its local server.',
              serverStartupFailed ||
                `The server did not respond on ${APP_URL} within ${READY_TIMEOUT_MS / 1000} seconds.\n\nCheck the console output for details.`
            );
            return;
          }
        } else {
          log('server ready');
        }
      }

      createWindow();

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
      });
    } catch (err: any) {
      showErrorAndQuit('NUVRO AI failed to start.', err?.message || String(err));
    }
  });

  app.on('window-all-closed', () => {
    app.quit();
  });

  app.on('before-quit', () => {
    appIsQuitting = true;
    stopServerProcess();
  });

  // Raw signals (Ctrl+C in a terminal, `kill`) do not run Electron's normal
  // quit sequence on every platform — stop the server explicitly here too.
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      appIsQuitting = true;
      stopServerProcess();
      app.quit();
    });
  }
}
