import { describe, expect, it } from 'vitest';
import { activeApiHealthTargets } from '../../shared/apiHealth.js';

const base = {
  aiProvider: 'groq',
  sarvamKeyConfigured: true,
  openaiKeyConfigured: true,
  grokKeyConfigured: true,
  groqKeyConfigured: true,
  universalKeyConfigured: true,
  universalProtocol: 'openai' as const,
  universalEndpoint: 'https://api.example.test/v1',
  tavilyKeyConfigured: false,
};

describe('API Health Center target policy', () => {
  it('shows only the active coding provider and Tavily', () => {
    expect(activeApiHealthTargets(base).map(target => target.id)).toEqual(['groq', 'tavily']);
  });

  it('defaults to Ollama plus Tavily and preserves configured status', () => {
    const targets = activeApiHealthTargets({ ...base, aiProvider: undefined, tavilyKeyConfigured: true });
    expect(targets).toEqual([
      { id: 'ollama', label: 'Ollama', configured: true },
      { id: 'tavily', label: 'Tavily API · verification', configured: true },
    ]);
  });

  it('does not mark an unrelated localhost Universal endpoint as active', () => {
    const targets = activeApiHealthTargets({ ...base, aiProvider: 'openai', universalEndpoint: 'http://localhost:11434' });
    expect(targets.map(target => target.id)).toEqual(['openai', 'tavily']);
  });

  it('shows the dedicated NVIDIA target when NVIDIA is the active brain', () => {
    const targets = activeApiHealthTargets({ ...base, aiProvider: 'nvidia', nvidiaKeyConfigured: true });
    expect(targets).toEqual([
      { id: 'nvidia', label: 'NVIDIA NIM', configured: true },
      { id: 'tavily', label: 'Tavily API · verification', configured: false },
    ]);
  });
});
