import fs from 'fs';
import path from 'path';
import { randomUUID } from 'node:crypto';
import type { FileNode, SearchMatch } from '../shared/types.js';
import { redactSensitiveText } from '../shared/secretRedaction.js';
import { MAX_FILE_BYTES, fileSizeLimitError } from '../shared/largeFile.js';
import { assertWorkspaceWritable } from './workspaceLock.js';

// ---------------------------------------------------------------------------
// Hardening constants
// ---------------------------------------------------------------------------

const MAX_PATH_LENGTH = 4096;
const MAX_SEARCH_PATTERN_LENGTH = 256;
const MAX_SEARCH_RESULTS = 500;
const SEARCH_TIMEOUT_MS = 10000;
const DANGEROUS_PATH_PATTERNS = [
  /\.\./,              // path traversal
  /[\x00-\x1f\x7f]/,  // control characters
  /\|/,                // pipe
  /;/,                 // semicolon
  /&/,                 // ampersand
  /\$\(/,              // command substitution
  />\s*\//,            // redirect to root
];

function sanitizePath(input: string, maxLength: number): string {
  if (typeof input !== 'string') return '';
  const sanitized = input.replace(/[\x00-\x1f\x7f]/g, '').trim();
  return sanitized.length > maxLength ? sanitized.slice(0, maxLength) : sanitized;
}

function validatePath(input: string, maxLength: number): void {
  if (input.length > maxLength) {
    throw new Error(`Path exceeds maximum length of ${maxLength} characters.`);
  }
  for (const pattern of DANGEROUS_PATH_PATTERNS) {
    if (pattern.test(input)) {
      throw new Error('Path contains disallowed patterns.');
    }
  }
}

export class WorkspaceManager {
  private workspaceRoot: string;

  constructor(initialPath: string = process.cwd()) {
    const sanitized = sanitizePath(initialPath, MAX_PATH_LENGTH);
    validatePath(sanitized, MAX_PATH_LENGTH);
    this.workspaceRoot = fs.realpathSync(path.resolve(sanitized));
  }

  public getRoot(): string {
    return this.workspaceRoot;
  }

  /**
   * M9.6: refuse to mutate the workspace while another live NUVRO AI instance
   * owns it. The owning instance itself is always allowed, and a lock whose
   * owner crashed is ignored so the workspace recovers automatically.
   */
  private guardExclusiveWrite(): { success: boolean; error?: string } | null {
    const guard = assertWorkspaceWritable(this.workspaceRoot);
    if (guard.ok) return null;
    return { success: false, error: guard.error };
  }

  /**
   * REAL file metadata straight from the filesystem (§4): absolute path,
   * size, timestamps, type. Never fabricated.
   */
  public getMetadata(relativePath: string): {
    success: boolean;
    meta?: {
      absolutePath: string;
      relativePath: string;
      name: string;
      extension: string;
      sizeBytes: number;
      created: string;
      modified: string;
      accessed: string;
      isDirectory: boolean;
      isFile: boolean;
    };
    error?: string;
  } {
    const sanitized = sanitizePath(relativePath, MAX_PATH_LENGTH);
    if (sanitized !== relativePath) return { success: false, error: 'Relative path contains invalid characters.' };
    const check = this.resolveSafePath(sanitized);
    if (!check.safe) return { success: false, error: check.error };
    try {
      const stat = fs.statSync(check.fullPath);
      return {
        success: true,
        meta: {
          absolutePath: check.fullPath,
          relativePath,
          name: path.basename(check.fullPath),
          extension: path.extname(check.fullPath),
          sizeBytes: stat.size,
          created: new Date(stat.ctimeMs).toISOString(),
          modified: new Date(stat.mtimeMs).toISOString(),
          accessed: new Date(stat.atimeMs).toISOString(),
          isDirectory: stat.isDirectory(),
          isFile: stat.isFile(),
        },
      };
    } catch (err: any) {
      return { success: false, error: `File not found or not accessible: ${relativePath} (${err.message})` };
    }
  }

  /**
   * REAL recursive project-structure tree (§4): an actual fs walk, pruned of
   * build artifacts, rendered as an ASCII tree with file counts.
   */
  public getProjectStructure(relativePath = '.', maxDepth = 6): {
    success: boolean;
    tree?: string;
    fileCount?: number;
    directoryCount?: number;
    error?: string;
  } {
    const check = this.resolveSafePath(relativePath);
    if (!check.safe) return { success: false, error: check.error };
    if (!fs.existsSync(check.fullPath)) return { success: false, error: `Directory does not exist: ${relativePath}` };
    if (!fs.statSync(check.fullPath).isDirectory()) {
      return { success: false, error: `Not a directory: ${relativePath}` };
    }

    const SKIP = new Set(['node_modules', '.git', '__pycache__', 'dist', 'build', 'target', '.quillix', 'venv', '.venv', '.next', 'coverage']);
    let fileCount = 0;
    let directoryCount = 0;
    const lines: string[] = [relativePath === '.' ? path.basename(check.fullPath) || '.' : relativePath];

    const walk = (dir: string, depth: number, prefix: string) => {
      if (depth > maxDepth || lines.length > 400) return;
      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      const visible = entries
        .filter((e) => !SKIP.has(e.name))
        .sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1));
      visible.forEach((e, i) => {
        const last = i === visible.length - 1;
        lines.push(`${prefix}${last ? '└── ' : '├── '}${e.name}${e.isDirectory() ? '/' : ''}`);
        if (e.isDirectory()) {
          directoryCount++;
          walk(path.join(dir, e.name), depth + 1, `${prefix}${last ? '    ' : '│   '}`);
        } else {
          fileCount++;
        }
      });
    };

    walk(check.fullPath, 0, '');
    return { success: true, tree: lines.join('\n'), fileCount, directoryCount };
  }

  public setRoot(newPath: string): { success: boolean; path: string; error?: string } {
    try {
      const resolved = path.resolve(newPath);
      if (!fs.existsSync(resolved)) {
        return { success: false, path: this.workspaceRoot, error: `Directory does not exist: ${resolved}` };
      }
      const stat = fs.statSync(resolved);
      if (!stat.isDirectory()) {
        return { success: false, path: this.workspaceRoot, error: `Path is not a directory: ${resolved}` };
      }
      this.workspaceRoot = resolved;
      return { success: true, path: this.workspaceRoot };
    } catch (err: any) {
      return { success: false, path: this.workspaceRoot, error: err.message };
    }
  }

  /**
   * Creates a directory (and parents) inside the workspace. Idempotent:
   * succeeds when the directory already exists.
   */
  public createDirectory(relativePath: string): { success: boolean; path?: string; error?: string } {
    const check = this.resolveSafePath(relativePath);
    if (!check.safe) return { success: false, error: check.error };
    try {
      fs.mkdirSync(check.fullPath, { recursive: true });
      return { success: true, path: relativePath };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  /** Public check used by routes (e.g. the preview server) to keep secrets out. */
  public static isSecretPath(relativePath: string): boolean {
    return WorkspaceManager.isProtectedSecretFile(relativePath);
  }

  /**
   * Files whose contents must never be exposed to the model or UI.
   * Reading them returns a clear refusal instead of the secrets inside.
   */
  private static isProtectedSecretFile(relativePath: string): boolean {
    const base = path.basename(relativePath).toLowerCase();
    if (
      base === '.env' ||
      base.startsWith('.env.') ||
      base === 'id_rsa' ||
      base === 'id_ed25519' ||
      base === 'id_ecdsa' ||
      base === '.npmrc' ||
      base === '.netrc' ||
      base === 'credentials.json' ||
      base === 'secrets.json' ||
      base === 'secrets.yaml' ||
      base === 'secrets.yml' ||
      base.endsWith('.pem') ||
      base.endsWith('.key') ||
      base.endsWith('.pfx') ||
      base.endsWith('.p12')
    ) {
      return true;
    }
    // Common secret-named subpaths
    const normalized = relativePath.replace(/\\/g, '/').toLowerCase();
    return /(^|\/)(secrets?|credentials)\.(json|ya?ml|toml|ini|txt)$/.test(normalized);
  }

  /**
   * Resolves a target relative path and ensures it stays strictly within the workspace root.
   * Blocks path traversal (../), absolute paths outside the root, and symlink escapes.
   */
  public resolveSafePath(relativePath: string): { safe: boolean; fullPath: string; error?: string } {
    try {
      // Absolute-looking paths (POSIX or Windows drive letters) are only allowed
      // when they resolve to a location inside the active workspace.
      const isAbsoluteStyle = /^[/\\]/.test(relativePath) || /^[A-Za-z]:[\\/]/.test(relativePath);
      if (isAbsoluteStyle) {
        const resolvedAbs = path.resolve(relativePath);
        const relAbs = path.relative(this.workspaceRoot, resolvedAbs);
        if (relAbs !== '' && (relAbs.startsWith('..') || path.isAbsolute(relAbs))) {
          return {
            safe: false,
            fullPath: resolvedAbs,
            error: `Operation blocked: path is outside the active workspace. ('${relativePath}' resolves to '${resolvedAbs}', outside '${this.workspaceRoot}')`,
          };
        }
        // Absolute path INSIDE the workspace: use it as resolved, so it is
        // never re-interpreted as a relative path (which would double it).
        if (!this.isWithinWorkspace(resolvedAbs)) {
          return { safe: false, fullPath: resolvedAbs, error: 'Operation blocked: path is outside the active workspace (symlink).' };
        }
        return { safe: true, fullPath: resolvedAbs };
      }

      // Normalize slashes
      const cleanRel = relativePath.replace(/^[/\\]+/, '');
      const fullPath = path.resolve(this.workspaceRoot, cleanRel);

      // Logical boundary check
      const relative = path.relative(this.workspaceRoot, fullPath);
      const isInside = relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));

      if (!isInside) {
        return {
          safe: false,
          fullPath,
          error: `Operation blocked: path is outside the active workspace. ('${relativePath}' escapes '${this.workspaceRoot}')`,
        };
      }

      // Symlink escape check: compare the real path of the deepest existing ancestor
      // against the real path of the workspace root.
      const rootReal = fs.realpathSync(this.workspaceRoot);
      let probe = fullPath;
      while (!fs.existsSync(probe)) {
        const parent = path.dirname(probe);
        if (parent === probe) break; // reached filesystem root
        probe = parent;
      }
      if (fs.existsSync(probe)) {
        const probeReal = fs.realpathSync(probe);
        const normalizedRootReal = rootReal.replace(/\\/g, '/');
        const normalizedProbeReal = probeReal.replace(/\\/g, '/');
        const insideReal = normalizedProbeReal === normalizedRootReal || normalizedProbeReal.startsWith(normalizedRootReal + '/');
        if (!insideReal) {
          return {
            safe: false,
            fullPath,
            error: `Operation blocked: path is outside the active workspace. ('${relativePath}' resolves outside '${this.workspaceRoot}' via a symlink.)`,
          };
        }
      }

      return { safe: true, fullPath };
    } catch (err: any) {
      return { safe: false, fullPath: '', error: err.message };
    }
  }

  /**
   * Returns true when an absolute candidate path (e.g. a terminal cwd) lies
   * within the active workspace, including symlink resolution.
   */
  public isWithinWorkspace(candidatePath: string): boolean {
    try {
      const resolved = path.resolve(candidatePath);
      const rel = path.relative(this.workspaceRoot, resolved);
      if (rel !== '' && (rel.startsWith('..') || path.isAbsolute(rel))) return false;

      const rootReal = fs.realpathSync(this.workspaceRoot);
      let probe = resolved;
      while (!fs.existsSync(probe)) {
        const parent = path.dirname(probe);
        if (parent === probe) break;
        probe = parent;
      }
      if (!fs.existsSync(probe)) return false;
      const probeReal = fs.realpathSync(probe);
      const normalizedRootReal = rootReal.replace(/\\/g, '/');
      const normalizedProbeReal = probeReal.replace(/\\/g, '/');
      return normalizedProbeReal === normalizedRootReal || normalizedProbeReal.startsWith(normalizedRootReal + '/');
    } catch {
      return false;
    }
  }

  /**
   * Redacts common secret patterns (API keys, private keys, passwords)
   */
  public redactSecrets(content: string): string {
    return redactSensitiveText(content);
  }

  /**
   * Generates a recursive directory tree
   */
  public getFileTree(maxDepth = 5): FileNode {
    const buildTree = (dirPath: string, currentDepth: number): FileNode => {
      const name = path.basename(dirPath) || 'workspace';
      const relPath = path.relative(this.workspaceRoot, dirPath) || '.';
      const node: FileNode = {
        name,
        path: relPath.replace(/\\/g, '/'),
        fullPath: dirPath,
        isDirectory: true,
        children: [],
      };

      if (currentDepth > maxDepth) return node;

      try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });

        // Sort: directories first, then files alphabetically
        const sorted = entries.sort((a, b) => {
          if (a.isDirectory() && !b.isDirectory()) return -1;
          if (!a.isDirectory() && b.isDirectory()) return 1;
          return a.name.localeCompare(b.name);
        });

        for (const entry of sorted) {
          // Ignore heavy/system directories
          if (
            entry.name === 'node_modules' ||
            entry.name === '.git' ||
            entry.name === 'dist' ||
            entry.name === '.next' ||
            entry.name === '.vscode' ||
            entry.name === '.idea' ||
            entry.name === 'build' ||
            entry.name.endsWith('.log')
          ) {
            continue;
          }

          const entryFullPath = path.join(dirPath, entry.name);
          const entryRelPath = path.relative(this.workspaceRoot, entryFullPath).replace(/\\/g, '/');

          if (entry.isDirectory()) {
            node.children?.push(buildTree(entryFullPath, currentDepth + 1));
          } else {
            let size = 0;
            try {
              const stat = fs.statSync(entryFullPath);
              size = stat.size;
            } catch {
              // ignore
            }
            node.children?.push({
              name: entry.name,
              path: entryRelPath,
              fullPath: entryFullPath,
              isDirectory: false,
              size,
            });
          }
        }
      } catch (err) {
        console.error('Error reading dir:', dirPath, err);
      }

      return node;
    };

    return buildTree(this.workspaceRoot, 0);
  }

  public readFile(relativePath: string): { success: boolean; content?: string; size?: number; error?: string } {
    const check = this.resolveSafePath(relativePath);
    if (!check.safe) return { success: false, error: check.error };

    try {
      const exists = fs.existsSync(check.fullPath);
      const resolved = exists ? fs.realpathSync(check.fullPath) : check.fullPath;
      if (WorkspaceManager.isProtectedSecretFile(relativePath) || WorkspaceManager.isProtectedSecretFile(resolved)) {
        return { success: false, error: `Protected file: "${relativePath}" may contain secrets and cannot be read by the AI. NUVRO AI never exposes secrets in the model context.` };
      }
      if (!exists) {
        return { success: false, error: `File not found: ${relativePath}` };
      }
      const realRelative = path.relative(fs.realpathSync(this.workspaceRoot), resolved);
      if (realRelative === '..' || realRelative.startsWith(`..${path.sep}`) || path.isAbsolute(realRelative)) {
        return { success: false, error: 'Operation blocked: path is outside the active workspace (symlink).' };
      }
      const stat = fs.statSync(resolved);
      if (stat.isDirectory()) {
        return { success: false, error: `Path is a directory, not a file: ${relativePath}` };
      }
      if (stat.size > MAX_FILE_BYTES) {
        return { success: false, error: fileSizeLimitError(stat.size) };
      }
      const content = fs.readFileSync(resolved, 'utf8');
      return { success: true, content, size: stat.size };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  /**
   * READ-BACK VERIFICATION (§4): after any write, confirm the file exists,
   * has a non-zero size (when content was non-empty), and that the bytes on
   * disk match exactly what was requested. The filesystem — not the AI's
   * textual response — is the source of truth.
   */
  private verifyWriteback(fullPath: string, expected: string): { ok: boolean; sizeBytes: number; error?: string } {
    try {
      const stat = fs.statSync(fullPath);
      if (!stat.isFile()) {
        return { ok: false, sizeBytes: 0, error: 'Write verification failed: the target is not a regular file on disk.' };
      }
      if (expected.length > 0 && stat.size <= 0) {
        return { ok: false, sizeBytes: 0, error: 'Write verification failed: the file is EMPTY on disk (0 bytes).' };
      }
      const readBack = fs.readFileSync(fullPath, 'utf8');
      if (readBack !== expected) {
        return { ok: false, sizeBytes: stat.size, error: 'Write verification failed: the content read back from disk differs from what was written.' };
      }
      return { ok: true, sizeBytes: stat.size };
    } catch (err: any) {
      return { ok: false, sizeBytes: 0, error: `Write verification failed: ${err.message}` };
    }
  }

  /** Crash-safe staged writes with a unique, cleaned-up temporary file.
   *  A new file uses an exclusive hard link, preventing a concurrent creator
   *  from being overwritten between the existence check and installation.
   */
  private atomicWrite(fullPath: string, content: string, createOnly = false): void {
    const tmp = `${fullPath}.quillix-tmp-${process.pid}-${randomUUID()}`;
    let fd: number | undefined;
    try {
      fd = fs.openSync(tmp, 'wx', 0o600);
      fs.writeFileSync(fd, content, { encoding: 'utf8' });
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = undefined;
      if (createOnly) {
        // linkSync is atomic and fails if the target already exists.
        try {
          fs.linkSync(tmp, fullPath);
        } catch (error: any) {
          // Windows sandboxed filesystems can reject hard links even when the
          // target is new. Preserve create-only semantics with an existence
          // check immediately before the fallback write.
          if (!['EPERM', 'EACCES', 'EXDEV'].includes(error?.code)) throw error;
          if (fs.existsSync(fullPath)) {
            const exists = new Error('The target file already exists.') as NodeJS.ErrnoException;
            exists.code = 'EEXIST';
            throw exists;
          }
          fs.writeFileSync(fullPath, content, { encoding: 'utf8', flag: 'wx' });
          try { fs.unlinkSync(tmp); } catch (cleanup: any) {
            if (cleanup?.code !== 'ENOENT') throw cleanup;
          }
        }
      } else {
        try {
          fs.renameSync(tmp, fullPath);
        } catch (error: any) {
          // Some Windows sandboxed/temp filesystems reject replacing a file
          // with rename even when both paths are on the same volume. Keep the
          // staged-write path, but fall back to a direct write so local agent
          // runs do not fail before verification can begin.
          if (!['EPERM', 'EACCES', 'EXDEV'].includes(error?.code)) throw error;
          fs.writeFileSync(fullPath, content, { encoding: 'utf8' });
          try { fs.unlinkSync(tmp); } catch (cleanup: any) {
            if (cleanup?.code !== 'ENOENT') throw cleanup;
          }
        }
      }
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      try { fs.unlinkSync(tmp); } catch (error: any) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }
  }

  public writeFile(relativePath: string, content: string): { success: boolean; error?: string; verified?: boolean; sizeBytes?: number } {
    const check = this.resolveSafePath(relativePath);
    if (!check.safe) return { success: false, error: check.error };
    const blocked = this.guardExclusiveWrite();
    if (blocked) return blocked;
    // M9.5: refuse oversized writes before touching the disk, with the same
    // honest limit the read path enforces.
    if (Buffer.byteLength(content || '', 'utf8') > MAX_FILE_BYTES) {
      return { success: false, error: fileSizeLimitError(Buffer.byteLength(content || '', 'utf8')) };
    }
    try {
      const parentDir = path.dirname(check.fullPath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }
      this.atomicWrite(check.fullPath, content);
      // Real read-back verification — never claim success from the write call alone.
      const verification = this.verifyWriteback(check.fullPath, content);
      if (!verification.ok) {
        return { success: false, error: verification.error, verified: false, sizeBytes: verification.sizeBytes };
      }
      return { success: true, verified: true, sizeBytes: verification.sizeBytes };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  public createFile(relativePath: string, content = ''): { success: boolean; error?: string; verified?: boolean; sizeBytes?: number } {
    const check = this.resolveSafePath(relativePath);
    if (!check.safe) return { success: false, error: check.error };
    const blocked = this.guardExclusiveWrite();
    if (blocked) return blocked;
    // M9.5: same oversized-write refusal as writeFile.
    if (Buffer.byteLength(content || '', 'utf8') > MAX_FILE_BYTES) {
      return { success: false, error: fileSizeLimitError(Buffer.byteLength(content || '', 'utf8')) };
    }

    try {
      if (fs.existsSync(check.fullPath)) {
        return { success: false, error: `File already exists: ${relativePath}` };
      }
      const parentDir = path.dirname(check.fullPath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }
      this.atomicWrite(check.fullPath, content, true);
      // Real read-back verification.
      const verification = this.verifyWriteback(check.fullPath, content);
      if (!verification.ok) {
        return { success: false, error: verification.error, verified: false, sizeBytes: verification.sizeBytes };
      }
      return { success: true, verified: true, sizeBytes: verification.sizeBytes };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  public deleteFile(relativePath: string): { success: boolean; error?: string } {
    const check = this.resolveSafePath(relativePath);
    if (!check.safe) return { success: false, error: check.error };
    const blocked = this.guardExclusiveWrite();
    if (blocked) return blocked;
    if (path.relative(this.workspaceRoot, check.fullPath) === '') return { success: false, error: 'Cannot delete the active workspace root.' };

    try {
      if (!fs.existsSync(check.fullPath)) {
        return { success: false, error: `File or folder does not exist: ${relativePath}` };
      }
      const stat = fs.statSync(check.fullPath);
      if (stat.isDirectory()) {
        fs.rmSync(check.fullPath, { recursive: true, force: true });
      } else {
        fs.unlinkSync(check.fullPath);
      }
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  public renameFile(oldRelativePath: string, newRelativePath: string): { success: boolean; error?: string } {
    const oldCheck = this.resolveSafePath(oldRelativePath);
    const newCheck = this.resolveSafePath(newRelativePath);

    if (!oldCheck.safe) return { success: false, error: oldCheck.error };
    if (!newCheck.safe) return { success: false, error: newCheck.error };
    const blocked = this.guardExclusiveWrite();
    if (blocked) return blocked;

    try {
      if (!fs.existsSync(oldCheck.fullPath)) {
        return { success: false, error: `Source path does not exist: ${oldRelativePath}` };
      }
      if (fs.existsSync(newCheck.fullPath)) {
        return { success: false, error: `Target path already exists: ${newRelativePath}` };
      }
      const parentDir = path.dirname(newCheck.fullPath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }
      fs.renameSync(oldCheck.fullPath, newCheck.fullPath);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  public listDirectory(relativePath = '.'): { success: boolean; files?: Array<{ name: string; isDirectory: boolean; size: number }>; error?: string } {
    const check = this.resolveSafePath(relativePath);
    if (!check.safe) return { success: false, error: check.error };

    try {
      if (!fs.existsSync(check.fullPath)) {
        return { success: false, error: `Directory does not exist: ${relativePath}` };
      }
      const entries = fs.readdirSync(check.fullPath, { withFileTypes: true });
      const files = entries.map((entry) => {
        let size = 0;
        try {
          if (!entry.isDirectory()) {
            size = fs.statSync(path.join(check.fullPath, entry.name)).size;
          }
        } catch {
          // ignore
        }
        return {
          name: entry.name,
          isDirectory: entry.isDirectory(),
          size,
        };
      });
      return { success: true, files };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Search across workspace files
   */
  public searchFiles(query: string, options: { caseSensitive?: boolean; wholeWord?: boolean; isRegex?: boolean } = {}): {
    success: boolean;
    matches: SearchMatch[];
    error?: string;
  } {
    const matches: SearchMatch[] = [];
    if (typeof query !== 'string' || !query.trim() || query.length > 256) {
      return { success: false, matches, error: 'Search query must contain 1–256 characters.' };
    }
    try {
      let pattern = options.isRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (options.wholeWord) pattern = `\\b${pattern}\\b`;
      const regex = new RegExp(pattern, options.caseSensitive ? 'g' : 'gi');
      const SKIP = new Set(['node_modules', '.git', '.quillix', 'dist', 'build', '.next', '.venv', 'venv', 'coverage', '__pycache__']);
      const EXT_SKIP = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.zip', '.exe', '.dll', '.woff', '.woff2', '.mp4', '.mp3']);
      let filesVisited = 0;
      let bytesVisited = 0;
      const walk = (dir: string): void => {
        if (matches.length >= 100 || filesVisited >= 10000 || bytesVisited >= 32 * 1024 * 1024) return;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (matches.length >= 100 || filesVisited >= 10000 || bytesVisited >= 32 * 1024 * 1024) break;
          if (entry.isSymbolicLink() || SKIP.has(entry.name)) continue;
          const fullPath = path.join(dir, entry.name);
          const relPath = path.relative(this.workspaceRoot, fullPath).replace(/\\/g, '/');
          if (entry.isDirectory()) {
            walk(fullPath);
            continue;
          }
          if (!entry.isFile() || WorkspaceManager.isSecretPath(relPath) || EXT_SKIP.has(path.extname(entry.name).toLowerCase())) continue;
          try {
            const size = fs.statSync(fullPath).size;
            if (size > 2 * 1024 * 1024) continue;
            filesVisited++;
            bytesVisited += size;
            const content = fs.readFileSync(fullPath, 'utf8');
            if (content.includes('\0')) continue; // likely binary, not text
            for (const [i, line] of content.split('\n').entries()) {
              regex.lastIndex = 0;
              let match: RegExpExecArray | null;
              while ((match = regex.exec(line)) !== null) {
                matches.push({
                  filePath: relPath,
                  lineNumber: i + 1,
                  lineContent: line.trim().slice(0, 500),
                  matchStart: match.index,
                  matchEnd: match.index + match[0].length,
                });
                if (matches.length >= 100) return;
                // Zero-width regular expressions must advance explicitly.
                if (match[0].length === 0) regex.lastIndex = match.index + 1;
              }
            }
          } catch { /* unreadable file, continue */ }
        }
      };
      walk(this.workspaceRoot);
      return { success: true, matches };
    } catch (err: any) {
      return { success: false, matches: [], error: err.message };
    }
  }

  /**
   * Symbol locator across files (classes, interfaces, functions, consts)
   */
  public findSymbols(symbolQuery: string): { success: boolean; symbols: Array<{ name: string; kind: string; filePath: string; line: number }>; error?: string } {
    const results: Array<{ name: string; kind: string; filePath: string; line: number }> = [];
    try {
      const searchRes = this.searchFiles(symbolQuery);
      if (!searchRes.success) return { success: false, symbols: [], error: searchRes.error };

      for (const match of searchRes.matches) {
        let kind = 'symbol';
        if (/\b(?:function|def|fn)\b/.test(match.lineContent)) kind = 'function';
        else if (/\b(?:class|struct)\b/.test(match.lineContent)) kind = 'class';
        else if (/\b(?:interface|type)\b/.test(match.lineContent)) kind = 'type';
        else if (/\b(?:const|let|var)\b/.test(match.lineContent)) kind = 'variable';

        results.push({
          name: symbolQuery,
          kind,
          filePath: match.filePath,
          line: match.lineNumber,
        });
      }
      return { success: true, symbols: results };
    } catch (err: any) {
      return { success: false, symbols: [], error: err.message };
    }
  }

  /**
   * Definition-aware navigation for the coding agent. The general symbol
   * search above is intentionally broad; these two methods distinguish a
   * declaration from a call/reference so an edit can be anchored to the
   * implementation instead of the first textual occurrence.
   */
  public findDefinitions(symbolQuery: string): { success: boolean; symbols: Array<{ name: string; kind: string; filePath: string; line: number }>; error?: string } {
    return this.findSymbolLocations(symbolQuery, 'definition');
  }

  public findReferences(symbolQuery: string): { success: boolean; symbols: Array<{ name: string; kind: string; filePath: string; line: number }>; error?: string } {
    return this.findSymbolLocations(symbolQuery, 'reference');
  }

  private findSymbolLocations(symbolQuery: string, mode: 'definition' | 'reference') {
    const query = typeof symbolQuery === 'string' ? symbolQuery.trim() : '';
    if (!query || !/^[\p{L}_$][\p{L}\p{N}_$]*$/u.test(query)) {
      return { success: false, symbols: [], error: 'Identifier must be a non-empty language identifier.' };
    }
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const definitionPattern = new RegExp([
      `\\b(?:function|class|interface|type|enum|struct|trait|def|fn|func|namespace|module)\\s+${escaped}\\b`,
      `\\b(?:const|let|var|val)\\s+${escaped}\\b`,
      `\\b(?:module\\.exports|exports)\\.${escaped}\\b`,
      `(?:^|[;,{]\\s*)(?:export\\s+)?${escaped}\\s*[:=]\\s*`,
    ].join('|'), 'i');
    try {
      const search = this.searchFiles(query, { wholeWord: true });
      if (!search.success) return { success: false, symbols: [], error: search.error };
      const symbols = search.matches
        .filter(match => mode === 'definition' ? definitionPattern.test(match.lineContent) : !definitionPattern.test(match.lineContent))
        .map(match => ({ name: query, kind: mode, filePath: match.filePath, line: match.lineNumber }))
        .slice(0, 100);
      return { success: true, symbols };
    } catch (err: any) {
      return { success: false, symbols: [], error: err.message };
    }
  }
}
