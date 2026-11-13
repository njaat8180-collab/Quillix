import { describe, expect, it } from 'vitest';
import { DEFAULT_ONLINE_PROVIDER_MIN_INTERVAL_MS, OVERDRIVE_PROVIDER_CONCURRENCY, getEffectiveProviderConcurrency, getEffectiveProviderIntervalMs } from '../../shared/providerPacing.js';

describe('provider request pacing', () => {
  it('keeps normal requests single-flight and caps Turbo overlap at two', () => {
    expect(getEffectiveProviderConcurrency()).toBe(1);
    expect(getEffectiveProviderConcurrency({ turboSpeedMode: false })).toBe(1);
    expect(getEffectiveProviderConcurrency({ turboSpeedMode: true })).toBe(2);
    expect(getEffectiveProviderConcurrency({ performanceMode: 'turbo' })).toBe(2);
  });
  it('keeps normal pacing at the default floor and Turbo at the faster safe floor', () => {
    expect(getEffectiveProviderIntervalMs()).toBe(DEFAULT_ONLINE_PROVIDER_MIN_INTERVAL_MS);
    expect(getEffectiveProviderIntervalMs({ turboSpeedMode: false, performanceMode: 'balanced' })).toBe(4_000);
    expect(getEffectiveProviderIntervalMs({ turboSpeedMode: true, performanceMode: 'balanced' })).toBe(1_000);
    expect(DEFAULT_ONLINE_PROVIDER_MIN_INTERVAL_MS / getEffectiveProviderIntervalMs({ turboSpeedMode: true })).toBe(4);
  });

  it('uses the selected performance profile when Turbo is disabled', () => {
    expect(getEffectiveProviderIntervalMs({ performanceMode: 'eco' })).toBe(6_000);
    expect(getEffectiveProviderIntervalMs({ performanceMode: 'turbo' })).toBe(1_000);
  });

  it('removes every app-side delay in Overdrive Mode', () => {
    expect(getEffectiveProviderIntervalMs({ overdriveMode: true })).toBe(0);
    expect(getEffectiveProviderIntervalMs({ overdriveMode: true, turboSpeedMode: true, performanceMode: 'eco' })).toBe(0);
    expect(getEffectiveProviderConcurrency({ overdriveMode: true })).toBe(OVERDRIVE_PROVIDER_CONCURRENCY);
    expect(getEffectiveProviderConcurrency({ overdriveMode: true, performanceMode: 'eco' })).toBe(OVERDRIVE_PROVIDER_CONCURRENCY);
    // Every other profile keeps its pacing untouched.
    expect(getEffectiveProviderIntervalMs({ overdriveMode: false, performanceMode: 'eco' })).toBe(6_000);
  });
});
