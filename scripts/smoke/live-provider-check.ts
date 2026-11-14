import { createServer } from 'node:http';
import { UniversalProvider, type UniversalProtocol } from '../../src/server/universal.js';
import type { ToolDefinition } from '../../src/shared/types.js';

const mock = /^(1|true|yes)$/i.test(process.env.QUILLIX_LIVE_MOCK || '');
let endpoint = process.env.QUILLIX_LIVE_ENDPOINT?.trim();
let model = process.env.QUILLIX_LIVE_MODEL?.trim();
const protocol = (process.env.QUILLIX_LIVE_PROTOCOL?.trim() || 'openai') as UniversalProtocol;
const apiKey = process.env.QUILLIX_LIVE_API_KEY?.trim() || '';
const requireTool = /^(1|true|yes)$/i.test(process.env.QUILLIX_LIVE_REQUIRE_TOOL || '');
const allowedProtocols = new Set<UniversalProtocol>(['openai', 'responses', 'anthropic', 'gemini']);

if ((!mock && (!endpoint || !model || !allowedProtocols.has(protocol) || (!apiKey && process.env.QUILLIX_LIVE_AUTH !== 'none'))) || (mock && !allowedProtocols.has(protocol))) {
  console.log(JSON.stringify({
    status: 'SKIP',
    reason: 'Set QUILLIX_LIVE_ENDPOINT, QUILLIX_LIVE_MODEL, QUILLIX_LIVE_PROTOCOL and QUILLIX_LIVE_API_KEY (or QUILLIX_LIVE_AUTH=none).',
  }));
  process.exit(0);
}

let mockServer: ReturnType<typeof createServer> | undefined;
if (mock) {
  mockServer = createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const wantsTool = requireTool && (
          (protocol === 'openai' && Array.isArray(payload.tools) && payload.tools.some((tool: any) => tool?.function?.name === 'live_provider_probe')) ||
          (protocol === 'responses' && Array.isArray(payload.tools) && payload.tools.some((tool: any) => tool?.name === 'live_provider_probe')) ||
          (protocol === 'anthropic' && Array.isArray(payload.tools) && payload.tools.some((tool: any) => tool?.name === 'live_provider_probe')) ||
          (protocol === 'gemini' && Array.isArray(payload.tools) && payload.tools.some((group: any) => group?.functionDeclarations?.some((tool: any) => tool?.name === 'live_provider_probe')))
        );
        const text = 'Local compatibility provider connection confirmed.';
        const result = protocol === 'openai'
          ? { choices: [{ index: 0, message: wantsTool ? { role: 'assistant', tool_calls: [{ id: 'mock-probe-1', type: 'function', function: { name: 'live_provider_probe', arguments: '{"ok":true}' } }] } : { role: 'assistant', content: text }, finish_reason: wantsTool ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 } }
          : protocol === 'responses'
            ? { status: 'completed', output: wantsTool ? [{ type: 'function_call', call_id: 'mock-probe-1', name: 'live_provider_probe', arguments: '{"ok":true}' }] : [{ type: 'message', content: [{ type: 'output_text', text }] }], usage: { input_tokens: 12, output_tokens: 8 } }
            : protocol === 'anthropic'
              ? { content: wantsTool ? [{ type: 'tool_use', id: 'mock-probe-1', name: 'live_provider_probe', input: { ok: true } }] : [{ type: 'text', text }], stop_reason: wantsTool ? 'tool_use' : 'end_turn', usage: { input_tokens: 12, output_tokens: 8 } }
              : { candidates: [{ content: { parts: wantsTool ? [{ functionCall: { name: 'live_provider_probe', args: { ok: true } } }] : [{ text }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 8 } };
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ id: 'quillix-live-mock', ...result }));
      } catch {
        response.writeHead(400, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ error: { message: 'invalid mock request' } }));
      }
    });
  });
  await new Promise<void>(resolve => mockServer!.listen(0, '127.0.0.1', resolve));
  const address = mockServer.address();
  if (!address || typeof address === 'string') throw new Error('Local live-provider mock failed to bind.');
  endpoint = `http://127.0.0.1:${address.port}/v1`;
  model = model || 'quillix-live-mock';
}

const probeTool: ToolDefinition = {
  name: 'live_provider_probe',
  description: 'Return a short provider connectivity confirmation.',
  category: 'code',
  permission: 'read',
  parameters: { type: 'object', properties: { ok: { type: 'boolean', description: 'Whether the provider is reachable.' } }, required: ['ok'] },
};
const provider = new UniversalProvider(
  () => ({
    protocol,
    endpoint: endpoint!,
    model: model!,
    offlineMode: false,
    auth: { type: mock || process.env.QUILLIX_LIVE_AUTH === 'none' ? 'none' : 'bearer' },
    capabilities: { tools: true, streaming: false, reasoning: false },
  }),
  () => apiKey,
);

const prompt = requireTool
  ? 'Call the live_provider_probe tool with {"ok":true}, then reply with a short confirmation.'
  : 'Reply with a short confirmation that this provider connection is working.';
const result = await provider.chatWithTools(
  [{ role: 'user', content: prompt }],
  [probeTool],
  { timeoutSeconds: 90, maxOutputTokens: 256, reasoningEffort: 'none' },
);
if (mockServer) await new Promise<void>(resolve => mockServer!.close(() => resolve()));
const toolCalls = result.toolCalls?.map(call => call.name) || [];
if (!result.text?.trim() && !toolCalls.length) throw new Error('Live provider returned neither text nor a tool call.');
if (requireTool && !toolCalls.includes('live_provider_probe')) throw new Error('Live provider returned text but did not execute the required probe tool.');

console.log(JSON.stringify({
  status: 'PASS',
  protocol,
  model,
  hasText: Boolean(result.text?.trim()),
  toolCalls,
  usage: provider.usage.at(-1) || null,
}));
