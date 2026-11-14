import React, { useCallback, useEffect, useState } from "react";
import { Blocks, Check, ChevronDown, HardDrive, Loader2, RefreshCw, Search, ShieldCheck } from "lucide-react";
import type { CodingPlugin } from "../shared/codingPlugins.js";
import { api } from "../services/apiBridge.js";

export function CodingPluginsPanel({ compact = false, onChanged, onSelectTool, readOnly = false }: {
  compact?: boolean;
  readOnly?: boolean;
  onChanged?: () => void;
  onSelectTool?: (name: string) => void;
}) {
  const [plugins, setPlugins] = useState<CodingPlugin[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [detailsOpen, setDetailsOpen] = useState<Record<string, boolean>>({});
  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const result = await api.getCodingPlugins();
      if (!result.success || !Array.isArray(result.plugins)) throw new Error("Could not load coding plugins.");
      setPlugins(result.plugins);
    } catch (e: any) { setError(e.message || "Could not reach the local server."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  const toggle = async (plugin: CodingPlugin) => {
    setBusy(plugin.id); setError("");
    try {
      const result = await api.setCodingPlugin(plugin.id, !plugin.enabled);
      if (!result.success) throw new Error(result.error || "Could not save plugin setting.");
      await refresh(); onChanged?.();
    } catch (e: any) { setError(e.message); }
    finally { setBusy(null); }
  };
  const bundled = plugins.filter(p => p.source === "bundled");
  const visible = plugins.filter(p => `${p.name} ${p.description} ${p.tools.join(" ")}`.toLowerCase().includes(query.toLowerCase()));
  return <section className={`q-coding-plugins ${compact ? "q-plugins-compact" : ""}`} aria-label="Coding plugins">
    <div className="q-plugins-heading">
      <div><div className="q-plugins-eyebrow"><Blocks size={13} /> LOCAL CAPABILITIES</div><h2>Coding plugins</h2></div>
      <button onClick={refresh} disabled={loading || !!busy} className="q-icon-button" aria-label="Refresh coding plugins"><RefreshCw size={15} className={loading ? "animate-spin" : ""} /></button>
    </div>
    <p className="q-plugins-intro">Installed with QUILLIX. No account, API key, or internet needed for bundled packs.</p>
    {!loading && <div className="q-plugins-summary"><HardDrive size={13} /><span>{bundled.filter(p => p.enabled).length} / {bundled.length} offline packs enabled</span><Check size={12} /></div>}
    <label className="q-plugins-search"><Search size={14} /><input aria-label="Search coding plugins" placeholder="Find a capability…" value={query} onChange={e => setQuery(e.target.value)} /></label>
    {error && <p role="alert" className="q-plugins-error">{error}</p>}
    {loading && !plugins.length && <p role="status" className="q-plugins-intro">Loading installed packs…</p>}
    <div className="q-plugins-grid">{visible.map(plugin => <article key={plugin.id} className={`q-plugin-card ${plugin.enabled ? "" : "q-plugin-disabled"}`}>
      <div className="q-plugin-title"><span className="q-plugin-icon"><Blocks size={17} /></span><h3>{plugin.name}</h3>
        {plugin.manageable ? <button role="switch" aria-checked={plugin.enabled} aria-label={`Enable ${plugin.name}`} disabled={readOnly || !!busy || loading} onClick={() => toggle(plugin)} className="q-plugin-switch">{busy === plugin.id ? <Loader2 size={11} className="animate-spin" /> : <span />}</button> : <span className="q-plugin-core">Core</span>}
      </div>
      <p>{plugin.description}</p>
      <div className="q-plugin-badges"><span><HardDrive size={11} />{plugin.offline ? "Offline ready" : "Network required"}</span><span>{plugin.tools.length} tools</span></div>
      {!!plugin.packages?.length && <div className="q-plugin-packages">{plugin.packages.join(" · ")}</div>}
      <details>
        <summary
          className="cursor-pointer text-[11px] text-[var(--text-muted)] hover:text-[var(--text)] flex items-center gap-1.5"
          aria-expanded={detailsOpen[plugin.id] || false}
          onClick={(e) => {
            e.preventDefault();
            setDetailsOpen(prev => ({ ...prev, [plugin.id]: !prev[plugin.id] }));
          }}
        >
          Tools & details <ChevronDown size={12} className={`transition-transform ${detailsOpen[plugin.id] ? "rotate-90" : ""}`} aria-hidden="true" />
        </summary>
        <div className="q-plugin-tools">{plugin.tools.map(name => onSelectTool && plugin.enabled ? <button key={name} onClick={() => onSelectTool(name)}>{name}</button> : <code key={name}>{name}</code>)}</div>{plugin.documentation && <a href={plugin.documentation} target="_blank" rel="noreferrer">Official documentation ↗</a>}
      </details>
    </article>)}</div>
    {!loading && !visible.length && <p className="q-plugins-intro">No installed packs match your search.</p>}
    <p className="q-plugins-safety"><ShieldCheck size={14} /><span>Workspace boundaries and secret protection stay on. Formatting follows Auto Apply Diffs. No workspace config scripts or remote plugins are loaded by these packs. Project commands still need their own installed runtimes and dependencies.</span></p>
  </section>;
}
