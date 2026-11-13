import React, { useState } from 'react';
import { PlayCircle, CheckCircle2, XCircle, Wrench, Sparkles, RefreshCw, Terminal } from 'lucide-react';
import { api } from '../services/apiBridge.js';

interface BuildTestPanelProps {
  onFixWithAgent: (errorLog: string) => void;
  readOnly?: boolean;
}

export const BuildTestPanel: React.FC<BuildTestPanelProps> = ({ onFixWithAgent, readOnly = false }) => {
  const [isRunning, setIsRunning] = useState(false);
  const [currentTask, setCurrentTask] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{
    task: string;
    exitCode: number;
    stdout: string;
    stderr: string;
    durationMs: number;
  } | null>(null);

  const runTask = async (taskName: string, command: string) => {
    if (readOnly || isRunning) return;
    setIsRunning(true);
    setCurrentTask(taskName);
    setLastResult(null);

    const startTime = Date.now();
    try {
      const res = await api.runCommand(command);
      if (!res.success || !res.result) {
        throw new Error(res.error || 'Command failed to run.');
      }
      setLastResult({
        task: taskName,
        exitCode: res.result.exitCode,
        stdout: res.result.stdout,
        stderr: res.result.stderr,
        durationMs: Date.now() - startTime,
      });
    } catch (err: any) {
      setLastResult({
        task: taskName,
        exitCode: 1,
        stdout: '',
        stderr: err.message,
        durationMs: Date.now() - startTime,
      });
    } finally {
      setIsRunning(false);
      setCurrentTask(null);
    }
  };

  return (
    <div className="h-full flex flex-col bg-[#0d1117] text-[#c9d1d9] text-xs">
      {/* Header */}
      <div className="h-9 px-3 border-b border-[#30363d] flex items-center justify-between select-none shrink-0">
        <span className="font-semibold text-xs tracking-wider uppercase text-[#8b949e]">Build & Tests</span>
      </div>
      {readOnly && <div role="status" className="px-3 py-1 text-[11px] text-amber-200 bg-amber-950/40">Build and test commands are disabled in Chat mode.</div>}

      {/* Task buttons */}
      <div className="p-3 border-b border-[#30363d] flex flex-col space-y-2 shrink-0">
        <button
          onClick={() => runTask('Run Tests', 'npm test')}
          disabled={readOnly || isRunning}
          className="w-full py-2 bg-[#161b22] hover:bg-[#21262d] border border-[#30363d] rounded text-left px-3 flex items-center justify-between transition-colors"
        >
          <div className="flex items-center space-x-2">
            <PlayCircle size={15} className="text-blue-400" />
            <span className="font-medium text-white">Run Unit Tests</span>
          </div>
          <span className="font-mono text-[11px] text-[#8b949e]">vitest</span>
        </button>

        <button
          onClick={() => runTask('Run Build', 'npm run build')}
          disabled={readOnly || isRunning}
          className="w-full py-2 bg-[#161b22] hover:bg-[#21262d] border border-[#30363d] rounded text-left px-3 flex items-center justify-between transition-colors"
        >
          <div className="flex items-center space-x-2">
            <Wrench size={15} className="text-emerald-400" />
            <span className="font-medium text-white">Compile & Build</span>
          </div>
          <span className="font-mono text-[11px] text-[#8b949e]">vite + esbuild</span>
        </button>

        <button
          onClick={() => runTask('Run TypeCheck', 'npm run lint')}
          disabled={readOnly || isRunning}
          className="w-full py-2 bg-[#161b22] hover:bg-[#21262d] border border-[#30363d] rounded text-left px-3 flex items-center justify-between transition-colors"
        >
          <div className="flex items-center space-x-2">
            <CheckCircle2 size={15} className="text-purple-400" />
            <span className="font-medium text-white">TypeScript Check</span>
          </div>
          <span className="font-mono text-[11px] text-[#8b949e]">tsc</span>
        </button>
      </div>

      {/* Result & Log View */}
      <div className="flex-1 overflow-y-auto p-3 flex flex-col">
        {isRunning && (
          <div className="flex items-center space-x-2 text-blue-400 font-medium py-3">
            <RefreshCw size={14} className="animate-spin" />
            <span>Executing {currentTask}...</span>
          </div>
        )}

        {lastResult && (
          <div className="flex flex-col space-y-3">
            <div
              className={`p-2.5 rounded-lg border flex items-center justify-between ${
                lastResult.exitCode === 0
                  ? 'bg-emerald-950/40 border-emerald-800 text-emerald-300'
                  : 'bg-rose-950/40 border-rose-800 text-rose-300'
              }`}
            >
              <div className="flex items-center space-x-2">
                {lastResult.exitCode === 0 ? (
                  <CheckCircle2 size={16} className="text-emerald-400" />
                ) : (
                  <XCircle size={16} className="text-rose-400" />
                )}
                <span className="font-semibold">
                  {lastResult.task} {lastResult.exitCode === 0 ? 'Passed' : 'Failed'}
                </span>
              </div>
              <span className="text-[11px] font-mono text-[#8b949e]">
                {lastResult.durationMs}ms
              </span>
            </div>

            {/* Autonomous Repair button if failed */}
            {lastResult.exitCode !== 0 && (
              <button
                onClick={() =>
                  onFixWithAgent(
                    `Task '${lastResult.task}' failed with exit code ${lastResult.exitCode}.\n\nOutput:\n${lastResult.stdout}\n\nErrors:\n${lastResult.stderr}`
                  )
                }
                className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium transition-colors flex items-center justify-center space-x-2 shadow-md"
              >
                <Sparkles size={14} />
                <span>Fix Failure with Autonomous Agent</span>
              </button>
            )}

            {/* Logs */}
            <div className="flex flex-col space-y-1">
              <span className="text-[11px] font-semibold text-[#8b949e] uppercase">Console Logs</span>
              <pre className="p-2.5 rounded bg-[#161b22] border border-[#30363d] font-mono text-[11px] text-[#c9d1d9] overflow-x-auto whitespace-pre-wrap max-h-72">
                {lastResult.stdout || lastResult.stderr || '(No log output)'}
              </pre>
            </div>
          </div>
        )}

        {!isRunning && !lastResult && (
          <div className="text-center text-[#8b949e] py-8">
            Click any task above to run validation tests or compile the application.
          </div>
        )}
      </div>
    </div>
  );
};
