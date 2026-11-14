import { describe, expect, it, vi } from 'vitest';
import { createApiErrorHandler, createLocalApiGuard, isLoopbackAddress } from '../platform/httpSecurity';

function makeReq(overrides: Record<string, unknown> = {}) {
  return {
    socket: { remoteAddress: '127.0.0.1' },
    headers: { host: '127.0.0.1:3000' as string | undefined, origin: undefined as string | undefined },
    ...overrides,
  } as any;
}

function makeRes() {
  const captured = { statusCode: 200, body: undefined as any, headers: {} as Record<string, any> };
  const res: any = {
    captured,
    status(code: number) {
      captured.statusCode = code;
      return res;
    },
    json(body: any) {
      captured.body = body;
      return res;
    },
    setHeader(key: string, value: any) {
      captured.headers[key] = value;
      return res;
    },
  };
  return res;
}

describe('local API guard', () => {
  it('detects the local machine only', () => {
    expect(isLoopbackAddress('127.0.0.1')).toBe(true);
    expect(isLoopbackAddress('::1')).toBe(true);
    expect(isLoopbackAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isLoopbackAddress('10.0.0.5')).toBe(false);
    expect(isLoopbackAddress('192.168.1.10')).toBe(false);
    expect(isLoopbackAddress(undefined)).toBe(false);
    expect(isLoopbackAddress('')).toBe(false);
  });

  it('lets a request from the local app origin through', () => {
    const next = vi.fn();
    createLocalApiGuard(3000)(makeReq(), makeRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('blocks a request from another machine', () => {
    const next = vi.fn();
    const res = makeRes();
    createLocalApiGuard(3000)(makeReq({ socket: { remoteAddress: '10.0.0.5' } }), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.captured.statusCode).toBe(403);
    expect(res.captured.body.success).toBe(false);
  });

  it('blocks a request with a foreign Host header (DNS rebinding)', () => {
    const next = vi.fn();
    const res = makeRes();
    createLocalApiGuard(3000)(makeReq({ headers: { host: 'attacker.example:3000' } }), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.captured.statusCode).toBe(403);
  });

  it('blocks a cross-origin request from a hostile page', () => {
    const next = vi.fn();
    const res = makeRes();
    createLocalApiGuard(3000)(
      makeReq({ headers: { host: '127.0.0.1:3000', origin: 'https://evil.example' } }),
      res,
      next,
    );
    expect(next).not.toHaveBeenCalled();
    expect(res.captured.statusCode).toBe(403);
  });
});

describe('terminal API error handler', () => {
  it('never leaks a stack trace to the client', () => {
    const err = Object.assign(new Error('boom at C:\\Users\\nakul\\secret\\file.ts'), { stack: 'Error: boom\n    at C:\\Users\\nakul' });
    const res = makeRes();
    const next = vi.fn();
    createApiErrorHandler()(err, makeReq(), res, next);
    expect(res.captured.statusCode).toBe(500);
    expect(res.captured.body).toEqual({ success: false, error: 'Internal server error.' });
    expect(JSON.stringify(res.captured.body)).not.toContain('nakul');
    expect(next).not.toHaveBeenCalled();
  });

  it('keeps a short client error message', () => {
    const err = Object.assign(new Error('id required'), { status: 400 });
    const res = makeRes();
    createApiErrorHandler()(err, makeReq(), res, vi.fn());
    expect(res.captured.statusCode).toBe(400);
    expect(res.captured.body).toEqual({ success: false, error: 'id required' });
  });

  it('reports an oversized body and a malformed body clearly', () => {
    const tooLarge = makeRes();
    createApiErrorHandler()({ type: 'entity.too.large' }, makeReq(), tooLarge, vi.fn());
    expect(tooLarge.captured.statusCode).toBe(500);
    expect(tooLarge.captured.body.error).toBe('Request body is too large.');

    const malformed = makeRes();
    createApiErrorHandler()({ type: 'entity.parse.failed' }, makeReq(), malformed, vi.fn());
    expect(malformed.captured.body.error).toBe('Malformed JSON request body.');
  });

  it('hands the error back when the response already started', () => {
    const res = makeRes();
    res.headersSent = true;
    const next = vi.fn();
    const err = new Error('late failure');
    createApiErrorHandler()(err, makeReq(), res, next);
    expect(next).toHaveBeenCalledWith(err);
  });
});
