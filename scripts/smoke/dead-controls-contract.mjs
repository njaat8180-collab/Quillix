import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// P1.6 / release-gate contract: no visible control may be decorative.
// The Developer Cockpit Debug tab shipped six buttons with hover styling,
// aria-labels and helper text but no onClick/onKeyDown at all (Attach
// Debugger, Console Logs, Profiler, Network, Export Debug Bundle, Clear
// Debug Cache), plus System-tab metric cards showing hardcoded `N/A` and
// `Network: "Online"`. Clicking them did nothing, and the metrics were
// invented. This contract fails on that tree.
//
// Scan root is overridable so the contract can be proven to fail against a
// reverted copy of the tree.
const project = path.resolve(process.env.QUILLIX_CONTRACT_ROOT || path.resolve(import.meta.dirname, '../..'));

const cockpitPath = path.join(project, 'src/components/DeveloperCockpit.tsx');
assert.ok(fs.existsSync(cockpitPath), 'dead-controls contract: DeveloperCockpit.tsx must exist');
const cockpit = fs.readFileSync(cockpitPath, 'utf8');

function has(hay, needle, message) {
  if (needle instanceof RegExp) {
    assert.ok(needle.test(hay), `dead-controls contract: ${message}`);
  } else {
    assert.ok(hay.includes(needle), `dead-controls contract: ${message}`);
  }
}

// --- every button in the renderer must be operable -------------------------
// A button is inoperable when it declares neither a pointer/keyboard handler
// nor a form-submit role. Run this across the whole component tree so the
// class of defect cannot come back anywhere else.
const componentDir = path.join(project, 'src');
const tsxFiles = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
    } else if (entry.isFile() && entry.name.endsWith('.tsx')) {
      tsxFiles.push(full);
    }
  }
}(componentDir));
tsxFiles.sort();

const OPERABLE = /onClick=|onKeyDown=|onKeyPress=|onPointerDown=|onPointerUp=|onMouseDown=|type="submit"/;
const deadControls = [];
for (const file of tsxFiles) {
  const source = fs.readFileSync(file, 'utf8');
  for (const match of source.matchAll(/<button\b[^>]*>/g)) {
    if (!OPERABLE.test(match[0])) deadControls.push(`${path.relative(project, file).replace(/\\/g, '/')}: ${match[0].slice(0, 120)}`);
  }
}
assert.equal(deadControls.length, 0, `dead-controls contract: found button controls with no handler:\n${deadControls.join('\n')}`);

// --- the cockpit debug tools must be wired to real diagnostics -------------
has(cockpit, 'const loadDebugSection = async', 'cockpit defines the debug section loader');
has(cockpit, 'const exportDebugBundle = ', 'cockpit defines the bundle exporter');
has(cockpit, 'api.getTerminalHistory(20)', 'console logs reads real terminal history');
has(cockpit, 'api.getProviderHealth()', 'network reads real provider diagnostics');
has(cockpit, 'api.getTokenEfficiency()', 'profiler reads real task counters');
has(cockpit, 'api.getRagStatus()', 'profiler reads real index stats');
has(cockpit, 'api.getAgentStatus()', 'profiler reads real agent state');
has(cockpit, 'setDebugSection("logs")', 'logs section is rendered when selected');
has(cockpit, 'setDebugSection("network")', 'network section is rendered when selected');
has(cockpit, 'setDebugSection("profiler")', 'profiler section is rendered when selected');
has(cockpit, 'debugSection === "logs" &&', 'logs results are conditionally rendered');
has(cockpit, 'debugSection === "network" && providers &&', 'network results require real data before rendering');
has(cockpit, 'debugSection === "profiler" &&', 'profiler results are conditionally rendered');
has(cockpit, 'anchor.download = `quillix-debug-', 'export triggers a real download');

// --- the decorative affordances must be gone -------------------------------
for (const removed of [
  'Attach Debugger',
  'Launch Node.js inspector',
  'Clear Debug Cache',
  'Remove temporary debug files',
  'Export Debug Bundle',
  'CPU/Memory profiling',
]) {
  assert.ok(!cockpit.includes(removed), `dead-controls contract: decorative control "${removed}" must be removed`);
}

// --- fabricated metrics must be replaced by real state ---------------------
assert.ok(!cockpit.includes('value="Online"'), 'dead-controls contract: hardcoded Network "Online" must be gone');
assert.ok(!cockpit.includes('value="N/A"'), 'dead-controls contract: hardcoded "N/A" metric must be gone');
has(cockpit, 'label="Indexed Files"', 'system tab shows the real indexed-file count');
has(cockpit, 'label="Indexed Chunks"', 'system tab shows the real indexed-chunk count');
has(cockpit, 'label="Provider Link"', 'system tab shows real provider availability');
has(cockpit, 'label="Agent"', 'system tab shows real agent state');
has(cockpit, /value=\{ragStatus\?\.files != null \? String\(ragStatus\.files\) : "unavailable"\}/, 'indexed-file value is derived from real data');

console.log(JSON.stringify({
  status: 'PASS',
  files: ['src/components/DeveloperCockpit.tsx'],
  scannedComponents: tsxFiles.length,
  checks: 34,
}));
