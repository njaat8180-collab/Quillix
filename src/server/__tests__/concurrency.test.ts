import { describe, expect, it } from 'vitest';
import { independentTargets, mapWithConcurrency } from '../../shared/concurrency.js';

describe('mapWithConcurrency', () => {
  it('preserves input order regardless of completion order', async () => {
    const delays = [30, 5, 20, 1];
    const results = await mapWithConcurrency(delays, async (ms, index) => {
      await new Promise((resolve) => setTimeout(resolve, ms));
      return index;
    });
    expect(results.map((r) => (r.ok ? r.value : null))).toEqual([0, 1, 2, 3]);
  });

  it('never runs more than the limit at once', async () => {
    let active = 0;
    let peak = 0;
    const items = Array.from({ length: 12 }, (_, i) => i);
    await mapWithConcurrency(items, async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
    }, { limit: 3 });
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1); // really did run in parallel
  });

  it('captures per-item errors without rejecting the batch', async () => {
    const results = await mapWithConcurrency([1, 2, 3], async (n) => {
      if (n === 2) throw new Error('boom');
      return n * 10;
    });
    expect(results[0]).toEqual({ ok: true, value: 10 });
    expect(results[1].ok).toBe(false);
    expect(results[2]).toEqual({ ok: true, value: 30 });
  });

  it('stops starting new work once shouldContinue() is false', async () => {
    let started = 0;
    const results = await mapWithConcurrency(Array.from({ length: 10 }, (_, i) => i), async () => {
      started++;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return started;
    }, { limit: 1, shouldContinue: () => started < 3 });
    expect(results.filter((r) => r.ok).length).toBeLessThanOrEqual(3);
  });
});

describe('independentTargets', () => {
  it('returns distinct targets for independent calls', () => {
    const targets = independentTargets([
      { args: { filePath: 'a.ts' } },
      { args: { filePath: 'b\\c.ts' } },
      { args: { filePath: 'd.ts' } },
    ]);
    expect(targets).toEqual(['a.ts', 'b/c.ts', 'd.ts']);
  });

  it('rejects duplicate targets', () => {
    expect(independentTargets([{ args: { filePath: 'a.ts' } }, { args: { filePath: 'a.ts' } }])).toBeNull();
  });

  it('rejects pathless calls (conservative: keep them sequential)', () => {
    expect(independentTargets([{ args: { filePath: 'a.ts' } }, { args: {} }])).toBeNull();
    expect(independentTargets([{ args: { filePath: 'a.ts' } }, { args: { dirPath: 'src' } }])).toEqual(['a.ts', 'src']);
  });
});
