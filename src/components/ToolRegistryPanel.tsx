import React, { useState, useEffect, useRef } from 'react';
import { Wrench, Play, CheckCircle2, ChevronRight, ChevronDown, Terminal, RefreshCw } from 'lucide-react';
import { ToolDefinition, ToolResult } from '../shared/types.js';
import { api } from '../services/apiBridge.js';
import { CodingPluginsPanel } from './CodingPluginsPanel.js';

export const ToolRegistryPanel: React.FC<{ readOnly?: boolean }> = ({ readOnly = false }) => {
  const [view, setView] = useState<'plugins' | 'tools'>('plugins');
  const [tools, setTools] = useState<ToolDefinition[]>([]);
  const [selectedTool, setSelectedTool] = useState<ToolDefinition | null>(null);
  const [toolArgs, setToolArgs] = useState<string>('{}');
  const [executionResult, setExecutionResult] = useState<ToolResult | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const fetchTools = async () => {
    setIsLoading(true);
    try {
      const res = await api.getToolList();
      if (res.success) {
        setTools(res.tools);
        if (res.tools.length > 0 && (!selectedTool || !res.tools.some(t => t.name === selectedTool.name))) {
          setSelectedTool(res.tools[0]);
          setToolArgs(JSON.stringify(getDefaultArgs(res.tools[0]), null, 2));
        }
      }
    } catch (err) {
      console.error('Failed to load tool list', err);
    } finally {
      setIsLoading(false);
    }
  };

  const getDefaultArgs = (tool: ToolDefinition): Record<string, any> => {
    const args: Record<string, any> = {};
    if (tool.parameters?.properties) {
      for (const [key, prop] of Object.entries<any>(tool.parameters.properties)) {
        if (prop.type === 'string') args[key] = '';
        else if (prop.type === 'number' || prop.type === 'integer') args[key] = 0;
        else if (prop.type === 'boolean') args[key] = false;
        else if (prop.type === 'array') args[key] = [];
        else args[key] = {};
        if (key === 'dirPath') args[key] = '.';
      }
    }
    return args;
  };

  useEffect(() => {
    fetchTools();
  }, []);

  const handleRunTool = async () => {
    if (readOnly) return;
    if (!selectedTool || isExecuting) return;
    setIsExecuting(true);
    setExecutionResult(null);

    try {
      const parsedArgs = JSON.parse(toolArgs);
      let res = await api.executeTool(selectedTool.name, parsedArgs);
      if (res.needsApproval && !res.success) {
        const consent = window.confirm(`Authorize ${selectedTool.name}?\n\n${res.error || res.output}\n\nThis tool may change files, history or run commands on your PC.`);
        if (consent) res = await api.executeTool(selectedTool.name, parsedArgs, true);
      }
      setExecutionResult(res);
    } catch (err: any) {
      setExecutionResult({
        toolCallId: 'manual',
        toolName: selectedTool.name,
        success: false,
        output: '',
        error: `JSON parse or execution error: ${err.message}`,
        durationMs: 0,
      });
    } finally {
      setIsExecuting(false);
    }
  };

  // Group tools by category
  const categories = tools.reduce((acc, t) => {
    const cat = t.category || 'other';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(t);
    return acc;
  }, {} as Record<string, ToolDefinition[]>);

  // Plugins/Tools switch as a proper tablist: roving tabindex + arrow keys.
  const tabRefs = useRef<Record<'plugins' | 'tools', HTMLButtonElement | null>>({ plugins: null, tools: null });
  const activateTab = (next: 'plugins' | 'tools') => {
    if (next === view) return;
    if (next === 'tools') fetchTools();
    setView(next);
    requestAnimationFrame(() => tabRefs.current[next]?.focus());
  };
  const onTabsKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    activateTab(view === 'plugins' ? 'tools' : 'plugins');
  };
  const tabAttrs = (id: 'plugins' | 'tools') => ({
    ref: (el: HTMLButtonElement | null) => { tabRefs.current[id] = el; },
    type: 'button' as const,
    role: 'tab' as const,
    'aria-selected': view === id,
    tabIndex: view === id ? 0 : -1,
    onKeyDown: onTabsKeyDown,
  });

  if (view === 'plugins') return <div className="h-full overflow-y-auto bg-[var(--surface)] text-[var(--text)]"><div className="flex p-2 gap-2 border-b border-[var(--border)]" role="tablist" aria-label="Tools and plugins"><button {...tabAttrs('plugins')} className="text-xs px-2 py-1 rounded bg-[var(--accent-soft)] text-[var(--accent)]" onClick={() => activateTab('plugins')}>Plugins</button><button {...tabAttrs('tools')} className="text-xs px-2 py-1 rounded" onClick={() => activateTab('tools')}>Tools ({tools.length})</button></div><CodingPluginsPanel compact readOnly={readOnly} onChanged={fetchTools} onSelectTool={name => {
    const selected = tools.find(t => t.name === name);
    if (selected) { setSelectedTool(selected); setToolArgs(JSON.stringify(getDefaultArgs(selected), null, 2)); setExecutionResult(null); setView('tools'); }
  }} /></div>;

  return (
    <div className="h-full flex flex-col bg-[#0d1117] text-[#c9d1d9] text-xs">
      <div className="h-9 px-3 border-b border-[#30363d] flex items-center justify-between select-none shrink-0">
        <div className="flex items-center space-x-1.5 font-semibold text-xs tracking-wider uppercase text-[#8b949e]" role="tablist" aria-label="Tools and plugins">
          <Wrench size={13} className="text-blue-400" />
          <button {...tabAttrs('plugins')} className="text-blue-400" onClick={() => activateTab('plugins')}>Plugins</button><button {...tabAttrs('tools')} className="text-[#c9d1d9]" onClick={() => activateTab('tools')}>Tools ({tools.length})</button>
        </div>
        <button onClick={fetchTools} className="p-1 hover:text-white rounded" aria-label="Refresh tools" title="Refresh tools">
          <RefreshCw size={13} className={isLoading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="flex-1 flex flex-col overflow-y-auto">
        {/* Tool Selector */}
        <div className="p-2 border-b border-[#30363d] bg-[#161b22]">
          <select
            aria-label="Select coding tool"
            value={selectedTool?.name || ''}
            onChange={(e) => {
              const tool = tools.find((t) => t.name === e.target.value);
              if (tool) {
                setSelectedTool(tool);
                setToolArgs(JSON.stringify(getDefaultArgs(tool), null, 2));
                setExecutionResult(null);
              }
            }}
            className="w-full bg-[#0d1117] border border-[#30363d] text-white rounded px-2 py-1 outline-none text-xs"
          >
            {Object.entries(categories).map(([cat, list]) => (
              <optgroup key={cat} label={cat.toUpperCase()}>
                {list.map((t, idx) => (
                  <option key={`${t.name}_${idx}`} value={t.name}>
                    {t.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>

          {selectedTool && (
            <p className="text-[11px] text-[#8b949e] mt-1.5 leading-relaxed">
              {selectedTool.description}
            </p>
          )}
        </div>

        {/* Arguments Editor */}
        <div className="p-3 flex flex-col space-y-2 border-b border-[#30363d]">
          <div className="flex items-center justify-between text-[11px] text-[#8b949e] font-semibold uppercase">
            <span>Arguments (JSON)</span>
            <span className="font-mono text-blue-400">{selectedTool?.name}</span>
          </div>

          <textarea
            aria-label="Tool arguments JSON"
            rows={5}
            value={toolArgs}
            onChange={(e) => setToolArgs(e.target.value)}
            className="w-full bg-[#161b22] border border-[#30363d] font-mono text-[11px] text-white rounded p-2 outline-none resize-none"
          />

          <button
            onClick={handleRunTool}
            disabled={readOnly || isExecuting || !selectedTool}
            className="w-full py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded font-medium transition-colors flex items-center justify-center space-x-1.5 shadow-sm"
          >
            <Play size={13} />
            <span>{isExecuting ? 'Invoking Tool...' : 'Execute Tool'}</span>
          </button>
        </div>

        {/* Execution Output */}
        {executionResult && (
          <div className="p-3 flex flex-col space-y-2">
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-semibold uppercase text-[#8b949e]">Result</span>
              <span
                className={`font-semibold ${
                  executionResult.success ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {executionResult.success ? 'SUCCESS' : 'FAILURE'} ({executionResult.durationMs}ms)
              </span>
            </div>

            <pre className="p-2.5 rounded bg-[#161b22] border border-[#30363d] font-mono text-[11px] text-[#c9d1d9] overflow-x-auto whitespace-pre-wrap max-h-60">
              {executionResult.error || executionResult.output || JSON.stringify(executionResult.data, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
};
