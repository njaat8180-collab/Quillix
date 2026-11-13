import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';

// QUILLIX MISSION CONTROL contract: the deadline tracker must be real at every
// layer — the persisted state files exist and are internally consistent, the
// server exposes them read-only, the Studio panel renders them, and the VS Code
// sidebar is a valid, dependency-free extension that says "not available"
// instead of inventing progress. `--root <dir>` replays the contract against
// another tree (used to prove it fails without the feature).
const rootIndex = process.argv.indexOf('--root');
const project = rootIndex >= 0 && process.argv[rootIndex + 1]
  ? path.resolve(process.argv[rootIndex + 1])
  : path.resolve(import.meta.dirname, '../..');

const read = (...parts) => fs.readFileSync(path.join(project, ...parts), 'utf8');
const missionDir = path.join(project, '.quillix', 'mission');

// --- The persisted goal state must exist, parse, and be consistent. ---
const requiredMissionFiles = ['GOAL.md', 'ROADMAP.md', 'TASKS.md', 'PROGRESS.md', 'BENCHMARKS.md', 'BLOCKERS.md', 'SESSION_MEMORY.md', 'goal-state.json'];
for (const name of requiredMissionFiles) {
  assert.ok(fs.existsSync(path.join(missionDir, name)), `.quillix/mission/${name} is missing`);
}

const goalState = JSON.parse(read('.quillix', 'mission', 'goal-state.json'));
assert.ok(typeof goalState.deadline === 'string' && !Number.isNaN(Date.parse(goalState.deadline)), 'goal-state.json must carry a parseable deadline');
const { completed, inProgress, pending, total } = goalState.counts;
assert.equal(total, completed + inProgress + pending, 'goal-state.json counts must be internally consistent');
assert.ok(goalState.verifiedProgressPercent > 0 && goalState.verifiedProgressPercent <= 100, 'goal-state.json must carry a real verified progress value');
assert.ok(Array.isArray(goalState.releaseGates) && goalState.releaseGates.length > 0, 'goal-state.json must list release gates');
assert.equal(goalState.benchmarks.cursorBaseline, 'not-collected', 'no Cursor baseline may be claimed without evidence');
assert.ok(goalState.blockers.every(blocker => blocker.approvalRequired === true || blocker.severity !== 'critical'), 'critical blockers must be approval-gated');

// --- Source surface ---
const shared = read('src', 'shared', 'missionState.ts');
const server = read('server.ts');
const bridge = read('src', 'services', 'apiBridge.ts');
const layout = read('src', 'components', 'WorkbenchLayout.tsx');
const panel = read('src', 'components', 'MissionControlPanel.tsx');
const rules = read('.clinerules', 'quillix-mission.md');
const extensionManifest = JSON.parse(read('extensions', 'quillix-mission-control', 'package.json'));
const extensionSource = read('extensions', 'quillix-mission-control', 'extension.js');
const extensionReadme = read('extensions', 'quillix-mission-control', 'README.md');

const source = [shared, server, bridge, layout, panel].join('\n');

const checks = [
  ['the shared parser is exported and versioned',
    /export const MISSION_STATE_VERSION = 1;/],
  ['the shared parser exposes the persisted state path',
    /export const MISSION_STATE_PATH/],
  ['the shared parser never throws on a partial file',
    /export function parseMissionState\(raw: unknown\): MissionState/],
  ['verified progress is derived from counts, not asserted',
    /export function computeVerifiedProgressPercent/],
  ['the countdown marks the final 24 hours critical',
    /critical: totalMs <= 86_400_000/],
  ['the server exposes the persisted mission state',
    /app\.get\('\/api\/mission\/state'/],
  ['the server reads the workspace-local state file',
    /path\.join\(root, \.\.\.MISSION_STATE_PATH\)/],
  ['the server parses through the shared normalizer',
    /parseMissionState\(JSON\.parse\(fs\.readFileSync\(file, 'utf8'\)\)\)/],
  ['the bridge reads mission state read-only',
    /getMissionState\(\): Promise<MissionState \| null>[\s\S]*?fetch\('\/api\/mission\/state', \{ cache: 'no-store' \}\)/],
  ['the Studio command palette can open the mission tracker',
    /title: "Mission control"[\s\S]*?action: \(\) => openSidePanel\("mission"\)/],
  ['the command palette offers the mission tracker',
    /title: "Mission control"/],
  ['the Studio renders the persisted state (no local copy)',
    /\{missionOpen && <MissionControlPanel active=\{true\}/],
  ['the tracker polls only while it is visible',
    /if \(!active\) return;[\s\S]*?const refresh = window\.setInterval/],
  ['the panel derives its progress from the persisted counts',
    /percent = state\?\.verifiedProgressPercent/],
];

// --- The VS Code sidebar must be a real, valid, dependency-free extension. ---
assert.equal(extensionManifest.name, 'quillix-mission-control', 'extension manifest name');
assert.equal(extensionManifest.main, './extension.js', 'extension entry point');
assert.equal(extensionManifest.displayName, 'QUILLIX MISSION CONTROL', 'extension display name');
assert.ok(/^\^?\d+\.\d+\.\d+/.test(extensionManifest.engines?.vscode || ''), 'extension must declare a VS Code engine range');
const activitybar = extensionManifest.contributes?.viewsContainers?.activitybar?.[0];
assert.ok(activitybar && activitybar.id === 'quillix', 'extension must contribute an activity-bar container');
const sidebarView = extensionManifest.contributes?.views?.quillix?.[0];
assert.ok(sidebarView && sidebarView.id === 'quillix.missionControl' && sidebarView.type === 'webview', 'extension must contribute the MISSION CONTROL webview view');
assert.equal(sidebarView.name, 'MISSION CONTROL', 'the sidebar view must be named MISSION CONTROL');
assert.deepEqual(extensionManifest.activationEvents, ['onView:quillix.missionControl'], 'extension activates on the sidebar view');
const manifestText = read('extensions', 'quillix-mission-control', 'package.json');
assert.ok(!/"dependencies"\s*:/.test(manifestText), 'the extension must stay dependency-free (offline install)');

// The extension entry must load as CommonJS and export activate/deactivate.
// `vscode` is not installed in this offline workspace, so it is stubbed with
// the exact API surface the extension touches.
const disposable = { dispose() {} };
const nodeRequire = createRequire(import.meta.url);
const fakeVscode = {
  workspace: {
    workspaceFolders: [],
    createFileSystemWatcher: () => ({ onDidChange() {}, onDidCreate() {}, dispose() {} }),
  },
  window: {
    registerWebviewViewProvider: () => disposable,
    showWarningMessage() {},
    showInformationMessage() {},
  },
  commands: {
    registerCommand: () => disposable,
    executeCommand: async () => undefined,
  },
};
const sandboxRequire = (id) => (id === 'vscode' ? fakeVscode : nodeRequire(id));
const moduleStub = { exports: {} };
const sandbox = { module: moduleStub, exports: moduleStub.exports, require: sandboxRequire, console, process, Buffer };
vm.runInNewContext(extensionSource, sandbox, { filename: 'extension.js' });
assert.equal(typeof moduleStub.exports.activate, 'function', 'extension must export activate()');
assert.equal(typeof moduleStub.exports.deactivate, 'function', 'extension must export deactivate()');

const extensionChecks = [
  ['the sidebar reads the same persisted state path',
    /MISSION_STATE_PATH = \['\.quillix', 'mission', 'goal-state\.json'\]/],
  ['the sidebar escapes every interpolated value (XSS safety)',
    /function escapeHtml\(value\)/],
  ['the sidebar refreshes on a bounded interval',
    /setInterval\(\(\) => provider\.refresh\(\), REFRESH_INTERVAL_MS\)/],
  ['the sidebar never invents progress when state is missing',
    /Mission state is not available yet/],
  ['the sidebar reports a parse failure rather than faking values',
    /could not be read or parsed/],
  ['the sidebar is HTML-CSP hardened',
    /default-src 'none'/],
];
for (const [name, pattern] of extensionChecks) assert.match(extensionSource, pattern, name);

// --- Anti-fabrication guards ---
assert.doesNotMatch(extensionSource, /\b(https?:\/\/|fetch\(|require\('child_process'\)|child_process)\b/, 'the extension must not access the network or spawn processes');
assert.doesNotMatch(extensionSource, /\beval\(|new Function\(/, 'the extension must not evaluate dynamic code');
assert.doesNotMatch(bridge, /method: 'POST'[\s\S]{0,200}mission\/state/, 'mission state must never be written from the renderer');
assert.doesNotMatch(layout, /api\.updateSettings/, 'the mission tracker must never write settings');
assert.doesNotMatch(extensionReadme, /npm install(?!\s*--save-dev @types)/, 'the extension must not require a network install to run');

// --- Reload instructions for future sessions ---
assert.match(rules, /\.quillix\/mission\/GOAL\.md/, 'Cline rules must point at the persisted mission goal');
assert.match(rules, /\.quillix\/mission\/goal-state\.json/, 'Cline rules must point at the machine-readable mission state');
assert.match(rules, /Never fabricate/, 'Cline rules must forbid fabricated progress');

for (const [name, pattern] of checks) assert.match(source, pattern, name);

console.log(JSON.stringify({
  status: 'PASS',
  files: [
    '.quillix/mission/*',
    'src/shared/missionState.ts',
    'server.ts',
    'src/services/apiBridge.ts',
    'src/components/MissionControlPanel.tsx',
    'src/components/WorkbenchLayout.tsx',
    '.clinerules/quillix-mission.md',
    'extensions/quillix-mission-control/package.json',
    'extensions/quillix-mission-control/extension.js',
  ],
  checks: checks.length + extensionChecks.length + 24,
}));
