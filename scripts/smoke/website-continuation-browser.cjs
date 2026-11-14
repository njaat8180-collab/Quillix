// Inspect an actual benchmark output in an isolated Chromium renderer.
const {app, BrowserWindow, session} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = fs.realpathSync(process.argv[2]);
app.setPath('userData', path.join(path.dirname(root), 'browser-profile'));
app.disableHardwareAcceleration();
const timeout = setTimeout(() => { console.error('Browser verification timed out'); app.exit(1); }, 15000);
const origin = 'https://quillix-benchmark.invalid';
const files = new Map();
for (const [file, mime] of [['index.html', 'text/html'], ['style.css', 'text/css'], ['script.js', 'text/javascript']]) {
  const absolute = fs.realpathSync(path.join(root, file));
  assert.equal(path.dirname(absolute), root, 'Fixture source must reside inside the selected project');
  files.set('/' + file, {body: fs.readFileSync(absolute), mime});
}
async function verify() {
  const partition = session.fromPartition('website-continuation');
  partition.setPermissionRequestHandler((_web, _permission, callback) => callback(false));
  partition.setPermissionCheckHandler(() => false);
  partition.webRequest.onBeforeRequest((request, callback) => {
    callback({cancel: !request.url.startsWith(origin + '/')});
  });
  partition.protocol.handle('https', request => {
    const url = new URL(request.url);
    const asset = url.origin === origin && files.get(url.pathname);
    return asset ? new Response(asset.body, {headers: {'Content-Type': asset.mime,
      'Content-Security-Policy': "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'"}})
      : new Response(null, {status: 404});
  });
  const win = new BrowserWindow({show: false, width: 390, height: 760,
    webPreferences: {session: partition, sandbox: true, contextIsolation: true, nodeIntegration: false}});
  win.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
  win.webContents.on('will-navigate', event => event.preventDefault());
  const errors = [];
  win.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
  try {
    await win.loadURL(origin + '/index.html');
    const state = await win.webContents.executeJavaScript(`(() => {
      const button = document.querySelector('#theme-toggle');
      const card = document.querySelector('.card');
      if (!button || !card) throw new Error('Theme control or card is missing');
      const initial = document.body.className;
      button.click();
      const toggled = document.body.className;
      button.click();
      return {initial, toggled, restored: document.body.className, stylesheetLoaded: [...document.styleSheets].some(sheet => sheet.href?.endsWith('/style.css') && sheet.cssRules.length),
        viewport: document.documentElement.clientWidth, width: document.documentElement.scrollWidth,
        animation: getComputedStyle(card).animationName};
    })()`);
    assert.equal(state.stylesheetLoaded, true, 'index.html must load style.css');
    assert.notEqual(state.initial, state.toggled, 'script.js must change the body theme on click');
    assert.equal(state.initial, state.restored, 'script.js must restore the theme on a second click');
    assert.ok(state.width <= state.viewport + 1, 'style.css mobile layout overflows');
    assert.notEqual(state.animation, 'none', 'style.css must apply its keyframe animation to .card');
    assert.deepEqual(errors, [], 'script.js browser console errors: ' + errors.join(' | '));
    console.log(JSON.stringify({status: 'PASS', ...state, consoleErrors: errors.length}));
  } finally { win.destroy(); }
}
app.whenReady().then(verify).then(() => {clearTimeout(timeout); app.exit(0);}, error => {clearTimeout(timeout); console.error(String(error)); app.exit(1);});
