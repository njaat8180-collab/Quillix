import { afterEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import process from 'node:process';
import fs from 'node:fs';
import os from 'node:os';
import { ExtensionTools } from '../extensionTools.js';
import { LspStdioClient } from '../lspStdio.js';

describe('local MCP stdio bridge', () => {
  const clients: ExtensionTools[] = [];
  afterEach(() => { for (const client of clients) client.closeAll(); clients.length = 0; });

  it('discovers and invokes a local MCP server without a shell', async () => {
    const extension = new ExtensionTools();
    clients.push(extension);
    const script = path.resolve(process.cwd(), 'scripts/smoke/mock-mcp-stdio.mjs');
    const definitions = await extension.connectMCPStdio('demo', process.execPath, [script]);
    expect(definitions.some(tool => tool.name === 'mcp_demo_lookup')).toBe(true);
    const result = await extension.get('mcp_demo_lookup')?.invoke({ query: 'value' });
    expect(result).toContain('mock:value');
    expect(extension.get('mcp_demo_lookup')?.definition.permission).toBe('execute');
  });

  it('rejects duplicate local MCP IDs before starting another process', async () => {
    const extension = new ExtensionTools();
    clients.push(extension);
    const script = path.resolve(process.cwd(), 'scripts/smoke/mock-mcp-stdio.mjs');
    await extension.connectMCPStdio('demo', process.execPath, [script]);
    await expect(extension.connectMCPStdio('demo', process.execPath, [script])).rejects.toThrow(/already connected/i);
  });

  it('removes LSP tools when their workspace-bound process is disposed', async () => {
    const extension = new ExtensionTools();
    clients.push(extension);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-lsp-dispose-'));
    try {
      fs.writeFileSync(path.join(root, 'app.ts'), 'const answer = 42;\n');
      const script = path.resolve(process.cwd(), 'scripts/smoke/mock-lsp-stdio.mjs');
      await extension.connectLSPStdio('typescript', process.execPath, [script], root);
      expect(extension.get('plugin_lsp_typescript_definition')).toBeTruthy();
      extension.closeLSP();
      expect(extension.get('plugin_lsp_typescript_definition')).toBeUndefined();
    } finally {
      extension.closeAll();
      await new Promise(resolve => setTimeout(resolve, 100));
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  }, 15000);

  it('connects a local LSP server and keeps navigation inside the workspace', async () => {
    const extension = new ExtensionTools();
    clients.push(extension);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-lsp-'));
    try {
      fs.writeFileSync(path.join(root, 'app.ts'), 'const answer = 42;\nanswer;\n');
      const script = path.resolve(process.cwd(), 'scripts/smoke/mock-lsp-stdio.mjs');
      const definitions = await extension.connectLSPStdio('typescript', process.execPath, [script], root);
      expect(definitions.some(tool => tool.name === 'plugin_lsp_typescript_definition')).toBe(true);
      const definition = JSON.parse(await extension.get('plugin_lsp_typescript_definition')!.invoke({ filePath: 'app.ts', line: 1, column: 1 }));
      expect(definition.result[0].filePath).toBe('app.ts');
      const references = JSON.parse(await extension.get('plugin_lsp_typescript_references')!.invoke({ filePath: 'app.ts', line: 1, column: 1 }));
      expect(references.result).toHaveLength(2);
      const diagnostics = JSON.parse(await extension.get('plugin_lsp_typescript_diagnostics')!.invoke({ filePath: 'app.ts' }));
      expect(diagnostics.result[0]).toMatchObject({ filePath: 'app.ts', severity: 'warning', code: 'MOCK001' });
      const hover = JSON.parse(await extension.get('plugin_lsp_typescript_hover')!.invoke({ filePath: 'app.ts', line: 1, column: 1 }));
      expect(hover.result.contents).toContain('answer: number');
      const completion = JSON.parse(await extension.get('plugin_lsp_typescript_completion')!.invoke({ filePath: 'app.ts', line: 1, column: 1 }));
      expect(completion.result[0]).toMatchObject({ label: 'answer', insertText: 'answer' });
      const rename = JSON.parse(await extension.get('plugin_lsp_typescript_rename_preview')!.invoke({ filePath: 'app.ts', line: 1, column: 1, newName: 'total' }));
      expect(rename.result).toHaveLength(2);
      expect(rename.result[0]).toMatchObject({ filePath: 'app.ts', newText: 'total' });
      const symbols = JSON.parse(await extension.get('plugin_lsp_typescript_workspace_symbols')!.invoke({ query: 'answer' }));
      expect(symbols.result[0]).toMatchObject({ name: 'answer', containerName: 'mock', location: { filePath: 'app.ts' } });
      const outline = JSON.parse(await extension.get('plugin_lsp_typescript_document_symbols')!.invoke({ filePath: 'app.ts' }));
      expect(outline.result).toHaveLength(2);
      expect(outline.result[1]).toMatchObject({ name: 'nested', containerName: 'answer', location: { filePath: 'app.ts' } });
      await expect(extension.get('plugin_lsp_typescript_definition')!.invoke({ filePath: '../outside.ts', line: 1, column: 1 })).rejects.toThrow(/inside the workspace/i);
    } finally {
      extension.closeAll();
      await new Promise(resolve => setTimeout(resolve, 150));
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  }, 15000);

  it('notifies the owner when a local LSP process exits by itself', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-lsp-exit-'));
    const closed = vi.fn();
    const client = new LspStdioClient(process.execPath, ['-e', 'setTimeout(() => process.exit(0), 40)'], root, closed);
    try {
      // Windows process scheduling can delay a short-lived child when the
      // suite has just spawned other stdio workers. Poll for the observable
      // lifecycle event instead of assuming a fixed 180ms wall-clock window.
      const deadline = Date.now() + 1500;
      while (!closed.mock.calls.length && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      expect(closed).toHaveBeenCalledOnce();
    } finally {
      client.close();
      // Windows can keep a just-exited child cwd locked for a short interval.
      // Give the process handle time to release it before the temp-tree cleanup
      // so the acceptance suite does not fail nondeterministically with EBUSY.
      await new Promise(resolve => setTimeout(resolve, 250));
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 30, retryDelay: 100 });
    }
  }, 5000);
});
