import { SettingsStore } from '../../src/server/settings.js';
import { selectedProviderConfig } from '../../src/server/providerProfiles.js';
import { readUniversalKeys, type UniversalKeyContext, UniversalProvider } from '../../src/server/universal.js';
import type { ToolDefinition } from '../../src/shared/types.js';

const settings = new SettingsStore().get();
const config = selectedProviderConfig(settings);
if (settings.offlineMode || config.offlineMode) {
  console.log(JSON.stringify({ status: 'SKIP', reason: 'Offline Mode is enabled.' }));
  process.exit(0);
}

const context: UniversalKeyContext = { protocol: config.protocol, endpoint: config.endpoint };
const keys = readUniversalKeys(context);
if (!keys.length) {
  console.log(JSON.stringify({ status: 'SKIP', reason: 'No saved key is configured for the active Universal API endpoint.' }));
  process.exit(0);
}
if (!/^https:\/\//i.test(config.endpoint)) {
  throw new Error('Live saved-provider smoke requires a trusted HTTPS endpoint.');
}

const tool: ToolDefinition = {
  name: 'live_provider_probe',
  description: 'Return a short connectivity confirmation; do not access files or external systems.',
  category: 'code',
  permission: 'read',
  parameters: {
    type: 'object',
    properties: { ok: { type: 'boolean', description: 'Set true to confirm provider connectivity.' } },
    required: ['ok'],
  },
};
const provider = new UniversalProvider(
  () => ({ ...config, capabilities: { tools: true, streaming: false, reasoning: false } }),
  () => keys,
);
const result = await provider.chatWithTools(
  [{ role: 'user', content: 'Call live_provider_probe exactly once with {"ok":true}. Then stop.' }],
  [tool],
  { timeoutSeconds: 45, maxOutputTokens: 64, reasoningEffort: 'none', requiredToolName: 'live_provider_probe' },
);
const calls = result.toolCalls?.map(call => call.name) || [];
if (!calls.includes('live_provider_probe')) throw new Error('Active saved provider did not return the required probe tool call.');

console.log(JSON.stringify({
  status: 'PASS',
  provider: 'universal',
  endpoint: new URL(config.endpoint).origin,
  protocol: config.protocol,
  model: config.model,
  toolCallReturned: true,
  usage: provider.usage.at(-1) || null,
}));
