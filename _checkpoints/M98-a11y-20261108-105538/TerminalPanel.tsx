import React, { useState, useRef, useEffect } from 'react';
import {
  Terminal as TerminalIcon,
  Play,
  Plus,
  Trash2,
  Copy,
  Check,
  ShieldAlert,
  ShieldCheck,
  Shield,
  CornerDownLeft,
  X,
  Bot,
  Square,
  RotateCw,
  ArrowDownToLine,
} from 'lucide-react';
import { CommandExecutionResult, CommandRisk, TerminalHistoryEntry } from '../shared/types.js';
import { api } from '../services/apiBridge.js';

interface TerminalTab {
  id: string;
  title: string;
  shell: 'powershell' | 'cmd' | 'bash';
  history: CommandExecutionResult[];
  /** Last executed command — used by the RESTART button. */
  lastCommand?: string;
}

interface TerminalPanelProps {
  workspaceRoot: string;
  isOpen: boolean;
  onClose: () => void;
  onRequestApproval?: (command: string, risk: CommandRisk, onApproved: () => void) => void;
  /** Panel height in px — driven by the draggable divider above the panel. */
  height?: number;
  readOnly?: boolean;
}

export const TerminalPanel: React.FC<TerminalPanelProps> = ({
  workspaceRoot,
  isOpen,
  onClose,
  onRequestApproval,
  height = 256,
  readOnly = false,
}) => {
  const [tabs, setTabs] = useState<TerminalTab[]>([
    { id: 'term_1', title: 'PowerShell / Shell 1', shell: 'powershell', history: [] },
  ]);
  const [activeTabId, setActiveTabId] = useState('term_1');
  const [inputCommand, setInputCommand] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [copied, setCopied] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const outputEndRef = useRef<HTMLDivElement>(null);

  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0];

  // --- Real agent command feed -------------------------------------------
  // Commands the coding agent executes (run_command / build / tests) are
  // recorded server-side; poll them so the user can SEE what Quillix runs.
  const [agentHistory, setAgentHistory] = useState<TerminalHistoryEntry[]>([]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await api.getTerminalHistory(30);
        if (!cancelled && res.success && Array.isArray(res.history)) {
          setAgentHistory(res.history.filter((h: TerminalHistoryEntry) => h.source === 'agent'));
        }
      } catch {
        // server briefly unreachable — keep showing the last snapshot
      }
    };
    load();
    const timer = setInterval(load, 2500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [isOpen]);

  useEffect(() => {
    if (autoScroll) {
      outputEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [activeTab?.history, isRunning, autoScroll]);

  const addTab = () => {
    const newId = `term_${Date.now()}`;
    const newTab: TerminalTab = {
      id: newId,
      title: `Terminal ${tabs.length + 1}`,
      shell: 'powershell',
      history: [],
    };
    setTabs([...tabs, newTab]);
    setActiveTabId(newId);
  };

  const closeTab = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (tabs.length <= 1) return;
    const remaining = tabs.filter((t) => t.id !== id);
    setTabs(remaining);
    if (activeTabId === id) {
      setActiveTabId(remaining[0].id);
    }
  };

  const clearCurrentTerminal = () => {
    setTabs((prev) =>
      prev.map((t) => (t.id === activeTabId ? { ...t, history: [] } : t))
    );
  };

  const copyTerminalOutput = () => {
    const text = activeTab.history
      .map((h) => `$ ${h.command}\n${h.stdout}${h.stderr ? '\n' + h.stderr : ''}`)
      .join('\n\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const executeCommandRaw = async (cmd: string) => {
    if (readOnly || !cmd.trim() || isRunning) return;
    setTabs((prev) => prev.map((t) => (t.id === activeTabId ? { ...t, lastCommand: cmd } : t)));
    setIsRunning(true);
    try {
      let res = await api.runCommand(cmd, undefined, activeTab.shell);

      // Server-side approval enforcement: dangerous commands come back with
      // needsApproval when Terminal Approval is ON.
      if (res.needsApproval) {
        const approved = window.confirm(
          `"${cmd}" needs approval before execution.\n\n${res.reason || ''}\n\nAuthorize and run it?`
        );
        if (!approved) return;
        res = await api.runCommand(cmd, undefined, activeTab.shell, true);
      }

      if (res.success && res.result) {
        setTabs((prev) =>
          prev.map((t) =>
            t.id === activeTabId ? { ...t, history: [...t.history, res.result!] } : t
          )
        );
      } else if (res.error) {
        const failedResult: CommandExecutionResult = {
          command: cmd,
          cwd: workspaceRoot,
          risk: 'SAFE',
          stdout: '',
          stderr: res.error,
          exitCode: 1,
          durationMs: 0,
        };
        setTabs((prev) =>
          prev.map((t) =>
            t.id === activeTabId ? { ...t, history: [...t.history, failedResult] } : t
          )
        );
      }
    } catch (err: any) {
      const failedResult: CommandExecutionResult = {
        command: cmd,
        cwd: workspaceRoot,
        risk: 'SAFE',
        stdout: '',
        stderr: err.message,
        exitCode: 1,
        durationMs: 0,
      };
      setTabs((prev) =>
        prev.map((t) =>
          t.id === activeTabId ? { ...t, history: [...t.history, failedResult] } : t
        )
      );
    } finally {
      setIsRunning(false);
    }
  };

  const handleCommandSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (readOnly) return;
    const cmd = inputCommand.trim();
    if (!cmd || isRunning) return;
    setInputCommand('');

    // Check risk first
    const riskCheck = await api.checkRisk(cmd);
    if (riskCheck.risk === 'DANGEROUS' && onRequestApproval) {
      onRequestApproval(cmd, riskCheck.risk, () => {
        executeCommandRaw(cmd);
      });
      return;
    }

    executeCommandRaw(cmd);
  };

  if (!isOpen) return null;

  return (
    <div
      className="bg-[#0d1117] border-t border-[#30363d] flex flex-col text-xs text-[#c9d1d9] select-none shrink-0 z-10"
      style={{ height }}
    >
      {readOnly && <div role="status" className="px-3 py-1 text-[11px] text-amber-200 bg-amber-950/40">Terminal commands are disabled in Chat mode. Switch to Agent mode to run commands.</div>}
      {/* Top Bar with Tabs and Controls */}
      <div className="h-9 min-h-9 px-2 bg-[#161b22] border-b border-[#30363d] flex items-center justify-between gap-2 overflow-x-auto whitespace-nowrap">
        <div className="flex items-center space-x-1 overflow-x-auto">
          {tabs.map((tab, idx) => {
            const isActive = tab.id === activeTabId;
            return (
              <div
                key={`${tab.id}_${idx}`}
                onClick={() => setActiveTabId(tab.id)}
                className={`flex items-center space-x-2 px-2.5 py-1 rounded cursor-pointer text-xs transition-colors ${
                  isActive
                    ? 'bg-[#0d1117] text-white border border-[#30363d] font-medium'
                    : 'text-[#8b949e] hover:text-[#c9d1d9] hover:bg-[#21262d]'
                }`}
              >
                <TerminalIcon size={12} className="text-blue-400" />
                <span>{tab.title}</span>
                {tabs.length > 1 && (
                  <button
                    onClick={(e) => closeTab(tab.id, e)}
                    className="p-0.5 hover:text-white rounded"
                  >
                    <X size={10} />
                  </button>
                )}
              </div>
            );
          })}
          <button
            onClick={addTab}
            title="New Terminal"
            className="p-1 text-[#8b949e] hover:text-white hover:bg-[#21262d] rounded"
          >
            <Plus size={13} />
          </button>
        </div>

        {/* Quick actions & controls */}
        <div className="flex shrink-0 items-center space-x-2">
          {/* Preset quick command buttons */}
          <div className="flex items-center space-x-1 text-[11px]">
            <button
              onClick={() => executeCommandRaw('npm test')}
              disabled={readOnly || isRunning}
              className="px-2 py-0.5 rounded bg-[#21262d] hover:bg-[#30363d] text-[#58a6ff]"
            >
              npm test
            </button>
            <button
              onClick={() => executeCommandRaw('npm run build')}
              disabled={readOnly || isRunning}
              className="px-2 py-0.5 rounded bg-[#21262d] hover:bg-[#30363d] text-emerald-400"
            >
              npm run build
            </button>
            <button
              onClick={() => executeCommandRaw('git status')}
              disabled={readOnly || isRunning}
              className="px-2 py-0.5 rounded bg-[#21262d] hover:bg-[#30363d] text-amber-400"
            >
              git status
            </button>
          </div>

          <div className="h-4 w-px bg-[#30363d]" />

          <button
            onClick={async () => {
              await api.stopTerminalCommand();
            }}
            disabled={!isRunning}
            title="Stop the running command process"
            className="p-1 text-[#8b949e] hover:text-red-400 hover:bg-[#21262d] rounded disabled:opacity-40"
          >
            <Square size={13} />
          </button>
          <button
            onClick={() => {
              const last = activeTab?.lastCommand;
              if (last) executeCommandRaw(last);
            }}
            disabled={isRunning || !activeTab?.lastCommand}
            title="Restart last command"
            className="p-1 text-[#8b949e] hover:text-white hover:bg-[#21262d] rounded disabled:opacity-40"
          >
            <RotateCw size={13} />
          </button>
          <button
            onClick={() => setAutoScroll((v) => !v)}
            title={autoScroll ? 'Auto-scroll ON — click to disable' : 'Auto-scroll OFF — click to enable'}
            className={`p-1 rounded ${autoScroll ? 'text-emerald-400' : 'text-[#8b949e] hover:text-white'} hover:bg-[#21262d]`}
          >
            <ArrowDownToLine size={13} />
          </button>
          <button
            onClick={copyTerminalOutput}
            title="Copy Output"
            className="p-1 text-[#8b949e] hover:text-white hover:bg-[#21262d] rounded"
          >
            {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
          </button>
          <button
            onClick={clearCurrentTerminal}
            title="Clear Terminal"
            className="p-1 text-[#8b949e] hover:text-white hover:bg-[#21262d] rounded"
          >
            <Trash2 size={13} />
          </button>
          <button
            onClick={onClose}
            title="Close Panel"
            className="p-1 text-[#8b949e] hover:text-white hover:bg-[#21262d] rounded"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {/* Terminal Output Log Area */}
      <div className="flex-1 overflow-y-auto p-3 font-mono text-[12px] bg-[#0d1117] select-text">
        {agentHistory.length > 0 && (
          <div className="mb-4">
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-purple-400 mb-1.5">
              <Bot size={11} /> Quillix agent activity
            </div>
            {agentHistory.map((h) => (
              <div key={h.id} className="mb-2">
                <div className="flex items-center space-x-2 text-purple-400 font-semibold">
                  <span>❯</span>
                  <span className="text-white">{h.command}</span>
                  <span className="text-[10px] text-[#8b949e]">({h.durationMs}ms, code {h.exitCode})</span>
                  <span
                    className={`px-1 rounded text-[10px] border ${
                      h.exitCode === 0
                        ? 'bg-emerald-950 text-emerald-400 border-emerald-800'
                        : 'bg-rose-950 text-rose-400 border-rose-800'
                    }`}
                  >
                    {h.exitCode === 0 ? 'SUCCESS' : 'ERROR'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
        {activeTab.history.length === 0 && agentHistory.length === 0 ? (
          <div className="text-[#8b949e] leading-relaxed">
            Windows PowerShell / Terminal Ready.<br />
            Working Directory: <span className="text-[#58a6ff]">{workspaceRoot}</span><br />
            Type a command below or click a quick action above.
          </div>
        ) : (
          activeTab.history.map((h, i) => (
            <div key={i} className="mb-3">
              <div className="flex items-center space-x-2 text-[#58a6ff] font-semibold">
                <span>❯</span>
                <span className="text-white">{h.command}</span>
                <span className="text-[10px] text-[#8b949e]">
                  ({h.durationMs}ms, code {h.exitCode})
                </span>
                {h.risk === 'DANGEROUS' && (
                  <span className="px-1 py-0.2 rounded bg-rose-950 text-rose-400 text-[10px] border border-rose-800">
                    DANGEROUS
                  </span>
                )}
              </div>
              {h.stdout && (
                <pre className="whitespace-pre-wrap text-[#c9d1d9] mt-1 pl-3 leading-relaxed">
                  {h.stdout}
                </pre>
              )}
              {h.stderr && (
                <pre className="whitespace-pre-wrap text-rose-400 mt-1 pl-3 leading-relaxed">
                  {h.stderr}
                </pre>
              )}
            </div>
          ))
        )}

        {isRunning && (
          <div className="flex items-center space-x-2 text-blue-400 font-mono text-xs animate-pulse">
            <span className="w-2 h-2 rounded-full bg-blue-400" />
            <span>Executing command...</span>
          </div>
        )}

        <div ref={outputEndRef} />
      </div>

      {/* Terminal Command Input */}
      <form
        onSubmit={handleCommandSubmit}
        className="h-10 px-3 bg-[#161b22] border-t border-[#30363d] flex items-center space-x-2 shrink-0"
      >
        <span className="text-blue-400 font-mono font-bold">❯</span>
        <input
          type="text"
          placeholder="Run terminal command... (e.g. 'npm test', 'git diff', 'ls -la')"
          value={inputCommand}
          onChange={(e) => setInputCommand(e.target.value)}
          disabled={readOnly || isRunning}
          className="flex-1 bg-transparent text-xs text-white font-mono outline-none placeholder-[#8b949e]"
        />
        <button
          type="submit"
          disabled={readOnly || !inputCommand.trim() || isRunning}
          className="p-1 text-[#8b949e] hover:text-white disabled:opacity-30"
          aria-label="Run terminal command"
          title="Run terminal command"
        >
          <CornerDownLeft size={14} />
        </button>
      </form>
    </div>
  );
};
