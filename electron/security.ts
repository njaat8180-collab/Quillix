/**
 * Quillix Electron security policy.
 *
 * SINGLE SOURCE OF TRUTH for the desktop security rules.
 *
 * `electron/main.ts` imports this module and applies the rules to the real
 * runtime. The security contract test imports the SAME module and asserts
 * the same behaviour, so the test can never drift away from what the app
 * actually enforces.
 *
 * This module deliberately contains no Electron imports so it can be loaded
 * from a plain Node test as well as from the Electron main process.
 */

/* ------------------------------------------------------------------ */
/* Content Security Policy                                              */
/* ------------------------------------------------------------------ */

/**
 * The renderer is a fully local application: it loads its own bundle, its
 * own CSS and the Monaco editor runtime from the local server. It makes no
 * requests to third-party origins — no CDN fonts, no remote scripts, no
 * analytics beacons.
 *
 * - 'unsafe-eval' is required because the Monaco editor evaluates lazily
 *   constructed language-service code.
 * - 'wasm-unsafe-eval' is required by the tree-sitter WASM parsers.
 * - 'unsafe-inline' is required for the style attributes the React UI sets.
 *
 * Neither eval allowance permits loading remote script, which `script-src`
 * still blocks.
 */
export const RENDERER_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "child-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

/** Hardening headers applied to every response the renderer receives. */
export const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

/* ------------------------------------------------------------------ */
/* Permissions                                                          */
/* ------------------------------------------------------------------ */

/**
 * The ONLY permission the renderer is allowed to request.
 *
 * The UI calls `navigator.clipboard.writeText()` in ChatView, CodebaseQA,
 * CrashBoundary and TerminalPanel. Nothing in the app touches the camera,
 * microphone, geolocation, notifications or media devices, so every other
 * permission is denied outright.
 */
export const ALLOWED_PERMISSIONS = new Set(['clipboard-sanitized-write']);

/** Decide a permission request. Deny by default. */
export function isPermissionAllowed(permission: string): boolean {
  return ALLOWED_PERMISSIONS.has(permission);
}

/* ------------------------------------------------------------------ */
/* IPC sender validation                                                */
/* ------------------------------------------------------------------ */

/**
 * True when a URL belongs to this app's local server.
 *
 * @param url       the URL to test
 * @param host      the loopback host the app is served from
 * @param port      the port the app is served from
 */
export function isLocalAppUrl(url: string, host = '127.0.0.1', port = 3000): boolean {
  if (typeof url !== 'string' || !url) return false;
  return (
    url.startsWith(`http://${host}:${port}/`) ||
    url === `http://${host}:${port}` ||
    url.startsWith(`http://localhost:${port}/`) ||
    url === `http://localhost:${port}`
  );
}

/**
 * True when an IPC event may drive the native bridge.
 *
 * Every `ipcMain.handle()` is reachable from any frame loaded inside the
 * BrowserWindow. These checks ensure only the app's own top-level local
 * page can drive the native bridge, so a frame that somehow ends up on a
 * foreign origin cannot invoke the folder picker or the window controls.
 *
 * @param event        the Electron IPC event
 * @param host         the loopback host the app is served from
 * @param port         the port the app is served from
 */
export function isTrustedIpcSender(
  event: { senderFrame?: { parent?: unknown; url?: string } | null },
  host = '127.0.0.1',
  port = 3000,
): boolean {
  const frame = event?.senderFrame;
  if (!frame) return false;

  // Only a top-level frame may drive the bridge; subframes are rejected.
  if (frame.parent !== null && frame.parent !== undefined) return false;

  let senderUrl = '';
  try {
    senderUrl = frame.url || '';
  } catch {
    return false;
  }
  if (!senderUrl) return false;

  return isLocalAppUrl(senderUrl, host, port);
}
