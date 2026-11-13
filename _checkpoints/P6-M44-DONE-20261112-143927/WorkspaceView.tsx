import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FolderTree, Search, GitBranch, PlayCircle, Wrench, Activity, FolderOpen, FolderPlus, RefreshCw, X, Loader2, GripHorizontal, Bug, History } from 'lucide-react';
import { AgentActivity, FileNode, FilePatch, ProjectMetadata } from '../shared/types.js';
import { api } from '../services/apiBridge.js';
import { FileTree } from './FileTree.js';
import { GlobalSearch } from './GlobalSearch.js';
import { EditorArea, EditorTab } from './EditorArea.js';
import { TerminalPanel } from './TerminalPanel.js';
import { GitPanel } from './GitPanel.js';
import { BuildTestPanel } from './BuildTestPanel.js';
import { CheckpointsPanel } from './CheckpointsPanel.js';
import { ToolRegistryPanel } from './ToolRegistryPanel.js';
import { DebuggerPanel } from './DebuggerPanel.js';
import { DiagnosticsModal } from './DiagnosticsModal.js';
import { DiffViewer } from './DiffViewer.js';
import { ProjectRunner } from './ProjectRunner.js';
import { PreviewPane } from './PreviewPane.js';
import { Dashboard, QuickAction } from './Dashboard.js';
import type { WorkspaceCommand } from './WorkbenchLayout.js';

type WorkspaceTab = 'explorer' | 'search' | 'git' | 'build' | 'checkpoints' | 'tools' | 'debug' | 'health';

interface WorkspaceViewProps {
  onDirtyChange?: (dirty: boolean) => void;
  onActiveFileChange?: (file: string | null) => void;
  onActiveBufferChange?: (file: string | null, content: string | null, dirty: boolean) => void;
  active?: boolean;
  commandRequest?: { action: WorkspaceCommand; nonce: number } | null;
  onInlineRequest?: (prompt: string, selection: string, file: string) => void;
  /** "Fix this error with the agent" from build/test failures. */
  onFixWithAgent?: (errorLog: string) => void;
  /** Live agent activity stream shown in the left activity log. */
  agentActivities?: AgentActivity[];
  /** Banner shown above the editor while the agent works (e.g. "NUVRO AI is editing src/game/player.js…"). */
  agentBanner?: string | null;
  /** Ask the workspace to open (and re-read) a file — fired when the agent creates/modifies it. */
  focusFileRequest?: { path: string; nonce: number } | null;
  /** Incremented to force a tree refresh (after agent runs / workspace changes). */
  refreshSignal?: number;
  /** Incremented (e.g. by the top header) to open the native folder picker. */
  openFolderSignal?: number;
  /** Incremented to open the diagnostics modal. */
  diagnosticsSignal?: number;
  /** Show the welcome dashboard instead of the editor (no messages yet). */
  showWelcome?: boolean;
  projectMeta?: ProjectMetadata | null;
  onQuickAction?: (action: QuickAction) => void;
  /** Notified whenever the active workspace folder changed. */
  onWorkspaceChanged?: () => void;
  conversationMode?: 'chat' | 'agent';
  conversationModeReady?: boolean;
  /** Prevents switching roots while an agent is mutating the current workspace. */
  agentBusy?: boolean;
}

/**
 * The main coding workspace: left project explorer + activity log,
 * center code editor, bottom terminal. The chat panel lives to the right of
 * this view (see App.tsx) — the center is always reserved for code.
 */
export const WorkspaceView: React.FC<WorkspaceViewProps> = ({
  onDirtyChange,
  onActiveFileChange,
  onActiveBufferChange,
  active = true,
  commandRequest,
  onInlineRequest,
  onFixWithAgent,
  agentActivities = [],
  agentBanner,
  focusFileRequest,
  refreshSignal,
  openFolderSignal,
  diagnosticsSignal,
  showWelcome,
  projectMeta,
  onQuickAction,
  onWorkspaceChanged,
  conversationMode = 'agent',
  conversationModeReady = true,
  agentBusy = false,
}) => {
  const readOnly = !conversationModeReady || conversationMode !== 'agent';
  const [fileTree, setFileTree] = useState<FileNode | null>(null);
  const [workspaceRoot, setWorkspaceRoot] = useState('');
  const [sourceRevision, setSourceRevision] = useState(0);
  const [sidebarTab, setSidebarTab] = useState<WorkspaceTab>('explorer');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [tabs, setTabs] = useState<EditorTab[]>([]);
  useEffect(() => {
    onDirtyChange?.(tabs.some(tab => tab.isDirty));
  }, [tabs, onDirtyChange]);
  const [activeTabPath, setActiveTabPath] = useState<string | null>(null);
  const [fileOpenError, setFileOpenError] = useState<{ path: string; message: string } | null>(null);
  useEffect(() => { onActiveFileChange?.(activeTabPath); }, [activeTabPath, onActiveFileChange]);
  useEffect(() => {
    const activeTab = tabs.find(tab => tab.filePath === activeTabPath);
    onActiveBufferChange?.(activeTab?.filePath ?? null, activeTab?.content ?? null, activeTab?.isDirty ?? false);
  }, [activeTabPath, tabs, onActiveBufferChange]);
  const [activeDiffPatch, setActiveDiffPatch] = useState<FilePatch | null>(null);
  useEffect(() => {
    if (!tabs.some(tab => tab.isDirty)) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [tabs]);
  const [terminalOpen, setTerminalOpen] = useState(true);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  useEffect(() => {
    if (!commandRequest) return;
    if (commandRequest.action === 'terminal') setTerminalOpen(open => !open);
    else { setSidebarOpen(true); setSidebarTab(commandRequest.action); }
  }, [commandRequest]);

  // Cursor/VS Code-style workspace shortcuts. These are registered here,
  // rather than in the editor, so they keep working when focus is in the
  // explorer, terminal, search box, or chat-adjacent workspace controls.
  useEffect(() => {
    if (!active) return;
    const handleWorkspaceShortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;

      const key = event.key.toLowerCase();
      if (event.shiftKey && key === 'f') {
        event.preventDefault();
        setSidebarOpen(true);
        setSidebarTab('search');
        return;
      }
      if (event.shiftKey && key === 'g') {
        event.preventDefault();
        setSidebarOpen(true);
        setSidebarTab('git');
        return;
      }
      if (event.shiftKey && key === 'b') {
        event.preventDefault();
        setSidebarOpen(true);
        setSidebarTab('build');
        return;
      }
      if (key === 'p' && !event.shiftKey) {
        event.preventDefault();
        setSidebarOpen(true);
        setSidebarTab('search');
        return;
      }
      if (key === 'b') {
        event.preventDefault();
        setSidebarOpen((open) => !open);
        return;
      }
      if (event.key === '`') {
        event.preventDefault();
        setTerminalOpen((open) => !open);
      }
    };

    window.addEventListener('keydown', handleWorkspaceShortcut);
    return () => window.removeEventListener('keydown', handleWorkspaceShortcut);
  }, [active]);

  // --- Resizable terminal: draggable divider height, remembered for the
  // --- whole browser/app session (§10). Drag UP → bigger terminal.
  const TERMINAL_MIN = 120;
  const TERMINAL_MAX = 600;
  const [terminalHeight, setTerminalHeight] = useState<number>(() => {
    const saved = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('quillix-terminal-height') : null;
    const n = saved ? parseInt(saved, 10) : NaN;
    return Number.isFinite(n) && n >= TERMINAL_MIN && n <= TERMINAL_MAX ? n : 256;
  });
  const dividerDragging = useRef(false);
  // Force-detaches window pointer listeners when the view unmounts mid-drag.
  const dragCleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => { dragCleanupRef.current?.(); }, []);

  const startDividerDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    dividerDragging.current = true;
    const startY = e.clientY;
    const startHeight = terminalHeight;

    const onMove = (ev: PointerEvent) => {
      if (!dividerDragging.current) return;
      // Dragging UP increases the terminal height.
      const delta = startY - ev.clientY;
      const next = Math.min(TERMINAL_MAX, Math.max(TERMINAL_MIN, Math.round(startHeight + delta)));
      setTerminalHeight(next);
    };
    // Shared detach: used by pointerup, pointercancel and unmount so a
    // cancelled drag can never leave move listeners attached.
    const detach = () => {
      dividerDragging.current = false;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', detach);
      try {
        sessionStorage.setItem('quillix-terminal-height', String(Math.round(terminalHeightRef.current)));
      } catch {
        // sessionStorage unavailable — height still persists via React state
      }
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      dragCleanupRef.current = null;
    };
    const onUp = detach;
    dragCleanupRef.current = detach;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', detach);
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  };

  // Keep a ref of the live height so the pointerup handler persists the
  // final value, not the value captured at drag start.
  const terminalHeightRef = useRef(terminalHeight);
  useEffect(() => {
    terminalHeightRef.current = terminalHeight;
  }, [terminalHeight]);

  // --- Built-in web preview (§12) -------------------------------------------
  const [preview, setPreview] = useState<{ root: string; entry: string; title: string } | null>(null);
  const [previewInfo, setPreviewInfo] = useState<{ root: string; entry: string; title: string } | null>(null);
  useEffect(() => { if (readOnly) setPreview(null); }, [readOnly]);

  // --- New Project inline form state ---
  const [newProjectParent, setNewProjectParent] = useState<string | null>(null);
  const [newProjectName, setNewProjectName] = useState('');
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [formatting, setFormatting] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);

  const refreshWorkspace = useCallback(async () => {
    try {
      const treeRes = await api.getTree(5);
      if (treeRes.success) {
        setFileTree(treeRes.tree);
        setWorkspaceRoot(treeRes.root);
        setSourceRevision(value => value + 1);
      }
    } catch (err) {
      console.error('Failed to load workspace data:', err);
    }
  }, []);

  useEffect(() => {
    refreshWorkspace();
  }, [refreshWorkspace, refreshSignal]);

  useEffect(() => {
    if (!diagnosticsSignal) return;
    setDiagnosticsOpen(true);
  }, [diagnosticsSignal]);

  const openFileInternal = useCallback(async (filePath: string, forceReload = false) => {
    setFileOpenError(null);
    const existing = tabs.find((t) => t.filePath === filePath);
    if (existing && (!forceReload || existing.isDirty)) {
      // Agent writes must not silently replace unsaved user edits in memory.
      if (forceReload && existing.isDirty) {
        setWorkspaceError(`External change detected in ${filePath}. Your unsaved editor changes were preserved; copy them before reloading.`);
      }
      setActiveTabPath(filePath);
      setActiveDiffPatch(null);
      return;
    }
    try {
      const res = await api.readFile(filePath);
      if (res.success) {
        const fileName = filePath.split('/').pop() || filePath;
        setTabs((prev) =>
          prev.some((t) => t.filePath === filePath)
            ? prev.map((t) =>
                t.filePath === filePath
                  ? { ...t, content: res.content || '', originalContent: res.content || '', isDirty: false }
                  : t
              )
            : [
                ...prev,
                {
                  filePath,
                  fileName,
                  content: res.content || '',
                  originalContent: res.content || '',
                  isDirty: false,
                  language: fileName.split('.').pop() || 'plaintext',
                },
              ]
        );
        setActiveTabPath(filePath);
        setActiveDiffPatch(null);
        setWorkspaceError(null);
      } else {
        const message = res.error || 'The file could not be read from this workspace.';
        setFileOpenError({ path: filePath, message });
        setWorkspaceError(`Could not open ${filePath}: ${message}`);
      }
    } catch (err) {
      console.error(`Failed to read file ${filePath}:`, err);
      const message = err instanceof Error ? err.message : String(err);
      setFileOpenError({ path: filePath, message });
      setWorkspaceError(`Could not open ${filePath}: ${message}`);
    }
  }, [tabs]);

  // Open (and re-read) the file the agent just touched, so the user can watch
  // the coding process live in the editor.
  useEffect(() => {
    if (focusFileRequest?.path) {
      openFileInternal(focusFileRequest.path, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusFileRequest?.nonce]);

  const handleCloseTab = (filePath: string) => {
    if (tabs.find(t => t.filePath === filePath)?.isDirty && !window.confirm('Discard unsaved changes to this file?')) return;
    const remaining = tabs.filter((t) => t.filePath !== filePath);
    setTabs(remaining);
    if (activeTabPath === filePath) {
      setActiveTabPath(remaining.length > 0 ? remaining[remaining.length - 1].filePath : null);
    }
  };

  const handleContentChange = (filePath: string, newContent: string) => {
    setTabs((prev) =>
      prev.map((t) =>
        t.filePath === filePath ? { ...t, content: newContent, isDirty: newContent !== t.originalContent } : t
      )
    );
  };

  const handleSaveFile = async (filePath: string) => {
    if (readOnly) { setWorkspaceError('Switch to Agent mode to save workspace changes.'); return; }
    const tab = tabs.find((t) => t.filePath === filePath);
    if (!tab) return;
    try {
      const res = await api.writeFile(filePath, tab.content, false, tab.originalContent);
      if (res.success) {
        setTabs((prev) =>
          prev.map((t) => (t.filePath === filePath ? { ...t, originalContent: tab.content, isDirty: t.content !== tab.content } : t))
        );
        refreshWorkspace();
      } else setWorkspaceError(res.error || 'Could not save file.');
    } catch (err) {
      setWorkspaceError(`Could not save ${filePath}: ${String(err)}`);
    }
  };

  const handleFormatFile = async (filePath: string) => {
    if (readOnly) { setWorkspaceError('Switch to Agent mode to format workspace files.'); return; }
    if (formatting) return;
    if (tabs.find(tab => tab.filePath === filePath)?.isDirty) {
      setWorkspaceError('Save this file before formatting. Unsaved editor content was not changed.'); return;
    }
    setFormatting(true); setWorkspaceError(null);
    try {
      const result = await api.executeTool('plugin_format_file', { filePath });
      if (!result.success) throw new Error(result.error || result.output || 'Formatting failed.');
      if (result.staged && result.data) setActiveDiffPatch(result.data as FilePatch);
      else {
        const file = await api.readFile(filePath);
        if (!file.success || file.content === undefined) throw new Error(file.error || 'Could not reload formatted file.');
        // Never replace edits typed while the formatter request was running.
        setTabs(previous => previous.map(tab => tab.filePath === filePath && !tab.isDirty ? { ...tab, content: file.content!, originalContent: file.content!, isDirty: false } : tab));
        refreshWorkspace();
      }
    } catch (error: any) { setWorkspaceError(error.message); }
    finally { setFormatting(false); }
  };

  const handleCreateFile = async (parentPath: string, fileName: string, isFolder: boolean) => {
    if (readOnly) { setWorkspaceError('Switch to Agent mode to create workspace files.'); return; }
    const fullPath = parentPath === '.' ? fileName : `${parentPath}/${fileName}`;
    const res = await api.writeFile(isFolder ? `${fullPath}/.gitkeep` : fullPath, '', true);
    if (!res.success) { setWorkspaceError(res.error || 'Could not create file.'); return; }
    refreshWorkspace();
  };

  const handleDeleteFile = async (filePath: string) => {
    if (readOnly) { setWorkspaceError('Switch to Agent mode to delete workspace files.'); return; }
    const res = await api.deleteFile(filePath);
    if (!res.success) { setWorkspaceError(res.error || 'Could not delete file.'); return; }
    handleCloseTab(filePath);
    refreshWorkspace();
  };

  const handleRenameFile = async (oldPath: string, newPath: string) => {
    if (readOnly) { setWorkspaceError('Switch to Agent mode to rename workspace files.'); return; }
    const res = await api.renameFile(oldPath, newPath);
    if (!res.success) { setWorkspaceError(res.error || 'Could not rename file.'); return; }
    setTabs((prev) =>
      prev.map((t) =>
        t.filePath === oldPath ? { ...t, filePath: newPath, fileName: newPath.split('/').pop() || newPath } : t
      )
    );
    if (activeTabPath === oldPath) setActiveTabPath(newPath);
    refreshWorkspace();
  };

  // --- Open Project Folder (native desktop picker) ---
  const handleOpenFolder = async () => {
    if (agentBusy) {
      setWorkspaceError('Finish or stop the active agent task before switching workspaces.');
      return;
    }
    if (tabs.some(t => t.isDirty) && !window.confirm('Discard unsaved changes before switching workspace?')) return;
    setWorkspaceError(null);
    try {
      let folder: string | null = null;
      if (api.isDesktopApp()) {
        folder = await api.selectNativeFolder();
      } else {
        // Browser/dev fallback: manual path entry.
        const typed = window.prompt('Enter the full path of the project folder to open:');
        folder = typed && typed.trim() ? typed.trim() : null;
      }
      if (!folder) return;
      setWorkspaceBusy(true);
      const res = await api.setRoot(folder);
      if (!res.success) {
        setWorkspaceError(res.error || 'Could not open that folder.');
        return;
      }
      setTabs([]);
      setActiveTabPath(null);
      setActiveDiffPatch(null);
      await refreshWorkspace();
      onWorkspaceChanged?.();
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : String(error));
    } finally {
      setWorkspaceBusy(false);
    }
  };

  // The top header's "Open Project Folder" button drives the same flow as the
  // workspace header button (fires on every signal change except mount).
  const prevOpenFolderSignal = useRef(openFolderSignal);
  useEffect(() => {
    if (openFolderSignal !== prevOpenFolderSignal.current) {
      prevOpenFolderSignal.current = openFolderSignal;
      handleOpenFolder();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openFolderSignal]);

  // --- Create New Project (parent chosen with native picker, name typed) ---
  const handleStartNewProject = async () => {
    if (agentBusy) {
      setWorkspaceError('Finish or stop the active agent task before creating another workspace.');
      return;
    }
    setWorkspaceError(null);
    try {
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
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : String(error));
    }
  };

  const handleConfirmNewProject = async () => {
    if (!newProjectParent || !newProjectName.trim()) return;
    if (tabs.some(t => t.isDirty) && !window.confirm('Discard unsaved changes before creating a project?')) return;
    setWorkspaceBusy(true);
    setWorkspaceError(null);
    try {
      const res = await api.createProject(newProjectParent, newProjectName.trim());
      if (!res.success) {
        setWorkspaceError(res.error || 'Could not create the project.');
        return;
      }
      setNewProjectParent(null);
      setNewProjectName('');
      setTabs([]);
      setActiveTabPath(null);
      await refreshWorkspace();
      onWorkspaceChanged?.();
    } finally {
      setWorkspaceBusy(false);
    }
  };

  const sideTabs: Array<{ id: WorkspaceTab; icon: React.ReactNode; title: string }> = [
    { id: 'explorer', icon: <FolderTree size={17} />, title: 'Explorer' },
    { id: 'search', icon: <Search size={17} />, title: 'Search' },
    { id: 'git', icon: <GitBranch size={17} />, title: 'Source Control' },
    { id: 'build', icon: <PlayCircle size={17} />, title: 'Build & Tests' },
    { id: 'checkpoints', icon: <History size={17} />, title: 'Checkpoints' },
    { id: 'tools', icon: <Wrench size={17} />, title: 'Tool Registry' },
    { id: 'debug', icon: <Bug size={17} />, title: 'Debugger' },
    { id: 'health', icon: <Activity size={17} />, title: 'Diagnostics' },
  ];

  const recentActivities = agentActivities.slice(-40);

  return (
    <div className="q-editor-workspace flex-1 flex min-h-0 min-w-0 overflow-hidden bg-[var(--bg)]" role="main" aria-label="Workspace">
      {/* Panel rail: explorer / search / git / build / tools / health */}
      <div className="w-12 flex flex-col items-center py-2 gap-1 border-r border-[var(--border)] bg-[var(--surface)] shrink-0">
        {sideTabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setSidebarTab(tab.id)}
            title={tab.title}
            aria-label={tab.title}
            aria-pressed={sidebarTab === tab.id}
            className={`q-transition w-9 h-9 flex items-center justify-center rounded-xl ${
              sidebarTab === tab.id
                ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--hover)]'
            }`}
          >
            {tab.icon}
          </button>
        ))}
      </div>

      {/* LEFT: project explorer + workspace controls + activity log */}
      {sidebarOpen && <div className="q-project-sidebar w-60 border-r border-[var(--border)] bg-[var(--surface)] flex flex-col shrink-0 overflow-hidden">
        {/* Workspace header */}
        <div className="p-2.5 border-b border-[var(--border)] space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
              Project Explorer
            </div>
            <button
              onClick={refreshWorkspace}
              className="q-transition p-1 rounded text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--hover)]"
              title="Refresh file tree"
              aria-label="Refresh file tree"
            >
              <RefreshCw size={12} />
            </button>
          </div>
          <div
            className="text-[11px] font-mono text-[var(--text)] truncate px-2 py-1.5 rounded-lg bg-[var(--surface-secondary)] border border-[var(--border)]"
            title={workspaceRoot}
          >
            {workspaceRoot ? `📁 ${workspaceRoot}` : 'No workspace loaded'}
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={handleOpenFolder}
              disabled={workspaceBusy || agentBusy}
              className="q-transition flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-[11.5px] font-semibold text-white disabled:opacity-50"
              style={{ background: 'var(--accent)' }}
              title={agentBusy ? 'Finish or stop the active agent task before switching workspaces' : 'Open any local project folder with the native folder picker'}
              aria-label="Open Project Folder"
            >
              <FolderOpen size={13} /> Open folder
            </button>
            <button
              onClick={handleStartNewProject}
              disabled={workspaceBusy || agentBusy}
              className="q-transition flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-[11.5px] font-semibold border border-[var(--border)] text-[var(--text)] hover:bg-[var(--hover)] disabled:opacity-50"
              title="Create a new project folder"
              aria-label="New Project"
            >
              <FolderPlus size={13} /> New
            </button>
          </div>

          {newProjectParent && (
            <div className="flex items-center gap-1.5">
              <input
                autoFocus
                type="text"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleConfirmNewProject();
                  if (e.key === 'Escape') setNewProjectParent(null);
                }}
                placeholder="Project name…"
                className="flex-1 min-w-0 px-2 py-1.5 rounded-lg text-[12px] bg-[var(--surface-secondary)] border border-[var(--border)] outline-none focus:border-[var(--accent)]"
              />
              <button
                onClick={handleConfirmNewProject}
                disabled={!newProjectName.trim()}
                className="px-2.5 py-1.5 rounded-lg text-[11.5px] font-semibold text-white disabled:opacity-40"
                style={{ background: 'var(--accent)' }}
              >
                Create
              </button>
              <button
                onClick={() => setNewProjectParent(null)}
                className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--hover)]"
                title="Cancel"
              >
                <X size={13} />
              </button>
            </div>
          )}
          {newProjectParent && (
            <div className="text-[10px] text-[var(--text-muted)] truncate" title={newProjectParent}>
              in {newProjectParent}
            </div>
          )}
          {workspaceError && (
            <div className="text-[10.5px] text-[var(--danger)] px-2 py-1 rounded bg-[var(--danger)]/10 border border-[var(--danger)]/30">
              {workspaceError}
            </div>
          )}
          {readOnly && <div role="status" className="text-[10.5px] text-[var(--text-muted)] px-2 py-1 rounded bg-[var(--accent-soft)] border border-[var(--border)]">{conversationModeReady ? 'Chat mode is read-only: file, terminal, preview, and tool actions are disabled.' : 'Loading this workspace’s conversation mode… editing is temporarily disabled.'}</div>}
        </div>

        {/* File tree / panels */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {sidebarTab === 'explorer' && (
            <FileTree
              tree={fileTree}
              activeFilePath={activeTabPath || undefined}
              onOpenFile={(p) => openFileInternal(p)}
              onRefresh={refreshWorkspace}
              onCreateFile={handleCreateFile}
              onDeleteFile={handleDeleteFile}
              onRenameFile={handleRenameFile}
              readOnly={readOnly}
            />
          )}
          {sidebarTab === 'search' && <GlobalSearch onOpenFile={(p) => openFileInternal(p)} />}
          {sidebarTab === 'git' && <GitPanel onOpenFile={(p) => openFileInternal(p)} onViewDiff={(p) => openFileInternal(p)} readOnly={readOnly} />}
          {sidebarTab === 'build' && (
            <BuildTestPanel
              onFixWithAgent={(log) => {
                onFixWithAgent?.(log);
              }}
              readOnly={readOnly}
            />
          )}
          {sidebarTab === 'checkpoints' && <CheckpointsPanel readOnly={readOnly} onRestored={refreshWorkspace} />}
          {sidebarTab === 'tools' && <ToolRegistryPanel readOnly={readOnly} />}
          {sidebarTab === 'debug' && <DebuggerPanel activeFilePath={activeTabPath} readOnly={readOnly} />}
          {sidebarTab === 'health' && (
            <div className="p-4 text-center">
              <button
                onClick={() => setDiagnosticsOpen(true)}
                className="px-4 py-2 rounded-xl text-white text-[12px] font-semibold"
                style={{ background: 'var(--accent)' }}
              >
                Open System Diagnostics
              </button>
            </div>
          )}
        </div>

        {/* Live activity log (real operations, streamed from the agent) */}
        <div className="h-44 border-t border-[var(--border)] flex flex-col shrink-0">
          <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] border-b border-[var(--border)]">
            Activity
          </div>
          <div className="flex-1 overflow-y-auto px-3 py-1.5 space-y-1">
            {recentActivities.length === 0 ? (
              <div className="text-[11px] text-[var(--text-muted)]">NUVRO AI is idle.</div>
            ) : (
              recentActivities.map((act, idx) => (
                <div key={`${act.id}_${idx}`} className="text-[11px] leading-tight flex gap-2">
                  <span className="font-mono text-[10px] text-[var(--text-muted)] shrink-0">
                    {new Date(act.timestamp).toLocaleTimeString()}
                  </span>
                  <span
                    className="truncate"
                    style={{
                      color:
                        act.type === 'error'
                          ? 'var(--danger)'
                          : act.type === 'completed'
                            ? 'var(--success)'
                            : 'var(--text-muted)',
                    }}
                    title={act.message}
                  >
                    {act.message}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>}

      {/* CENTER: code editor + terminal */}
      <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden">
        {/* Agent status banner ("NUVRO AI is editing …") */}
        {agentBanner && (
          <div className="h-8 px-3 flex items-center gap-2 border-b border-[var(--border)] bg-[var(--accent-soft)] shrink-0">
            <Loader2 size={13} className="animate-spin" style={{ color: 'var(--accent)' }} />
            <span className="text-[12px] text-[var(--text)] truncate">{agentBanner}</span>
          </div>
        )}

        {/* RUN / PREVIEW system (§11, §12) */}
        <ProjectRunner
          disabled={readOnly}
          workspaceRoot={workspaceRoot}
          refreshSignal={refreshSignal}
          onOpenPreview={(info) => setPreview(info)}
          onPreviewAvailabilityChange={setPreviewInfo}
        />

        <div className="flex-1 flex min-h-0 overflow-hidden">
          {preview ? (
            <PreviewPane
              disabled={readOnly}
              root={preview.root}
              entry={preview.entry}
              title={preview.title}
              onClose={() => setPreview(null)}
            />
          ) : activeDiffPatch ? (
            <DiffViewer
              patch={activeDiffPatch}
              onApply={() => setActiveDiffPatch(null)}
              onReject={() => setActiveDiffPatch(null)}
              onClose={() => setActiveDiffPatch(null)}
            />
          ) : showWelcome ? (
            <Dashboard projectMeta={projectMeta || null} onQuickAction={(a) => onQuickAction?.(a)} />
          ) : (
            <EditorArea
              readOnly={readOnly}
              workspaceId={workspaceRoot}
              refreshSignal={sourceRevision}
              onOpenFile={openFileInternal}
              active={active}
              tabs={tabs}
              activeTabPath={activeTabPath}
              fileOpenError={fileOpenError}
              onRetryOpenFile={(filePath) => void openFileInternal(filePath, true)}
              onSelectTab={(path) => {
                setFileOpenError(null);
                setActiveTabPath(path);
                setActiveDiffPatch(null);
                setPreview(null);
              }}
              onCloseTab={handleCloseTab}
              onContentChange={handleContentChange}
              onSaveFile={handleSaveFile}
              onFormatFile={handleFormatFile}
              formatting={formatting}
              previewInfo={previewInfo}
              onOpenPreview={(info) => setPreview(info)}
              onAskInlineAI={(prompt, selection, file) => onInlineRequest?.(prompt, selection, file)}
            />
          )}
        </div>

        {/* Draggable divider: EDITOR/PREVIEW ↔ TERMINAL (drag UP = larger
            terminal; height is remembered for the session) */}
        {terminalOpen && (
          <div
            onPointerDown={startDividerDrag}
            onDoubleClick={() => setTerminalHeight(256)}
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize terminal panel"
            title="Drag up to enlarge the terminal, drag down to shrink it. Double-click to reset."
            className="h-1.5 shrink-0 cursor-row-resize flex items-center justify-center hover:bg-[var(--accent-soft)] border-t border-[var(--border)]"
          >
            <GripHorizontal size={12} className="text-[var(--text-muted)] pointer-events-none" />
          </div>
        )}

        <TerminalPanel
          readOnly={readOnly}
          readOnlyMessage={conversationModeReady ? 'Terminal commands are disabled in Chat mode. Switch to Agent mode to run commands.' : 'Loading this workspace’s conversation mode… terminal commands are temporarily disabled.'}
          workspaceRoot={workspaceRoot}
          isOpen={terminalOpen}
          onClose={() => setTerminalOpen(false)}
          height={terminalHeight}
        />
      </div>

      <DiagnosticsModal isOpen={diagnosticsOpen} onClose={() => setDiagnosticsOpen(false)} />
    </div>
  );
};
