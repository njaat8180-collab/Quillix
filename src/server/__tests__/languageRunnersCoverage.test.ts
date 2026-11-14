import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';

const childState = vi.hoisted(() => ({
  spawnSync: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock('child_process', async () => {
  const { EventEmitter: MockEventEmitter } = await import('node:events');
  return {
    spawnSync: childState.spawnSync,
    spawn: childState.spawn,
    ChildProcess: MockEventEmitter,
  };
});

import {
  LanguageRunnerRegistry,
  ProjectRunService,
  clearRuntimeCache,
  probeRuntime,
} from '../languageRunners.js';

let testDir: string;

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-language-runners-'));
  clearRuntimeCache();
  childState.spawnSync.mockReset();
  childState.spawnSync.mockReturnValue({ status: 0, stdout: 'v1.0.0', stderr: '' });
  childState.spawn.mockReset();
});

afterEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
  vi.useRealTimers();
});

function write(name: string, content = ''): void {
  const target = path.join(testDir, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

describe('LanguageRunnerRegistry language detection', () => {
  it('detects Maven, Gradle, and single-file Java projects', () => {
    write('pom.xml');
    write('Main.java');
    expect(LanguageRunnerRegistry.detect(testDir)).toMatchObject({ language: 'java', projectType: 'maven-project', runCommand: 'mvn exec:java', testCommand: 'mvn test' });
    fs.rmSync(path.join(testDir, 'pom.xml'));
    write('build.gradle.kts');
    expect(LanguageRunnerRegistry.detect(testDir)).toMatchObject({ language: 'java', projectType: 'gradle-project', runCommand: 'gradle run', testCommand: 'gradle test' });
    fs.rmSync(path.join(testDir, 'build.gradle.kts'));
    expect(LanguageRunnerRegistry.detect(testDir)).toMatchObject({ language: 'java', projectType: 'java-single-file', runCommand: 'java "Main.java"' });
  });

  it('detects .NET projects and C# source files', () => {
    write('Sample.csproj');
    write('Program.cs');
    expect(LanguageRunnerRegistry.detect(testDir)).toMatchObject({ language: 'csharp', projectType: 'dotnet-project', runCommand: 'dotnet run', testCommand: 'dotnet test' });
    fs.rmSync(path.join(testDir, 'Sample.csproj'));
    expect(LanguageRunnerRegistry.detect(testDir)).toMatchObject({ language: 'csharp', projectType: 'dotnet-single-file', runCommand: 'dotnet run "Program.cs"' });
  });

  it('detects CMake and single-file C and C++ projects', () => {
    write('CMakeLists.txt');
    write('main.cpp');
    expect(LanguageRunnerRegistry.detect(testDir)).toMatchObject({ language: 'cpp', projectType: 'cmake-project', runCommand: 'cmake --build build && ./build/main' });
    fs.rmSync(path.join(testDir, 'main.cpp'));
    fs.rmSync(path.join(testDir, 'CMakeLists.txt'));
    write('main.c');
    expect(LanguageRunnerRegistry.detect(testDir)).toMatchObject({ language: 'c', projectType: 'c-single-file', runCommand: 'gcc -O2 -o main.out "main.c" && ./main.out' });
  });

  it('detects Vite, TypeScript, and plain Node projects with constructed commands', () => {
    write('package.json', JSON.stringify({ scripts: { dev: 'vite' }, dependencies: { vite: '^8.0.0' } }));
    write('index.ts');
    expect(LanguageRunnerRegistry.detect(testDir)).toMatchObject({ language: 'node', projectType: 'vite-app', runCommand: 'npm run dev', installCommand: 'npm install' });
    fs.rmSync(path.join(testDir, 'package.json'));
    expect(LanguageRunnerRegistry.detect(testDir)).toMatchObject({ language: 'node', projectType: 'typescript-script', runCommand: 'npx tsx "index.ts"' });
    fs.rmSync(path.join(testDir, 'index.ts'));
    write('server.js');
    expect(LanguageRunnerRegistry.detect(testDir)).toMatchObject({ language: 'node', projectType: 'node-script', runCommand: 'node "server.js"' });
  });

  it('detects Python projects and constructs test and dependency commands', () => {
    write('main.py');
    write('test_main.py');
    write('requirements.txt', 'pytest>=8\n# comment\n');
    expect(LanguageRunnerRegistry.detect(testDir)).toMatchObject({
      language: 'python',
      projectType: 'python-script',
      runCommand: 'python "main.py"',
      testCommand: 'python -m pytest',
      installCommand: 'pip install -r requirements.txt',
    });
  });

  it('detects PHP, Ruby, Kotlin, and Swift scripts', () => {
    write('index.php');
    expect(LanguageRunnerRegistry.detect(testDir)).toMatchObject({ language: 'php', runCommand: 'php "index.php"' });
    fs.rmSync(path.join(testDir, 'index.php'));
    write('main.rb');
    expect(LanguageRunnerRegistry.detect(testDir)).toMatchObject({ language: 'ruby', runCommand: 'ruby "main.rb"' });
    fs.rmSync(path.join(testDir, 'main.rb'));
    write('Main.kt');
    expect(LanguageRunnerRegistry.detect(testDir)).toMatchObject({ language: 'kotlin', runCommand: 'kotlinc "Main.kt" -include-runtime -d Main.jar && java -jar Main.jar' });
    fs.rmSync(path.join(testDir, 'Main.kt'));
    write('main.swift');
    expect(LanguageRunnerRegistry.detect(testDir)).toMatchObject({ language: 'swift', runCommand: 'swift "main.swift"' });
  });

  it('detects Dart, Lua, R, and SQL projects', () => {
    write('pubspec.yaml');
    write('bin/main.dart');
    expect(LanguageRunnerRegistry.detect(testDir)).toMatchObject({ language: 'dart', projectType: 'dart-project', runCommand: 'dart run', testCommand: 'dart test' });
    fs.rmSync(path.join(testDir, 'pubspec.yaml'));
    fs.rmSync(path.join(testDir, 'bin'), { recursive: true });
    write('main.lua');
    expect(LanguageRunnerRegistry.detect(testDir)).toMatchObject({ language: 'lua', runCommand: 'lua "main.lua"' });
    fs.rmSync(path.join(testDir, 'main.lua'));
    write('script.r');
    expect(LanguageRunnerRegistry.detect(testDir)).toMatchObject({ language: 'r', runCommand: 'Rscript "script.r"' });
    fs.rmSync(path.join(testDir, 'script.r'));
    write('query.sql');
    expect(LanguageRunnerRegistry.detect(testDir)).toMatchObject({ language: 'sql', projectType: 'sql-files', entryPoint: 'query.sql' });
  });

  it('detects Shell, PowerShell, and static web projects', () => {
    write('run.sh');
    expect(LanguageRunnerRegistry.detect(testDir)).toMatchObject({ language: 'shell', projectType: 'shell-script', runCommand: 'bash "run.sh"' });
    fs.rmSync(path.join(testDir, 'run.sh'));
    write('start.ps1');
    expect(LanguageRunnerRegistry.detect(testDir)).toMatchObject({ language: 'shell', projectType: 'powershell-script', runCommand: 'powershell -File "start.ps1"' });
    fs.rmSync(path.join(testDir, 'start.ps1'));
    write('index.html');
    expect(LanguageRunnerRegistry.detect(testDir)).toMatchObject({ language: 'static-web', projectType: 'web-static', previewable: true, previewEntry: 'index.html' });
  });
});

describe('runtime probing and project execution safeguards', () => {
  it('uses a bounded timeout when probing a runtime', () => {
    childState.spawnSync.mockReturnValue({ error: new Error('timeout'), status: null });
    expect(probeRuntime('missing-runtime')).toEqual({ available: false, version: undefined });
    expect(childState.spawnSync).toHaveBeenCalledWith('missing-runtime', ['--version'], expect.objectContaining({ timeout: 8000 }));
  });

  it('returns missing-runtime and no-command errors before spawning', () => {
    const service = new ProjectRunService();
    expect(service.start(testDir, { language: 'rust', runtimeAvailable: false, runtimeBinary: 'cargo', runCommand: 'cargo run' } as any))
      .toEqual({ error: "Runtime 'cargo' is not installed on this machine." });
    expect(service.start(testDir, { language: 'static-web', runtimeAvailable: false, runCommand: '' } as any))
      .toEqual({ error: 'This project has no run command — it may be preview-only or not runnable.' });
    expect(childState.spawn).not.toHaveBeenCalled();
  });

  it('rejects dangerous run commands and invalid project roots', () => {
    const service = new ProjectRunService();
    expect(service.start(testDir, { language: 'node', runtimeAvailable: true, runCommand: 'node app.js && echo unsafe' } as any))
      .toEqual({ error: 'Run command contains disallowed patterns.' });
    expect(service.start(path.join(testDir, 'missing'), { language: 'node', runtimeAvailable: true, runCommand: 'node app.js' } as any))
      .toEqual({ error: 'Project root must be an existing directory.' });
    expect(childState.spawn).not.toHaveBeenCalled();
  });

  it('truncates oversized process output while retaining its tail', async () => {
    const child = new EventEmitter() as any;
    child.pid = 4242;
    child.exitCode = null;
    child.kill = vi.fn(() => true);
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    childState.spawn.mockReturnValue(child);
    const service = new ProjectRunService();
    const started = service.start(testDir, { language: 'node', runtimeAvailable: true, runCommand: 'node app.js' } as any) as any;
    expect(started.status).toBe('running');
    child.stdout.emit('data', Buffer.from('x'.repeat(250000)));
    const status = service.status(started.id)!;
    expect(status.output).toContain('output truncated');
    expect(status.output.length).toBeLessThan(210000);
    expect(status.output).toContain('x');
  });

  it('reports a synchronous process start failure', () => {
    childState.spawn.mockImplementation(() => { throw new Error('spawn failed'); });
    const service = new ProjectRunService();
    expect(service.start(testDir, { language: 'node', runtimeAvailable: true, runCommand: 'node app.js' } as any))
      .toEqual({ error: 'Failed to start project: spawn failed' });
  });
});
