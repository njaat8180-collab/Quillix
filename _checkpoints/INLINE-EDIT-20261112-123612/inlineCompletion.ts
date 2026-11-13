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
