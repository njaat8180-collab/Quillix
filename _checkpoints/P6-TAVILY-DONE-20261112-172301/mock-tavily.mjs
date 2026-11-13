/**
 * Local Tavily double for the M-TAVILY E2E. Emulates just enough of the
 * Tavily REST surface used by @tavily/core (POST /search, POST /extract) and
 * records every request body so the test can prove what actually left the app
 * (query sanitization, URL limits, usage accounting). No network, no keys.
 */
import http from 'node:http';

export const receivedRequests = [];

export function startMockTavily(port) {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'method not allowed' }));
        return;
      }
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        let parsed = {};
        try { parsed = JSON.parse(body || '{}'); } catch { parsed = {}; }
        receivedRequests.push({ route: req.url, body: parsed });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        if (req.url === '/search') {
          res.end(JSON.stringify({
            answer: 'React 19 documents the use() hook for reading resources in render.',
            response_time: 1,
            images: [],
            results: [
              { title: 'React 19 use() reference', url: 'https://react.dev/reference/react/use', content: 'The use() Hook reads the value of a resource like a Promise or context.', score: 0.98 },
              { title: 'React blog: React 19', url: 'https://react.dev/blog/2024/12/05/react-19', content: 'React 19 is now available with Actions and the use() hook.', score: 0.9 },
              { title: 'Third-party notes', url: 'https://example-notes.dev/react-19', content: 'Some unofficial notes about React 19.', score: 0.4 },
            ],
            usage: { credits: 1 },
          }));
          return;
        }
        if (req.url === '/extract') {
          const urls = Array.isArray(parsed.urls) ? parsed.urls : ['https://react.dev/reference/react/use'];
          res.end(JSON.stringify({
            results: urls.slice(0, 1).map(url => ({ url, title: 'Fetched page', raw_content: '# Docs\n\nuse() reads a resource in render. '.repeat(50) })),
            failed_results: urls.slice(1).map(url => ({ url, error: 'not found' })),
            response_time: 1,
            usage: { credits: 1 },
          }));
          return;
        }
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'unknown route' }));
      });
    });
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}
