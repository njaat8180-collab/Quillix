/** Commands are user-provided checks, not permission bypasses or project instructions. */
export function normalizeVerificationCommands(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 3 || value.some(command => typeof command !== 'string' || !command.trim() || command.length > 2000 || /[\0\r\n]/.test(command))) {
    throw new Error('verificationCommands must contain at most 3 non-empty single-line commands, each at most 2000 characters.');
  }
  return [...new Set(value.map(command => command.trim()))];
}
