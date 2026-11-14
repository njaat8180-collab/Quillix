import {afterEach,describe,expect,it,vi} from 'vitest';
import {getProviderPreset,maskProviderKey,normalizeProviderEndpoint,presetForEndpoint,PROVIDER_PRESETS} from '../../shared/providerPresets.js';
import {SettingsStore} from '../settings.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempFiles:string[]=[];
afterEach(()=>{vi.unstubAllGlobals();for(const file of tempFiles.splice(0)){try{fs.unlinkSync(file);}catch{}}});

describe('OpenAI-compatible provider presets',()=>{
  it('resolves NVIDIA NIM and DeepSeek defaults without secrets',()=>{
    const nvidia=getProviderPreset('nvidia-nim');
    const deepseek=getProviderPreset('deepseek');
    expect(nvidia.defaultEndpoint).toBe('https://integrate.api.nvidia.com/v1');
    expect(nvidia.defaultModel).toBe('openai/gpt-oss-120b');
    expect(deepseek.defaultEndpoint).toBe('https://api.deepseek.com');
    expect(deepseek.defaultModel).toBe('deepseek-flash');
    expect(nvidia.authHeader).toBe('Authorization');
    expect(JSON.stringify(PROVIDER_PRESETS)).not.toMatch(/api[_-]?key|secret|token/i);
  });

  it('normalizes endpoint slashes and recognizes preset endpoints',()=>{
    expect(normalizeProviderEndpoint(' https://api.deepseek.com/// ')).toBe('https://api.deepseek.com');
    expect(presetForEndpoint('https://integrate.api.nvidia.com/v1///')).toBe('nvidia-nim');
    expect(presetForEndpoint('https://other.example/v1')).toBe('custom-openai');
  });

  it('applies a preset server-side without making a network request',()=>{
    const file=path.join(process.cwd(),`.test-tmp-preset-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);tempFiles.push(file);
    const store=new SettingsStore(file);
    const result=store.update({aiProvider:'universal',universalPreset:'deepseek',offlineMode:false});
    expect(result.success, result.error).toBe(true);
    expect(result.settings?.universalEndpoint).toBe('https://api.deepseek.com');
    expect(result.settings?.universalModel).toBe('deepseek-flash');
    expect(result.settings?.universalPreset).toBe('deepseek');
  });

  it('migrates the retired NVIDIA model in existing settings',()=>{
    const file=path.join(os.tmpdir(),`quillix-nvidia-migration-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);tempFiles.push(file);
    fs.writeFileSync(file, JSON.stringify({aiProvider:'universal',offlineMode:false,universalPreset:'nvidia-nim',universalEndpoint:'https://integrate.api.nvidia.com/v1',universalModel:'meta/llama-3.1-8b-instruct'}));
    const store=new SettingsStore(file);
    expect(store.get().universalModel).toBe('openai/gpt-oss-120b');
  });

  it('masks credentials for display and never returns the raw value',()=>{
    expect(maskProviderKey('sk-test-1234')).toBe('••••1234');
    expect(maskProviderKey('abc')).toBe('••••');
    expect(maskProviderKey('sk-test-1234')).not.toContain('sk-test');
  });
});
