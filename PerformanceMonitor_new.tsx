import React, { useEffect, useState } from "react";
import { Activity, Gauge, Zap, RefreshCw, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { api } from "../services/apiBridge.js";
import type { ProviderHealthSummary } from "../shared/types.js";

interface PerformanceMonitorProps {
  /** If true, shows compact inline version for footer/status bar */
  compact?: boolean;
  /** Polling interval in ms (default 5000) */
  pollInterval?: number;
}

interface PerformanceData {
  health: ProviderHealthSummary;
  lastUpdated: number;
}

/**
 * Live Performance Monitor (M7.5)
 * Shows real-time provider metrics: tokens/sec, latency, success rate, queue depth, RPM
 * Fetches from /api/providers/diagnostics via api.getProviderHealth()
 */
export function PerformanceMonitor({ compact = false, pollInterval = 5000 }: PerformanceMonitorProps) {
  const [data, setData] = useState<PerformanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchHealth = async () => {
    try {
      const result = await api.getProviderHealth();
      if (result.success && result.health) {
        setData({ health: result.health, lastUpdated: Date.now() });
        setError(null);
      } else {
        setError("No provider diagnostics available");
      }
    } catch (e) {
      setError("Failed to fetch performance data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, pollInterval);
    return () => clearInterval(interval);
  }, [pollInterval]);

  if (compact) {
    return (
      <div className="inline-flex items-center gap-1.5 text-[11px] font-medium" role="region" aria-label="Provider performance">
        {loading ? (
          <>
            <Activity size={12} className="animate-spin text-[var(--text-muted)]" aria-hidden="true" />
            <span className="text-[var(--text-muted)]">Loading…</span>
          </>
        ) : error ? (
          <span className="text-[var(--text-muted)]" title={error}>
            <Gauge size={12} className="text-[var(--text-muted)]" aria-hidden="true" />
            No data
          </span>
        ) : data ? (
          <>
            <span className={`inline-flex items-center gap-1 ${getAvailabilityColor(data.health.availability)}`} title={getTooltip(data.health)}>
              <Activity size={12} aria-hidden="true" />
              <span>{formatCompact(data.health)}</span>
            </span>
            <span className="text-[var(--text-muted)]" aria-label={`Last updated ${formatRelativeTime(data.lastUpdated)}`}>
              {formatRelativeTime(data.lastUpdated)}
            </span>
          </>
        ) : null}
      </div>
    );
  }

  // Full expanded version
  return (
    <div className="p-3 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border)] min-w-[280px]">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-[13px] flex items-center gap-2">
          <Gauge size={16} className="text-[var(--accent)]" aria-hidden="true" />
          Live Performance
        </h3>
        <button
          onClick={fetchHealth}
          disabled={loading}
          className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--hover)] transition-colors"
          aria-label="Refresh performance data"
          title="Refresh"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} aria-hidden="true" />
        </button>
      </div>

      {loading && !data ? (
        <div className="flex items-center justify-center py-6 text-[var(--text-muted)]">
          <Activity size={20} className="animate-spin mr-2" aria-hidden="true" />
          Fetching provider diagnostics…
        </div>
      ) : error && !data ? (
        <div className="text-center py-4 text-[var(--text-muted)]">
          <Gauge size={24} className="mx-auto mb-2 opacity-50" aria-hidden="true" />
          <p className="text-[12px]">{error}</p>
          <button
            onClick={fetchHealth}
            className="mt-2 text-[11px] text-[var(--accent)] hover:underline"
          >
            Try again
          </button>
        </div>
      ) : data ? (
        <div className="space-y-3" role="region" aria-label="Performance metrics">
          {/* Primary metrics row */}
          <div className="grid grid-cols-2 gap-2">
            <MetricCard
              label="Tokens/sec"
              value={data.health.tokensPerSecond > 0 ? data.health.tokensPerSecond.toFixed(1) : "—"}
              icon={<Zap size={14} />}
              trend={data.health.tokensPerSecond > 10 ? "up" : data.health.tokensPerSecond > 0 ? "neutral" : "down"}
              unit="tok/s"
            />
            <MetricCard
              label="Avg Latency"
              value={data.health.averageLatencyMs > 0 ? `${data.health.averageLatencyMs}ms` : "—"}
              icon={<Activity size={14} />}
              trend={data.health.averageLatencyMs > 0 && data.health.averageLatencyMs < 2000 ? "up" : data.health.averageLatencyMs > 0 ? "neutral" : "down"}
              unit="ms"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <MetricCard
              label="First Token"
              value={data.health.averageFirstTokenMs > 0 ? `${data.health.averageFirstTokenMs}ms` : "—"}
              icon={<TrendingUp size={14} />}
              trend={data.health.averageFirstTokenMs > 0 && data.health.averageFirstTokenMs < 500 ? "up" : data.health.averageFirstTokenMs > 0 ? "neutral" : "down"}
              unit="ms"
            />
            <MetricCard
              label="Success Rate"
              value={data.health.successRate >= 0 ? `${(data.health.successRate * 100).toFixed(0)}%` : "—"}
              icon={<Activity size={14} />}
              trend={data.health.successRate >= 0.95 ? "up" : data.health.successRate >= 0.8 ? "neutral" : "down"}
              unit="%"
            />
          </div>

          {/* Queue & pacing */}
          <div className="grid grid-cols-2 gap-2 pt-1 border-t border-[var(--border)]">
            <MetricCard
              label="Queue Depth"
              value={data.health.queueDepth.toString()}
              icon={<Activity size={14} />}
              trend={data.health.queueDepth === 0 ? "up" : data.health.queueDepth < 5 ? "neutral" : "down"}
              unit="req"
            />
            <MetricCard
              label="Effective Interval"
              value={data.health.effectiveIntervalMs > 0 ? `${data.health.effectiveIntervalMs}ms` : "—"}
              icon={<Gauge size={14} />}
              trend={data.health.effectiveIntervalMs > 0 && data.health.effectiveIntervalMs < 1000 ? "up" : data.health.effectiveIntervalMs > 0 ? "neutral" : "down"}
              unit="ms"
            />
          </div>

          {/* Health status */}
          <div className="flex items-center justify-between pt-1 border-t border-[var(--border)]">
            <span className="text-[11px] text-[var(--text-muted)]">Provider Status</span>
            <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium ${getAvailabilityColor(data.health.availability)} bg-opacity-10`}>
              <Activity size={12} aria-hidden="true" />
              {getAvailabilityLabel(data.health.availability)}
            </span>
          </div>

          {/* Recommended wait */}
          {data.health.recommendedWaitMs > 0 && (
            <div className="flex items-center gap-2 text-[11px] text-amber-400 bg-amber-900/20 rounded-lg px-2 py-1.5">
              <Zap size={12} aria-hidden="true" />
              <span>Next request in ~{Math.round(data.health.recommendedWaitMs / 1000)}s (rate limited)</span>
            </div>
          )}

          <div className="text-[10px] text-[var(--text-muted)] text-right">
            Updated {formatRelativeTime(data.lastUpdated)}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MetricCard({
  label,
  value,
  icon,
  trend,
  unit,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  trend: "up" | "down" | "neutral";
  unit: string;
}) {
  const trendIcon = trend === "up" ? <TrendingUp size={12} className="text-emerald-400" /> :
                    trend === "down" ? <TrendingDown size={12} className="text-rose-400" /> :
                    <Minus size={12} className="text-amber-400" />;
  
  const trendLabel = trend === "up" ? "Good" : trend === "down" ? "Attention" : "Normal";

  return (
    <div className="p-2 rounded-lg bg-[var(--bg)] border border-[var(--border)]">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] text-[var(--text-muted)] flex items-center gap-1">
          {icon}
          {label}
        </span>
        <span className="text-[10px]" aria-label={trendLabel}>{trendIcon}</span>
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-[16px] font-mono font-semibold text-[var(--text)]">{value}</span>
        {unit !== "%" && unit && <span className="text-[10px] text-[var(--text-muted)]">{unit}</span>}
      </div>
    </div>
  );
}

function getAvailabilityColor(availability: ProviderHealthSummary["availability"]): string {
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
}

function getAvailabilityLabel(availability: ProviderHealthSummary["availability"]): string {
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
}

function getTooltip(health: ProviderHealthSummary): string {
  return [
    `Status: ${getAvailabilityLabel(health.availability)}`,
    `Tokens/sec: ${health.tokensPerSecond.toFixed(1)}`,
    `Avg Latency: ${health.averageLatencyMs}ms`,
    `First Token: ${health.averageFirstTokenMs}ms`,
    `Success Rate: ${(health.successRate * 100).toFixed(1)}%`,
    `Queue: ${health.queueDepth}`,
    `Interval: ${health.effectiveIntervalMs}ms`,
  ].join("\n");
}

function formatCompact(health: ProviderHealthSummary): string {
  if (health.tokensPerSecond > 0) {
    return `${health.tokensPerSecond.toFixed(0)} tok/s · ${health.averageLatencyMs}ms`;
  }
  return `${health.averageLatencyMs}ms · ${(health.successRate * 100).toFixed(0)}%`;
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 1000) return "just now";
  if (diff < 60000) return `${Math.round(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.round(diff / 60000)}m ago`;
  return `${Math.round(diff / 3600000)}h ago`;
}
