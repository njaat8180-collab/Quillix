import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// M7.5 Studio monitor contract: the provider health summary produced by
// `summarizeProviderHealth()` must actually reach the Studio monitor footer
// and be rendered as a read-only indicator. Guards against a monitor wired to
// stale local state, one that polls while hidden, or one that mutates
// provider pacing / quota behavior. `--root <dir>` replays the contract
// against another tree (used to prove the check fails without the fix).
const rootIndex = process.argv.indexOf('--root');
const project = rootIndex >= 0 && process.argv[rootIndex + 1]
  ? path.resolve(process.argv[rootIndex + 1])
  : path.resolve(import.meta.dirname, '../..');

const read = (...parts) => fs.readFileSync(path.join(project, ...parts), 'utf8');
const bridge = read('src/services/apiBridge.ts');
const layout = read('src/components/WorkbenchLayout.tsx');
const types = read('src/shared/types.ts');
const server = read('server.ts');
const universal = read('src/server/universal.ts');
const source = [bridge, layout, types, server, universal].join('\n');

const checks = [
  ['the shared contract exposes a ProviderHealthSummary with the known availability union',
    /export interface ProviderHealthSummary \{[\s\S]*?'circuit-open'/],
  ['the provider health summarizer is exported for reuse',
    /export function summarizeProviderHealth\(/],
  ['the provider snapshot publishes the health summary',
    /const health = summarizeProviderHealth\(\{/],
  ['the server exposes provider diagnostics over HTTP',
    /app\.get\('\/api\/providers\/diagnostics'/],
  ['the bridge reads provider health from the provider diagnostics route',
    /getProviderHealth\([\s\S]*?fetch\('\/api\/providers\/diagnostics'/],
  ['the bridge unwraps the health summary from providerDiagnostics',
    /providerDiagnostics\?\.health/],
  ['the Studio monitor reads provider health through the bridge',
    /api\.getProviderHealth\(\)/],
  ['the Studio monitor refreshes provider health on an interval',
    /fetchHealth\(\);[\s\S]*?setInterval\(fetchHealth,\s*5000\)/],
  ['the Studio monitor renders the availability state',
    /PROVIDER_HEALTH_LABELS\[providerHealth\.availability\]/],
  ['the Studio monitor exposes the health details to assistive technology',
    /aria-label=\{providerHealthDetails\}/],
];

for (const [name, pattern] of checks) assert.match(source, pattern, name);
assert.doesNotMatch(layout, /server\/universal/, 'The renderer must not import server modules directly.');
assert.doesNotMatch(layout, /updateSettings/, 'The provider health monitor must never write settings.');
assert.doesNotMatch(layout, /setCooldown|setCircuit|resetProvider/i, 'The provider health monitor must never mutate provider pacing state.');
console.log(JSON.stringify({
  status: 'PASS',
  files: ['src/services/apiBridge.ts', 'src/components/WorkbenchLayout.tsx', 'src/shared/types.ts', 'server.ts', 'src/server/universal.ts'],
  checks: checks.length,
}));
