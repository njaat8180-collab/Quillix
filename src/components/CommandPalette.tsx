/**
 * Command palette UI.
 *
 * The state container (provider + hooks + built-in actions) lives in
 * `CommandPaletteState.tsx` so this component can be loaded on demand via
 * `React.lazy()` without the bundler reporting an ineffective dynamic import.
 *
 * The component markup below is unchanged from the original single-module
 * implementation — only the module boundary moved.
 */
import React, { useEffect, useRef, useCallback } from 'react';
import { Command as CommandIcon, Search } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import {
  builtInActions,
  useCommandPaletteContext,
  type CommandPaletteAction,
} from './CommandPaletteState.js';

export interface CommandPaletteProps {
  onExecuteAction: (actionId: string) => void;
  customActions?: CommandPaletteAction[];
  workspaceRoot?: string;
  activeFile?: string;
  hasActiveProject?: boolean;
  isOpen?: boolean;
  onClose?: () => void;
}

export type { CommandPaletteAction } from './CommandPaletteState.js';

export function CommandPalette(props: CommandPaletteProps) {
  const { onExecuteAction, customActions = [], workspaceRoot, activeFile, hasActiveProject } = props;
  const {
    isOpen,
    query,
    selectedIndex,
    customActions: contextCustomActions,
    setQuery,
    setSelectedIndex,
    close,
    executeAction,
  } = useCommandPaletteContext();

  const inputRef = useRef<HTMLInputElement>(null);
  const allActions = [...builtInActions, ...contextCustomActions, ...customActions];

  const filteredActions = allActions
    .filter(action => {
      if (!query.trim()) return true;
      const searchTerm = query.toLowerCase();
      const titleMatch = action.title.toLowerCase().includes(searchTerm);
      const descMatch = action.description?.toLowerCase().includes(searchTerm);
      const keywordMatch = action.keywords?.some(k => k.toLowerCase().includes(searchTerm));
      const categoryMatch = action.category?.toLowerCase().includes(searchTerm);
      return titleMatch || descMatch || keywordMatch || categoryMatch;
    })
    .slice(0, 50);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'Escape':
        close();
        break;
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(prev => Math.min(prev + 1, Math.max(0, filteredActions.length - 1)));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(prev => Math.max(prev - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (filteredActions[selectedIndex]) {
          onExecuteAction(filteredActions[selectedIndex].id);
          close();
        }
        break;
    }
  }, [close, filteredActions, selectedIndex, onExecuteAction, setSelectedIndex]);

  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className='fixed inset-0 z-50 flex items-start justify-center pt-20'
        role='dialog'
        aria-modal='true'
        aria-label='Command palette'
      >
        <div className="absolute inset-0 bg-[var(--overlay)]" onClick={close} aria-hidden="true" />
        <motion.div
          initial={{ opacity: 0, y: -20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -20, scale: 0.95 }}
          className='relative z-10 w-[640px] max-w-[90vw] rounded-xl bg-[var(--surface)] border border-[var(--border)] shadow-2xl overflow-hidden'
        >
          <div className='flex items-center gap-2 border-b border-[var(--border)] px-4 py-3'>
            <Search size={16} className='text-[var(--accent)] shrink-0' aria-hidden='true' />
            <input
              ref={inputRef}
              type='text'
              value={query}
              onChange={e => { setQuery(e.target.value); setSelectedIndex(0); }}
              onKeyDown={handleKeyDown}
              placeholder='Type a command or search...'
              className='flex-1 bg-transparent border-none text-[14px] text-[var(--text)] placeholder-[var(--text-muted)] focus:outline-none'
              autoFocus
              aria-label='Search commands'
              aria-controls='command-list'
              aria-activedescendant={filteredActions[selectedIndex] ? 'cmd-' + selectedIndex : undefined}
            />
            <kbd className='px-2 py-0.5 text-[10px] text-[var(--text-muted)] bg-[var(--bg)] rounded border border-[var(--border)]'>Ctrl+K</kbd>
          </div>
          
          <ul id='command-list' role='listbox' className='max-h-[400px] overflow-auto' aria-label='Available commands'>
            {filteredActions.length === 0 ? (
              <li className='px-4 py-6 text-center text-[var(--text-muted)] text-[13px]' role='option' aria-disabled='true'>
                No commands match
              </li>
            ) : (
              filteredActions.map((action, i) => (
                <li
                  key={action.id}
                  id={'cmd-' + i}
                  role='option'
                  aria-selected={i === selectedIndex}
                  className={'px-4 py-2.5 flex items-center gap-3 transition-colors cursor-pointer ' + (i === selectedIndex ? 'bg-[var(--hover)]' : '')}
                  onClick={() => { onExecuteAction(action.id); close(); }}
                  onMouseEnter={() => setSelectedIndex(i)}
                >
                  <span className='text-[var(--text-muted)] shrink-0 w-5 h-5 flex items-center justify-center'>
                    {action.icon || React.createElement(CommandIcon, { size: 14 })}
                  </span>
                  <div className='flex-1 min-w-0 text-left'>
                    <div className='text-[13px] font-medium text-[var(--text)] truncate'>{action.title}</div>
                    {action.description && (
                      <div className='text-[11px] text-[var(--text-muted)] truncate'>{action.description}</div>
                    )}
                  </div>
                  {action.shortcut && (
                    <kbd className='px-1.5 py-0.5 text-[10px] text-[var(--text-muted)] bg-[var(--bg)] rounded border border-[var(--border)] shrink-0'>
                      {action.shortcut}
                    </kbd>
                  )}
                  {action.category && (
                    <span className='px-1.5 py-0.5 text-[10px] text-[var(--text-muted)] bg-[var(--bg)] rounded border border-[var(--border)] shrink-0'>
                      {action.category}
                    </span>
                  )}
                </li>
              ))
            )}
          </ul>
          
          <div className='border-t border-[var(--border)] px-4 py-2 text-center text-[11px] text-[var(--text-muted)]'>
            <kbd className='px-1.5 py-0.5 mr-1 text-[10px] bg-[var(--bg)] rounded border border-[var(--border)]'>Esc</kbd> Close
            <span className='mx-2'>.</span>
            <kbd className='px-1.5 py-0.5 mr-1 text-[10px] bg-[var(--bg)] rounded border border-[var(--border)]'>Up/Down</kbd> Navigate
            <span className='mx-2'>.</span>
            <kbd className='px-1.5 py-0.5 mr-1 text-[10px] bg-[var(--bg)] rounded border border-[var(--border)]'>Enter</kbd> Execute
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// The provider now lives in CommandPaletteState.tsx. Re-exported here so
// existing importers of `CommandPaletteProvider` keep working.
export { CommandPaletteProvider } from './CommandPaletteState.js';
