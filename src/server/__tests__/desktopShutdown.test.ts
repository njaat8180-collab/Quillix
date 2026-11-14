import { describe, it, expect } from 'vitest';
import { shutdownChildBounded, type ShutdownChild } from '../../electron/desktopShutdown.js';

/** A child that exits only after a given signal, or never. */
function fakeChild(options: { exitsOn?: string; neverExits?: boolean } = {}) {
  const signals: string[] = [];
  let exited = false;
  const child: ShutdownChild = {
    get exitCode() { return exited ? 0 : null; },
    kill(signal?: NodeJS.Signals | number) {
      const name = String(signal ?? 'SIGTERM');
      signals.push(name);
      if (!options.neverExits && options.exitsOn === name) exited = true;
      return true;
    },
  };
  return { child, signals, hasExited: () => exited };
}

/** An injected wait that never spends real time. */
const instantWait = async (_ms: number) => {};

/** An injected wait that advances a virtual clock. */
function virtualWait(state: { now: number }) {
  return async (ms: number) => { state.now += ms; };
}

describe('bounded desktop shutdown (hardening)', () => {
  it('does not signal a child that has already exited', async () => {
    const { child, signals } = fakeChild();
    const result = await shutdownChildBounded(
      { ...child, exitCode: 0 },
      { wait: instantWait },
    );
    expect(result.exited).toBe(true);
    expect(result.escalated).toBe(false);
    expect(result.timedOut).toBe(false);
    expect(signals).toEqual([]);
  });

  it('stops a cooperative child with the graceful signal only', async () => {
    const { child, signals } = fakeChild({ exitsOn: 'SIGTERM' });
    const result = await shutdownChildBounded(child, { wait: instantWait });
    expect(result.exited).toBe(true);
    expect(result.escalated).toBe(false);
    expect(result.timedOut).toBe(false);
    expect(signals).toEqual(['SIGTERM']);
  });

  it('escalates to a forced kill when the child ignores the graceful request', async () => {
    const { child, signals } = fakeChild({ exitsOn: 'SIGKILL' });
    const result = await shutdownChildBounded(child, {
      wait: instantWait,
      graceMs: 100,
      forceMs: 100,
      pollMs: 10,
    });
    expect(result.exited).toBe(true);
    expect(result.escalated).toBe(true);
    expect(result.timedOut).toBe(false);
    expect(signals).toEqual(['SIGTERM', 'SIGKILL']);
  });

  it('reports a timeout instead of hanging when the child refuses to die', async () => {
    const { child, signals } = fakeChild({ neverExits: true });
    const result = await shutdownChildBounded(child, {
      wait: instantWait,
      graceMs: 100,
      forceMs: 100,
      pollMs: 10,
    });
    expect(result.exited).toBe(false);
    expect(result.escalated).toBe(true);
    expect(result.timedOut).toBe(true);
    expect(signals).toEqual(['SIGTERM', 'SIGKILL']);
  });

  it('never waits longer than the grace plus force window', async () => {
    const { child } = fakeChild({ neverExits: true });
    const state = { now: 0 };
    const result = await shutdownChildBounded(child, {
      wait: virtualWait(state),
      graceMs: 300,
      forceMs: 150,
      pollMs: 50,
    });
    expect(result.timedOut).toBe(true);
    expect(state.now).toBeLessThanOrEqual(450);
    expect(state.now).toBeGreaterThan(0);
  });

  it('survives a kill that throws', async () => {
    const child: ShutdownChild = {
      exitCode: null,
      kill() { throw new Error('EPERM'); },
    };
    const result = await shutdownChildBounded(child, {
      wait: instantWait,
      graceMs: 10,
      forceMs: 10,
      pollMs: 5,
    });
    // A failed kill must not crash the shutdown, and must not claim success.
    expect(result.exited).toBe(false);
    expect(result.timedOut).toBe(true);
    expect(result.signals).toEqual(['SIGTERM', 'SIGKILL']);
  });

  it('notices a child that exits promptly instead of burning the whole window', async () => {
    const { child, signals } = fakeChild({ exitsOn: 'SIGTERM' });
    const state = { now: 0 };
    const result = await shutdownChildBounded(child, {
      wait: virtualWait(state),
      graceMs: 5_000,
      forceMs: 1_000,
      pollMs: 50,
    });
    expect(result.exited).toBe(true);
    expect(state.now).toBeLessThanOrEqual(50);
    expect(signals).toEqual(['SIGTERM']);
  });

  it('reports every signal it sent through the log sink', async () => {
    const { child } = fakeChild({ neverExits: true });
    const messages: string[] = [];
    await shutdownChildBounded(child, {
      wait: instantWait,
      graceMs: 10,
      forceMs: 10,
      pollMs: 5,
      onLog: (message) => messages.push(message),
    });
    expect(messages.join('\n')).toMatch(/graceful/i);
    expect(messages.join('\n')).toMatch(/SIGKILL/);
    expect(messages.join('\n')).toMatch(/force-exit/i);
  });
});
