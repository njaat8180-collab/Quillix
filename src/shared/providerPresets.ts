/**
 * Safe, non-secret presets for providers that expose an OpenAI-compatible API.
 * Presets only fill form defaults; selecting one never performs network I/O.
 */
export type ProviderPresetId = 'custom-openai' | 'nvidia-nim' | 'deepseek';

export type ProviderPreset = {
  id: ProviderPresetId;
  label: string;
  description: string;
  protocol: 'openai';
  defaultEndpoint: string;
  defaultModel: string;
  authHeader: 'Authorization';
  docsUrl: string;
};

export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  {
    id: 'custom-openai',
    label: 'Custom OpenAI-compatible',
    description: 'Bring your own compatible gateway or self-hosted endpoint.',
    protocol: 'openai',
    defaultEndpoint: 'https://api.example.com/v1',
    defaultModel: '',
    authHeader: 'Authorization',
    docsUrl: '',
  },
  {
    id: 'nvidia-nim',
    label: 'NVIDIA NIM',
    description: 'NVIDIA hosted NIM API catalog; model IDs are editable.',
    protocol: 'openai',
    defaultEndpoint: 'https://integrate.api.nvidia.com/v1',
    // NVIDIA's current hosted catalog documents this tool-capable model;
    // older Llama IDs can return HTTP 410 when retired from an account.
    defaultModel: 'openai/gpt-oss-120b',
    authHeader: 'Authorization',
    docsUrl: 'https://docs.api.nvidia.com/nim/docs/api-quickstart',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    description: 'DeepSeek OpenAI-compatible API; model IDs are editable.',
    protocol: 'openai',
    defaultEndpoint: 'https://api.deepseek.com',
    defaultModel: 'deepseek-flash',
    authHeader: 'Authorization',
    docsUrl: 'https://api-docs.deepseek.com/guides/search_fetch',
  },
];

export function getProviderPreset(id: string | undefined): ProviderPreset {
  return PROVIDER_PRESETS.find(preset => preset.id === id) || PROVIDER_PRESETS[0];
}

export function presetForEndpoint(endpoint: string | undefined): ProviderPresetId {
  const normalized = normalizeProviderEndpoint(endpoint || '');
  return PROVIDER_PRESETS.find(preset => preset.id !== 'custom-openai' && normalizeProviderEndpoint(preset.defaultEndpoint) === normalized)?.id || 'custom-openai';
}

export function normalizeProviderEndpoint(endpoint: string): string {
  return endpoint.trim().replace(/\/+$/, '');
}

/** A display-only hint. The encrypted store never uses this value. */
export function maskProviderKey(value: string): string {
  const key = value.trim();
  if (!key) return '';
  return key.length <= 4 ? '••••' : `••••${key.slice(-4)}`;
}
