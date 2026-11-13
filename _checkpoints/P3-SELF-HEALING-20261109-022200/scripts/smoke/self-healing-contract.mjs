import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Part 3 contract: terminal self-healing. The rules that matter are safety
// rules, so this contract proves they are present in the source and locked by
// regression tests: only failures with a deterministic repair are healed, a
// repair command is never built from raw error text, a dependency is only
// installed when the project has a manifest, and a process is only terminated
// when it belongs to the workspace that failed.
// `--root <dir>` replays the contract against another tree (used to prove it
// fails without the feature).
const rootIndex = process.argv.indexOf('--root');
const project = rootIndex >= 0 && process.argv[rootIndex + 1]
  ? path.resolve(process.argv[rootIndex + 1])
  : path.resolve(import.meta.dirname, '../..');

const read = (...parts) => fs.readFileSync(path.join(project, ...parts), 'utf8');
const engine = read('src', 'server', 'selfHealing.ts');
const runtime = read('src', 'server', 'selfHealingRuntime.ts');
const agent = read('src', 'server', 'agentEngine.ts');
const server = read('server.ts');
const bridge = read('src', 'services', 'apiBridge.ts');
const terminal = read('src', 'components', 'TerminalPanel.tsx');
const types = read('src', 'shared', 'types.ts');
const tests = read('src', 'server', '__tests__', 'selfHealing.test.ts');

const classifyChecks = [
  ['terminal failures are classified', /export function classifyTerminalFailure\(output: string, exitCode\?: number\): ClassifiedTerminalFailure/],
  ['a missing dependency is recognised', /category: 'missing-dependency'/],
  ['a missing directory is recognised', /category: 'missing-directory'/],
  ['a port conflict is recognised', /category: 'port-conflict'/],
  ['a permission failure is recognised', /category: 'permission-denied'/],
  ['a syntax error is recognised', /category: 'syntax-error'/],
  ['a test failure is recognised', /category: 'test-failure'/],
  ['an unknown failure invents no repair', /category: 'unknown'[\s\S]*?strategy: 'none'/],
];

const safetyChecks = [
  ['a repair plan is a separate, testable step', /export function planSelfHeal\(/],
  ['npm package names are validated', /const NPM_PACKAGE = \/\^\[@a-z0-9\]/],
  ['python package names are validated', /const PIP_PACKAGE = \/\^\[A-Za-z0-9\]/],
  ['paths can never escape the workspace', /if \(segment === '\.\.'\) return undefined;/],
  ['a dependency is only installed with a manifest', /if \(!context\.hasNpmManifest \|\| !NPM_PACKAGE\.test\(name\)\) return null;/],
  ['a python dependency needs a python manifest', /if \(!context\.hasPipManifest \|\| !PIP_PACKAGE\.test\(name\)\) return null;/],
  ['only workspace processes are terminated', /commandLine\.includes\(workspace\)/],
  ['a foreign port owner is left untouched', /held by a process outside the workspace — left untouched/],
  ['the attempt budget is bounded', /this\.attempts >= this\.maxAttempts/],
  ['the same repair is never repeated', /this\.appliedSignatures\.has\(signature\)/],
  ['a repair only counts as healed after a real re-run', /verified = rerun\.exitCode === 0/],
  ['the engine never throws into the agent loop', /catch \(error: any\) \{/],
];

const wiringChecks = [
  ['the agent runs a self-heal after a failed execution', /const selfHeal = await attemptSelfHeal\(\{/, agent],
  ['a healed execution re-runs the real command', /execRes = \{ exitCode: selfHeal\.rerun\.exitCode, output: selfHeal\.rerun\.output \};/, agent],
  ['the self-heal is reported to the user', /emitActivity\('running_tests', `Self-healed/, agent],
  ['the healed execution is reported in the verification summary', /Project executed successfully after self-heal/, agent],
  ['the runtime binds the engine to the real filesystem', /export function createSelfHealingEngine\(options: SelfHealingRuntimeOptions\): SelfHealingEngine/, runtime],
  ['the port owner is looked up from the OS', /export async function findWorkspacePortOwner\(port: number\)/, runtime],
  ['the repair history is shared process-wide', /export function selfHealHistory\(limit = 20\): SelfHealEntry\[\]/, runtime],
  ['the history route exists', /app\.get\('\/api\/agent\/self-heal\/history'/, server],
  ['the bridge exposes the history', /public async getSelfHealHistory\(limit = 20\): Promise<SelfHealEntry\[\]>/, bridge],
  ['the terminal panel shows the repair history', /Self-healing repair history/, terminal],
  ['the repair entry is part of the shared contract', /export interface SelfHealEntry/, types],
];

const testChecks = [
  ['a missing dependency is healed', /installs a missing dependency and verifies it/],
  ['a failed verification is not a success', /does not claim success when the verification re-run still fails/],
  ['a foreign process is never killed', /never terminates a port owner outside the workspace/],
  ['a workspace process is released', /stops a workspace-owned port holder/],
  ['a missing directory is created', /creates a missing directory inside the workspace/],
  ['the attempt budget is respected', /never repeats the same repair and respects the attempt budget/],
  ['model-level failures are left to the model', /journals a skipped repair for failures the model must fix/],
];

for (const [name, pattern] of classifyChecks) assert.match(engine, pattern, name);
for (const [name, pattern] of safetyChecks) assert.match(engine, pattern, name);
for (const [name, pattern, source] of wiringChecks) assert.match(source, pattern, name);
for (const [name, pattern] of testChecks) assert.match(tests, pattern, name);
assert.match(tests, /describe\('classifyTerminalFailure'/, 'failure classification regression tests must exist');
assert.match(tests, /describe\('SelfHealingEngine'/, 'self-healing engine regression tests must exist');

console.log(`self-healing contract: ${classifyChecks.length + safetyChecks.length + wiringChecks.length + testChecks.length} checks passed`);
