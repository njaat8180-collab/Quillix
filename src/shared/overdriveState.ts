/**
 * Overdrive Mode — single source of truth for "no app-imposed delays".
 *
 * The server flips this whenever settings change (startup + every settings
 * update) so every module that would otherwise wait — the resource guard, the
 * universal transport's pacing and cooldowns, the provider router — follows
 * the live setting without threading it through every call site.
 *
 * Delays this removes are all NUVRO AI's own: request pacing, declared
 * rolling-quota windows, header-derived adaptive spacing, conservative
 * fallback cooldowns and resource-safety pauses. Provider-side latency and
 * limits (network, generation, Retry-After windows) always remain.
 */
let overdriveActive = false;

/** Enable/disable Overdrive Mode. */
export function setOverdriveActive(active: boolean): void {
  overdriveActive = active === true;
}

/** True while Overdrive Mode is removing app-imposed delays. */
export function isOverdriveActive(): boolean {
  return overdriveActive;
}
