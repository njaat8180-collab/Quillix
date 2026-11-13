import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TaskStateStore } from '../taskState.js';

describe('task rollback journal', () => {
  const roots: string[] = [];
  const root = () => { const value = fs.mkdtempSync(path.join(process.cwd(), '.test-tmp-rollback-')); roots.push(value); return value; };

  afterEach(() => { for (const value of roots.splice(0)) fs.rmSync(value, { recursive: true, force: true }); });

  it('restores a modified file and removes a file created by the task', () => {
    const workspace = root();
    fs.writeFileSync(path.join(workspace, 'app.js'), 'before();');
    const store = new TaskStateStore(workspace);
    const task = store.startTask('Improve the app', 'agent');
    store.recordRollback(task.id, { filePath: 'app.js', changeType: 'modified', oldContent: 'before();', newContent: 'after();' });
    store.recordRollback(task.id, { filePath: 'new.js', changeType: 'created', oldContent: '', newContent: 'export const ready = true;' });
    fs.writeFileSync(path.join(workspace, 'app.js'), 'after();');
    fs.writeFileSync(path.join(workspace, 'new.js'), 'export const ready = true;');

    const result = store.rollbackTask(task.id);
    expect(result).toMatchObject({ success: true, restored: ['new.js', 'app.js'], conflicts: [] });
    expect(fs.readFileSync(path.join(workspace, 'app.js'), 'utf8')).toBe('before();');
    expect(fs.existsSync(path.join(workspace, 'new.js'))).toBe(false);
  });

  it('does not overwrite a manual edit made after the task', () => {
    const workspace = root();
    fs.writeFileSync(path.join(workspace, 'app.js'), 'before();');
    const store = new TaskStateStore(workspace);
    const task = store.startTask('Improve the app', 'agent');
    store.recordRollback(task.id, { filePath: 'app.js', changeType: 'modified', oldContent: 'before();', newContent: 'agent();' });
    fs.writeFileSync(path.join(workspace, 'app.js'), 'user-change();');

    const result = store.rollbackTask(task.id);
    expect(result.success).toBe(false);
    expect(result.conflicts).toEqual(['app.js']);
    expect(fs.readFileSync(path.join(workspace, 'app.js'), 'utf8')).toBe('user-change();');
  });

  it('recovers persisted running tasks after a server restart without losing resume evidence', () => {
    const workspace = root();
    const firstSession = new TaskStateStore(workspace);
    const task = firstSession.startTask('Continue the interrupted refactor', 'agent', { provider: 'ollama', model: 'local' });
    const nextSession = new TaskStateStore(workspace);
    expect(nextSession.getLatestIncomplete()).toBeUndefined();
    expect(nextSession.getTask(task.id)).toMatchObject({ status: 'cancelled', finalText: expect.stringContaining('interrupted') });
    expect(nextSession.getTask(task.id)?.errors).toContain('Interrupted by a previous NUVRO AI session.');
    expect(nextSession.getTask(task.id)?.observability.finishedAt).toEqual(expect.any(Number));
  });

  it('persists provider-neutral model sizing for token-efficiency benchmarks', () => {
    const workspace = root();
    const store = new TaskStateStore(workspace);
    const task = store.startTask('Fix one focused file', 'agent', { provider: 'ollama', model: 'qwen2.5-coder:3b' });
    store.recordModelMetric(task.id, { inputChars: 400, outputChars: 120, toolResultChars: 80, contextCharsPeak: 400, rawConversationChars: 1000, sentMessageChars: 500 });
    store.recordModelMetric(task.id, { inputChars: 200, outputChars: 40, toolResultChars: 0, contextCharsPeak: 400, rawConversationChars: 1000, sentMessageChars: 900 });
    const saved = store.getTask(task.id)?.observability;
    expect(saved).toMatchObject({ modelCalls: 2, inputChars: 600, outputChars: 160, toolResultChars: 80, contextCharsPeak: 400 });
    expect(saved?.estimatedInputTokens).toBe(150);
    expect(saved?.estimatedOutputTokens).toBe(40);
    expect(saved?.estimatedTotalTokens).toBe(190);
    expect(saved?.rawConversationChars).toBe(2000);
    expect(saved?.sentMessageChars).toBe(1400);
    expect(saved?.messageHistoryReductionPercent).toBe(30);
  });

  it('returns aggregate token-efficiency telemetry without task contents', () => {
    const workspace = root();
    const store = new TaskStateStore(workspace);
    const task = store.startTask('Do not expose this prompt', 'agent', { provider: 'ollama', model: 'local' });
    store.recordFileModified(task.id, 'src/app.ts');
    store.recordFileCreated(task.id, 'src/test.ts');
    store.recordModelMetric(task.id, { inputChars: 400, outputChars: 120, toolResultChars: 80, contextCharsPeak: 400, actualInputTokens: 100, actualOutputTokens: 30 });
    store.recordToolMetric(task.id, 'read_file', true, 4);
    store.recordVerification(task.id, { summary: 'passed', executed: true, exitCode: 0 });
    store.finishTask(task.id, 'completed', 'private final response');

    const summary = store.tokenEfficiencySummary(5);
    expect(summary).toMatchObject({
      sampleSize: 1,
      completedTasks: 1,
      verifiedTasks: 1,
      totalTokens: 130,
      totalModelCalls: 1,
      totalToolCalls: 1,
      totalVerificationRuns: 1,
      totalVerifiedFiles: 2,
      averageTokensPerVerifiedFile: 65,
      medianTokens: 130,
      p95Tokens: 130,
      passRatePercent: 100,
    });
    expect(summary.tasks[0]).not.toHaveProperty('userRequest');
    expect(summary.tasks[0]).not.toHaveProperty('finalText');
    expect(summary.tasks[0].byTool).toEqual({ read_file: { calls: 1, failures: 0, totalDurationMs: 4 } });
  });
});
