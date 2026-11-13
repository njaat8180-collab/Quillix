import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// M2.3 contract: batch approve/reject for a multi-file changeset. The decision
// logic must be pure and unit-tested, the queue must never be double-resolved,
// and the HTTP surface must support listing plus batch resolution (including a
// selected subset). `--root <dir>` replays the contract against another tree.
const rootIndex = process.argv.indexOf('--root');
const project = rootIndex >= 0 && process.argv[rootIndex + 1]
  ? path.resolve(process.argv[rootIndex + 1])
  : path.resolve(import.meta.dirname, '../..');

const read = (...parts) => fs.readFileSync(path.join(project, ...parts), 'utf8');
const batch = read('src', 'server', 'approvalBatch.ts');
const server = read('server.ts');
const bridge = read('src', 'services', 'apiBridge.ts');
const tests = read('src', 'server', '__tests__', 'approvalBatch.test.ts');
const layout = read('src', 'components', 'WorkbenchLayout.tsx');
const source = [batch, server, bridge, layout].join('\n');

const checks = [
  ['the decision logic is a pure, dependency-free module', /export function resolveApprovalBatch</],
  ['queued approvals can be listed without mutating the queue', /export function listPendingApprovals</],
  ['a batch resolves each queued entry exactly once', /pending\.delete\(id\);\s*\n\s*if \(entry\)/],
  ['a late resolver failure cannot break the batch', /try \{ entry\.resolve\(approved\); \} catch \{/],
  ['unknown selected ids are reported honestly', /if \(selected\) for \(const id of selected\) if \(!known\.has\(id\)\) unresolved\.push\(id\);/],
  ['the server exposes the pending approval list', /app\.get\('\/api\/agent\/approvals'/],
  ['the server exposes batch resolution', /app\.post\('\/api\/agent\/approvals\/batch'/],
  ['the batch route honours a subset selection', /const selection = Array\.isArray\(ids\)/],
  ['the single-approval route is unchanged (backwards compatible)', /app\.post\('\/api\/agent\/approve', requireAgentMode/],
  ['the renderer can list pending approvals', /listPendingApprovals\(\): Promise<Array</],
  ['the renderer can batch approve/reject', /batchResolveApprovals\(approved: boolean, ids\?: string\[\]\)/],
  ['the bridge reads the pending list from the approval route', /listPendingApprovals\(\)[\s\S]*?fetch\('\/api\/agent\/approvals'/],
  ['the bridge posts batch decisions to the batch route', /batchResolveApprovals[\s\S]*?fetch\('\/api\/agent\/approvals\/batch'/],
  // --- The Studio review surface that uses it (M2.3 UI, Cline-owned) ---
  ['the Studio lists queued approvals while a run is in flight', /api\.listPendingApprovals\(\)/],
  ['the Studio polls on a bounded interval', /const timer = window\.setInterval\(\(\) => \{ void poll\(\); \}, 2000\);/],
  ['the Studio stops polling when nothing is running', /if \(!props\.working\) \{[\s\S]*?setPendingApprovals\(current => \(current\.length \? \[\] : current\)\);/],
  ['the Studio offers batch resolution', /batchResolveApprovals\(approved\)/],
  ['the Studio exposes labelled batch actions', /aria-label=\{`Approve all \$\{pendingApprovals\.length\} pending approvals`\}/],
];

for (const [name, pattern] of checks) assert.match(source, pattern, name);

const testChecks = [
  ['approving all empties the queue in one decision', /expect\(pending\.size\)\.toBe\(0\);/],
  ['rejecting all is supported', /resolveApprovalBatch\(pending, false\);/],
  ['a subset leaves the rest queued and reports unknowns', /expect\(result\.unresolved\)\.toEqual\(\['ghost'\]\);/],
  ['a request is never resolved twice', /expect\(decisions\)\.toHaveLength\(1\);/],
];
for (const [name, pattern] of testChecks) assert.match(tests, pattern, name);

assert.doesNotMatch(batch, /new Map|globalThis|process\./, 'the batch decision module must stay pure and side-effect free');
// The review bar must never decide for the user.
assert.doesNotMatch(layout, /batchResolveApprovals\(true\)\s*;?\s*\n\s*\}, \[/, 'batch resolution must require a user action');
assert.match(layout, /aria-label="Pending approvals"/, 'the review bar must be identifiable to assistive technology');
console.log(JSON.stringify({
  status: 'PASS',
  files: ['src/server/approvalBatch.ts', 'src/server/__tests__/approvalBatch.test.ts', 'server.ts', 'src/services/apiBridge.ts', 'src/components/WorkbenchLayout.tsx'],
  checks: checks.length + testChecks.length,
}));