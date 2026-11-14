import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';

const debuggerState = vi.hoisted(() => ({
  spawn: vi.fn(),
}));

vi.mock('node:child_process', async () => {
  const { EventEmitter: MockEventEmitter } = await import('node:events');
  return {
    spawn: debuggerState.spawn,
    ChildProcessWithoutNullStreams: MockEventEmitter,
  };
});

import { NodeDebugger } from '../nodeDebugger.js';

let workspace: string;

class InspectorSocket {
  private readyState = 1;
  readonly url: string;
  private readonly listeners = new Map<string, Set<(event: any) => void>>();

  constructor(url: string) {
    this.url = url;
    setImmediate(() => this.dispatch('open', {}));
  }

  addEventListener(type: string, listener: (event: any) => void): void {
    const listeners = this.listeners.get(type) || new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  send(payload: string): void {
    const request = JSON.parse(payload);
    const result: any = request.method === 'Debugger.setBreakpointByUrl'
      ? { breakpointId: 'bp-1', locations: [] }
      : {};
    setImmediate(() => this.dispatch('message', { data: JSON.stringify({ id: request.id, result }) }));
  }

  close(): void {
    (this as any).readyState = 3;
    this.dispatch('close', {});
  }

  private dispatch(type: string, event: any): void {
    for (const listener of this.listeners.get(type) || []) listener(event);
  }
}

function fakeChild(inspectUrl = 'ws://127.0.0.1:41234/inspect'): any {
  const child = new EventEmitter() as any;
  child.pid = 5678;
  child.exitCode = null;
  child.kill = vi.fn(() => true);
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  setImmediate(() => child.stderr.emit('data', Buffer.from(`Debugger listening on ${inspectUrl}\n`)));
  return child;
}

beforeEach(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-node-debugger-'));
  fs.writeFileSync(path.join(workspace, 'app.js'), 'console.log("debug");\n');
  debuggerState.spawn.mockReset();
});

afterEach(() => {
  fs.rmSync(workspace, { recursive: true, force: true });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('NodeDebugger launch and attachment paths', () => {
  it('selects the workspace script and an automatic loopback inspector port', async () => {
    const child = fakeChild();
    debuggerState.spawn.mockReturnValue(child);
    vi.stubGlobal('WebSocket', InspectorSocket);
    const debuggerAdapter = new NodeDebugger(workspace);
    const result = await debuggerAdapter.launch('app.js', ['--verbose'], '.', false);
    expect(result).toMatchObject({ sessionId: 'debug-1', status: 'running', filePath: 'app.js', pid: 5678 });
    expect(debuggerState.spawn).toHaveBeenCalledTimes(1);
    const [runtime, args, options] = debuggerState.spawn.mock.calls[0];
    expect(runtime).toBe(process.execPath);
    expect(args.slice(0, 2)).toEqual(['--inspect-brk=127.0.0.1:0', path.join(workspace, 'app.js')]);
    expect(args).toContain('--verbose');
    expect(options).toMatchObject({ cwd: workspace, shell: false });
  });

  it('rejects a script outside the workspace before spawning', async () => {
    const debuggerAdapter = new NodeDebugger(workspace);
    await expect(debuggerAdapter.launch('../outside.js')).rejects.toThrow(/must stay inside the workspace/);
    expect(debuggerState.spawn).not.toHaveBeenCalled();
  });

  it('rejects missing scripts and unsupported script extensions', async () => {
    const debuggerAdapter = new NodeDebugger(workspace);
    await expect(debuggerAdapter.launch('missing.js')).rejects.toThrow(/existing file/);
    fs.writeFileSync(path.join(workspace, 'program.txt'), 'text');
    await expect(debuggerAdapter.launch('program.txt')).rejects.toThrow(/supports \.js, \.mjs and \.cjs/);
    expect(debuggerState.spawn).not.toHaveBeenCalled();
  });

  it('rejects invalid debugger arguments before spawning', async () => {
    const debuggerAdapter = new NodeDebugger(workspace);
    await expect(debuggerAdapter.launch('app.js', [123])).rejects.toThrow(/at most 32 strings/);
    expect(debuggerState.spawn).not.toHaveBeenCalled();
  });

  it('reports a synchronous child start failure', async () => {
    debuggerState.spawn.mockImplementation(() => { throw new Error('unable to start node'); });
    const debuggerAdapter = new NodeDebugger(workspace);
    await expect(debuggerAdapter.launch('app.js', [], '.', false)).rejects.toThrow('unable to start node');
  });

  it('reports a child that exits before publishing an inspector URL', async () => {
    const child = new EventEmitter() as any;
    child.pid = 9012;
    child.exitCode = 1;
    child.kill = vi.fn(() => true);
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    setImmediate(() => child.emit('exit', 1));
    debuggerState.spawn.mockReturnValue(child);
    const debuggerAdapter = new NodeDebugger(workspace);
    await expect(debuggerAdapter.launch('app.js', [], '.', false)).rejects.toThrow(/exited before inspector startup \(code 1\)/);
  });

  it('reports an unavailable WebSocket inspector attachment', async () => {
    debuggerState.spawn.mockReturnValue(fakeChild());
    vi.stubGlobal('WebSocket', undefined);
    const debuggerAdapter = new NodeDebugger(workspace);
    await expect(debuggerAdapter.launch('app.js', [], '.', false)).rejects.toThrow(/does not expose WebSocket/);
  });

  it('rebinds to another workspace and rejects its old script path', async () => {
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-node-debugger-other-'));
    fs.writeFileSync(path.join(other, 'other.js'), 'console.log("other");\n');
    try {
      const debuggerAdapter = new NodeDebugger(workspace);
      await debuggerAdapter.setWorkspaceRoot(other);
      await expect(debuggerAdapter.launch('app.js')).rejects.toThrow(/existing file/);
    } finally {
      fs.rmSync(other, { recursive: true, force: true });
    }
  });
});
