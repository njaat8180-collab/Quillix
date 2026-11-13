import { describe, expect, it } from 'vitest';
import { repairSharedMoneyContract } from '../sharedMoneyContract.js';

describe('shared money verifier contract', () => {
  it('repairs rounding and routes checkout through the shared helper', () => {
    const result = repairSharedMoneyContract(
      'exports.toCents = amount => Math.floor(Number(amount) * 100);\n',
      'const { toCents } = require("./money.cjs");\nexports.totalCents = amounts => amounts.reduce((sum, amount) => sum + Math.floor(Number(amount) * 100), 0);\n',
    );
    expect(result.changed).toBe(true);
    expect(result.money).toContain('Math.round(Number(amount) * 100)');
    expect(result.checkout).toContain('sum + toCents(amount)');
    expect(repairSharedMoneyContract(result.money, result.checkout).changed).toBe(false);
  });

  it('does not rewrite unrelated source shapes', () => {
    expect(repairSharedMoneyContract('exports.toCents = x => x;', 'exports.totalCents = x => x;').changed).toBe(false);
  });

  it('repairs the remaining file when the helper file was already fixed', () => {
    const result = repairSharedMoneyContract(
      'exports.toCents = amount => Math.round(Number(amount) * 100);\n',
      'const { toCents } = require("./money.cjs");\nexports.totalCents = amounts => amounts.reduce((sum, amount) => sum + Math.floor(Number(amount) * 100), 0);\n',
    );
    expect(result.changed).toBe(true);
    expect(result.money).toContain('Math.round');
    expect(result.checkout).toContain('toCents(amount)');
  });
});
