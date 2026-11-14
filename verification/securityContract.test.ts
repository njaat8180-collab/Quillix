import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildContentSecurityPolicy } from '../platform/csp';

/**
 * Structural contracts for the files that carry the security boundaries.
 * They lock the ordering and the wiring that unit tests cannot observe:
 * a hostile page must be rejected before a 50 MB body is parsed, every IPC
 * handler must verify its sender, and the checked-in CSP must not drift away
 * from the policy the application actually ships.
 */
const root = process.cwd();
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

const serverSource = read('server.ts');
const mainSource = read('electron/main.ts');
const indexHtml = read('index.html');

describe('local API server contracts', () => {
  it('rejects a foreign origin BEFORE the request body is parsed', () => {
    const guardIndex = serverSource.indexOf("app.use('/api', createLocalApiGuard(PORT));");
    const parserIndex = serverSource.indexOf('express.json(');
    expect(guardIndex).toBeGreaterThan(-1);
    expect(parserIndex).toBeGreaterThan(-1);
    expect(guardIndex).toBeLessThan(parserIndex);
  });

  it('answers an unknown API path with a JSON 404 instead of the app shell', () => {
    expect(serverSource).toContain("res.status(404).json({ success: false, error: 'Unknown API endpoint.' });");
    const notFoundIndex = serverSource.indexOf("'Unknown API endpoint.'");
    const spaIndex = serverSource.indexOf("app.get('*'");
    expect(notFoundIndex).toBeGreaterThan(-1);
    expect(spaIndex).toBeGreaterThan(-1);
    expect(notFoundIndex).toBeLessThan(spaIndex);
  });

  it('installs a terminal error handler on the API and on the preview server', () => {
    const handlers = serverSource.match(/app\.use\(createApiErrorHandler\(\)\);/g) || [];
    const previewHandlers = serverSource.match(/previewApp\.use\(createApiErrorHandler\(\)\);/g) || [];
    expect(handlers.length).toBeGreaterThanOrEqual(1);
    expect(previewHandlers.length).toBe(1);
  });

  it('sends the security headers of the app shell', () => {
    expect(serverSource).toContain("res.setHeader('Content-Security-Policy', appContentSecurityPolicy);");
    expect(serverSource).toContain("res.setHeader('X-Content-Type-Options', 'nosniff');");
    expect(serverSource).toContain("res.setHeader('X-Frame-Options', 'DENY');");
    expect(serverSource).toContain("frame-ancestors 'none'");
  });

  it('resolves the port through the shared desktop/server contract', () => {
    expect(serverSource).toContain('resolvePort({ envPort: process.env.PORT })');
  });
});

describe('electron main process contracts', () => {
  it('denies device permissions by default', () => {
    expect(mainSource).toContain('setPermissionRequestHandler');
    expect(mainSource).toContain('setPermissionCheckHandler');
    expect(mainSource).toContain('installPermissionGuards();');
  });

  it('validates the sender of every IPC handler', () => {
    const handlers = mainSource.match(/ipcMain\.handle\(/g) || [];
    const guards = mainSource.match(/assertTrustedIpcSender\(event\);/g) || [];
    expect(handlers.length).toBeGreaterThan(0);
    expect(guards.length).toBe(handlers.length);
  });

  it('never shows raw server stderr in the native dialog', () => {
    expect(mainSource).toContain('formatServerDiagnostics(lastServerErrors)');
    expect(mainSource).not.toContain('lastServerErrors.join(');
  });

  it('fails fast when the configured port is invalid', () => {
    expect(mainSource).toContain('resolvePort({ envPort: process.env.PORT, envFileContents: readEnvFile() })');
    expect(mainSource).toContain('PORT_CONFIG_ERROR');
    expect(mainSource).toContain('NUVRO AI cannot start: invalid PORT.');
  });

  it('refuses to attach a webview to the renderer', () => {
    expect(mainSource).toContain("on('will-attach-webview'");
  });
});

describe('renderer document contracts', () => {
  it('ships a content security policy meta tag', () => {
    expect(indexHtml).toMatch(/<meta http-equiv="Content-Security-Policy" content="[^"]+"/);
  });

  it('keeps the checked-in policy identical to the shipped production policy', () => {
    const production = buildContentSecurityPolicy('production');
    expect(indexHtml).toContain(`content="${production}"`);
  });
});
