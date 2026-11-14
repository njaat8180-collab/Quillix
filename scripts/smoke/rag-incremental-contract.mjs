import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// M1.5 contract: incremental project re-index. A save must drop that file's
// cached chunks (so the next retrieval re-reads exactly it), the shared index
// must survive a workspace switch, and the work done by a refresh must be
// observable so "incremental" is provable rather than asserted. `--root <dir>`
// replays the contract against another tree (used to prove it fails without the
// feature).
const rootIndex = process.argv.indexOf('--root');
const project = rootIndex >= 0 && process.argv[rootIndex + 1]
  ? path.resolve(process.argv[rootIndex + 1])
  : path.resolve(import.meta.dirname, '../..');

const read = (...parts) => fs.readFileSync(path.join(project, ...parts), 'utf8');
const rag = read('src', 'server', 'projectRag.ts');
const server = read('server.ts');
const bridge = read('src', 'services', 'apiBridge.ts');
const engine = read('src', 'server', 'agentEngine.ts');
const incrementalTests = read('src', 'server', '__tests__', 'projectRagIncremental.test.ts');
const source = [rag, server, bridge, engine].join('\n');

const checks = [
  ['the index reports how many files a refresh re-read (observability)', /public status\(\): \{ files: number; chunks: number; cachedFiles: number; reindexedFiles: number/],
  ['unchanged files are detected by mtime/ctime/size before any read', /indexed\?\.mtimeMs === stat\.mtimeMs && indexed\.ctimeMs === stat\.ctimeMs && indexed\.size === stat\.size/],
  ['cached chunks are reused for unchanged files', /if \(!unchangedFiles\.has\(chunk\.file\)\) continue;/],
  ['a single-file invalidation entry point exists', /public invalidate\(relativePath\?: string\): number/],
  ['invalidation persists so a restart sees the trimmed index', /this\.persist\(\);/],
  ['caller paths are normalized to the index key format', /function ragKey\(root: string, input: string\): string/],
  ['the write route drops only the saved file from the index', /if \(result\?\.success !== false\) projectRag\.invalidate\(filePath\);/],
  ['deleting a file refreshes the whole index signature', /if \(result\?\.success !== false\) projectRag\.invalidate\(\);/],
  ['one shared index instance is used by the engine and the routes', /const projectRag = new ProjectRag\(workspaceManager\.getRoot\(\)\);/],
  ['switching workspace rebinds the shared index', /projectRag\.rebind\(result\.path\);/],
  ['the engine accepts the shared index instead of a private one', /this\.rag = rag \|\| new ProjectRag\(indexer\.getWorkspaceRoot\(\)\);/],
  ['the renderer can read index status without touching internals', /getRagStatus\(\)[\s\S]*?fetch\('\/api\/project\/rag\/status'/],
  ['the renderer can request a targeted invalidation', /invalidateRagIndex\(filePath\?: string\)[\s\S]*?fetch\('\/api\/project\/rag\/invalidate'/],
  ['the invalidate route rejects a malformed path', /filePath must be a non-empty string when provided/],
];

for (const [name, pattern] of checks) assert.match(source, pattern, name);

const routeChecks = [
  ['index status is exposed over HTTP', /app\.get\('\/api\/project\/rag\/status'/],
  ['index invalidation is exposed over HTTP', /app\.post\('\/api\/project\/rag\/invalidate'/],
  ['status responses are never cached', /app\.get\('\/api\/project\/rag\/status'[\s\S]*?Cache-Control', 'no-store'/],
];
for (const [name, pattern] of routeChecks) assert.match(server, pattern, name);

// Behaviour is locked by unit tests, not just structure.
const testChecks = [
  ['a single edit re-reads exactly one file', /refreshed\.reindexedFiles\)\.toBe\(1\);/],
  ['unchanged files stay cached after an edit', /refreshed\.cachedFiles\)\.toBe\(files\.length - 1\);/],
  ['invalidation forces a re-read with identical metadata', /expect\(rag\.invalidate\('stable\.ts'\)\)\.toBe\(1\);/],
  ['a deleted file disappears from retrieval', /expect\(result\.files\)\.not\.toContain\('doomed\.ts'\);/],
  ['a persisted index is reused instead of rebuilding', /expect\(status\.cachedFiles\)\.toBe\(2\);/],
];
for (const [name, pattern] of testChecks) assert.match(incrementalTests, pattern, name);

assert.match(incrementalTests, /describe\('incremental re-index \(M1\.5\)'/, 'incremental regression tests must exist');
console.log(JSON.stringify({
  status: 'PASS',
  files: ['src/server/projectRag.ts', 'server.ts', 'src/services/apiBridge.ts', 'src/server/agentEngine.ts', 'src/server/__tests__/projectRagIncremental.test.ts'],
  checks: checks.length + routeChecks.length + testChecks.length,
}));