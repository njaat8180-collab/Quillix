/** Shared, testable pacing for the renderer's ghost-text provider. The renderer
 * sleeps this long after Monaco asks (so a fast typist does not enqueue a
 * request per keystroke) and never issues requests closer together than the
 * throttle window. Kept here so EditorArea and tests agree on one value. */
export const INLINE_COMPLETION_DEBOUNCE_MS = 450;
export const INLINE_COMPLETION_THROTTLE_MS = 700;

/** Languages where `#` at line start is code (private fields / preprocessor),
 * not a comment. Everywhere else a leading `#` is treated as a comment. */
const HASH_CODE_LANGUAGES = new Set([
  'typescript', 'javascript', 'java', 'c', 'cpp', 'csharp', 'go', 'rust',
  'swift', 'kotlin', 'dart', 'css', 'json',
]);

/** True when the cursor sits inside a comment, so a completion would be noise.
 * Checks ONLY the current line up to the cursor: the previous heuristic looked
 * at the last 180 characters, so a file ending in `// TODO` suppressed
 * completions on the following code line. String literals are quote-aware, so
 * `const url = "https://x"` is never treated as a comment. */
export function isCompletionSuppressedContext(lineBeforeCursor: string, languageId: string): boolean {
  const line = String(lineBeforeCursor || '');
  const language = String(languageId || '').toLowerCase();
  const leading = line.replace(/^[ \t]+/, '');
  if (!leading) return false;
  const hashIsComment = !HASH_CODE_LANGUAGES.has(language);
  // Line-start comment openers (block-comment continuations included).
  if (/^(?:\/\/|\/\*+|\*+\/?|<!--|-->|"""|'''|--[^\s]|-- )/.test(leading)) return true;
  if (hashIsComment && leading.startsWith('#')) return true;
  if (hashIsComment && /^#!/.test(leading)) return true;
  // Same-line comments: track quotes so string contents never count.
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === '\\') { i++; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '/' && line[i + 1] === '/') return true;
    if (ch === '/' && line[i + 1] === '*') return true;
    if (ch === '#' && hashIsComment) return true;
    if (ch === '<' && line[i + 1] === '!' && line[i + 2] === '-' && line[i + 3] === '-') return true;
    if (language === 'sql' && ch === '-' && line[i + 1] === '-') return true;
  }
  return false;
}

/** Bracket balance with quotes respected: `const s = "(";` is balanced. */
function bracketBalance(text: string): number {
  let balance = 0;
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') { i++; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '(' || ch === '[' || ch === '{') balance++;
    else if (ch === ')' || ch === ']' || ch === '}') balance--;
  }
  return balance;
}

/** True when a line is itself an unfinished fragment (never mind brackets that
 * opened on earlier lines): it ends with an unclosed bracket or a dangling
 * operator/comma/arrow. A complete line is never partial, even when an earlier
 * line opened a block the user will keep typing inside. */
function isPartialLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (bracketBalance(line) > 0) return true;
  return /(?:[+\-*/%<>=&|^?,.:]|=>|\b(?:return|const|let|var|new|in|of)\s*)$/.test(trimmed);
}

/** Drop a trailing unterminated line from a multi-line completion so ghost
 * text never inserts a dangling half-token (models truncate mid-expression).
 * Conservative: a balanced completion is returned untouched, a single-line
 * completion is returned untouched, and trimming never empties the result. */
export function trimIncompleteTail(completion: string): string {
  let value = String(completion || '');
  while (value.indexOf('\n') !== -1) {
    const lines = value.split('\n');
    const lastLine = lines[lines.length - 1];
    if (!lastLine.trim() && lines.length > 1) {
      lines.pop();
      value = lines.join('\n');
      continue;
    }
    if (lines.length > 1 && isPartialLine(lastLine)) {
      lines.pop();
      value = lines.join('\n');
      continue;
    }
    break;
  }
  return value;
}

const MAX_COMPLETION_CHARS = 1200;
const FENCE = String.fromCharCode(96).repeat(3);

/** Monaco language IDs that receive NUVRO AI ghost-text completions. Keep this
 * aligned with EditorArea.getLanguage so supported files do not silently miss
 * the provider (notably HTML/CSS project files). */
export const INLINE_COMPLETION_LANGUAGES = [
  'typescript', 'javascript', 'json', 'css', 'html', 'markdown', 'python', 'rust',
  'go', 'shell', 'java', 'c', 'cpp', 'csharp', 'php', 'ruby', 'kotlin', 'swift',
  'dart', 'lua', 'r', 'sql', 'xml', 'yaml', 'ini', 'powershell', 'bat',
] as const;

/** Keep inline completion output safe and useful for Monaco ghost text. */
export function cleanInlineCompletion(raw: string): string {
  let value = String(raw || '').replace(/\r/g, '');
  value = value.replace(new RegExp('^\\s*' + FENCE + '[\\w#+.-]*\\s*\\n?'), '').replace(new RegExp('\\n?\\s*' + FENCE + '\\s*$'), '');
  value = value.replace(/^\s*(?:Here(?:'s| is)\s+the\s+)?(?:completion|suggestion)\s*:\s*/i, '');
  value = trimIncompleteTail(value);
  if (value.length > MAX_COMPLETION_CHARS) value = value.slice(0, MAX_COMPLETION_CHARS);
  return value;
}

export function trimCompletionContext(value: string, maxChars: number): string {
  const normalized = String(value || '').replace(/\0/g, '').replace(/\r/g, '');
  return normalized.length <= maxChars ? normalized : normalized.slice(-maxChars);
}

export function buildInlineCompletionPrompt(input: {
  filePath: string;
  language: string;
  prefix: string;
  suffix: string;
  relatedContext?: string;
}): string {
  const prefix = trimCompletionContext(input.prefix, 4200);
  const suffix = trimCompletionContext(input.suffix, 1200);
  const context = trimCompletionContext(input.relatedContext || '', 2200);
  const contextBlock = context
    ? '\nRelevant project symbols:\n<context>\n' + context + '\n</context>'
    : '';
  return [
    'Complete the code at the cursor. Return ONLY the text to insert, with no markdown, explanation, or code fences.',
    'Preserve the existing style and indentation. Prefer a short, syntactically complete continuation; do not repeat text already present after the cursor.',
    'If there is not enough information, return an empty response.',
    '',
    'File: ' + input.filePath,
    'Language: ' + input.language,
    '',
    '<prefix>',
    prefix,
    '</prefix>',
    '',
    '<suffix>',
    suffix,
    '</suffix>',
    contextBlock,
    '',
    'Text to insert:',
  ].join('\n');
}

export const INLINE_COMPLETION_LIMITS = {
  maxChars: MAX_COMPLETION_CHARS,
  prefixChars: 4200,
  suffixChars: 1200,
  contextChars: 2200,
} as const;

export interface InlineCancellationToken {
  onCancellationRequested?: (listener: () => void) => { dispose: () => void };
}

/** Subscribe to Monaco cancellation and return the owned listener disposal. */
export function subscribeInlineCancellation(
  token: InlineCancellationToken | undefined,
  cancel: () => void,
): { dispose: () => void } | undefined {
  return token?.onCancellationRequested?.(cancel);
}

export function inlineCompletionCacheKey(input: {
  workspaceId: string;
  filePath: string;
  language: string;
  prefix: string;
  suffix: string;
}): string {
  return JSON.stringify([
    input.workspaceId,
    input.filePath,
    input.language,
    trimCompletionContext(input.prefix, INLINE_COMPLETION_LIMITS.prefixChars),
    trimCompletionContext(input.suffix, INLINE_COMPLETION_LIMITS.suffixChars),
  ]);
}

/** Small renderer-local LRU cache to avoid duplicate typeahead requests. */
export class InlineCompletionCache {
  private readonly entries = new Map<string, { value: string; expiresAt: number }>();

  constructor(
    private readonly maxEntries = 96,
    private readonly ttlMs = 30_000,
    private readonly now: () => number = Date.now,
  ) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) throw new Error('Inline completion cache size must be positive.');
    if (!Number.isFinite(ttlMs) || ttlMs < 1) throw new Error('Inline completion cache lifetime must be positive.');
  }

  public get(key: string): string | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  public set(key: string, value: string): void {
    const completion = String(value || '');
    if (!completion) return;
    this.entries.delete(key);
    this.entries.set(key, { value: completion, expiresAt: this.now() + this.ttlMs });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  public clear(): void {
    this.entries.clear();
  }
}
