import React, { useState, useEffect, useRef, useCallback, createContext, useContext } from 'react';
import { Command as CommandIcon, Search } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

export interface CommandPaletteAction {
  id: string;
  title: string;
  description?: string;
  icon?: React.ReactNode;
  shortcut?: string;
  category?: string;
  onExecute?: () => void;
  keywords?: string[];
}

export interface CommandPaletteProps {
  onExecuteAction: (actionId: string) => void;
  customActions?: CommandPaletteAction[];
  workspaceRoot?: string;
  activeFile?: string;
  hasActiveProject?: boolean;
  isOpen?: boolean;
  onClose?: () => void;
}

// Internal state shared between hook and component
interface CommandPaletteState {
  isOpen: boolean;
  query: string;
  selectedIndex: number;
  customActions: CommandPaletteAction[];
}

interface CommandPaletteContextValue extends CommandPaletteState {
  setIsOpen: (open: boolean) => void;
  setQuery: (query: string) => void;
  setSelectedIndex: React.Dispatch<React.SetStateAction<number>>;
  setCustomActions: (actions: CommandPaletteAction[]) => void;
  registerAction: (action: CommandPaletteAction) => void;
  unregisterAction: (actionId: string) => void;
  open: () => void;
  close: () => void;
  executeAction: (actionId: string) => void;
}

const CommandPaletteContext = createContext<CommandPaletteContextValue | null>(null);

export function useCommandPaletteContext() {
  const context = useContext(CommandPaletteContext);
  if (!context) {
    throw new Error('useCommandPaletteContext must be used within a CommandPaletteProvider');
  }
  return context;
}

export function useCommandPalette() {
  const context = useContext(CommandPaletteContext);
  if (!context) {
    // Return a minimal controller if not in provider
    return {
      isOpen: false,
      open: () => {},
      close: () => {},
      registerAction: () => {},
      unregisterAction: () => {},
    };
  }
  return {
    isOpen: context.isOpen,
    open: context.open,
    close: context.close,
    registerAction: context.registerAction,
    unregisterAction: context.unregisterAction,
  };
}

function CommandPaletteProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  const [customActions, setCustomActions] = useState<CommandPaletteAction[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const open = useCallback(() => {
    setIsOpen(true);
    setQuery('');
    setSelectedIndex(0);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    setQuery('');
    setSelectedIndex(0);
  }, []);

  const registerAction = useCallback((action: CommandPaletteAction) => {
    setCustomActions(prev => {
      if (prev.some(a => a.id === action.id)) return prev;
      return [...prev, action];
    });
  }, []);

  const unregisterAction = useCallback((actionId: string) => {
    setCustomActions(prev => prev.filter(a => a.id !== actionId));
  }, []);

  const executeAction = useCallback((actionId: string) => {
    const allActions = [...builtInActions, ...customActions];
    const action = allActions.find(a => a.id === actionId);
    if (action && 'onExecute' in action && action.onExecute) {
      action.onExecute();
    }
    close();
  }, [customActions, close]);

  const value = {
    isOpen,
    query,
    selectedIndex,
    customActions,
    setIsOpen,
    setQuery,
    setSelectedIndex,
    setCustomActions,
    registerAction,
    unregisterAction,
    open,
    close,
    executeAction,
  };

  return (
    <CommandPaletteContext.Provider value={value}>
      {children}
    </CommandPaletteContext.Provider>
  );
}

const builtInActions = [
  { id: 'nav.open-workspace', title: 'Open Workspace', description: 'Open a project folder', icon: React.createElement(CommandIcon, { size: 14 }), shortcut: 'Ctrl+O', category: 'Navigation', keywords: ['open', 'workspace', 'folder', 'project'] },
  { id: 'nav.file-explorer', title: 'File Explorer', description: 'Show file explorer', icon: React.createElement(CommandIcon, { size: 14 }), shortcut: 'Ctrl+Shift+E', category: 'Navigation', keywords: ['file', 'explorer', 'tree'] },
  { id: 'nav.go-to-file', title: 'Go to File', description: 'Quick open file by name', icon: React.createElement(CommandIcon, { size: 14 }), shortcut: 'Ctrl+P', category: 'Navigation', keywords: ['goto', 'file', 'open'] },
  { id: 'nav.go-to-symbol', title: 'Go to Symbol', description: 'Navigate to symbol in workspace', icon: React.createElement(CommandIcon, { size: 14 }), shortcut: 'Ctrl+T', category: 'Navigation', keywords: ['goto', 'symbol', 'navigate'] },
  { id: 'editor.new-file', title: 'New File', description: 'Create a new file', icon: React.createElement(CommandIcon, { size: 14 }), shortcut: 'Ctrl+N', category: 'Editor', keywords: ['new', 'file', 'create'] },
  { id: 'editor.save', title: 'Save File', description: 'Save the active file', icon: React.createElement(CommandIcon, { size: 14 }), shortcut: 'Ctrl+S', category: 'Editor', keywords: ['save', 'write'] },
  { id: 'editor.toggle-terminal', title: 'Toggle Terminal', description: 'Show/hide integrated terminal', icon: React.createElement(CommandIcon, { size: 14 }), shortcut: 'Ctrl+', category: 'Editor', keywords: ['terminal', 'console', 'shell'] },
  { id: 'editor.toggle-sidebar', title: 'Toggle Sidebar', description: 'Show/hide sidebar', icon: React.createElement(CommandIcon, { size: 14 }), shortcut: 'Ctrl+B', category: 'Editor', keywords: ['sidebar', 'toggle', 'panel'] },
  { id: 'editor.command-palette', title: 'Command Palette', description: 'Show all commands', icon: React.createElement(CommandIcon, { size: 14 }), shortcut: 'Ctrl+Shift+P', category: 'Editor', keywords: ['command', 'palette', 'commands'] },
  { id: 'ai.inline-prompt', title: 'Inline AI Prompt', description: 'Trigger inline AI completion', icon: React.createElement(CommandIcon, { size: 14 }), shortcut: 'Ctrl+K', category: 'AI', keywords: ['ai', 'inline', 'prompt', 'complete'] },
  { id: 'ai.chat', title: 'AI Chat', description: 'Open AI chat panel', icon: React.createElement(CommandIcon, { size: 14 }), shortcut: 'Ctrl+L', category: 'AI', keywords: ['ai', 'chat', 'assistant'] },
  { id: 'project.run', title: 'Run Project', description: 'Run the project', icon: React.createElement(CommandIcon, { size: 14 }), shortcut: 'F5', category: 'Project', keywords: ['run', 'start', 'execute'] },
  { id: 'project.build', title: 'Build Project', description: 'Build the project', icon: React.createElement(CommandIcon, { size: 14 }), shortcut: 'Ctrl+Shift+B', category: 'Project', keywords: ['build', 'compile'] },
  { id: 'project.test', title: 'Run Tests', description: 'Run project tests', icon: React.createElement(CommandIcon, { size: 14 }), shortcut: 'Ctrl+Shift+T', category: 'Project', keywords: ['test', 'testing'] },
  { id: 'project.create', title: 'Create Project', description: 'Create a new project', icon: React.createElement(CommandIcon, { size: 14 }), category: 'Project', keywords: ['create', 'new', 'project', 'scaffold'] },
  { id: 'project.settings', title: 'Project Settings', description: 'Open project settings', icon: React.createElement(CommandIcon, { size: 14 }), category: 'Project', keywords: ['settings', 'config', 'preferences'] },
  { id: 'settings.open', title: 'Open Settings', description: 'Open application settings', icon: React.createElement(CommandIcon, { size: 14 }), shortcut: 'Ctrl+,', category: 'Settings', keywords: ['settings', 'preferences', 'options'] },
  { id: 'help.shortcuts', title: 'Keyboard Shortcuts', description: 'View all keyboard shortcuts', icon: React.createElement(CommandIcon, { size: 14 }), shortcut: 'Ctrl+K Ctrl+S', category: 'Help', keywords: ['shortcuts', 'keys', 'keybindings', 'help'] },
];

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

export { CommandPaletteProvider };
