import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { tsImport } from 'tsx/esm/api';
import { releaseSourceFingerprint } from './release-source-fingerprint.mjs';
import { cleanupIncompleteNsisArtifacts } from './cleanup-incomplete-nsis.mjs';

const root = process.cwd();
const markerDir = path.join(root, '.quillix-smoke');
const markerPath = path.join(markerDir, 'package-output.json');
const defaultOutput = path.resolve(root, 'release', 'windows');
const npm = process.platform === 'win32' ? process.execPath : 'npm';
const npx = process.platform === 'win32' ? process.execPath : 'npx';
const globalNpmCli = process.platform === 'win32' && process.env.npm_execpath
  ? path.resolve(process.env.npm_execpath)
  : undefined;
const globalNpxCli = globalNpmCli ? path.join(path.dirname(globalNpmCli), 'npx-cli.js') : undefined;
const npmPrefix = process.platform === 'win32' && globalNpmCli ? [globalNpmCli] : [];
const npxPrefix = process.platform === 'win32' && globalNpxCli ? [globalNpxCli] : [];
// Electron-builder must scan and pack Quillix's runtime dependencies (including
// Monaco, Tree-sitter and the provider SDKs). On Windows this can legitimately
// exceed three minutes even after the app has already been assembled. The old
// 180s default caused a false failure while electron-builder kept producing a
// valid installer in the background. Keep the timeout bounded, but give the
// packaging gate enough room for a cold Windows build; CI/release builders can
// still override it explicitly.
const packageTimeoutMs = Number(process.env.QUILLIX_PACKAGE_TIMEOUT_MS || 600000);
if (!Number.isFinite(packageTimeoutMs) || packageTimeoutMs < 30000) throw new Error('QUILLIX_PACKAGE_TIMEOUT_MS must be at least 30000 ms.');
// Acceptance and release smoke checks need one deterministic Windows artifact.
// Building both x64 and arm64 multiplies packaging time and can leave a
// half-written win-unpacked directory when the helper is interrupted. Keep
// x64 as the production default; arm64 remains opt-in for release builders.
const packageArch = String(process.env.QUILLIX_PACKAGE_ARCH || 'x64').toLowerCase();
if (!['x64', 'arm64'].includes(packageArch)) throw new Error('QUILLIX_PACKAGE_ARCH must be x64 or arm64.');
const requestedTarget = String(process.env.QUILLIX_PACKAGE_TARGET || 'nsis').toLowerCase();
if (!['nsis', 'portable'].includes(requestedTarget)) throw new Error('QUILLIX_PACKAGE_TARGET must be nsis or portable.');
// Portable packaging is dominated by 7-Zip recompression of the already
// bundled ASAR on some Windows hosts. Store mode produces a valid, larger
// executable much faster and makes the bounded release gate deterministic;
// NSIS keeps normal compression unless explicitly overridden.
// This setting is used only for the portable target. Default to fast store
// mode even when portable is reached through the NSIS-unavailable fallback;
// NSIS itself always keeps normal compression in packageAt() below.
const packageCompression = String(process.env.QUILLIX_PACKAGE_COMPRESSION || 'store').toLowerCase();
if (!['store', 'normal', 'maximum'].includes(packageCompression)) throw new Error('QUILLIX_PACKAGE_COMPRESSION must be store, normal or maximum.');
const signingSource = process.env.CSC_LINK
  ? 'CSC_LINK'
  : process.env.QUILLIX_WIN_CERTIFICATE_FILE
    ? 'QUILLIX_WIN_CERTIFICATE_FILE'
    : process.env.CSC_NAME
      ? 'CSC_NAME'
      : process.env.QUILLIX_WIN_CERTIFICATE_SUBJECT_NAME
        ? 'QUILLIX_WIN_CERTIFICATE_SUBJECT_NAME'
        : 'none';
if (process.env.QUILLIX_WIN_CERTIFICATE_FILE) {
  const certificateFile = path.resolve(process.env.QUILLIX_WIN_CERTIFICATE_FILE);
  if (!fs.existsSync(certificateFile) || !fs.statSync(certificateFile).isFile()) {
    throw new Error(`QUILLIX_WIN_CERTIFICATE_FILE does not point to a certificate file: ${certificateFile}`);
  }
  process.env.QUILLIX_WIN_CERTIFICATE_FILE = certificateFile;
}
if (process.env.QUILLIX_WIN_CERTIFICATE_SUBJECT_NAME && !process.env.CSC_NAME) {
  process.env.CSC_NAME = process.env.QUILLIX_WIN_CERTIFICATE_SUBJECT_NAME;
}
const signingRequested = Boolean(
  process.env.CSC_LINK ||
  process.env.QUILLIX_WIN_CERTIFICATE_FILE ||
  process.env.CSC_NAME ||
  process.env.QUILLIX_WIN_CERTIFICATE_SUBJECT_NAME,
);
// Keep certificate secrets out of command-line arguments. electron-builder
// consumes the standard CSC_* environment variables; Quillix-prefixed names
// make the release contract explicit for CI and local release scripts.
if (!process.env.CSC_LINK && process.env.QUILLIX_WIN_CERTIFICATE_FILE) process.env.CSC_LINK = process.env.QUILLIX_WIN_CERTIFICATE_FILE;
if (!process.env.CSC_KEY_PASSWORD && process.env.QUILLIX_WIN_CERTIFICATE_PASSWORD) process.env.CSC_KEY_PASSWORD = process.env.QUILLIX_WIN_CERTIFICATE_PASSWORD;
if (!process.env.CSC_NAME && process.env.QUILLIX_WIN_CERTIFICATE_SUBJECT_NAME) process.env.CSC_NAME = process.env.QUILLIX_WIN_CERTIFICATE_SUBJECT_NAME;
let builderConfigArg = [];
let temporaryBuilderConfig;
if (process.env.QUILLIX_WIN_CERTIFICATE_SUBJECT_NAME) {
  const baseConfig = JSON.parse(fs.readFileSync(path.join(root, 'electron-builder.json'), 'utf8'));
  baseConfig.win = {
    ...(baseConfig.win || {}),
    signtoolOptions: {
      ...((baseConfig.win && baseConfig.win.signtoolOptions) || {}),
      certificateSubjectName: process.env.QUILLIX_WIN_CERTIFICATE_SUBJECT_NAME,
    },
  };
  temporaryBuilderConfig = path.join(os.tmpdir(), `quillix-electron-builder-${process.pid}-${Date.now()}.json`);
  fs.writeFileSync(temporaryBuilderConfig, JSON.stringify(baseConfig, null, 2));
  builderConfigArg = [`--config=${temporaryBuilderConfig}`];
}

const run = (command, args, options = {}) => spawnSync(command, args, {
  cwd: root,
  encoding: 'utf8',
  windowsHide: true,
  // npm.cmd/npx.cmd are executable directly on Windows. Avoid shell=true so
  // timeout/termination applies to the actual electron-builder process tree.
  shell: false,
  ...options,
});

// Packaging runs Vite/Electron Builder over a large runtime dependency graph.
// Check CPU, workspace-volume capacity and Windows disk health before starting
// either build stage; a constrained host gets a resumable, explicit pause
// instead of being driven into a crash.
const { checkPackageResources } = await tsImport('./package-resource-preflight.ts', import.meta.url);
const resourceResult = await checkPackageResources(root);
console.log(JSON.stringify({
  status: resourceResult.allowed ? 'PASS' : 'PAUSED_RESOURCE_GUARD',
  reason: resourceResult.reason,
  snapshot: resourceResult.snapshot,
}));
if (!resourceResult.allowed) {
  console.error(`Package preflight blocked before build: ${resourceResult.reason}. Save work, free resources, then retry.`);
  if (temporaryBuilderConfig) {
    try { fs.rmSync(temporaryBuilderConfig, { force: true }); } catch { /* diagnostic cleanup only */ }
  }
  process.exit(75);
}

const buildSourceFingerprint = releaseSourceFingerprint(root);
const build = run(npm, [...npmPrefix, 'run', 'build:electron'], { stdio: 'inherit' });
if (build.error) throw build.error;
if (build.status !== 0) process.exit(build.status ?? 1);

const packageAt = (output, target = 'nsis') => run(npx, [...npxPrefix, 'electron-builder', '--win', target, `--${packageArch}`, `--config.directories.output=${output}`, `--config.compression=${target === 'portable' ? packageCompression : 'normal'}`, ...builderConfigArg], { timeout: packageTimeoutMs, killSignal: 'SIGTERM' });
const printResult = (result) => {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
};

const timedOut = (result) => result.error?.code === 'ETIMEDOUT' || result.signal === 'SIGTERM';

let output = defaultOutput;
let target = requestedTarget;
// Never let a prior interrupted builder run satisfy (or break) the current
// static contract. This is a generated directory owned by electron-builder;
// no source or user project files are touched.
try { fs.rmSync(path.join(output, 'win-unpacked'), { recursive: true, force: true }); } catch { /* builder will report a precise lock error */ }
let result = packageAt(output, target);
printResult(result);
const combined = `${result.stdout || ''}\n${result.stderr || ''}`;
const lockFailure = result.status !== 0 && /EPERM|EBUSY|resource busy|operation not permitted|win-unpacked\.tmp.*(?:rename|unlink)|(?:rename|unlink) .*win-unpacked/i.test(combined);
if (lockFailure) {
  output = path.join(os.tmpdir(), `quillix-release-${process.pid}-${Date.now()}`);
  result = packageAt(output, target);
  printResult(result);
}
// NSIS needs a working Wine/NSIS signing helper on some Windows-hosted
// environments. The unpacked app was already produced; use a portable EXE as
// the release artifact when only the NSIS uninstaller step is unavailable.
const nsisUnavailable = (result.status !== 0 || timedOut(result)) && /spawn UNKNOWN|WineVmManager|computeScriptAndSignUninstaller|timed out|ETIMEDOUT/i.test(`${result.stdout || ''}\n${result.stderr || ''}\n${result.error?.message || ''}`);
let nsisFallbackOutput;
// Never launch a second portable build when portable was explicitly
// requested. A timed-out electron-builder process can briefly retain the
// unpacked directory on Windows; retrying the same output immediately turns a
// recoverable timeout into a misleading EBUSY failure.
if (nsisUnavailable && target !== 'portable') {
  nsisFallbackOutput = output;
  if (timedOut(result)) {
    output = path.join(os.tmpdir(), `quillix-release-${process.pid}-${Date.now()}`);
  }
  target = 'portable';
  result = packageAt(output, target);
  printResult(result);
}
if (result.error) {
  if (timedOut(result)) {
    throw new Error(`Windows packaging exceeded ${Math.round(packageTimeoutMs / 1000)} seconds while building ${target}. Check electron-builder dependency scanning or set QUILLIX_PACKAGE_TIMEOUT_MS explicitly for this host.`);
  }
  throw result.error;
}
if (result.status !== 0) process.exit(result.status ?? 1);

// NSIS can leave a small, unusable EXE and blockmap before its uninstaller
// helper fails. Once the portable fallback succeeds, discard only that
// undersized generated pair; never touch a plausible full-size installer.
if (nsisFallbackOutput) {
  const cleaned = [
    ...cleanupIncompleteNsisArtifacts(nsisFallbackOutput),
    ...(defaultOutput === nsisFallbackOutput ? [] : cleanupIncompleteNsisArtifacts(defaultOutput)),
  ];
  for (const artifact of cleaned) console.warn(`Removed incomplete NSIS fallback output: ${artifact}`);
}

if (releaseSourceFingerprint(root) !== buildSourceFingerprint) {
  throw new Error('Runtime source changed during packaging. The artifact was not marked as verified; rebuild from a stable source tree.');
}

fs.mkdirSync(markerDir, { recursive: true });
fs.writeFileSync(markerPath, JSON.stringify({
  outputDir: output,
  target,
  fallbackUsed: target !== 'nsis' || output !== defaultOutput,
  sourceFingerprint: buildSourceFingerprint,
  createdAt: new Date().toISOString(),
}, null, 2));
console.log(JSON.stringify({ status: 'PASS', outputDir: output, target, fallbackUsed: target !== 'nsis' || output !== defaultOutput }));
console.log(JSON.stringify({ signingConfigured: signingRequested, signingSource, note: signingRequested ? 'Release signing credentials detected.' : 'Unsigned local artifact; configure CSC_LINK/CSC_KEY_PASSWORD or QUILLIX_WIN_CERTIFICATE_SUBJECT_NAME for production Windows distribution.' }));
if (temporaryBuilderConfig) {
  try { fs.rmSync(temporaryBuilderConfig, { force: true }); } catch { /* diagnostic cleanup only */ }
}
