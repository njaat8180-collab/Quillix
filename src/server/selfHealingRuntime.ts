/**
 * Runtime wiring for the terminal self-healing engine (Part 3).
 *
 * The decision logic lives in `selfHealing.ts` (pure, unit-tested). This file
 * only provides the real side effects — filesystem, shell and process
 * inspection — and keeps a process-wide, bounded repair history that the UI
 * and the HTTP API read.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  SelfHealingEngine,
  type SelfHealDeps,
  type SelfHealEntry,
  type SelfHealCommandResult,
} from './selfHealing.js';

const execFileAsync = promisify(execFile);

const HISTORY_LIMIT = 100;
const history: SelfHealEntry[] = [];

function pushHistory(entry: SelfHealEntry): void {
  history.push(entry);
  while (history.length > HISTORY_LIMIT) history.shift();
}

/** Recent self-healing attempts, newest first. */
export function selfHealHistory(limit = 20): SelfHealEntry[] {
  const bounded = Math.max(1, Math.min(HISTORY_LIMIT, limit));
  return history.slice(-bounded).reverse();
}

export function clearSelfHealHistory(): void {
  history.length = 0;
}

async function execWithTimeout(command: string, args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
  const result = await execFileAsync(command, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 512 * 1024 });
  return { stdout: String(result.stdout || ''), stderr: String(result.stderr || '') };
}

/**
 * Find the process listening on `port`. On Windows the owning pid comes from
 * `netstat -ano` and the command line from CIM; on POSIX `lsof` is used.
 * Returns `null` when the port is free or the owner cannot be identified.
 */
export async function findWorkspacePortOwner(port: number): Promise<{ pid: number; commandLine: string } | null> {
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;
  try {
    if (process.platform === 'win32') {
      const { stdout } = await execWithTimeout('netstat.exe', ['-ano'], 8_000);
      const pidMatch = stdout
        .split(/\r?\n/)
        .filter(line => new RegExp(`[:.]${port}\\s`).test(line) && /LISTENING/i.test(line))
        .map(line => line.trim().split(/\s+/).pop())
        .find(value => value && /^\d+$/.test(value));
      if (!pidMatch) return null;
      const pid = Number(pidMatch);
      const { stdout: commandLine } = await execWithTimeout(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" -ErrorAction SilentlyContinue).CommandLine`],
        10_000,
      );
      return { pid, commandLine: commandLine.trim() };
    }
    const { stdout } = await execWithTimeout('lsof', ['-ti', `:${port}`], 8_000);
    const pid = Number((stdout.split(/\r?\n/).find(line => /^\d+$/.test(line.trim())) || '').trim());
    if (!Number.isInteger(pid) || pid <= 0) return null;
    const { stdout: commandLine } = await execWithTimeout('ps', ['-p', String(pid), '-o', 'command='], 8_000);
    return { pid, commandLine: commandLine.trim() };
  } catch {
    return null;
  }
}

/** Stop a process that the self-healing engine already proved to be workspace-owned. */
export async function terminateProcess(pid: number): Promise<boolean> {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    if (process.platform === 'win32') {
      await execWithTimeout('taskkill.exe', ['/PID', String(pid), '/F'], 10_000);
      return true;
    }
    process.kill(pid, 'SIGTERM');
    return true;
  } catch {
    return false;
  }
}

export interface SelfHealingRuntimeOptions {
  workspaceRoot: string;
  projectRoot: string;
  runCommand: (command: string, cwd: string, timeoutMs?: number) => Promise<SelfHealCommandResult>;
  enabled?: boolean;
  maxAttempts?: number;
}

/** Build an engine bound to a real workspace and the agent's command runner. */
export function createSelfHealingEngine(options: SelfHealingRuntimeOptions): SelfHealingEngine {
  const projectRoot = path.resolve(options.projectRoot);
  const deps: SelfHealDeps = {
    runCommand: (command, cwd, timeoutMs) => options.runCommand(command, cwd, timeoutMs),
    fileExists: relativePath => {
      try { return fs.existsSync(path.resolve(projectRoot, relativePath)); } catch { return false; }
    },
    directoryExists: relativePath => {
      try { return fs.statSync(path.resolve(projectRoot, relativePath)).isDirectory(); } catch { return false; }
    },
    makeDirectory: relativePath => {
      fs.mkdirSync(path.resolve(projectRoot, relativePath), { recursive: true });
    },
    findWorkspacePortOwner,
    terminateProcess,
    now: () => Date.now(),
  };
  return new SelfHealingEngine(deps, {
    enabled: options.enabled,
    maxAttempts: options.maxAttempts,
    onEntry: pushHistory,
  });
}
