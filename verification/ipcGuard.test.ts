import { describe, expect, it } from 'vitest';
import { isTrustedIpcSender, isTrustedOrigin } from '../platform/ipcGuard';

const TRUSTED_ORIGINS = ['http://127.0.0.1:3000', 'http://localhost:3000'];

/**
 * The preload bridge exposes privileged operations (native folder picker,
 * window controls). The main process must only answer the local app page.
 */
describe('electron IPC sender validation', () => {
  it('accepts the local application origin', () => {
    expect(isTrustedIpcSender({ senderUrl: 'http://127.0.0.1:3000/' }, TRUSTED_ORIGINS)).toBe(true);
    expect(isTrustedIpcSender({ senderUrl: 'http://localhost:3000/index.html' }, TRUSTED_ORIGINS)).toBe(true);
  });

  it('rejects a remote, foreign-port or non-http sender', () => {
    expect(isTrustedIpcSender({ senderUrl: 'https://evil.example/' }, TRUSTED_ORIGINS)).toBe(false);
    expect(isTrustedIpcSender({ senderUrl: 'http://127.0.0.1:4000/' }, TRUSTED_ORIGINS)).toBe(false);
    expect(isTrustedIpcSender({ senderUrl: 'file:///C:/index.html' }, TRUSTED_ORIGINS)).toBe(false);
    expect(isTrustedIpcSender({ senderUrl: 'about:blank' }, TRUSTED_ORIGINS)).toBe(false);
    expect(isTrustedIpcSender({ senderUrl: 'javascript:alert(1)' }, TRUSTED_ORIGINS)).toBe(false);
  });

  it('rejects a hostile sub frame even when the top level page is trusted', () => {
    expect(
      isTrustedIpcSender({ senderUrl: 'http://127.0.0.1:3000/', frameUrl: 'https://evil.example/' }, TRUSTED_ORIGINS),
    ).toBe(false);
    expect(
      isTrustedIpcSender({ senderUrl: 'http://127.0.0.1:3000/', frameUrl: 'http://127.0.0.1:3000/preview' }, TRUSTED_ORIGINS),
    ).toBe(true);
  });

  it('rejects a missing sender', () => {
    expect(isTrustedIpcSender(null, TRUSTED_ORIGINS)).toBe(false);
    expect(isTrustedIpcSender({ senderUrl: undefined }, TRUSTED_ORIGINS)).toBe(false);
    expect(isTrustedIpcSender({ senderUrl: null }, TRUSTED_ORIGINS)).toBe(false);
  });

  it('rejects credentials embedded in the sender URL', () => {
    expect(isTrustedOrigin('http://user:pass@127.0.0.1:3000/', TRUSTED_ORIGINS)).toBe(false);
  });
});
