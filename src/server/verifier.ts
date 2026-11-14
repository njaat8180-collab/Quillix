import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { WorkspaceManager } from './workspace.js';
import { TerminalService } from './terminal.js';
import { inspectBrowserScripts, inspectBrowserAssets, checkExplicitWebRequirements } from './browserChecks.js';
import { requestedCommonJSExports, declaredCommonJSExports } from './exportContract.js';

const execFileAsync = promisify(execFile);

/**
 * QUILLIX Workspace Verifier
 *
 * Real, deterministic validation of generated files. Used by the agent engine
 * to guarantee the mandatory TEST → FIX → RETEST cycle: after the model
 * finishes writing files, QUILLIX itself runs syntax/structure checks (node
 * --check for JavaScript, py_compile for Python, JSON.parse for JSON, tag
 * balance for HTML) and reports genuine failures for repair.
 */

export interface FileVerification {
  filePath: string;
  /** Verification kind that ran. */
  check: string;
  ok: boolean;
  error?: string;
}

export interface VerificationReport {
  verified: FileVerification[];
  allOk: boolean;
  failures: FileVerification[];
}

export class WorkspaceVerifier {
  constructor(private workspace: WorkspaceManager, private terminal: TerminalService) {}

  /**
   * Verifies that every claimed file actually exists on disk and passes a
   * language-appropriate syntax check when the runtime is available.
   */
  public async verifyFiles(relativePaths: string[], userPrompt = ''): Promise<VerificationReport> {
    const verified: FileVerification[] = [];

    for (const rel of relativePaths) {
      const check = this.workspace.resolveSafePath(rel);
      if (!check.safe) {
        verified.push({ filePath: rel, check: 'path', ok: false, error: check.error });
        continue;
      }
      if (!fs.existsSync(check.fullPath)) {
        verified.push({ filePath: rel, check: 'existence', ok: false, error: 'File does not exist on disk.' });
        continue;
      }
      verified.push({ filePath: rel, check: 'existence', ok: true });

      const ext = path.extname(rel).toLowerCase();

      // NO PLACEHOLDER CODE (§5): a code file that is empty, contains only
      // comments, or consists solely of stub markers (pass / TODO /
      // "coming soon") is NOT a real implementation and must fail verification.
      const content = this.workspace.readFile(rel);
      if (!content.success || content.content === undefined) {
        // An UNREADABLE file must fail: a protected/secret file or an I/O
        // error can never be verified, and silently skipping the content
        // checks would let an unverifiable file count toward success.
        verified.push({ filePath: rel, check: 'content-read', ok: false,
          error: content.error || 'The written file could not be read back for verification.' });
        continue;
      }
      const placeholderErr = checkPlaceholderCode(path.basename(rel), content.content);
      if (placeholderErr) {
        verified.push({ filePath: rel, check: 'placeholder-content', ok: false, error: placeholderErr });
        continue;
      }

      try {
        if (ext === '.json') {
          try {
            JSON.parse(content.content);
            verified.push({ filePath: rel, check: 'json-parse', ok: true });
          } catch (err: any) {
            verified.push({ filePath: rel, check: 'json-parse', ok: false, error: `Invalid JSON: ${err.message}` });
          }
        } else if (['.js', '.mjs', '.cjs'].includes(ext)) {
          try {
            const { transform } = await import('esbuild');
            await transform(content.content, { loader: 'js', sourcefile: rel, format: 'cjs' });
            verified.push({ filePath: rel, check: 'js-syntax', ok: true });
          } catch (err: any) {
            verified.push({ filePath: rel, check: 'js-syntax', ok: false, error: `JavaScript syntax check failed: ${String(err?.message || err).slice(0, 800)}` });
          }
        } else if (['.ts', '.tsx', '.jsx'].includes(ext)) {
          // Transpilation checks syntax, not project-wide types or runtime.
          try {
            // TypeScript 7 no longer guarantees the legacy transpileModule
            // compiler API. esbuild is already a mandatory QUILLIX runtime
            // dependency, and checks TS/TSX/JSX syntax without execution.
            const { transform } = await import('esbuild');
            const loader = ext === '.tsx' ? 'tsx' : ext === '.jsx' ? 'jsx' : 'ts';
            await transform(content.content, { loader, sourcefile: rel, format: 'esm', jsx: 'automatic' });
            verified.push({ filePath: rel, check: 'ts-syntax', ok: true });
          } catch (err: any) {
            const detail = typeof err?.message === 'string' ? err.message.slice(0, 300) : 'Syntax checking unavailable';
            verified.push({ filePath: rel, check: 'ts-syntax', ok: false, error: `TypeScript/JSX syntax check failed: ${detail}` });
          }
        } else if (ext === '.py') {
          const py = await this.detectPython();
          if (py) {
            // py_compile writes __pycache__, which is unnecessary for a
            // syntax check and can fail in locked-down/temp workspaces. Parse
            // the source in memory so validation remains read-only.
            try {
              await execFileAsync(py, ['-c', 'import ast,sys; ast.parse(open(sys.argv[1], encoding="utf-8").read())', check.fullPath], {
                cwd: this.workspace.getRoot(), timeout: 30000, windowsHide: true, maxBuffer: 1024 * 1024,
              });
              verified.push({ filePath: rel, check: 'py_compile', ok: true });
            } catch (err: any) {
              const detail = String(err?.stderr || err?.stdout || err?.message || 'Python syntax check failed').trim();
              verified.push({ filePath: rel, check: 'py_compile', ok: false, error: detail.slice(0, 800) });
            }
          } else {
            verified.push({
              filePath: rel,
              check: 'py_compile',
              ok: false,
              error: 'Python runtime not found on this machine — cannot verify.',
            });
          }
        } else if (ext === '.html' || ext === '.htm') {
          const htmlErr = checkHtml(content.content);
          verified.push({
            filePath: rel,
            check: 'html-balance',
            ok: !htmlErr,
            error: htmlErr || undefined,
          });
          // Syntax-valid server code is NOT automatically browser-compatible.
          // Inspect scripts linked by this HTML, without executing them.
          for (const issue of inspectBrowserScripts(rel, content.content, scriptPath => {
            const safe = this.workspace.resolveSafePath(scriptPath);
            if (!safe.safe) return undefined;
            const source = this.workspace.readFile(scriptPath);
            return source.success ? source.content : undefined;
          })) {
            verified.push({ ...issue, ok: false });
          }
          for (const issue of inspectBrowserAssets(rel, content.content, assetPath => {
            const safe = this.workspace.resolveSafePath(assetPath);
            if (!safe.safe) return undefined;
            const source = this.workspace.readFile(assetPath);
            return source.success ? source.content : undefined;
          })) {
            verified.push({ ...issue, ok: false });
          }
        }
        // CSS, Markdown, config files: existence check already covers them.
      } catch (err: any) {
        // Preserve the real failure text: a non-Error throw would otherwise
        // report `error: undefined` on a failed check.
        verified.push({ filePath: rel, check: ext, ok: false,
          error: String((err as any)?.message || err || 'verification failed').slice(0, 800) });
      }
    }

    // Only explicit, mechanically testable requirements are enforced here.
    // Passing this does NOT replace a real browser UI acceptance test.
    if (userPrompt) {
      const commonJSFiles = relativePaths.filter(file => /\.(?:cjs|js)$/i.test(file));
      const requiredExports = requestedCommonJSExports(userPrompt);
      // A multi-module task needs a per-file API contract; do not guess which
      // of several modules owns a name mentioned in the user's request.
      if (commonJSFiles.length === 1 && requiredExports.length) {
        const filePath = commonJSFiles[0], read = this.workspace.readFile(filePath);
        const declared = declaredCommonJSExports(read.success ? read.content || '' : '');
        const missing = requiredExports.filter(name => !declared.has(name));
        verified.push({ filePath, check: 'explicit-commonjs-exports', ok: !missing.length,
          error: missing.length ? `Missing explicitly requested named CommonJS export(s): ${missing.join(', ')}. Preserve the requested exports.name API, not a default-only module.exports function.` : undefined });
      }
      for (const issue of checkExplicitWebRequirements(userPrompt, relativePaths, file => {
        const safe = this.workspace.resolveSafePath(file);
        if (!safe.safe) return undefined;
        const source = this.workspace.readFile(file);
        return source.success ? source.content : undefined;
      })) verified.push({ ...issue, ok: false });
    }
    const failures = verified.filter((v) => !v.ok);
    if (relativePaths.length === 0) {
      const noFiles = {
        filePath: '',
        check: 'verification-input',
        ok: false,
        error: 'No files were produced for verification.',
      };
      verified.push(noFiles);
      failures.push(noFiles);
    }
    return { verified, allOk: failures.length === 0, failures };
  }

  /** Resolved Python interpreter, memoized so N .py files cost one probe. */
  private pythonRuntime: string | null | undefined;

  private async detectPython(): Promise<string | null> {
    if (this.pythonRuntime) return this.pythonRuntime;
    for (const cmd of ['python3', 'python']) {
      try {
        const res = await this.terminal.executeCommand(`${cmd} --version`, this.workspace.getRoot(), undefined, 10000, 'agent');
        if (res.exitCode === 0 && /python/i.test(res.stdout + res.stderr)) {
          this.pythonRuntime = cmd;
          return cmd;
        }
      } catch { /* try the next interpreter candidate */ }
    }
    return null;
  }
}

/**
 * Returns an error message when a code file contains no real implementation —
 * only comments, whitespace, or stub markers. Markdown and other non-code
 * files are never flagged; genuinely empty placeholder files that a real
 * project needs (__init__.py, .gitkeep) are exempt.
 */
function checkPlaceholderCode(fileName: string, content: string): string | undefined {
  const CODE_EXTS = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.html', '.htm', '.css', '.java', '.c', '.cpp', '.cc', '.h', '.go', '.rs', '.rb', '.php', '.swift', '.kt', '.sh']);
  const EXEMPT_NAMES = new Set(['__init__.py', '.gitkeep', '.gitignore', '.env.example']);
  const ext = path.extname(fileName).toLowerCase();
  if (!CODE_EXTS.has(ext) || EXEMPT_NAMES.has(fileName)) return undefined;

  if (content.trim().length === 0) {
    return 'Code file is empty — it contains no implementation.';
  }

  // Strip comments so only executable statements remain.
  // CSS has NO line comments: `#id { … }` is a selector, not a comment, so a
  // stylesheet built entirely from id rules would otherwise be misread as a
  // comments-only placeholder.
  const hashIsComment = ext !== '.css' && ext !== '.scss' && ext !== '.less';
  let code = content
    .replace(/\/\*[\s\S]*?\*\//g, '')      // /* */ block comments (JS/TS/CSS)
    .replace(/<!--[\s\S]*?-->/g, '')        // <!-- --> HTML comments
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      return t !== '' && !t.startsWith('//') && !(hashIsComment && t.startsWith('#'));
    })
    .join('\n')
    .trim();

  if (code.length === 0) {
    return 'Code file contains only comments/whitespace — no implementation.';
  }
  // Remove docstrings before the stub check (a lone docstring is not code).
  code = code.replace(/(['"]{3})[\s\S]*?\1/g, '').trim();
  if (code.length === 0) {
    return 'Code file contains only a docstring — no implementation.';
  }
  // Stub detection on the whitespace-collapsed code so indentation never hides
  // a placeholder ("def run():\n    pass\n" collapses to "defrun():pass").
  const compact = code.replace(/\s+/g, '');
  // NOTE: `compact` has ALL whitespace removed, so these patterns must not
  // require any whitespace between tokens.
  if (
    /^(?:pass|\.\.\.|TODO|FIXME|NotImplemented(?:Error)?|raiseNotImplementedError\(\)?);?$/.test(compact) ||
    // A function (sync or async) whose entire body is a stub.
    /^(?:export)?(?:default)?(?:async)?function\w*\([^)]*\)\{\};?$/.test(compact) ||
    /^(?:export)?(?:const|let|var)\w+=(?:async)?\([^)]*\)=>\{\};?$/.test(compact) ||
    /^(?:export)?(?:const|let|var)\w+=(?:async)?\w+=>\{\};?$/.test(compact) ||
    // A class (or plain function) whose every method body is a stub.
    /^(?:export)?(?:default)?class\w*(?:extends[\w.]+)?\{(?:\w+\([^)]*\)\{\})+\};?$/.test(compact) ||
    /^(?:export)?(?:default)?class\w*:(?:def\w*\([^)]*\):(?:pass|\.\.\.|raiseNotImplementedError\(\)?))+$/.test(compact) ||
    /^(?:export)?(?:default)?def\w*\([^)]*\):(?:pass|\.\.\.|raiseNotImplementedError\(\)?);?$/.test(compact) ||
    /^(?:export)?default\{\};?$/.test(compact)
  ) {
    return 'Code file contains only a stub (pass / TODO / empty function) — no implementation.';
  }
  if (/^(?:print|console\.log|echo|System\.out\.println)\(\s*['"][^'"]*(coming soon|todo|placeholder|not implemented)[^"]*['"]\s*\)\s*;?$/im.test(code) &&
      compact.match(/^(?:print|console\.log|echo|System\.out\.println)\((['"])[^'"]*\1\);?$/i)) {
    return 'Code file only prints a placeholder message — no implementation.';
  }
  return undefined;
}

/** Void HTML elements that never take a closing tag. */
const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr', '!doctype',
]);

/** Stack-based HTML tag balance check for common structural errors. */
function checkHtml(html: string): string | undefined {
  // Comments are not elements. Strip them before the lightweight tag stack
  // parser; otherwise a normal `<!-- ... -->` is misread as an opening `< !`
  // tag and a valid page can fail with the misleading error `Tag <!--> ...`.
  // Script/style contents are text, not HTML markup. A browser game may
  // legitimately contain strings such as `<empty>` or comparison snippets
  // inside JavaScript; feeding those bytes to the structural tag stack
  // creates a false unclosed-tag failure and sends the agent into a useless
  // repair loop. Preserve the wrapper tags while excluding their contents.
  // An UNCLOSED script/style would otherwise swallow the rest of the
  // document and surface as a misleading "Tag <x> is never closed", so the
  // real defect is reported by name first.
  const scriptOpens = (html.match(/<script\b[^>]*>/gi) || []).length;
  const scriptCloses = (html.match(/<\/script\s*>/gi) || []).length;
  if (scriptOpens !== scriptCloses) {
    return `Tag <script> is never closed (${scriptOpens} opening tag(s) vs ${scriptCloses} closing tag(s)).`;
  }
  const styleOpens = (html.match(/<style\b[^>]*>/gi) || []).length;
  const styleCloses = (html.match(/<\/style\s*>/gi) || []).length;
  if (styleOpens !== styleCloses) {
    return `Tag <style> is never closed (${styleOpens} opening tag(s) vs ${styleCloses} closing tag(s)).`;
  }
  const source = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/(<script\b[^>]*>)[\s\S]*?(<\/script\s*>)/gi, '$1$2')
    .replace(/(<style\b[^>]*>)[\s\S]*?(<\/style\s*>)/gi, '$1$2');
  const tagRegex = /<\/?([a-zA-Z!][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/g;
  const stack: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(source)) !== null) {
    const isClosing = match[0][1] === '/';
    const raw = match[1].toLowerCase();
    if (VOID_TAGS.has(raw)) continue;
    if (!isClosing) {
      // Self-closing <div/> — nothing to track.
      if (/\/>$/.test(match[0])) continue;
      stack.push(raw);
    } else {
      const openIdx = stack.lastIndexOf(raw);
      if (openIdx === -1) {
        return `Closing tag </${raw}> has no matching opening tag.`;
      }
      if (openIdx !== stack.length - 1) {
        const unclosed = stack.slice(openIdx + 1);
        return `Tag <${unclosed[unclosed.length - 1]}> is not closed before </${raw}>.`;
      }
      stack.pop();
    }
  }
  if (stack.length > 0) {
    return `Tag <${stack[stack.length - 1]}> is never closed.`;
  }
  return undefined;
}
