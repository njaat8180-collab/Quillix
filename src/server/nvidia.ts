import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {dpapi} from './sarvam.js';
import {UniversalProvider} from './universal.js';
import { getEffectiveProviderConcurrency, getEffectiveProviderIntervalMs } from '../shared/providerPacing.js';
import type {QuillixSettings} from '../shared/types.js';
import {readEncryptedKeyPool, saveEncryptedKeyToPool, clearEncryptedKeyPool, encryptedKeyPoolCount} from './encryptedKeyPool.js';
import {parseNimModelCatalog, type NimModelInfo} from './nimModels.js';
import {NimFailoverProvider} from './nvidiaFailover.js';

export const NVIDIA_API_ENDPOINT = 'https://integrate.api.nvidia.com/v1';
export const NVIDIA_DEFAULT_MODEL = 'openai/gpt-oss-120b';
const keyFile = path.join(os.homedir(), '.quillix', 'nvidia-key.dpapi.json');
const crypto = (operation:'protect'|'unprotect', value:string) => dpapi(operation, value);

export function saveNvidiaKey(value:string): void {
  const key = typeof value === 'string' ? value.trim() : '';
  if (!key || key.length > 4096 || /[\r\n]/.test(key)) throw new Error('Enter a valid NVIDIA API key.');
  const data = dpapi('protect', key);
  if (dpapi('unprotect', data) !== key) throw new Error('Windows secure storage verification failed.');
  fs.mkdirSync(path.dirname(keyFile), {recursive:true, mode:0o700});
  const tmp = `${keyFile}.${randomUUID()}.tmp`;
  try { fs.writeFileSync(tmp, JSON.stringify({format:'dpapi-current-user-v1', data}), {mode:0o600, flag:'wx'}); fs.renameSync(tmp, keyFile); }
  finally { try { fs.unlinkSync(tmp); } catch (e:any) { if (e?.code !== 'ENOENT') throw e; } }
}
export function readNvidiaKey(): string {
  if (!fs.existsSync(keyFile)) return process.env.NVIDIA_API_KEY?.trim() || '';
  const record = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
  if (record?.format !== 'dpapi-current-user-v1' || typeof record.data !== 'string') throw new Error('Saved NVIDIA key format is invalid. Re-save the NVIDIA API key.');
  return dpapi('unprotect', record.data);
}
export function hasNvidiaKey(): boolean { try { return !!readNvidiaKey(); } catch { return false; } }
export function clearNvidiaKey(): void { try { fs.unlinkSync(keyFile); } catch (e:any) { if (e?.code !== 'ENOENT') throw e; } }
export function readNvidiaKeys(): string[] { return [readNvidiaKey(), ...readEncryptedKeyPool('nvidia', crypto), ...(process.env.NVIDIA_API_KEYS || '').split(/[\r\n,;]+/g)].map(v=>v.trim()).filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i).slice(0,20); }
export function saveNvidiaFailoverKey(value:string): number { return saveEncryptedKeyToPool('nvidia', value, crypto); }
export function clearNvidiaFailoverKeys(): void { clearEncryptedKeyPool('nvidia'); }
export function nvidiaFailoverKeyCount(): number { return encryptedKeyPoolCount('nvidia', crypto); }
export const NVIDIA_MODELS_ENDPOINT = `${NVIDIA_API_ENDPOINT}/models`;
const NIM_CATALOG_TTL_MS = 10 * 60 * 1000;
const NIM_DISCOVERY_TIMEOUT_MS = 12_000;
let nimCatalog: { models: NimModelInfo[]; fetchedAt: number } | null = null;
let nimCatalogError: string | null = null;
let nimProvider: NimFailoverProvider | null = null;

export interface NimCatalogResult {
  models: NimModelInfo[];
  fetchedAt: number;
  source: 'live' | 'cache';
  error?: string;
}

/**
 * Discover the models this NVIDIA account can actually use from the
 * OpenAI-compatible `/v1/models` endpoint. Never guesses model ids: an empty
 * or failing discovery keeps the configured model as the only option.
 */
export async function discoverNimModels(force = false, credentialsOverride?: readonly string[]): Promise<NimCatalogResult> {
  if (!force && nimCatalog && Date.now() - nimCatalog.fetchedAt < NIM_CATALOG_TTL_MS) {
    return { models: nimCatalog.models, fetchedAt: nimCatalog.fetchedAt, source: 'cache' };
  }
  const keys = credentialsOverride
    ? [...new Set(credentialsOverride.map(value => value.trim()).filter(Boolean))]
    : readNvidiaKeys();
  if (!keys.length) {
    nimCatalogError = 'Save NVIDIA API key first.';
    return { models: nimCatalog?.models ?? [], fetchedAt: nimCatalog?.fetchedAt ?? 0, source: 'cache', error: nimCatalogError };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NIM_DISCOVERY_TIMEOUT_MS);
  try {
    let response: Response | undefined;
    for (let index = 0; index < keys.length; index++) {
      response = await fetch(NVIDIA_MODELS_ENDPOINT, {
        headers: { Authorization: `Bearer ${keys[index]}`, Accept: 'application/json' },
        signal: controller.signal,
      });
      if ((response.status === 401 || response.status === 403) && index + 1 < keys.length) {
        await response.body?.cancel().catch(() => {});
        continue;
      }
      break;
    }
    if (!response?.ok) throw new Error(`NVIDIA model discovery failed (HTTP ${response?.status || 'unknown'}).`);
    const payload = await response.json();
    const models = parseNimModelCatalog(payload);
    if (!models.length) throw new Error('NVIDIA model discovery returned no usable models.');
    nimCatalog = { models, fetchedAt: Date.now() };
    nimCatalogError = null;
    return { models, fetchedAt: nimCatalog.fetchedAt, source: 'live' };
  } catch (error) {
    nimCatalogError = error instanceof Error ? error.message : String(error ?? 'NVIDIA model discovery failed.');
    return { models: nimCatalog?.models ?? [], fetchedAt: nimCatalog?.fetchedAt ?? 0, source: 'cache', error: nimCatalogError };
  } finally {
    clearTimeout(timer);
  }
}

/** Last known catalog without touching the network. */
export function cachedNimModels(): NimModelInfo[] { return nimCatalog?.models ?? []; }

/** Health/failover snapshot for the dashboard; empty until the provider is used. */
export function nimFailoverSnapshot(): Record<string, unknown> {
  if (!nimProvider) return { active: '', models: {}, switches: [], catalog: cachedNimModels().map(model => model.id), catalogError: nimCatalogError };
  const snapshot = nimProvider.healthSnapshot() as Record<string, unknown>;
  return { ...snapshot, catalog: cachedNimModels().map(model => model.id), catalogError: nimCatalogError };
}
export function createNvidiaProvider(settings:()=>QuillixSettings): UniversalProvider {
  return new UniversalProvider(() => {
    const s = settings();
    const effectiveInterval = getEffectiveProviderIntervalMs({ turboSpeedMode: s.turboSpeedMode, performanceMode: s.performanceMode, overdriveMode: s.overdriveMode });
    return {
      protocol: 'openai',
      endpoint: NVIDIA_API_ENDPOINT,
      model: s.nvidiaModel || NVIDIA_DEFAULT_MODEL,
      offlineMode: s.offlineMode,
      capabilities: { tools: true, streaming: true, reasoning: true },
      requestBudget: {
        maxInputChars: 60000,
        maxOutputTokens: 8192,
        minRequestIntervalMs: effectiveInterval,
        maxConcurrentRequests: getEffectiveProviderConcurrency({ turboSpeedMode: s.turboSpeedMode, performanceMode: s.performanceMode, overdriveMode: s.overdriveMode })
      },
      overdriveMode: s.overdriveMode === true,
      promptCache: s.promptCache === true,
    };
  }, () => readNvidiaKeys());
}

/**
 * NVIDIA provider with automatic multi-model failover (Part 4).
 *
 * The UniversalProvider stays the transport (it owns pacing, endpoint-scoped
 * budget windows and the circuit breaker). The first bounded alternate-model
 * probe may skip a just-recorded cooldown; pacing and rolling quotas still apply.
 * The failover wrapper only chooses WHICH model id is sent, and it
 * re-reads settings per request so a model change applies without a restart.
 */
export function createNimProvider(settings:()=>QuillixSettings): NimFailoverProvider {
  let activeModel = settings().nvidiaModel || NVIDIA_DEFAULT_MODEL;
  const delegate = new UniversalProvider(() => {
    const s = settings();
    const effectiveInterval = getEffectiveProviderIntervalMs({ turboSpeedMode: s.turboSpeedMode, performanceMode: s.performanceMode, overdriveMode: s.overdriveMode });
    return {
      protocol: 'openai',
      endpoint: NVIDIA_API_ENDPOINT,
      model: activeModel,
      offlineMode: s.offlineMode,
      capabilities: { tools: true, streaming: true, reasoning: true },
      requestBudget: {
        maxInputChars: 60000,
        maxOutputTokens: 8192,
        minRequestIntervalMs: effectiveInterval,
        maxConcurrentRequests: getEffectiveProviderConcurrency({ turboSpeedMode: s.turboSpeedMode, performanceMode: s.performanceMode, overdriveMode: s.overdriveMode })
      },
      overdriveMode: s.overdriveMode === true,
      promptCache: s.promptCache === true,
    };
  }, () => readNvidiaKeys());
  const provider = new NimFailoverProvider(delegate, {
    models: () => cachedNimModels(),
    discoverModels: () => discoverNimModels(),
    priority: () => settings().nvidiaModelPriority ?? [],
    onModel: model => { activeModel = model; },
    configuredModel: () => settings().nvidiaModel || NVIDIA_DEFAULT_MODEL,
  }, activeModel);
  nimProvider = provider;
  return provider;
}
