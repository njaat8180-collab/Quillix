import { describe, expect, it, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  GitBisectService,
  runBisectTest,
  isSafeRevision,
  buildCulpritExplanation,
  type BisectSession,
} from '../gitBisect.js';

// M3.6 — Git Bisect Assist.
//
// Every case below drives a *real* Git repository in a temporary directory
// and runs the *real* configured test command. Nothing is mocked, so a passing
// test proves the behaviour on the same Windows filesystem the app uses.

const createdRoots: string[] = [];
const service = new GitBisectService();
// Every case below drives a real Git repository and runs a real test command.
// Each step spawns several processes, so the default 30 s per-test budget is
// too tight on a loaded Windows machine.
const TEST_TIMEOUT_MS = 120_000;

function makeRepo(): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-bisect-')));
  createdRoots.push(root);
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.email', 'bisect@example.test']);
  git(root, ['config', 'user.name', 'Bisect Test']);
  return root;
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/** Run Git and tolerate a non-zero exit (e.g. `bisect log` outside a session). */
function gitStatus(cwd: string, args: string[]): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, stdout, stderr: '' };
  } catch (error: any) {
    return {
      code: typeof error?.status === 'number' ? error.status : 1,
      stdout: String(error?.stdout ?? ''),
      stderr: String(error?.stderr ?? ''),
    };
  }
}

function commit(root: string, name: string, content: string): string {
  // Every commit changes the file so that Git always has something to commit.
  fs.writeFileSync(path.join(root, 'result.txt'), `${content}\n# ${name}\n`);
  git(root, ['add', 'result.txt']);
  git(root, ['commit', '-q', '-m', name]);
  return git(root, ['rev-parse', 'HEAD']).trim();
}

/**
 * A test command that reproduces the regression only after the commit that
 * introduced it. The command reads the checked-out file, so it genuinely
 * depends on which commit Git has checked out.
 */
function regressionCommand(): string {
  return `node -e "const fs=require('fs');process.exit(fs.readFileSync('result.txt','utf8').includes('BROKEN')?1:0)"`;
}

afterEach(() => {
  for (const root of createdRoots.splice(0)) {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

describe('M3.6 revision safety', () => {
  it('accepts plain refs and hashes', () => {
    expect(isSafeRevision('main')).toBe(true);
    expect(isSafeRevision('HEAD~1')).toBe(true);
    expect(isSafeRevision('a1b2c3d4e5f6')).toBe(true);
    expect(isSafeRevision('feature/new-thing')).toBe(true);
  });

  it('rejects shell fragments, options and empty values', () => {
    expect(isSafeRevision('')).toBe(false);
    expect(isSafeRevision('--upload-pack=evil')).toBe(false);
    expect(isSafeRevision('main; rm -rf /')).toBe(false);
    expect(isSafeRevision('main && echo hi')).toBe(false);
    expect(isSafeRevision('main\nrm -rf /')).toBe(false);
    expect(isSafeRevision(undefined)).toBe(false);
    expect(isSafeRevision(42)).toBe(false);
  });
});

describe('M3.6 test classification', () => {
  it('classifies a passing command as good', async () => {
    const root = makeRepo();
    const result = await runBisectTest(root, { testCommand: 'node -e "process.exit(0)"' });
    expect(result.classification).toBe('good');
    expect(result.result.exitCode).toBe(0);
  });

  it('classifies a failing command as bad', async () => {
    const root = makeRepo();
    const result = await runBisectTest(root, { testCommand: 'node -e "process.exit(3)"' });
    expect(result.classification).toBe('bad');
    expect(result.result.exitCode).toBe(3);
  });

  it('classifies git’s skip exit code as inconclusive', async () => {
    const root = makeRepo();
    const result = await runBisectTest(root, { testCommand: 'node -e "process.exit(125)"' });
    expect(result.classification).toBe('inconclusive');
    expect(result.reason).toMatch(/125/);
  });

  it('honours a configured inconclusive exit code', async () => {
    const root = makeRepo();
    const result = await runBisectTest(root, {
      testCommand: 'node -e "process.exit(42)"',
      inconclusiveExitCodes: [42],
    });
    expect(result.classification).toBe('inconclusive');
  });

  it('honours a configured inconclusive output pattern', async () => {
    const root = makeRepo();
    const result = await runBisectTest(root, {
      testCommand: 'node -e "console.log(\'Cannot find module xyz\'); process.exit(1)"',
      inconclusivePatterns: ['cannot find module'],
    });
    expect(result.classification).toBe('inconclusive');
    expect(result.reason).toMatch(/cannot find module/);
  });

  it('treats a missing test command as inconclusive', async () => {
    const root = makeRepo();
    const result = await runBisectTest(root, { testCommand: '  ' });
    expect(result.classification).toBe('inconclusive');
  });

  it('treats a timeout as inconclusive rather than as a regression', async () => {
    const root = makeRepo();
    const result = await runBisectTest(root, {
      testCommand: 'node -e "setTimeout(()=>{}, 60000)"',
      timeoutMs: 1000,
    });
    expect(result.classification).toBe('inconclusive');
    expect(result.result.timedOut).toBe(true);
  });
});

describe('M3.6 session lifecycle', () => {
  it('refuses to start outside a Git repository', async () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-bisect-nogit-')));
    createdRoots.push(root);
    const result = await service.start(root, 'main', 'main', { testCommand: 'node -e "process.exit(0)"' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not a Git repository/i);
  });

  it('refuses to start without a test command', async () => {
    const root = makeRepo();
    commit(root, 'one', 'ok');
    const result = await service.start(root, 'HEAD~1', 'HEAD', { testCommand: '' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/test command/i);
  });

  it('refuses to start with an unsafe revision', async () => {
    const root = makeRepo();
    commit(root, 'one', 'ok');
    const result = await service.start(root, 'HEAD; rm -rf /', 'HEAD', { testCommand: 'node -e "process.exit(0)"' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/plain commit references/i);
  });

  it('refuses to start with an uncommitted working tree and never discards the work', async () => {
    const root = makeRepo();
    commit(root, 'one', 'ok');
    fs.writeFileSync(path.join(root, 'result.txt'), 'uncommitted work');
    const result = await service.start(root, 'HEAD', 'HEAD', { testCommand: 'node -e "process.exit(0)"' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/uncommitted changes/i);
    expect(fs.readFileSync(path.join(root, 'result.txt'), 'utf8')).toBe('uncommitted work');
    expect(git(root, ['status', '--porcelain']).trim()).not.toBe('');
  });

  it('records the original HEAD and branch when the session starts', async () => {
    const root = makeRepo();
    commit(root, 'one', 'ok');
    commit(root, 'two', 'ok');
    const good = commit(root, 'three', 'ok');
    commit(root, 'four', 'ok');
    const bad = commit(root, 'five', 'BROKEN');
    const headBefore = git(root, ['rev-parse', 'HEAD']).trim();
    const result = await service.start(root, good, bad, { testCommand: 'node -e "process.exit(0)"' });
    expect(result.success).toBe(true);
    expect(result.session?.originalHead).toBe(headBefore);
    expect(result.session?.originalBranch).toBe('main');
    expect(result.session?.status).toBe('running');
    await service.finish(root);
  }, TEST_TIMEOUT_MS);

  it('restores the original branch and commit when the session is finished', async () => {
    const root = makeRepo();
    commit(root, 'one', 'ok');
    commit(root, 'two', 'ok');
    const good = commit(root, 'three', 'ok');
    commit(root, 'four', 'ok');
    const bad = commit(root, 'five', 'BROKEN');
    const headBefore = git(root, ['rev-parse', 'HEAD']).trim();
    await service.start(root, good, bad, { testCommand: 'node -e "process.exit(0)"' });
    await service.step(root);
    expect(git(root, ['rev-parse', 'HEAD']).trim()).not.toBe(headBefore);
    const finished = await service.finish(root);
    expect(finished.success).toBe(true);
    expect(git(root, ['rev-parse', 'HEAD']).trim()).toBe(headBefore);
    expect(git(root, ['rev-parse', '--abbrev-ref', 'HEAD']).trim()).toBe('main');
    expect(gitStatus(root, ['bisect', 'log']).code).not.toBe(0);
  }, TEST_TIMEOUT_MS);
});

describe('M3.6 bisect search', () => {
  it('identifies the commit that introduced the regression', async () => {
    const root = makeRepo();
    commit(root, 'c1 good', 'FINE');
    commit(root, 'c2 good', 'FINE');
    const culprit = commit(root, 'c3 bad', 'FINE BROKEN');
    commit(root, 'c4 bad', 'FINE BROKEN');
    commit(root, 'c5 bad', 'FINE BROKEN');
    const good = git(root, ['rev-parse', 'HEAD~4']).trim();
    const bad = git(root, ['rev-parse', 'HEAD']).trim();

    const started = await service.start(root, good, bad, { testCommand: regressionCommand() });
    expect(started.success).toBe(true);

    let session = started.session as BisectSession;
    let guard = 0;
    while (session.status === 'running' && guard < 20) {
      const step = await service.step(root);
      expect(step.success).toBe(true);
      session = step.session as BisectSession;
      guard += 1;
    }

    expect(session.status).toBe('complete');
    expect(session.culprit?.commit).toBe(culprit);
    expect(session.culprit?.explanation).toContain(culprit.slice(0, 7));
    expect(session.culprit?.subject).toContain('c3 bad');
    expect(session.steps.length).toBeGreaterThan(0);
    expect(session.steps.every(step => step.classification !== 'inconclusive')).toBe(true);
    await service.finish(root);
  }, TEST_TIMEOUT_MS);

  it('tracks progress while the search runs', async () => {
    const root = makeRepo();
    commit(root, 'c1 good', 'FINE');
    commit(root, 'c2 good', 'FINE');
    commit(root, 'c3 bad', 'FINE BROKEN');
    commit(root, 'c4 bad', 'FINE BROKEN');
    commit(root, 'c5 bad', 'FINE BROKEN');
    const good = git(root, ['rev-parse', 'HEAD~4']).trim();
    const bad = git(root, ['rev-parse', 'HEAD']).trim();

    await service.start(root, good, bad, { testCommand: regressionCommand() });
    const before = await service.progress(root);
    expect(before.active).toBe(true);
    expect(before.tested).toBe(0);
    expect(before.remaining).toBeGreaterThan(0);
    expect(before.estimatedTotal).toBeGreaterThan(0);

    await service.step(root);
    const after = await service.progress(root);
    expect(after.tested).toBe(1);
    expect(after.remaining).toBe(before.remaining - 1);
    expect(after.message).toMatch(/Bisect in progress/);
    await service.finish(root);
  }, TEST_TIMEOUT_MS);

  it('reports an inconclusive result and still advances the search', async () => {
    const root = makeRepo();
    commit(root, 'c1 good', 'FINE');
    commit(root, 'c2 good', 'FINE');
    commit(root, 'c3 bad', 'FINE BROKEN');
    commit(root, 'c4 bad', 'FINE BROKEN');
    const good = git(root, ['rev-parse', 'HEAD~3']).trim();
    const bad = git(root, ['rev-parse', 'HEAD']).trim();

    // The evaluated commit exits with the git "skip" code.
    const command = 'node -e "process.exit(125)"';
    await service.start(root, good, bad, { testCommand: command });
    const step = await service.step(root);
    expect(step.classification).toBe('inconclusive');
    expect(step.session?.steps[0]?.reason).toMatch(/125/);
    expect(step.session?.status).toBe('running');
    await service.finish(root);
  }, TEST_TIMEOUT_MS);

  it('never rewrites history: the commit graph is unchanged after the session', async () => {
    const root = makeRepo();
    commit(root, 'c1', 'FINE');
    commit(root, 'c2', 'FINE BROKEN');
    const good = git(root, ['rev-parse', 'HEAD~1']).trim();
    const bad = git(root, ['rev-parse', 'HEAD']).trim();
    const logBefore = git(root, ['log', '--format=%H %s']).trim();

    await service.start(root, good, bad, { testCommand: regressionCommand() });
    let guard = 0;
    while (guard < 10) {
      const progress = await service.progress(root);
      if (progress.session?.status !== 'running') break;
      const step = await service.step(root);
      if (!step.success) break;
      guard += 1;
    }
    await service.finish(root);

    expect(git(root, ['log', '--format=%H %s']).trim()).toBe(logBefore);
    expect(git(root, ['branch', '--list']).includes('main')).toBe(true);
  }, TEST_TIMEOUT_MS);
});

describe('M3.6 interruption and recovery', () => {
  it('recovers an interrupted session that is still active in Git', async () => {
    const root = makeRepo();
    commit(root, 'c1 good', 'FINE');
    commit(root, 'c2 good', 'FINE');
    commit(root, 'c3 bad', 'FINE BROKEN');
    commit(root, 'c4 bad', 'FINE BROKEN');
    const good = git(root, ['rev-parse', 'HEAD~3']).trim();
    const bad = git(root, ['rev-parse', 'HEAD']).trim();

    await service.start(root, good, bad, { testCommand: regressionCommand() });
    await service.step(root);

    // Simulate an application restart: the Git bisect is still running.
    const recovered = await service.recover(root);
    expect(recovered.success).toBe(true);
    expect(recovered.session?.status).toBe('running');
    expect(recovered.session?.steps.length).toBe(1);

    const progress = await service.progress(root);
    expect(progress.active).toBe(true);
    expect(progress.tested).toBe(1);
    await service.finish(root);
  }, TEST_TIMEOUT_MS);

  it('refuses to recover a session whose Git state is gone and leaves the repository untouched', async () => {
    const root = makeRepo();
    commit(root, 'c1 good', 'FINE');
    commit(root, 'c2 bad', 'FINE BROKEN');
    commit(root, 'c3 bad', 'FINE BROKEN');
    const good = git(root, ['rev-parse', 'HEAD~2']).trim();
    const bad = git(root, ['rev-parse', 'HEAD']).trim();
    const headBefore = git(root, ['rev-parse', 'HEAD']).trim();

    await service.start(root, good, bad, { testCommand: regressionCommand() });
    // The user resets the bisect manually — the session record survives.
    git(root, ['bisect', 'reset']);

    const recovered = await service.recover(root);
    expect(recovered.success).toBe(false);
    expect(recovered.error).toMatch(/no longer active/i);
    expect(git(root, ['rev-parse', 'HEAD']).trim()).toBe(headBefore);
  }, TEST_TIMEOUT_MS);

  it('reports no session when nothing was ever started', async () => {
    const root = makeRepo();
    const progress = await service.progress(root);
    expect(progress.active).toBe(false);
    expect(progress.session).toBeNull();
    expect(progress.message).toMatch(/No bisect session/i);
  });

  it('refuses to step when no session is running', async () => {
    const root = makeRepo();
    const result = await service.step(root);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/No bisect session/i);
  });

  it('abandons a session record without touching the repository', async () => {
    const root = makeRepo();
    commit(root, 'c1 good', 'FINE');
    commit(root, 'c2 bad', 'FINE BROKEN');
    commit(root, 'c3 bad', 'FINE BROKEN');
    const good = git(root, ['rev-parse', 'HEAD~2']).trim();
    const bad = git(root, ['rev-parse', 'HEAD']).trim();
    await service.start(root, good, bad, { testCommand: regressionCommand() });
    await service.abandon(root);
    const progress = await service.progress(root);
    expect(progress.session).toBeNull();
    // The Git session is still there and can be reset normally.
    git(root, ['bisect', 'reset']);
  });
});

describe('M3.6 culprit explanation', () => {
  it('explains the result, the range and how to inspect the commit', () => {
    const session: BisectSession = {
      id: 'x',
      workspace: '/tmp/x',
      good: 'aaa',
      bad: 'bbb',
      originalHead: 'bbb',
      originalBranch: 'main',
      testCommand: 'npm test',
      startedAt: new Date().toISOString(),
      status: 'complete',
      steps: [
        { commit: 'c1', short: 'c1', subject: 's', classification: 'good', reason: '', exitCode: 0, at: '' },
        { commit: 'c2', short: 'c2', subject: 's', classification: 'bad', reason: '', exitCode: 1, at: '' },
      ],
    };
    const explanation = buildCulpritExplanation(session, 'c2abc12', 'break the build');
    expect(explanation).toContain('c2abc12');
    expect(explanation).toContain('break the build');
    expect(explanation).toContain('git show c2abc12');
    expect(explanation).toMatch(/1 commit\(s\) were confirmed good/);
  });
});




