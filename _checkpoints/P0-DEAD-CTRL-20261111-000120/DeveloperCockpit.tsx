// DeveloperCockpit.tsx
import React, { useEffect, useRef, useState } from "react";
import { Activity, Braces, Bug, CheckCircle2, ChevronRight, Code, Command, Cpu, Database, ExternalLink, FileCode, FileText, Filter, FolderOpen, Gauge, GitBranch, Globe, Loader2, MemoryStick, Monitor, Network, Search, Settings, Terminal, Trash2, X, AlertCircle, HardDrive, Wifi, Zap } from "lucide-react";
import { api } from "../services/apiBridge.js";
import type { ProviderHealthSummary } from "../shared/types.js";

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

export const DeveloperCockpit: React.FC<Props> = ({ active = true, onClose }) => {
  const [systemHealth, setSystemHealth] = useState<SystemHealthItem[]>([]);
  const [providers, setProviders] = useState<ProviderHealthSummary | null>(null);
  const [gitStatus, setGitStatus] = useState<GitStatusResponse | null>(null);
  const [buildStatus, setBuildStatus] = useState<BuildStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"system" | "providers" | "git" | "build" | "debug">("system");
  const [now, setNow] = useState(() => Date.now());
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
      if (e.key === "Escape" && onClose) { e.preventDefault(); onClose(); }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [active, onClose]);

  if (!active) return null;

  const tabs = [ 
    { id: "system", label: "System", icon: Cpu, shortcut: "⌘1" }, 
    { id: "providers", label: "Providers", icon: Globe, shortcut: "⌘2" }, 
    { id: "git", label: "Git", icon: GitBranch, shortcut: "⌘3" }, 
    { id: "build", label: "Build", icon: CheckCircle2, shortcut: "⌘4" }, 
    { id: "debug", label: "Debug", icon: Bug, shortcut: "⌘5" }, 
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
              {/* CPU */}
              <MetricCard 
                label="CPU" 
                value="N/A" 
                icon={<Cpu size={14} />}
                status="available"
              />
              {/* Memory */}
              <MetricCard 
                label="Memory" 
                value="N/A" 
                icon={<MemoryStick size={14} />}
                status="available"
              />
              {/* Disk */}
              <MetricCard 
                label="Disk" 
                value="N/A" 
                icon={<HardDrive size={14} />}
                status="available"
              />
              {/* Network */}
              <MetricCard 
                label="Network" 
                value="Online" 
                icon={<Wifi size={14} />}
                status="available"
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
              <div className="grid grid-cols-2 gap-2">
                <button className="p-2 rounded-lg border border-[var(--border)] hover:bg-[var(--hover)] text-left transition-colors" aria-label="Open debugger panel">
                  <div className="flex items-center gap-2">
                    <Bug size={14} className="text-emerald-400" aria-hidden="true" />
                    <span className="font-medium">Attach Debugger</span>
                  </div>
                  <p className="mt-1 text-[10px] text-[var(--text-muted)]">Launch Node.js inspector</p>
                </button>
                <button className="p-2 rounded-lg border border-[var(--border)] hover:bg-[var(--hover)] text-left transition-colors" aria-label="View console logs">
                  <div className="flex items-center gap-2">
                    <Terminal size={14} className="text-blue-400" aria-hidden="true" />
                    <span className="font-medium">Console Logs</span>
                  </div>
                  <p className="mt-1 text-[10px] text-[var(--text-muted)]">View runtime output</p>
                </button>
                <button className="p-2 rounded-lg border border-[var(--border)] hover:bg-[var(--hover)] text-left transition-colors" aria-label="Performance profiler">
                  <div className="flex items-center gap-2">
                    <Gauge size={14} className="text-amber-400" aria-hidden="true" />
                    <span className="font-medium">Profiler</span>
                  </div>
                  <p className="mt-1 text-[10px] text-[var(--text-muted)]">CPU/Memory profiling</p>
                </button>
                <button className="p-2 rounded-lg border border-[var(--border)] hover:bg-[var(--hover)] text-left transition-colors" aria-label="Network inspector">
                  <div className="flex items-center gap-2">
                    <Network size={14} className="text-purple-400" aria-hidden="true" />
                    <span className="font-medium">Network</span>
                  </div>
                  <p className="mt-1 text-[10px] text-[var(--text-muted)]">Inspect API requests</p>
                </button>
              </div>
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
              <div className="px-3 pb-3 space-y-2 text-[10px]">
                <button className="w-full p-2 rounded-lg border border-[var(--border)] hover:bg-[var(--hover)] text-left transition-colors" aria-label="Export debug bundle">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <FileText size={14} className="text-[var(--accent)]" aria-hidden="true" />
                      <span>Export Debug Bundle</span>
                    </div>
                    <ExternalLink size={12} aria-hidden="true" />
                  </div>
                  <p className="ml-6 text-[var(--text-muted)]">Collect logs, config, and state for bug reports</p>
                </button>
                <button className="w-full p-2 rounded-lg border border-[var(--border)] hover:bg-[var(--hover)] text-left transition-colors" aria-label="Clear debug cache">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Trash2 size={14} className="text-rose-400" aria-hidden="true" />
                      <span>Clear Debug Cache</span>
                    </div>
                  </div>
                  <p className="ml-6 text-[var(--text-muted)]">Remove temporary debug files</p>
                </button>
              </div>
            </details>
          </div>
        )}

        <div className="border-t border-[var(--border)] px-3 py-2 text-[10px] text-[var(--text-muted)]">
          <kbd className="px-1.5 py-0.5 bg-[var(--border)] rounded">⌘1-5</kbd> Switch tabs ·
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
