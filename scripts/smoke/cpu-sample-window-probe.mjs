/**
 * CPU sample-window probe.
 *
 * WHY THIS EXISTS
 * ---------------
 * `src/server/resourceGuard.ts` measures host CPU utilisation from deltas
 * between `os.cpus()` counter samples. On Windows those counters advance in
 * discrete ticks (~10 ms per core), so a ratio taken over a very short
 * window is numerically meaningless: on an idle host the same code reported
 * anywhere from 62% to 94% CPU purely as a function of how long the sample
 * window happened to be.
 *
 * This script quantifies that behaviour so the guard's minimum sample window
 * can be justified from measurements rather than from intuition.
 *
 * USAGE
 *   node scripts/smoke/cpu-sample-window-probe.mjs
 *
 * It prints JSON to stdout and writes `cpu-sample-window.json` next to the
 * project root. It performs no network access and mutates nothing.
 */
import fs from 'node:fs';
import os from 'node:os';

/** Aggregate all core timers into one idle/total pair. */
function cpuTimes() {
  return os.cpus().reduce((sum, cpu) => {
    const t = cpu.times;
    const total = t.user + t.nice + t.sys + t.irq + t.idle;
    return { idle: sum.idle + t.idle, total: sum.total + total };
  }, { idle: 0, total: 0 });
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Measure CPU utilisation across one window.
 * @param {number} windowMs requested window length
 * @param {boolean} busy whether to burn CPU for the duration
 */
async function measure(windowMs, busy) {
  const before = cpuTimes();
  const startedAt = Date.now();

  const load = busy
    ? (async () => {
        const end = Date.now() + windowMs;
        while (Date.now() < end) Math.sqrt(Math.random() * 1e9);
      })()
    : Promise.resolve();

  await sleep(windowMs);

  const after = cpuTimes();
  const wallMs = Date.now() - startedAt;
  await load;

  const totalDelta = after.total - before.total;
  const idleDelta = after.idle - before.idle;
  const cpuPercent = totalDelta > 0 ? (1 - idleDelta / totalDelta) * 100 : null;

  return {
    windowMs,
    wallMs,
    totalDelta,
    idleDelta,
    cpuPercent: cpuPercent === null ? null : Number(cpuPercent.toFixed(1)),
  };
}

const WINDOWS = [1, 5, 10, 25, 50, 100, 150, 250, 500, 1000];

const idle = [];
for (const w of WINDOWS) idle.push(await measure(w, false));

const busy = [];
for (const w of WINDOWS) busy.push(await measure(w, true));

const report = { cores: os.cpus().length, windows: WINDOWS, idle, busy };
fs.writeFileSync('cpu-sample-window.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
