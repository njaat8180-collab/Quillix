# Verified coding workflow — October 19, 2026

## Durable checkpoint — October 20, 2026

- Browser verification now checks literal DOM IDs/classes even for scripts that
  use `createElement`/`innerHTML`, and rejects explicit HTML placeholders or
  empty product cards. This caught the AURA run's missing search/filter/cart
  roots before runtime execution.
- Added `scripts/smoke/website-behavior-check.ts` and the
  `npm run test:website-behavior` command. The current repaired AURA fixture
  passed all checks: three files present, JavaScript syntax, static browser
  contract, runtime bootstrap, search narrowing, category filtering,
  add/remove cart persistence, and cart state updates. The independent
  `verify-existing-ecommerce.ts` verifier also returned `allOk: true`.
- The AURA fixture was repaired deterministically after the targeted Qwen
  repair could not start because Ollama was unavailable. This is acceptance
  evidence for NUVRO AI's verifier/smoke, not evidence that the 3B model itself
  produced the final high-end site. A real headless browser and visual
  regression runner are still not installed.
- Fixed a deterministic agent regression: when a requested file does not
  exist, `directNewFile` now takes precedence over guided `edit_file`. The
  production verification smoke previously looped on `File not found:
  greet.cjs`; after rebuilding, it passes the real failure -> edit -> retest
  sequence.
- Final evidence for this checkpoint: `npm test` **28 test files / 264 tests
  passed** in the unrestricted runner; `npm run lint` passed; production
  `npm run build` passed; `npm run test:website-behavior` passed; the offline
  production smoke passed with 10 packs / 12 tools; and the production
  HTTP/SSE verification smoke passed. The first sandboxed full-test attempt
  had 21 `ENOENT` failures from deleted Vitest SSR temp modules, so it is not
  counted as a code result.

The high-end model-origin website gate remains open. No Cursor-level parity
claim is made.

### Latest model-origin attempt

The host-level read-only Ollama check listed `qwen2.5-coder:3b` (1.9 GB) and
the other installed Qwen models. One bounded fresh high-end AURA probe was
then started in an isolated workspace with that model; it timed out during
the provider warm-up at 45 seconds and produced no accepted model-origin
website result. No deterministic fixture pass was reclassified as a model
pass, and no second blind retry was started.

## Production follow-up — October 19, 2026

- Added the offline **Web Quality & Accessibility** pack with
  `plugin_web_quality_check`, bringing the bundled catalog to 10 packs and 12
  tools. It audits local HTML/CSS/JS references, viewport/semantics, responsive
  CSS, focus styles, reduced-motion coverage and recognizable DOM behavior
  without fetching or executing generated code.
- Prompt-aware browser acceptance now fails closed when a request explicitly
  asks for responsive, animated, accessible, search/filter or cart behavior
  that is absent from the generated source. This is a static gate, not visual
  regression or browser execution.
- `qwen3:4b` now receives the same compact local-model tool surface as the
  installed 1.5B/1.8B/3B Qwen models. Plain website prompts no longer contain
  conflicting inline-CSS guidance when the contract requires separate root
  files.
- Empty verifier input is now a failure, so a model that produced no files can
  never receive an accidental `allOk: true` report. Production HTTP smoke now
  counts tool-enabled agent turns separately from the server's model warm-up.
- Plain-website repair turns for small Qwen models are now compact and
  file-scoped: the model receives only the failing file, its current source and
  the verifier evidence, with a single `write_file` surface. HTML comments no
  longer trip the lightweight tag checker, and site-root `/style.css` or
  `/script.js` references are rejected because they break nested previews.
- Plain-website full-file repair now uses a compact native-tool request instead
  of streamed strict JSON, a reduced context/output budget, and deterministic
  per-file HTML/CSS/JS contracts. A request-shape regression confirms the
  repair surface is exactly one `write_file` tool with no conflicting format.

Latest deterministic verification before the October 20 checkpoint: **28 test
files / 262 tests passed**, TypeScript lint passed, production bundles built, HTTP/SSE
verification passed, and the offline-plugin production smoke passed with all
10 packs / 12 tools. A real `qwen2.5-coder:3b` three-file website smoke also
completed and passed. The high-end animated e-commerce probe did write all three
requested files after per-file orchestration, but validation still found a
truncated JavaScript file, malformed/incompatible HTML references, and missing
responsive/focus behavior. Two bounded repair attempts—including the compact
file-scoped prompt—produced no tool call; the generated files remained
unchanged. No visual-quality success claim is made, and this remains an open
high-end acceptance gate.

## Next-level follow-up — October 19, 2026

- Code navigation now separates `find_definition` from `find_references`/
  `find_usages`, so the agent can anchor edits to declarations instead of the
  first lexical match.
- `project_health_check` is language-aware. It validates configuration and
  runs available typecheck/lint/build/test commands for the detected project;
  it no longer claims a pass only for TypeScript projects.
- The editor keeps native Monaco intelligence and adds bounded project-local
  symbol completion plus go-to-definition for Python, Go, Rust, Java, C#,
  C/C++, Kotlin, Swift, PHP and Ruby. Open buffers override disk snapshots.

These are deterministic tooling improvements around the selected AI model;
they do not claim universal Cursor parity or replace language-specific LSPs.

## Qwen 3B runtime profile — October 19, 2026

- No model training or weight changes were used. Qwen Coder requests now use a
  bounded coding sampling profile, a 6,144-token focused context / 12,288-token
  project context budget, and a 30-minute Ollama keep-alive by default.
- NUVRO AI warms the selected local model in the background after the server
  starts, so the first user task does not pay the full cold-load penalty.
- A real `qwen2.5-coder:3b` run created and independently checked `greet.cjs`
  successfully after warm-up. The warm-up took 11.4 seconds; the coding task
  itself took 43.1 seconds on this machine, which is CPU-bound rather than a
  prompt/tool failure.
- The completion gate was tightened so an optional, unconfigured test attempt
  cannot mark a successfully validated fix as incomplete. Explicit user tests
  and configured project checks still fail closed and trigger repair.

NUVRO AI now has a stronger local coding workflow. This report records measured
improvements, not a claim of general Cursor parity or a model-training upgrade.

## What changed

1. Explicit file-wise editing clauses are tracked. A multi-file edit cannot
   silently stop after only the first requested file. The current target gets
   its own instruction, current protected/redacted source, and an exact-edit
   schema on small Qwen models. This is a bounded heuristic, not a semantic
   planner or a language server. Reference-only files are not automatically
   treated as editing targets; test files need a direct editing instruction.
2. The Studio's active saved file is included in agent requests. Implicit requests
   such as “Fix this function” can use that context without confusing an unrelated
   open tab with an explicitly named new-file request. Unsaved editor buffers are
   not sent: save drafts first. The composer shows the saved file used as context.
3. Large source files keep normal read/search tools instead of being trapped in an
   edit-only response format based on a truncated excerpt.
4. Agent/Debug composers include **Acceptance check**. Enter a real project check,
   for example `node --test`, `python -m pytest`, `cargo test`, or `go test ./...`.
   It runs after edits through the existing terminal/workspace permissions. The
   command stays in this workspace session, clears on folder changes, and is not
   executed in Ask/Plan modes or while patches await review. Installed runtimes
   and project tests are still required. Do not put credentials in the field.
5. The API accepts optional `verificationCommands` (up to three single-line,
   non-empty commands of at most 2,000 characters). Malformed input is rejected
   before a task starts. Commands do not bypass approval. Passing results must
   correspond to the final tracked source bytes; failed assertions are fed back
   into bounded targeted repair and real retesting.
6. `edit_file` now requires explicit `newString`. A match must be unique unless
   `replaceAll: true` is deliberately provided. Empty replacement means an intended
   deletion; omission does not. No-op edits do not count as completed work.
7. Editing valid JS/JSX/TS/TSX/JSON source of up to 512 KiB gets a syntax preflight.
   A proposed syntax-breaking replacement is rejected before saving, preserving
   the original. Already-invalid source can still be repaired. This is not type
   checking or a guarantee of correctness; other tools/large files still need
   their ordinary verification and review. It does not cover every write tool.

## Real local-model observations

All observations below used the installed `qwen2.5-coder:3b` through loopback
Ollama, with isolated settings and fixtures. No downloads, cloud fallback, global
Ollama changes, or actual user-project edits were used for acceptance testing.

| Probe | Independently checked behavior | Result | Observed time |
| --- | --- | --- | --- |
| Greeting module | Named API, whitespace trimming, empty and missing inputs | Passed | 49.1 s |
| Async retry | Await rejection, default retry count, explicit attempt limit, final error identity, synchronous success | Passed | 115.4 s |
| Two-file backend refactor | Cents rounding, totals, empty input, actual shared-helper use rather than copied conversion | Passed | 150.7 s |

The greeting observation is in `.quillix-smoke/coding-benchmark-wt4z28/`;
the final async/backend observations are in
`.quillix-smoke/coding-benchmark-YjI8Kv/`. These are separate runs, not a single
statistically controlled suite. Independent assertions are held in the runner;
when `--acceptance` is provided, their command is explicitly given to the engine
so actual failures can drive repair. This differs from earlier no-check runs.
No speedup percentage, broad pass rate, or product-superiority score is implied.

The earlier failures remain in the reports. In particular, one intermediate
backend run passed its weak project tests but failed the independent helper-reuse
assertion. Another async run generated broken syntax and timed out. Those findings
motivated file-specific instructions and preflight protection; they were not
hidden, hand-fixed in the fixtures, or reclassified as successful. Assertions and
expected values were not weakened to make the final observations pass.

## Verification and reproduction

Final verification: **22 test files / 224 tests passed**, TypeScript passed,
production UI/server/Electron bundles built, and the HTTP/SSE repair smoke passed.
Browser QA confirmed that opening a saved file updates the composer context,
the acceptance command accepts input, and Ask mode hides the execution control.
No agent task or terminal command was submitted from that UI preview.

```powershell
npm test
npm run lint
npm run build
npm run test:verification-http
npm run benchmark:coding -- --acceptance
```

The production HTTP/SSE smoke test uses a deterministic local provider to verify
API input validation and a real Node assertion failure → targeted edit → passing
retest. It is not evidence of AI intelligence. Actual-model probes are separate.
Settings remain isolated in both test paths; failure reports are retained.

For the local probes, existing models at `D:\.ollama\models` were served on a
temporary localhost port (11435) because the default Ollama instance previously
listed no models. The user's saved provider, credentials and global model-store
configuration were not silently changed. A normal instance that still cannot see
the installed model needs that setup resolved independently.

## Remaining gap

Three small passing probes do not establish Cursor-level coding capability.
There is still no full LSP/debug-adapter/VSIX extension host or proven large-repo
refactoring performance. Lexical/import-assisted retrieval is not comprehensive
semantic understanding. Local 3B inference on this approximately 6 GiB CPU-only
machine remains slow and can make reasoning mistakes. Real tests, diff review,
permissions and a capable user-selected model remain necessary.

## Provider credential-flow checkpoint — October 20, 2026

- The custom-provider UI had a concrete pre-save failure path: it called
  `crypto.randomUUID()` directly. In Electron/file contexts where that API is
  absent, adding any external provider stopped before settings/key persistence.
  `src/shared/providerIdentity.ts` now uses the runtime UUID when available and
  a validated local profile identifier otherwise; the identifier contains no
  credential material.
- The same UI saved provider settings first, then encrypted the key, but only
  published the pre-key settings object to the renderer. It now publishes the
  post-key state, so `universalKeyConfigured` and the Test/Remove controls stay
  synchronized. Provider form buttons are explicitly non-submit buttons.
- The OpenAI-compatible adapter regression now asserts the exact
  `/chat/completions` URL, model mapping, and omission of Authorization for a
  no-auth connection. Existing deterministic tests cover bearer/custom-header,
  Basic, Anthropic, Gemini, Responses, transient retry, cancellation and
  malformed-stream handling. No real key was requested or used.
- Focused provider/identity/Ollama tests passed **24/24**; the unrestricted
  full suite passed **29 test files / 269 tests**, TypeScript lint passed, and
  the production build passed. A sandboxed full-suite attempt reported 21
  `ENOENT` failures while Vitest loaded deleted temporary SSR modules; the
  unrestricted rerun passed, so those are environment failures rather than
  provider assertions. The AURA fake-DOM website smoke passed all checks and
  the deterministic production HTTP/SSE smoke passed outside the sandbox;
  its sandboxed attempt could not reach the spawned loopback server.
- The endpoint remains intentionally protocol-compatible rather than universal:
  HTTPS (or loopback HTTP) is required, the exact provider model ID must exist,
  and a Vercel/OpenRouter/other gateway must expose the selected OpenAI,
  Responses, Anthropic or Gemini contract. Credentials and account access are
  not verified without a user-supplied key and a live provider request.

## Completion audit — October 20, 2026

The acceptance matrix was audited requirement by requirement. Current status:

- Workspace routing, project context, file-wise edits, tool parsing, validation
  and editor UX are **partial**: deterministic/unit coverage is substantial,
  but the plan's nested-project, repeated real-3B, full-LSP, debugger and
  broad-runtime gates are still open.
- Offline coding plugins are **proven for the current scope**: the production
  smoke passed 10 packs / 12 tools with parser, formatting, web-quality,
  enable/disable, validation and workspace-boundary checks. This is not a
  debugger or VSIX extension-host claim.
- Provider/runtime is **partial but verified for the tested surface**:
  provider/identity tests passed 19/19, full regression passed 29 files / 269
  tests, lint/build passed, and deterministic HTTP/SSE plus offline-plugin
  smokes passed outside the sandbox. No real credential or provider account was
  used.
- Website acceptance is **open for model-origin quality**. The deterministic
  WxPTxO AURA fixture passes its fake-DOM smoke, but the preserved rFqZuM
  model-origin fixture fails the verifier with nine concrete issues: six
  missing DOM contracts (`search-input`, `category-select`, `cart-list`,
  `subtotal`, `.add-to-cart-btn`, `.remove-from-cart-btn`), weak/placeholder
  HTML content, and missing focus styling. The one bounded Qwen continuation
  produced no `repair-report.json` and no accepted origin result.
- Cursor parity is **not complete**. Full semantic LSP, debugger/debug-adapter,
  VSIX/extension host, large-repository refactoring, real browser visual QA and
  repeated model-origin multi-file acceptance remain unproven.

## Failure audit and final rerun — October 20, 2026

Every recorded failure was classified instead of being silently discarded:

| Failure observed | Classification | Final disposition |
| --- | --- | --- |
| 21 Vitest suites reported `ENOENT` for deleted sandbox SSR temp modules | Environment / sandbox | No source change or weakened test. The unrestricted rerun passed 29/29 files and 269/269 tests. |
| HTTP/SSE and offline-plugin smokes could not reach their spawned localhost server inside the sandbox | Environment / loopback policy | No source change. Escalated local reruns passed both production smokes. |
| Custom provider setup could fail before key persistence when `crypto.randomUUID()` was unavailable, and renderer state could forget the just-saved key | Actionable UI defect | Fixed with browser-safe profile IDs, post-key settings publication and explicit non-submit buttons; focused regression coverage passes. |
| Earlier model-origin AURA output had missing DOM contracts, placeholder HTML, null-element runtime behavior and missing focus styling | Model output / acceptance fixture | Deterministic WxPTxO fixture is repaired and passes; the failure is retained as evidence and is not counted as a Qwen pass. |
| Preserved rFqZuM Qwen fixture still fails nine verifier checks | Model-origin limitation | Not hand-reclassified. One bounded continuation produced no repair report; missing DOM contracts, weak/placeholder HTML and focus styling remain recorded. |
| One bounded Qwen high-end continuation produced no transition before safe termination | Model/runtime limitation | Classified as timeout/no accepted origin result. No additional origin probe was launched. |
| Historical 3B async/helper-reuse probe failures | Model-quality observations | Retained as historical evidence; prompt/tool/retest hardening followed, but they do not become passes retroactively. |

Final rerun results after the provider and reliability fixes:

- Focused provider identity, Universal adapter and Ollama warm-up tests:
  **3 files / 24 tests passed**.
- Full Vitest regression: **29 files / 269 tests passed**.
- TypeScript lint: **passed**.
- Production UI/server/Electron build: **passed**.
- Deterministic AURA fake-DOM behavior: **all checks passed**.
- Existing AURA verifier: **allOk: true, failures: []** for the repaired
  WxPTxO fixture.
- Production HTTP/SSE repair smoke: **passed**.
- Offline production smoke: **passed — 10 packs / 12 tools**.

The remaining model-origin and Cursor-parity limitations are external or
unproven capabilities, not hidden test failures. They remain open in the
acceptance matrix.

## Provider preset checkpoint — October 20, 2026

- Added a secret-free preset registry shared by Quick Connect and Settings.
  `NVIDIA NIM` resolves to OpenAI Chat Completions at
  `https://integrate.api.nvidia.com/v1` with default model
  `meta/llama-3.1-8b-instruct`; `DeepSeek` resolves to
  `https://api.deepseek.com` with default model `deepseek-flash`. Both use
  bearer `Authorization`. The model and endpoint remain editable.
- Selecting a preset only updates local form state. No network call occurs
  until Save & Connect/Test. Keys remain password-masked in the UI and are
  persisted only through the existing Windows DPAPI route; the preset registry
  contains no secrets. Custom OpenAI-compatible connections remain supported.
- Added focused coverage for preset resolution, endpoint normalization,
  server-side default application without network I/O, masked display hints,
  exact NVIDIA URL/auth/model payload mapping, and HTTP 401 failure reporting.
- After this change: focused provider/preset/Ollama tests passed **4 files / 30
  tests**; full regression passed **30 files / 275 tests**; lint and production
  build passed; HTTP/SSE and offline-plugin smokes passed; AURA fake-DOM and
  existing-project verifier both passed with `allOk: true`.
- The provider smoke contract passed **14/14** outside the sandbox, including
  OpenAI-compatible, Anthropic, Gemini, Responses, offline blocking, scoped
  credentials, no-redirect behavior and settings persistence. Its first
  sandbox attempt failed because the temp settings folder was not writable;
  the unrestricted rerun passed without changing assertions.
- Provider-specific limits remain: the selected account must have access to the
  exact model, the endpoint must implement the selected OpenAI-compatible
  schema/tool behavior, NVIDIA hosted NIM access may require an NVIDIA API key
  and entitlement, and DeepSeek model availability/limits can change. NUVRO AI
  does not make a real provider request until the user explicitly connects.

## Shared provider rate-limit checkpoint — October 20, 2026

- Universal/Grok-compatible requests now retry transient `429`, `502`, `503`,
  `504` and `529` responses at most twice. Delay is bounded to 1,000ms then
  2,000ms; numeric or HTTP-date `Retry-After` values are honored but clamped
  to the same 1–2 second safety window.
- Exhaustion now reports a specific quota/rate-limit error for `429` and a
  retry-counted HTTP error for other transient statuses. `401` and other
  non-retryable responses are not delayed or replayed. External cancellation
  interrupts the retry wait.
- Focused Universal tests cover delay/backoff, capped `Retry-After`, retry
  exhaustion, non-retryable errors and cancellation. The focused provider,
  preset, identity and Ollama suite passed **4 files / 34 tests**; the full
  suite passed **30 files / 279 tests**. Universal smoke passed **14/14**;
  lint, production build, HTTP/SSE, offline-plugin and AURA behavior smokes
  passed. No live provider request or secret was used.

## Two-hour API-first bug and acceptance matrix — October 20, 2026

This focused pass reviewed the shared provider path, agent retry behavior,
provider setup, extension/plugin execution, UI/runtime error reporting and
the production end-to-end contracts. It records fixes and evidence gaps; it
is not a Cursor-parity claim.

| Area | Bug/risk reviewed | Current result | Evidence / remaining gate |
| --- | --- | --- | --- |
| Provider setup | Custom profiles could fail before persistence without `crypto.randomUUID`; saved-key state could go stale; common providers lacked guided defaults | **Fixed** | Browser-safe profile IDs, post-key renderer state, NVIDIA NIM/DeepSeek presets; `test:universal` passed 14/14. Live credentials were not used. |
| Request/retry | 429/502/503/504/529 failures could disconnect after one attempt; 413 payload failures were misreported as credentials/credits errors; agent retry could compound adapter-owned quota retries | **Fixed for tested path** | Adapter retries transient responses at most twice with 1s/2s bounded waits; a 413 trims older history/tool context once, never retries unchanged, and preserves system/latest user content. Agent outer replay stops for rate-limit errors. Universal focused run passed 25 tests; full regression passed 30 files / 283 tests. |
| Tool/plugin execution | Text-emitted tool calls, malformed arguments, offline boundaries and HTTP extension behavior could silently fail or execute unsafe work | **Verified for current scope** | HTTP/SSE smoke passed; offline production smoke passed 10 packs / 12 tools, including parser, validation, enable/disable and workspace-boundary checks. Broad malformed-call measurements across every installed model remain open. |
| UI/runtime | Provider/plugin catalog failures were reviewed for silent failure; build/runtime contracts needed a clean post-change check | **Build and core runtime verified** | TypeScript lint and production UI/server/Electron build passed; website fake-DOM smoke passed all 7 checks. Full browser visual QA and complete debugger/LSP UX remain open. |
| End-to-end coding | File routing, multi-file writeback, validation and repair must be proven beyond chat text | **Deterministic path verified; model-origin open** | HTTP/SSE repair flow passed with a deterministic provider and actual failing Node assertion → targeted edit → passing retest. The preserved Qwen 2.5 Coder 3B run still has no accepted origin result. |
| Cursor-level capability | Semantic LSP, debugger, extension host, large-repo refactors and repeated high-quality model-origin work | **Open** | These are capability gates, not hidden test failures. No claim of Cursor parity is made. |

### Focused-window verification

- Full Vitest regression: **30 files / 283 tests passed** in the unrestricted
  local rerun. The sandbox attempt again failed with 22 Windows SSR-temp
  `ENOENT` load errors; it passed 8 files / 32 tests before that environment
  failure, so those errors remain classified as sandbox infrastructure.
- TypeScript lint: **passed**.
- Production build: **passed** — Vite 1,728 modules plus server/Electron
  bundles.
- Universal provider unit run: **25 tests passed**, including HTTP 413
  classification, reduction order, preservation of system/latest user content
  and no-unchanged-retry behavior.
- Universal provider smoke: **14/14 passed**.
- Production HTTP/SSE repair smoke: **passed**.
- Offline plugin smoke: **passed — 10 packs / 12 tools**.
- Website behavior smoke: **all 7 deterministic static/fake-DOM checks passed**
  with no static issues. This is not a real browser visual-regression result.
- No live provider request, API key, or external secret was used. The prior
  bounded Qwen model-origin probe remains a timeout/no-accepted-result and is
  not counted as a pass.

## Provider route error-propagation checkpoint — October 20, 2026

- Fixed a concrete UI diagnosis bug in the OpenAI, Grok, Groq and Universal
  connection-test routes. Adapter errors were previously replaced by generic
  “connection failed” text, or the OpenAI route failed to recognize the new
  retry-counted status format. The routes now use one secret-free classifier.
- HTTP status, bounded retry context and the actionable 413 context-limit
  message are preserved; timeout/network and empty-response failures receive
  specific guidance. Unknown upstream text is never echoed to the renderer.
- Focused provider-error plus Universal tests passed **2 files / 28 tests**.
  Full regression passed **31 files / 286 tests**. TypeScript lint and the
  production UI/server/Electron build passed. Website behavior passed all 7
  deterministic checks; HTTP/SSE repair passed; Universal smoke passed 14/14.
- No live provider key, request or external secret was used. Real account/model
  access, latency, rate limits and Qwen model-origin quality remain unproven.

## Preview and focused-file routing checkpoint — October 20, 2026

- Added a reliable local Preview lifecycle: safe HTML-entry validation, isolated
  loopback start/status/stop sessions, idempotent starts, startup/port errors,
  protected asset checks, Retry Preview, Stop/Start and Back to code actions.
  The existing live-refresh behavior remains bounded at **2 seconds**, while
  status polling is **1.5 seconds** and stops when the session is stopped or
  unmounted.
- Preview now rejects missing linked browser assets before launch with an
  actionable 422 response, and the dedicated preview server continues to
  protect `.env`, source-control metadata and other disallowed files. Focused
  Preview session and website workflow tests passed **34 tests** across 3
  files; the real HTTP smoke also passed Preview start, ready status, stop,
  stopped status and missing-script rejection.
- Fixed a small-model routing regression in focused one-file prompts: the
  compact writer prompt now always retains the original user request even
  when a generic website-layout hint is selected from the current workspace.
  The real mock-Qwen run then wrote the calculator's three files to disk and
  produced a valid project report; no chat-only completion was accepted.
- Final verification evidence for this checkpoint: full Vitest regression
  **32 files / 289 tests passed**; backend HTTP E2E **all checks passed**;
  website behavior **7/7** deterministic static/fake-DOM checks passed;
  offline plugin smoke **10 packs / 12 tools** passed; verification HTTP
  repair smoke passed; TypeScript lint passed; production Vite/server/Electron
  build passed (1,728 UI modules). The website smoke reports no static issues
  and passes runtime bootstrap/interactions, but it is not a substitute for
  real browser visual QA.
- No live provider key/request was used. Qwen 2.5 Coder 3B model-origin quality,
  full Cursor parity, real browser visual regression, debugger/LSP breadth and
  large-repository repeated refactors remain open gates.

## November 5, 2026 — current-source mode-lock and package verification

The renderer had a concrete Chat-mode bypass: the saved-task Resume action changed the request's mode to Agent. Fixed that path and added guards so Chat mode cannot apply an old patch, roll back workspace files, or approve a pending terminal/workspace action. Switching to Chat during an active Agent request now asks the server to stop and aborts the current request.

Verification after the fix: TypeScript lint passed; Chat/Agent UI contract passed 30 checks; intent-router suite passed 10 tests; full regression passed 53 files / 511 tests; production build passed. A fresh portable Windows package passed static/release-artifact checks and packaged runtime debugger acceptance (root rebind, LSP, completion, breakpoint, step and stop). Package unsigned; signing credentials were not configured. No live Ollama/provider model run or Cursor comparison is claimed. The 2 GiB free-RAM floor remains in place for live Ollama runs. The Nov 12 objective is a usable MVP; full Cursor parity is not promised.


## 2026-11-05 live-model benchmark preflight

The installed local models are present, including Qwen 2.5 Coder 1.5B and 3B. No model inference was started: free RAM was 1.31 GiB, below the 1.5B model's calculated floor (about 2 GiB). The preflight contract itself passed 2/2 tests, confirming a constrained run records a resumable pause and does not load Ollama. The one-time Ollama metadata command caused a brief startup/resource spike that settled after it exited; no model was loaded. Re-run live coding cases only after the resource gate permits it.

