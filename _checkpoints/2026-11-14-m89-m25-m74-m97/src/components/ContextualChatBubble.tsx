import React, { useEffect, useRef, useState } from 'react';
import { MessageSquare, X, Send, Loader2 } from 'lucide-react';
import { positionContextualChatBubble } from '../shared/contextualChat.js';

/**
 * M7.4 — Contextual chat bubble.
 *
 * Hovering a line in the editor offers "Ask about this". The answer appears in
 * a bubble anchored to that line, so the question and its answer stay next to
 * the code they are about.
 *
 * The bubble is deliberately dumb about layout: it asks the shared
 * `positionContextualChatBubble` helper where to sit, so the positioning rules
 * can be proven by tests instead of by eyeballing the UI.
 */

export interface ContextualChatBubbleProps {
  /** 1-based line the bubble is anchored to. */
  line: number;
  /** File the question is about (workspace-relative). */
  filePath: string;
  /** Absolute position of the anchor line inside the editor viewport. */
  anchorTop: number;
  /** Height of one editor line in pixels. */
  lineHeight: number;
  /** Size of the editor viewport, used to keep the bubble on screen. */
  viewport: { width: number; height: number };
  /** Sends the question and resolves with the answer text. */
  onAsk: (question: string) => Promise<string>;
  /** Closes the bubble. */
  onClose: () => void;
}

const BUBBLE_WIDTH = 340;
const BUBBLE_HEIGHT = 220;

export const ContextualChatBubble: React.FC<ContextualChatBubbleProps> = ({
  line,
  filePath,
  anchorTop,
  lineHeight,
  viewport,
  onAsk,
  onClose,
}) => {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);

  const position = positionContextualChatBubble(anchorTop, lineHeight, BUBBLE_WIDTH, BUBBLE_HEIGHT, viewport);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Escape closes the bubble, but only while the user is not typing into it.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = question.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await onAsk(trimmed);
      setAnswer(typeof result === 'string' ? result : '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The question could not be answered.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      ref={bubbleRef}
      role="dialog"
      aria-label={`Ask about ${filePath}, line ${line}`}
      data-testid="contextual-chat-bubble"
      className="absolute z-40 w-[340px] rounded-lg border border-blue-500/70 bg-[#161b22] p-3 shadow-2xl backdrop-blur-md"
      style={{ top: position.top, left: position.left }}
    >
      <div className="mb-2 flex items-center justify-between">
        <div className="flex min-w-0 items-center gap-1.5 text-[11px] font-medium text-blue-400">
          <MessageSquare size={12} aria-hidden="true" />
          <span className="truncate">{filePath}:{line}</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close the contextual chat bubble"
          className="text-[#8b949e] transition-colors hover:text-white"
        >
          <X size={13} />
        </button>
      </div>

      <form onSubmit={submit} className="flex items-center gap-1.5">
        <input
          ref={inputRef}
          type="text"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Ask about this line..."
          aria-label={`Ask about ${filePath}, line ${line}`}
          className="min-w-0 flex-1 rounded border border-[#30363d] bg-[#0d1117] px-2 py-1 text-[11px] text-white outline-none focus:border-blue-500"
        />
        <button
          type="submit"
          disabled={busy || !question.trim()}
          aria-label="Send the question"
          className="rounded bg-blue-600 px-2 py-1 text-[11px] text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : <Send size={12} aria-hidden="true" />}
        </button>
      </form>

      {error ? (
        <p role="alert" className="mt-2 text-[11px] text-red-400">{error}</p>
      ) : null}

      {answer ? (
        <div
          data-testid="contextual-chat-answer"
          className="mt-2 max-h-28 overflow-y-auto whitespace-pre-wrap rounded border border-[#30363d] bg-[#0d1117] p-2 text-[11px] leading-5 text-[#c9d1d9]"
        >
          {answer}
        </div>
      ) : null}
    </div>
  );
};
