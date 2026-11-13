/**
 * Browser-safe provider profile IDs. Some Electron/file contexts do not
 * expose crypto.randomUUID even though the rest of the Web Crypto API exists.
 * IDs are labels only; credentials are never derived from or placed in them.
 */
export function createProviderProfileId(randomUUID?: () => string): string {
  try {
    const id = randomUUID?.() || globalThis.crypto?.randomUUID?.();
    if (id && /^[-\w]{1,64}$/.test(id)) return id;
  } catch {
    // Fall through to a non-secret local identifier.
  }
  return `provider-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
