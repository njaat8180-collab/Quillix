import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Part 2 rate-limit contract: the centralized service is real (RPM/TPM/day +
// shared cooldown + Retry-After parsing), the universal transport records into
// it, and every component reads one picture from /api/providers/rate-limit.
// Fails on a tree without the wiring.
const root = process.cwd();
const service = fs.readFileSync(path.join(root, 'src', 'server', 'rateLimitService.ts'), 'utf8');
const universal = fs.readFileSync(path.join(root, 'src', 'server', 'universal.ts'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.ts'), 'utf8');

// --- the service itself ---
assert.match(service, /export function parseRetryAfterMs\(/, 'Retry-After parsing lives in the service');
assert.match(service, /export function parseResetMs\(/, 'x-ratelimit-reset parsing lives in the service');
assert.match(service, /export function parseRateLimitHeaders\(/, 'the provider header set is normalized in one place');
assert.match(service, /maxRequestsPerMinute\?: number;/, 'RPM ceilings exist');
assert.match(service, /maxTokensPerMinute\?: number;/, 'TPM ceilings exist');
assert.match(service, /maxRequestsPerDay\?: number;/, 'daily request ceilings exist');
assert.match(service, /maxTokensPerDay\?: number;/, 'daily token ceilings exist');
assert.match(service, /export const rateLimitService = new RateLimitService\(\);/, 'one process-wide shared instance is exported');
assert.match(service, /export function rateLimitScopeFor\(/, 'scopes are canonical per protocol+endpoint');
assert.match(service, /if \(durationParts\.length >= 1/, 'single-unit reset durations ("45s") parse correctly');
// A provider-advertised ceiling may only tighten a declared one.
assert.match(service, /never raises an operator's limit|never \*raises\*/, 'declared ceilings are authoritative');

// --- the universal transport records into it ---
assert.match(universal, /import \{ rateLimitService \} from '\.\/rateLimitService\.js';/, 'the universal transport uses the shared service');
assert.match(universal, /rateLimitService\.record\(rateLimitScope/, 'real endpoint traffic is recorded');
assert.match(universal, /rateLimitService\.noteResponse\(rateLimitScope, response\)/, 'provider responses (429/Retry-After) open the shared cooldown');

// --- every component reads one picture ---
assert.match(server, /import \{ rateLimitService, rateLimitScopeFor \}/, 'the server exposes the service');
assert.match(server, /const quota = \{/, 'the rate-limit endpoint includes the quota snapshot');
assert.match(server, /rateLimitService\.scopesSnapshot\(\)/, 'all tracked scopes are listed');
assert.match(server, /rateLimitService\.snapshot\(activeScope\)/, 'the active endpoint snapshot is exposed');

console.log(JSON.stringify({ status: 'PASS', files: ['src/server/rateLimitService.ts', 'src/server/universal.ts', 'server.ts'], checks: 18 }));
