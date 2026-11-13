/**
 * Bounded-concurrency helpers (M5.7: parallel independent work).
 *
 * Independent sub-tasks (e.g. several read-only tool calls in one agent turn)
 * run concurrently, but never more than `limit` at a time, so provider pacing,
 * memory and file descriptors stay predictable. Results always come back in
 * input order and a failing item never rejects the whole batch.
 */

export type ConcurrencyResult<R> = { ok: true; value: R } | { ok: false; error: unknown };

export interface MapWithConcurrencyOptions {
  /** Maximum in-flight workers. Always >= 1. */
  limit?: number;
  /** Called before each worker starts; when it returns false the item runs
   *  after the current in-flight workers settle (cooperative cancellation). */
  shouldContinue?: () => boolean;
}

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  worker: (item: T, index: number) => Promise<R> | R,
  options: MapWithConcurrencyOptions = {},
): Promise<Array<ConcurrencyResult<R>>> {
  const limit = Math.max(1, Math.min(Math.floor(options.limit ?? 4), items.length || 1));
  const results: Array<ConcurrencyResult<R>> = new Array(items.length);
  let next = 0;
  const runWorker = async (): Promise<void> => {
    while (true) {
      if (options.shouldContinue && !options.shouldContinue()) return;
      const index = next++;
      if (index >= items.length) return;
      try {
        results[index] = { ok: true, value: await worker(items[index], index) };
      } catch (error) {
        results[index] = { ok: false, error };
      }
    }
  };
  const runners: Array<Promise<void>> = [];
  for (let i = 0; i < Math.min(limit, items.length); i++) runners.push(runWorker());
  await Promise.all(runners);
  return results;
}

/** Distinct, non-empty targets of independent calls (used to gate batching). */
export function independentTargets(calls: ReadonlyArray<{ args?: Record<string, unknown> }>, pathKeys = ['filePath', 'dirPath', 'path']): string[] | null {
  const targets: string[] = [];
  for (const call of calls) {
    let target = '';
    for (const key of pathKeys) {
      const value = call.args?.[key];
      if (typeof value === 'string' && value.trim()) { target = value.replace(/\\/g, '/'); break; }
    }
    if (!target) return null; // pathless calls stay sequential (conservative)
    targets.push(target);
  }
  return new Set(targets).size === targets.length ? targets : null;
}
