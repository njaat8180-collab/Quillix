import React, { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  ChevronRight, 
  ChevronLeft, 
  Check, 
  X, 
  FolderOpen, 
  Cloud, 
  Cpu, 
  Zap, 
  Terminal, 
  MessageSquare,
  Settings,
  ArrowRight,
  HelpCircle,
  ExternalLink,
  Download,
  Play,
  Shield,
  Sparkles
} from 'lucide-react';
import { api } from '../services/apiBridge.js';
import { QuillixSettings } from '../shared/types.js';
import { useTheme } from '../theme.js';

interface OnboardingFlowProps {
  settings: QuillixSettings;
  onSettingsChanged: (settings: Partial<QuillixSettings>) => void;
  onComplete: () => void;
  onSkip: () => void;
}

type OnboardingStep = 
  | 'welcome'
  | 'workspace'
  | 'provider'
  | 'modes'
  | 'shortcuts'
  | 'complete';

const STEPS: Array<{ id: OnboardingStep; title: string; icon: React.ReactNode }> = [
  { id: 'welcome', title: 'Welcome', icon: <Sparkles size={20} /> },
  { id: 'workspace', title: 'Workspace', icon: <FolderOpen size={20} /> },
  { id: 'provider', title: 'AI Provider', icon: <Cpu size={20} /> },
  { id: 'modes', title: 'Chat Modes', icon: <MessageSquare size={20} /> },
  { id: 'shortcuts', title: 'Shortcuts', icon: <Zap size={20} /> },
  { id: 'complete', title: 'Ready!', icon: <Check size={20} /> },
];

const stepVariants = {
  hidden: { opacity: 0, x: 50, scale: 0.95 },
  visible: { opacity: 1, x: 0, scale: 1, transition: { type: 'spring', stiffness: 200, damping: 25 } as const },
  exit: { opacity: 0, x: -50, scale: 0.95, transition: { duration: 0.2 } },
};

const cardVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3 } },
  exit: { opacity: 0, y: -20, transition: { duration: 0.2 } },
};

export const OnboardingFlow: React.FC<OnboardingFlowProps> = ({ 
  settings, 
  onSettingsChanged, 
  onComplete, 
  onSkip 
}) => {
  const { theme } = useTheme();
  const [currentStep, setCurrentStep] = useState<OnboardingStep>('welcome');
  const [selectedProvider, setSelectedProvider] = useState<'ollama' | 'openai' | 'universal' | 'sarvam' | 'nvidia'>('ollama');
  const [workspacePath, setWorkspacePath] = useState('');
  const [workspaceError, setWorkspaceError] = useState('');
  const [testingProvider, setTestingProvider] = useState(false);
  const [providerTestResult, setProviderTestResult] = useState<'idle' | 'success' | 'error'>('idle');
  const [providerTestError, setProviderTestError] = useState('');

  const currentIndex = STEPS.findIndex(s => s.id === currentStep);
  const canGoNext = currentIndex < STEPS.length - 1;
  const canGoBack = currentIndex > 0;

  const handleNext = useCallback(() => {
    if (canGoNext) {
      setCurrentStep(STEPS[currentIndex + 1].id);
    }
  }, [currentIndex]);

  const handleBack = useCallback(() => {
    if (canGoBack) {
      setCurrentStep(STEPS[currentIndex - 1].id);
    }
  }, [currentIndex]);

  const handleSkip = useCallback(() => {
    onSettingsChanged({ hasCompletedOnboarding: true });
    onSkip();
  }, [onSettingsChanged, onSkip]);

  const handleComplete = useCallback(() => {
    onSettingsChanged({ hasCompletedOnboarding: true });
    onComplete();
  }, [onSettingsChanged, onComplete]);

  const handleSelectWorkspace = async () => {
    setWorkspaceError('');
    try {
      const path = await api.selectNativeFolder();
      if (path) {
        setWorkspacePath(path);
        onSettingsChanged({ workspaceRoot: path });
      } else {
        setWorkspaceError('No folder selected');
      }
    } catch (err) {
      setWorkspaceError(err instanceof Error ? err.message : 'Failed to open folder picker');
    }
  };

  const handleTestProvider = async () => {
    setTestingProvider(true);
    setProviderTestResult('idle');
    setProviderTestError('');
    try {
      let res;
      const baseUrl = '/api/providers';
      switch (selectedProvider) {
        case 'ollama':
          res = await api.getOllamaStatus(settings.model);
          break;
        case 'openai':
          if (!settings.openaiKeyConfigured) throw new Error('OpenAI API key not configured');
          res = await fetch(`${baseUrl}/openai/test`, { method: 'POST' }).then(r => r.json());
          break;
        case 'universal':
          if (!settings.universalKeyConfigured) throw new Error('Universal API key not configured');
          res = await fetch(`${baseUrl}/universal/test`, { method: 'POST' }).then(r => r.json());
          break;
        case 'sarvam':
          if (!settings.sarvamKeyConfigured) throw new Error('Sarvam API key not configured');
          res = await fetch(`${baseUrl}/sarvam/test`, { method: 'POST' }).then(r => r.json());
          break;
        case 'nvidia':
          if (!settings.nvidiaKeyConfigured) throw new Error('NVIDIA API key not configured');
          res = await fetch(`${baseUrl}/nvidia/test`, { method: 'POST' }).then(r => r.json());
          break;
      }
      if (res?.success) {
        setProviderTestResult('success');
      } else {
        setProviderTestResult('error');
        setProviderTestError(res?.error || 'Connection test failed');
      }
    } catch (err) {
      setProviderTestResult('error');
      setProviderTestError(err instanceof Error ? err.message : 'Connection test failed');
    } finally {
      setTestingProvider(false);
    }
  };

  const renderStep = () => {
    switch (currentStep) {
      case 'welcome':
        return (
          <motion.div variants={cardVariants} className="text-center space-y-6">
            <div className="w-20 h-20 mx-auto rounded-2xl flex items-center justify-center" style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}>
              <Sparkles size={32} />
            </div>
            <h2 className="text-2xl font-bold">Welcome to NUVRO AI</h2>
            <p className="text-[var(--text-muted)] max-w-md mx-auto leading-relaxed">
              NUVRO AI is your local-first AI coding agent. It runs on your machine with Ollama, 
              connects to cloud providers when you need them, and gives you a full development 
              environment: editor, terminal, Git, and autonomous agent workflows.
            </p>
            <div className="grid grid-cols-3 gap-3 text-sm" style={{ marginTop: '1rem' }}>
              <div className="p-3 rounded-xl bg-[var(--surface)] border border-[var(--border)]">
                <Cpu size={18} className="mx-auto mb-2" style={{ color: 'var(--accent)' }} />
                <p className="font-medium">Local First</p>
                <p className="text-[var(--text-muted)] text-xs">Ollama on your machine</p>
              </div>
              <div className="p-3 rounded-xl bg-[var(--surface)] border border-[var(--border)]">
                <Cloud size={18} className="mx-auto mb-2" style={{ color: 'var(--accent)' }} />
                <p className="font-medium">Cloud Ready</p>
                <p className="text-[var(--text-muted)] text-xs">OpenAI, Universal, Sarvam, NVIDIA</p>
              </div>
              <div className="p-3 rounded-xl bg-[var(--surface)] border border-[var(--border)]">
                <Terminal size={18} className="mx-auto mb-2" style={{ color: 'var(--accent)' }} />
                <p className="font-medium">Full Workbench</p>
                <p className="text-[var(--text-muted)] text-xs">Editor, Terminal, Git, Agent</p>
              </div>
            </div>
          </motion.div>
        );

      case 'workspace':
        return (
          <motion.div variants={cardVariants} className="space-y-6">
            <h2 className="text-xl font-bold">Choose Your Workspace</h2>
            <p className="text-[var(--text-muted)]">
              NUVRO AI works with a folder on your computer. This is where your code lives and where 
              the agent will read, write, and run files.
            </p>
            <div className="space-y-3">
              <button
                onClick={handleSelectWorkspace}
                disabled={!!workspacePath}
                className="w-full px-4 py-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] text-left hover:border-[var(--accent)] hover:bg-[var(--accent)]/5 transition-colors flex items-center gap-3"
                style={{ background: workspacePath ? 'var(--success)/10' : 'var(--surface)', borderColor: workspacePath ? 'var(--success)' : 'var(--border)' }}
              >
                <FolderOpen size={20} style={{ color: workspacePath ? 'var(--success)' : 'var(--accent)' }} />
                <div className="flex-1 text-left">
                  <p className="font-medium">{workspacePath || 'Select a folder for your workspace'}</p>
                  <p className="text-xs text-[var(--text-muted)]">Or create a new project after setup</p>
                </div>
                {workspacePath && <Check size={20} style={{ color: 'var(--success)' }} />}
              </button>
              {workspaceError && (
                <p className="text-sm text-[var(--danger)]" role="alert">{workspaceError}</p>
              )}
              {!workspacePath && (
                <p className="text-sm text-[var(--text-muted)]">
                  Tip: Pick an existing project folder, or skip and create a new project from the dashboard.
                </p>
              )}
            </div>
            {workspacePath && (
              <motion.div className="p-3 rounded-xl bg-[var(--success)]/10 border border-[var(--success)]/30" style={{ color: 'var(--success)' }}>
                <p className="font-medium flex items-center gap-2"><Check size={16} /> Workspace ready: {workspacePath}</p>
              </motion.div>
            )}
          </motion.div>
        );

      case 'provider':
        return (
          <motion.div variants={cardVariants} className="space-y-6">
            <h2 className="text-xl font-bold">Choose Your AI Provider</h2>
            <p className="text-[var(--text-muted)]">
              NUVRO AI runs locally with Ollama by default. Add a cloud provider for more models 
              or when you need extra capacity.
            </p>
            
            <div className="grid grid-cols-2 gap-3">
              {[
                { id: 'ollama', label: 'Ollama (Local)', desc: 'Free, private, runs on your machine', icon: <Cpu size={20} />, needsKey: false, recommended: true },
                { id: 'openai', label: 'OpenAI', desc: 'GPT-4o, GPT-4o-mini, o1 models', icon: <Cloud size={20} />, needsKey: true },
                { id: 'universal', label: 'Universal API', desc: 'OpenRouter, Together, custom endpoints', icon: <Zap size={20} />, needsKey: true },
                { id: 'sarvam', label: 'Sarvam', desc: 'Indic language models', icon: <Sparkles size={20} />, needsKey: true },
                { id: 'nvidia', label: 'NVIDIA NIM', desc: 'Llama, Nemotron, optimized on NVIDIA', icon: <Shield size={20} />, needsKey: true },
              ].map(provider => (
                <button
                  key={provider.id}
                  onClick={() => { setSelectedProvider(provider.id as any); setProviderTestResult('idle'); }}
                  className={`p-4 rounded-xl border-2 transition-all text-left ${selectedProvider === provider.id ? 'border-[var(--accent)] bg-[var(--accent)]/5' : 'border-[var(--border)] hover:border-[var(--accent)]/50'}`}
                >
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: selectedProvider === provider.id ? 'var(--accent)' : 'var(--surface)', color: selectedProvider === provider.id ? 'var(--accent-ink)' : 'var(--text-muted)' }}>
                      {provider.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium truncate">{provider.label}</p>
                        {provider.recommended && <span className="px-1.5 py-0.5 text-[10px] rounded-full" style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}>Recommended</span>}
                      </div>
                      <p className="text-sm text-[var(--text-muted)] truncate">{provider.desc}</p>
                      {provider.needsKey && settings[`${provider.id}KeyConfigured` as keyof QuillixSettings] && (
                        <span className="inline-flex items-center gap-1 text-xs" style={{ color: 'var(--success)' }}><Check size={10} /> Key configured</span>
                      )}
                    </div>
                    {selectedProvider === provider.id && <Check size={20} style={{ color: 'var(--accent)' }} />}
                  </div>
                </button>
              ))}
            </div>

            <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] space-y-3">
              <div className="flex items-center gap-3">
                <button
                  onClick={handleTestProvider}
                  disabled={testingProvider}
                  className="px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2"
                  style={{ background: selectedProvider === 'ollama' ? 'var(--surface)' : 'var(--accent)', color: selectedProvider === 'ollama' ? 'var(--text)' : 'var(--accent-ink)', border: selectedProvider === 'ollama' ? '1px solid var(--border)' : 'none' }}
                >
                  {testingProvider ? (
                    <>
                      <div className="w-4 h-4 border-2 border-current/30 border-t-[var(--accent)] rounded-full animate-spin" />
                      Testing...
                    </>
                  ) : (
                    <>
                      <Play size={14} />
                      Test {selectedProvider === 'ollama' ? 'Ollama Connection' : `${selectedProvider.charAt(0).toUpperCase() + selectedProvider.slice(1)} Connection`}
                    </>
                  )}
                </button>
                {providerTestResult === 'success' && (
                  <span className="flex items-center gap-1 text-sm" style={{ color: 'var(--success)' }}>
                    <Check size={14} /> Connected successfully
                  </span>
                )}
                {providerTestResult === 'error' && (
                  <span className="flex items-center gap-1 text-sm" style={{ color: 'var(--danger)' }}>
                    <X size={14} /> {providerTestError}
                  </span>
                )}
              </div>
              {selectedProvider === 'ollama' && (
                <p className="text-sm text-[var(--text-muted)]">
                  Make sure Ollama is running: <code className="bg-[var(--bg)] px-1 rounded">ollama serve</code>. 
                  Default model: <code className="bg-[var(--bg)] px-1 rounded">qwen2.5-coder:3b</code>.
                </p>
              )}
              {selectedProvider !== 'ollama' && !settings[`${selectedProvider}KeyConfigured` as keyof QuillixSettings] && (
                <p className="text-sm text-[var(--warning)] flex items-center gap-1">
                  <Shield size={12} /> Add your API key in Settings → Providers after setup
                </p>
              )}
            </div>
          </motion.div>
        );

      case 'modes':
        return (
          <motion.div variants={cardVariants} className="space-y-6">
            <h2 className="text-xl font-bold">Understand Chat Modes</h2>
            <p className="text-[var(--text-muted)]">
              NUVRO AI has four modes. Switch between them in the composer or with <kbd className="px-1.5 py-0.5 rounded bg-[var(--bg)] border border-[var(--border)] text-[11px]">Cmd+M</kbd>.
            </p>
            
            <div className="space-y-3">
              {[
                { id: 'chat', label: 'Chat', desc: 'Ask questions, get explanations, no code changes', icon: <MessageSquare size={18} />, color: 'var(--accent)', key: 'Chat' },
                { id: 'agent', label: 'Agent', desc: 'Autonomous: reads, writes, runs tests, fixes errors', icon: <Zap size={18} />, color: 'var(--success)', key: 'Agent' },
                { id: 'plan', label: 'Plan', desc: 'Analyze and create implementation plans', icon: <Settings size={18} />, color: 'var(--warning)', key: 'Plan' },
                { id: 'debug', label: 'Debug', desc: 'Investigate errors and propose fixes', icon: <Terminal size={18} />, color: 'var(--danger)', key: 'Debug' },
              ].map(mode => (
                <div key={mode.id} className="p-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] flex items-start gap-3 hover:border-[var(--accent)]/50 transition-colors">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: `${mode.color}/15`, color: mode.color }}>
                    {mode.icon}
                  </div>
                  <div className="flex-1">
                    <p className="font-medium">{mode.label} Mode</p>
                    <p className="text-sm text-[var(--text-muted)]">{mode.desc}</p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      <kbd className="px-2 py-0.5 rounded text-[10px] bg-[var(--bg)] border border-[var(--border)]">Cmd+M</kbd>
                      <span className="px-2 py-0.5 rounded text-[10px] text-[var(--text-muted)]">→ {mode.key}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="p-3 rounded-xl bg-[var(--accent)]/10 border border-[var(--accent)]/30">
              <p className="text-sm flex items-start gap-2">
                <Sparkles size={14} style={{ color: 'var(--accent)', marginTop: 2 }} />
                <span><strong>Start with Chat mode</strong> to explore. Switch to Agent when you want the AI to modify your codebase.</span>
              </p>
            </div>
          </motion.div>
        );

      case 'shortcuts':
        return (
          <motion.div variants={cardVariants} className="space-y-6">
            <h2 className="text-xl font-bold">Essential Shortcuts</h2>
            <p className="text-[var(--text-muted)]">
              Press <kbd className="px-1.5 py-0.5 rounded bg-[var(--bg)] border border-[var(--border)] text-[11px]">Cmd+K</kbd> anytime to open the Command Palette with all actions.
            </p>
            
            <div className="space-y-2">
              {[
                { keys: ['Cmd', 'K'], desc: 'Open Command Palette' },
                { keys: ['Cmd', 'M'], desc: 'Cycle Chat Modes' },
                { keys: ['Cmd', 'Shift', 'P'], desc: 'Quick Connect / Provider Setup' },
                { keys: ['Cmd', 'B'], desc: 'Build & Test Project' },
                { keys: ['Cmd', '`'], desc: 'Toggle Terminal' },
                { keys: ['Cmd', 'E'], desc: 'Open File Explorer' },
                { keys: ['Cmd', 'Shift', 'E'], desc: 'Open Settings' },
                { keys: ['Cmd', '/'], desc: 'Toggle Sidebar' },
                { keys: ['Ctrl', 'Space'], desc: 'Trigger Inline Completion (in editor)' },
              ].map((item, i) => (
                <div key={i} className="flex items-center gap-3 p-3 rounded-xl bg-[var(--surface)] border border-[var(--border)]">
                  <div className="flex items-center gap-1">
                    {item.keys.map((k, ki) => (
                      <kbd key={ki} className="px-2 py-1 rounded text-[11px] font-mono bg-[var(--bg)] border border-[var(--border)]">{k}</kbd>
                    ))}
                  </div>
                  <p className="text-sm text-[var(--text-muted)]">{item.desc}</p>
                </div>
              ))}
            </div>
          </motion.div>
        );

      case 'complete':
        return (
          <motion.div variants={cardVariants} className="text-center space-y-6">
            <div className="w-24 h-24 mx-auto rounded-full flex items-center justify-center" style={{ background: 'var(--success)/15', color: 'var(--success)' }}>
              <Check size={40} />
            </div>
            <h2 className="text-2xl font-bold">You're Ready!</h2>
            <p className="text-[var(--text-muted)] max-w-md mx-auto leading-relaxed">
              NUVRO AI is set up and ready to go. Open a workspace, pick a mode, and start coding 
              with your AI pair programmer.
            </p>
            <div className="grid grid-cols-2 gap-3 max-w-md mx-auto">
              <button 
                onClick={handleComplete}
                className="px-4 py-3 rounded-xl font-semibold transition-colors flex items-center justify-center gap-2"
                style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}
              >
                <ArrowRight size={18} /> Start Coding
              </button>
              <button 
                onClick={() => { onSettingsChanged({ hasCompletedOnboarding: true }); onComplete(); }}
                className="px-4 py-3 rounded-xl font-semibold transition-colors flex items-center justify-center gap-2 border border-[var(--border)]"
                style={{ background: 'var(--surface)', color: 'var(--text)' }}
              >
                <ExternalLink size={18} /> Open Dashboard
              </button>
            </div>
          </motion.div>
        );
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}>
      <AnimatePresence mode="wait">
        <motion.div
          key={currentStep}
          variants={stepVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
          className="w-full max-w-2xl rounded-2xl overflow-hidden"
          style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)' }}
        >
          {/* Progress Header */}
          <div className="px-6 py-4 border-b border-[var(--border)]">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">Setup Wizard</h3>
              <button 
                onClick={handleSkip}
                className="p-1 rounded-lg hover:bg-[var(--surface)] text-[var(--text-muted)] transition-colors"
                aria-label="Skip onboarding"
              >
                <X size={18} />
              </button>
            </div>
            <div className="flex items-center gap-2 overflow-x-auto pb-2">
              {STEPS.map((step, i) => (
                <div key={step.id} className="flex items-center gap-1.5 flex-shrink-0">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-all ${
                    i < currentIndex ? 'bg-[var(--success)] text-[var(--success-ink)]' :
                    i === currentIndex ? 'bg-[var(--accent)] text-[var(--accent-ink)]' :
                    'bg-[var(--surface)] text-[var(--text-muted)] border border-[var(--border)]'
                  }`}>
                    {i < currentIndex ? <Check size={14} /> : step.icon}
                  </div>
                  {i < STEPS.length - 1 && (
                    <div className={`w-12 h-0.5 rounded transition-colors hidden sm:block ${
                      i < currentIndex ? 'bg-[var(--success)]' : 'bg-[var(--border)]'
                    }`} />
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Step Content */}
          <div className="p-6 max-h-[60vh] overflow-y-auto">
            {renderStep()}
          </div>

          {/* Navigation Footer */}
          <div className="px-6 py-4 border-t border-[var(--border)] flex items-center justify-between gap-3">
            <button
              onClick={handleBack}
              disabled={!canGoBack}
              className="px-4 py-2 rounded-xl font-medium transition-colors flex items-center gap-2 border border-[var(--border)] disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: 'var(--surface)', color: 'var(--text)' }}
            >
              <ChevronLeft size={16} /> Back
            </button>
            <div className="flex-1" />
            {currentStep === 'complete' ? (
              <button
                onClick={handleComplete}
                className="px-6 py-2.5 rounded-xl font-semibold transition-colors flex items-center gap-2"
                style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}
              >
                Start Coding <ArrowRight size={16} />
              </button>
            ) : (
              <button
                onClick={handleNext}
                className="px-6 py-2.5 rounded-xl font-semibold transition-colors flex items-center gap-2"
                style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}
              >
                Next <ChevronRight size={16} />
              </button>
            )}
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
};

export default OnboardingFlow;