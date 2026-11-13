import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// M4.4 named-checkpoints contract: restore points are bounded, secret-free,
// conflict-aware, and always behind the Agent-mode guard. Fails without it.
const root = process.cwd();
const server = fs.readFileSync(path.join(root, 'server.ts'), 'utf8');
const store = fs.readFileSync(path.join(root, 'src', 'server', 'checkpoints.ts'), 'utf8');
const bridge = fs.readFileSync(path.join(root, 'src', 'services', 'apiBridge.ts'), 'utf8');
const panel = fs.readFileSync(path.join(root, 'src', 'components', 'CheckpointsPanel.tsx'), 'utf8');
const view = fs.readFileSync(path.join(root, 'src', 'components', 'WorkspaceView.tsx'), 'utf8');

// --- store safety ---
assert.match(store, /export function isCheckpointSkippablePath\(/, 'store exports the skip rule');
assert.match(store, /export function sanitizeCheckpointName\(/, 'store exports name sanitization');
assert.match(store, /base\.startsWith\('\.env'\)/, 'secret paths are never snapshotted');
assert.match(store, /maxTotalBytes: 64 \* 1024 \* 1024/, 'total snapshot size is bounded');
assert.match(store, /maxFiles: 2000,/, 'file count is bounded');
assert.match(store, /content\.indexOf\('\\u0000'\) !== -1/, 'binary files are skipped');
assert.match(store, /relative\.startsWith\('\.\.'\) \|\| path\.isAbsolute\(relative\)/, 'restore refuses paths outside the workspace');
assert.match(store, /createTwoFilesPatch\(/, 'diffs come from the bundled diff library');

// --- server surface ---
assert.match(server, /const checkpointStore = new CheckpointStore\(workspaceManager\);/, 'server instantiates the store');
for (const route of ['/api/checkpoints', '/api/checkpoints/:id', '/api/checkpoints/:id/diff', '/api/checkpoints/:id/restore']) {
  assert.ok(server.includes(route), `endpoint present: ${route}`);
}
assert.match(server, /app\.post\('\/api\/checkpoints', requireAgentMode/, 'creating a checkpoint requires Agent mode');
assert.match(server, /app\.post\('\/api\/checkpoints\/:id\/restore', requireAgentMode/, 'restoring requires Agent mode');
assert.match(server, /app\.delete\('\/api\/checkpoints\/:id', requireAgentMode/, 'removing requires Agent mode');
assert.match(server, /agentBusy\) return res\.status\(409\)/, 'mutations wait for an active task');

// --- renderer ---
assert.match(bridge, /public async listCheckpoints\(\)/, 'apiBridge lists checkpoints');
assert.match(bridge, /public async createCheckpoint\(/, 'apiBridge creates checkpoints');
assert.match(bridge, /public async restoreCheckpoint\(/, 'apiBridge restores checkpoints');
assert.match(bridge, /public async removeCheckpoint\(/, 'apiBridge removes checkpoints');
assert.match(bridge, /public async getCheckpointDiff\(/, 'apiBridge fetches diffs');
assert.match(view, /CheckpointsPanel/, 'the workspace renders the checkpoints panel');
assert.match(view, /id: 'checkpoints'/, 'a sidebar tab opens the panel');
assert.match(panel, /aria-label=\{`Restore checkpoint \$\{checkpoint\.name\}`\}/, 'restore is labelled for screen readers');
assert.match(panel, /aria-label=\{`Delete checkpoint \$\{checkpoint\.name\}`\}/, 'delete is labelled for screen readers');
assert.match(panel, /Secrets are never captured/, 'the panel discloses the safety guarantee');
assert.match(panel, /disabled=\{readOnly/, 'actions are disabled in Chat mode');

console.log(JSON.stringify({ status: 'PASS', files: ['src/server/checkpoints.ts', 'server.ts', 'src/components/CheckpointsPanel.tsx', 'src/components/WorkspaceView.tsx', 'src/services/apiBridge.ts'], checks: 25 }));
