import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const MAX_KEYS = 20;
const MAX_KEY_LENGTH = 4096;

export type KeyCrypto = (operation: 'protect' | 'unprotect', value: string) => string;

export function encryptedKeyPoolPath(provider: string): string {
  const safe = provider.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
  return path.join(os.homedir(), '.quillix', `${safe}-failover-keys.dpapi.json`);
}

function normalize(value: unknown): string {
  const key = typeof value === 'string' ? value.trim() : '';
  if (!key || key.length > MAX_KEY_LENGTH || /[\r\n]/.test(key)) throw new Error('Enter a valid failover API key.');
  return key;
}

export function readEncryptedKeyPool(provider: string, crypto: KeyCrypto): string[] {
  const file = encryptedKeyPoolPath(provider);
  if (!fs.existsSync(file)) return [];
  const record = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (record?.format !== 'dpapi-current-user-v1' || !Array.isArray(record.data)) {
    throw new Error(`Saved ${provider} failover key format is invalid. Re-save the backup keys.`);
  }
  const values: string[] = record.data
    .map((item: unknown) => crypto('unprotect', String(item)))
    .filter((value: unknown): value is string => typeof value === 'string' && value.length > 0);
  return [...new Set(values)].slice(0, MAX_KEYS);
}

export function saveEncryptedKeyToPool(provider: string, value: string, crypto: KeyCrypto): number {
  const key = normalize(value);
  const keys = [...readEncryptedKeyPool(provider, crypto), key].filter((candidate, index, all) => all.indexOf(candidate) === index).slice(0, MAX_KEYS);
  const encrypted = keys.map(candidate => crypto('protect', candidate));
  const file = encryptedKeyPoolPath(provider);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify({ format: 'dpapi-current-user-v1', data: encrypted }), { mode: 0o600, flag: 'wx' });
    fs.renameSync(tmp, file);
  } finally {
    try { fs.unlinkSync(tmp); } catch (error: any) { if (error?.code !== 'ENOENT') throw error; }
  }
  return keys.length;
}

export function clearEncryptedKeyPool(provider: string): void {
  try { fs.unlinkSync(encryptedKeyPoolPath(provider)); } catch (error: any) { if (error?.code !== 'ENOENT') throw error; }
}

export function encryptedKeyPoolCount(provider: string, crypto: KeyCrypto): number {
  try { return readEncryptedKeyPool(provider, crypto).length; } catch { return 0; }
}

export const encryptedKeyPoolLimit = MAX_KEYS;
