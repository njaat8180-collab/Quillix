# NUVRO AI coding-quality acceptance plan

This is an evidence plan for raising NUVRO AI toward Cursor-class coding
workflow quality. It is not a claim of parity, and it does not install Cursor
extensions or use cloud inference.

## Durable checkpoint — November 4, 2026 (current continuation)

- Fresh local acceptance matrix regenerated with the current six-case protocol:
  18/18 live cases passed across three installed Ollama models. The artifact
  now carries a hardware fingerprint and the contract rejects missing or
  mismatched environment metadata.
- During the matrix, resource pressure reached 91–96% RAM on the CPU-only
  machine. The resource guard paused requests, released the active brain and
  selected the smaller installed fallback; no unrelated process was stopped.
- Current regression after the benchmark comparison hardening is 52 test files
  and 457/457 tests, with lint and the benchmark artifact contract passing.

- Deterministic routing, project-scoped RAG with symbol/import hints, bounded
  context budgeting, project task memory and the explicit verified-result
  contract are implemented and covered by the current regression suite.
- Current verification: TypeScript check passed; 52 test files and 457/457
  tests passed; Agent E2E passed 66/66; backend/provider/offline-plugin,
  token-efficiency, Tavily, Preview, Chat and Settings contracts passed.
- Windows packaging initially hit the old 180-second smoke timeout while
  electron-builder was still producing the installer. The packaging gate now
  uses a bounded 600-second default (still overrideable with
  `QUILLIX_PACKAGE_TIMEOUT_MS`) and the NSIS installer completed successfully.
- This is strong current reliability evidence, not a Cursor-parity claim.
  Remaining gates are still the real model-origin high-end browser benchmark,
  repeated large-repository refactors, broader language-server/debug-adapter
  coverage, and controlled live-provider latency/pass-rate measurements.
- Fresh model-origin follow-up now passed: `qwen2.5-coder:3b` generated the
  AURA multi-file storefront, produced real verifier failures, and NUVRO AI
  repaired them through the normal bounded loop. The final report was
  `complete: true`, all three files existed, and `failures: []`. This run also
  exercised the new normalization of `/style.css`, `/script.js` and
  `/assets/...` into project-relative preview paths.
- The current full acceptance run passed all `23/23` suites after those
  changes, including 421 unit tests, backend and Agent E2E, provider and
  token-efficiency contracts, offline plugins, Tavily, release artifact,
  Electron browser behavior and packaged debugger acceptance.
- Repeated local-model refactor evidence is now available: two independent
  `qwen2.5-coder:3b` backend-refactor runs both passed their external
  behavioral assertions and configured verification. Each used 3 first-turn
  tools versus 74 available (95% schema reduction), about 3,409 provider
  tokens, and completed the two-file shared-helper refactor with repair/retest.
- The broader six-case local coding benchmark also passed `6/6` with
  `qwen2.5-coder:3b`: CommonJS module creation, async retry repair, backend
  two-file refactor, Python runtime repair, Node runtime repair and Electron
  entrypoint repair. Every case passed its independent behavioral assertion,
  configured verification and token-budget guard.
- Agent E2E now includes a same-project continuation scenario: after creating
  `Calculator`, a second request added a percentage control in place without
  creating a new folder or falling into the chatbot branch. The complete E2E
  run passed `66/66` checks.

## Acceptance matrix

Latest continuation evidence: 40 files / 335 tests pass; verifier-backed single-file HTML quality repair, qwen3:4b token-ui smoke, qwen2.5-coder:3b greeting/async-retry/backend-refactor semantic benchmark passes, Sarvam compact truncation recovery with forced single-tool turns, model-specific Qwen3 schema-constrained tool routing, bounded installed-local fallback brain selection, file-specific plain-website continuation prompts, duplicate-write protection, capability-preserving real-model benchmark telemetry, early-stop native Ollama tool streaming, provider capability snapshots and run observability in task resume/chat context, dependency-aware browser repair targeting, resumable repair-timeout handling, three fresh real `qwen2.5-coder:3b` coding benchmark cases, a capability-driven qwen3:4b greeting-module write→failed-acceptance→edit-repair→retest case, eight workspace-scoped local LSP read-only tools, the Monaco LSP provider bridge, the Node debugger breakpoint/stepping slice, external-JavaScript HTML rejection and Electron Chromium acceptance are covered by regression and production smoke tests.

| Area | Current evidence | Gate still required |
| --- | --- | --- |
| Workspace/project routing | Dedicated project roots, existing-folder reuse, plain-web root normalization; unit coverage | Real multi-project follow-up run with nested assets |
| Context and navigation | Bounded retrieval, local JS/TS import/caller context, AST symbols/imports, editor project context, configurable workspace-scoped local LSP stdio tools, and Monaco definition/reference/diagnostic/hover/completion/rename providers | Full semantic LSP resolution, edit-application review and language-server lifecycle coverage across languages |
| Multi-file edits | Explicit edit targets, per-file recovery prompts, small-model one-file write surface, write tracking, resumable task state, and one fresh real 3B two-file refactor with independent assertions | Repeated refactors across more projects/models and large-repository scale |
| Tool calls | Native Ollama calls, text-emitted tool parsing, schema narrowing for small Qwen, bounded retry/recovery | Measure malformed/truncated-call recovery across installed models |
| Validation and repair | Syntax/HTML/browser-reference checks, compact file-scoped repair prompts, configured test/build retest, fail-closed empty-output verification, real Electron Chromium fixture smoke | Broader browser execution/visual coverage and more runtime-language coverage |
| Website quality | Static web-quality plugin plus prompt-aware responsive/motion/accessibility/search/cart gates; AURA fixture passes static, fake-DOM and real Electron Chromium search/filter/cart/persistence/responsive smoke | Real browser smoke from an unmodified model output and exhaustive UI/visual coverage |
| Offline coding plugins | Eleven bundled offline packs / twenty-four tools, settings toggles, safety limits, approval-gated local Node debugger and no network | Broader language/debug-adapter coverage beyond the verified Node slice |
| UX/editor | Monaco editor, inline completion, project-local navigation, connected LSP providers, dedicated debugger UI, live preview, truthful phases/progress | Full debugger-adapter parity and broad language-server lifecycle/visual coverage |
| Provider/runtime | Local Ollama status, warm-up, model keep-alive, provider error reporting, bounded shared rate-limit retries, NVIDIA NIM/DeepSeek presets | Controlled latency/pass-rate measurements per model and machine |

## Durable checkpoint — October 31, 2026 (semantic retrieval and local extensions)

- Agent-side JavaScript/TypeScript retrieval now uses a bounded local Monaco
  TypeScript language-service adapter for definitions, references/usages and
  semantic/syntax diagnostics. It is covered by dedicated tests and falls back
  to the existing lexical workspace index when no semantic result is found.
- The provider-independent extension layer now supports local MCP stdio
  servers and configurable local LSP stdio servers. Both use direct process
  spawning without a shell and bounded Content-Length frames; MCP keeps its
  approval boundary, while LSP exposes only workspace-scoped read-only
  definition, references and diagnostics tools. Offline Mode keeps both local
  transports available and continues to block network extension tools.
- The Ollama header status check now has an eight-second client timeout,
  cancellation, overlap protection and a 15-second refresh interval, so a
  stopped/unreachable Ollama service cannot leave the UI stuck in “Checking”.
- Verification after these changes: `npm run lint`, `npm test` (37 files / 306
  tests), and `npm run build` passed. This improves semantic JS/TS retrieval and
  offline extension coverage, including the verified local Node debugger slice,
  but does not close the full-LSP, broad debugger UI,
  extension-host, broad visual-coverage, or repeated model-origin gates below.

## Durable checkpoint — October 31, 2026 (real Electron browser acceptance)

- Added `npm run test:electron-browser`, a real Electron Chromium harness that
  serves the AURA fixture over localhost and verifies completed DOM loading,
  stylesheet/hero/product contracts, search narrowing, category filtering,
  cart subtotal, localStorage persistence after reload, mobile viewport
  behavior, horizontal-overflow safety and reduced-motion CSS.
- The browser run passed with `searchVisible: 1`, `categoryVisible: 2`,
  `$128.00` cart persistence, a 374px effective mobile viewport inside a
  390px window, and no document overflow. It also saved and visually inspected
  `.qa-dist/electron-browser/aura-desktop.png` and `aura-mobile.png`.
- The real browser run found and fixed a mobile overflow defect in the fixture's
  off-canvas decorative ambient circle. This is stronger evidence than the
  existing fake-DOM smoke, but it is still one repaired fixture rather than a
  general model-origin browser benchmark.

## Durable checkpoint — October 31, 2026 (local Node debugger slice)

- Added the bundled `quillix-debugger` pack with twelve provider-independent tools:
  `plugin_debug_launch`, `plugin_debug_pause`, `plugin_debug_continue`,
  `plugin_debug_set_breakpoint`, `plugin_debug_clear_breakpoint`,
  `plugin_debug_breakpoints`, `plugin_debug_step_over`,
  `plugin_debug_step_into`, `plugin_debug_step_out`, `plugin_debug_stack`,
  `plugin_debug_evaluate` and `plugin_debug_stop`.
- The adapter launches only existing workspace-local `.js`, `.mjs` or `.cjs`
  files, keeps the inspector on `127.0.0.1`, bounds sessions/arguments/
  expressions, requires explicit approval for launch, validates source
  breakpoints, supports stepping, and cleans child process and WebSocket state
  on stop.
- A real test launches a temporary Node script, reaches its `debugger;` pause,
  returns the workspace-relative stack, evaluates `answer + 1` as `42`, and
  stops cleanly. This closes the verified Node debugging slice, not full
  VS Code debug-adapter, browser-debugger or debugger-UI parity.

## Durable checkpoint — October 31, 2026 (stale task recovery and packaged gate)

### Follow-up checkpoint — packaged debugger UI and workspace rebinding

- The workspace now exposes a dedicated Node Debugger panel with launch,
  pause/continue, stack refresh, expression evaluation and stop controls.
- Workspace switches dispose stale debugger sessions and rebind the adapter to
  the selected root; the regression suite covers this lifecycle.
- The latest packaged acceptance verified root switching, eight LSP tools,
  completion, two debugger stack frames, evaluation and clean stop.
- Latest installer: `release/windows/NUVRO AI Setup 1.2.0.exe`, 163,399,221
  bytes, SHA-256 `FE27463966A8A3054A7D92DDFF6DF93AF34261DF18BC25373C3EF8AC5FD06812`.

- `TaskStateStore` now converts persisted `running` records into explicit
  interrupted/cancelled records during startup and workspace rebind, records a
  finish timestamp and preserves the files/rollback journal for explicit
  resume. This prevents a dead previous session from being treated as the
  active task.
- The recovery regression test and full suite pass at 37 files / 318 tests.
- Fresh packaged Windows acceptance launched with Ollama connected; the API
  reported zero stale `running` tasks, and a real `qwen2.5-coder:1.5b` task
  wrote `packaged-final-acceptance.txt` with one `write_file`, zero tool
  failures, one verification run and `completed` status.

## Execution order

1. Keep file routing and write safety fail-closed.
2. Keep model prompts/tool schemas small and task-specific; resume from verified
   disk state after interrupted turns.
3. Make every named behavior an explicit deterministic acceptance check, then
   feed failures into bounded repair/retest.
4. Use offline plugins for static quality/context and preserve user approval
   boundaries for writes, commands, Git and network extensions.
5. Run unit, production build, HTTP smoke, and isolated real-model probes;
   record failures instead of weakening assertions.

## Current honest limits

The installed CPU-only Qwen 3B/4B models are slow and can still fail native
tool use or omit edge-case behavior on large prompts. Passing deterministic
checks does not prove visual quality, runtime correctness, semantic LSP parity,
or superiority to Cursor. A real high-end website probe remains an acceptance
gate, not a success claim.

## Durable checkpoint — October 20, 2026

- Added a static DOM contract check that still validates literal IDs/classes
  when a browser script also creates dynamic nodes. It catches missing search,
  filter and cart roots instead of allowing a dynamic-renderer exception to
  hide them. Placeholder comments and empty product cards now fail the HTML
  quality gate.
- Added `npm run test:website-behavior`, a deterministic fake-DOM smoke for the
  AURA run. It exercises bootstrap, search narrowing, category filtering,
  add/remove cart persistence, cart count/subtotal updates, JS syntax and the
  responsive/focus/static browser contract. It is explicitly not a real
  headless-browser or visual-regression test.
- The model-generated AURA output initially failed with missing DOM contracts,
  placeholders, missing focus styling and a runtime null-element exception.
  Ollama was unavailable during the targeted repair attempt, so the fixture
  was repaired deterministically for acceptance evidence; that pass is not a
  Qwen quality result. The real-model high-end gate remains open.
- A new-file routing regression was fixed: nonexistent requested files now use
  the focused `write_file` surface before guided `edit_file`, preventing an
  edit loop against a path that does not exist. Production HTTP/SSE acceptance
  now passes again.
- A later read-only host check confirmed `qwen2.5-coder:3b` is installed in
  Ollama, but one bounded fresh high-end probe timed out during the model
  warm-up at 45 seconds before producing an accepted model-origin result. This
  keeps the high-end gate open; it does not invalidate the deterministic
  verifier evidence above.
- The October 31 continuation supersedes that earlier timeout for core coding:
  fresh `qwen2.5-coder:3b` greeting-module, async-retry, and two-file
  backend-refactor cases all passed independent behavioral acceptance. The
  high-end browser/e-commerce generation gate remains separate and open.
- Custom provider setup now survives runtimes without `crypto.randomUUID()`
  and keeps the renderer's encrypted-key state synchronized after saving. A
  deterministic adapter check confirms the configured OpenAI-compatible base
  URL, model and auth behavior. This fixes a concrete key/profile UI failure;
  it is not proof that every third-party endpoint accepts every model or API
  protocol.
- The Ollama warm-up path now has bounded timeout, retry, exponential backoff
  and cancellation. A fresh high-end run reached file generation after the
  local model became available, but it was stopped before validation when the
  provider-key investigation took priority; it is therefore still not a
  model-origin acceptance pass.
- Added a safe OpenAI-compatible preset registry. NVIDIA NIM defaults to
  `https://integrate.api.nvidia.com/v1` + `meta/llama-3.1-8b-instruct`; DeepSeek
  defaults to `https://api.deepseek.com` + `deepseek-flash`. Both use bearer
  `Authorization`, keep the endpoint/model editable, and perform no network
  request until the user presses Connect/Test. Custom OpenAI-compatible setup
  remains available.

## Completion audit — October 20, 2026

This audit is a gate-by-gate status report, not a Cursor-parity claim.

| Gate | Status | Evidence / reason it remains open |
| --- | --- | --- |
| Workspace/project routing | Partial | Dedicated roots, existing-folder routing and the new-file regression are covered; nested multi-project follow-up is not proven. |
| Context/navigation | Partial | Bounded retrieval, AST/import context and project-local definitions/references exist; full semantic LSP coverage is not present. |
| Multi-file edits | Partial | One isolated real 3B two-file backend observation and multi-file tracking exist; repeated independent 3B refactors are not proven. |
| Tool calls | Partial | Ollama tools, text-call parsing, schemas and recovery are tested; broad malformed/truncated-call measurements across models are missing. |
| Validation/repair | Partial | Static contracts, syntax, fake-DOM behavior and HTTP/SSE repair pass; real browser/visual regression and broader runtime coverage remain open. |
| Animated e-commerce quality | Open | The repaired WxPTxO fixture passes deterministic checks, but the preserved rFqZuM model-origin fixture still fails: missing `search-input`, `category-select`, `cart-list`, `subtotal`, `.add-to-cart-btn`, `.remove-from-cart-btn`, meaningful HTML, placeholder content, and focus styling. The bounded continuation produced no repair report. |
| Offline plugins | Proven for current scope | Production smoke passes 11 packs / 24 tools with safety and workspace-boundary checks; local Node debugger breakpoints/stepping and workspace-scoped local LSP bridge are covered, while broader debugger-adapter parity is not claimed. |
| UX/editor | Partial | Monaco, inline completion, project-local navigation, preview and truthful progress exist; full debugger UI and broad language-server integration are absent. |
| Provider/runtime | Partial | Provider preset/adapter tests, full 30-file/275-test evidence, Ollama warm-up controls and installed-model readiness are proven; controlled latency/pass-rate measurements are not. |

Explicit Cursor-level requirements still not proven: full semantic LSP,
debugger/debug-adapter support, VSIX/extension host compatibility, reliable
large-repository refactoring, real browser visual QA, and repeated model-origin
multi-file acceptance. The earlier bounded continuation probe used the
installed `qwen2.5-coder:3b` and produced no accepted origin result. The
October 31 continuation now has three accepted core-coding cases, while
browser/e-commerce model-origin quality remains unproven.

## Final verification checkpoint — October 20, 2026

- Actionable provider-key failures are fixed and covered: focused provider,
  identity and Ollama tests passed 3 files / 24 tests.
- The unrestricted final regression passed 29 files / 269 tests; lint and the
  production build passed.
- The repaired AURA fixture passed deterministic fake-DOM behavior and the
  existing-project verifier (`allOk: true`, no failures). This proves the
  verifier/runtime harness and repaired fixture, not model-origin visual
  quality.
- HTTP/SSE and offline-plugin production smokes passed outside the sandbox;
  their earlier sandbox failures were loopback/temporary-module environment
  restrictions, not source assertions.
- The preserved real Qwen AURA fixture and Cursor-parity gates remain open. A
  single bounded continuation produced no accepted origin report; no timeout
  was converted into a pass and no extra origin probe was started.

## Durable checkpoint — October 20, 2026 (API-first focused window)

- The shared Universal/Grok-compatible adapter now performs bounded retries for
  transient `429`, `502`, `503`, `504` and `529` responses (1 second, then 2
  seconds, honoring but clamping `Retry-After`). HTTP 413 is classified as a
  payload/context limit: NUVRO AI removes older history/tool output once,
  preserves the system instructions and latest user request, and reports a
  clear context-limit error if those protected contents alone are too large.
- The agent layer no longer replays a whole task after an adapter-owned
  rate-limit exhaustion, avoiding quota-pressure loops. Universal unit tests
  passed 25 tests; the unrestricted full regression passed 30 files / 283
  tests; lint and the production build passed. Universal smoke passed 14/14,
  HTTP/SSE repair passed, offline plugin smoke passed 11 packs / 24 tools, and
  website fake-DOM behavior passed all 7 checks.
- The current evidence matrix covers provider setup, retry, payload limits,
  plugin/tool execution, UI/runtime and end-to-end repair. No live key or
  provider call was used. Cursor parity remains open for full LSP/debugger/
  extension-host support, large-repository refactors, real browser visual QA
  and repeated model-origin acceptance with Qwen 2.5 Coder 3B.

## Durable checkpoint — October 20, 2026 (provider route diagnostics)

- OpenAI, Grok, Groq and Universal connection-test routes now preserve safe,
  actionable adapter errors instead of flattening every failure into a generic
  connection message. 413 context-limit, 429 retry/quota, timeout/network and
  empty-response cases are distinguishable; unknown upstream response text and
  secrets are not exposed to the renderer.
- Focused provider-error + Universal tests passed 2 files / 28 tests. Full
  regression passed 31 files / 286 tests; lint and production build passed.
  Website behavior passed 7/7 deterministic checks, HTTP/SSE repair passed,
  and Universal smoke passed 14/14.
- This improves provider parity and debugging feedback, but does not prove
  live provider account access, controlled latency, model quality or Cursor
  parity. The model-origin Qwen 2.5 Coder 3B gate remains open.

## Durable checkpoint — October 20, 2026 (Preview lifecycle and routing)

- Preview is now an explicit local session rather than an iframe-only action:
  `POST /api/preview/start`, status polling, stop, safe HTML-entry validation,
  protected linked-asset checks and clear failure states are wired through the
  UI. Start/Stop/Retry/Back-to-code controls and the existing two-second live
  refresh are retained. This closes the reliability gap where Preview could
  appear available while its entry file or linked JavaScript was missing.
- The focused-file writer prompt now preserves the original user request in
  every compact subtask. This prevents workspace-derived layout guidance from
  erasing the task identity for small local models and was proven by the real
  mock-Qwen calculator E2E, including filesystem writes and project reporting.
- Evidence: 32/32 Vitest files and 289/289 tests passed; backend HTTP E2E,
  verification HTTP, 7/7 website behavior checks, 10 offline packs/12 tools,
  lint and production build passed. The preserved AURA e-commerce run remains
  covered by deterministic checks for HTML/CSS/JS presence, JS syntax,
  browser contracts, bootstrap, interactions and linked assets. These checks
  do not establish real-browser visual quality.
- Cursor-level gates remain explicitly open: model-origin Qwen quality,
  semantic LSP breadth, debugger/debug-adapter UX, extension-host support,
  large-repository repeated refactors and real browser visual regression.

## November 5, 2026 — current-source Chat/Agent lock and release update

- A UI audit found that a saved-task Resume action forced `conversationMode: agent`, bypassing an explicit Chat lock. Resume now refuses to run until the user selects Agent mode, and sends the selected mode unchanged to the server.
- Switching from Agent to Chat requests a stop and aborts the current SSE run. Applying saved patches, rolling back files, and approving pending terminal/workspace actions are also guarded by the selected mode.
- Evidence after these edits: TypeScript lint passed; Chat/Agent UI contract 30 checks passed; intent-router 10 tests passed; full Vitest suite passed 53 files / 511 tests. Production build passed.
- Fresh portable x64 package passed packaged-static (5 required entries, 5 server markers) and release-artifact checks. Packaged debugger runtime passed workspace rebind, 8 LSP tools, completion, and debugger launch/breakpoint/step/clear/stop using a temporary profile. The local package is unsigned.
- Remaining near-term gates: full packaged UI interaction testing, live local-model continuation when at least 2 GiB RAM is free, broader current benchmark evidence and repeatable large-project repairs. The Nov 12 target is a usable, verified coding-agent MVP; full Cursor parity by that date is not promised. Cursor is not installed per the user's preference, so no direct Cursor comparison is claimed.


## 2026-11-05 live-model benchmark preflight

The installed local models are present, including Qwen 2.5 Coder 1.5B and 3B. No model inference was started: free RAM was 1.31 GiB, below the 1.5B model's calculated floor (about 2 GiB). The preflight contract itself passed 2/2 tests, confirming a constrained run records a resumable pause and does not load Ollama. The one-time Ollama metadata command caused a brief startup/resource spike that settled after it exited; no model was loaded. Re-run live coding cases only after the resource gate permits it.

