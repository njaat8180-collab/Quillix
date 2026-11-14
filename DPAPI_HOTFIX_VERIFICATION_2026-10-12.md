# NUVRO AI Sarvam DPAPI RuntimeException hotfix — verification

## Symptom

Selecting Sarvam AI and saving the key in Studio Settings returned:
`Windows DPAPI secure storage failed (Windows error type: RuntimeException)` and `KEY NOT SET`.

## Changes

- Explicitly load `System.Security` in Windows PowerShell 5.1 before using `System.Security.Cryptography.ProtectedData`, or load the `System.Security.Cryptography.ProtectedData` assembly under PowerShell 7.
- Keep API key input in stdin as base64 and never place it in PowerShell arguments, logs or disk plaintext.
- Preserve DPAPI CurrentUser protection and read-back verification before saving.
- Distinguish a missing DPAPI type from an opaque RuntimeException without exposing the exception payload.
- Hide stale Ollama Test Connection success text while Sarvam is selected.

## Verified in Linux test runner (Node 22.16.0)

- `npm run test:smoke`: PASS, 59/59 tests across 7 smoke suites.
- `npm run test:windows-storage-contract`: PASS, 7/7 mocked Windows contract tests, including 2 new regression cases.
- Actual Windows DPAPI **NOT tested** here; live Sarvam API **NOT tested** here.
- Full npm install and TypeScript/Electron build **NOT verified**. `npm ci --offline` failed because `yocto-queue-0.1.0.tgz` was not cached, and a subsequent online npm attempt reported `Exit handler never called`.

## Required on your Windows PC

1. Extract ZIP to a *new* directory (keep old working NUVRO AI as backup).
2. Open PowerShell in the `NUVRO AI` directory, then run:
   ```powershell
   npm ci
   npm run check:sarvam-storage
   npm run lint
   npm start
   ```
3. Only after `check:sarvam-storage` reports PASS, paste your actual Sarvam API key in Settings → Sarvam AI → Save API Key, then click Test Sarvam Connection. A connection test can use API credits.
4. Restart NUVRO AI and ensure KEY SAVED persists.
5. If Windows check fails, send only error text — never the API key.

If group policy disables PowerShell or the Windows user profile cannot use DPAPI, secure storage will still fail closed.
