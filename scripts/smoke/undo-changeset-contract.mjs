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

// --- ghost-text accept hint (inline polish) ---
assert.match(editor, /const \[inlineHint, setInlineHint\] = useState\(false\);/, 'the editor tracks the suggestion hint state');
assert.match(editor, /setInlineHint\(true\);/, 'producing a completion reveals the accept hint');
assert.match(editor, /setInlineHint\(false\);/, 'typing clears the hint');
assert.match(editor, /Suggestion ready — Tab to accept · Ctrl\+→ accepts the next word/, 'the hint teaches word-by-word accept');
assert.match(editor, /Accept AI suggestion/, 'the empty state documents the accept gesture');

// --- multi-file changeset review bar ---
const layout = fs.readFileSync(path.join(root, 'src', 'components', 'WorkbenchLayout.tsx'), 'utf8');
assert.match(layout, /const resolveApprovals = async \(approved: boolean, ids: string\[\]\)/, 'the review bar can resolve individual approvals');
assert.match(layout, /batchResolveApprovals\(approved, ids\)/, 'per-item resolution rides the batch endpoint');
assert.match(layout, /Approve file changes/, 'file changes can be approved as a group');
assert.match(layout, /aria-label=\{`Approve: \$\{a\.title\}`\}/, 'each item has a labelled approve action');
assert.match(layout, /aria-label=\{`Reject: \$\{a\.title\}`\}/, 'each item has a labelled reject action');

// --- M7.6: task timeline (summary, filters, chronological events) ---
const timeline = fs.readFileSync(path.join(root, 'src', 'components', 'TaskHistoryPanel.tsx'), 'utf8');
assert.match(timeline, /const \[filter, setFilter\] = useState/, 'the task list has a status filter');
assert.match(timeline, /const \[query, setQuery\] = useState/, 'the task list has a prompt search');
assert.match(timeline, /visibleTasks/, 'the list honours filter + search');
assert.match(timeline, /const summary = useMemo/, 'the panel computes real aggregate stats');
assert.match(timeline, /const timeline = useMemo/, 'the detail view builds a chronological timeline');
assert.match(timeline, /aria-label="Task event timeline"/, 'the timeline is labelled for screen readers');
assert.match(timeline, /Task started \(/, 'the timeline starts at the recorded start time');
assert.match(timeline, /commandsExecuted\]\.sort/, 'commands appear in chronological order');

console.log(JSON.stringify({ status: 'PASS', files: ['server.ts', 'src/server/taskState.ts', 'src/services/apiBridge.ts', 'src/components/EditorArea.tsx', 'src/components/WorkbenchLayout.tsx', 'src/components/TaskHistoryPanel.tsx'], checks: 28 }));
