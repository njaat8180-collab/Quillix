import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { encryptedKeyPoolPath, readEncryptedKeyPool, saveEncryptedKeyToPool, clearEncryptedKeyPool } from '../encryptedKeyPool.js';

describe('encrypted provider failover pool contract', () => {
  it('deduplicates and bounds keys without writing plaintext', () => {
    const root = fs.mkdtempSync(path.join(process.cwd(), '.test-tmp-key-pool-'));
    const originalHome = process.env.USERPROFILE;
    process.env.USERPROFILE = root;
    try {
      const crypto = (operation: 'protect' | 'unprotect', value: string) => operation === 'protect'
        ? `cipher:${Buffer.from(value, 'utf8').toString('base64')}`
        : Buffer.from(value.replace(/^cipher:/, ''), 'base64').toString('utf8');
      expect(saveEncryptedKeyToPool('contract', 'first-key', crypto)).toBe(1);
      expect(saveEncryptedKeyToPool('contract', 'first-key', crypto)).toBe(1);
      for (let index = 2; index <= 25; index += 1) saveEncryptedKeyToPool('contract', `key-${index}`, crypto);
      expect(readEncryptedKeyPool('contract', crypto)).toHaveLength(20);
      const raw = fs.readFileSync(encryptedKeyPoolPath('contract'), 'utf8');
      expect(raw).not.toContain('first-key');
      expect(raw).toContain('cipher:Zmlyc3Qta2V5');
      clearEncryptedKeyPool('contract');
      expect(fs.existsSync(encryptedKeyPoolPath('contract'))).toBe(false);
    } finally {
      if (originalHome === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = originalHome;
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
