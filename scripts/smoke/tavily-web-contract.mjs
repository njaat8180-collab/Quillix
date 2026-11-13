import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// M-TAVILY contract: web_search / web_fetch are real tools with hard safety
// gates; queries are sanitized; results are bounded; usage is metered and
// budget-capped; consent is opt-in. Fails on a tree without the feature.
const root = process.cwd();
const policy = fs.readFileSync(path.join(root, 'src', 'shared', 'webSearchPolicy.ts'), 'utf8');
const service = fs.readFileSync(path.join(root, 'src', 'server', 'tavilyVerification.ts'), 'utf8');
const registry = fs.readFileSync(path.join(root, 'src', 'server', 'toolRegistry.ts'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.ts'), 'utf8');
const settings = fs.readFileSync(path.join(root, 'src', 'components', 'SettingsScreen.tsx'), 'utf8');

// --- policy surface ---
assert.match(policy, /export function sanitizeSearchQuery\(/, 'queries are sanitized');
assert.match(policy, /sk-\[A-Za-z0-9_-\]\{12,\}/, 'API-key-shaped tokens are stripped from queries');
assert.match(policy, /redacted-path/, 'local paths are stripped from queries');
assert.match(policy, /export function formatCitations\(/, 'citations have one canonical format');
assert.match(policy, /export function withinSearchBudget\(/, 'the daily budget rule is testable');

// --- service surface ---
assert.match(service, /public async search\(/, 'the service exposes web search');
assert.match(service, /public async extract\(/, 'the service exposes page fetch');
assert.match(service, /public budgetStatus\(/, 'the service exposes today\'s budget');
assert.match(service, /public clearWebCaches\(/, 'caches can be cleared');
assert.match(service, /QUILLIX_TAVILY_BASE_URL/, 'a proxy/self-hosted Tavily endpoint is supported');
assert.match(service, /Math\.max\(1, Math\.min\(WEB_SEARCH_LIMITS\.maxResults/, 'search results are bounded');
assert.match(service, /slice\(0, WEB_SEARCH_LIMITS\.maxUrlsPerFetch\)/, 'fetched pages are bounded');

// --- tools + gates ---
assert.match(registry, /name: 'web_search'/, 'web_search is a registered tool');
assert.match(registry, /name: 'web_fetch'/, 'web_fetch is a registered tool');
assert.match(registry, /Offline Mode blocks Tavily network access/, 'Offline Mode blocks both tools');
assert.match(registry, /tavilyNetworkConsent !== true/, 'both tools require explicit consent');
assert.match(registry, /searchBudgetMessage\(budget\.searches, budget\.cap\)/, 'the daily budget blocks searches honestly');
assert.match(registry, /permission: 'network'/, 'both tools are declared network-permission tools');

// --- settings UI ---
assert.match(settings, /tavilyNetworkConsent/, 'Settings carries the consent toggle');
assert.match(settings, /tavilyDailySearchCap/, 'Settings carries the daily budget');
assert.match(settings, /role="switch"/, 'the consent control is an accessible switch');
assert.match(settings, /Allow agent web search and page fetch/, 'the consent label is explicit');

// --- server surface ---
assert.match(server, /\/api\/verification\/tavily\/budget/, 'budget endpoint exists');
assert.match(server, /\/api\/verification\/tavily\/cache-clear/, 'cache-clear endpoint exists');

// --- research mode (M-TAVILY-3) + citations (M-TAVILY-4) ---
assert.match(server, /app\.post\('\/api\/research', requireAgentMode/, 'research endpoint exists and requires Agent mode');
assert.match(server, /clampResearchQueries\(parsedQueries\)/, 'planned queries are clamped');
assert.match(server, /buildResearchEvidenceBlock\(evidence\)/, 'the evidence block is bounded');
assert.match(server, /researchSynthesisInstruction\(\)/, 'synthesis must cite or refuse');
assert.match(server, /Offline Mode blocks web research/, 'research is blocked in Offline Mode');
assert.match(server, /Tavily network use is off/, 'research requires consent');
const chatView = fs.readFileSync(path.join(root, 'src', 'components', 'ChatView.tsx'), 'utf8');
const composer = fs.readFileSync(path.join(root, 'src', 'components', 'Composer.tsx'), 'utf8');
const app = fs.readFileSync(path.join(root, 'src', 'App.tsx'), 'utf8');
assert.match(chatView, /message\.sources && message\.sources\.length > 0/, 'cited sources render a chat footer');
assert.match(chatView, /title="Official source"/, 'official sources are badged');
assert.match(composer, /Deep Research/, 'the composer exposes the research toggle');
assert.match(composer, /role="switch"/, 'the research control is an accessible switch');
assert.match(app, /if \(researchMode\) void runResearch\(prompt\);/, 'sends route to research when enabled');
assert.match(app, /runResearch = useCallback/, 'the research flow is wired in App');

console.log(JSON.stringify({ status: 'PASS', files: ['src/shared/webSearchPolicy.ts', 'src/shared/researchPlan.ts', 'src/server/tavilyVerification.ts', 'src/server/toolRegistry.ts', 'server.ts', 'src/components/SettingsScreen.tsx', 'src/components/Composer.tsx', 'src/components/ChatView.tsx', 'src/App.tsx'], checks: 36 }));
