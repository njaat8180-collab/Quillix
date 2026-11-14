import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const protocols = ['openai', 'responses', 'anthropic', 'gemini'];
const runner = new URL('../../node_modules/tsx/dist/cli.mjs', import.meta.url);
for (const protocol of protocols) {
  const result = spawnSync(process.execPath, [fileURLToPath(runner), 'scripts/smoke/live-provider-check.ts'], {
    cwd: process.cwd(),
    env: { ...process.env, QUILLIX_LIVE_MOCK: '1', QUILLIX_LIVE_PROTOCOL: protocol, QUILLIX_LIVE_REQUIRE_TOOL: '1' },
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log(`LIVE PROVIDER MATRIX: ${protocols.length}/${protocols.length} protocols passed`);
