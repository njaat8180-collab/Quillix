let buffer = Buffer.alloc(0);
let openedUri = '';

function send(message) {
  const payload = Buffer.from(JSON.stringify(message));
  process.stdout.write(`Content-Length: ${payload.length}\r\n\r\n`);
  process.stdout.write(payload);
}

function location(uri, line = 0, character = 0) {
  return { uri, range: { start: { line, character }, end: { line, character: character + 5 } } };
}

process.stdin.on('data', chunk => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const separator = buffer.indexOf(Buffer.from('\r\n\r\n'));
    if (separator < 0) return;
    const header = buffer.subarray(0, separator).toString('ascii');
    const match = /content-length:\s*(\d+)/i.exec(header);
    if (!match) process.exit(2);
    const length = Number(match[1]);
    if (buffer.length < separator + 4 + length) return;
    const body = JSON.parse(buffer.subarray(separator + 4, separator + 4 + length).toString());
    buffer = buffer.subarray(separator + 4 + length);

    if (body.method === 'initialize') {
      send({ jsonrpc: '2.0', id: body.id, result: { capabilities: { definitionProvider: true, referencesProvider: true, hoverProvider: true, completionProvider: { triggerCharacters: ['.'] }, renameProvider: true, workspaceSymbolProvider: true, documentSymbolProvider: true, diagnosticProvider: { identifier: 'mock', interFileDependencies: false, workspaceDiagnostics: false } }, serverInfo: { name: 'mock-lsp', version: '1' } } });
    } else if (body.method === 'textDocument/didOpen') {
      openedUri = body.params?.textDocument?.uri || openedUri;
    } else if (body.method === 'textDocument/definition') {
      send({ jsonrpc: '2.0', id: body.id, result: openedUri ? [location(openedUri, 0, 0)] : [] });
    } else if (body.method === 'textDocument/references') {
      send({ jsonrpc: '2.0', id: body.id, result: openedUri ? [location(openedUri, 0, 0), location(openedUri, 1, 0)] : [] });
    } else if (body.method === 'textDocument/diagnostic') {
      send({ jsonrpc: '2.0', id: body.id, result: { kind: 'full', items: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } }, severity: 2, code: 'MOCK001', source: 'mock-lsp', message: 'Mock language-server warning' }] } });
    } else if (body.method === 'textDocument/hover') {
      send({ jsonrpc: '2.0', id: body.id, result: { contents: [{ language: 'typescript', value: 'const answer: number' }, 'Mock hover documentation'], range: { start: { line: 0, character: 0 }, end: { line: 0, character: 6 } } } });
    } else if (body.method === 'textDocument/completion') {
      send({ jsonrpc: '2.0', id: body.id, result: { isIncomplete: false, items: [{ label: 'answer', kind: 6, detail: 'const answer: number', insertText: 'answer' }, { label: 'another', kind: 6 }] } });
    } else if (body.method === 'textDocument/rename') {
      send({ jsonrpc: '2.0', id: body.id, result: { changes: openedUri ? { [openedUri]: [
        { range: { start: { line: 0, character: 6 }, end: { line: 0, character: 12 } }, newText: body.params?.newName || 'renamed' },
        { range: { start: { line: 1, character: 0 }, end: { line: 1, character: 6 } }, newText: body.params?.newName || 'renamed' },
      ] } : {} } });
    } else if (body.method === 'workspace/symbol') {
      send({ jsonrpc: '2.0', id: body.id, result: openedUri ? [{ name: body.params?.query || 'answer', kind: 13, location: location(openedUri, 0, 6), containerName: 'mock' }] : [] });
    } else if (body.method === 'textDocument/documentSymbol') {
      send({
        jsonrpc: '2.0',
        id: body.id,
        result: [{
          name: 'answer',
          kind: 13,
          range: { start: { line: 0, character: 6 }, end: { line: 0, character: 12 } },
          selectionRange: { start: { line: 0, character: 6 }, end: { line: 0, character: 12 } },
          children: [{
            name: 'nested',
            kind: 12,
            range: { start: { line: 1, character: 0 }, end: { line: 1, character: 6 } },
            selectionRange: { start: { line: 1, character: 0 }, end: { line: 1, character: 6 } },
          }],
        }],
      });
    }
  }
});
