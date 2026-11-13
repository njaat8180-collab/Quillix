import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface ResourceSnapshot {
  cpuPercent?: number;
  memoryUsedPercent: number;
  memoryFreeBytes: number;
  diskFreePercent?: number;
  diskFreeBytes?: number;
  logicalDrives?: Array<{ drive: string; freePercent: number; freeBytes: number; totalBytes: number }>;
  storageHealth: 'healthy' | 'unhealthy' | 'unknown';
  storageDetail?: string;
  sampledAt: number;
}

export interface ResourceLimits {
  maxCpuPercent: number;
  minDiskFreePercent: number;
}

export interface ResourceGateResult {
  allowed: boolean;
  snapshot: ResourceSnapshot;
  reason?: string;
}

export interface ParsedStorageTelemetry {
  storageHealth: ResourceSnapshot['storageHealth'];
  storageDetail?: string;
  logicalDrives: NonNullable<ResourceSnapshot['logicalDrives']>;
}

/** Parse the bounded PowerShell storage payload without trusting its shape. */
export function parseWindowsStoragePayload(payload: unknown): ParsedStorageTelemetry {
  const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const physicalValue = record.physical;
  const physical = Array.isArray(physicalValue) ? physicalValue : physicalValue ? [physicalValue] : [];
  const unhealthy = physical.filter((disk: any) =>
    String(disk?.HealthStatus || '').toLowerCase() !== 'healthy' ||
    String(disk?.OperationalStatus || '').toLowerCase() !== 'ok');
  const logicalValue = record.logical;
  const logical = Array.isArray(logicalValue) ? logicalValue : logicalValue ? [logicalValue] : [];
  const logicalDrives = logical.flatMap((drive: any) => {
    const totalBytes = Number(drive?.Size);
    const freeBytes = Number(drive?.FreeSpace);
    if (!Number.isFinite(totalBytes) || totalBytes <= 0 || !Number.isFinite(freeBytes) || freeBytes < 0) return [];
    return [{
      drive: String(drive?.DeviceID || 'unknown'),
      freePercent: Math.max(0, Math.min(100, (freeBytes / totalBytes) * 100)),
      freeBytes,
      totalBytes,
    }];
  });
  return {
    storageHealth: unhealthy.length ? 'unhealthy' : physical.length ? 'healthy' : 'unknown',
    ...(unhealthy.length ? { storageDetail: unhealthy.map((disk: any) => String(disk?.FriendlyName || 'physical disk')).join(', ') } : {}),
    logicalDrives,
  };
}

const DEFAULT_LIMITS: ResourceLimits = {
  maxCpuPercent: 90,
  minDiskFreePercent: 10,
};

function numberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function diskStats(root: string): { freeBytes: number; totalBytes: number } | undefined {
  try {
    const stat = (fs as typeof fs & { statfsSync?: (path: string) => { bavail: number; bfree?: number; bsize: number; blocks: number } }).statfsSync?.(root);
    if (!stat || !Number.isFinite(stat.bsize) || !Number.isFinite(stat.blocks)) return undefined;
    const freeBlocks = Number.isFinite(stat.bavail) ? stat.bavail : (stat.bfree || 0);
    return { freeBytes: Math.max(0, freeBlocks * stat.bsize), totalBytes: Math.max(0, stat.blocks * stat.bsize) };
  } catch {
    return undefined;
  }
}

function cpuTimes(): { idle: number; total: number } {
  return os.cpus().reduce((sum, cpu) => {
    const times = cpu.times;
    const total = times.user + times.nice + times.sys + times.irq + times.idle;
    return { idle: sum.idle + times.idle, total: sum.total + total };
  }, { idle: 0, total: 0 });
}

/**
 * Resource gate for expensive local-model and verification work. It is
 * deliberately read-only: it never terminates user processes. CPU is sampled
 * between calls, memory comes from the OS, and disk checks are scoped to the
 * active workspace volume.
 */
export class ResourceGuard {
  private previousCpu = cpuTimes();
  private lastStorageCheck = 0;
  private cachedStorage: { health: ResourceSnapshot['storageHealth']; detail?: string } = { health: 'unknown' };
  private cachedLogicalDrives: Array<{ drive: string; freePercent: number; freeBytes: number; totalBytes: number }> = [];
  private readonly limits: ResourceLimits;
  private readonly enforceSystemLimits: boolean;

  public constructor(limits: Partial<ResourceLimits> = {}) {
    // Unit tests use simulated providers and must not hang behind the host's
    // unrelated Ollama state. Explicit limits still exercise the real gate;
    // production and integration processes enforce it by default.
    const explicitTestOverride = process.env.QUILLIX_ENFORCE_RESOURCE_GUARD === '1' || Object.keys(limits).length > 0;
    this.enforceSystemLimits = process.env.NODE_ENV !== 'test' || explicitTestOverride;
    this.limits = {
      maxCpuPercent: limits.maxCpuPercent ?? numberEnv('QUILLIX_MAX_CPU_PERCENT', DEFAULT_LIMITS.maxCpuPercent),
      minDiskFreePercent: limits.minDiskFreePercent ?? numberEnv('QUILLIX_MIN_DISK_FREE_PERCENT', DEFAULT_LIMITS.minDiskFreePercent),
    };
  }

  public getLimits(): ResourceLimits { return { ...this.limits }; }

  public snapshot(workspaceRoot: string): ResourceSnapshot {
    const currentCpu = cpuTimes();
    const totalDelta = currentCpu.total - this.previousCpu.total;
    const idleDelta = currentCpu.idle - this.previousCpu.idle;
    this.previousCpu = currentCpu;
    const cpuPercent = totalDelta > 0 ? Math.max(0, Math.min(100, (1 - idleDelta / totalDelta) * 100)) : undefined;
    const totalMemory = os.totalmem();
    const memoryFreeBytes = os.freemem();
    const memoryUsedPercent = totalMemory > 0 ? ((totalMemory - memoryFreeBytes) / totalMemory) * 100 : 0;
    const stats = diskStats(path.parse(path.resolve(workspaceRoot)).root || workspaceRoot);
    const diskFreePercent = stats && stats.totalBytes > 0 ? (stats.freeBytes / stats.totalBytes) * 100 : undefined;
    const now = Date.now();
    if (now - this.lastStorageCheck > 30_000) {
      this.lastStorageCheck = now;
      // Physical-disk health is refreshed asynchronously by waitUntilSafe;
      // this synchronous snapshot reuses the most recent safe telemetry.
      this.cachedStorage = { health: 'unknown' };
      this.cachedLogicalDrives = [];
    }
    return {
      ...(cpuPercent === undefined ? {} : { cpuPercent }),
      memoryUsedPercent,
      memoryFreeBytes,
      ...(diskFreePercent === undefined ? {} : { diskFreePercent, diskFreeBytes: stats?.freeBytes }),
      ...(this.cachedLogicalDrives.length ? { logicalDrives: this.cachedLogicalDrives.map(drive => ({ ...drive })) } : {}),
      storageHealth: this.cachedStorage.health,
      ...(this.cachedStorage.detail ? { storageDetail: this.cachedStorage.detail } : {}),
      sampledAt: now,
    };
  }

  public evaluate(workspaceRoot: string, limits: Partial<ResourceLimits> = {}): ResourceGateResult {
    const snapshot = this.snapshot(workspaceRoot);
    const activeLimits = { ...this.limits, ...limits };
    const reasons: string[] = [];
    if (this.enforceSystemLimits) {
      if (snapshot.cpuPercent !== undefined && snapshot.cpuPercent > activeLimits.maxCpuPercent) reasons.push(`CPU ${snapshot.cpuPercent.toFixed(0)}%`);
      if (snapshot.diskFreePercent !== undefined && snapshot.diskFreePercent < activeLimits.minDiskFreePercent) reasons.push(`disk free ${snapshot.diskFreePercent.toFixed(1)}%`);
      const lowDrive = snapshot.logicalDrives?.find(drive => drive.freePercent < activeLimits.minDiskFreePercent);
      if (lowDrive) reasons.push(`${lowDrive.drive} free ${lowDrive.freePercent.toFixed(1)}%`);
      if (snapshot.storageHealth === 'unhealthy') reasons.push('physical storage is unhealthy');
    }
    return reasons.length
      ? { allowed: false, snapshot, reason: reasons.join(', ') }
      : { allowed: true, snapshot };
  }

  public async waitUntilSafe(
    workspaceRoot: string,
    options: { signal?: AbortSignal; maxWaitMs?: number; intervalMs?: number; limits?: Partial<ResourceLimits>; getLimits?: () => Partial<ResourceLimits> | Promise<Partial<ResourceLimits>>; onBlocked?: (result: ResourceGateResult) => void | Promise<void> } = {},
  ): Promise<ResourceGateResult> {
    const deadline = Date.now() + Math.max(0, options.maxWaitMs ?? 60_000);
    await this.refreshPhysicalStorageHealth();
    let result = this.evaluate(workspaceRoot, await options.getLimits?.() || options.limits);
    while (!result.allowed && Date.now() < deadline && !options.signal?.aborted) {
      await options.onBlocked?.(result);
      await new Promise<void>(resolve => setTimeout(resolve, Math.max(250, options.intervalMs ?? 5_000)));
      await this.refreshPhysicalStorageHealth();
      result = this.evaluate(workspaceRoot, await options.getLimits?.() || options.limits);
    }
    return result;
  }

  private async refreshPhysicalStorageHealth(): Promise<void> {
    if (process.platform !== 'win32' || Date.now() - this.lastStorageCheck <= 30_000) return;
    this.lastStorageCheck = Date.now();
    try {
      const result = await execFileAsync('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-Command',
        '$ErrorActionPreference="Stop"; $physical=@(Get-PhysicalDisk | Select-Object HealthStatus,OperationalStatus,FriendlyName); $logical=@(Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | Where-Object {$_.Size -gt 0} | Select-Object DeviceID,FreeSpace,Size); [pscustomobject]@{physical=$physical;logical=$logical} | ConvertTo-Json -Compress',
      ], { timeout: 3_000, windowsHide: true, maxBuffer: 64 * 1024 });
      const parsed = parseWindowsStoragePayload(JSON.parse(String(result.stdout || '')));
      this.cachedStorage = { health: parsed.storageHealth, ...(parsed.storageDetail ? { detail: parsed.storageDetail } : {}) };
      this.cachedLogicalDrives = parsed.logicalDrives;
    } catch {
      // Health telemetry must never crash or block the agent when a Windows
      // edition lacks Get-PhysicalDisk or PowerShell is unavailable.
      this.cachedStorage = { health: 'unknown' };
      this.cachedLogicalDrives = [];
    }
  }
}

