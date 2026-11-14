import React, { useState, useCallback } from "react";
import { Search, X, FileText, ChevronRight, Loader2, Info, AlertTriangle, Copy } from "lucide-react";
import { api } from "../services/apiBridge.js";

interface CodebaseQAProps {
  /** Called when user wants to open a file at a specific line */
  onOpenFile?: (file: string, line: number) => void;
  /** Compact mode for inline use */
  compact?: boolean;
}

interface QAResult {
  kind: "definition" | "none";
  text: string;
  match?: { file: string; line: number; kind: string; symbol: string; snippet: string };
  matches: Array<{ file: string; line: number; kind: string; symbol: string; snippet: string }>;
  searchedFiles: number;
}

/**
 * Codebase Q&A Component (M1.4)
 * Allows asking "where is X defined?" and gets file:line with snippet
 * Uses /api/codebase/answer endpoint via api.answerCodebaseQuestion()
 */
export function CodebaseQA({ onOpenFile, compact = false }: CodebaseQAProps) {
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<QAResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [otherMatchesOpen, setOtherMatchesOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const askQuestion = useCallback(async () => {
    const q = question.trim();
    if (!q) return;
    
    setLoading(true);
    setError(null);
    setResult(null);
    
    try {
      const response = await api.answerCodebaseQuestion(q);
      if (response) {
        setResult(response);
        // Add to history
        setHistory(prev => [q, ...prev.filter(h => h !== q)].slice(0, 10));
      } else {
        setError("No answer available. Make sure you are in Agent mode and the workspace is indexed.");
      }
    } catch (e) {
      setError("Failed to query codebase. Check console for details.");
    } finally {
      setLoading(false);
    }
  }, [question]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      askQuestion();
    }
  };

  const clear = () => {
    setQuestion("");
    setResult(null);
    setError(null);
  };

  const copyResult = () => {
    if (result?.text) {
      void navigator.clipboard?.writeText(result.text).catch(() => undefined);
    }
  };

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask: where is X defined?"
          className="w-[200px] px-2 py-1.5 text-[11px] rounded-lg bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--text)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
          aria-label="Codebase question"
        />
        <button
          onClick={askQuestion}
          disabled={loading || !question.trim()}
          className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--hover)] disabled:opacity-40 transition-colors"
          aria-label="Ask codebase"
          title="Search codebase"
        >
          <Search size={14} className={loading ? "animate-spin" : ""} aria-hidden="true" />
        </button>
        {result && (
          <div className="flex items-center gap-1.5 text-[11px]">
            {result.kind === "definition" ? (
              <span className="text-emerald-400" title={result.match?.file + ":" + result.match?.line}>
                <FileText size={12} />
                Found: {result.match?.symbol} in {result.match?.file}:{result.match?.line}
              </span>
            ) : (
              <span className="text-amber-400">
                <AlertTriangle size={12} />
                Not found
              </span>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="p-3 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border)] min-w-[320px] max-w-[480px]">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-[13px] flex items-center gap-2">
          <Search size={16} className="text-[var(--accent)]" aria-hidden="true" />
          Codebase Q&A
        </h3>
        <span className="text-[10px] text-[var(--text-muted)]">M1.4</span>
      </div>

      <div className="space-y-3">
        {/* Input */}
        <div className="flex gap-2">
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="e.g. where is parseMissionState defined?"
            className="flex-1 px-3 py-2 text-[12px] rounded-lg bg-[var(--bg)] border border-[var(--border)] text-[var(--text)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
            aria-label="Codebase question"
            disabled={loading}
          />
          <button
            onClick={askQuestion}
            disabled={loading || !question.trim()}
            className="px-3 py-2 text-[12px] rounded-lg bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
            aria-label="Ask codebase"
          >
            {loading ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Search size={14} />}
          </button>
          {question && (
            <button onClick={clear} className="p-2 rounded-lg text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--hover)] transition-colors" aria-label="Clear question" title="Clear">
              <X size={14} />
            </button>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="p-3 rounded-lg bg-rose-900/20 border border-rose-800">
            <div className="flex items-center gap-2 text-rose-300">
              <AlertTriangle size={16} aria-hidden="true" />
              <span className="font-medium">Error</span>
            </div>
            <p className="mt-1 text-[11px] text-rose-400">{error}</p>
          </div>
        )}

        {/* Result */}
        {result && (
          <div className="space-y-3">
            {/* Primary match */}
            {result.kind === "definition" && result.match && (
              <div className="p-3 rounded-lg bg-emerald-900/20 border border-emerald-800">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <FileText size={16} className="text-emerald-400 shrink-0" aria-hidden="true" />
                    <div className="min-w-0">
                      <div className="font-medium text-emerald-300 truncate">
                        {result.match.symbol} <span className="text-[11px] text-emerald-400">({result.match.kind})</span>
                      </div>
                      <div className="text-[11px] text-[var(--text-muted)] font-mono truncate">
                        {result.match.file}:{result.match.line}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {onOpenFile && (
                      <button
                        onClick={() => onOpenFile(result.match!.file, result.match!.line)}
                        className="p-1.5 rounded text-emerald-300 hover:bg-emerald-900/30 transition-colors"
                        aria-label={`Open ${result.match!.file}:${result.match!.line}`}
                        title="Open in editor"
                      >
                        <ChevronRight size={12} />
                      </button>
                    )}
                    <button
                      onClick={copyResult}
                      className="p-1.5 rounded text-emerald-300 hover:bg-emerald-900/30 transition-colors"
                      aria-label="Copy answer"
                      title="Copy answer"
                    >
                      <Copy size={12} />
                    </button>
                  </div>
                </div>
                <pre className="p-2 rounded bg-[var(--bg)] border border-[var(--border)] text-[10px] font-mono text-[var(--text-muted)] overflow-x-auto max-h-32">
                  {result.match.snippet}
                </pre>
              </div>
            )}

            {/* Not found */}
            {result.kind === "none" && (
              <div className="p-3 rounded-lg bg-amber-900/20 border border-amber-800">
                <div className="flex items-center gap-2 text-amber-300">
                  <AlertTriangle size={16} aria-hidden="true" />
                  <span className="font-medium">No definition found</span>
                </div>
                <p className="mt-1 text-[11px] text-amber-400">
                  {result.text}
                </p>
                {result.searchedFiles > 0 && (
                  <p className="mt-1 text-[10px] text-[var(--text-muted)]">
                    Searched {result.searchedFiles} indexed file{result.searchedFiles !== 1 ? "s" : ""}.
                  </p>
                )}
              </div>
            )}

            {/* Other matches */}
            {result.matches.length > 1 && (
              <details className="group">
                <summary
                  className="cursor-pointer text-[11px] text-[var(--text-muted)] hover:text-[var(--text)] flex items-center gap-1.5"
                  aria-expanded={otherMatchesOpen}
                  onClick={(e) => {
                    e.preventDefault();
                    setOtherMatchesOpen(!otherMatchesOpen);
                  }}
                >
                  <ChevronRight size={12} className={`group-open:rotate-90 transition-transform ${otherMatchesOpen ? "rotate-90" : ""}`} aria-hidden="true" />
                  {result.matches.length - 1} other match{result.matches.length - 1 !== 1 ? "es" : ""}
                </summary>
                <div className="mt-2 space-y-2 ml-4">
                  {result.matches.slice(1).map((m, i) => (
                    <div key={i} className="p-2 rounded bg-[var(--bg)] border border-[var(--border)]">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <FileText size={14} className="text-[var(--text-muted)]" aria-hidden="true" />
                          <div className="min-w-0">
                            <div className="font-mono text-[11px] text-[var(--text)] truncate">
                              {m.symbol} <span className="text-[var(--text-muted)]">({m.kind})</span>
                            </div>
                            <div className="text-[10px] text-[var(--text-muted)] font-mono truncate">
                              {m.file}:{m.line}
                            </div>
                          </div>
                        </div>
                        {onOpenFile && (
                          <button
                            onClick={() => onOpenFile(m.file, m.line)}
                            className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--hover)] transition-colors"
                            aria-label={`Open ${m.file}:${m.line}`}
                            title="Open in editor"
                          >
                            <ChevronRight size={10} />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            )}

            <div className="text-[10px] text-[var(--text-muted)]">
              Searched {result.searchedFiles} file{result.searchedFiles !== 1 ? "s" : ""}
            </div>
          </div>
        )}

        {/* History */}
        {history.length > 0 && !loading && (
          <details className="group border-t border-[var(--border)] pt-3">
            <summary
              className="cursor-pointer text-[11px] text-[var(--text-muted)] hover:text-[var(--text)] flex items-center gap-1.5"
              aria-expanded={historyOpen}
              onClick={(e) => {
                e.preventDefault();
                setHistoryOpen(!historyOpen);
              }}
            >
              <Info size={12} aria-hidden="true" />
              Recent questions
              <ChevronRight size={12} className={`group-open:rotate-90 transition-transform ${historyOpen ? "rotate-90" : ""}`} aria-hidden="true" />
            </summary>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {history.map((h, i) => (
                <button
                  key={i}
                  onClick={() => { setQuestion(h); askQuestion(); }}
                  disabled={loading}
                  className="px-2 py-1 text-[10px] rounded bg-[var(--bg)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] hover:border-[var(--accent)] transition-colors disabled:opacity-50 truncate max-w-[140px]"
                  title={h}
                >
                  {h}
                </button>
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}
