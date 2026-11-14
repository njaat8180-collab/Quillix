import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { listPackage, extractFile } from '@electron/asar';
import { resolveInstaller, resolveUnpackedExecutable, expectedArtifactNames } from './release-artifact-names.mjs';

const project = path.resolve(import.meta.dirname, '../..');
const packager = fs.readFileSync(path.join(project, 'scripts', 'smoke', 'package-win.mjs'), 'utf8');
assert.match(packager, /QUILLIX_PACKAGE_COMPRESSION\s*\|\|\s*'store'/, 'portable fallback should default to fast store compression');
assert.match(packager, /target === 'portable' \? packageCompression : 'normal'/, 'NSIS should retain normal compression while portable uses its configured mode');
const markerPath = path.join(project, '.quillix-smoke', 'package-output.json');
let release = path.join(project, 'release', 'windows');
let target = 'nsis';
try {
  const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
  if (typeof marker.outputDir === 'string' && path.isAbsolute(marker.outputDir)) release = marker.outputDir;
  if (typeof marker.target === 'string') target = marker.target;
} catch { /* fall back to the standard release directory */ }
const unpacked = path.join(release, 'win-unpacked');
const asar = path.join(unpacked, 'resources', 'app.asar');
// Resolve artifact names from the ACTUAL productName in electron-builder.json.
// The previous hardcoded "Quillix" spelling no longer matched the packaged
// "NUVRO AI" artifacts and failed release verification on valid builds.
const artifactNames = expectedArtifactNames(project, target);
const installer = resolveInstaller(release, project, target);
const unpackedExecutable = resolveUnpackedExecutable(unpacked, project);
assert.ok(fs.existsSync(unpackedExecutable), `unpacked executable is missing: ${path.basename(unpackedExecutable)}`);
assert.ok(fs.existsSync(installer), `installer is missing: ${path.basename(installer)}`);
assert.ok(fs.statSync(installer).size > 10 * 1024 * 1024, 'installer is unexpectedly small');
assert.ok(fs.statSync(asar).size > 10 * 1024 * 1024, 'app.asar is unexpectedly small');

const entries = new Set(listPackage(asar).map(entry => entry.replace(/\\/g, '/')));
for (const required of ['dist/server.cjs', 'dist/electron/main.cjs', 'dist/electron/preload.cjs', 'dist/index.html', 'package.json']) {
  assert.ok([...entries].some(entry => entry.replace(/^[/\\]+/, '') === required), `asar entry missing: ${required}`);
}
const server = extractFile(asar, 'dist/server.cjs').toString('utf8');
for (const marker of ['/api/providers/openai/failover-key', '/api/providers/groq/failover-key', 'plugin_tree_sitter_outline', 'plugin_swebench_contract', '/api/metrics/token-efficiency']) {
  assert.match(server, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `packaged server marker missing: ${marker}`);
}
console.log(JSON.stringify({ status: 'PASS', target, productName: artifactNames.productName, installer: path.basename(installer), unpackedExecutable: path.basename(unpackedExecutable), installerBytes: fs.statSync(installer).size, asarBytes: fs.statSync(asar).size, requiredEntries: 5, serverMarkers: 5 }));
