import fs from 'node:fs';
import path from 'node:path';
import { releaseSourceFingerprint } from './release-source-fingerprint.mjs';
import { resolveInstaller, expectedArtifactNames } from './release-artifact-names.mjs';

const root = process.cwd();
const markerPath = path.join(root, '.quillix-smoke', 'package-output.json');
let releaseRoot = path.join(root, 'release', 'windows');
try {
  const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
  if (typeof marker.outputDir === 'string' && path.isAbsolute(marker.outputDir)) releaseRoot = marker.outputDir;
} catch { /* default release output remains authoritative when no package marker exists */ }
const marker = (() => { try { return JSON.parse(fs.readFileSync(markerPath, 'utf8')); } catch { return {}; } })();
// Resolve the installer from the ACTUAL productName in electron-builder.json
// instead of a hardcoded product string, so a rename cannot silently break
// release verification.
const installer = resolveInstaller(releaseRoot, root, marker.target === 'portable' ? 'portable' : 'nsis');
const artifactNames = expectedArtifactNames(root, marker.target === 'portable' ? 'portable' : 'nsis');
const appRoot = path.join(releaseRoot, 'win-unpacked', 'resources', 'app');
const appArchive = path.join(releaseRoot, 'win-unpacked', 'resources', 'app.asar');
const required = [
  appArchive,
];
const fail = message => { throw new Error(message); };
if (typeof marker.sourceFingerprint !== 'string' || !/^[a-f0-9]{64}$/i.test(marker.sourceFingerprint)) {
  fail('Packaged artifact has no source fingerprint; rebuild it with the current release packager before accepting it.');
}
const currentFingerprint = releaseSourceFingerprint(root);
if (marker.sourceFingerprint !== currentFingerprint) {
  fail(`Packaged artifact is stale: its source fingerprint does not match the current runtime inputs. Rebuild ${path.relative(root, releaseRoot)} before release verification.`);
}
if (!fs.existsSync(installer)) fail(`Installer missing: ${installer}`);
const installerBytes = fs.statSync(installer).size;
if (installerBytes < 10 * 1024 * 1024) fail(`Installer is unexpectedly small: ${installerBytes} bytes`);
for (const target of required) if (!fs.existsSync(target)) fail(`Packaged resource missing: ${path.relative(root, target)}`);
if (fs.existsSync(appRoot)) fail('Production package unexpectedly contains an unpacked app directory; asar protection is not active.');
console.log(JSON.stringify({ status: 'PASS', target: marker.target || 'nsis', productName: artifactNames.productName, installer: path.basename(installer), installerBytes, appArchiveBytes: fs.statSync(appArchive).size, asar: true, main: 'dist/electron/main.cjs' }));
