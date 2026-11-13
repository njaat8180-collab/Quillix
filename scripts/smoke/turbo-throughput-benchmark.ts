import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { ProviderRouter } from '../../src/server/sarvam.js';
import { UniversalProvider } from '../../src/server/universal.js';
import { SettingsStore } from '../../src/server/settings.js';
import { getEffectiveProviderConcurrency, getEffectiveProviderIntervalMs } from '../../src/shared/providerPacing.js';
import type { AIProvider } from '../../src/server/qwen.js';

const requestCount = 3;
// Synthetic per-request latency. Deliberately longer than Turbo's 1000ms
// pacing floor so the two-request concurrency limit is actually exercised;
// real cloud first-token times are typically longer than one second.
const mockLatencyMs = 1_500;
const originalOnlineInterval = process.env.QUILLIX_ONLINE_MIN_INTERVAL_MS;
const originalUniversalInterval = process.env.QUILLIX_UNIVERSAL_MIN_INTERVAL_MS;
delete process.env.QUILLIX_ONLINE_MIN_INTERVAL_MS;
delete process.env.QUILLIX_UNIVERSAL_MIN_INTERVAL_MS;

const activeByScenario = new Map<string, number>();
const maximumByScenario = new Map<string, number>();
const server = createServer((request, response) => {
  const scenario = new URL(request.url || '/', 'http://127.0.0.1').pathname.split('/').filter(Boolean)[0] || 'unknown';
  const active = (activeByScenario.get(scenario) || 0) + 1;
  activeByScenario.set(scenario, active);
  maximumByScenario.set(scenario, Math.max(maximumByScenario.get(scenario) || 0, active));
  request.resume();
  request.on('end', () => setTimeout(() => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'mock response' }, finish_reason: 'stop' }], usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 } }));
    activeByScenario.set(scenario, Math.max(0, (activeByScenario.get(scenario) || 1) - 1));
  }, mockLatencyMs));
});

function listen(): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('Turbo benchmark mock server failed to bind.'));
      resolve(address.port);
    });
  });
}

async function runScenario(port: number, turboSpeedMode: boolean): Promise<{ elapsedMs: number; maxInFlight: number }> {
  const scenario = turboSpeedMode ? 'turbo' : 'normal';
  const providerId = `turbo-benchmark-${scenario}`;
  const directory = fs.mkdtempSync(path.join(process.cwd(), '.quillix-turbo-benchmark-'));
  try {
    const settings = new SettingsStore(path.join(directory, 'settings.json'));
    const update = settings.update({ aiProvider: providerId, offlineMode: false, turboSpeedMode, performanceMode: 'balanced' });
    if (!update.success) throw new Error(`Could not configure benchmark provider: ${update.error}`);
    const provider = new UniversalProvider(() => {
      const current = settings.get();
      return {
        protocol: 'openai', endpoint: `http://127.0.0.1:${port}/${scenario}/v1`, model: 'quillix-turbo-mock', offlineMode: false,
        auth: { type: 'none' }, capabilities: { tools: true, streaming: false, reasoning: false },
        requestBudget: {
          minRequestIntervalMs: getEffectiveProviderIntervalMs(current),
          maxConcurrentRequests: getEffectiveProviderConcurrency(current),
        },
      };
    }, () => '');
    const router = new ProviderRouter({} as AIProvider, settings);
    router.registerBrain({ id: providerId, label: scenario, mode: 'online', capabilities: { tools: true, streaming: false, reasoning: false }, create: () => provider });
    const startedAt = performance.now();
    await Promise.all(Array.from({ length: requestCount }, (_, index) => router.generateText(`scheduler-only benchmark request ${index + 1}`, { maxOutputTokens: 8 })));
    return { elapsedMs: Math.round(performance.now() - startedAt), maxInFlight: maximumByScenario.get(scenario) || 0 };
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

try {
  const port = await listen();
  const normal = await runScenario(port, false);
  const turbo = await runScenario(port, true);
  const speedup = Number((normal.elapsedMs / Math.max(1, turbo.elapsedMs)).toFixed(2));
  if (normal.maxInFlight !== 1) throw new Error(`Normal mode exceeded its single-flight limit (${normal.maxInFlight}).`);
  if (turbo.maxInFlight !== 2) throw new Error(`Turbo did not reach its two-request limit (${turbo.maxInFlight}).`);
  if (turbo.elapsedMs >= normal.elapsedMs * 0.7) throw new Error(`Turbo scheduler improvement was below the 30% acceptance target (${speedup}x).`);
  console.log(JSON.stringify({ status: 'PASS', measurement: 'synthetic scheduler validation only; not a model/provider benchmark', requestCount, mockLatencyMs, normal, turbo, speedup }));
} finally {
  await new Promise<void>(resolve => server.close(() => resolve()));
  if (originalOnlineInterval === undefined) delete process.env.QUILLIX_ONLINE_MIN_INTERVAL_MS;
  else process.env.QUILLIX_ONLINE_MIN_INTERVAL_MS = originalOnlineInterval;
  if (originalUniversalInterval === undefined) delete process.env.QUILLIX_UNIVERSAL_MIN_INTERVAL_MS;
  else process.env.QUILLIX_UNIVERSAL_MIN_INTERVAL_MS = originalUniversalInterval;
}
