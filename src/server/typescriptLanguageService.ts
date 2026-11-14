import fs from 'node:fs';
import path from 'node:path';
// TypeScript 7 exposes the classic language-service runtime through the
// Monaco worker bundle, while the root `typescript` package is the tsgo API.
// The bundle is intentionally used here because this server needs the
// in-process LanguageService host (definitions, references, diagnostics).
//
// That bundle is 8.86 MB. It is loaded LAZILY: the previous eager import
// made every server start pay the parse cost even though only three
// retrieval tools (find_definition, find_references, type_diagnostics) ever
// need it. The type-only import keeps the compiler happy without pulling
// the module into the startup path.
// @ts-expect-error Monaco's runtime bundle does not publish a Node declaration file.
import type * as TsNamespace from 'monaco-editor/languages/features/typescript/lib/typescriptServices.js';

type TypeScriptApi = typeof TsNamespace.typescript;

/** Cached so the 8.86 MB bundle is parsed at most once per process. */
let typescriptApi: TypeScriptApi | undefined;

/**
 * Load the Monaco TypeScript runtime on first use.
 *
 * Kept in a separate function so the heavy `import()` is not hoisted into
 * module evaluation time by the bundler.
 */
function loadTypeScript(): TypeScriptApi {
  if (!typescriptApi) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    typescriptApi = require('monaco-editor/languages/features/typescript/lib/typescriptServices.js').typescript;
  }
  return typescriptApi;
}
import { WorkspaceManager } from './workspace.js';

const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const SKIP_DIRS = new Set(['node_modules', '.git', '.quillix', 'dist', 'build', 'coverage', 'target', 'vendor', 'out']);
const MAX_FILES = 700;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_ENTRIES = 20_000;

export interface SemanticLocation {
  filePath: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  name?: string;
  kind?: string;
}

export interface SemanticDiagnostic {
  filePath: string;
  line: number;
  column: number;
  message: string;
  code: number;
  category: 'warning' | 'error' | 'suggestion' | 'message';
}

function category(value: TsNamespace.typescript.DiagnosticCategory): SemanticDiagnostic['category'] {
  const ts = loadTypeScript();
  return value === ts.DiagnosticCategory.Error ? 'error'
    : value === ts.DiagnosticCategory.Warning ? 'warning'
      : value === ts.DiagnosticCategory.Suggestion ? 'suggestion' : 'message';
}

/** Bounded TypeScript/JavaScript language-service adapter used by retrieval
 * tools. It is deliberately a project-local service: no package installation,
 * network access, or source outside the active workspace is consulted. */
export class TypeScriptLanguageService {
  private readonly workspace: WorkspaceManager;
  private fileNames: string[] = [];
  private versions = new Map<string, string>();
  private service?: TsNamespace.typescript.LanguageService;

  public constructor(workspace: WorkspaceManager) {
    this.workspace = workspace;
  }

  private scanFiles(): string[] {
    const root = this.workspace.getRoot();
    const found: string[] = [];
    const queue = ['.'];
    let entries = 0;
    for (let index = 0; index < queue.length && found.length < MAX_FILES && entries < MAX_ENTRIES; index++) {
      const relativeDir = queue[index];
      const absoluteDir = path.resolve(root, relativeDir);
      let names: fs.Dirent[];
      try { names = fs.readdirSync(absoluteDir, { withFileTypes: true }); } catch { continue; }
      for (const entry of names) {
        if (++entries > MAX_ENTRIES) break;
        if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
        const relative = relativeDir === '.' ? entry.name : path.join(relativeDir, entry.name);
        if (entry.isDirectory()) { queue.push(relative); continue; }
        if (!entry.isFile() || !CODE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
        try {
          const stat = fs.statSync(path.join(root, relative));
          if (stat.size <= MAX_FILE_BYTES) found.push(path.resolve(root, relative));
        } catch { /* removed/unreadable file is not language evidence */ }
      }
    }
    return found.sort();
  }

  private ensureService(): TsNamespace.typescript.LanguageService {
    const ts = loadTypeScript();
    const files = this.scanFiles();
    const same = files.length === this.fileNames.length && files.every((file, index) => file === this.fileNames[index]);
    if (this.service && same) return this.service;
    this.fileNames = files;
    this.versions = new Map(files.map(file => [file, '0']));
    const root = this.workspace.getRoot();
    const host: TsNamespace.typescript.LanguageServiceHost = {
      getCompilationSettings: () => ({
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        jsx: ts.JsxEmit.ReactJSX,
        allowJs: true,
        checkJs: false,
        noEmit: true,
        noLib: true,
        skipLibCheck: true,
        allowNonTsExtensions: true,
      }),
      getScriptFileNames: () => this.fileNames,
      getScriptVersion: (fileName: string) => {
        const current = this.versions.get(fileName) || '0';
        try {
          const stat = fs.statSync(fileName);
          const next = `${stat.mtimeMs}:${stat.size}`;
          this.versions.set(fileName, next);
          return next;
        } catch { return current; }
      },
      getScriptSnapshot: (fileName: string) => {
        try {
          if (!this.fileNames.includes(path.resolve(fileName))) return undefined;
          const content = fs.readFileSync(fileName, 'utf8');
          return ts.ScriptSnapshot.fromString(content);
        } catch { return undefined; }
      },
      getCurrentDirectory: () => root,
      getDefaultLibFileName: (_options: any) => 'lib.d.ts',
      fileExists: (fileName: string) => this.fileNames.includes(path.resolve(fileName)),
      readFile: (fileName: string) => {
        if (!this.fileNames.includes(path.resolve(fileName))) return undefined;
        try { return fs.readFileSync(fileName, 'utf8'); } catch { return undefined; }
      },
      readDirectory: (directory: string, extensions?: readonly string[]) => this.fileNames.filter(fileName => {
        if (path.dirname(fileName) !== path.resolve(directory)) return false;
        return !extensions || extensions.length === 0 || extensions.some(extension => fileName.endsWith(extension));
      }),
      getNewLine: () => '\n',
      useCaseSensitiveFileNames: () => process.platform !== 'win32',
      getCanonicalFileName: (fileName: string) => process.platform !== 'win32' ? fileName : fileName.toLowerCase(),
    };
    this.service?.dispose();
    this.service = ts.createLanguageService(host, ts.createDocumentRegistry());
    return this.service;
  }

  private relative(fileName: string): string | undefined {
    const root = this.workspace.getRoot();
    const absolute = path.resolve(fileName);
    const rel = path.relative(root, absolute);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return undefined;
    return rel.replace(/\\/g, '/');
  }

  private location(fileName: string, span: TsNamespace.typescript.TextSpan, name?: string, kind?: string): SemanticLocation | undefined {
    const ts = loadTypeScript();
    const filePath = this.relative(fileName);
    if (!filePath) return undefined;
    const source = this.ensureService().getProgram()?.getSourceFile(fileName);
    if (!source) return undefined;
    const start = ts.getLineAndCharacterOfPosition(source, Math.min(span.start, source.text.length));
    const end = ts.getLineAndCharacterOfPosition(source, Math.min(span.start + span.length, source.text.length));
    return { filePath, line: start.line + 1, column: start.character + 1, endLine: end.line + 1, endColumn: end.character + 1, ...(name ? { name } : {}), ...(kind ? { kind } : {}) };
  }

  private navigate(identifier: string): TsNamespace.typescript.NavigateToItem[] {
    const ts = loadTypeScript();
    const service = this.ensureService();
    const items = service.getNavigateToItems(identifier.trim(), 100) || [];
    const exact = items.filter((item: any) => item.name === identifier.trim());
    return exact.length ? exact : items;
  }

  public findDefinitions(identifier: string): SemanticLocation[] {
    if (!/^[A-Za-z_$][\w$]*$/.test(identifier.trim())) return [];
    return this.navigate(identifier).map((item: any) => this.location(item.fileName, item.textSpan, item.name, item.kind)).filter((value): value is SemanticLocation => !!value);
  }

  public findReferences(identifier: string): SemanticLocation[] {
    if (!/^[A-Za-z_$][\w$]*$/.test(identifier.trim())) return [];
    const service = this.ensureService();
    const results: SemanticLocation[] = [];
    const seen = new Set<string>();
    for (const item of this.navigate(identifier).slice(0, 20)) {
      const locations = service.getReferencesAtPosition(item.fileName, item.textSpan.start) || [];
      for (const reference of locations) {
        const location = this.location(reference.fileName, reference.textSpan, identifier);
        if (!location) continue;
        const key = `${location.filePath}:${location.line}:${location.column}`;
        if (!seen.has(key)) { seen.add(key); results.push(location); }
        if (results.length >= 1000) return results;
      }
    }
    return results;
  }

  public diagnostics(filePath?: string): SemanticDiagnostic[] {
    const ts = loadTypeScript();
    const service = this.ensureService();
    const files = filePath ? [path.resolve(this.workspace.getRoot(), filePath)] : this.fileNames.slice(0, 100);
    const result: SemanticDiagnostic[] = [];
    for (const file of files) {
      const relative = this.relative(file);
      if (!relative || !this.fileNames.includes(file)) continue;
      const diagnostics = [
        ...service.getSyntacticDiagnostics(file),
        ...service.getSemanticDiagnostics(file),
      ];
      for (const diagnostic of diagnostics.slice(0, 100)) {
        const start = diagnostic.start ?? 0;
        const source = service.getProgram()?.getSourceFile(file);
        if (!source) continue;
        const position = ts.getLineAndCharacterOfPosition(source, Math.min(start, source.text.length));
        result.push({ filePath: relative, line: position.line + 1, column: position.character + 1, message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'), code: diagnostic.code, category: category(diagnostic.category) });
        if (result.length >= 500) return result;
      }
    }
    return result;
  }
}
