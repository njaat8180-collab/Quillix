import { describe, expect, it, vi } from 'vitest';
import {
  classifyTerminalFailure,
  normalizeRelativePath,
  planSelfHeal,
  SelfHealingEngine,
  type SelfHealDeps,
} from '../selfHealing.js';

const WORKSPACE = 'D:/workspace/demo';
const PROJECT = 'D:/workspace/demo/app';

function deps(overrides: Partial<SelfHealDeps> = {}): SelfHealDeps {
  return {
    runCommand: vi.fn(async () => ({ exitCode: 0, output: 'ok' })),
    fileExists: vi.fn(() => false),
    directoryExists: vi.fn(() => false),
    makeDirectory: vi.fn(),
    findWorkspacePortOwner: vi.fn(async () => null),
    terminateProcess: vi.fn(async () => true),
    now: () => 1_700_000_000_000,
    ...overrides,
  };
}

describe('classifyTerminalFailure', () => {
  it('classifies a missing node dependency as installable', () => {
    const failure = classifyTerminalFailure("Error: Cannot find module 'express'");
    expect(failure.category).toBe('missing-dependency');
    expect(failure.strategy).toBe('install-dependency');
    expect(failure.ecosystem).toBe('npm');
    expect(failure.packageName).toBe('express');
    expect(failure.retryable).toBe(true);
  });

  it('never auto-fixes a missing local module', () => {
    const failure = classifyTerminalFailure("Error: Cannot find module './lib/helper.js'");
    expect(failure.category).toBe('missing-file');
    expect(failure.strategy).toBe('none');
    expect(failure.retryable).toBe(false);
  });

  it('classifies a missing python dependency', () => {
    const failure = classifyTerminalFailure("ModuleNotFoundError: No module named 'requests'");
    expect(failure.category).toBe('missing-dependency');
    expect(failure.ecosystem).toBe('pip');
    expect(failure.packageName).toBe('requests');
  });

  it('classifies a missing directory and a port conflict', () => {
    const missing = classifyTerminalFailure("Error: ENOENT: no such file or directory, mkdir 'build/app'");
    expect(missing.category).toBe('missing-directory');
    expect(missing.strategy).toBe('create-directory');
    expect(missing.relativePath).toBe('build/app');

    const port = classifyTerminalFailure('Error: listen EADDRINUSE: address already in use :::3000');
    expect(port.category).toBe('port-conflict');
    expect(port.port).toBe(3000);
    expect(port.strategy).toBe('free-workspace-port');
  });

  it('never auto-fixes permission, syntax, timeout or test failures', () => {
    for (const output of [
      'EACCES: permission denied, open "/etc/hosts"',
      'SyntaxError: Unexpected token }',
      'command timed out after 20000ms',
      'FAIL src/app.test.ts\nAssertionError: expected 1 to be 2',
    ]) {
      const failure = classifyTerminalFailure(output);
      expect(failure.retryable).toBe(false);
      expect(failure.strategy).toBe('none');
    }
  });

  it('falls back to unknown without inventing a repair', () => {
    const failure = classifyTerminalFailure('something went sideways');
    expect(failure.category).toBe('unknown');
    expect(failure.strategy).toBe('none');
  });
});

describe('normalizeRelativePath', () => {
  it('keeps workspace-relative paths and rejects escapes', () => {
    expect(normalizeRelativePath('build/app')).toBe('build/app');
    expect(normalizeRelativePath('D:\\workspace\\demo\\build')).toBe('workspace/demo/build');
    expect(normalizeRelativePath('../outside')).toBeUndefined();
    expect(normalizeRelativePath('a/../../b')).toBeUndefined();
  });
});

describe('planSelfHeal', () => {
  it('installs an npm dependency only when the project has a manifest', () => {
    const failure = classifyTerminalFailure("Cannot find module 'express'");
    expect(planSelfHeal(failure, { projectRoot: PROJECT, workspaceRoot: WORKSPACE })).toBeNull();
    const plan = planSelfHeal(failure, { projectRoot: PROJECT, workspaceRoot: WORKSPACE, hasNpmManifest: true });
    expect(plan?.command).toBe('npm install express');
  });

  it('installs a python dependency only when the project has a python manifest', () => {
    const failure = classifyTerminalFailure("No module named 'requests'");
    expect(planSelfHeal(failure, { projectRoot: PROJECT, workspaceRoot: WORKSPACE })).toBeNull();
    const plan = planSelfHeal(failure, { projectRoot: PROJECT, workspaceRoot: WORKSPACE, hasPipManifest: true });
    expect(plan?.command).toBe('python -m pip install requests');
  });

  it('never plans a repair for a failure without a deterministic strategy', () => {
    const failure = classifyTerminalFailure('SyntaxError: Unexpected token }');
    expect(planSelfHeal(failure, { projectRoot: PROJECT, workspaceRoot: WORKSPACE, hasNpmManifest: true })).toBeNull();
  });
});

describe('SelfHealingEngine', () => {
  it('installs a missing dependency and verifies it by re-running the command', async () => {
    const calls: string[] = [];
    const engine = new SelfHealingEngine(
      deps({
        fileExists: (relative) => relative === 'package.json',
        runCommand: vi.fn(async (command: string) => {
          calls.push(command);
          return { exitCode: 0, output: 'ok' };
        }),
      }),
    );
    const result = await engine.heal({
      failureText: "Cannot find module 'express'",
      exitCode: 1,
      projectRoot: PROJECT,
      workspaceRoot: WORKSPACE,
      command: 'node index.js',
      cwd: PROJECT,
    });
    expect(result.healed).toBe(true);
    expect(calls).toEqual(['npm install express', 'node index.js']);
    expect(result.entry?.status).toBe('healed');
    expect(engine.history()[0].category).toBe('missing-dependency');
  });

  it('does not claim success when the verification re-run still fails', async () => {
    const engine = new SelfHealingEngine(
      deps({
        fileExists: (relative) => relative === 'package.json',
        runCommand: vi.fn(async (command: string) => ({
          exitCode: command.startsWith('npm install') ? 0 : 1,
          output: 'still broken',
        })),
      }),
    );
    const result = await engine.heal({
      failureText: "Cannot find module 'express'",
      exitCode: 1,
      projectRoot: PROJECT,
      workspaceRoot: WORKSPACE,
      command: 'node index.js',
      cwd: PROJECT,
    });
    expect(result.healed).toBe(false);
    expect(result.entry?.status).toBe('attempted');
    expect(result.entry?.verified).toBe(false);
  });

  it('never terminates a port owner outside the workspace', async () => {
    const terminate = vi.fn(async () => true);
    const engine = new SelfHealingEngine(
      deps({
        findWorkspacePortOwner: vi.fn(async () => ({ pid: 4242, commandLine: 'node C:/other/app/server.js' })),
        terminateProcess: terminate,
      }),
    );
    const result = await engine.heal({
      failureText: 'EADDRINUSE: address already in use :::3000',
      exitCode: 1,
      projectRoot: PROJECT,
      workspaceRoot: WORKSPACE,
      command: 'node server.js',
      cwd: PROJECT,
    });
    expect(terminate).not.toHaveBeenCalled();
    expect(result.healed).toBe(false);
    expect(result.entry?.status).toBe('failed');
    expect(result.entry?.summary).toMatch(/outside the workspace/i);
  });

  it('stops a workspace-owned port holder', async () => {
    const terminate = vi.fn(async () => true);
    const engine = new SelfHealingEngine(
      deps({
        findWorkspacePortOwner: vi.fn(async () => ({ pid: 4242, commandLine: `node ${WORKSPACE}/server.js` })),
        terminateProcess: terminate,
        runCommand: vi.fn(async () => ({ exitCode: 0, output: 'listening' })),
      }),
    );
    const result = await engine.heal({
      failureText: 'EADDRINUSE: address already in use :::3000',
      exitCode: 1,
      projectRoot: PROJECT,
      workspaceRoot: WORKSPACE,
      command: 'node server.js',
      cwd: PROJECT,
    });
    expect(terminate).toHaveBeenCalledWith(4242);
    expect(result.healed).toBe(true);
  });

  it('creates a missing directory inside the workspace', async () => {
    const created: string[] = [];
    let exists = false;
    const engine = new SelfHealingEngine(
      deps({
        directoryExists: () => exists,
        makeDirectory: (relative) => {
          created.push(relative);
          exists = true;
        },
      }),
    );
    const result = await engine.heal({
      failureText: "ENOENT: no such file or directory, mkdir 'build/app'",
      exitCode: 1,
      projectRoot: PROJECT,
      workspaceRoot: WORKSPACE,
      command: 'node index.js',
      cwd: PROJECT,
    });
    expect(created).toEqual(['build/app']);
    expect(result.healed).toBe(true);
  });

  it('never repeats the same repair and respects the attempt budget', async () => {
    const runCommand = vi.fn(async () => ({ exitCode: 0, output: 'ok' }));
    const engine = new SelfHealingEngine(
      deps({ fileExists: (relative) => relative === 'package.json', runCommand }),
      { maxAttempts: 1 },
    );
    const input = {
      failureText: "Cannot find module 'express'",
      exitCode: 1,
      projectRoot: PROJECT,
      workspaceRoot: WORKSPACE,
      command: 'node index.js',
      cwd: PROJECT,
    };
    const first = await engine.heal(input);
    const second = await engine.heal(input);
    expect(first.healed).toBe(true);
    expect(second.healed).toBe(false);
    expect(second.entry?.status).toBe('skipped');
    expect(runCommand).toHaveBeenCalledTimes(2); // install + one verification re-run
  });

  it('journals a skipped repair for failures the model must fix', async () => {
    const engine = new SelfHealingEngine(deps());
    const result = await engine.heal({
      failureText: 'SyntaxError: Unexpected token }',
      exitCode: 1,
      projectRoot: PROJECT,
      workspaceRoot: WORKSPACE,
    });
    expect(result.healed).toBe(false);
    expect(result.entry?.status).toBe('skipped');
    expect(result.entry?.strategy).toBe('none');
  });

  it('can be disabled', async () => {
    const runCommand = vi.fn(async () => ({ exitCode: 0, output: 'ok' }));
    const engine = new SelfHealingEngine(
      deps({ fileExists: (relative) => relative === 'package.json', runCommand }),
      { enabled: false },
    );
    const result = await engine.heal({
      failureText: "Cannot find module 'express'",
      exitCode: 1,
      projectRoot: PROJECT,
      workspaceRoot: WORKSPACE,
      command: 'node index.js',
      cwd: PROJECT,
    });
    expect(result.healed).toBe(false);
    expect(result.entry?.status).toBe('skipped');
    expect(runCommand).not.toHaveBeenCalled();
  });
});

