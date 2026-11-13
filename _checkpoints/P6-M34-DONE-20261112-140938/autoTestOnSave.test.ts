import { describe, expect, it } from 'vitest';
import {
  AUTO_TEST_DEBOUNCE_MS,
  AUTO_TEST_MIN_GAP_MS,
  AUTO_TEST_SAME_FILE_WINDOW_MS,
  autoTestShouldRun,
  formatAutoTestLabel,
  pickAutoTestCommand,
  resolveAutoTestPlan,
  summarizeAutoTestRun,
} from '../../shared/autoTestOnSave.js';

describe('auto-run on save planning', () => {
  it('resolves only the workspace package.json own scripts, preferring lint', () => {
    expect(pickAutoTestCommand({ scripts: { test: 'vitest run', lint: 'tsc --noEmit' } }, 'node', 'npm-cli')).toEqual({ script: 'lint', label: 'npm run lint', argv: ['node', 'npm-cli', 'run', 'lint'] });
    expect(pickAutoTestCommand({ scripts: { test: 'vitest run' } })).toEqual({ script: 'test', label: 'npm test', argv: [process.execPath, 'npm-cli.js', 'run', 'test'] });
    // Never invents commands for projects without runnable scripts.
    expect(pickAutoTestCommand({ scripts: { build: 'vite build' } })).toBeNull();
    expect(pickAutoTestCommand({})).toBeNull();
    expect(pickAutoTestCommand(null)).toBeNull();
    expect(pickAutoTestCommand('not-an-object')).toBeNull();
  });

  it('is opt-in and pauses honestly under Offline Mode', () => {
    const packageJson = { scripts: { lint: 'tsc --noEmit' } };
    expect(resolveAutoTestPlan({ enabled: false, offlineMode: false, packageJson })).toEqual({ enabled: false, command: null, reason: expect.stringContaining('off') });
    const paused = resolveAutoTestPlan({ enabled: true, offlineMode: true, packageJson });
    expect(paused.command).not.toBeNull();
    expect(paused.reason).toMatch(/Offline Mode/);
    expect(resolveAutoTestPlan({ enabled: true, offlineMode: false, packageJson }).reason).toBeUndefined();
    expect(resolveAutoTestPlan({ enabled: true, offlineMode: false, packageJson: {} }).reason).toMatch(/no package\.json/);
  });

  it('paces runs with a debounce, a minimum gap and a same-file window', () => {
    expect(autoTestShouldRun(null, 1000, 'a.ts')).toBe(true);
    // Immediately after a run: suppressed.
    expect(autoTestShouldRun({ at: 1000, filePath: 'a.ts' }, 1200, 'b.ts')).toBe(false);
    // Same file after the minimum gap but inside the same-file window: suppressed.
    expect(autoTestShouldRun({ at: 1000, filePath: 'a.ts' }, 1000 + AUTO_TEST_MIN_GAP_MS + 10, 'a.ts')).toBe(false);
    // Different file after the gap: runs.
    expect(autoTestShouldRun({ at: 1000, filePath: 'a.ts' }, 1000 + AUTO_TEST_MIN_GAP_MS + 10, 'b.ts')).toBe(true);
    // The minimum gap applies even to the debounce boundary.
    expect(autoTestShouldRun({ at: 0, filePath: '' }, AUTO_TEST_DEBOUNCE_MS - 1, 'a.ts')).toBe(false);
    expect(autoTestShouldRun({ at: 0, filePath: 'other.ts' }, AUTO_TEST_MIN_GAP_MS + 1, 'a.ts')).toBe(true);
    // The same-file window only expires after its own, longer horizon.
    expect(autoTestShouldRun({ at: 0, filePath: 'a.ts' }, AUTO_TEST_SAME_FILE_WINDOW_MS + 1, 'a.ts')).toBe(true);
  });

  it('summarizes runs with bounded, display-safe tails', () => {
    const summary = summarizeAutoTestRun({ exitCode: 0, durationMs: 12.7, triggeredBy: 'save', filePath: 'app.ts', stdout: 'x'.repeat(50), stderr: '', maxChars: 10 });
    expect(summary.ok).toBe(true);
    expect(summary.exitCode).toBe(0);
    expect(summary.durationMs).toBe(12);
    expect(summary.triggeredBy).toBe('save');
    expect(summary.filePath).toBe('app.ts');
    // Requested sizes below the floor are clamped, so short output is kept whole.
    expect(summary.stdoutTail).toBe('x'.repeat(50));
    const clipped = summarizeAutoTestRun({ exitCode: 1, durationMs: 1, triggeredBy: 'save', stdout: 'y'.repeat(10_000) });
    expect(clipped.stdoutTail.length).toBe(4000);
    expect(clipped.stdoutTail.startsWith('\u2026')).toBe(true);
    // A timeout is a failure even when the exit code is 0.
    expect(summarizeAutoTestRun({ exitCode: 0, durationMs: 1, triggeredBy: 'manual', timedOut: true }).ok).toBe(false);
    expect(summarizeAutoTestRun({ exitCode: null, durationMs: 1, triggeredBy: 'manual' }).ok).toBe(false);
  });

  it('formats an honest one-line label', () => {
    const command = pickAutoTestCommand({ scripts: { lint: 'tsc --noEmit' } })!;
    expect(formatAutoTestLabel(command, null)).toBe('npm run lint');
    const failed = summarizeAutoTestRun({ exitCode: 1, durationMs: 5, triggeredBy: 'save' });
    expect(formatAutoTestLabel(command, failed)).toBe('npm run lint · last run failed');
    const passed = summarizeAutoTestRun({ exitCode: 0, durationMs: 5, triggeredBy: 'save' });
    expect(formatAutoTestLabel(command, passed)).toBe('npm run lint · last run passed');
  });
});
