import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { clearSelfHealHistory, createSelfHealingEngine, findWorkspacePortOwner, selfHealHistory, terminateProcess } from '../selfHealingRuntime.js';

describe('self-healing runtime wiring', () => {
  const roots: string[] = [];
  const root = () => { const value = fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-selfheal-')); roots.push(value); return value; };

  afterEach(() => { clearSelfHealHistory(); for (const value of roots.splice(0)) fs.rmSync(value, { recursive: true, force: true }); });

  it('rejects invalid ports and process ids without touching the system', async () => {
    await expect(findWorkspacePortOwner(0)).resolves.toBeNull();
    await expect(findWorkspacePortOwner(-1)).resolves.toBeNull();
    await expect(findWorkspacePortOwner(70000)).resolves.toBeNull();
    await expect(findWorkspacePortOwner(1.5)).resolves.toBeNull();
    await expect(terminateProcess(0)).resolves.toBe(false);
    await expect(terminateProcess(-3)).resolves.toBe(false);
    await expect(terminateProcess(2.5)).resolves.toBe(false);
  });

  it('binds the engine to the real project filesystem', async () => {
    const workspace = root();
    const project = path.join(workspace, 'project');
    fs.mkdirSync(path.join(project, 'src'), { recursive: true });
    fs.writeFileSync(path.join(project, 'package.json'), '{}');

    const commands: Array<{ command: string; cwd: string }> = [];
    const engine = createSelfHealingEngine({
      workspaceRoot: workspace,
      projectRoot: project,
      runCommand: async (command, cwd) => { commands.push({ command, cwd }); return { exitCode: 0, output: 'ok' }; },
    });

    const result = await engine.heal({
      failureText: "Cannot find module 'left-pad'",
      exitCode: 1,
      projectRoot: project,
      workspaceRoot: workspace,
      command: 'node index.js',
    });

    expect(result.healed).toBe(true);
    expect(commands.some(entry => entry.command.includes('npm install left-pad'))).toBe(true);
  });

  it('keeps a bounded self-heal history and clears it on demand', async () => {
    const workspace = root();
    const project = path.join(workspace, 'project');
    fs.mkdirSync(path.join(project, 'src'), { recursive: true });
    fs.writeFileSync(path.join(project, 'package.json'), '{}');

    const engine = createSelfHealingEngine({
      workspaceRoot: workspace,
      projectRoot: project,
      runCommand: async () => ({ exitCode: 0, output: 'ok' }),
    });

    await engine.heal({
      failureText: "Cannot find module 'left-pad'",
      exitCode: 1,
      projectRoot: project,
      workspaceRoot: workspace,
      command: 'node index.js',
    });

    const history = selfHealHistory(10);
    expect(history.length).toBeGreaterThan(0);
    expect(history[0]).toMatchObject({ status: expect.any(String), summary: expect.any(String) });
    expect(selfHealHistory(1).length).toBe(1);

    clearSelfHealHistory();
    expect(selfHealHistory(10)).toEqual([]);
  });
});
