import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TaskStateStore } from '../taskState.js';

describe('long-running task recovery', () => {
  const roots: string[] = [];
  const root = () => { const value = fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-task-recovery-')); roots.push(value); return value; };

  afterEach(() => { for (const value of roots.splice(0)) fs.rmSync(value, { recursive: true, force: true }); });

  it('recovers an interrupted long-running task and keeps its verified journal', () => {
    const workspace = root();
    const project = path.join(workspace, 'project');
    fs.mkdirSync(project, { recursive: true });
    fs.writeFileSync(path.join(project, 'index.html'), '<h1>done</h1>');

    const session = new TaskStateStore(workspace);
    const task = session.startTask('Build a long running website', 'agent', { provider: 'ollama', model: 'qwen2.5-coder:3b' });
    session.setProject(task.id, 'project', project);
    session.recordFileCreated(task.id, 'index.html');
    session.recordCommand(task.id, { command: 'npm run build', cwd: project, exitCode: 0, durationMs: 1200, timestamp: Date.now() });
    session.recordError(task.id, 'build retried after a transient failure');

    const recovered = new TaskStateStore(workspace);
    const record = recovered.getTask(task.id);
    expect(record?.status).toBe('cancelled');
    expect(record?.filesCreated).toEqual(['index.html']);
    expect(record?.commandsExecuted).toHaveLength(1);
    expect(record?.errors).toContain('build retried after a transient failure');
    expect(record?.observability.finishedAt).toEqual(expect.any(Number));
    expect(recovered.getLatestIncomplete()).toBeUndefined();
  });

  it('resumes a recovered checkpoint from the verified on-disk state', () => {
    const workspace = root();
    const project = path.join(workspace, 'project');
    fs.mkdirSync(project, { recursive: true });
    fs.writeFileSync(path.join(project, 'index.html'), '<h1>verified</h1>');

    const session = new TaskStateStore(workspace);
    const task = session.startTask('Build a long running website', 'agent');
    session.setProject(task.id, 'project', project);
    session.recordFileCreated(task.id, 'project/index.html');
    session.recordFileCreated(task.id, 'project/style.css');

    const recovered = new TaskStateStore(workspace);
    const checkpoint = recovered.resolveResumeCheckpoint(task.id);
    expect(checkpoint).toMatchObject({ projectRoot: path.resolve(project) });
    if (!('task' in checkpoint)) throw new Error('expected a resume checkpoint');

    const resumed = recovered.startTask('Build a long running website', 'agent', { resumedFromTaskId: task.id });
    expect(resumed.resumedFromTaskId).toBe(task.id);
    expect(resumed.filesCreated).toEqual(['project/index.html', 'project/style.css']);
    expect(resumed.status).toBe('running');

    const context = recovered.buildResumeContext(checkpoint.task);
    expect(context).toContain('Files already created and verified on disk: project/index.html');
    expect(context).toContain('project/style.css');
    expect(context).toContain('Continue the task from this VERIFIED state');
  });

  it('refuses to resume a checkpoint twice and rejects unknown or live tasks', () => {
    const workspace = root();
    const session = new TaskStateStore(workspace);
    const task = session.startTask('Build a long running website', 'agent');
    session.finishTask(task.id, 'failed', 'failed for the test');

    const resumed = session.startTask('Build a long running website', 'agent', { resumedFromTaskId: task.id });
    expect(resumed.resumedFromTaskId).toBe(task.id);
    expect(() => session.startTask('Build a long running website', 'agent', { resumedFromTaskId: task.id }))
      .toThrow(/already resumed/i);
    expect(session.resolveResumeCheckpoint('task_missing')).toMatchObject({ status: 404 });

    const live = session.startTask('Another task', 'agent');
    expect(session.resolveResumeCheckpoint(live.id)).toMatchObject({ status: 409 });
  });
});
