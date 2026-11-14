# NUVRO AI — Professional Animated UI Upgrade (2026-10-11)

## Implemented

- Reworked Dashboard into a responsive developer studio, preserving Dashboard / Chat / Action navigation and existing functionality.
- New restrained animated gradient hero, orbit illustration made from CSS + existing Lucide icons, actionable buttons, lightweight card entry/hover transitions, and an improved project/activity presentation.
- Added motion-reduction compliance, focus-visible accessibility, compact-window responsiveness and theme-token-based appearance across four existing themes.
- Updated top bar branding and UI hierarchy, with provider-aware connection indicator.
- Sarvam provider status is never assumed connected merely because a key was saved. It displays untested, testing, verified, failed, key-needed, or blocked-by-offline-mode states based on settings and current-session connection-test results.
- Dashboard, chat header, chat composer and provider Settings now correctly distinguish Ollama (local) from Sarvam (cloud); removed misleading 'fully offline' claim when Sarvam is configured.
- Settings provider selector redesigned as side-by-side choice cards. API key handling and connection test actions retained; key save resets connection status to unverified until an actual test succeeds.
- Updated Action screen and composer styling without modifying the agent's execution or file-editing workflows.

## Verification

- TypeScript TSX syntax transpilation via globally installed TypeScript 5.8.3: PASS for App, DashboardView, TopHeader, SettingsScreen, ChatPanel, Composer and ActionHub.
- Full dependency installation (`npm ci --ignore-scripts --no-audit --no-fund --prefer-offline`) attempted, but npm registry DNS failed with EAI_AGAIN. Dependencies were not installed. Full type checking, runtime preview, app build and tests: NOT VERIFIED.
- Live Sarvam API access and Windows DPAPI storage testing: NOT VERIFIED. No API key was provided or requested.

## Recommended verification on Windows

```
npm ci
npm run lint
npm run build
npm test
npm start
```

Before release, manually inspect Dashboard, Chat and Settings with Ollama, Sarvam with key not set, Sarvam with a saved key, and Offline Mode enabled. Verify keyboard navigation and Windows scaling at 125%/150%. Do not claim a provider is connected until Test Connection succeeds.
