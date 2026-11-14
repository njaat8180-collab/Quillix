import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

type DebugStatus = 'starting' | 'paused' | 'running' | 'exited' | 'stopped' | 'error';

interface PausedState {
  callFrames?: Array<{ callFrameId: string; functionName?: string; url?: string; location?: { scriptId?: string; lineNumber?: number; columnNumber?: number }; scopeChain?: unknown[] }>;
  reason?: string;
}

interface DebugSession {
  id: string;
  child: ChildProcessWithoutNullStreams;
  socket: any;
  nextRequestId: number;
  pending: Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>;
  paused?: PausedState;
  status: DebugStatus;
  output: string[];
  inspectUrl: string;
  scriptPath: string;
  scripts: Map<string, string>;
  breakpoints: Map<string, { filePath: string; line: number; column: number }>;
  lastActivity: number;
}

const MAX_SESSIONS = 4;
const REQUEST_TIMEOUT_MS = 5000;
// Packaged Electron startup can be slower on a cold Windows machine (or while
// Defender scans the unpacked child). Keep launch bounded, but do not turn a
// slow inspector startup into a false debugger failure.
const LAUNCH_TIMEOUT_MS = 15000;
const MAX_OUTPUT_CHARS = 4000;
const MAX_BREAKPOINTS_PER_SESSION = 50;
const SESSION_IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const MAX_EXPRESSION_LENGTH = 8000;
const DANGEROUS_EXPRESSION_PATTERNS = [
  /require\s*\(\s*['"]child_process['"]/i,
  /require\s*\(\s*['"]fs['"]/i,
  /process\.exit/i,
  /process\.kill/i,
  /global\./i,
  /eval\s*\(/i,
  /Function\s*\(/i,
  /new\s+Function/i,
  /setTimeout\s*\(/i,
  /setInterval\s*\(/i,
];

function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function sanitizeFilePath(filePath: string): string {
  // Remove null bytes and control characters
  return filePath.replace(/[\x00-\x1f\x7f]/g, '').trim();
}

function validateExpression(expr: string): void {
  if (expr.length > MAX_EXPRESSION_LENGTH) {
    throw new Error(`Expression exceeds maximum length of ${MAX_EXPRESSION_LENGTH} characters.`);
  }
  for (const pattern of DANGEROUS_EXPRESSION_PATTERNS) {
    if (pattern.test(expr)) {
      throw new Error('Expression contains disallowed operations (process/fs/eval/timers/global access).');
    }
  }
}

function displayPath(root: string, file: string): string {
  if (!file) return file;
  const source = file.startsWith('file://') ? fileURLToPath(file) : file;
  const absolute = path.resolve(source);
  try {
    const rootReal = fs.realpathSync(root);
    const absoluteReal = fs.realpathSync(absolute);
    return inside(rootReal, absoluteReal) ? path.relative(rootReal, absoluteReal).replace(/\\/g, '/') : file;
  } catch {
    return inside(root, absolute) ? path.relative(root, absolute).replace(/\\/g, '/') : file;
  }
}

function compactValue(value: any): any {
  if (!value || typeof value !== 'object') return value;
  const result: Record<string, unknown> = {};
  for (const key of ['type', 'subtype', 'value', 'description', 'unserializableValue', 'objectId']) {
    if (value[key] !== undefined) result[key] = value[key];
  }
  return result;
}

/**
 * Small, local Chrome DevTools Protocol adapter for Node scripts.
 * It intentionally supports a bounded coding-agent slice: launch,
 * breakpoints, stepping, pause/resume, stack inspection, expression
 * evaluation and stop. The child is bound to the workspace and the
 * inspector remains on loopback.
 */
export class NodeDebugger {
  private readonly sessions = new Map<string, DebugSession>();
  private sequence = 0;

  constructor(private workspaceRoot: string) {
    this.workspaceRoot = fs.realpathSync(path.resolve(workspaceRoot));
  }

  /** Rebind the inspector adapter when the user opens another workspace. */
  async setWorkspaceRoot(workspaceRoot: string): Promise<void> {
    await this.dispose();
    this.workspaceRoot = fs.realpathSync(path.resolve(workspaceRoot));
  }

  private resolveWorkspacePath(filePath: string): string {
    if (typeof filePath !== 'string' || !filePath.trim()) throw new Error('A non-empty JavaScript filePath is required.');
    const sanitized = sanitizeFilePath(filePath);
    if (sanitized !== filePath) throw new Error('File path contains invalid characters.');
    const absolute = path.resolve(this.workspaceRoot, sanitized);
    if (!inside(this.workspaceRoot, absolute)) throw new Error('Debugger filePath must stay inside the workspace.');
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) throw new Error('Debugger filePath must point to an existing file.');
    if (!/\.(?:cjs|mjs|js)$/i.test(absolute)) throw new Error('The Node debugger currently supports .js, .mjs and .cjs files.');
    const rootReal = fs.realpathSync(this.workspaceRoot);
    const targetReal = fs.realpathSync(absolute);
    if (!inside(rootReal, targetReal)) throw new Error('Debugger filePath must resolve inside the workspace; symlink escapes are blocked.');
    return targetReal;
  }

  private resolveCwd(cwd?: string): string {
    const raw = typeof cwd === 'string' && cwd.trim() ? cwd : '.';
    const sanitized = sanitizeFilePath(raw);
    if (sanitized !== raw) throw new Error('Working directory contains invalid characters.');
    const absolute = path.resolve(this.workspaceRoot, sanitized);
    if (!inside(this.workspaceRoot, absolute) || !fs.existsSync(absolute) || !fs.statSync(absolute).isDirectory()) throw new Error('Debugger cwd must be an existing workspace directory.');
    const rootReal = fs.realpathSync(this.workspaceRoot);
    const cwdReal = fs.realpathSync(absolute);
    if (!inside(rootReal, cwdReal)) throw new Error('Debugger cwd must resolve inside the workspace; symlink escapes are blocked.');
    return cwdReal;
  }

  private async waitForInspectUrl(child: ChildProcessWithoutNullStreams): Promise<{ url: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      let stderr = '';
      let settled = false;
      const finish = (fn: (value: any) => void, value: any) => { if (settled) return; settled = true; clearTimeout(timer); fn(value); };
      const onData = (chunk: Buffer) => {
        stderr = `${stderr}${chunk.toString('utf8')}`.slice(-MAX_OUTPUT_CHARS);
        const match = /Debugger listening on (ws:\/\/127\.0\.0\.1:\d+\/[^\s]+)/.exec(stderr);
        if (match) finish(resolve, { url: match[1], stderr });
      };
      child.stderr.on('data', onData);
      const onError = (error: Error) => finish(reject, error);
      const onExit = (code: number | null) => finish(reject, new Error(`Node debugger process exited before inspector startup (code ${code ?? 'unknown'}).`));
      child.once('error', onError);
      child.once('exit', onExit);
      const timer = setTimeout(() => finish(reject, new Error(`Node inspector did not start within ${LAUNCH_TIMEOUT_MS} ms. ${stderr.trim() ? `Child output: ${stderr.trim().slice(-800)}` : 'The child produced no inspector output.'}`)), LAUNCH_TIMEOUT_MS);
    });
  }

  private resolveNodeRuntime(): string {
    // Electron's process.execPath is QUILLIX.exe, not node.exe. Prefer an
    // explicitly supplied Node runtime, then common Windows installations,
    // and finally PATH resolution. This makes the packaged debugger work when
    // the Electron-launched process has a reduced or stale PATH.
    if (!(process as any).versions?.electron) return process.execPath;
    const candidates = [
      process.env.QUILLIX_NODE_RUNTIME,
      process.env.npm_node_execpath,
      process.env.NODE,
      process.env.ProgramW6432 ? path.join(process.env.ProgramW6432, 'nodejs', 'node.exe') : undefined,
      process.env.ProgramFiles ? path.join(process.env.ProgramFiles, 'nodejs', 'node.exe') : undefined,
      process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs', 'nodejs', 'node.exe') : undefined,
    ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
    for (const candidate of candidates) {
      if (path.basename(candidate).toLowerCase().startsWith('node') && fs.existsSync(candidate)) return candidate;
    }
    return process.platform === 'win32' ? 'node.exe' : 'node';
  }

  private async connect(session: DebugSession): Promise<void> {
    let lastError: unknown;
    // Node can print the inspector URL just before the WebSocket endpoint is
    // ready to accept connections, especially inside packaged Electron. Keep
    // this bounded and local; it avoids turning a startup race into a false
    // debugger failure without hiding a genuine unavailable inspector.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await this.connectOnce(session);
        return;
      } catch (error) {
        lastError = error;
        try { session.socket?.close(); } catch { /* Socket may never have opened. */ }
        session.socket = undefined;
        for (const pending of session.pending.values()) {
          clearTimeout(pending.timer);
          pending.reject(error instanceof Error ? error : new Error(String(error)));
        }
        session.pending.clear();
        if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 120 * (attempt + 1)));
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError || 'Could not connect to the local Node inspector.'));
  }

  private async connectOnce(session: DebugSession): Promise<void> {
    const WebSocketCtor = (globalThis as any).WebSocket;
    if (typeof WebSocketCtor !== 'function') throw new Error('This Node runtime does not expose WebSocket for the local inspector.');
    const socket = new WebSocketCtor(session.inspectUrl);
    session.socket = socket;
    const onMessage = (event: any) => {
      try {
        const message = JSON.parse(String(event.data));
        if (typeof message.id === 'number') {
          const pending = session.pending.get(message.id);
          if (!pending) return;
          session.pending.delete(message.id);
          clearTimeout(pending.timer);
          if (message.error) pending.reject(new Error(message.error.message || 'Inspector request failed.'));
          else pending.resolve(message.result);
          return;
        }
        if (message.method === 'Debugger.paused') {
          session.paused = message.params;
          session.status = 'paused';
        } else if (message.method === 'Debugger.scriptParsed' && message.params?.scriptId && message.params?.url) {
          session.scripts.set(String(message.params.scriptId), String(message.params.url));
        } else if (message.method === 'Debugger.resumed') {
          session.paused = undefined;
          session.status = 'running';
        }
      } catch { /* Ignore malformed inspector notifications. */ }
    };
    const onError = () => { if (session.status !== 'exited' && session.status !== 'stopped') session.status = 'error'; };
    const onClose = () => { if (session.status !== 'exited' && session.status !== 'stopped') session.status = 'error'; };
    const onOpen = () => undefined;
    if (typeof socket.addEventListener === 'function') {
      socket.addEventListener('message', onMessage);
      socket.addEventListener('error', onError);
      socket.addEventListener('close', onClose);
      socket.addEventListener('open', onOpen);
    } else {
      socket.onmessage = onMessage;
      socket.onerror = onError;
      socket.onclose = onClose;
      socket.onopen = onOpen;
    }
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Could not connect to the local Node inspector.')), REQUEST_TIMEOUT_MS);
      const opened = () => { clearTimeout(timer); resolve(); };
      if (typeof socket.addEventListener === 'function') socket.addEventListener('open', opened, { once: true });
      else socket.onopen = opened;
    });
    await this.request(session, 'Runtime.enable');
    await this.request(session, 'Debugger.enable');
  }

  private request(session: DebugSession, method: string, params?: Record<string, unknown>): Promise<any> {
    if (!session.socket || session.socket.readyState !== 1) return Promise.reject(new Error('The debugger connection is not open.'));
    const id = session.nextRequestId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { session.pending.delete(id); reject(new Error(`Inspector request timed out: ${method}`)); }, REQUEST_TIMEOUT_MS);
      session.pending.set(id, { resolve, reject, timer });
      session.socket.send(JSON.stringify({ id, method, ...(params ? { params } : {}) }));
    });
  }

  private async waitForPaused(session: DebugSession, timeout = 1500): Promise<void> {
    if (session.paused) return;
    const started = Date.now();
    while (!session.paused && Date.now() - started < timeout && session.status !== 'exited') await new Promise(resolve => setTimeout(resolve, 25));
    if (!session.paused && session.status !== 'exited') throw new Error('Node did not report a paused location in time.');
  }

  private async ensurePaused(session: DebugSession): Promise<void> {
    try {
      await this.waitForPaused(session);
      return;
    } catch (error) {
      // In a packaged Electron process the initial Debugger.paused event can
      // race with inspector startup. If the child is already running, ask the
      // inspector for a fresh pause event before declaring launch broken.
      if (session.status === 'exited') throw error;
      await this.request(session, 'Debugger.pause');
      await this.waitForPaused(session, 3000);
    }
  }

  private session(sessionId?: string): DebugSession {
    if (typeof sessionId !== 'string' || !sessionId.trim()) throw new Error('A debugger sessionId is required.');
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Unknown debugger session: ${sessionId}`);
    // Check idle timeout
    if (Date.now() - session.lastActivity > SESSION_IDLE_TIMEOUT_MS) {
      this.stop(sessionId).catch(() => undefined);
      throw new Error('Debugger session timed out due to inactivity.');
    }
    session.lastActivity = Date.now();
    return session;
  }

  private cleanupIdleSessions(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (now - session.lastActivity > SESSION_IDLE_TIMEOUT_MS) {
        this.stop(id).catch(() => undefined);
      }
    }
  }

  async launch(filePath: string, args: unknown[] = [], cwd?: string, stopOnEntry = true): Promise<any> {
    this.cleanupIdleSessions();
    if (this.sessions.size >= MAX_SESSIONS) throw new Error(`At most ${MAX_SESSIONS} debugger sessions may run at once.`);
    if (!Array.isArray(args) || args.some(arg => typeof arg !== 'string') || args.length > 32 || args.some(arg => typeof arg === 'string' && arg.length > 4096)) throw new Error('Debugger args must be at most 32 strings of 4096 characters each.');
    const script = this.resolveWorkspacePath(filePath);
    const workingDirectory = this.resolveCwd(cwd);
    const runtime = this.resolveNodeRuntime();
    const childEnv = { ...process.env };
    // The packaged server itself runs the Electron binary in plain-Node mode
    // via ELECTRON_RUN_AS_NODE. Never leak that launcher flag into a real
    // system-Node debugger child; on Windows it can suppress inspector output.
    delete childEnv.ELECTRON_RUN_AS_NODE;
    const child = spawn(runtime, ['--inspect-brk=127.0.0.1:0', script, ...args as string[]], {
      cwd: workingDirectory, shell: false, windowsHide: true, stdio: 'pipe', env: childEnv,
    });
    const id = `debug-${++this.sequence}`;
    const session: DebugSession = { id, child, socket: undefined, nextRequestId: 1, pending: new Map(), status: 'starting', output: [], inspectUrl: '', scriptPath: script, scripts: new Map(), breakpoints: new Map(), lastActivity: Date.now() };
    this.sessions.set(id, session);
    child.stdout.on('data', chunk => { session.output.push(chunk.toString('utf8')); session.output = session.output.join('').slice(-MAX_OUTPUT_CHARS).split(''); });
    child.stderr.on('data', chunk => { session.output.push(chunk.toString('utf8')); session.output = session.output.join('').slice(-MAX_OUTPUT_CHARS).split(''); });
    child.once('exit', () => { session.status = 'exited'; for (const pending of session.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('Debugger process exited.')); } session.pending.clear(); });
    try {
      const inspected = await this.waitForInspectUrl(child);
      session.inspectUrl = inspected.url;
      await this.connect(session);
      if (stopOnEntry) {
        // --inspect-brk waits for this command before it emits its first
        // paused location. Reconcile the initial break explicitly instead of
        // relying on an event that may have fired before Debugger.enable.
        await this.request(session, 'Runtime.runIfWaitingForDebugger');
        await this.ensurePaused(session);
      } else {
        await this.request(session, 'Runtime.runIfWaitingForDebugger');
        await this.request(session, 'Debugger.resume');
        session.status = 'running';
      }
      return this.describe(session);
    } catch (error) {
      await this.stop(id).catch(() => undefined);
      throw error;
    }
  }

  private describe(session: DebugSession): any {
    return { sessionId: session.id, status: session.status, filePath: displayPath(this.workspaceRoot, session.scriptPath), pid: session.child.pid, paused: Boolean(session.paused), breakpoints: [...session.breakpoints.entries()].map(([breakpointId, point]) => ({ breakpointId, ...point })), output: session.output.join('').slice(-MAX_OUTPUT_CHARS) };
  }

  async setBreakpoint(sessionId: string, filePath: string, line: number, column = 1): Promise<any> {
    const session = this.session(sessionId);
    const target = this.resolveWorkspacePath(filePath);
    if (!Number.isInteger(line) || line < 1 || line > 1_000_000 || !Number.isInteger(column) || column < 1 || column > 1_000_000) throw new Error('Breakpoint line and column must be positive integers.');
    if (session.breakpoints.size >= MAX_BREAKPOINTS_PER_SESSION) throw new Error(`Maximum ${MAX_BREAKPOINTS_PER_SESSION} breakpoints per session exceeded.`);
    const result = await this.request(session, 'Debugger.setBreakpointByUrl', { url: pathToFileURL(target).href, lineNumber: line - 1, columnNumber: column - 1 });
    const breakpointId = String(result?.breakpointId || '');
    if (!breakpointId) throw new Error('Node inspector did not return a breakpoint ID.');
    const point = { filePath: displayPath(this.workspaceRoot, target), line, column };
    session.breakpoints.set(breakpointId, point);
    return { ...this.describe(session), breakpointId, locations: Array.isArray(result?.locations) ? result.locations.slice(0, 20) : [] };
  }

  async clearBreakpoint(sessionId: string, breakpointId: string): Promise<any> {
    const session = this.session(sessionId);
    if (typeof breakpointId !== 'string' || !breakpointId.trim() || !session.breakpoints.has(breakpointId)) throw new Error('Unknown breakpoint for this debugger session.');
    await this.request(session, 'Debugger.removeBreakpoint', { breakpointId });
    session.breakpoints.delete(breakpointId);
    return this.describe(session);
  }

  breakpoints(sessionId: string): any {
    const session = this.session(sessionId);
    return { sessionId: session.id, status: session.status, breakpoints: [...session.breakpoints.entries()].map(([breakpointId, point]) => ({ breakpointId, ...point })) };
  }

  async step(sessionId: string, direction: 'over' | 'into' | 'out'): Promise<any> {
    const session = this.session(sessionId);
    if (!session.paused) throw new Error('Pause the debugger before stepping.');
    session.paused = undefined;
    session.status = 'running';
    const method = direction === 'over' ? 'Debugger.stepOver' : direction === 'into' ? 'Debugger.stepInto' : 'Debugger.stepOut';
    await this.request(session, method);
    await this.waitForPaused(session);
    return this.describe(session);
  }

  async pause(sessionId: string): Promise<any> {
    const session = this.session(sessionId);
    if (session.status === 'paused') return this.describe(session);
    await this.request(session, 'Debugger.pause');
    await this.waitForPaused(session);
    return this.describe(session);
  }

  async resume(sessionId: string): Promise<any> {
    const session = this.session(sessionId);
    if (session.status !== 'paused') return this.describe(session);
    session.paused = undefined;
    session.status = 'running';
    await this.request(session, 'Debugger.resume');
    const started = Date.now();
    while (session.status === 'running' && !session.paused && Date.now() - started < 1500) await new Promise(resolve => setTimeout(resolve, 25));
    return this.describe(session);
  }

  stack(sessionId: string): any {
    const session = this.session(sessionId);
    if (!session.paused) throw new Error('Pause the debugger before requesting stack frames.');
    const frames = (session.paused.callFrames || []).slice(0, 50).map(frame => ({
      callFrameId: frame.callFrameId,
      functionName: frame.functionName || '(anonymous)',
      filePath: displayPath(this.workspaceRoot, frame.url || session.scripts.get(frame.location?.scriptId || '') || ''),
      line: (frame.location?.lineNumber ?? 0) + 1,
      column: (frame.location?.columnNumber ?? 0) + 1,
    }));
    return { sessionId: session.id, status: session.status, reason: session.paused.reason, frames };
  }

  async evaluate(sessionId: string, expression: string): Promise<any> {
    const session = this.session(sessionId);
    if (!session.paused) throw new Error('Pause the debugger before evaluating an expression.');
    if (typeof expression !== 'string' || !expression.trim()) throw new Error('A non-empty expression is required.');
    validateExpression(expression);
    const frame = session.paused.callFrames?.[0];
    const result = frame
      ? await this.request(session, 'Debugger.evaluateOnCallFrame', { callFrameId: frame.callFrameId, expression, returnByValue: true, awaitPromise: false })
      : await this.request(session, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: false });
    return { sessionId: session.id, status: session.status, expression, result: compactValue(result?.result), exception: result?.exceptionDetails?.text };
  }

  async stop(sessionId: string): Promise<any> {
    const session = this.session(sessionId);
    if (session.status !== 'exited' && session.status !== 'stopped') {
      try { session.child.kill(); } catch { /* Process may have already exited. */ }
      // Wait for the child to actually exit. On Windows a killed child can keep
      // file handles open for a short while; a fixed sleep is a guess, and the
      // workspace cleanup that follows fails with EBUSY while the guess is wrong.
      await new Promise<void>(resolve => {
        if (session.child.exitCode !== null || session.child.signalCode !== null) { resolve(); return; }
        const timer = setTimeout(() => resolve(), 1500);
        session.child.once('exit', () => { clearTimeout(timer); resolve(); });
      });
    }
    try { session.socket?.close(); } catch { /* Already closed. */ }
    session.status = session.status === 'exited' ? 'exited' : 'stopped';
    this.sessions.delete(sessionId);
    return this.describe(session);
  }

  async dispose(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map(id => this.stop(id).catch(() => undefined)));
  }
}
