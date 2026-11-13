import React, { useState, useEffect, useCallback } from 'react';
import { Camera, RotateCcw, Trash2, FileDiff, Loader2 } from 'lucide-react';
import { api } from '../services/apiBridge.js';

interface CheckpointSummary {
  id: string;
  name: string;
  createdAt: number;
  fileCount: number;
  totalBytes: number;
  truncated: boolean;
}

interface CheckpointsPanelProps {
  readOnly?: boolean;
  onRestored?: () => void;
}

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

/** M4.4: named workspace restore points — create, inspect diffs, restore, remove. */
export const CheckpointsPanel: React.FC<CheckpointsPanelProps> = ({ readOnly = false, onRestored }) => {
  const [checkpoints, setCheckpoints] = useState<CheckpointSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [files, setFiles] = useState<string[]>([]);
  const [diff, setDiff] = useState<{ filePath: string; text: string } | null>(null);

  const refresh = useCallback(async () => {
    const result = await api.listCheckpoints();
    setCheckpoints(result.checkpoints ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const announce = (kind: 'ok' | 'error', text: string) => {
    setMessage({ kind, text });
    setTimeout(() => setMessage(null), 8000);
  };

  const create = async () => {
    if (readOnly) return;
    setBusyId('create');
    try {
      const result = await api.createCheckpoint(name.trim());
      if (result.success && result.checkpoint) {
        setName('');
        announce('ok', `Checkpoint “${result.checkpoint.name}” saved (${result.checkpoint.fileCount} files${result.checkpoint.truncated ? ', truncated at the size limit' : ''}).`);
        await refresh();
      } else {
        announce('error', result.error || 'Could not create the checkpoint.');
      }
    } finally {
      setBusyId(null);
    }
  };

  const restore = async (checkpoint: CheckpointSummary) => {
    if (readOnly || busyId) return;
    setBusyId(checkpoint.id);
    try {
      const result = await api.restoreCheckpoint(checkpoint.id);
      if (result.success) {
        const restored = result.restored?.length ?? 0;
        const conflicts = result.conflicts?.length ?? 0;
        announce('ok', conflicts
          ? `Restored ${restored} file(s); ${conflicts} could not be restored.`
          : `Restored ${restored} file(s) from “${checkpoint.name}”.`);
        onRestored?.();
        await refresh();
      } else {
        announce('error', result.error || 'Restore failed.');
      }
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (checkpoint: CheckpointSummary) => {
    if (readOnly || busyId) return;
    setBusyId(checkpoint.id);
    try {
      const result = await api.removeCheckpoint(checkpoint.id);
      if (result.success) {
        announce('ok', `Checkpoint “${checkpoint.name}” removed.`);
        if (expandedId === checkpoint.id) { setExpandedId(null); setDiff(null); }
        await refresh();
      } else {
        announce('error', result.error || 'Remove failed.');
      }
    } finally {
      setBusyId(null);
    }
  };

  const showFiles = async (checkpoint: CheckpointSummary) => {
    if (expandedId === checkpoint.id) { setExpandedId(null); setDiff(null); return; }
    setExpandedId(checkpoint.id);
    setDiff(null);
    const detail = await api.getCheckpointDetail(checkpoint.id);
    setFiles((detail.checkpoint?.files ?? []).slice(0, 50).map(file => file.filePath));
  };

  const showDiff = async (checkpointId: string, filePath: string) => {
    const result = await api.getCheckpointDiff(checkpointId, filePath);
    setDiff({ filePath, text: result.success ? (result.diff || '(no differences)') : `Diff unavailable: ${result.error || 'unknown error'}` });
  };

  return (
    <div className="h-full flex flex-col bg-[#0d1117] text-[#c9d1d9] text-xs">
      <div className="h-9 px-3 border-b border-[#30363d] flex items-center justify-between select-none shrink-0">
        <span className="font-semibold text-xs tracking-wider uppercase text-[#8b949e]">Checkpoints</span>
        <button onClick={() => void refresh()} className="text-[#8b949e] hover:text-white" title="Refresh checkpoints" aria-label="Refresh checkpoints">
          <Loader2 size={13} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="p-3 border-b border-[#30363d] flex items-center space-x-2 shrink-0">
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Name this restore point…"
          maxLength={64}
          className="flex-1 bg-[#161b22] border border-[#30363d] focus:border-blue-500 rounded px-2 py-1.5 text-xs text-white outline-none"
        />
        <button
          onClick={create}
          disabled={readOnly || busyId === 'create'}
          className="flex items-center space-x-1 px-2.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-medium disabled:opacity-40"
          title="Save a named checkpoint of the workspace"
        >
          <Camera size={13} />
          <span>Save</span>
        </button>
      </div>

      {message && (
        <div role="status" className={`px-3 py-1.5 text-[11px] border-b ${message.kind === 'ok' ? 'bg-emerald-950/40 text-emerald-300 border-emerald-800' : 'bg-rose-950/40 text-rose-300 border-rose-800'}`}>
          {message.text}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-2 flex flex-col space-y-2">
        {readOnly && <div className="px-1 text-[11px] text-amber-200">Checkpoint actions are disabled in Chat mode.</div>}
        {checkpoints.length === 0 && !loading && (
          <div className="text-center text-[#8b949e] py-8 px-2">
            No checkpoints yet. Save one before a big change, then restore the workspace to this exact state in one click.
          </div>
        )}
        {checkpoints.map(checkpoint => (
          <div key={checkpoint.id} className="rounded-lg border border-[#30363d] bg-[#161b22] p-2.5 flex flex-col space-y-2">
            <div className="flex items-start justify-between">
              <div className="min-w-0">
                <div className="text-xs font-medium text-white truncate" title={checkpoint.name}>{checkpoint.name}</div>
                <div className="text-[10px] text-[#8b949e]">
                  {new Date(checkpoint.createdAt).toLocaleString()} · {checkpoint.fileCount} files · {formatBytes(checkpoint.totalBytes)}{checkpoint.truncated ? ' · truncated' : ''}
                </div>
              </div>
              <div className="flex items-center space-x-1 shrink-0">
                <button
                  onClick={() => void showFiles(checkpoint)}
                  className="p-1.5 rounded text-[#8b949e] hover:text-white hover:bg-[#21262d]"
                  title={expandedId === checkpoint.id ? 'Hide files' : 'Show files and diffs'}
                  aria-label={`Show files in checkpoint ${checkpoint.name}`}
                >
                  <FileDiff size={13} />
                </button>
                <button
                  onClick={() => void restore(checkpoint)}
                  disabled={readOnly || busyId === checkpoint.id}
                  className="p-1.5 rounded text-[#8b949e] hover:text-white hover:bg-[#21262d] disabled:opacity-40"
                  title={`Restore the workspace to “${checkpoint.name}”`}
                  aria-label={`Restore checkpoint ${checkpoint.name}`}
                >
                  <RotateCcw size={13} className={busyId === checkpoint.id ? 'animate-spin' : ''} />
                </button>
                <button
                  onClick={() => void remove(checkpoint)}
                  disabled={readOnly || busyId === checkpoint.id}
                  className="p-1.5 rounded text-[#8b949e] hover:text-rose-400 hover:bg-[#21262d] disabled:opacity-40"
                  title={`Delete “${checkpoint.name}”`}
                  aria-label={`Delete checkpoint ${checkpoint.name}`}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
            {expandedId === checkpoint.id && (
              <div className="flex flex-col space-y-1">
                {files.length === 0 && <div className="text-[11px] text-[#8b949e]">No files recorded.</div>}
                {files.map(filePath => (
                  <button
                    key={filePath}
                    onClick={() => void showDiff(checkpoint.id, filePath)}
                    className={`text-left text-[11px] px-2 py-1 rounded truncate ${diff?.filePath === filePath ? 'bg-blue-600/30 text-blue-200' : 'text-[#c9d1d9] hover:bg-[#21262d]'}`}
                    title={`Diff ${filePath} against the checkpoint`}
                  >
                    {filePath}
                  </button>
                ))}
                {diff && (
                  <pre className="mt-1 p-2 rounded bg-[#0d1117] border border-[#30363d] font-mono text-[10px] whitespace-pre-wrap max-h-64 overflow-auto">{diff.text}</pre>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="px-3 py-2 border-t border-[#30363d] text-[10px] text-[#8b949e] shrink-0">
        Snapshots are stored locally in the workspace (.quillix/checkpoints). Secrets are never captured.
      </div>
    </div>
  );
};
