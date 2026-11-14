import {ExtensionTools} from './extensionTools.js';
import { OfflineCodingPlugins } from './offlineCodingPlugins.js';
import { parse as parseEditSyntax } from '@babel/parser';
import fs from 'fs';
import path from 'path';
import { ToolDefinition, ToolResult } from '../shared/types.js';
import { WorkspaceManager } from './workspace.js';
import { TerminalService } from './terminal.js';
import { searchBudgetMessage } from '../shared/webSearchPolicy.js';
import { GitService } from './git.js';
import { CodebaseIndexer } from './indexer.js';
import { PatchEngine } from './patchEngine.js';
import { SettingsStore } from './settings.js';
import { WorkspaceVerifier } from './verifier.js';
import { LanguageRunnerRegistry } from './languageRunners.js';
import * as diffLib from 'diff';
import { normalizeToolName, normalizeToolArgs } from './toolAliases.js';
import { debugLog } from './debugLog.js';
import { TypeScriptLanguageService } from './typescriptLanguageService.js';
import type { TavilyVerificationService } from './tavilyVerification.js';
import { redactSensitiveText, redactSensitiveTextForRoundTrip, restoreSensitiveValues, type SensitiveValueMap } from '../shared/secretRedaction.js';
import { readPackageManifest } from './packageManifest.js';

export interface ToolExecutionContext {
  /** Ask the user for explicit approval (agent runs stream this to the UI). */
  requestApproval?: (request: {
    kind: 'terminal' | 'git' | 'file';
    title: string;
    command?: string;
    reason?: string;
  }) => Promise<boolean>;
  /** True when the caller has already been approved by the user (manual runs). */
  preApproved?: boolean;
  /**
   * Project folder (relative to workspace root, no leading slash) that a
   * run is scoped to, e.g. "Calculator". When set, RELATIVE file paths in
   * tool arguments are automatically routed into this folder — so a model
   * writing "index.html" during a calculator project build actually creates
   * Calculator/index.html. Paths already inside the folder, absolute paths,
   * and paths that escape the folder explicitly are left untouched.
   */
  projectPrefix?: string;
  /** Canonical layout rules for the active project, when known. */
  projectLayout?: 'plain-web' | 'framework-web' | 'generic';
  /** Per-run UI setting; takes precedence over stale persisted settings. */
  autoApplyDiffs?: boolean;
  /** Opaque per-run secret handles used only to round-trip sanitized file reads. */
  secretRedactions?: Map<string, SensitiveValueMap>;
}

/** Argument keys that hold file-system paths. */
const PATH_ARG_KEYS = ['filePath', 'dirPath', 'sourcePath', 'destinationPath', 'oldPath', 'newPath'];

/** Hard bounds for resumable chunk assembly and its workspace checkpoint. */
export const CHUNK_TRANSFER_LIMITS = Object.freeze({
  maxChunkBytes: 256 * 1024,
  maxFileBytes: 8 * 1024 * 1024,
  maxChunks: 512,
  maxTransfers: 4,
  maxBufferedBytes: 24 * 1024 * 1024,
  maxCheckpointBytes: 32 * 1024 * 1024,
  maxTransferIdLength: 128,
});

/** Required string arguments per tool — validated before execution so a
 *  malformed call gets a precise, actionable error instead of a crash. */
const REQUIRED_ARGS: Record<string, string[]> = {
  read_file: ['filePath'],
  write_file: ['filePath', 'content'],
  create_file: ['filePath'],
  append_file: ['filePath', 'content'],
  write_file_chunk: ['filePath', 'content', 'transferId'],
  edit_file: ['filePath', 'oldString'],
  get_file_metadata: ['filePath'],
  compare_files: ['filePathA', 'filePathB'],
  verify_file: ['filePath'],
  delete_file: ['filePath'],
  rename_file: ['oldPath', 'newPath'],
  copy_file: ['sourcePath', 'destinationPath'],
  move_file: ['sourcePath', 'destinationPath'],
  create_directory: ['dirPath'],
  list_directory: [],
  apply_patch: ['filePath'],
};

function validateRequiredArgs(name: string, args: Record<string, any>): string | null {
  const required = REQUIRED_ARGS[name];
  if (!required || required.length === 0) return null;
  for (const key of required) {
    const v = args[key];
    if (typeof v !== 'string' || v.trim() === '') {
      return `Invalid tool arguments: '${name}' requires a non-empty string argument '${key}'.`;
    }
  }
  return null;
}

/**
 * Small local models sometimes put the actual source inside one extra
 * `{ "content": "..." }` envelope or markdown fence even though the tool
 * arguments themselves are valid JSON. Recover only for source-like files;
 * JSON/config documents must remain byte-for-byte what the model requested.
 */
function normalizeModelFileContent(name: string, args: Record<string, any> | null | undefined): boolean {
  const field = name === 'edit_file' ? 'newString' : ['write_file', 'create_file', 'append_file'].includes(name) ? 'content' : '';
  if (!field || !args || typeof args !== 'object' || Array.isArray(args) || typeof args[field] !== 'string' || typeof args.filePath !== 'string') return false;
  const extension = path.extname(args.filePath).toLowerCase();
  if (!/^(?:\.[cm]?js|\.jsx|\.ts|\.tsx|\.py|\.go|\.rs|\.java|\.cs|\.cpp|\.c|\.h|\.php|\.rb|\.swift|\.kt|\.kts|\.css|\.scss|\.less|\.html?|\.vue|\.svelte|\.sh|\.ps1|\.sql)$/.test(extension)) return false;

  let value = args[field] as string;
  let changed = false;
  const fenced = /^\s*```[^\r\n]*\r?\n([\s\S]*?)\r?\n\s*```\s*$/.exec(value);
  if (fenced) {
    value = fenced[1];
    changed = true;
  }
  if (!changed && /^\s*\{/.test(value)) {
    try {
      const parsed = JSON.parse(value.trim());
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Object.keys(parsed).length === 1 && typeof parsed.content === 'string') {
        value = parsed.content;
        changed = true;
      }
    } catch { /* The source itself is ordinary code beginning with `{`. */ }
  }
  if (changed) args[field] = value;
  return changed;
}

/**
 * Applies the run's project prefix to relative path arguments so every file
 * operation lands inside the active project folder even when the model
 * writes bare paths like "index.html".
 */
function applyProjectPrefixToArgs(
  args: Record<string, any>,
  projectPrefix: string | undefined,
  projectLayout: ToolExecutionContext['projectLayout']
): void {
  if (!projectPrefix) return;
  const prefix = projectPrefix.replace(/\/$/, '');
  for (const key of PATH_ARG_KEYS) {
    const raw = args[key];
    if (typeof raw !== 'string' || raw.trim() === '') continue;
    let p = raw.replace(/^[.][/\\]/, '').replace(/\\/g, '/');
    if (p.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(p)) continue; // absolute — safe resolver handles it
    // Plain websites have a stable root contract. If a small model invents a
    // framework-style path for one of the three core files, normalize it to
    // the root before the workspace safety resolver sees it. Asset folders and
    // explicitly named non-core files remain untouched.
    if (projectLayout === 'plain-web' && /^(?:index\.html?|style\.css|script\.js)$/i.test(path.posix.basename(p))) {
      p = path.posix.basename(p);
    }
    if (p === prefix || p.startsWith(`${prefix}/`)) continue; // already inside the project folder
    args[key] = `${prefix}/${p}`;
  }
  // Terminal working directory: also route into the project folder.
  if (typeof args.cwd === 'string' && args.cwd.trim() !== '' && !args.cwd.startsWith('/') && !/^[a-zA-Z]:[\\/]/.test(args.cwd)) {
    const cwd = args.cwd.replace(/^[.][/\\]/, '').replace(/\\/g, '/');
    args.cwd = cwd.startsWith(`${prefix}/`) || cwd === prefix ? cwd : `${prefix}/${cwd}`;
  }
}

export class ToolRegistry {
  public readonly codingPlugins: OfflineCodingPlugins;
  public readonly extensions = new ExtensionTools();
  private workspace: WorkspaceManager;
  private terminal: TerminalService;
  private git: GitService;
  private indexer: CodebaseIndexer;
  private semantic: TypeScriptLanguageService;
  private settings: SettingsStore;
  private tavilyVerification?: TavilyVerificationService;
  /** In-memory, ordered chunk assemblies; each agent run gets a unique id. */
  private readonly chunkTransfers = new Map<string, { filePath: string; totalChunks: number; nextIndex: number; content: string; originalContent: string; originalExists: boolean }>();

  private chunkCheckpointPath(): string { return path.join(this.workspace.getRoot(), '.quillix', 'chunk-transfers.json'); }

  private loadChunkTransfers(): void {
    if (this.chunkTransfers.size) return;
    try {
      const checkpointPath = this.chunkCheckpointPath();
      if (fs.statSync(checkpointPath).size > CHUNK_TRANSFER_LIMITS.maxCheckpointBytes) return;
      const parsed = JSON.parse(fs.readFileSync(checkpointPath, 'utf8')) as Record<string, { filePath: string; totalChunks: number; nextIndex: number; content: string; originalContent?: string; originalExists?: boolean }>;
      let bufferedBytes = 0;
      for (const [id, value] of Object.entries(parsed || {})) {
        if (this.chunkTransfers.size >= CHUNK_TRANSFER_LIMITS.maxTransfers) break;
        const originalContent = typeof value?.originalContent === 'string' ? value.originalContent : '';
        const contentBytes = typeof value?.content === 'string' ? Buffer.byteLength(value.content, 'utf8') : Number.POSITIVE_INFINITY;
        const originalBytes = Buffer.byteLength(originalContent, 'utf8');
        if (!/^[\w.:-]{1,128}$/.test(id) || typeof value?.filePath !== 'string' || value.filePath.length > 1024 ||
            !Number.isInteger(value.nextIndex) || value.nextIndex < 1 || !Number.isInteger(value.totalChunks) ||
            value.totalChunks < 1 || value.totalChunks > CHUNK_TRANSFER_LIMITS.maxChunks || value.nextIndex >= value.totalChunks ||
            contentBytes > CHUNK_TRANSFER_LIMITS.maxFileBytes || originalBytes > CHUNK_TRANSFER_LIMITS.maxFileBytes ||
            bufferedBytes + contentBytes + originalBytes > CHUNK_TRANSFER_LIMITS.maxBufferedBytes) continue;
        this.chunkTransfers.set(id, { ...value, originalContent, originalExists: value.originalExists === true });
        bufferedBytes += contentBytes + originalBytes;
      }
    } catch { /* no active transfer checkpoint */ }
  }

  private persistChunkTransfers(): boolean {
    try {
      const checkpoint = this.chunkCheckpointPath();
      fs.mkdirSync(path.dirname(checkpoint), { recursive: true });
      const serialized = JSON.stringify(Object.fromEntries(this.chunkTransfers));
      if (Buffer.byteLength(serialized, 'utf8') > CHUNK_TRANSFER_LIMITS.maxCheckpointBytes) return false;
      const temp = `${checkpoint}.tmp`;
      fs.writeFileSync(temp, serialized, { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(temp, checkpoint);
      return true;
    } catch (error: any) {
      debugLog('CHUNK_CHECKPOINT_FAILED', 'recovery checkpoint could not be persisted', {
        code: typeof error?.code === 'string' ? error.code : undefined,
        error: String(error?.message || error).slice(0, 240),
      });
      return false;
    }
  }

  constructor(
    workspace: WorkspaceManager,
    terminal: TerminalService,
    git: GitService,
    indexer: CodebaseIndexer,
    settings: SettingsStore,
    tavilyVerification?: TavilyVerificationService
  ) {
    this.workspace = workspace;
    this.terminal = terminal;
    this.git = git;
    this.indexer = indexer;
    this.semantic = new TypeScriptLanguageService(workspace);
    this.settings = settings;
    this.tavilyVerification = tavilyVerification;
    this.codingPlugins = new OfflineCodingPlugins(workspace, settings);
  }

  /** Absolute path of the active workspace root. */
  public getWorkspaceRoot(): string {
    return this.workspace.getRoot();
  }

  private secretRedactionKey(filePath: string): string {
    const absolute = path.resolve(this.workspace.getRoot(), filePath);
    return process.platform === 'win32' ? absolute.toLowerCase() : absolute;
  }

  private secretRedactionsFor(filePath: string, context: ToolExecutionContext): SensitiveValueMap | undefined {
    return context.secretRedactions?.get(this.secretRedactionKey(filePath));
  }

  private restoreToolSource(filePath: string, content: string, context: ToolExecutionContext, requireAll = false): { content: string; error?: string } {
    const saved = this.secretRedactionsFor(filePath, context);
    if (saved?.size) {
      const restored = restoreSensitiveValues(content, saved);
      if (requireAll && restored.missing.length) {
        return { content, error: `Safe write blocked for ${filePath}: preserve every opaque secret handle returned by read_file, or use a focused edit_file patch. The existing file was left unchanged.` };
      }
      return { content: restored.content };
    }
    const current = this.workspace.readFile(filePath);
    if (requireAll && current.success && current.content !== undefined && redactSensitiveText(current.content) !== current.content) {
      return { content, error: `Safe whole-file replacement blocked for ${filePath}: it contains inline credentials that were not read through this agent task. Use read_file and preserve its opaque handles, or make a focused edit_file change. The existing file was left unchanged.` };
    }
    return { content };
  }

  /** Rebind stateful local plugins after the active workspace changes. */
  public async setWorkspaceRoot(root: string): Promise<void> {
    // LSP processes are initialized with the previous rootUri/cwd. Dispose
    // them before rebinding so navigation tools can never read a stale
    // workspace after the user switches projects.
    this.extensions.closeLSP();
    this.chunkTransfers.clear();
    await this.codingPlugins.setWorkspaceRoot(root);
  }

  public getToolDefinitions(): ToolDefinition[] {
    const tools: ToolDefinition[] = [
      ...this.extensions.definitions(),
      ...this.codingPlugins.definitions(),
      // File tools
      {
        name: 'read_file',
        category: 'file',
        description: 'Read the text content of a file within the workspace. Inline credentials are returned as opaque __QUILLIX_SECRET_*__ handles; preserve those handles unchanged in whole-file writes. Prefer focused edit_file patches so unrelated credentials remain untouched.',
        permission: 'read',
        parameters: {
          type: 'object',
          properties: {
            filePath: { type: 'string', description: 'Relative path to the file' },
          },
          required: ['filePath'],
        },
      },
      {
        name: 'write_file',
        category: 'file',
        description: 'Write/overwrite content to a file within the workspace. Missing parent folders (e.g. src/game/) are created automatically. Use this to create or update any file, including new project files.',
        permission: 'write',
        parameters: {
          type: 'object',
          properties: {
            filePath: { type: 'string', description: 'Relative path to the file' },
            content: { type: 'string', description: 'Complete content to write' },
          },
          required: ['filePath', 'content'],
        },
      },
      {
        name: 'create_file',
        category: 'file',
        description: 'Create a new file within the workspace. Missing parent folders are created automatically. Fails if the file already exists (use write_file to update an existing file).',
        permission: 'write',
        parameters: {
          type: 'object',
          properties: {
            filePath: { type: 'string', description: 'Relative path for the new file' },
            content: { type: 'string', description: 'Initial file content' },
          },
          required: ['filePath'],
        },
      },
      {
        name: 'append_file',
        category: 'file',
        description: 'Append content to the END of an existing file in the workspace. The file must already exist (use write_file/create_file to create it first).',
        permission: 'write',
        parameters: {
          type: 'object',
          properties: {
            filePath: { type: 'string', description: 'Relative path to the existing file' },
            content: { type: 'string', description: 'Content to append at the end of the file' },
          },
          required: ['filePath', 'content'],
        },
      },
      {
        name: 'write_file_chunk',
        category: 'file',
        description: 'Assemble a large file in ordered chunks (max 256 KiB per chunk, 8 MiB per file, 512 chunks, four active transfers). Use chunkIndex 0 to start, then call again with the same transferId and next chunkIndex only after success. With Auto Apply ON each chunk is written and verified on disk; with Auto Apply OFF chunks are checkpointed without touching the file, and the final chunk returns one reviewable staged patch. Rejects out-of-order or duplicate chunks.',
        permission: 'write',
        parameters: {
          type: 'object',
          properties: {
            filePath: { type: 'string', description: 'Relative path to the file being assembled' },
            content: { type: 'string', description: 'Only this chunk of the file content' },
            transferId: { type: 'string', description: 'Stable id shared by every chunk of this file' },
            chunkIndex: { type: 'number', description: 'Zero-based chunk number; start at 0 and increment by one' },
            totalChunks: { type: 'number', description: 'Total number of chunks in this transfer' },
            final: { type: 'boolean', description: 'True only on the final chunk' },
          },
          required: ['filePath', 'content', 'transferId', 'chunkIndex', 'totalChunks', 'final'],
        },
      },
      {
        name: 'edit_file',
        category: 'file',
        description: 'Safely replace a unique exact oldString with newString in an existing file. Ambiguous matches require more context or explicit replaceAll. Rejects syntax-breaking JS/TS/JSON edits to valid source.',
        permission: 'write',
        parameters: {
          type: 'object',
          properties: {
            filePath: { type: 'string', description: 'Relative path to the file' },
            oldString: { type: 'string', description: 'Exact text to find and replace' },
            newString: { type: 'string', description: 'Replacement text (empty string deletes the match)' },
            replaceAll: { type: 'boolean', description: 'Explicitly replace all occurrences; default false requires exactly one match' },
          },
          required: ['filePath', 'oldString', 'newString'],
        },
      },
      {
        name: 'delete_file',
        category: 'file',
        description: 'Delete a file or empty directory in the workspace with safety checks.',
        permission: 'destructive',
        parameters: {
          type: 'object',
          properties: {
            filePath: { type: 'string', description: 'Relative path to delete' },
          },
          required: ['filePath'],
        },
      },
      {
        name: 'rename_file',
        category: 'file',
        description: 'Rename or move a file in the workspace.',
        permission: 'write',
        parameters: {
          type: 'object',
          properties: {
            oldPath: { type: 'string', description: 'Current relative path' },
            newPath: { type: 'string', description: 'New relative path' },
          },
          required: ['oldPath', 'newPath'],
        },
      },
      {
        name: 'copy_file',
        category: 'file',
        description: 'Copy a file to another path in the workspace.',
        permission: 'write',
        parameters: {
          type: 'object',
          properties: {
            sourcePath: { type: 'string', description: 'Source relative path' },
            destinationPath: { type: 'string', description: 'Destination relative path' },
          },
          required: ['sourcePath', 'destinationPath'],
        },
      },
      {
        name: 'list_directory',
        category: 'file',
        description: 'List contents of a directory in the workspace.',
        permission: 'read',
        parameters: {
          type: 'object',
          properties: {
            dirPath: { type: 'string', description: 'Relative path of directory, or . for root' },
          },
        },
      },
      {
        name: 'get_file_metadata',
        category: 'file',
        description: 'Get REAL filesystem metadata for a file or directory: absolute path, size in bytes, created/modified/accessed timestamps, and type.',
        permission: 'read',
        parameters: {
          type: 'object',
          properties: {
            filePath: { type: 'string', description: 'Relative path to inspect' },
          },
          required: ['filePath'],
        },
      },
      {
        name: 'get_project_structure',
        category: 'file',
        description: 'Show the real recursive project structure as a tree (build artifacts like node_modules/.git/dist are pruned). Use it to inspect a project before modifying it.',
        permission: 'read',
        parameters: {
          type: 'object',
          properties: {
            dirPath: { type: 'string', description: 'Relative path of the project directory, or . for the workspace root' },
            maxDepth: { type: 'number', description: 'Maximum recursion depth (default 6)' },
          },
        },
      },
      {
        name: 'compare_files',
        category: 'file',
        description: 'Compare two files in the workspace and return a real unified diff plus line counts. Use it to check what changed between two versions of a file.',
        permission: 'read',
        parameters: {
          type: 'object',
          properties: {
            filePathA: { type: 'string', description: 'First file (original side of the diff)' },
            filePathB: { type: 'string', description: 'Second file (modified side of the diff)' },
          },
          required: ['filePathA', 'filePathB'],
        },
      },
      {
        name: 'verify_file',
        category: 'file',
        description: 'Verify a file on disk: exists, is non-empty for code files, is not placeholder content, and passes a language-appropriate syntax check (node --check / py_compile / JSON parse / HTML balance). Optionally also checks that expectedContent appears in the file.',
        permission: 'read',
        parameters: {
          type: 'object',
          properties: {
            filePath: { type: 'string', description: 'Relative path of the file to verify' },
            expectedContent: { type: 'string', description: 'Optional text that must be present in the file' },
          },
          required: ['filePath'],
        },
      },
      {
        name: 'create_directory',
        category: 'file',
        description: 'Create a directory (and any missing parent directories) inside the workspace. Use it before or while scaffolding a multi-file project structure. Idempotent: succeeds if the directory already exists.',
        permission: 'write',
        parameters: {
          type: 'object',
          properties: {
            dirPath: { type: 'string', description: 'Relative path of the directory to create (e.g. src/game)' },
          },
          required: ['dirPath'],
        },
      },
      {
        name: 'move_file',
        category: 'file',
        description: 'Move or rename a file or folder to a new path in the workspace. Parent directories of the destination are created automatically.',
        permission: 'write',
        parameters: {
          type: 'object',
          properties: {
            oldPath: { type: 'string', description: 'Current relative path' },
            newPath: { type: 'string', description: 'New relative path' },
          },
          required: ['oldPath', 'newPath'],
        },
      },
      {
        name: 'search_files',
        category: 'file',
        description: 'Search for text or regex across workspace files.',
        permission: 'read',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search term or regex' },
            caseSensitive: { type: 'boolean', description: 'Match case' },
            wholeWord: { type: 'boolean', description: 'Match whole words only' },
          },
          required: ['query'],
        },
      },
      {
        name: 'find_symbol',
        category: 'file',
        description: 'Locate symbol definitions across code files.',
        permission: 'read',
        parameters: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'Name of the function, class, or symbol' },
          },
          required: ['symbol'],
        },
      },
      {
        name: 'find_references',
        category: 'file',
        description: 'Locate call/use sites of a symbol across the workspace, excluding its declaration when it can be identified.',
        permission: 'read',
        parameters: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'Symbol to find references for' },
          },
          required: ['symbol'],
        },
      },

      // Code tools
      {
        name: 'analyze_file',
        category: 'code',
        description: 'Analyze an individual file structure, line count, language, and exports.',
        permission: 'read',
        parameters: {
          type: 'object',
          properties: {
            filePath: { type: 'string', description: 'Relative path to file' },
          },
          required: ['filePath'],
        },
      },
      {
        name: 'analyze_project',
        category: 'code',
        description: 'Full codebase architectural scan detecting frameworks, scripts, and dependencies.',
        permission: 'read',
        parameters: { type: 'object', properties: {} },
      },
      {
        name: 'find_definition',
        category: 'code',
        description: 'Locate declaration/definition lines for a function, class, interface, type, variable, or module — not arbitrary text occurrences.',
        permission: 'read',
        parameters: {
          type: 'object',
          properties: {
            identifier: { type: 'string', description: 'Identifier to look up' },
          },
          required: ['identifier'],
        },
      },
      {
        name: 'find_usages',
        category: 'code',
        description: 'Find all usages of an identifier across workspace files.',
        permission: 'read',
        parameters: {
          type: 'object',
          properties: {
            identifier: { type: 'string', description: 'Identifier to find' },
          },
          required: ['identifier'],
        },
      },
      {
        name: 'language_diagnostics',
        category: 'code',
        description: 'Run bounded TypeScript/JavaScript language-service diagnostics across the project or one file. Uses local source only; does not install packages or contact a server.',
        permission: 'read',
        parameters: {
          type: 'object',
          properties: {
            filePath: { type: 'string', description: 'Optional TypeScript/JavaScript file to diagnose' },
          },
        },
      },
      {
        name: 'search_code',
        category: 'code',
        description: 'Fast codebase search for code snippets or patterns.',
        permission: 'read',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Code pattern to search' },
          },
          required: ['query'],
        },
      },
      {
        name: 'detect_language',
        category: 'code',
        description: 'Detect programming language based on file extension and content.',
        permission: 'read',
        parameters: {
          type: 'object',
          properties: {
            filePath: { type: 'string', description: 'Path to examine' },
          },
          required: ['filePath'],
        },
      },
      {
        name: 'detect_framework',
        category: 'code',
        description: 'Identify primary web or application framework used in this project.',
        permission: 'read',
        parameters: { type: 'object', properties: {} },
      },
      {
        name: 'detect_package_manager',
        category: 'code',
        description: 'Identify active package manager (npm, pnpm, yarn, bun, pip, cargo, etc.).',
        permission: 'read',
        parameters: { type: 'object', properties: {} },
      },
      {
        name: 'detect_project_type',
        category: 'code',
        description: 'Identify project type (Full-Stack, React SPA, Electron Desktop, Node API, etc.).',
        permission: 'read',
        parameters: { type: 'object', properties: {} },
      },

      // Patch tools
      {
        name: 'create_patch',
        category: 'patch',
        description: 'Generate unified diff between original file content and proposed changes.',
        permission: 'read',
        parameters: {
          type: 'object',
          properties: {
            filePath: { type: 'string', description: 'Target file path' },
            newContent: { type: 'string', description: 'Proposed new file content' },
          },
          required: ['filePath', 'newContent'],
        },
      },
      {
        name: 'apply_patch',
        category: 'patch',
        description: 'Apply unified diff or new content safely to a workspace file.',
        permission: 'write',
        parameters: {
          type: 'object',
          properties: {
            filePath: { type: 'string', description: 'Target file path' },
            newContent: { type: 'string', description: 'New file content' },
          },
          required: ['filePath', 'newContent'],
        },
      },
      {
        name: 'preview_patch',
        category: 'patch',
        description: 'Preview lines added and removed without applying.',
        permission: 'read',
        parameters: {
          type: 'object',
          properties: {
            filePath: { type: 'string', description: 'File path' },
            newContent: { type: 'string', description: 'New content to preview diff for' },
          },
          required: ['filePath', 'newContent'],
        },
      },
      {
        name: 'get_diff',
        category: 'patch',
        description: 'Get unified diff for git working directory or specific file.',
        permission: 'read',
        parameters: {
          type: 'object',
          properties: {
            staged: { type: 'boolean', description: 'Check staged diff instead of working tree' },
          },
        },
      },

      // Terminal tools
      {
        name: 'run_command',
        category: 'terminal',
        description: 'Run a shell command in the project root with output capture and safety check.',
        permission: 'execute',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'Command line to run' },
            cwd: { type: 'string', description: 'Optional relative directory' },
            timeoutMs: { type: 'integer', description: 'Optional execution timeout in milliseconds (1000–120000). Use this instead of shell-specific timeout/background wrappers.' },
          },
          required: ['command'],
        },
      },

      // Build & Test tools
      {
        name: 'install_dependencies',
        category: 'build',
        description: 'Run package manager install command.',
        permission: 'execute',
        parameters: { type: 'object', properties: {} },
      },
      {
        name: 'run_build',
        category: 'build',
        description: 'Run build command (e.g. npm run build).',
        permission: 'execute',
        parameters: { type: 'object', properties: {} },
      },
      {
        name: 'run_tests',
        category: 'build',
        description: 'Run project automated tests (npm test, vitest, jest, etc.).',
        permission: 'execute',
        parameters: {
          type: 'object',
          properties: {
            testPath: { type: 'string', description: 'Optional specific test pattern' },
          },
        },
      },
      {
        name: 'run_linter',
        category: 'build',
        description: 'Run typecheck or linter (e.g. tsc --noEmit or npm run lint).',
        permission: 'execute',
        parameters: { type: 'object', properties: {} },
      },

      // Git tools
      {
        name: 'git_status',
        category: 'git',
        description: 'Get current git repository status (branch, modified, staged files).',
        permission: 'git',
        parameters: { type: 'object', properties: {} },
      },
      {
        name: 'git_log',
        category: 'git',
        description: 'Get recent git commit log.',
        permission: 'git',
        parameters: {
          type: 'object',
          properties: {
            limit: { type: 'number', description: 'Max commits to fetch' },
          },
        },
      },
      {
        name: 'git_branch',
        category: 'git',
        description: 'Get current git branch name.',
        permission: 'git',
        parameters: { type: 'object', properties: {} },
      },
      {
        name: 'git_add',
        category: 'git',
        description: 'Stage modified files for commit.',
        permission: 'git',
        parameters: {
          type: 'object',
          properties: {
            filePath: { type: 'string', description: 'File to stage, or . for all' },
          },
        },
      },
      {
        name: 'git_commit',
        category: 'git',
        description: 'Commit staged changes with a commit message (Requires Authorization).',
        permission: 'git',
        parameters: {
          type: 'object',
          properties: {
            message: { type: 'string', description: 'Commit message' },
          },
          required: ['message'],
        },
      },
      {
        name: 'git_restore',
        category: 'git',
        description: 'Discard unstaged modifications for a file.',
        permission: 'git',
        parameters: {
          type: 'object',
          properties: {
            filePath: { type: 'string', description: 'File to restore' },
          },
          required: ['filePath'],
        },
      },

      // Project tools
      {
        name: 'detect_project',
        category: 'project',
        description: 'Complete project health and architectural detection.',
        permission: 'read',
        parameters: { type: 'object', properties: {} },
      },
      {
        name: 'project_health_check',
        category: 'project',
        description: 'Run a language-aware project health gate: validate configuration, typecheck/lint when available, then run the configured build and test commands without installing dependencies.',
        permission: 'execute',
        parameters: { type: 'object', properties: {} },
      },
    ];
    if (this.tavilyVerification) tools.push({
      name: 'verify_current_information',
      category: 'project',
      description: 'Use Tavily to verify a version-sensitive API, library, documentation or coding claim against current trustworthy web sources. This is read-only; it never edits files. Use it before relying on potentially outdated information.',
      permission: 'network',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Precise current-information question or API/library claim to verify' },
          answer: { type: 'string', description: 'Answer or code claim to compare against retrieved evidence' },
          urls: { type: 'array', description: 'Optional URLs to extract directly', items: { type: 'string' } },
        },
        required: ['query'],
      },
    });
    if (this.tavilyVerification) tools.push({
      name: 'web_search',
      category: 'project',
      description: 'Search the public web with Tavily for current documentation, API references, error messages or library usage. Returns bounded results with title, URL and snippet plus compact citations. Read-only; it never edits files or runs commands.',
      permission: 'network',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'What to search for. Keep it specific; never include secrets, keys or local file paths.' },
          maxResults: { type: 'number', description: 'Optional result count (1-5, default 5)' },
        },
        required: ['query'],
      },
    });
    if (this.tavilyVerification) tools.push({
      name: 'web_fetch',
      category: 'project',
      description: 'Fetch a documentation or reference URL with Tavily and return its bounded text content so it can be used as coding context. Read-only; never executes page scripts.',
      permission: 'network',
      parameters: {
        type: 'object',
        properties: {
          urls: { type: 'array', description: 'One to three http(s) URLs to read', items: { type: 'string' } },
        },
        required: ['urls'],
      },
    });
    return tools;
  }

  /**
   * Executes a tool by name with arguments.
   * Security: tool names are validated against the registry, all file paths go
   * through the workspace safe-path resolver, terminal cwd must stay inside the
   * workspace, and dangerous terminal/git operations require user approval.
   */
  public async executeTool(
    toolCallId: string,
    name: string,
    args: Record<string, any>,
    context: ToolExecutionContext = {}
  ): Promise<ToolResult> {
    if (name === 'verify_current_information' && this.tavilyVerification) {
      const start = Date.now();
      try {
        if (this.settings.get().offlineMode) throw new Error('Offline Mode blocks Tavily network verification. No freshness claim was made.');
        if (!args || typeof args !== 'object' || Array.isArray(args) || typeof args.query !== 'string' || !args.query.trim()) throw new Error('verify_current_information requires a non-empty query.');
        const result = await this.tavilyVerification.verify({ query: args.query, answer: typeof args.answer === 'string' ? args.answer : '', urls: Array.isArray(args.urls) ? args.urls.filter((url: unknown): url is string => typeof url === 'string') : [], offline: false });
        return { toolCallId, toolName: name, success: true, output: JSON.stringify({ finding: result.finding, explanation: result.explanation, suggestedAction: result.suggestedAction, sources: result.sources.map(source => ({ title: source.title, url: source.url, official: source.official })), cached: result.cached, usage: result.usage }), data: result, durationMs: Date.now() - start };
      } catch (error: any) { return { toolCallId, toolName: name, success: false, output: '', error: error?.message || 'Tavily verification failed.', durationMs: Date.now() - start }; }
    }
    if ((name === 'web_search' || name === 'web_fetch') && this.tavilyVerification) {
      const start = Date.now();
      try {
        if (this.settings.get().offlineMode) throw new Error('Offline Mode blocks Tavily network access. Enable Online Mode (and Tavily network consent in Settings) to search or fetch pages.');
        if (this.settings.get().tavilyNetworkConsent !== true) throw new Error('Tavily network use is off. Turn on "Allow web search and page fetch" in Settings → Tavily to let the agent use the internet.');
        if (name === 'web_search') {
          if (!args || typeof args !== 'object' || Array.isArray(args) || typeof args.query !== 'string' || !args.query.trim()) throw new Error('web_search requires a non-empty query.');
          const cap = this.settings.get().tavilyDailySearchCap;
          const budget = this.tavilyVerification.budgetStatus(cap);
          if (!budget.allowed) throw new Error(searchBudgetMessage(budget.searches, budget.cap));
          const result = await this.tavilyVerification.search({ query: args.query, maxResults: typeof args.maxResults === 'number' ? args.maxResults : undefined, offline: false });
          return { toolCallId, toolName: name, success: true, output: JSON.stringify({ query: result.query, answer: result.answer, citations: result.citations, results: result.results.map(source => ({ title: source.title, url: source.url, domain: source.domain, official: source.official, snippet: source.content })), cached: result.cached, usage: result.usage }), data: result, durationMs: Date.now() - start };
        }
        if (!args || typeof args !== 'object' || Array.isArray(args) || !Array.isArray(args.urls)) throw new Error('web_fetch requires a urls array.');
        const result = await this.tavilyVerification.extract({ urls: args.urls, offline: false });
        return { toolCallId, toolName: name, success: true, output: JSON.stringify({ pages: result.pages.map(page => ({ url: page.url, title: page.title, chars: page.content.length })), failedUrls: result.failedUrls, usage: result.usage }), data: result, durationMs: Date.now() - start };
      } catch (error: any) { return { toolCallId, toolName: name, success: false, output: '', error: error?.message || 'Tavily web access failed.', durationMs: Date.now() - start }; }
    }
    if (this.codingPlugins.handles(name)) {
      const start = Date.now();
      try {
        if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Expected JSON object arguments.');
        if (name === 'plugin_debug_launch' && !context.preApproved && !(await context.requestApproval?.({ kind: 'terminal', title: 'Launch local Node debugger', reason: 'This runs the selected workspace script under the local Node inspector.' }))) {
          throw new Error('Debugger launch requires explicit approval.');
        }
        // Keep path mutation consistent with core tools and agent write tracking.
        if (name.endsWith('_scan') || name === 'plugin_rules_read' || name === 'plugin_dependencies_inspect') args.dirPath ??= '.';
        applyProjectPrefixToArgs(args, context.projectPrefix, context.projectLayout);
        const result = await this.codingPlugins.invoke(name, args);
        if (result.replacement !== undefined) {
          const write = await this.executeTool(toolCallId, 'write_file', { filePath: args.filePath, content: result.replacement }, { ...context, projectPrefix: undefined });
          return { ...write, toolName: name, durationMs: Date.now() - start };
        }
        return { toolCallId, toolName: name, success: result.success !== false, output: result.output, data: result.data, durationMs: Date.now() - start };
      } catch (error: any) {
        return { toolCallId, toolName: name, success: false, output: '', error: error.message, ...(name === 'plugin_debug_launch' && /requires explicit approval/i.test(error.message) ? { needsApproval: true } : {}), durationMs: Date.now() - start } as ToolResult & { needsApproval?: boolean };
      }
    }
    const extension=this.extensions.get(name);
    if(extension) {
      try {
        if (this.settings.get().offlineMode && extension.definition.permission === 'network') throw new Error('Offline Mode blocks network extension tools. Bundled coding plugins and local MCP servers remain available.');
        if(!args||typeof args!=='object'||Array.isArray(args)) throw new Error('Invalid extension arguments.');
        for(const required of extension.definition.parameters.required||[]) if(!(required in args)) throw new Error(`Missing argument: ${required}`);
        // Read-only local extensions (for example the workspace-scoped LSP
        // bridge) are safe to use during an agent turn. External/network and
        // execute extensions still stay behind the normal approval gate.
        if(extension.definition.permission !== 'read' && !context.preApproved && !(await context.requestApproval?.({kind:'terminal',title:`Run ${name}`,reason:extension.definition.description}))) throw new Error('Extension tool requires approval.');
        return {toolCallId,toolName:name,success:true,output:await extension.invoke(args)};
      } catch(e:any) {return {toolCallId,toolName:name,success:false,output:'',error:e.message};}
    }
    const root = this.workspace.getRoot();

    // Alias normalization FIRST (defense in depth): a native tool_call that
    // names the tool "file_write" with a "path" argument executes exactly
    // like a registry-canonical "write_file"/"filePath" call. Only well-known
    // synonyms map; genuinely unknown tools are still rejected below.
    name = normalizeToolName(name);
    if (args && typeof args === 'object' && !Array.isArray(args)) {
      const normalizedArgs = normalizeToolArgs(args);
      for (const k of Object.keys(normalizedArgs)) args[k] = normalizedArgs[k];
    }

    const normalizedModelContent = normalizeModelFileContent(name, args);

    // Validate the tool actually exists before executing anything.
    if (!this.getToolDefinitions().some((t) => t.name === name)) {
      return {
        toolCallId,
        toolName: name,
        success: false,
        output: `Unknown tool: ${name}`,
        error: `Unknown tool: ${name}`,
      };
    }

    // Never trust argument payloads that are not objects.
    if (!args || typeof args !== 'object' || Array.isArray(args)) {
      return {
        toolCallId,
        toolName: name,
        success: false,
        output: 'Invalid tool arguments: expected a JSON object.',
        error: 'Invalid tool arguments: expected a JSON object.',
      };
    }

    // Required-argument validation: reject malformed calls with a precise
    // error instead of crashing deep inside the implementation.
    const argError = validateRequiredArgs(name, args);
    if (argError) {
      return { toolCallId, toolName: name, success: false, output: argError, error: argError };
    }

    // Route relative path arguments into the active project folder.
    applyProjectPrefixToArgs(args, context.projectPrefix, context.projectLayout);
    for (const key of PATH_ARG_KEYS) {
      if (typeof args[key] !== 'string') continue;
      const checked = this.workspace.resolveSafePath(args[key]);
      if (!checked.safe) return { toolCallId, toolName: name, success: false, output: checked.error!, error: checked.error };
      args[key] = path.relative(this.workspace.getRoot(), checked.fullPath).replace(/\\/g, '/') || '.';
    }

    // Protected secret files cannot be read by the model. Refuse mutations of
    // an existing protected target too: otherwise write_file/write_file_chunk
    // could misclassify the unreadable file as new and silently replace it.
    const mutationPaths: string[] = name === 'rename_file'
      ? [args.oldPath, args.newPath]
      : ['copy_file', 'move_file'].includes(name)
        ? [args.sourcePath, args.destinationPath]
        : ['write_file', 'create_file', 'append_file', 'edit_file', 'apply_patch', 'delete_file', 'write_file_chunk'].includes(name)
          ? [args.filePath]
          : [];
    for (const candidate of mutationPaths) {
      if (typeof candidate !== 'string' || !WorkspaceManager.isSecretPath(candidate)) continue;
      const checked = this.workspace.resolveSafePath(candidate);
      if (checked.safe && fs.existsSync(checked.fullPath)) {
        const error = `Protected secret file mutation blocked: ${candidate} already exists and NUVRO AI cannot read it to preserve its contents. Update it manually or use the provider's secure settings.`;
        return { toolCallId, toolName: name, success: false, output: error, error };
      }
    }

    const autoApplyDiffs = context.autoApplyDiffs ?? this.settings.get().autoApplyDiffs;

    try {
      switch (name) {
        // --- FILE TOOLS ---
        case 'read_file': {
          const res = this.workspace.readFile(args.filePath);
          if (!res.success) {
            return { toolCallId, toolName: name, success: false, output: res.error || 'Failed to read file', error: res.error };
          }
          const rawContent = res.content || '';
          let modelContent = '';
          if (context.secretRedactions) {
            const key = this.secretRedactionKey(args.filePath);
            const redacted = redactSensitiveTextForRoundTrip(rawContent, context.secretRedactions.get(key));
            if (redacted.values.size) context.secretRedactions.set(key, redacted.values);
            else context.secretRedactions.delete(key);
            modelContent = redacted.content;
          } else {
            modelContent = this.workspace.redactSecrets(rawContent);
          }
          return {
            toolCallId,
            toolName: name,
            success: true,
            output: modelContent,
            data: { size: res.size, filePath: args.filePath },
          };
        }

        case 'write_file': {
          const requestedContent = typeof args.content === 'string' ? args.content : '';
          const before = this.workspace.readFile(args.filePath);
          const restored = this.restoreToolSource(args.filePath, requestedContent, context, true);
          if (restored.error) return { toolCallId, toolName: name, success: false, output: restored.error, error: restored.error };
          const content = restored.content;
          const oldContent = before.success && before.content !== undefined ? before.content : '';
          const patch = PatchEngine.createPatch(args.filePath, oldContent, content, before.success ? 'modified' : 'created');

          // Auto Apply Diffs OFF: stage the change and require user confirmation.
          if (!autoApplyDiffs) {
            return {
              toolCallId,
              toolName: name,
              success: true,
              staged: true,
              output: `Change prepared for ${args.filePath} but NOT applied: Auto Apply Diffs is OFF, so the user must review and approve this change in the NUVRO AI UI. Tell the user to review the proposed change and apply it.`,
              data: patch,
            };
          }

          const res = this.workspace.writeFile(args.filePath, content);
          if (!res.success) {
            return { toolCallId, toolName: name, success: false, output: res.error || 'Failed to write file', error: res.error };
          }
          return {
            toolCallId,
            toolName: name,
            success: true,
            output: `Successfully wrote ${content.length} characters to ${args.filePath} (absolute path: ${path.join(this.workspace.getRoot(), args.filePath)}) — read back from disk and verified: ${res.sizeBytes} bytes on disk match the requested content.${normalizedModelContent ? ' Recovered an outer model source wrapper before writing.' : ''}`,
            data: patch,
          };
        }

        case 'write_file_chunk': {
          const currentBeforeChunks = this.workspace.readFile(args.filePath);
          if (this.secretRedactionsFor(args.filePath, context)?.size ||
              currentBeforeChunks.success && currentBeforeChunks.content !== undefined && redactSensitiveText(currentBeforeChunks.content) !== currentBeforeChunks.content) {
            const error = `Chunked replacement blocked for ${args.filePath}: the target contains inline credentials, and chunk writes cannot safely preserve opaque secret handles. Use a focused edit_file change instead; the file was left unchanged.`;
            return { toolCallId, toolName: name, success: false, output: error, error };
          }
          this.loadChunkTransfers();
          const transferId = String(args.transferId || '').trim();
          const chunkIndex = Number(args.chunkIndex);
          const totalChunks = Number(args.totalChunks);
          const final = args.final === true;
          const chunk = typeof args.content === 'string' ? args.content : '';
          const chunkBytes = Buffer.byteLength(chunk, 'utf8');
          if (!transferId || transferId.length > CHUNK_TRANSFER_LIMITS.maxTransferIdLength || !/^[\w.:-]+$/.test(transferId) ||
              chunkBytes > CHUNK_TRANSFER_LIMITS.maxChunkBytes || !Number.isInteger(chunkIndex) || !Number.isInteger(totalChunks) ||
              totalChunks < 1 || totalChunks > CHUNK_TRANSFER_LIMITS.maxChunks || chunkIndex < 0 || chunkIndex >= totalChunks) {
            return { toolCallId, toolName: name, success: false, output: 'Invalid chunk metadata: use a stable transferId, zero-based chunkIndex, and positive totalChunks.', error: 'Invalid chunk metadata' };
          }
          if (final !== (chunkIndex === totalChunks - 1)) {
            return { toolCallId, toolName: name, success: false, output: 'Invalid final flag: only the last chunk may set final=true.', error: 'Invalid final flag' };
          }
          const existing = this.chunkTransfers.get(transferId);
          if (!existing) {
            if (chunkIndex !== 0) return { toolCallId, toolName: name, success: false, output: 'Chunk transfer must start at chunkIndex 0. No file was changed.', error: 'Out-of-order first chunk' };
            if (this.chunkTransfers.size >= CHUNK_TRANSFER_LIMITS.maxTransfers) {
              return { toolCallId, toolName: name, success: false, output: `Too many active chunk transfers (${CHUNK_TRANSFER_LIMITS.maxTransfers}). Finish or resume one before starting another.`, error: 'Chunk transfer limit reached' };
            }
          } else {
            if (existing.filePath !== args.filePath || existing.totalChunks !== totalChunks) {
              return { toolCallId, toolName: name, success: false, output: 'Chunk transfer metadata changed mid-transfer. No file was changed.', error: 'Chunk transfer mismatch' };
            }
            if (chunkIndex < existing.nextIndex) {
              return { toolCallId, toolName: name, success: true, output: `Chunk ${chunkIndex + 1}/${totalChunks} was already applied; request chunk ${existing.nextIndex + 1}/${totalChunks}.`, data: { transferId, nextChunk: existing.nextIndex, complete: false, duplicate: true } };
            }
            if (chunkIndex !== existing.nextIndex) {
              return { toolCallId, toolName: name, success: false, output: `Expected chunk ${existing.nextIndex}, received ${chunkIndex}. No file was changed.`, error: 'Out-of-order chunk' };
            }
          }
          const before = this.workspace.readFile(args.filePath);
          const diskMatchesTransfer = existing && (autoApplyDiffs
            ? before.success && before.content === existing.content
            : existing.originalExists
              ? before.success && before.content === existing.originalContent
              : !before.success);
          if (existing && !diskMatchesTransfer) {
            return { toolCallId, toolName: name, success: false, output: `Chunk transfer paused: ${args.filePath} changed since chunk ${existing.nextIndex} was saved. No new chunk was written; inspect the file before resuming.`, error: 'Chunk target changed during transfer' };
          }
          const assembled = existing ? existing.content + chunk : chunk;
          const oldContent = before.success && before.content !== undefined ? before.content : '';
          const originalContent = existing?.originalContent ?? oldContent;
          const originalExists = existing?.originalExists ?? before.success;
          const assembledBytes = Buffer.byteLength(assembled, 'utf8');
          const originalBytes = Buffer.byteLength(originalContent, 'utf8');
          const otherBufferedBytes = Array.from(this.chunkTransfers.entries())
            .filter(([id]) => id !== transferId)
            .reduce((sum, [, transfer]) => sum + Buffer.byteLength(transfer.content, 'utf8') + Buffer.byteLength(transfer.originalContent, 'utf8'), 0);
          if (assembledBytes > CHUNK_TRANSFER_LIMITS.maxFileBytes || originalBytes > CHUNK_TRANSFER_LIMITS.maxFileBytes) {
            return { toolCallId, toolName: name, success: false, output: `Chunk transfer exceeds the ${CHUNK_TRANSFER_LIMITS.maxFileBytes / (1024 * 1024)} MiB per-file limit. No new chunk was accepted.`, error: 'Chunk file size limit exceeded' };
          }
          if (otherBufferedBytes + assembledBytes + originalBytes > CHUNK_TRANSFER_LIMITS.maxBufferedBytes) {
            return { toolCallId, toolName: name, success: false, output: `Chunk transfers exceed the ${CHUNK_TRANSFER_LIMITS.maxBufferedBytes / (1024 * 1024)} MiB total checkpoint budget. No new chunk was accepted.`, error: 'Chunk checkpoint budget exceeded' };
          }
          const patch = PatchEngine.createPatch(args.filePath, originalContent, assembled, originalExists ? 'modified' : 'created');
          if (!autoApplyDiffs) {
            if (final) {
              this.chunkTransfers.delete(transferId);
              if (!this.persistChunkTransfers()) {
                if (existing) this.chunkTransfers.set(transferId, existing);
                return { toolCallId, toolName: name, success: false, output: `The final chunk was assembled, but the review checkpoint could not be saved. No file was changed; retry this same chunk after checking workspace write access.`, error: 'Chunk review checkpoint could not be persisted' };
              }
              return {
                toolCallId,
                toolName: name,
                success: true,
                staged: true,
                output: `Chunk ${chunkIndex + 1}/${totalChunks} assembled. The complete change for ${args.filePath} is staged for review; the workspace file was not changed.`,
                data: { ...patch, transferId, nextChunk: totalChunks, complete: true },
              };
            }
            const previousTransfer = existing;
            this.chunkTransfers.set(transferId, {
              filePath: args.filePath, totalChunks, nextIndex: chunkIndex + 1, content: assembled,
              originalContent, originalExists,
            });
            if (!this.persistChunkTransfers()) {
              if (previousTransfer) this.chunkTransfers.set(transferId, previousTransfer);
              else this.chunkTransfers.delete(transferId);
              return { toolCallId, toolName: name, success: false, output: `Chunk ${chunkIndex + 1}/${totalChunks} was not saved: its recovery checkpoint could not be written. The workspace file is unchanged; no next chunk was accepted.`, error: 'Chunk checkpoint could not be persisted' };
            }
            return {
              toolCallId,
              toolName: name,
              success: true,
              output: `Chunk ${chunkIndex + 1}/${totalChunks} checkpointed for ${args.filePath}; workspace unchanged. Request chunk ${chunkIndex + 2}/${totalChunks} only after this success.`,
            };
          }
          const res = this.workspace.writeFile(args.filePath, assembled);
          if (!res.success) return { toolCallId, toolName: name, success: false, output: res.error || 'Failed to write file chunk', error: res.error };
          if (final) {
            this.chunkTransfers.delete(transferId);
            const checkpointRemoved = this.persistChunkTransfers();
            return {
              toolCallId, toolName: name, success: true,
              output: `Chunk ${chunkIndex + 1}/${totalChunks} written and transfer completed for ${args.filePath}.${checkpointRemoved ? '' : ' The file is complete, but the old recovery checkpoint could not be removed; inspect .quillix/chunk-transfers.json before reusing this workspace.'}`,
              data: { ...patch, transferId, nextChunk: totalChunks, complete: true, checkpointRemoved },
            };
          }
          const previousTransfer = existing;
          this.chunkTransfers.set(transferId, {
            filePath: args.filePath, totalChunks, nextIndex: chunkIndex + 1, content: assembled,
            originalContent, originalExists,
          });
          const checkpointSaved = this.persistChunkTransfers();
          if (!checkpointSaved) {
            if (previousTransfer) this.chunkTransfers.set(transferId, previousTransfer);
            else this.chunkTransfers.delete(transferId);
            const restored = originalExists
              ? this.workspace.writeFile(args.filePath, oldContent)
              : this.workspace.deleteFile(args.filePath);
            return {
              toolCallId, toolName: name, success: false,
              output: restored.success
                ? `Chunk ${chunkIndex + 1}/${totalChunks} was rolled back because its recovery checkpoint could not be saved. No next chunk was accepted; retry after fixing workspace metadata access.`
                : `Chunk checkpoint failed and automatic rollback also failed: ${restored.error || 'unknown rollback error'}. Stop this transfer and inspect ${args.filePath} before continuing.`,
              error: restored.success ? 'Chunk checkpoint could not be persisted' : 'Chunk checkpoint and rollback failed',
              data: { transferId, nextChunk: chunkIndex, complete: false, rolledBack: restored.success },
            };
          }
          return {
            toolCallId, toolName: name, success: true,
            output: `Chunk ${chunkIndex + 1}/${totalChunks} written to ${args.filePath}; recovery checkpoint saved. Request the next chunk only after this success.`,
            data: { ...patch, transferId, nextChunk: chunkIndex + 1, complete: false, checkpointSaved: true },
          };
        }

        case 'append_file': {
          const readRes = this.workspace.readFile(args.filePath);
          if (!readRes.success || readRes.content === undefined) {
            return { toolCallId, toolName: name, success: false, output: readRes.error || 'File not found — create it with write_file first.', error: readRes.error || 'File not found' };
          }
          const append = typeof args.content === 'string' ? args.content : '';
          const combined = readRes.content + append;
          const oldContent = readRes.content;
          const patch = PatchEngine.createPatch(args.filePath, oldContent, combined, 'modified');

          if (!autoApplyDiffs) {
            return {
              toolCallId,
              toolName: name,
              success: true,
              staged: true,
              output: `Append to ${args.filePath} prepared but NOT applied: Auto Apply Diffs is OFF, so the user must review and approve this change in the NUVRO AI UI.`,
              data: patch,
            };
          }

          const res = this.workspace.writeFile(args.filePath, combined);
          if (!res.success) {
            return { toolCallId, toolName: name, success: false, output: res.error || 'Failed to append to file', error: res.error };
          }
          return {
            toolCallId,
            toolName: name,
            success: true,
            output: `Appended ${append.length} characters to ${args.filePath} — read back from disk and verified: file is now ${res.sizeBytes} bytes.`,
            data: patch,
          };
        }

        case 'edit_file': {
          const readRes = this.workspace.readFile(args.filePath);
          if (!readRes.success || readRes.content === undefined) {
            return { toolCallId, toolName: name, success: false, output: readRes.error || 'File not found.', error: readRes.error || 'File not found' };
          }
          const requestedOldString = typeof args.oldString === 'string' ? args.oldString : '';
          if (typeof args.newString !== 'string') {
            return { toolCallId, toolName: name, success: false, output: 'edit_file requires an explicit newString; use an empty string only for an intended deletion.', error: 'Missing newString' };
          }
          const oldString = this.restoreToolSource(args.filePath, requestedOldString, context).content;
          const newString = this.restoreToolSource(args.filePath, args.newString, context).content;
          if (!oldString) {
            return {
              toolCallId,
              toolName: name,
              success: false,
              output: "Invalid tool arguments: 'edit_file' requires a non-empty 'oldString' to find in the file.",
              error: "Missing oldString",
            };
          }
          const content = readRes.content;
          if (!content.includes(oldString)) {
            return {
              toolCallId,
              toolName: name,
              success: false,
              output: `edit_file failed: oldString was not found in ${args.filePath}. Read the file first and use an exact excerpt as oldString.`,
              error: 'oldString not found in file',
            };
          }
          const occurrences = content.split(oldString).length - 1;
          if (occurrences > 1 && args.replaceAll !== true) {
            return { toolCallId, toolName: name, success: false, output: `Ambiguous edit: oldString matches ${occurrences} places in ${args.filePath}. Include unique surrounding context, or explicitly set replaceAll: true when every replacement is intended. No file was changed.`, error: 'Ambiguous oldString; exact unique context required' };
          }
          const updated = occurrences === 1 ? content.replace(oldString, newString) : content.split(oldString).join(newString);
          if (updated === content) return { toolCallId, toolName: name, success: false, output: 'The proposed edit makes no source change. Reinspect the file and provide an actual correction, or report that no change is needed.', error: 'No source change' };
          const extension = path.extname(args.filePath).toLowerCase();
          if (content.length <= 512 * 1024 && updated.length <= 512 * 1024 && /^(?:\.[cm]?js|\.jsx|\.ts|\.tsx|\.json)$/.test(extension)) {
            const parse = (source: string) => extension === '.json' ? JSON.parse(source) : parseEditSyntax(source, {
              sourceType: 'unambiguous', plugins: [...(['.ts', '.tsx'].includes(extension) ? ['typescript' as const] : []), ...(['.jsx', '.tsx'].includes(extension) ? ['jsx' as const] : [])],
            });
            let wasValid = true;
            try { parse(content); } catch { wasValid = false; }
            if (wasValid) {
              try { parse(updated); } catch (error: any) {
                return { toolCallId, toolName: name, success: false, output: `Syntax preflight rejected the edit to ${args.filePath}: ${String(error.message).slice(0, 600)}. Original source is preserved. Read the current source and replace a complete, balanced block.`, error: 'Edit would break source syntax' };
              }
            }
          }
          const patch = PatchEngine.createPatch(args.filePath, content, updated, 'modified');

          if (!autoApplyDiffs) {
            return {
              toolCallId,
              toolName: name,
              success: true,
              staged: true,
              output: `Edit to ${args.filePath} prepared but NOT applied: Auto Apply Diffs is OFF, so the user must review and approve this change in the NUVRO AI UI.`,
              data: patch,
            };
          }

          const res = this.workspace.writeFile(args.filePath, updated);
          if (!res.success) {
            return { toolCallId, toolName: name, success: false, output: res.error || 'Failed to write edited file', error: res.error };
          }
          return {
            toolCallId,
            toolName: name,
            success: true,
            output: `Edited ${args.filePath}: replaced ${occurrences} occurrence(s) of the target text — read back from disk and verified: ${res.sizeBytes} bytes on disk.`,
            data: patch,
          };
        }

        case 'create_file': {
          const patch = PatchEngine.createPatch(args.filePath, '', typeof args.content === 'string' ? args.content : '', 'created');

          if (!autoApplyDiffs) {
            return {
              toolCallId,
              toolName: name,
              success: true,
              staged: true,
              output: `New file ${args.filePath} prepared but NOT created: Auto Apply Diffs is OFF, so the user must review and approve this change in the NUVRO AI UI. Tell the user to review the proposed change and apply it.`,
              data: patch,
            };
          }

          const res = this.workspace.createFile(args.filePath, args.content || '');
          if (!res.success) {
            return { toolCallId, toolName: name, success: false, output: res.error || 'Failed to create file', error: res.error };
          }
          return {
            toolCallId,
            toolName: name,
            success: true,
            output: `Successfully created file ${args.filePath} (absolute path: ${path.join(this.workspace.getRoot(), args.filePath)}) — read back from disk and verified: ${res.sizeBytes} bytes on disk.`,
            data: patch,
          };
        }

        case 'delete_file': {
          if (!context.preApproved) {
            const approved = context.requestApproval && await context.requestApproval({
              kind: 'file', title: 'Approve deletion', command: args.filePath,
              reason: 'Deleting this file or folder permanently removes its contents.',
            });
            if (!approved) return { toolCallId, toolName: name, success: false, needsApproval: !context.requestApproval, output: 'Deletion requires user approval.', error: 'Deletion not approved.' };
          }
          const before = this.workspace.readFile(args.filePath);
          const res = this.workspace.deleteFile(args.filePath);
          if (!res.success) {
            return { toolCallId, toolName: name, success: false, output: res.error || 'Failed to delete file', error: res.error };
          }
          return {
            toolCallId,
            toolName: name,
            success: true,
            output: `Successfully deleted ${args.filePath}`,
            ...(before.success && before.content !== undefined
              ? { data: PatchEngine.createPatch(args.filePath, before.content, '', 'deleted') }
              : {}),
          };
        }

        case 'copy_file': {
          const readRes = this.workspace.readFile(args.sourcePath);
          if (!readRes.success || readRes.content === undefined) {
            return { toolCallId, toolName: name, success: false, output: readRes.error || 'Source file not found', error: readRes.error };
          }
          const writeRes = this.workspace.createFile(args.destinationPath, readRes.content);
          if (!writeRes.success) {
            return { toolCallId, toolName: name, success: false, output: writeRes.error || 'Failed to create destination copy', error: writeRes.error };
          }
          return {
            toolCallId,
            toolName: name,
            success: true,
            output: `Copied ${args.sourcePath} to ${args.destinationPath}`,
          };
        }

        case 'list_directory': {
          const res = this.workspace.listDirectory(args.dirPath || '.');
          if (!res.success) {
            return { toolCallId, toolName: name, success: false, output: res.error || 'Failed to list directory', error: res.error };
          }
          const formatted = (res.files || [])
            .map((f) => `${f.isDirectory ? '[DIR]' : '[FILE]'} ${f.name} (${f.size} bytes)`)
            .join('\n');
          return {
            toolCallId,
            toolName: name,
            success: true,
            output: formatted || '(empty directory)',
            data: res.files,
          };
        }

        case 'create_directory': {
          if (typeof args.dirPath !== 'string' || !args.dirPath.trim()) {
            return {
              toolCallId,
              toolName: name,
              success: false,
              output: 'Invalid directory path: expected a non-empty string.',
              error: 'Invalid directory path: expected a non-empty string.',
            };
          }
          const dirRes = this.workspace.createDirectory(args.dirPath);
          if (!dirRes.success) {
            return { toolCallId, toolName: name, success: false, output: dirRes.error || 'Failed to create directory', error: dirRes.error };
          }
          return {
            toolCallId,
            toolName: name,
            success: true,
            output: `Successfully created directory ${args.dirPath}`,
          };
        }

        case 'move_file':
        case 'rename_file': {
          const res = this.workspace.renameFile(args.oldPath, args.newPath);
          if (!res.success) {
            return { toolCallId, toolName: name, success: false, output: res.error || 'Failed to move/rename', error: res.error };
          }
          return {
            toolCallId,
            toolName: name,
            success: true,
            output: `Moved/renamed ${args.oldPath} to ${args.newPath}`,
          };
        }

        case 'search_files':
        case 'search_code': {
          const res = this.workspace.searchFiles(args.query, {
            caseSensitive: args.caseSensitive,
            wholeWord: args.wholeWord,
          });
          if (!res.success) {
            return { toolCallId, toolName: name, success: false, output: res.error || 'Search error', error: res.error };
          }
          const formatted = res.matches
            .map((m) => `${m.filePath}:${m.lineNumber}: ${m.lineContent}`)
            .join('\n');
          return {
            toolCallId,
            toolName: name,
            success: true,
            output: formatted || `No matches found for query: ${args.query}`,
            data: res.matches,
          };
        }

        case 'get_file_metadata': {
          const res = this.workspace.getMetadata(args.filePath);
          if (!res.success || !res.meta) {
            return { toolCallId, toolName: name, success: false, output: res.error || 'File not found', error: res.error };
          }
          const m = res.meta;
          const formatted = [
            `Path: ${m.relativePath}`,
            `Absolute: ${m.absolutePath}`,
            `Type: ${m.isDirectory ? 'directory' : m.isFile ? 'file' : 'other'}`,
            `Size: ${m.sizeBytes} bytes`,
            `Created: ${m.created}`,
            `Modified: ${m.modified}`,
            `Accessed: ${m.accessed}`,
          ].join('\n');
          return { toolCallId, toolName: name, success: true, output: formatted, data: m };
        }

        case 'get_project_structure': {
          const depth = typeof args.maxDepth === 'number' && args.maxDepth > 0 ? Math.floor(args.maxDepth) : 6;
          const res = this.workspace.getProjectStructure(args.dirPath || '.', depth);
          if (!res.success || !res.tree) {
            return { toolCallId, toolName: name, success: false, output: res.error || 'Failed to read project structure', error: res.error };
          }
          return {
            toolCallId,
            toolName: name,
            success: true,
            output: `${res.tree}\n\n${res.fileCount} file(s), ${res.directoryCount} directory(ies)`,
            data: { tree: res.tree, fileCount: res.fileCount, directoryCount: res.directoryCount },
          };
        }

        case 'compare_files': {
          const readA = this.workspace.readFile(args.filePathA);
          if (!readA.success || readA.content === undefined) {
            return { toolCallId, toolName: name, success: false, output: readA.error || `File not found: ${args.filePathA}`, error: readA.error };
          }
          const readB = this.workspace.readFile(args.filePathB);
          if (!readB.success || readB.content === undefined) {
            return { toolCallId, toolName: name, success: false, output: readB.error || `File not found: ${args.filePathB}`, error: readB.error };
          }
          const patchStr = diffLib.createTwoFilesPatch(
            `a/${args.filePathA}`,
            `b/${args.filePathB}`,
            readA.content,
            readB.content,
            'original',
            'modified',
            { context: 3 }
          );
          const changes = diffLib.diffLines(readA.content, readB.content);
          let linesAdded = 0;
          let linesRemoved = 0;
          for (const part of changes) {
            if (part.added) linesAdded += part.count || 0;
            else if (part.removed) linesRemoved += part.count || 0;
          }
          const identical = linesAdded === 0 && linesRemoved === 0;
          return {
            toolCallId,
            toolName: name,
            success: true,
            output: identical
              ? `${args.filePathA} and ${args.filePathB} are IDENTICAL.`
              : `Files differ (+${linesAdded} / -${linesRemoved} lines):\n\n${patchStr}`,
            data: { identical, linesAdded, linesRemoved, diff: patchStr },
          };
        }

        case 'verify_file': {
          const check = this.workspace.resolveSafePath(args.filePath);
          if (!check.safe) {
            const unsafe = check.error || 'Path is outside the workspace or invalid.';
            return { toolCallId, toolName: name, success: false, output: unsafe, error: unsafe };
          }
          if (!fs.existsSync(check.fullPath)) {
            return {
              toolCallId,
              toolName: name,
              success: false,
              output: `VERIFICATION FAILED: ${args.filePath} does not exist on disk.`,
              error: 'File does not exist',
            };
          }
          const stat = fs.statSync(check.fullPath);
          const readBack = this.workspace.readFile(args.filePath);
          const lines: string[] = [
            `Path: ${args.filePath}`,
            `Exists: yes`,
            `Size: ${stat.size} bytes`,
          ];
          if (readBack.success && readBack.content !== undefined) {
            lines.push(`Read back from disk: OK (${readBack.content.length} characters)`);
            if (typeof args.expectedContent === 'string' && args.expectedContent.length > 0) {
              const present = readBack.content.includes(args.expectedContent);
              lines.push(`Expected content present: ${present ? 'yes' : 'NO'}`);
              if (!present) {
                return {
                  toolCallId,
                  toolName: name,
                  success: false,
                  output: `${lines.join('\n')}\n\nVERIFICATION FAILED: the expected content was not found in ${args.filePath}.`,
                  error: 'Expected content missing',
                };
              }
            }
          }
          // Real syntax/placeholder validation for code files.
          const verifier = new WorkspaceVerifier(this.workspace, this.terminal);
          const report = await verifier.verifyFiles([args.filePath]);
          const failures = report.failures;
          if (failures.length > 0) {
            return {
              toolCallId,
              toolName: name,
              success: false,
              output: `${lines.join('\n')}\n\nVERIFICATION FAILED:\n${failures.map((f) => `- ${f.filePath} [${f.check}]: ${f.error}`).join('\n')}`,
              error: failures.map((f) => `${f.check}: ${f.error}`).join('; '),
            };
          }
          lines.push('Syntax/content checks: PASS');
          return { toolCallId, toolName: name, success: true, output: lines.join('\n'), data: { sizeBytes: stat.size } };
        }

        case 'find_symbol':
        case 'find_definition':
        case 'find_references':
        case 'find_usages': {
          const query = args.symbol || args.identifier || '';
          const semantic = name === 'find_definition'
            ? this.semantic.findDefinitions(query)
            : name === 'find_references' || name === 'find_usages'
              ? this.semantic.findReferences(query)
              : [];
          const res: { success: boolean; symbols: Array<{ filePath: string; line: number; kind: string; name: string }>; error?: string } = semantic.length > 0
            ? { success: true, symbols: semantic.map(location => ({ filePath: location.filePath, line: location.line, kind: location.kind || 'reference', name: query })) }
            : name === 'find_definition'
              ? this.workspace.findDefinitions(query)
              : name === 'find_references' || name === 'find_usages'
                ? this.workspace.findReferences(query)
                : this.workspace.findSymbols(query);
          if (!res.success) {
            return { toolCallId, toolName: name, success: false, output: res.error || 'Symbol search error', error: res.error };
          }
          const formatted = res.symbols
            .map((s) => `${s.filePath}:${s.line} [${s.kind}] ${s.name}`)
            .join('\n');
          return {
            toolCallId,
            toolName: name,
            success: true,
            output: formatted || `No occurrences found for "${query}"`,
            data: res.symbols,
          };
        }

        case 'language_diagnostics': {
          const diagnostics = this.semantic.diagnostics(typeof args.filePath === 'string' && args.filePath.trim() ? args.filePath : undefined);
          const output = diagnostics.length
            ? diagnostics.map(item => `${item.filePath}:${item.line}:${item.column} [${item.category} TS${item.code}] ${item.message}`).join('\n')
            : 'TypeScript/JavaScript language-service diagnostics: PASS (no diagnostics in the bounded project scan).';
          return { toolCallId, toolName: name, success: true, output, data: diagnostics };
        }

        // --- CODE / PROJECT TOOLS ---
        case 'analyze_file': {
          const read = this.workspace.readFile(args.filePath);
          if (!read.success || read.content === undefined) {
            return { toolCallId, toolName: name, success: false, output: read.error || 'File not found' };
          }
          const lines = read.content.split('\n').length;
          const ext = path.extname(args.filePath);
          return {
            toolCallId,
            toolName: name,
            success: true,
            output: `File: ${args.filePath}\nExtension: ${ext}\nLines: ${lines}\nSize: ${read.size} bytes`,
            data: { lines, size: read.size, ext },
          };
        }

        case 'analyze_project':
        case 'detect_project': {
          const meta = await this.indexer.analyzeProject();
          const out = [
            `Name: ${meta.name}`,
            `Framework: ${meta.framework}`,
            `Runtime: ${meta.runtime} (${meta.packageManager})`,
            `Languages: ${meta.languages.join(', ')}`,
            `Entry Points: ${meta.entryPoints.join(', ')}`,
            `Git Repo: ${meta.isGitRepo ? `Yes (branch: ${meta.gitBranch})` : 'No'}`,
            `Scripts: ${Object.keys(meta.scripts).join(', ')}`,
          ].join('\n');
          return { toolCallId, toolName: name, success: true, output: out, data: meta };
        }

        case 'detect_framework': {
          const meta = await this.indexer.analyzeProject();
          return { toolCallId, toolName: name, success: true, output: `Framework: ${meta.framework}` };
        }

        case 'detect_package_manager': {
          const meta = await this.indexer.analyzeProject();
          return { toolCallId, toolName: name, success: true, output: `Package Manager: ${meta.packageManager}` };
        }

        case 'detect_project_type': {
          const meta = await this.indexer.analyzeProject();
          return { toolCallId, toolName: name, success: true, output: `Project Type: ${meta.framework} / ${meta.runtime}` };
        }

        // --- PATCH TOOLS ---
        case 'create_patch':
        case 'preview_patch': {
          const read = this.workspace.readFile(args.filePath);
          const oldContent = read.success && read.content !== undefined ? read.content : '';
          const patch = PatchEngine.createPatch(args.filePath, oldContent, args.newContent, read.success ? 'modified' : 'created');
          return {
            toolCallId,
            toolName: name,
            success: true,
            output: `Patch generated for ${args.filePath}: +${patch.linesAdded}, -${patch.linesRemoved}\n\n${patch.diff}`,
            data: patch,
          };
        }

        case 'apply_patch': {
          const read = this.workspace.readFile(args.filePath);
          const oldContent = read.success && read.content !== undefined ? read.content : '';
          const requestedContent = typeof args.newContent === 'string' ? args.newContent : '';
          const restored = this.restoreToolSource(args.filePath, requestedContent, context, true);
          if (restored.error) return { toolCallId, toolName: name, success: false, output: restored.error, error: restored.error };
          const patch = PatchEngine.createPatch(args.filePath, oldContent, restored.content, read.success ? 'modified' : 'created');

          if (!autoApplyDiffs) {
            return {
              toolCallId,
              toolName: name,
              success: true,
              staged: true,
              output: `Patch for ${args.filePath} prepared but NOT applied: Auto Apply Diffs is OFF, so the user must review and approve this change in the NUVRO AI UI. Tell the user to review the proposed change and apply it.`,
              data: patch,
            };
          }

          const applyRes = PatchEngine.applyPatch(oldContent, patch);
          if (!applyRes.success || applyRes.result === undefined) {
            return { toolCallId, toolName: name, success: false, output: applyRes.error || 'Failed to apply patch', error: applyRes.error };
          }

          const writeRes = this.workspace.writeFile(args.filePath, applyRes.result);
          if (!writeRes.success) {
            return { toolCallId, toolName: name, success: false, output: writeRes.error || 'Failed to write patched file', error: writeRes.error };
          }
          return {
            toolCallId,
            toolName: name,
            success: true,
            output: `Successfully applied patch to ${args.filePath} (+${patch.linesAdded}, -${patch.linesRemoved} lines)`,
            data: patch,
          };
        }

        case 'get_diff': {
          const diffStr = await this.git.getDiff(root, args.staged);
          return {
            toolCallId,
            toolName: name,
            success: true,
            output: diffStr || '(No git diff detected)',
          };
        }

        // --- TERMINAL TOOLS ---
        case 'run_command': {
          if (typeof args.command !== 'string' || !args.command.trim()) {
            return { toolCallId, toolName: name, success: false, output: 'Invalid command: expected a non-empty string.', error: 'Invalid command: expected a non-empty string.' };
          }

          // Never trust a cwd supplied by the model: resolve and verify it
          // belongs to the active workspace.
          const projectCwd = this.workspace.resolveSafePath(context.projectPrefix || '.');
          if (!projectCwd.safe) return { toolCallId, toolName: name, success: false, output: projectCwd.error!, error: projectCwd.error };
          let targetCwd = projectCwd.fullPath;
          if (args.cwd && typeof args.cwd === 'string' && args.cwd.trim()) {
            const resolved = path.resolve(root, args.cwd.trim());
            if (!this.workspace.isWithinWorkspace(resolved)) {
              return {
                toolCallId,
                toolName: name,
                success: false,
                output: 'Operation blocked: path is outside the active workspace. (command cwd)',
                error: 'Operation blocked: path is outside the active workspace. (command cwd)',
              };
            }
            targetCwd = resolved;
          }

          const { risk, reason } = TerminalService.classifyRisk(args.command);
          // Agent-issued REVIEW commands can also execute arbitrary code;
          // require explicit permission while Terminal Approval is enabled.
          if (risk === 'DANGEROUS' || risk === 'REVIEW') {
            const needsApproval = this.settings.get().terminalApproval;
            if (needsApproval && !context.preApproved) {
              if (context.requestApproval) {
                const approved = await context.requestApproval({
                  kind: 'terminal',
                  title: 'Approve terminal command',
                  command: args.command,
                  reason: reason || `Agent command classified ${risk}.`,
                });
                if (!approved) {
                  return {
                    toolCallId,
                    toolName: name,
                    success: false,
                    output: 'Command rejected: the user denied authorization.',
                    error: 'Command rejected: the user denied authorization.',
                  };
                }
              } else {
                return {
                  toolCallId,
                  toolName: name,
                  success: false,
                  needsApproval: true,
                  output: `Command not executed: "${args.command}" is classified ${risk} and requires explicit user approval.`,
                  error: `Command blocked pending user approval: ${reason || 'dangerous command'}`,
                };
              }
            }
          }

          const requestedTimeout = Number(args.timeoutMs);
          const timeoutMs = Number.isFinite(requestedTimeout)
            ? Math.min(120000, Math.max(1000, Math.round(requestedTimeout)))
            : 60000;
          const res = await this.terminal.executeCommand(args.command, targetCwd, undefined, timeoutMs, 'agent');
          const formatted = [
            `Command: ${args.command}`,
            `Exit Code: ${res.exitCode} (${res.durationMs}ms)`,
            res.stdout ? `STDOUT:\n${res.stdout}` : '',
            res.stderr ? `STDERR:\n${res.stderr}` : '',
          ]
            .filter(Boolean)
            .join('\n');
          return {
            toolCallId,
            toolName: name,
            success: res.exitCode === 0,
            output: formatted,
            error: res.exitCode !== 0 ? `Exit code ${res.exitCode}` : undefined,
            data: res,
          };
        }

        // --- BUILD & TEST TOOLS ---
        case 'install_dependencies': {
          const projectRoot = path.resolve(root, context.projectPrefix || '.');
          if (!this.workspace.isWithinWorkspace(projectRoot)) return { toolCallId, toolName: name, success: false, output: 'Project root outside workspace.', error: 'Project root outside workspace.' };
          const profile = LanguageRunnerRegistry.detect(projectRoot);
          const cmd = profile.installCommand;
          if (!cmd) return { toolCallId, toolName: name, success: false, output: 'No dependency installation command configured for this project.', error: 'No installation command configured.' };
          // Installing dependencies can download and execute third-party scripts.
          if (this.settings.get().terminalApproval && !context.preApproved) {
            if (!context.requestApproval) return { toolCallId, toolName: name, success: false, needsApproval: true, output: `Permission required: ${cmd}`, error: 'Dependency install requires approval.' };
            if (!await context.requestApproval({ kind: 'terminal', title: 'Approve dependency installation', command: cmd, reason: 'Package install scripts can run arbitrary code.' })) {
              return { toolCallId, toolName: name, success: false, output: 'Installation not approved.', error: 'Installation not approved.' };
            }
          }
          const res = await this.terminal.executeCommand(cmd, projectRoot, undefined, 120000, 'agent');
          return {
            toolCallId,
            toolName: name,
            success: res.exitCode === 0,
            output: res.stdout + '\n' + res.stderr,
            data: res,
          };
        }

        case 'run_build': {
          const projectRoot = path.resolve(root, context.projectPrefix || '.');
          if (!this.workspace.isWithinWorkspace(projectRoot)) return { toolCallId, toolName: name, success: false, output: 'Project root outside workspace.', error: 'Project root outside workspace.' };
          const profile = LanguageRunnerRegistry.detect(projectRoot);
          let cmd = profile.buildCommand;
          if (!cmd) {
            const manifest = readPackageManifest(projectRoot);
            if (manifest?.scripts?.build) cmd = 'npm run build';
          }
          if (!cmd) return { toolCallId, toolName: name, success: false, output: 'No build command configured for this project.', error: 'No build command configured.' };
          const res = await this.terminal.executeCommand(cmd, projectRoot, undefined, 60000, 'agent');
          return {
            toolCallId,
            toolName: name,
            success: res.exitCode === 0,
            output: res.stdout + '\n' + res.stderr,
            data: res,
          };
        }

        case 'run_tests': {
          // Language-aware test command selection (§16): prefer the REAL
          // test command of the detected project profile (pytest for Python,
          // cargo test, go test, mvn test, dotnet test, npm test, ...) over a
          // hardcoded npm default. Falls back to package scripts only when
          // the project has no profile test command.
          const targetRoot = context.projectPrefix
            ? path.resolve(root, context.projectPrefix)
            : root;
          let cmd: string | undefined;
          let cwd = targetRoot;
          let profile: ReturnType<typeof LanguageRunnerRegistry.detect> | undefined;
          try {
            profile = LanguageRunnerRegistry.detect(targetRoot);
            if (profile.testCommand && profile.runtimeAvailable) {
              cmd = profile.testCommand;
              if (args.testPath) cmd += ` ${args.testPath}`;
            }
          } catch {
            // detection failure falls through to package scripts
          }
          if (args.testPath && (!/^[\w./\\-]+$/.test(args.testPath) || args.testPath.includes('..'))) {
            return { toolCallId, toolName: name, success: false, output: 'Invalid test path: use a relative filename without shell metacharacters.', error: 'Unsafe test path.' };
          }
          if (!cmd && profile && profile.language !== 'unknown' &&
              !['javascript', 'typescript', 'static-web'].includes(profile.language) &&
              !profile.testCommand) {
            // A detected non-Node project with no test suite: say so honestly
            // instead of blindly running an unrelated npm command.
            return {
              toolCallId,
              toolName: name,
              success: false,
              output: `No test suite is configured for this ${profile.languageLabel} project (${profile.projectType}). Create tests (e.g. a test_*.py file for pytest) or configure a test script, then run run_tests again.`,
              error: 'No test suite configured for this project type',
            };
          }
          if (!cmd) {
            const manifest = readPackageManifest(targetRoot);
            if (manifest?.scripts?.test && !/no test specified/i.test(manifest.scripts.test)) cmd = 'npm test';
            if (!cmd) return { toolCallId, toolName: name, success: false, output: 'No test command configured in this project.', error: 'No test suite configured.' };
            if (args.testPath) cmd += ` -- ${args.testPath}`;
            cwd = targetRoot;
          }
          const res = await this.terminal.executeCommand(cmd, cwd, undefined, 60000, 'agent');
          return {
            toolCallId,
            toolName: name,
            success: res.exitCode === 0,
            output: `Command: ${cmd} (cwd: ${cwd})\nExit Code: ${res.exitCode}\n${res.stdout}\n${res.stderr}`,
            data: res,
          };
        }

        case 'run_linter': {
          const projectRoot = path.resolve(root, context.projectPrefix || '.');
          if (!this.workspace.isWithinWorkspace(projectRoot)) return { toolCallId, toolName: name, success: false, output: 'Project root outside workspace.', error: 'Project root outside workspace.' };
          let cmd: string | undefined;
          const manifest = readPackageManifest(projectRoot);
          if (manifest?.scripts?.lint) cmd = 'npm run lint';
          if (!cmd && fs.existsSync(path.join(projectRoot, 'tsconfig.json'))) cmd = 'npx --no-install tsc --noEmit';
          if (!cmd) return { toolCallId, toolName: name, success: false, output: 'No linter configured for this project.', error: 'No linter configured.' };
          const res = await this.terminal.executeCommand(cmd, projectRoot, undefined, 60000, 'agent');
          return {
            toolCallId,
            toolName: name,
            success: res.exitCode === 0,
            output: res.stdout + '\n' + res.stderr,
            data: res,
          };
        }

        case 'project_health_check': {
          const projectRoot = path.resolve(root, context.projectPrefix || '.');
          if (!this.workspace.isWithinWorkspace(projectRoot)) return { toolCallId, toolName: name, success: false, output: 'Project root outside workspace.', error: 'Project root outside workspace.' };
          const profile = LanguageRunnerRegistry.detect(projectRoot);
          const checks: Array<{ label: string; command: string }> = [];
          const seen = new Set<string>();
          const addCheck = (label: string, command: string | undefined) => {
            const normalized = command?.trim();
            if (!normalized || seen.has(normalized)) return;
            seen.add(normalized);
            checks.push({ label, command: normalized });
          };
          let manifest: any | undefined;
          const packagePath = path.join(projectRoot, 'package.json');
          if (fs.existsSync(packagePath)) {
            try {
              manifest = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
            } catch (error: any) {
              return { toolCallId, toolName: name, success: false, output: `Configuration Check: FAILED — invalid package.json (${String(error?.message || error).slice(0, 400)})`, error: 'Invalid package.json.' };
            }
          }
          const scripts = manifest?.scripts || {};
          const testScript = typeof scripts.test === 'string' && !/no test specified/i.test(scripts.test) ? 'npm test' : undefined;
          const buildScript = typeof scripts.build === 'string' ? 'npm run build' : undefined;
          const lintScript = typeof scripts.lint === 'string' ? 'npm run lint' : undefined;

          // Prefer explicit project scripts, but retain language adapters for
          // Python, Rust, Go, Java, C/C++ and other non-Node projects.
          if (fs.existsSync(path.join(projectRoot, 'tsconfig.json'))) addCheck('TypeScript', 'npx --no-install tsc --noEmit');
          addCheck('Lint', lintScript);
          addCheck('Build', buildScript || profile.buildCommand);
          addCheck('Tests', testScript || profile.testCommand);

          if (profile.language === 'static-web') {
            const entry = profile.previewEntry || 'index.html';
            if (!fs.existsSync(path.join(projectRoot, entry))) {
              return { toolCallId, toolName: name, success: false, output: `Static web check: FAILED — preview entry ${entry} does not exist.`, error: 'Missing preview entry.' };
            }
            return { toolCallId, toolName: name, success: true, output: `Configuration Check: PASSED\nStatic web check: PASSED — ${entry} exists; no build/test command is configured.`, data: { profile, checks: [] } };
          }
          if (!checks.length) {
            return { toolCallId, toolName: name, success: false, output: `Health check could not find a configured typecheck, linter, build, or test command for ${profile.projectType}. Add a project check before claiming health.`, error: 'No health checks configured.' };
          }

          const results: Array<{ label: string; command: string; exitCode: number; output: string }> = [];
          for (const check of checks) {
            const result = await this.terminal.executeCommand(check.command, projectRoot, undefined, 120000, 'agent');
            results.push({ label: check.label, command: check.command, exitCode: result.exitCode, output: `${result.stdout}\n${result.stderr}`.trim().slice(-5000) });
            if (result.exitCode !== 0) break;
          }
          const passed = results.every(result => result.exitCode === 0) && results.length === checks.length;
          const output = results.map(result => `${result.label}: ${result.exitCode === 0 ? 'PASSED' : 'FAILED'}\n$ ${result.command}\n${result.output}`).join('\n\n');
          return { toolCallId, toolName: name, success: passed, output: `Project Health: ${passed ? 'PASSED' : 'FAILED'}\n${output}`, data: { profile, checks: results } };
        }

        // --- GIT TOOLS ---
        case 'git_status': {
          const status = await this.git.getStatus(root);
          return {
            toolCallId,
            toolName: name,
            success: true,
            output: status.raw || '(Working tree clean)',
            data: status,
          };
        }

        case 'git_log': {
          const log = await this.git.getLog(root, args.limit || 10);
          const formatted = log.map((l) => `${l.hash} - ${l.message} (${l.author}, ${l.date})`).join('\n');
          return {
            toolCallId,
            toolName: name,
            success: true,
            output: formatted || 'No git commits found',
            data: log,
          };
        }

        case 'git_branch': {
          const branch = await this.git.getBranch(root);
          return {
            toolCallId,
            toolName: name,
            success: true,
            output: `Current branch: ${branch}`,
            data: { branch },
          };
        }

        case 'git_add': {
          const res = await this.git.add(root, args.filePath || '.');
          return {
            toolCallId,
            toolName: name,
            success: res.success,
            output: res.output || 'Staged changes successfully',
          };
        }

        case 'git_commit': {
          if (typeof args.message !== 'string' || !args.message.trim()) {
            return { toolCallId, toolName: name, success: false, output: 'Invalid commit message: expected a non-empty string.', error: 'Invalid commit message: expected a non-empty string.' };
          }

          // Real authorization enforcement, not just a description.
          if (this.settings.get().gitApproval && !context.preApproved) {
            if (context.requestApproval) {
              const approved = await context.requestApproval({
                kind: 'git',
                title: 'Authorize git commit',
                command: `git commit -m "${args.message}"`,
                reason: 'Committing changes the repository history and requires explicit authorization.',
              });
              if (!approved) {
                return {
                  toolCallId,
                  toolName: name,
                  success: false,
                  output: 'Commit rejected: the user denied authorization.',
                  error: 'Commit rejected: the user denied authorization.',
                };
              }
            } else {
              return {
                toolCallId,
                toolName: name,
                success: false,
                needsApproval: true,
                output: 'Commit not executed: git commits require explicit user authorization.',
                error: 'Commit blocked pending user authorization.',
              };
            }
          }

          const res = await this.git.commit(root, args.message);
          return {
            toolCallId,
            toolName: name,
            success: res.success,
            output: res.output || 'Committed changes successfully',
          };
        }

        case 'git_restore': {
          if (typeof args.filePath !== 'string' || !args.filePath.trim()) {
            return { toolCallId, toolName: name, success: false, output: 'Invalid file path for restore.', error: 'Invalid file path for restore.' };
          }

          // Restoring discards uncommitted changes — destructive, enforce approval.
          if (this.settings.get().gitApproval && !context.preApproved) {
            if (context.requestApproval) {
              const approved = await context.requestApproval({
                kind: 'git',
                title: 'Authorize git restore (discard changes)',
                command: `git restore "${args.filePath}"`,
                reason: 'git restore permanently discards uncommitted changes in this file.',
              });
              if (!approved) {
                return {
                  toolCallId,
                  toolName: name,
                  success: false,
                  output: 'Restore rejected: the user denied authorization.',
                  error: 'Restore rejected: the user denied authorization.',
                };
              }
            } else {
              return {
                toolCallId,
                toolName: name,
                success: false,
                needsApproval: true,
                output: `Restore not executed: discarding changes in ${args.filePath} requires explicit user authorization.`,
                error: 'Restore blocked pending user authorization.',
              };
            }
          }

          const res = await this.git.restore(root, args.filePath);
          return {
            toolCallId,
            toolName: name,
            success: res.success,
            output: res.output || `Restored ${args.filePath}`,
          };
        }

        default:
          return {
            toolCallId,
            toolName: name,
            success: false,
            output: `Unknown tool: ${name}`,
            error: `Unknown tool: ${name}`,
          };
      }
    } catch (err: any) {
      return {
        toolCallId,
        toolName: name,
        success: false,
        output: `Tool execution failed: ${err.message}`,
        error: err.message,
      };
    }
  }
}
