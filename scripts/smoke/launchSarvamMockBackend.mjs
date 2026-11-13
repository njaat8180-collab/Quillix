/** Test-only mock transport: no Sarvam credentials, network calls or quota. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const originalFetch = globalThis.fetch;
let generationTurn = 0;
const html = '<!doctype html><html lang="en"><head><title>Hello World</title><style>body{background:#091120;color:white;text-align:center}.temple{font-size:80px;animation:float 3s ease-in-out infinite alternate}@keyframes float{to{transform:translateY(-20px)}}</style></head><body><h1>Hello World</h1><div class="temple">🏛️</div></body></html>';
globalThis.fetch = async (url, init) => {
  if (String(url) !== 'https://api.sarvam.ai/v1/chat/completions') return originalFetch(url, init);
  const data = JSON.parse(init.body);
  if (init.headers['api-subscription-key'] !== 'test-only-sarvam-key') throw new Error('Unexpected Sarvam mock key');
  if (data.model !== 'sarvam-105b' || data.max_tokens > 4096) throw new Error('Invalid Sarvam model or Starter budget');
  const lastUser = [...data.messages].reverse().find(m => m.role === 'user')?.content || '';
  if (!data.tools?.length) return new Response(JSON.stringify({choices:[{message:{role:'assistant',content:'OK'},finish_reason:'stop'}]}),{status:200,headers:{'Content-Type':'application/json'}});
  generationTurn++;
  const hasCreated = data.messages.some(m => m.role === 'tool' && /written|created|success/i.test(m.content||''));
  const reply = (!hasCreated && generationTurn < 4) ? {
    role:'assistant',content:null,
    tool_calls:[{id:'sarvam-write-1',type:'function',function:{name:'write_file',arguments:JSON.stringify({filePath:'index.html',content:html})}}],
  } : {role:'assistant',content:'I created the requested page.'};
  if (reply.tool_calls && !data.tools.some(t => t.function.name === 'write_file')) throw new Error('Missing write_file tool');
  return new Response(JSON.stringify({choices:[{message:reply,finish_reason:reply.tool_calls?'tool_calls':'stop'}]}),{status:200,headers:{'Content-Type':'application/json'}});
};
const currentDir = path.dirname(fileURLToPath(import.meta.url));
globalThis.__dirname = path.resolve(currentDir, '../../.qa-dist');
await import('../../.qa-dist/server.js');
