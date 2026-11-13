#!/usr/bin/env node
/**
 * Quillix desktop launcher — `npm start`.
 *
 * 1. Makes sure a production build exists (dist/index.html, dist/server.cjs,
 *    dist/electron/main.cjs); builds it automatically on first run.
 * 2. Launches the Electron desktop app, which starts (or reuses) the local
 *    Quillix server and opens the native Quillix window.
 *
 * No other command is needed for normal use:
 *   npm install
 *   npm start
 */
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const DIST = path.join(root, 'dist');
const REQUIRED_ARTIFACTS = [
  path.join(DIST, 'index.html'),
  path.join(DIST, 'server.cjs'),
  path.join(DIST, 'electron', 'main.cjs'),
  path.join(DIST, 'electron', 'preload.cjs'),
];

function log(...args) {
  console.log('[quillix]', ...args);
}

function run(command, args, opts = {}) {
  const res = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32', ...opts });
  if (res.status !== 0) {
    console.error(`[quillix] Command failed: ${command} ${args.join(' ')}`);
    process.exit(res.status ?? 1);
  }
}

// --- 1. Ensure the production build exists ---------------------------------
const needsBuild = REQUIRED_ARTIFACTS.some((p) => !existsSync(p));
if (needsBuild) {
  log('production build not found — building Quillix first (one-time)...');
  run('npm', ['run', 'build']);
}

// --- 2. Resolve the Electron binary -----------------------------------------
let electronBin;
try {
  electronBin = require('electron');
} catch (err) {
  console.error(
    '[quillix] Electron is not installed. Run "npm install" first.\n' +
      `Details: ${err && err.message}`
  );
  process.exit(1);
}
if (typeof electronBin !== 'string') {
  // Running inside Electron somehow — fall back to the CLI shim.
  electronBin = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'electron.cmd' : 'electron');
}

// --- 3. Launch the desktop app -----------------------------------------------
log('launching Quillix desktop...');
// Extra CLI args after `npm start -- --flag` are forwarded to Electron
// (useful for diagnostics, e.g. `npm start -- --enable-logging`).
const forwardArgs = process.argv.slice(2);
const launchEnv = { ...process.env, NODE_ENV: 'production' };
delete launchEnv.ELECTRON_RUN_AS_NODE;
const electron = spawn(electronBin, ['.', ...forwardArgs], {
  cwd: root,
  stdio: 'inherit',
  env: launchEnv,
});
electron.on('error', (error) => {
  console.error(`[quillix] Could not launch Electron: ${error.message}`);
  process.exitCode = 1;
});

// --- 4. Forward termination signals for a clean shutdown --------------------
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (!electron.killed) {
      try {
        electron.kill(signal);
      } catch {
        /* already gone */
      }
    }
  });
}
electron.on('exit', (code) => {
  // Exit with Electron's code so Ctrl+C and normal close propagate cleanly.
  process.exit(code ?? 0);
});
