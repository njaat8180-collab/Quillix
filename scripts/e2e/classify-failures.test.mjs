import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

// The agent E2E harness must tell two things apart:
//   - the agent's resource guard aborted a model request because the machine
//     was saturated  -> environment block (exit 75)
//   - something else failed                             -> product defect (exit 1)
//
// A busy host must never be able to hide a real product failure, so the
// classifier is exercised directly with fixtures.

const bashCandidates = process.platform === 'win32'
  ? ['C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files\\Git\\usr\\bin\\bash.exe', 'bash']
  : ['bash'];
const bash = bashCandidates.find(candidate => candidate === 'bash' || fs.existsSync(candidate));

const guardAbort = 'data: {"event":"error","error":"Resource guard could not start the model request safely: CPU 98%","taskId":"task_1","resumable":true}\n';

const makeWorkDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-e2e-classify-'));

const classify = (workDir) => spawnSync(bash, ['scripts/e2e/classify-failures.sh', workDir], {
  cwd: process.cwd(),
  encoding: 'utf8',
  windowsHide: true,
});

test('a failure caused by the resource guard is reported as an environment block', () => {
  const workDir = makeWorkDir();
  try {
    fs.writeFileSync(path.join(workDir, 's4.txt'), guardAbort);
    fs.writeFileSync(path.join(workDir, 'failures.txt'), 's4.txt|S4: project was never executed successfully\n');
    const result = classify(workDir);
    assert.equal(result.status, 75, result.stdout);
    assert.match(result.stdout, /guardBlocked=1 productFailures=0/);
    assert.match(result.stdout, /BLOCKED BY HOST RESOURCES/);
    assert.doesNotMatch(result.stdout, /PRODUCT FAILURE/);
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test('a failure that is not guard-caused stays a product failure', () => {
  const workDir = makeWorkDir();
  try {
    fs.writeFileSync(path.join(workDir, 's4.txt'), 'data: {"event":"done","result":"ok"}\n');
    fs.writeFileSync(path.join(workDir, 'failures.txt'), 's4.txt|S4: main.py missing\n');
    const result = classify(workDir);
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stdout, /guardBlocked=0 productFailures=1/);
    assert.match(result.stdout, /PRODUCT FAILURE: S4: main.py missing/);
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test('a real product failure is never masked by a concurrent guard block', () => {
  const workDir = makeWorkDir();
  try {
    fs.writeFileSync(path.join(workDir, 's4.txt'), guardAbort);
    fs.writeFileSync(path.join(workDir, 's5.txt'), 'data: {"event":"done","result":"ok"}\n');
    fs.writeFileSync(
      path.join(workDir, 'failures.txt'),
      's4.txt|S4: project was never executed successfully\ns5.txt|S5: calculator.py missing\n',
    );
    const result = classify(workDir);
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stdout, /guardBlocked=1 productFailures=1/);
    assert.match(result.stdout, /PRODUCT FAILURE: S5: calculator.py missing/);
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test('a missing stream file is treated as an unexplained failure, not a block', () => {
  const workDir = makeWorkDir();
  try {
    fs.writeFileSync(path.join(workDir, 'failures.txt'), 's9.txt|S9: stream never written\n');
    const result = classify(workDir);
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stdout, /guardBlocked=0 productFailures=1/);
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test('the host capacity probe reports READY when the machine has headroom', () => {
  const result = spawnSync(process.execPath, [
    'scripts/e2e/host-capacity.mjs',
    '--threshold',
    '100',
    '--sample-ms',
    '200',
  ], { cwd: process.cwd(), encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stdout);
  const report = JSON.parse(result.stdout.trim().split(/\r?\n/).pop());
  assert.equal(report.status, 'READY');
  assert.ok(report.cpuPercent >= 0 && report.cpuPercent <= 100);
});

test('the host capacity probe reports BLOCKED (exit 75) when the host never settles', () => {
  const result = spawnSync(process.execPath, [
    'scripts/e2e/host-capacity.mjs',
    '--wait',
    '--threshold',
    '-1',
    '--max-seconds',
    '2',
    '--sample-ms',
    '500',
  ], { cwd: process.cwd(), encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 75, result.stdout);
  const report = JSON.parse(result.stdout.trim().split(/\r?\n/).pop());
  assert.equal(report.status, 'BLOCKED');
  assert.equal(report.threshold, -1);
});
