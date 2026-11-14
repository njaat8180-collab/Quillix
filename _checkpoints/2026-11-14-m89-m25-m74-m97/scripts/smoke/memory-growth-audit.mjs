// QUILLIX M9.7 — real memory-growth audit.
//
// The earlier contract for this item was a source scan: it proved that React
// effects clean up their timers, but it could not prove that a long session
// actually holds a bounded amount of memory. This audit closes that gap by
// RUNNING the real modules in a loop and measuring the process.
//
// Method
//   1. Warm-up phase: run the same operations so V8 has tiered up and the
//      module-level caches are populated. Memory is sampled AFTER this
//      phase, because a first-run allocation is not a leak.
//   2. Measured phase: run N iterations of realistic long-session work
//      (workspace read/write churn, code-index context building, contextual
//      chat context building, and conversation/tool-output compaction).
//      Each iteration samples RSS and heap. `global.gc()` is called before
//      every sample when the process was started with --expose-gc, so the
//      number reflects memory that is still RETAINED, not memory that is
//      merely awaiting collection.
//   3. Projection: the mission gate is "no RSS growth > 200 MB over a 4h
//      session". We cannot wait 4 hours in CI, so we measure the per-iteration
//      retained-growth slope and extrapolate it to the projected iteration
//      count of a 4-hour session. A flat slope projects to ~0 MB.
//
// This is a measurement, not a mock: the modules under test are the real
// ones, the files are real files on a real temp disk, and the numbers are
// read from the V8 runtime.
//
// Usage: node --experimental-strip-types --expose-gc scripts/smoke/memory-growth-audit.mjs
//        [--iterations N] [--projected-iterations N] [--max-rss-growth-mb N]

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const project = path.resolve(import.meta.dirname, '../..');

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return fallback;
  const value = Number(process.argv[index + 1]);
  return Number.isFinite(value) ? value : fallback;
}

const ITERATIONS = arg('iterations', 120);
// A 4h session at ~1 agent turn every 12s is ~1200 turns; the audit uses a
// conservative 6000 so the projection has margin over the real turn rate.
const PROJECTED_ITERATIONS = arg('projected-iterations', 6000);
const MAX_RSS_GROWTH_MB = arg('max-rss-growth-mb', 200);
const MAX_RETAINED_HEAP_GROWTH_MB = arg('max-retained-heap-growth-mb', 48);

const gcAvailable = typeof globalThis.gc === 'function';
if (!gcAvailable) {
  console.error('M9.7 memory audit requires --expose-gc so retained memory can be measured honestly.');
  process.exit(2);
}

const load = async (relative) => import(pathToFileURL(path.join(project, relative)).href);
const { WorkspaceManager } = await load('src/server/workspace.ts');
const { CodebaseIndexer } = await load('src/server/indexer.ts');
const { GitService } = await load('src/server/git.ts');
const { buildContextualChatContext, buildContextualChatPrompt } = await load('src/shared/contextualChat.ts');
const { compactToolResult, compactConversationHistory } = await load('src/server/agentEngine.ts');

function sample() {
  globalThis.gc();
  const usage = process.memoryUsage();
  return {
    rssMb: usage.rss / (1024 * 1024),
    retainedHeapMb: usage.heapUsed / (1024 * 1024),
    externalMb: usage.external / (1024 * 1024),
  };
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-mem-audit-'));
const workspace = new WorkspaceManager(root);
const indexer = new CodebaseIndexer(workspace, new GitService(null));

// A realistic project shape: the audit needs real files to read, search and
// index, otherwise the measured operations would be no-ops.
const SEED_FILES = 40;
for (let i = 0; i < SEED_FILES; i++) {
  const rel = `src/module-${i}.ts`;
  workspace.writeFile(rel, [
    `export function compute${i}(input: number): number {`,
    `  // seeded module ${i}`,
    `  return input + ${i};`,
    '}',
    '',
    'export class Handler {',
    `  handle(value: string): string { return value.trim(); }`,
    '}',
  ].join('\n'));
}

const SEED_LINES = Array.from({ length: 400 }, (_, i) => `line ${i}: const value${i} = ${i};`).join('\n');
workspace.writeFile('src/large.ts', SEED_LINES);

const toolOutput = 'x'.repeat(40_000);
const conversation = Array.from({ length: 60 }, (_, i) => ({
  role: i % 2 === 0 ? 'user' : 'assistant',
  content: `turn ${i} ${'y'.repeat(800)}`,
}));

/** One realistic long-session unit of work. */
function doIteration(iteration) {
  const rel = `src/module-${iteration % SEED_FILES}.ts`;
  const read = workspace.readFile(rel);
  const tree = workspace.getFileTree();
  workspace.searchFiles('compute');
  workspace.findSymbols('compute');
  if (read.success) workspace.writeFile(rel, `${read.content}\n// touched ${iteration}\n`);
  indexer.getFocusedContext(`update compute${iteration % SEED_FILES}`, rel, undefined, 4000);
  const context = buildContextualChatContext(SEED_LINES, Math.min(399, iteration % 400), 400);
  buildContextualChatPrompt({ filePath: rel, line: iteration % 400, content: context.content }, 'what does this do?');
  compactToolResult('read_file', toolOutput, 3200);
  compactConversationHistory(conversation, false, 20_000);
  return tree;
}

const WARMUP = Math.max(5, Math.floor(ITERATIONS / 6));
for (let i = 0; i < WARMUP; i++) doIteration(i);

const baseline = sample();
const samples = [];
const startedAt = Date.now();
for (let i = 0; i < ITERATIONS; i++) {
  doIteration(i);
  samples.push({ iteration: i + 1, ...sample() });
}
const durationMs = Date.now() - startedAt;
const final = samples[samples.length - 1];

const rssGrowthMb = final.rssMb - baseline.rssMb;
const retainedHeapGrowthMb = final.retainedHeapMb - baseline.retainedHeapMb;

// Least-squares slope of retained RSS across the measured phase.
const n = samples.length;
const meanX = samples.reduce((sum, s) => sum + s.iteration, 0) / n;
const meanY = samples.reduce((sum, s) => sum + s.rssMb, 0) / n;
let numerator = 0;
let denominator = 0;
for (const s of samples) {
  numerator += (s.iteration - meanX) * (s.rssMb - meanY);
  denominator += (s.iteration - meanX) ** 2;
}
const rssSlopeMbPerIteration = denominator === 0 ? 0 : numerator / denominator;
const projectedRssGrowthMb = Math.max(0, rssSlopeMbPerIteration) * PROJECTED_ITERATIONS;

// A leak is also visible as retained heap that never comes back after GC.
const meanH = samples.reduce((sum, s) => sum + s.retainedHeapMb, 0) / n;
let heapNum = 0;
for (const s of samples) heapNum += (s.iteration - meanX) * (s.retainedHeapMb - meanH);
const retainedHeapSlopeMbPerIteration = denominator === 0 ? 0 : heapNum / denominator;
const projectedRetainedHeapGrowthMb = Math.max(0, retainedHeapSlopeMbPerIteration) * PROJECTED_ITERATIONS;

const report = {
  status: 'PASS',
  generatedAt: new Date().toISOString(),
  iterations: ITERATIONS,
  warmupIterations: WARMUP,
  projectedIterations: PROJECTED_ITERATIONS,
  durationMs,
  gcAvailable: true,
  baseline: { rssMb: Number(baseline.rssMb.toFixed(2)), retainedHeapMb: Number(baseline.retainedHeapMb.toFixed(2)) },
  final: { rssMb: Number(final.rssMb.toFixed(2)), retainedHeapMb: Number(final.retainedHeapMb.toFixed(2)) },
  observedRssGrowthMb: Number(rssGrowthMb.toFixed(2)),
  observedRetainedHeapGrowthMb: Number(retainedHeapGrowthMb.toFixed(2)),
  rssSlopeMbPerIteration: Number(rssSlopeMbPerIteration.toFixed(6)),
  retainedHeapSlopeMbPerIteration: Number(retainedHeapSlopeMbPerIteration.toFixed(6)),
  projectedRssGrowthMb: Number(projectedRssGrowthMb.toFixed(2)),
  projectedRetainedHeapGrowthMb: Number(projectedRetainedHeapGrowthMb.toFixed(2)),
  gates: {
    maxRssGrowthMb: MAX_RSS_GROWTH_MB,
    maxRetainedHeapGrowthMb: MAX_RETAINED_HEAP_GROWTH_MB,
  },
  samplePoints: samples.length,
};

const failures = [];
if (projectedRssGrowthMb > MAX_RSS_GROWTH_MB) {
  failures.push(`projected RSS growth ${projectedRssGrowthMb.toFixed(1)} MB over ${PROJECTED_ITERATIONS} iterations exceeds the ${MAX_RSS_GROWTH_MB} MB gate`);
}
if (projectedRetainedHeapGrowthMb > MAX_RETAINED_HEAP_GROWTH_MB) {
  failures.push(`projected retained-heap growth ${projectedRetainedHeapGrowthMb.toFixed(1)} MB exceeds the ${MAX_RETAINED_HEAP_GROWTH_MB} MB gate`);
}
if (rssGrowthMb > MAX_RSS_GROWTH_MB) {
  failures.push(`observed RSS growth ${rssGrowthMb.toFixed(1)} MB exceeds the ${MAX_RSS_GROWTH_MB} MB gate`);
}
if (failures.length) {
  report.status = 'FAIL';
  report.failures = failures;
}

fs.rmSync(root, { recursive: true, force: true });

const artifactDir = path.join(project, '.quillix-smoke');
fs.mkdirSync(artifactDir, { recursive: true });
const artifact = path.join(artifactDir, `memory-growth-audit-${Date.now()}.json`);
fs.writeFileSync(artifact, JSON.stringify(report, null, 2));
report.artifact = path.relative(project, artifact);

console.log(JSON.stringify(report, null, 2));
assert.equal(report.status, 'PASS', `M9.7 memory-growth audit failed: ${failures.join('; ')}`);
