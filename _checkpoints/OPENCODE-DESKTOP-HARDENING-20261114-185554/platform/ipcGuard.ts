/**
 * NUVRO AI — Electron IPC sender validation.
 *
 * The preload bridge exposes a handful of privileged operations (native
 * folder picker, window controls). Without a sender check, any renderer that
 * somehow ended up in the Electron window could invoke them. The main process
 * therefore verifies that an IPC message really came from the local NUVRO AI
 * page before it is handled.
 *
 * The helpers are pure so the contract can be unit-tested without Electron.
 */

export interface IpcSenderInfo {
  /** URL of the web contents that sent the message. */
  senderUrl?: string | null;
  /** URL of the frame that sent the message. `null` when Electron does not expose it. */
  frameUrl?: string | null;
}

/** True when the URL is an http(s)-free, credential-free local app URL of a trusted origin. */
export function isTrustedOrigin(url: string | undefined | null, trustedOrigins: readonly string[]): boolean {
  if (typeof url !== 'string' || !url) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:') return false;
  if (parsed.username || parsed.password) return false;
  return trustedOrigins.some((origin) => {
    try {
      return new URL(origin).origin === parsed.origin;
    } catch {
      return false;
    }
  });
}

/**
 * True when an IPC message may be handled: the sending document must live on
 * one of the trusted local origins, and a sub-frame (when known) must do so as
 * well. `about:blank`, `file://` and remote origins are rejected.
 */
export function isTrustedIpcSender(info: IpcSenderInfo | null | undefined, trustedOrigins: readonly string[]): boolean {
  if (!info) return false;
  if (!isTrustedOrigin(info.senderUrl, trustedOrigins)) return false;
  if (info.frameUrl === null || info.frameUrl === undefined) return true;
  return isTrustedOrigin(info.frameUrl, trustedOrigins);
}
