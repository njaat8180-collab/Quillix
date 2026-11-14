import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { GitService } from '../git.js';

/** M1.6: search across git history (git log -p | grep as a query). */
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-git-history-'));
const git = new GitService(null as any);
const runGit = (args: string[]) => execFileSync('git', args, { cwd: tmpRoot, stdio: 'pipe' }).toString();

describe('git history search', () => {
  beforeAll(() => {
    runGit(['init', '-b', 'main']);
    runGit(['config', 'user.email', 'test@quillix.local']);
    runGit(['config', 'user.name', 'quillix-test']);
    fs.writeFileSync(path.join(tmpRoot, 'a.txt'), 'first\n');
    runGit(['add', '.']);
    runGit(['commit', '-m', 'initial']);
    fs.writeFileSync(path.join(tmpRoot, 'a.txt'), 'first\nstacnery-shop\n');
    runGit(['add', '.']);
    runGit(['commit', '-m', 'add shop mention']);
    fs.writeFileSync(path.join(tmpRoot, 'a.txt'), 'first\nstacnery-shop\nplain second file\n');
    runGit(['add', '.']);
    runGit(['commit', '-m', 'unrelated tweak']);
  });

  afterAll(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

  it('finds the commit whose diff introduced the term', async () => {
    const result = await git.searchHistory(tmpRoot, 'stacnery-shop');
    expect(result.isGit).toBe(true);
    expect(result.commits.length).toBeGreaterThanOrEqual(1);
    const subjects = result.commits.map((c) => c.subject);
    expect(subjects).toContain('add shop mention');
    const hit = result.commits.find((c) => c.subject === 'add shop mention')!;
    expect(hit.hash).toMatch(/^[0-9a-f]{7,40}$/);
    expect(hit.files).toContain('a.txt');
  });

  it('returns no commits for a term that never appeared', async () => {
    const result = await git.searchHistory(tmpRoot, 'no-such-term-anywhere');
    expect(result.commits).toEqual([]);
  });

  it('treats the term literally, not as a regex', async () => {
    const dots = await git.searchHistory(tmpRoot, 'first.shop');
    expect(dots.commits).toEqual([]); // '.' would match "first shop" as a regex
    const literal = await git.searchHistory(tmpRoot, 'stacnery');
    expect(literal.commits.length).toBeGreaterThanOrEqual(1);
  });

  it('ignores blank queries and reports non-repositories honestly', async () => {
    expect((await git.searchHistory(tmpRoot, '   ')).commits).toEqual([]);
    const outside = await git.searchHistory(os.tmpdir(), 'anything');
    expect(outside.isGit).toBe(false);
    expect(outside.commits).toEqual([]);
  });

  it('bounds the number of returned commits', async () => {
    const result = await git.searchHistory(tmpRoot, 'a', { limit: 1 });
    expect(result.commits.length).toBeLessThanOrEqual(1);
  });
});
