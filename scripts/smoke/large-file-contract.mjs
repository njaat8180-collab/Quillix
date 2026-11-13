import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// M9.5 large-file contract: reads and writes share one hard ceiling, the
// advisory threshold is lower, and the editor warns instead of janking quietly.
const root = process.cwd();
const shared = fs.readFileSync(path.join(root, 'src', 'shared', 'largeFile.ts'), 'utf8');
const workspace = fs.readFileSync(path.join(root, 'src', 'server', 'workspace.ts'), 'utf8');
const editor = fs.readFileSync(path.join(root, 'src', 'components', 'EditorArea.tsx'), 'utf8');

assert.match(shared, /export const LARGE_FILE_BYTES = 1_000_000;/, 'advisory threshold is 1 MB');
assert.match(shared, /export const MAX_FILE_BYTES = 8 \* 1024 \* 1024;/, 'hard ceiling is 8 MiB');
assert.match(shared, /export function fileSizeLimitError\(/, 'refusal message is shared');

assert.match(workspace, /import \{ MAX_FILE_BYTES, fileSizeLimitError \} from '\.\.\/shared\/largeFile\.js';/, 'workspace uses the shared limits');
assert.match(workspace, /stat\.size > MAX_FILE_BYTES/, 'reads enforce the ceiling');
assert.match(workspace, /Buffer\.byteLength\(content \|\| '', 'utf8'\) > MAX_FILE_BYTES/, 'writes enforce the ceiling before touching disk');
// The write guard must appear in both write paths.
const writeGuardCount = (workspace.match(/Buffer\.byteLength\(content \|\| '', 'utf8'\) > MAX_FILE_BYTES/g) || []).length;
assert.equal(writeGuardCount, 2, 'both writeFile and createFile enforce the ceiling');

assert.match(editor, /LARGE_FILE_BYTES/, 'the editor imports the advisory threshold');
assert.match(editor, /activeTab\.content\.length > LARGE_FILE_BYTES/, 'the editor warns on large files');
assert.match(editor, /largeFileAdvisory\(/, 'the warning explains the consequence');

console.log(JSON.stringify({ status: 'PASS', files: ['src/shared/largeFile.ts', 'src/server/workspace.ts', 'src/components/EditorArea.tsx'], checks: 10 }));
