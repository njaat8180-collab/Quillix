import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { GitService } from '../git.js';
import { TaskBranchStore, isTaskBranchName, slugifyTaskTitle, taskBranchName } from '../taskBranches.js';

/**
 * Contract: one agent task = one git branch (Cursor-style).
 * create -> work on the task branch -> finish (merge back, branch deleted)
 * and create -> work -> discard (changes and branch deleted).
 */
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-task-branch-'));
const store = new TaskBranchStore(path.join(tmpRoot, 'task-branches.json'));
const git = new GitService(null as any);

const runGit = (args: string[]) => execFileSync('git', args, { cwd: tmpRoot, stdio: 'pipe' }).toString();

async function startTaskBranch(title: string): Promise<{ success: boolean; branch?: string; base?: string; existing?: boolean; skipped?: boolean; error?: string }> {
  const prefix = 'nuvro';
  const current = await git.getBranch(tmpRoot);
  const record = store.get(tmpRoot);
  if (record && record.branch === current) return { success: true, existing: true, branch: record.branch, base: record.base };
  if (isTaskBranchName(current, prefix)) {
    const branches = await git.listBranches(tmpRoot);
    const fallbackBase = ['main', 'master'].find((name) => branches.some((b) => b.name === name)) || current;
    const base = record?.base && record.base !== current ? record.base : fallbackBase;
    store.set(tmpRoot, { branch: current, base, createdAt: record?.createdAt || Date.now(), title: record?.title });
    return { success: true, existing: true, branch: current, base };
  }
  let name = '';
  for (let attempt = 0; attempt < 6 && !name; attempt++) {
    const candidate = taskBranchName(prefix, title, Math.random().toString(36).slice(2, 8));
    if (!(await git.hasBranch(tmpRoot, candidate))) name = candidate;
  }
  if (!name) return { success: false, error: 'no free name' };
  const created = await git.checkout(tmpRoot, name, true);
  if (!created.success) return { success: false, error: created.output };
  store.set(tmpRoot, { branch: name, base: current || 'main', createdAt: Date.now(), title });
  return { success: true, branch: name, base: current || 'main' };
}

async function finishTask(message?: string) {
  const record = store.get(tmpRoot);
  const current = await git.getBranch(tmpRoot);
  if (!record || record.branch !== current) return { success: false, error: 'not on a task branch' };
  const status = await git.getStatus(tmpRoot);
  if (status.files.length) {
    await git.add(tmpRoot, '.');
    const committed = await git.commit(tmpRoot, message || `task: ${record.title}`);
    if (!committed.success && !/nothing to commit/i.test(committed.output)) return { success: false, error: committed.output };
  }
  const back = await git.checkout(tmpRoot, record.base, false);
  if (!back.success) return { success: false, error: back.output };
  const merged = await git.mergeBranch(tmpRoot, record.branch, `Merge task branch ${record.branch}`);
  if (!merged.success) return { success: false, conflict: true, error: merged.output };
  await git.deleteBranch(tmpRoot, record.branch, true);
  store.clear(tmpRoot);
  return { success: true, branch: record.branch, base: record.base };
}

async function discardTask() {
  const record = store.get(tmpRoot);
  const current = await git.getBranch(tmpRoot);
  if (!record || record.branch !== current) return { success: false, error: 'not on a task branch' };
  const reset = await git.discardWorkingChanges(tmpRoot);
  if (!reset.success) return { success: false, error: reset.output };
  const back = await git.checkout(tmpRoot, record.base, false);
  if (!back.success) return { success: false, error: back.output };
  await git.deleteBranch(tmpRoot, record.branch, true);
  store.clear(tmpRoot);
  return { success: true, branch: record.branch };
}

let baseBranch = 'main';

describe('task branches', () => {
  beforeAll(() => {
    runGit(['init', '-b', 'main']);
    runGit(['config', 'user.email', 'test@quillix.local']);
    runGit(['config', 'user.name', 'quillix-test']);
    fs.writeFileSync(path.join(tmpRoot, 'README.md'), 'base\n');
    runGit(['add', '.']);
    runGit(['commit', '-m', 'base']);
    baseBranch = runGit(['branch', '--show-current']).trim();
  });

  it('derives git-safe branch names from task titles', () => {
    expect(slugifyTaskTitle('Stacnery Shop Website!')).toBe('stacnery-shop-website');
    expect(slugifyTaskTitle('   ')).toBe('task');
    expect(taskBranchName('nuvro', 'Stacnery Shop', 'a1b2c3')).toBe('nuvro/stacnery-shop-a1b2c3');
    expect(isTaskBranchName('nuvro/x-1', 'nuvro')).toBe(true);
    expect(isTaskBranchName('main', 'nuvro')).toBe(false);
  });

  it('creates a task branch from the current branch and remembers the base', async () => {
    const res = await startTaskBranch('stacnery shop website');
    expect(res.success).toBe(true);
    expect(res.branch).toMatch(/^nuvro\/stacnery-shop-website-[a-z0-9]{1,8}$/);
    expect(res.base).toBe(baseBranch);
    expect((await git.listBranches(tmpRoot)).find((b) => b.current)?.name).toBe(res.branch);
    expect(store.get(tmpRoot)).toMatchObject({ branch: res.branch, base: baseBranch });
  });

  it('finishes a task: commits, merges into the base branch and deletes the task branch', async () => {
    fs.writeFileSync(path.join(tmpRoot, 'feature.txt'), 'task work\n');
    const res = await finishTask('task: task work');
    expect(res.success).toBe(true);
    expect(await git.getBranch(tmpRoot)).toBe(baseBranch);
    expect((await git.listBranches(tmpRoot)).some((b) => b.name === res.branch)).toBe(false);
    expect(fs.existsSync(path.join(tmpRoot, 'feature.txt'))).toBe(true);
    expect(runGit(['log', '--oneline', '-3'])).toContain('task: task work');
    expect(store.get(tmpRoot)).toBeNull();
  });

  it('reuses the active task branch for the next turn of the same task', async () => {
    const first = await startTaskBranch('second task');
    const second = await startTaskBranch('second task, next turn');
    expect(second.success).toBe(true);
    expect(second.existing).toBe(true);
    expect(second.branch).toBe(first.branch);
  });

  it('discards a task: removes tracked and untracked work and the branch', async () => {
    const before = await startTaskBranch('third task');
    fs.writeFileSync(path.join(tmpRoot, 'junk.txt'), 'discard me\n');
    const res = await discardTask();
    expect(res.success).toBe(true);
    expect(await git.getBranch(tmpRoot)).toBe(baseBranch);
    expect(fs.existsSync(path.join(tmpRoot, 'junk.txt'))).toBe(false);
    expect((await git.listBranches(tmpRoot)).some((b) => b.name === before.branch)).toBe(false);
    expect(store.get(tmpRoot)).toBeNull();
  });

  it('adopts an existing task branch (store lost) without nesting', async () => {
    await git.checkout(tmpRoot, 'nuvro/orphan-xyz', true);
    const res = await startTaskBranch('fourth task');
    expect(res.success).toBe(true);
    expect(res.existing).toBe(true);
    expect(res.branch).toBe('nuvro/orphan-xyz');
    expect(res.base).toBe(baseBranch);
    await discardTask();
  });
});

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});
