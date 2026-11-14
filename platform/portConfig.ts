/**
 * NUVRO AI — desktop/server port configuration.
 *
 * The Electron shell and the bundled HTTP server must agree on the port.
 * The server refuses anything that is not an integer in 1..65535; the desktop
 * shell used to accept values such as `3000.5` or `70000`, which made the two
 * processes disagree and produced a confusing "the server never became ready"
 * failure with no actionable message.
 *
 * These helpers are pure so the contract can be unit-tested without booting
 * Electron and without starting a server.
 */

export const DEFAULT_PORT = 3000;
export const MIN_PORT = 1;
export const MAX_PORT = 65535;

export type PortSource = 'env' | 'file' | 'default';

export interface PortResolution {
  /** The port that should be used. Falls back to the default when the configured value is invalid. */
  port: number;
  /** Where the value came from. */
  source: PortSource;
  /** True when a configured value was present and valid. */
  ok: boolean;
  /** The raw invalid value, present only when `ok` is false. */
  invalidValue?: string;
  /** Human readable reason, present only when `ok` is false. */
  reason?: string;
}

/**
 * Parse a port value. Only plain decimal digits are accepted: `3000.5`,
 * `0x10`, `3e3`, `-1` and `3000abc` are rejected instead of being silently
 * coerced into a different port.
 */
export function parsePortValue(raw: string | undefined | null): number | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  if (!Number.isInteger(value) || value < MIN_PORT || value > MAX_PORT) return null;
  return value;
}

/**
 * Extract the PORT entry from a `.env` file body, mirroring dotenv's rules:
 * surrounding quotes are stripped and an unquoted `#` starts a comment.
 * Returns null when the file has no (usable) PORT entry.
 */
export function parseEnvFilePort(contents: string | undefined | null): string | null {
  if (typeof contents !== 'string' || !contents) return null;
  const match = contents.match(/^\s*(?:export\s+)?PORT\s*=\s*(.*)$/m);
  if (!match) return null;
  let value = match[1].trim();
  if (!value) return null;
  const quoted =
    (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
    (value.startsWith("'") && value.endsWith("'") && value.length >= 2);
  if (quoted) {
    value = value.slice(1, -1).trim();
  } else {
    const commentAt = value.indexOf('#');
    if (commentAt >= 0) value = value.slice(0, commentAt).trim();
  }
  return value || null;
}

export interface ResolvePortOptions {
  /** The raw `process.env.PORT` value, when present. */
  envPort?: string | null;
  /** The raw contents of the project `.env` file, when it exists. */
  envFileContents?: string | null;
  /** The port used when nothing valid is configured. */
  fallback?: number;
}

/**
 * Resolve the port the way the desktop shell should: the environment wins,
 * then the project `.env` file, then the default. An explicitly configured but
 * invalid value is reported (`ok: false`) instead of being silently replaced,
 * so the caller can fail fast with an actionable message.
 */
export function resolvePort(options: ResolvePortOptions = {}): PortResolution {
  const requestedFallback = Number(options.fallback);
  const fallback =
    Number.isInteger(requestedFallback) && requestedFallback >= MIN_PORT && requestedFallback <= MAX_PORT
      ? requestedFallback
      : DEFAULT_PORT;

  const envRaw = typeof options.envPort === 'string' ? options.envPort.trim() : '';
  if (envRaw) {
    const parsed = parsePortValue(envRaw);
    if (parsed !== null) return { port: parsed, source: 'env', ok: true };
    return {
      port: fallback,
      source: 'env',
      ok: false,
      invalidValue: envRaw,
      reason: `PORT must be an integer between ${MIN_PORT} and ${MAX_PORT} (got "${envRaw}").`,
    };
  }

  const fileRaw = parseEnvFilePort(options.envFileContents);
  if (fileRaw !== null) {
    const parsed = parsePortValue(fileRaw);
    if (parsed !== null) return { port: parsed, source: 'file', ok: true };
    return {
      port: fallback,
      source: 'file',
      ok: false,
      invalidValue: fileRaw,
      reason: `PORT must be an integer between ${MIN_PORT} and ${MAX_PORT} (got "${fileRaw}").`,
    };
  }

  return { port: fallback, source: 'default', ok: true };
}
