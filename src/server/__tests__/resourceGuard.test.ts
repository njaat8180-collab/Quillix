import { describe, expect, it } from 'vitest';
import { ResourceGuard, parseWindowsStoragePayload } from '../resourceGuard.js';
import { setOverdriveActive } from '../../shared/overdriveState.js';

describe('resource-aware execution guard', () => {
  it('reports the current memory and workspace-volume snapshot without gating on it', () => {
    const result = new ResourceGuard({ maxCpuPercent: 100, minDiskFreePercent: 0 }).evaluate(process.cwd());
    expect(result.allowed).toBe(true);
    expect(result.snapshot.memoryUsedPercent).toBeGreaterThanOrEqual(0);
    expect(result.snapshot.memoryUsedPercent).toBeLessThanOrEqual(100);
    expect(result.snapshot.sampledAt).toBeGreaterThan(0);
  });

  it('blocks a heavy step when configured CPU limits are exceeded', async () => {
    const guard = new ResourceGuard({ maxCpuPercent: -1 });
    // CPU usage is sampled between constructor and evaluation, so let the
    // process times advance before asserting the gate.
    await new Promise(resolve => setTimeout(resolve, 50));
    const result = guard.evaluate(process.cwd());
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/CPU/i);
  });

  it('never terminates processes and returns a bounded blocked result', async () => {
    const result = await new ResourceGuard({ maxCpuPercent: -1 }).waitUntilSafe(process.cwd(), { maxWaitMs: 0 });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  it('awaits an async blocked callback so owned model cleanup can finish before polling', async () => {
    let callbackFinished = false;
    const result = await new ResourceGuard({ maxCpuPercent: -1 }).waitUntilSafe(process.cwd(), {
      maxWaitMs: 5000,
      intervalMs: 250,
      onBlocked: async () => { await new Promise(resolve => setTimeout(resolve, 10)); callbackFinished = true; },
    });
    expect(result.allowed).toBe(false);
    expect(callbackFinished).toBe(true);
  });

  it('clears a block once the system limit allows work again', async () => {
    let relaxed = false;
    const result = await new ResourceGuard({ maxCpuPercent: 100, minDiskFreePercent: 0 }).waitUntilSafe(process.cwd(), {
      maxWaitMs: 5000,
      intervalMs: 250,
      getLimits: () => ({ maxCpuPercent: relaxed ? 100 : -1 }),
      onBlocked: () => { relaxed = true; },
    });
    expect(result.allowed).toBe(true);
  });

  it('bypasses every resource wait in Overdrive Mode and restores gating afterwards', async () => {
    setOverdriveActive(true);
    let blockedCalls = 0;
    try {
      const direct = new ResourceGuard({ maxCpuPercent: -1, minDiskFreePercent: -1 }).evaluate(process.cwd());
      expect(direct.allowed).toBe(true);
      const waited = await new ResourceGuard({ maxCpuPercent: -1, minDiskFreePercent: -1 }).waitUntilSafe(process.cwd(), {
        maxWaitMs: 0,
        onBlocked: () => { blockedCalls++; },
      });
      expect(waited.allowed).toBe(true);
      expect(blockedCalls).toBe(0);
    } finally { setOverdriveActive(false); }
    // Once Overdrive is off the gate is armed again. Construct first, then let
    // the CPU sample advance before evaluating (CPU deltas need real time
    // between the constructor sample and the evaluation).
    const armedGuard = new ResourceGuard({ maxCpuPercent: -1 });
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(armedGuard.evaluate(process.cwd()).allowed).toBe(false);
  });

  it('parses healthy physical disks and every valid logical drive', () => {
    const parsed = parseWindowsStoragePayload({
      physical: [{ HealthStatus: 'Healthy', OperationalStatus: 'OK', FriendlyName: 'NVMe' }],
      logical: [
        { DeviceID: 'C:', FreeSpace: 25, Size: 100 },
        { DeviceID: 'D:', FreeSpace: 5, Size: 100 },
        { DeviceID: 'E:', FreeSpace: 0, Size: 0 },
      ],
    });
    expect(parsed.storageHealth).toBe('healthy');
    expect(parsed.logicalDrives).toEqual([
      { drive: 'C:', freePercent: 25, freeBytes: 25, totalBytes: 100 },
      { drive: 'D:', freePercent: 5, freeBytes: 5, totalBytes: 100 },
    ]);
  });

  it('fails closed on unhealthy physical telemetry and malformed drive values', () => {
    const parsed = parseWindowsStoragePayload({
      physical: { HealthStatus: 'Warning', OperationalStatus: 'OK', FriendlyName: 'Archive SSD' },
      logical: { DeviceID: 'F:', FreeSpace: 'not-a-number', Size: 100 },
    });
    expect(parsed.storageHealth).toBe('unhealthy');
    expect(parsed.storageDetail).toBe('Archive SSD');
    expect(parsed.logicalDrives).toEqual([]);
  });
});
