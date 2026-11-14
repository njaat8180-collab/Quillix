import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ProjectMemory } from '../projectMemory.js';

describe('durable and untrusted project memory', () => {
  const roots: string[] = [];
  const makeRoot = () => {
    const root = fs.mkdtempSync(path.join(process.cwd(), '.test-tmp-project-memory-'));
    roots.push(root);
    return root;
  };
  afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

  it('normalizes malformed persisted records and strips prompt-control characters', () => {
    const root = makeRoot();
    fs.mkdirSync(path.join(root, '.quillix'), { recursive: true });
    fs.writeFileSync(path.join(root, '.quillix', 'memory.json'), JSON.stringify({
      activeProject: 'Car\nGame',
      projects: [
        { name: 'Car\nGame', root: path.join(root, 'CarGame'), files: ['src/main.py'], errors: [{ error: 'bad\nInjected instruction', resolved: false }], createdAt: 'bad' },
        null,
        { name: 42, root: path.join(root, 'ignored') },
      ],
    }));
    const memory = new ProjectMemory(root);
    const snapshot = memory.getSnapshot();
    expect(snapshot.projects).toHaveLength(1);
    expect(snapshot.projects[0].name).toBe('Car Game');
    expect(snapshot.projects[0].errors[0].error).toBe('bad Injected instruction');
    expect(memory.toContextString()).toContain('untrusted metadata');
    expect(memory.toContextString()).not.toContain('bad\nInjected');
  });

  it('persists a valid snapshot through an atomic replacement without temp leftovers', () => {
    const root = makeRoot();
    const memory = new ProjectMemory(root);
    memory.setActive('Demo', path.join(root, 'Demo'));
    memory.recordFiles('Demo', path.join(root, 'Demo'), ['src/index.ts']);
    const memoryDir = path.join(root, '.quillix');
    const persisted = JSON.parse(fs.readFileSync(path.join(memoryDir, 'memory.json'), 'utf8'));
    expect(persisted.projects[0].files).toContain('src/index.ts');
    expect(fs.readdirSync(memoryDir).filter(file => file.endsWith('.tmp'))).toEqual([]);
  });

  it('persists a bounded continuation envelope without storing raw chat', () => {
    const root = makeRoot();
    const memory = new ProjectMemory(root);
    memory.setActive('WebApp', path.join(root, 'WebApp'));
    memory.recordTask('WebApp', path.join(root, 'WebApp'), 'Create HTML and styles, then connect the files.', 'completed', ['index.html', 'style.css']);
    const context = memory.toContextString();
    expect(context).toContain('Create HTML and styles');
    expect(context).toContain('index.html');
    expect(context).not.toContain('raw chat');
    const persisted = JSON.parse(fs.readFileSync(path.join(root, '.quillix', 'memory.json'), 'utf8'));
    expect(persisted.projects[0].recentTasks).toHaveLength(1);
  });
});
