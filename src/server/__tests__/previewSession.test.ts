import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PreviewSessionService, validatePreviewEntry } from '../previewSession.js';

describe('local preview lifecycle', () => {
  it('launches idempotently, reports status and stops cleanly', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-preview-'));
    fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><title>Preview</title>');
    const service = new PreviewSessionService(() => true);
    const validation = validatePreviewEntry(root, 'index.html');
    expect(validation.ok).toBe(true);
    const started = service.start(root, 'index.html');
    expect('error' in started).toBe(false);
    const same = service.start(root, 'index.html');
    expect(same).toMatchObject({ id: (started as any).id, status: 'ready' });
    expect(service.status((started as any).id)).toMatchObject({ status: 'ready', entry: 'index.html' });
    expect(service.stop((started as any).id)).toBe(true);
    expect(service.status((started as any).id)).toMatchObject({ status: 'stopped' });
    expect(service.stop((started as any).id)).toBe(false);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('reports missing/unsafe entries instead of launching a broken preview', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-preview-'));
    expect(validatePreviewEntry(root, 'index.html')).toMatchObject({ ok: false, error: expect.stringMatching(/not found/i) });
    expect(validatePreviewEntry(root, '../index.html')).toMatchObject({ ok: false, error: expect.stringMatching(/project-local|escapes/i) });
    fs.writeFileSync(path.join(root, 'app.js'), 'console.log(1);');
    expect(validatePreviewEntry(root, 'app.js')).toMatchObject({ ok: false, error: expect.stringMatching(/HTML/i) });
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('reports a local port/startup conflict and allows a later retry', () => {
    let ready = false;
    const service = new PreviewSessionService(() => ready);
    expect(service.start('C:/workspace', 'index.html')).toMatchObject({ error: expect.stringMatching(/port conflict/i) });
    ready = true;
    expect(service.start('C:/workspace', 'index.html')).toMatchObject({ status: 'ready' });
  });
});
