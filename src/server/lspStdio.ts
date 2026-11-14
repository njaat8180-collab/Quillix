import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export type LspLocation = {
  filePath: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
};

export type LspDiagnostic = LspLocation & {
  message: string;
  severity: 'error' | 'warning' | 'information' | 'hint';
  source?: string;
  code?: string | number;
};

export type LspTextEdit = {
  filePath: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  newText: string;
};

export type LspSymbol = {
  name: string;
  kind: number;
  containerName?: string;
  location: LspLocation;
};

type Pending = {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

const MAX_FRAME_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;
const DIAGNOSTIC_WAIT_MS = 350;

function safeEnvironment(): NodeJS.ProcessEnv {
  const keep = ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'ComSpec'];
  const env: NodeJS.ProcessEnv = {};
  for (const key of keep) if (process.env[key]) env[key] = process.env[key];
  return env;
}

function languageId(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  const ids: Record<string, string> = {
    '.c': 'c', '.h': 'c', '.cc': 'cpp', '.cpp': 'cpp', '.cxx': 'cpp',
    '.cs': 'csharp', '.css': 'css', '.go': 'go', '.html': 'html', '.htm': 'html',
    '.java': 'java', '.js': 'javascript', '.cjs': 'javascript', '.mjs': 'javascript',
    '.jsx': 'javascriptreact', '.json': 'json', '.kt': 'kotlin', '.md': 'markdown',
    '.php': 'php', '.py': 'python', '.rb': 'ruby', '.rs': 'rust', '.scss': 'scss',
    '.sh': 'shellscript', '.sql': 'sql', '.ts': 'typescript', '.mts': 'typescript',
    '.cts': 'typescript', '.tsx': 'typescriptreact', '.vue': 'vue', '.xml': 'xml',
    '.yaml': 'yaml', '.yml': 'yaml',
  };
  return ids[extension] || 'plaintext';
}

function severity(value: unknown): LspDiagnostic['severity'] {
  return value === 1 ? 'error' : value === 2 ? 'warning' : value === 3 ? 'information' : 'hint';
}

/**
 * Small, provider-independent LSP client for local language servers.
 * It speaks the standard Content-Length JSON-RPC framing over stdio, starts
 * the process without a shell, and never allows a result to escape the
 * configured workspace root.
 */
export class LspStdioClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly root: string;
  private buffer = Buffer.alloc(0);
  private readonly pending = new Map<number, Pending>();
  private readonly diagnosticsByUri = new Map<string, LspDiagnostic[]>();
  private nextId = 1;
  private version = 0;
  private closed = false;
  private capabilities: any = {};
  private readonly onClosed?: () => void;

  public constructor(command: string, args: string[] = [], workspaceRoot: string, onClosed?: () => void) {
    if (!command.trim() || command.length > 512) throw new Error('LSP command is required and must be at most 512 characters.');
    if (!Array.isArray(args) || args.length > 64 || args.some(arg => typeof arg !== 'string' || arg.length > 4096)) {
      throw new Error('LSP arguments are invalid or too large.');
    }
    this.root = path.resolve(workspaceRoot);
    this.onClosed = onClosed;
    if (!fs.existsSync(this.root) || !fs.statSync(this.root).isDirectory()) throw new Error('LSP workspace root must be an existing directory.');
    this.child = spawn(command, args, {
      shell: false,
      windowsHide: true,
      cwd: this.root,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: safeEnvironment(),
    });
    this.child.stdout.on('data', (chunk: Buffer) => this.consume(chunk));
    this.child.on('error', error => this.failAll(new Error(`LSP process failed: ${error.message}`)));
    // Language servers are workspace extensions; their stderr can contain
    // paths and environment secrets, so never forward it through tool errors.
    this.child.on('exit', (code, signal) => this.failAll(new Error(`LSP process exited (code ${code ?? 'unknown'}, signal ${signal ?? 'none'}).`)));
  }

  private failAll(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(error); }
    this.pending.clear();
    this.onClosed?.();
  }

  private consume(chunk: Buffer): void {
    if (this.closed) return;
    this.buffer = Buffer.concat([this.buffer, chunk]);
    if (this.buffer.length > MAX_FRAME_BYTES) { this.close(); return; }
    while (this.buffer.length > 0) {
      const separator = this.buffer.indexOf(Buffer.from('\r\n\r\n'));
      if (separator < 0) return;
      const header = this.buffer.subarray(0, separator).toString('ascii');
      const match = /(?:^|\r\n)content-length:\s*(\d+)\s*(?:\r\n|$)/i.exec(header);
      if (!match) { this.close(); return; }
      const length = Number(match[1]);
      if (!Number.isSafeInteger(length) || length < 1 || length > MAX_FRAME_BYTES) { this.close(); return; }
      const frameStart = separator + 4;
      if (this.buffer.length < frameStart + length) return;
      const payload = this.buffer.subarray(frameStart, frameStart + length).toString('utf8');
      this.buffer = this.buffer.subarray(frameStart + length);
      try {
        const message = JSON.parse(payload);
        if (typeof message?.method === 'string' && message.id === undefined) {
          this.handleNotification(message.method, message.params);
          continue;
        }
        if (!Number.isSafeInteger(message?.id)) continue;
        const pending = this.pending.get(message.id);
        if (!pending) continue;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(String(message.error.message || 'LSP JSON-RPC request failed.')));
        else pending.resolve(message.result);
      } catch {
        this.close();
        return;
      }
    }
  }

  private handleNotification(method: string, params: any): void {
    if (method !== 'textDocument/publishDiagnostics' || typeof params?.uri !== 'string' || !Array.isArray(params.diagnostics)) return;
    this.diagnosticsByUri.set(params.uri, params.diagnostics.slice(0, 500).map((item: any) => this.normalizeDiagnostic(params.uri, item)).filter(Boolean));
  }

  private write(message: Record<string, unknown>): void {
    if (this.closed || !this.child.stdin.writable) throw new Error('LSP process is not available.');
    const payload = Buffer.from(JSON.stringify(message), 'utf8');
    if (payload.length > MAX_FRAME_BYTES) throw new Error('LSP request is too large.');
    this.child.stdin.write(`Content-Length: ${payload.length}\r\n\r\n`);
    this.child.stdin.write(payload);
  }

  private request(method: string, params: Record<string, unknown> = {}): Promise<any> {
    if (!/^[A-Za-z0-9_.$/:-]{1,128}$/.test(method)) return Promise.reject(new Error('Invalid LSP method.'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`LSP request timed out: ${method}`)); }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      try { this.write({ jsonrpc: '2.0', id, method, params }); }
      catch (error: any) { clearTimeout(timer); this.pending.delete(id); reject(error instanceof Error ? error : new Error(String(error))); }
    });
  }

  private notify(method: string, params: Record<string, unknown> = {}): void {
    this.write({ jsonrpc: '2.0', method, params });
  }

  private safeFile(filePath: string): { relative: string; absolute: string; uri: string } {
    if (typeof filePath !== 'string' || !filePath.trim()) throw new Error('filePath is required.');
    const absolute = path.resolve(this.root, filePath);
    const relative = path.relative(this.root, absolute);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('LSP file must stay inside the workspace.');
    const normalized = relative.replace(/\\/g, '/');
    return { relative: normalized, absolute, uri: pathToFileURL(absolute).href };
  }

  private position(filePath: string, line: unknown, column: unknown): { file: ReturnType<LspStdioClient['safeFile']>; line: number; column: number } {
    const file = this.safeFile(filePath);
    const lineNumber = Number(line);
    const columnNumber = Number(column);
    if (!Number.isInteger(lineNumber) || lineNumber < 1 || lineNumber > 1_000_000 || !Number.isInteger(columnNumber) || columnNumber < 1 || columnNumber > 1_000_000) {
      throw new Error('line and column must be positive integers (1-based).');
    }
    return { file, line: lineNumber - 1, column: columnNumber - 1 };
  }

  private async open(filePath: string): Promise<ReturnType<LspStdioClient['safeFile']>> {
    const file = this.safeFile(filePath);
    const stat = fs.statSync(file.absolute);
    if (!stat.isFile() || stat.size > 512 * 1024) throw new Error('LSP supports workspace text files up to 512 KiB.');
    const text = fs.readFileSync(file.absolute, 'utf8');
    this.version++;
    this.notify('textDocument/didOpen', { textDocument: { uri: file.uri, languageId: languageId(file.relative), version: this.version, text } });
    return file;
  }

  public async initialize(): Promise<void> {
    const rootUri = pathToFileURL(this.root).href;
    const result = await this.request('initialize', {
      processId: process.pid,
      rootUri,
      workspaceFolders: [{ uri: rootUri, name: path.basename(this.root) }],
      capabilities: {
        workspace: { workspaceFolders: true },
        textDocument: {
          synchronization: { dynamicRegistration: false, didSave: false },
          definition: { dynamicRegistration: false, linkSupport: true },
          references: { dynamicRegistration: false },
          publishDiagnostics: { relatedInformation: true },
        },
      },
      clientInfo: { name: 'QUILLIX', version: '1.2.0' },
    });
    this.capabilities = result?.capabilities || {};
    this.notify('initialized', {});
  }

  private toLocation(value: any): LspLocation | undefined {
    const uri = typeof value?.uri === 'string' ? value.uri : typeof value?.targetUri === 'string' ? value.targetUri : undefined;
    const range = value?.range || value?.targetSelectionRange || value?.targetRange;
    if (!uri || !range?.start) return undefined;
    let absolute: string;
    try { absolute = fileURLToPath(uri); } catch { return undefined; }
    const relative = path.relative(this.root, absolute);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return undefined;
    return {
      filePath: relative.replace(/\\/g, '/'),
      line: Number(range.start.line) + 1,
      column: Number(range.start.character) + 1,
      ...(range.end ? { endLine: Number(range.end.line) + 1, endColumn: Number(range.end.character) + 1 } : {}),
    };
  }

  private normalizeDiagnostic(uri: string, item: any): LspDiagnostic {
    const location = this.toLocation({ uri, range: item?.range || { start: { line: 0, character: 0 } } }) || { filePath: '', line: 1, column: 1 };
    return {
      ...location,
      message: String(item?.message || 'Language-server diagnostic'),
      severity: severity(item?.severity),
      ...(item?.source ? { source: String(item.source) } : {}),
      ...(item?.code !== undefined && (typeof item.code === 'string' || typeof item.code === 'number') ? { code: item.code } : {}),
    };
  }

  private normalizeLocations(result: any): LspLocation[] {
    const values = Array.isArray(result) ? result : result ? [result] : [];
    return values.map(value => this.toLocation(value)).filter((value): value is LspLocation => Boolean(value)).slice(0, 200);
  }

  private normalizeHover(result: any, uri: string): { contents: string; range?: LspLocation } {
    const raw = result?.contents;
    const parts = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
    const contents = parts.map((part: any) => typeof part === 'string' ? part : typeof part?.value === 'string' ? part.value : '').filter(Boolean).join('\n').slice(0, 8000);
    const range = result?.range && this.toLocation({ uri, range: result.range });
    return { contents, ...(range ? { range } : {}) };
  }

  private normalizeCompletion(result: any): Array<{ label: string; kind?: number; detail?: string; documentation?: string; insertText?: string }> {
    const items = Array.isArray(result) ? result : Array.isArray(result?.items) ? result.items : [];
    return items.map((item: any) => ({
      label: String(item?.label || '').slice(0, 300),
      ...(Number.isInteger(item?.kind) ? { kind: item.kind } : {}),
      ...(typeof item?.detail === 'string' ? { detail: item.detail.slice(0, 500) } : {}),
      ...(typeof item?.documentation === 'string' ? { documentation: item.documentation.slice(0, 1200) } : typeof item?.documentation?.value === 'string' ? { documentation: item.documentation.value.slice(0, 1200) } : {}),
      ...(typeof item?.insertText === 'string' ? { insertText: item.insertText.slice(0, 2000) } : {}),
    })).filter((item: { label: string }) => item.label).slice(0, 100);
  }

  private normalizeWorkspaceEdit(result: any): LspTextEdit[] {
    const edits: LspTextEdit[] = [];
    const add = (uri: unknown, changes: any) => {
      if (typeof uri !== 'string' || !Array.isArray(changes)) return;
      let absolute: string;
      try { absolute = fileURLToPath(uri); } catch { return; }
      const relative = path.relative(this.root, absolute);
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return;
      for (const edit of changes.slice(0, 200 - edits.length)) {
        const start = edit?.range?.start, end = edit?.range?.end;
        if (!start || !end || typeof edit?.newText !== 'string' || edit.newText.length > 20_000) continue;
        edits.push({ filePath: relative.replace(/\\/g, '/'), line: Number(start.line) + 1, column: Number(start.character) + 1, endLine: Number(end.line) + 1, endColumn: Number(end.character) + 1, newText: edit.newText });
      }
    };
    for (const [uri, changes] of Object.entries(result?.changes || {})) add(uri, changes);
    for (const item of Array.isArray(result?.documentChanges) ? result.documentChanges : []) add(item?.textDocument?.uri, item?.edits);
    return edits.slice(0, 200);
  }

  private normalizeSymbols(result: any, documentUri?: string): LspSymbol[] {
    const symbols: LspSymbol[] = [];
    const visit = (value: any, containerName?: string) => {
      if (!value || symbols.length >= 500) return;
      const location = value.location
        ? this.toLocation(value.location)
        : documentUri && value.range
          ? this.toLocation({ uri: documentUri, range: value.range })
          : undefined;
      const declaredContainer = typeof value.containerName === 'string' && value.containerName.trim() ? value.containerName : containerName;
      if (location && typeof value.name === 'string' && value.name.trim()) {
        symbols.push({ name: value.name.slice(0, 300), kind: Number.isInteger(value.kind) ? value.kind : 13, ...(declaredContainer ? { containerName: declaredContainer.slice(0, 300) } : {}), location });
      }
      const nextContainer = typeof value.name === 'string' && value.name.trim() ? value.name : containerName;
      if (Array.isArray(value.children)) value.children.forEach((child: any) => visit(child, nextContainer));
    };
    (Array.isArray(result) ? result : []).forEach(value => visit(value));
    return symbols;
  }

  public async definition(filePath: string, line: number, column: number): Promise<LspLocation[]> {
    const position = this.position(filePath, line, column);
    await this.open(position.file.relative);
    const result = await this.request('textDocument/definition', { textDocument: { uri: position.file.uri }, position: { line: position.line, character: position.column } });
    return this.normalizeLocations(result);
  }

  public async references(filePath: string, line: number, column: number): Promise<LspLocation[]> {
    const position = this.position(filePath, line, column);
    await this.open(position.file.relative);
    const result = await this.request('textDocument/references', { textDocument: { uri: position.file.uri }, position: { line: position.line, character: position.column }, context: { includeDeclaration: true } });
    return this.normalizeLocations(result);
  }

  public async diagnostics(filePath: string): Promise<LspDiagnostic[]> {
    const file = await this.open(filePath);
    if (this.capabilities?.diagnosticProvider) {
      try {
        const result = await this.request('textDocument/diagnostic', { textDocument: { uri: file.uri } });
        if (Array.isArray(result?.items)) return result.items.slice(0, 500).map((item: any) => this.normalizeDiagnostic(file.uri, item));
      } catch { /* Older servers publish diagnostics asynchronously. */ }
    }
    await new Promise(resolve => setTimeout(resolve, DIAGNOSTIC_WAIT_MS));
    return this.diagnosticsByUri.get(file.uri) || [];
  }

  public async hover(filePath: string, line: number, column: number): Promise<{ contents: string; range?: LspLocation }> {
    const position = this.position(filePath, line, column);
    await this.open(position.file.relative);
    const result = await this.request('textDocument/hover', { textDocument: { uri: position.file.uri }, position: { line: position.line, character: position.column } });
    return this.normalizeHover(result, position.file.uri);
  }

  public async completion(filePath: string, line: number, column: number): Promise<Array<{ label: string; kind?: number; detail?: string; documentation?: string; insertText?: string }>> {
    const position = this.position(filePath, line, column);
    await this.open(position.file.relative);
    return this.normalizeCompletion(await this.request('textDocument/completion', { textDocument: { uri: position.file.uri }, position: { line: position.line, character: position.column } }));
  }

  public async renamePreview(filePath: string, line: number, column: number, newName: string): Promise<LspTextEdit[]> {
    const position = this.position(filePath, line, column);
    if (typeof newName !== 'string' || !newName.trim() || newName.length > 128 || /[\u0000-\u001f\u007f]/.test(newName)) throw new Error('newName must be a non-empty text identifier of at most 128 characters.');
    await this.open(position.file.relative);
    return this.normalizeWorkspaceEdit(await this.request('textDocument/rename', { textDocument: { uri: position.file.uri }, position: { line: position.line, character: position.column }, newName }));
  }

  public async workspaceSymbols(query: string): Promise<LspSymbol[]> {
    if (typeof query !== 'string' || query.length > 500) throw new Error('Workspace symbol query must be text of at most 500 characters.');
    return this.normalizeSymbols(await this.request('workspace/symbol', { query }));
  }

  public async documentSymbols(filePath: string): Promise<LspSymbol[]> {
    const file = await this.open(filePath);
    return this.normalizeSymbols(await this.request('textDocument/documentSymbol', { textDocument: { uri: file.uri } }), file.uri);
  }

  public close(): void {
    if (this.closed) return;
    this.failAll(new Error('LSP connection closed.'));
    try { this.child.kill(); } catch { /* already exited */ }
  }
}
