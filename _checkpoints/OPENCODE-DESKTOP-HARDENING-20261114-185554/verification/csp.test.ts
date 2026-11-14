import { describe, expect, it } from 'vitest';
import {
  buildContentSecurityPolicy,
  contentSecurityPolicyMetaTag,
  injectContentSecurityPolicy,
} from '../platform/csp';

describe('renderer content security policy', () => {
  it('locks the production bundle to its own origin', () => {
    const policy = buildContentSecurityPolicy('production');
    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("script-src 'self'");
    expect(policy).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(policy).not.toContain('unsafe-eval');
    expect(policy).toContain("base-uri 'none'");
    expect(policy).toContain("object-src 'none'");
  });

  it('allows the isolated loopback preview origin to be framed', () => {
    const policy = buildContentSecurityPolicy('production');
    expect(policy).toContain("frame-src 'self' http://127.0.0.1:* http://localhost:*");
  });

  it('allows the Monaco worker and the inline styles the editor needs', () => {
    const policy = buildContentSecurityPolicy('production');
    expect(policy).toContain("worker-src 'self' blob: data:");
    expect(policy).toContain("style-src 'self' 'unsafe-inline'");
  });

  it('only relaxes the policy for the Vite development server', () => {
    const development = buildContentSecurityPolicy('development');
    expect(development).toContain("script-src 'self' 'unsafe-inline'");
    expect(development).toContain('ws://127.0.0.1:*');
    // The production policy keeps the script directive strict; only the style
    // directive allows inline styles (React inline styles and Monaco).
    expect(buildContentSecurityPolicy('production')).toContain("script-src 'self';");
    expect(buildContentSecurityPolicy('production')).not.toContain("script-src 'self' 'unsafe-inline'");
  });

  it('replaces an existing policy meta tag instead of stacking two', () => {
    const html = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'" /><title>x</title></head><body></body></html>`;
    const result = injectContentSecurityPolicy(html, buildContentSecurityPolicy('production'));
    expect(result.match(/http-equiv="Content-Security-Policy"/g) || []).toHaveLength(1);
    expect(result).toContain(`content="${buildContentSecurityPolicy('production')}"`);
    expect(result).not.toContain("default-src 'none'");
  });

  it('inserts the policy when the document has none', () => {
    const html = '<!doctype html><html><head><title>x</title></head><body></body></html>';
    const result = injectContentSecurityPolicy(html, buildContentSecurityPolicy('production'));
    expect(result).toContain(contentSecurityPolicyMetaTag(buildContentSecurityPolicy('production')));
  });
});
