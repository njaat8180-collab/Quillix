/** Dedicated OpenAI provider: fixed official endpoint and independent Windows DPAPI key.
 * Only a model ID can be configured; an OpenAI secret is never forwarded to
 * the configurable Universal endpoint or stored in renderer/JSON settings.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {dpapi} from './sarvam.js';
import {UniversalProvider} from './universal.js';
import { getEffectiveProviderConcurrency, getEffectiveProviderIntervalMs } from '../shared/providerPacing.js';
import {readEncryptedKeyPool, saveEncryptedKeyToPool, clearEncryptedKeyPool, encryptedKeyPoolCount} from './encryptedKeyPool.js';
import type {QuillixSettings} from '../shared/types.js';

const keyFile = path.join(os.homedir(), '.quillix', 'openai-key.dpapi.json');
export const OPENAI_API_ENDPOINT = 'https://api.openai.com/v1';

export function saveOpenAIKey(value: string): void {
  const key = typeof value === 'string' ? value.trim() : '';
  if (!key || key.length > 4096 || /[\r\n]/.test(key)) throw new Error('Enter a valid OpenAI API key.');
  const ciphertext = dpapi('protect', key);
  if (dpapi('unprotect', ciphertext) !== key) throw new Error('Windows secure storage verification failed; the previous OpenAI key was not changed.');
  fs.mkdirSync(path.dirname(keyFile), {recursive:true, mode:0o700});
  const tmp = `${keyFile}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify({format:'dpapi-current-user-v1', data:ciphertext}), {mode:0o600, flag:'wx'});
    fs.renameSync(tmp, keyFile);
  } finally {
    try {fs.unlinkSync(tmp);} catch(e:any) {if(e?.code !== 'ENOENT') throw e;}
  }
}
export function readOpenAIKey(): string {
  // Settings-provided key must win over an old environment credential.
  if (fs.existsSync(keyFile)) {
    const record = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
    if (record?.format !== 'dpapi-current-user-v1' || typeof record.data !== 'string')
      throw new Error('Saved OpenAI key format is invalid. Re-save the OpenAI key.');
    return dpapi('unprotect', record.data);
  }
  return process.env.OPENAI_API_KEY?.trim() || '';
}
export function hasOpenAIKey(): boolean {try {return !!readOpenAIKey();} catch {return false;}}
export function clearOpenAIKey(): void {try {fs.unlinkSync(keyFile);} catch(e:any) {if(e?.code !== 'ENOENT') throw e;}}
const openAICrypto = (operation: 'protect'|'unprotect', value: string) => dpapi(operation, value);
export function readOpenAIKeys(): string[] { return [readOpenAIKey(), ...readEncryptedKeyPool('openai', openAICrypto), ...(process.env.OPENAI_API_KEYS || '').split(/[\r\n,;]+/g)].map(value => value.trim()).filter(Boolean).filter((value,index,all)=>all.indexOf(value)===index).slice(0,20); }
export function saveOpenAIFailoverKey(value: string): number { return saveEncryptedKeyToPool('openai', value, openAICrypto); }
export function clearOpenAIFailoverKeys(): void { clearEncryptedKeyPool('openai'); }
export function openAIFailoverKeyCount(): number { return encryptedKeyPoolCount('openai', openAICrypto); }

/** OpenAI's official endpoint expects the bare model ID, not provider/model. */
export function normalizeOpenAIModel(value: string): string {
  return value.trim().replace(/^openai\//i, '');
}

export function createOpenAIProvider(settings:()=>QuillixSettings): UniversalProvider {
  return new UniversalProvider(
    () => {
      const s = settings();
      const effectiveInterval = getEffectiveProviderIntervalMs({ turboSpeedMode: s.turboSpeedMode, performanceMode: s.performanceMode, overdriveMode: s.overdriveMode });
      return {
        protocol: 'responses',
        endpoint: OPENAI_API_ENDPOINT,
        model: normalizeOpenAIModel(s.openaiModel || 'gpt-6-astra'),
        offlineMode: s.offlineMode,
        requestBudget: { minRequestIntervalMs: effectiveInterval, maxConcurrentRequests: getEffectiveProviderConcurrency({ turboSpeedMode: s.turboSpeedMode, performanceMode: s.performanceMode, overdriveMode: s.overdriveMode }) },
        overdriveMode: s.overdriveMode === true,
        promptCache: s.promptCache === true,
      };
    },
    () => readOpenAIKeys(),
  );
}
