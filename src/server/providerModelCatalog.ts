import { createHash } from 'node:crypto';
import { validateUniversalEndpoint, type ProviderConfig } from './universal.js';
import type { ProviderModelEntry } from '../shared/providerModels.js';
export type { ProviderModelEntry } from '../shared/providerModels.js';

type CachedCatalog = { expiresAt: number; models: ProviderModelEntry[] };
const catalogCache = new Map<string, CachedCatalog>();
const CATALOG_TTL_MS = 5 * 60_000;

function catalogKey(config: ProviderConfig, credentials: readonly string[]): string {
  const keyMaterial = `${config.protocol}\n${validateUniversalEndpoint(config.endpoint, config.protocol)}\n${credentials.join('\n')}`;
  return createHash('sha256').update(keyMaterial).digest('hex');
}

/** A successful recent user discovery can seed failover before a provider is
 * rate-limited. The cache key is a digest: credentials are never stored here.
 */
export function getCachedProviderModels(config: ProviderConfig, credential: string | readonly string[] = '', now = Date.now()): ProviderModelEntry[] | undefined {
  const credentials = [...new Set((Array.isArray(credential) ? credential : [credential]).map(value => String(value).trim()))];
  const cached = catalogCache.get(catalogKey(config, credentials));
  if (!cached) return undefined;
  if (cached.expiresAt <= now) { catalogCache.delete(catalogKey(config, credentials)); return undefined; }
  return cached.models.map(model => ({ ...model }));
}

function readModels(payload: unknown, protocol: ProviderConfig['protocol']): ProviderModelEntry[] {
  const root = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const rows = Array.isArray(root.data) ? root.data : Array.isArray(root.models) ? root.models : [];
  const result: ProviderModelEntry[] = [];
  for (const value of rows) {
    if (!value || typeof value !== 'object') continue;
    const row = value as Record<string, unknown>;
    let id = typeof row.id === 'string' ? row.id.trim() : typeof row.name === 'string' ? row.name.trim() : '';
    if (protocol === 'gemini') id = id.replace(/^models\//, '');
    if (!id) continue;
    const name = typeof row.display_name === 'string' ? row.display_name : typeof row.displayName === 'string' ? row.displayName : undefined;
    const contextLength = Number(row.context_length ?? row.max_context_length ?? row.contextLength);
    result.push({ id, ...(name ? { name } : {}),
      ...(Number.isFinite(contextLength) && contextLength > 0 ? { contextLength: Math.round(contextLength) } : {}),
      ...(typeof (row.supports_tools ?? row.tools) === 'boolean' ? { tools: Boolean(row.supports_tools ?? row.tools) } : {}),
      ...(typeof (row.supports_streaming ?? row.streaming) === 'boolean' ? { streaming: Boolean(row.supports_streaming ?? row.streaming) } : {}),
      ...(typeof (row.supports_reasoning ?? row.reasoning) === 'boolean' ? { reasoning: Boolean(row.supports_reasoning ?? row.reasoning) } : {}),
    });
  }
  return result;
}

/** Read the model catalog exposed by the configured API endpoint. Credentials
 * stay in the main process and are only sent to the endpoint the user saved.
 */
export async function discoverProviderModels(config: ProviderConfig, credential: string | readonly string[] = '', options: { forceRefresh?: boolean } = {}): Promise<ProviderModelEntry[]> {
  const endpoint = validateUniversalEndpoint(config.endpoint, config.protocol);
  const credentials = [...new Set((Array.isArray(credential) ? credential : [credential]).map(value => String(value).trim()))];
  if (config.auth?.type === 'none' && !credentials.length) credentials.push('');
  const cacheKey = catalogKey(config, credentials);
  if (!options.forceRefresh) {
    const cached = catalogCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.models.map(model => ({ ...model }));
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    for (let credentialIndex = 0; credentialIndex < Math.max(1, credentials.length); credentialIndex++) {
      const key = credentials[credentialIndex] || '';
      const url = new URL(`${endpoint}/models`);
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (config.protocol === 'gemini') {
        if (key) url.searchParams.set('key', key);
      } else if (key && config.auth?.type === 'basic') {
        headers.Authorization = `Basic ${Buffer.from(key).toString('base64')}`;
      } else if (key && config.auth?.type === 'header') {
        headers[config.auth.header || 'x-api-key'] = key;
      } else if (key && config.protocol === 'anthropic') {
        headers['x-api-key'] = key;
        headers['anthropic-version'] = '2023-06-01';
      } else if (key && config.auth?.type !== 'none') {
        headers.Authorization = `Bearer ${key}`;
      }
      const models: ProviderModelEntry[] = [];
      const seen = new Set<string>();
      let nextPageToken = '';
      let rejectedCredential = false;
      for (let page = 0; page < 100; page++) {
        const pageUrl = new URL(url);
        if (nextPageToken) {
          if (config.protocol === 'gemini') pageUrl.searchParams.set('pageToken', nextPageToken);
          else pageUrl.searchParams.set(config.protocol === 'anthropic' ? 'after_id' : 'after', nextPageToken);
        }
        const response = await fetch(pageUrl, { headers, signal: controller.signal });
        if ((response.status === 401 || response.status === 403) && credentialIndex + 1 < credentials.length) {
          await response.body?.cancel().catch(() => {});
          rejectedCredential = true;
          break;
        }
        if (!response.ok) throw new Error(`Model discovery failed (HTTP ${response.status}).`);
        const payload = await response.json() as Record<string, unknown>;
        const pageModels = readModels(payload, config.protocol);
        for (const model of pageModels) {
          if (!seen.has(model.id)) { seen.add(model.id); models.push(model); }
        }
        if (models.length >= 10_000) break;
        const token = config.protocol === 'gemini'
          ? payload.nextPageToken
          : (payload.has_more === true ? (payload.last_id || pageModels.at(-1)?.id) : undefined);
        if (typeof token !== 'string' || !token.trim()) break;
        nextPageToken = token.trim();
      }
      if (rejectedCredential) continue;
      if (!models.length) throw new Error('The provider returned no usable model IDs from its models endpoint.');
      catalogCache.set(cacheKey, { models: models.map(model => ({ ...model })), expiresAt: Date.now() + CATALOG_TTL_MS });
      if (catalogCache.size > 40) {
        for (const [key, entry] of catalogCache) if (entry.expiresAt <= Date.now()) catalogCache.delete(key);
        while (catalogCache.size > 40) catalogCache.delete(catalogCache.keys().next().value!);
      }
      return models;
    }
    throw new Error('Model discovery failed (HTTP 401/403). No saved API key was accepted.');
  } finally {
    clearTimeout(timer);
  }
}
