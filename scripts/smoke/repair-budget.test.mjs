import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RepairBudget, MAX_AUTOMATIC_REPAIR_ATTEMPTS, fingerprintWrittenFiles } from '../../src/server/repairBudget.ts';

test('a single task has at most 20 total repair attempts', () => {
  const budget = new RepairBudget();
  assert.equal(MAX_AUTOMATIC_REPAIR_ATTEMPTS, 20);
  for (let i = 0; i < 20; i++) {
    assert.equal(budget.claimAttempt(), i + 1);
    budget.observeFileChanges(String(i), String(i + 1));
  }
  assert.equal(budget.canAttempt(), false);
  assert.equal(budget.claimAttempt(), null);
  assert.match(budget.stopReason(), /20 repair attempts/);
});

test('two consecutive no-change attempts stop instead of blindly looping', () => {
  const budget = new RepairBudget();
  budget.claimAttempt();
  assert.equal(budget.observeFileChanges('same', 'same'), false);
  assert.equal(budget.canAttempt(), true);
  budget.claimAttempt();
  assert.equal(budget.observeFileChanges('same', 'same'), false);
  assert.equal(budget.canAttempt(), false);
  assert.match(budget.stopReason(), /no file changes/);
});

test('a genuine file change resets the no-progress counter', () => {
  const budget = new RepairBudget();
  budget.claimAttempt(); budget.observeFileChanges('A', 'A');
  budget.claimAttempt(); budget.observeFileChanges('A', 'B');
  assert.equal(budget.stagnantAttempts, 0);
  assert.equal(budget.canAttempt(), true);
});

test('file fingerprints use bytes, ignore re-write timestamps, and detect repairs', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-budget-'));
  try {
    const filepath = path.join(workspace, 'index.js');
    fs.writeFileSync(filepath, 'throw new Error();');
    const broken = fingerprintWrittenFiles(workspace, ['index.js']);
    fs.writeFileSync(filepath, 'throw new Error();');
    assert.equal(fingerprintWrittenFiles(workspace, ['index.js']), broken);
    fs.writeFileSync(filepath, 'console.log("ok");');
    assert.notEqual(fingerprintWrittenFiles(workspace, ['index.js']), broken);
    assert.equal(fingerprintWrittenFiles(workspace, ['../outside']), fingerprintWrittenFiles(workspace, []));
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});
