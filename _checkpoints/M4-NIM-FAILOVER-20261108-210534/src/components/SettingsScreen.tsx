import {ProviderProfiles} from './ProviderProfiles.js';
import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Cpu, Bot, Palette, CloudOff, Cloud, RefreshCw, ShieldCheck, Sparkles, KeyRound, Activity, CheckCircle2, XCircle, CircleHelp, Zap, Gauge, ArrowUpRight, Waves, Ban } from 'lucide-react';
import { api, type BrainCatalogResponse } from '../services/apiBridge.js';
import { QuillixSettings, QuillixTheme, QuillixAnimationLevel } from '../shared/types.js';
import { useTheme } from '../theme.js';
import { useAnimationLevel } from '../animations/preferences.js';
import { OllamaState } from './TopHeader.js';
import { getProviderPreset, maskProviderKey, presetForEndpoint, PROVIDER_PRESETS, type ProviderPresetId } from '../shared/providerPresets.js';
import { activeApiHealthTargets } from '../shared/apiHealth.js';
import { modalVariants, modalBackdropVariants, springEntranceVariants, cardHoverVariants, slideAndFadeVariants, staggerContainerFastVariants } from '../animations/index.js';
import { getEffectiveProviderIntervalMs, DEFAULT_ONLINE_PROVIDER_MIN_INTERVAL_MS } from '../shared/providerPacing.js';

interface SettingsScreenProps {
  isOpen: boolean;
  onClose: () => void;
  settings: QuillixSettings | null;
  onSettingsChanged: (settings: QuillixSettings) => void;
  ollama: OllamaState;
  onRefreshOllama: () => void;
  sarvamConnection: 'untested' | 'checking' | 'connected' | 'failed';
  onSarvamConnectionChange: (state: 'untested' | 'checking' | 'connected' | 'failed') => void;
  universalConnection: 'untested' | 'checking' | 'connected' | 'failed';
  openaiConnection: 'untested' | 'checking' | 'connected' | 'failed';
  grokConnection: 'untested' | 'checking' | 'connected' | 'failed';
  nvidiaConnection?: 'untested' | 'checking' | 'connected' | 'failed';
  onNvidiaConnectionChange: (state:'untested'|'checking'|'connected'|'failed') => void;
  onOpenAIConnectionChange: (state:'untested'|'checking'|'connected'|'failed') => void;
  onGrokConnectionChange: (state:'untested'|'checking'|'connected'|'failed') => void;
  onUniversalConnectionChange: (state: 'untested' | 'checking' | 'connected' | 'failed') => void;
}

type TestState = 'idle' | 'checking' | 'connected' | 'disconnected';
type ApiHealthStatus = 'idle' | 'checking' | 'connected' | 'failed' | 'not_configured' | 'blocked';
type ApiHealthRow = { label: string; status: ApiHealthStatus; latencyMs?: number; model?: string; error?: string; checkedAt?: string };

const THEMES: Array<{ id: QuillixTheme; label: string; preview: string[] }> = [
  { id: 'light', label: 'Light', preview: ['#ffffff', '#4f46e5', '#e2e6ee'] },
  { id: 'dark', label: 'Dark', preview: ['#0b0e14', '#6366f1', '#232a3a'] },
  { id: 'gray', label: 'Gray', preview: ['#1a1c1f', '#7a8494', '#383c42'] },
  { id: 'gradient', label: 'Gradient', preview: ['#0c0f1d', '#6d7cff', '#a855f7'] },
];

const ANIMATION_LEVELS: Array<{ id: QuillixAnimationLevel; label: string; hint: string; icon: React.ReactNode }> = [
  { id: 'full', label: 'Max', hint: 'Full motion, ambient effects', icon: <Sparkles size={15} /> },
  { id: 'minimal', label: 'Minimal', hint: 'Short fades only', icon: <Waves size={15} /> },
  { id: 'off', label: 'None', hint: 'No animation', icon: <Ban size={15} /> },
];

const FailoverKeyPanel: React.FC<{provider: 'openai'|'groq'|'grok'|'sarvam'|'nvidia'; label: string; count: number; settings: QuillixSettings; onSettingsChanged: (settings: QuillixSettings) => void}> = ({provider, label, count, settings, onSettingsChanged}) => {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const add = async () => { setBusy(true); setMessage(''); try { const r=await fetch(`/api/providers/${provider}/failover-key`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key})}); const d=await r.json(); if(!r.ok||!d.success) throw new Error(d.error||'Could not save backup key.'); setKey(''); onSettingsChanged({...settings, [`${provider}KeyPoolCount`]:Number(d.count)||0} as QuillixSettings); setMessage(`Backup key added. ${d.count} encrypted key${d.count === 1 ? '' : 's'} available.`); } catch (e:any) { setMessage(e?.message||'Could not save backup key.'); } finally { setBusy(false); } };
  const clear = async () => { setBusy(true); setMessage(''); try { const r=await fetch(`/api/providers/${provider}/failover-keys`,{method:'DELETE'}); const d=await r.json(); if(!r.ok||!d.success) throw new Error(d.error||'Could not remove backup keys.'); onSettingsChanged({...settings, [`${provider}KeyPoolCount`]:0} as QuillixSettings); setMessage('All encrypted backup keys removed.'); } catch (e:any) { setMessage(e?.message||'Could not remove backup keys.'); } finally { setBusy(false); } };
  return <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2.5 space-y-2">
    <div className="flex items-center justify-between gap-2"><span className="text-[11px] font-semibold">Optional {label} failover keys</span><span className="text-[10px] text-[var(--text-muted)]">{count} encrypted backup{count === 1 ? '' : 's'}</span></div>
    <p className="text-[10.5px] leading-relaxed text-[var(--text-muted)]">Only temporary rate-limit or upstream failures rotate to the next key. Invalid keys never rotate automatically. Keys are encrypted for this Windows account.</p>
    <div className="flex gap-2"><input aria-label={`${label} failover API key`} type="password" autoComplete="off" value={key} onChange={e=>setKey(e.target.value)} placeholder="Add another key for optional failover" className="q-settings-field min-w-0 flex-1 rounded-lg border bg-[var(--input)] px-2.5 py-1.5 text-[12px]" /><button type="button" className="q-button-outline rounded-lg px-2.5 py-1.5 text-[11px] disabled:opacity-50" disabled={busy||!key.trim()} onClick={add}>{busy?'Saving…':'Add key'}</button></div>
    {count > 0 && <button type="button" className="text-[10.5px] text-[var(--danger)] hover:underline disabled:opacity-50" disabled={busy} onClick={clear}>Remove backup keys</button>}
    {message && <p role="status" className="text-[10.5px] leading-relaxed" style={{color: /could not|failed|invalid|error/i.test(message) ? 'var(--danger)' : 'var(--success)'}}>{message}</p>}
  </div>;
};

export const SettingsScreen: React.FC<SettingsScreenProps> = ({
  isOpen,
  onClose,
  settings,
  onSettingsChanged,
  ollama,
  onRefreshOllama,
  sarvamConnection,
  onSarvamConnectionChange,
  universalConnection,
  onUniversalConnectionChange,
  openaiConnection,
  grokConnection,
  onNvidiaConnectionChange,
  onOpenAIConnectionChange,
  onGrokConnectionChange,
}) => {
  const { setTheme } = useTheme();
  const { setLevel: setAnimationLevel } = useAnimationLevel();
  const [testState, setTestState] = useState<TestState>('idle');
  const [testMessage, setTestMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [sarvamKey, setSarvamKey] = useState('');
  const [sarvamKeyError, setSarvamKeyError] = useState<string | null>(null);
  const [sarvamChecking, setSarvamChecking] = useState(false);
  const [openaiKey,setOpenAIKey]=useState('');
  const [openaiModel,setOpenAIModel]=useState(settings?.openaiModel || 'gpt-6-astra');
  const [openaiSaving,setOpenAISaving]=useState(false);
  const [openaiMessage,setOpenAIMessage]=useState('');
  const [grokKey,setGrokKey]=useState('');const [grokSaving,setGrokSaving]=useState(false);const [grokMessage,setGrokMessage]=useState('');
  const [grokModel,setGrokModel]=useState(settings?.grokModel || 'grok-4');
  const [groqKey,setGroqKey]=useState('');const [groqSaving,setGroqSaving]=useState(false);const [groqMessage,setGroqMessage]=useState('');
  const [groqModel,setGroqModel]=useState(settings?.groqModel || 'openai/gpt-oss-120b');
  const [nvidiaKey,setNvidiaKey]=useState('');const [nvidiaSaving,setNvidiaSaving]=useState(false);const [nvidiaMessage,setNvidiaMessage]=useState('');
  const [nvidiaModel,setNvidiaModel]=useState(settings?.nvidiaModel || 'openai/gpt-oss-120b');
  const [nimModels,setNimModels]=useState<Array<{id:string;contextLength?:number}>>([]);
  const [nimHealth,setNimHealth]=useState<{active?:string;models?:Array<{id:string;successes?:number;failures?:number;rateLimits?:number;cooldownUntil?:number}>;switches?:Array<{from:string;to:string;reason:string;at:number}>}|null>(null);
  const [nimPriorityText,setNimPriorityText]=useState((settings?.nvidiaModelPriority||[]).join(', '));
  const [nimCatalogMessage,setNimCatalogMessage]=useState('');
  const [nimLoading,setNimLoading]=useState(false);
  const [universalKey, setUniversalKey] = useState('');
  const [universalMessage, setUniversalMessage] = useState('');
  const [universalSaving, setUniversalSaving] = useState(false);
  const [failoverKey, setFailoverKey] = useState('');
  const [failoverSaving, setFailoverSaving] = useState(false);
  const [universalProtocol, setUniversalProtocol] = useState<'openai'|'responses'|'anthropic'|'gemini'>(settings?.universalProtocol || 'openai');
  const [universalUrl, setUniversalUrl] = useState(settings?.universalEndpoint || 'https://api.openai.com/v1');
  const [universalModel, setUniversalModel] = useState(settings?.universalModel || '');
  const [universalPreset, setUniversalPreset] = useState<ProviderPresetId>(settings?.universalPreset || presetForEndpoint(settings?.universalEndpoint));
  const [brainCatalog, setBrainCatalog] = useState<BrainCatalogResponse | null>(null);
  const [tavilyKey, setTavilyKey] = useState('');
  const [tavilySaving, setTavilySaving] = useState(false);
  const [tavilyQuery, setTavilyQuery] = useState('');
  const [tavilyAnswer, setTavilyAnswer] = useState('');
  const [tavilyResult, setTavilyResult] = useState<any>(null);
  const [tavilyUsage, setTavilyUsage] = useState<any>(null);
  const [tavilyHistory, setTavilyHistory] = useState<any[]>([]);
  const [apiHealth, setApiHealth] = useState<Record<string, ApiHealthRow>>({});
  const [apiHealthRunning, setApiHealthRunning] = useState(false);
  const [rateLimitStatus, setRateLimitStatus] = useState<{providerId:string; offline:boolean; minIntervalMs:number; queuedRequests:number; waitingMs:number} | null>(null);

  // Modal keyboard pattern (WCAG dialog): Escape closes, Tab cycles within the
  // dialog, focus moves in on open and is restored to the opener on close.
  // onClose is held in a ref so a parent re-render never re-triggers focus.
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => {
    if (!isOpen) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    const focusableItems = () => Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
      ) || []
    );
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusableItems();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (!active || !dialogRef.current?.contains(active)) {
        event.preventDefault();
        first.focus();
        return;
      }
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      previouslyFocused?.focus();
    };
  }, [isOpen]);

  // The settings are loaded asynchronously after the app starts. Refresh
  // the editable Universal form when persisted values arrive or panel opens.
  useEffect(() => {
    if (!isOpen || !settings) return;
    setUniversalProtocol(settings.universalProtocol || 'openai');
    setUniversalUrl(settings.universalEndpoint || 'https://api.openai.com/v1');
    setUniversalModel(settings.universalModel || '');
    setUniversalPreset(settings.universalPreset || presetForEndpoint(settings.universalEndpoint));
    setOpenAIModel(settings.openaiModel || 'gpt-6-astra');
    setGrokModel(settings.grokModel || 'grok-4');
    setGroqModel(settings.groqModel || 'openai/gpt-oss-120b');
    setNvidiaModel(settings.nvidiaModel || 'openai/gpt-oss-120b');
  }, [isOpen, settings?.universalProtocol, settings?.universalEndpoint, settings?.universalModel, settings?.universalPreset, settings?.openaiModel, settings?.grokModel, settings?.groqModel, settings?.nvidiaModel]);

  // A health result is evidence for a specific active brain and mode. Never
  // carry it across a provider/mode change where it could become misleading.
  useEffect(() => {
    if (isOpen) setApiHealth({});
  }, [isOpen, settings?.aiProvider, settings?.offlineMode, settings?.model, settings?.openaiModel, settings?.grokModel, settings?.groqModel, settings?.nvidiaModel, settings?.universalModel]);

  useEffect(() => {
    if (!isOpen) return;
    api.getBrainCatalog().then(setBrainCatalog).catch(() => setBrainCatalog(null));
    fetch('/api/verification/tavily/usage').then(response => response.json()).then(data => setTavilyUsage(data.usage || null)).catch(() => setTavilyUsage(null));
    fetch('/api/verification/tavily/history').then(response => response.json()).then(data => setTavilyHistory(Array.isArray(data.history) ? data.history : [])).catch(() => setTavilyHistory([]));
    const refreshRateLimit = () => fetch('/api/providers/rate-limit', { cache: 'no-store' }).then(response => response.json()).then(data => data?.success && setRateLimitStatus(data)).catch(() => setRateLimitStatus(null));
    refreshRateLimit();
    const timer = window.setInterval(refreshRateLimit, 1000);
    return () => window.clearInterval(timer);
  }, [isOpen]);

  const applyUniversalPreset = (id: ProviderPresetId) => {
    const preset = getProviderPreset(id);
    setUniversalPreset(id);
    setUniversalProtocol(preset.protocol);
    setUniversalUrl(preset.defaultEndpoint);
    setUniversalModel(preset.defaultModel);
    changeUniversalStatus('untested');
    setUniversalMessage(id === 'custom-openai' ? 'Enter your compatible endpoint and exact model ID.' : `${preset.label} defaults loaded. Press Save & Connect to test.`);
  };

  const changeUniversalStatus = (state: 'untested'|'checking'|'connected'|'failed') => {onUniversalConnectionChange(state);};
  // NIM dashboard: live catalog + per-model failover health for the active provider.
  useEffect(() => {
    if (!isOpen || settings?.aiProvider !== 'nvidia') return;
    let cancelled = false;
    const load = () => {
      fetch('/api/providers/nvidia/health', { cache: 'no-store' }).then(response => response.json()).then(data => { if (!cancelled && data?.success) setNimHealth(data); }).catch(() => {});
      fetch('/api/providers/nvidia/models', { cache: 'no-store' }).then(response => response.json()).then(data => { if (!cancelled && Array.isArray(data?.models)) setNimModels(data.models); }).catch(() => {});
    };
    load();
    const timer = window.setInterval(load, 5000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [isOpen, settings?.aiProvider]);
  useEffect(() => { setNimPriorityText((settings?.nvidiaModelPriority||[]).join(', ')); }, [settings?.nvidiaModelPriority]);
  const discoverNimModels = async () => {
    setNimLoading(true); setNimCatalogMessage('Discovering models from your NVIDIA account…');
    try {
      const response = await fetch('/api/providers/nvidia/models?refresh=1', { cache: 'no-store' });
      const data = await response.json();
      if (Array.isArray(data?.models)) setNimModels(data.models);
      setNimCatalogMessage(data?.error ? `Discovery failed: ${data.error}` : `${(data?.models||[]).length} model(s) available from your NVIDIA account.`);
    } catch (err: any) { setNimCatalogMessage(err?.message || 'Discovery failed.'); }
    finally { setNimLoading(false); }
  };
  const saveNimPriority = async () => {
    const ids = nimPriorityText.split(/[\n,]/).map(value => value.trim()).filter(Boolean);
    setNimSaving(true);
    try {
      const updated = await api.updateSettings({ nvidiaModelPriority: ids });
      if (!updated.success || !updated.settings) throw new Error(updated.error || 'Could not save the failover priority.');
      onSettingsChanged(updated.settings);
      setNimCatalogMessage(`Failover priority saved (${ids.length} model${ids.length === 1 ? '' : 's'}).`);
    } catch (err: any) { setNimCatalogMessage(err?.message || 'Could not save the failover priority.'); }
    finally { setNimSaving(false); }
  };
  const universalKeyMatchesSelection = settings?.universalKeyConfigured &&
    settings?.universalProtocol === universalProtocol &&
    (settings?.universalEndpoint || '').replace(/\/+$/, '') === universalUrl.trim().replace(/\/+$/, '');

  if (!isOpen || !settings) return null;

  const patch = async (update: Partial<QuillixSettings>) => {
    setError(null);
    setSaving(true);
    try {
      const res = await api.updateSettings(update);
      if (res.success && res.settings) {
        onSettingsChanged(res.settings);
        if (update.theme) setTheme(update.theme);
        if (update.animationLevel) setAnimationLevel(update.animationLevel);
        if (update.aiProvider || update.offlineMode !== undefined) {
          setApiHealth({});
          onSarvamConnectionChange('untested');
          onUniversalConnectionChange('untested');
          onOpenAIConnectionChange('untested');
          onGrokConnectionChange('untested');
          onNvidiaConnectionChange('untested');
          // Do not display a stale Ollama "Connected" message under Sarvam.
          setTestState('idle');
          setTestMessage('');
        }
      } else {
        setError(res.error || 'Could not save settings.');
      }
    } catch (err: any) {
      setError(err?.message || 'Could not save settings.');
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async () => {
    setTestState('checking');
    setTestMessage('Checking connection to local Ollama…');
    try {
      const res = await api.getOllamaStatus(settings.model.trim() || undefined);
      if (res.success && res.status?.connected && res.status?.modelAvailable) {
        setTestState('connected');
        setTestMessage(`Connected · ${res.status.model} is ready.`);
      } else if (res.success && res.status?.connected) {
        setTestState('disconnected');
        setTestMessage(`Model Not Found: ${res.status.details}`);
      } else {
        setTestState('disconnected');
        setTestMessage(
          res.status?.details ||
            res.error ||
            'Quillix cannot connect to Ollama.\nStart Ollama and make sure your local Qwen model is installed.'
        );
      }
    } catch (err: any) {
      setTestState('disconnected');
      setTestMessage(err?.message || 'Quillix cannot connect to Ollama.');
    }
  };

  const apiHealthTargets = activeApiHealthTargets(settings);

  const runApiHealthCheck = async (id: string) => {
    const target = apiHealthTargets.find(item => item.id === id);
    if (!target) return;
    if (!target.configured && id !== 'ollama') {
      setApiHealth(previous => ({ ...previous, [id]: { label: target.label, status: 'not_configured', checkedAt: new Date().toISOString() } }));
      return;
    }
    setApiHealth(previous => ({ ...previous, [id]: { label: target.label, status: 'checking' } }));
    const startedAt = performance.now();
    try {
      let data: any;
      if (id === 'ollama') {
        data = await api.getOllamaStatus(settings.model.trim() || undefined);
        if (!data.success || !data.status?.connected || !data.status?.modelAvailable) throw new Error(data.status?.details || data.error || 'Ollama model is not ready.');
        data = { success: true, model: data.status.model };
      } else if (id === 'tavily') {
        const response = await fetch('/api/verification/tavily', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: 'What is the current Tavily JavaScript SDK package?' }) });
        data = await response.json().catch(() => ({}));
        if (!response.ok || !data.success) throw new Error(data.error || 'Tavily verification failed.');
        data = { success: true, model: 'Search + Extract' };
      } else {
        const response = await fetch(`/api/providers/${id}/test`, { method: 'POST' });
        data = await response.json().catch(() => ({}));
        if (!response.ok || !data.success) throw new Error(data.error || `${target.label} connection failed.`);
      }
      setApiHealth(previous => ({ ...previous, [id]: { label: target.label, status: 'connected', latencyMs: Math.round(performance.now() - startedAt), model: data.model, checkedAt: new Date().toISOString() } }));
    } catch (error: any) {
      const message = String(error?.message || `${target.label} connection failed.`);
      setApiHealth(previous => ({ ...previous, [id]: { label: target.label, status: message.toLowerCase().includes('offline') ? 'blocked' : 'failed', latencyMs: Math.round(performance.now() - startedAt), error: message, checkedAt: new Date().toISOString() } }));
    }
  };

  const runAllApiHealthChecks = async () => {
    if (apiHealthRunning) return;
    setApiHealthRunning(true);
    try {
      // Sequential checks avoid a burst of cloud requests and make rate-limit
      // behaviour visible instead of creating a second rate-limit problem.
      for (const target of apiHealthTargets) await runApiHealthCheck(target.id);
    } finally { setApiHealthRunning(false); }
  };

  const SectionTitle: React.FC<{ icon: React.ReactNode; label: string }> = ({ icon, label }) => (
    <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-3">
      {icon}
      {label}
    </div>
  );

  const Toggle: React.FC<{ label: string; description: string; checked: boolean; onChange: (v: boolean) => void }> = ({
    label,
    description,
    checked,
    onChange,
  }) => (
    <label className="flex items-start justify-between gap-4 py-2.5 cursor-pointer">
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-[var(--text)]">{label}</span>
        <span className="block text-[11.5px] text-[var(--text-muted)] leading-snug mt-0.5">{description}</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className="relative w-10 h-[22px] rounded-full q-transition shrink-0 mt-0.5"
        style={{ background: checked ? 'var(--accent)' : 'var(--border)' }}
      >
        <span
          className="absolute top-[2px] w-[18px] h-[18px] rounded-full bg-white q-transition"
          style={{ left: checked ? '20px' : '2px' }}
        />
      </button>
    </label>
  );

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        role="presentation"
        variants={modalBackdropVariants}
        initial="hidden"
        animate="visible"
        exit="exit"
      >
        <motion.div
          ref={dialogRef}
          className="w-full max-w-xl max-h-[87vh] rounded-3xl border border-[var(--border)] bg-[var(--bg)] shadow-2xl flex flex-col overflow-hidden"
          style={{ boxShadow: 'var(--shadow)' }}
          variants={modalVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
          role="dialog"
          aria-modal="true"
          aria-label="Settings"
          tabIndex={-1}
        >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] shrink-0">
          <div><h2 className="text-[16px] font-bold tracking-[-0.025em] text-[var(--text)]">Studio settings</h2><p className="text-[11px] text-[var(--text-muted)] mt-1">Personalize your AI development environment</p></div>
          <button
            onClick={onClose}
            className="q-transition p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--hover)]"
            aria-label="Close settings"
          >
            <X size={16} />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-5 space-y-7">
          {/* AI section */}
          <section>
            <SectionTitle icon={<Cpu size={13} />} label="AI" />
            <div className="space-y-3.5">
              <div>
                <p className="block text-[12px] font-semibold text-[var(--text)] mb-2">AI provider</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5" role="group" aria-label="AI provider">
                  <button type="button" aria-pressed={(settings.aiProvider || 'ollama') === 'ollama'}
                    onClick={() => patch({aiProvider:'ollama'})}
                    className="q-provider-option rounded-xl px-3 py-3 text-left">
                    <span className="flex items-center gap-2 text-[13px] font-semibold"><Cpu size={15} style={{color:'var(--accent)'}} /> Ollama</span>
                    <span className="text-[11px] text-[var(--text-muted)] block mt-1">Local · Qwen / Ollama</span>
                  </button>
                  <button type="button" aria-pressed={settings.aiProvider === 'sarvam'}
                    onClick={() => patch({aiProvider:'sarvam',offlineMode:false})}
                    className="q-provider-option rounded-xl px-3 py-3 text-left">
                    <span className="flex items-center gap-2 text-[13px] font-semibold"><Sparkles size={15} style={{color:'var(--accent)'}} /> Sarvam AI</span>
                    <span className="text-[11px] text-[var(--text-muted)] block mt-1">Cloud · 105B</span>
                  </button>
                  <button type="button" aria-pressed={settings.aiProvider === 'openai'}
                    onClick={() => patch({aiProvider:'openai',offlineMode:false})}
                    className="q-provider-option rounded-xl px-3 py-3 text-left">
                    <span className="flex items-center gap-2 text-[13px] font-semibold"><Sparkles size={15} style={{color:'var(--accent)'}} /> OpenAI / ChatGPT API</span>
                    <span className="text-[11px] text-[var(--text-muted)] block mt-1">Dedicated GPT · Responses API</span>
                  </button>
                  <button type="button" aria-pressed={settings.aiProvider === 'grok'}
                    onClick={() => patch({aiProvider:'grok',offlineMode:false})}
                    className="q-provider-option rounded-xl px-3 py-3 text-left">
                    <span className="flex items-center gap-2 text-[13px] font-semibold"><Sparkles size={15} style={{color:'var(--accent)'}} /> Grok / xAI</span>
                    <span className="text-[11px] text-[var(--text-muted)] block mt-1">Cloud · xAI coding models</span>
                  </button>
                  <button type="button" aria-pressed={settings.aiProvider === 'groq'} onClick={() => patch({aiProvider:'groq',offlineMode:false})} className="q-provider-option rounded-xl px-3 py-3 text-left">
                    <span className="flex items-center gap-2 text-[13px] font-semibold"><Sparkles size={15} style={{color:'var(--accent)'}} /> Groq</span>
                    <span className="text-[11px] text-[var(--text-muted)] block mt-1">Cloud · API key only</span>
                  </button>
                  <button type="button" aria-pressed={settings.aiProvider === 'universal'}
                    onClick={() => patch({aiProvider:'universal',offlineMode:false})}
                    className="q-provider-option rounded-xl px-3 py-3 text-left">
                    <span className="flex items-center gap-2 text-[13px] font-semibold"><Cloud size={15} style={{color:'var(--accent)'}} /> Universal API</span>
                    <span className="text-[11px] text-[var(--text-muted)] block mt-1">OpenAI · Claude · Gemini · Custom</span>
                  </button>
                  <button type="button" aria-pressed={settings.aiProvider === 'nvidia'}
                    onClick={() => patch({aiProvider:'nvidia',offlineMode:false})}
                    className="q-provider-option rounded-xl px-3 py-3 text-left">
                    <span className="flex items-center gap-2 text-[13px] font-semibold"><Sparkles size={15} style={{color:'var(--accent)'}} /> NVIDIA NIM</span>
                    <span className="text-[11px] text-[var(--text-muted)] block mt-1">Direct NVIDIA API · model + key</span>
                  </button>
                </div>
                {brainCatalog && <p className="mt-2 text-[11px] text-[var(--text-muted)]" role="status">
                  Active brain: <span className="font-semibold text-[var(--text)]">{brainCatalog.brains.find(brain => brain.id === brainCatalog.active)?.label || brainCatalog.active || 'Ollama'}</span>
                  {' · '}{brainCatalog.brains.find(brain => brain.id === brainCatalog.active)?.capabilities.tools ? 'tools' : 'text only'}
                  {' · '}{brainCatalog.brains.find(brain => brain.id === brainCatalog.active)?.mode === 'offline' ? 'offline' : 'online'}
                </p>}
                {brainCatalog && <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Available brains">
                  {brainCatalog.brains.map(brain => <span key={brain.id} title={`${brain.label}: ${brain.mode} brain`} className={`rounded-full border px-2 py-1 text-[10px] ${brain.id === brainCatalog.active ? 'border-[var(--accent)] text-[var(--text)]' : 'border-[var(--border)] text-[var(--text-muted)]'}`}>
                    {brain.label} · {brain.mode} · {brain.capabilities.tools ? 'tools' : 'text'}{brain.capabilities.streaming ? ' · stream' : ''}{brain.capabilities.reasoning ? ' · reasoning' : ''}
                  </span>)}
                </div>}
                <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface-secondary)] p-3" data-testid="api-health-center">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="flex items-center gap-2 text-[12px] font-semibold text-[var(--text)]"><Activity size={14} style={{color:'var(--accent)'}} /> Active Provider + Tavily API Health</p>
                      <p className="mt-1 text-[10.5px] text-[var(--text-muted)]">Shows the provider currently used for coding plus the Tavily API used for freshness verification. Tests never display API keys.</p>
                    </div>
                    <button type="button" onClick={runAllApiHealthChecks} disabled={apiHealthRunning || apiHealthTargets.length === 0} className="q-button-outline shrink-0 rounded-xl px-3 py-2 text-[11px] disabled:opacity-50"><RefreshCw size={12} className={apiHealthRunning ? 'animate-spin' : ''} /> {apiHealthRunning ? 'Testing…' : 'Test active + Tavily'}</button>
                  </div>
                  <div className="mt-3 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                    {apiHealthTargets.map(target => {
                      const row = apiHealth[target.id] || { label: target.label, status: target.configured || target.id === 'ollama' ? 'idle' : 'not_configured' };
                      const statusLabel = row.status === 'connected' ? 'Working' : row.status === 'checking' ? 'Checking…' : row.status === 'not_configured' ? 'Not configured' : row.status === 'blocked' ? 'Blocked' : row.status === 'failed' ? 'Failed' : 'Not tested';
                      const statusColor = row.status === 'connected' ? 'var(--success)' : row.status === 'failed' ? 'var(--danger)' : row.status === 'not_configured' || row.status === 'blocked' ? 'var(--warning)' : 'var(--text-muted)';
                      return <div key={target.id} className="flex items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2" title={row.error || (row.checkedAt ? `Checked ${new Date(row.checkedAt).toLocaleTimeString()}` : '')}>
                        <div className="flex min-w-0 items-center gap-2"><span style={{color:statusColor}}>{row.status === 'connected' ? <CheckCircle2 size={13} /> : row.status === 'failed' ? <XCircle size={13} /> : row.status === 'checking' ? <RefreshCw size={13} className="animate-spin" /> : <CircleHelp size={13} />}</span><span className="truncate text-[11px] font-medium">{target.label}</span><span className="text-[10px]" style={{color:statusColor}}>{statusLabel}</span>{row.model && <span className="hidden truncate text-[9px] text-[var(--text-muted)] sm:inline">· {row.model}</span>}</div>
                        <button type="button" onClick={() => runApiHealthCheck(target.id)} disabled={apiHealthRunning || row.status === 'checking'} className="shrink-0 rounded-lg border border-[var(--border)] px-2 py-1 text-[10px] text-[var(--text-muted)] hover:text-[var(--text)] disabled:opacity-50">Test</button>
                      </div>;
                    })}
                  </div>
                  <p className="mt-2 text-[10px] text-[var(--text-muted)]">Switching the coding provider changes the first row. Tavily checks perform one real verification and may consume credits.</p>
                  {rateLimitStatus && <div className="mt-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2 text-[10.5px]" role="status" data-testid="provider-rate-limit-status">
                    <div className="flex items-center justify-between gap-2"><span className="font-semibold">Provider pacing firewall</span><span className={rateLimitStatus.offline ? 'text-[var(--success)]' : rateLimitStatus.waitingMs > 0 ? 'text-[var(--warning)]' : 'text-[var(--success)]'}>{rateLimitStatus.offline ? 'Ollama · no cloud delay' : rateLimitStatus.waitingMs > 0 ? `Cooldown ${Math.ceil(rateLimitStatus.waitingMs / 1000)}s` : 'Ready'}</span></div>
                    {!rateLimitStatus.offline && <p className="mt-1 text-[var(--text-muted)]">Cloud requests are serialized with {Math.round(rateLimitStatus.minIntervalMs / 1000)}s spacing · {rateLimitStatus.queuedRequests} request{rateLimitStatus.queuedRequests === 1 ? '' : 's'} queued.</p>}
                  </div>}
                </div>
                {settings.aiProvider === 'openai' && <div className="mt-3 space-y-2 rounded-xl border border-[var(--border)] bg-[var(--surface-secondary)] p-3">
                  <p className="text-[11px] text-[var(--text-muted)]">Dedicated official OpenAI Responses API. Uses a separate Windows-encrypted key. Testing makes a small billable API request; model access depends on your OpenAI API account.</p>
                  <label htmlFor="openai-model" className="block text-[12px] font-medium">Exact OpenAI model ID</label>
                  <input id="openai-model" aria-label="OpenAI model name" className="q-settings-field w-full rounded-xl border bg-[var(--input)] px-3 py-2 text-[13px] font-mono" value={openaiModel} onChange={e=>{setOpenAIModel(e.target.value);onOpenAIConnectionChange('untested');}} placeholder="gpt-6-astra" />
                  <label htmlFor="openai-key" className="block text-[12px] font-medium">OpenAI API key</label>
                  <input id="openai-key" type="password" autoComplete="new-password" className="q-settings-field w-full rounded-xl border bg-[var(--input)] px-3 py-2 text-[13px]" value={openaiKey} onChange={e=>setOpenAIKey(e.target.value)} placeholder={settings.openaiKeyConfigured?'Encrypted OpenAI key saved; leave blank to reuse':'Paste OpenAI API key'} />
                  <FailoverKeyPanel provider="openai" label="OpenAI" count={settings.openaiKeyPoolCount || 0} settings={settings} onSettingsChanged={onSettingsChanged} />
                  <div className="flex gap-2 flex-wrap">
                    <button type="button" className="q-button-primary px-3 py-2 rounded-xl text-[12px] disabled:opacity-50" disabled={openaiSaving||!openaiModel.trim()||(!openaiKey.trim()&&!settings.openaiKeyConfigured)} onClick={async()=>{
                      setOpenAISaving(true);setOpenAIMessage('Saving and verifying…');onOpenAIConnectionChange('checking');
                      try {
                        const updated=await api.updateSettings({aiProvider:'openai',offlineMode:false,openaiModel});
                        if(!updated.success||!updated.settings) throw new Error(updated.error||'Failed to save OpenAI settings.');
                        onSettingsChanged(updated.settings);
                        if(openaiKey.trim()) {
                          const resp=await fetch('/api/providers/openai/key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:openaiKey})});
                          const data=await resp.json();if(!resp.ok||!data.success) throw new Error(data.error||'OpenAI key storage failed.');
                          setOpenAIKey('');onSettingsChanged({...updated.settings,openaiKeyConfigured:true});
                        }
                        const resp=await fetch('/api/providers/openai/test',{method:'POST'});
                        const data=await resp.json();if(!resp.ok||!data.success) throw new Error(data.error||'OpenAI connection failed.');
                        onOpenAIConnectionChange('connected');setOpenAIMessage(`Verified ${data.model}. Ready for coding.`);
                      }catch(e:any){onOpenAIConnectionChange('failed');setOpenAIMessage(`Connection not verified: ${e?.message||'Unknown error'}`);}finally{setOpenAISaving(false);}
                    }}>{openaiSaving?'Saving / testing…':'Save & Connect'}</button>
                    <button type="button" className="q-button-outline px-3 py-2 rounded-xl text-[12px] disabled:opacity-50" disabled={!settings.openaiKeyConfigured||openaiSaving} onClick={async()=>{
                      setOpenAISaving(true);
                      try {const resp=await fetch('/api/providers/openai/key',{method:'DELETE'});const data=await resp.json();if(!resp.ok||!data.success)throw new Error(data.error||'Key removal failed.');onSettingsChanged({...settings,openaiKeyConfigured:!!data.configured});onOpenAIConnectionChange('untested');setOpenAIMessage('Saved OpenAI key removed.');}
                      catch(e:any){setOpenAIMessage(e?.message||'Unable to remove key.');}finally{setOpenAISaving(false);}
                    }}>Remove Key</button>
                  </div>
                  <p role="status" className="text-[11px]" style={{color:openaiConnection==='connected'?'var(--success)':openaiConnection==='failed'?'var(--danger)':'var(--text-muted)'}}>{openaiMessage||'Not verified yet. Select Save & Connect.'}</p>
                </div>}
                {settings.aiProvider === 'groq' && <div className="mt-3 space-y-2 rounded-xl border border-[var(--border)] bg-[var(--surface-secondary)] p-3">
                  <p className="text-[11px] text-[var(--text-muted)]">Groq uses its OpenAI-compatible API. Choose the exact model ID available to your Groq account.</p>
                  <div className="flex items-start gap-2 rounded-lg border border-[var(--accent)]/25 bg-[var(--accent-soft)] px-2.5 py-2 text-[10px] leading-relaxed text-[var(--text-muted)]" role="note">
                    <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--success)]" aria-hidden="true" />
                    <span><strong className="text-[var(--text)]">Free-tier budget guard active.</strong> Older context is compacted before requests, output is capped at 4,096 tokens, and requests are paced to reduce 413/429 errors. Provider account quotas still apply.</span>
                  </div>
                  <label htmlFor="groq-model" className="block text-[12px] font-medium">Exact Groq model ID</label>
                  <input id="groq-model" aria-label="Groq model name" className="q-settings-field w-full rounded-xl border bg-[var(--input)] px-3 py-2 text-[13px] font-mono" value={groqModel} onChange={e=>setGroqModel(e.target.value)} placeholder="openai/gpt-oss-120b" />
                  <label htmlFor="groq-key" className="block text-[12px] font-medium">Groq API key</label>
                  <input id="groq-key" type="password" autoComplete="new-password" className="q-settings-field w-full rounded-xl border bg-[var(--input)] px-3 py-2 text-[13px]" value={groqKey} onChange={e=>setGroqKey(e.target.value)} placeholder={settings.groqKeyConfigured?'Encrypted Groq key saved; leave blank to reuse':'Paste Groq API key'} />
                  <FailoverKeyPanel provider="groq" label="Groq" count={settings.groqKeyPoolCount || 0} settings={settings} onSettingsChanged={onSettingsChanged} />
                  <div className="flex gap-2 flex-wrap"><button type="button" className="q-button-primary px-3 py-2 rounded-xl text-[12px] disabled:opacity-50" disabled={groqSaving||!groqModel.trim()||(!groqKey.trim()&&!settings.groqKeyConfigured)} onClick={async()=>{setGroqSaving(true);setGroqMessage('Saving and verifying…');try{const updated=await api.updateSettings({aiProvider:'groq',offlineMode:false,groqModel:groqModel.trim()});if(!updated.success||!updated.settings)throw new Error(updated.error);if(groqKey.trim()){const r=await fetch('/api/providers/groq/key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:groqKey})});const d=await r.json();if(!r.ok||!d.success)throw new Error(d.error);setGroqKey('');}onSettingsChanged({...updated.settings,groqKeyConfigured:true});const r=await fetch('/api/providers/groq/test',{method:'POST'});const d=await r.json();if(!r.ok||!d.success)throw new Error(d.error);setGroqMessage(`Verified ${d.model || groqModel}. Ready for coding.`);}catch(e:any){setGroqMessage(`Connection not verified: ${e?.message||'Unknown error'}`);}finally{setGroqSaving(false);}}}>{groqSaving?'Saving / testing…':'Save & Connect'}</button><button type="button" className="q-button-outline px-3 py-2 rounded-xl text-[12px]" disabled={!settings.groqKeyConfigured||groqSaving} onClick={async()=>{setGroqSaving(true);try{const r=await fetch('/api/providers/groq/key',{method:'DELETE'});const d=await r.json();if(!r.ok||!d.success)throw new Error(d.error);onSettingsChanged({...settings,groqKeyConfigured:false});setGroqMessage('Stored Groq key removed.');}catch(e:any){setGroqMessage(e.message);}finally{setGroqSaving(false);}}}>Remove Key</button></div>
                  <p role="status" className="text-[11px]" style={{color:'var(--text-muted)'}}>{groqMessage||'Not verified yet. Select Save & Connect.'}</p>
                </div>}
                 {settings.aiProvider === 'nvidia' && <div className="mt-3 space-y-2 rounded-xl border border-[var(--border)] bg-[var(--surface-secondary)] p-3">
                   <p className="text-[11px] text-[var(--text-muted)]">Direct NVIDIA NIM connection. Enter the exact model ID and your NVIDIA API key; Save &amp; Connect stores the key encrypted and verifies the endpoint immediately.</p>
                   <label htmlFor="nvidia-model" className="block text-[12px] font-medium">Exact NVIDIA model ID</label>
                   <input id="nvidia-model" aria-label="NVIDIA model name" className="q-settings-field w-full rounded-xl border bg-[var(--input)] px-3 py-2 text-[13px] font-mono" value={nvidiaModel} onChange={e=>setNvidiaModel(e.target.value)} placeholder="openai/gpt-oss-120b" />
                   <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2.5 space-y-2" role="group" aria-label="NVIDIA model discovery and failover health">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[12px] font-medium">Account models & automatic failover</span>
                      <button type="button" className="q-button-outline px-2.5 py-1.5 rounded-lg text-[11px] disabled:opacity-50" disabled={nimLoading} onClick={discoverNimModels} aria-label="Discover NVIDIA models">{nimLoading?'Discovering…':'Discover models'}</button>
                    </div>
                    {nimModels.length > 0 && <ul className="flex flex-wrap gap-1.5" aria-label="Discovered NVIDIA models">
                      {nimModels.map(model => <li key={model.id}><button type="button" className="q-button-outline px-2 py-1 rounded-lg text-[11px] font-mono" aria-label={`Use NVIDIA model ${model.id}`} aria-pressed={nvidiaModel===model.id} onClick={()=>{setNvidiaModel(model.id);onNvidiaConnectionChange('untested');}}>{model.id}{model.contextLength?` · ${Math.round(model.contextLength/1000)}k`:''}</button></li>)}
                    </ul>}
                    <label htmlFor="nvidia-failover-priority" className="block text-[12px] font-medium">Failover priority (most preferred first)</label>
                    <input id="nvidia-failover-priority" aria-label="NVIDIA failover priority models" className="q-settings-field w-full rounded-xl border bg-[var(--input)] px-3 py-2 text-[12px] font-mono" value={nimPriorityText} onChange={e=>setNimPriorityText(e.target.value)} placeholder="model-a, model-b" />
                    <button type="button" className="q-button-primary px-3 py-1.5 rounded-lg text-[11px] disabled:opacity-50" disabled={nvidiaSaving} onClick={saveNimPriority}>Save priority</button>
                    {nimHealth && <div className="text-[11px] text-[var(--text-muted)] space-y-1" role="status" aria-label="NVIDIA failover health">
                      <div>Active model: <span className="font-mono text-[var(--text)]">{nimHealth.active || 'none yet'}</span></div>
                      {(nimHealth.models||[]).filter(m=>(m.successes||0)+(m.failures||0)>0).length > 0 && <ul className="space-y-0.5">
                        {(nimHealth.models||[]).filter(m=>(m.successes||0)+(m.failures||0)>0).map(m=><li key={m.id} className="font-mono">{m.id} · ok {m.successes||0} · fail {m.failures||0}{m.cooldownUntil&&m.cooldownUntil>Date.now()?' · cooling down':''}</li>)}
                      </ul>}
                      {(nimHealth.switches||[]).length > 0 && <div>Recent switches: {(nimHealth.switches||[]).slice(-3).map(s=>`${s.from} → ${s.to} (${s.reason})`).join('; ')}</div>}
                    </div>}
                    <p role="status" className="text-[11px]" style={{color:'var(--text-muted)'}}>{nimCatalogMessage}</p>
                  </div>
                  <label htmlFor="nvidia-key" className="block text-[12px] font-medium">NVIDIA API key</label>
                   <input id="nvidia-key" aria-label="NVIDIA API key" type="password" autoComplete="new-password" className="q-settings-field w-full rounded-xl border bg-[var(--input)] px-3 py-2 text-[13px]" value={nvidiaKey} onChange={e=>setNvidiaKey(e.target.value)} placeholder={settings.nvidiaKeyConfigured?'Encrypted NVIDIA key saved; leave blank to reuse':'Paste NVIDIA API key'} />
                   <FailoverKeyPanel provider="nvidia" label="NVIDIA" count={settings.nvidiaKeyPoolCount || 0} settings={settings} onSettingsChanged={onSettingsChanged} />
                   <div className="flex gap-2 flex-wrap">
                     <button type="button" className="q-button-primary px-3 py-2 rounded-xl text-[12px] disabled:opacity-50" disabled={nvidiaSaving||!nvidiaModel.trim()||(!nvidiaKey.trim()&&!settings.nvidiaKeyConfigured)} onClick={async()=>{
                       setNvidiaSaving(true);setNvidiaMessage('Saving and verifying…');onNvidiaConnectionChange('checking');
                       try {
                         const updated=await api.updateSettings({aiProvider:'nvidia',offlineMode:false,nvidiaModel:nvidiaModel.trim()});
                         if(!updated.success||!updated.settings) throw new Error(updated.error||'Failed to save NVIDIA settings.');
                         if(nvidiaKey.trim()) { const resp=await fetch('/api/providers/nvidia/key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:nvidiaKey})}); const data=await resp.json(); if(!resp.ok||!data.success) throw new Error(data.error||'NVIDIA key storage failed.'); setNvidiaKey(''); }
                         onSettingsChanged({...updated.settings,nvidiaKeyConfigured:true});
                         const resp=await fetch('/api/providers/nvidia/test',{method:'POST'}); const data=await resp.json(); if(!resp.ok||!data.success) throw new Error(data.error||'NVIDIA connection failed.');
                         onNvidiaConnectionChange('connected');setNvidiaMessage(`Verified ${data.model || nvidiaModel}. Ready for coding.`);
                       } catch(e:any) { onNvidiaConnectionChange('failed');setNvidiaMessage(`Connection not verified: ${e?.message||'Unknown error'}`); } finally { setNvidiaSaving(false); }
                     }}>{nvidiaSaving?'Saving / testing…':'Save & Connect'}</button>
                     <button type="button" className="q-button-outline px-3 py-2 rounded-xl text-[12px] disabled:opacity-50" disabled={!settings.nvidiaKeyConfigured||nvidiaSaving} onClick={async()=>{setNvidiaSaving(true);try{const r=await fetch('/api/providers/nvidia/key',{method:'DELETE'});const d=await r.json();if(!r.ok||!d.success)throw new Error(d.error||'Key removal failed.');onSettingsChanged({...settings,nvidiaKeyConfigured:false});onNvidiaConnectionChange('untested');setNvidiaMessage('Stored NVIDIA key removed.');}catch(e:any){setNvidiaMessage(e?.message||'Unable to remove key.');}finally{setNvidiaSaving(false);}}}>Remove Key</button>
                   </div>
                   <p role="status" className="text-[11px]" style={{color:nvidiaMessage.toLowerCase().includes('verified')?'var(--success)':nvidiaMessage.toLowerCase().includes('not verified')?'var(--danger)':'var(--text-muted)'}}>{nvidiaMessage||'Not verified yet. Select Save & Connect.'}</p>
                 </div>}
                {settings.aiProvider === 'grok' && <div className="mt-3 space-y-2 rounded-xl border border-[var(--border)] bg-[var(--surface-secondary)] p-3">
                  <p className="text-[11px] text-[var(--text-muted)]">Grok uses xAI's OpenAI-compatible API. Choose the exact model ID available to your xAI account.</p>
                  <label htmlFor="grok-model" className="block text-[12px] font-medium">Exact Grok model ID</label>
                  <input id="grok-model" aria-label="Grok model name" className="q-settings-field w-full rounded-xl border bg-[var(--input)] px-3 py-2 text-[13px] font-mono" value={grokModel} onChange={e=>{setGrokModel(e.target.value);onGrokConnectionChange('untested');}} placeholder="grok-4" />
                  <label htmlFor="grok-key" className="block text-[12px] font-medium">Grok / xAI API key</label>
                  <input id="grok-key" type="password" autoComplete="new-password" className="q-settings-field w-full rounded-xl border bg-[var(--input)] px-3 py-2 text-[13px]" value={grokKey} onChange={e=>setGrokKey(e.target.value)} placeholder={settings.grokKeyConfigured?'Encrypted Grok key saved; leave blank to reuse':'Paste xAI API key'} />
                  <FailoverKeyPanel provider="grok" label="Grok / xAI" count={settings.grokKeyPoolCount || 0} settings={settings} onSettingsChanged={onSettingsChanged} />
                  <div className="flex gap-2 flex-wrap">
                    <button type="button" className="q-button-primary px-3 py-2 rounded-xl text-[12px] disabled:opacity-50" disabled={grokSaving||!grokModel.trim()||(!grokKey.trim()&&!settings.grokKeyConfigured)} onClick={async()=>{
                      setGrokSaving(true);setGrokMessage('Saving and verifying…');onGrokConnectionChange('checking');
                      try {
                        const updated=await api.updateSettings({aiProvider:'grok',offlineMode:false,grokModel:grokModel.trim()});
                        if(!updated.success||!updated.settings) throw new Error(updated.error||'Failed to save Grok settings.');
                        if(grokKey.trim()){
                          const resp=await fetch('/api/providers/grok/key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:grokKey})});
                          const data=await resp.json();if(!resp.ok||!data.success) throw new Error(data.error||'Grok key storage failed.');
                          setGrokKey('');
                        }
                        onSettingsChanged({...updated.settings,grokKeyConfigured:true});
                        const resp=await fetch('/api/providers/grok/test',{method:'POST'});const data=await resp.json();
                        if(!resp.ok||!data.success) throw new Error(data.error||'Grok connection failed.');
                        onGrokConnectionChange('connected');setGrokMessage(`Verified ${data.model || grokModel}. Ready for coding.`);
                      } catch(e:any){onGrokConnectionChange('failed');setGrokMessage(`Connection not verified: ${e?.message||'Unknown error'}`);} finally {setGrokSaving(false);}
                    }}>{grokSaving?'Saving / testing…':'Save & Connect'}</button>
                    <button type="button" className="q-button-outline px-3 py-2 rounded-xl text-[12px] disabled:opacity-50" disabled={!settings.grokKeyConfigured||grokSaving} onClick={async()=>{
                      setGrokSaving(true);try {const resp=await fetch('/api/providers/grok/key',{method:'DELETE'});const data=await resp.json();if(!resp.ok||!data.success)throw new Error(data.error||'Key removal failed.');onSettingsChanged({...settings,grokKeyConfigured:!!data.configured});onGrokConnectionChange('untested');setGrokMessage('Saved Grok key removed.');}catch(e:any){setGrokMessage(e?.message||'Unable to remove key.');}finally{setGrokSaving(false);}
                    }}>Remove Key</button>
                  </div>
                  <p role="status" className="text-[11px]" style={{color:grokConnection==='connected'?'var(--success)':grokConnection==='failed'?'var(--danger)':'var(--text-muted)'}}>{grokMessage||'Not verified yet. Select Save & Connect.'}</p>
                </div>}
                {settings.aiProvider === 'universal' && <div className="mt-3 space-y-2 border border-[var(--border)] bg-[var(--surface-secondary)] rounded-xl p-3">
                  <ProviderProfiles settings={settings} onChange={onSettingsChanged}/><p className="text-[11px] text-[var(--text-muted)]">Choose API format, exact model name and endpoint. Your key stays encrypted for this Windows account. Each connection test may cost API credits.</p>
                  <label className="block text-[12px] font-medium" htmlFor="universal-preset">Provider preset</label>
                  <select id="universal-preset" aria-label="Universal provider preset" className="q-settings-field w-full rounded-xl border bg-[var(--input)] px-3 py-2 text-[13px]" value={universalPreset} onChange={e=>applyUniversalPreset(e.target.value as ProviderPresetId)}>
                    {PROVIDER_PRESETS.map(preset=><option key={preset.id} value={preset.id}>{preset.label}</option>)}
                  </select>
                  <p className="text-[11px] text-[var(--text-muted)]">Defaults are local form values only. No network request runs until Save &amp; Connect.</p>
                  <label className="block text-[12px] font-medium" htmlFor="universal-protocol">API format</label>
                  <select id="universal-protocol" className="q-settings-field w-full rounded-xl border bg-[var(--input)] px-3 py-2 text-[13px]" value={universalProtocol} onChange={e=>{
                    const proto=e.target.value as 'openai'|'responses'|'anthropic'|'gemini';setUniversalPreset('custom-openai');setUniversalProtocol(proto);
                    setUniversalUrl(proto==='anthropic'?'https://api.anthropic.com/v1':proto==='gemini'?'https://generativelanguage.googleapis.com/v1beta':'https://api.openai.com/v1');
                    changeUniversalStatus('untested');
                  }}>
                    <option value="openai">OpenAI-compatible Chat Completions</option>
                    <option value="responses">OpenAI Responses API (reasoning models)</option>
                    <option value="anthropic">Anthropic Messages (Claude)</option>
                    <option value="gemini">Google Gemini</option>
                  </select>
                  <label className="block text-[12px] font-medium" htmlFor="universal-url">API endpoint</label>
                  <input id="universal-url" aria-label="Universal API endpoint" className="q-settings-field w-full rounded-xl border bg-[var(--input)] px-3 py-2 text-[13px] font-mono" value={universalUrl} onChange={e=>{setUniversalUrl(e.target.value);changeUniversalStatus('untested');}} placeholder="https://api.example.com/v1" />
                  <label className="block text-[12px] font-medium" htmlFor="universal-model">Exact model ID</label>
                  <input id="universal-model" aria-label="Universal model name" className="q-settings-field w-full rounded-xl border bg-[var(--input)] px-3 py-2 text-[13px] font-mono" value={universalModel} onChange={e=>{setUniversalModel(e.target.value);changeUniversalStatus('untested');}} placeholder="Enter the exact model name your account supports" />
                  <label className="block text-[12px] font-medium" htmlFor="universal-key">API key</label>
                  <input id="universal-key" aria-label="Universal API key" type="password" autoComplete="off" className="q-settings-field w-full rounded-xl border bg-[var(--input)] px-3 py-2 text-[13px]" value={universalKey} onChange={e=>setUniversalKey(e.target.value)} placeholder={universalKeyMatchesSelection?'Saved key for this endpoint exists.':'Paste an API key for this endpoint'} />
                  <p className="text-[11px] text-[var(--text-muted)]">{universalKeyMatchesSelection?'Encrypted key saved for this endpoint.':'Enter a key for this endpoint.'} · Offline Mode will be disabled to connect.</p>
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2.5 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold">Optional failover keys</span>
                      <span className="text-[10px] text-[var(--text-muted)]">{settings.universalKeyPoolCount || 0} encrypted backup{(settings.universalKeyPoolCount || 0) === 1 ? '' : 's'}</span>
                    </div>
                    <p className="text-[10.5px] leading-relaxed text-[var(--text-muted)]">On rate-limit or temporary provider failure, Quillix can try the next key. Account-level quotas are still shared; invalid-key errors never rotate automatically.</p>
                    <div className="flex gap-2">
                      <input aria-label="Universal API failover key" type="password" autoComplete="off" value={failoverKey} onChange={e=>setFailoverKey(e.target.value)} placeholder="Add another key for optional failover" className="q-settings-field min-w-0 flex-1 rounded-lg border bg-[var(--input)] px-2.5 py-1.5 text-[12px]" />
                      <button type="button" className="q-button-outline rounded-lg px-2.5 py-1.5 text-[11px] disabled:opacity-50" disabled={failoverSaving || !failoverKey.trim() || !universalKeyMatchesSelection} onClick={async()=>{
                        setFailoverSaving(true);
                        try { const response=await fetch('/api/providers/universal/failover-key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:failoverKey})}); const data=await response.json(); if(!response.ok||!data.success) throw new Error(data.error||'Could not save failover key.'); setFailoverKey(''); onSettingsChanged({...settings,universalKeyPoolCount:Number(data.count)||0}); setUniversalMessage(`Failover key added. ${data.count} encrypted backup key${data.count===1?'':'s'} available.`); }
                        catch(error:any){setUniversalMessage(error?.message||'Could not save failover key.');} finally {setFailoverSaving(false);}
                      }}>{failoverSaving?'Saving…':'Add key'}</button>
                    </div>
                    {(settings.universalKeyPoolCount || 0) > 0 && <button type="button" className="text-[10.5px] text-[var(--danger)] hover:underline disabled:opacity-50" disabled={failoverSaving} onClick={async()=>{setFailoverSaving(true);try{const response=await fetch('/api/providers/universal/failover-keys',{method:'DELETE'});const data=await response.json();if(!response.ok||!data.success)throw new Error(data.error||'Could not remove failover keys.');onSettingsChanged({...settings,universalKeyPoolCount:0});setUniversalMessage('All encrypted failover keys removed.');}catch(error:any){setUniversalMessage(error?.message||'Could not remove failover keys.');}finally{setFailoverSaving(false);}}}>Remove backup keys</button>}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" disabled={universalSaving || !universalModel.trim() || (!universalKey.trim()&&!universalKeyMatchesSelection)} className="q-button-primary px-3 py-2 rounded-xl text-[12px] disabled:opacity-50" onClick={async()=>{
                      setUniversalSaving(true);setUniversalMessage('Saving configuration securely…');changeUniversalStatus('untested');
                      try {
                        const settingsResult=await api.updateSettings({aiProvider:'universal',activeProviderProfile:'',offlineMode:false,universalPreset,universalProtocol,universalEndpoint:universalUrl,universalModel});
                        if(!settingsResult.success||!settingsResult.settings) throw new Error(settingsResult.error||'Could not save provider settings.');
                        if(universalKey.trim()){
                          const resp=await fetch('/api/providers/universal/key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:universalKey})});
                          const data=await resp.json();if(!resp.ok)throw new Error(data.error||'Could not encrypt API key.');
                          setUniversalKey('');
                        }
                        onSettingsChanged({...settingsResult.settings,universalKeyConfigured: Boolean(universalKey.trim() || universalKeyMatchesSelection)});
                        changeUniversalStatus('checking');setUniversalMessage('Configuration saved. Testing API…');
                        const response=await fetch('/api/providers/universal/test',{method:'POST'});
                        const test=await response.json();if(!response.ok)throw new Error(test.error||'Connection test failed.');
                        changeUniversalStatus('connected');setUniversalMessage(`Verified: ${test.model} responded${test.capabilities?.tools ? ' · native tools verified' : ''}${universalKey.trim()?` (${maskProviderKey(universalKey)} stored encrypted)`:''}. Coding agent is using Universal API.`);
                      } catch(e:any){changeUniversalStatus('failed');setUniversalMessage(e?.message||'Save or connection failed.');}
                      finally {setUniversalSaving(false);}
                    }}>{universalSaving?'Saving / testing…':'Save & Connect'}</button>
                    <button type="button" className="q-button-outline px-3 py-2 rounded-xl text-[12px]" disabled={!settings.universalKeyConfigured || universalSaving} onClick={async()=>{
                      setUniversalSaving(true);try {const response=await fetch('/api/providers/universal/key',{method:'DELETE'});const data=await response.json();if(!response.ok)throw new Error(data.error||'Removal failed.');onSettingsChanged({...settings,universalKeyConfigured:!!data.configured});changeUniversalStatus('untested');setUniversalMessage('Stored key removed.');}catch(e:any){setUniversalMessage(e.message);}finally{setUniversalSaving(false);}
                    }}>Remove Key</button>
                  </div>
                  <p role="status" className="text-[11px]" style={{color:universalConnection==='connected'?'var(--success)':universalConnection==='failed'?'var(--danger)':'var(--text-muted)'}}>{universalMessage || 'Not verified yet. Select Save & Connect to test.'}</p>
                </div>}
                <div className="mt-3 space-y-2 rounded-xl border border-[var(--border)] bg-[var(--surface-secondary)] p-3" data-testid="tavily-verification-panel">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-[13px] font-semibold"><ShieldCheck size={14} style={{color:'var(--accent)'}} /> Tavily freshness verification</span>
                    <span className="text-[10px] font-semibold" style={{color:settings.tavilyKeyConfigured?'var(--success)':'var(--warning)'}}>{settings.tavilyKeyConfigured?'KEY SAVED':'KEY NOT SET'}</span>
                  </div>
                  <p className="text-[11px] leading-relaxed text-[var(--text-muted)]">Checks version-sensitive answers and coding claims against current web evidence. Offline Mode returns an explicit offline result and never calls Tavily.</p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <input aria-label="Tavily API key" type="password" autoComplete="off" value={tavilyKey} onChange={e=>setTavilyKey(e.target.value)} placeholder={settings.tavilyKeyConfigured?'Encrypted Tavily key saved; leave blank to reuse':'Paste Tavily API key'} className="q-settings-field w-full rounded-xl border bg-[var(--input)] px-3 py-2 text-[13px]" />
                    <div className="flex gap-2">
                      <button type="button" className="q-button-primary flex-1 rounded-xl px-3 py-2 text-[12px] disabled:opacity-50" disabled={tavilySaving||!tavilyKey.trim()} onClick={async()=>{setTavilySaving(true);try{const response=await fetch('/api/providers/tavily/key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:tavilyKey})});const data=await response.json();if(!response.ok||!data.success)throw new Error(data.error||'Could not save Tavily key.');setTavilyKey('');onSettingsChanged({...settings,tavilyKeyConfigured:true});}catch(error:any){setTavilyResult({finding:'unverified',explanation:error?.message||'Could not save Tavily key.'});}finally{setTavilySaving(false);}}}>{tavilySaving?'Saving…':'Save Key'}</button>
                      <button type="button" className="q-button-outline rounded-xl px-3 py-2 text-[12px] disabled:opacity-50" disabled={tavilySaving||!settings.tavilyKeyConfigured} onClick={async()=>{setTavilySaving(true);try{const response=await fetch('/api/providers/tavily/key',{method:'DELETE'});const data=await response.json();if(!response.ok||!data.success)throw new Error(data.error||'Could not remove Tavily key.');onSettingsChanged({...settings,tavilyKeyConfigured:!!data.configured});setTavilyResult(null);}catch(error:any){setTavilyResult({finding:'unverified',explanation:error?.message||'Could not remove Tavily key.'});}finally{setTavilySaving(false);}}}>Remove</button>
                    </div>
                  </div>
                  <div className="space-y-2 border-t border-[var(--border)] pt-2">
                    <input aria-label="Tavily verification query" value={tavilyQuery} onChange={e=>setTavilyQuery(e.target.value)} placeholder="What current API/library fact should be checked?" className="q-settings-field w-full rounded-xl border bg-[var(--input)] px-3 py-2 text-[12px]" />
                    <textarea aria-label="Answer to verify" value={tavilyAnswer} onChange={e=>setTavilyAnswer(e.target.value)} placeholder="Paste the AI answer or code claim to verify (optional)" rows={3} className="q-settings-field w-full resize-y rounded-xl border bg-[var(--input)] px-3 py-2 text-[12px]" />
                    <button type="button" className="q-button-outline rounded-xl px-3 py-2 text-[12px] disabled:opacity-50" disabled={tavilySaving||!tavilyQuery.trim()} onClick={async()=>{setTavilySaving(true);setTavilyResult(null);try{const response=await fetch('/api/verification/tavily',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:tavilyQuery,answer:tavilyAnswer})});const data=await response.json();if(!response.ok||!data.success)throw new Error(data.error||'Verification failed.');setTavilyResult(data.result);const usageResponse=await fetch('/api/verification/tavily/usage');if(usageResponse.ok){const usageData=await usageResponse.json();setTavilyUsage(usageData.usage||null);}const historyResponse=await fetch('/api/verification/tavily/history');if(historyResponse.ok){const historyData=await historyResponse.json();setTavilyHistory(Array.isArray(historyData.history)?historyData.history:[]);}}catch(error:any){setTavilyResult({finding:'unverified',explanation:error?.message||'Verification failed.'});}finally{setTavilySaving(false);}}}>{tavilySaving?'Checking sources…':'Verify with Tavily'}</button>
                  </div>
                  {tavilyResult && <div className="space-y-1 rounded-xl border border-[var(--border)] px-3 py-2 text-[11px]" role="status"><div className="flex items-center justify-between gap-2"><div className="font-semibold" style={{color:tavilyResult.finding==='supported'?'var(--success)':tavilyResult.finding==='offline'?'var(--warning)':'var(--danger)'}}>Result: {String(tavilyResult.finding || 'unverified').replace('_',' ')}</div>{typeof tavilyResult.freshnessScore==='number'&&<span className="rounded-full bg-[var(--accent-soft)] px-2 py-0.5 font-semibold">Freshness {tavilyResult.freshnessScore}%</span>}</div><p className="text-[var(--text-muted)]">{tavilyResult.explanation}</p>{Array.isArray(tavilyResult.claims)&&tavilyResult.claims.slice(0,5).map((claim:any,index:number)=><div key={`${claim.text}-${index}`} className="rounded-lg bg-[var(--surface-secondary)] px-2 py-1"><div className="flex justify-between gap-2"><span className="truncate">{claim.text}</span><span className="shrink-0 font-semibold">{String(claim.finding||'unverified').replace('_',' ')}</span></div>{claim.sourceUrls?.length>0&&<span className="text-[10px] text-[var(--text-muted)]">{claim.sourceUrls.length} cited source{claim.sourceUrls.length===1?'':'s'}</span>}</div>)}{tavilyResult.suggestedAction&&<p className="rounded-lg bg-[var(--accent-soft)] px-2 py-1 text-[var(--text)]">Next: {tavilyResult.suggestedAction}</p>}{Array.isArray(tavilyResult.sources)&&tavilyResult.sources.slice(0,3).map((source:any)=><a key={source.url} href={source.url} target="_blank" rel="noreferrer" className="block truncate text-[var(--accent)]">{source.official?'★ ':''}{source.title} · {source.domain}</a>)}</div>}
                  {tavilyUsage && <p className="text-[10px] text-[var(--text-muted)]">Usage: {tavilyUsage.verifications||0} checks · {tavilyUsage.searches||0} searches · {tavilyUsage.extracts||0} extracts · {tavilyUsage.credits||0} credits · est. ${(Number(tavilyUsage.estimatedCostUsd)||0).toFixed(4)}</p>}
                  {tavilyHistory.length>0 && <div className="space-y-1 border-t border-[var(--border)] pt-2"><p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Recent verification history</p>{tavilyHistory.slice(0,5).map((entry:any)=><div key={entry.id} className="flex items-center justify-between gap-2 rounded-lg bg-[var(--surface-secondary)] px-2 py-1 text-[10px]"><span className="truncate">{entry.queryPreview}</span><span className="shrink-0 font-semibold">{String(entry.finding).replace('_',' ')} · {entry.freshnessScore}%</span></div>)}</div>}
                </div>
                {settings.aiProvider === 'sarvam' && <p className="mt-2 text-[11px] text-[var(--text-muted)]">Selecting Sarvam turns off Offline Mode to allow API access.</p>}
                {settings.aiProvider === 'sarvam' && <div className="mt-3 space-y-2">
                  <div className="flex items-center justify-between gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-secondary)] px-3 py-2.5"><span className="text-xs flex items-center gap-2"><KeyRound size={13} /> sarvam-105b</span><span className="text-[11px] font-semibold" style={{color:settings.sarvamKeyConfigured ? 'var(--success)' : 'var(--warning)'}}>{settings.sarvamKeyConfigured ? 'KEY SAVED' : 'KEY NOT SET'}</span></div>
                  <p className="text-[11px] text-[var(--text-muted)]">On Windows, the key is encrypted for your Windows account. Connection tests may use API credits.</p>
                  <input type="password" autoComplete="off" value={sarvamKey} onChange={e => setSarvamKey(e.target.value)}
                    placeholder="Paste Sarvam API key" aria-label="Sarvam API key"
                    className="q-settings-field w-full rounded-xl border border-[var(--border)] bg-[var(--input)] px-3 py-2.5 text-[13px] text-[var(--text)]" />
                  <FailoverKeyPanel provider="sarvam" label="Sarvam" count={settings.sarvamKeyPoolCount || 0} settings={settings} onSettingsChanged={onSettingsChanged} />
                  <div className="flex flex-wrap gap-2">
                    <button type="button" disabled={!sarvamKey.trim() || saving} className="q-button-outline text-xs rounded-xl border px-3 py-2.5 disabled:opacity-50 disabled:cursor-not-allowed" onClick={async () => {
                      setError(null); setSarvamKeyError(null); setSaving(true);
                      try {
                        const r = await fetch('/api/providers/sarvam/key', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({key:sarvamKey}) });
                        const data = await r.json(); if (!r.ok) throw new Error(data.error || 'Unable to save key.');
                        setSarvamKey(''); onSettingsChanged({...settings,sarvamKeyConfigured:true});
                        // User explicitly chose Save & Connect. Encryption
                        // success is NOT proof that the cloud model responds.
                        onSarvamConnectionChange('checking'); setSarvamChecking(true);
                        setTestState('checking'); setTestMessage('API key saved securely. Testing Sarvam…');
                        try {
                          const check = await fetch('/api/providers/sarvam/test', {method:'POST'});
                          const result = await check.json();
                          if (!check.ok) throw new Error(result.error || 'Sarvam connection failed.');
                          onSarvamConnectionChange('connected');
                          setTestState('connected'); setTestMessage(`Connected · ${result.model} is responding.`);
                        } catch (connectionError: any) {
                          onSarvamConnectionChange('failed');
                          setTestState('disconnected');
                          setTestMessage('API key saved, but Sarvam connection could not be verified.');
                          setSarvamKeyError(connectionError?.message || 'Sarvam test failed.');
                        } finally { setSarvamChecking(false); }
                      } catch (e:any) { setSarvamKeyError(e?.message || 'Secure key storage failed.'); } finally { setSaving(false); }
                    }}>{saving ? "Saving…" : "Save & Connect"}</button>
                    <button type="button" disabled={!settings.sarvamKeyConfigured || sarvamChecking} className="q-button-outline text-xs rounded-xl border px-3 py-2.5 disabled:opacity-50 disabled:cursor-not-allowed" onClick={async () => {
                      setError(null); setSarvamChecking(true); onSarvamConnectionChange('checking'); setTestState('checking'); setTestMessage('Testing Sarvam connection…');
                      try {
                        const r = await fetch('/api/providers/sarvam/test', {method:'POST'});
                        const data = await r.json(); if (!r.ok) throw new Error(data.error || 'Sarvam test failed.');
                        onSarvamConnectionChange('connected'); setTestState('connected'); setTestMessage(`Connected · ${data.model} is responding.`);
                      } catch (e:any) { onSarvamConnectionChange('failed'); setTestState('disconnected'); setTestMessage(''); setError(e.message); }
                      finally { setSarvamChecking(false); }
                    }}>{sarvamChecking ? 'Checking…' : 'Test Sarvam Connection'}</button>
                    <button type="button" disabled={!settings.sarvamKeyConfigured || saving} className="q-button-outline text-xs rounded-xl border px-3 py-2.5 disabled:opacity-50 disabled:cursor-not-allowed" onClick={async () => {
                      setError(null); setSaving(true);
                      try {
                        const r = await fetch('/api/providers/sarvam/key', {method:'DELETE'});
                        const data = await r.json(); if (!r.ok) throw new Error(data.error || 'Unable to remove key.');
                        onSettingsChanged({...settings,sarvamKeyConfigured:!!data.configured});
                        setSarvamKey(''); onSarvamConnectionChange('untested'); setTestState('idle'); setTestMessage(data.configured ? 'Environment key is still active.' : 'Saved Sarvam key removed.');
                      } catch (e:any) { setError(e.message); } finally { setSaving(false); }
                    }}>Remove Key</button>
                  </div>
                  {sarvamKeyError && (
                    <p role="alert" className="text-[11px] leading-5 rounded-xl border px-3 py-2" style={{color:'var(--danger)',borderColor:'var(--danger)'}}>
                      {sarvamKeyError} To diagnose secure storage without using your real key, run <code>npm run check:sarvam-storage</code> in the Quillix folder.
                    </p>
                  )}
                  <p className="flex items-center gap-2 text-[11px] text-[var(--text-muted)]"><ShieldCheck size={13} /> Connection: {sarvamConnection === 'connected' ? 'Verified by test' : sarvamConnection === 'checking' ? 'Checking…' : sarvamConnection === 'failed' ? 'Test failed' : 'Not yet verified'}</p>
                </div>}

              </div>

              {settings.aiProvider === 'ollama' && <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[12px] font-medium text-[var(--text)] mb-1.5" htmlFor="set-model">
                    Model
                  </label>
                  <input
                    id="set-model"
                    value={settings.model}
                    onChange={(e) => patch({ model: e.target.value })}
                    placeholder="qwen3:4b"
                    className="w-full rounded-xl border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--accent)] font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[12px] font-medium text-[var(--text)] mb-1.5" htmlFor="set-url">
                    Ollama URL
                  </label>
                  <input
                    id="set-url"
                    value={settings.ollamaBaseUrl}
                    onChange={(e) => patch({ ollamaBaseUrl: e.target.value })}
                    placeholder="http://localhost:11434"
                    className="w-full rounded-xl border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--accent)] font-mono"
                  />
                </div>
              </div>}

              {settings.aiProvider === 'ollama' && <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-[12.5px]">
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{
                      background:
                        ollama.state === 'connected'
                          ? 'var(--success)'
                          : ollama.state === 'disconnected' || ollama.state === 'model-missing'
                            ? 'var(--danger)'
                            : 'var(--text-muted)',
                    }}
                    aria-hidden="true"
                  />
                  <span className="text-[var(--text-muted)]">Connection</span>
                  <span className="text-[var(--text)] font-medium">
                    {ollama.state === 'connected'
                      ? 'Connected'
                      : ollama.state === 'model-missing'
                        ? 'Model Not Found'
                        : ollama.state === 'disconnected'
                          ? 'Disconnected'
                          : 'Checking…'}
                  </span>
                </span>
                <button
                  onClick={() => {
                    testConnection();
                    onRefreshOllama();
                  }}
                  className="q-transition flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[var(--border)] text-[12px] font-medium text-[var(--text)] hover:bg-[var(--hover)]"
                >
                  <RefreshCw size={12} className={testState === 'checking' ? 'animate-spin' : ''} />
                  Test Connection
                </button>
              </div>}

              {settings.aiProvider === 'ollama' && testMessage && (
                <p
                  className="text-[12px] leading-relaxed whitespace-pre-wrap"
                  style={{
                    color:
                      testState === 'connected'
                        ? 'var(--success)'
                        : testState === 'disconnected'
                          ? 'var(--danger)'
                          : 'var(--text-muted)',
                  }}
                >
                  {testMessage}
                </p>
              )}

              <Toggle
                label="Offline Mode"
                description="When ON, cloud AI requests are blocked. Only locally configured Ollama connections can be used."
                checked={settings.offlineMode}
                onChange={(v) => patch({ offlineMode: v })}
              />

              {/* Turbo Speed Performance Dashboard */}
              <section className="mt-6" data-testid="turbo-speed-dashboard">
                <SectionTitle icon={<Zap size={13} />} label="Turbo Speed" />
                <div className="space-y-4">
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-secondary)] p-4 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[14px] font-semibold text-[var(--text)] flex items-center gap-1.5">
                            <Zap size={15} style={{color: 'var(--accent)'}} />
                            Turbo Speed Mode
                          </span>
                        </div>
                        <p className="text-[11px] text-[var(--text-muted)] mt-0.5">Optimize AI speed while respecting provider rate limits.</p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={settings.turboSpeedMode === true}
                        aria-label="Turbo Speed Mode"
                        onClick={() => patch({ turboSpeedMode: !settings.turboSpeedMode })}
                        className={`q-turbo-toggle-button rounded-lg px-4 py-2 text-[12px] font-semibold flex items-center gap-2 shrink-0 ${
                          settings.turboSpeedMode === true ? 'q-turbo-toggle-on' : ''
                        }`}
                        style={{ background: settings.turboSpeedMode === true ? 'linear-gradient(135deg, #00b4ff, #0066ff)' : 'var(--surface)' }}
                      >
                        <span className="q-turbo-toggle-icon" aria-hidden="true"><Zap size={14} /></span>
                        <span className="q-turbo-toggle-text">{settings.turboSpeedMode === true ? 'ON' : 'OFF'}</span>
                        {settings.turboSpeedMode === true && <span className="q-turbo-pulse" aria-hidden="true" />}
                      </button>
                    </div>
                    {settings.turboSpeedMode === true && (
                      <div className="rounded-lg border border-[var(--accent)]/30 bg-[var(--accent-soft)] px-3 py-2 text-[11px] text-[var(--accent)] flex items-center gap-2">
                        <span className="shrink-0"><ArrowUpRight size={12} /></span>
                        <span>Turbo Speed is active. Adaptive pacing enabled with 250ms minimum interval floor. Provider limits (RPM/TPM/concurrency) still enforced. HTTP 429 with Retry-After handled automatically.</span>
                      </div>
                    )}
                  </div>

                  {/* Performance Mode */}
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-secondary)] p-4 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[14px] font-semibold text-[var(--text)] flex items-center gap-1.5">
                            <Gauge size={15} style={{color: 'var(--accent)'}} />
                            Performance Profile
                          </span>
                        </div>
                        <p className="text-[11px] text-[var(--text-muted)] mt-0.5">Select the default pacing profile when Turbo Speed is OFF.</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Performance mode">
                      {(['eco', 'balanced', 'turbo'] as const).map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          role="radio"
                          aria-checked={settings.performanceMode === mode}
                          onClick={() => patch({ performanceMode: mode })}
                          disabled={settings.turboSpeedMode === true}
                          className={`q-transition rounded-lg px-3 py-2.5 text-center border-2 text-[12px] font-medium ${
                            settings.performanceMode === mode
                              ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
                              : settings.turboSpeedMode === true
                              ? 'border-[var(--border)] text-[var(--text-muted)]/50 bg-[var(--surface)] cursor-not-allowed'
                              : 'border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--accent)] hover:text-[var(--text)]'
                          }`}
                        >
                          <div className="font-semibold capitalize">{mode}</div>
                          <div className="text-[10px] mt-0.5 opacity-80">
                            {mode === 'eco' && '6s interval'}
                            {mode === 'balanced' && '4s interval'}
                            {mode === 'turbo' && '1s interval'}
                          </div>
                        </button>
                      ))}
                    </div>
                    <p className="text-[10.5px] text-[var(--text-muted)]">
                      {settings.turboSpeedMode === true
                        ? 'Performance profile is overridden by Turbo Speed. Disable Turbo to use this setting.'
                        : 'Eco = conservative (6s), Balanced = default (4s), Turbo = aggressive (1s). Provider limits still apply.'}
                    </p>
                  </div>

                  {/* Request Pacing Mode */}
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-secondary)] p-4 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[14px] font-semibold text-[var(--text)] flex items-center gap-1.5">
                            <Activity size={15} style={{color: 'var(--accent)'}} />
                            Request Pacing
                          </span>
                        </div>
                        <p className="text-[11px] text-[var(--text-muted)] mt-0.5">How Quillix schedules outbound AI requests.</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Request pacing mode">
                      {(['adaptive', 'fixed'] as const).map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          role="radio"
                          aria-checked={settings.requestPacingMode === mode}
                          onClick={() => patch({ requestPacingMode: mode })}
                          disabled={settings.turboSpeedMode === true}
                          className={`q-transition rounded-lg px-3 py-2.5 text-center border-2 text-[12px] font-medium ${
                            settings.requestPacingMode === mode
                              ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
                              : settings.turboSpeedMode === true
                              ? 'border-[var(--border)] text-[var(--text-muted)]/50 bg-[var(--surface)] cursor-not-allowed'
                              : 'border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--accent)] hover:text-[var(--text)]'
                          }`}
                        >
                          <div className="font-semibold capitalize">{mode}</div>
                          <div className="text-[10px] mt-0.5 opacity-80">
                            {mode === 'adaptive' && 'Auto from headers'}
                            {mode === 'fixed' && 'Use profile interval'}
                          </div>
                        </button>
                      ))}
                    </div>
                    <p className="text-[10.5px] text-[var(--text-muted)]">
                      {settings.turboSpeedMode === true
                        ? 'Adaptive pacing is forced ON with Turbo Speed. Disable Turbo to change this setting.'
                        : 'Adaptive = reads x-ratelimit headers and Retry-After for dynamic spacing. Fixed = uses profile interval only.'}
                    </p>
                  </div>

                  {/* Live Provider Pacing Status */}
                  {rateLimitStatus && (
                    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-secondary)] p-4 space-y-2" data-testid="provider-pacing-live-status">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[12px] font-semibold text-[var(--text)] flex items-center gap-1.5">
                          <Activity size={14} style={{color: 'var(--accent)'}} />
                          Live Provider Pacing
                        </span>
                        <span className="text-[10px] font-semibold" style={{color: rateLimitStatus.offline ? 'var(--success)' : rateLimitStatus.waitingMs > 0 ? 'var(--warning)' : 'var(--success)'}}>
                          {rateLimitStatus.offline ? 'Ollama (local) · No cloud delay' : rateLimitStatus.waitingMs > 0 ? `Cooldown ${Math.ceil(rateLimitStatus.waitingMs / 1000)}s` : 'Ready'}
                        </span>
                      </div>
                      {!rateLimitStatus.offline && (
                        <p className="text-[11px] text-[var(--text-muted)]">
                          Effective interval: <span className="font-mono text-[var(--text)]">{Math.round(rateLimitStatus.minIntervalMs / 1000)}s</span>{' '}
                          · Queued: <span className="font-mono text-[var(--text)]">{rateLimitStatus.queuedRequests}</span>
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </section>
            </div>
          </section>

          {/* Agent section */}
          <section>
            <SectionTitle icon={<Bot size={13} />} label="Agent" />
            <div className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[12px] font-medium text-[var(--text)]" htmlFor="set-turns">
                    Max Autonomous Turns
                  </label>
                  <span className="font-mono text-[12px] font-bold" style={{ color: 'var(--accent)' }}>
                    {settings.maxAutonomousTurns}
                  </span>
                </div>
                <input
                  id="set-turns"
                  type="range"
                  min={1}
                  max={25}
                  value={settings.maxAutonomousTurns}
                  onChange={(e) => patch({ maxAutonomousTurns: parseInt(e.target.value, 10) })}
                  className="w-full cursor-pointer accent-[var(--accent)]"
                  style={{ accentColor: 'var(--accent)' }}
                />
                <p className="text-[11px] text-[var(--text-muted)] mt-1">
                  Maximum autonomous tool-execution iterations per prompt.
                </p>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[12px] font-medium text-[var(--text)]" htmlFor="set-temp">
                    Temperature
                  </label>
                  <span className="font-mono text-[12px] font-bold" style={{ color: 'var(--accent)' }}>
                    {settings.temperature.toFixed(2)}
                  </span>
                </div>
                <input
                  id="set-temp"
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={settings.temperature}
                  onChange={(e) => patch({ temperature: parseFloat(e.target.value) })}
                  className="w-full cursor-pointer"
                  style={{ accentColor: 'var(--accent)' }}
                />
                <p className="text-[11px] text-[var(--text-muted)] mt-1">
                  Lower values (0.1–0.3) give precise, deterministic code generation.
                </p>
              </div>

              <Toggle
                label="Terminal Approval"
                description="Dangerous terminal commands require explicit approval before execution."
                checked={settings.terminalApproval}
                onChange={(v) => patch({ terminalApproval: v })}
              />

              <Toggle
                label="Auto Apply Diffs"
                description="When OFF, file changes are staged and require your review before being written."
                checked={settings.autoApplyDiffs}
                onChange={(v) => patch({ autoApplyDiffs: v })}
              />

              <Toggle
                label="Git Authorization"
                description="Commits and restores require explicit authorization."
                checked={settings.gitApproval}
                onChange={(v) => patch({ gitApproval: v })}
              />
            </div>
          </section>

          {/* Appearance */}
          <section>
            <SectionTitle icon={<Palette size={13} />} label="Appearance" />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => patch({ theme: t.id })}
                  aria-pressed={settings.theme === t.id}
                  className={`q-transition rounded-2xl border p-2.5 text-left ${
                    settings.theme === t.id
                      ? 'border-[var(--accent)] ring-2 ring-[var(--accent-soft)]'
                      : 'border-[var(--border)] hover:border-[var(--text-muted)]'
                  }`}
                >
                  <div className="flex gap-1 mb-2">
                    {t.preview.map((color, i) => (
                      <span
                        key={i}
                        className="w-5 h-5 rounded-md border border-black/10"
                        style={{ background: color }}
                        aria-hidden="true"
                      />
                    ))}
                  </div>
                  <span className="text-[12px] font-medium text-[var(--text)]">{t.label}</span>
                </button>
              ))}
            </div>
            <p className="text-[11px] text-[var(--text-muted)] mt-2">Your theme is remembered across restarts.</p>

            <div className="mt-4">
              <SectionTitle icon={<Waves size={13} />} label="Motion" />
              <div className="grid grid-cols-3 gap-2.5">
                {ANIMATION_LEVELS.map((option) => (
                  <button
                    key={option.id}
                    onClick={() => patch({ animationLevel: option.id })}
                    aria-pressed={settings.animationLevel === option.id}
                    className={`q-transition rounded-2xl border p-2.5 text-left ${
                      settings.animationLevel === option.id
                        ? 'border-[var(--accent)] ring-2 ring-[var(--accent-soft)]'
                        : 'border-[var(--border)] hover:border-[var(--text-muted)]'
                    }`}
                  >
                    <span className="flex items-center text-[var(--text)]" aria-hidden="true">{option.icon}</span>
                    <span className="block mt-2 text-[12px] font-medium text-[var(--text)]">{option.label}</span>
                    <span className="block text-[10px] leading-tight text-[var(--text-muted)]">{option.hint}</span>
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-[var(--text-muted)] mt-2">
                Max keeps the full designed motion, Minimal keeps short fades without ambient loops, and None disables animation everywhere.
              </p>
            </div>
          </section>

          {error && (
            <p className="text-[12px] rounded-xl border px-3 py-2" style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }} role="alert">
              {error}
            </p>
          )}
        </div>

        {/* Footer */}
        <motion.div className="px-5 py-3.5 border-t border-[var(--border)] flex items-center justify-between shrink-0" variants={slideAndFadeVariants} initial="hidden" animate="visible" custom="up">
          <span className="text-[11px] text-[var(--text-muted)] flex items-center gap-1.5">
            {settings.offlineMode ? <CloudOff size={12} /> : <Cloud size={12} />}
            {saving ? 'Saving…' : 'Settings save automatically'}
          </span>
          <motion.button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-white text-[13px] font-semibold q-transition"
            style={{ background: 'var(--accent)' }}
            whileHover={{ scale: 1.03, y: -1 }}
            whileTap={{ scale: 0.97 }}
          >
            Done
          </motion.button>
        </motion.div>
      </motion.div>
    </motion.div>
  </AnimatePresence>
);
};
