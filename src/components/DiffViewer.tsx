import React, { useState } from 'react';
import { Check, X, Split, AlignJustify, FileText, ArrowRight } from 'lucide-react';
import { FilePatch } from '../shared/types.js';
import { PatchEngine } from '../server/patchEngine.js';

interface DiffViewerProps {
  patch: FilePatch;
  onApply: (patch: FilePatch) => void;
  onReject: (patch: FilePatch) => void;
  onClose: () => void;
}

export const DiffViewer: React.FC<DiffViewerProps> = ({
  patch,
  onApply,
  onReject,
  onClose,
}) => {
  const [viewMode, setViewMode] = useState<'unified' | 'split'>('unified');

  const diffLines = PatchEngine.parseDiffLines(patch.diff);

  return (
    <div className="flex-1 flex flex-col bg-[#0d1117] border-l border-[#30363d] h-full text-xs">
      {/* Header */}
      <div className="h-10 px-3 bg-[#161b22] border-b border-[#30363d] flex items-center justify-between select-none">
        <div className="flex items-center space-x-2 truncate">
          <FileText size={14} className="text-blue-400 shrink-0" />
          <span className="font-semibold text-white truncate">{patch.filePath}</span>
          <span className="text-[11px] px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800">
            +{patch.linesAdded}
          </span>
          <span className="text-[11px] px-1.5 py-0.5 rounded bg-rose-950 text-rose-400 border border-rose-800">
            -{patch.linesRemoved}
          </span>
        </div>

        <div className="flex items-center space-x-2">
          {/* View mode toggle */}
          <div className="flex items-center bg-[#0d1117] rounded p-0.5 border border-[#30363d]">
            <button
              onClick={() => setViewMode('unified')}
              className={`p-1 rounded ${viewMode === 'unified' ? 'bg-[#21262d] text-white' : 'text-[#8b949e]'}`}
              title="Unified Diff View"
            >
              <AlignJustify size={13} />
            </button>
            <button
              onClick={() => setViewMode('split')}
              className={`p-1 rounded ${viewMode === 'split' ? 'bg-[#21262d] text-white' : 'text-[#8b949e]'}`}
              title="Side by Side Split View"
            >
              <Split size={13} />
            </button>
          </div>

          {/* Action buttons */}
          <button
            onClick={() => onApply(patch)}
            className="flex items-center space-x-1 px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded font-medium transition-colors"
          >
            <Check size={13} />
            <span>Accept Changes</span>
          </button>
          <button
            onClick={() => onReject(patch)}
            className="flex items-center space-x-1 px-2.5 py-1 bg-[#21262d] hover:bg-rose-900/50 hover:text-rose-300 text-[#c9d1d9] border border-[#30363d] rounded transition-colors"
          >
            <X size={13} />
            <span>Reject</span>
          </button>
        </div>
      </div>

      {/* Diff Content View */}
      <div className="flex-1 overflow-auto font-mono text-[12px] bg-[#0d1117]">
        {diffLines.length === 0 ? (
          <div className="p-8 text-center text-[#8b949e]">No textual differences detected.</div>
        ) : viewMode === 'unified' ? (
          <div className="min-w-full inline-block">
            {diffLines.map((line, idx) => {
              let bg = '';
              let textColor = 'text-[#c9d1d9]';
              let sign = ' ';

              if (line.type === 'add') {
                bg = 'bg-[#1b4427]/40';
                textColor = 'text-emerald-300';
                sign = '+';
              } else if (line.type === 'remove') {
                bg = 'bg-[#5c1d24]/40';
                textColor = 'text-rose-300';
                sign = '-';
              } else if (line.type === 'header') {
                bg = 'bg-[#161b22]';
                textColor = 'text-[#58a6ff]';
                sign = '@';
              }

              return (
                <div key={`diff_${line.type}_${line.oldLine ?? ''}_${line.newLine ?? ''}_${idx}`} className={`flex items-start leading-5 hover:bg-opacity-80 px-2 ${bg}`}>
                  <div className="w-10 text-right pr-2 text-[#484f58] select-none text-[11px]">
                    {line.oldLine ?? ''}
                  </div>
                  <div className="w-10 text-right pr-2 text-[#484f58] select-none text-[11px]">
                    {line.newLine ?? ''}
                  </div>
                  <div className="w-4 text-center select-none font-bold opacity-60">
                    {sign}
                  </div>
                  <div className={`flex-1 whitespace-pre pl-1 ${textColor}`}>
                    {line.text}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* Side by side split */
          <div className="grid grid-cols-2 divide-x divide-[#30363d] min-h-full">
            <div className="flex flex-col">
              <div className="p-1.5 bg-[#161b22] text-[#8b949e] font-semibold uppercase text-[10px] border-b border-[#30363d] sticky top-0">
                Original Version
              </div>
              <div className="p-2 whitespace-pre text-rose-300 font-mono text-[11px] overflow-auto">
                {patch.oldContent || '(File is new)'}
              </div>
            </div>
            <div className="flex flex-col">
              <div className="p-1.5 bg-[#161b22] text-emerald-400 font-semibold uppercase text-[10px] border-b border-[#30363d] sticky top-0">
                Proposed Changes
              </div>
              <div className="p-2 whitespace-pre text-emerald-300 font-mono text-[11px] overflow-auto">
                {patch.newContent || '(File will be deleted)'}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
