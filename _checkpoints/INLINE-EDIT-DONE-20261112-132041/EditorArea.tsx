import React, { useState, useEffect, useRef } from 'react';
import Editor from '@monaco-editor/react';
import { X, Save, Sparkles, MessageSquare, Bug, CheckSquare, Wrench, FileCode, AlignLeft, MonitorPlay } from 'lucide-react';
import { api } from '../services/apiBridge.js';
import { useTheme } from '../theme.js';
import { QuillixMark } from './QuillixMark.js';
import { editorModelPath, configureEditorIntelligence, revealEditorDestination, mergeEditorSources, registerProjectCompletionProvider, registerConnectedLspProviders, EDITOR_INTELLIGENCE_OPTIONS } from '../services/editorIntelligence.js';
import { InlineCompletionCache, INLINE_COMPLETION_LANGUAGES, inlineCompletionCacheKey, subscribeInlineCancellation, isCompletionSuppressedContext, trimIncompleteTail, INLINE_COMPLETION_DEBOUNCE_MS, INLINE_COMPLETION_THROTTLE_MS } from '../shared/inlineCompletion.js';
import type { EditorProjectSnapshot } from '../shared/editorProject.js';

export interface EditorTab {
  filePath: string;
  fileName: string;
  content: string;
  originalContent: string;
  isDirty: boolean;
  language: string;
}

interface EditorAreaProps {
  workspaceId?: string;
  refreshSignal?: number;
  onOpenFile?: (filePath: string) => Promise<void>;
  onFormatFile?: (filePath: string) => void;
  formatting?: boolean;
  active?: boolean;
  tabs: EditorTab[];
  activeTabPath: string | null;
  fileOpenError?: { path: string; message: string } | null;
  onRetryOpenFile?: (filePath: string) => void;
  onSelectTab: (filePath: string) => void;
  onCloseTab: (filePath: string) => void;
  onContentChange: (filePath: string, newContent: string) => void;
  onSaveFile: (filePath: string) => void;
  onAskInlineAI: (prompt: string, selectedText: string, filePath: string) => void;
  previewInfo?: { root: string; entry: string; title: string } | null;
  onOpenPreview?: (info: { root: string; entry: string; title: string }) => void;
  readOnly?: boolean;
}

export const EditorArea: React.FC<EditorAreaProps> = ({
  workspaceId = '',
  refreshSignal = 0,
  onOpenFile,
  onFormatFile,
  formatting,
  active = true,
  tabs,
  activeTabPath,
  fileOpenError = null,
  onRetryOpenFile,
  onSelectTab,
  onCloseTab,
  onContentChange,
  onSaveFile,
  onAskInlineAI,
  previewInfo = null,
  onOpenPreview,
  readOnly = false,
}) => {
  const { theme } = useTheme();
  const [selectedText, setSelectedText] = useState('');
  const [showInlinePrompt, setShowInlinePrompt] = useState(false);
  const [inlineInput, setInlineInput] = useState('');
  const editorRef = useRef<any>(null);
  const instanceId = React.useId();
  const modelScope = `${instanceId}:${workspaceId}`;
  const [monacoApi, setMonacoApi] = useState<any>(null);
  const ownedModels = useRef(new Map<string, any>());
  const completionProvider = useRef<{ dispose: () => void } | null>(null);
  const lspRegistration = useRef<{ dispose: () => void; refreshDiagnostics: (filePath: string) => Promise<void> } | null>(null);
  const inlineCompletionProvider = useRef<{ dispose: () => void } | null>(null);
  const inlineRequest = useRef<AbortController | null>(null);
  const inlineCompletionCache = useRef(new InlineCompletionCache());
  const lastInlineRequestAt = useRef(0);
  const inlinePromptRef = useRef<HTMLDivElement | null>(null);
  const navigation = useRef<any>(null);
  const currentTabs = useRef(tabs);
  const selectTab = useRef(onSelectTab);
  const openFile = useRef(onOpenFile);
  openFile.current = onOpenFile;
  const [snapshot, setSnapshot] = useState<EditorProjectSnapshot | null>(null);
  const [sourceStatus, setSourceStatus] = useState('');
  const [sourceRefresh, setSourceRefresh] = useState(0);
  const [problemCount, setProblemCount] = useState(0);
  const sourceFiles = React.useMemo(() => mergeEditorSources(snapshot?.root === workspaceId ? snapshot.files : [], tabs), [snapshot, workspaceId, tabs]);
  // Keep Preview usable while async project detection is warming up. The
  // detected profile replaces this fallback as soon as it is available.
  const fallbackPreviewInfo = React.useMemo(() => {
    if (!workspaceId) return null;
    const htmlTab = activeTabPath && /\.html?$/i.test(activeTabPath)
      ? activeTabPath
      : tabs.find((tab) => /\.html?$/i.test(tab.filePath))?.filePath
        || snapshot?.files.find((file) => /\.html?$/i.test(file.filePath))?.filePath;
    return { root: '', entry: htmlTab || 'index.html', title: 'Web' };
  }, [activeTabPath, tabs, snapshot, workspaceId]);
  const effectivePreviewInfo = previewInfo || fallbackPreviewInfo;
  const currentSources = useRef(sourceFiles);
  currentSources.current = sourceFiles;
  currentTabs.current = tabs;
  selectTab.current = onSelectTab;
  // uri-string → source file, rebuilt only when the file set or scope changes.
  // The ghost-text provider used to linear-scan every source file and re-parse
  // a Monaco URI for each one on every keystroke: O(n) parses per request.
  const sourceUriIndex = React.useMemo(() => {
    const index = new Map<string, ReturnType<typeof mergeEditorSources>[number]>();
    for (const file of sourceFiles) index.set(editorModelPath(modelScope, file.filePath), file);
    return index;
  }, [sourceFiles, modelScope]);
  // The ghost-text provider closure outlives individual renders; read the
  // index through a ref so it always sees the latest file set.
  const sourceUriIndexRef = useRef(sourceUriIndex);
  sourceUriIndexRef.current = sourceUriIndex;
  const resolveModelSource = (modelUri: string) => {
    const indexed = sourceUriIndexRef.current.get(modelUri);
    if (indexed) return indexed;
    // Defensive fallback if a URI ever fails to round-trip exactly.
    return currentSources.current.find(item =>
      monacoApi?.Uri.parse(editorModelPath(modelScope, item.filePath)).toString() === modelUri);
  };

  useEffect(() => {
    if (!workspaceId) return;
    const controller = new AbortController();
    setSourceStatus('Loading project context…');
    api.getEditorProject(controller.signal).then(result => {
      if (controller.signal.aborted || result.root !== workspaceId) return;
      setSnapshot(result);
      setSourceStatus(`${result.files.length} source files${result.limited ? ' · limited' : ''}`);
    }).catch(() => {
      if (!controller.signal.aborted) {
        setSnapshot(null);
        setSourceStatus('Project context unavailable · open tabs only');
      }
    });
    return () => controller.abort();
  }, [workspaceId, refreshSignal, sourceRefresh]);

  useEffect(() => {
    if (!monacoApi) return;
    const models = ownedModels.current;
    for (const tab of sourceFiles) {
      const path = editorModelPath(modelScope, tab.filePath);
      let model = models.get(path);
      if (!model) {
        model = monacoApi.editor.getModel(monacoApi.Uri.parse(path)) ??
          monacoApi.editor.createModel(tab.content, getLanguage(tab.filePath), monacoApi.Uri.parse(path));
        models.set(path, model);
      } else if (model.getValue() !== tab.content) {
        // Preserve the undo stack when saved content is refreshed externally.
        model.pushEditOperations([], [{ range: model.getFullModelRange(), text: tab.content }], () => null);
      }
    }
    const retained = new Set(sourceFiles.map(tab => editorModelPath(modelScope, tab.filePath)));
    for (const [path, model] of models) {
      if (!retained.has(path) && model !== editorRef.current?.getModel()) {
        model.dispose();
        models.delete(path);
      }
    }
    const destination = navigation.current;
    if (destination?.filePath === activeTabPath) {
      const editor = editorRef.current;
      if (editor?.getModel()?.uri.toString() === monacoApi.Uri.parse(editorModelPath(modelScope, activeTabPath!)).toString()) {
        revealEditorDestination(editor, destination.selection);
        navigation.current = null;
      }
    }
  }, [sourceFiles, activeTabPath, monacoApi, modelScope]);

  useEffect(() => {
    if (!monacoApi || !activeTabPath) {
      setProblemCount(0);
      return;
    }
    const updateProblems = () => {
      const model = monacoApi.editor.getModel(monacoApi.Uri.parse(editorModelPath(modelScope, activeTabPath)));
      setProblemCount(model ? monacoApi.editor.getModelMarkers({ resource: model.uri }).length : 0);
    };
    updateProblems();
    const markerSubscription = monacoApi.editor.onDidChangeMarkers((resources: any[]) => {
      const current = editorModelPath(modelScope, activeTabPath);
      if (resources.some(resource => resource.toString() === monacoApi.Uri.parse(current).toString())) updateProblems();
    });
    return () => markerSubscription.dispose();
  }, [activeTabPath, monacoApi, modelScope, sourceFiles]);

  useEffect(() => {
    completionProvider.current?.dispose();
    completionProvider.current = null;
    if (!monacoApi || sourceFiles.length === 0) return;
    // Native TypeScript suggestions remain active; this provider fills the
    // project-symbol gap for languages without an embedded LSP.
    completionProvider.current = registerProjectCompletionProvider(monacoApi, sourceFiles, modelScope);
    return () => {
      completionProvider.current?.dispose();
      completionProvider.current = null;
    };
  }, [monacoApi, sourceFiles, modelScope]);

  // A connected local LSP is provider-agnostic: discover its read-only tools
  // from the registry and surface them in Monaco, while keeping the local
  // symbol providers above as a zero-configuration fallback.
  useEffect(() => {
    let cancelled = false;
    lspRegistration.current?.dispose();
    lspRegistration.current = null;
    if (!monacoApi || sourceFiles.length === 0) return;
    registerConnectedLspProviders(
      monacoApi,
      sourceFiles,
      modelScope,
      () => api.getToolList(),
      (name, args) => api.executeTool(name, args),
    ).then(registration => {
      if (cancelled) { registration.dispose(); return; }
      lspRegistration.current = registration;
      if (activeTabPath) void registration.refreshDiagnostics(activeTabPath);
    }).catch(() => undefined);
    return () => {
      cancelled = true;
      lspRegistration.current?.dispose();
      lspRegistration.current = null;
    };
  }, [activeTabPath, monacoApi, sourceFiles, modelScope]);

  useEffect(() => {
    inlineCompletionProvider.current?.dispose();
    inlineCompletionProvider.current = null;
    if (!monacoApi || !workspaceId) return;

    const languages = [...INLINE_COMPLETION_LANGUAGES];
    const provider = {
      provideInlineCompletions: async (model: any, position: any, _context: any, token: any) => {
        const now = Date.now();
        // Local 3B models need breathing room. Do not enqueue a request for
        // every keystroke; the next idle cursor event gets the latest buffer.
        if (position.column <= 1) return { items: [] };
        const activeSource = resolveModelSource(String(model.uri.toString()));
        if (!activeSource) return { items: [] };
        const languageId = getLanguage(activeSource.filePath);
        const before = model.getValueInRange({
          startLineNumber: 1,
          startColumn: 1,
          endLineNumber: position.lineNumber,
          endColumn: position.column,
        });
        const after = model.getValueInRange({
          startLineNumber: position.lineNumber,
          startColumn: position.column,
          endLineNumber: model.getLineCount(),
          endColumn: model.getLineMaxColumn(model.getLineCount()),
        });
        // Suppress only when the cursor is genuinely inside a comment ON THE
        // CURRENT LINE. The old check looked at the last 180 characters, so a
        // file that ended in `// TODO` blocked completions on the next code
        // line. The shared helper is quote-aware, so string literals that
        // contain // (URLs) are not treated as comments.
        const lineStart = Math.max(before.lastIndexOf('\n'), before.lastIndexOf('\r')) + 1;
        if (!before.trim() || isCompletionSuppressedContext(before.slice(lineStart), languageId)) return { items: [] };
        const cacheKey = inlineCompletionCacheKey({
          workspaceId,
          filePath: activeSource.filePath,
          language: languageId,
          prefix: before,
          suffix: after,
        });
        const cachedCompletion = inlineCompletionCache.current.get(cacheKey);
        if (cachedCompletion) {
          return { items: [{ insertText: cachedCompletion, range: { startLineNumber: position.lineNumber, startColumn: position.column, endLineNumber: position.lineNumber, endColumn: position.column } }] };
        }
        if (now - lastInlineRequestAt.current < INLINE_COMPLETION_THROTTLE_MS) return { items: [] };
        lastInlineRequestAt.current = now;
        inlineRequest.current?.abort();
        const controller = new AbortController();
        inlineRequest.current = controller;
        const cancel = () => controller.abort();
        const cancellationSubscription = subscribeInlineCancellation(token, cancel);
        try {
          await new Promise(resolve => setTimeout(resolve, INLINE_COMPLETION_DEBOUNCE_MS));
          if (controller.signal.aborted || token?.isCancellationRequested) return { items: [] };
          const result = await api.getInlineCompletion({
            filePath: activeSource.filePath,
            language: languageId,
            prefix: before,
            suffix: after,
            signal: controller.signal,
          });
          if (!result.success || !result.completion || controller.signal.aborted || token?.isCancellationRequested) return { items: [] };
          // Never insert a dangling half-token: drop an unterminated trailing
          // line (models truncate mid-expression). Idempotent with the server.
          const completion = trimIncompleteTail(result.completion);
          if (!completion) return { items: [] };
          const currentPrefix = model.getValueInRange({
            startLineNumber: 1,
            startColumn: 1,
            endLineNumber: position.lineNumber,
            endColumn: position.column,
          });
          const currentSuffix = model.getValueInRange({
            startLineNumber: position.lineNumber,
            startColumn: position.column,
            endLineNumber: model.getLineCount(),
            endColumn: model.getLineMaxColumn(model.getLineCount()),
          });
          if (currentPrefix !== before || currentSuffix !== after) return { items: [] };
          inlineCompletionCache.current.set(cacheKey, completion);
          return {
            items: [{
              insertText: completion,
              range: {
                startLineNumber: position.lineNumber,
                startColumn: position.column,
                endLineNumber: position.lineNumber,
                endColumn: position.column,
              },
            }],
          };
        } catch {
          return { items: [] };
        } finally {
          cancellationSubscription?.dispose();
          if (inlineRequest.current === controller) inlineRequest.current = null;
        }
      },
      freeInlineCompletions: () => undefined,
    };
    inlineCompletionProvider.current = monacoApi.languages.registerInlineCompletionsProvider(languages, provider);
    return () => {
      inlineCompletionProvider.current?.dispose();
      inlineCompletionProvider.current = null;
      inlineRequest.current?.abort();
      inlineRequest.current = null;
    };
  }, [monacoApi, workspaceId, modelScope]);

  useEffect(() => {
    if (!monacoApi) return;
    const opener = monacoApi.editor.registerEditorOpener({
      openCodeEditor: (_source: any, resource: any, selection: any) => {
        const tab = currentSources.current.find(item => monacoApi.Uri.parse(editorModelPath(modelScope, item.filePath)).toString() === resource.toString());
        if (!tab) return false;
        if (editorRef.current?.getModel()?.uri.toString() === resource.toString()) {
          const target = selection ?? { lineNumber: 1, column: 1 };
          revealEditorDestination(editorRef.current, target);
          return true;
        }
        navigation.current = { filePath: tab.filePath, selection: selection ?? { lineNumber: 1, column: 1 } };
        if (currentTabs.current.some(item => item.filePath === tab.filePath)) selectTab.current(tab.filePath);
        else if (openFile.current) void openFile.current(tab.filePath).catch(() => {
          navigation.current = null;
          setSourceStatus('Definition file could not be opened · refresh context');
        });
        else return false;
        return true;
      },
    });
    return () => opener.dispose();
  }, [monacoApi, modelScope]);

  useEffect(() => () => {
    completionProvider.current?.dispose();
    completionProvider.current = null;
    inlineCompletionProvider.current?.dispose();
    inlineCompletionProvider.current = null;
    inlineRequest.current?.abort();
    inlineCompletionCache.current.clear();
    for (const model of ownedModels.current.values()) if (!model.isDisposed()) model.dispose();
    ownedModels.current.clear();
  }, []);

  const activeTab = tabs.find((t) => t.filePath === activeTabPath);

  // Keyboard shortcut Ctrl+S
  useEffect(() => {
    if (!active) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (activeTabPath) {
          onSaveFile(activeTabPath);
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        // Only claim Ctrl+K while focus is inside this editor or no text field
        // is focused. Claiming it globally stole the shortcut from the chat
        // composer, the terminal and every other input on the page.
        const target = e.target as HTMLElement | null;
        const inTextField = !!target?.closest?.('input, textarea, [contenteditable="true"]');
        const editorFocused = !!editorRef.current?.hasTextFocus?.();
        if (inTextField && !editorFocused) return;
        e.preventDefault();
        setShowInlinePrompt((prev) => !prev);
      }
      if (e.key === 'Escape') setShowInlinePrompt(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [active, activeTabPath, onSaveFile]);

  // Dismiss the Ctrl+K bar on a click outside it (the toolbar toggle button
  // keeps working: it re-opens the bar).
  useEffect(() => {
    if (!showInlinePrompt) return;
    const onPointerDown = (event: PointerEvent) => {
      const bar = inlinePromptRef.current;
      const target = event.target as HTMLElement | null;
      if (!bar || !target) return;
      if (bar.contains(target)) return;
      if (target.closest?.('[title="Inline AI Prompt (Ctrl+K)"]')) return;
      setShowInlinePrompt(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [showInlinePrompt]);

  const handleEditorDidMount = (editor: any, monaco: any) => {
    editorRef.current = editor;
    setMonacoApi(monaco);

    editor.onDidChangeCursorSelection((e: any) => {
      const selection = editor.getSelection();
      const model = editor.getModel();
      if (selection && model) {
        const text = model.getValueInRange(selection);
        setSelectedText(text);
      }
    });
  };

  const getLanguage = (fileName: string): string => {
    const ext = fileName.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'ts':
      case 'tsx':
      case 'mts':
      case 'cts':
        return 'typescript';
      case 'js':
      case 'jsx':
      case 'mjs':
      case 'cjs':
        return 'javascript';
      case 'json':
        return 'json';
      case 'css':
        return 'css';
      case 'html':
        return 'html';
      case 'md':
        return 'markdown';
      case 'py':
        return 'python';
      case 'rs':
        return 'rust';
      case 'go':
        return 'go';
      case 'sh':
      case 'bash':
      case 'zsh':
      case 'fish':
        return 'shell';
      case 'java': return 'java';
      case 'c': return 'c';
      case 'h': return 'cpp';
      case 'cpp':
      case 'cc':
      case 'cxx':
      case 'hpp': return 'cpp';
      case 'cs': return 'csharp';
      case 'php': return 'php';
      case 'rb': return 'ruby';
      case 'kt':
      case 'kts': return 'kotlin';
      case 'swift': return 'swift';
      case 'dart': return 'dart';
      case 'lua': return 'lua';
      case 'r': return 'r';
      case 'sql': return 'sql';
      case 'xml': return 'xml';
      case 'yaml':
      case 'yml': return 'yaml';
      case 'toml': return 'ini';
      case 'ps1': return 'powershell';
      case 'bat':
      case 'cmd': return 'bat';
      case 'vue': return 'html';
      case 'svelte': return 'html';
      default:
        return 'plaintext';
    }
  };

  const handleInlineSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inlineInput.trim() || !activeTabPath) return;
    onAskInlineAI(inlineInput.trim(), selectedText, activeTabPath);
    setInlineInput('');
    setShowInlinePrompt(false);
  };

  const quickAction = (action: string) => {
    if (!activeTabPath) return;
    onAskInlineAI(action, selectedText, activeTabPath);
    setShowInlinePrompt(false);
  };

  if (tabs.length === 0) {
    return (
      <div className="q-editor-empty flex-1 flex flex-col items-center justify-center select-none p-6 text-center">
        <div className="q-editor-emblem">
          <QuillixMark size={48} />
        </div>
        <span className="q-editor-kicker">THE SPACE BETWEEN IDEA & EXECUTION</span>
        <h2 className="text-[var(--text)] text-2xl font-semibold tracking-tight mt-3 mb-2">Your next<br /><em>breakthrough.</em></h2>
        <p className="text-xs leading-6 max-w-xs text-[var(--text-muted)] mb-7">
          A blank editor isn't empty. It's possibility.{' '}<br />Open a file. Follow a thought. Make your next move.
        </p>

        <button className="q-atlas-editor-start" onClick={() => onAskInlineAI('Explain the architecture and main entry points of this workspace.', '', '')}><Sparkles size={13} /> Start with your agent <span>↗</span></button>

        <div className="q-editor-shortcuts flex flex-col text-xs">
          <div className="q-shortcut-row">
            <kbd className="px-1.5 py-0.5 bg-[#0d1117] rounded text-[11px] font-mono border border-[#30363d]">Ctrl + P</kbd>
            <span>Search project</span>
          </div>
          <div className="q-shortcut-row">
            <kbd className="px-1.5 py-0.5 bg-[#0d1117] rounded text-[11px] font-mono border border-[#30363d]">Ctrl + `</kbd>
            <span>Toggle Integrated Terminal</span>
          </div>
          <div className="q-shortcut-row">
            <kbd className="px-1.5 py-0.5 bg-[#0d1117] rounded text-[11px] font-mono border border-[#30363d]">Ctrl + B</kbd>
            <span>Toggle Explorer Sidebar</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 min-w-0 flex flex-col bg-[var(--bg)] overflow-hidden relative">
      {/* Tab bar */}
      <div className="h-9 bg-[var(--surface)] border-b border-[var(--border)] flex items-center justify-between px-2 select-none overflow-x-auto shrink-0">
        <div className="flex items-center space-x-1 overflow-x-auto">
          {tabs.map((tab, idx) => {
            const isActive = tab.filePath === activeTabPath;
            return (
              <div
                key={tab.filePath}
                onClick={() => onSelectTab(tab.filePath)}
                className={`flex items-center space-x-2 px-3 py-1 rounded-t-md cursor-pointer text-xs transition-colors border-t-2 ${
                  isActive
                    ? 'bg-[var(--bg)] text-[var(--text)] border-[var(--accent)] font-medium'
                    : 'bg-transparent text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--hover)] border-transparent'
                }`}
              >
                <span className="truncate max-w-[140px]">{tab.fileName}</span>

                {/* Dirty indicator / close button */}
                {tab.isDirty && <span className="w-2 h-2 rounded-full bg-blue-400 shrink-0" title="Unsaved changes" />}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseTab(tab.filePath);
                  }}
                  className="p-0.5 hover:text-white hover:bg-[#30363d] rounded text-[#8b949e]"
                  title="Close Tab"
                >
                  <X size={12} />
                </button>
              </div>
            );
          })}
        </div>

        {/* Action icons */}
        <div className="flex items-center space-x-1 pl-2">
          {onOpenPreview && !readOnly && <button
            onClick={() => { if (effectivePreviewInfo) onOpenPreview(effectivePreviewInfo); }}
            className="q-icon-button q-preview-toolbar-button"
            title={effectivePreviewInfo ? `Open ${effectivePreviewInfo.title} preview (${effectivePreviewInfo.entry})` : 'Open project preview'}
            aria-label={effectivePreviewInfo ? `Open ${effectivePreviewInfo.title} preview` : 'Open project preview'}
          >
            <MonitorPlay size={14} />
            <span className="text-[10px] whitespace-nowrap">Preview</span>
          </button>}
          {workspaceId && <button onClick={() => setSourceRefresh(value => value + 1)} title={`Refresh project source context: ${sourceStatus}`} aria-label={`Refresh project context: ${sourceStatus}`} className="q-icon-button"><FileCode size={14} /><span className="text-[10px] whitespace-nowrap">{sourceStatus || 'Project context'}</span></button>}
          {activeTab && problemCount > 0 && <button onClick={() => editorRef.current?.trigger('quillix', 'editor.action.marker.next', {})} title="Jump to next problem (F8)" aria-label={`${problemCount} problems in ${activeTab.fileName}`} className="q-icon-button text-amber-300"><Bug size={14} /><span className="text-[10px]">{problemCount} problem{problemCount === 1 ? '' : 's'}</span></button>}
          {activeTab && onFormatFile && !readOnly && <button onClick={() => onFormatFile(activeTab.filePath)} disabled={formatting} aria-label="Format current file with Prettier" title="Format current file with bundled Prettier" className="q-icon-button disabled:opacity-40"><AlignLeft size={14} /></button>}
          {activeTab && activeTab.isDirty && !readOnly && (
            <button
              onClick={() => onSaveFile(activeTab.filePath)}
              className="flex items-center space-x-1 px-2 py-0.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs"
              title="Save file (Ctrl+S)"
            >
              <Save size={12} />
              <span>Save</span>
            </button>
          )}

          <button
            disabled={readOnly}
            onClick={() => setShowInlinePrompt(!showInlinePrompt)}
            className={`p-1.5 rounded transition-colors ${
              showInlinePrompt ? 'bg-blue-600 text-white' : 'text-[#8b949e] hover:text-white hover:bg-[#21262d]'
            }`}
            title="Inline AI Prompt (Ctrl+K)"
          >
            <Sparkles size={14} />
          </button>
        </div>
      </div>

      {/* Inline AI Quick Bar (Ctrl+K) */}
      {showInlinePrompt && (
        <div ref={inlinePromptRef} className="absolute top-10 left-12 right-12 z-30 bg-[#161b22] border border-blue-500/80 rounded-lg p-3 shadow-2xl flex flex-col space-y-2 backdrop-blur-md">
          <div className="flex items-center justify-between text-xs text-[#8b949e]">
            <div className="flex items-center space-x-1.5 text-blue-400 font-medium">
              <Sparkles size={14} />
              <span>Inline AI Editor ({selectedText ? 'Selection Active' : 'Current File'})</span>
            </div>
            <div className="flex items-center space-x-2">
              <kbd className="px-1.5 py-0.5 bg-[#0d1117] rounded text-[10px] font-mono border border-[#30363d]">Esc</kbd>
              <button onClick={() => setShowInlinePrompt(false)} className="hover:text-white" aria-label="Close inline AI prompt">
                <X size={14} />
              </button>
            </div>
          </div>

          <form onSubmit={handleInlineSubmit} className="flex items-center space-x-2">
            <input
              autoFocus
              type="text"
              placeholder="Ask AI to modify, refactor, explain, or fix this code..."
              value={inlineInput}
              onChange={(e) => setInlineInput(e.target.value)}
              className="flex-1 bg-[#0d1117] border border-[#30363d] focus:border-blue-500 rounded px-3 py-1.5 text-xs text-white outline-none"
            />
            <button
              type="submit"
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-medium"
            >
              Generate
            </button>
          </form>

          {/* Quick preset chips */}
          <div className="flex items-center space-x-1.5 pt-1 overflow-x-auto text-[11px]">
            <button
              onClick={() => quickAction('Explain how this code works')}
              className="flex items-center space-x-1 px-2 py-0.5 rounded bg-[#21262d] hover:bg-[#30363d] text-[#c9d1d9]"
            >
              <MessageSquare size={11} />
              <span>Explain</span>
            </button>
            <button
              onClick={() => quickAction('Find bugs, vulnerabilities, and edge cases in this code')}
              className="flex items-center space-x-1 px-2 py-0.5 rounded bg-[#21262d] hover:bg-[#30363d] text-[#c9d1d9]"
            >
              <Bug size={11} />
              <span>Find Bugs</span>
            </button>
            <button
              onClick={() => quickAction('Refactor this code for readability and performance')}
              className="flex items-center space-x-1 px-2 py-0.5 rounded bg-[#21262d] hover:bg-[#30363d] text-[#c9d1d9]"
            >
              <Wrench size={11} />
              <span>Refactor</span>
            </button>
            <button
              onClick={() => quickAction('Add comprehensive unit tests for this')}
              className="flex items-center space-x-1 px-2 py-0.5 rounded bg-[#21262d] hover:bg-[#30363d] text-[#c9d1d9]"
            >
              <CheckSquare size={11} />
              <span>Add Tests</span>
            </button>
          </div>
        </div>
      )}

      {/* Monaco Editor Container */}
      <div className="flex-1 min-h-0 min-w-0 h-full w-full overflow-hidden">
        {!activeTab && fileOpenError ? (
          <div className="h-full min-h-0 flex flex-col items-center justify-center gap-3 p-6 text-center" role="alert">
            <p className="text-sm font-medium text-[var(--text)]">Could not display {fileOpenError.path}</p>
            <p className="max-w-xl text-xs text-[var(--text-muted)] break-words">{fileOpenError.message}</p>
            {onRetryOpenFile && <button className="q-atlas-editor-start" onClick={() => onRetryOpenFile(fileOpenError.path)}>Retry opening file</button>}
          </div>
        ) : activeTab && (
          <Editor
            path={editorModelPath(modelScope, activeTab.filePath)}
            keepCurrentModel
            beforeMount={configureEditorIntelligence}
            height="100%"
            language={getLanguage(activeTab.fileName)}
            value={activeTab.content}
            theme={theme === 'light' ? 'light' : 'vs-dark'}
            onMount={handleEditorDidMount}
            onChange={(val) => {
              if (val !== undefined && val !== activeTab.content) {
                onContentChange(activeTab.filePath, val);
              }
            }}
            options={{
              readOnly,
              ...EDITOR_INTELLIGENCE_OPTIONS,
              inlineSuggest: { enabled: true, showToolbar: 'always' },
              minimap: { enabled: true },
              fontSize: 13,
              fontFamily: "'Fira Code', 'Cascadia Code', Consolas, monospace",
              fontLigatures: true,
              tabSize: 2,
              wordWrap: 'on',
              lineNumbers: 'on',
              scrollBeyondLastLine: false,
              automaticLayout: true,
              renderWhitespace: 'selection',
              bracketPairColorization: { enabled: true },
              cursorBlinking: 'smooth',
              cursorSmoothCaretAnimation: 'on',
              smoothScrolling: true,
            }}
          />
        )}
      </div>
    </div>
  );
};
