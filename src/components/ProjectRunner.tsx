import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Play, Square, RotateCw, ChevronDown, ChevronUp, Terminal as TerminalIcon, MonitorPlay, Package } from 'lucide-react';
import { ProjectProfile, ProjectRunInfo } from '../shared/types.js';
import { api } from '../services/apiBridge.js';

interface ProjectRunnerProps {
  /** Absolute workspace root. */
  workspaceRoot: string;
  /** Incremented whenever the tree/agent output changes — re-detects the project. */
  refreshSignal?: number;
  /** Fired when the user opens the built-in web preview (root is workspace-relative). */
  onOpenPreview: (info: { root: string; entry: string; title: string }) => void;
  /** Keeps the editor toolbar aware of whether the current project can preview. */
  onPreviewAvailabilityChange?: (info: { root: string; entry: string; title: string } | null) => void;
  disabled?: boolean;
}

/**
 * The RUN / PREVIEW system.
 * Detects the project in the active workspace via the language-runner API and
 * provides a real RUN button that spawns the actual project process (with live
 * output, exit status, stop and restart). Web projects get a PREVIEW button
 * that opens the built-in preview instead.
 */
export const ProjectRunner: React.FC<ProjectRunnerProps> = ({ workspaceRoot, refreshSignal, onOpenPreview, onPreviewAvailabilityChange, disabled = false }) => {
  const [profile, setProfile] = useState<ProjectProfile | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [starting, setStarting] = useState(false);
  const [run, setRun] = useState<ProjectRunInfo | null>(null);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const outputEndRef = useRef<HTMLDivElement>(null);

  // --- Project detection (re-runs when the workspace or tree changes) ------
  const detect = useCallback(async () => {
    if (!workspaceRoot) return;
    setDetecting(true);
    try {
      const res = await api.detectProject(workspaceRoot);
      if (res.success && res.profile) {
        setProfile(res.profile);
        onPreviewAvailabilityChange?.(res.profile.previewable && res.profile.previewEntry
          ? { root: '', entry: res.profile.previewEntry, title: res.profile.languageLabel || 'Web' }
          : null);
      } else {
        setProfile(null);
        // Let EditorArea choose an open/indexed HTML file. Assuming a root
        // index.html breaks workspaces that contain nested generated projects.
        onPreviewAvailabilityChange?.(null);
      }
    } catch {
      setProfile(null);
      onPreviewAvailabilityChange?.(null);
    } finally {
      setDetecting(false);
    }
  }, [workspaceRoot, onPreviewAvailabilityChange]);

  useEffect(() => {
    detect();
  }, [detect, refreshSignal]);

  // --- Live run status polling ---------------------------------------------
  useEffect(() => {
    if (run?.status === 'running') {
      pollTimer.current = setInterval(async () => {
        try {
          const res = await api.getProjectRunStatus(run.id);
          if (res.success && res.run) {
            setRun(res.run);
          }
        } catch {
          // server briefly unreachable — keep polling
        }
      }, 1200);
    }
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
    };
  }, [run?.status, run?.id]);

  // Auto-open the console when a run starts; scroll output.
  useEffect(() => {
    if (run) setConsoleOpen(true);
  }, [run?.id]);

  useEffect(() => {
    outputEndRef.current?.scrollIntoView({ block: 'nearest' });
  }, [run?.output]);

  // --- Actions --------------------------------------------------------------
  /** Strips the workspace prefix so preview URLs stay workspace-relative. */
  const toWorkspaceRelative = useCallback(
    (absRoot: string): string => {
      const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '');
      const ws = norm(workspaceRoot);
      const root = norm(absRoot);
      return root.startsWith(ws) ? root.slice(ws.length).replace(/^\/+/, '') : root;
    },
    [workspaceRoot]
  );

  const handleRun = useCallback(async () => {
    if (disabled) return;
    if (!workspaceRoot || starting) return;
    setStarting(true);
    try {
      const res = await api.runProject(workspaceRoot);
      if (res.previewOnly && res.previewEntry) {
        onOpenPreview({ root: toWorkspaceRelative(res.root || workspaceRoot), entry: res.previewEntry, title: profile?.languageLabel || 'Web' });
        return;
      }
      if (res.run) {
        setRun(res.run);
      } else if (res.error) {
        setRun(null);
        window.alert(`Could not start the project: ${res.error}`);
      }
    } catch (err: any) {
      window.alert(`Could not start the project: ${err?.message || err}`);
    } finally {
      setStarting(false);
    }
  }, [workspaceRoot, starting, profile, onOpenPreview, disabled]);

  const handlePreview = useCallback(() => {
    if (disabled) return;
    onOpenPreview({
      root: '',
      entry: profile?.previewable && profile.previewEntry ? profile.previewEntry : 'index.html',
      title: profile?.previewable ? (profile.languageLabel || 'Web') : 'Web',
    });
  }, [profile, onOpenPreview, disabled]);

  const handleStop = useCallback(async () => {
    if (!run) return;
    await api.stopProjectRun(run.id);
  }, [run]);

  const handleRestart = useCallback(async () => {
    await handleRun();
  }, [handleRun]);

  // --- Rendering --------------------------------------------------------------
  if (!workspaceRoot) return null;

  const runnable = !!profile?.runCommand && profile.runtimeAvailable;
  // Keep Preview available while detection is pending or when the workspace
  // is not a web project. EditorArea supplies an open/indexed HTML fallback.
  const previewable = !!workspaceRoot;
  const noButton = !runnable && !previewable;
  const busy = starting || detecting;

  const statusColor =
    run?.status === 'running'
      ? 'var(--accent)'
      : run?.status === 'exited'
        ? 'var(--success)'
        : run?.status === 'failed'
          ? 'var(--danger)'
          : 'var(--text-muted)';

  return (
    <div className="shrink-0 border-b border-[var(--border)] bg-[var(--surface)]">
      <div className="h-9 px-2.5 flex items-center justify-between gap-2">
        {/* Left: detected project info */}
        <div className="flex items-center gap-2 min-w-0">
          <Package size={13} className="text-[var(--text-muted)] shrink-0" />
          <span
            className="text-[11px] font-semibold text-[var(--text)] truncate"
            title={profile ? profile.detectionNotes.join(' · ') : 'No project detected'}
          >
            {detecting ? 'Detecting project…' : profile ? `${profile.languageLabel} · ${profile.projectType}` : 'No runnable project detected'}
          </span>
          {runnable && profile?.entryPoint && (
            <span className="text-[10.5px] font-mono text-[var(--text-muted)] truncate hidden lg:inline" title={`Entry: ${profile.entryPoint}`}>
              {profile.entryPoint}
            </span>
          )}
          {run && (
            <span
              className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded shrink-0"
              style={{ color: statusColor, background: 'color-mix(in srgb, var(--surface-secondary) 80%, transparent)' }}
            >
              {run.status === 'running' ? '● Running' : run.status === 'exited' ? '● Exited 0' : run.status === 'failed' ? `● Failed (${run.exitCode})` : '● Stopped'}
            </span>
          )}
        </div>

        {/* Right: RUN / PREVIEW / STOP / RESTART */}
        <div className="flex items-center gap-1.5 shrink-0">
          {run?.status === 'running' ? (
            <>
              <button
                onClick={handleStop}
                className="q-transition flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11.5px] font-semibold text-white"
                style={{ background: 'var(--danger)' }}
                title="Stop the running project process"
              >
                <Square size={12} /> Stop
              </button>
            </>
          ) : (
            <>
              {previewable && (
                <button
                  onClick={handlePreview}
                  disabled={disabled}
                  className="q-transition flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11.5px] font-semibold text-white"
                  style={{ background: 'var(--accent)' }}
                  title="Open the website in the built-in QUILLIX preview"
                >
                  <MonitorPlay size={12} /> Preview
                </button>
              )}
              {runnable && (
                <button
                  onClick={handleRun}
                  disabled={disabled || busy}
                  className="q-transition flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[11.5px] font-semibold text-white disabled:opacity-50"
                  style={{ background: 'var(--accent)' }}
                  title={profile ? `Execute: ${profile.runCommand}` : 'Run the project'}
                >
                  {run ? <RotateCw size={12} /> : <Play size={12} />}
                  {run ? 'Restart' : 'Run'}
                </button>
              )}
              {noButton && profile && (
                <span className="text-[10.5px] text-[var(--text-muted)]" title={profile.detectionNotes.join('\n')}>
                  {profile.runCommand ? `Runtime "${profile.runtimeBinary}" not installed` : 'Not runnable'}
                </span>
              )}
            </>
          )}
          {run && (
            <button
              onClick={() => setConsoleOpen((v) => !v)}
              className="q-transition p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--hover)]"
              title={consoleOpen ? 'Hide run console' : 'Show run console'}
              aria-label="Toggle run console"
            >
              {consoleOpen ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
            </button>
          )}
        </div>
      </div>

      {/* Run console: live output of the real project process */}
      {run && consoleOpen && (
        <div className="border-t border-[var(--border)] bg-[#0d1117] flex flex-col" style={{ height: 180 }}>
          <div className="h-7 px-2.5 flex items-center justify-between border-b border-[#30363d]">
            <div className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-[#8b949e]">
              <TerminalIcon size={11} />
              <span>Run Console — {run.command}</span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={handleStop}
                disabled={run.status !== 'running'}
                className="q-transition p-1 rounded text-[#8b949e] hover:text-white hover:bg-[#21262d] disabled:opacity-40"
                title="Stop process"
              >
                <Square size={11} />
              </button>
              <button
                onClick={handleRestart}
                disabled={disabled || run.status === 'running'}
                className="q-transition p-1 rounded text-[#8b949e] hover:text-white hover:bg-[#21262d] disabled:opacity-40"
                title="Restart process"
              >
                <RotateCw size={11} />
              </button>
              <button
                onClick={() => setConsoleOpen(false)}
                className="q-transition p-1 rounded text-[#8b949e] hover:text-white hover:bg-[#21262d]"
                title="Hide console"
              >
                <ChevronDown size={11} />
              </button>
            </div>
          </div>
          <pre className="flex-1 overflow-auto px-2.5 py-1.5 text-[11px] font-mono text-[#c9d1d9] whitespace-pre-wrap">
            {run.output}
            <div ref={outputEndRef} />
          </pre>
        </div>
      )}
    </div>
  );
};
