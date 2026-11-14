// QUILLIX P4.6 — security hardening contract (secrets, IPC, file scope).
//
// This is the security review the mission asked for. It has two halves:
//
//   1. Source surface — the renderer stays sandboxed, the IPC surface stays
//      tiny, and the desktop shutdown stays bounded.
//   2. Runtime behaviour — the REAL modules are exercised with REAL attack
//      payloads: traversal attempts against the workspace guard, real
//      credential shapes against the redaction helpers, and the two IPC files
//      are cross-checked against each other.
//
// The runtime half is the point. A source scan can prove that a regex exists;
// only a runtime assertion proves that the regex actually catches a key.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const project = path.resolve(import.meta.dirname, '../..');
const read = (...parts) => fs.readFileSync(path.join(project, ...parts), 'utf8');

const electronMain = read('electron', 'main.ts');
const electronPreload = read('electron', 'preload.ts');
const desktopShutdown = read('electron', 'desktopShutdown.ts');
const workspaceSource = read('src', 'server', 'workspace.ts');
const redactionSource = read('src', 'shared', 'secretRedaction.ts');
const serverSource = read('server.ts');

// --- A. Renderer / IPC surface ----------------------------------------------

const sourceChecks = [
  ['the renderer runs with context isolation enabled', /contextIsolation:\s*true/],
  ['the renderer has no Node integration', /nodeIntegration:\s*false/],
  ['workers have no Node integration', /nodeIntegrationInWorker:\s*false/],
  ['the renderer runs in a sandbox', /sandbox:\s*true/],
  ['web security is not disabled', /webSecurity:\s*true/],
  ['the preload bridge is the only privileged path', /contextBridge\.exposeInMainWorld\(/],
  ['the preload bridge exposes a fixed, named surface', /isDesktop:\s*true/],
  ['the shutdown escalates instead of waiting forever', /SIGKILL/],
  ['the shutdown reports a timeout to its caller', /timedOut/],
  ['the quit is deferred until the bounded shutdown finished', /event\.preventDefault\(\)/],
  ['a failed shutdown force-exits instead of hanging the UI', /app\.exit\(0\)/],
  ['the workspace guard refuses paths outside the root', /path is outside the active workspace/],
  ['the workspace guard resolves symlinks before trusting a path', /realpathSync/],
  ['credentials are redacted before content reaches a provider', /export function redactSensitiveText\(/],
];

for (const [label, pattern] of sourceChecks) {
  const haystack = [electronMain, electronPreload, desktopShutdown, workspaceSource, redactionSource].join('\n');
  assert.ok(pattern.test(haystack), `P4.6 security contract: ${label}`);
}

// The IPC surface is cross-checked across two files: every channel the preload
// invokes must be handled in main, and main must not handle channels the
// preload never uses. A typo in either file is a real bug that a one-file
// scan cannot see.
const handled = [...electronMain.matchAll(/ipcMain\.handle\(\s*'([^']+)'/g)].map(m => m[1]).sort();
const invoked = [...electronPreload.matchAll(/ipcRenderer\.invoke\(\s*'([^']+)'/g)].map(m => m[1]).sort();
assert.deepEqual(invoked, handled,
  `P4.6 security contract: the preload invokes channels that main does not handle (or vice versa). invoked=${JSON.stringify(invoked)} handled=${JSON.stringify(handled)}`);

// The IPC surface must stay tiny and must never carry a shell command.
assert.ok(handled.length <= 8,
  `P4.6 security contract: the IPC surface grew to ${handled.length} channels; it must stay a short allow-list`);
for (const channel of handled) {
  assert.ok(/^(dialog|window):[a-z-]+$/.test(channel),
    `P4.6 security contract: the IPC channel "${channel}" is outside the dialog:/window: allow-list`);
}
// --- B. Secrets: runtime redaction ------------------------------------------

const redactionUrl = pathToFileURL(path.join(project, 'src', 'shared', 'secretRedaction.ts')).href;
const { redactSensitiveText, redactSensitiveTextForRoundTrip, restoreSensitiveValues } = await import(redactionUrl);

// Real credential shapes. Each of these MUST be gone from the redacted text.
const realCredentials = [
  ['OpenAI legacy key', 'sk-abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGH'],
  ['OpenAI project key', 'sk-proj-abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGH'],
  ['OpenAI service key', 'sk-svcacct-abcdefghijklmnopqrstuvwxyz0123456789'],
  ['Stripe key', 'sk_live_abcdefghijklmnop123456'],
  ['Google API key', 'AIzaSyA1234567890abcdefghijklmnopqrstuvw'],
  ['AWS access key', 'AKIAIOSFODNN7EXAMPLE'],
  ['GitHub token', 'ghp_abcdefghijklmnopqrstuvwxyz0123456789'],
  ['GitLab token', 'glpat-abcdefghijklmnopqrstuvu'],
  ['npm token', 'npm_abcdefghijklmnopqrstuvwxyz0123'],
  ['Slack token', 'xoxb-123456789012-123456789012-abcdefghijklmnopqrstuvwx'],
];

for (const [label, secret] of realCredentials) {
  const redacted = redactSensitiveText(`const value = "${secret}";`);
  assert.ok(!redacted.includes(secret),
    `P4.6 security contract: the ${label} survived redaction: ${redacted}`);
  assert.ok(redacted.includes('[REDACTED'),
    `P4.6 security contract: the ${label} was not marked as redacted: ${redacted}`);
}

// A private key block and a bearer header must not survive either.
const privateKey = '-----BEGIN RSA PRIVATE KEY-----\nMIIEow\nsecret\n-----END RSA PRIVATE KEY-----';
assert.ok(!redactSensitiveText(privateKey).includes('MIIEow'),
  'P4.6 security contract: private key material survived redaction');
assert.ok(!redactSensitiveText('Authorization: Bearer abc123DEF456ghi789').includes('abc123DEF456ghi789'),
  'P4.6 security contract: a bearer token survived redaction');

// The round-trip helper must never put the original value into the text that
// is sent to the model, and must restore it only for a local write.
const roundTrip = redactSensitiveTextForRoundTrip(`const apiKey = "${realCredentials[0][1]}";`);
assert.ok(!roundTrip.content.includes(realCredentials[0][1]),
  'P4.6 security contract: the round-trip redaction leaked the original credential');
assert.ok(roundTrip.content.includes('__QUILLIX_SECRET_'),
  'P4.6 security contract: the round-trip redaction did not leave an opaque handle');
const restored = restoreSensitiveValues(roundTrip.content, roundTrip.values);
assert.ok(restored.content.includes(realCredentials[0][1]),
  'P4.6 security contract: the round-trip restore did not put the credential back');
assert.deepEqual(restored.missing, [], 'P4.6 security contract: the round-trip restore reported missing values');

// --- C. File scope: runtime traversal attempts --------------------------------

const workspaceUrl = pathToFileURL(path.join(project, 'src', 'server', 'workspace.ts')).href;
const { WorkspaceManager } = await import(workspaceUrl);

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-security-'));
const workspace = new WorkspaceManager(root);
fs.writeFileSync(path.join(root, 'inside.ts'), 'export const inside = true;\n');
fs.mkdirSync(path.join(root, 'sub'), { recursive: true });
fs.writeFileSync(path.join(root, 'sub', 'nested.ts'), 'export const nested = true;\n');

// Real traversal payloads. Every one of them must be refused.
const traversalPayloads = [
  ['parent traversal', '../outside.txt'],
  ['deep parent traversal', '../../../../Windows/System32/drivers/etc/hosts'],
  ['backslash traversal', '..\\outside.txt'],
  ['mixed traversal', 'sub/../../outside.txt'],
  ['absolute outside path', 'C:\\Windows\\System32\\drivers\\etc\\hosts'],
  ['posix absolute path', '/etc/passwd'],
  ['unc path', '\\\\server\\share\\payload.txt'],
  ['windows device path', '\\\\?\\C:\\Windows\\System32\\drivers\\etc\\hosts'],
  ['null byte injection', 'inside.ts\u0000.txt'],
];

for (const [label, payload] of traversalPayloads) {
  const result = workspace.resolveSafePath(payload);
  assert.equal(result.safe, false, `P4.6 security contract: the ${label} was allowed: ${payload}`);
  assert.ok(result.error, `P4.6 security contract: the ${label} was refused without an explanation`);
}

// Legitimate paths must still work — a guard that blocks everything is not a
// guard, it is an outage.
for (const good of ['inside.ts', 'sub/nested.ts', './inside.ts', 'sub/../inside.ts']) {
  const result = workspace.resolveSafePath(good);
  assert.equal(result.safe, true, `P4.6 security contract: a legitimate path was blocked: ${good} (${result.error})`);
}

// A symlink that points outside the workspace must be refused too.
let symlinkCreated = false;
try {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-outside-'));
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'top secret');
  fs.symlinkSync(outside, path.join(root, 'escape'), 'junction');
  symlinkCreated = true;
} catch { /* creating a junction can require privileges on some Windows setups */ }
const escaped = workspace.resolveSafePath('escape/secret.txt');
assert.equal(escaped.safe, false,
  'P4.6 security contract: a symlink pointing outside the workspace was allowed');
fs.rmSync(root, { recursive: true, force: true });

// The server must never hand a raw provider key to the renderer.
assert.ok(!/res\.json\(\{[^}]*apiKey\s*:/s.test(serverSource),
  'P4.6 security contract: a route returns a raw apiKey to the renderer');

console.log(JSON.stringify({
  status: 'PASS',
  sourceChecks: sourceChecks.length,
  ipcChannels: handled.length,
  credentialsTested: realCredentials.length,
  traversalPayloadsTested: traversalPayloads.length,
  symlinkEscapeChecked: symlinkCreated,
}));
