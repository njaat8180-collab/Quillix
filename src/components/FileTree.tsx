import React, { useState } from 'react';
import {
  Folder,
  FolderOpen,
  FileCode,
  FileText,
  FileJson,
  FileSpreadsheet,
  File,
  Plus,
  RefreshCw,
  Trash2,
  Edit2,
  ChevronRight,
  ChevronDown,
} from 'lucide-react';
import { FileNode } from '../shared/types.js';

interface FileTreeProps {
  tree: FileNode | null;
  activeFilePath?: string;
  onOpenFile: (filePath: string) => void;
  onRefresh: () => void;
  onCreateFile: (parentPath: string, fileName: string, isFolder: boolean) => void;
  onDeleteFile: (filePath: string) => void;
  onRenameFile: (oldPath: string, newPath: string) => void;
  readOnly?: boolean;
}

export const FileTree: React.FC<FileTreeProps> = ({
  tree,
  activeFilePath,
  onOpenFile,
  onRefresh,
  onCreateFile,
  onDeleteFile,
  onRenameFile,
  readOnly = false,
}) => {
  // Start with a useful outline, not thousands of expanded generated files.
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(['src']));
  const [creatingIn, setCreatingIn] = useState<{ path: string; isFolder: boolean } | null>(null);
  const [newItemName, setNewItemName] = useState('');
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const toggleFolder = (path: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const getFileIcon = (fileName: string) => {
    const ext = fileName.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'ts':
      case 'tsx':
      case 'js':
      case 'jsx':
        return <FileCode size={14} className="text-blue-400 shrink-0" />;
      case 'json':
        return <FileJson size={14} className="text-amber-400 shrink-0" />;
      case 'css':
      case 'scss':
        return <FileCode size={14} className="text-cyan-400 shrink-0" />;
      case 'md':
      case 'txt':
        return <FileText size={14} className="text-gray-400 shrink-0" />;
      case 'py':
        return <FileCode size={14} className="text-emerald-400 shrink-0" />;
      case 'rs':
        return <FileCode size={14} className="text-orange-400 shrink-0" />;
      default:
        return <File size={14} className="text-[#8b949e] shrink-0" />;
    }
  };

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!creatingIn || !newItemName.trim()) return;
    onCreateFile(creatingIn.path, newItemName.trim(), creatingIn.isFolder);
    setCreatingIn(null);
    setNewItemName('');
  };

  const handleRenameSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!renamingPath || !renameValue.trim()) return;
    const parts = renamingPath.split('/');
    parts.pop();
    const newPath = parts.length > 0 ? `${parts.join('/')}/${renameValue.trim()}` : renameValue.trim();
    onRenameFile(renamingPath, newPath);
    setRenamingPath(null);
    setRenameValue('');
  };

  const renderNode = (node: FileNode, depth = 0, index = 0) => {
    const isCollapsed = !expandedFolders.has(node.path);
    const isActive = activeFilePath === node.path;
    const isRenaming = renamingPath === node.path;
    const nodeKey = `${node.isDirectory ? 'dir' : 'file'}_${node.path || node.name}_${depth}_${index}`;

    if (node.isDirectory) {
      return (
        <div key={nodeKey} className="flex flex-col select-none">
          <div className="group flex items-center py-1 px-2 hover:bg-[var(--hover)] rounded text-xs text-[var(--text)]" style={{ paddingLeft: `${depth * 12 + 6}px` }}>
            <button type="button" className="flex min-w-0 flex-1 items-center space-x-1.5 text-left" onClick={() => toggleFolder(node.path)} aria-expanded={!isCollapsed} aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} folder ${node.name}`}>
              <span className="truncate font-medium">{node.name}</span>
            </button>

            {!readOnly && <div className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 flex items-center space-x-1">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setCreatingIn({ path: node.path, isFolder: false });
                  setExpandedFolders(previous => new Set([...previous, node.path]));
                }}
                title="New File in folder"
                className="p-0.5 hover:text-white"
              >
                <Plus size={12} />
              </button>
            </div>}
          </div>

          {/* Creation input inside folder */}
          {!readOnly && creatingIn && creatingIn.path === node.path && !isCollapsed && (
            <form onSubmit={handleCreateSubmit} className="py-1 px-2" style={{ paddingLeft: `${(depth + 1) * 12 + 6}px` }}>
              <input
                autoFocus
                type="text"
                placeholder={creatingIn.isFolder ? 'folder name...' : 'filename.ext...'}
                value={newItemName}
                onChange={(e) => setNewItemName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape') { setCreatingIn(null); setNewItemName(''); } }}
                className="w-full bg-[#0d1117] border border-blue-500 rounded px-1.5 py-0.5 text-xs text-white outline-none"
              />
            </form>
          )}

          {!isCollapsed && node.children && (
            <div className="flex flex-col">
              {node.children.map((child, childIdx) => renderNode(child, depth + 1, childIdx))}
            </div>
          )}
        </div>
      );
    }

    return (
      <div
        key={nodeKey}
        className={`group flex items-center justify-between py-1 px-2 rounded text-xs ${
          isActive ? 'bg-[var(--accent-soft)] text-[var(--text)] border-l-2 border-[var(--accent)]' : 'text-[var(--text)] hover:bg-[var(--hover)]'
        }`}
        style={{ paddingLeft: `${depth * 12 + 6}px` }}
      >
        {isRenaming ? (
          <form onSubmit={handleRenameSubmit} className="flex min-w-0 flex-1 items-center gap-2">
            {getFileIcon(node.name)}
            <input
              autoFocus
              type="text"
              value={renameValue}
              aria-label={`Rename ${node.name}`}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') { setRenamingPath(null); setRenameValue(''); } }}
              className="w-full min-w-0 bg-[#0d1117] border border-blue-500 rounded px-1 py-0.5 text-xs text-white outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            />
          </form>
        ) : (
          <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => onOpenFile(node.path)} aria-label={`Open file ${node.name}`}>
            {getFileIcon(node.name)}
            <span className="truncate">{node.name}</span>
          </button>
        )}

        {!readOnly && !isRenaming && <div className="flex shrink-0 items-center space-x-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setRenamingPath(node.path);
              setRenameValue(node.name);
            }}
            title="Rename"
            className="p-0.5 hover:text-white text-[#8b949e]"
          >
            <Edit2 size={11} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (window.confirm(`Delete ${node.name}? This will permanently delete the file.`)) {
                onDeleteFile(node.path);
              }
            }}
            title="Delete file"
            className="p-0.5 hover:text-red-400 text-[#8b949e]"
          >
            <Trash2 size={11} />
          </button>
        </div>}
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col bg-[var(--surface)] text-[var(--text)] text-xs">
      {/* Header bar */}
      <div className="h-9 px-3 border-b border-[var(--border)] flex items-center justify-between select-none shrink-0">
        <span className="font-semibold text-xs tracking-wider uppercase text-[#8b949e]">Explorer</span>
        <div className="flex items-center space-x-1 text-[#8b949e]">
          {!readOnly && <>
          <button
            onClick={() => setCreatingIn({ path: '.', isFolder: false })}
            title="New File (Root)"
            aria-label="New File (Root)"
            className="p-1 hover:text-white hover:bg-[#21262d] rounded"
          >
            <Plus size={14} />
          </button>
          <button
            onClick={() => setCreatingIn({ path: '.', isFolder: true })}
            title="New Folder (Root)"
            aria-label="New Folder (Root)"
            className="p-1 hover:text-white hover:bg-[#21262d] rounded"
          >
            <Folder size={14} />
          </button>
          </>}
          <button
            onClick={onRefresh}
            title="Refresh Files"
            aria-label="Refresh Files"
            className="p-1 hover:text-white hover:bg-[#21262d] rounded"
          >
            <RefreshCw size={13} />
          </button>
        </div>
      </div>

      {/* Root creation input */}
      {!readOnly && creatingIn && creatingIn.path === '.' && (
        <form onSubmit={handleCreateSubmit} className="p-2 border-b border-[#30363d] bg-[#161b22]">
          <input
            autoFocus
            type="text"
            placeholder={creatingIn.isFolder ? 'New folder name...' : 'New file name...'}
            value={newItemName}
            onChange={(e) => setNewItemName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { setCreatingIn(null); setNewItemName(''); } }}
            className="w-full bg-[#0d1117] border border-blue-500 rounded px-2 py-1 text-xs text-white outline-none"
          />
        </form>
      )}

      {/* File Tree List */}
      <div className="flex-1 overflow-y-auto py-1">
        {tree && tree.children && tree.children.length > 0 ? (
          tree.children.map((child, idx) => renderNode(child, 0, idx))
        ) : (
          <div className="p-4 text-center text-[#8b949e]">No files in workspace</div>
        )}
      </div>
    </div>
  );
};
