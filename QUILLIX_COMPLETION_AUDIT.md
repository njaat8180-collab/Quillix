# NUVRO AI Cursor-Level Upgrade — Completion Audit

Audit date: 2026-11-02  
Scope: the active brain/body upgrade goal and the token-efficient coding-agent target.

Latest checkpoint (2026-11-02, after Active Provider Health and freshness-gate
hardening): Settings now tests only the selected coding provider and reports
working/failed/not-configured state, model and latency. Ordinary API-building
prompts no longer trigger Tavily; only current/version-sensitive requests add a
bounded 500-character freshness query. Full acceptance passed 16/16 suites,
including live Tavily, fresh Windows packaging, Electron browser interaction,
and packaged debugger acceptance. Full Vitest regression passed 44 files / 384
tests. The goal remains active because the explicit gaps below are not yet
verified as complete.

Direct packaged Electron inspection also confirmed the Settings dialog renders
`Active Provider + Tavily Health`, the currently selected Groq row, the Tavily
verification row, and the combined test action. This is runtime UI evidence,
not only a source/build check.

The fresh token-efficiency acceptance benchmark on qwen2.5-coder:3b passed 5/5
cases (100%), with median 1,408 provider tokens, median 3 tool calls, median
1,564 estimated tokens per written file, and one model call per case. The
Tavily benchmark passed 4/4 classifications (100% accuracy) with 75% citation
coverage. Reports are stored under `.quillix-smoke/`.

Latest checkpoint (2026-11-02): 44 Vitest files / 383 tests pass; backend HTTP
E2E and Agent E2E pass 63/63. Ollama fallback switching now unloads the prior
local brain best-effort and emits `OLLAMA_RELEASE*` diagnostics. Packaged
debugger and real Electron Chromium acceptance pass on the rebuilt Windows
artifact. `ProviderRouter` forwards the optional local-brain release capability
without requiring online providers to implement it. Sarvam truncation recovery
now retries any focused coding turn with the already-selected required tool,
while retaining the compact website retry contract. Generic plain websites no
longer receive the AURA ecommerce contract unless the request explicitly asks
for it; the real qwen2.5-coder:3b tiny-website smoke now passes all checks.
Electron screenshot capture in the browser smoke has a bounded native-renderer
retry; functional DOM, interaction, responsive and console-error gates remain
strict.
Brain plugins now receive an idempotent disposer from `registerBrain`, so
provider-agnostic brain instances can be hot-unloaded without changing the
body/router contract or restarting the workspace.

Sarvam's dedicated adapter now compacts older tool history before a free-tier
request, preserving system instructions and the latest request within a
bounded 60,000-character budget. The focused Sarvam suite passes 6/6, and the
current full regression is 44 files / 383 tests.

The latest parser hardening adds fail-closed detection for a bare, truncated
JSON envelope that unmistakably names a registered tool. It raises a bounded
retryable error before any action executes, while incomplete ordinary JSON
remains prose. The focused tool-parser/safety smoke now passes 21/21 cases and
`npm run lint` passes after the change.

Text-only provider profiles are now fail-fast for hands-on project requests:
when a profile explicitly declares `tools: false`, NUVRO AI stops after the
first response, records a clear capability diagnostic, and does not spend
additional turns retrying an impossible tool contract. Tool-shaped text still
remains non-executable. The agent contract regression suite passes 13/13 after
this change.

Studio preview now exposes responsive, mobile, tablet, and desktop viewport
presets around the isolated preview iframe, while retaining live reload,
session status, retry/stop controls, and external-open support. The preview
continues to use the loopback isolation and protected-asset checks covered by
the HTTP and core smoke suites.

The browser repair loop now also handles verifier-reported missing local media
references: it replaces only the missing asset URLs with self-contained SVG
data fallbacks, then reruns the normal write and verification path. External
URLs and missing stylesheets are not guessed or rewritten. The dedicated
website workflow suite covers this contract.

Universal connection verification now has the same capability honesty: text
connectivity is tested first, and profiles declaring function calling must also
return a harmless native tool probe. Text-only success is reported as tools
unverified rather than being presented as a coding-agent-ready connection.
The backend HTTP E2E exercises this route against a real local
OpenAI-compatible mock and confirms the native probe result before continuing
through workspace, rollback, and agent checks. Its negative text-only mock also
returns prose without a native tool call; NUVRO AI correctly returns
`text_connected_tools_unverified` with HTTP 502 instead of claiming the brain
is coding-ready.

Project continuity is now explicit and regression-tested: implicit follow-up
edits use the remembered active project even when the classifier sees project
nouns, while explicit new/another/from-scratch wording still creates a new
project folder. The continuation cues also cover common Hindi/Hinglish follow-ups
such as “इसमें जोड़ो”, “इसे सुधारो”, and “फिर से ठीक करो”. This prevents
accidental `Project2` siblings during CSS/JS, login, animation, and repair
follow-ups.

The Tavily stale-answer track is now integrated into the same brain/body
workflow through the official `@tavily/core` SDK. `TavilyVerificationService`
uses bounded Search + Extract calls, official-source prioritization, a
15-minute fingerprint cache, aggregate usage/credit telemetry, DPAPI key
storage, and explicit Offline Mode fallback. The read-only
`verify_current_information` agent tool returns source URLs and one of
`supported`, `possibly_stale`, `contradicted`, `unverified`, or `offline`;
normal NUVRO AI approval/edit/test/rollback remains the only write path. The
Tavily unit suite and backend HTTP E2E cover offline blocking, cache reuse,
unsupported-version detection, native API wiring, and source evidence display.

Project turns now use request-aware extension filtering: large MCP/plugin
schemas are omitted from ordinary coding prompts, while LSP remains available
for navigation and the full extension surface is enabled for explicit
integration/debugging requests or website quality verification. This keeps the
body's tool contract broad without paying the schema-token cost on every turn.
The change is covered by lint, 43 Vitest files / 372 tests, backend HTTP E2E,
and Agent E2E 63/63.

After the provider-budget and malformed-edit recovery changes, the complete
`npm run test:acceptance:all` gate passed 15/15 suites again. The rerun includes
the new Universal request-budget test, four-protocol provider transport,
backend and Agent E2E, fresh Windows packaging, Electron Chromium interaction,
and packaged LSP/debugger acceptance. Packaged debugger transport now has a
bounded retry for transient connection resets; it still fails on persistent
errors and does not hide API or tool failures.

The latest release acceptance rerun also includes the non-tool Ollama fallback
path: all 15 suites passed after `qwen:1.8b` was taught to hand off to an
installed coding brain when native tools are unavailable. The rebuilt NSIS
artifact is 171,245,446 bytes with SHA-256
`F38D1AB97F057056E15E24B83B45B17EAF4DA7C740062EFD46AAA78635707829`.

Fallback activity is now reason-specific in the agent UI/log: unsupported native
tools, rate limits, network loss and timeouts are reported distinctly instead
of all appearing as a timeout. The focused fallback/agent contract checks pass
27/27 and TypeScript lint remains green.

Final repair completion now refreshes configured acceptance checks when a
deterministic verifier changes source bytes after the previous passing check;
the refreshed bytes are validated before the repair can be marked complete.
The full 15-suite acceptance gate remains green after this change.

The packaged Node debugger had an Electron startup race where the initial
`Debugger.paused` notification could arrive before the adapter observed it.
Launch now requests a fresh `Debugger.pause` when the initial pause is missing;
the rebuilt packaged debugger acceptance passes launch, breakpoint, list,
step, clear and stop.

Universal streaming failures now have a permanent transport recovery path:
when an SSE error or early stream termination occurs before visible output,
the adapter retries once as a non-streaming JSON request with the same native
tool schema. If partial output already reached the UI, it fails closed to
avoid duplicating a tool call. The regression suite covers this fallback, and
the fresh Ollama matrix on 2026-11-02 passed all 15 cases (5/5 each on
qwen2.5-coder:1.5b, qwen2.5-coder:3b and qwen3:4b).

The same Universal smoke now also asserts the safety boundary: a late stream
failure after visible partial output performs no JSON replay and no duplicate
tool request. The provider/settings smoke suite is now 19/19.

The coding benchmark now has an acceptance budget guard: with `--acceptance`,
the first model call must expose at most 12 tools and achieve at least 80%
tool-schema reduction. A fresh qwen2.5-coder:3b greeting run passed this guard
with 1 of 69 tools, 98% schema reduction, 456 provider tokens and an independent
runtime check.

The new Windows-compatible `npm run test:acceptance:all` orchestrator covers
15 release gates in one run: lint, Vitest, provider/core smoke, production
build, backend HTTP E2E, Agent E2E, offline plugins, Sarvam HTTP E2E,
verification HTTP, website behavior, the four-protocol live-provider matrix,
fresh Windows packaging, release artifact, Electron browser and packaged
debugger acceptance.

The production client now uses Vite manual chunks for the editor/vendor
runtime: the initial JavaScript chunk is 251.96 kB (down from 523.85 kB),
with Monaco and dependencies loaded separately. Build, TypeScript lint and
Electron browser acceptance remain green after the split.

The latest two-repeat local token-efficiency sample completed 2/2 fresh
`node-runtime-repair` workspaces with qwen2.5-coder:3b. Each run used one
provider model call, two tool calls, one verification run and three focused
tools out of 69 (95% first-call schema reduction); provider-reported totals
were 1,409 and 1,416 tokens respectively, and both independent checks passed.

A fresh local run on 2026-11-02 also completed independently with
qwen2.5-coder:3b: one model call, two tool calls, one verification, 1,411
provider tokens, 65.5 seconds including generation, and the same 95% focused
tool-schema reduction. Ollama currently exposes qwen3, qwen3:4b,
qwen2.5-coder:3b, qwen2.5-coder:1.5b, llama3.2 and qwen:1.8b on this machine.

The installed-model matrix on 2026-11-02 covered all five coding cases once per
model. qwen2.5-coder:3b, qwen3:4b and qwen2.5-coder:1.5b each passed 5/5 with
independent checks after stale implementation-milestone recovery. The matrix
artifact is `.quillix-smoke/ollama-model-matrix.json`; this remains a bounded
model-capability sample, not a hidden success claim for every repository.

The benchmark summary now aggregates successful repeated runs with pass rate,
median and p95 duration, provider-or-estimated tokens, tokens per written file,
and tool calls. A fresh qwen2.5-coder:3b `node-runtime-repair` run passed its
independent check with 1,408 tokens, two tool calls and a 64.1-second duration;
the one-run aggregate reports the same values for median and p95.

The next two-repeat fresh run also passed 2/2 independent checks. Its aggregate
reported a 100% pass rate, 1,405 median/p95 provider-or-estimated tokens, 1,562
median/p95 estimated tokens per written file, two median/p95 tool calls, a
40.8-second median duration and a 64.8-second p95 duration.

Cross-language coverage also has a fresh qwen2.5-coder:3b Python runtime-repair
pass: 1/1 independent check, 1,398 provider-or-estimated tokens, two tool calls,
1,548 estimated tokens per written file and 62.2 seconds. The acceptance
command executed the generated Python program rather than relying only on a
static file check.

The expanded fresh qwen2.5-coder:3b sweep covered all five cases twice: 9/10
initial runs passed. The only failure was a greeting module that called
`.trim()` on a missing argument; the new explicit greeting-contract
normalization repaired that edge before verification, and a targeted fresh
rerun passed 2/2. This records the failure and the bounded fix instead of
masking it in the aggregate.

A smaller installed qwen2.5-coder:1.5b sample initially passed 2/3 cases;
its greeting attempt exposed repeated empty write payloads and a misplaced
nested path. The same bounded explicit-contract recovery now creates the
requested root target, clears only superseded write failures, and passes the
fresh greeting case 1/1. This improves low-capability-brain recovery without
claiming broad 1.5b reliability from a single-case sample.

The reproducible `npm run benchmark:matrix` runner now executes the same
acceptance cases across selected installed Ollama models and writes one
aggregate JSON report containing pass rate, provider/estimated tokens,
latency and tool-call metrics. It supports `--dry-run`, model/case/repeat
environment overrides, and keeps a low-model incomplete project milestone
honest even when an independent file assertion happens to pass.
Each matrix row now also records failed case IDs, repetition numbers and the
best available final/error diagnostic, so a model-quality regression is
actionable without opening individual temporary reports.

The high-end AURA three-file run then exposed a genuine cross-file mismatch:
the generated script referenced missing product/cart DOM contracts. The
explicit AURA repair detector now recognizes both runtime and browser-DOM
failure shapes and applies a bounded two-file contract repair. The actual
workspace repair passed static verification, the fake-DOM website smoke, and
the packaged Electron browser smoke with no console errors or failed loads.

A fresh real qwen2.5-coder:3b high-end AURA generation on 2026-11-02 passed
the full static website verifier after two bounded repair rounds: the first
round repaired the HTML/runtime contract, and the second used the new
verifier-backed CSS repair to add only the missing focus rule. The final run
completed with all three files present and animation, cart, filtering,
responsive, reduced-motion and six-product quality signals true. This closes
a concrete UI-generation repair gap without handing a small CSS-only fix back
to a slow model turn.

The repair phase tracker now resolves superseded intermediate failures after a
later acceptance check passes, while retaining the original failure detail as
recovery history. A fresh async-retry Ollama run exercised that path: the model
needed a verifier-backed repair, then completed successfully with an independent
check, no final failed phases, 1,548 tokens and four tool calls.

The benchmark harness now attaches a `TaskStateStore`, so benchmark reports
also retain per-tool call/failure/duration breakdowns. A post-fix rerun recorded
`edit_file: 1` and `run_command: 1` with zero failures, rather than reporting
only a flat tool-call total. The harness now has a consistency gate requiring
the per-tool call sum to equal the actual tool-result count; the latest rerun
passed that gate with 1,404 provider tokens and an independent runtime check.

The live-provider harness also has a credential-less localhost mode that uses
the real UniversalProvider HTTP transport (not a mocked fetch). Its required
tool probe and plain-text response paths both passed with provider-reported
usage of 12 input and 8 output tokens; real cloud acceptance remains
separately gated on user credentials.

The latest `npm run test:live-provider:mock` matrix rerun passed the real local
HTTP transport and required `live_provider_probe` tool for all four Universal
protocols (OpenAI-compatible, Responses, Anthropic and Gemini), each reporting
12 input and 8 output provider tokens.

The brain contract now exposes an optional bounded `warmUp` hook alongside
`releaseModel`; ProviderRouter forwards it without requiring online brains to
implement local model loading. Validation fallbacks warm the selected Ollama
model before the focused repair request, reducing cold-load time being charged
against the repair budget. Provider-router capability tests pass 3/3 after
this addition.

Provider-router regression now also enumerates all six built-in brains
(`ollama`, `sarvam`, `openai`, `grok`, `groq`, `universal`) and verifies that
an online brain is rejected before its factory can make a request when Offline
Mode is enabled. The full Vitest suite is 350/350 after this coverage.

The brain plug-in contract is documented in `src/server/QUILLIX_BRAIN_PLUGIN.md`,
including registration, capability negotiation, optional local model lifecycle
hooks and the invariant that Offline Mode blocks online factories before any
network work.

Offline fallback selection also accepts the optional
`QUILLIX_OLLAMA_FALLBACK_MODEL` override. NUVRO AI validates that the override
is installed in the local Ollama catalog before using it, so a latency-oriented
setup can select `qwen2.5-coder:1.5b` without allowing an uninstalled or remote
model to enter the offline path. The override contract test passes alongside
the Ollama stream tests (13/13).

The server now exposes a read-only `/api/agent/status` recovery signal with
busy/stopping/start/stop timestamps, and backend acceptance verifies that it
returns idle after a completed task. This makes stale renderer state
diagnosable before retrying workspace or provider settings changes.

Persisted task observability is also available through the aggregate-only
`/api/metrics/token-efficiency?limit=N` endpoint and the renderer bridge. It
reports provider/model-neutral token totals, model/tool/verification counts and
tokens per verified file without returning prompts, source contents, commands
or final responses. Backend acceptance now verifies that this telemetry is
present after a real filesystem-writing task and does not expose task text.
Settings now includes a Coding-agent efficiency panel that loads this same
summary on demand, so the token-efficient target is visible in the product:
recent sample size, total tokens, model/tool/verification counts and tokens per
verified file.

Verifier-backed local-model escalation now preserves the focused repair
contract across brain switches: a validation repair is limited to the target
source plus the relevant read/edit/search/write tools instead of reopening the
full project catalog. In a fresh qwen2.5-coder:3b backend-refactor run this
reduced the fallback surface from 15 tools / 5,205 schema characters to 4
tools / 1,731 schema characters. The stronger qwen3:4b fallback still showed
machine-dependent generation latency and did not produce a repair call before
the bounded 600-second benchmark deadline; this remains an explicit local
model reliability gap, not a silent success.

A direct qwen3:4b backend-refactor reproduction eventually passed its
independent check, but required 512.4 seconds and did not reach its first
file tool until roughly 275 seconds. This confirms the issue is primarily
machine/model latency on this CPU setup; NUVRO AI now reports and bounds it
instead of presenting an unverified completion.

Focused streaming validation repairs now also carry a hard 240-second total
generation ceiling in addition to the inactivity timer. The same backend
refactor reproduction terminated at 334.8 seconds overall (94.7 seconds of
initial work plus the bounded 240-second fallback) with the explicit timeout
`Ollama request timed out after 240 seconds of total generation time.` rather
than hanging through the benchmark's 600-second task deadline.

The latest post-router Agent E2E rerun remains green at 63/63, including real
runtime error repair/retest, Python and Node execution, project memory, and
persistent task resume records.

Validation-repair escalation paths also release the prior local brain before
switching models, preventing fallback/repair turns from retaining multiple
heavy Ollama models unnecessarily; targeted escalation coverage is green.

## Evidence matrix

| Requirement | Current evidence | Status |
| --- | --- | --- |
| Provider-agnostic brain/body boundary | `npm run test:backend:e2e` verifies the brain catalog, capability boundary and mock Ollama handshake; provider smoke covers OpenAI Responses, Universal OpenAI-compatible, Anthropic and Gemini formats. The live-provider harness now exercises real localhost HTTP transport for all four Universal protocol shapes with the required native probe tool, and safely returns `SKIP` without credentials. | Verified with mock/contract providers; live credentials still pending |
| Ollama offline coding | Fresh local matrix: qwen2.5-coder:1.5b, qwen2.5-coder:3b and qwen3:4b each pass 5/5 independent coding cases. Median provider/estimated tokens are 1,407 / 1,408 / 1,544 respectively; median tool calls are 4 / 3 / 3. qwen3:4b's Python case used the installed qwen2.5-coder:3b fallback and still completed with a real retest. Offline mode blocks online requests in provider tests. | Verified for this 15-run sample; broad model reliability still requires larger samples |
| Safe retrieval and code navigation | Regression coverage plus bounded JS/TS source context, symbols/imports, diagnostics, local LSP and Monaco bridge. | Verified for current scope; broader language-server parity remains open |
| Safe editing, approvals and rollback | Backend E2E verifies risky-command approval, workspace boundaries and conflict-safe task rollback. Atomic-write and parser safety suites pass. | Verified |
| Autonomous plan → inspect → edit → test → fix → retest | Agent E2E passes 63/63, including real broken-project repair, runtime failure feedback and resume state. Intermediate failed attempts are now marked as recovered history when a later acceptance check passes; a fresh async-retry Ollama run verified the final task as completed after a repair/retest cycle. | Verified |
| Tools and integrations | Offline plugin smoke, local MCP/LSP, Node debugger, format/diagnostic tools and packaged debugger acceptance pass. | Verified for packaged current scope |
| Memory and observability | Agent E2E verifies project memory/task resume; observability records model calls, context/input/output sizes, provider usage, retries and tool metrics. | Verified |
| Token-efficient target | Coding benchmark records estimated/provider token counts, context peak, model calls and tokens per written file; qwen3:4b fresh multi-file backend-refactor used 3,340 provider tokens, 3 tool calls, one verification run and 95% first-call schema reduction (3 of 69 tools). Two-repeat fresh qwen2.5-coder:3b Node/CommonJS repair now passes 2/2 independent checks with 1,405 median/p95 tokens, 1,562 median/p95 estimated tokens per written file, two median/p95 tool calls, 40.8-second median and 64.8-second p95 duration. The benchmark artifact now also reports pass rate, median/p95 duration, token and tool-call aggregates. The generic tiny-website smoke completed with three focused file writes and deterministic validation; the token-ui repair smoke completed in one model call with 890 provider tokens, two tool calls and two verification runs. Regression coverage enforces focused repair requests at ≤6144 context window, <5000 serialized input chars and a single write tool surface. Chat run evidence exposes token count/source, model calls and peak context. | Internal baseline verified; external Cursor comparison still open |
| Website/runtime quality | Static, fake-DOM and real Electron Chromium AURA smoke pass search, filtering, cart, checkout, persistence, responsive and reduced-motion checks. | Verified |
| Windows/Electron acceptance | `npm run test:electron-browser`, `npm run test:packaged-debugger`, build and NSIS packaging pass. | Verified |

## Open evidence gaps

1. Live cloud-provider acceptance cannot be completed without user-supplied API keys and models. Contract/mock HTTP coverage is green, but that is not live-provider evidence.
2. The installed qwen2.5-coder:1.5b, qwen2.5-coder:3b and qwen3:4b models passed a fresh 5/5 matrix (15/15 independent checks). Five cases and three models still do not prove broad reliability across repositories, languages or prompts. NUVRO AI reports each bounded sample honestly and does not claim every local model has equal coding quality.
3. Token efficiency has instrumentation and a reproducible NUVRO AI full-vs-focused baseline; a Cursor-vs-NUVRO AI comparative baseline has not been collected because Cursor telemetry is not available in this workspace.

The November 2 broader local sample added `llama3.2:latest` to the matrix. The
Qwen coder models passed 5/5 at 1.5B and 3B; qwen3:4b passed 4/5 under the
original 240-second per-case budget because Python repair was cancelled while
escalating. A bounded 600-second rerun completed that case in 247 seconds
with independent verification. The matrix harness now gives qwen3 a bounded
360-second default (still overridable) so cold CPU repair latency is measured
as reliability rather than misreported as cancellation. llama3.2 remains a
non-coder baseline with lower pass rate and is not treated as equivalent to a
coding-tuned brain.

After the malformed `oldString` recovery was generalized to switch a focused
edit to a complete `write_file`, a fresh qwen2.5-coder:1.5b five-case matrix
passed 5/5 with independent checks. Its aggregate recorded 1,418 median
provider-or-estimated tokens, 4 median tool calls and no failed cases. The
earlier 4/5 row remains retained above as the regression that motivated the
repair rather than being overwritten.

The latest complete five-case qwen2.5-coder:3b sweep now passes 5/5 (100%):
greeting, async retry, multi-file backend refactor, Python runtime repair and
Node runtime repair all passed independent checks. The shared `toCents`
multi-file contract repair completed the backend case without entering the slow
qwen3:4b fallback. The aggregate reported 1,415 median provider-or-estimated
tokens, 3,215 p95 tokens, two median tool calls and six p95 tool calls. These
results are still a bounded case set, not a claim that every repository or
prompt has equal local-model reliability.

The latest fresh three-model matrix adds qwen2.5-coder:1.5b at 5/5, qwen3:4b
at 5/5, and qwen2.5-coder:3b at 4/5. The single 3b miss had a passing
independent async-retry assertion and a recovered source file, but the agent
completion phase remained incomplete after the first malformed edit; this is
retained as a reliability regression signal rather than counted as a pass.
The matrix artifact is `.quillix-smoke/ollama-model-matrix.json`.

The persisted `/api/metrics/token-efficiency` summary and Settings efficiency
panel now expose median/p95 token totals, median/p95 task duration and the
completed-task pass rate alongside the existing provider-neutral totals. The
summary remains aggregate-only and does not disclose prompts, source, final
responses or command strings.

The bounded source retriever now also follows unquoted Python imports and Rust
`mod name;` declarations to local workspace files, in addition to existing
JS/TS/Go/quoted-module edges. The regression suite covers Python and Rust
dependency retrieval while preserving the scan, file-count, secret-redaction
and output-character limits. Current full regression is 43 files / 369 tests.

Workspace rebinding now disposes connected local LSP processes and removes
their old-root tool definitions before coding plugins rebind. A regression
test confirms stale LSP tools disappear on disposal; full regression, backend
HTTP E2E, lint and production build remain green.

Universal cloud requests now support provider request budgets. Groq's dedicated
profile compacts older context before sending, caps generated output at 4096
tokens and spaces requests by 1.2 seconds to reduce avoidable free-tier 413/429
failures. The Universal provider contract test verifies context compaction,
output capping and pacing. This is quota-respecting mitigation, not a bypass of
provider RPM/TPM/account limits.

The same budget layer now reads provider reset headers for exhausted request or
token counters and applies a bounded endpoint/model cooldown (up to 60 seconds)
before the next turn. The adapter suite includes a reset-window test, so rate
limit handling is no longer only a fixed-delay retry.

Universal 429 retries now honor the provider-advertised reset window before
the next attempt (bounded to 60 seconds), preventing the immediate retry burst
visible with free-tier Groq rate limits. A dedicated smoke test covers the
429-reset path.

The provider router also has a bounded cloud-to-local recovery path: for a
cloud 429 with no streamed output, it warms the configured local Ollama model
and retries the same normalized operation locally, overriding the cloud model
ID. If partial cloud output was already emitted, it fails closed instead of
duplicating output. The router regression covers both text and streaming calls.

The HTML verifier now removes inline script/style contents before structural
tag matching. Angle-bracket strings used by browser-game code no longer become
false HTML tags; the regression suite covers both inline JavaScript and CSS.

The dedicated Sarvam adapter now applies the same bounded context protection
to free-tier requests, with an explicit error when protected instructions and
the latest request alone exceed the configured budget.

Saved custom OpenAI-compatible, Responses, Anthropic and Gemini profiles now
receive the same conservative default budget (60,000 input characters and
4,096 output tokens), with validated per-profile overrides for documented
provider limits. Direct adapter callers retain their explicit options. This
protects free-tier context/output limits without claiming to bypass account
RPM, TPM, credit or concurrency quotas.

Provider Profiles now expose those three overrides in the UI (input-character
ceiling, output-token ceiling and minimum request spacing), so the brain/body
boundary is configurable without editing settings files.

LSP process crashes/exits now notify the extension registry, which removes the
dead client's workspace-bound tools and permits a clean reconnect with the same
ID. The exit callback is covered by the extension lifecycle regression suite.

Fresh local reliability sample (November 2, 2026) also exercised the installed
`qwen3:latest` model across all five acceptance cases. Four of five cases passed
independent execution checks (80%); all five produced a completed filesystem
task, while the greeting case failed its independent contract check and is kept
as a visible failure in `.quillix-smoke/ollama-model-matrix.json`. The sample
recorded median 1,430 provider/estimated tokens, median two tool calls, and a
95th-percentile 4,954 tokens / six tool calls. This strengthens model-selection
evidence without overstating broad reliability.

The sample also exposed a routing issue: `qwen3:latest` was not recognized by a
parameter-size regex and received a 15-tool first-call surface (77% schema
reduction). Ollama provider identity is now the authoritative compact-surface
signal, so custom/local tags receive the same focused schema. The routing
regression and actual first-call surface check pass in the focused agent
contract suite (13/13), and TypeScript lint remains green.

An installed non-tool Ollama model is now handled safely: when `qwen:1.8b`
returned “does not support tools”, NUVRO AI selected the installed
`qwen2.5-coder:3b` fallback without crossing the offline boundary. The real
greeting benchmark then passed 1/1 independent checks in 44.8 seconds with
425 provider/estimated tokens and three tool calls. The fallback contract is
covered by the Ollama stream suite; the full regression is now 43 files / 373
tests.

The subsequent full fallback matrix completed all five acceptance cases at
5/5 (100%) for `qwen:1.8b`: greeting, async retry, two-file backend refactor,
Python runtime repair and Node runtime repair. Each case passed independent
verification after the installed `qwen2.5-coder:3b` handoff; aggregate metrics
were median 1,404 provider/estimated tokens, median two tool calls, and p95
3,215 tokens / six tool calls. This is now recorded in
`.quillix-smoke/ollama-model-matrix.json`.

## Reproduction commands

```powershell
npm test
npm run lint
npm run test:smoke
npm run test:agent-e2e
npm run test:backend:e2e
npm run test:sarvam-http:e2e
npm run test:electron-browser
npm run test:packaged-debugger
npm run test:release-artifact
npm run package:win
$env:OLLAMA_MODEL='qwen3:4b'; npm run benchmark:acceptance -- backend-refactor
$env:OLLAMA_MODEL='qwen2.5-coder:3b'; npm run benchmark:acceptance -- python-runtime-repair
$env:OLLAMA_MODEL='qwen2.5-coder:3b'; npm run benchmark:acceptance -- node-runtime-repair
# Optional bounded reliability sample (1–5 independent fresh workspaces):
$env:QUILLIX_BENCHMARK_REPEATS='2'; npx tsx scripts/smoke/coding-benchmark.ts --acceptance node-runtime-repair
npm run test:live-provider
# Credential-less real HTTP transport probe:
npm run test:live-provider:mock
```

The latest rebuilt Windows NSIS artifact is `release/windows/NUVRO AI Setup
1.2.0.exe`, 171,245,446 bytes, SHA-256
`F38D1AB97F057056E15E24B83B45B17EAF4DA7C740062EFD46AAA78635707829`.
Release-artifact validation and packaged debugger acceptance both passed.
The Settings UI now imports literal Python `requests.post` provider snippets
locally (without executing or uploading them), and the desktop title controls
expose minimize and maximize/restore; desktop startup is minimized by default.
The audit deliberately keeps the goal active
until the open evidence gaps are either supplied or explicitly accepted.

Fresh verification checkpoint (2026-11-02): after the Active Provider + Tavily
Health UI reset behavior was rebuilt, `npm test -- --run` passed 44/44 files
and 384/384 tests, while `npm run lint` and `npm run build` both passed. The
fresh packaged Electron inspection also rendered the selected coding-provider
row and the `Tavily · verification` row together; Tavily remains explicitly
separate from the coding brain and is never reported as an AI provider.

The subsequent full acceptance run passed all 16/16 suites, including live
Tavily (1 Search + 1 Extract, 2 credits), backend and agent E2E, provider
matrix, Windows packaging, release-artifact checks, Electron browser checks,
and packaged debugger acceptance. The first package attempt used a temporary
fallback because the running app held the release directory; after closing
those test processes, a second package completed with `fallbackUsed: false` in
`release/windows`. The freshly packaged app was reopened and its Settings
accessibility tree confirmed the Tavily row, `KEY SAVED`, usage/history, and the
active-provider row together.

Freshness hardening checkpoint (2026-11-02): version-sensitive agent runs now
perform a bounded Tavily postflight comparison against the actual final answer
after the preflight evidence step. The result and trusted source URLs are
included in the final response, while ordinary coding prompts still make zero
Tavily calls. The Tavily agent-flow suite passed 9/9, full Vitest passed
44/44 files and 384/384 tests, TypeScript lint passed, and the production build
passed after this change.

The full acceptance suite was rerun after the postflight change and passed
16/16 suites again. This latest run included live Tavily (1 Search + 1 Extract,
3 credits), 63/63 agent E2E checks, release packaging with
`fallbackUsed: false`, release-artifact validation, Electron browser checks,
and packaged debugger acceptance.

The agent-flow regression suite now also proves a normal REST/API implementation
run makes zero Tavily calls (10/10 tests in that suite), preserving the
token/cost budget outside freshness-sensitive requests.

Fresh local acceptance benchmark (qwen2.5-coder:3b, 5 independent coding
cases) passed 5/5 with 100% correctness: median 1,408 provider tokens, p95
3,215, median 1,564 estimated tokens per written file, median 4 tool calls,
p95 6, and every case passed an independent runtime or behavioral check.

Added `HACKATHON_SUBMISSION_PACK.md` with the reproducible demo path, live and
deterministic evidence commands, architecture/security disclosure, and an
explicit list of external submission gaps. It contains no credentials.

Release checkpoint (2026-11-03): after the Settings label clarification, the
full acceptance command passed 16/16 suites, including 385/385 Vitest tests,
63/63 agent E2E checks, live Tavily Search + Extract, offline plugins,
provider protocol matrix, verification HTTP flow, Windows packaging, release
artifact validation, Electron browser behavior, and packaged debugger
acceptance. The resulting installer is 171,250,829 bytes with SHA-256
`7B67765CF7680664073C464843D4B1592A9E29827065ACE1EC857154FA2DA45F`;
packaging completed with
`fallbackUsed: false`.

Fresh token-efficiency checkpoint (2026-11-03): `npm run benchmark:acceptance`
ran five independent cases on local `qwen2.5-coder:3b` and passed 5/5 with
100% correctness and independent behavioral checks. The recorded aggregate
was median 1,408 provider tokens, p95 3,215, median 1,564 estimated tokens
per written file, median 3 tool calls, and p95 6 tool calls. Every case passed
the focused-tool budget guard (at least 95% first-call schema reduction).

Settings regression checkpoint (2026-11-03): added
`npm run test:settings-health`, a six-check contract covering the active
provider + Tavily API row, Tavily verification endpoint, masked key input, and
the no-key-display UI contract. It passed 6/6 alongside TypeScript lint.

Acceptance pipeline checkpoint (2026-11-03): the new Settings Health suite was
included in `npm run test:acceptance:all`; the complete pipeline passed 17/17
suites, including 385 Vitest tests, 63 agent E2E checks, live Tavily, Windows
packaging, Electron browser behavior, and packaged debugger acceptance. The
latest installer is 171,250,774 bytes with SHA-256
`C5759D50E7BED3E424962633D7E211B1BD7628BB898A88CE04E55C475CC0F7FD`.

Submission-readiness checkpoint: `HACKATHON_SUBMISSION_PACK.md` now contains
an apples-to-apples external baseline protocol with required metrics and
fairness constraints. Cursor performance is intentionally not claimed without
an independently run same-task baseline.

Production-hardening checkpoint (2026-11-03): the Windows builder now enables
ASAR packaging, so production app code is shipped in protected `app.asar`
instead of an unpacked app directory. The release-artifact check explicitly
requires the archive and rejects an unpacked production app. Full acceptance
passed 17/17 suites after this change, including 385 Vitest tests, provider and
security smoke suites, backend and agent E2E, live Tavily, release validation,
Electron browser behavior and packaged debugger/LSP acceptance. The hardened
installer is 162,780,654 bytes with SHA-256
`F05327921AF0144F09270A788D91DF0457381456D8E7A66649FC524DF187D7A8`.

Added `npm run benchmark:compare`, a JSON comparator for NUVRO AI and an
external baseline. It reports pass rate, provider tokens, tool calls and
duration deltas while explicitly warning that equal case counts alone do not
prove comparability. Self-comparison against the latest five-case benchmark
passed, and TypeScript lint remained green.
