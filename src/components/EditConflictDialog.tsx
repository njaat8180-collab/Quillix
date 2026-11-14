import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, RefreshCw, Save, Split, AlignJustify, X } from 'lucide-react';
import { PatchEngine } from '../server/patchEngine.js';

/** How the user wants to resolve a detected edit conflict. */
export type EditConflictResolution = 'reload' | 'overwrite' | 'keep';

interface EditConflictDialogProps {
  filePath: string;
  /** Current contents on disk — the version QUILLIX wrote. */
  diskContent: string;
  /** The user's unsaved editor buffer. */
  editorContent: string;
  /** Short explanation of what triggered the conflict. */
  reason?: string;
  onResolve: (resolution: EditConflictResolution) => void;
}

/**
 * M2.5 — Edit conflict dialog.
 *
 * Surfaces whenever an agent write and an unsaved user buffer race each other
 * (detected either by the 409 optimistic-concurrency guard on save, or when the
 * agent rewrites a file that still has unsaved edits). Never silently discards
 * either side: the user picks which version wins, or keeps editing.
 */
export const EditConflictDialog: React.FC<EditConflictDialogProps> = ({
  filePath,
  diskContent,
  editorContent,
  reason,
  onResolve,
}) => {
  const [viewMode, setViewMode] = useState<'unified' | 'split'>('unified');
  const primaryRef = useRef<HTMLButtonElement>(null);

  const patch = useMemo(
    // oldContent = what is on disk now, newContent = the user's unsaved buffer.
    () => PatchEngine.createPatch(filePath, diskContent, editorContent, 'modified'),
    [filePath, diskContent, editorContent],
  );
  const diffLines = useMemo(() => PatchEngine.parseDiffLines(patch.diff), [patch.diff]);
  const identical = diskContent === editorContent;

  useEffect(() => {
    primaryRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onResolve('keep');
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onResolve]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="presentation">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => onResolve('keep')} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-conflict-title"
        className="relative z-10 w-full max-w-5xl h-[85vh] flex flex-col rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-[var(--border)] flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="edit-conflict-title" className="text-[13px] font-semibold text-[var(--text)] flex items-center gap-2">
              <AlertTriangle size={15} style={{ color: 'var(--warning, #f59e0b)' }} aria-hidden="true" />
              Edit conflict — this file changed on disk
            </h2>
            <p className="mt-1 text-[11px] text-[var(--text-muted)] font-mono truncate" title={filePath}>
              {filePath}
            </p>
            <p className="mt-1 text-[11px] text-[var(--text-muted)]">
              {reason || 'QUILLIX wrote a new version while your unsaved edits were still open. Choose which version to keep.'}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="flex items-center bg-[var(--surface-secondary)] rounded-lg p-0.5 border border-[var(--border)]">
              <button
                type="button"
                onClick={() => setViewMode('unified')}
                aria-label="Unified diff view"
                title="Unified diff"
                className={`p-1 rounded ${viewMode === 'unified' ? 'bg-[var(--accent-soft)] text-[var(--accent)]' : 'text-[var(--text-muted)]'}`}
              >
                <AlignJustify size={13} />
              </button>
              <button
                type="button"
                onClick={() => setViewMode('split')}
                aria-label="Side by side diff view"
                title="Side by side"
                className={`p-1 rounded ${viewMode === 'split' ? 'bg-[var(--accent-soft)] text-[var(--accent)]' : 'text-[var(--text-muted)]'}`}
              >
                <Split size={13} />
              </button>
            </div>
            <button
              type="button"
              onClick={() => onResolve('keep')}
              aria-label="Close conflict dialog"
              title="Keep editing (Escape)"
              className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-secondary)]"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Legend */}
        <div className="px-4 py-2 border-b border-[var(--border)] flex items-center gap-4 text-[11px]">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500/70" aria-hidden="true" />
            <span className="text-[var(--text-muted)]">On disk (QUILLIX) — <span className="text-emerald-400 font-mono">+{patch.linesAdded}</span></span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-rose-500/70" aria-hidden="true" />
            <span className="text-[var(--text-muted)]">Your unsaved edits — <span className="text-rose-400 font-mono">-{patch.linesRemoved}</span></span>
          </span>
        </div>

        {/* Diff body */}
        <div className="flex-1 overflow-auto font-mono text-[12px] bg-[var(--surface-secondary)]">
          {identical ? (
            <div className="p-8 text-center text-[var(--text-muted)]">
              Your buffer already matches the file on disk — nothing to merge.
            </div>
          ) : viewMode === 'unified' ? (
            <div className="min-w-full inline-block">
              {diffLines.map((line, idx) => {
                let bg = '';
                let textColor = 'text-[var(--text)]';
                let sign = ' ';
                if (line.type === 'add') {
                  bg = 'bg-emerald-500/10';
                  textColor = 'text-emerald-300';
                  sign = '+';
                } else if (line.type === 'remove') {
                  bg = 'bg-rose-500/10';
                  textColor = 'text-rose-300';
                  sign = '-';
                } else if (line.type === 'header') {
                  bg = 'bg-[var(--surface)]';
                  textColor = 'text-[var(--accent)]';
                  sign = '@';
                }
                return (
                  <div key={`conflict_${line.type}_${idx}_${line.oldLine ?? ''}_${line.newLine ?? ''}`} className={`flex items-start leading-5 px-2 ${bg}`}>
                    <div className="w-10 text-right pr-2 text-[var(--text-muted)] opacity-50 select-none text-[11px]">{line.oldLine ?? ''}</div>
                    <div className="w-10 text-right pr-2 text-[var(--text-muted)] opacity-50 select-none text-[11px]">{line.newLine ?? ''}</div>
                    <div className="w-3 text-center select-none font-bold opacity-60">{sign}</div>
                    <div className={`flex-1 whitespace-pre pl-1 ${textColor}`}>{line.text}</div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="grid grid-cols-2 divide-x divide-[var(--border)] min-h-full">
              <div className="flex flex-col">
                <div className="p-1.5 bg-[var(--surface)] text-rose-400 font-semibold uppercase text-[10px] border-b border-[var(--border)] sticky top-0">
                  Your unsaved edits
                </div>
                <div className="p-2 whitespace-pre text-rose-200 font-mono text-[11px]">{editorContent || '(empty)'}</div>
              </div>
              <div className="flex flex-col">
                <div className="p-1.5 bg-[var(--surface)] text-emerald-400 font-semibold uppercase text-[10px] border-b border-[var(--border)] sticky top-0">
                  On disk (QUILLIX)
                </div>
                <div className="p-2 whitespace-pre text-emerald-200 font-mono text-[11px]">{diskContent || '(empty)'}</div>
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="px-4 py-3 border-t border-[var(--border)] flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => onResolve('keep')}
            className="px-3 py-2 rounded-xl text-[12px] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-secondary)]"
          >
            Keep editing
          </button>
          <button
            type="button"
            onClick={() => onResolve('reload')}
            className="px-3 py-2 rounded-xl text-[12px] border border-[var(--border)] text-[var(--text)] hover:border-rose-500/60 hover:text-rose-300 flex items-center gap-1.5"
          >
            <RefreshCw size={13} aria-hidden="true" />
            Reload from disk (discard my edits)
          </button>
          <button
            ref={primaryRef}
            type="button"
            onClick={() => onResolve('overwrite')}
            className="px-3 py-2 rounded-xl text-[12px] text-white flex items-center gap-1.5"
            style={{ background: 'var(--accent)' }}
          >
            <Save size={13} aria-hidden="true" />
            Overwrite file with my edits
          </button>
        </div>
      </div>
    </div>
  );
};
