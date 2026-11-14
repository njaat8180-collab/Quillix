import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { GitService } from '../git.js';

function gitAvailable(): boolean {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const hasGit = gitAvailable();
const service = new GitService(null as any);
const roots: string[] = [];

function runGit(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf8' });
}

function makeRepository(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-git-service-'));
  roots.push(root);
  runGit(root, ['init']);
  runGit(root, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
  runGit(root, ['config', 'user.name', 'Quillix Test']);
  runGit(root, ['config', 'user.email', 'quillix-test@example.invalid']);
  runGit(root, ['config', 'core.autocrlf', 'false']);
  fs.writeFileSync(path.join(root, 'tracked.txt'), 'first line\n');
  runGit(root, ['add', 'tracked.txt']);
  runGit(root, ['commit', '-m', 'initial commit']);
  return root;
}

afterEach(() => {
  while (roots.length) {
    fs.rmSync(roots.pop()!, { recursive: true, force: true });
  }
});

describe.skipIf(!hasGit)('GitService repository operations', () => {
  beforeEach(() => {
    makeRepository();
  });

  it('detects repositories and reports branch and status', async () => {
    const root = roots[0];
    expect(await service.isGitRepo(root)).toBe(true);
    expect(await service.isGitRepo(path.dirname(root))).toBe(false);
    expect(await service.getBranch(root)).toBe('main');

    fs.writeFileSync(path.join(root, 'tracked.txt'), 'changed\n');
    fs.writeFileSync(path.join(root, 'untracked.txt'), 'new\n');
    const status = await service.getStatus(root);
    expect(status.isGit).toBe(true);
    expect(status.branch).toBe('main');
    expect(status.files).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'tracked.txt', status: 'modified' }),
      expect.objectContaining({ path: 'untracked.txt', status: 'untracked' }),
    ]));
    expect(status.raw).toContain('tracked.txt');
  });

  it('reports staged and deleted status entries', async () => {
    const root = roots[0];
    fs.writeFileSync(path.join(root, 'staged.txt'), 'staged\n');
    runGit(root, ['add', 'staged.txt']);
    fs.unlinkSync(path.join(root, 'tracked.txt'));
    const status = await service.getStatus(root);
    expect(status.files).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'staged.txt', status: 'staged' }),
      expect.objectContaining({ path: 'tracked.txt', status: 'deleted' }),
    ]));
  });

  it('returns unstaged and staged diffs', async () => {
    const root = roots[0];
    fs.writeFileSync(path.join(root, 'tracked.txt'), 'working change\n');
    expect(await service.getDiff(root)).toContain('working change');
    runGit(root, ['add', 'tracked.txt']);
    expect(await service.getDiff(root, true)).toContain('working change');
  });

  it('returns commit history and searches history by literal text', async () => {
    const root = roots[0];
    fs.writeFileSync(path.join(root, 'tracked.txt'), 'first line\nsearchable-token\n');
    runGit(root, ['add', 'tracked.txt']);
    runGit(root, ['commit', '-m', 'add searchable token']);

    const log = await service.getLog(root, 5);
    expect(log).toHaveLength(2);
    expect(log[0]).toMatchObject({ author: 'Quillix Test', message: 'add searchable token' });
    expect(log[0].hash).toMatch(/^[0-9a-f]{7,40}$/);

    const history = await service.searchHistory(root, 'searchable-token');
    expect(history.isGit).toBe(true);
    expect(history.commits.some(commit => commit.subject === 'add searchable token')).toBe(true);
    expect(history.commits[0].files).toContain('tracked.txt');
  });

  it('stages files and rejects unsafe paths', async () => {
    const root = roots[0];
    fs.writeFileSync(path.join(root, 'new.txt'), 'new');
    expect((await service.add(root, 'new.txt')).success).toBe(true);
    expect(runGit(root, ['diff', '--cached', '--name-only']).trim()).toBe('new.txt');

    const outside = path.join(path.dirname(root), 'outside.txt');
    expect((await service.add(root, outside)).success).toBe(false);
    expect((await service.add(root, '../outside.txt')).success).toBe(false);
    expect((await service.add(root, 'C:\\outside.txt')).success).toBe(false);
  });

  it('commits staged changes and rejects empty messages', async () => {
    const root = roots[0];
    expect(await service.commit(root, '   ')).toEqual({ success: false, output: 'Commit message is required.' });
    fs.writeFileSync(path.join(root, 'tracked.txt'), 'committed change\n');
    runGit(root, ['add', 'tracked.txt']);
    expect((await service.commit(root, 'new commit')).success).toBe(true);
    expect(runGit(root, ['log', '-1', '--pretty=%s']).trim()).toBe('new commit');
  });

  it('creates and checks out branches and rejects invalid branches', async () => {
    const root = roots[0];
    expect((await service.checkout(root, 'feature', true)).success).toBe(true);
    expect(await service.getBranch(root)).toBe('feature');
    expect((await service.checkout(root, 'main')).success).toBe(true);
    expect((await service.checkout(root, 'missing-branch')).success).toBe(false);
    expect((await service.checkout(root, '-bad')).success).toBe(false);
  });

  it('lists branches and detects branch existence', async () => {
    const root = roots[0];
    runGit(root, ['branch', 'feature']);
    const branches = await service.listBranches(root);
    expect(branches).toEqual(expect.arrayContaining([
      { name: 'main', current: true },
      { name: 'feature', current: false },
    ]));
    expect(await service.hasBranch(root, 'feature')).toBe(true);
    expect(await service.hasBranch(root, 'missing')).toBe(false);
    expect(await service.hasBranch(root, '-bad')).toBe(false);
  });

  it('merges a branch into the current branch', async () => {
    const root = roots[0];
    runGit(root, ['checkout', '-b', 'feature']);
    fs.writeFileSync(path.join(root, 'feature.txt'), 'feature content\n');
    runGit(root, ['add', 'feature.txt']);
    runGit(root, ['commit', '-m', 'feature commit']);
    runGit(root, ['checkout', 'main']);

    const merged = await service.mergeBranch(root, 'feature', 'merge feature');
    expect(merged.success).toBe(true);
    expect(fs.existsSync(path.join(root, 'feature.txt'))).toBe(true);
    expect((await service.mergeBranch(root, '-bad', 'invalid')).success).toBe(false);
  });

  it('deletes a branch', async () => {
    const root = roots[0];
    runGit(root, ['branch', 'temporary']);
    expect((await service.deleteBranch(root, 'temporary')).success).toBe(true);
    expect(await service.hasBranch(root, 'temporary')).toBe(false);
    expect((await service.deleteBranch(root, '-bad')).success).toBe(false);
  });

  it('discards tracked and untracked working changes', async () => {
    const root = roots[0];
    fs.writeFileSync(path.join(root, 'tracked.txt'), 'discarded\n');
    fs.writeFileSync(path.join(root, 'untracked.txt'), 'remove me\n');
    const discarded = await service.discardWorkingChanges(root);
    expect(discarded.success).toBe(true);
    expect(fs.readFileSync(path.join(root, 'tracked.txt'), 'utf8')).toBe('first line\n');
    expect(fs.existsSync(path.join(root, 'untracked.txt'))).toBe(false);
  });

  it('restores a file and rejects unsafe paths', async () => {
    const root = roots[0];
    fs.writeFileSync(path.join(root, 'tracked.txt'), 'restore me\n');
    expect((await service.restore(root, 'tracked.txt')).success).toBe(true);
    expect(fs.readFileSync(path.join(root, 'tracked.txt'), 'utf8')).toBe('first line\n');

    const outside = path.join(path.dirname(root), 'outside.txt');
    expect((await service.restore(root, outside)).success).toBe(false);
    expect((await service.restore(root, '../outside.txt')).success).toBe(false);
    expect((await service.restore(root, 'C:\\outside.txt')).success).toBe(false);
  });
});
