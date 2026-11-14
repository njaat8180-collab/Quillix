import type { QuillixSettings } from './types.js';

export type ApiHealthTarget = {
  id: 'ollama' | 'sarvam' | 'openai' | 'grok' | 'groq' | 'nvidia' | 'universal' | 'tavily';
  label: string;
  configured: boolean;
};

/**
 * Health Center policy: show the currently selected coding brain and Tavily
 * freshness verification only. Other configured credentials stay out of the
 * active health list so a stale provider cannot appear “healthy” by accident.
 */
export function activeApiHealthTargets(settings: Pick<QuillixSettings,
  'aiProvider' | 'sarvamKeyConfigured' | 'openaiKeyConfigured' | 'grokKeyConfigured' |
  'groqKeyConfigured' | 'nvidiaKeyConfigured' | 'universalKeyConfigured' | 'universalProtocol' |
  'universalEndpoint' | 'tavilyKeyConfigured'>): ApiHealthTarget[] {
  const all: ApiHealthTarget[] = [
    { id: 'ollama', label: 'Ollama', configured: true },
    { id: 'sarvam', label: 'Sarvam AI', configured: !!settings.sarvamKeyConfigured },
    { id: 'openai', label: 'OpenAI', configured: !!settings.openaiKeyConfigured },
    { id: 'grok', label: 'Grok', configured: !!settings.grokKeyConfigured },
    { id: 'groq', label: 'Groq', configured: !!settings.groqKeyConfigured },
    { id: 'nvidia', label: 'NVIDIA NIM', configured: !!settings.nvidiaKeyConfigured },
    { id: 'universal', label: 'Universal API', configured: !!settings.universalKeyConfigured || (settings.universalProtocol === 'openai' && settings.universalEndpoint?.includes('localhost') === true) },
    { id: 'tavily', label: 'Tavily API · verification', configured: !!settings.tavilyKeyConfigured },
  ];
  const active = settings.aiProvider || 'ollama';
  return all.filter(target => target.id === active || target.id === 'tavily');
}
