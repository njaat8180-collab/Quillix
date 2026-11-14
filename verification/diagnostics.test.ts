import { describe, expect, it } from 'vitest';
import {
  formatServerDiagnostics,
  redactAbsolutePaths,
  redactSecrets,
  sanitizeServerDiagnostic,
} from '../platform/diagnostics';

/**
 * The native error dialog of the desktop shell shows the tail of the server's
 * stderr. That text can contain absolute user paths and credentials, so it is
 * redacted before it ever reaches the screen.
 */
describe('server diagnostics redaction', () => {
  it('never shows an absolute Windows path', () => {
    const safe = sanitizeServerDiagnostic('Error: cannot read C:\\Users\\nakul\\AppData\\Local\\Temp\\quillix\\file.ts');
    expect(safe).not.toContain('C:\\Users\\nakul');
    expect(safe).not.toContain('AppData');
    expect(safe).toContain('<path>');
  });

  it('never shows an absolute POSIX path', () => {
    const safe = sanitizeServerDiagnostic('failed to open /home/alice/projects/app/index.ts');
    expect(safe).not.toContain('/home/alice');
    expect(safe).toContain('<path>');
  });

  it('never shows a UNC path', () => {
    const safe = sanitizeServerDiagnostic('cannot read \\\\build-server\\share\\secret.txt');
    expect(safe).not.toContain('build-server');
    expect(safe).toContain('<path>');
  });

  it('redacts credentials', () => {
    expect(redactSecrets('Authorization: Bearer abcdef1234567890')).not.toContain('abcdef1234567890');
    expect(redactSecrets('api_key=sk-abcdefghijklmnopqrstuvwxyz')).not.toContain('sk-abcdefghijklmnopqrstuvwxyz');
    expect(redactSecrets('password: hunter2secret')).not.toContain('hunter2secret');
    expect(redactSecrets('"client_secret": "s3cr3t-value-here"')).not.toContain('s3cr3t-value-here');
    expect(
      redactSecrets('-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----'),
    ).not.toContain('MIIEowIBAAKCAQEA');
  });

  it('keeps URLs readable so diagnostics stay useful', () => {
    const message = 'see https://example.com/docs/page for details';
    expect(redactAbsolutePaths(message)).toBe(message);
  });

  it('strips control characters and truncates long lines', () => {
    const safe = sanitizeServerDiagnostic('boom\u001b[31m\u0007');
    expect(safe).not.toContain('\u001b');
    expect(safe).not.toContain('\u0007');

    const long = sanitizeServerDiagnostic('repeated failure detail '.repeat(20), 80);
    expect(long.length).toBeLessThanOrEqual(80);
    expect(long.endsWith('...')).toBe(true);
  });

  it('treats a long opaque token as a credential rather than printing it', () => {
    const opaque = 'A'.repeat(80);
    const safe = sanitizeServerDiagnostic(`token ${opaque}`);
    expect(safe).not.toContain(opaque);
  });

  it('shows only the tail of the error buffer', () => {
    const lines = Array.from({ length: 20 }, (_, index) => `line ${index}`);
    const formatted = formatServerDiagnostics(lines, 3);
    expect(formatted.split('\n')).toHaveLength(3);
    expect(formatted).toContain('line 19');
    expect(formatted).not.toContain('line 0');
    expect(formatServerDiagnostics([])).toBe('');
  });

  it('never returns an empty diagnostic line', () => {
    expect(sanitizeServerDiagnostic('')).toBe('(no details available)');
  });
});
