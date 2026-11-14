let buffer = Buffer.alloc(0);
function send(message) {
  const payload = Buffer.from(JSON.stringify(message));
  process.stdout.write(`Content-Length: ${payload.length}\r\n\r\n`);
  process.stdout.write(payload);
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
      send({ jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'mock-mcp', version: '1' } } });
    } else if (body.method === 'tools/list') {
      send({ jsonrpc: '2.0', id: body.id, result: { tools: [{ name: 'lookup', description: 'Look up a deterministic test value.', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } }] } });
    } else if (body.method === 'tools/call') {
      send({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: `mock:${body.params?.arguments?.query || ''}` }] } });
    }
  }
});
