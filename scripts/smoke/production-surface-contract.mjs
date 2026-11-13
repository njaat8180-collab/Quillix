import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const server = read('server.ts');
const engine = read('src/server/agentEngine.ts');
const plugins = read('src/server/offlineCodingPlugins.ts');
const registry = read('src/server/toolRegistry.ts');
const health = read('src/shared/apiHealth.ts');
const settings = read('src/components/SettingsScreen.tsx');
const quickConnect = read('src/components/QuickConnect.tsx');
const chat = read('src/components/ChatPanel.tsx');
const editor = read('src/components/EditorArea.tsx');
const packaging = read('scripts/smoke/package-win.mjs');
const vite = read('vite.config.ts');
const source = `${server}\n${engine}\n${plugins}\n${registry}\n${health}\n${settings}\n${quickConnect}\n${chat}\n${editor}\n${packaging}\n${vite}`;
const checks = [
  ['provider brain catalog is exposed', /\/api\/brains/],
  ['dedicated provider failover routes exist', /providers\/(?:openai|groq|grok|sarvam)\/failover-key/],
  ['dedicated NVIDIA provider is exposed end to end', /providers\/nvidia\/(?:key|test|failover-key)[\s\S]*NVIDIA NIM[\s\S]*nvidiaModel/],
  ['NVIDIA is selectable from Quick Connect', /'nvidia', 'NVIDIA NIM', 'Direct NVIDIA API/],
  ['NVIDIA active status is wired through the shell', /nvidiaConnection[\s\S]*NVIDIA NIM/],
  ['Windows packaging has a bounded timeout', /packageTimeoutMs[\s\S]*timeout: packageTimeoutMs/],
  ['Windows packaging checks resource headroom before the Electron build', /package-resource-preflight[\s\S]*build:electron/],
  ['Universal failover route exists', /providers\/universal\/failover-key/],
  ['resume context route exists', /tasks\/:id\/resume-context/],
  ['token efficiency telemetry route exists', /metrics\/token-efficiency/],
  ['safe workspace patch preview is registered', /preview_patch/],
  ['task rollback journal is implemented', /rollbackTask|rollback:/],
  ['offline plugin packs include requested integrations', /tree-sitter[\s\S]*composio[\s\S]*mcp[\s\S]*swebench[\s\S]*sweagent/],
  ['Health Center uses active-target helper', /activeApiHealthTargets\(settings\)/],
  ['Health policy retains Tavily with the active provider', /target\.id === active \|\| target\.id === 'tavily'/],
  ['Health Center has a Tavily verification action', /fetch\('\/api\/verification\/tavily'/],
  ['Chat history has inline delete', /q-chat-history-delete[\s\S]*onDeleteChat\(chat\.id\)/],
  ['Studio exposes an enabled Preview control in writable mode', /onOpenPreview && !readOnly && <button[\s\S]*effectivePreviewInfo[\s\S]*q-preview-toolbar-button/],
  ['Monaco inline completions use the shared language list including HTML and CSS', /INLINE_COMPLETION_LANGUAGES[\s\S]*registerInlineCompletionsProvider/],
  ['React is deduplicated and only Monaco runtime is split from the shared React wrapper', /dedupe:\s*\['react',\s*'react-dom'\][\s\S]*manualChunks\(id\)[\s\S]*id\.includes\('node_modules\/monaco-editor\/'\)[\s\S]*return 'monaco'/],
  ['agent has bounded repair/idempotency guard', /repairBudget[\s\S]*repeatedUnchangedFailures/],
];
for (const [name, pattern] of checks) assert.match(source, pattern, name);
const inline = read('src/shared/inlineCompletion.ts');
assert.match(inline, /'html'/, 'inline completion supports HTML');
assert.match(inline, /'css'/, 'inline completion supports CSS');
console.log(JSON.stringify({ status: 'PASS', checks: checks.length + 1, contract: 'production-surface' }));
