/**
 * Terminal self-healing engine (Part 3).
 *
 * A failing build/test command is classified into a small set of failure
 * classes, and only the classes with a *deterministic* repair are healed
 * automatically (missing dependency, missing directory, workspace port
 * conflict). Everything else (syntax errors, failing assertions, permission
 * denials) is handed back to the model repair loop untouched — a wrong
 * automatic edit is worse than no edit.
 *
 * Pure and dependency-injected so classification, planning and history are
 * unit-tested without touching the filesystem, the network or a real shell.
 *
 * Safety rules enforced here, not by convention:
 *  - a repair command is only built from a validated package name, a
 *    workspace-relative path or a numeric port (never from raw error text),
 *  - a dependency is only installed when the project really has a manifest
 *    for that ecosystem,
 *  - a listening process is only terminated when its command line points at
 *    the workspace that failed,
 *  - every attempt is journalled, bounded and visible to the user.
 */

export type TerminalFailureCategory =
  | 'missing-dependency'
  | 'missing-module'
  | 'missing-directory'
  | 'missing-file'
  | 'port-conflict'
  | 'permission-denied'
  | 'syntax-error'
  | 'timeout'
  | 'test-failure'
  | 'unknown';

export type SelfHealStrategy =
  | 'install-dependency'
  | 'create-directory'
  | 'free-workspace-port'
  | 'none';

export type SelfHealEcosystem = 'npm' | 'pip' | 'unknown';

export interface ClassifiedTerminalFailure {
  category: TerminalFailureCategory;
  /** 0..1 — how strongly the output matches the class. */
  confidence: number;
  summary: string;
  /** The deterministic repair to attempt, or `none` when the model must fix it. */
  strategy: SelfHealStrategy;
  /** True only when a deterministic repair can plausibly fix this failure. */
  retryable: boolean;
  ecosystem?: SelfHealEcosystem;
  packageName?: string;
  relativePath?: string;
  port?: number;
}

const NPM_PACKAGE = /^[@a-z0-9][a-z0-9@._/-]*$/i;
const PIP_PACKAGE = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

function firstMatch(text: string, patterns: RegExp[]): RegExpExecArray | null {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) return match;
  }
  return null;
}

/** Normalize a path captured from an error message to a workspace-relative path. */
export function normalizeRelativePath(candidate: string | undefined): string | undefined {
  if (!candidate) return undefined;
  let value = candidate.trim().replace(/^['"`]|['"`]$/g, '');
  value = value.replace(/\\/g, '/');
  if (!value) return undefined;
  value = value.replace(/^[A-Za-z]:\//, '').replace(/^\/+/, '');
  const segments: string[] = [];
  for (const segment of value.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') return undefined; // never escape the workspace
    segments.push(segment);
  }
  return segments.length ? segments.join('/') : undefined;
}

/**
 * Classify a failed command output. Pure: the same text always yields the
 * same class, so the repair loop can rely on it.
 */
export function classifyTerminalFailure(output: string, exitCode?: number): ClassifiedTerminalFailure {
  const text = String(output || '');
  const base = { confidence: 0, ecosystem: undefined as SelfHealEcosystem | undefined };

  // Node: `Cannot find module 'express'` — a package, not a local file.
  const nodeModule = firstMatch(text, [
    /Cannot find module ['"]([^'"]+)['"]/,
    /Error: Cannot find module '([^']+)'/,
  ]);
  if (nodeModule) {
    const name = nodeModule[1];
    if (/^[./]/.test(name)) {
      const relativePath = normalizeRelativePath(name);
      return {
        ...base,
        category: 'missing-file',
        confidence: 0.9,
        summary: `Local module not found: ${name}`,
        strategy: 'none',
        retryable: false,
        relativePath,
      };
    }
    const valid = NPM_PACKAGE.test(name) && name.length <= 100;
    return {
      ...base,
      category: 'missing-dependency',
      confidence: valid ? 0.85 : 0.4,
      summary: `Dependency not installed: ${name}`,
      strategy: valid ? 'install-dependency' : 'none',
      retryable: valid,
      ecosystem: 'npm',
      packageName: valid ? name : undefined,
    };
  }

  // Python: `ModuleNotFoundError: No module named 'requests'`
  const pythonModule = firstMatch(text, [/No module named ['"]([A-Za-z0-9_.-]+)['"]/]);
  if (pythonModule) {
    const name = pythonModule[1];
    const valid = PIP_PACKAGE.test(name) && name.length <= 100;
    return {
      ...base,
      category: 'missing-dependency',
      confidence: valid ? 0.8 : 0.35,
      summary: `Python dependency not installed: ${name}`,
      strategy: valid ? 'install-dependency' : 'none',
      retryable: valid,
      ecosystem: 'pip',
      packageName: valid ? name : undefined,
    };
  }

  // `ENOENT: no such file or directory, mkdir 'build/app'`
  const missingDir = firstMatch(text, [
    /ENOENT[^\n]*?(?:mkdir|makedirs) ['"]([^'"]+)['"]/i,
    /cannot find the path specified[^\n]*?['"]([^'"]+)['"]/i,
  ]);
  if (missingDir) {
    const relativePath = normalizeRelativePath(missingDir[1]);
    return {
      ...base,
      category: 'missing-directory',
      confidence: relativePath ? 0.8 : 0.4,
      summary: `Working directory missing: ${missingDir[1]}`,
      strategy: relativePath ? 'create-directory' : 'none',
      retryable: !!relativePath,
      relativePath,
    };
  }

  // `ENOENT: no such file or directory, open 'src/app.js'`
  const missingFile = firstMatch(text, [
    /ENOENT[^\n]*?open ['"]([^'"]+)['"]/i,
    /no such file or directory: ['"]?([^'"\n]+)['"]?/i,
    /cannot find module path ['"]([^'"]+)['"]/i,
  ]);
  if (missingFile) {
    const relativePath = normalizeRelativePath(missingFile[1]);
    return {
      ...base,
      category: 'missing-file',
      confidence: 0.6,
      summary: `File not found: ${missingFile[1]}`,
      strategy: 'none',
      retryable: false,
      relativePath,
    };
  }

  // `EADDRINUSE: address already in use :::3000`
  const portInUse = firstMatch(text, [/(?:EADDRINUSE|address already in use)[^\n]*?:(\d{2,5})\b/]);
  if (portInUse) {
    const port = Number(portInUse[1]);
    const valid = Number.isInteger(port) && port > 0 && port < 65536;
    return {
      ...base,
      category: 'port-conflict',
      confidence: valid ? 0.85 : 0.4,
      summary: `Port ${portInUse[1]} is already in use`,
      strategy: valid ? 'free-workspace-port' : 'none',
      retryable: valid,
      port: valid ? port : undefined,
    };
  }

  if (/EACCES|EPERM|permission denied|access is denied/i.test(text)) {
    return {
      ...base,
      category: 'permission-denied',
      confidence: 0.8,
      summary: 'Permission denied',
      strategy: 'none',
      retryable: false,
    };
  }

  if (/SyntaxError|Unexpected token|Unexpected identifier|ParseError/i.test(text)) {
    return {
      ...base,
      category: 'syntax-error',
      confidence: 0.75,
      summary: 'Syntax error in the generated code',
      strategy: 'none',
      retryable: false,
    };
  }

  if (/timed out|ETIMEDOUT|Timeout - Async callback was not invoked/i.test(text) || exitCode === 124) {
    return {
      ...base,
      category: 'timeout',
      confidence: 0.7,
      summary: 'Command timed out',
      strategy: 'none',
      retryable: false,
    };
  }

  if (/(?:^|\n)\s*(?:FAIL|FAILED|AssertionError|✕|✖)|expected .* (?:to|but) |tests? failed/i.test(text)) {
    return {
      ...base,
      category: 'test-failure',
      confidence: 0.6,
      summary: 'Test or assertion failure',
      strategy: 'none',
      retryable: false,
    };
  }

  return {
    ...base,
    category: 'unknown',
    confidence: 0.2,
    summary: 'Unclassified command failure',
    strategy: 'none',
    retryable: false,
  };
}

export interface SelfHealCommandResult {
  exitCode: number;
  output: string;
}

export interface SelfHealPlan {
  strategy: SelfHealStrategy;
  /** The exact command to run, already validated. */
  command?: string;
  /** Human readable reason for the plan. */
  reason: string;
}

export interface SelfHealContext {
  /** Root of the project that failed (manifests are looked up here). */
  projectRoot: string;
  /** Root of the workspace (paths are validated against it). */
  workspaceRoot: string;
  /** True when a `package.json` exists in the project root. */
  hasNpmManifest?: boolean;
  /** True when a Python manifest exists in the project root. */
  hasPipManifest?: boolean;
}

export interface SelfHealDeps {
  runCommand(command: string, cwd: string, timeoutMs?: number): Promise<SelfHealCommandResult>;
  fileExists(relativePath: string): boolean;
  directoryExists(relativePath: string): boolean;
  makeDirectory(relativePath: string): void;
  /** Find the process listening on `port`; only workspace-owned processes may be killed. */
  findWorkspacePortOwner(port: number): Promise<{ pid: number; commandLine: string } | null>;
  terminateProcess(pid: number): Promise<boolean>;
  now(): number;
}

export interface SelfHealEntry {
  id: string;
  at: number;
  category: TerminalFailureCategory;
  strategy: SelfHealStrategy;
  status: 'healed' | 'attempted' | 'skipped' | 'failed';
  summary: string;
  detail?: string;
  command?: string;
  durationMs: number;
  verified?: boolean;
  verificationOutput?: string;
}

export interface SelfHealResult {
  healed: boolean;
  entry: SelfHealEntry | null;
  /** Output of the verification re-run, when the original command was re-run. */
  rerun?: SelfHealCommandResult;
}

export interface SelfHealOptions {
  enabled?: boolean;
  maxAttempts?: number;
  historyLimit?: number;
  repairTimeoutMs?: number;
  /** Called for every journalled entry (used to share history across runs). */
  onEntry?: (entry: SelfHealEntry) => void;
}

/**
 * Build the repair command for a classified failure. Returns `null` when no
 * safe deterministic repair exists for the current project context.
 */
export function planSelfHeal(
  failure: ClassifiedTerminalFailure,
  context: SelfHealContext,
): SelfHealPlan | null {
  if (!failure.retryable || failure.strategy === 'none') return null;

  if (failure.strategy === 'install-dependency') {
    const name = failure.packageName;
    if (!name) return null;
    if (failure.ecosystem === 'npm') {
      if (!context.hasNpmManifest || !NPM_PACKAGE.test(name)) return null;
      return { strategy: 'install-dependency', command: `npm install ${name}`, reason: `Install missing npm package ${name}` };
    }
    if (failure.ecosystem === 'pip') {
      if (!context.hasPipManifest || !PIP_PACKAGE.test(name)) return null;
      return { strategy: 'install-dependency', command: `python -m pip install ${name}`, reason: `Install missing Python package ${name}` };
    }
    return null;
  }

  if (failure.strategy === 'create-directory') {
    const relativePath = failure.relativePath;
    if (!relativePath) return null;
    return { strategy: 'create-directory', command: `mkdir "${relativePath}"`, reason: `Create missing directory ${relativePath}` };
  }

  if (failure.strategy === 'free-workspace-port') {
    if (!failure.port) return null;
    return { strategy: 'free-workspace-port', reason: `Release the workspace process holding port ${failure.port}` };
  }

  return null;
}

export interface SelfHealInput {
  /** Raw output of the failed command. */
  failureText: string;
  exitCode?: number;
  projectRoot: string;
  workspaceRoot: string;
  /** The command that failed — re-run after a repair to verify the fix. */
  command?: string;
  cwd?: string;
  signal?: AbortSignal;
}

/**
 * Applies deterministic repairs for terminal failures and keeps a bounded,
 * inspectable history of every attempt.
 */
export class SelfHealingEngine {
  private readonly deps: SelfHealDeps;
  private readonly enabled: boolean;
  private readonly maxAttempts: number;
  private readonly historyLimit: number;
  private readonly repairTimeoutMs: number;
  private readonly onEntry?: (entry: SelfHealEntry) => void;
  private readonly entries: SelfHealEntry[] = [];
  private readonly appliedSignatures = new Set<string>();
  private attempts = 0;
  private sequence = 0;

  constructor(deps: SelfHealDeps, options: SelfHealOptions = {}) {
    this.deps = deps;
    this.enabled = options.enabled !== false;
    this.maxAttempts = Math.max(1, Math.min(10, options.maxAttempts ?? 3));
    this.historyLimit = Math.max(1, Math.min(500, options.historyLimit ?? 100));
    this.repairTimeoutMs = Math.max(1000, Math.min(600_000, options.repairTimeoutMs ?? 120_000));
    this.onEntry = options.onEntry;
  }

  public history(limit = 20): SelfHealEntry[] {
    const bounded = Math.max(1, Math.min(this.historyLimit, limit));
    return this.entries.slice(-bounded).reverse();
  }

  public clear(): void {
    this.entries.length = 0;
  }

  public get attemptsUsed(): number {
    return this.attempts;
  }

  private record(entry: SelfHealEntry): SelfHealEntry {
    this.entries.push(entry);
    while (this.entries.length > this.historyLimit) this.entries.shift();
    try { this.onEntry?.(entry); } catch { /* history must never break a repair */ }
    return entry;
  }

  private journal(
    failure: ClassifiedTerminalFailure,
    status: SelfHealEntry['status'],
    summary: string,
    extra: Partial<SelfHealEntry> = {},
  ): SelfHealEntry {
    this.sequence += 1;
    return this.record({
      id: `heal_${this.sequence}_${this.deps.now()}`,
      at: this.deps.now(),
      category: failure.category,
      strategy: failure.strategy,
      status,
      summary,
      durationMs: 0,
      ...extra,
    });
  }

  /**
   * Classify, repair and verify a failed command. Never throws: a failed
   * self-heal must not break the agent loop that called it.
   */
  public async heal(input: SelfHealInput): Promise<SelfHealResult> {
    const startedAt = this.deps.now();
    let failure: ClassifiedTerminalFailure;
    try {
      failure = classifyTerminalFailure(input.failureText, input.exitCode);
    } catch {
      failure = { category: 'unknown', confidence: 0, summary: 'Unclassified command failure', strategy: 'none', retryable: false };
    }

    if (!this.enabled) {
      return { healed: false, entry: this.journal(failure, 'skipped', 'Self-healing is disabled') };
    }

    if (this.attempts >= this.maxAttempts) {
      return {
        healed: false,
        entry: this.journal(failure, 'skipped', `Self-healing attempt budget exhausted (${this.maxAttempts})`),
      };
    }

    const context: SelfHealContext = {
      projectRoot: input.projectRoot,
      workspaceRoot: input.workspaceRoot,
      hasNpmManifest: this.deps.fileExists('package.json'),
      hasPipManifest: this.deps.fileExists('requirements.txt') || this.deps.fileExists('pyproject.toml'),
    };

    const plan = planSelfHeal(failure, context);
    if (!plan) {
      return {
        healed: false,
        entry: this.journal(failure, 'skipped', `${failure.summary} — no safe automatic repair available`, {
          detail: failure.summary,
        }),
      };
    }

    const signature = `${plan.strategy}:${failure.packageName || failure.relativePath || failure.port || ''}`;
    if (this.appliedSignatures.has(signature)) {
      return {
        healed: false,
        entry: this.journal(failure, 'skipped', `${plan.reason} — already attempted for this failure`),
      };
    }
    this.appliedSignatures.add(signature);
    this.attempts += 1;

    try {
      const applied = await this.applyPlan(plan, failure, input);
      if (!applied.ok) {
        return {
          healed: false,
          entry: this.journal(failure, 'failed', applied.reason, {
            detail: applied.detail,
            command: plan.command,
            durationMs: this.deps.now() - startedAt,
          }),
        };
      }

      // Verify by replaying the original command — a repair only counts as a
      // success when the real command passes afterwards.
      let rerun: SelfHealCommandResult | undefined;
      let verified = false;
      if (input.command) {
        rerun = await this.deps.runCommand(input.command, input.cwd || input.projectRoot, this.repairTimeoutMs);
        verified = rerun.exitCode === 0;
      }

      return {
        healed: verified,
        rerun,
        entry: this.journal(
          failure,
          verified ? 'healed' : 'attempted',
          verified ? `${plan.reason} — verified by re-running the command` : `${plan.reason} — verification did not pass`,
          {
            detail: applied.detail,
            command: plan.command,
            durationMs: this.deps.now() - startedAt,
            verified,
            ...(rerun ? { verificationOutput: rerun.output.slice(-800) } : {}),
          },
        ),
      };
    } catch (error: any) {
      return {
        healed: false,
        entry: this.journal(failure, 'failed', `${plan.reason} failed`, {
          detail: String(error?.message || error || '').slice(0, 400),
          command: plan.command,
          durationMs: this.deps.now() - startedAt,
        }),
      };
    }
  }

  private async applyPlan(
    plan: SelfHealPlan,
    failure: ClassifiedTerminalFailure,
    input: SelfHealInput,
  ): Promise<{ ok: boolean; reason: string; detail?: string }> {
    if (plan.strategy === 'install-dependency') {
      const result = await this.deps.runCommand(plan.command!, input.projectRoot, this.repairTimeoutMs);
      if (result.exitCode !== 0) {
        return { ok: false, reason: `Install failed: ${result.output.slice(-200)}`, detail: result.output.slice(-800) };
      }
      return { ok: true, reason: plan.reason, detail: result.output.slice(-400) };
    }

    if (plan.strategy === 'create-directory') {
      const relativePath = failure.relativePath!;
      if (this.deps.directoryExists(relativePath)) {
        return { ok: false, reason: `Directory already exists: ${relativePath}` };
      }
      this.deps.makeDirectory(relativePath);
      if (!this.deps.directoryExists(relativePath)) {
        return { ok: false, reason: `Could not create directory ${relativePath}` };
      }
      return { ok: true, reason: plan.reason };
    }

    if (plan.strategy === 'free-workspace-port') {
      const port = failure.port!;
      const owner = await this.deps.findWorkspacePortOwner(port);
      if (!owner) return { ok: false, reason: `No process is holding port ${port}` };
      // Only a process that belongs to this workspace may be terminated.
      const commandLine = String(owner.commandLine || '').toLowerCase();
      const workspace = String(input.workspaceRoot || '').toLowerCase();
      if (!workspace || !commandLine.includes(workspace)) {
        return {
          ok: false,
          reason: `Port ${port} is held by a process outside the workspace — left untouched`,
          detail: String(owner.commandLine || '').slice(0, 300),
        };
      }
      const killed = await this.deps.terminateProcess(owner.pid);
      if (!killed) return { ok: false, reason: `Could not stop the workspace process on port ${port}` };
      return { ok: true, reason: plan.reason, detail: `Stopped pid ${owner.pid}` };
    }

    return { ok: false, reason: `Unsupported strategy ${plan.strategy}` };
  }
}




