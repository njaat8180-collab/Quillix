/** Minimal OpenAI-compatible endpoint for route-level provider verification. */
const http = require('http');
const port = Number(process.env.QUILLIX_MOCK_UNIVERSAL_PORT || 11498);
const textOnly = process.env.QUILLIX_MOCK_UNIVERSAL_TEXT_ONLY === '1';

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (req.method !== 'POST' || !/\/v1\/chat\/completions$/.test(req.url || '')) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    let request = {};
    try { request = JSON.parse(body); } catch {}
    const probe = !textOnly && Array.isArray(request.tools) && request.tools[0]?.function?.name;
    const message = probe
      ? { role: 'assistant', content: null, tool_calls: [{ id: 'probe-1', type: 'function', function: { name: probe, arguments: '{}' } }] }
      : { role: 'assistant', content: 'OK' };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id: 'quillix-probe', choices: [{ index: 0, message, finish_reason: probe ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 8, completion_tokens: 2, total_tokens: 10 } }));
  });
});

server.listen(port, '127.0.0.1', () => console.log(`MOCK Universal listening on 127.0.0.1:${port}`));
