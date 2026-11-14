import React, { useState, useEffect } from 'react';
import {
  GitBranch,
  GitCommit,
  GitMerge,
  Plus,
  Minus,
  RotateCcw,
  Check,
  RefreshCw,
  FileCode,
  Clock,
  ShieldAlert,
} from 'lucide-react';
import { api } from '../services/apiBridge.js';

interface GitPanelProps {
  onOpenFile: (filePath: string) => void;
  onViewDiff: (filePath: string) => void;
  readOnly?: boolean;
}

export const GitPanel: React.FC<GitPanelProps> = ({ onOpenFile, onViewDiff, readOnly = false }) => {
  const [gitStatus, setGitStatus] = useState<any>(null);
  const [gitLog, setGitLog] = useState<any[]>([]);
  const [commitMessage, setCommitMessage] = useState('');
  const [isCommitting, setIsCommitting] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Task branches: one agent task = one git branch (Cursor-style workflow).
  const [branches, setBranches] = useState<Array<{ name: string; current: boolean }>>([]);
  const [taskBranch, setTaskBranch] = useState<any>(null);
  const [newBranchName, setNewBranchName] = useState('');
  const [branchBusy, setBranchBusy] = useState(false);

  const refreshGit = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const statRes = await api.getGitStatus();
      if (statRes.success) {
        setGitStatus(statRes.status);
      }
      const logRes = await api.getGitLog(8);
      if (logRes.success) {
        setGitLog(logRes.log);
      }
      const branchRes = await api.getGitBranches();
      if (branchRes.success) {
        setBranches(branchRes.branches || []);
        setTaskBranch(branchRes.taskBranch || null);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    refreshGit();
  }, []);

  const handleStage = async (filePath = '.') => {
    if (readOnly) return;
    await api.gitStage(filePath);
    refreshGit();
  };

  const handleRestore = async (filePath: string) => {
    if (readOnly) return;
    if (window.confirm(`Discard unstaged changes in ${filePath}?`)) {
      // Passing authorized: true — the user just explicitly confirmed above.
      const res = await api.gitRestore(filePath, true);
      if (!res.success && res.needsAuthorization) {
        setError('Restore blocked: authorization required.');
      }
      refreshGit();
    }
  };

  const handleCommit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (readOnly) return;
    if (!commitMessage.trim()) return;

    if (!window.confirm(`Explicit Authorization: Commit changes with message "${commitMessage}"?`)) {
      return;
    }

    setIsCommitting(true);
    try {
      // authorized: true — the user explicitly confirmed the commit above.
      const res = await api.gitCommit(commitMessage.trim(), true);
      if (res.success) {
        setCommitMessage('');
        refreshGit();
      } else {
        setError(res.output || res.error || 'Commit failed');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsCommitting(false);
    }
  };

  const stagedFiles = gitStatus?.files?.filter((f: any) => f.status === 'staged') || [];
  const unstagedFiles = gitStatus?.files?.filter((f: any) => f.status !== 'staged') || [];

  // --- Task branch actions (one agent task = one branch) ---
  const handleStartTaskBranch = async () => {
    if (readOnly) return;
    setBranchBusy(true);
    setError(null);
    try {
      const res = await api.gitTaskBranch(taskBranch?.title || 'manual task');
      if (!res.success) setError(res.error || 'Could not create the task branch.');
      await refreshGit();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBranchBusy(false);
    }
  };

  const handleFinishTask = async () => {
    if (readOnly || !taskBranch) return;
    const message = window.prompt(`Finish task "${taskBranch.branch}"?\nCommit message (leave empty for the default):`, commitMessage.trim() || `task: ${taskBranch.title || taskBranch.branch}`);
    if (message === null) return;
    if (!window.confirm(`Commit all changes on "${taskBranch.branch}", switch back to "${taskBranch.base}" and merge the task branch into it?`)) return;
    setBranchBusy(true);
    setError(null);
    try {
      // authorized: true — the user just explicitly confirmed above.
      const res = await api.gitFinishTask(message.trim() || undefined, true);
      if (res.success) {
        setCommitMessage('');
        await refreshGit();
      } else if (res.needsAuthorization) {
        setError('Finish task blocked: authorization required.');
      } else {
        setError(res.error || 'Could not finish the task.');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBranchBusy(false);
    }
  };

  const handleDiscardTask = async () => {
    if (readOnly || !taskBranch) return;
    if (!window.confirm(`Discard task "${taskBranch.branch}"? Every uncommitted change on it is deleted and the branch is removed. This cannot be undone.`)) return;
    setBranchBusy(true);
    setError(null);
    try {
      // authorized: true — the user just explicitly confirmed above.
      const res = await api.gitDiscardTask(true);
      if (!res.success && res.needsAuthorization) {
        setError('Discard blocked: authorization required.');
      } else if (!res.success) {
        setError(res.error || 'Could not discard the task.');
      }
      await refreshGit();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBranchBusy(false);
    }
  };

  const handleCreateBranch = async () => {
    if (readOnly) return;
    const name = newBranchName.trim();
    if (!name) return;
    setBranchBusy(true);
    setError(null);
    try {
      const res = await api.gitCreateBranch(name);
      if (!res.success) setError(res.error || res.output || 'Could not create the branch.');
      else setNewBranchName('');
      await refreshGit();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBranchBusy(false);
    }
  };

  const handleSwitchBranch = async (name: string) => {
    if (readOnly || !name) return;
    setBranchBusy(true);
    setError(null);
    try {
      const res = await api.gitCheckout(name);
      if (!res.success) setError(res.error || res.output || 'Could not switch branch.');
      await refreshGit();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBranchBusy(false);
    }
  };

  return (
    <div className="h-full flex flex-col bg-[#0d1117] text-[#c9d1d9] text-xs">
      {/* Header */}
      <div className="h-9 px-3 border-b border-[#30363d] flex items-center justify-between select-none shrink-0">
        <div className="flex items-center space-x-1.5 font-semibold text-xs tracking-wider uppercase text-[#8b949e]">
          <GitBranch size={13} className="text-blue-400" />
          <span>Source Control</span>
          {gitStatus?.branch && (
            <span className="normal-case text-white font-mono text-[11px] px-1.5 py-0.5 rounded bg-[#21262d]">
              {gitStatus.branch}
            </span>
          )}
        </div>

        <button
          onClick={refreshGit}
          disabled={isLoading}
          className="p-1 text-[#8b949e] hover:text-white hover:bg-[#21262d] rounded"
          title="Refresh Git Status"
        >
          <RefreshCw size={13} className={isLoading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Commit Input Box */}
      {readOnly && <div role="status" className="px-3 py-1 text-[11px] text-amber-200 bg-amber-950/40">Git changes are disabled in Chat mode.</div>}
      <div className="p-3 border-b border-[#30363d] flex flex-col space-y-2 shrink-0">
        <form onSubmit={handleCommit} className="flex flex-col space-y-2">
          <textarea
            rows={2}
            placeholder="Commit message (Enter to commit with authorization)..."
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            className="w-full bg-[#161b22] border border-[#30363d] focus:border-blue-500 rounded p-2 text-xs text-white placeholder-[#8b949e] outline-none resize-none"
          />

          <button
            type="submit"
            disabled={readOnly || !commitMessage.trim() || isCommitting}
            className="w-full py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded font-medium transition-colors flex items-center justify-center space-x-1.5"
          >
            <GitCommit size={13} />
            <span>{isCommitting ? 'Committing...' : 'Commit with Authorization'}</span>
          </button>
        </form>
      </div>

      {/* Task branch: one agent task = one git branch (Cursor-style) */}
      {!readOnly && (
        <div className="p-3 border-b border-[#30363d] flex flex-col space-y-2 shrink-0">
          {taskBranch ? (
            <>
              <div className="flex items-center justify-between">
                <span className="text-[#8b949e] font-semibold text-[11px] uppercase tracking-wider">Task branch</span>
                <span className="normal-case text-emerald-300 font-mono text-[11px] px-1.5 py-0.5 rounded bg-[#21262d] flex items-center gap-1">
                  <GitBranch size={11} /> {taskBranch.branch}
                </span>
              </div>
              <div className="text-[11px] text-[#8b949e]">
                Cut from <span className="font-mono text-[#c9d1d9]">{taskBranch.base}</span>. Finish merges it back; discard deletes it.
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleFinishTask}
                  disabled={branchBusy}
                  className="flex-1 py-1.5 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-white rounded font-medium transition-colors flex items-center justify-center gap-1.5"
                >
                  <GitMerge size={13} />
                  <span>{branchBusy ? 'Working…' : 'Finish task'}</span>
                </button>
                <button
                  type="button"
                  onClick={handleDiscardTask}
                  disabled={branchBusy}
                  className="flex-1 py-1.5 bg-rose-800 hover:bg-rose-700 disabled:opacity-40 text-white rounded font-medium transition-colors flex items-center justify-center gap-1.5"
                >
                  <RotateCcw size={13} />
                  <span>Discard</span>
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <span className="text-[#8b949e] font-semibold text-[11px] uppercase tracking-wider">Task branch</span>
                <span className="text-[11px] text-[#8b949e]">none active</span>
              </div>
              <div className="text-[11px] text-[#8b949e]">
                {gitStatus?.isGit
                  ? 'Start a task branch so this task’s changes live on their own branch until you finish or discard them.'
                  : 'This workspace is not a git repository, so task branches are unavailable.'}
              </div>
              {gitStatus?.isGit && (
                <button
                  type="button"
                  onClick={handleStartTaskBranch}
                  disabled={branchBusy}
                  className="w-full py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded font-medium transition-colors flex items-center justify-center gap-1.5"
                >
                  <GitBranch size={13} />
                  <span>{branchBusy ? 'Working…' : 'New task branch here'}</span>
                </button>
              )}
            </>
          )}

          {/* Manual branch controls */}
          {gitStatus?.isGit && (
            <div className="flex items-center gap-2 pt-1">
              <select
                value={gitStatus?.branch || ''}
                onChange={(e) => handleSwitchBranch(e.target.value)}
                disabled={branchBusy || readOnly}
                className="flex-1 min-w-0 bg-[#161b22] border border-[#30363d] rounded p-1.5 text-xs text-white outline-none disabled:opacity-50"
                title="Switch branch"
              >
                {branches.map((b) => (
                  <option key={b.name} value={b.name}>
                    {b.current ? '● ' : ''}{b.name}
                  </option>
                ))}
              </select>
              <input
                value={newBranchName}
                onChange={(e) => setNewBranchName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleCreateBranch(); } }}
                placeholder="new branch"
                className="w-28 bg-[#161b22] border border-[#30363d] focus:border-blue-500 rounded p-1.5 text-xs text-white placeholder-[#8b949e] outline-none"
              />
              <button
                type="button"
                onClick={handleCreateBranch}
                disabled={branchBusy || !newBranchName.trim()}
                className="p-1.5 text-[#8b949e] hover:text-white hover:bg-[#21262d] rounded disabled:opacity-40"
                title="Create branch from current HEAD"
              >
                <Plus size={13} />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Error notification */}
      {error && <div className="p-2 bg-rose-950 text-rose-300 text-xs border-b border-rose-800">{error}</div>}

      {/* Files Lists */}
      <div className="flex-1 overflow-y-auto p-2 space-y-4">
        {/* Staged Changes */}
        <div>
          <div className="flex items-center justify-between text-[#8b949e] font-semibold text-[11px] uppercase tracking-wider mb-1 px-1">
            <span>Staged Changes ({stagedFiles.length})</span>
          </div>

          {stagedFiles.length === 0 ? (
            <div className="px-2 py-1 text-[#8b949e] text-[11px] italic">No staged changes</div>
          ) : (
            stagedFiles.map((f: any, idx: number) => (
              <div
                key={`staged_${f.path}_${idx}`}
                onClick={() => onOpenFile(f.path)}
                className="flex items-center justify-between py-1 px-2 hover:bg-[#21262d] rounded cursor-pointer group"
              >
                <div className="flex items-center space-x-1.5 truncate">
                  <FileCode size={13} className="text-emerald-400 shrink-0" />
                  <span className="truncate text-white">{f.path}</span>
                </div>
                <span className="text-[10px] text-emerald-400 font-mono">S</span>
              </div>
            ))
          )}
        </div>

        {/* Unstaged Changes */}
        <div>
          <div className="flex items-center justify-between text-[#8b949e] font-semibold text-[11px] uppercase tracking-wider mb-1 px-1">
            <span>Changes ({unstagedFiles.length})</span>
            {unstagedFiles.length > 0 && !readOnly && (
              <button
                onClick={() => handleStage('.')}
                aria-label="Stage all changes"
                className="text-[11px] text-blue-400 hover:text-blue-300 normal-case"
              >
                Stage All
              </button>
            )}
          </div>

          {unstagedFiles.length === 0 ? (
            <div className="px-2 py-1 text-[#8b949e] text-[11px] italic">Working tree clean</div>
          ) : (
            unstagedFiles.map((f: any, idx: number) => (
              <div
                key={`unstaged_${f.path}_${idx}`}
                onClick={() => onOpenFile(f.path)}
                className="flex items-center justify-between py-1 px-2 hover:bg-[#21262d] rounded cursor-pointer group"
              >
                <div className="flex items-center space-x-1.5 truncate flex-1 mr-2">
                  <FileCode size={13} className="text-amber-400 shrink-0" />
                  <span className="truncate text-[#c9d1d9] group-hover:text-white">{f.path}</span>
                </div>

                {!readOnly && <div className="flex items-center space-x-1 shrink-0">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleStage(f.path);
                    }}
                    aria-label="Stage changes"
                    className="p-1 hover:text-white text-[#8b949e]"
                  >
                    <Plus size={12} />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRestore(f.path);
                    }}
                    aria-label="Discard unstaged changes"
                    className="p-1 hover:text-rose-400 text-[#8b949e]"
                  >
                    <RotateCcw size={11} />
                  </button>
                </div>}
              </div>
            ))
          )}
        </div>

        {/* Recent Commits Log */}
        {gitLog.length > 0 && (
          <div className="pt-2 border-t border-[#30363d]">
            <div className="text-[#8b949e] font-semibold text-[11px] uppercase tracking-wider mb-2 px-1">
              Recent Commits
            </div>
            <div className="space-y-1.5">
              {gitLog.map((log: any, idx) => (
                <div key={`commit_${log.hash || idx}_${idx}`} className="p-1.5 bg-[#161b22] rounded border border-[#30363d] text-[11px]">
                  <div className="flex items-center justify-between text-[#8b949e] mb-0.5">
                    <span className="font-mono text-blue-400">{log.hash}</span>
                    <span>{log.date}</span>
                  </div>
                  <div className="text-white truncate font-medium">{log.message}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
