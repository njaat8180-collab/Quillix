import { afterEach, describe, expect, it } from 'vitest';
import { finiteTimeoutSeconds, readEnvNumber } from '../../shared/envNumbers.js';
import { ResourceGuard } from '../resourceGuard.js';
import { tavilyCostPerCreditUsd } from '../tavilyVerification.js';

const touched: string[] = [];

function setEnv(name: string, value: string | undefined): void {
  touched.push(name);
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterEach(() => {
  while (touched.length) {
    const name = touched.pop()!;
    delete process.env[name];
  }
});

describe('readEnvNumber', () => {
  it('returns the fallback for an unset variable', () => {
    setEnv('QUILLIX_TEST_NUMBER', undefined);
    expect(readEnvNumber('QUILLIX_TEST_NUMBER', 42)).toBe(42);
  });

  it('treats a blank variable as unset instead of zero', () => {
    setEnv('QUILLIX_TEST_NUMBER', '');
    expect(readEnvNumber('QUILLIX_TEST_NUMBER', 42)).toBe(42);
  });

  it('treats a whitespace-only variable as unset', () => {
    setEnv('QUILLIX_TEST_NUMBER', '   ');
    expect(readEnvNumber('QUILLIX_TEST_NUMBER', 42)).toBe(42);
  });

  it('falls back for a malformed value instead of returning NaN', () => {
    setEnv('QUILLIX_TEST_NUMBER', 'abc');
    expect(readEnvNumber('QUILLIX_TEST_NUMBER', 42)).toBe(42);
  });

  it('falls back for Infinity and NaN spellings', () => {
    setEnv('QUILLIX_TEST_NUMBER', 'Infinity');
    expect(readEnvNumber('QUILLIX_TEST_NUMBER', 42)).toBe(42);
    setEnv('QUILLIX_TEST_NUMBER', 'NaN');
    expect(readEnvNumber('QUILLIX_TEST_NUMBER', 42)).toBe(42);
  });

  it('parses valid numbers, including zero and negatives', () => {
    setEnv('QUILLIX_TEST_NUMBER', '0');
    expect(readEnvNumber('QUILLIX_TEST_NUMBER', 42)).toBe(0);
    setEnv('QUILLIX_TEST_NUMBER', '-1');
    expect(readEnvNumber('QUILLIX_TEST_NUMBER', 42)).toBe(-1);
    setEnv('QUILLIX_TEST_NUMBER', '12.5');
    expect(readEnvNumber('QUILLIX_TEST_NUMBER', 42)).toBe(12.5);
  });

  it('trims surrounding whitespace before parsing', () => {
    setEnv('QUILLIX_TEST_NUMBER', ' 7 ');
    expect(readEnvNumber('QUILLIX_TEST_NUMBER', 42)).toBe(7);
  });

  it('rejects values outside the requested bounds', () => {
    setEnv('QUILLIX_TEST_NUMBER', '5');
    expect(readEnvNumber('QUILLIX_TEST_NUMBER', 42, { min: 30, max: 90 })).toBe(42);
    setEnv('QUILLIX_TEST_NUMBER', '95');
    expect(readEnvNumber('QUILLIX_TEST_NUMBER', 42, { min: 30, max: 90 })).toBe(42);
    setEnv('QUILLIX_TEST_NUMBER', '45');
    expect(readEnvNumber('QUILLIX_TEST_NUMBER', 42, { min: 30, max: 90 })).toBe(45);
  });
});

describe('finiteTimeoutSeconds', () => {
  it('keeps a finite value inside the bounds', () => {
    expect(finiteTimeoutSeconds(45, 90, { min: 5, max: 300 })).toBe(45);
  });

  it('clamps values outside the bounds', () => {
    expect(finiteTimeoutSeconds(1, 90, { min: 5, max: 300 })).toBe(5);
    expect(finiteTimeoutSeconds(9999, 90, { min: 5, max: 300 })).toBe(300);
  });

  it('falls back for NaN and Infinity', () => {
    expect(finiteTimeoutSeconds(Number.NaN, 90, { min: 5, max: 300 })).toBe(90);
    expect(finiteTimeoutSeconds(Number.POSITIVE_INFINITY, 90, { min: 5, max: 300 })).toBe(90);
    expect(finiteTimeoutSeconds(Number.NEGATIVE_INFINITY, 90, { min: 5, max: 300 })).toBe(90);
  });

  it('falls back for undefined and non-numeric input', () => {
    expect(finiteTimeoutSeconds(undefined, 90, { min: 5, max: 300 })).toBe(90);
    expect(finiteTimeoutSeconds('abc', 90, { min: 5, max: 300 })).toBe(90);
    expect(finiteTimeoutSeconds(null, 90, { min: 5, max: 300 })).toBe(90);
  });

  it('accepts a numeric string', () => {
    expect(finiteTimeoutSeconds('60', 90, { min: 5, max: 300 })).toBe(60);
  });
});

describe('environment overrides no longer corrupt runtime limits', () => {
  it('uses the default CPU limit when the override is blank', () => {
    setEnv('QUILLIX_MAX_CPU_PERCENT', '');
    const guard = new ResourceGuard();
    expect(guard.getLimits().maxCpuPercent).toBeGreaterThan(0);
  });

  it('uses the default CPU limit when the override is malformed', () => {
    setEnv('QUILLIX_MAX_CPU_PERCENT', 'abc');
    const guard = new ResourceGuard();
    expect(guard.getLimits().maxCpuPercent).toBeGreaterThan(0);
  });

  it('still honours an explicit negative CPU limit used to force a pause', () => {
    setEnv('QUILLIX_MAX_CPU_PERCENT', '-1');
    const guard = new ResourceGuard();
    expect(guard.getLimits().maxCpuPercent).toBe(-1);
  });

  it('keeps the Tavily cost estimate active when the override is blank', () => {
    setEnv('QUILLIX_TAVILY_COST_PER_CREDIT_USD', '');
    expect(tavilyCostPerCreditUsd()).toBeCloseTo(0.008, 6);
  });

  it('keeps the Tavily cost estimate active when the override is malformed', () => {
    setEnv('QUILLIX_TAVILY_COST_PER_CREDIT_USD', 'abc');
    expect(tavilyCostPerCreditUsd()).toBeCloseTo(0.008, 6);
  });

  it('honours a valid Tavily cost override', () => {
    setEnv('QUILLIX_TAVILY_COST_PER_CREDIT_USD', '0.02');
    expect(tavilyCostPerCreditUsd()).toBeCloseTo(0.02, 6);
  });
});
