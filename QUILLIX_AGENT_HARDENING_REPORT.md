# NUVRO AI agent hardening — October 31, 2026

## Scope and provenance

This update modifies the **existing NUVRO AI source** from `Quillix_Full_Coding_Agent_Updated_2026-10-11.zip`. It is a source-code candidate, **not a certified bug-free or Cursor/Codex-equivalent release**. The changes address concrete failures seen in a Windows test log and in the NUVRO AI-generated `test 10.1.zip` To-Do project.

## Implemented in this source candidate

### Bounded Ollama worker recovery — November 1, 2026

When a heavy local model terminates Ollama's `llama-server` while NUVRO AI is
switching to an installed fallback brain, the agent now waits once for the
worker to restart and retries the fallback turn. The recovery is task-scoped
and bounded to one 1.5-second window. Regression coverage brings the suite to
40 files / 336 tests; it does not hide a genuinely unavailable Ollama service.

### Latest adaptive local-brain continuation — November 1, 2026

The verifier now counts inline `<style>` blocks for single-file HTML quality
checks, and verifier-backed responsive/motion/focus repair is no longer gated
by plain-website classification. This closes a real qwen3:4b smoke failure:
the `token-ui` task first omitted two quality contracts, then completed after
one deterministic repair round. The fresh run used one model call, two tool
calls, two verification runs and 890 provider tokens, with all checks passing.
The regression suite is now 40 files / 335 tests. qwen2.5-coder:3b now passes
the greeting-module and async-retry semantic benchmarks after bounded,
verifier-backed contract repairs; its backend-refactor case was already green.
A fresh NSIS rebuild passed
packaged debugger and Electron Chromium acceptance; the installer is
163,399,221 bytes with SHA-256
`FE27463966A8A3054A7D92DDFF6DF93AF34261DF18BC25373C3EF8AC5FD06812`.

Plain website turns now use file-specific continuation prompts, reject
duplicate writes to already-verified files, normalize harmless `<style>` and
`<script>` wrappers from external CSS/JS payloads, persist a selected local
fallback model across later repair turns, and escalate once to an installed
stronger coding model when validation repair makes no filesystem progress.
The real 1.5B AURA run created all three files and reduced verifier failures
after wrapper normalization; it still remains an honest incomplete benchmark
because the model did not repair all JavaScript/HTML behavior requirements.

### Latest continuation checkpoint — October 31, 2026

The full suite now passes at 37 files / 321 tests. Qwen3 model-specific JSON-schema
tool envelopes now avoid long reasoning-only turns, while Sarvam plain-website
truncation has bounded compact single-file retries and forced single-tool turns,
and the local LSP bridge
has verified definition, references, diagnostics, hover, completion and
workspace-scoped rename preview without automatic writes. Connected LSP tools
are now also registered as Monaco definition, reference, hover, completion and
rename providers, with bounded diagnostics rendered as editor markers.
The prior NSIS rebuild was 163,364,687 bytes with SHA-256
`B8F1FBC7DB07298BE4F7A4F841F8913E4906BF12BFA2152ED80001D26957F112`.

### Latest packaged UI checkpoint — October 31, 2026

The packaged build now includes the dedicated Node Debugger panel in the
workspace rail and command palette. A fresh packaged acceptance switched the
 workspace root, connected eight local LSP tools, returned completion items,
launched the workspace-local debugger, set/listed a source breakpoint, stepped,
cleared the breakpoint and stopped the session cleanly. The debugger is
rebound and old sessions are disposed whenever the active workspace changes.
The latest NSIS artifact is 163,397,463 bytes with SHA-256
`13D55B34401AB609E0A6EAF6DBCCD81A45DAD0DFBECA33E7A6912946922315D`.

The current offline ecommerce benchmark also passes the explicit runtime DOM
contract and the independent fake-DOM interaction smoke. The repair engine can
apply this narrow verifier-backed contract repair only for the named benchmark;
generic websites remain model-driven.

Real coding benchmark evidence: qwen3:4b passed greeting-module, async-retry
and backend-refactor (3/3 independent checks); qwen2.5-coder:3b passed the
backend-refactor case. The qwen2.5 greeting and async cases were retained as
honest failures in telemetry because the model produced an ESM export for a
CommonJS request and omitted the async retry result, respectively.

Fresh real-model acceptance also passed with `qwen2.5-coder:3b`: the
greeting-module, async-retry, and two-file backend-refactor cases all passed
their independent behavioral checks. The benchmark now records streamed and
non-streamed tool turns so repair-call counts are observable.

The debugger now also exposes workspace-local source breakpoints and
step-over/step-into/step-out actions through the offline tool registry and the
dedicated panel. The source regression covers set/list/step/clear; packaged
breakpoint acceptance remains part of the final installer smoke.

1. **Request-adaptive phases and plan.** Actual agent runs now build a phase list from the prompt instead of always emitting the same 15 project / 10 fix phases. Titles identify requested source files and common task behaviors. Repair/retest phases are added only after a real failure. Pending required phases are not marked “not needed” during finalization. The user-visible plan mirrors the phase state instead of using five unrelated canned steps.
2. **Better context for small local models.** A model call that still needs a required file now includes the prior conversation and tool results. The earlier file-by-file shortcut replaced that context with a synthetic one-message prompt; that could cause the model to write unrelated code.
3. **Bounded failure handling.** A transient failure of a *read-only* tool can be retried once. Writes, commands, Git mutations and permission decisions are never replayed blindly. Other failures return their diagnostic output to the model for bounded repair. Permission blocks stop automatically. Unresolved errors prevent truthful completion.
4. **More accurate deliverable contracts.** Plain calculator and To-Do web projects default to requiring `index.html`, `style.css`, and `script.js` unless framework, platform or explicit file requirements indicate otherwise. Missing requested files block completion. Build/preview requirements shown as dynamic phases also block completion when unverified.
5. **Web incompatibility detection.** HTML-linked browser scripts are examined for Node-only globals such as `require()` and `module.exports`; HTML documents pasted into external JavaScript files are rejected; missing/unsafe local scripts are flagged. Explicit `localStorage` requirements are checked for an implementation. These are static guards, **not browser execution tests or proof that click handlers work**.
6. **Additional syntax support.** `.ts`, `.tsx`, `.jsx` files are syntactically transpiled by the TypeScript compiler. TypeScript is now a runtime dependency because this validation must work in packaged apps. Project-wide type checking still needs a project build/lint.
7. **Windows test portability.** The Git filename regression test no longer uses double-quote characters forbidden in Windows filenames. The search test keeps testing secret exclusion when Windows denies symlink creation (the symlink-specific assertion remains unverified in that case).
8. **Hindi/Hinglish intent detection** for straightforward new-project and bug-fix requests.
9. **Additional smoke tests** under `scripts/smoke/agent-resilience.test.mjs`, runnable with `npm run test:resilience` and without downloading dependencies.

## Verified in this runner (October 31, 2026)

### Latest continuation evidence

- Agent-side JS/TS retrieval now uses a bounded local Monaco TypeScript
  language-service adapter for project definitions, references/usages and
  syntax/semantic diagnostics, with lexical fallback. Its dedicated test file
  passes.
- Local MCP stdio discovery/invocation is now implemented with direct process
  spawning, bounded JSON-RPC framing, request timeouts, validated environment
  variables, pagination limits and shutdown cleanup. Offline Mode continues to
  block network extensions but permits explicitly local execute tools.
- A configurable local LSP stdio bridge now starts a workspace-rooted language
  server without a shell and exposes read-only definition, references and
  diagnostics tools. The mock server is covered by extension tests and the
  production offline HTTP smoke checks tool discovery.
- The Ollama status indicator has cancellation, an eight-second timeout,
  overlap protection and periodic refresh, preventing a permanent “Checking”
  state when Ollama is stopped or unreachable.
- After these changes, `npm run lint`, `npm test` (37 files / 318 tests), and
  `npm run build` passed.
- Fresh packaged Windows acceptance also passed: the unpacked `NUVRO AI.exe`
  launched cleanly, showed `Ollama Connected · Model Ready`, ran a real
  `qwen2.5-coder:1.5b` task from Studio, wrote `packaged-acceptance.txt`, and
  displayed `AGENT CHECKS PASSED 7/7`. The persisted task metrics recorded one
  `write_file`, one verification run, zero tool failures and a 42,274 ms run.

- **10/10** new agent-resilience tests passed (`npm run test:resilience`).
- **9/9** dependency-free core smoke tests passed (`npm run test:core`).
- The actual To-Do project from `test 10.1.zip` was analyzed against the new checks: they identified the `require('express')` browser incompatibility and the missing `localStorage` implementation.
- TypeScript/TSX source files passed a **transpilation/syntax diagnostic pass** with the locally installed compiler, not a complete project type check.
- Current Windows source verification passes `npm run lint`, `npm test` (37 files / 318 tests), the provider smoke suite, `npm run test:backend:e2e`, and `npm run test:agent-e2e` (63/63). The offline plugin catalog now includes an approval-gated local Node debugger slice: launch-at-entry, breakpoints, stepping, pause/resume, bounded stack frames, expression evaluation and stop; its real workspace test passes. The workspace-scoped local LSP stdio bridge also passes mock definition/reference/diagnostics/hover/completion/rename-preview/workspace-symbol/document-symbol and production HTTP smoke checks, and its providers are wired into Monaco. Persisted `running` task records are recovered as interrupted/cancelled on startup or workspace rebind, and the recovery regression passes. Provider capabilities and the active brain snapshot are now carried into task observability and resume context; external JavaScript validation rejects HTML documents before they can be accepted as browser code.
- Fresh `qwen2.5-coder:3b` model-origin acceptance passed greeting-module, async-retry, and two-file backend-refactor cases with independent behavioral checks. A real `qwen3:4b` greeting-module also passed through its schema-constrained tool path and independent check; the high-end three-file browser/e-commerce model-origin gate remains open because long requests still hit Ollama socket interruptions before all files are accepted.
- The fresh packaged `release/windows/win-unpacked/NUVRO AI.exe` launched successfully. Its UI reported Ollama connected/model ready, and a real packaged-app task completed with 7/7 checks and a verified file on disk. `npm run package:win` also produced the NSIS installer.
- The latest installer is `release/windows/NUVRO AI Setup 1.2.0.exe` (163,381,075 bytes; SHA-256 `141450FB67C4C392621D9CFA29BE01F18659BDE82BEC4F4779D769C946911EE8`). Sarvam HTTP E2E, offline-plugin checks, local LSP smoke, packaged debugger smoke, deterministic website behavior checks and Electron Chromium browser acceptance also pass. Streaming-capable Ollama repairs use incremental tool transport for initial writes and compact structured transport for small-model website repairs; plain websites now use file-specific continuation prompts and duplicate-write protection, existing fix-mode websites use the same plain-web contract, browser-contract failures can target their incomplete HTML root, and repair provider timeouts now return resumable incomplete results. Native Ollama streams stop after a complete required tool call, and installed local fallback brains are selected only after bounded timeout/transport failures. The real-model benchmark wrapper preserves declared brain capabilities; qwen3:4b passed a capability-driven greeting write, failed acceptance, edit repair and retest sequence. Quick Connect and Settings persist dedicated Grok and Groq model IDs. Final agent results expose provider/capability, tool-call/failure, verification, retry, duration and per-tool evidence to the chat UI.
- Real Electron Chromium browser acceptance now passes via `npm run test:electron-browser`: it loads the AURA fixture, verifies DOM/style contracts, exercises search/category/cart/localStorage persistence, checks mobile overflow and reduced-motion behavior, and saves desktop/mobile screenshots under `.qa-dist/electron-browser`. This run also found and fixed a mobile decorative-overflow defect.
- Full browser visual/click coverage for every UI control, model-origin browser generation, and live-key acceptance for every cloud provider are not implied by this single fixture and remain separate release risks.
- Fresh packaged acceptance after the installer rebuild reported zero stale running tasks and completed a real `qwen2.5-coder:1.5b` write task with one tool call, zero failures and one verification run.

## How to run the Windows acceptance gate

The high-end benchmark harness now always writes `acceptance-report.json`, including on a bounded timeout/provider failure, so partial files and failure evidence remain available for the next repair run.

The latest fresh real `qwen2.5-coder:3b` coding benchmark also recorded an
independent pass for the async-retry case (98.8s) and a truthful failure for
the greeting-module case: the model omitted the missing-name guard, the
acceptance command caught the resulting `undefined.trim()` error, and the
bounded repair timed out. The report is preserved under
`.quillix-smoke/coding-benchmark-mLz9lo/` for reproducible follow-up.

Extract this ZIP. Open PowerShell **inside the `NUVRO AI` folder**:

```powershell
npm ci
npm run test:resilience
npm run test:core
npm run lint
npm run test:backend:e2e
npm test
npm run build
npm run benchmark:coding -- --acceptance
npm start
```

Then, with Ollama running and Qwen selected, run a fresh To-Do test requiring add/delete/complete actions and `localStorage`. Confirm all files on disk, inspect JS for browser compatibility, open the isolated preview, click through actions, reload to confirm persistence, and verify that errors cause a bounded fix-and-retest rather than a false “completed.” Test approval refusal and retry handling separately. Only claim release readiness after these checks and review any npm audit vulnerabilities.

## Remaining engineering risks

- Heuristic intent parsing and static feature checks cannot guarantee full semantic correctness for arbitrary prompts.
- Qwen 2.5 Coder 3B can still generate poor code or fail to call tools reliably; more capable local models may require more RAM than the original PC has.
- Browser visual/click coverage for every UI control, model-origin browser generation, recovery under process termination, Git edge cases and a full third-party security audit remain additional release work. The packaged Electron launch, Ollama connection, core agent task and one real Chromium browser fixture are now verified on Windows.
- The source does not claim zero defects, production certification, or superiority over Cursor/Codex. Always keep backups of workspaces before letting any agent modify files.
