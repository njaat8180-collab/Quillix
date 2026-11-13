import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { SettingsStore, DEFAULT_SETTINGS } from '../settings.js';

// Animation level setting (Settings → Appearance → Motion): the persisted
// value must round-trip, invalid values must fall back to the default, and
// legacy settings files must upgrade to "full" without losing anything.
const dirs: string[] = [];
const makeDir = () => {
  const dir = fs.mkdtempSync(path.join(process.cwd(), '.test-tmp-animation-level-'));
  dirs.push(dir);
  return dir;
};
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

describe('animation level setting', () => {
  it('defaults to the full animation experience', () => {
    expect(DEFAULT_SETTINGS.animationLevel).toBe('full');
  });

  it('round-trips every level through update() and persistence', () => {
    const file = path.join(makeDir(), 'settings.json');
    const store = new SettingsStore(file);

    for (const level of ['full', 'minimal', 'off'] as const) {
      const res = store.update({ animationLevel: level });
      expect(res.success).toBe(true);
      expect(res.settings?.animationLevel).toBe(level);
      const persisted = JSON.parse(fs.readFileSync(file, 'utf8'));
      expect(persisted.animationLevel).toBe(level);
      expect(new SettingsStore(file).get().animationLevel).toBe(level);
    }
  });

  it('rejects an unknown level without changing the stored value', () => {
    const file = path.join(makeDir(), 'settings.json');
    const store = new SettingsStore(file);
    store.update({ animationLevel: 'minimal' });

    const res = store.update({ animationLevel: 'spinning' as never });

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/animation level/i);
    expect(store.get().animationLevel).toBe('minimal');
  });

  it('upgrades a legacy settings file that has no animationLevel', () => {
    const file = path.join(makeDir(), 'settings.json');
    fs.writeFileSync(file, JSON.stringify({ theme: 'gray', animationLevel: 'off' }));

    expect(new SettingsStore(file).get().animationLevel).toBe('off');
  });

  it('sanitizes a corrupt stored level back to the default', () => {
    const file = path.join(makeDir(), 'settings.json');
    fs.writeFileSync(file, JSON.stringify({ animationLevel: 'everywhere' }));

    expect(new SettingsStore(file).get().animationLevel).toBe('full');
  });
});
