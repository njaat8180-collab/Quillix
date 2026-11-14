import { spawnSync } from 'node:child_process';
import process from 'node:process';

const allSuites = [
  'lint',
  'test',
  'test:smoke',
  'build',
  'test:backend:e2e',
  'test:agent-e2e',
  'test:offline-plugins',
  'test:sarvam-http:e2e',
  'test:verification-http',
  'test:website-behavior',
  'test:benchmark-artifact',
  'test:package-preflight',
  'test:token-efficiency',
  'test:live-provider:mock',
  'test:live-tavily',
  'test:settings-health',
  'test:preview-ui',
  'test:chat-ui',
  'test:conversation-mode-storage',
  'test:production-surface',
  'package:win',
  'test:release-artifact',
  'test:release-signature',
  'test:packaged-static',
  'test:electron-browser',
  'test:packaged-debugger',
];
// These suites start a real Quillix service or the shipped executable. Keep
// them opt-in so the default acceptance command is genuinely no-launch and
// safe for CI/headless/user-requested no-launch sessions.
const serviceLaunchSuites = new Set([
  'test:backend:e2e',
  'test:agent-e2e',
  'test:sarvam-http:e2e',
  'test:verification-http',
  // These suites use isolated fixtures, but still spawn a local Quillix
  // server, mock transport or Electron process. Keep them out of the
  // default no-launch gate as well.
  'test:offline-plugins',
  'test:live-provider:mock',
  'test:electron-browser',
]);
const allowServiceLaunch = process.env.QUILLIX_ALLOW_SERVICE_LAUNCH === '1';
const allowPackagedLaunch = process.env.QUILLIX_ALLOW_PACKAGED_LAUNCH === '1';
const suites = allSuites.filter(suite =>
  (allowServiceLaunch || !serviceLaunchSuites.has(suite)) &&
  (allowPackagedLaunch || suite !== 'test:packaged-debugger')
);
if (process.argv.includes('--list')) {
  console.log(JSON.stringify({ suites, skipped: allSuites.filter(suite => !suites.includes(suite)), allowServiceLaunch, allowPackagedLaunch }));
  process.exit(0);
}
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
for (const suite of suites) {
  console.log(`\n=== Quillix acceptance: npm run ${suite} ===`);
  const result = spawnSync(npm, ['run', suite], { cwd: process.cwd(), stdio: 'inherit', windowsHide: true, shell: process.platform === 'win32' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    console.error(`ACCEPTANCE FAILED: ${suite}`);
    process.exit(result.status ?? 1);
  }
}
const skipped = allSuites.filter(suite => !suites.includes(suite));
console.log(`\nQUILLIX ACCEPTANCE: ${suites.length}/${suites.length} suites passed${skipped.length ? ` (skipped launch suites: ${skipped.join(', ')}; set QUILLIX_ALLOW_SERVICE_LAUNCH=1 and QUILLIX_ALLOW_PACKAGED_LAUNCH=1 for the full live gate)` : ''}`);
