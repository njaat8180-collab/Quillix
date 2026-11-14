/**
 * NUVRO AI — safe rendering of server diagnostics.
 *
 * When the bundled server dies, the Electron shell shows the tail of the
 * server's stderr in a native dialog. Raw stderr can contain absolute user
 * paths, API keys or bearer tokens, and a native dialog is not a safe place
 * for that. Everything shown to the user is redacted first; the untouched
 * text stays in the console log only.
 *
 * The helpers are pure so the redaction contract can be unit-tested.
 */

export const MAX_DIAGNOSTIC_LENGTH = 240;
export const MAX_DIAGNOSTIC_LINES = 12;

/** Replace credential-looking values with a placeholder. */
export function redactSecrets(text: string): string {
  if (typeof text !== 'string' || !text) return '';
  let out = text;
  out = out.replace(
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    '[redacted-private-key]',
  );
  out = out.replace(/\b(Bearer|Basic|Token)\s+[A-Za-z0-9._\-+/=]{8,}/gi, '$1 [redacted]');
  out = out.replace(
    /\b(api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|auth[_-]?token|client[_-]?secret|secret|password|passwd|pwd|authorization)\b["']?(\s*[:=]\s*)("|')?[^\s"',;)]+/gi,
    '$1$2[redacted]',
  );
  out = out.replace(/\bsk-[A-Za-z0-9_-]{12,}/g, '[redacted-key]');
  out = out.replace(/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g, '[redacted-token]');
  out = out.replace(/\bxox[baprs]-[A-Za-z0-9-]{10,}/g, '[redacted-token]');
  out = out.replace(/\b[A-Fa-f0-9]{40,}\b/g, '[redacted-hex]');
  out = out.replace(/\b[A-Za-z0-9_-]{56,}\b/g, '[redacted-token]');
  return out;
}

/** Replace absolute filesystem paths with a placeholder. */
export function redactAbsolutePaths(text: string): string {
  if (typeof text !== 'string' || !text) return '';
  // Protect URLs first: their path component must not be mistaken for a
  // filesystem path, and the URL itself is preserved for diagnostics.
  const urls: string[] = [];
  let out = text.replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi, (match) => {
    urls.push(match);
    return `\u0000url${urls.length - 1}\u0000`;
  });
  out = out.replace(/[A-Za-z]:\\(?:[^\\\s"'<>|:*?]+\\)*[^\\\s"'<>|:*?]*/g, '<path>');
  out = out.replace(/\\\\[^\\\s"'<>|]+\\[^\s"'<>|]*/g, '<path>');
  out = out.replace(
    /(^|[\s("'=:])\/(?:[A-Za-z0-9._@~+-]+\/)+[A-Za-z0-9._@~+-]*/g,
    (_match, prefix: string) => `${prefix}<path>`,
  );
  out = out.replace(/\u0000url(\d+)\u0000/g, (_match, index: string) => urls[Number(index)] ?? '');
  return out;
}

/** Turn one raw server stderr line into a short, safe, human readable line. */
export function sanitizeServerDiagnostic(line: string, maxLength = MAX_DIAGNOSTIC_LENGTH): string {
  const raw = typeof line === 'string' ? line : String(line ?? '');
  let safe = redactSecrets(redactAbsolutePaths(raw));
  // Drop control characters: a native dialog must never render escape codes.
  safe = safe.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ').trim();
  if (!safe) return '(no details available)';
  if (safe.length > maxLength) safe = `${safe.slice(0, Math.max(0, maxLength - 3))}...`;
  return safe;
}

/**
 * Format the tail of the server error buffer for a native dialog. Returns an
 * empty string when there is nothing to show.
 */
export function formatServerDiagnostics(
  lines: readonly string[],
  maxLines = MAX_DIAGNOSTIC_LINES,
  maxLength = MAX_DIAGNOSTIC_LENGTH,
): string {
  if (!Array.isArray(lines) || lines.length === 0) return '';
  const limit = Math.max(1, maxLines);
  return lines.slice(-limit).map((line) => sanitizeServerDiagnostic(line, maxLength)).join('\n');
}
