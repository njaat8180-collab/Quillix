import type { ChatMessage, ToolResult } from './types.js';

export function latestVerificationResults(results: ToolResult[] = []) {
  const checks = new Set(['run_tests', 'run_build', 'run_linter', 'verify_file', 'project_health_check']);
  const last = new Map<string, ToolResult>();
  for (const result of results) if (checks.has(result.toolName)) last.set(`${result.toolName}:${result.data?.filePath || result.data?.cwd || ''}`, result);
  return [...last.values()];
}

/** Model prose is not proof. The phase/result evidence owns the visual status. */
export function resultPresentation(message: Pick<ChatMessage, 'content' | 'phases' | 'error' | 'patches' | 'toolResults' | 'verified'>) {
  if (/^Task cancelled/i.test(message.content)) return { label: 'Task cancelled', tone: 'muted', needsRepair: false };
  if (/^BLOCKED:/i.test(message.content)) return { label: 'Approval required', tone: 'warning', needsRepair: false };
  if (/^PENDING REVIEW:/i.test(message.content) || message.patches?.some(p => !p.applied && !p.rejected)) return { label: 'Changes await review', tone: 'warning', needsRepair: false };
  // Backend acceptance is authoritative. Intermediate failed phases may be
  // retained in activity history after a later verified repair.
  if (message.verified === true) return { label: 'Task completed', tone: 'success', needsRepair: false };
  const failed = !!message.error || message.phases?.some(p => p.status === 'failed') || latestVerificationResults(message.toolResults).some(r => !r.success) || /\bTask (?:FAILED|INCOMPLETE)\b/i.test(message.content);
  if (failed) return { label: 'Task incomplete — needs repair', tone: 'danger', needsRepair: true };
  if (message.phases?.at(-1)?.status === 'completed') return { label: 'Task completed', tone: 'success', needsRepair: false };
  return { label: 'Task finished — check the results', tone: 'muted', needsRepair: false };
}
