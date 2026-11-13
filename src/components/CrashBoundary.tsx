import React, { useState } from "react";

/**
 * Production crash boundary (roadmap M9.9).
 *
 * Wraps the whole React tree so an uncaught render error shows a branded
 * recovery screen (Restart / Recover / Report) instead of a blank window.
 *
 * Self-contained so it can render even when the failure is inside the app's own
 * module graph: no external icon or network dependencies, and a tiny local
 * credential scrubber (no `node:crypto`, which would break the browser bundle).
 */

export const QUILLIX_APP_VERSION = "1.2.0";
export const CRASH_STORAGE_KEY = "quillix_last_crash";

export interface CrashReport {
  id: string;
  time: string;
  message: string;
  stack: string;
  componentStack: string;
  version: string;
  page: string;
}

/** Minimal, dependency-free credential scrubber for crash text. */
export function redactCrashText(input: string): string {
  return String(input ?? "")
    .replace(/AIza[0-9A-Za-z_-]{35}/g, "[REDACTED_API_KEY]")
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[REDACTED_KEY]")
    .replace(/\b(?:gsk|hf|xox[baprs]|glpat|gh[pousr])_[A-Za-z0-9_-]{12,}\b/g, "[REDACTED_KEY]")
    .replace(/(Bearer\s+)[A-Za-z0-9._-]{8,}/gi, "$1[REDACTED]")
    .replace(/((?:api[_-]?key|authorization|token|secret|password)\s*[:=]\s*["\"]?)[^"\"]{8,}/gi, "$1[REDACTED]");
}

function newCrashId(): string {
  return `qx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

interface BoundaryState {
  error: Error | null;
  info: React.ErrorInfo | null;
}

export class QuillixErrorBoundary extends React.Component<React.PropsWithChildren<Record<string, unknown>>, BoundaryState> {
  state: BoundaryState = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<BoundaryState> {
    return { error: error || new Error("Unknown render error") };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    this.setState({ info });
    const report: CrashReport = {
      id: newCrashId(),
      time: new Date().toISOString(),
      message: redactCrashText(String(error?.message ?? error)),
      stack: redactCrashText(String(error?.stack ?? "")).slice(0, 4000),
      componentStack: redactCrashText(String(info?.componentStack ?? "")).slice(0, 4000),
      version: QUILLIX_APP_VERSION,
      page: typeof location !== "undefined" ? location.pathname : "",
    };
    try {
      localStorage.setItem(CRASH_STORAGE_KEY, JSON.stringify(report));
    } catch {
      // Storage may be unavailable (private mode, quota) — never block the UI.
    }
    // A desktop log sink can be wired over IPC later; console keeps it visible now.
    console.error("[NUVRO AI] renderer error captured by crash boundary:", report);
  }

  private reload = (): void => {
    if (typeof window !== "undefined") window.location.reload();
  };

  private recover = (): void => {
    // Drop transient, possibly-corrupt renderer state; keep user preferences.
    // Server-side settings, keys and workspace data are untouched and survive.
    try {
      const keep = new Set(["quillix_theme", "quillix_agent_width"]);
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key) keys.push(key);
      }
      for (const key of keys) {
        if (key.startsWith("quillix_") && !keep.has(key)) localStorage.removeItem(key);
      }
    } catch {
      // Ignore — server-side settings remain the source of truth.
    }
    this.reload();
  };

  private copyReport = async (): Promise<void> => {
    try {
      const raw = localStorage.getItem(CRASH_STORAGE_KEY);
      const text = raw ?? JSON.stringify({ time: new Date().toISOString(), message: "Unknown render error", version: QUILLIX_APP_VERSION });
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard permission may be blocked; the report is also in the devtools console.
    }
  };

  render(): React.ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <CrashScreen
        error={this.state.error}
        info={this.state.info}
        onRestart={this.reload}
        onRecover={this.recover}
        onReport={this.copyReport}
      />
    );
  }
}

function IconAlert() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function IconRotate() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  );
}

function IconLife() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="4" />
      <line x1="4.93" y1="4.93" x2="9.17" y2="9.17" />
      <line x1="14.83" y1="14.83" x2="19.07" y2="19.07" />
      <line x1="14.83" y1="9.17" x2="19.07" y2="4.93" />
      <line x1="4.93" y1="19.07" x2="9.17" y2="14.83" />
    </svg>
  );
}

function IconCopy() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CrashScreen(props: { error: Error; info: React.ErrorInfo | null; onRestart: () => void; onRecover: () => void; onReport: () => void }) {
  const { error, info, onRestart, onRecover, onReport } = props;
  const message = redactCrashText(String(error?.message ?? error));
  const componentStack = redactCrashText(String(info?.componentStack ?? "")).trim();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const screenStyle: React.CSSProperties = {
    minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
    padding: 24, background: "radial-gradient(1200px 600px at 50% -10%, var(--surface-secondary, #171a22), var(--bg, #0b0e14))",
    color: "var(--text, #e6e8ee)",
    fontFamily: "ui-sans-serif, system-ui, \"Segoe UI\", Roboto, Helvetica, Arial, sans-serif",
  };
  const cardStyle: React.CSSProperties = {
    width: "min(580px, 94vw)", padding: "28px 28px 22px", borderRadius: 18,
    background: "var(--surface, #12151c)", border: "1px solid var(--border, #23262e)",
    boxShadow: "0 30px 90px rgba(0,0,0,0.5)",
  };
  const badgeStyle: React.CSSProperties = {
    width: 46, height: 46, borderRadius: 14, display: "grid", placeItems: "center",
    color: "#fff", background: "linear-gradient(135deg, #ff6a3d, #ff2d55)", boxShadow: "0 8px 24px rgba(255,45,85,0.35)",
  };
  const buttonBase: React.CSSProperties = {
    display: "inline-flex", alignItems: "center", gap: 8, height: 40, padding: "0 16px",
    borderRadius: 10, border: "1px solid var(--border, #2a2e38)", cursor: "pointer",
    fontSize: 13, fontWeight: 600, background: "var(--surface-secondary, #1a1e26)", color: "var(--text, #e6e8ee)",
  };
  const primaryButton: React.CSSProperties = {
    ...buttonBase, border: "1px solid transparent",
    background: "linear-gradient(135deg, #00b4ff, #0066ff)", color: "#fff", boxShadow: "0 8px 22px rgba(0,102,255,0.35)",
  };
  return (
    <div role="alertdialog" aria-modal="true" aria-label="NUVRO AI crashed" style={screenStyle}>
      <div style={cardStyle}>
        <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
          <div style={badgeStyle}><IconAlert /></div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700, letterSpacing: "-0.02em" }}>NUVRO AI hit an unexpected error</h1>
            <p style={{ margin: "6px 0 0", fontSize: 13, lineHeight: 1.5, color: "var(--text-muted, #9aa3b2)" }}>
              Your work and settings are safe. Server-side settings, keys and workspace data are preserved — this was an interface error.
            </p>
          </div>
        </div>

        <details style={{ marginTop: 18, borderRadius: 12, border: "1px solid var(--border, #23262e)", background: "var(--surface-secondary, #12151c)", padding: "10px 14px" }}>
          <summary
            style={{ cursor: "pointer", fontSize: 12, fontWeight: 600, color: "var(--text-muted, #9aa3b2)" }}
            aria-expanded={detailsOpen}
            onClick={(e) => {
              e.preventDefault();
              setDetailsOpen(!detailsOpen);
            }}
          >
            Technical details
          </summary>
          <pre style={{ margin: "10px 0 0", fontSize: 12, lineHeight: 1.45, whiteSpace: "pre-wrap", wordBreak: "break-word", color: "var(--text, #e6e8ee)", maxHeight: 200, overflow: "auto" }}>
            {message}
            {componentStack ? `\n\nComponent stack:\n${componentStack.slice(0, 1200)}` : ""}
          </pre>
        </details>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 20 }}>
          <button type="button" onClick={onRestart} style={primaryButton} aria-label="Restart NUVRO AI"><IconRotate /> Restart app</button>
          <button type="button" onClick={onRecover} style={buttonBase} aria-label="Recover workspace"><IconLife /> Recover workspace</button>
          <button type="button" onClick={onReport} style={{ ...buttonBase, background: "transparent" }} aria-label="Copy crash report"><IconCopy /> Copy crash report</button>
        </div>

        <p style={{ margin: "16px 0 0", fontSize: 11, color: "var(--text-muted, #9aa3b2)" }}>
          NUVRO AI {QUILLIX_APP_VERSION} · Nothing was written to your project. If this repeats, copy the crash report and share it with support.
        </p>
      </div>
    </div>
  );
}

export default QuillixErrorBoundary;
