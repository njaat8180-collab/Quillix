import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// M5.6 prompt-result-cache contract: repeated chat prompts may replay a cached
// answer, but only with a full-identity key, bounds, and a disclosed flag.
// Agent/tool flows are explicitly out of scope. Fails without the feature.
const root = process.cwd();
const server = fs.readFileSync(path.join(root, 'server.ts'), 'utf8');
const shared = fs.readFileSync(path.join(root, 'src', 'shared', 'promptResultCache.ts'), 'utf8');

assert.match(shared, /export function promptResultCacheKey\(/, 'shared module builds the cache key');
assert.match(shared, /export class PromptResultCache/, 'shared module owns the bounded cache');
assert.match(shared, /export function chunkCachedResponse\(/, 'shared module replays chunks');
assert.match(shared, /maxEntries: 64,/, 'entry count is bounded');
assert.match(shared, /maxEntryChars: 20_000,/, 'entry size is bounded');
assert.match(shared, /ttlMs: 5 \* 60_000,/, 'entries expire');

assert.match(server, /const promptResultCache = new PromptResultCache\(\);/, 'server instantiates the cache');
assert.match(server, /const cacheKey = promptResultCacheKey\(\{/, 'the chat endpoint builds a full-identity key');
assert.match(server, /done: true, cached: true/, 'a replayed answer is disclosed as cached');
assert.match(server, /done: true, cached: false/, 'a fresh answer is disclosed as not cached');
assert.match(server, /promptResultCache\.set\(cacheKey, assembled\);/, 'successful chat answers are cached');
// Scope guard: the agent run endpoint must not consult the chat cache.
const agentRun = server.slice(server.indexOf("app.post('/api/agent/run'"));
assert.doesNotMatch(agentRun, /promptResultCache/, 'the agent loop never reads the chat result cache');

console.log(JSON.stringify({ status: 'PASS', files: ['src/shared/promptResultCache.ts', 'server.ts'], checks: 12 }));
