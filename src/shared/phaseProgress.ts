import type { AgentPhase } from './types.js';

export interface PhaseProgressSummary {
  completed: number;
  applicable: number;
  skipped: number;
  failed: boolean;
  percent: number;
  verifiedComplete: boolean;
}

/** Calculates progress from required phases only; skipped means not applicable. */
export function summarizePhaseProgress(phases: AgentPhase[], isLive: boolean): PhaseProgressSummary {
  const applicablePhases = phases.filter(phase => phase.status !== 'skipped');
  const completed = applicablePhases.filter(phase => phase.status === 'completed').length;
  const skipped = phases.length - applicablePhases.length;
  const failed = applicablePhases.some(phase => phase.status === 'failed');
  const verifiedComplete = !isLive && !failed && applicablePhases.length > 0 &&
    applicablePhases.every(phase => phase.status === 'completed');
  const percent = verifiedComplete
    ? 100
    : applicablePhases.length
      ? Math.min(99, Math.round((completed / applicablePhases.length) * 100))
      : 0;
  return { completed, applicable: applicablePhases.length, skipped, failed, percent, verifiedComplete };
}
