/** Sandbox policy also applies to externally opened previews, not just iframe previews. */
export const PREVIEW_CONTENT_SECURITY_POLICY =
  "sandbox allow-scripts allow-forms; object-src 'none'; base-uri 'none'";

/** Only public web assets may be served from a user-controlled workspace. */
export function isPreviewAssetAllowed(relativePath: string): boolean {
  if (!relativePath || relativePath.includes('\0')) return false;
  const segments = relativePath.replace(/\\/g, '/').split('/');
  if (segments.some((part) => !part || part === '..' || part.startsWith('.') ||
      ['node_modules', 'dist', 'build', 'coverage'].includes(part.toLowerCase()))) return false;
  const ext = segments[segments.length - 1].toLowerCase().match(/\.[^.]+$/)?.[0];
  // If a folder was requested, server will only serve index.html, never a directory listing.
  return !ext || new Set([
    '.html', '.htm', '.css', '.js', '.mjs', '.json', '.png', '.jpg',
    '.jpeg', '.gif', '.svg', '.webp', '.ico', '.mp3', '.wav', '.ogg',
    '.mp4', '.woff', '.woff2', '.ttf',
  ]).has(ext);
}
