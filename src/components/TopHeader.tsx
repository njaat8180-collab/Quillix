import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Cpu, Moon, Sun, Cloud, CloudOff, Settings, LayoutDashboard, MessageSquare, Zap, PanelsTopLeft, Minus, Maximize2, Minimize2, Gauge, Sparkles } from 'lucide-react';
import { useTheme } from '../theme.js';
import { QuillixTheme } from '../shared/types.js';
import { QuillixMark } from './QuillixMark.js';
import {
  tabSwitchVariants,
  staggerContainerFastVariants,
  scaleSpringVariants,
  ambientGlowPulseVariants,
  fadeVariants,
} from '../animations/index.js';

export type OllamaState =
  | { state: 'connected'; model: string; details?: string }
  | { state: 'model-missing'; model: string; details: string }
  | { state: 'disconnected'; details: string }
  | { state: 'unknown' };

/** Primary navigation — intentionally minimal: Dashboard, Chat, Action. */
export type MainView = 'dashboard' | 'workspace' | 'chat' | 'action';

interface TopHeaderProps {
  ollama: OllamaState;
  offlineMode: boolean;
  provider?: string;
  sarvamKeyConfigured?: boolean;
  sarvamConnection?: 'untested' | 'checking' | 'connected' | 'failed';
  universalConnection?: 'untested' | 'checking' | 'connected' | 'failed';
  openaiConnection?: 'untested' | 'checking' | 'connected' | 'failed';
  grokConnection?: 'untested' | 'checking' | 'connected' | 'failed';
  groqConnection?: 'untested' | 'checking' | 'connected' | 'failed';
  nvidiaConnection?: 'untested' | 'checking' | 'connected' | 'failed';
  activeView: MainView;
  onNavigate: (view: MainView) => void;
  onOpenSettings: () => void;
  /** Synchronized Turbo Speed control beside Agent and Chat in Studio and on Home. */
  turboSpeedMode?: boolean;
  onToggleTurboSpeed?: (next: boolean) => void;
}

const THEME_ORDER: QuillixTheme[] = ['dark', 'light', 'gray', 'gradient'];
const THEME_LABELS: Record<QuillixTheme, string> = {
  dark: 'Dark',
  light: 'Light',
  gray: 'Gray',
  gradient: 'Gradient',
};

const NAV_ITEMS: Array<{ id: MainView; label: string; icon: React.ReactNode }> = [
  { id: 'dashboard', label: 'Home', icon: <LayoutDashboard size={14} /> },
  { id: 'workspace', label: 'Studio', icon: <PanelsTopLeft size={14} /> },
  { id: 'chat', label: 'Chat', icon: <MessageSquare size={14} /> },
  { id: 'action', label: 'Tools', icon: <Zap size={14} /> },
];

export const TopHeader: React.FC<TopHeaderProps> = ({
  ollama,
  offlineMode,
  provider = 'ollama',
  sarvamKeyConfigured = false,
  sarvamConnection = 'untested', universalConnection = 'untested', openaiConnection = 'untested', grokConnection = 'untested', groqConnection = 'untested', nvidiaConnection = 'untested',
  activeView,
  onNavigate,
  onOpenSettings,
  turboSpeedMode = false,
  onToggleTurboSpeed,
}) => {
  const { theme, setTheme } = useTheme();
  const [maximized, setMaximized] = React.useState(false);

  React.useEffect(() => {
    window.quillixDesktop?.isMaximized().then(setMaximized).catch(() => undefined);
  }, []);

  const cycleTheme = () => {
    const next = THEME_ORDER[(THEME_ORDER.indexOf(theme) + 1) % THEME_ORDER.length];
    setTheme(next);
  };

  const isSarvam = provider === 'sarvam';
  const isUniversal = provider === 'universal';
  const isOpenAI = provider === 'openai';
  const isGrok = provider === 'grok';
  const isGroq = provider === 'groq';
  const isNvidia = provider === 'nvidia';
  const activeCloudName = isNvidia ? 'NVIDIA NIM' : isGrok ? 'Grok' : isGroq ? 'Groq' : isOpenAI ? 'OpenAI' : isUniversal ? 'Universal API' : 'Sarvam';
  const activeCloudConnection = isNvidia ? nvidiaConnection : isGrok ? grokConnection : isGroq ? groqConnection : isOpenAI ? openaiConnection : isUniversal ? universalConnection : sarvamConnection;
  const ProviderTypeIcon: React.FC<{ provider: string; className?: string }> = ({ provider, className = '' }) => {
    switch (provider) {
      case 'ollama':
        return <Cpu size={14} className={className} />;
      case 'openai':
      case 'groq':
      case 'grok':
      case 'nvidia':
      case 'universal':
        return <Cloud size={14} className={className} />;
      case 'sarvam':
        return <Sparkles size={14} className={className} />;
      default:
        return <Cloud size={14} className={className} />;
    }
  };

  const ProviderTypeBadge: React.FC<{ provider: string }> = ({ provider }) => {
    const isLocal = provider === 'ollama';
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium"
        style={{
          background: isLocal ? 'color-mix(in srgb, var(--success) 16%, transparent)' : 'var(--accent-soft)',
          color: isLocal ? 'var(--success)' : 'var(--accent)',
          border: isLocal ? '1px solid color-mix(in srgb, var(--success) 35%, transparent)' : '1px solid color-mix(in srgb, var(--accent) 35%, transparent)',
        }}>
        {isLocal ? <Cpu size={10} /> : <Cloud size={10} />}
        {isLocal ? 'Local' : 'Cloud'}
      </span>
    );
  };
  const statusLabel = (isOpenAI || isUniversal || isGrok || isGroq || isNvidia) ? (offlineMode ? `${activeCloudName} · Offline Mode` : activeCloudConnection==='connected' ? `${activeCloudName} · Verified` : activeCloudConnection==='failed' ? `${activeCloudName} · Test failed` : activeCloudConnection==='checking' ? `${activeCloudName} · Checking…` : `${activeCloudName} · Not verified`) : isSarvam ? (offlineMode ? 'Sarvam blocked · Offline Mode' : !sarvamKeyConfigured ? 'Sarvam · Add API key' : sarvamConnection === 'connected' ? 'Sarvam · Verified' : sarvamConnection === 'failed' ? 'Sarvam · Test failed' : sarvamConnection === 'checking' ? 'Testing Sarvam…' : 'Sarvam · Not tested') :
    ollama.state === 'connected'
      ? `Ollama · ${ollama.model || 'Connected'}`
      : ollama.state === 'model-missing'
        ? 'Model Not Found'
        : ollama.state === 'disconnected'
          ? 'Ollama Disconnected'
          : 'Ollama Not Running';

  const statusColor = (isOpenAI || isUniversal || isGrok || isGroq || isNvidia) ? (activeCloudConnection==='connected'&&!offlineMode?'var(--success)':activeCloudConnection==='failed'?'var(--danger)':'var(--warning)') : isSarvam
    ? (sarvamConnection === 'connected' && !offlineMode ? 'var(--success)' : sarvamConnection === 'failed' ? 'var(--danger)' : 'var(--warning)')
    : ollama.state === 'connected' ? 'var(--success)' : ollama.state === 'unknown' ? 'var(--text-muted)' : 'var(--danger)';

  const badgeLabel = statusLabel;
  const badgeColor = statusColor;
  return (
    <header className="q-topbar h-[64px] flex items-center justify-between gap-2 px-3 sm:px-5 border-b border-[var(--border)] select-none shrink-0">
      {/* Brand */}
      <div className="flex items-center gap-3 min-w-0">
        <div
          className="q-brand-mark w-9 h-9 rounded-xl flex items-center justify-center text-white shrink-0"
          aria-hidden="true"
        >
          <QuillixMark size={24} />
        </div>
        <div className="leading-tight min-w-0 hidden sm:block">
          <div className="q-atlas-wordmark">quillix<span>✳</span></div>
          <div className="q-atlas-brand-caption">A SPACE FOR WHAT'S NEXT</div>
        </div>
      </div>

      {/* Primary navigation: Dashboard | Chat | Action */}
      <nav
        className="flex items-center gap-0.5 sm:gap-1 p-1 rounded-2xl border border-[var(--border)] bg-[var(--surface-secondary)]"
        aria-label="Primary"
      >
        <AnimatePresence>
          {NAV_ITEMS.map((item) => {
            const isActive = activeView === item.id;
            return (
              <motion.button
                key={item.id}
                layoutId={`nav-${item.id}`}
                onClick={() => onNavigate(item.id)}
                aria-current={isActive ? 'page' : undefined}
                aria-label={item.label}
                className={`q-nav-item flex items-center gap-1.5 px-2.5 sm:px-3.5 py-2 rounded-xl text-[12px] font-semibold ${
                  isActive ? 'text-white' : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--hover)]'
                }`}
                variants={tabSwitchVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
                whileHover={isActive ? undefined : { scale: 1.05, y: -1 }}
                whileTap={{ scale: 0.95 }}
              >
                <span className="q-atlas-nav-no">0{NAV_ITEMS.indexOf(item) + 1}</span>{item.icon}
                {item.label}
              </motion.button>
            );
          })}
        </AnimatePresence>
      </nav>

      {/* Right side */}
      <div className="flex items-center gap-1.5 sm:gap-2.5">
        {/* Offline Mode badge */}
        <span
          className="hidden xl:inline-flex items-center gap-2 text-[11px] font-medium px-3 py-1 rounded-full border"
          style={{
            color: offlineMode ? 'var(--success)' : 'var(--warning)',
            borderColor: offlineMode ? 'var(--success)' : 'var(--warning)',
            background: 'transparent',
          }}
          title={offlineMode ? 'Offline Mode blocks cloud requests. Local Ollama is permitted.' : 'Offline Mode is off; cloud providers may be used if selected.'}
        >
          {offlineMode ? <CloudOff size={12} /> : <Cloud size={12} />}
          Offline Mode: {offlineMode ? 'ON' : 'OFF'}
        </span>

        {/* Ollama status pill */}
        <motion.span
          className="q-transition hidden md:inline-flex items-center gap-2 text-[11px] font-medium px-3 py-1 rounded-full border border-[var(--border)]"
          style={{ color: badgeColor }}
          title={provider === 'ollama' && ollama.state === 'disconnected' && 'details' in ollama ? ollama.details : badgeLabel}
          aria-label={`AI provider status: ${badgeLabel}`}
          variants={staggerContainerFastVariants}
          initial="hidden"
          animate="visible"
        >
          <Cpu size={12} />
          <span className="hidden xl:inline">{badgeLabel}</span>
          <motion.span className="q-status-dot w-1.5 h-1.5 rounded-full" style={{ background: badgeColor }} variants={ambientGlowPulseVariants} initial="hidden" animate="visible" aria-hidden="true" />
        </motion.span>

        {/* Theme selector */}
        <button
          onClick={cycleTheme}
          className="q-transition p-2 rounded-lg text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--hover)]"
          title={`Theme: ${THEME_LABELS[theme]} — click to change`}
          aria-label={`Change theme (current: ${THEME_LABELS[theme]})`}
        >
          {theme === 'light' ? <Sun size={16} /> : <Moon size={16} />}
          <span className="sr-only">Change theme</span>
        </button>

        {window.quillixDesktop && <>
          <button onClick={() => window.quillixDesktop?.minimize()} className="q-transition p-2 rounded-lg text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--hover)]" title="Minimize NUVRO AI" aria-label="Minimize NUVRO AI"><Minus size={16} /></button>
          <button onClick={async () => setMaximized(await window.quillixDesktop!.toggleMaximize())} className="q-transition p-2 rounded-lg text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--hover)]" title={maximized ? 'Restore NUVRO AI' : 'Maximize NUVRO AI'} aria-label={maximized ? 'Restore NUVRO AI' : 'Maximize NUVRO AI'}>{maximized ? <Minimize2 size={15} /> : <Maximize2 size={15} />}</button>
        </>}

        {/* Settings */}
        <button
          onClick={onOpenSettings}
          className="q-transition p-2 rounded-lg text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--hover)]"
          title="Settings"
          aria-label="Open settings"
        >
          <Settings size={16} />
        </button>

        {/* Synchronized Turbo Speed control beside Agent and Chat on Home and in Studio. */}
        {onToggleTurboSpeed && (
          <button
            onClick={() => onToggleTurboSpeed(turboSpeedMode !== true)}
            aria-pressed={turboSpeedMode === true}
            aria-label={turboSpeedMode === true ? 'Turbo Speed ON: adaptive pacing active' : 'Turbo Speed OFF: conservative pacing'}
            title={turboSpeedMode === true ? 'Turbo Speed ON: adaptive pacing active, respects provider limits' : 'Turbo Speed OFF: conservative pacing'}
            className={`q-turbo-header-button ${turboSpeedMode === true ? 'q-turbo-header-on' : ''}`}
          >
            <Zap size={15} />
            <span className="q-turbo-header-state">{turboSpeedMode === true ? 'TURBO' : 'Turbo'}</span>
            {turboSpeedMode === true && <span className="q-turbo-pulse" aria-hidden="true" />}
          </button>
        )}
      </div>
    </header>
  );
};
