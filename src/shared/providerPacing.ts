/** Shared default for cloud providers. Ollama bypasses cloud pacing entirely. */
export const DEFAULT_ONLINE_PROVIDER_MIN_INTERVAL_MS = 4_000;

/** Overdrive permits broad parallel cloud work; every other profile stays single-flight. */
export const OVERDRIVE_PROVIDER_CONCURRENCY = 8;

/**
 * Overdrive Mode removes every app-imposed delay: requests fire the moment
 * they are ready with no spacing and no declared rolling-quota wait. Only the
 * AI provider's own latency and limits remain, and a provider rate-limit hit
 * is retried the instant the provider's window reopens (see universal.ts).
 */
export function getEffectiveProviderConcurrency(settings?: { overdriveMode?: boolean; turboSpeedMode?: boolean; performanceMode?: 'eco' | 'balanced' | 'turbo' }): number {
  if (settings?.overdriveMode === true) return OVERDRIVE_PROVIDER_CONCURRENCY;
  return settings?.turboSpeedMode === true || settings?.performanceMode === 'turbo' ? 2 : 1;
}

export function getEffectiveProviderIntervalMs(settings?: { overdriveMode?: boolean; turboSpeedMode?: boolean; performanceMode?: 'eco' | 'balanced' | 'turbo' }): number {
  if (settings?.overdriveMode === true) return 0;
  if (!settings) return DEFAULT_ONLINE_PROVIDER_MIN_INTERVAL_MS;
  if (settings.turboSpeedMode === true) {
    // Turbo mode drops the artificial floor to ~60 requests/minute. Agent
    // turns are normally separated by seconds of tool execution and
    // verification, so this only guards back-to-back bursts while staying
    // inside free-tier RPM limits (Groq/Sarvam/NIM ≈ 30-40 RPM). Anything
    // lower floods provider quotas; a 429 costs a cooldown or a local-fallback
    // quality drop. Provider-advertised limits and Retry-After still tighten
    // this further at runtime.
    return 1_000;
  }
  const mode = settings.performanceMode ?? 'balanced';
  if (mode === 'turbo') return 1_000;
  if (mode === 'eco') return 6_000;
  return DEFAULT_ONLINE_PROVIDER_MIN_INTERVAL_MS;
}
