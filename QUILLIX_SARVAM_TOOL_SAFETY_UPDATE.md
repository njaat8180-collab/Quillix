# NUVRO AI Sarvam tool-call safety update — October 11, 2026

## Baseline

This source patch builds on the existing `Quillix_Professional_Animated_UI_Preview_2026-10-11.zip`. The original archive was not edited.

## Implemented

- Sarvam native tool-call JSON arguments are now validated strictly.
- Malformed JSON, absent arguments, arrays or scalar arguments yield an explicit error **before tool execution**. Previously these were silently converted to `{}`.
- Object arguments and valid JSON-object strings continue to work.
- Replaced TypeScript parameter-properties in `ProviderRouter` with explicit assignments, allowing dependency-free tests under Node.js 22 `--experimental-strip-types`.
- Added `npm run test:sarvam-contract` (4 tests) using a stubbed fetch; tests do not contact Sarvam or use actual API credentials.

## Verification in this environment

- `npm run test:sarvam-contract`: 4/4 PASS.
- `npm run test:core`: 9/9 PASS.
- `npm run test:resilience`: 10/10 PASS.
- Total: **23/23 automated smoke tests passed**.

These tests confirm the guard and previously tested regressions, **not** that an end-to-end real-model coding workflow passes.

## Known limits

- This Linux environment had an incomplete `node_modules`; package installation, Windows Electron startup, `npm run lint`, production build, full Vitest suite, and live Sarvam/Ollama testing were not verified for this update.
- User reports Node.js **22.23.2** on Windows, which is newer than the stated minimum **22.16.0** in this project's prior release notes. That is sufficient to attempt local installation, but does not prove dependencies or Windows compatibility.

## Windows validation commands

In PowerShell, extract ZIP and `cd` into its `NUVRO AI` directory, then run:

```powershell
node -v
npm ci
npm run test:sarvam-contract
npm run test:core
npm run test:resilience
npm run lint
npm run test:backend:e2e
npm test
npm run build
npm start
```

Never paste an API key in chat, logs, or screenshots. For Sarvam, configure the key in app Settings only after verifying the build. Test real file-writing in a **disposable workspace** with approvals enabled.
