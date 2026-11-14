/**
 * Command palette state container.
 *
 * Split out from `CommandPalette.tsx` so the *palette UI* can be code-split
 * and loaded on demand while the *state* (which App.tsx needs immediately for
 * the keyboard shortcut handler) stays in the main bundle. Keeping both in one
 * module made `React.lazy()` ineffective — the bundler reported:
 *
 *   INEFFECTIVE_DYNAMIC_IMPORT: src/components/CommandPalette.tsx is
 *   dynamically imported by src/App.tsx but also statically imported by
 *   src/App.tsx
 *
 * because `App.tsx` still needed `useCommandPalette` / `CommandPaletteProvider`
 * from the same file. This module contains only the provider, the hooks and
 * the action contracts; the visual palette lives in `CommandPalette.tsx`.
 */
import React, { createContext, useCallback, useContext, useState } from 'react';
import { Command as CommandIcon } from 'lucide-react';

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

/**
 * Internal state shared between hook and component.
 */
export interface CommandPaletteState {
  isOpen: boolean;
  query: string;
  selectedIndex: number;
  customActions: CommandPaletteAction[];
}

export interface CommandPaletteContextValue extends CommandPaletteState {
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

export const CommandPaletteContext = createContext<CommandPaletteContextValue | null>(null);

export function useCommandPaletteContext(): CommandPaletteContextValue {
  const context = useContext(CommandPaletteContext);
  if (!context) {
    throw new Error('useCommandPaletteContext must be used within a CommandPaletteProvider');
  }
  return context;
}

export function useCommandPalette(): CommandPaletteContextValue {
  const context = useContext(CommandPaletteContext);
  if (!context) {
    // Return a minimal controller if not in provider.
    return {
      isOpen: false,
      query: '',
      selectedIndex: 0,
      customActions: [],
      setIsOpen: () => {},
      setQuery: () => {},
      setSelectedIndex: () => {},
      setCustomActions: () => {},
      registerAction: () => {},
      unregisterAction: () => {},
      open: () => {},
      close: () => {},
      executeAction: () => {},
    };
  }
  return context;
}

export function CommandPaletteProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [customActions, setCustomActions] = useState<CommandPaletteAction[]>([]);

  const open = useCallback(() => {
    setIsOpen(true);
    setQuery('');
    setSelectedIndex(0);
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

  const value: CommandPaletteContextValue = {
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

/**
 * Built-in palette actions. Kept here (not in the UI module) so the provider
 * can execute them without pulling the palette UI into the main bundle.
 */
export const builtInActions: CommandPaletteAction[] = [
  { id: 'file.new', title: 'New File', description: 'Create a new file in the workspace', icon: React.createElement(CommandIcon, { size: 14 }), shortcut: 'Ctrl+N', category: 'File', keywords: ['new', 'create', 'file'] },
  { id: 'file.open', title: 'Open File', description: 'Open a file from the workspace', icon: React.createElement(CommandIcon, { size: 14 }), shortcut: 'Ctrl+P', category: 'File', keywords: ['open', 'file', 'goto'] },
  { id: 'file.save', title: 'Save File', description: 'Save the active file', icon: React.createElement(CommandIcon, { size: 14 }), shortcut: 'Ctrl+S', category: 'File', keywords: ['save', 'write'] },
  { id: 'editor.toggle-terminal', title: 'Toggle Terminal', description: 'Show/hide integrated terminal', icon: React.createElement(CommandIcon, { size: 14 }), shortcut: 'Ctrl+`', category: 'Editor', keywords: ['terminal', 'console', 'shell'] },
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
