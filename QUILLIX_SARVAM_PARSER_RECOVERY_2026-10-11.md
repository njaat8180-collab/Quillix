# NUVRO AI — Sarvam tool-call / parser recovery update (2026-10-11)

This release is based on the existing `Quillix_Sarvam_Safety_Update_2026-10-11.zip`; it does not replace the user's original ZIP. JARVIS was not changed.

## Changes implemented

- **Fail closed on text-emitted tools:** malformed JSON argument strings, missing arguments, arrays, `null`, and scalar values now raise a clear error before `AgentEngine` receives any executable tool calls. Previous fallback to `{}` was removed.
- **Consistent aliases:** Ollama `function.name` and text-style `name` / `tool` envelopes use the same recognized-tool and argument-key normalization.
- **Atomic batches:** JSON arrays and wrapped tool-call batches are accepted only when **every entry** is a recognized, well-formed tool call. A mixed valid/unknown batch runs **nothing**. A malformed known tool call aborts the full turn.
- **Code examples stay examples:** JSON inside unrelated fenced code blocks is protected from fallback extraction; model code explanations will not be executed accidentally.
- **Sarvam native response validation:** `tool_calls` must be an array when present, each entry must have a named function, and each function must have valid JSON-object arguments. Previously incomplete entries could be filtered out silently. Truncated (`finish_reason: length`) responses raise an explicit error.
- **Node 22 test compatibility:** replaced the text parser's unsupported TypeScript parameter-property syntax and changed an erased type import to `import type`, allowing offline Node `--experimental-strip-types` testing.
- Added `npm run test:tool-parser` and `npm run test:smoke` for the dependency-free smoke test suite. Updated the affected Vitest safety expectation to require an error rather than silently attempting a tool operation.

## Verification completed (this environment)

```
npm run test:core             9 passed
npm run test:resilience      10 passed
npm run test:sarvam-contract  7 passed
npm run test:tool-parser     19 passed
------------------------------------
Total                        45 passed, 0 failed
```

These are offline smoke and mock-provider contract tests. No live Sarvam API, real-model coding run, or Windows Electron UI was tested in this environment.

`npm ci --offline --ignore-scripts --no-audit --no-fund` **failed** (`ENOTCACHED`) because `yocto-queue-0.1.0.tgz` is absent from the npm cache. Thus full npm installation, `npm run lint`, production build, full Vitest suite and interactive Windows verification remain **unverified**, not passed.

## Windows verification (user-reported Node 22.23.2)

Extract the ZIP; run these PowerShell commands from its `NUVRO AI` directory:

```powershell
node -v
npm ci
npm run test:smoke
npm run lint
npm test
npm run build
npm start
```

Then select **Sarvam AI** in Settings, disable Offline Mode, save the API key **in the app only**, and use a **disposable** empty workspace to ask NUVRO AI to create an HTML/CSS/JS calculator. Verify real files and previews, then deliberately request a small fix and check that the agent reruns verification. Keep file/terminal approvals enabled when testing.

**No real credentials are included in this archive.** Do not share Sarvam API keys in chat, screenshots, logs, or test output.
