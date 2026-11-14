import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// M-TURBO-1 regression contract: every Turbo Speed surface (Home Dashboard,
// Home header, Studio beside Agent/Chat) must share ONE persistent global state
// (handleTurboSpeedToggle -> api.updateSettings) rather than a local-only patch
// that would desync after reload. Guards against reintroducing the Home-dashboard
// desync where the toggle only called setSettings (never persisted).
const project = path.resolve(import.meta.dirname, '../..');
const app = fs.readFileSync(path.join(project, 'src/App.tsx'), 'utf8');
const dashboard = fs.readFileSync(path.join(project, 'src/components/AtlasDashboard.tsx'), 'utf8');
const dashboardTypes = fs.readFileSync(path.join(project, 'src/components/dashboardTypes.ts'), 'utf8');
const pacing = fs.readFileSync(path.join(project, 'src/shared/providerPacing.ts'), 'utf8');

const checks = [
  ['the shared Turbo toggle persists via api.updateSettings (the single global state)',
    /const handleTurboSpeedToggle = useCallback\(async \(next: boolean\) => \{[\s\S]*?api\.updateSettings\(\{ turboSpeedMode: next \}\)/],
  ['Home Dashboard is wired to the persisted toggle, not a local-only patch',
    /import \{ AtlasDashboard as DashboardView \}[\s\S]*?<DashboardView[\s\S]*?onToggleTurboSpeed=\{handleTurboSpeedToggle\}/],
  ['Home header (TopHeader) is wired to the persisted toggle',
    /<TopHeader[\s\S]*?onToggleTurboSpeed=\{handleTurboSpeedToggle\}/],
  ['Studio (WorkbenchLayout, beside Agent/Chat) is wired to the persisted toggle',
    /<WorkbenchLayout[\s\S]*?onToggleTurboSpeed=\{handleTurboSpeedToggle\}/],
  ['the active Atlas dashboard shares the typed dashboard contract',
    /export interface DashboardViewProps[\s\S]*?onToggleTurboSpeed\?: \(next: boolean\) => void/],
  ['Turbo pacing floor (1s / ~60 RPM) is still enforced so limits are respected',
    /if \(settings\.turboSpeedMode === true\)[\s\S]*?return 1_000;/],
];

for (const [name, pattern] of checks) assert.match(app + '\n' + dashboard + '\n' + dashboardTypes + '\n' + pacing, pattern, name);
assert.equal(fs.existsSync(path.join(project, 'src/components/DashboardView.tsx')), false,
  'the unused legacy dashboard surface should stay removed');
console.log(JSON.stringify({ status: 'PASS', files: ['src/App.tsx', 'src/components/AtlasDashboard.tsx', 'src/components/dashboardTypes.ts', 'src/shared/providerPacing.ts'], checks: checks.length + 1 }));
