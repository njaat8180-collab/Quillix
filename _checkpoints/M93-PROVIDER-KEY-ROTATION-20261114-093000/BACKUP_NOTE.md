# M9.3 — Advanced Provider Key Management (checkpoint)

**Date:** 2026-11-14
**Branch:** `cline/b137d` (no merge, no rebase, no cherry-pick, no history rewrite)

## What this increment contains

| File | Change |
|---|---|
| `src/server/providerKeyRotation.ts` | **New.** The key decision layer: `classifyProviderFailure` (invalid / expired / rate-limited / quota-exhausted / server-error / network-error / unknown), a per-failure cooldown policy, `ProviderKeyPool` with multi-key registration, automatic selection, owner-visible health, cooldowns, recovery and a bounded `execute()` failover. Keys are identified by a truncated SHA-256 digest — raw key material never leaves the pool. |
| `src/server/universal.ts` | The real provider adapter now registers its key set in the pool, records every success/failure, rotates to the next **untried** key on a credential-specific rejection (401/403/402/quota), and keeps the same key for provider outages and plain rate limits. |
| `server.ts` | `GET /api/providers/key-health` — per-provider key counts, active key id, status and failure kind. Never returns key material. |
| `src/services/apiBridge.ts` | `getProviderKeyHealth()` client method. |
| `src/server/__tests__/providerKeyRotation.test.ts` | **New.** 23 unit tests (classification, selection, cooldowns, recovery, health, secret hygiene). |
| `src/server/__tests__/providerKeyRotation.integration.test.ts` | **New.** 5 tests that drive the **real** `UniversalProvider` with a mocked fetch and assert which credential was actually sent on each attempt. |
| `scripts/smoke/provider-key-rotation-contract.mjs` | **New.** Source checks + a runtime exercise of the real pool. |
| `package.json` | New `test:provider-key-rotation` script, wired into `test:smoke`. |

## Design decisions (recorded, not accidental)

1. **A plain HTTP 429 does not rotate the key.** The rate-limit window is an
   *account* level window shared by the keys of that account, so switching keys
   would neither help nor be honest — it would only hide the real limit. The
   key is marked `rate-limited` (visible in the health report) and stays in
   rotation. This preserves the pre-existing product guarantee asserted by
   `universalProvider.test.ts` ("does not rotate API keys to work around a
   provider rate limit").
2. **A quota exhaustion does rotate.** `402`, or a `429` carrying
   `insufficient_quota` / billing text, is credential-specific: another key can
   have credit. That case fails over.
3. **A provider outage never rotates.** A 5xx or a transport error is recorded
   against the key but never cools it down — the next key would fail identically.
4. **A key is never tried twice in one request**, so two broken keys cannot
   send a request back and forth.
5. **The attempt budget is bounded** (`maxAttempts`, default 3) — no infinite
   retry loop is possible.

## Verification recorded for this increment

- `src/server/__tests__/providerKeyRotation.test.ts` — **23 passed / 0 failed**
- `src/server/__tests__/providerKeyRotation.integration.test.ts` — **5 passed / 0 failed**
- `universalProvider.test.ts` (pre-existing, incl. the rate-limit guarantee) — **all passed**
- `npm run test:provider-key-rotation` — **EXIT 0**
- `npm run lint` (tsc --noEmit, strict) — **EXIT 0**
