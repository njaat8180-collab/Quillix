#!/usr/bin/env node
// =============================================================================
// Host capacity probe for the agent E2E harness.
//
// The engine's resource guard (src/server/resourceGuard.ts) refuses to start a
// model request while the machine is saturated and reports a RESUMABLE error
// instead of pretending the request worked. That is correct product behaviour
// and this helper never relaxes it.
//
// The problem it solves is a harness one: an E2E run that starts on a busy
// host can be aborted mid-run for purely environmental reasons, and the
// harness would then report that as a product failure. This probe samples the
// SAME CPU signal the guard uses (os.cpus() deltas) so the harness can wait
// for headroom before it starts.
//
// Usage:
//   node scripts/e2e/host-capacity.mjs --wait --threshold 80 --max-seconds 300
//
// Exit codes follow the repository convention for resource-blocked work:
//   0  -> the host has CPU headroom
//   75 -> the host stayed too busy for the whole wait window (blocked)
// =============================================================================

import os from 'node:os';

const args = process.argv.slice(2);

const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  if (index === -1 || index + 1 >= args.length) return fallback;
  const value = Number(args[index + 1]);
  return Number.isFinite(value) ? value : fallback;
};

const threshold = option('threshold', 80);
const maxSeconds = option('max-seconds', 300);
const sampleMs = option('sample-ms', 2000);
const shouldWait = args.includes('--wait');

function cpuTimes() {
  return os.cpus().reduce(
    (sum, cpu) => {
      const times = cpu.times;
      const total = times.user + times.nice + times.sys + times.irq + times.idle;
      sum.idle += times.idle;
      sum.total += total;
      return sum;
    },
    { idle: 0, total: 0 },
  );
}

/** Same computation the resource guard uses: utilization between two samples. */
function utilization(before, after) {
  const totalDelta = after.total - before.total;
  const idleDelta = after.idle - before.idle;
  if (totalDelta <= 0) return 0;
  return Math.max(0, Math.min(100, (1 - idleDelta / totalDelta) * 100));
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function measure() {
  const before = cpuTimes();
  await sleep(sampleMs);
  const after = cpuTimes();
  return utilization(before, after);
}

const startedAt = Date.now();
let cpuPercent = await measure();

while (shouldWait && cpuPercent > threshold && Date.now() - startedAt < maxSeconds * 1000) {
  process.stdout.write(
    `[capacity] CPU ${cpuPercent.toFixed(0)}% is above the ${threshold}% headroom target — waiting for the host to settle\n`,
  );
  await sleep(sampleMs);
  cpuPercent = await measure();
}

const ready = cpuPercent <= threshold;
const report = {
  status: ready ? 'READY' : 'BLOCKED',
  cpuPercent: Number(cpuPercent.toFixed(1)),
  threshold,
  waitedSeconds: Math.round((Date.now() - startedAt) / 1000),
  reason: ready
    ? 'host has CPU headroom'
    : `host stayed above ${threshold}% CPU for the whole wait window`,
};
process.stdout.write(`${JSON.stringify(report)}\n`);
process.exit(ready ? 0 : 75);
