/**
 * NUVRO AI — HTTP surface hardening for the local API server.
 *
 * The NUVRO AI API can read/write files, run terminal commands and execute
 * tools, so it must only answer requests that come from the local app origin.
 * Two things are enforced here:
 *
 *  1. The loopback + Host/Origin check runs BEFORE any request body is
 *     parsed, so a hostile page in the user's browser cannot make the server
 *     allocate a 50 MB JSON body just to be rejected afterwards.
 *  2. Every unhandled error ends in a JSON response with a safe message.
 *     Express' default handler leaks stack traces and absolute paths to the
 *     client outside production mode.
 */
import type { NextFunction, Request, Response } from 'express';
import { validateLocalApiRequest } from '../src/server/localRequestSecurity.js';

/** True when the socket peer is the local machine. */
export function isLoopbackAddress(remoteAddress: string | undefined | null): boolean {
  if (!remoteAddress) return false;
  const normalized = remoteAddress.replace(/^::ffff:/, '').toLowerCase();
  return normalized === '127.0.0.1' || normalized === '::1' || normalized === 'localhost';
}

/**
 * The middleware that protects `/api`. It deliberately does not read the
 * request body: it must be able to reject a request before the body parser
 * runs.
 */
export function createLocalApiGuard(port: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (
      !isLoopbackAddress(req.socket.remoteAddress) ||
      !validateLocalApiRequest(req.headers.host, req.headers.origin, port)
    ) {
      res.status(403).json({
        success: false,
        error: 'Forbidden: NUVRO AI only accepts requests from its local application origin.',
      });
      return;
    }
    next();
  };
}

/** The JSON body of an Express error, without the stack trace. */
export interface ApiErrorShape {
  success: false;
  error: string;
}

/**
 * Terminal error handler. Client errors keep their (short) message, server
 * errors are reported generically; the full error is only written to the
 * server log.
 */
export function createApiErrorHandler() {
  return (err: any, _req: Request, res: Response, next: NextFunction): void => {
    if (res.headersSent) {
      next(err);
      return;
    }
    const rawStatus = Number(err?.status ?? err?.statusCode);
    const status = Number.isInteger(rawStatus) && rawStatus >= 400 && rawStatus <= 599 ? rawStatus : 500;
    const type = typeof err?.type === 'string' ? err.type : '';
    let message = 'Internal server error.';
    if (type === 'entity.too.large') message = 'Request body is too large.';
    else if (type === 'entity.parse.failed') message = 'Malformed JSON request body.';
    else if (status < 500) message = String(err?.message || 'Request failed.').slice(0, 300);
    try {
      console.error('NUVRO AI request error:', err?.stack || err);
    } catch {
      // Logging must never turn a handled error into a crash.
    }
    const body: ApiErrorShape = { success: false, error: message };
    res.status(status).json(body);
  };
}
