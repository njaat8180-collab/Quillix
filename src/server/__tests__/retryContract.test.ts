import { describe, expect, it } from 'vitest';
import { repairAsyncRetryContract } from '../retryContract.js';

describe('explicit async retry contract repair', () => {
  it('repairs missing await while preserving the CommonJS export', () => {
    const source = `exports.retry = async (operation, attempts = 3) => {
  for (let i = 0; i < attempts; i++) {
    try { return operation(); } catch (error) { if (i === attempts - 1) throw error; }
  }
};`;
    const repaired = repairAsyncRetryContract(source);
    expect(repaired.changed).toBe(true);
    expect(repaired.content).toContain('return await operation()');
    expect(repaired.content).toContain('exports.retry = retry');
    expect(repairAsyncRetryContract(repaired.content).changed).toBe(false);
  });

  it('does not rewrite unrelated source', () => {
    const source = 'exports.add = (a, b) => a + b;';
    expect(repairAsyncRetryContract(source)).toEqual({ content: source, changed: false });
  });
});
