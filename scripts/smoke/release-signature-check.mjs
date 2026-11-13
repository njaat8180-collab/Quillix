import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { releaseSignatureReport } from './release-signature-contract.mjs';

const root = process.cwd();
const markerPath = path.join(root, '.quillix-smoke', 'package-output.json');
let outputDir = path.resolve(root, 'release', 'windows');
let target = 'nsis';
try {
  const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
  if (typeof marker.outputDir === 'string' && path.isAbsolute(marker.outputDir)) outputDir = marker.outputDir;
  if (typeof marker.target === 'string') target = marker.target;
} catch { /* package marker is optional for a diagnostic-only run */ }

const executable = path.join(outputDir, 'win-unpacked', 'Quillix.exe');
const installerName = target === 'portable' ? 'Quillix 1.2.0.exe' : 'Quillix Setup 1.2.0.exe';
const installer = path.join(outputDir, installerName);
const required = process.env.QUILLIX_REQUIRE_SIGNED_RELEASE === '1';
if (process.platform !== 'win32') {
  console.log(JSON.stringify({ ...releaseSignatureReport({ required }), reason: 'Windows Authenticode is only available on Windows.' }));
  process.exit(required ? 1 : 0);
}

const appExists = fs.existsSync(executable);
const installerExists = fs.existsSync(installer);
if (!appExists || !installerExists) {
  const report = releaseSignatureReport({
    required,
    appStatus: appExists ? 'Unknown' : 'Missing',
    installerStatus: installerExists ? 'Unknown' : 'Missing',
    installerExists,
  });
  console.log(JSON.stringify({ ...report, executable, installer }));
  process.exit(required ? 1 : 0);
}

const powershell = process.env.SystemRoot
  ? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  : 'powershell.exe';
const command = '$app = Get-AuthenticodeSignature -LiteralPath $env:QUILLIX_SIGNATURE_APP; $installer = Get-AuthenticodeSignature -LiteralPath $env:QUILLIX_SIGNATURE_INSTALLER; [Console]::Write((ConvertTo-Json -Compress -InputObject @{app=$app.Status.ToString();installer=$installer.Status.ToString()}))';
const result = spawnSync(
  powershell,
  ['-NoProfile', '-NonInteractive', '-Command', command],
  {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 15000,
    env: {
      SystemRoot: process.env.SystemRoot,
      SystemDrive: process.env.SystemDrive,
      Path: process.env.Path,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      PSModulePath: `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\Modules`,
      QUILLIX_SIGNATURE_APP: executable,
      QUILLIX_SIGNATURE_INSTALLER: installer,
    },
  },
);

let statuses = {};
try { statuses = JSON.parse(String(result.stdout || '')); } catch { /* reported as Unknown below */ }
const report = releaseSignatureReport({
  required,
  appStatus: String(statuses.app || 'Unknown'),
  installerStatus: String(statuses.installer || 'Unknown'),
  installerExists,
});
if (result.error) report.error = result.error.message;
if (result.stderr?.trim()) report.stderr = result.stderr.trim();
if (result.status !== 0 && !report.error) report.error = `PowerShell exited with code ${result.status}`;
if (result.signal && !report.error) report.error = `PowerShell terminated by ${result.signal}`;
if (required && report.status !== 'PASS' && !report.error) {
  report.error = 'Valid Authenticode signatures are required for both the packaged Quillix executable and installer.';
}
console.log(JSON.stringify({ ...report, executable, installer }));
if (required && report.status !== 'PASS') process.exit(1);
