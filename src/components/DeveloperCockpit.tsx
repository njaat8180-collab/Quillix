// DeveloperCockpit.tsx
import React, { useEffect, useRef, useState } from "react";
import { Activity, Braces, Bug, CheckCircle2, ChevronRight, Code, Command, Cpu, Database, ExternalLink, FileCode, FileText, Filter, FolderOpen, Gauge, GitBranch, Globe, Loader2, MemoryStick, Monitor, Network, Search, Settings, Sparkles, Terminal, Trash2, X, AlertCircle, HardDrive, Wifi, Zap } from "lucide-react";
import { api } from "../services/apiBridge.js";
import type { ProviderHealthSummary, TerminalHistoryEntry } from "../shared/types.js";

interface Props { active?: boolean; onClose?: () => void; }

interface SystemHealthItem {
  id: string;
  name: string;
  category: string;
  status: "available" | "warning" | "missing";
  version?: string;
  details?: string;
}

interface GitStatusResponse {
  isGit: boolean;
  branch: string;
  files: Array<{ path: string; status: string; rawStatus: string }>;
  raw: string;
}

interface ProjectRunInfo {
  id: string;
  root: string;
  command: string;
  status: "running" | "exited" | "failed" | "stopped";
  exitCode?: number;
  output: string;
  startedAt: number;
  endedAt?: number;
}

interface ProjectRunStatus {
  success: boolean;
  run?: ProjectRunInfo;
}

interface BuildStatus {
  lastRun: number;
  status: "passing" | "failing" | "pending" | "running";
  duration: number;
  testsPassed: number;
  testsFailed: number;
  output?: string;
}
interface RagStatusSummary {
  files?: number;
  chunks?: number;
  cachedFiles?: number;
  reindexedFiles?: number;
  durationMs?: number;
}

interface TokenEfficiencySummary {
  completedTasks: number;
  verifiedTasks: number;
  totalTokens: number;
  totalModelCalls: number;
  totalToolCalls: number;
  passRatePercent: number;
  medianDurationMs: number | null;
  p95DurationMs: number | null;
}


export const DeveloperCockpit: React.FC<Props> = ({ active = true, onClose }) => {
  const [systemHealth, setSystemHealth] = useState<SystemHealthItem[]>([]);
  const [providers, setProviders] = useState<ProviderHealthSummary | null>(null);
  const [gitStatus, setGitStatus] = useState<GitStatusResponse | null>(null);
  const [buildStatus, setBuildStatus] = useState<BuildStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"system" | "providers" | "git" | "build" | "debug" | "perf">("system");
  const [promptCache, setPromptCache] = useState<{ enabled: boolean; entries: number; hits: number; misses: number; evictions: number; hitRate: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [debugSection, setDebugSection] = useState<"none" | "logs" | "network" | "profiler">("none");
  const [terminalHistory, setTerminalHistory] = useState<TerminalHistoryEntry[]>([]);
  const [ragStatus, setRagStatus] = useState<RagStatusSummary | null>(null);
  const [tokenEfficiency, setTokenEfficiency] = useState<TokenEfficiencySummary | null>(null);
  const [agentBusy, setAgentBusy] = useState<boolean | null>(null);
  const [debugBusy, setDebugBusy] = useState(false);
  const [debugNote, setDebugNote] = useState<string | null>(null);

  const [debugAdvancedOpen, setDebugAdvancedOpen] = useState(false);
  const [buildOutputOpen, setBuildOutputOpen] = useState(false);
  const refreshIntervalRef = useRef<number | null>(null);

  const loadAllData = async () => {
    try {
      // System health - real diagnostics
      try {
        const healthResult = await api.getHealth();
        if (healthResult.success && healthResult.items) {
          setSystemHealth(healthResult.items);
        }
      } catch (e) {
        console.warn("Failed to load system health:", e);
      }

      // Provider health - real diagnostics
      try {
        const provResult = await api.getProviderHealth();
        if (provResult?.success && provResult.health) {
          setProviders(provResult.health);
        }
      } catch (e) {
        console.warn("Failed to load provider health:", e);
      }

      // Git status - real API
      try {
        const gitResult = await api.getGitStatus();
        if (gitResult?.success && gitResult.status) {
          setGitStatus(gitResult.status);
        }
      } catch (e) {
        console.warn("Failed to load git status:", e);
      }

      // Build status - from project run status
      try {
        const runResult = await api.getProjectRunStatus();
        if (runResult?.success && runResult.run) {
          const run = runResult.run;
          const isExited = run.status === "exited";
          const passed = isExited && run.exitCode === 0;
          const failed = run.status === "failed" || (isExited && run.exitCode !== 0);
          setBuildStatus({
            lastRun: run.startedAt || Date.now(),
            status: run.status === "running" ? "running" : passed ? "passing" : failed ? "failing" : "pending",
            duration: run.endedAt && run.startedAt ? run.endedAt - run.startedAt : 0,
            testsPassed: 0, // Would need test runner integration
            testsFailed: 0,
            output: run.output || "",
          });
        } else {
          // No active run - show last known or empty state
          setBuildStatus({
            lastRun: 0,
            status: "pending",
            duration: 0,
            testsPassed: 0,
            testsFailed: 0,
          });
        }
      } catch (e) {
        console.warn("Failed to load build status:", e);
      }
      // Index + agent state - real diagnostics (no fabricated metrics)
      try {
        const ragResult = await api.getRagStatus();
        setRagStatus(ragResult ?? null);
      } catch (e) {
        console.warn("Failed to load index status:", e);
      }
      try {
        const agentResult = await api.getAgentStatus();
        if (typeof agentResult?.busy === "boolean") setAgentBusy(agentResult.busy);
      } catch (e) {
        console.warn("Failed to load agent status:", e);
      }


      setError(null);
    } catch (e) {
      setError("Failed to load cockpit data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!active) return;
    loadAllData();
    refreshIntervalRef.current = window.setInterval(loadAllData, 10000);
    const tickInterval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      if (refreshIntervalRef.current) window.clearInterval(refreshIntervalRef.current);
      window.clearInterval(tickInterval);
    };
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "1") { e.preventDefault(); setActiveTab("system"); }
      if ((e.ctrlKey || e.metaKey) && e.key === "2") { e.preventDefault(); setActiveTab("providers"); }
      if ((e.ctrlKey || e.metaKey) && e.key === "3") { e.preventDefault(); setActiveTab("git"); }
      if ((e.ctrlKey || e.metaKey) && e.key === "4") { e.preventDefault(); setActiveTab("build"); }
      if ((e.ctrlKey || e.metaKey) && e.key === "5") { e.preventDefault(); setActiveTab("debug"); }
  // Performance tab: light polling of the chat result-cache telemetry.
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const refreshCache = async () => {
      try {
        const data = await api.getPromptCacheStats();
        if (!cancelled && data.success) {
          setPromptCache({
            enabled: data.enabled !== false,
            entries: data.cache?.entries ?? 0,
            hits: data.cache?.hits ?? 0,
            misses: data.cache?.misses ?? 0,
            evictions: data.cache?.evictions ?? 0,
            hitRate: Number(data.hitRate) || 0,
          });
        }
      } catch {
        // A telemetry outage must never break the cockpit.
      }
    };
    void refreshCache();
    const timer = window.setInterval(refreshCache, 5000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [active, activeTab]);

  if ((e.ctrlKey || e.metaKey) && e.key === "6") { e.preventDefault(); setActiveTab("perf"); }
      if (e.key === "Escape" && onClose) { e.preventDefault(); onClose(); }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [active, onClose]);

  /**
   * Debug tools: each control fetches real, already-implemented diagnostics.
   * No control exists here without a real operation behind it.
   */
  const loadDebugSection = async (section: "logs" | "network" | "profiler") => {
    setDebugBusy(true);
    setDebugNote(null);
    try {
      if (section === "logs") {
        const result = await api.getTerminalHistory(20);
        setTerminalHistory(result?.history ?? []);
        setDebugSection("logs");
        if (result?.success === false) setDebugNote("Terminal history is unavailable.");
      } else if (section === "network") {
        const result = await api.getProviderHealth();
        if (result?.success && result.health) {
          setProviders(result.health);
          setDebugSection("network");
        } else {
          setDebugSection("none");
          setDebugNote("The active provider does not publish network diagnostics.");
        }
      } else {
        const [rag, tokens, agent] = await Promise.all([
          api.getRagStatus(),
          api.getTokenEfficiency(),
          api.getAgentStatus(),
        ]);
        setRagStatus(rag ?? null);
        setTokenEfficiency(tokens ?? null);
        setAgentBusy(typeof agent?.busy === "boolean" ? agent.busy : null);
        setDebugSection("profiler");
      }
    } catch (e) {
      setDebugSection("none");
      setDebugNote(`Could not load ${section}: ${(e as Error)?.message || "unknown error"}`);
    } finally {
      setDebugBusy(false);
    }
  };

  /** Download the diagnostics this panel actually holds - never synthesized values. */
  const exportDebugBundle = () => {
    try {
      const bundle = {
        exportedAt: new Date().toISOString(),
        source: "QUILLIX Developer Cockpit",
        systemHealth,
        providerHealth: providers ?? null,
        git: gitStatus
          ? { isGit: gitStatus.isGit, branch: gitStatus.branch, changedFiles: gitStatus.files?.length ?? 0 }
          : null,
        build: buildStatus ?? null,
        terminalHistory: terminalHistory.slice(0, 20),
        index: ragStatus ?? null,
        tokenEfficiency: tokenEfficiency ?? null,
        agentBusy,
      };
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `quillix-debug-${Date.now()}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setDebugNote("Debug bundle downloaded.");
    } catch (e) {
      setDebugNote(`Export failed: ${(e as Error)?.message || "unknown error"}`);
    }
  };

  if (!active) return null;

  const tabs = [ 
    { id: "system", label: "System", icon: Cpu, shortcut: "⌘1" }, 
    { id: "providers", label: "Providers", icon: Globe, shortcut: "⌘2" }, 
    { id: "git", label: "Git", icon: GitBranch, shortcut: "⌘3" }, 
    { id: "build", label: "Build", icon: CheckCircle2, shortcut: "⌘4" }, 
    { id: "debug", label: "Debug", icon: Bug, shortcut: "⌘5" }, 
    { id: "perf", label: "Performance", icon: Gauge, shortcut: "⌘6" }, 
  ] as const;

  const formatBytes = (bytes: number) => { 
    if (bytes === 0) return "0 B"; 
    const k = 1024; 
    const sizes = ["B", "KB", "MB", "GB", "TB"]; 
    const i = Math.floor(Math.log(bytes) / Math.log(k)); 
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i]; 
  };
  
  const formatDuration = (ms: number) => { 
    if (ms < 1000) return ms + "ms"; 
    if (ms < 60000) return (ms / 1000).toFixed(1) + "s"; 
    return Math.floor(ms / 60000) + "m " + Math.floor((ms % 60000) / 1000) + "s"; 
  };
  
  const getStatusColor = (status: string) => 
    status === "healthy" || status === "available" ? "text-emerald-400" : 
    status === "degraded" || status === "warning" ? "text-amber-400" : "text-rose-400";

  const getProviderAvailabilityColor = (availability: ProviderHealthSummary["availability"]) => {
    switch (availability) {
      case "ok": return "text-emerald-400";
      case "throttled": return "text-amber-400";
      case "cooldown": return "text-amber-400";
      case "degraded": return "text-amber-400";
      case "auth": return "text-rose-400";
      case "billing": return "text-rose-400";
      case "circuit-open": return "text-rose-400";
      default: return "text-slate-500";
    }
  };

  const getProviderAvailabilityLabel = (availability: ProviderHealthSummary["availability"]) => {
    switch (availability) {
      case "ok": return "Healthy";
      case "throttled": return "Throttled";
      case "cooldown": return "Cooldown";
      case "degraded": return "Degraded";
      case "auth": return "Auth Error";
      case "billing": return "Billing Issue";
      case "circuit-open": return "Circuit Open";
      default: return "No Data";
    }
  };

  return (
    <section className="q-developer-cockpit flex h-full flex-col overflow-hidden bg-[var(--bg)] text-[11px]" role="region" aria-label="Developer Cockpit">
      <header className="flex items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--surface)] px-3 py-2">
        <div className="flex items-center gap-2">
          <Monitor size={13} className="text-[var(--accent)]" aria-hidden="true" />
          <strong className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--text)]">Developer Cockpit</strong>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={loadAllData} disabled={loading} className="q-transition p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--hover)]" aria-label="Refresh all data" title="Refresh (R)">
            <Activity size={14} className={loading ? "animate-spin" : ""} aria-hidden="true" />
          </button>
          {onClose && (
            <button onClick={onClose} className="q-transition p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--hover)]" aria-label="Close cockpit" title="Close (Esc)">
              <X size={14} />
            </button>
          )}
        </div>
      </header>

      <nav className="flex gap-0.5 border-b border-[var(--border)] bg-[var(--surface)] px-2 py-1 overflow-x-auto" role="tablist" aria-label="Cockpit sections">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-controls={`panel-${tab.id}`}
            id={`tab-${tab.id}`}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium q-transition whitespace-nowrap ${activeTab === tab.id ? "bg-[var(--accent)] text-[var(--accent-ink)]" : "text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--hover)]"}`}
            title={`${tab.label} (${tab.shortcut})`}
          >
            <tab.icon size={12} aria-hidden="true" />
            <span>{tab.label}</span>
            <kbd className="px-1 py-0.5 text-[9px] opacity-60 bg-[var(--border)] rounded">{tab.shortcut}</kbd>
          </button>
        ))}
      </nav>

      <div className="flex-1 overflow-auto p-3" role="tabpanel" aria-label="Cockpit content">
        {loading && <div className="flex items-center justify-center py-12 text-[var(--text-muted)]"><Activity size={24} className="animate-spin mr-2" aria-hidden="true" />Loading cockpit data…</div>}
        {error && <div className="p-3 rounded-lg bg-rose-900/20 border border-rose-800 text-rose-300 text-[11px]" role="alert">{error}</div>}

        {/* System tab */}
        {activeTab === "system" && (
          <div id="panel-system" role="tabpanel" aria-labelledby="tab-system" className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
              <MetricCard
                label="Indexed Files"
                value={ragStatus?.files != null ? String(ragStatus.files) : "unavailable"}
                icon={<Database size={14} />}
                status={ragStatus?.files ? "available" : "warning"}
              />
              <MetricCard
                label="Indexed Chunks"
                value={ragStatus?.chunks != null ? String(ragStatus.chunks) : "unavailable"}
                icon={<Braces size={14} />}
                status={ragStatus?.chunks ? "available" : "warning"}
              />
              <MetricCard
                label="Provider Link"
                value={providers ? getProviderAvailabilityLabel(providers.availability) : "not reported"}
                icon={<Wifi size={14} />}
                status={providers ? (providers.successRate >= 0.95 ? "available" : "warning") : "warning"}
              />
              <MetricCard
                label="Agent"
                value={agentBusy == null ? "unknown" : agentBusy ? "working" : "idle"}
                icon={<Cpu size={14} />}
                status={agentBusy == null ? "warning" : "available"}
              />

            </div>

            {/* Detailed system info */}
            <div className="space-y-2">
              {systemHealth.map((item) => (
                <div key={item.id} className="p-3 rounded-lg bg-[var(--surface)] border border-[var(--border)]">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {item.category === "runtime" && <Zap size={14} className="text-[var(--accent)]" />}
                      {item.category === "tool" && <Terminal size={14} className="text-blue-400" />}
                      {item.category === "service" && <Activity size={14} className="text-emerald-400" />}
                      <strong className="text-[var(--text)]">{item.name}</strong>
                    </div>
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${getStatusColor(item.status)} bg-opacity-10`}>
                      <span className="w-1.5 h-1.5 rounded-full bg-current" aria-hidden="true" />
                      {item.status.charAt(0).toUpperCase() + item.status.slice(1)}
                    </span>
                  </div>
                  {item.version && (
                    <div className="mt-1 text-[10px] text-[var(--text-muted)] font-mono">{item.version}</div>
                  )}
                  {item.details && (
                    <div className="mt-1 text-[10px] text-[var(--text-muted)]">{item.details}</div>
                  )}
                </div>
              ))}
              {systemHealth.length === 0 && (
                <div className="p-3 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[var(--text-muted)] text-center">
                  System health data unavailable. Run diagnostics to populate.
                </div>
              )}
            </div>
          </div>
        )}

        {/* Providers tab */}
        {activeTab === "providers" && (
          <div id="panel-providers" role="tabpanel" aria-labelledby="tab-providers" className="space-y-3">
            {providers ? (
              <div className="space-y-3">
                <div className="p-3 rounded-lg bg-[var(--surface)] border border-[var(--border)]">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Globe size={14} className="text-[var(--accent)]" aria-hidden="true" />
                      <strong className="text-[var(--text)]">Active Provider</strong>
                    </div>
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${getProviderAvailabilityColor(providers.availability)} bg-opacity-10`}>
                      <Activity size={8} aria-hidden="true" />
                      {getProviderAvailabilityLabel(providers.availability)}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]">
                    <div><span className="text-[var(--text-muted)]">Latency:</span> <span className="font-mono text-[var(--text)] ml-1">{providers.averageLatencyMs}ms</span></div>
                    <div><span className="text-[var(--text-muted)]">First Token:</span> <span className="font-mono text-[var(--text)] ml-1">{providers.averageFirstTokenMs}ms</span></div>
                    <div><span className="text-[var(--text-muted)]">Tokens/s:</span> <span className="font-mono text-[var(--text)] ml-1">{providers.tokensPerSecond.toFixed(1)}</span></div>
                    <div><span className="text-[var(--text-muted)]">Success Rate:</span> <span className="font-mono text-[var(--text)] ml-1">{(providers.successRate * 100).toFixed(1)}%</span></div>
                    <div><span className="text-[var(--text-muted)]">Queue Depth:</span> <span className="font-mono text-[var(--text)] ml-1">{providers.queueDepth}</span></div>
                    <div><span className="text-[var(--text-muted)]">Effective Interval:</span> <span className="font-mono text-[var(--text)] ml-1">{providers.effectiveIntervalMs}ms</span></div>
                    <div><span className="text-[var(--text-muted)]">Recommended Wait:</span> <span className="font-mono text-[var(--text)] ml-1">{providers.recommendedWaitMs > 0 ? `${Math.round(providers.recommendedWaitMs / 1000)}s` : "N/A"}</span></div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-3 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[var(--text-muted)] text-center">
                No provider diagnostics available. Make sure a provider is configured and has made requests.
              </div>
            )}
          </div>
        )}

        {/* Git tab */}
        {activeTab === "git" && (
          <div id="panel-git" role="tabpanel" aria-labelledby="tab-git" className="space-y-3">
            {gitStatus?.isGit ? (
              <div className="space-y-3">
                <div className="p-3 rounded-lg bg-[var(--surface)] border border-[var(--border)]">
                  <div className="flex items-center gap-2 mb-3">
                    <GitBranch size={14} className="text-[var(--accent)]" aria-hidden="true" />
                    <strong className="text-[var(--text)]">Branch: <span className="font-mono">{gitStatus.branch || "detached"}</span></strong>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]">
                    <div><span className="text-[var(--text-muted)]">Modified:</span> <span className="font-mono text-amber-400 ml-1">{gitStatus.files.filter(f => f.status === "modified").length}</span></div>
                    <div><span className="text-[var(--text-muted)]">Staged:</span> <span className="font-mono text-emerald-400 ml-1">{gitStatus.files.filter(f => f.status === "staged").length}</span></div>
                    <div><span className="text-[var(--text-muted)]">Untracked:</span> <span className="font-mono text-blue-400 ml-1">{gitStatus.files.filter(f => f.status === "untracked").length}</span></div>
                    <div><span className="text-[var(--text-muted)]">Deleted:</span> <span className="font-mono text-rose-400 ml-1">{gitStatus.files.filter(f => f.status === "deleted").length}</span></div>
                  </div>
                </div>
                
                {gitStatus.files.length > 0 && (
                  <div className="p-3 rounded-lg bg-[var(--surface)] border border-[var(--border)]">
                    <strong className="text-[var(--text)] mb-2 block">File Changes</strong>
                    <div className="max-h-60 overflow-auto space-y-1">
                      {gitStatus.files.map((file, i) => (
                        <div key={i} className="flex items-center justify-between text-[10px] px-2 py-1 rounded bg-[var(--bg)]">
                          <span className="font-mono truncate max-w-[200px]">{file.path}</span>
                          <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${file.status === "staged" ? "bg-emerald-900/30 text-emerald-300" : file.status === "modified" ? "bg-amber-900/30 text-amber-300" : file.status === "untracked" ? "bg-blue-900/30 text-blue-300" : "bg-rose-900/30 text-rose-300"}`}>
                            {file.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="p-3 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[var(--text-muted)] text-center">
                Not a Git repository or Git unavailable
              </div>
            )}
          </div>
        )}

        {/* Build tab */}
        {activeTab === "build" && (
          <div id="panel-build" role="tabpanel" aria-labelledby="tab-build" className="space-y-3">
            {buildStatus ? (
              <div className="space-y-3">
                <div className="p-3 rounded-lg bg-[var(--surface)] border border-[var(--border)]">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 size={14} className={buildStatus.status === "passing" ? "text-emerald-400" : buildStatus.status === "failing" ? "text-rose-400" : buildStatus.status === "pending" ? "text-amber-400" : "text-blue-400"} aria-hidden="true" />
                      <strong className="text-[var(--text)]">Last Build: <span className="font-mono capitalize">{buildStatus.status}</span></strong>
                    </div>
                    <span className="text-[10px] text-[var(--text-muted)]">{buildStatus.lastRun > 0 ? `Ran ${formatDuration(Date.now() - buildStatus.lastRun)} ago` : "Never run"}</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]">
                    <div><span className="text-[var(--text-muted)]">Duration:</span> <span className="font-mono text-[var(--text)] ml-1">{formatDuration(buildStatus.duration)}</span></div>
                    <div><span className="text-[var(--text-muted)]">Tests Passed:</span> <span className="font-mono text-emerald-400 ml-1">{buildStatus.testsPassed}</span></div>
                    <div><span className="text-[var(--text-muted)]">Tests Failed:</span> <span className="font-mono text-rose-400 ml-1">{buildStatus.testsFailed}</span></div>
                    <div><span className="text-[var(--text-muted)]">Exit Code:</span> <span className="font-mono text-[var(--text)] ml-1">{buildStatus.status === "failing" ? "≠ 0" : "0"}</span></div>
                  </div>
                  {buildStatus.output && (
                    <details className="mt-3">
                      <summary 
                        className="cursor-pointer text-[10px] text-[var(--text-muted)] hover:text-[var(--text)]" 
                        aria-expanded={buildOutputOpen}
                        onClick={(e) => {
                          e.preventDefault();
                          setBuildOutputOpen(!buildOutputOpen);
                        }}
                      >
                        Build Output
                      </summary>
                      <pre className="mt-2 p-2 rounded bg-[var(--bg)] border border-[var(--border)] text-[9px] font-mono text-[var(--text-muted)] overflow-x-auto max-h-40">{buildStatus.output.slice(0, 2000)}</pre>
                    </details>
                  )}
                </div>
              </div>
            ) : (
              <div className="p-3 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[var(--text-muted)] text-center">
                No build status available. Run a project to see build results.
              </div>
            )}
          </div>
        )}

        {/* Debug tab */}
        {activeTab === "debug" && (
          <div id="panel-debug" role="tabpanel" aria-labelledby="tab-debug" className="space-y-3">
            <div className="p-3 rounded-lg bg-[var(--surface)] border border-[var(--border)]">
              <div className="flex items-center gap-2 mb-3">
                <Bug size={14} className="text-[var(--accent)]" aria-hidden="true" />
                <strong className="text-[var(--text)]">Debug Tools</strong>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <button onClick={() => void loadDebugSection("logs")} disabled={debugBusy} className="p-2 rounded-lg border border-[var(--border)] hover:bg-[var(--hover)] text-left transition-colors disabled:opacity-50 disabled:cursor-not-allowed" aria-label="Load recent terminal commands">
                  <div className="flex items-center gap-2">
                    <Terminal size={14} className="text-blue-400" aria-hidden="true" />
                    <span className="font-medium">Console Logs</span>
                  </div>
                  <p className="mt-1 text-[10px] text-[var(--text-muted)]">Recent commands and exit codes</p>
                </button>
                <button onClick={() => void loadDebugSection("network")} disabled={debugBusy} className="p-2 rounded-lg border border-[var(--border)] hover:bg-[var(--hover)] text-left transition-colors disabled:opacity-50 disabled:cursor-not-allowed" aria-label="Load live provider diagnostics">
                  <div className="flex items-center gap-2">
                    <Network size={14} className="text-purple-400" aria-hidden="true" />
                    <span className="font-medium">Network</span>
                  </div>
                  <p className="mt-1 text-[10px] text-[var(--text-muted)]">Latency, throughput, success rate</p>
                </button>
                <button onClick={() => void loadDebugSection("profiler")} disabled={debugBusy} className="p-2 rounded-lg border border-[var(--border)] hover:bg-[var(--hover)] text-left transition-colors disabled:opacity-50 disabled:cursor-not-allowed" aria-label="Load index and task performance">
                  <div className="flex items-center gap-2">
                    <Gauge size={14} className="text-amber-400" aria-hidden="true" />
                    <span className="font-medium">Profiler</span>
                  </div>
                  <p className="mt-1 text-[10px] text-[var(--text-muted)]">Index stats and task counters</p>
                </button>
                <button onClick={() => { setDebugSection("none"); void loadAllData(); }} disabled={debugBusy} className="p-2 rounded-lg border border-[var(--border)] hover:bg-[var(--hover)] text-left transition-colors disabled:opacity-50 disabled:cursor-not-allowed" aria-label="Re-read every cockpit section">
                  <div className="flex items-center gap-2">
                    <Activity size={14} className="text-emerald-400" aria-hidden="true" />
                    <span className="font-medium">Refresh</span>
                  </div>
                  <p className="mt-1 text-[10px] text-[var(--text-muted)]">Re-query the live server</p>
                </button>
                <button onClick={exportDebugBundle} className="p-2 rounded-lg border border-[var(--border)] hover:bg-[var(--hover)] text-left transition-colors" aria-label="Download captured diagnostics as JSON">
                  <div className="flex items-center gap-2">
                    <FileText size={14} className="text-[var(--accent)]" aria-hidden="true" />
                    <span className="font-medium">Export Bundle</span>
                  </div>
                  <p className="mt-1 text-[10px] text-[var(--text-muted)]">Download diagnostics JSON</p>
                </button>
              </div>

              {debugBusy && (
                <p className="mt-3 text-[10px] text-[var(--text-muted)]" role="status">
                  <Loader2 size={11} className="inline-block animate-spin mr-1" aria-hidden="true" />Loading diagnostics…
                </p>
              )}
              {debugNote && (
                <p className={`mt-3 text-[10px] ${debugNote.startsWith("Export") ? "text-emerald-400" : "text-amber-400"}`} role="status">{debugNote}</p>
              )}

              {debugSection === "logs" && (
                <div className="mt-3 space-y-1 max-h-48 overflow-auto">
                  {terminalHistory.length === 0 ? (
                    <p className="text-[10px] text-[var(--text-muted)]">No terminal commands recorded yet.</p>
                  ) : (
                    terminalHistory.map((entry) => (
                      <div key={entry.id} className="flex items-center gap-2 p-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-[10px] font-mono">
                        <span className={entry.exitCode === 0 ? "text-emerald-400" : "text-rose-400"}>exit {entry.exitCode}</span>
                        <span className="truncate flex-1 text-[var(--text)]">{entry.command}</span>
                        <span className="text-[var(--text-muted)]">{entry.source}</span>
                        <span className="text-[var(--text-muted)]">{entry.durationMs}ms</span>
                      </div>
                    ))
                  )}
                </div>
              )}

              {debugSection === "network" && providers && (
                <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-1 text-[10px]">
                  <div><span className="text-[var(--text-muted)]">Availability:</span> <span className="font-mono text-[var(--text)]">{getProviderAvailabilityLabel(providers.availability)}</span></div>
                  <div><span className="text-[var(--text-muted)]">Latency:</span> <span className="font-mono text-[var(--text)]">{providers.averageLatencyMs}ms</span></div>
                  <div><span className="text-[var(--text-muted)]">First token:</span> <span className="font-mono text-[var(--text)]">{providers.averageFirstTokenMs}ms</span></div>
                  <div><span className="text-[var(--text-muted)]">Tokens/s:</span> <span className="font-mono text-[var(--text)]">{providers.tokensPerSecond.toFixed(1)}</span></div>
                  <div><span className="text-[var(--text-muted)]">Success rate:</span> <span className="font-mono text-[var(--text)]">{(providers.successRate * 100).toFixed(1)}%</span></div>
                  <div><span className="text-[var(--text-muted)]">Queue depth:</span> <span className="font-mono text-[var(--text)]">{providers.queueDepth}</span></div>
                  <div><span className="text-[var(--text-muted)]">Effective interval:</span> <span className="font-mono text-[var(--text)]">{providers.effectiveIntervalMs}ms</span></div>
                  <div><span className="text-[var(--text-muted)]">Recommended wait:</span> <span className="font-mono text-[var(--text)]">{providers.recommendedWaitMs > 0 ? `${Math.round(providers.recommendedWaitMs / 1000)}s` : "none"}</span></div>
                </div>
              )}

              {debugSection === "profiler" && (
                <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-1 text-[10px]">
                  <div><span className="text-[var(--text-muted)]">Indexed files:</span> <span className="font-mono text-[var(--text)]">{ragStatus?.files ?? "n/a"}</span></div>
                  <div><span className="text-[var(--text-muted)]">Indexed chunks:</span> <span className="font-mono text-[var(--text)]">{ragStatus?.chunks ?? "n/a"}</span></div>
                  <div><span className="text-[var(--text-muted)]">Cached files:</span> <span className="font-mono text-[var(--text)]">{ragStatus?.cachedFiles ?? "n/a"}</span></div>
                  <div><span className="text-[var(--text-muted)]">Re-indexed:</span> <span className="font-mono text-[var(--text)]">{ragStatus?.reindexedFiles ?? "n/a"}</span></div>
                  <div><span className="text-[var(--text-muted)]">Last index build:</span> <span className="font-mono text-[var(--text)]">{ragStatus?.durationMs != null ? `${ragStatus.durationMs}ms` : "n/a"}</span></div>
                  <div><span className="text-[var(--text-muted)]">Agent:</span> <span className="font-mono text-[var(--text)]">{agentBusy == null ? "unknown" : agentBusy ? "working" : "idle"}</span></div>
                  <div><span className="text-[var(--text-muted)]">Completed tasks:</span> <span className="font-mono text-[var(--text)]">{tokenEfficiency?.completedTasks ?? 0}</span></div>
                  <div><span className="text-[var(--text-muted)]">Verified tasks:</span> <span className="font-mono text-[var(--text)]">{tokenEfficiency?.verifiedTasks ?? 0}</span></div>
                  <div><span className="text-[var(--text-muted)]">Model calls:</span> <span className="font-mono text-[var(--text)]">{tokenEfficiency?.totalModelCalls ?? 0}</span></div>
                  <div><span className="text-[var(--text-muted)]">Tool calls:</span> <span className="font-mono text-[var(--text)]">{tokenEfficiency?.totalToolCalls ?? 0}</span></div>
                  <div><span className="text-[var(--text-muted)]">Task pass rate:</span> <span className="font-mono text-[var(--text)]">{tokenEfficiency ? `${tokenEfficiency.passRatePercent}%` : "n/a"}</span></div>
                  <div><span className="text-[var(--text-muted)]">Median duration:</span> <span className="font-mono text-[var(--text)]">{tokenEfficiency?.medianDurationMs != null ? `${tokenEfficiency.medianDurationMs}ms` : "n/a"}</span></div>
                </div>
              )}

              <p className="mt-3 text-[10px] text-[var(--text-muted)]">Breakpoints, stepping and expression evaluation live in the Debug sidebar panel.</p>
            </div>

            <details className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
              <summary
                className="flex items-center gap-2 p-3 cursor-pointer text-[11px] font-medium text-[var(--text)]"
                aria-expanded={debugAdvancedOpen}
                onClick={(e) => {
                  e.preventDefault();
                  setDebugAdvancedOpen(!debugAdvancedOpen);
                }}
              >
                <ChevronRight size={12} className={`transition-transform ${debugAdvancedOpen ? "rotate-90" : ""}`} aria-hidden="true" />
                <span>Advanced Debugging</span>
              </summary>
              <div className="px-3 pb-3 space-y-2 text-[10px] text-[var(--text-muted)]">
                <p>Workspace-level debugging (breakpoints, stepping, expression evaluation) is available in the Debug sidebar panel.</p>
                <p>Export Bundle above downloads the diagnostics this cockpit has actually captured.</p>
              </div>
            </details>
          </div>
        )}

        {/* Performance tab (M5.6 + provider speed proof) */}
        {activeTab === "perf" && (
          <div id="panel-perf" role="tabpanel" aria-labelledby="tab-perf" className="space-y-3">
            <div className="p-3 rounded-lg bg-[var(--surface)] border border-[var(--border)]">
              <div className="flex items-center gap-2 mb-2">
                <Gauge size={14} className="text-[var(--accent)]" aria-hidden="true" />
                <strong className="text-[var(--text)]">Model Speed</strong>
                <span className="text-[10px] text-[var(--text-muted)]">live provider telemetry</span>
              </div>
              {providers ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[10px]">
                  <div><span className="text-[var(--text-muted)]">Avg response:</span> <span className="font-mono text-[var(--text)] ml-1">{providers.averageLatencyMs}ms</span></div>
                  <div><span className="text-[var(--text-muted)]">First token:</span> <span className="font-mono text-[var(--text)] ml-1">{providers.averageFirstTokenMs}ms</span></div>
                  <div><span className="text-[var(--text-muted)]">Output speed:</span> <span className="font-mono text-[var(--text)] ml-1">{providers.tokensPerSecond.toFixed(1)} tok/s</span></div>
                  <div><span className="text-[var(--text-muted)]">Success rate:</span> <span className="font-mono text-[var(--text)] ml-1">{(providers.successRate * 100).toFixed(1)}%</span></div>
                  <div><span className="text-[var(--text-muted)]">Queue depth:</span> <span className="font-mono text-[var(--text)] ml-1">{providers.queueDepth}</span></div>
                  <div><span className="text-[var(--text-muted)]">Effective interval:</span> <span className="font-mono text-[var(--text)] ml-1">{providers.effectiveIntervalMs}ms</span></div>
                </div>
              ) : (
                <p className="text-[10px] text-[var(--text-muted)]">No provider telemetry yet — make a model request and refresh.</p>
              )}
            </div>
            <div className="p-3 rounded-lg bg-[var(--surface)] border border-[var(--border)]">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles size={14} className="text-[var(--accent)]" aria-hidden="true" />
                <strong className="text-[var(--text)]">Token Savings</strong>
                <span className="text-[10px] text-[var(--text-muted)]">chat result cache (agent turns never cached)</span>
              </div>
              {promptCache ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[10px]">
                  <div><span className="text-[var(--text-muted)]">Status:</span> <span className={`font-mono ml-1 ${promptCache.enabled ? "text-emerald-400" : "text-amber-400"}`}>{promptCache.enabled ? "ON" : "OFF"}</span></div>
                  <div><span className="text-[var(--text-muted)]">Hit rate:</span> <span className="font-mono text-[var(--text)] ml-1">{(promptCache.hitRate * 100).toFixed(1)}%</span></div>
                  <div><span className="text-[var(--text-muted)]">Entries:</span> <span className="font-mono text-[var(--text)] ml-1">{promptCache.entries}</span></div>
                  <div><span className="text-[var(--text-muted)]">Replays saved:</span> <span className="font-mono text-[var(--text)] ml-1">{promptCache.hits}</span></div>
                  <div><span className="text-[var(--text-muted)]">Fresh answers:</span> <span className="font-mono text-[var(--text)] ml-1">{promptCache.misses}</span></div>
                  <div><span className="text-[var(--text-muted)]">Evictions:</span> <span className="font-mono text-[var(--text)] ml-1">{promptCache.evictions}</span></div>
                </div>
              ) : (
                <p className="text-[10px] text-[var(--text-muted)]">Cache telemetry unavailable.</p>
              )}
            </div>
            <p className="text-[10px] text-[var(--text-muted)]">Numbers here come from this running server: provider diagnostics and cache counters. Turbo Speed affects pacing only; it is configured in Settings.</p>
          </div>
        )}

        <div className="border-t border-[var(--border)] px-3 py-2 text-[10px] text-[var(--text-muted)]">
          <kbd className="px-1.5 py-0.5 bg-[var(--border)] rounded">⌘1-6</kbd> Switch tabs ·
          <kbd className="px-1.5 py-0.5 bg-[var(--border)] rounded">R</kbd> Refresh ·
          <kbd className="px-1.5 py-0.5 bg-[var(--border)] rounded">Esc</kbd> Close
        </div>
      </div>
    </section>
  );
};

function MetricCard({ label, value, icon, status }: { label: string; value: string; icon: React.ReactNode; status: string }) {
  const statusColor = status === "available" ? "text-emerald-400" : status === "warning" ? "text-amber-400" : "text-rose-400";
  return (
    <div className="p-3 rounded-lg bg-[var(--surface)] border border-[var(--border)]">
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <span className="text-[10px] text-[var(--text-muted)]">{label}</span>
      </div>
      <div className="flex items-center gap-1">
        <span className="text-[14px] font-mono font-semibold text-[var(--text)]">{value}</span>
        <span className={`w-2 h-2 rounded-full ${statusColor}`} aria-hidden="true" />
      </div>
    </div>
  );
}

export default DeveloperCockpit;
