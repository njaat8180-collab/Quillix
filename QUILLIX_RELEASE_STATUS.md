> **Newer update available:** Read `QUILLIX_AGENT_HARDENING_REPORT.md` for the current adaptive-phase, retry, and browser-compatibility changes. Tests and limitations below refer to the **earlier** release snapshot unless the newer report says otherwise.

# NUVRO AI — Full-source stabilization candidate

**Authoritative latest installer (November 2, 2026):** `release/windows/NUVRO AI Setup 1.2.0.exe`, 163,400,459 bytes; SHA-256 `BA3B84C22E0FBCF5BF90EB73799829CF2437B735D9F011C5378C29EEFBE5832B`.

Post-recovery checkpoint: the source regression suite is 40 files / 336 tests,
and the packaged debugger plus Electron Chromium acceptance pass on the rebuilt
installer. The latest runtime addition is one bounded Ollama fallback-worker
reconnect after a local `llama-server` termination.

Latest source checkpoint: 41 Vitest files / 340 tests pass, including fallback
brain unload integration and `OLLAMA_RELEASE*` observability events.

**Historical installer snapshot:** `release/windows/NUVRO AI Setup 1.2.0.exe`, 163,384,694 bytes; SHA-256 `914FB4A98749CE80DEC0C0102FFF6A6FE0F22742327D4FA2263AB41783D847D5`.

> **Current Windows verification (November 1, 2026):** The source passes lint, 40 Vitest files / 335 tests, qwen3:4b token-ui repair, qwen2.5:3b greeting and async-retry semantic repairs, offline Ollama ecommerce repair benchmark, and independent fake-DOM website behavior smoke. The packaged app also passed root rebind, eight local LSP tools, completion, debugger launch/set/list/step/clear/stop, and real Electron Chromium acceptance. The latest installer is `release/windows/NUVRO AI Setup 1.2.0.exe` (163,399,221 bytes); SHA-256: `FE27463966A8A3054A7D92DDFF6DF93AF34261DF18BC25373C3EF8AC5FD06812`. The fake-DOM smoke is deterministic and is not a substitute for exhaustive visual coverage; live cloud API keys remain separate acceptance work. See `QUILLIX_AGENT_HARDENING_REPORT.md` for the authoritative current report.**

**Updated: October 11, 2026**  
**Release type: Source ZIP for Windows development / acceptance testing.**  
**Production certification: NOT YET VERIFIED.** No claim of a signed installer, fully verified desktop UI, or guaranteed performance of the small Qwen model is made.

**Current installer hash supersedes the historical line above:** `4E9DB7EAD7674FEAD06BFFCCFE040AE39D09C2CF2CB88DF1D62D2FFC406737FB` for 163,384,656 bytes.

**Latest continuation checkpoint:** 37 files / 321 tests pass; Qwen3 schema-constrained
truncation recovery, eight workspace-scoped local LSP read-only tools, and the
Monaco LSP provider bridge are covered by regression and production smoke tests.

Latest packaged artifact after this continuation: `release/windows/NUVRO AI Setup
1.2.0.exe`, 163,382,474 bytes, SHA-256
`C57A5433DC60AAEF33603F92C7FB0AD829AE16D7C88E6305C90718C2C8288C58`.

## What is present

The existing Electron/React/TypeScript offline coding-agent application remains intact. It provides Ollama-backed conversation, agent/plan/review workflows, real workspace file tools, search, Monaco editor, terminal, Git, diffs, tests and builds, project preview, project memory, task resumption, and live task events. It uses `qwen2.5-coder:3b` by default. These were existing features or prior source changes; **not all of them have been fully exercised on Windows**.

## Engineering changes in this continuation

1. **Agent/file completion (from the previous NUVRO AI update):** missing-file detection, one-file-at-a-time Qwen fallback, truthful build/syntax/runtime reporting, read-only Plan/Analyze modes, review staging, editor conflict protection and API Host/Origin validation. Existing fix-mode websites now share the plain-web contract, validation repair timeouts preserve resumable incomplete task state, and native Ollama tool streams stop once required tool arguments are complete.
2. **Tool execution:** project-scoped install/build/test/lint commands run from the selected project directory. Missing scripts report a real configuration error, rather than running an unrelated npm command. Dependency installation requires approval when enabled. Shell metacharacters in `testPath` are rejected. Avoids `npx` downloading a compiler automatically.
3. **Tool UI:** manual Tool Registry requests display an approval dialog when the backend requires it, and tool output is displayed rather than an empty object. Terminal approval also covers REVIEW-risk commands.
4. **Git:** executes Git with argument arrays, never a shell string. Supports spaced and unusual filenames, checks stage/restore paths remain inside the active workspace, bounds `git log` size and handles Git process timeout/errors.
5. **Workspace search:** ignores symlinks, protected secret files, task-memory internals and oversized/binary files; bounds work and results; prevents an infinite match loop with zero-width regular expressions. Editor/file read rejects files above 8 MiB instead of loading unbounded contents.
6. **Web preview:** generated websites load from a second ephemeral `127.0.0.1` port, separate from the privileged NUVRO AI API origin. This permits normal browser storage while cross-origin API checks deny file/terminal access. The older API-origin preview remains opaque-sandboxed. Private assets and traversal are denied.
7. **Export:** pure Node ZIP export of the selected workspace works on Windows without Python or a shell. Excludes secret files, Git metadata, dependencies, and symlinks; refuses extremely large exports instead of exhausting memory.
8. **Testing infrastructure:** cross-platform backend compilation and standalone HTTP acceptance tests against a mock Ollama server, plus separate dependency-light security/unit smoke tests.
9. **Project naming:** avoids common descriptive adjectives and recognizes To-Do in project titles; the E2E driver understands named project subfolders instead of assuming all generated files are at workspace root.

## Verification actually completed here

| Check | Result |
|---|---|
| TypeScript compiler on complete source (`tsc --noEmit -p tsconfig.json`) | PASS |
| Backend TypeScript emission (`tsc --project tsconfig.integration.json`) | PASS |
| Core tests (`npm run test:core`) | **9/9 PASS** |
| Real local HTTP backend + mock-Ollama acceptance (`npm run test:backend:e2e`) | **ALL PASS** (server, model handshake, workspace restrictions, isolated preview, ZIP, terminal approvals, multi-file generation) |
| Existing extended HTTP agent driver with a mock model (`node scripts/e2e/e2e-driver.cjs`) | PASS after updating folder assertions; agent wrote and repaired actual files |
| Full Vitest suite (`npm test`) | NOT RUN — available dependencies include Windows-only native binaries on this Linux runner |
| Vite frontend production build (`npm run build`) | BLOCKED — `vite` executable cannot run with the provided platform-specific dependencies |
| Real Ollama/Qwen model inference | NOT TESTED — Ollama is not installed on this runner |
| Windows `npm start`, desktop UI, installer, application signing | NOT TESTED — no Windows desktop environment |
| Chromium visual/localStorage browser verification | NOT COMPLETED — available headless Chromium timed out in this runner |

**Important:** A mock-model pass tests the protocol and real tool side effects. It does **not** prove that Qwen 2.5 Coder 3B will follow every complex prompt or produce high-quality production code.

## Recommended Windows verification

Open **PowerShell** in this ZIP's extracted NUVRO AI project folder:

```powershell
node --version
npm ci
ollama pull qwen2.5-coder:3b
npm run lint
npm run test:core
npm run test:backend:e2e
npm test
npm run build
npm start
```

Prerequisites: supported Windows 10/11 environment, Node.js 22.16+ (recommended current Node 22 LTS or 24 LTS), npm, and a running local Ollama installation. `npm ci` requires network access the first time.

Then manually verify a **real** Qwen-generated 3-file web project, a nested multi-file coding request, error/fix/retest, Read-only Plan mode, diff review, file-save conflicts, browser `localStorage` within Preview, and terminal/Git approvals. Finally run `npm run package:win` if an installer is needed.

## Limitations and safeguards

- Local `qwen2.5-coder:3b` can still stop early or fail difficult tasks. NUVRO AI reports incomplete output rather than falsely claiming success. Larger compatible local coding models may improve results if hardware permits.
- Tools run real code on the user's Windows machine. Keep terminal and Git approval enabled and review the effect of commands before accepting them.
- This is source code, not a prebuilt `.exe`; dependencies and Windows-specific binaries are intentionally not bundled into the ZIP.
- Preview is not the same as a test pass: actual browser behavior, network requests and performance must be tested separately.
- Release quality still requires Windows end-to-end testing, real-model evaluation, installer validation, recovery tests, security review and preferably code signing.

## Windows Sarvam API key secure storage repair (2026-10-12)

Windows PowerShell discovery and DPAPI encoding/diagnostics were hardened. Save now verifies CurrentUser protect/unprotect before committing ciphertext; legacy plaintext fallback was not added. Run `npm run check:sarvam-storage` on the target Windows machine before testing with a real key. Windows DPAPI and live Sarvam access were not verified in the authoring environment.
