import { describe, expect, it } from 'vitest';
import { buildInlineCompletionPrompt, cleanInlineCompletion, INLINE_COMPLETION_DEBOUNCE_MS, INLINE_COMPLETION_LANGUAGES, INLINE_COMPLETION_THROTTLE_MS, InlineCompletionCache, inlineCompletionCacheKey, isCompletionSuppressedContext, subscribeInlineCancellation, trimCompletionContext, trimIncompleteTail } from '../../shared/inlineCompletion.js';

describe('inline completion contract', () => {
  it('registers ghost-text completion for web and supported editor languages', () => {
    expect(INLINE_COMPLETION_LANGUAGES).toContain('html');
    expect(INLINE_COMPLETION_LANGUAGES).toContain('css');
    expect(INLINE_COMPLETION_LANGUAGES).toContain('markdown');
    expect(INLINE_COMPLETION_LANGUAGES).toContain('python');
    expect(new Set(INLINE_COMPLETION_LANGUAGES).size).toBe(INLINE_COMPLETION_LANGUAGES.length);
  });

  it('strips markdown and explanation wrappers', () => {
    const fence = String.fromCharCode(96).repeat(3);
    expect(cleanInlineCompletion(fence + 'ts\nconst answer = 42;\n' + fence)).toBe('const answer = 42;');
    expect(cleanInlineCompletion('Completion: return value;')).toBe('return value;');
  });

  it('keeps the cursor context bounded and preserves the newest prefix', () => {
    expect(trimCompletionContext('abcdef', 3)).toBe('def');
  });

  it('disposes the Monaco cancellation listener after an inline request', () => {
    let listener: (() => void) | undefined;
    let disposed = false;
    const subscription = subscribeInlineCancellation({
      onCancellationRequested: callback => {
        listener = callback;
        return { dispose: () => { disposed = true; listener = undefined; } };
      },
    }, () => undefined);

    expect(listener).toBeTypeOf('function');
    subscription?.dispose();
    expect(disposed).toBe(true);
    expect(listener).toBeUndefined();
    expect(subscribeInlineCancellation(undefined, () => undefined)).toBeUndefined();
  });

  it('caches duplicate cursor requests briefly with a bounded LRU', () => {
    let now = 100;
    const cache = new InlineCompletionCache(2, 50, () => now);
    const key = inlineCompletionCacheKey({ workspaceId: 'project-a', filePath: 'src/app.ts', language: 'typescript', prefix: 'const answer = ', suffix: '\nrender(answer);' });
    cache.set(key, '42;');
    expect(cache.get(key)).toBe('42;');
    cache.set('second', 'second-result');
    expect(cache.get(key)).toBe('42;'); // refreshes LRU position
    cache.set('third', 'third-result');
    expect(cache.get('second')).toBeUndefined();
    expect(cache.get(key)).toBe('42;');
    now += 51;
    expect(cache.get(key)).toBeUndefined();
    cache.set('empty', '');
    expect(cache.get('empty')).toBeUndefined();
    expect(inlineCompletionCacheKey({ workspaceId: 'project-b', filePath: 'src/app.ts', language: 'typescript', prefix: 'const answer = ', suffix: '\nrender(answer);' })).not.toBe(key);
  });

  it('builds an insertion-only prompt with bounded context', () => {
    const prompt = buildInlineCompletionPrompt({
      filePath: 'src/app.ts', language: 'typescript', prefix: 'const value = ', suffix: '\nrender(value);',
      relatedContext: 'function render(value: unknown) {}',
    });
    expect(prompt).toContain('Return ONLY the text to insert');
    expect(prompt).toContain('File: src/app.ts');
    expect(prompt).toContain('<prefix>\nconst value = ');
    expect(prompt).toContain('function render(value: unknown) {}');
  });

  it('suppresses completions only inside comments on the current line', () => {
    // Comment at line start.
    expect(isCompletionSuppressedContext('  // TODO: handle errors', 'typescript')).toBe(true);
    expect(isCompletionSuppressedContext(' * @param count', 'typescript')).toBe(true);
    expect(isCompletionSuppressedContext('-- sql comment', 'sql')).toBe(true);
    expect(isCompletionSuppressedContext('# python note', 'python')).toBe(true);
    expect(isCompletionSuppressedContext('# markdown heading', 'markdown')).toBe(true);
    // Same-line comment after code.
    expect(isCompletionSuppressedContext('const total = 0; // running total', 'typescript')).toBe(true);
    expect(isCompletionSuppressedContext('x = 1  # python same-line', 'python')).toBe(true);
    // Strings are quote-aware: URLs and hashes inside literals are not comments.
    expect(isCompletionSuppressedContext('const url = "https://example.com"', 'typescript')).toBe(false);
    expect(isCompletionSuppressedContext('const tag = "# not-a-comment"', 'python')).toBe(false);
    // `#` is code in these languages (private fields / preprocessor), a comment elsewhere.
    expect(isCompletionSuppressedContext('#count = 0;', 'typescript')).toBe(false);
    expect(isCompletionSuppressedContext('#include <stdio.h>', 'c')).toBe(false);
    // A comment line ABOVE the cursor must not suppress the code line.
    expect(isCompletionSuppressedContext('const value = ', 'typescript')).toBe(false);
    expect(isCompletionSuppressedContext('', 'typescript')).toBe(false);
    expect(isCompletionSuppressedContext('   ', 'typescript')).toBe(false);
  });

  it('drops an unterminated trailing line from multi-line completions', () => {
    // Balanced completions are untouched.
    expect(trimIncompleteTail('const a = 1;\nconst b = 2;')).toBe('const a = 1;\nconst b = 2;');
    // A dangling truncated expression loses its final partial line.
    expect(trimIncompleteTail('const a = 1;\nlogValue(')).toBe('const a = 1;');
    expect(trimIncompleteTail('function go() {\n  first();\n  second(')).toBe('function go() {\n  first();');
    // Trailing blank/whitespace lines are dropped.
    expect(trimIncompleteTail('const a = 1;\n   ')).toBe('const a = 1;');
    // Single-line completions are never trimmed (mid-token is normal).
    expect(trimIncompleteTail('42;')).toBe('42;');
    expect(trimIncompleteTail('logValue(')).toBe('logValue(');
    // Quotes are respected: brackets inside strings do not count.
    expect(trimIncompleteTail('const s = "(";\nconst t = "[";')).toBe('const s = "(";\nconst t = "[";');
    // A lone opener that is the entire completion is preserved (never empties).
    expect(trimIncompleteTail('if (ready) {')).toBe('if (ready) {');
    // cleanInlineCompletion applies the same guard end-to-end.
    const fence = String.fromCharCode(96).repeat(3);
    expect(cleanInlineCompletion(fence + 'ts\nconst ok = 1;\nconst partial = doThing(' + fence)).toBe('const ok = 1;');
  });

  it('exposes shared pacing constants used by the renderer provider', () => {
    expect(INLINE_COMPLETION_DEBOUNCE_MS).toBeGreaterThan(0);
    expect(INLINE_COMPLETION_THROTTLE_MS).toBeGreaterThanOrEqual(INLINE_COMPLETION_DEBOUNCE_MS);
  });
});
