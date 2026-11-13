import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { resultPresentation, latestVerificationResults } from '../shared/resultPresentation.js';
import {
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Copy,
  Clock,
  AlertCircle,
  Loader2,
  Play,
  FileText,
  RotateCcw,
  ArrowRight,
  ShieldAlert,
  Wrench,
} from 'lucide-react';
import { AgentActivity, AgentPhase, ChatMessage, FilePatch, ToolResult } from '../shared/types.js';
import { useAmbientMotion } from './AmbientEffects.js';
import { summarizePhaseProgress } from '../shared/phaseProgress.js';
import {
  messageVariants,
  staggerContainerVariants,
  slideUpVariants,
  scaleSpringVariants,
  accordionVariants,
  fadeVariants,
  tabSwitchVariants,
  slideAndFadeVariants,
  springEntranceVariants,
  ambientGlowPulseVariants,
} from '../animations/index.js';

/* ------------------------------------------------------------------ */
/* Friendly activity labels — no raw tool dumps in the main UI         */
/* ------------------------------------------------------------------ */

const ACTIVITY_LABELS: Partial<Record<AgentActivity['type'], string>> = {
  thinking: 'Thinking',
  searching_code: 'Analyzing project',
  reading_file: 'Reading relevant files',
  planning: 'Planning changes',
  editing_file: 'Preparing changes',
  calling_tool: 'Working',
  running_tests: 'Running tests',
  running_command: 'Running commands',
  applying_patch: 'Applying changes',
  verifying: 'Verifying results',
  completed: 'Done',
  analyzing_error: 'Analyzing errors',
  error: 'Error',
};

function friendlyActivity(activity: AgentActivity): string {
  const label = ACTIVITY_LABELS[activity.type];
  if (label && label !== 'Working') return label;
  if (activity.type === 'calling_tool') {
    // "Calling tool: read_file" -> "Reading files (read_file)"
    const tool = activity.message.replace(/^Calling tool:\s*/i, '');
    const map: Record<string, string> = {
      read_file: 'Reading files',
      search_files: 'Searching the codebase',
      search_code: 'Searching the codebase',
      find_symbol: 'Locating symbols',
      git_status: 'Checking git status',
      list_directory: 'Inspecting the project',
      analyze_project: 'Analyzing the project',
    };
    return map[tool] || `Using ${tool.replace(/_/g, ' ')}`;
  }
  return label || activity.message;
}

/* ------------------------------------------------------------------ */
/* Chat content guard (defense in depth)                               */
/* ------------------------------------------------------------------ */

const MAX_CHAT_CODE_LINES = 12;

/**
 * Final client-side guard: raw tool-call JSON never renders in Chat, and
 * oversized code blocks are replaced with a compact pointer to the Editor.
 * (The server already sanitizes; this protects restored history.)
 */
function guardChatContent(content: string): string {
  if (!content) return content;
  // Raw tool-call JSON objects -> removed
  let out = content.replace(
    /\{\s*"(?:name|tool|function)"\s*:[^{}]*\{[\s\S]*?\}\s*\}/g,
    (match) => (/"(?:arguments|args|parameters)"/.test(match) ? '' : match)
  );
  // Oversized fenced code -> pointer note
  out = out.replace(/```([a-zA-Z0-9_+-]*)\r?\n([\s\S]*?)```/g, (_m, lang: string, code: string) => {
    const lines = code.replace(/\n$/, '').split('\n').length;
    if (lines > MAX_CHAT_CODE_LINES) {
      return `_[${lines}-line ${lang || 'code'} block — open it in the Editor]_`;
    }
    return `\`\`\`${lang}\n${code}\`\`\``;
  });
  return out;
}

/* ------------------------------------------------------------------ */
/* Markdown-lite renderer (code blocks + paragraphs)                   */
/* ------------------------------------------------------------------ */

function MessageBody({ content, messageId }: { content: string; messageId: string }) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const parts = useMemo(() => {
    const out: React.ReactNode[] = [];
    const safeContent = guardChatContent(content);
    const regex = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    let partIndex = 0;

    while ((match = regex.exec(safeContent)) !== null) {
      if (match.index > lastIndex) {
        out.push(
          <div key={`${messageId}_txt_${partIndex++}`} className="q-chat-text text-[13.5px]">
            {safeContent.substring(lastIndex, match.index)}
          </div>
        );
      }
      const code = match[2];
      const lang = match[1] || 'code';
      const codeKey = `${messageId}_code_${partIndex}`;
      out.push(
        <div key={codeKey} className="my-2.5 rounded-xl border border-[var(--border)] overflow-hidden">
          <div className="flex items-center justify-between px-3 py-1.5 bg-[var(--surface-secondary)] text-[10.5px] text-[var(--text-muted)]">
            <span className="font-mono">{lang}</span>
            <button
              onClick={() => {
                void navigator.clipboard?.writeText(code).catch(() => undefined);
                setCopiedKey(codeKey);
                setTimeout(() => setCopiedKey(null), 1600);
              }}
              className="flex items-center gap-1 hover:text-[var(--text)] q-transition"
              aria-label="Copy code"
            >
              {copiedKey === codeKey ? <Check size={11} /> : <Copy size={11} />}
              {copiedKey === codeKey ? 'Copied' : 'Copy'}
            </button>
          </div>
          <pre className="p-3 overflow-x-auto text-[12px] leading-relaxed font-mono bg-[var(--input)] text-[var(--text)]">
            {code}
          </pre>
        </div>
      );
      partIndex++;
      lastIndex = regex.lastIndex;
    }
    if (lastIndex < safeContent.length) {
      out.push(
        <div key={`${messageId}_txt_${partIndex++}`} className="q-chat-text text-[13.5px]">
          {safeContent.substring(lastIndex)}
        </div>
      );
    }
    return out;
  }, [content, messageId, copiedKey]);

  return <div>{parts}</div>;
}

/* ------------------------------------------------------------------ */
/* Activity feed                                                       */
/* ------------------------------------------------------------------ */

export const ActivityFeed: React.FC<{ activities: AgentActivity[]; compact?: boolean }> = ({
  activities,
  compact = false,
}) => {
  const [showDetails, setShowDetails] = useState(false);

  if (activities.length === 0) return null;

  // Collapse consecutive duplicates ("Reading relevant files" x5)
  const steps: Array<{ label: string; activity: AgentActivity }> = [];
  for (const act of activities) {
    const label = friendlyActivity(act);
    if (steps.length === 0 || steps[steps.length - 1].label !== label) {
      steps.push({ label, activity: act });
    }
  }
  const visible = compact ? steps.slice(-8) : steps;

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3.5">
      <div className="flex items-center justify-between mb-2">
        <span className="flex items-center gap-2 text-[12px] font-semibold text-[var(--text-muted)]">
          <Loader2 size={13} className="animate-spin" style={{ color: 'var(--accent)' }} />
          NUVRO AI is working…
        </span>
        <button
          onClick={() => setShowDetails(!showDetails)}
          className="flex items-center gap-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--text)] q-transition"
          aria-expanded={showDetails}
        >
          Details
          {showDetails ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
      </div>

      {!showDetails && (
        <ul className="space-y-1.5" aria-label="Agent activity">
          {visible.map((step, idx) => {
            const isLast = idx === visible.length - 1;
            const isDone = step.activity.type === 'completed' || idx < visible.length - 1;
            return (
              <li key={`${step.activity.id}_${idx}`} className="flex items-center gap-2.5 text-[12.5px]">
                {isDone ? (
                  <Check size={13} style={{ color: 'var(--success)' }} aria-hidden="true" />
                ) : isLast ? (
                  <Circle size={9} className="animate-pulse" style={{ color: 'var(--accent)' }} aria-hidden="true" />
                ) : (
                  <Circle size={9} style={{ color: 'var(--border)' }} aria-hidden="true" />
                )}
                <span className={isDone ? 'text-[var(--text-muted)]' : 'text-[var(--text)] font-medium'}>
                  {step.label}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {showDetails && (
        <div className="max-h-56 overflow-y-auto rounded-xl bg-[var(--input)] border border-[var(--border)] p-2.5 space-y-1 font-mono text-[11px]">
          {activities.map((act) => (
            <div key={act.id} className="flex gap-2 text-[var(--text-muted)]">
              <span className="text-[var(--text-muted)]/60 shrink-0">
                {new Date(act.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
              <span className="text-[var(--text)] truncate">{act.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Agent progress panel (collapsible) — the request-adaptive phase workflow        */
/* ------------------------------------------------------------------ */

const PHASE_STATUS_ICON: Record<AgentPhase['status'], React.ReactNode> = {
  completed: <Check size={13} aria-hidden="true" />,
  in_progress: <Loader2 size={13} className="animate-spin" aria-hidden="true" />,
  pending: <Circle size={9} aria-hidden="true" />,
  failed: <AlertCircle size={13} aria-hidden="true" />,
  skipped: <Circle size={9} aria-hidden="true" />,
};

const PHASE_STATUS_COLOR: Record<AgentPhase['status'], string> = {
  completed: 'var(--success)',
  in_progress: 'var(--accent)',
  pending: 'var(--border)',
  failed: 'var(--danger)',
  skipped: 'var(--border)',
};

export const AgentProgressPanel: React.FC<{
  phases: AgentPhase[];
  files: string[];
  isLive: boolean;
}> = ({ phases, files, isLive }) => {
  const [open, setOpen] = useState(true);
  const uniqueFiles = [...new Set(files)];
  if (phases.length === 0) return null;

  const currentIdx = phases.findIndex((p) => p.status === 'in_progress');
  const current = currentIdx >= 0 ? phases[currentIdx] : null;
  const progress = summarizePhaseProgress(phases, isLive);
  const taskStatus = isLive
    ? 'WORKING'
    : progress.failed
      ? 'FAILED'
      : progress.verifiedComplete
        ? 'CHECKS PASSED'
        : 'INCOMPLETE';

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
      {/* Header — always visible, click to toggle details */}
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-[var(--hover)] q-transition"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2.5 text-[13px] font-semibold text-[var(--text)] min-w-0">
          {isLive ? (
            <Loader2 size={14} className="animate-spin shrink-0" style={{ color: 'var(--accent)' }} />
          ) : progress.verifiedComplete ? (
            <CheckCircle2 size={14} className="shrink-0" style={{ color: 'var(--success)' }} />
          ) : (
            <AlertCircle size={14} className="shrink-0" style={{ color: 'var(--danger)' }} />
          )}
          AGENT {taskStatus}
          <span className="text-[var(--text-muted)] font-normal">
            {progress.completed}/{progress.applicable} verified steps
            {progress.skipped > 0 ? ' · ' + progress.skipped + ' not required' : ''}
            {current ? ' — ' + current.title : ''}
          </span>
        </span>
        <span className="flex items-center gap-2 shrink-0">
          <span className="text-[11px] font-mono text-[var(--text-muted)]">{progress.percent}%</span>
          {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </span>
      </button>

      {/* Progress bar */}
      <div className="h-1 bg-[var(--border)]" aria-hidden="true">
        <div
          className="h-full q-transition-all"
          style={{ width: progress.percent + '%', background: progress.failed ? 'var(--danger)' : 'var(--accent)' }}
        />
      </div>

      {open && (
        <div className="px-4 py-3 space-y-3 border-t border-[var(--border)]">
          {/* Files */}
          {uniqueFiles.length > 0 && (
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-1.5">Files changed on disk {isLive ? '(verification pending)' : ''}</div>
              <ul className="space-y-1" aria-label="Files touched">
                {uniqueFiles.slice(-8).map((file) => (
                  <li key={file} className="flex items-center gap-2 font-mono text-[11.5px] text-[var(--text)]">
                    <Circle size={11} style={{ color: progress.verifiedComplete ? 'var(--success)' : 'var(--text-muted)' }} aria-hidden="true" />
                    <span className="truncate">{file}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Phase list */}
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-1.5">Phases</div>
            <ol className="space-y-1" aria-label="Agent phases">
              {phases.map((phase, idx) => (
                <li
                  key={phase.id}
                  className="flex items-center gap-2.5 text-[12px]"
                  title={phase.detail || phase.title}
                >
                  <span className="shrink-0" style={{ color: PHASE_STATUS_COLOR[phase.status] }}>
                    {PHASE_STATUS_ICON[phase.status]}
                  </span>
                  <span
                    className={
                      phase.status === 'in_progress'
                        ? 'text-[var(--text)] font-medium'
                        : phase.status === 'completed'
                          ? 'text-[var(--text-muted)]'
                          : 'text-[var(--text-muted)] opacity-70'
                    }
                  >
                    {idx + 1}. {phase.title}
                    {phase.status === 'skipped' && <span className="ml-1 text-[10px]">(not required)</span>}
                    {phase.status === 'failed' && <span className="ml-1 text-[10px]" style={{ color: 'var(--danger)' }}>(failed)</span>}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Changed files (collapsible)                                         */
/* ------------------------------------------------------------------ */

export const ChangedFiles: React.FC<{ patches: FilePatch[]; onViewPatch: (patch: FilePatch) => void }> = ({
  patches,
  onViewPatch,
}) => {
  const [open, setOpen] = useState(true);
  if (patches.length === 0) return null;

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-[var(--hover)] q-transition"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 text-[13px] font-semibold text-[var(--text)]">
          <FileText size={14} style={{ color: 'var(--accent)' }} />
          Changed Files
          <span className="text-[var(--text-muted)] font-normal">
            {patches.length} {patches.length === 1 ? 'file' : 'files'}{' '}
            {patches.some((p) => p.applied === false) ? 'pending review' : 'modified'}
          </span>
        </span>
        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
      </button>
      {open && (
        <ul className="border-t border-[var(--border)] divide-y divide-[var(--border)]">
          {patches.map((patch, idx) => (
            <li
              key={`${patch.filePath}_${idx}`}
              className="flex items-center justify-between px-4 py-2 hover:bg-[var(--hover)] q-transition"
            >
              <span className="font-mono text-[12px] text-[var(--text)] truncate">{patch.filePath}</span>
              <span className="flex items-center gap-2 shrink-0 font-mono text-[11px]">
                <span style={{ color: 'var(--success)' }}>+{patch.linesAdded}</span>
                <span style={{ color: 'var(--danger)' }}>-{patch.linesRemoved}</span>
                <button
                  onClick={() => onViewPatch(patch)}
                  className="ml-1 px-2 py-0.5 rounded-lg border border-[var(--border)] text-[11px] text-[var(--text-muted)] hover:text-[var(--text)] q-transition"
                >
                  View
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Result card                                                         */
/* ------------------------------------------------------------------ */

const VERIFICATION_TOOLS = ['run_tests', 'run_build', 'run_linter'];

const VERIFICATION_LABELS: Record<string, string> = {
  run_tests: 'Tests',
  run_build: 'Build',
  run_linter: 'TypeScript',
};

export const ResultCard: React.FC<{
  message: ChatMessage;
  onViewPatch: (patch: FilePatch) => void;
  onContinue: () => void;
  onRunAgain: () => void;
  onFixWithAgent?: (errorLog: string) => void;
  onRollback?: (taskId: string) => void;
  onResumeTask?: (taskId: string) => void;
}> = ({ message, onViewPatch, onContinue, onRunAgain, onFixWithAgent, onRollback, onResumeTask }) => {
  const [summaryOpen, setSummaryOpen] = useState(true);

  const verifications = latestVerificationResults(message.toolResults);
  const failedVerifications = verifications.filter((result) => !result.success);
  const presentation = resultPresentation(message);
  const needsRepair = presentation.needsRepair;
  const resultColor = presentation.tone === 'muted' ? 'var(--text-muted)' : `var(--${presentation.tone})`;
  const repairContext = [
    message.content,
    ...failedVerifications.map((result) => `${VERIFICATION_LABELS[result.toolName] || result.toolName}: ${result.error || result.output || 'Verification failed without details.'}`),
  ].filter(Boolean).join('\n\n');

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setSummaryOpen(!summaryOpen)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-[var(--hover)] q-transition"
        aria-expanded={summaryOpen}
      >
        <span className="flex items-center gap-2 text-[13px] font-semibold" style={{ color: resultColor }}>
          {needsRepair ? <AlertCircle size={15} /> : presentation.tone === 'success' ? <CheckCircle2 size={15} /> : <Clock size={15} />}
          {presentation.label}
        </span>
        {summaryOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
      </button>

      {summaryOpen && (
        <div className="px-4 pb-4 space-y-3.5 border-t border-[var(--border)] pt-3">
          {/* Summary */}
          {message.content && message.content !== 'Task completed successfully.' && (
            <div className="text-[13px] leading-relaxed text-[var(--text)]">
              <MessageBody content={message.content} messageId={`${message.id}_result`} />
            </div>
          )}

          {/* Changed files */}
          {message.patches && message.patches.length > 0 && (
            <ChangedFiles patches={message.patches} onViewPatch={onViewPatch} />
          )}

          {/* Verification */}
          {verifications.length > 0 && (
            <div className="flex items-center flex-wrap gap-x-5 gap-y-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                Verification
              </span>
              {verifications.map((v, idx) => (
                <span
                  key={`${v.toolCallId}_${idx}`}
                  className="flex items-center gap-1.5 text-[12.5px]"
                  style={{ color: v.success ? 'var(--success)' : 'var(--danger)' }}
                  title={v.error || undefined}
                >
                  {v.success ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}
                  {VERIFICATION_LABELS[v.toolName] || v.toolName}
                </span>
              ))}
            </div>
          )}

          {message.observability && (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-secondary)] px-3 py-2.5 text-[11px] text-[var(--text-muted)]" aria-label="Agent run evidence">
              <div className="font-semibold uppercase tracking-wide text-[10px] mb-1.5">Run evidence</div>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                <span>Brain: <strong className="text-[var(--text)]">{message.observability.provider || 'unknown'}{message.observability.model ? ` · ${message.observability.model}` : ''}</strong></span>
                <span>Tools: <strong className="text-[var(--text)]">{message.observability.toolCalls}</strong>{message.observability.toolFailures ? <span className="text-[var(--danger)]"> ({message.observability.toolFailures} failed)</span> : null}</span>
                <span>Verification: <strong className="text-[var(--text)]">{message.observability.verificationRuns}</strong></span>
                {message.observability.retryCount !== undefined && <span>Retries: <strong className="text-[var(--text)]">{message.observability.retryCount}</strong></span>}
                {(message.observability.actualTotalTokens !== undefined || message.observability.estimatedTotalTokens !== undefined) && (
                  <span title={message.observability.tokenCountSource ? `Token count: ${message.observability.tokenCountSource}` : undefined}>
                    Tokens: <strong className="text-[var(--text)]">{message.observability.actualTotalTokens ?? message.observability.estimatedTotalTokens}</strong>
                    {message.observability.tokenCountSource === 'estimate' ? ' est.' : message.observability.tokenCountSource === 'mixed' ? ' mixed' : ''}
                  </span>
                )}
                {message.observability.modelCalls !== undefined && <span>Model calls: <strong className="text-[var(--text)]">{message.observability.modelCalls}</strong></span>}
                {message.observability.contextCharsPeak !== undefined && <span>Peak context: <strong className="text-[var(--text)]">{message.observability.contextCharsPeak.toLocaleString()} chars</strong></span>}
                {message.observability.durationMs !== undefined && <span>Duration: <strong className="text-[var(--text)]">{Math.round(message.observability.durationMs / 1000)}s</strong></span>}
              </div>
              {message.observability.capabilities && <div className="mt-1">Capabilities: tools={String(message.observability.capabilities.tools)}, streaming={String(message.observability.capabilities.streaming)}, reasoning={String(message.observability.capabilities.reasoning)}</div>}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 pt-1">
            {message.resumable && message.taskId && onResumeTask && (
              <button
                onClick={() => onResumeTask(message.taskId!)}
                aria-label="Resume this task from its saved checkpoint"
                title="Continue from the saved checkpoint; completed work will be preserved."
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-semibold text-white hover:opacity-90 q-transition"
                style={{ background: 'var(--accent)' }}
              >
                <RotateCcw size={13} />
                Resume from checkpoint
              </button>
            )}
            {needsRepair && onFixWithAgent && (
              <button
                onClick={() => onFixWithAgent(repairContext)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-semibold text-white hover:opacity-90 q-transition"
                style={{ background: 'var(--accent)' }}
              >
                <Wrench size={13} />
                Fix with Agent
              </button>
            )}
            {message.patches && message.patches.length > 0 && (
              <button
                onClick={() => onViewPatch(message.patches![0])}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[var(--border)] text-[12px] font-medium text-[var(--text)] hover:bg-[var(--hover)] q-transition"
              >
                <FileText size={13} />
                View Changes
              </button>
            )}
            {message.taskId && message.rollback?.available && onRollback && (
              <button
                onClick={() => onRollback(message.taskId!)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[var(--danger)] text-[12px] font-medium text-[var(--danger)] hover:bg-[var(--hover)] q-transition"
                title={`Restore ${message.rollback.files} file change(s) from this task`}
              >
                <RotateCcw size={13} />
                Roll back changes
              </button>
            )}
            <button
              onClick={onContinue}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[var(--border)] text-[12px] font-medium text-[var(--text)] hover:bg-[var(--hover)] q-transition"
            >
              <ArrowRight size={13} />
              Continue
            </button>
            <button
              onClick={onRunAgain}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[var(--border)] text-[12px] font-medium text-[var(--text)] hover:bg-[var(--hover)] q-transition"
            >
              <RotateCcw size={13} />
              Run Again
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Terminal command card (compact, expandable)                          */
/* ------------------------------------------------------------------ */

export const CommandCard: React.FC<{ result: ToolResult }> = ({ result }) => {
  const [open, setOpen] = useState(false);
  const command = (result.data as any)?.command || result.output?.split('\n')[0] || 'command';

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-[var(--hover)] q-transition"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2.5 text-[12.5px] font-mono text-[var(--text)] truncate">
          <Play size={12} style={{ color: 'var(--accent)' }} />
          {command}
        </span>
        <span className="flex items-center gap-2 shrink-0">
          <span
            className="text-[11px] font-medium"
            style={{ color: result.success ? 'var(--success)' : 'var(--danger)' }}
          >
            {result.success ? 'passed' : 'failed'}
          </span>
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
      </button>
      {open && (
        <pre className="max-h-64 overflow-auto border-t border-[var(--border)] bg-[var(--input)] p-3 text-[11.5px] font-mono text-[var(--text-muted)] whitespace-pre-wrap">
          {result.output}
        </pre>
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Approval card                                                       */
/* ------------------------------------------------------------------ */

export const ApprovalCard: React.FC<{
  request: { kind: 'terminal' | 'git' | 'file'; title: string; command?: string; reason?: string };
  onApprove: () => void;
  onDeny: () => void;
}> = ({ request, onApprove, onDeny }) => {
  // Approval is a safety-critical surface, not an ambient pulse: keep the glow
  // only when ambient loops are actually enabled (level + OS reduced-motion).
  const { ambientLoops } = useAmbientMotion();
  return (
  <motion.div
    className="rounded-2xl border p-4 flex flex-col gap-3"
    style={{ borderColor: 'var(--warning)', background: 'var(--surface)' }}
    role="alertdialog"
    aria-label={request.title}
    variants={springEntranceVariants}
    initial="hidden"
    animate="visible"
    exit="exit"
  >
    <div className="flex items-center gap-2 text-[13px] font-semibold" style={{ color: 'var(--warning)' }}>
      <motion.div variants={ambientLoops ? ambientGlowPulseVariants : undefined} initial={ambientLoops ? 'hidden' : undefined} animate={ambientLoops ? 'visible' : undefined} aria-hidden="true">
        <ShieldAlert size={15} />
      </motion.div>
      {request.title}
    </div>
    {request.command && (
      <pre className="rounded-xl bg-[var(--input)] border border-[var(--border)] p-2.5 font-mono text-[12px] text-[var(--text)] whitespace-pre-wrap">
        {request.command}
      </pre>
    )}
    {request.reason && <p className="text-[12px] text-[var(--text-muted)]">{request.reason}</p>}
    <div className="flex items-center gap-2">
      <motion.button
        onClick={onDeny}
        className="px-3.5 py-1.5 rounded-xl border border-[var(--border)] text-[12px] font-semibold text-[var(--text)]"
        whileHover={{ scale: 1.03, y: -1 }}
        whileTap={{ scale: 0.96 }}
      >
        Deny
      </motion.button>
      <motion.button
        onClick={onApprove}
        className="px-3.5 py-1.5 rounded-xl text-[12px] font-semibold text-white"
        style={{ background: 'var(--warning)' }}
        whileHover={{ scale: 1.03, y: -1, boxShadow: '0 8px 24px var(--warning)' }}
        whileTap={{ scale: 0.96 }}
      >
        Approve & Run
      </motion.button>
    </div>
  </motion.div>
  );
};

/* ------------------------------------------------------------------ */
/* Main chat view                                                       */
/* ------------------------------------------------------------------ */

interface ChatViewProps {
  emptyState?: React.ReactNode;
  messages: ChatMessage[];
  isWorking: boolean;
  activities: AgentActivity[];
  /** Live request-adaptive phase workflow state (agent runs). */
  phases?: AgentPhase[];
  /** Files written so far in the current live run. */
  liveFiles?: string[];
  streamingText: string;
  onStreamingTextChange?: (text: string) => void;
  onViewPatch: (patch: FilePatch) => void;
  onContinue: () => void;
  onRunAgain: () => void;
  onFixWithAgent?: (errorLog: string) => void;
  onRollback?: (taskId: string) => void;
  onResumeTask?: (taskId: string) => void;
}

export const ChatView: React.FC<ChatViewProps> = ({
  emptyState,
  messages,
  isWorking,
  activities,
  phases,
  liveFiles,
  streamingText,
  onViewPatch,
  onContinue,
  onRunAgain,
  onFixWithAgent,
  onRollback,
  onResumeTask,
}) => {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!messages.length && !activities.length && !streamingText) return;
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, activities, streamingText]);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto" role="log" aria-live="polite" aria-label="Conversation" tabIndex={0}>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-5">
        {emptyState}
        {messages.map((message) => {
          if (message.role === 'user') {
            return (
              <motion.div key={message.id} className="flex justify-end" variants={scaleSpringVariants} initial="hidden" animate="visible" layout>
                <motion.div
                  className="q-user-bubble max-w-[85%] rounded-2xl rounded-br-md px-4 py-3 text-[13.5px] leading-relaxed whitespace-pre-wrap"
                  style={{ background: 'var(--accent)' }}
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.99 }}
                >
                  {message.content}
                </motion.div>
              </motion.div>
            );
          }

          const isResultCard =
            (!!message.taskId && message.resumable === true) ||
            (message.patches && message.patches.length > 0) ||
            (message.toolResults || []).some((r) => VERIFICATION_TOOLS.includes(r.toolName));

          return (
            <motion.div key={message.id} className="space-y-3" variants={messageVariants} initial="hidden" animate="visible" layout>
              {/* Completed-run phase workflow (final, honest state) */}
              {message.phases && message.phases.length > 0 && (
                <AgentProgressPanel
                  phases={message.phases}
                  files={(message.patches || []).filter((p) => p.applied !== false).map((p) => p.filePath)}
                  isLive={false}
                />
              )}

              <AnimatePresence mode="wait">
                {isResultCard ? (
                  <motion.div variants={scaleSpringVariants} initial="hidden" animate="visible" exit="exit" layout>
                    <ResultCard
                      message={message}
                      onViewPatch={onViewPatch}
                      onContinue={onContinue}
                      onRunAgain={onRunAgain}
                      onFixWithAgent={onFixWithAgent}
                      onRollback={onRollback}
                      onResumeTask={onResumeTask}
                    />
                  </motion.div>
                ) : message.content.startsWith('❌') ? (
                  <motion.div
                    className="rounded-2xl border p-4 text-[13px] leading-relaxed"
                    style={{ borderColor: 'var(--danger)', background: 'var(--surface)', color: 'var(--text)' }}
                    role="alert"
                    variants={scaleSpringVariants}
                    initial="hidden"
                    animate="visible"
                  >
                    <div>{message.content.replace(/^❌\s*\*\*[^*]*\*\*\s*\n\n/, '')}</div>
                    {onFixWithAgent && (
                      <motion.button
                        onClick={() => onFixWithAgent(message.content)}
                        className="mt-3 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-semibold text-white"
                        style={{ background: 'var(--accent)' }}
                        whileHover={{ scale: 1.03 }}
                        whileTap={{ scale: 0.97 }}
                      >
                        <Wrench size={13} />
                        Fix with Agent
                      </motion.button>
                    )}
                  </motion.div>
                ) : (
                  <motion.div
                    className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3.5"
                    variants={messageVariants}
                    initial="hidden"
                    animate="visible"
                    whileHover={{ y: -1 }}
                  >
                    <MessageBody content={message.content} messageId={message.id} />
                  </motion.div>
                )}
              </AnimatePresence>

              {/* M-TAVILY-4: cited sources footer (Deep Research answers) */}
              {message.sources && message.sources.length > 0 && (
                <motion.div
                  className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3"
                  variants={messageVariants}
                  initial="hidden"
                  animate="visible"
                >
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2">Sources</p>
                  <div className="flex flex-col space-y-1">
                    {message.sources.slice(0, 8).map((source, index) => (
                      <a key={`${source.url}-${index}`} href={source.url} target="_blank" rel="noreferrer"
                        className="flex items-center gap-2 text-[12px] text-[var(--accent)] hover:underline"
                        title={source.url}
                      >
                        <span className="shrink-0 font-mono text-[10px] text-[var(--text-muted)]">[{index + 1}]</span>
                        {source.official && <span title="Official source" className="shrink-0">★</span>}
                        <span className="truncate">{source.title}</span>
                        {source.domain && <span className="shrink-0 text-[10px] text-[var(--text-muted)]">{source.domain}</span>}
                      </a>
                    ))}
                  </div>
                </motion.div>
              )}

              {/* Non-verification command outputs as compact cards */}
              <AnimatePresence>
                {(message.toolResults || [])
                  .filter((r) => !VERIFICATION_TOOLS.includes(r.toolName) && r.toolName === 'run_command')
                  .map((r, idx) => (
                    <motion.div key={`${message.id}_cmd_${idx}`} variants={tabSwitchVariants} initial="hidden" animate="visible" exit="exit" layout>
                      <CommandCard result={r} />
                    </motion.div>
                  ))}
              </AnimatePresence>

              {/* Staged patches pending user approval */}
              {message.patches && message.patches.some((p) => p.applied === false) && (
                <motion.div variants={slideAndFadeVariants} initial="hidden" animate="visible" custom="up" layout>
                  <ChangedFiles patches={message.patches.filter((p) => p.applied === false)} onViewPatch={onViewPatch} />
                </motion.div>
              )}
            </motion.div>
          );
        })}

        {/* Live progress panel + activity + streaming response */}
        <AnimatePresence>
          {isWorking && (
            <motion.div className="space-y-3" variants={staggerContainerVariants} initial="hidden" animate="visible" exit="exit">
              {phases && phases.length > 0 ? (
                <AgentProgressPanel phases={phases} files={liveFiles || []} isLive={true} />
              ) : (
                <ActivityFeed activities={activities} />
              )}
              {streamingText && (
                <motion.div
                  className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3.5"
                  variants={messageVariants}
                  initial="hidden"
                  animate="visible"
                >
                  <MessageBody content={streamingText} messageId="streaming" />
                </motion.div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        <div ref={endRef} />
      </div>
    </div>
  );
};
