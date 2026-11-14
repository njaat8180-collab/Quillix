import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Zap,
  FolderOpen,
  FolderPlus,
  FolderTree,
  Terminal as TerminalIcon,
  Play,
  Hammer,
  TestTube2,
  Settings,
  X,
  Loader2,
  CheckCircle2,
  XCircle,
  Sparkles,
} from 'lucide-react';
import { CommandExecutionResult, FileNode, ProjectMetadata } from '../shared/types.js';
import { api } from '../services/apiBridge.js';
import { CodingPluginsPanel } from './CodingPluginsPanel.js';

interface ActionHubProps {
  workspaceRoot: string;
  /** Incremented to auto-open the Create New Project flow (e.g. from the Dashboard). */
  autoCreateSignal?: number;
  onOpenWorkspace: () => void;
  onCreateProject: (parentPath: string, projectName: string) => Promise<{ success: boolean; error?: string }>;
  onOpenExplorer: () => void;
  onOpenTerminal: () => void;
  onOpenSettings: () => void;
  /** Sends a build/test failure to the chat agent for autonomous repair. */
  onFixWithAgent: (errorLog: string) => void;
  onWorkspaceChanged: () => void;
}

interface TaskResult {
  kind: string;
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

/** Finds a file anywhere in the tree whose name is in `names`. */
function findFileInTree(node: FileNode | null, names: string[]): string | null {
  if (!node) return null;
  for (const child of node.children || []) {
    if (!child.isDirectory && names.includes(child.name)) return child.name;
    if (child.isDirectory) {
      const found = findFileInTree(child, names);
      if (found) return found;
    }
  }
  return null;
}

function findFileByPattern(node: FileNode | null, pattern: RegExp): string | null {
  if (!node) return null;
  for (const child of node.children || []) {
    if (!child.isDirectory && pattern.test(child.name)) return child.name;
    if (child.isDirectory) {
      const found = findFileByPattern(child, pattern);
      if (found) return found;
    }
  }
  return null;
}

/**
 * The Action system — every project/workspace operation lives here, keeping
 * the primary Dashboard and Chat experience clean. Run/Build/Test execute
 * REAL commands in the active workspace and show the REAL output.
 */
export const ActionHub: React.FC<ActionHubProps> = ({
  workspaceRoot,
  autoCreateSignal,
  onOpenWorkspace,
  onCreateProject,
  onOpenExplorer,
  onOpenTerminal,
  onOpenSettings,
  onFixWithAgent,
  onWorkspaceChanged,
}) => {
  const [fileTree, setFileTree] = useState<FileNode | null>(null);
  const [projectMeta, setProjectMeta] = useState<ProjectMetadata | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<TaskResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // --- Create New Project inline form ---
  const [newProjectParent, setNewProjectParent] = useState<string | null>(null);
  const [newProjectName, setNewProjectName] = useState('');
  const [creating, setCreating] = useState(false);

  const refreshContext = useCallback(async () => {
    try {
      const [treeRes, metaRes] = await Promise.all([api.getTree(3), api.getProjectMeta()]);
      if (treeRes.success) setFileTree(treeRes.tree);
      if (metaRes.success) setProjectMeta(metaRes.meta);
    } catch {
      /* workspace not ready */
    }
  }, []);

  useEffect(() => {
    refreshContext();
  }, [refreshContext, workspaceRoot]);

  const prevAutoCreate = useRef(autoCreateSignal);
  useEffect(() => {
    if (autoCreateSignal && autoCreateSignal !== prevAutoCreate.current) {
      prevAutoCreate.current = autoCreateSignal;
      startNewProject();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoCreateSignal]);

  /** Resolves the best command for run/build/test in the active workspace. */
  const resolveCommand = (kind: 'run' | 'build' | 'test'): string | null => {
    const scripts = projectMeta?.scripts || {};
    const pm = projectMeta?.packageManager || 'npm';
    if (kind === 'build') {
      return scripts.build ? `${pm} run build` : null;
    }
    if (kind === 'test') {
      if (scripts.test) return `${pm} test`;
      const pyTest = findFileByPattern(fileTree, /^test_.*\.py$|^.*_test\.py$/);
      if (pyTest) return `python -m pytest -q`;
      return null;
    }
    // run
    if (scripts.start) return `${pm} start`;
    const pyEntry = findFileInTree(fileTree, ['app.py', 'main.py', 'server.py']);
    if (pyEntry) return `python ${pyEntry}`;
    const jsEntry = findFileInTree(fileTree, ['index.js', 'server.js', 'app.js']);
    if (jsEntry) return `node ${jsEntry}`;
    return null;
  };

  const runTask = async (kind: 'run' | 'build' | 'test') => {
    if (running) return;
    const command = resolveCommand(kind);
    if (!command) {
      setError(
        kind === 'test'
          ? 'No test command detected in this workspace (no package.json test script and no test_*.py files).'
          : `No ${kind} command detected in this workspace.`
      );
      setLastResult(null);
      return;
    }
    setError(null);
    setRunning(kind);
    setLastResult(null);
    try {
      const res = await api.runCommand(command);
      if (res.success && res.result) {
        const r = res.result as CommandExecutionResult;
        setLastResult({
          kind,
          command,
          exitCode: r.exitCode,
          stdout: r.stdout,
          stderr: r.stderr,
          durationMs: r.durationMs,
        });
      } else {
        setError(res.error || 'The command could not be executed.');
      }
    } catch (err: any) {
      setError(err?.message || 'The command could not be executed.');
    } finally {
      setRunning(null);
    }
  };

  const startNewProject = async () => {
    let parent: string | null = null;
    if (api.isDesktopApp()) {
      parent = await api.selectNativeFolder();
    } else {
      const typed = window.prompt('Enter the parent folder where the new project should be created:');
      parent = typed && typed.trim() ? typed.trim() : null;
    }
    if (!parent) return;
    setNewProjectParent(parent);
    setNewProjectName('');
  };

  const confirmNewProject = async () => {
    if (!newProjectParent || !newProjectName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const res = await onCreateProject(newProjectParent, newProjectName.trim());
      if (res.success) {
        setNewProjectParent(null);
        setNewProjectName('');
        await refreshContext();
        onWorkspaceChanged();
      } else {
        setError(res.error || 'Could not create the project.');
      }
    } catch (error: any) {
      setError(error?.message || 'Could not create the project.');
    } finally {
      setCreating(false);
    }
  };

  const navigationActions = [
    {
      id: 'open-workspace',
      label: 'Open Workspace',
      description: 'Select any local project folder — it becomes the agent workspace',
      icon: <FolderOpen size={16} />,
      onClick: onOpenWorkspace,
      primary: true,
    },
    {
      id: 'create-project',
      label: 'Create New Project',
      description: 'Pick a parent folder and name — QUILLIX creates and opens it',
      icon: <FolderPlus size={16} />,
      onClick: startNewProject,
      primary: false,
    },
    {
      id: 'file-explorer',
      label: 'File Explorer',
      description: 'Browse, open, create, rename and delete workspace files',
      icon: <FolderTree size={16} />,
      onClick: onOpenExplorer,
      primary: false,
    },
    {
      id: 'terminal',
      label: 'Terminal',
      description: 'Run commands inside the active workspace',
      icon: <TerminalIcon size={16} />,
      onClick: onOpenTerminal,
      primary: false,
    },
    {
      id: 'project-settings',
      label: 'Project Settings',
      description: 'AI providers, API key, local model and agent behaviour',
      icon: <Settings size={16} />,
      onClick: onOpenSettings,
      primary: false,
    },
  ];

  const projectTasks = [
    { kind: 'run' as const, label: 'Run Project', icon: <Play size={16} /> },
    { kind: 'build' as const, label: 'Build Project', icon: <Hammer size={16} /> },
    { kind: 'test' as const, label: 'Test Project', icon: <TestTube2 size={16} /> },
  ];

  return (
    <div className="q-dashboard flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto px-5 sm:px-8 pt-9 pb-8">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-2.5 mb-1">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center text-white"
              style={{ background: `linear-gradient(135deg, var(--accent), var(--accent-secondary))` }}
              aria-hidden="true"
            >
              <Zap size={18} />
            </div>
            <h1 className="text-xl font-bold text-[var(--text)]">Tools & plugins</h1>
          </div>
          <p className="text-[13px] text-[var(--text-muted)]">
            Project & workspace operations. Active workspace:{' '}
            <span className="font-mono text-[12px] text-[var(--text)]" title={workspaceRoot}>
              {workspaceRoot || 'none selected'}
            </span>
          </p>
        </div>

        {/* Workspace actions */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
          {navigationActions.map((action) => (
            <button
              key={action.id}
              onClick={action.onClick}
              className={`q-action-card q-card-enter text-left p-4 rounded-2xl border group ${
                action.primary
                  ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                  : 'border-[var(--border)] bg-[var(--surface)] hover:border-[var(--accent)]'
              }`}
            >
              <div className="flex items-center gap-2.5 mb-1.5">
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center"
                  style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
                  aria-hidden="true"
                >
                  {action.icon}
                </div>
                <div className="text-sm font-semibold text-[var(--text)]">{action.label}</div>
              </div>
              <div className="text-[11.5px] leading-snug text-[var(--text-muted)]">{action.description}</div>
            </button>
          ))}
        </div>

        {/* New project inline form */}
        {newProjectParent && (
          <div className="rounded-2xl border border-[var(--accent)] bg-[var(--surface)] p-4 mb-6">
            <div className="text-[12px] font-semibold text-[var(--text)] mb-2">Create New Project</div>
            <div className="text-[11px] text-[var(--text-muted)] truncate mb-2" title={newProjectParent}>
              in {newProjectParent}
            </div>
            <div className="flex items-center gap-2">
              <input
                autoFocus
                type="text"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') confirmNewProject();
                  if (e.key === 'Escape') setNewProjectParent(null);
                }}
                placeholder="Project name…"
                className="flex-1 min-w-0 px-3 py-2 rounded-xl text-[13px] bg-[var(--surface-secondary)] border border-[var(--border)] outline-none focus:border-[var(--accent)]"
              />
              <button
                onClick={confirmNewProject}
                disabled={!newProjectName.trim() || creating}
                aria-label="Create new project"
                className="px-4 py-2 rounded-xl text-[12.5px] font-semibold text-white disabled:opacity-40"
                style={{ background: 'var(--accent)' }}
              >
                Create
              </button>
              <button
                onClick={() => setNewProjectParent(null)}
                className="p-2 rounded-xl text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--hover)]"
                title="Cancel"
              >
                <X size={14} />
              </button>
            </div>
          </div>
        )}

        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] mb-6"><CodingPluginsPanel /></div>

        {/* Project tasks: Run / Build / Test — real execution */}
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 mb-6">
          <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-3">
            Project Tasks — executed in the active workspace
          </div>
          <div className="flex flex-wrap gap-2">
            {projectTasks.map((task) => (
              <button
                key={task.kind}
                onClick={() => runTask(task.kind)}
                disabled={running !== null}
                className="q-transition flex items-center gap-2 px-4 py-2 rounded-xl text-[12.5px] font-semibold border border-[var(--border)] text-[var(--text)] hover:bg-[var(--hover)] disabled:opacity-50"
              >
                {running === task.kind ? <Loader2 size={14} className="animate-spin" /> : task.icon}
                {task.label}
              </button>
            ))}
          </div>

          {error && (
            <div className="mt-3 text-[12px] px-3 py-2 rounded-xl bg-[var(--danger)]/10 border border-[var(--danger)]/30 text-[var(--danger)]">
              {error}
            </div>
          )}

          {lastResult && (
            <div className="mt-3 rounded-xl border border-[var(--border)] bg-[#0d1117] overflow-hidden">
              <div className="px-3 py-2 border-b border-[#30363d] flex items-center gap-2 text-[11.5px] font-mono">
                {lastResult.exitCode === 0 ? (
                  <CheckCircle2 size={13} className="text-emerald-400" />
                ) : (
                  <XCircle size={13} className="text-rose-400" />
                )}
                <span className="text-[#c9d1d9]">${lastResult.command}</span>
                <span className="text-[#8b949e]">
                  exit {lastResult.exitCode} · {lastResult.durationMs}ms
                </span>
                {lastResult.exitCode !== 0 && (
                  <button
                    onClick={() =>
                      onFixWithAgent(
                        `The command "${lastResult.command}" failed with exit code ${lastResult.exitCode}.\n\nSTDOUT:\n${lastResult.stdout}\n\nSTDERR:\n${lastResult.stderr}`
                      )
                    }
                    className="ml-auto flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold text-white"
                    style={{ background: 'var(--accent)' }}
                    title="Ask the agent to diagnose and fix this failure"
                  >
                    <Sparkles size={11} /> Fix with Agent
                  </button>
                )}
              </div>
              <pre className="max-h-56 overflow-y-auto px-3 py-2 text-[11.5px] font-mono whitespace-pre-wrap text-[#c9d1d9]">
                {lastResult.stdout || lastResult.stderr || '(no output)'}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
