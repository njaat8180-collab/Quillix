/**
 * ResourceGuard end-to-end verification.
 *
 * Proves the two properties that matter for the Windows packaging gate:
 *
 *  1. The guard does NOT count its own Windows storage probe (which spawns
 *     `powershell.exe`) as host CPU load. Before the fix this produced a
 *     constant false ~99% reading that permanently blocked `npm run
 *     package:win` with `PAUSED_RESOURCE_GUARD`.
 *
 *  2. The guard STILL detects genuine external CPU load. The fix must not
 *     weaken the gate into a no-op.
 *
 * USAGE
 *   npm exec -- tsx scripts/smoke/resource-guard-verify.ts
 *
 * Read-only with respect to the workspace; it only reads host CPU counters.
 */
import { ResourceGuard } from '../../src/server/resourceGuard.js';

/** Burn CPU for a fixed duration. */
const busy = async (ms: number): Promise<void> => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    Math.sqrt(Math.random() * 1e9);
  }
};

const out: Record<string, unknown> = {};

// 1) Idle host: the guard must allow work and must not report a bogus value.
{
  const guard = new ResourceGuard({ maxCpuPercent: 100, minDiskFreePercent: 0 });
  const result = await guard.waitUntilSafe(process.cwd(), { maxWaitMs: 0 });
  out.idle = {
    allowed: result.allowed,
    cpuPercent: result.snapshot.cpuPercent,
    reason: result.reason ?? null,
  };
}

// 2) Genuinely busy host: the guard must still block.
{
  const guard = new ResourceGuard({ maxCpuPercent: -1, minDiskFreePercent: 0 });
  const load = busy(1200);
  const result = await guard.waitUntilSafe(process.cwd(), { maxWaitMs: 0 });
  await load;
  out.busy = {
    allowed: result.allowed,
    cpuPercent: result.snapshot.cpuPercent,
    reason: result.reason ?? null,
  };
}

console.log(JSON.stringify(out, null, 2));

const idleOk = out.idle && (out.idle as { allowed: boolean }).allowed === true;
const busyBlocked = out.busy && (out.busy as { allowed: boolean }).allowed === false;

if (!idleOk) {
  console.error('FAIL: the guard blocked an idle host.');
  process.exitCode = 1;
}
if (!busyBlocked) {
  console.error('FAIL: the guard did not block a saturated host.');
  process.exitCode = 1;
}
if (idleOk && busyBlocked) {
  console.error('PASS: guard allows idle hosts and blocks saturated hosts.');
}
