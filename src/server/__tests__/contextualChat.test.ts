import { describe, expect, it } from 'vitest';
import {
  CONTEXTUAL_CHAT_CONTEXT_LINES,
  CONTEXTUAL_CHAT_MAX_CONTEXT_CHARS,
  buildContextualChatContext,
  buildContextualChatPrompt,
  normalizeAnchorLine,
  positionContextualChatBubble,
} from '../../shared/contextualChat.js';

const file = (lines: number) => Array.from({ length: lines }, (_, i) => `line ${i + 1}`).join('\n');

describe('contextual chat (M7.4)', () => {
  it('normalises the anchor line into a usable 1-based number', () => {
    expect(normalizeAnchorLine(42, 100)).toBe(42);
    expect(normalizeAnchorLine(0, 100)).toBe(1);
    expect(normalizeAnchorLine(-7, 100)).toBe(1);
    expect(normalizeAnchorLine(500, 100)).toBe(100);
    expect(normalizeAnchorLine('17', 100)).toBe(17);
    expect(normalizeAnchorLine('not a number', 100)).toBe(1);
    expect(normalizeAnchorLine(undefined, 100)).toBe(1);
  });

  it('extracts a symmetric window around the anchor and marks it', () => {
    const anchor = { filePath: 'src/a.ts', line: 50, content: file(100) };
    const context = buildContextualChatContext(anchor);
    expect(context.startLine).toBe(50 - CONTEXTUAL_CHAT_CONTEXT_LINES);
    expect(context.endLine).toBe(50 + CONTEXTUAL_CHAT_CONTEXT_LINES);
    expect(context.truncated).toBe(false);
    // Exactly one line is marked, and it is the anchor.
    const marked = context.text.split('\n').filter(line => line.startsWith('>>> '));
    expect(marked).toHaveLength(1);
    expect(marked[0]).toBe('>>> line 50');
  });

  it('clips the window at the start and end of the file', () => {
    // A 10-line file cannot have a window wider than the file.
    const context = buildContextualChatContext({ filePath: 'a.ts', line: 2, content: file(10) });
    expect(context.startLine).toBe(1);
    expect(context.endLine).toBe(10);
    // Anchoring on the first line still opens a full window downwards.
    const first = buildContextualChatContext({ filePath: 'a.ts', line: 1, content: file(30) });
    expect(first.startLine).toBe(1);
    expect(first.endLine).toBe(1 + CONTEXTUAL_CHAT_CONTEXT_LINES);
  });

  it('shrinks the window instead of sending an oversized file', () => {
    const huge = Array.from({ length: 5000 }, (_, i) => 'x'.repeat(200) + i).join('\n');
    const context = buildContextualChatContext(
      { filePath: 'big.ts', line: 2500, content: huge },
      { maxChars: 2000 },
    );
    expect(context.text.length).toBeLessThanOrEqual(2000);
    expect(context.truncated).toBe(true);
    // The anchor line itself is never dropped: a question about "this line"
    // is meaningless without it.
    expect(context.text).toContain('>>> ');
    expect(context.startLine).toBeLessThanOrEqual(2500);
    expect(context.endLine).toBeGreaterThanOrEqual(2500);
  });

  it('never exceeds the default character ceiling for a huge file', () => {
    const huge = 'y'.repeat(CONTEXTUAL_CHAT_MAX_CONTEXT_CHARS * 3);
    const context = buildContextualChatContext({ filePath: 'big.ts', line: 1, content: huge });
    expect(context.text.length).toBeLessThanOrEqual(CONTEXTUAL_CHAT_MAX_CONTEXT_CHARS);
    expect(context.truncated).toBe(true);
  });

  it('builds a prompt that names the file and the anchor line', () => {
    const prompt = buildContextualChatPrompt(
      { filePath: 'src/server/git.ts', line: 12, content: file(30) },
      'Why is this safe?',
    );
    expect(prompt).toContain('src/server/git.ts');
    expect(prompt).toContain('line 12');
    expect(prompt).toContain('Why is this safe?');
    expect(prompt).toContain('>>> line 12');
  });

  it('refuses to build a prompt without a question', () => {
    expect(buildContextualChatPrompt({ filePath: 'a.ts', line: 1, content: file(3) }, '')).toBe('');
    expect(buildContextualChatPrompt({ filePath: 'a.ts', line: 1, content: file(3) }, '   ')).toBe('');
  });

  it('says so honestly when the context was truncated', () => {
    const huge = Array.from({ length: 3000 }, (_, i) => 'z'.repeat(300) + i).join('\n');
    const prompt = buildContextualChatPrompt(
      { filePath: 'big.ts', line: 1500, content: huge },
      'What does this do?',
      { maxChars: 1500 },
    );
    expect(prompt).toContain('The file is large');
  });

  it('places the bubble above the line when there is room', () => {
    const position = positionContextualChatBubble(400, 20, 320, 180, { width: 800, height: 600 });
    expect(position.placement).toBe('above');
    expect(position.top).toBe(400 - 180 - 6);
  });

  it('flips the bubble below the line when there is no room above', () => {
    const position = positionContextualChatBubble(20, 20, 320, 180, { width: 800, height: 600 });
    expect(position.placement).toBe('below');
    expect(position.top).toBe(20 + 20 + 6);
  });

  it('keeps the bubble inside the viewport', () => {
    const position = positionContextualChatBubble(10, 20, 320, 180, { width: 300, height: 200 });
    expect(position.top).toBeGreaterThanOrEqual(0);
    expect(position.top + 180).toBeLessThanOrEqual(200);
    expect(position.left).toBeGreaterThanOrEqual(0);
    // The bubble is wider than the viewport, so it is clamped to the viewport
    // width: it must not report a position that puts it off-screen.
    expect(position.left + Math.min(320, 300)).toBeLessThanOrEqual(300);
  });

  it('never produces a negative offset for a degenerate viewport', () => {
    const position = positionContextualChatBubble(0, 0, 320, 180, { width: 0, height: 0 });
    expect(position.top).toBeGreaterThanOrEqual(0);
    expect(position.left).toBeGreaterThanOrEqual(0);
  });
});
