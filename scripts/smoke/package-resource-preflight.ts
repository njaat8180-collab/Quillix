import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ResourceGuard } from '../../src/server/resourceGuard.js';

export async function checkPackageResources(root = process.cwd()) {
  const guard = new ResourceGuard();
  return guard.waitUntilSafe(root, { maxWaitMs: 0 });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await checkPackageResources();
  console.log(JSON.stringify({
    status: result.allowed ? 'PASS' : 'PAUSED_RESOURCE_GUARD',
    reason: result.reason,
    snapshot: result.snapshot,
  }));
  if (!result.allowed) {
    console.error(`Package preflight blocked before build: ${result.reason}. Save work, free resources, then retry.`);
    process.exitCode = 75;
  }
}
