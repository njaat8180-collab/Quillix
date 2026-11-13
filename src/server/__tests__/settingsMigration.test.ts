import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { SettingsStore, SETTINGS_VERSION, migrateSettingsData } from '../settings.js';

// M9.1 — settings migration/versioning. Legacy (no-version) files must load,
// normalize, and gain the current version WITHOUT losing any known field;
// corrupt files must still fall back to defaults; a file written by a newer
// schema must not crash the app.
const dirs: string[] = [];
const makeDir = () => {
  const dir = fs.mkdtempSync(path.join(process.cwd(), '.test-tmp-settings-mig-'));
  dirs.push(dir);
  return dir;
};
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

describe('settings migration and versioning (M9.1)', () => {
  it('stamps the current version and preserves every known field from a legacy (no-version) file', () => {
    const dir = makeDir();
    const file = path.join(dir, 'settings.json');
    fs.writeFileSync(file, JSON.stringify({
      aiProvider: 'openai', openaiModel: 'gpt-6-astra', theme: 'gray',
      offlineMode: false, terminalApproval: false, autoApplyDiffs: true,
      turboSpeedMode: true, performanceMode: 'turbo', requestPacingMode: 'fixed',
      hasCompletedOnboarding: true,
      maxAutonomousTurns: 25, temperature: 0.7, workspaceRoot: dir, recentWorkspaces: [dir],
    }));

    const s = new SettingsStore(file).get();

    expect(s.version).toBe(SETTINGS_VERSION);
    expect(s.aiProvider).toBe('openai');
    expect(s.openaiModel).toBe('gpt-6-astra');
    expect(s.theme).toBe('gray');
    expect(s.offlineMode).toBe(false);
    expect(s.terminalApproval).toBe(false);
    expect(s.autoApplyDiffs).toBe(true);
    expect(s.turboSpeedMode).toBe(true);
    expect(s.performanceMode).toBe('turbo');
    expect(s.hasCompletedOnboarding).toBe(true);
    expect('requestPacingMode' in s).toBe(false);
    expect(s.maxAutonomousTurns).toBe(25);
    expect(s.temperature).toBeCloseTo(0.7);
    expect(s.workspaceRoot).toBe(dir);
    expect(s.recentWorkspaces).toEqual([dir]);
  });

  it('starts fresh installs with file changes staged for review', () => {
    const dir = makeDir();
    const settings = new SettingsStore(path.join(dir, 'settings.json')).get();
    expect(settings.autoApplyDiffs).toBe(false);
    expect(settings.terminalApproval).toBe(true);
    expect(settings.gitApproval).toBe(true);
  });

  it('persists onboarding completion across a reload', () => {
    const dir = makeDir();
    const file = path.join(dir, 'settings.json');
    const store = new SettingsStore(file);

    expect(store.get().hasCompletedOnboarding).toBe(false);
    expect(store.update({ hasCompletedOnboarding: true }).success).toBe(true);
    expect(new SettingsStore(file).get().hasCompletedOnboarding).toBe(true);
  });

  it('remaps the retired NVIDIA NIM default model on load so upgrades do not keep failing', () => {
    const dir = makeDir();
    const file = path.join(dir, 'settings.json');
    fs.writeFileSync(file, JSON.stringify({ universalPreset: 'nvidia-nim', universalModel: 'meta/llama-3.1-8b-instruct', offlineMode: false }));

    const s = new SettingsStore(file).get();

    expect(s.universalModel).not.toBe('meta/llama-3.1-8b-instruct');
    expect((s.universalModel || '').length).toBeGreaterThan(0);
    expect(s.version).toBe(SETTINGS_VERSION);
  });

  it('migrateSettingsData reports a legacy file as version 0 and returns the current version', () => {
    expect(migrateSettingsData({ aiProvider: 'openai' })).toEqual({ fromVersion: 0, version: SETTINGS_VERSION });
    expect(migrateSettingsData({ version: 0 }).fromVersion).toBe(0);
    expect(migrateSettingsData({ version: 12 }).fromVersion).toBe(12);
    expect(migrateSettingsData({ version: 999 }).version).toBe(SETTINGS_VERSION);
  });

  it('persists the version and round-trips it across reloads', () => {
    const dir = makeDir();
    const file = path.join(dir, 'settings.json');
    const store = new SettingsStore(file);
    const res = store.update({ turboSpeedMode: true });
    expect(res.success).toBe(true);
    const persisted = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(persisted.version).toBe(SETTINGS_VERSION);
    const reloaded = new SettingsStore(file).get();
    expect(reloaded.version).toBe(SETTINGS_VERSION);
    expect(reloaded.turboSpeedMode).toBe(true);
  });

  it('loads a settings file written by a newer schema without throwing and keeps known fields', () => {
    const dir = makeDir();
    const file = path.join(dir, 'settings.json');
    fs.writeFileSync(file, JSON.stringify({ version: 999, aiProvider: 'groq', groqModel: 'openai/gpt-oss-120b', theme: 'light' }));

    const s = new SettingsStore(file).get();

    expect(s.aiProvider).toBe('groq');
    expect(s.groqModel).toBe('openai/gpt-oss-120b');
    expect(s.theme).toBe('light');
    expect(s.version).toBe(SETTINGS_VERSION);
  });

  it('a corrupt settings file falls back to defaults (with version stamped) and does not crash', () => {
    const dir = makeDir();
    const file = path.join(dir, 'settings.json');
    fs.writeFileSync(file, '{ not valid json');

    const s = new SettingsStore(file).get();

    expect(s.aiProvider).toBe('ollama');
    expect(s.version).toBe(SETTINGS_VERSION);
  });
});
