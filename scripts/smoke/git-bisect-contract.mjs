import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// QUILLIX M3.6 contract: Git Bisect Assist.
//
// Two halves:
//   1. Source surface — the bisect service, the server routes and the renderer
//      bridge must exist and keep their safety guarantees.
//   2. Runtime behaviour — the real bisect module is imported and driven
//      against a real temporary Git repository: a session is started, a test
//      command is classified, the search converges on the right commit and
//      the repository is restored.
//
// The runtime half is what makes this a contract instead of a description: a
// source scan alone cannot prove that the culprit is found and that the
// repository is left exactly as it was found.

const project = path.resolve(import.meta.dirname, '../..');
const read = (...parts) => fs.readFileSync(path.join(project, ...parts), 'utf8');

const bisectSource = read('src', 'server', 'gitBisect.ts');
const serverSource = read('server.ts');
const bridgeSource = read('src', 'services', 'apiBridge.ts');
const combinedSource = [bisectSource, serverSource, bridgeSource].join('\n');

const checks = [
  ['the bisect service exists as its own module',
    /export class GitBisectService \{/],
  ['a session can be started from a known-good and a known-bad revision',
    /public async start\(/],
  ['the known-good and known-bad revisions are validated',
    /export function isSafeRevision\(/],
  ['revisions are resolved to stable commit ids',
    /rev-parse', `\$\{good\.trim\(\)\}\^\{commit\}`/],
  ['a session refuses to start with an uncommitted working tree',
    /The working tree has uncommitted changes/],
  ['the original HEAD and branch are recorded so the repo can be restored',
    /originalHead/],
  ['the configured test command is executed',
    /export async function runBisectTest\(/],
  ['the test result is classified as good, bad or inconclusive',
    /export type BisectClassification = 'good' \| 'bad' \| 'inconclusive';/],
  ['an inconclusive result is skipped instead of being mistaken for a regression',
    /'inconclusive'/],
  ['git’s own skip exit code is treated as inconclusive',
    /INCONCLUSIVE_EXIT_CODE = 125/],
  ['a timeout is inconclusive, never a regression',
    /The test run timed out/],
  ['the classification is handed to git so the search advances',
    /\['bisect', mark\]/],
  ['the culprit is read from git’s own message',
    /export function parseCulpritCommit\(/],
  ['the result is explained to the user',
    /export function buildCulpritExplanation\(/],
  ['progress is reported while the search runs',
    /public async progress\(/],
  ['an interrupted session can be recovered',
    /public async recover\(/],
  ['finishing a session restores the repository',
    /public async finish\(/],
  ['history is never rewritten',
    /'bisect', 'reset'/],
  ['git is invoked without a shell so a revision is never a command',
    /shell: false/],
  ['the server exposes the bisect progress route',
    /app\.get\('\/api\/git\/bisect'/],
  ['the server exposes the bisect start route',
    /app\.post\('\/api\/git\/bisect\/start', requireAgentMode/],
  ['the server exposes the bisect step route',
    /app\.post\('\/api\/git\/bisect\/step', requireAgentMode/],
  ['the server exposes the bisect recover route',
    /app\.post\('\/api\/git\/bisect\/recover', requireAgentMode/],
  ['the server exposes the bisect finish route',
    /app\.post\('\/api\/git\/bisect\/finish', requireAgentMode/],
  ['the renderer bridge can read the bisect progress',
    /public async getGitBisectProgress\(\)/],
  ['the renderer bridge can start a bisect session',
    /public async startGitBisect\(/],
  ['the renderer bridge can run a bisect step',
    /public async runGitBisectStep\(\)/],
  ['the renderer bridge can recover a bisect session',
    /public async recoverGitBisect\(\)/],
  ['the renderer bridge can finish a bisect session',
    /public async finishGitBisect\(\)/],
];

for (const [label, pattern] of checks) {
  assert.ok(pattern.test(combinedSource), `M3.6 contract: ${label}`);
}

// The bisect service must never be able to rewrite history. The check looks at
// the actual Git argument arrays, not at prose (the module documents these
// very commands in its header comment).
const gitInvocations = [...bisectSource.matchAll(/executeGit\([^)]*?\[([^\]]*)\]/g)].map(match => match[1]);
const invoked = gitInvocations.join('\n');
assert.ok(!/reset\s+--hard/i.test(invoked), 'M3.6 contract: the bisect service must never run "reset --hard"');
assert.ok(!/rebase/i.test(invoked), 'M3.6 contract: the bisect service must never rebase');
assert.ok(!/cherry-pick/i.test(invoked), 'M3.6 contract: the bisect service must never cherry-pick');
assert.ok(!/push/i.test(invoked), 'M3.6 contract: the bisect service must never push');
assert.ok(!/merge/i.test(invoked), 'M3.6 contract: the bisect service must never merge');
assert.ok(!/clean\b/i.test(invoked), 'M3.6 contract: the bisect service must never clean the working tree');

// --- Runtime behaviour ------------------------------------------------------
const moduleUrl = pathToFileURL(path.join(project, 'src', 'server', 'gitBisect.ts')).href;
const { GitBisectService, runBisectTest, isSafeRevision, parseCulpritCommit } = await import(moduleUrl);

const service = new GitBisectService();
const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-bisect-contract-')));
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const commit = (name, content) => {
  fs.writeFileSync(path.join(repo, 'result.txt'), `${content}\n# ${name}\n`);
  git('add', 'result.txt');
  git('commit', '-q', '-m', name);
  return git('rev-parse', 'HEAD').trim();
};

try {
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'contract@example.test');
  git('config', 'user.name', 'Contract Test');
  commit('c1 good', 'FINE');
  commit('c2 good', 'FINE');
  const culprit = commit('c3 bad', 'FINE BROKEN');
  commit('c4 bad', 'FINE BROKEN');
  commit('c5 bad', 'FINE BROKEN');
  const good = git('rev-parse', 'HEAD~4').trim();
  const bad = git('rev-parse', 'HEAD').trim();
  const headBefore = git('rev-parse', 'HEAD').trim();
  const logBefore = git('log', '--format=%H %s').trim();

  // 1. Unsafe revisions are rejected before Git ever sees them.
  assert.equal(isSafeRevision('main'), true, 'M3.6 contract: a plain ref must be accepted');
  assert.equal(isSafeRevision('main; rm -rf /'), false, 'M3.6 contract: a shell fragment must be rejected');
  assert.equal(isSafeRevision('--upload-pack=evil'), false, 'M3.6 contract: an option-like revision must be rejected');

  // 2. A missing test command is inconclusive, never a regression.
  const noCommand = await runBisectTest(repo, { testCommand: '' });
  assert.equal(noCommand.classification, 'inconclusive', 'M3.6 contract: a missing test command must be inconclusive');

  // 3. A failing test command is a regression; a passing one is not.
  const failing = await runBisectTest(repo, { testCommand: 'node -e "process.exit(1)"' });
  assert.equal(failing.classification, 'bad', 'M3.6 contract: a failing test command must classify as bad');
  const passing = await runBisectTest(repo, { testCommand: 'node -e "process.exit(0)"' });
  assert.equal(passing.classification, 'good', 'M3.6 contract: a passing test command must classify as good');
  const skipped = await runBisectTest(repo, { testCommand: 'node -e "process.exit(125)"' });
  assert.equal(skipped.classification, 'inconclusive', 'M3.6 contract: the git skip code must classify as inconclusive');

  // 4. The culprit is read from git's message, not from HEAD.
  assert.equal(
    parseCulpritCommit("abc1234 is the first 'bad' commit"),
    'abc1234',
    'M3.6 contract: the culprit hash must be parsed from git output',
  );

  // 5. A session started on a dirty tree is refused and the work survives.
  fs.writeFileSync(path.join(repo, 'result.txt'), 'uncommitted work');
  const dirty = await service.start(repo, good, bad, { testCommand: 'node -e "process.exit(0)"' });
  assert.equal(dirty.success, false, 'M3.6 contract: a dirty working tree must block a bisect session');
  assert.match(dirty.error || '', /uncommitted changes/i, 'M3.6 contract: the refusal must explain itself');
  assert.equal(
    fs.readFileSync(path.join(repo, 'result.txt'), 'utf8'),
    'uncommitted work',
    'M3.6 contract: a refused bisect must never discard the user\'s work',
  );
  git('checkout', '--', 'result.txt');

  // 6. The real search finds the commit that introduced the regression.
  const testCommand = `node -e "const fs=require('fs');process.exit(fs.readFileSync('result.txt','utf8').includes('BROKEN')?1:0)"`;
  const started = await service.start(repo, good, bad, { testCommand });
  assert.equal(started.success, true, `M3.6 contract: the session must start (${started.error || ''})`);
  assert.equal(started.session.originalHead, headBefore, 'M3.6 contract: the original HEAD must be recorded');
  assert.equal(started.session.originalBranch, 'main', 'M3.6 contract: the original branch must be recorded');

  const progressBefore = await service.progress(repo);
  assert.equal(progressBefore.active, true, 'M3.6 contract: a running session must be reported as active');
  assert.ok(progressBefore.remaining > 0, 'M3.6 contract: the progress must report remaining candidates');

  let session = started.session;
  let guard = 0;
  while (session.status === 'running' && guard < 20) {
    const step = await service.step(repo);
    assert.equal(step.success, true, `M3.6 contract: every step must succeed (${step.error || ''})`);
    session = step.session;
    guard += 1;
  }
  assert.equal(session.status, 'complete', 'M3.6 contract: the search must converge');
  assert.equal(session.culprit.commit, culprit, 'M3.6 contract: the culprit must be the commit that introduced the regression');
  assert.match(session.culprit.explanation, /git show/, 'M3.6 contract: the result must explain how to inspect the commit');

  // 7. Finishing restores the repository exactly as it was found.
  const finished = await service.finish(repo);
  assert.equal(finished.success, true, 'M3.6 contract: finishing must succeed');
  assert.equal(git('rev-parse', 'HEAD').trim(), headBefore, 'M3.6 contract: finishing must restore the original commit');
  assert.equal(git('rev-parse', '--abbrev-ref', 'HEAD').trim(), 'main', 'M3.6 contract: finishing must restore the original branch');
  assert.equal(git('log', '--format=%H %s').trim(), logBefore, 'M3.6 contract: the commit graph must never be rewritten');

  console.log('M3.6 git bisect contract: PASS');

} finally {
  try { execFileSync('git', ['bisect', 'reset'], { cwd: repo, stdio: 'ignore' }); } catch { /* already reset */ }
  fs.rmSync(repo, { recursive: true, force: true });
}

