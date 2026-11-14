/**
 * Contract test for the process-level fault policy.
 *
 * The policy is a safety property, so it is asserted at the source level in
 * addition to the unit tests:
 *
 *   - `unhandledRejection` → report and KEEP SERVING.
 *   - `uncaughtException`  → report, clean up, then EXIT (fatal by default).
 *
 * A regression that made uncaught exceptions non-fatal would let the server
 * keep serving requests, watchers and agent tasks from an undefined process
 * state, which risks silent data corruption.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const root = resolve(__dirname, '..', '..', '..');
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8');

describe('fault policy contract', () => {
  const faultReporter = read('src/server/faultReporter.ts');

  it('keeps unhandled rejections non-fatal', () => {
    expect(faultReporter).toMatch(/onUnhandledRejection/);
    // The rejection handler must not terminate the process.
    const rejectionHandler = faultReporter.slice(
      faultReporter.indexOf('const onUnhandledRejection'),
      faultReporter.indexOf('const onUncaughtException'),
    );
    expect(rejectionHandler).not.toMatch(/terminate\(/);
    expect(rejectionHandler).not.toMatch(/process\.exit\(/);
  });

  it('makes uncaught exceptions fatal by default', () => {
    expect(faultReporter).toMatch(/onUncaughtException/);
    const exceptionHandler = faultReporter.slice(
      faultReporter.indexOf('const onUncaughtException'),
    );
    // The fatal path MUST terminate the process.
    expect(exceptionHandler).toMatch(/terminate\(fatalExitCode\)/);
    // There must be no option that disables the exit for uncaught
    // exceptions (the previous `exitOnUncaughtException: false` escape
    // hatch is what made this unsafe).
    expect(faultReporter).not.toMatch(/exitOnUncaughtException/);
  });

  it('does not allow the server to opt out of the fatal exit', () => {
    const server = read('server.ts');
    expect(server).not.toMatch(/exitOnUncaughtException/);
    // The server must wire a cleanup hook so resources are released before
    // the process dies.
    expect(server).toMatch(/onFatalError:/);
    expect(server).toMatch(/fatalCleanup\s*=/);
  });

  it('does not allow the electron main process to opt out of the fatal exit', () => {
    const main = read('electron/main.ts');
    expect(main).not.toMatch(/exitOnUncaughtException/);
    expect(main).toMatch(/onFatalError:/);
  });
});
