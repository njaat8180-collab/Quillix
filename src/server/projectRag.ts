import fs from 'node:fs';
import path from 'node:path';
import { redactSensitiveText } from '../shared/secretRedaction.js';

type RagChunk = { file: string; start: number; content: string; terms: string[]; symbols: string[]; references: string[] };
const RAG_INDEX_VERSION = 7;
type RagIndex = {
  version: typeof RAG_INDEX_VERSION;
  files: Record<string, { mtimeMs: number; ctimeMs: number; size: number; chunkCount: number }>;
  chunks: RagChunk[];
};

const MAX_FILES = 420;
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_CHUNKS = 900;
const MAX_SELECTED_FILE_BYTES = 1_000_000;
const CHUNK_SIZE = 1400;
const OVERLAP = 160;
const SKIP_DIRS = new Set([
  '.git', '.quillix', 'node_modules', 'dist', '.qa-dist', 'build', 'release',
  '.cache', '.vite', '.next', '.turbo', '.parcel-cache', '.svelte-kit', '.nuxt', '.pytest_cache',
  '.quillix-smoke', 'benchmark-results', '__pycache__', 'target', 'coverage',
  '.venv', 'venv', 'vendor', 'bin', 'obj', 'out', '.idea', '.tox', '.gradle',
  '.mypy_cache', '.ruff_cache', '.bundle', 'pods',
]);
const PROTECTED_SELECTED_DIRS = new Set(['.git', '.quillix']);
const SECRET_NAMES = /^(?:\.env(?:\..*)?|.*\.(?:pem|key|p12|pfx|der|crt))$/i;
const EPHEMERAL_WORKSPACE_DIR = /^qx-[a-z0-9]{6}$/i;
const TEXT_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rs', '.java', '.cs', '.cpp', '.c', '.h', '.html', '.htm', '.css', '.scss', '.vue', '.svelte', '.json', '.jsonc', '.yaml', '.yml', '.toml', '.md', '.txt', '.sql', '.sh', '.ps1']);
const STOP = new Set(('the and for with this that from into your project files file code create update fix make use using should can will are was have has not only then than ' +
  'का की के को में से पर और यह इस इसे उससे तथा नहीं कर करो करें करना हुआ हुई होते है हैं था थी होगा होगी आप हम वो जो अगर फिर एक').split(/\s+/));

const terms = (value: string): string[] => [...new Set(
  (value.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().match(/[\p{L}\p{M}\p{N}_]{2,}/gu) || [])
    .filter(word => !STOP.has(word))
)].slice(0, 48);

const symbols = (value: string): string[] => [...new Set(
  [...value.matchAll(/\b(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|class|interface|type|const|let|var|def|fn|struct|enum)\s+([A-Za-z_$][\w$]*)/g)].map(match => match[1])
)].slice(0, 32);

const references = (value: string): string[] => [...new Set([
  ...[...value.matchAll(/\b(?:from|import|require|include|use)\s*[('\"`]?([A-Za-z0-9_./@-]{3,})/g)].map(match => match[1]),
  ...[...value.matchAll(/\b(?:src|href)\s*=\s*['\"]([^'\"]+)['\"]/gi)].map(match => match[1]),
  ...[...value.matchAll(/@import\s+(?:url\(\s*)?['\"]?([^'\")\s;]+)['\"]?\s*\)?/gi)].map(match => match[1]),
  ...[...value.matchAll(/\burl\(\s*['\"]?([^'\")]+)['\"]?\s*\)/gi)].map(match => match[1]),
].map(reference => reference.trim().replace(/[?#].*$/, '').trim())
  // An empty reference (e.g. href="#") would match EVERY chunk through
  // String.includes('') and corrupt relevance scoring.
  .filter(Boolean))].slice(0, 32);

/** Resolve the small, high-signal subset of local import references that can
 * be used to pull a companion file into the RAG context. This is deliberately
 * conservative: package names and aliases are ignored unless they exactly
 * match a workspace file, so retrieval never invents a dependency. */
function referenceCandidates(ownerFile: string, reference: string): string[] {
  const clean = reference.replace(/\\/g, '/').replace(/^['"`]|['"`]$/g, '');
  if (!clean || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(clean) || clean.startsWith('@')) return [];
  const rootRelative = clean.startsWith('/') && !clean.startsWith('//');
  if (!rootRelative && !clean.startsWith('.') && clean.includes('/')) return [];
  const ownerDir = path.posix.dirname(ownerFile.replace(/\\/g, '/'));
  const base = rootRelative ? path.posix.normalize(clean.slice(1))
    : clean.startsWith('.') ? path.posix.normalize(path.posix.join(ownerDir, clean)) : clean;
  const withoutExt = base.replace(/\.(?:[cm]?[jt]sx?|py|go|rs|java|cs|cpp|c|h|php|rb|css|scss|html?)$/i, '');
  return [withoutExt, `${withoutExt}.js`, `${withoutExt}.ts`, `${withoutExt}.tsx`, `${withoutExt}.jsx`, `${withoutExt}.py`, `${withoutExt}.css`, `${withoutExt}.html`];
}

function isSecret(file: string): boolean {
  const name = path.basename(file);
  const credentialLikeName = /(?:secret|credential|password|apikey|api[_-]?key)/i.test(name);
  const tokenFileName = /^(?:access[_-]?token|refresh[_-]?token|auth[_-]?token|token)(?:\.[^.]+)?$/i.test(name);
  return SECRET_NAMES.test(name) || credentialLikeName || tokenFileName;
}

function safeSelectedFile(root: string, selected?: string, currentFileBase = root): string | undefined {
  if (!selected) return undefined;
  try {
    const absolute = path.resolve(currentFileBase, selected);
    const relative = path.relative(root, absolute).replace(/\\/g, '/');
    if (!relative || relative === '..' || relative.startsWith('../') || path.isAbsolute(relative)) return undefined;
    if (isSecret(relative) || !TEXT_EXTENSIONS.has(path.extname(relative).toLowerCase())) return undefined;
    const realRoot = fs.realpathSync(root);
    const realFile = fs.realpathSync(absolute);
    const realRelative = path.relative(realRoot, realFile).replace(/\\/g, '/');
    if (!realRelative || realRelative === '..' || realRelative.startsWith('../') || path.isAbsolute(realRelative)) return undefined;
    // Explicit selection may override generated-output exclusions (for
    // example, editing dist/index.html), but never expose QUILLIX's private
    // index/state or Git internals through a symlink alias.
    if (realRelative.split('/').some(part => PROTECTED_SELECTED_DIRS.has(part.toLowerCase()))) return undefined;
    if (isSecret(realRelative) || !TEXT_EXTENSIONS.has(path.extname(realRelative).toLowerCase())) return undefined;
    const stat = fs.statSync(realFile);
    if (!stat.isFile() || stat.size > MAX_SELECTED_FILE_BYTES) return undefined;
    return relative;
  } catch { return undefined; }
}

function indexingPriority(entry: fs.Dirent, relativePath: string): number {
  if (entry.isDirectory()) {
    const name = entry.name.toLowerCase();
    const relative = relativePath.toLowerCase();
    if (relative === 'src/server' || relative.startsWith('src/server/')) return 0;
    if (relative === 'src/shared' || relative.startsWith('src/shared/')) return 1;
    if (relative === 'src/components' || relative.startsWith('src/components/')) return 2;
    if (relative === 'src' || relative.startsWith('src/')) return 3;
    if (name === 'src') return 0;
    if (name === 'electron' || name === 'app' || name === 'lib') return 1;
    if (name === 'scripts') return 2;
    if (name === 'test' || name === 'tests' || name === '__tests__') return 3;
    if (name === 'docs' || name === 'documentation') return 5;
    return 4;
  }
  const extension = path.extname(entry.name).toLowerCase();
  if (TEXT_EXTENSIONS.has(extension) && !['.md', '.txt'].includes(extension)) return 1;
  if (['package.json', 'tsconfig.json', 'vite.config.ts', 'pyproject.toml', 'Cargo.toml', 'go.mod'].includes(entry.name.toLowerCase())) return 2;
  return 6;
}

/** Split on nearby line boundaries so indexed declarations/imports stay intact. */
function splitIntoRagChunks(content: string): Array<{ start: number; content: string }> {
  const chunks: Array<{ start: number; content: string }> = [];
  let start = 0;
  while (start < content.length && chunks.length < MAX_CHUNKS) {
    const limit = Math.min(content.length, start + CHUNK_SIZE);
    let end = limit;
    if (limit < content.length) {
      const newline = content.lastIndexOf('\n', limit - 1);
      // Prefer the closest previous line break when it retains most of the
      // chunk budget. A single oversized line is still split at the hard cap.
      if (newline >= start + Math.floor(CHUNK_SIZE * 0.5)) end = newline + 1;
    }
    const piece = content.slice(start, end);
    if (piece.trim()) chunks.push({ start, content: piece });
    if (end >= content.length) break;

    const overlapStart = Math.max(start + 1, end - OVERLAP);
    const lineStart = content.lastIndexOf('\n', overlapStart - 1) + 1;
    const nextStart = lineStart > start && lineStart < end ? lineStart : overlapStart;
    start = Math.max(start + 1, nextStart);
  }
  return chunks;
}

/** Remove RAG excerpts already present verbatim in the primary project
 * context. Keep the RAG header and all excerpts that add new source evidence. */
export function removeDuplicateRagEvidence(ragContext: string, primaryContext: string): string {
  if (!ragContext || !primaryContext) return ragContext;
  const sections = ragContext.split(/(?=\nFILE\s+[^\n]+\n)/);
  if (sections.length < 2) return ragContext;
  const [header, ...evidence] = sections;
  const retained = evidence.filter(section => {
    const bodyStart = section.indexOf('\n', 1);
    if (bodyStart < 0) return true;
    const content = section.slice(bodyStart + 1).trim();
    return !content || !primaryContext.includes(content);
  });
  return retained.length ? `${header}${retained.join('')}` : '';
}

function walk(root: string, current = root, result: string[] = [], budget = { bytes: 0 }): string[] {
  if (result.length >= MAX_FILES || budget.bytes >= MAX_BYTES) return result;
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { return result; }
  for (const entry of entries.sort((a, b) => {
    const relativeA = path.relative(root, path.join(current, a.name)).replace(/\\/g, '/');
    const relativeB = path.relative(root, path.join(current, b.name)).replace(/\\/g, '/');
    return indexingPriority(a, relativeA) - indexingPriority(b, relativeB) || a.name.localeCompare(b.name);
  })) {
    if (result.length >= MAX_FILES || budget.bytes >= MAX_BYTES) break;
    const absolute = path.join(current, entry.name);
    const relative = path.relative(root, absolute).replace(/\\/g, '/');
    // Follow symlinks (a source file linked into the workspace must be
    // indexed) but never walk a symlinked directory out of the workspace.
    const kind = entry.isDirectory() || entry.isFile() ? (entry.isDirectory() ? 'directory' : 'file') : safeEntryKind(root, absolute);
    if (kind === 'directory') {
      if (!SKIP_DIRS.has(entry.name.toLowerCase()) && !isSecret(entry.name) && !EPHEMERAL_WORKSPACE_DIR.test(entry.name)) walk(root, absolute, result, budget);
      continue;
    }
    if (kind !== 'file' || isSecret(relative) || !TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
    try {
      const stat = fs.statSync(absolute);
      if (stat.size > 120_000 || budget.bytes + stat.size > MAX_BYTES) continue;
      result.push(relative); budget.bytes += stat.size;
    } catch { /* file disappeared during indexing */ }
  }
  return result;
}

/** Normalize a caller path into the forward-slash workspace-relative key the
 * index uses. Absolute paths INSIDE the root are accepted (the docstring
 * contract); anything else is passed through so an unknown file invalidates
 * nothing. */
function ragKey(root: string, input: string): string {
  const slashed = String(input || '').replace(/\\/g, '/').trim();
  if (!slashed) return '';
  const relative = path.relative(root, path.resolve(root, slashed)).replace(/\\/g, '/');
  if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) return relative;
  return slashed.replace(/^\/+/, '').split('/').filter(Boolean).join('/');
}

/** Classify a directory entry, following symlinks but never leaving the root. */
function safeEntryKind(root: string, absolute: string): 'directory' | 'file' | 'other' {
  try {
    // Compare against the RESOLVED root: the workspace root itself can be
    // reached through a symlink (macOS /tmp -> /private/tmp, a Windows
    // junction). Comparing the resolved entry against the lexical root would
    // report every symlinked entry as an escape.
    const realRoot = fs.realpathSync(root);
    const real = fs.realpathSync(absolute);
    const relative = path.relative(realRoot, real);
    if (relative.startsWith('..') || path.isAbsolute(relative)) return 'other'; // symlink escapes the workspace
    // Private QUILLIX state and Git internals are never indexed, even when a
    // symlink or directory junction aliases them into the workspace.
    if (relative.split(/[\\/]/).some(part => PROTECTED_SELECTED_DIRS.has(part.toLowerCase()))) return 'other';
    const stat = fs.statSync(real);
    if (stat.isDirectory()) return 'directory';
    if (stat.isFile()) return 'file';
    return 'other';
  } catch { return 'other'; }
}

function loadIndex(file: string): RagIndex | undefined {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as RagIndex;
    if (parsed?.version === RAG_INDEX_VERSION && parsed.files && Array.isArray(parsed.chunks)) return parsed;
  } catch { /* rebuild a corrupt or interrupted index */ }
  return undefined;
}

/** Local lexical project RAG. It is deliberately deterministic and offline. */
export class ProjectRag {
  private root!: string;
  private indexPath!: string;
  private index?: RagIndex;
  /** Observability for incremental indexing (M1.5): what the last refresh did. */
  private lastRefresh = { files: 0, chunks: 0, cachedFiles: 0, reindexedFiles: 0, durationMs: 0 };

  constructor(root: string) { this.rebind(root); }

  public rebind(root: string): void {
    this.root = path.resolve(root);
    this.indexPath = path.join(this.root, '.quillix', 'rag-index.json');
    this.index = undefined;
  }

  private refresh(): RagIndex {
    const startedAt = Date.now();
    const files = walk(this.root);
    // Do not materialize a .quillix cache inside a newly-created but still
    // empty project. A failed/no-tool run must leave the target folder truly
    // empty, and there is nothing useful to retrieve until source exists.
    if (files.length === 0) {
      this.index = { version: RAG_INDEX_VERSION, files: {}, chunks: [] };
      this.lastRefresh = { files: 0, chunks: 0, cachedFiles: 0, reindexedFiles: 0, durationMs: Date.now() - startedAt };
      return this.index;
    }
    const signature: RagIndex['files'] = {};
    if (!this.index) this.index = loadIndex(this.indexPath);
    // A persisted index can be reused after restart when every indexed source
    // file still has the same metadata. Initialize this only after loading it;
    // otherwise each new ProjectRag instance needlessly rereads and rechunks
    // the whole workspace on its first retrieval.
    const unchangedFiles = new Set<string>();
    for (const relative of files) {
      try {
        const stat = fs.statSync(path.join(this.root, relative));
        const indexed = this.index?.files[relative];
        if (indexed?.mtimeMs === stat.mtimeMs && indexed.ctimeMs === stat.ctimeMs && indexed.size === stat.size) {
          unchangedFiles.add(relative);
        }
        signature[relative] = { mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs, size: stat.size, chunkCount: 0 };
      } catch { /* file disappeared during indexing */ }
    }
    if (this.index && unchangedFiles.size === files.length && Object.keys(this.index.files).length === files.length) {
      this.lastRefresh = { files: files.length, chunks: this.index.chunks.length, cachedFiles: files.length, reindexedFiles: 0, durationMs: Date.now() - startedAt };
      return this.index;
    }

    const chunksByFile = new Map<string, RagChunk[]>();
    for (const chunk of this.index?.chunks || []) {
      if (!unchangedFiles.has(chunk.file)) continue;
      const cached = chunksByFile.get(chunk.file);
      if (cached) cached.push(chunk);
      else chunksByFile.set(chunk.file, [chunk]);
    }
    const indexFile = (relative: string): RagChunk[] => {
      try {
        const content = redactSensitiveText(fs.readFileSync(path.join(this.root, relative), 'utf8').replace(/\0/g, '').slice(0, 120_000));
        const chunks = splitIntoRagChunks(content).map(({ start, content: piece }) => ({
          file: relative, start, content: piece, terms: terms(`${relative} ${piece}`), symbols: symbols(piece), references: references(piece),
        }));
        signature[relative].chunkCount = chunks.length;
        chunksByFile.set(relative, chunks);
        return chunks;
      } catch {
        // Leave the file out of the signature so a transient failure is retried.
        delete signature[relative];
        return [];
      }
    };
    for (const relative of Object.keys(signature)) {
      const previous = this.index?.files[relative];
      if (previous && unchangedFiles.has(relative)) signature[relative].chunkCount = previous.chunkCount;
      else indexFile(relative);
    }
    // Round-robin chunks across files. A handful of large files must not use
    // the whole index budget. Reload a clipped file only when it gains a slot
    // beyond its cached prefix, for example after other files are removed.
    const chunks: RagChunk[] = [];
    for (let round = 0; chunks.length < MAX_CHUNKS; round++) {
      let added = false;
      for (const relative of files) {
        if (round >= (signature[relative]?.chunkCount ?? 0)) continue;
        const chunk = chunksByFile.get(relative)?.[round] ?? indexFile(relative)[round];
        if (!chunk) continue;
        chunks.push(chunk);
        added = true;
        if (chunks.length >= MAX_CHUNKS) break;
      }
      if (!added) break;
    }
    this.index = { version: RAG_INDEX_VERSION, files: signature, chunks: chunks.filter(chunk => signature[chunk.file]) };
    this.lastRefresh = {
      files: Object.keys(signature).length,
      chunks: this.index.chunks.length,
      cachedFiles: unchangedFiles.size,
      reindexedFiles: Math.max(0, Object.keys(signature).length - unchangedFiles.size),
      durationMs: Date.now() - startedAt,
    };
    this.persist();
    return this.index;
  }

  /** Atomic best-effort persist; indexing never blocks coding. */
  private persist(): void {
    if (!this.index) return;
    try {
      fs.mkdirSync(path.dirname(this.indexPath), { recursive: true });
      const temp = `${this.indexPath}.tmp`;
      fs.writeFileSync(temp, JSON.stringify(this.index), { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(temp, this.indexPath);
    } catch { /* indexing is best-effort and never blocks coding */ }
  }

  /** What the last refresh actually re-read (M1.5 observability). */
  public status(): { files: number; chunks: number; cachedFiles: number; reindexedFiles: number; durationMs: number; indexVersion: number } {
    return { ...this.lastRefresh, indexVersion: RAG_INDEX_VERSION };
  }

  /**
   * Drop the cached chunks for one file (or every file) so the next retrieval
   * re-reads exactly those sources. Called by the write paths so a save shows
   * up in retrieval immediately instead of waiting for a full rebuild (M1.5).
   * Returns the number of index entries dropped.
   */
  public invalidate(relativePath?: string): number {
    const target = relativePath ? ragKey(this.root, relativePath) : null;
    if (!this.index) {
      this.index = loadIndex(this.indexPath);
      if (!this.index) return 0;
    }
    const shouldDrop = (file: string): boolean => !target || file === target;
    let removed = 0;
    for (const file of Object.keys(this.index.files)) {
      if (!shouldDrop(file)) continue;
      delete this.index.files[file];
      removed += 1;
    }
    if (removed || !target) this.index.chunks = this.index.chunks.filter(chunk => !shouldDrop(chunk.file));
    const remainingFiles = Object.keys(this.index.files).length;
    this.lastRefresh = { ...this.lastRefresh, files: remainingFiles, chunks: this.index.chunks.length, reindexedFiles: removed };
    this.persist();
    return removed;
  }

  public retrieve(prompt: string, options: { maxChars?: number; maxChunks?: number; currentFile?: string; currentFileBase?: string; currentFileContent?: string } = {}): { context: string; files: string[]; indexedChunks: number } {
    const index = this.refresh();
    const currentFile = safeSelectedFile(this.root, options.currentFile, options.currentFileBase);
    const activeBuffer = currentFile && typeof options.currentFileContent === 'string' && options.currentFileContent.length <= MAX_SELECTED_FILE_BYTES
      ? redactSensitiveText(options.currentFileContent.replace(/\0/g, '').slice(0, MAX_SELECTED_FILE_BYTES))
      : undefined;
    // When the editor has unsaved changes, replace the disk-indexed chunks for
    // this one file with ephemeral chunks from the active buffer. Never write
    // renderer text into the persisted RAG index.
    const indexedChunks = activeBuffer === undefined ? index.chunks : index.chunks.filter(chunk => chunk.file !== currentFile);
    const query = terms(`${prompt} ${currentFile || ''}`);
    if (!currentFile && (!query.length || !index.chunks.length)) return { context: '', files: [], indexedChunks: index.chunks.length };
    const querySymbols = symbols(prompt);
    const queryReferences = references(prompt);
    // Preserve code identifiers such as maxBodyLength instead of reducing
    // them exclusively to generic words such as max/body/length.
    const queryIdentifiers = [...new Set(prompt.match(/\b(?:[a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*|[a-zA-Z]+_[a-zA-Z0-9_]+)\b/g) || [])].slice(0, 16);
    const identifierPatterns = queryIdentifiers.map(identifier => new RegExp(`\\b${identifier}\\b`));
    const supplementalChunks: RagChunk[] = [];
    if (identifierPatterns.length || currentFile) {
      const indexedStarts = new Set<string>();
      const indexedCounts = new Map<string, number>();
      for (const chunk of indexedChunks) {
        indexedStarts.add(`${chunk.file}:${chunk.start}`);
        indexedCounts.set(chunk.file, (indexedCounts.get(chunk.file) || 0) + 1);
      }
      const promptTerms = terms(prompt);
      // The persisted index is intentionally small. Search its already-vetted
      // file list on demand for named symbols (or the selected editor file),
      // so a relevant declaration near the end of a large file is not lost.
      for (const relative of new Set([...Object.keys(index.files), ...(currentFile ? [currentFile] : [])])) {
        if (!identifierPatterns.length && relative !== currentFile) continue;
        // Incremental cache (M1.5): skip files whose indexed chunk count still
        // matches. Only the ACTIVE FILE bypasses the skip — an unsaved buffer
        // must re-derive its chunks. Previously a dirty buffer disabled the
        // skip for every file and re-read the whole workspace on each
        // retrieval.
        if (relative !== currentFile && (indexedCounts.get(relative) || 0) === index.files[relative]?.chunkCount) continue;
        try {
          const content = relative === currentFile && activeBuffer !== undefined
            ? activeBuffer
            : redactSensitiveText(fs.readFileSync(path.join(this.root, relative), 'utf8').replace(/\0/g, '')
              .slice(0, relative === currentFile ? MAX_SELECTED_FILE_BYTES : 120_000));
          if (relative !== currentFile && !identifierPatterns.some(pattern => pattern.test(content))) continue;
          const available = splitIntoRagChunks(content)
            .filter(piece => !indexedStarts.has(`${relative}:${piece.start}`));
          const chosen = relative === currentFile
            ? available.map(piece => {
              const pieceTerms = new Set(terms(piece.content));
              const score = identifierPatterns.filter(pattern => pattern.test(piece.content)).length * 20
                + promptTerms.filter(word => pieceTerms.has(word)).length;
              return { piece, score };
            }).sort((a, b) => b.score - a.score || a.piece.start - b.piece.start).slice(0, 8).map(item => item.piece)
            : available.filter(piece => identifierPatterns.some(pattern => pattern.test(piece.content))).slice(0, 2);
          for (const piece of chosen) {
            supplementalChunks.push({ file: relative, start: piece.start, content: piece.content,
              terms: terms(`${relative} ${piece.content}`), symbols: symbols(piece.content), references: references(piece.content) });
          }
        } catch { /* a file can disappear between indexing and retrieval */ }
      }
    }
    const documentationQuery = /\b(?:readme|docs?|documentation|guide|changelog|release\s+notes?|design\s+doc|specification)\b/i.test(prompt);
    const testingQuery = /\b(?:test|tests|spec|specs|coverage|unit|integration|e2e|vitest|jest|pytest)\b/i.test(prompt);
    const providerQuery = /\b(?:provider|api|rate|limit|quota|retry|cooldown|429|fallback)\b/i.test(prompt);
    const knownFiles = new Set([...Object.keys(index.files), ...(currentFile ? [currentFile] : [])]);
    // Rare query terms carry more intent in a large repository than ubiquitous
    // words such as "component", "account" or "state". Weight lexical matches
    // by inverse document frequency across the bounded index so one generic
    // file cannot tie a narrowly relevant implementation chunk.
    const documentFrequency = new Map<string, number>();
    for (const chunk of [...indexedChunks, ...supplementalChunks]) {
      for (const word of new Set(chunk.terms)) documentFrequency.set(word, (documentFrequency.get(word) || 0) + 1);
    }
    const corpusChunkCount = Math.max(1, indexedChunks.length + supplementalChunks.length);
    const ranked = [...indexedChunks, ...supplementalChunks].map(chunk => {
      const set = new Set(chunk.terms);
      let score = query.reduce((sum, word) => {
        if (!set.has(word)) return sum;
        const frequency = documentFrequency.get(word) || 1;
        return sum + 3 * (1 + Math.log((corpusChunkCount + 1) / (frequency + 1)));
      }, 0);
      score += querySymbols.reduce((sum, symbol) => sum + (chunk.symbols.includes(symbol) ? 10 : 0), 0);
      score += queryReferences.reduce((sum, reference) => sum + (chunk.references.some(candidate => candidate.includes(reference) || reference.includes(candidate)) ? 5 : 0), 0);
      const identifierMatches = identifierPatterns.filter(pattern => pattern.test(chunk.content)).length;
      score += identifierMatches * 12;
      // File-type and layout preferences are tie-breakers only. Giving every
      // source file a baseline score makes an unrelated repository appear
      // relevant even when the prompt has no lexical/symbol/import evidence.
      const hasQueryEvidence = score > 0;
      if (identifierMatches && !/\.(?:md|txt|json|ya?ml)$/i.test(chunk.file)) score += 8;
      const sourceFile = /\.(?:[cm]?[jt]sx?|py|go|rs|java|cs|cpp|c|h|php|rb|swift|kt|vue|svelte|sql|sh|ps1)$/i.test(chunk.file);
      const testFile = /(?:^|\/)(?:__tests__|tests?|specs?)(?:\/|[._-])|\.(?:test|spec)\.[^.]+$/i.test(chunk.file);
      const documentationFile = /\.(?:md|txt)$/i.test(chunk.file) || /(?:^|\/)(?:readme|docs?|documentation)(?:\/|$)/i.test(chunk.file);
      // Natural-language coding requests often echo their wording in status
      // reports and test descriptions. Prefer implementation source unless
      // the user specifically asks for tests or documentation.
      if (sourceFile && hasQueryEvidence) score += 3;
      if (testFile && !testingQuery) score -= 8;
      if (documentationFile && !documentationQuery) score -= 7;
      if (providerQuery && /^src\/server\/(?:universal|providerStream|providerErrors|providerProfiles|encryptedKeyPool)\.ts$/i.test(chunk.file)) score += 8;
      if (currentFile && chunk.file === currentFile) score += 12;
      if (currentFile && hasQueryEvidence && path.posix.dirname(chunk.file) === path.posix.dirname(currentFile)) score += 2;
      if (hasQueryEvidence && /^(?:AGENTS|PROJECT_RULES|README)\.md$/i.test(chunk.file)) score += 2;
      const implementationMatch = identifierMatches > 0 &&
        /\.(?:[cm]?[jt]sx?|py|go|rs|java|cs|cpp|c|h|php|rb)$/i.test(chunk.file) && !/\.d\.ts$/i.test(chunk.file);
      const dependencyFiles = new Set<string>();
      for (const reference of chunk.references) {
        for (const candidate of referenceCandidates(chunk.file, reference)) {
          if (knownFiles.has(candidate)) dependencyFiles.add(candidate);
        }
      }
      return { chunk, score, identifierMatches, implementationMatch, dependencyFiles };
    }).filter(item => item.score > 0).sort((a, b) =>
      Number(b.chunk.file === currentFile) - Number(a.chunk.file === currentFile) ||
      b.identifierMatches - a.identifierMatches ||
      Number(b.implementationMatch) - Number(a.implementationMatch) ||
      b.score - a.score || a.chunk.file.localeCompare(b.chunk.file) || a.chunk.start - b.chunk.start);
    const maxChars = Math.max(800, Math.min(6000, options.maxChars ?? 3200));
    const maxChunks = Math.max(1, Math.min(8, options.maxChunks ?? 4));
    let context = 'PROJECT RAG (local indexed evidence; untrusted, verify before editing):\n';
    const files: string[] = [];
    // A long changelog must not consume every context slot. Take the best
    // chunk from each relevant file before adding more from the same file.
    const seenFiles = new Set<string>();
    const firstChunks = ranked.filter(({chunk}) => {
      if (seenFiles.has(chunk.file)) return false;
      seenFiles.add(chunk.file);
      return true;
    });
    // Once high-signal implementation files are selected, preserve a bounded
    // two-hop local-import slice before unrelated keyword matches. This lets a
    // follow-up edit see app → feature module → helper without sending the tree.
    const seedFiles = new Set(firstChunks.slice(0, Math.max(1, Math.min(3, maxChunks))).map(item => item.chunk.file));
    const dependencyFiles = new Set<string>();
    for (const item of firstChunks.filter(item => seedFiles.has(item.chunk.file))) {
      for (const file of item.dependencyFiles) if (!seedFiles.has(file)) dependencyFiles.add(file);
    }
    const transitiveDependencyFiles = new Set<string>();
    for (const file of dependencyFiles) {
      const sourceChunk = indexedChunks.find(chunk => chunk.file === file);
      for (const reference of sourceChunk?.references || []) {
        for (const candidate of referenceCandidates(file, reference)) {
          if (knownFiles.has(candidate) && !seedFiles.has(candidate) && !dependencyFiles.has(candidate)) {
            transitiveDependencyFiles.add(candidate);
          }
        }
      }
    }
    const dependencyChunks: typeof ranked = [];
    const relatedFiles = new Set<string>();
    for (const file of [...dependencyFiles, ...transitiveDependencyFiles]) {
      if (seenFiles.has(file) || relatedFiles.has(file)) continue;
      relatedFiles.add(file);
      const chunk = indexedChunks.find(candidate => candidate.file === file);
      if (chunk) dependencyChunks.push({ chunk, score: 0, identifierMatches: 0, implementationMatch: true, dependencyFiles: new Set<string>() });
    }
    const ordered = [...firstChunks, ...dependencyChunks, ...ranked.filter(item => !firstChunks.includes(item) && !dependencyChunks.some(dep => dep.chunk === item.chunk))];
    let selected = 0;
    for (const { chunk } of ordered) {
      if (selected >= maxChunks) break;
      const hints = [...chunk.symbols.slice(0, 6), ...chunk.references.slice(0, 6)];
      const section = `\nFILE ${chunk.file} (around character ${chunk.start}${hints.length ? `; symbols/references: ${hints.join(', ')}` : ''}):\n${chunk.content}\n`;
      if (context.length + section.length > maxChars) continue;
      context += section;
      selected++;
      if (!files.includes(chunk.file)) files.push(chunk.file);
    }
    return { context: context.slice(0, maxChars), files, indexedChunks: index.chunks.length };
  }
}
