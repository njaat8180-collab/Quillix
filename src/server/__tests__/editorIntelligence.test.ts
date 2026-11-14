import { describe, expect, it, vi } from 'vitest';
import { configureEditorIntelligence, editorModelPath, revealEditorDestination, collectProjectSymbols, findProjectReferences, registerProjectCompletionProvider, registerConnectedLspProviders, EDITOR_INTELLIGENCE_OPTIONS } from '../../services/editorIntelligence.js';

describe('offline editor intelligence', () => {
  it('keeps suggestions, diagnostics and quick fixes enabled', () => {
    expect(EDITOR_INTELLIGENCE_OPTIONS.quickSuggestions).toEqual({ other: true, comments: false, strings: true });
    expect(EDITOR_INTELLIGENCE_OPTIONS.suggestOnTriggerCharacters).toBe(true);
    expect(EDITOR_INTELLIGENCE_OPTIONS.renderValidationDecorations).toBe('on');
    expect(EDITOR_INTELLIGENCE_OPTIONS.lightbulb).toEqual({ enabled: 'on' });
  });
  it('reveals definition ranges with the range API, not the position API', () => {
    const editor = { setSelection: vi.fn(), revealRangeInCenter: vi.fn(), setPosition: vi.fn(), revealPositionInCenter: vi.fn(), focus: vi.fn() };
    const range = { startLineNumber: 2, startColumn: 3, endLineNumber: 2, endColumn: 10 };
    revealEditorDestination(editor, range);
    expect(editor.revealRangeInCenter).toHaveBeenCalledWith(range);
    expect(editor.revealPositionInCenter).not.toHaveBeenCalled();
    const position = { lineNumber: 3, column: 4 };
    revealEditorDestination(editor, position);
    expect(editor.revealPositionInCenter).toHaveBeenCalledWith(position);
  });
  it('keeps relative module hierarchy and Windows paths stable', () => {
    expect(editorModelPath('studio', 'src\\lib\\money.ts')).toBe('file:///quillix/studio/src/lib/money.ts');
    const checkout = editorModelPath('studio', 'src/lib/checkout.ts');
    expect(new URL('./money.ts', checkout).href).toBe(editorModelPath('studio', 'src/lib/money.ts'));
  });
  it('isolates editor instances and encodes reserved path characters', () => {
    expect(editorModelPath('one', 'a.ts')).not.toBe(editorModelPath('two', 'a.ts'));
    expect(editorModelPath(':r1:', 'src/a #?.ts')).toContain('src/a%20%23%3F.ts');
  });
  it('enables eager model sync and diagnostics for both language services', () => {
    const defaults = () => ({ setCompilerOptions: vi.fn(), setEagerModelSync: vi.fn(), setDiagnosticsOptions: vi.fn() });
    const ts = { typescriptDefaults: defaults(), javascriptDefaults: defaults(), ScriptTarget: { ES2022: 9 }, ModuleKind: { ESNext: 99 }, ModuleResolutionKind: { NodeJs: 2 }, JsxEmit: { ReactJSX: 4 } };
    configureEditorIntelligence({ typescript: ts });
    for (const service of [ts.typescriptDefaults, ts.javascriptDefaults]) {
      expect(service.setEagerModelSync).toHaveBeenCalledWith(true);
      expect(service.setCompilerOptions).toHaveBeenCalledWith(expect.objectContaining({ noEmit: true, allowJs: true, strict: true }));
      expect(service.setDiagnosticsOptions).toHaveBeenCalledWith({ noSyntaxValidation: false, noSemanticValidation: false });
    }
  });

  it('extracts project symbols for languages without an embedded LSP', () => {
    expect(collectProjectSymbols([
      { filePath: 'src/math.py', content: 'def calculate_total(value):\n    return value * 2\n' },
      { filePath: 'src/types.ts', content: 'export interface Invoice {}\nexport const taxRate = 0.18;\n' },
    ])).toEqual([
      { name: 'calculate_total', kind: 'function', filePath: 'src/math.py' },
      { name: 'Invoice', kind: 'interface', filePath: 'src/types.ts' },
      { name: 'taxRate', kind: 'variable', filePath: 'src/types.ts' },
    ]);
  });

  it('finds cross-file references with stable Monaco ranges', () => {
    expect(findProjectReferences([
      { filePath: 'src/a.ts', content: 'export function total() {}\nconst value = total();\n' },
      { filePath: 'src/b.ts', content: 'import { total } from "./a";\ntotal();\n' },
    ], 'total')).toEqual([
      { filePath: 'src/a.ts', lineNumber: 1, startColumn: 17, endColumn: 22 },
      { filePath: 'src/a.ts', lineNumber: 2, startColumn: 15, endColumn: 20 },
      { filePath: 'src/b.ts', lineNumber: 1, startColumn: 10, endColumn: 15 },
      { filePath: 'src/b.ts', lineNumber: 2, startColumn: 1, endColumn: 6 },
    ]);
  });

  it('registers and disposes the project completion provider cleanly', () => {
    const dispose = vi.fn();
    const register = vi.fn(() => ({ dispose }));
    const registerDefinition = vi.fn(() => ({ dispose }));
    const registerReferences = vi.fn(() => ({ dispose }));
    const registerRename = vi.fn(() => ({ dispose }));
    const monaco = { Uri: { parse: (value: string) => value }, languages: { registerCompletionItemProvider: register, registerDefinitionProvider: registerDefinition, registerReferenceProvider: registerReferences, registerRenameProvider: registerRename, CompletionItemKind: { Function: 1 } } };
    const provider = registerProjectCompletionProvider(monaco, [{ filePath: 'main.go', content: 'func StartServer() {}' }]);
    expect(register).toHaveBeenCalledWith(expect.arrayContaining(['go', 'python']), expect.objectContaining({ triggerCharacters: ['.', ':'] }));
    expect(registerDefinition).toHaveBeenCalledTimes(1);
    expect(registerReferences).toHaveBeenCalledTimes(1);
    expect(registerRename).toHaveBeenCalledTimes(1);
    provider.dispose();
    expect(dispose).toHaveBeenCalledTimes(4);
  });

  it('bridges connected LSP tools into Monaco navigation and diagnostics', async () => {
    const disposes = Array.from({ length: 7 }, () => vi.fn());
    const registerDefinition = vi.fn(() => ({ dispose: disposes[0] }));
    const registerReferences = vi.fn(() => ({ dispose: disposes[1] }));
    const registerHover = vi.fn(() => ({ dispose: disposes[2] }));
    const registerCompletion = vi.fn(() => ({ dispose: disposes[3] }));
    const registerRename = vi.fn(() => ({ dispose: disposes[4] }));
    const registerDocumentSymbols = vi.fn(() => ({ dispose: disposes[5] }));
    const uri = (value: string) => ({ toString: () => value });
    const model = { uri: uri(editorModelPath('lsp', 'main.go')) };
    const markers = vi.fn();
    const monaco = {
      Uri: { parse: uri },
      MarkerSeverity: { Error: 8, Warning: 4, Info: 2, Hint: 1 },
      editor: { getModel: vi.fn(() => model), setModelMarkers: markers },
      languages: {
        registerDefinitionProvider: registerDefinition,
        registerReferenceProvider: registerReferences,
        registerHoverProvider: registerHover,
        registerCompletionItemProvider: registerCompletion,
        registerRenameProvider: registerRename,
        registerDocumentSymbolProvider: registerDocumentSymbols,
        CompletionItemKind: { Text: 18 },
      },
    };
    const tools = ['definition', 'references', 'diagnostics', 'hover', 'completion', 'rename_preview', 'document_symbols'].map(operation => ({ name: `plugin_lsp_gopls_${operation}` }));
    const execute = vi.fn(async (name: string) => ({
      success: true,
      output: JSON.stringify({ server: 'gopls', filePath: 'main.go', result:
        name.endsWith('diagnostics') ? [{ filePath: 'main.go', line: 2, column: 1, message: 'unused value', severity: 'warning' }] :
        name.endsWith('hover') ? { contents: 'int answer' } :
        name.endsWith('completion') ? [{ label: 'answer', kind: 6 }] :
        name.endsWith('rename_preview') ? { edits: [{ filePath: 'main.go', line: 1, column: 5, endLine: 1, endColumn: 11, newText: 'renamed' }] } :
        name.endsWith('document_symbols') ? [{ name: 'answer', kind: 13, location: { filePath: 'main.go', line: 1, column: 1, endLine: 1, endColumn: 7 } }] :
        [{ filePath: 'main.go', line: 1, column: 1, endLine: 1, endColumn: 7 }] }),
    }));
    const registration = await registerConnectedLspProviders(monaco, [{ filePath: 'main.go', content: 'const answer = 1;' }], 'lsp', async () => ({ success: true, tools }), execute);
    const definitionProvider: any = (registerDefinition as any).mock.calls[0]?.[1];
    const renameProvider: any = (registerRename as any).mock.calls[0]?.[1];
    const definition = await definitionProvider.provideDefinition(model, { lineNumber: 1, column: 1 });
    expect(definition[0].uri.toString()).toBe(editorModelPath('lsp', 'main.go'));
    const rename = await renameProvider.provideRenameEdits(model, { lineNumber: 1, column: 1 }, 'renamed');
    expect(rename.edits[0].textEdit.text).toBe('renamed');
    const documentSymbolProvider: any = (registerDocumentSymbols as any).mock.calls[0]?.[1];
    const documentSymbols = await documentSymbolProvider.provideDocumentSymbols(model);
    expect(documentSymbols[0]).toMatchObject({ name: 'answer', range: expect.objectContaining({ startLineNumber: 1 }) });
    await registration.refreshDiagnostics('main.go');
    expect(markers).toHaveBeenCalledWith(model, 'quillix-lsp', expect.arrayContaining([expect.objectContaining({ severity: 4, message: 'unused value' })]));
    registration.dispose();
    expect(disposes.slice(0, 6).every(dispose => dispose.mock.calls.length === 1)).toBe(true);
  });
});
