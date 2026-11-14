/**
 * Environment-variable numeric parsing that never silently corrupts a limit.
 *
 * `Number('')` is 0 and `Number('abc')` is NaN, so a plain `Number(process.env.X)`
 * turns an empty variable into a zero limit (which can block every request) and
 * a malformed one into NaN (which can reach `AbortSignal.timeout(NaN)` and throw
 * an out-of-range error, or make a timer fire immediately). Every numeric
 * environment override in the app is parsed through this helper so a blank or
 * broken value falls back to the documented default instead of failing later.
 */

/** Parse a numeric environment variable, falling back when it is absent, blank or malformed. */
export function readEnvNumber(name: string, fallback: number, bounds?: { min?: number; max?: number }): number {
  const raw = process.env[name];
  if (typeof raw !== 'string' || raw.trim() === '') return fallback;
  const value = Number(raw.trim());
  if (!Number.isFinite(value)) return fallback;
  if (bounds?.min !== undefined && value < bounds.min) return fallback;
  if (bounds?.max !== undefined && value > bounds.max) return fallback;
  return value;
}

/**
 * Clamp a caller-supplied timeout to a finite number of seconds.
 *
 * A non-finite value (NaN from a malformed environment override, Infinity from
 * a division) must never reach `AbortSignal.timeout()` — it throws
 * `ERR_OUT_OF_RANGE` — or `setTimeout()`, where it fires immediately and
 * aborts every request.
 */
export function finiteTimeoutSeconds(value: unknown, fallback: number, bounds: { min: number; max: number }): number {
  if (typeof value !== 'number' && typeof value !== 'string') return fallback;
  if (typeof value === 'string' && value.trim() === '') return fallback;
  const numeric = typeof value === 'number' ? value : Number(value.trim());
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(bounds.max, Math.max(bounds.min, numeric));
}
