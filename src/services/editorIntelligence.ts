/** Stable, isolated model URIs preserve relative imports without leaking between editors. */
import type { EditorProjectFile } from '../shared/editorProject.js';

type LspToolDefinition = { name: string };
type LspToolResponse = { success: boolean; output?: string; data?: unknown; error?: string };
type LspToolCatalog = { success: boolean; tools: LspToolDefinition[] };
type LspToolExecutor = (name: string, args: Record<string, unknown>) => Promise<LspToolResponse>;

export const EDITOR_INTELLIGENCE_OPTIONS = {
  quickSuggestions: { other: true, comments: false, strings: true },
  suggestOnTriggerCharacters: true,
  parameterHints: { enabled: true },
  codeLens: true,
  lightbulb: { enabled: 'on' as any },
  renderValidationDecorations: 'on',
  bracketPairColorization: { enabled: true },
} as const;

export function mergeEditorSources(project: EditorProjectFile[], tabs: EditorProjectFile[]): EditorProjectFile[] {
  // Open buffers always win over older disk snapshots, including unsaved edits.
  return [...new Map([...project, ...tabs].map(file => [file.filePath, file])).values()];
}

export interface ProjectSymbol {
  name: string;
  kind: 'function' | 'class' | 'interface' | 'type' | 'variable' | 'symbol';
  filePath: string;
}

/** Extracts lightweight project symbols for languages without a bundled LSP. */
export function collectProjectSymbols(files: EditorProjectFile[], maxSymbols = 500): ProjectSymbol[] {
  const symbols: ProjectSymbol[] = [];
  const seen = new Set<string>();
  const patterns: Array<{ regex: RegExp; kind: ProjectSymbol['kind'] }> = [
    { regex: /\b(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g, kind: 'function' },
    { regex: /\b(?:export\s+)?(?:class|struct|trait)\s+([A-Za-z_$][\w$]*)/g, kind: 'class' },
    { regex: /\b(?:export\s+)?(?:interface)\s+([A-Za-z_$][\w$]*)/g, kind: 'interface' },
    { regex: /\b(?:export\s+)?(?:type|enum)\s+([A-Za-z_$][\w$]*)/g, kind: 'type' },
    { regex: /\b(?:export\s+)?(?:const|let|var|val)\s+([A-Za-z_$][\w$]*)/g, kind: 'variable' },
    { regex: /\b(?:def|fn|func)\s+([A-Za-z_$][\w$]*)/g, kind: 'function' },
  ];
  for (const file of files) {
    if (symbols.length >= maxSymbols) break;
    const lines = file.content.split('\n').slice(0, 10000);
    for (const line of lines) {
      for (const pattern of patterns) {
        pattern.regex.lastIndex = 0;
        const match = pattern.regex.exec(line);
        if (!match) continue;
        const key = `${match[1]}\u0000${file.filePath}`;
        if (seen.has(key)) continue;
        seen.add(key);
        symbols.push({ name: match[1], kind: pattern.kind, filePath: file.filePath });
        if (symbols.length >= maxSymbols) break;
      }
      if (symbols.length >= maxSymbols) break;
    }
  }
  return symbols;
}

export interface ProjectReference {
  filePath: string;
  lineNumber: number;
  startColumn: number;
  endColumn: number;
}

/** Finds bounded word references for lightweight cross-file navigation/refactors. */
export function findProjectReferences(files: EditorProjectFile[], name: string, maxReferences = 1000): ProjectReference[] {
  if (!/^[A-Za-z_$][\w$]*$/.test(name)) return [];
  const escaped = name.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
  const matcher = new RegExp('(^|[^A-Za-z0-9_$])(' + escaped + ')(?=$|[^A-Za-z0-9_$])', 'g');
  const references: ProjectReference[] = [];
  for (const file of files) {
    const lines = file.content.split('\n');
    for (let index = 0; index < lines.length && references.length < maxReferences; index++) {
      const line = lines[index];
      matcher.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = matcher.exec(line)) && references.length < maxReferences) {
        const start = match.index + match[1].length + 1;
        references.push({
          filePath: file.filePath,
          lineNumber: index + 1,
          startColumn: start,
          endColumn: start + name.length,
        });
        if (match[0].length === 0) matcher.lastIndex++;
      }
    }
  }
  return references;
}

/** Adds project-local suggestions while preserving Monaco's native providers. */
export function registerProjectCompletionProvider(monaco: any, files: EditorProjectFile[], scope = 'project'): { dispose: () => void } {
  const symbols = collectProjectSymbols(files);
  const languages = ['typescript', 'javascript', 'python', 'go', 'rust', 'java', 'csharp', 'cpp', 'c', 'kotlin', 'swift', 'php', 'ruby'];
  const kindMap: Record<ProjectSymbol['kind'], any> = {
    function: monaco.languages.CompletionItemKind?.Function ?? 1,
    class: monaco.languages.CompletionItemKind?.Class ?? 4,
    interface: monaco.languages.CompletionItemKind?.Interface ?? 7,
    type: monaco.languages.CompletionItemKind?.TypeParameter ?? 25,
    variable: monaco.languages.CompletionItemKind?.Variable ?? 5,
    symbol: monaco.languages.CompletionItemKind?.Text ?? 18,
  };
  const provider = {
    triggerCharacters: ['.', ':'],
    provideCompletionItems(model: any, position: any) {
      const word = model.getWordUntilPosition(position);
      const prefix = String(word?.word || '').toLowerCase();
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word?.startColumn || position.column,
        endColumn: word?.endColumn || position.column,
      };
      const items = symbols
        .filter(symbol => !prefix || symbol.name.toLowerCase().startsWith(prefix))
        .slice(0, 80)
        .map(symbol => ({
          label: symbol.name,
          kind: kindMap[symbol.kind],
          insertText: symbol.name,
          detail: `${symbol.kind} · ${symbol.filePath}`,
          sortText: `0_${symbol.name}`,
          range,
        }));
      return { suggestions: items };
    },
    provideDefinition(model: any, position: any) {
      const word = model.getWordAtPosition?.(position);
      const name = String(word?.word || '');
      if (!name) return undefined;
      const target = symbols.find(symbol => symbol.name === name);
      if (!target) return undefined;
      const file = files.find(item => item.filePath === target.filePath);
      if (!file) return undefined;
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const definition = new RegExp(`\\b(?:function|class|interface|type|enum|struct|trait|def|fn|func|const|let|var|val)\\s+${escaped}\\b`);
      const lineNumber = file.content.split('\n').findIndex(line => definition.test(line)) + 1;
      if (lineNumber < 1) return undefined;
      return [{
        uri: monaco.Uri.parse(editorModelPath(scope, target.filePath)),
        range: { startLineNumber: lineNumber, startColumn: 1, endLineNumber: lineNumber, endColumn: file.content.split('\n')[lineNumber - 1].length + 1 },
      }];
    },
    provideReferences(model: any, position: any) {
      const word = model.getWordAtPosition?.(position);
      const name = String(word?.word || '');
      if (!name || !symbols.some(symbol => symbol.name === name)) return [];
      return findProjectReferences(files, name).map(reference => ({
        uri: monaco.Uri.parse(editorModelPath(scope, reference.filePath)),
        range: {
          startLineNumber: reference.lineNumber,
          startColumn: reference.startColumn,
          endLineNumber: reference.lineNumber,
          endColumn: reference.endColumn,
        },
      }));
    },
    provideRenameEdits(model: any, position: any, newName: string) {
      const word = model.getWordAtPosition?.(position);
      const oldName = String(word?.word || '');
      if (!oldName || !/^[A-Za-z_$][\w$]*$/.test(newName) || !symbols.some(symbol => symbol.name === oldName)) {
        return { edits: [], rejectReason: 'Select a project symbol and enter a valid identifier.' };
      }
      return {
        edits: findProjectReferences(files, oldName).map(reference => ({
          resource: monaco.Uri.parse(editorModelPath(scope, reference.filePath)),
          textEdit: {
            range: {
              startLineNumber: reference.lineNumber,
              startColumn: reference.startColumn,
              endLineNumber: reference.lineNumber,
              endColumn: reference.endColumn,
            },
            text: newName,
          },
        })),
      };
    },
  };
  const completionDisposable = monaco.languages.registerCompletionItemProvider(languages, provider);
  const definitionDisposable = monaco.languages.registerDefinitionProvider?.(languages, provider);
  const referenceDisposable = monaco.languages.registerReferenceProvider?.(languages, provider);
  const renameDisposable = monaco.languages.registerRenameProvider?.(languages, provider);
  return {
    dispose: () => {
      completionDisposable?.dispose?.();
      definitionDisposable?.dispose?.();
      referenceDisposable?.dispose?.();
      renameDisposable?.dispose?.();
    },
  };
}

export interface ConnectedLspRegistration {
  dispose: () => void;
  refreshDiagnostics: (filePath: string) => Promise<void>;
  serverName?: string;
}

function parseLspOutput(response: LspToolResponse): any | undefined {
  if (!response.success) return undefined;
  if (response.data && typeof response.data === 'object') return response.data;
  if (typeof response.output !== 'string' || !response.output.trim()) return undefined;
  try { return JSON.parse(response.output); } catch { return undefined; }
}

function locationRange(monaco: any, location: any): any {
  const startLine = Math.max(1, Number(location?.line) || 1);
  const startColumn = Math.max(1, Number(location?.column) || 1);
  const endLine = Math.max(startLine, Number(location?.endLine) || startLine);
  const endColumn = Math.max(startColumn + 1, Number(location?.endColumn) || startColumn + 1);
  return {
    startLineNumber: startLine,
    startColumn,
    endLineNumber: endLine,
    endColumn,
  };
}

function lspTool(tools: LspToolDefinition[], operation: string): string | undefined {
  return tools.find(tool => tool.name.startsWith('plugin_lsp_') && tool.name.endsWith(`_${operation}`))?.name;
}

function lspPayload(value: any): any {
  return value && typeof value === 'object' && 'result' in value ? value.result : value;
}

/**
 * Wires a connected workspace-scoped LSP into Monaco without making the
 * editor depend on a particular server or provider. The returned promise is
 * intentionally best-effort: the offline project-symbol providers remain
 * available when no LSP is connected or a server is still starting.
 */
export async function registerConnectedLspProviders(
  monaco: any,
  files: EditorProjectFile[],
  scope: string,
  getTools: () => Promise<LspToolCatalog>,
  executeTool: LspToolExecutor,
): Promise<ConnectedLspRegistration> {
  let catalog: LspToolCatalog;
  try { catalog = await getTools(); } catch { return { dispose: () => undefined, refreshDiagnostics: async () => undefined }; }
  const tools = Array.isArray(catalog?.tools) ? catalog.tools : [];
  const definitionTool = lspTool(tools, 'definition');
  const referencesTool = lspTool(tools, 'references');
  const diagnosticsTool = lspTool(tools, 'diagnostics');
  const hoverTool = lspTool(tools, 'hover');
  const completionTool = lspTool(tools, 'completion');
  const renameTool = lspTool(tools, 'rename_preview');
  const documentSymbolsTool = lspTool(tools, 'document_symbols');
  const serverName = definitionTool?.match(/^plugin_lsp_([^_]+(?:_[^_]+)*)_definition$/)?.[1];
  if (!definitionTool && !referencesTool && !diagnosticsTool && !hoverTool && !completionTool && !renameTool && !documentSymbolsTool) {
    return { dispose: () => undefined, refreshDiagnostics: async () => undefined };
  }

  let disposed = false;
  const modelFile = (model: any): string | undefined => files.find(file => monaco.Uri.parse(editorModelPath(scope, file.filePath)).toString() === model?.uri?.toString())?.filePath;
  const invoke = async (name: string | undefined, args: Record<string, unknown>): Promise<any | undefined> => {
    if (disposed || !name) return undefined;
    try { return lspPayload(parseLspOutput(await executeTool(name, args))); } catch { return undefined; }
  };
  const toLocations = (result: any): any[] => (Array.isArray(result) ? result : []).filter(item => files.some(file => file.filePath === item?.filePath)).map(item => ({
    uri: monaco.Uri.parse(editorModelPath(scope, item.filePath)),
    range: locationRange(monaco, item),
  }));
  const registrations: Array<{ dispose?: () => void }> = [];

  if (definitionTool) registrations.push(monaco.languages.registerDefinitionProvider?.(
    ['typescript', 'javascript', 'python', 'go', 'rust', 'java', 'csharp', 'cpp', 'c', 'kotlin', 'swift', 'php', 'ruby'],
    { provideDefinition: async (model: any, position: any) => {
      const filePath = modelFile(model); if (!filePath) return undefined;
      return toLocations(await invoke(definitionTool, { filePath, line: position.lineNumber, column: position.column }));
    } },
  ));
  if (referencesTool) registrations.push(monaco.languages.registerReferenceProvider?.(
    ['typescript', 'javascript', 'python', 'go', 'rust', 'java', 'csharp', 'cpp', 'c', 'kotlin', 'swift', 'php', 'ruby'],
    { provideReferences: async (model: any, position: any) => {
      const filePath = modelFile(model); if (!filePath) return [];
      return toLocations(await invoke(referencesTool, { filePath, line: position.lineNumber, column: position.column }));
    } },
  ));
  if (hoverTool) registrations.push(monaco.languages.registerHoverProvider?.(
    ['typescript', 'javascript', 'python', 'go', 'rust', 'java', 'csharp', 'cpp', 'c', 'kotlin', 'swift', 'php', 'ruby'],
    { provideHover: async (model: any, position: any) => {
      const filePath = modelFile(model); if (!filePath) return undefined;
      const payload = await invoke(hoverTool, { filePath, line: position.lineNumber, column: position.column });
      if (!payload?.contents) return undefined;
      return { contents: [{ value: String(payload.contents).slice(0, 8000) }], ...(payload.range ? { range: locationRange(monaco, payload.range) } : {}) };
    } },
  ));
  if (completionTool) registrations.push(monaco.languages.registerCompletionItemProvider?.(
    ['typescript', 'javascript', 'python', 'go', 'rust', 'java', 'csharp', 'cpp', 'c', 'kotlin', 'swift', 'php', 'ruby'],
    { triggerCharacters: ['.', ':'], provideCompletionItems: async (model: any, position: any) => {
      const filePath = modelFile(model); if (!filePath) return { suggestions: [] };
      const payload = await invoke(completionTool, { filePath, line: position.lineNumber, column: position.column });
      const word = model.getWordUntilPosition?.(position);
      const range = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: word?.startColumn || position.column, endColumn: word?.endColumn || position.column };
      const items = Array.isArray(payload) ? payload : [];
      return { suggestions: items.filter(item => item?.label).slice(0, 100).map(item => ({ label: String(item.label), kind: item.kind || monaco.languages.CompletionItemKind?.Text, detail: item.detail, documentation: item.documentation, insertText: item.insertText || String(item.label), range })) };
    } },
  ));
  if (renameTool) registrations.push(monaco.languages.registerRenameProvider?.(
    ['typescript', 'javascript', 'python', 'go', 'rust', 'java', 'csharp', 'cpp', 'c', 'kotlin', 'swift', 'php', 'ruby'],
    { provideRenameEdits: async (model: any, position: any, newName: string) => {
      const filePath = modelFile(model); if (!filePath) return { edits: [], rejectReason: 'The active buffer is not in the workspace.' };
      const payload = await invoke(renameTool, { filePath, line: position.lineNumber, column: position.column, newName });
      const edits: any[] = Array.isArray(payload?.edits) ? payload.edits : [];
      return { edits: edits.filter((edit: any) => files.some(file => file.filePath === edit?.filePath)).map((edit: any) => ({ resource: monaco.Uri.parse(editorModelPath(scope, edit.filePath)), textEdit: { range: locationRange(monaco, edit), text: String(edit.newText || '') } })) };
    } },
  ));
  if (documentSymbolsTool) registrations.push(monaco.languages.registerDocumentSymbolProvider?.(
    ['typescript', 'javascript', 'python', 'go', 'rust', 'java', 'csharp', 'cpp', 'c', 'kotlin', 'swift', 'php', 'ruby'],
    { provideDocumentSymbols: async (model: any) => {
      const filePath = modelFile(model); if (!filePath) return [];
      const payload = await invoke(documentSymbolsTool, { filePath });
      return (Array.isArray(payload) ? payload : []).filter(item => item?.name && files.some(file => file.filePath === item?.location?.filePath)).map(item => ({
        name: String(item.name).slice(0, 300),
        detail: item.containerName,
        kind: item.kind || monaco.languages.SymbolKind?.Variable,
        range: locationRange(monaco, item.location),
        selectionRange: locationRange(monaco, item.location),
      }));
    } },
  ));

  const refreshDiagnostics = async (filePath: string) => {
    if (!diagnosticsTool || disposed) return;
    const model = files.find(file => file.filePath === filePath);
    const monacoModel = model && monaco.editor.getModel(monaco.Uri.parse(editorModelPath(scope, model.filePath)));
    if (!monacoModel) return;
    const payload = await invoke(diagnosticsTool, { filePath });
    const diagnostics = Array.isArray(payload) ? payload : [];
    monaco.editor.setModelMarkers(monacoModel, 'quillix-lsp', diagnostics.filter(item => item?.message).map(item => ({
      ...locationRange(monaco, item),
      message: String(item.message).slice(0, 2000),
      severity: item.severity === 'error' ? monaco.MarkerSeverity.Error : item.severity === 'warning' ? monaco.MarkerSeverity.Warning : item.severity === 'information' ? monaco.MarkerSeverity.Info : monaco.MarkerSeverity.Hint,
      source: item.source || serverName || 'LSP',
      code: item.code === undefined ? undefined : String(item.code),
    })));
  };

  return {
    serverName,
    refreshDiagnostics,
    dispose: () => {
      disposed = true;
      for (const registration of registrations) registration?.dispose?.();
      for (const file of files) {
        const model = monaco.editor.getModel(monaco.Uri.parse(editorModelPath(scope, file.filePath)));
        if (model) monaco.editor.setModelMarkers(model, 'quillix-lsp', []);
      }
    },
  };
}

export function editorModelPath(scope: string, filePath: string): string {
  const segments = filePath.replace(/\\/g, '/').split('/').filter(Boolean);
  return `file:///quillix/${encodeURIComponent(scope)}/${segments.map(encodeURIComponent).join('/')}`;
}

export function revealEditorDestination(editor: any, selection: any): void {
  if ('startLineNumber' in selection) {
    editor.setSelection(selection);
    editor.revealRangeInCenter(selection);
  } else {
    editor.setPosition(selection);
    editor.revealPositionInCenter(selection);
  }
  editor.focus();
}

export function configureEditorIntelligence(monaco: any): void {
  // Monaco 0.56 exposes language services at top level; older runtimes used languages.
  const ts = monaco.typescript ?? monaco.languages.typescript;
  if (!ts?.typescriptDefaults) return;
  const options = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    jsx: ts.JsxEmit.ReactJSX,
    allowJs: true,
    allowNonTsExtensions: true,
    noEmit: true,
    strict: true,
  };
  for (const defaults of [ts.typescriptDefaults, ts.javascriptDefaults]) {
    defaults.setCompilerOptions(options);
    defaults.setEagerModelSync(true);
    defaults.setDiagnosticsOptions({ noSyntaxValidation: false, noSemanticValidation: false });
  }
}
