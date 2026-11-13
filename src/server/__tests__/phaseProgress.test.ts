import { describe, expect, it } from 'vitest';
import { summarizePhaseProgress } from '../../shared/phaseProgress.js';

const phase = (status: 'completed' | 'pending' | 'failed' | 'skipped') => ({ id: status, title: status, status });

describe('real phase progress', () => {
  it('does not count skipped optional work in the denominator', () => {
    expect(summarizePhaseProgress([
      phase('completed'), phase('completed'), phase('skipped'), phase('pending'),
    ], true)).toMatchObject({ completed: 2, applicable: 3, skipped: 1, percent: 67, verifiedComplete: false });
  });

  it('reaches 100 only when every applicable phase is verified', () => {
    expect(summarizePhaseProgress([phase('completed'), phase('skipped')], false)).toMatchObject({
      completed: 1, applicable: 1, skipped: 1, percent: 100, verifiedComplete: true,
    });
    expect(summarizePhaseProgress([phase('completed'), phase('failed')], false).verifiedComplete).toBe(false);
  });
});
