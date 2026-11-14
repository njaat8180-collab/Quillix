import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// M9.3 — provider key rotation, exercised through the *real* provider adapter.
//
// The pool unit tests prove the decision layer; this file proves the adapter
// actually uses it: a 401 on the first key must be answered with the second
// key, and the rejected key must be remembered.

const isolatedSettingsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-key-rotation-settings-'));
const isolatedSettingsPath = path.join(isolatedSettingsDir, 'settings.json');
fs.writeFileSync(isolatedSettingsPath, JSON.stringify({ promptCache: false }));
const previousSettingsPath = process.env.QUILLIX_SETTINGS_PATH;
process.env.QUILLIX_SETTINGS_PATH = isolatedSettingsPath;

import { UniversalProvider } from '../universal.js';
import { providerKeyPool, providerKeyId } from '../providerKeyRotation.js';

afterEach(() => {
  vi.unstubAllGlobals();
  providerKeyPool.reset();
});

const config = {
  protocol: 'openai' as const,
  endpoint: 'https://key-rotation.example/v1',
  model: 'test/model',
  offlineMode: false,
  requestBudget: { minRequestIntervalMs: 0 },
};

function authHeaderOf(call: any[]): string {
  const headers = (call[1] as any)?.headers ?? {};
  return String(headers.Authorization ?? headers['x-api-key'] ?? '');
}
void authHeaderOf;

/**
 * The adapter reuses one `headers` object for every attempt and mutates it in
 * place, so the recorded call arguments cannot be inspected after the fact.
 * This mock captures the credential that was actually sent, per attempt.
 */
function recordingFetch(responses: Response[]) {
  const sent: string[] = [];
  let index = 0;
  const fetcher = vi.fn(async (_url: any, init: any) => {
    const headers = init?.headers ?? {};
    sent.push(String(headers.Authorization ?? headers['x-api-key'] ?? ''));
    const response = responses[Math.min(index, responses.length - 1)];
    index += 1;
    return response;
  });
  return { fetcher, sent };
}

describe('provider key rotation in the real provider adapter', () => {
  it('retries with the next key when the first key is rejected', async () => {
    const { fetcher, sent } = recordingFetch([
      new Response(JSON.stringify({ error: { message: 'invalid api key' } }), { status: 401 }),
      new Response(JSON.stringify({ choices: [{ message: { content: 'recovered' } }] })),
    ]);
    vi.stubGlobal('fetch', fetcher);

    const provider = new UniversalProvider(() => config, () => ['key-one', 'key-two']);
    await expect(provider.generateText('hello')).resolves.toBe('recovered');

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(sent).toEqual(['Bearer key-one', 'Bearer key-two']);
  });

  it('remembers the rejected key so the next request starts with the healthy key', async () => {
    const { fetcher, sent } = recordingFetch([
      new Response(JSON.stringify({ error: { message: 'invalid api key' } }), { status: 401 }),
      new Response(JSON.stringify({ choices: [{ message: { content: 'recovered' } }] })),
      new Response(JSON.stringify({ choices: [{ message: { content: 'second request' } }] })),
    ]);
    vi.stubGlobal('fetch', fetcher);

    const provider = new UniversalProvider(() => config, () => ['key-one', 'key-two']);
    await provider.generateText('first');
    await provider.generateText('second');

    // The third call must not repeat the rejected key.
    expect(sent[2]).toBe('Bearer key-two');
    const health = providerKeyPool.health(`universal:${config.endpoint}`);
    const rejected = health.keys.find(key => key.keyId === providerKeyId('key-one'));
    expect(rejected?.status).toBe('cooldown');
    expect(rejected?.failureKind).toBe('invalid-credentials');
  });

  it('does not rotate on a provider outage — the same key is retried', async () => {
    const { fetcher, sent } = recordingFetch([
      new Response('upstream down', { status: 503 }),
      new Response(JSON.stringify({ choices: [{ message: { content: 'recovered' } }] })),
    ]);
    vi.stubGlobal('fetch', fetcher);

    const provider = new UniversalProvider(() => config, () => ['key-one', 'key-two']);
    await provider.generateText('hello');

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(sent).toEqual(['Bearer key-one', 'Bearer key-one']);
  });

  it('keeps a key eligible after a provider outage', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response('upstream down', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: 'recovered' } }] })));
    vi.stubGlobal('fetch', fetcher);

    const provider = new UniversalProvider(() => config, () => ['key-one']);
    await provider.generateText('hello');

    const health = providerKeyPool.health(`universal:${config.endpoint}`);
    expect(health.keys[0].status).toBe('healthy');
    expect(health.keys[0].failures).toBe(1);
  });

  it('never leaks the key material into the health report', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] })));
    vi.stubGlobal('fetch', fetcher);

    const provider = new UniversalProvider(() => config, () => ['top-secret-key-value']);
    await provider.generateText('hello');

    const serialized = JSON.stringify(providerKeyPool.healthAll());
    expect(serialized).not.toContain('top-secret-key-value');
    expect(serialized).toContain(providerKeyId('top-secret-key-value'));
  });
});
