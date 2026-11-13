import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  LanguageRunnerRegistry,
  ProjectRunService,
  deriveProjectName,
  fallbackProjectName,
  uniqueProjectFolder,
  requestedExistingProjectFolder,
  probeRuntime,
  clearRuntimeCache,
} from '../languageRunners.js';
import { ProjectMemory } from '../projectMemory.js';

async function canStopOwnWindowsProcessTree(): Promise<boolean> {
  if (process.platform !== 'win32') return true;
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 750)'], { windowsHide: true, stdio: 'ignore' });
  const closed = new Promise<void>(resolve => child.once('close', () => resolve()));
  await new Promise<void>((resolve, reject) => {
    child.once('spawn', () => resolve());
    child.once('error', reject);
  });
  const result = spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 3000, stdio: 'ignore' });
  if (result.error || result.status !== 0) {
    await Promise.race([closed, new Promise(resolve => setTimeout(resolve, 1000))]);
    return false;
  }
  await Promise.race([closed, new Promise(resolve => setTimeout(resolve, 1000))]);
  return child.exitCode !== null || child.signalCode !== null;
}

let testDir: string;

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(process.cwd(), '.test-tmp-runners-'));
});

afterEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
});

describe('Language Runner System (§9 — per-language adapters)', () => {
  it('derives PascalCase project names from natural prompts', () => {
    expect(deriveProjectName('Create a small Node.js project named SmokeAdder.')).toBe('SmokeAdder');
    expect(deriveProjectName('Create a calculator')).toBe('Calculator');
    expect(deriveProjectName('create a python car game')).toBe('CarGame');
    expect(deriveProjectName('Build me a portfolio website')).toBe('Portfolio');
    expect(deriveProjectName('make a snake game with react')).toBe('SnakeGame');
    expect(deriveProjectName('please create a new project for me')).toBeNull();
    expect(fallbackProjectName('Create a Node.js application.')).toBe('NodeApp');
    expect(fallbackProjectName('Build a Python application.')).toBe('PythonProject');
  });

  it('runs real package tests when a library has no start script', () => {
    fs.writeFileSync(path.join(testDir, 'package.json'), JSON.stringify({ scripts: { test: 'node test.cjs' } }));
    fs.writeFileSync(path.join(testDir, 'test.cjs'), 'console.log("ok");');
    const profile = LanguageRunnerRegistry.detect(testDir);
    expect(profile.runCommand).toBe('npm test');
    expect(profile.testCommand).toBe('npm test');
  });

  it('avoids folder name collisions in the workspace', () => {
    fs.mkdirSync(path.join(testDir, 'Calculator'));
    expect(uniqueProjectFolder(testDir, 'Calculator')).toBe('Calculator2');
  });

  it('reuses an explicitly named existing project folder', () => {
    fs.mkdirSync(path.join(testDir, 'Portfolio'));
    fs.mkdirSync(path.join(testDir, 'AURA'));
    expect(requestedExistingProjectFolder(testDir, 'Build the website inside the Portfolio folder')).toBe('Portfolio');
    expect(requestedExistingProjectFolder(testDir, 'Repair the existing AURA project')).toBe('AURA');
    expect(requestedExistingProjectFolder(testDir, 'Build a website')).toBeNull();
  });

  it('detects a Python project with entry point and requirements', () => {
    fs.writeFileSync(path.join(testDir, 'main.py'), 'print("hi")\n');
    fs.writeFileSync(path.join(testDir, 'requirements.txt'), 'pygame==2.5.1\n');
    const p = LanguageRunnerRegistry.detect(testDir);
    expect(p.language).toBe('python');
    expect(p.entryPoint).toBe('main.py');
    expect(p.dependencies['pygame']).toBe('pygame==2.5.1');
    expect(p.runCommand).toContain('main.py');
    expect(p.previewable).toBe(false);
  });

  it('detects a Node project with an npm start script', () => {
    fs.writeFileSync(
      path.join(testDir, 'package.json'),
      JSON.stringify({ name: 'x', main: 'server.js', scripts: { start: 'node server.js', test: 'node test.js' } })
    );
    fs.writeFileSync(path.join(testDir, 'server.js'), 'console.log(1);\n');
    const p = LanguageRunnerRegistry.detect(testDir);
    expect(p.language).toBe('node');
    expect(p.runCommand).toBe('npm start');
    expect(p.testCommand).toBe('npm test');
    expect(p.runtimeAvailable).toBe(true); // node runs the tests themselves
  });

  it('detects a static web project as previewable', () => {
    fs.writeFileSync(path.join(testDir, 'index.html'), '<html><body>hi</body></html>');
    fs.writeFileSync(path.join(testDir, 'style.css'), 'body{}');
    fs.writeFileSync(path.join(testDir, 'script.js'), 'console.log(1);');
    const p = LanguageRunnerRegistry.detect(testDir);
    expect(p.language).toBe('static-web');
    expect(p.previewable).toBe(true);
    expect(p.previewEntry).toBe('index.html');
    expect(p.runCommand).toBe('');
  });

  it('detects a C++ project with a real compile+run command', () => {
    fs.writeFileSync(path.join(testDir, 'main.cpp'), 'int main(){return 0;}\n');
    const p = LanguageRunnerRegistry.detect(testDir);
    expect(p.language).toBe('cpp');
    expect(p.runCommand).toContain('g++');
    expect(p.runCommand).toContain('main.cpp');
  });

  it('detects single-file Java via direct JVM execution', () => {
    fs.writeFileSync(path.join(testDir, 'Main.java'), 'class Main { public static void main(String[] a){} }');
    const p = LanguageRunnerRegistry.detect(testDir);
    expect(p.language).toBe('java');
    expect(p.runCommand).toContain('java');
    expect(p.runCommand).toContain('Main.java');
  });

  it('detects Cargo and Go projects', () => {
    fs.writeFileSync(path.join(testDir, 'Cargo.toml'), '[package]\nname = "x"\n');
    expect(LanguageRunnerRegistry.detect(testDir).runCommand).toBe('cargo run');
    fs.rmSync(testDir, { recursive: true, force: true });
    fs.mkdirSync(testDir, { recursive: true });
    fs.writeFileSync(path.join(testDir, 'go.mod'), 'module x\n');
    expect(LanguageRunnerRegistry.detect(testDir).runCommand).toBe('go run .');
  });

  it('detects an unknown folder honestly', () => {
    fs.writeFileSync(path.join(testDir, 'notes.txt'), 'nothing runnable');
    const p = LanguageRunnerRegistry.detect(testDir);
    expect(p.language).toBe('unknown');
    expect(p.runCommand).toBe('');
  });

  it('probes real runtime availability (node is present in this environment)', () => {
    clearRuntimeCache();
    expect(probeRuntime('node').available).toBe(true);
    expect(probeRuntime('definitely-not-a-real-binary-xyz').available).toBe(false);
  });
});

describe('ProjectRunService (§11 — real RUN lifecycle)', () => {
  it('starts a real process, streams output, and records exit status', async () => {
    fs.writeFileSync(path.join(testDir, 'app.js'), "console.log('hello-from-run');\n");
    const svc = new ProjectRunService();
    const profile = LanguageRunnerRegistry.detect(testDir);
    const started = svc.start(testDir, {
      ...profile,
      language: 'node',
      runCommand: 'node app.js',
      runtimeAvailable: true,
    });
    expect('error' in started).toBe(false);
    const run = started as any;
    expect(run.status).toBe('running');

    // Wait for the real process to finish (poll the live status).
    let status = run;
    for (let i = 0; i < 50 && status.status === 'running'; i++) {
      await new Promise((r) => setTimeout(r, 100));
      status = svc.status(run.id)!;
    }
    expect(status.status).toBe('exited');
    expect(status.exitCode).toBe(0);
    expect(status.output).toContain('hello-from-run');
  });

  it('stops a running process on demand', async ({ skip }) => {
    if (!await canStopOwnWindowsProcessTree()) return skip('Windows process-tree termination is restricted by this environment.');
    fs.writeFileSync(path.join(testDir, 'app.js'), "setInterval(()=>console.log('tick'), 100);\n");
    const svc = new ProjectRunService();
    const started = svc.start(testDir, {
      language: 'node',
      runCommand: 'node app.js',
      runtimeAvailable: true,
    } as any) as any;
    expect(started.status).toBe('running');
    const stopped = svc.stop(started.id);
    expect(stopped).toBe(true);
    await new Promise((r) => setTimeout(r, 200));
    const status = svc.status(started.id);
    expect(status?.status).toBe('stopped');
  });

  it('keeps a run active when process-tree termination fails', () => {
    const svc = new ProjectRunService();
    const run = {
      id: 'run_test', root: testDir, command: 'node app.js', status: 'running', output: '', startedAt: Date.now(),
      child: { pid: 12345, exitCode: null, kill: vi.fn(() => true) },
    } as any;
    (svc as any).runs.set(run.id, run);
    (svc as any).byRoot.set(testDir, run.id);
    vi.spyOn(svc as any, 'requestTermination').mockReturnValue(false);

    expect(svc.stop(run.id)).toBe(false);
    expect(svc.status(run.id)?.status).toBe('running');
    const restart = svc.start(testDir, { runCommand: 'node app.js', runtimeAvailable: true } as any);
    expect('error' in restart).toBe(true);
    expect((restart as any).error).toMatch(/Could not stop the existing project process/);
  });

  it('refuses to run when the runtime is missing', () => {
    const svc = new ProjectRunService();
    const res = svc.start(testDir, {
      language: 'rust',
      runCommand: 'cargo run',
      runtimeAvailable: false,
    } as any);
    expect('error' in res).toBe(true);
    expect((res as any).error).toContain('not installed');
  });
});

describe('Project Memory (§14 — context across conversations)', () => {
  it('records and restores the active project', () => {
    fs.mkdirSync(path.join(testDir, 'CarGame'));
    const mem = new ProjectMemory(testDir);
    mem.setActive('CarGame', path.join(testDir, 'CarGame'));
    const active = mem.getActive();
    expect(active?.name).toBe('CarGame');
    expect(active?.root).toBe(path.join(testDir, 'CarGame'));
  });

  it('persists across instances (restarts)', () => {
    fs.mkdirSync(path.join(testDir, 'Calculator'));
    new ProjectMemory(testDir).setActive('Calculator', path.join(testDir, 'Calculator'));
    const again = new ProjectMemory(testDir);
    expect(again.getActive()?.name).toBe('Calculator');
  });

  it('updates from a detected profile', () => {
    fs.mkdirSync(path.join(testDir, 'App'));
    fs.writeFileSync(path.join(testDir, 'App', 'main.py'), 'print(1)\n');
    const mem = new ProjectMemory(testDir);
    const profile = LanguageRunnerRegistry.detect(path.join(testDir, 'App'));
    mem.updateFromProfile('App', path.join(testDir, 'App'), profile);
    expect(mem.getActive()?.language).toBe('python');
    expect(mem.getActive()?.entryPoint).toBe('main.py');
  });

  it('resolves "fix the car" to the CarGame project', () => {
    fs.mkdirSync(path.join(testDir, 'CarGame'));
    fs.mkdirSync(path.join(testDir, 'Portfolio'));
    const mem = new ProjectMemory(testDir);
    mem.setActive('CarGame', path.join(testDir, 'CarGame'));
    mem.setActive('Portfolio', path.join(testDir, 'Portfolio'));
    const ref = mem.resolveReference('fix the car');
    expect(ref?.name).toBe('CarGame');
    const ref2 = mem.resolveReference('improve the portfolio');
    expect(ref2?.name).toBe('Portfolio');
  });

  it('records errors and marks them fixed', () => {
    fs.mkdirSync(path.join(testDir, 'Game'));
    const mem = new ProjectMemory(testDir);
    mem.recordError('Game', path.join(testDir, 'Game'), 'NameError: name not defined', 'main.py');
    expect(mem.getActive()?.errors.some((e) => !e.resolved)).toBe(true);
    mem.recordFix('Game', path.join(testDir, 'Game'), 'main.py');
    expect(mem.getActive()?.errors.every((e) => e.resolved)).toBe(true);
  });

  it('produces a system-prompt context block', () => {
    fs.mkdirSync(path.join(testDir, 'CarGame'));
    const mem = new ProjectMemory(testDir);
    mem.setActive('CarGame', path.join(testDir, 'CarGame'));
    mem.updateFromProfile('CarGame', path.join(testDir, 'CarGame'), {
      language: 'python',
      languageLabel: 'Python',
      projectType: 'python-script',
      entryPoint: 'main.py',
      dependencies: { pygame: 'pygame' },
      runCommand: 'python main.py',
      previewable: false,
      detectionNotes: [],
    } as any);
    const ctx = mem.toContextString();
    expect(ctx).toContain('CarGame');
    expect(ctx).toContain('python');
  });

  it('never treats a deleted project folder as resolvable', () => {
    const goneDir = path.join(testDir, 'GhostApp');
    fs.mkdirSync(goneDir);
    const mem = new ProjectMemory(testDir);
    mem.setActive('GhostApp', goneDir);
    fs.rmSync(goneDir, { recursive: true });
    expect(mem.resolveReference('fix the ghost app')).toBeUndefined();
  });
});
