# NUVRO AI Next-Level Upgrade — v1.1.0 (2026-10-12)

## Verified code changes

1. **Home-screen Quick Connect:** added `src/components/QuickConnect.tsx` and integrated it into the existing Dashboard. Choose Ollama, Sarvam or Universal API. Configure protocol, exact model, endpoint, and (if needed) secret key. Save and test from the Home screen. Keys are never exposed in browser/localStorage; secret input is cleared after successful save.
2. **Universal provider expansion:** OpenAI-compatible Chat Completions, **OpenAI Responses API**, Anthropic Messages, Gemini generateContent. Responses handles native function-call/result items for agent file tools. Supports full tool definitions; does not claim every model/provider supports tools.
3. **Correct provider health status:** a cloud response with no text or function calls is an error, not an authenticated/connected state; API test endpoint double-checks output.
4. **Key safety:** DPAPI-encrypted Universal keys are bound to provider protocol and validated endpoint. Legacy v1 DPAPI ciphertext migrates against persisted settings on startup without exposing key material. Failed migrations preserve the old ciphertext. An unintended HTTP redirect cannot forward the key.
5. **Project-create failure safety:** agent no longer continues to write files to unintended locations when the requested project folder cannot be created.
6. **Type/build cleanup:** fixed mismatched SettingsScreen `universalConnection` props, narrowed phase category typing, switched the verifier to esbuild syntax checks compatible with TypeScript 7, removed runtime type-only imports in SettingsStore, and made smoke tests use Node 22's built-in TS transpilation instead of the legacy TypeScript compiler API.
7. **UI consistency:** Universal status displays a cloud source, stale provider-test status resets on settings changes, and Quick Connect is keyboard-accessible with explicit status/error feedback.

## Tested here

- `npm run test:smoke`: **79/79 passed** (local mock/contract tests, including Responses function tool calls, empty replies, redirect protection, and credential-scoping regressions).
- `tsc --noEmit` using globally installed **TypeScript 5.8.3**, with dependencies recovered from an older source archive: **PASS**.
- `npm run build`: **NOT VERIFIED** here; imported dependency binaries lack appropriate Linux executable permissions/native bindings. Windows requires a fresh `npm ci` to install its native dependencies.
- Actual Windows DPAPI, real cloud API keys, live Ollama runtime, GUI interactions, and Electron installer: **NOT TESTED** in this Linux environment.

This is a source ZIP, not a prebuilt Windows installer. It is not certified free from every bug. Do not ship without running the acceptance checks on your Windows PC.

## Windows acceptance checklist

1. Extract ZIP to a fresh folder; keep the old NUVRO AI directory as a rollback backup.
2. In PowerShell inside `NUVRO AI` run:

   ```powershell
   npm ci
   npm run test:smoke
   npm run lint
   npm run build
   npm run check:sarvam-storage
   npm start
   ```
3. On Home, connect Sarvam with your own key; verify live `Connected` and a successful coding request. Repeat with Universal API using a valid provider/model you own. **Never send your key to another person.**
4. Select a writable workspace and ask: `Create index.html with a Hello World heading and an animated background. Verify that the file exists.` Confirm the file exists on disk and the task is only completed after verification.
5. Repeat after restarting NUVRO AI. Check that the selected model and encrypted key persist, without revealing the key to the UI.
6. Test Stop, error recovery, permissions, and a task that intentionally fails build/test before submission.
