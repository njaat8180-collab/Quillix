/**
 * NUVRO AI — renderer Content Security Policy.
 *
 * The renderer is a local single-page app that only ever talks to its own
 * origin (the loopback API server). A restrictive CSP therefore costs nothing
 * and removes a whole class of injection impact.
 *
 * Two modes exist:
 *  - production: the shipped bundle has no inline scripts at all.
 *  - development: Vite injects the React Fast Refresh preamble as an inline
 *    module script and the HMR client opens a websocket back to the dev
 *    server, so those two sources are allowed in development only.
 *
 * `frame-src` allows the isolated loopback preview origin: the built-in web
 * preview renders the user's project inside an iframe on a second ephemeral
 * local port.
 */

export type CspMode = 'production' | 'development';

export function buildContentSecurityPolicy(mode: CspMode): string {
  const directives: string[] = [
    "default-src 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-src 'self' http://127.0.0.1:* http://localhost:*",
    "form-action 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "worker-src 'self' blob: data:",
    "child-src 'self' blob: data:",
    "media-src 'self' data: blob:",
    "manifest-src 'self'",
  ];
  if (mode === 'development') {
    directives[directives.indexOf("script-src 'self'")] = "script-src 'self' 'unsafe-inline'";
    directives[directives.indexOf("connect-src 'self'")] =
      "connect-src 'self' ws://127.0.0.1:* ws://localhost:*";
  }
  return directives.join('; ');
}

/** The CSP meta tag for the given policy. */
export function contentSecurityPolicyMetaTag(policy: string): string {
  return `<meta http-equiv="Content-Security-Policy" content="${policy}" />`;
}

const META_TAG_PATTERN = /<meta\s+http-equiv=["']Content-Security-Policy["'][^>]*\/?>/i;

/**
 * Put the CSP meta tag into an HTML document. An existing meta tag is
 * replaced (so the development variant never inherits the production one),
 * otherwise the tag is inserted right after `<head>`.
 */
export function injectContentSecurityPolicy(html: string, policy: string): string {
  const tag = contentSecurityPolicyMetaTag(policy);
  if (typeof html !== 'string' || !html) return html;
  if (META_TAG_PATTERN.test(html)) return html.replace(META_TAG_PATTERN, tag);
  const headOpen = html.match(/<head\b[^>]*>/i);
  if (!headOpen || headOpen.index === undefined) return html;
  const insertAt = headOpen.index + headOpen[0].length;
  return `${html.slice(0, insertAt)}\n    ${tag}${html.slice(insertAt)}`;
}
