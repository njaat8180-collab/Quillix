import { describe, it, expect, vi, afterEach } from 'vitest';
import { formatFault, installFaultReporter } from '../faultReporter.js';

describe('faultReporter', () => {
  it('formats an Error with its stack', () => {
    const error = new Error('boom');
    const message = formatFault('[test]', 'unhandled rejection', error);
    expect(message).toContain('[test]');
    expect(message).toContain('unhandled rejection');
    expect(message).toContain('boom');
  });

  it('formats a non-Error rejection reason', () => {
    const message = formatFault('[test]', 'unhandled rejection', 'plain string');
    expect(message).toContain('plain string');
    expect(message).not.toContain('undefined');
  });

  it('formats null and undefined reasons without throwing', () => {
    expect(() => formatFault('[test]', 'uncaught exception', null)).not.toThrow();
    expect(() => formatFault('[test]', 'uncaught exception', undefined)).not.toThrow();
    expect(formatFault('[test]', 'uncaught exception', undefined)).toContain('undefined');
  });

  it('falls back to the message when a stack is missing', () => {
    const error = new Error('no-stack');
    error.stack = undefined;
    const message = formatFault('[test]', 'uncaught exception', error);
    expect(message).toContain('no-stack');
  });
});

describe('installFaultReporter — policy', () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    while (cleanups.length) cleanups.pop()?.();
    vi.restoreAllMocks();
  });

  function install(options: Parameters<typeof installFaultReporter>[0]) {
    const dispose = installFaultReporter(options);
    cleanups.push(dispose);
    return dispose;
  }

  it('reports an unhandled rejection and keeps the process alive', () => {
    const log = vi.fn();
    const exit = vi.fn();
    install({ label: '[test]', log, exit });

    process.emit('unhandledRejection', new Error('stray rejection'), Promise.resolve());

    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toContain('unhandled rejection');
    // A rejection must NOT terminate the process.
    expect(exit).not.toHaveBeenCalled();
  });

  it('treats an uncaught exception as fatal and exits', () => {
    const log = vi.fn();
    const exit = vi.fn();
    install({ label: '[test]', log, exit });

    process.emit('uncaughtException', new Error('corrupt state'));

    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toContain('uncaught exception');
    // The process MUST terminate — continuing to serve from an undefined
    // state risks silent data corruption.
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('runs the fatal cleanup hook before exiting', () => {
    const log = vi.fn();
    const cleanup = vi.fn();
    const exit = vi.fn();
    install({ label: '[test]', log, exit, onFatalError: cleanup });

    process.emit('uncaughtException', new Error('boom'));

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledWith(expect.any(Error));
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('still exits when the fatal cleanup hook throws', () => {
    const log = vi.fn();
    const cleanup = vi.fn(() => { throw new Error('cleanup exploded'); });
    const exit = vi.fn();
    install({ label: '[test]', log, exit, onFatalError: cleanup });

    process.emit('uncaughtException', new Error('boom'));

    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls[1][0]).toContain('fatal cleanup failed');
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('still exits when the fatal cleanup hook rejects', async () => {
    const log = vi.fn();
    const cleanup = vi.fn(() => Promise.reject(new Error('cleanup rejected')));
    const exit = vi.fn();
    install({ label: '[test]', log, exit, onFatalError: cleanup });

    process.emit('uncaughtException', new Error('boom'));
    await Promise.resolve();
    await Promise.resolve();

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[1][0]).toContain('fatal cleanup failed');
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('honours a custom fatal exit code', () => {
    const log = vi.fn();
    const exit = vi.fn();
    install({ label: '[test]', log, exit, fatalExitCode: 7 });

    process.emit('uncaughtException', new Error('boom'));

    expect(exit).toHaveBeenCalledWith(7);
  });

  it('does not exit twice when the fatal path is triggered repeatedly', () => {
    const log = vi.fn();
    const exit = vi.fn();
    install({ label: '[test]', log, exit });

    process.emit('uncaughtException', new Error('first'));
    process.emit('uncaughtException', new Error('second'));

    // The first fault already decided the process is dying; a second fault
    // during the teardown window must not schedule a second exit.
    expect(exit).toHaveBeenCalledTimes(1);
  });
});
