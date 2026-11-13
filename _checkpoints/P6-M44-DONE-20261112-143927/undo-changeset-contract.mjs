import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// M2.4 undo-last-changeset contract: one action restores the newest agent
// changeset through the SAME conflict-safe path as the per-task rollback
// (manual edits are conflicts, never silent overwrites). Fails without it.
const root = process.cwd();
const server = fs.readFileSync(path.join(root, 'server.ts'), 'utf8');
const bridge = fs.readFileSync(path.join(root, 'src', 'services', 'apiBridge.ts'), 'utf8');
const editor = fs.readFileSync(path.join(root, 'src', 'components', 'EditorArea.tsx'), 'utf8');
const store = fs.readFileSync(path.join(root, 'src', 'server', 'taskState.ts'), 'utf8');

// --- server ---
assert.match(server, /app\.post\('\/api\/tasks\/undo-last-changeset', requireAgentMode/, 'undo endpoint exists and requires Agent mode');
assert.match(server, /taskStateStore\.rollbackTask\(latest\.id\)/, 'undo reuses the conflict-safe task rollback');
assert.match(server, /!task\.rollback\?\.restoredAt/, 'an already-restored changeset is not undone twice');
assert.match(server, /No agent changeset is available to undo/, 'the empty case fails honestly');
assert.match(server, /agentBusy\) return res\.status\(409\)/, 'undo waits for an active task');

// --- shared restore safety (unchanged guarantees) ---
assert.match(store, /unchanged = entry\.existsAfter \? exists && currentHash === entry\.afterHash : !exists;/, 'restore only happens when the file still matches the task output');
assert.match(store, /conflicts\.push\(entry\.filePath\)/, 'changed files are reported as conflicts');

// --- renderer ---
assert.match(bridge, /public async undoLastChangeset\(\)/, 'apiBridge exposes the undo action');
assert.match(editor, /api\.undoLastChangeset\(\)/, 'the editor calls the undo action');
assert.match(editor, /aria-label="Undo the last agent changeset"/, 'the undo control is labelled for screen readers');
assert.match(editor, /disabled=\{readOnly \|\| undoBusy\}/, 'the undo control is disabled in Chat mode and while running');
assert.match(editor, /role="status"/, 'the undo outcome is announced honestly (restored / conflicts)');

console.log(JSON.stringify({ status: 'PASS', files: ['server.ts', 'src/server/taskState.ts', 'src/services/apiBridge.ts', 'src/components/EditorArea.tsx'], checks: 12 }));
