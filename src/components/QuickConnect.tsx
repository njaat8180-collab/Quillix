import React, { useEffect, useState } from 'react';
import { CheckCircle2, CircleAlert, Cloud, Cpu, KeyRound, LoaderCircle, LockKeyhole, PlugZap, Sparkles } from 'lucide-react';
import { QuillixSettings } from '../shared/types.js';
import { DEFAULT_LOCAL_OLLAMA_MODEL } from '../shared/modelDefaults.js';
import { api } from '../services/apiBridge.js';
import { getProviderPreset, maskProviderKey, presetForEndpoint, PROVIDER_PRESETS, type ProviderPresetId } from '../shared/providerPresets.js';

type Provider = string;
type Protocol = 'openai' | 'responses' | 'anthropic' | 'gemini';
type Status = 'idle' | 'working' | 'success' | 'error';

const endpoints: Record<Protocol, string> = {
  openai: 'https://api.openai.com/v1',
  responses: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
};

async function checkResponse(response: Response): Promise<any> {
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.success) {
    throw new Error(typeof data?.error === 'string' ? data.error : `Request failed (HTTP ${response.status}).`);
  }
  return data;
}

/** Home-screen provider configuration. Never persists secrets in browser settings/localStorage. */
export const QuickConnect: React.FC<{
  settings: QuillixSettings | null;
  onSettingsChanged: (next: QuillixSettings) => void;
  onConnectionChange: (provider: string, status: 'untested' | 'checking' | 'connected' | 'failed') => void;
  onRefreshOllama: () => Promise<void> | void;
}> = ({ settings, onSettingsChanged, onConnectionChange, onRefreshOllama }) => {
  const [provider, setProvider] = useState<Provider>(settings?.aiProvider || 'ollama');
  const [protocol, setProtocol] = useState<Protocol>(settings?.universalProtocol || 'openai');
  const [endpoint, setEndpoint] = useState(settings?.universalEndpoint || endpoints.openai);
  const [model, setModel] = useState(settings?.universalModel || '');
  const [preset, setPreset] = useState<ProviderPresetId>(settings?.universalPreset || presetForEndpoint(settings?.universalEndpoint));
  const [openaiModel,setOpenAIModel]=useState(settings?.openaiModel || 'gpt-6-astra');
  const [grokModel,setGrokModel]=useState(settings?.grokModel || 'grok-4');
  const [groqModel,setGroqModel]=useState(settings?.groqModel || 'openai/gpt-oss-120b');
  const [nvidiaModel,setNvidiaModel]=useState(settings?.nvidiaModel || 'openai/gpt-oss-120b');
  const [ollamaModel, setOllamaModel] = useState(settings?.model || DEFAULT_LOCAL_OLLAMA_MODEL);
  const [key, setKey] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('Select a provider, then connect.');

  useEffect(() => {
    if (!settings) return;
    setProvider(settings.aiProvider || 'ollama');
    setProtocol(settings.universalProtocol || 'openai');
    setEndpoint(settings.universalEndpoint || endpoints.openai);
    setModel(settings.universalModel || '');
    setPreset(settings.universalPreset || presetForEndpoint(settings.universalEndpoint));
    setOpenAIModel(settings.openaiModel || 'gpt-6-astra');
    setGrokModel(settings.grokModel || 'grok-4');
    setGroqModel(settings.groqModel || 'openai/gpt-oss-120b');
    setNvidiaModel(settings.nvidiaModel || 'openai/gpt-oss-120b');
    setOllamaModel(settings.model || DEFAULT_LOCAL_OLLAMA_MODEL);
  }, [settings?.aiProvider, settings?.universalProtocol, settings?.universalEndpoint, settings?.universalModel, settings?.universalPreset, settings?.openaiModel, settings?.grokModel, settings?.groqModel, settings?.nvidiaModel, settings?.model]);

  const applyPreset = (id: ProviderPresetId) => {
    const selected = getProviderPreset(id);
    setPreset(id);
    setProtocol(selected.protocol);
    setEndpoint(selected.defaultEndpoint);
    setModel(selected.defaultModel);
    setStatus('idle');
    onConnectionChange('universal', 'untested');
    setMessage(id === 'custom-openai' ? 'Enter your compatible endpoint and exact model ID.' : `${selected.label} defaults loaded. Enter your model/key, then press Connect.`);
  };

  const switchProvider = (value: Provider) => {
    setProvider(value);
    setKey('');
    setStatus('idle');
    if (value !== 'ollama') onConnectionChange(value, 'untested');
    setMessage(value === 'ollama' ? 'Check your locally running model.' : 'The key stays encrypted under your Windows account.');
  };

  const connect = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!settings || status === 'working') return;
    setStatus('working');
    setMessage('Saving configuration and checking the provider…');
    if (provider !== 'ollama') onConnectionChange(provider, 'checking');
    let saved = false;
    try {
      if (provider === 'ollama') {
        const result = await api.updateSettings({aiProvider:'ollama',model:ollamaModel.trim()});
        if (!result.success || !result.settings) throw new Error(result.error || 'Could not save Ollama settings.');
        saved = true;
        onSettingsChanged(result.settings);
        const check = await api.getOllamaStatus(ollamaModel.trim());
        if (!check.success || !check.status?.connected || !check.status?.modelAvailable) {
          throw new Error(check.status?.details || check.error || 'Ollama model unavailable. Is Ollama running?');
        }
        await onRefreshOllama();
        setMessage(`${check.status.model || ollamaModel} is available locally. Ready for coding.`);
      } else {
        const existingKey = provider === 'sarvam' ? settings.sarvamKeyConfigured : provider === 'openai' ? settings.openaiKeyConfigured : provider === 'groq' ? settings.groqKeyConfigured : provider === 'grok' ? settings.grokKeyConfigured : provider === 'nvidia' ? settings.nvidiaKeyConfigured : settings.universalKeyConfigured;
        const matchesSavedProvider = provider === 'sarvam' || provider === 'openai' || provider === 'groq' || provider === 'grok' || provider === 'nvidia' ||
          (protocol === settings.universalProtocol && endpoint.trim().replace(/\/+$/, '') === (settings.universalEndpoint || '').replace(/\/+$/, ''));
        if (!key.trim() && (!existingKey || !matchesSavedProvider)) throw new Error('Enter an API key for this provider and endpoint first.');
        const result = await api.updateSettings(provider === 'sarvam'
          ? {aiProvider:'sarvam',offlineMode:false}
          : provider === 'openai' ? {aiProvider:'openai',offlineMode:false,openaiModel:openaiModel.trim()}
          : provider === 'groq' ? {aiProvider:'groq',offlineMode:false,groqModel:groqModel.trim()}
          : provider === 'grok' ? {aiProvider:'grok',offlineMode:false,grokModel:grokModel.trim()}
          : provider === 'nvidia' ? {aiProvider:'nvidia',offlineMode:false,nvidiaModel:nvidiaModel.trim()}
          : {aiProvider:'universal',activeProviderProfile:'',offlineMode:false,universalPreset:preset,universalProtocol:protocol,universalEndpoint:endpoint.trim(),universalModel:model.trim()});
        if (!result.success || !result.settings) throw new Error(result.error || 'Could not save provider settings.');
        saved = true;
        if (key.trim()) {
          const route = `/api/providers/${provider}/key`;
          await checkResponse(await fetch(route, {
            method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key}),
          }));
          setKey('');
        }
        const credentialIsForSelection = provider === 'sarvam' || provider === 'openai' || provider === 'groq' || provider === 'grok' || provider === 'nvidia' ||
          (protocol === settings.universalProtocol && endpoint.trim().replace(/\/+$/, '') === (settings.universalEndpoint || '').replace(/\/+$/, ''));
        const configured = !!key.trim() || (!!existingKey && credentialIsForSelection);
        onSettingsChanged({...result.settings, ...(provider === 'sarvam' ? {sarvamKeyConfigured:configured} : provider === 'openai' ? {openaiKeyConfigured:configured} : provider === 'groq' ? {groqKeyConfigured:configured} : provider === 'grok' ? {grokKeyConfigured:configured} : provider === 'nvidia' ? {nvidiaKeyConfigured:configured} : {universalKeyConfigured:configured})});
        const response = await checkResponse(await fetch(`/api/providers/${provider}/test`, {method:'POST'}));
        onConnectionChange(provider, 'connected');
        const keyHint = provider === 'universal' && key.trim() ? ` (${maskProviderKey(key)} stored encrypted)` : '';
        setMessage(`Verified ${response.model || (provider === 'sarvam' ? 'Sarvam' : provider === 'openai' ? openaiModel : provider === 'groq' ? groqModel : provider === 'grok' ? grokModel : provider === 'nvidia' ? nvidiaModel : model)}${keyHint}. Coding agent can use this provider.`);
      }
      setStatus('success');
    } catch (err: any) {
      if (provider !== 'ollama') onConnectionChange(provider, 'failed');
      setStatus('error');
      setMessage(`${saved ? 'Settings saved, but connection not verified. ' : ''}${err?.message || 'Could not connect.'}`);
    }
  };

  const isCloud = provider !== 'ollama';
  return (
    <section className="q-status-card rounded-[22px] mt-6 border border-[var(--border)] p-5 sm:p-6" aria-label="Connect AI provider from home">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 text-[11px] uppercase font-bold tracking-[0.15em] text-[var(--text-muted)]"><PlugZap size={15} /> QUICK CONNECT</div>
          <h2 className="mt-2 text-[18px] font-semibold text-[var(--text)]">Connect your coding model</h2>
          <p className="text-[12px] text-[var(--text-muted)] mt-1">Configure and verify AI directly from Home. No API key is stored in your browser.</p>
        </div>
        <span className="inline-flex gap-1.5 items-center text-[11px] text-[var(--text-muted)]"><LockKeyhole size={14} /> Encrypted key storage on Windows</span>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2 mt-4" role="group" aria-label="Choose AI provider">
        {([
          ['ollama', 'Ollama', 'Local AI', Cpu],
          ['sarvam', 'Sarvam AI', 'Dedicated cloud', Sparkles],
          ['openai', 'OpenAI / ChatGPT API', 'Dedicated GPT coding models', Sparkles],
          ['grok', 'Grok / xAI', 'xAI coding models', Sparkles],
          ['groq', 'Groq', 'Fast OpenAI-compatible models', Sparkles],
          ['universal', 'Universal API', 'OpenAI · Claude · Gemini · custom', Cloud],
          ['nvidia', 'NVIDIA NIM', 'Direct NVIDIA API · model + key', Sparkles],
        ] as const).map(([value,label,detail,Icon]) => (
          <button key={value} type="button" aria-pressed={provider === value} onClick={() => switchProvider(value)}
            className="q-provider-option rounded-xl border border-[var(--border)] p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
            style={provider === value ? {borderColor:'var(--accent)',background:'var(--surface-secondary)'} : undefined}>
            <span className="flex items-center gap-2 text-[13px] font-semibold"><Icon size={16} style={{color:'var(--accent)'}} /> {label}</span>
            <span className="text-[10px] text-[var(--text-muted)] mt-1 block leading-4">{detail}</span>
          </button>
        ))}
      </div>
      <form onSubmit={connect} className="grid sm:grid-cols-2 gap-3 mt-4">
        {provider === 'ollama' && <label className="sm:col-span-2 text-[12px] font-medium">Local model name
          <input className="q-settings-field mt-1 w-full rounded-xl border bg-[var(--input)] px-3 py-2.5 font-mono" value={ollamaModel} onChange={e=>{setOllamaModel(e.target.value);setStatus('idle');}} placeholder="qwen2.5-coder:3b" required />
        </label>}
        {provider === 'grok' && <label className="text-[12px] font-medium sm:col-span-2">Exact Grok model ID
          <input aria-label="Grok model name" className="q-settings-field mt-1 w-full rounded-xl border bg-[var(--input)] px-3 py-2.5 font-mono" value={grokModel} onChange={e=>{setGrokModel(e.target.value);setStatus('idle');onConnectionChange(provider,'untested');}} placeholder="grok-4" required />
        </label>}
        {provider === 'groq' && <label className="text-[12px] font-medium sm:col-span-2">Exact Groq model ID
          <input aria-label="Groq model name" className="q-settings-field mt-1 w-full rounded-xl border bg-[var(--input)] px-3 py-2.5 font-mono" value={groqModel} onChange={e=>{setGroqModel(e.target.value);setStatus('idle');onConnectionChange(provider,'untested');}} placeholder="openai/gpt-oss-120b" required />
        </label>}
        {provider === 'openai' && <label className="text-[12px] font-medium sm:col-span-2">Exact OpenAI model ID
          <input aria-label="OpenAI model name" className="q-settings-field mt-1 w-full rounded-xl border bg-[var(--input)] px-3 py-2.5 font-mono" value={openaiModel} onChange={e=>{setOpenAIModel(e.target.value);setStatus('idle');onConnectionChange('openai','untested');}} placeholder="gpt-6-astra" required />
          <span className="text-[11px] text-[var(--text-muted)]">Official https://api.openai.com/v1/responses · model access and API credits required.</span>
        </label>}
        {provider === 'nvidia' && <label className="text-[12px] font-medium sm:col-span-2">Exact NVIDIA model ID
          <input aria-label="NVIDIA model name" className="q-settings-field mt-1 w-full rounded-xl border bg-[var(--input)] px-3 py-2.5 font-mono" value={nvidiaModel} onChange={e=>{setNvidiaModel(e.target.value);setStatus('idle');onConnectionChange('nvidia','untested');}} placeholder="openai/gpt-oss-120b" required />
          <span className="text-[11px] text-[var(--text-muted)] mt-1 block">NVIDIA NIM endpoint is built in; only model ID and API key are required.</span>
        </label>}
        {provider === 'universal' && <>
          <label className="text-[12px] font-medium sm:col-span-2">Provider preset
            <select aria-label="Universal provider preset" value={preset} onChange={e=>applyPreset(e.target.value as ProviderPresetId)} className="q-settings-field mt-1 w-full rounded-xl border bg-[var(--input)] px-3 py-2.5">
              {PROVIDER_PRESETS.map(option=><option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
            <span className="text-[11px] text-[var(--text-muted)] mt-1 block">Preset fills safe defaults only; no network request runs until Save &amp; Connect.</span>
          </label>
          <label className="text-[12px] font-medium">API format
            <select value={protocol} onChange={e=>{const p=e.target.value as Protocol;setProtocol(p);setEndpoint(endpoints[p]);setStatus('idle');onConnectionChange('universal','untested');}} className="q-settings-field mt-1 w-full rounded-xl border bg-[var(--input)] px-3 py-2.5">
              <option value="openai">OpenAI-compatible Chat Completions</option><option value="responses">OpenAI Responses (reasoning models)</option><option value="anthropic">Anthropic / Claude</option><option value="gemini">Google Gemini</option>
            </select>
          </label>
          <label className="text-[12px] font-medium">Exact model ID
            <input className="q-settings-field mt-1 w-full rounded-xl border bg-[var(--input)] px-3 py-2.5 font-mono" value={model} onChange={e=>{setModel(e.target.value);setStatus('idle');onConnectionChange('universal','untested');}} placeholder="Your provider's model ID" required />
          </label>
          <label className="text-[12px] font-medium sm:col-span-2">API endpoint URL
            <input className="q-settings-field mt-1 w-full rounded-xl border bg-[var(--input)] px-3 py-2.5 font-mono" type="url" value={endpoint} onChange={e=>{setEndpoint(e.target.value);setStatus('idle');onConnectionChange('universal','untested');}} placeholder="https://api.example.com/v1" required />
          </label>
        </>}
        {isCloud && <label className="text-[12px] font-medium sm:col-span-2">{provider === 'sarvam' ? 'Sarvam AI key' : provider === 'openai' ? 'OpenAI API key' : provider === 'grok' ? 'Grok API key' : provider === 'groq' ? 'Groq API key' : provider === 'nvidia' ? 'NVIDIA API key' : 'Provider API key'}
          <div className="relative mt-1"><KeyRound size={14} className="absolute left-3 top-3 text-[var(--text-muted)]" /><input aria-label="API key" className="q-settings-field w-full rounded-xl border bg-[var(--input)] px-9 py-2.5" type="password" autoComplete="new-password" value={key} onChange={e=>{setKey(e.target.value);setStatus('idle');onConnectionChange(provider as 'sarvam'|'openai'|'grok'|'groq'|'nvidia'|'universal','untested');}} placeholder={provider === 'sarvam' ? (settings?.sarvamKeyConfigured ? 'Saved key — leave blank to reuse' : 'Paste your Sarvam API key') : provider === 'openai' ? (settings?.openaiKeyConfigured ? 'Saved OpenAI key — leave blank to reuse' : 'Paste your OpenAI API key') : provider === 'groq' ? (settings?.groqKeyConfigured ? 'Saved Groq key — leave blank to reuse' : 'Paste your Groq API key') : provider === 'grok' ? (settings?.grokKeyConfigured ? 'Saved Grok key — leave blank to reuse' : 'Paste your Grok API key') : provider === 'nvidia' ? (settings?.nvidiaKeyConfigured ? 'Saved NVIDIA key — leave blank to reuse' : 'Paste your NVIDIA API key') : (settings?.universalKeyConfigured ? 'Saved key — leave blank to reuse' : 'Paste your provider API key')} /></div>
        </label>}
        <div className="sm:col-span-2 flex flex-wrap items-center gap-3 justify-between">
          <button type="submit" disabled={!settings || status === 'working' || (provider === 'universal' && (!model.trim() || !endpoint.trim())) || (provider === 'openai' && !openaiModel.trim()) || (provider === 'grok' && !grokModel.trim()) || (provider === 'groq' && !groqModel.trim()) || (provider === 'nvidia' && !nvidiaModel.trim()) || (provider === 'ollama' && !ollamaModel.trim())}
            className="q-button-primary inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-[12px] font-semibold disabled:opacity-50">
            {status === 'working' ? <LoaderCircle size={15} className="animate-spin" /> : <PlugZap size={15} />}
            {status === 'working' ? 'Verifying…' : 'Save & Connect'}
          </button>
          <div role="status" aria-live="polite" className="flex flex-1 items-center gap-2 text-[11px] leading-5" style={{color:status==='success'?'var(--success)':status==='error'?'var(--danger)':'var(--text-muted)'}}>
            {status==='success'?<CheckCircle2 size={16} className="shrink-0" />:status==='error'?<CircleAlert size={16} className="shrink-0" />:null}
            <span>{message}</span>
          </div>
        </div>
      </form>
    </section>
  );
};
