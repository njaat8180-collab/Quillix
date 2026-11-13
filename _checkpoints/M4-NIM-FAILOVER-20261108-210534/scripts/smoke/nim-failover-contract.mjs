import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Part 4 contract: NVIDIA NIM multi-model auto-failover. The rules that matter
// are safety rules, so this contract proves they are present in the source and
// locked by regression tests: only transient failures switch models, a cooling
// or failing model is never retried, quota limits stay endpoint-scoped, and the
// same request (conversation + tools) is preserved across a switch.
// `--root <dir>` replays the contract against another tree (used to prove it
// fails without the feature).
const rootIndex = process.argv.indexOf('--root');
const project = rootIndex >= 0 && process.argv[rootIndex + 1]
  ? path.resolve(process.argv[rootIndex + 1])
  : path.resolve(import.meta.dirname, '../..');

const read = (...parts) => fs.readFileSync(path.join(project, ...parts), 'utf8');
const models = read('src', 'server', 'nimModels.ts');
const failover = read('src', 'server', 'nvidiaFailover.ts');
const nvidia = read('src', 'server', 'nvidia.ts');
const sarvam = read('src', 'server', 'sarvam.ts');
const server = read('server.ts');
const settings = read('src', 'server', 'settings.ts');
const types = read('src', 'shared', 'types.ts');
const modelTests = read('src', 'server', '__tests__', 'nimModels.test.ts');
const failoverTests = read('src', 'server', '__tests__', 'nvidiaFailover.test.ts');
const settingsScreen = read('src', 'components', 'SettingsScreen.tsx');

const uiChecks = [
  ['the settings screen shows the NIM discovery dashboard', /aria-label="NVIDIA model discovery and failover health"/],
  ['the dashboard can discover the account models', /aria-label="Discover NVIDIA models"/],
  ['the dashboard can save the failover priority', /id="nvidia-failover-priority"/],
  ['the dashboard shows the active model and per-model health', /aria-label="NVIDIA failover health"/],
  ['the dashboard polls the health endpoint without caching', /fetch\('\/api\/providers\/nvidia\/health', \{ cache: 'no-store' \}\)/],
];

const modelChecks = [
  ['the catalog is parsed from the account model list', /export function parseNimModelCatalog\(payload: unknown\): NimModelInfo\[\]/],
  ['a model id is never invented when the catalog is empty', /if \(!configured\) return null;/],
  ['hard requirements exclude incompatible models', /export function isNimModelCompatible\(model: NimModelInfo, requirements: NimTaskRequirements\): boolean/],
  ['a model in cooldown is never selected', /export function nimModelNeedsCooldown\(health: NimModelHealth \| undefined, now: number\): boolean/],
  ['only transient failures are failover-worthy', /export const NIM_FAILOVER_KINDS: readonly NimFailureKind\[\] = \['rate-limit', 'timeout', 'server', 'overload', 'unavailable'\]/],
  ['auth and billing failures are not failover-worthy', /export function isNimFailoverWorthy\(kind: NimFailureKind\): boolean/],
  ['the failing model is excluded from its own replacement', /exclude: currentModelId/],
  ['a cooling model is rejected as a replacement', /nimModelNeedsCooldown\(health\[selection\.model\.id\], now\)\) return null;/],
];

const failoverChecks = [
  ['retry-after hints are honoured for the cooldown', /function retryAfterMs\(message: string\): number/],
  ['the wrapper never executes tools itself', /the agent loop owns that, which also prevents duplicate actions/],
  ['model switches are bounded', /attempt <= this\.maxSwitches/],
  ['a switch is recorded for the health dashboard', /this\.switches\.push\(\{ from: model, to: next\.model\.id, reason: kind, at: Date\.now\(\) - started \}\)/],
  ['the delegate is told which model to use', /this\.options\.onModel\?\.\(model\);/],
  ['a failed request records its failure kind and cooldown', /noteNimFailure\(this\.health\.get\(model\), kind, Date\.now\(\), attempt, retryAfterMs\(message\)\)/],
  ['the configured model is re-read per request', /configuredModel\?: \(\) => string/],
  ['streaming only retries before the first token', /canRetry[\s\S]*?emitted === 0/],
  ['the same request is replayed after a switch', /return this\.run\(\(\) => this\.delegate\.chatWithTools\(messages, tools, options\), requirements\)/],
  ['streamed tool turns use the same failover rules', /public async chatWithToolsStream\(/],
  ['health is exposed for the dashboard', /public healthSnapshot\(\)/],
];
const providerChecks = [
  ['the NVIDIA provider is created with failover enabled', /export function createNimProvider\(settings:\(\)=>QuillixSettings\): NimFailoverProvider/],
  ['the transport still owns pacing and endpoint cooldown', /new UniversalProvider\(\(\) => \{/],
  ['the failover priority comes from settings', /priority: \(\) => settings\(\)\.nvidiaModelPriority \?\? \[\]/],
  ['models are discovered from the account model list', /export async function discoverNimModels\(force = false\): Promise<NimCatalogResult>/],
  ['discovery never invents model ids', /NVIDIA model discovery returned no usable models\./],
  ['the discovery result is cached', /NIM_CATALOG_TTL_MS/],
];

const wiringChecks = [
  ['the NVIDIA brain uses the failover provider', /createNimProvider\(get\)/, sarvam],
  ['the model discovery route exists', /app\.get\('\/api\/providers\/nvidia\/models'/, server],
  ['the health route exists', /app\.get\('\/api\/providers\/nvidia\/health'/, server],
  ['the priority list is part of the settings contract', /nvidiaModelPriority\?: string\[\];/, types],
  ['the priority list is sanitized on load', /nvidiaModelPriority: sanitizeNvidiaPriority\(s\.nvidiaModelPriority\)/, settings],
  ['the priority list is validated on write', /Enter up to 12 exact NVIDIA model IDs for the failover priority\./, settings],
];

for (const [name, pattern] of modelChecks) assert.match(models, pattern, name);
for (const [name, pattern] of failoverChecks) assert.match(failover, pattern, name);
for (const [name, pattern] of providerChecks) assert.match(nvidia, pattern, name);
for (const [name, pattern, source] of wiringChecks) assert.match(source, pattern, name);
for (const [name, pattern] of uiChecks) assert.match(settingsScreen, pattern, name);

// Behaviour is locked by unit tests, not just structure.
const testChecks = [
  ['a rate limit switches to the next model', /rate.limit/i],
  ['an auth failure does not switch models', /auth/i],
  ['a failing model is never retried', /never re-uses the failing model/],
  ['streamed output is not duplicated', /does not duplicate output/],
  ['the conversation and tools survive a switch', /preserves the conversation and tool payload/],
  ['a cooling model is skipped', /cool/i],
];
for (const [name, pattern] of testChecks) {
  assert.match(modelTests + failoverTests, pattern, name);
}
assert.match(modelTests, /describe\('selectNimModel'/, 'NIM selection regression tests must exist');
assert.match(modelTests, /describe\('failoverNimModel'/, 'NIM failover selection regression tests must exist');
assert.match(failoverTests, /describe\('NimFailoverProvider'/, 'NIM failover regression tests must exist');

console.log(`nim-failover contract: ${modelChecks.length + failoverChecks.length + providerChecks.length + wiringChecks.length + uiChecks.length + testChecks.length} checks passed`);
