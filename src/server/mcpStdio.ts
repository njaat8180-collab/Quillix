import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

export interface StdioMcpTool {
  name: string;
  description?: string;
  inputSchema: { type: 'object'; properties?: Record<string, unknown>; required?: string[]; [key: string]: unknown };
}

type Pending = {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

const PROTOCOL_VERSION = '2025-03-26';
const MAX_FRAME_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;

function safeEnvironment(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const keep = ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'ComSpec'];
  const env: NodeJS.ProcessEnv = {};
  for (const key of keep) if (process.env[key]) env[key] = process.env[key];
  for (const [key, value] of Object.entries(extra)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key) || typeof value !== 'string' || value.length > 4096) {
      throw new Error(`Invalid MCP environment variable: ${key}`);
    }
    env[key] = value;
  }
  return env;
}

/** Minimal MCP Streamable stdio client. It never invokes a shell and accepts
 * only bounded Content-Length framed JSON-RPC messages. */
export class StdioMcpClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private buffer = Buffer.alloc(0);
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private closed = false;
  private stderr = '';

  public constructor(command: string, args: string[] = [], environment: Record<string, string> = {}) {
    if (!command.trim() || command.length > 512) throw new Error('MCP stdio command is required and must be at most 512 characters.');
    if (!Array.isArray(args) || args.length > 64 || args.some(arg => typeof arg !== 'string' || arg.length > 4096)) {
      throw new Error('MCP stdio arguments are invalid or too large.');
    }
    this.child = spawn(command, args, {
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: safeEnvironment(environment),
    });
    this.child.stdout.on('data', (chunk: Buffer) => this.consume(chunk));
    this.child.stderr.on('data', (chunk: Buffer) => {
      this.stderr = `${this.stderr}${chunk.toString('utf8')}`.slice(-4000);
    });
    this.child.on('error', error => this.failAll(new Error(`MCP stdio process failed: ${error.message}`)));
    this.child.on('exit', (code, signal) => {
      this.failAll(new Error(`MCP stdio process exited (code ${code ?? 'unknown'}, signal ${signal ?? 'none'}).${this.stderr ? ` ${this.stderr.trim()}` : ''}`));
    });
  }

  private failAll(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    for (const item of this.pending.values()) {
      clearTimeout(item.timer);
      item.reject(error);
    }
    this.pending.clear();
  }

  private consume(chunk: Buffer): void {
    if (this.closed) return;
    this.buffer = Buffer.concat([this.buffer, chunk]);
    if (this.buffer.length > MAX_FRAME_BYTES) {
      this.close();
      return;
    }
    while (this.buffer.length > 0) {
      const separator = this.buffer.indexOf(Buffer.from('\r\n\r\n'));
      if (separator < 0) return;
      const header = this.buffer.subarray(0, separator).toString('ascii');
      const match = /(?:^|\r\n)content-length:\s*(\d+)\s*(?:\r\n|$)/i.exec(header);
      if (!match) {
        this.close();
        return;
      }
      const length = Number(match[1]);
      if (!Number.isSafeInteger(length) || length < 1 || length > MAX_FRAME_BYTES) {
        this.close();
        return;
      }
      const frameStart = separator + 4;
      if (this.buffer.length < frameStart + length) return;
      const payload = this.buffer.subarray(frameStart, frameStart + length).toString('utf8');
      this.buffer = this.buffer.subarray(frameStart + length);
      try {
        const message = JSON.parse(payload);
        if (!Number.isSafeInteger(message?.id)) continue;
        const pending = this.pending.get(message.id);
        if (!pending) continue;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(String(message.error.message || 'MCP JSON-RPC request failed.')));
        else pending.resolve(message.result);
      } catch {
        this.close();
        return;
      }
    }
  }

  private write(message: Record<string, unknown>): void {
    if (this.closed || !this.child.stdin.writable) throw new Error('MCP stdio process is not available.');
    const payload = Buffer.from(JSON.stringify(message), 'utf8');
    if (payload.length > MAX_FRAME_BYTES) throw new Error('MCP request is too large.');
    this.child.stdin.write(`Content-Length: ${payload.length}\r\n\r\n`);
    this.child.stdin.write(payload);
  }

  public request(method: string, params: Record<string, unknown> = {}): Promise<any> {
    if (!/^[A-Za-z0-9_./:-]{1,128}$/.test(method)) return Promise.reject(new Error('Invalid MCP method.'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP stdio request timed out: ${method}`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      try { this.write({ jsonrpc: '2.0', id, method, params }); }
      catch (error: any) { clearTimeout(timer); this.pending.delete(id); reject(error instanceof Error ? error : new Error(String(error))); }
    });
  }

  public notify(method: string, params: Record<string, unknown> = {}): void {
    this.write({ jsonrpc: '2.0', method, params });
  }

  public close(): void {
    if (this.closed) return;
    this.failAll(new Error('MCP stdio connection closed.'));
    try { this.child.kill(); } catch { /* already exited */ }
  }
}

export { PROTOCOL_VERSION as MCP_STDIO_PROTOCOL_VERSION };
