import { describe, expect, it } from 'vitest';
import { buildInlineCompletionPrompt, cleanInlineCompletion, INLINE_COMPLETION_LANGUAGES, InlineCompletionCache, inlineCompletionCacheKey, subscribeInlineCancellation, trimCompletionContext } from '../../shared/inlineCompletion.js';

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
});
