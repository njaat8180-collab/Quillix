/**
 * M7.4: contextual chat (inline in the editor).
 *
 * "Ask about this line" must send the model *the line the user pointed at*,
 * not the whole file and not a bare question. This module owns the parts that
 * can be proven without a browser:
 *
 *   - which lines form the context window around the anchor,
 *   - how the anchor is rendered into the prompt,
 *   - where the answer bubble is anchored on screen,
 *   - and the rules that keep the request bounded (a huge file must not be
 *     pasted into a chat request).
 *
 * The renderer and the server both use these helpers so the two can never
 * disagree about what "line 42" means.
 */

/** Hard ceiling on the characters of file content sent with a question. */
export const CONTEXTUAL_CHAT_MAX_CONTEXT_CHARS = 12_000;

/** How many lines above/below the anchor are included by default. */
export const CONTEXTUAL_CHAT_CONTEXT_LINES = 12;

/** A line the user pointed at, together with the text around it. */
export interface ContextualChatAnchor {
  /** Workspace-relative path of the file the question is about. */
  filePath: string;
  /** 1-based line number the user pointed at. */
  line: number;
  /** The full text of the file as it is currently in the editor. */
  content: string;
}

/** The slice of a file that is sent with the question. */
export interface ContextualChatContext {
  /** 1-based first line included in the context. */
  startLine: number;
  /** 1-based last line included in the context (inclusive). */
  endLine: number;
  /** The extracted text, with the anchor line marked. */
  text: string;
  /** True when the file was too large and the context was truncated. */
  truncated: boolean;
}

/** The anchor as it should be drawn next to the line. */
export interface ContextualChatBubblePosition {
  /** Vertical offset in pixels from the top of the editor viewport. */
  top: number;
  /** Horizontal offset in pixels from the left of the editor viewport. */
  left: number;
  /** Where the bubble should be placed to stay on screen. */
  placement: 'above' | 'below';
}

/** Normalise a raw line number into a usable 1-based line number. */
export function normalizeAnchorLine(line: unknown, totalLines: number): number {
  const parsed = typeof line === 'number' ? Math.trunc(line) : Number.parseInt(String(line ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  if (totalLines > 0 && parsed > totalLines) return totalLines;
  return parsed;
}

/**
 * Extract the context window around the anchor line.
 *
 * The window is symmetric around the anchor and is clipped to the file. If the
 * resulting text would exceed the character ceiling, the window shrinks from
 * the far side first and `truncated` is set so the UI can say so honestly.
 */
export function buildContextualChatContext(
  anchor: ContextualChatAnchor,
  options: { contextLines?: number; maxChars?: number } = {},
): ContextualChatContext {
  const contextLines = Math.max(1, Math.trunc(options.contextLines ?? CONTEXTUAL_CHAT_CONTEXT_LINES));
  const maxChars = Math.max(500, Math.trunc(options.maxChars ?? CONTEXTUAL_CHAT_MAX_CONTEXT_CHARS));
  const source = typeof anchor.content === 'string' ? anchor.content : '';
  const lines = source.split('\n');
  const totalLines = lines.length;
  const anchorLine = normalizeAnchorLine(anchor.line, totalLines);

  let startLine = Math.max(1, anchorLine - contextLines);
  let endLine = Math.min(totalLines, anchorLine + contextLines);

  // Shrink the window until the rendered context fits the character budget.
  // The anchor line itself is never dropped: a question about "this line" is
  // meaningless without it.
  const render = (from: number, to: number) => {
    const out: string[] = [];
    for (let n = from; n <= to; n += 1) {
      const text = lines[n - 1] ?? '';
      out.push(n === anchorLine ? `>>> ${text}` : `    ${text}`);
    }
    return out.join('\n');
  };

  let text = render(startLine, endLine);
  let truncated = false;
  while (text.length > maxChars && endLine - startLine > 1) {
    // Drop the far side first: keep the anchor and its immediate neighbours.
    if (anchorLine - startLine >= endLine - anchorLine) startLine += 1;
    else endLine -= 1;
    text = render(startLine, endLine);
    truncated = true;
  }
  if (text.length > maxChars) {
    text = text.slice(0, maxChars);
    truncated = true;
  }

  return { startLine, endLine, text, truncated };
}

/**
 * Build the prompt for a contextual question.
 *
 * The prompt names the file and the exact anchor line so the answer can talk
 * about "line 42" and cite it back.
 */
export function buildContextualChatPrompt(anchor: ContextualChatAnchor, question: string, options: { contextLines?: number; maxChars?: number } = {}): string {
  const trimmedQuestion = typeof question === 'string' ? question.trim() : '';
  if (!trimmedQuestion) return '';
  const context = buildContextualChatContext(anchor, options);
  const line = normalizeAnchorLine(anchor.line, context.endLine);
  const truncatedNote = context.truncated
    ? '\n(The file is large; only the lines around the anchor are shown.)'
    : '';
  return [
    `The user is asking about ${anchor.filePath}, line ${line}.`,
    '',
    'Relevant code (the anchor line is marked with ">>>"):',
    context.text,
    truncatedNote,
    '',
    `Question: ${trimmedQuestion}`,
    '',
    'Answer concisely and refer to the line numbers above when they help.',
  ].filter((part) => part !== '').join('\n');
}

/**
 * Place the answer bubble next to the anchor line.
 *
 * The bubble is kept inside the viewport: it flips below the line when there is
 * not enough room above, and it is clamped horizontally so it never leaves the
 * editor.
 */
export function positionContextualChatBubble(
  lineTop: number,
  lineHeight: number,
  bubbleWidth: number,
  bubbleHeight: number,
  viewport: { width: number; height: number },
): ContextualChatBubblePosition {
  const safeLineHeight = Math.max(1, lineHeight);
  const gap = 6;
  // A bubble that is larger than the viewport can never fit: clamp the
  // effective size so the returned position is honest about what fits.
  const effectiveWidth = Math.max(0, Math.min(bubbleWidth, Math.max(0, viewport.width)));
  const effectiveHeight = Math.max(0, Math.min(bubbleHeight, Math.max(0, viewport.height)));
  const roomAbove = lineTop;
  const roomBelow = Math.max(0, viewport.height - (lineTop + safeLineHeight));

  let placement: 'above' | 'below' = 'above';
  let top = lineTop - effectiveHeight - gap;
  if (roomAbove < effectiveHeight + gap && roomBelow >= effectiveHeight + gap) {
    placement = 'below';
    top = lineTop + safeLineHeight + gap;
  }
  if (top < 0) top = 0;
  if (top + effectiveHeight > viewport.height) top = Math.max(0, viewport.height - effectiveHeight);

  const left = Math.max(0, Math.min(viewport.width - effectiveWidth, 16));
  return { top, left, placement };
}

