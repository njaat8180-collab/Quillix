import { describe, expect, it } from 'vitest';
import { BrainRegistry } from '../brainRegistry.js';
import type { AIProvider } from '../qwen.js';
import type { QuillixSettings } from '../../shared/types.js';

const fakeBrain = {} as AIProvider;
const settings = (offlineMode: boolean): QuillixSettings => ({
  model: 'local', ollamaBaseUrl: 'http://localhost:11434', offlineMode,
  maxAutonomousTurns: 4, temperature: 0.2, terminalApproval: true,
  autoApplyDiffs: true, gitApproval: true, promptCache: true, branchPerTask: true, taskBranchPrefix: 'nuvro', theme: 'dark', animationLevel: 'full',
});

describe('BrainRegistry', () => {
  it('keeps provider metadata separate from the AIProvider implementation', async () => {
    const registry = new BrainRegistry();
    registry.register({ id: 'test-local', label: 'Test Local', mode: 'offline', capabilities: { tools: true, streaming: false, reasoning: false }, create: () => fakeBrain });
    expect(registry.list()).toEqual([{ id: 'test-local', label: 'Test Local', mode: 'offline', capabilities: { tools: true, streaming: false, reasoning: false } }]);
    await expect(registry.create('test-local', () => settings(true))).resolves.toBe(fakeBrain);
  });

  it('blocks online brains before their factory can perform network work', async () => {
    const registry = new BrainRegistry();
    let created = false;
    registry.register({ id: 'test-cloud', label: 'Test Cloud', mode: 'online', capabilities: { tools: true, streaming: true, reasoning: true }, create: () => { created = true; return fakeBrain; } });
    await expect(registry.create('test-cloud', () => settings(true))).rejects.toThrow(/Offline Mode/);
    expect(created).toBe(false);
    await expect(registry.create('test-cloud', () => settings(false))).resolves.toBe(fakeBrain);
  });

  it('rejects invalid and duplicate brain registrations', () => {
    const registry = new BrainRegistry();
    const definition = { id: 'test', label: 'Test', mode: 'offline' as const, capabilities: { tools: false, streaming: false, reasoning: false }, create: () => fakeBrain };
    expect(() => registry.register({ ...definition, id: 'Bad ID' })).toThrow(/Brain IDs/);
    registry.register(definition);
    expect(() => registry.register(definition)).toThrow(/already registered/);
  });

  it('returns an idempotent disposer for hot-unloading plugin brains', () => {
    const registry = new BrainRegistry();
    const dispose = registry.register({
      id: 'temporary-brain', label: 'Temporary Brain', mode: 'offline',
      capabilities: { tools: true, streaming: true, reasoning: false }, create: () => fakeBrain,
    });
    expect(registry.has('temporary-brain')).toBe(true);
    expect(dispose()).toBe(true);
    expect(registry.has('temporary-brain')).toBe(false);
    expect(dispose()).toBe(false);
    expect(registry.unregister('temporary-brain')).toBe(false);
  });
});
