import type { QuillixSettings } from '../shared/types.js';
import type { AIProvider } from './qwen.js';

/**
 * The stable contract between NUVRO AI's body (agent/tools) and a brain
 * (Ollama, a cloud adapter, or a future provider plugin). The agent only needs
 * an AIProvider; the descriptor lets the UI and router reason about the
 * brain's capabilities without guessing from its name.
 */
export type BrainMode = 'offline' | 'online';

export interface BrainCapabilities {
  tools: boolean;
  streaming: boolean;
  reasoning: boolean;
}

export interface BrainDescriptor {
  id: string;
  label: string;
  mode: BrainMode;
  capabilities: BrainCapabilities;
}

export interface BrainDefinition extends BrainDescriptor {
  create: (getSettings: () => QuillixSettings) => AIProvider | Promise<AIProvider>;
}

const BRAIN_ID = /^[a-z][a-z0-9-]{0,47}$/;

function validateDefinition(definition: BrainDefinition): BrainDefinition {
  if (!definition || !BRAIN_ID.test(definition.id)) {
    throw new Error('Brain IDs must start with a lowercase letter and contain only lowercase letters, numbers, or hyphens.');
  }
  if (!definition.label.trim() || definition.label.length > 100) throw new Error('Brain label must be non-empty and at most 100 characters.');
  for (const key of ['tools', 'streaming', 'reasoning'] as const) {
    if (typeof definition.capabilities?.[key] !== 'boolean') throw new Error('Brain capabilities must be boolean values.');
  }
  if (typeof definition.create !== 'function') throw new Error('Brain factory is required.');
  return {
    ...definition,
    label: definition.label.trim(),
    capabilities: { ...definition.capabilities },
  };
}

/** Registry used by the provider router and future brain plugins. */
export class BrainRegistry {
  private readonly definitions = new Map<string, BrainDefinition>();

  /** Register a brain and return an idempotent disposer for plugin unload. */
  public register(definition: BrainDefinition): () => boolean {
    const valid = validateDefinition(definition);
    if (this.definitions.has(valid.id)) throw new Error(`Brain '${valid.id}' is already registered.`);
    this.definitions.set(valid.id, valid);
    let disposed = false;
    return () => {
      if (disposed) return false;
      disposed = true;
      return this.unregister(valid.id);
    };
  }

  public unregister(id: string): boolean {
    return this.definitions.delete(id);
  }

  public has(id: string): boolean {
    return this.definitions.has(id);
  }

  public get(id: string): BrainDefinition | undefined {
    return this.definitions.get(id);
  }

  public list(): BrainDescriptor[] {
    return [...this.definitions.values()].map(({ create: _create, ...descriptor }) => ({
      ...descriptor,
      capabilities: { ...descriptor.capabilities },
    }));
  }

  public async create(id: string, getSettings: () => QuillixSettings): Promise<AIProvider> {
    const definition = this.definitions.get(id);
    if (!definition) throw new Error(`Brain '${id}' is not registered.`);
    if (definition.mode === 'online' && getSettings().offlineMode) {
      throw new Error(`Disable Offline Mode before using ${definition.label}.`);
    }
    return definition.create(getSettings);
  }
}
