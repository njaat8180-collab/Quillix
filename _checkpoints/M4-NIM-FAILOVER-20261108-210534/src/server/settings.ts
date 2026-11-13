import {validateProfiles} from './providerProfiles.js';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {randomUUID} from 'node:crypto';
import type { QuillixSettings, QuillixTheme, QuillixAnimationLevel } from '../shared/types.js';
import { DEFAULT_LOCAL_OLLAMA_MODEL } from '../shared/modelDefaults.js';
import { getProviderPreset, type ProviderPresetId } from '../shared/providerPresets.js';

export const SETTINGS_VERSION = 1;

/** Keeps the NVIDIA failover priority list safe, unique and bounded. */
function sanitizeNvidiaPriority(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const cleaned = value
    .filter((entry): entry is string => typeof entry === 'string')
    .map(entry => entry.trim())
    .filter(entry => !!entry && entry.length <= 200 && !/[\r\n]/.test(entry));
  return [...new Set(cleaned)].slice(0, 12);
}

export const DEFAULT_SETTINGS: QuillixSettings = {
  model: DEFAULT_LOCAL_OLLAMA_MODEL,
  aiProvider: 'ollama',
  openaiModel: 'gpt-6-astra',
  grokModel: 'grok-4',
  groqModel: 'openai/gpt-oss-120b',
  nvidiaModel: 'openai/gpt-oss-120b',
  nvidiaModelPriority: [],
  ollamaBaseUrl: 'http://localhost:11434',
  offlineMode: true,
  universalProtocol: 'openai',
  universalEndpoint: 'https://api.openai.com/v1',
  universalModel: '',
  universalPreset: 'custom-openai',
  maxAutonomousTurns: 16,
  temperature: 0.2,
  terminalApproval: true,
  autoApplyDiffs: true,
  gitApproval: true,
  theme: 'dark',
  animationLevel: 'full',
  turboSpeedMode: false,
  performanceMode: 'balanced',
  requestPacingMode: 'adaptive',
  version: SETTINGS_VERSION,
};

/**
 * Forward-migrate a parsed settings object from its stored schema version to the
 * current one (M9.1). Key = the version upgraded FROM; transforms `raw` in place.
 * Field-level invariants are also enforced by sanitize() on every load, so a
 * migration only reshapes fields for a genuinely newer known schema. Exercised by
 * src/server/__tests__/settingsMigration.test.ts.
 */
const SETTINGS_MIGRATIONS: Record<number, (raw: Record<string, unknown>) => void> = {};

export function migrateSettingsData(raw: Record<string, unknown>): { fromVersion: number; version: number } {
  const parsed = Number(raw && typeof raw === 'object' ? raw.version : undefined);
  const fromVersion = Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
  let version = fromVersion;
  while (version < SETTINGS_VERSION) {
    SETTINGS_MIGRATIONS[version]?.(raw);
    version += 1;
  }
  return { fromVersion, version: SETTINGS_VERSION };
}

const THEMES: QuillixTheme[] = ['light', 'dark', 'gray', 'gradient'];
const ANIMATION_LEVELS: QuillixAnimationLevel[] = ['full', 'minimal', 'off'];
const BRAIN_ID = /^[a-z][a-z0-9-]{0,47}$/;

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Persistent, validated runtime settings for Quillix.
 * Stored at ~/.quillix/settings.json so it survives restarts.
 */
export class SettingsStore {
  private settings: QuillixSettings;
  private readonly filePath: string;
  private readonly listeners: Array<(settings: QuillixSettings) => void> = [];

  constructor(filePath?: string) {
    this.filePath = filePath || process.env.QUILLIX_SETTINGS_PATH || path.join(os.homedir(), '.quillix', 'settings.json');
    this.settings = { ...DEFAULT_SETTINGS };
    this.load();
  }

  private load(): void {
    try {
      if (!fs.existsSync(this.filePath)) return;
      const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      if (raw && typeof raw === 'object') {
        migrateSettingsData(raw as Record<string, unknown>);
        this.settings = this.sanitize({ ...DEFAULT_SETTINGS, ...(raw as Partial<QuillixSettings>) });
      }
    } catch (err) {
      console.warn('Quillix: could not read settings file, using defaults.', err);
    }
  }

  private persist(): void {
    // Never report Save succeeded if settings were lost. Atomic replace also
    // avoids truncated JSON after an unexpected shutdown during writes.
    const tmp = `${this.filePath}.${randomUUID()}.tmp`;
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify(this.settings, null, 2), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      fs.renameSync(tmp, this.filePath);
    } catch {
      throw new Error('Could not save Quillix settings. Check your Windows profile and folder permissions.');
    } finally {
      try { fs.unlinkSync(tmp); } catch (err: any) { if (!['ENOENT','ENOTDIR'].includes(err?.code)) console.warn('Quillix: could not clean temporary settings file.'); }
    }
  }

  private sanitize(s: QuillixSettings): QuillixSettings {
    const universalPreset = typeof s.universalPreset === 'string' && ['custom-openai','nvidia-nim','deepseek'].includes(s.universalPreset)
      ? s.universalPreset as ProviderPresetId
      : DEFAULT_SETTINGS.universalPreset;
    const rawUniversalModel = typeof s.universalModel === 'string' ? s.universalModel.trim() : '';
    // Migrate the retired NVIDIA preset default on load so existing users do
    // not keep receiving HTTP 410 after upgrading Quillix.
    const universalModel = universalPreset === 'nvidia-nim' && rawUniversalModel === 'meta/llama-3.1-8b-instruct'
      ? getProviderPreset('nvidia-nim').defaultModel
      : rawUniversalModel;
    return {
      providerProfiles: s.providerProfiles ? validateProfiles(s.providerProfiles) : [],
      activeProviderProfile: s.activeProviderProfile,
      aiProvider: typeof s.aiProvider === 'string' && BRAIN_ID.test(s.aiProvider) ? s.aiProvider : 'ollama',
      openaiModel: typeof s.openaiModel === 'string' && s.openaiModel.trim() && s.openaiModel.length <= 200 ? s.openaiModel.trim() : DEFAULT_SETTINGS.openaiModel,
      grokModel: typeof s.grokModel==='string'&&s.grokModel.trim()&&s.grokModel.length<=200?s.grokModel.trim():DEFAULT_SETTINGS.grokModel,
      groqModel: typeof s.groqModel==='string'&&s.groqModel.trim()&&s.groqModel.length<=200?s.groqModel.trim():DEFAULT_SETTINGS.groqModel,
      nvidiaModel: typeof s.nvidiaModel==='string'&&s.nvidiaModel.trim()&&s.nvidiaModel.length<=200?s.nvidiaModel.trim():DEFAULT_SETTINGS.nvidiaModel,
      nvidiaModelPriority: sanitizeNvidiaPriority(s.nvidiaModelPriority),
      universalProtocol: ['openai','responses','anthropic','gemini'].includes(s.universalProtocol || '') ? s.universalProtocol : 'openai',
      universalEndpoint: typeof s.universalEndpoint === 'string' && s.universalEndpoint.trim() ? s.universalEndpoint.trim() : DEFAULT_SETTINGS.universalEndpoint,
      universalModel,
      universalPreset,
      model: typeof s.model === 'string' && s.model.trim() ? s.model.trim() : DEFAULT_SETTINGS.model,
      ollamaBaseUrl:
        typeof s.ollamaBaseUrl === 'string' && s.ollamaBaseUrl.trim()
          ? s.ollamaBaseUrl.trim().replace(/\/+$/, '')
          : DEFAULT_SETTINGS.ollamaBaseUrl,
      offlineMode: s.offlineMode !== false,
      maxAutonomousTurns: Math.round(clampNumber(s.maxAutonomousTurns, 1, 50, DEFAULT_SETTINGS.maxAutonomousTurns)),
      temperature: clampNumber(s.temperature, 0, 2, DEFAULT_SETTINGS.temperature),
      terminalApproval: s.terminalApproval !== false,
      autoApplyDiffs: s.autoApplyDiffs === true,
      gitApproval: s.gitApproval !== false,
      disabledCodingPlugins: Array.isArray(s.disabledCodingPlugins) ? s.disabledCodingPlugins.filter((id): id is string => typeof id === 'string' && /^quillix-[a-z-]{1,50}$/.test(id)).slice(0, 50) : [],
      theme: THEMES.includes(s.theme) ? s.theme : DEFAULT_SETTINGS.theme,
      animationLevel: ANIMATION_LEVELS.includes(s.animationLevel) ? s.animationLevel : DEFAULT_SETTINGS.animationLevel,
      workspaceRoot:
        typeof s.workspaceRoot === 'string' && s.workspaceRoot.trim()
          ? s.workspaceRoot.trim()
          : undefined,
      recentWorkspaces: Array.isArray(s.recentWorkspaces)
        ? s.recentWorkspaces
            .filter((p: unknown): p is string => typeof p === 'string' && p.trim().length > 0)
            .slice(0, 6)
        : [],
      turboSpeedMode: s.turboSpeedMode === true,
      performanceMode: ['eco','balanced','turbo'].includes(s.performanceMode || '') ? s.performanceMode : DEFAULT_SETTINGS.performanceMode,
      requestPacingMode: ['adaptive','fixed'].includes(s.requestPacingMode || '') ? s.requestPacingMode : DEFAULT_SETTINGS.requestPacingMode,
      version: SETTINGS_VERSION,
    };
  }

  public get(): QuillixSettings {
    return { ...this.settings };
  }

  public getDefault(key: keyof QuillixSettings): QuillixSettings[typeof key] {
    return DEFAULT_SETTINGS[key];
  }

  /**
   * Validates and applies a partial settings patch.
   * Returns the new settings on success or an error message on failure.
   */
  public update(patch: Partial<QuillixSettings>): { success: boolean; settings?: QuillixSettings; error?: string } {
    if (!patch || typeof patch !== 'object') {
      return { success: false, error: 'Invalid settings payload.' };
    }

    const next: QuillixSettings = { ...this.settings };

    if (patch.aiProvider !== undefined) {
      if (typeof patch.aiProvider !== 'string' || !BRAIN_ID.test(patch.aiProvider)) return { success: false, error: 'Invalid AI provider or brain ID.' };
      next.aiProvider = patch.aiProvider;
    }
    if (patch.grokModel !== undefined) {if(typeof patch.grokModel!=='string'||!patch.grokModel.trim()||patch.grokModel.length>200)return {success:false,error:'Enter a valid exact Grok model ID.'};next.grokModel=patch.grokModel.trim();}
    if (patch.groqModel !== undefined) {if(typeof patch.groqModel!=='string'||!patch.groqModel.trim()||patch.groqModel.length>200)return {success:false,error:'Enter a valid exact Groq model ID.'};next.groqModel=patch.groqModel.trim();}
    if (patch.nvidiaModel !== undefined) {if(typeof patch.nvidiaModel!=='string'||!patch.nvidiaModel.trim()||patch.nvidiaModel.length>200)return {success:false,error:'Enter a valid exact NVIDIA model ID.'};next.nvidiaModel=patch.nvidiaModel.trim();}
    if (patch.nvidiaModelPriority !== undefined) {
      if (!Array.isArray(patch.nvidiaModelPriority) || patch.nvidiaModelPriority.length > 12 || patch.nvidiaModelPriority.some(v => typeof v !== 'string' || !v.trim() || v.trim().length > 200 || /[\r\n]/.test(v)))
        return {success:false,error:'Enter up to 12 exact NVIDIA model IDs for the failover priority.'};
      next.nvidiaModelPriority = [...new Set(patch.nvidiaModelPriority.map(v => v.trim()))];
    }
    if (patch.openaiModel !== undefined) {
      if (typeof patch.openaiModel !== 'string' || !patch.openaiModel.trim() || patch.openaiModel.trim().length > 200 || /[\r\n]/.test(patch.openaiModel))
        return {success:false,error:'Enter a valid exact OpenAI model ID.'};
      next.openaiModel = patch.openaiModel.trim();
    }
    if (patch.universalProtocol !== undefined) {
      if (!['openai','responses','anthropic','gemini'].includes(patch.universalProtocol)) return {success:false,error:'Invalid universal API protocol.'};
      next.universalProtocol = patch.universalProtocol;
    }
    if (patch.universalPreset !== undefined) {
      if (!['custom-openai','nvidia-nim','deepseek'].includes(patch.universalPreset)) return {success:false,error:'Invalid provider preset.'};
      next.universalPreset = patch.universalPreset;
      const preset = getProviderPreset(patch.universalPreset);
      if (patch.universalEndpoint === undefined) next.universalEndpoint = preset.defaultEndpoint;
      if (patch.universalModel === undefined && !next.universalModel) next.universalModel = preset.defaultModel;
      next.universalProtocol = preset.protocol;
    }
    if (patch.universalModel !== undefined) {
      if (typeof patch.universalModel !== 'string' || patch.universalModel.trim().length > 200) return {success:false,error:'Invalid model name.'};
      next.universalModel = patch.universalModel.trim();
    }
    if (patch.universalEndpoint !== undefined) {
      if (typeof patch.universalEndpoint !== 'string') return {success:false,error:'Invalid API URL.'};
      next.universalEndpoint = patch.universalEndpoint.trim();
    }
    if (patch.universalEndpoint !== undefined || patch.universalProtocol !== undefined || patch.aiProvider === 'universal') {
      try {
        const u = new URL(next.universalEndpoint || '');
        if (u.username || u.password || u.hash || u.search || !(u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(u.hostname)))) throw new Error();
        next.universalEndpoint = u.toString().replace(/\/+$/,'');
      } catch {return {success:false,error:'Use an HTTPS API endpoint (or localhost HTTP), without query credentials.'};}
    }
    if (patch.model !== undefined) {
      if (typeof patch.model !== 'string' || !patch.model.trim()) {
        return { success: false, error: 'Model name must be a non-empty string.' };
      }
      next.model = patch.model.trim();
    }

    if (patch.ollamaBaseUrl !== undefined) {
      if (typeof patch.ollamaBaseUrl !== 'string' || !patch.ollamaBaseUrl.trim()) {
        return { success: false, error: 'Ollama URL must be a non-empty string.' };
      }
      let parsed: URL;
      try {
        parsed = new URL(patch.ollamaBaseUrl.trim());
      } catch {
        return { success: false, error: 'Invalid Ollama URL. Use e.g. http://localhost:11434.' };
      }
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return { success: false, error: 'Ollama URL must use HTTP or HTTPS.' };
      }
      const host = parsed.hostname.toLowerCase();
      const isLoopback = host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
      // Offline Mode (default ON) only ever permits loopback addresses.
      const offline = patch.offlineMode !== undefined ? patch.offlineMode !== false : next.offlineMode;
      if (offline && !isLoopback) {
        return {
          success: false,
          error: 'Offline Mode is ON: Ollama URL must be a localhost address (localhost, 127.0.0.1, or ::1).',
        };
      }
      next.ollamaBaseUrl = patch.ollamaBaseUrl.trim().replace(/\/+$/, '');
    }

    if (patch.offlineMode !== undefined) next.offlineMode = patch.offlineMode !== false;
    if (patch.maxAutonomousTurns !== undefined) {
      next.maxAutonomousTurns = Math.round(clampNumber(patch.maxAutonomousTurns, 1, 50, this.settings.maxAutonomousTurns));
    }
    if (patch.temperature !== undefined) {
      next.temperature = clampNumber(patch.temperature, 0, 2, this.settings.temperature);
    }
    if (patch.terminalApproval !== undefined) next.terminalApproval = patch.terminalApproval !== false;
    if (patch.autoApplyDiffs !== undefined) next.autoApplyDiffs = patch.autoApplyDiffs === true;
    if (patch.gitApproval !== undefined) next.gitApproval = patch.gitApproval !== false;
    if (patch.disabledCodingPlugins !== undefined) {
      if (!Array.isArray(patch.disabledCodingPlugins) || patch.disabledCodingPlugins.length > 50 || patch.disabledCodingPlugins.some(id => typeof id !== 'string' || !/^quillix-[a-z-]{1,50}$/.test(id))) {
        return { success: false, error: 'Invalid disabled coding plugin IDs.' };
      }
      next.disabledCodingPlugins = [...new Set(patch.disabledCodingPlugins)];
    }
    if (patch.theme !== undefined) {
      if (!THEMES.includes(patch.theme)) {
        return { success: false, error: 'Theme must be one of: light, dark, gray, gradient.' };
      }
      next.theme = patch.theme;
    }
    if (patch.animationLevel !== undefined) {
      if (!ANIMATION_LEVELS.includes(patch.animationLevel)) {
        return { success: false, error: 'Animation level must be one of: full, minimal, off.' };
      }
      next.animationLevel = patch.animationLevel;
    }
    if (patch.workspaceRoot !== undefined) {
      // Empty/undefined clears the persisted workspace; otherwise it must be
      // an existing directory (validated by the caller before persisting).
      next.workspaceRoot =
        typeof patch.workspaceRoot === 'string' && patch.workspaceRoot.trim()
          ? patch.workspaceRoot.trim()
          : undefined;
    }
    if (patch.recentWorkspaces !== undefined) {
      next.recentWorkspaces = Array.isArray(patch.recentWorkspaces)
        ? patch.recentWorkspaces
            .filter((p) => typeof p === 'string' && p.trim().length > 0)
            .slice(0, 6)
        : [];
    }
    if (patch.turboSpeedMode !== undefined) next.turboSpeedMode = patch.turboSpeedMode === true;
    if (patch.performanceMode !== undefined) {
      if (!['eco','balanced','turbo'].includes(patch.performanceMode)) return {success:false,error:'Invalid performance mode.'};
      next.performanceMode = patch.performanceMode;
    }
    if (patch.requestPacingMode !== undefined) {
      if (!['adaptive','fixed'].includes(patch.requestPacingMode)) return {success:false,error:'Invalid request pacing mode.'};
      next.requestPacingMode = patch.requestPacingMode;
    }

    // Validate the *final* settings combination, not just URL edits. Without this
    // check switching offlineMode on while a remote URL is already saved leaves
    // offline mode pointing at a non-local provider.
    if (next.offlineMode) {
      let address: URL;
      try {
        address = new URL(next.ollamaBaseUrl);
      } catch {
        return { success: false, error: 'Invalid Ollama URL.' };
      }
      const hostname = address.hostname.toLowerCase();
      const loopback = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
      if (!loopback || !['http:', 'https:'].includes(address.protocol)) {
        return { success: false, error: 'Cannot enable Offline Mode while Ollama uses a remote URL. Set Ollama URL to localhost first.' };
      }
    }

    try {
      if(patch.providerProfiles!==undefined) next.providerProfiles=validateProfiles(patch.providerProfiles);
      if(patch.activeProviderProfile!==undefined) next.activeProviderProfile=patch.activeProviderProfile;
      if(next.activeProviderProfile && !next.providerProfiles?.some(p=>p.id===next.activeProviderProfile)) throw new Error('Unknown provider profile.');
    } catch(e:any) {return {success:false,error:e.message};}
    const previous = this.settings;
    this.settings = next;
    try { this.persist(); }
    catch (err: any) {
      this.settings = previous;
      return { success: false, error: String(err?.message || 'Could not save settings.') };
    }
    this.emit();
    return { success: true, settings: this.get() };
  }

  private emit(): void {
    const snapshot = this.get();
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch {
        // listener errors must not break the store
      }
    }
  }

  public onChange(listener: (settings: QuillixSettings) => void): void {
    this.listeners.push(listener);
  }
}
