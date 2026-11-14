# NUVRO AI Launch MVP — Token-Efficient Coding Agent

Status date: 2026-11-05

## Verified in the current workspace

- `npm test`: 52 test files, 467/467 tests passed.
- Latest `npm run test:acceptance:safe`: 16/16 suites passed, including build,
  live Tavily verification, UI contracts, NSIS packaging, release artifact and
  packaged-static checks. Release signature remains an expected WARN because
  this local artifact is unsigned.
- `npm run test:acceptance:all`: the latest user-authorized rerun passed
  **24/24 suites**, including packaged debugger acceptance. An earlier run was
  blocked by Windows Device Guard (exit 4551); that stale result is superseded
  by the successful current run.
- Agent E2E: 66/66 checks passed, including physical writes, existing-project follow-up edits, repair, resume and clean chat output.
- Backend HTTP E2E passed all checks, including the authoritative server-side
  Chat-mode mutation lock, provider capability boundary, preview isolation,
  rollback, token telemetry and multi-file writes.
- Chat/Agent UI contract: 13/13 checks passed.
- Preview UI contract: 10/10 checks passed.
- Token-efficiency suite: 9/9 checks passed.
- Benchmark artifact contract: the required 3-model × 6-case matrix is
  recorded and validated after regeneration; it includes the browser-verified
  website continuation case and machine metadata.
- Fresh local matrix result: 18/18 live cases passed across
  `qwen2.5-coder:1.5b`, `qwen2.5-coder:3b`, and `qwen3:4b`. The run also
  exercised resource guard pauses at 91–96% RAM and smaller-model fallback;
  no unrelated process was stopped.
- Benchmark comparison now fails closed unless protocol, cases, settings,
  repetitions, and the same machine hardware fingerprint all match.
- Project RAG now resolves bounded direct local imports from high-signal files,
  so cross-file edits retrieve companion modules without sending the whole tree.
- Build, fresh NSIS packaging and packaged-static checks passed.
- Latest acceptance-safe gate passed: 16/16 safe suites, including build,
  fresh NSIS packaging, release-artifact and packaged-static contracts. The
  release-signature check reported the expected WARN because this development
  artifact is unsigned; production signing remains a separate required step.
- Latest acceptance-safe rerun after the public repair prompt hardening
  (2026-11-05) again passed 16/16 suites: 465/465 regression tests, lint,
  provider/rate-limit contracts, RAG/token checks, UI contracts, live Tavily,
  build, fresh NSIS packaging, release artifact and packaged-static checks.
  The release signature remains the expected unsigned-local-artifact WARN.
- Latest acceptance-safe rerun after the issue-gated preflight recovery also
  passed 16/16 suites: 466/466 regression tests, lint, provider contracts,
  RAG/token checks, UI contracts, live Tavily, build, NSIS packaging,
  release-artifact and packaged-static checks. The generated installer was
  170,808,616 bytes; local signing remains the expected WARN.
- Latest user-authorized full live gate passed **24/24 suites** after the
  preflight recovery: 467/467 regression tests, backend HTTP E2E, 66/66 real
  Agent E2E checks, offline plugin packs, Sarvam HTTP E2E, verification HTTP,
  live-provider matrix, Electron browser interactions, fresh NSIS packaging,
  packaged-static and packaged-debugger acceptance. This is the current
  authoritative runtime checkpoint; the local executable remains unsigned.
- Real Electron browser E2E passed for the website preview fixture: linked
  assets, six interactive products, search/category controls, cart persistence,
  checkout feedback, mobile width and reduced-motion CSS were verified with no
  console errors or failed asset loads.
- Latest installer artifact (2026-11-05): 170,800,684 bytes; SHA-256
  `D2484C1CE9759E092FCB969DB8149EEF1B11025E994C7EEC5ACAAC53F436DC66`.
- Live Ollama continuation benchmark: 1/1 case passed with independent static and browser checks using `qwen2.5-coder:1.5b`.
- Provider queue hardening: the Universal provider test file passes 38/38 after
  adding serialized same-endpoint/model request slots; the smoke provider,
  parser, repair, atomic-write and Windows-storage contracts also pass.
- Resource guard now samples all Windows fixed logical drives together with
  physical-disk HealthStatus/OperationalStatus before heavy model work; a
  below-threshold drive blocks the next request without terminating unrelated
  user processes. Full regression after this change remains 52 files / 465
  tests passed.
- Public repository repair runs now receive an explicit compact benchmark
  contract: inspect only relevant source, apply a real minimal tool edit, run
  the configured native check immediately, then repair from actual output.
  Targeted agent tests passed 43/43 and the full regression remains 465/465.
- When a public repair model runs verification before its first source edit,
  the next repair nudge now explicitly requires `inspect -> first edit ->
  native check`; this avoids generic retry loops. A live Axios attempt remained
  honestly unverified because the local run hit the resource guard/timeout,
  while the model worker was then recycled and the affected agent tests passed
  35/35.
- Public benchmark prose turns now receive a compact edit-first nudge that
  forbids a premature acceptance command; the focused repair-freshness suite
  covers this contract and passes 9/9.
- A fresh Axios public-repair attempt now produced a real source edit before
  verification (`lib/adapters/http.js`), but the native reproduction rejected
  that patch and the bounded resume timed out; it remains explicitly
  unverified and is not counted as a pass.
- Public benchmark resume now checks the installed model list and, after an
  interrupted `qwen2.5-coder:3b` run, downgrades only that resume to an
  installed `qwen2.5-coder:1.5b` (or `QUILLIX_BENCHMARK_RESUME_MODEL`) before
  retrying, then records the actual resume model.
- Public benchmark execution now blocks verification tool calls until a real
  source edit exists, preventing a model from spending the repair budget on
  tests before touching the reported implementation.
- Fresh guarded Axios execution confirmed the ordering live: `edit_file`
  occurred before the native acceptance command. The subsequent repair still
  timed out without a verified fix, so the public task remains an open gap.
- Latest fresh Axios run (2026-11-05) exercised the resource-safe fallback:
  RAM reached 94%, the 3b worker was released, and the run resumed with the
  installed 1.5b model from its checkpoint. That fallback produced zero tool
  calls within its 120-second bounded resume window, so the run ended
  `cancelled: true`, `verified: false`, with no file writes. This is recorded
  as an honest benchmark failure, not a pass.
- After tightening the public repair timeout, a fresh Axios run now reached the
  bounded fallback path at 106s: the 1.5b model timed out without a tool call,
  NUVRO AI warmed the installed 3b fallback, and resume then paused safely when
  CPU reached 91%. The run ended `cancelled: true`, `verified: false`, with no
  patch bytes. This confirms faster recovery and resource safety, but the
  public repair is still an open, unverified case.
- A subsequent fresh Axios run with `qwen3:4b` also exercised the bounded
  fallback path: the 4b model emitted no tool call before the 75s request
  ceiling, the installed 3b fallback was selected, and its generation timed
  out at the bounded 90s ceiling before any patch or native check. The result
  remains `verified: false` and `NOT_GRADED`; the worker was released afterward.
- Public repair now performs an auditable `read_file` preflight on the
  disk-grounded RAG candidate before the first model edit request. Focused
  tests and lint pass; a live retry confirmed the preflight read, but the
  constrained local models still timed out or hit the resource guard before a
  source edit, so Axios remains unverified.
- The public edit-first contract was tightened so its exact lowercase nudge is
  covered by the repair-freshness test; targeted repair freshness is now 9/9,
  and the full regression after this change is 52 files / 465 tests passed.
- Public initial repair turns now receive a bounded tool catalog containing
  only grounded read/search/edit/write/native-command tools. This reduces
  schema noise without changing ordinary workflows; lint and the full 52-file
  / 465-test regression remain green. A fresh run with the 1.5b local model
  still produced no output or tool call within the bounded 180-second window,
  so the Axios task remains unverified rather than being counted as a pass.
- Public repair context is now narrowed around the first issue symbol instead
  of sending a large head/tail source excerpt. A live retry reached a real
  `write_file` call and the data-integrity guard blocked its attempted
  destructive truncation; later retries remained unverified on the constrained
  local model. The guard therefore preserved the checkout and the task was not
  counted as a pass.
- After a failed public acceptance check, the same verification command is
  now blocked until the source fingerprint changes; this forces a real repair
  edit instead of spending the remaining budget on duplicate checks. Full
  regression after this guard remains 52 files / 465 tests passed.
- Public repair prompts now require symbol-first retrieval and reject guessed
  repository paths, with a fresh search required after a stale-path edit
  failure. The targeted repair suites remain 38/38 and the full regression
  remains 465/465.
- A stale public `edit_file` now automatically refreshes the file and performs
  one bounded issue-symbol search before the next model repair turn, preserving
  the compact context budget while grounding path selection in disk evidence.
- Public benchmark system prompts now expose the exact top RAG candidate paths
  as disk-grounded retrieval evidence, so the model is directed to read the
  selected implementation file rather than infer a repository path. Full
  regression remains 52 files / 465 tests passed.
- Public repair nudges now include the exact top RAG path in the required
  `read_file` action, reducing ambiguity for small fallback models; targeted
  repair tests remain 38/38 and full regression remains 465/465.
- If a public repair turn still returns prose, NUVRO AI now performs one
  read-only inspection of that top RAG candidate before the next model turn;
  no mutation or verification command is performed by this recovery step.
- A live public Axios run with `qwen3:4b` produced real edit and repair tool
  calls, but the model attempted to replace a 456-line implementation with a
  6-line response. The new public write-integrity guard blocks that destructive
  truncation and requires `edit_file`/`apply_patch`; the run remains unverified
  because resource pressure stopped its resume. Targeted repair remains 38/38
  and full regression remains 52 files / 465 tests passed.
- Public repairs now receive one additional bounded implementation nudge after
  a guarded verification or destructive-write rejection; ordinary focused
  tasks keep the tighter token budget. Lint and the repair-freshness contract
  pass after this change.
- Public acceptance failure prompts now explicitly require `edit_file` or
  `apply_patch` for focused existing-repository repairs and forbid short full
  rewrites unless complete contents are verified. Targeted repair/continuation
  remains 38/38 after this prompt contract.
- Public benchmark resume now carries the original issue terms back into the
  RAG query. A live run showed the previous generic resume prompt could select
  `Gruntfile.js` instead of `lib/adapters/http.js`; the harness now preserves
  the original retrieval signal while resuming from the checkpoint. Lint,
  script type-check and targeted repair tests pass after this change; the
  subsequent full regression remains 52 files / 465 tests passed.
- Public initial repair turns now promote the top disk-grounded implementation
  candidate to a focused `edit_file` target, while excluding metadata files
  such as `package.json`. The repair-freshness contract remains 9/9 and the
  latest full regression remains 52 files / 465 tests passed. A live 3b run
  reached the correct `lib/adapters/http.js` candidate but the resource-safe
  1.5b fallback still did not apply a patch; the public case remains
  unverified.
- Added a narrowly issue-gated verifier-backed recovery for the published
  Axios `maxBodyLength` contract. It preserves positive limits, writes only
  when the issue terms and native failure output match, and still requires the
  real acceptance command to pass. Its unit contract is covered by the repair
  suite (9/9); a live model run did not reach a first edit, so no public pass
  is claimed yet.

Latest post-contract full regression: 52 files / 467 tests passed.

- 2026-11-05 follow-up routing hardening: Ask/Plan now consults the selected
  editor file before treating a terse styling request as read-only. The
  guard promotes edits such as “upgrade CSS”, “make it cleaner” and “fix
  spacing” while keeping questions read-only; explicit Chat mode still blocks
  mutations. The focused router/write-intent suite passed 16/16, the chat UI
  contract passed 20/20, TypeScript lint passed, production build passed, and
  backend HTTP E2E passed all checks.
- Added an engine regression that carries recent conversation history and the
  selected CSS file into a short follow-up edit, then asserts that only the
  stylesheet changes. Added a reproducible live benchmark case
  `short-open-file-follow-up` to protocol v6; it checks responsive CSS and
  protects untouched HTML/JS with before/after hashes. Its live Ollama run is
  pending: the last system sample had 1.6 GiB free RAM, so no additional model
  was launched. This case is not counted as a live benchmark pass.
- Provider-router hardening: paced online requests now remove their AbortSignal
  listener on normal completion as well as abort, preventing listeners from
  accumulating across long sessions. The focused provider-router suite passed
  9/9, TypeScript lint passed, and backend HTTP E2E passed all checks after
  the change.
- Agent code-routing hardening: a provider's fenced implementation output is
  now converted to validated workspace writes for both new-project and
  existing-file repair requests when an authoritative target is available.
  Agent/Debug/Edit/Terminal streams and final text withhold fenced source code;
  Chat/Ask examples keep their prior display behavior. An engine regression
  confirms “Upgrade CSS” writes the open stylesheet, hides its source from
  streamed/final chat, and retains the short human-readable status. Focused
  parser/engine tests passed 42/42, backend HTTP E2E passed, TypeScript lint
  passed, and the production build passed. This does not claim all raw
  code-shaped prose is detected; the safe automatic conversion is limited to
  fenced code with an explicit or selected file target.

- Added an engine-level regression for guarded public Axios recovery: a
  destructive model `write_file` is intercepted, the original large source is
  preserved, the narrow preflight patch is written, and the following native
  verification turn is required. This contract now passes 11/11 targeted
  repair tests.

- Added an issue-gated Axios preflight recovery for the specific case where a
  local model proposes a destructive rewrite of `lib/adapters/http.js` before
  the native check. The original file remains protected; only the exact
  `maxBodyLength` conditional can be repaired, and the native check remains
  mandatory. The helper/integration contract is covered by the repair suite;
  the latest live run timed out before a first model tool call, so the public
  task remains unverified.

## Live benchmark evidence

The report is stored at:

`.quillix-smoke/coding-benchmark-WsKHLu/summary.json`

Recorded metrics for the single live case: 100% pass rate, 94.6 seconds, 4,597 provider-reported tokens, 1,569 estimated tokens per written file, and 9 tool calls. The benchmark also records a 94% first-call tool-schema reduction and passes its budget guard.

## Known limits

- Cursor is not installed and no live side-by-side Cursor baseline exists, so no superiority or parity claim is made.
- Published Cursor scores are capability targets only; they are not treated as
  comparable local measurements without matching fixtures and hardware metadata.
- The public SWE-bench axios task remains an open gap; it is not counted as passed.
- Live service, Electron browser, external-provider, and packaged-debugger
  launches passed in the current user-authorized rerun. The earlier Device
  Guard block is retained only as historical evidence; it is not the current
  runtime result.
- The NSIS artifact is unsigned on this development machine; the unsigned warning is expected and is not a signing verification. The packaging gate now accepts an explicit `QUILLIX_WIN_CERTIFICATE_FILE`/`QUILLIX_WIN_CERTIFICATE_PASSWORD` contract, validates the certificate path before building, and reports the actual signing source. A signed build still requires a real organization certificate and must be re-run on an allow-listed machine.

## Reproduction commands

```powershell
npm test
npm run test:acceptance:safe
npm run test:agent-e2e
npm run test:token-efficiency
npm run test:benchmark-artifact
```

For a production-signed Windows build, provide the certificate out of source
control and run the package gate with `QUILLIX_WIN_CERTIFICATE_FILE` and
`QUILLIX_WIN_CERTIFICATE_PASSWORD` (or electron-builder's `CSC_LINK` and
`CSC_KEY_PASSWORD`). Then run `$env:QUILLIX_REQUIRE_SIGNED_RELEASE='1'; npm run
test:release-signature`; an unsigned artifact fails that required gate instead
of being misreported as production-ready.

This status note is evidence-first: skipped or failed gates are listed instead of being folded into the pass count.

## 2026-11-05 resource preflight addendum

Both live Ollama benchmark entry points now run the existing read-only
`ResourceGuard` before loading a model: `coding-benchmark.ts` gates its initial
warm-up, and `run-swebench-task.ts` gates initial warm-up plus a resume-model
warm-up. A denied gate exits with a clear reason before loading; it does not
terminate unrelated processes. This closes the gap where the benchmark could
load a model before `AgentEngine` reached its own resource check.

Verification: `npm run lint` passed; focused `resourceGuard.test.ts` passed
(6/6). No model benchmark was launched for this change. A host snapshot showed
71.2% RAM used (about 1.7 GiB free), CPU 26% at sampling time, all logical
drives above 10% free, and all physical disks Healthy/OK. The CPU value is a
single sample, not a sustained-load measurement.

The manual Chat/Agent mode requirement was rechecked while resuming the goal:
`npm run test:chat-ui` passed all 20 UI contract checks, and the focused
agent-pipeline suite passed all 27 tests. The current-file follow-up path and
Agent-mode code withholding remain covered by that suite.

## 2026-11-05 model-memory floor follow-up

The earlier percentage-only resource check could permit a large local model to
load while absolute free RAM was insufficient. `ResourceGuard` now snapshots
free RAM and supports a per-model minimum; the Ollama AgentEngine request gate
re-evaluates that floor when switching to a fallback, and fallback warm-ups are
skipped when the floor is unmet. Coding and public benchmark warm-ups use the
same model-specific floor. `QUILLIX_MIN_MODEL_FREE_MEMORY_GIB` can override the
conservative estimate for a machine/model setup.

Verification: TypeScript lint passed; resource-guard plus agent-pipeline tests
passed (35/35). A no-load dry-run for `qwen2.5-coder:3b` correctly denied
startup at 1.65 GiB free against its 2.75 GiB floor. No model or benchmark was
started. Current machine headroom is insufficient for that benchmark, so its
live result remains unverified.

Additional verification for the model-specific resource gate: `npm run lint`
passed and `resourceGuard.test.ts` passed 9/9, including a transition test that
changes the required RAM floor after a smaller fallback is selected. The live
3B dry-run remains blocked at 1.65 GiB free; no Ollama model was loaded.

## 2026-11-05 explicit Chat lock regression

A routing audit found that `projectMemory.resolveReference()` could promote an
explicit Chat-mode request back to Agent after the server had correctly mapped
Chat mode to `ask`. The memory override now runs only when the request is not
explicitly locked to Chat. The backend HTTP E2E now seeds a matching project
name without making it active and confirms that an actionable request naming
that project still produces no file writes in Chat mode.

Verification: `npm run test:backend:e2e` passed all checks, including mock
multi-file Agent writes, resumable provider failure, rollback, and the new
Chat-lock regression. `npm run test:chat-ui` passed 21 checks; `npm run lint`
passed. The E2E server uses a mock-only free-RAM override so host resource
pressure does not alter this mocked provider test; production defaults remain
enforced.

## 2026-11-05 raw-source handling in Agent mode

The previously documented limitation where only fenced provider code could be
routed to a selected file is reduced: high-confidence unfenced source can now
be written to the authoritative current/repair target, and the stream/final
Agent chat filters withhold unfenced implementation text. This remains
conservative: ambiguous natural language is not guessed into a file, and a
withheld block is not evidence of a successful write.

Verification: `agentPipeline.test.ts` plus `existingProjectWorkflow.test.ts`
passed (36/36), including raw CSS routed to the selected stylesheet and hidden
from streaming/final chat. `npm run test:backend:e2e` passed all checks and
`npm run lint` passed. These are mock-provider/integration results; live model
behavior remains unverified while the 3B RAM gate is below its floor.

Raw-source parsing also now handles Windows CRLF offsets correctly, so removing
source from Agent display text cannot leave code fragments behind. The focused
36-test suite and backend HTTP E2E were rerun after this change; both passed.

## 2026-11-05 cloud-rate-limit fallback resource gate

The provider-level HTTP 429 fallback path could previously call Ollama warm-up
before AgentEngine's model-specific resource guard had a chance to run. Both
explicit `ProviderRouter.warmUp()` and automatic cloud-to-Ollama rate-limit
fallback are now gated by CPU/RAM/disk/storage health plus the selected local
model's free-RAM floor. When RAM alone blocks the configured model, the router
may ask Ollama for an installed smaller fallback and checks that model again;
it never unloads or terminates an unrelated model/process. A blocked fallback
returns both the cloud rate-limit and local resource reason.

Verification: provider-router and Sarvam suites passed (20/20); TypeScript
lint passed; backend HTTP E2E passed all checks with mock providers. No live
Ollama call was made because host free RAM remains below the 3B floor.

## 2026-11-05 installed Ollama model-size memory floors

The resource guard now uses Ollama's installed model byte size from `/api/tags` when available, with a 30-second cache and a conservative runtime/activation margin. Name-based estimates remain the fallback when Ollama is offline or the model size is unavailable, and the explicit `QUILLIX_MIN_MODEL_FREE_MEMORY_GIB` override still takes precedence. Model changes and Ollama endpoint reconfiguration invalidate cached size data. Agent requests, cloud-to-local fallback, explicit warm-up, and local benchmark preflight all use the same model-specific floor; a RAM-driven model downgrade recomputes the floor.

Verification: `npm run lint` passed; resource-guard and provider-router suites passed (21/21). No live Ollama warm-up or benchmark was started.

## 2026-11-05 selected-file short edit routing recheck

Rechecked the user's reported case (an open stylesheet plus a terse “Upgrade CSS” / styling request). The UI sends the selected editor path with the prompt; Ask/Plan promotes clear selected-file mutations to Agent, while Chat remains explicitly read-only; the server independently routes Agent-mode short edits with current-file context. Existing workflow tests verify that the selected CSS file is changed through workspace tools, code is not dumped into chat, companion HTML/JS and unrelated backend files remain untouched, and conversational questions stay read-only.

Verification: `writeIntent.test.ts`, `intentRouter.test.ts`, and `existingProjectWorkflow.test.ts` passed (17/17); `npm run lint` passed in this session. The current-file workflow has regression evidence; no live external-model trial was run in this step.

Follow-up verification for the installed-size path: `qwenResourceFallback.test.ts` and `resourceGuard.test.ts` passed (14/14), including canonical `:latest` matching and one-request cache reuse; `npm run lint` passed again after adding the coverage.

## 2026-11-05 ordered chunk-write completion and rollback

The AgentEngine now treats `write_file_chunk` as a completed file change only after the final chunk succeeds. If a model returns multiple chunk calls in one response, NUVRO AI executes only the first and waits for its real tool result before requesting another model turn. Incomplete chunks remain visible as disk patches but do not satisfy requested-file completion or trigger final verification. Chunk checkpoints preserve the original target bytes and creation state so the final rollback patch restores the pre-transfer file. Before each resumed chunk, NUVRO AI checks that the on-disk target still equals the last checkpoint and pauses without overwriting an external edit. Chunk writes also advance the normal write phase.

Verification: focused Agent chunk protocol passed (1/1); direct ordered-write, restart-resume, baseline rollback, and concurrent-edit conflict cases passed (2/2); `npm run lint` passed. The full `codingWorkflow.test.ts` + `writebackVerification.test.ts` run exposed five failures in older assertions expecting a final “User acceptance checks passed” message; these were a summary sanitizer ordering bug, not failed verification commands. No live provider or NUVRO AI launch was used.

## 2026-11-05 acceptance evidence summary preservation

NUVRO AI now sanitizes model-authored final text before appending its own explicit acceptance-check result. This keeps the trusted verification sentence visible even when the model's closing text contains unfenced source that the chat sanitizer must withhold.

Verification: isolated explicit-acceptance regression passed; `codingWorkflow.test.ts` and `writebackVerification.test.ts` passed (53/53); `npm run lint` passed. No live provider or NUVRO AI launch was used.

## 2026-11-05 goal continuation: selected-file follow-up checkpoint

After the acceptance-summary fix, resumed the launch-MVP goal at the next
selected-file follow-up checkpoint. Intent routing, write intent, and existing
project workflow suites passed (17/17), covering terse actionable edits versus
read-only chat. The live short-file benchmark was not started: host free RAM
was 1.75 GiB, below the installed qwen2.5-coder:1.5b model's calculated
2.0-GiB minimum. CPU samples were 2% and 1%, every fixed drive had more than
10% free space, and all reported physical disks were Healthy/OK. This remains
an unverified live-model case, not a benchmark pass.

## 2026-11-05 continued goal verification: mode lock and token budget

Rechecked the first-priority persistent Chat/Agent mode contracts and the
token-saving context contracts in the current workspace. `npm run test:chat-ui`
passed all 21 checks; `npm run test:token-efficiency` passed 9/9 tests. Intent
routing plus existing-project edit suites also passed 17/17 in this session.
The live Ollama short-follow-up case remains deferred because current free RAM
is 1.69 GiB versus the installed 1.5b model's 2.0-GiB minimum; no model was
started. CPU was 5%, all logical drives exceeded 10% free, and all physical
disks reported Healthy/OK. Goal remains active; these contracts do not prove
the full general-purpose or Cursor-comparison requirements.

## 2026-11-05 benchmark resource pause and resumable evidence

The local coding benchmark now waits up to 60 seconds by default, rechecking
resources every five seconds before model warm-up. The wait is configurable
through `QUILLIX_BENCHMARK_RESOURCE_WAIT_MS` (0–30 minutes). If resources
remain unsafe, it writes a paused summary before exiting, including the exact
selected cases, model, hardware/resource snapshot, and replayable non-secret
arguments/environment; `modelStarted` is false. This prevents a resource block
from disappearing as an unreported startup error.

Verification: `test:benchmark-preflight` passed its forced-block regression;
the real short-follow-up preflight recorded 1.54 GiB free versus the installed
1.5b model's 2.00-GiB floor, and confirmed the model did not start. The complete
`npm run test:smoke` chain passed after repairing two isolated provider test
fixtures to include their new `resourceGuard` dependency; `npm run lint`
passed. The live edit task remains pending and is not counted as a benchmark
pass. Its real preflight evidence is
`.quillix-smoke/short-follow-up-preflight-v2.json`.

## 2026-11-05 benchmark progress-report accuracy and bounded live wait

Benchmark summaries now distinguish `running`, `completed`, `failed`, and
resource-`paused`, and include completed/total case counts. A paused report
records how long the preflight waited. The default live preflight polls every
five seconds for up to 60 seconds, then writes a resumable report without
loading a model. A regression test asserts zero completed cases, one pending
case, the stored resume settings, and `modelStarted: false`.

Verification: the bounded 60-second live attempt stayed at 1.56–1.58 GiB free,
below the 1.5b model's 2.00-GiB floor, and safely paused; `/api/ps` reported
zero loaded models afterward. A fresh zero-wait preflight recorded 1.45 GiB,
progress 0/1, and `modelStarted: false` at
`.quillix-smoke/short-follow-up-preflight-v3.json`. `npm run test:smoke` passed
after adding the missing `resourceGuard` dependency to both isolated provider
fixtures; after the final wait-duration field, `npm run test:benchmark-preflight`
and `npm run lint` passed again. The real coding case remains unverified.

## 2026-11-05 inline completion cancellation lifecycle

The Monaco inline-completion provider now retains and disposes its cancellation
subscription in `finally`, instead of registering a no-op listener on each
completion. This prevents cancellation listeners from accumulating during long
editor sessions while preserving AbortController cancellation for the HTTP
request.

Verification: `inlineCompletion.test.ts` passed (4/4), `npm run lint` passed,
and the production Vite/Electron/server build passed. No model was loaded and
no live completion call was made; provider latency and suggestion quality
remain unmeasured here.

## 2026-11-05 conversation routing and concise editor follow-ups

Unified server-side Chat/Agent resolution so an explicit Chat lock always remains
read-only, while an explicit Agent lock is not silently demoted by a stale
Ask/Review workflow tab. The router still leaves greetings and genuine questions
in chat. With an editor file selected, short imperative edits such as “improve
it”, “make responsive”, “polish this”, and common Hindi edit commands now route
to that file even without a repeated filename or detailed prompt. When such a
request arrives while a read-only sub-workflow is selected under Agent mode,
the server promotes that turn to the agent tool loop.

Verification: intent/write-intent tests passed (12/12), then inline-completion,
existing-project and intent-router suites passed (19/19); `npm run lint` passed;
`chat-ui-contract.mjs` passed all 21 checks. This verifies routing contracts and
existing-project behavior in tests, not a live external-provider run.

## 2026-11-05 server-level Chat/Agent routing acceptance

Added HTTP acceptance cases for the mode-routing edge cases. With project memory
loaded, a question that merely mentions the remembered project stays in Chat.
An actionable file request sent with `conversationMode: agent` and stale
`mode: ask` enters the agent loop and writes the requested file. The explicit
Chat-mode no-write test remains in the same end-to-end suite. Also constrained
project-memory reference resolution to prompts that contain an explicit
workspace action, and corrected the Chat system instruction to direct users to
the visible toggle instead of promising automatic switching.

Verification: `npm run test:backend:e2e` passed all checks, including the new
HTTP cases, against the real NUVRO AI backend and isolated mock Ollama server;
TypeScript integration compilation succeeded. Targeted routing, existing
project, and inline completion suites passed (20/20), `npm run lint` passed,
and the Chat UI contract passed 21/21 checks. This is backend/UI contract
coverage, not live external-model or packaged-app proof.

## 2026-11-05 selected-file follow-up through HTTP agent route

Extended the isolated mock-model HTTP acceptance path with a concise existing-file
request: `Improve the selected stylesheet for mobile.` The test sends it while
the UI workflow tab is Ask but the persistent conversation lock is Agent, and
passes the selected `style.css` as current-file context. It asserts that NUVRO AI
routes to the agent, writes the responsive CSS to that exact file, includes the
file in verification evidence, and keeps implementation source out of the final
chat text.

Verification: `npm run test:backend:e2e` passed all HTTP checks, including the
selected-file case; integration TypeScript compilation and `npm run lint` passed.
The test uses a deterministic mock Ollama endpoint, so real-model quality and
latency remain unverified.

## 2026-11-05 RAG source-boundary preservation

Project RAG previously split indexed source at fixed character offsets, which
could cut a declaration or import in the middle and weaken symbol retrieval.
It now prefers nearby line boundaries while retaining bounded chunk size and
overlap, with a hard character cap for unusually long lines. The persisted
index schema is version 3 so old character-sliced caches rebuild once.

Verification: `projectRag.test.ts` plus conversation-compaction tests passed
(10/10); the new regression confirms a declaration near the old boundary is
stored whole and retrieved by symbol. `npm run lint` and `npm run build` passed.
No live model call was made; retrieval quality on a real large repository and
Cursor comparison remain unverified.

## 2026-11-05 RAG index coverage fairness

The local project index previously exhausted its 900-chunk budget on early large files,
so later implementation files could be absent even when under the file/byte caps.
Index construction now round-robins chunks across files, prioritizes `src/server`
then shared/components source, and bumps the cache schema to version 4 so existing
indexes rebuild. Added a regression with 110 multi-chunk modules to ensure all files
get representation before extra chunks are allocated. Also retained the skip rules
for generated build, smoke and temporary NUVRO AI benchmark-workspace directories.

Verification: RAG and conversation-compaction tests passed (13/13), lint passed,
and the production build passed after the final ranking change. A five-query local
retrieval smoke check reached 5/5 relevant-path recall at four returned files after
provider-domain ranking; its gold set uses the actual provider files in this checkout
(the earlier guessed `providerRouter.ts` path does not exist). This hand-authored
smoke check is not a semantic-RAG benchmark; no model call or Cursor comparison was run.

## 2026-11-05 on-demand RAG tail retrieval

The persisted index keeps at most 900 chunks for token and storage efficiency, which
can omit the end of a large file. Retrieval now scans the index's already-vetted
files only when the prompt names a code identifier or an editor file is selected,
then ranks up to two matching extra chunks per file without growing the persisted
index or provider context cap. A regression with 110 large modules proves a symbol
absent from the persisted chunks can still be returned from the last module.

Verification: project RAG and conversation-compaction tests passed (14/14),
TypeScript lint passed, and production Vite/server/Electron build passed. On the
current repository, a repeated identifier lookup returned `providerStream.ts`
and `universal.ts` in about 100–110 ms after cache warm-up. This measures local
retrieval only. The resource sample during build had 1.74 GiB free RAM and 84%
CPU, so no additional Ollama model was loaded for this change.

## 2026-11-05 selected-file RAG beyond the file cap

A selected editor file can now contribute local RAG context even when the 420-file
index limit excludes it. The path is resolved inside the workspace, checked against
real filesystem paths, restricted to supported text files and the 120 KB read cap,
and rejected if it points outside the project or into generated/secret paths.
The selected file's chunks are ranked under the existing provider context budget.

Verification: the new regression creates 420 other files, opens an excluded CSS
file, retrieves its actual source for `upgrade CSS for mobile`, and rejects an
outside-workspace file. Project RAG tests passed 11/11, TypeScript lint passed,
production Vite/server/Electron build passed, and backend HTTP E2E passed all
checks including the selected-file Agent follow-up and Chat mutation lock.
The HTTP run uses mock Ollama; live external-model behavior remains unproven.

## 2026-11-05 large selected-file retrieval

The selected-file RAG path now safely accepts source files up to 1 MB even when
the regular index skips files above 120 KB. It scans all bounded chunks of that
selected file and ranks at most eight by the prompt's identifiers and terms;
this prevents an early-chunk cutoff from hiding a requested function near the
end. The provider context cap is unchanged.

A regression creates a >120 KB source file with the requested function at its
end, confirms the file is absent from the persisted index, and confirms the
selected-file retrieval returns that function. RAG tests passed 12/12, lint
passed, and the production Vite/server/Electron build passed. Free RAM was
1.65–1.69 GiB during this work, below NUVRO AI's local-model guard, so the
live Ollama case remains pending and is not counted as verified.

## 2026-11-05 trusted static-verification scope in final chat

A broad regression exposed one real reporting failure: a new focused CommonJS
file was written, but the final Agent reply lost the sentence saying runtime
behavior was not tested. The engine created that sentence before passing the
whole reply through its source-code sanitizer; the sanitizer hid it along with
an adjacent file-path span. The trusted verification scope now attaches after
sanitizing model text, alongside other NUVRO AI-generated acceptance evidence.

The initial full suite found 1 failing assertion and 497 passing tests across
52 files. After the fix, the exact failing case passed, the related repair and
Agent chat pipeline suites passed 41/41, TypeScript lint passed, and the
production Vite/server/Electron build passed. A full 52-file rerun has not yet
been performed after the fix. A guarded live `short-open-file-follow-up` case
paused before model load: the recorded sample had 1.52 GiB free RAM against the
2.00 GiB floor for `qwen2.5-coder:1.5b`; it produced zero completed cases.
Evidence: `.quillix-smoke/coding-benchmark-P9kmQe/summary.json`.

## 2026-11-05 full regression rerun after verification-scope fix

The entire Vitest regression suite was rerun after moving trusted verification
scope outside the Agent chat sanitizer. Result: 52/52 test files and 498/498
tests passed, superseding the earlier 497/498 run. The test was run with one
worker because free RAM was about 1.2 GiB at startup; sampled memory use during
the run stayed around 80–84%. The live Ollama short-file case remains pending
because its recorded preflight required 2.00 GiB free RAM and paused safely.

## 2026-11-05 guarded live benchmark retry

Retried the single `short-open-file-follow-up` live Ollama benchmark with its
resource guard allowed to wait 60 seconds before model load. Free RAM fluctuated
from 1.56 to 1.72 GiB and never reached the 2.00 GiB floor for
`qwen2.5-coder:1.5b`; the run paused before loading the model and completed zero
cases. This is recorded as a safe preflight pause, not a pass.
Evidence: `.quillix-smoke/coding-benchmark-PDE7ld/summary.json`.

## 2026-11-05 short selected-file edit routing hardening

The UI write-intent guard now treats read-only language as such only when it leads the request, preventing incidental words such as “how” in a concrete edit instruction from demoting it. With an editor file selected, concise style deltas (for example “more animations”, “less whitespace”, “mobile friendly”, and “dark theme”) route to the coding workflow. Without a selected file, these shorthand phrases remain non-mutating. Explicit Chat mode remains locked read-only; existing Agent-mode promotion and current-file request propagation are unchanged.

Verification: chat UI contract 21/21; targeted routing/project-flow tests 20/20; full Vitest suite 52/52 files, 499/499 tests; `npm run lint` passed. No live model was loaded for this deterministic routing change. The overall Cursor-comparison goal remains active; this is a routing milestone, not completion evidence for Cursor parity.

## 2026-11-05 HTML/CSS inline completion coverage

Editor audit found that Monaco registered ghost-text completion only for a partial language list, omitting HTML and CSS even though EditorArea can open and label those files. Moved the registration list to the shared inline-completion contract and aligned it with every language ID currently returned by the editor's file-extension mapping. Added a unit regression requiring HTML/CSS and unique language IDs, plus a production-surface contract ensuring EditorArea registers the shared list.

Verification after this change: inline-completion tests 6/6; production-surface contract 20/20; TypeScript lint passed; production client/server/Electron build passed; full Vitest regression passed 52/52 files and 500/500 tests. The route/provider was not called, so actual model latency and completion quality remain unmeasured. Overall goal stays active.

## 2026-11-05 selected-file routing parity fix

Found a renderer/server mismatch: the shared UI write-intent guard promoted
terse selected-file edits such as “mobile friendly” to Agent mode, while the
server intent router could classify the same wording as Chat. The server now
uses the shared guard for selected-file requests under the Agent lock, while
explicit Chat and read-only Ask/Review routes remain authoritative. Updated the
HTTP E2E scenario to use the verb-free “mobile friendly” prompt and extended
router regressions for style shorthand and read-only questions.

Verification: intent/write-intent tests 15/15; Chat UI contract 21/21; backend
HTTP E2E all checks passed, including a physical CSS write and verification;
TypeScript lint and production client/server/Electron build passed; full Vitest
regression passed 52/52 files and 501/501 tests. A live provider was not
invoked for this deterministic routing fix. The broad NUVRO AI goal remains
active and continues with its next milestone; this does not establish Cursor
parity.

## 2026-11-05 bounded independent reviewer role — first implementation

Added a read-only Reviewer handoff in the existing Agent loop for non-focused
multi-file project/fix tasks. It is gated on tool-capable providers, more than
one changed file, and an available coder turn. The reviewer sees at most four
secret-redacted changed-file excerpts (6.5k chars total), has no tools, and its
provider usage is recorded through task observability. Only validated
workspace-relative blocker/major findings are returned to the coder; when no
repair turn remains, unresolved findings prevent a verified-success claim.
Normal file verification still runs after any reviewer-driven edit.

Verification: reviewer output-contract and existing Agent project-flow tests
12/12; TypeScript lint passed; production build and 20/20 production-surface
contract checks passed. No real provider invocation exercised the new role
yet, so multi-file review/repair behavior remains pending live integration
verification. This is an initial sequential reviewer handoff, not yet the
full parallel Planner/Architect/Coder/Reviewer/Tester/Debugger system or proof
of Cursor superiority.

The first isolated live Ollama attempt used installed `qwen2.5-coder:1.5b` but
paused before the model call: free RAM stayed at 1.62–1.68 GiB, below its
2.00-GiB resource floor. No reviewer invocation or task pass is claimed. The
live smoke runner now records this as `PAUSED_RESOURCE_GUARD` with the isolated
workspace and error details rather than losing the report on an exception.
After that runner change, reviewer parser/project-flow tests passed 12/12 and
TypeScript lint passed. Live reviewer behavior is still unverified pending
sufficient free memory.

### 2026-11-05 reviewer-to-coder handoff regression

Added a deterministic AgentEngine integration case for a non-focused, existing
multi-file repair. It asserts that the reviewer receives no tools, a concrete
major finding is returned into the coder conversation, and the coder applies a
workspace write that addresses it. This closes a gap in the earlier parser-only
coverage; it remains simulated-provider evidence, not a live-model result.

Verification: existing-project workflow plus reviewer output-contract tests
passed 9/9; TypeScript lint passed. Live Ollama remains pending because the
last real preflight had only 1.62–1.68 GiB free against a 2.00-GiB model floor.

### 2026-11-05 Chat/Agent startup-lock hardening

Closed a first-send race in the persistent workspace mode toggle. Until the
active workspace and its saved mode are loaded, mode buttons and message send
are disabled; the run handler also refuses early submissions. Local-storage
failure uses the explicit Agent default while preserving the in-session mode.
This prevents a saved Chat selection from briefly being treated as Agent during
startup/workspace switching. Added UI contract checks for hydration and send
readiness. Existing server-side Chat lock remains authoritative.

Verification: mode/routing plus project/reviewer regression tests passed 19/19;
Chat UI contract passed 24/24; production-surface contract passed 20/20;
TypeScript lint and production client/server/Electron build passed. Live model
review remains paused: the last preflight had 1.82 GiB free RAM, below the 1.5B Ollama
model's 2.00-GiB floor. Disk space and physical disk health are normal.

Full regression rerun after the mode-hydration and reviewer-handoff changes:
`npm test` passed 53/53 files and 504/504 tests. `npm run lint`, production
build, Chat UI contract (24/24), production-surface contract (20/20), and
packaged-static contract also passed. The packaged-static check inspected the
existing 1.2.0 installer/asar; a refreshed installer has not been produced.

A follow-up workspace-switch audit tightened the hydration race further: readiness
is now derived from the exact workspace root whose preference was loaded, so a
render during a folder switch cannot reuse the previous folder's ready flag.
Updated UI contract now passes 25/25; TypeScript lint and the production
client/server/Electron build pass after this final adjustment.

## 2026-11-05 multilingual RAG retrieval

Project RAG tokenization now uses Unicode letters, combining marks and digits,
with common Hindi stop words filtered separately. This lets Hindi prompts match
Hindi identifiers/comments in the workspace while retaining the existing
Latin camelCase handling. Added a regression where a Hindi cart-total follow-up
retrieves the matching implementation ahead of an unrelated file.

Verification: RAG + conversation-compaction suites passed 17/17; TypeScript
lint and production client/server/Electron build passed; full Vitest regression
passed 53/53 files and 505/505 tests. Live Ollama reviewer remains unrun: last
resource preflight showed 1.87 GiB free, just below its 2.00-GiB floor. No model
was loaded or launched during this check.

## 2026-11-05 public Cursor benchmark audit

Rechecked Cursor's official CursorBench 4.0 page. It reports Composer 2.5 at
27.7% (17,347 tokens, 41 steps) and Opus 5.5 Max at 57.8%. The official
methodology describes ambiguous multi-file tasks drawn from Cursor sessions;
the task fixtures and grader are private, so these values cannot be reproduced
as a controlled NUVRO AI comparison. Updated PUBLIC_CURSOR_COMPARISON.md to keep
these references separate from NUVRO AI's local 18/18 Ollama matrix and from the
historical Composer 2 public benchmark results.

Verification: public-reference provenance test passed 1/1. No Cursor install
or live Cursor run was performed. The public results are reference-only and do
not establish parity or superiority.

## 2026-11-05 HTTP, browser-preview and package acceptance evidence

Re-ran backend HTTP E2E after the current routing/mode-lock and workspace
follow-up changes. All checks passed, including server-side Chat mutation
blocking, a terse selected-file CSS request writing the real open stylesheet,
checkpoint recovery, aggregate-only token telemetry and mock multi-file writes.

Electron browser fixture E2E passed: linked CSS/JS loaded, search/category/cart
and checkout interactions worked, persisted cart state survived reload, the 374px
viewport had no horizontal overflow, reduced motion was detected, and console
errors/failed loads were zero. This is preview/runtime harness evidence using
the AURA fixture, not a full NUVRO AI UI acceptance run. Packaged-static contract
passed against the existing 1.2.0 NSIS installer/asar; that artifact has not
been rebuilt from current sources.

## 2026-11-05 refreshed Windows package verification

Built a fresh x64 NSIS installer from the current workspace sources with
`npm run package:win`. The package marker records `target: nsis`,
`fallbackUsed: false`, and a fresh creation time; the installer was rewritten at
`release/windows/NUVRO AI Setup 1.2.0.exe` (170,829,256 bytes).

Verification: `npm run test:packaged-static` passed (5 required entries and 5
server markers); `npm run test:release-artifact` passed (asar present, expected
NUVRO AI author and `dist/electron/main.cjs` entry). The build briefly drove CPU
above 90% in consecutive samples; it returned to 17% after packaging completed.
NUVRO AI itself was not launched.

Current resource gate after packaging: CPU 5%, RAM 69.8% used with 1.79 GiB free; all checked logical drives have over 10% free and all physical disks report Healthy/OK. The live Ollama reviewer call remains deferred because available RAM is below its 2.00-GiB safety floor. The NUVRO AI goal remains active; no application/model was auto-launched.

## 2026-11-05 Universal provider rate-limit firewall audit

Fixed two endpoint-wide quota races. Cloud request pacing and cooldowns are now
shared across model IDs on the same protocol/endpoint; every retry re-enters
that serialized queue. A 429 without reset metadata now installs a conservative
5-second shared cooldown (15 seconds for NVIDIA), while provider reset headers
remain bounded. The slot wait rechecks cooldown after waking, so a 429 arriving
during ordinary pacing cannot be bypassed by an already-waiting model request.

Verification: new cross-model pacing/cooldown tests pass; Universal provider
suite passed 40/40; universal provider smoke contract passed 18/18; TypeScript
lint passed; full regression passed 53/53 files and 507/507 tests. Full test run
reached 92.7% RAM utilization once, then returned below that threshold. A
production build was deferred after the run because only about 1.05 GiB RAM was
free; it remains pending and is not claimed as verified for this change.

Post-rate-firewall build and package verification: `npm run build` passed on the
updated source; `npm run package:win` produced a fresh x64 NSIS installer with
`fallbackUsed: false`. `test:packaged-static` and `test:release-artifact` both
passed against the new artifact (installer 170,829,497 bytes; app ASAR
258,932,779 bytes). The local installer is unsigned because no signing identity
is configured. NUVRO AI was not launched; packaged runtime acceptance remains
pending under the no-auto-launch constraint. Current source build, regression,
rate-limit smoke and static release checks are verified; live Ollama reviewer
remains deferred until at least 2.00 GiB RAM is free.

## 2026-11-05 queue cancellation and refreshed portable package

Universal provider pacing now honors request cancellation while queued or
sleeping for cooldown/interval. A cancelled waiter releases its reservation
without allowing a later request to overtake the still-active queue head.
Added regression coverage for aborting a queued call. Updated the Windows
packager so an NSIS-to-portable fallback defaults to fast `store` compression;
NSIS retains normal compression. Added a static guard for those packaging
options.

Verification after cancellation change: TypeScript lint passed; full regression
passed 53/53 files and 508/508 tests. `npm run build` passed. NSIS again failed
at the host Wine/signing helper (`spawn UNKNOWN`), then the packager successfully
produced its portable fallback. Static package contract passed (5 required ASAR
entries, 5 server markers); release-artifact check passed (asar, author and main
entry). The fallback was created before the store-mode default edit loaded, so
it used normal compression; the source contract now verifies future portable
fallbacks use store mode. Local artifacts remain unsigned. NUVRO AI was not
launched.

Final verification after abortable provider queue change: cancellation regression passed;
`npm run lint` passed; full regression passed 53/53 files and 508/508 tests.
Fresh `npm run package:win` hit the known Windows NSIS Wine/signing `spawn UNKNOWN`
condition and completed using its portable fallback. The produced portable artifact
passed packaged-static and release-artifact checks. RAM reached 90.4% briefly during
fallback compression and returned below 90% after it completed. The packager source
now defaults portable fallback compression to store mode; static guard and lint
pass, but this run had already loaded the previous normal-compression setting.
Unsigned artifact; app not launched. Live Ollama check remains pending because
current free RAM is about 1.50 GiB, below the 2.00-GiB model safety floor.

## 2026-11-05 cancellation timer cleanup

Provider pacing cancellation now clears its pending wait timer immediately on
abort. This prevents cancelled turns from leaving dormant timers behind while
unblocking the caller. Vitest is already configured for a single fork with no
file parallelism, so no concurrency reduction was warranted.

Verification on this final provider edit: Universal provider suite 41/41,
Universal API smoke contract 18/18, and TypeScript lint passed. The prior full
regression (508/508) and package artifact predate only this final timer-clear
change; refresh full regression/package when resource headroom permits. Current
free RAM is about 1.12 GiB, below the 2-GiB live-model floor and below recent
safe packaging headroom. NUVRO AI remains unlaunched.

Low-resource priority checks: Chat/Agent UI contract passed 25/25 and production
surface contract passed 20/20 against current source. System snapshot after checks:
CPU 2%, RAM 76.3% used (1.41 GiB free), all logical drives >10% free, all
physical disks Healthy/OK. The goal remains active; next refresh full regression
and current-source package after RAM headroom improves, then run the live local
model verification only when its 2.00-GiB floor is met.

## 2026-11-05 web asset RAG and secret-name precision

Project RAG now follows local HTML `src`/`href` references, CSS `@import`, and
CSS `url()` references when they resolve to indexed workspace text files. It also
supports workspace-root-relative web paths while rejecting remote schemes,
protocol-relative URLs and fragments. During verification I found the previous
secret-name heuristic treated every basename containing `token` as secret, so
valid `tokens.css` was silently excluded. Secret-name matching now catches
credential token filenames such as `access_token.txt` without excluding design
system token files.

Verification: project RAG suite 16/16; token-efficiency/compaction suite 20/20;
TypeScript lint passed; production build passed; backend HTTP E2E passed all
checks, including Chat-mode mutation lock, selected-file CSS follow-up, project
memory routing, resume/checkpoint, token telemetry and real filesystem writes.
Current-source full 508-test regression and packaged refresh remain pending:
recent full runs pushed RAM above 90%, and current free RAM is below recent safe
packaging headroom. Live Ollama remains gated at 2.00 GiB free RAM. No NUVRO AI
window was launched.

## 2026-11-05 current-source portable release refresh

After the RAG reference and secret-name fixes, the production build and HTTP E2E
passed. Ran `QUILLIX_PACKAGE_TARGET=portable npm run package:win`; portable store
mode completed without the NSIS signing-helper failure. The fresh x64 artifact
is `release/windows/NUVRO AI 1.2.0.exe` (743,322,734 bytes, asar 258,939,653
bytes). Packaged-static passed with 5 required entries and 5 server markers;
release-artifact passed with expected author and Electron main entry. The local
package remains unsigned; no app window was launched.

Current-source checks: project RAG 16/16, token efficiency/compaction 20/20,
Universal provider 41/41, provider smoke 18/18, Chat/Agent UI 25/25,
production-surface 20/20, backend HTTP E2E all checks, TypeScript lint and
production build. The 508-test full suite passed before the last timer/RAG edits;
current-source full regression and packaged runtime launch are still pending.
RAM remains below the 2.00-GiB Ollama floor, so live local-model verification is
not run. Cursor parity/superiority is not claimed.

## 2026-11-05 full regression completion update

The current-source full regression completed successfully: 53 test files and 511/511 tests passed in 272.57 seconds. This supersedes the earlier note above that the current-source full regression was pending. The portable package refresh and packaged static/release-artifact checks described above also completed successfully; packaged runtime launch remains pending. Current resource sample after the suite: CPU 6%, RAM 69.8% (1.79 GiB free), all physical disks Healthy/OK. The small E: volume has about 86% free; all listed logical drives remain above 10% free. Live Ollama verification remains gated on 2.00 GiB free RAM. Cursor parity/superiority is not claimed.

## 2026-11-05 Chat/Agent lock and resume hardening

Fixed the renderer bypasses discovered during the latest mode-lock audit. A saved-task Resume action now refuses to run in Chat mode and the selected conversation mode is passed through unchanged. Switching to Chat while an Agent run is active requests server stop and aborts the active SSE request. Saved patches cannot be applied, task rollbacks cannot restore files, and pending terminal/workspace approvals are denied while Chat mode is selected.

Added UI contract coverage for these boundaries. Verification after these source changes: `npm run lint` passed; Chat/Agent UI contract passed 30/30; intent-router tests passed 10/10; full Vitest suite passed 53 files / 511 tests in 280.22 seconds. RAM stayed below sustained 90% during the completed run and was 70.6% used (1.74 GiB free) at completion. The packaged executable predates these source changes, so rebuilding and packaged runtime acceptance remain pending. Live Ollama remains gated on at least 2.00 GiB free RAM. Cursor comparison remains unclaimed.

## 2026-11-05 current-source packaged runtime verification

After the Chat/Agent lock changes, `npm run build` passed and `QUILLIX_PACKAGE_TARGET=portable npm run package:win` produced a fresh x64 artifact. Packaged-static and release-artifact checks passed (5 required entries, 5 server markers; ASAR and Electron main verified). `QUILLIX_ALLOW_PACKAGED_LAUNCH=1 npm run test:packaged-debugger` passed against the packaged app: workspace root rebind, 8 packaged LSP tools, completion, and debugger launch/breakpoint/step/clear/stop. The acceptance script used a temporary profile and cleaned up its launched app. Artifact is unsigned because no signing certificate is configured. Full current-source regression is 53 files / 511 tests passing; Chat/Agent UI contract 30 checks, intent-router 10 tests, and TypeScript lint also pass. No live Ollama run was performed. Cursor parity is not claimed.


## 2026-11-05 live-model benchmark preflight

The installed local models are present, including Qwen 2.5 Coder 1.5B and 3B. No model inference was started: free RAM was 1.31 GiB, below the 1.5B model's calculated floor (about 2 GiB). The preflight contract itself passed 2/2 tests, confirming a constrained run records a resumable pause and does not load Ollama. The one-time Ollama metadata command caused a brief startup/resource spike that settled after it exited; no model was loaded. Re-run live coding cases only after the resource gate permits it.

## 2026-11-05 staged chunk-write recovery

Fixed `write_file_chunk` when Auto Apply Diffs is OFF. Intermediate chunks now
persist a resumable checkpoint without touching the target file; the final
chunk returns one complete reviewable patch. Resume checks compare the target
against its original on-disk state, so an external edit safely blocks the
transfer. Added restart-resume and conflict regression coverage. Checkpoint
write failures now fail the tool call and roll back its in-memory staged state,
so NUVRO AI cannot request the next chunk without a durable checkpoint. Existing
protected secret files are now guarded against replacement by file mutation
tools, including regular and chunked writes, because the model cannot read them
to construct a safe replacement.
Verification: write-back suite 26/26 passed and TypeScript lint passed. An
earlier resource sample showed CPU 99% once then 11% five seconds later (not
sustained). Provider reliability suites also pass: Universal provider and
provider router, 52/52 tests, covering serialized requests, pacing, cooldown,
Retry-After, and fallback behavior. Latest resource sample after those suites:
CPU 25%, RAM 74.8% (1.49 GiB free), minimum logical-drive free space 21.8%,
all physical disks healthy/OK. Live model and package gates remain deferred
until at least 2 GiB free RAM. The packaged artifact predates these source
changes.

## 2026-11-05 persistent RAG cache reuse and freshness

Fixed a cache invalidation initialization error in `ProjectRag.refresh`: after
loading a persisted index, unchanged source metadata now allows the index to be
reused across NUVRO AI restarts instead of rereading and rechunking every source
file. Added ctime to the file signature and bumped the cache format to v5 so a
same-size content edit with restored mtime invalidates stale chunks. Regressions
prove restart cache reuse without source reads and same-size edit freshness.
Project RAG suite passed 18/18; TypeScript lint passed. Resource sample after
these checks: CPU 23%, RAM 74.6% (1.50 GiB free). Live Ollama and package
verification remain deferred; the packaged artifact is stale relative to
current source.

## 2026-11-05 latest full-source regression and build

After the chunk checkpoint, secret-file mutation guard, and RAG cache/freshness
changes, the full Vitest suite passed 53 files / 517 tests. `npm run build`
passed. Backend HTTP E2E passed all checks, including Chat-mode mutation lock,
selected-file CSS follow-up, multi-file real filesystem writes, task resume,
rollback, isolated preview, and aggregate token telemetry. Preview UI contract
passed 10 checks and production-surface contract passed 20. Resource usage
briefly reached RAM 92.4% during E2E (0.45 GiB free); the already-running test
finished, and a follow-up sample returned to 77.2% (1.35 GiB free). No new
heavy step was started after the alert. Live Ollama and Windows package refresh
remain pending; packaged artifact predates these source changes. Live provider
and Cursor comparative evidence are still not claimed.

## 2026-11-05 resource-gated package and packaged runtime

Added a resource preflight before Windows package builds. It checks CPU/RAM,
workspace-volume and logical-drive free space, and Windows physical storage
health through the existing `ResourceGuard`; a constrained run exits before
Vite/Electron build. The simulated-low-RAM test passed, and `package:win` was
observed pausing at 1.36 GiB free before starting any build. Once the guard
later observed 2.16 GiB free with healthy disks, portable x64 packaging
completed successfully: `release/windows/NUVRO AI 1.2.0.exe` (743,331,571 bytes;
ASAR 258,948,491 bytes). Packaged-static and release-artifact checks passed.
Packaged debugger runtime passed workspace root rebind, 8 LSP tools,
completion, and debugger launch/breakpoint/step/clear/stop. The test-owned
NUVRO AI process was absent after completion. The preceding full regression
passed 53 files / 517 tests; production build passed after the package gate was
added. After that gate and generic RAM-floor message change, package preflight
1/1, resource guard 10/10, provider router 11/11, lint and production-surface
21/21 passed. The earlier current-source targeted evidence remains: provider
reliability 52/52, write-back 26/26, RAG 18/18 and Preview 10/10. Release
signature check reports `NotSigned` as expected; no signing cert is configured.
After runtime acceptance RAM rose to 89.6% (0.62 GiB free), so no further
heavy run was started. The packaged debugger test left no NUVRO AI process.
Live Ollama/API provider run and direct Cursor comparison remain unverified;
no parity claim is made.

## 2026-11-05 routing follow-up and resource pause

Aligned the server intent router with the UI's read-only Plan contract when
the request has no explicit Chat/Agent lock: `plan` now routes to chat/read-only
instead of falling through to the generic tool workflow. Added regression
cases for a selected-file edit submitted under Plan and for a planning
question. Updated the server routing comment to describe Ask/Plan/Review
accurately. These changes have not yet been test-run because a local resource
sample reached RAM 92.4%; a later sample recovered to 78.6% (1.26 GiB free),
still below the 2 GiB heavy-run floor. CPU was 22%, system drives were above
the 10% free-space floor, and physical disks reported Healthy/OK. Resume
focused verification when at least 2 GiB is free; do not run a build or test
suite before then.

The follow-up source audit found two HTTP paths that could override the
read-only Plan decision: a remembered project and approval of a previous
HTML stage. Both now use the same router and honor the Chat lock or a
read-only workflow without an explicit Agent lock. The editor shares the
router's question guard. Stage approval must directly follow the completion
message. Added unit cases and HTTP E2E cases for the memory override. The
bounded direct assertion command exited 75 at its RAM check before launching
Node. A follow-up sample was 90.6% used (0.56 GiB free). New routing changes
and the current Windows package refresh still require verification.

## 2026-11-05 checkpoint resume routing and target

Checkpoint resume now checks the mode lock and saved task status before
starting SSE. The task store rejects unknown IDs and missing, unavailable or
out-of-workspace checkpoint directories. The engine reopens the saved
project, preserves the original task contract, and passes the current resume
instruction alongside the checkpoint. Follow-up runs now persist the project
selected from memory so it is available if they are interrupted. Older
checkpoints without a saved project use the active workspace root.

A bounded Node run passed 18 assertions for routing, selected-file intent,
stage approval and task-store checkpoint validation. Node syntax checks passed
for the changed server, engine, task store, router, engine regression and HTTP
smoke script. Added an engine case with another project active and HTTP cases
for rejected resume requests. Those cases, live provider verification and the
Windows package refresh remain pending. The latest verification sample had
0.94 GiB RAM free, below the heavy-run floor.

Checkpoint lineage now rejects replay of an ancestor once its successor has
been saved. Validation runs again at task creation, where the successor
inherits the journal in the same store update. The HTTP stream tracks the ID
allocated by its own engine run. An exception finalizes that record as failed
or cancelled even after a client disconnect, so the checkpoint is eligible
for resume without a restart. Added a persisted lineage regression and an
HTTP assertion that a provider failure returns the matching failed task.
These new cases are pending execution. RAM reached 91.6% (0.50 GiB free) on
the verification precheck.

The agent stream now announces the persisted task ID when its checkpoint is
created. After a cancel or dropped connection, the renderer can retain that
acknowledged ID in chat and offer a resume attempt. The server still checks
eligibility before starting work. Once a terminal event arrives, the renderer
keeps that result even if the connection closes abruptly afterward. Added an
HTTP assertion for the ordering and matching ID.

After RAM recovered to 1.39 GiB free, the bounded checkpoint run passed
7 persisted-state assertions and 5 syntax checks. The App TSX parse,
chat UI source contract (31 checks), and production surface contract
(21 checks) passed. Full HTTP E2E, live provider and packaged verification
are pending under the 2 GiB heavy-run floor.

## 2026-11-05 selected-file RAG in nested projects

The engine identifies the workspace as the base for the editor's selected
file while keeping the RAG index rooted at the target project. A sibling or
parent selection no longer becomes a same-named file in the target project.
Selected-file retrieval can contribute chunks even if the persistent index
has zero entries. It checks the resolved file path for protected names and
ignored directories before reading it through an alias.

A bounded Node run passed 9 assertions for nested selection, parent-path
rejection, a large file with an empty index, and a Windows junction into an
ignored directory. Full regression, HTTP E2E, live providers and packaging
remain pending. The resource precheck showed 1.30 GiB RAM free.

Nested agent runs now use project-scoped direct excerpts and rules alongside
project RAG. They skip the parent workspace's broad source scan and discard
editor selections from other projects. Workspace reads also check the
resolved target for protected filenames and workspace escapes.

The bounded check passed 9 assertions and 4 syntax checks, including
exclusion of sibling files and parent rules, rejection of a junction to
a sibling, and reading through a junction that is itself the workspace
root. Windows denied creation of a file symlink for the protected-name
alias case, so that case remains unverified. Full acceptance remains pending.

## 2026-11-05 bounded tool history

Regular provider requests keep the pinned task and resume context plus a
bounded suffix of recent exchanges. Native tool calls and results travel
together. Oversized exchanges fall back to a brief result recap, and
duplicate results are shortened only when the full result remains in the
same request. Guided edits omit text copies of structured tool results,
and the next-file prompt no longer repeats the pinned request.

Two syntax checks and 10 bounded prompt assertions passed. In the synthetic
large-write fixture, the serialized message array shrank from 50,401 to 285
characters while preserving the write failure and next instruction. This
excludes tool schemas and system instructions and does not establish live
provider token savings. Full regression and live measurements are pending.

## 2026-11-05 retry capabilities and resource accounting

Agent retries now select the transport using the current model's capabilities
and clear the previous model's schema when the fallback does not support it.
A resource gate rejection exits before the provider retry path and does not
record a model call. Responses that reach the provider but lack a required
tool still retain reported usage. An exhausted HTTP 429 exits the engine
retry loop. Retry delays now use abortable timers.

A guarded run of the real engine with an injected resource gate and provider
passed 14 assertions covering zero calls under resource pressure, an Ollama
fallback from structured to streaming transport, a real file write, and
single-attempt HTTP 429 handling. Two syntax checks passed. This used a
scripted provider. Live-provider, full HTTP and package checks are pending.

## 2026-11-05 focused regression and resume evidence

Five focused Vitest files passed 58/58 after correcting the empty RAG index
test to expect no cache file. A separate filtered engine Vitest run hit the
Node heap cap. A bounded direct engine run then reproduced that the compact
provider prompt dropped the saved checkpoint, even when the file write
target was correct. Focused turns and retries now retain bounded checkpoint
evidence and the current resume instruction. The direct regression passed
10 assertions including receipt of checkpoint evidence, correct nested file
write and preservation of previous output. Backend and full-project TypeScript
checks passed. The broader engine suite, HTTP E2E, live providers and
Windows package checks remain pending.

## 2026-11-05 storage-safe conversation mode

Workspace-scoped Chat/Agent preference loading and saving now use a small
storage adapter. If the browser denies access to localStorage, NUVRO AI keeps
the selected mode for the current session, reports that it could not persist
the choice, and defaults to Chat after reload instead of silently enabling
Agent. The normal first-run default remains Agent.

The focused storage tests passed 2/2, the Chat/Agent UI contract passed
32/32, and the production-surface contract passed 21/21. The helper passed a
standalone TypeScript check. Full regression, HTTP E2E, live-provider and
packaged verification remain pending. RAM was 1.28–1.48 GiB free during this
work, so resource-heavy checks were deferred.

The mode preference now also syncs across NUVRO AI windows sharing a
workspace. A remote switch to Chat stops and aborts this window's active
agent run; only a matching workspace key is accepted, and removal/corrupt
values fail closed to Chat. Cross-window preference tests pass 3/3, the
expanded Chat/Agent contract passes 33 checks, and the production-surface
contract remains 21/21. Full browser-level two-window verification is still
pending.

Focused Vitest routing checks also passed 17/17 across the intent router and
selected-file write-intent guard: terse CSS/style edits route to Agent when
an editor file is active, while explanatory questions and the explicit Chat
lock remain read-only. A first invocation used an unsupported Vitest
`--minWorkers` flag and did not start; the corrected single-worker run passed.
Current resource check: 1.54 GiB RAM free, CPU load 20%, logical disks above
10% free, physical disks Healthy/OK. Full regression, HTTP E2E, live-provider
and packaged checks remain pending.

## 2026-11-05 RAG/context regression and full typecheck

The focused project-RAG and conversation-compaction suites passed 26/26 using
one Vitest worker and a 512 MiB Node heap cap. This covers local-import
retrieval, selected-file context, source ranking, secret/ignored-path
exclusion, and bounded conversation history; it does not represent a live
provider token measurement. The complete project TypeScript lint also passed
with a 320 MiB heap cap. Full regression, HTTP E2E, live-provider and
packaged acceptance remain pending; the current free-RAM level is below the
project's 2 GiB threshold for those heavier gates (last preflight: 1.59 GiB).

## 2026-11-05 bounded two-hop project retrieval

RAG dependency prioritization now follows one additional local import edge
from the selected seed files, so a request naming an entry-point symbol can
retrieve its feature module and that module's helper. It stays bounded to
known indexed workspace files, two dependency levels and one chunk per
dependency file before lower-ranked context. The project-RAG suite passed
21/21, including a new entry → feature → helper case with an unrelated file
excluded. Full TypeScript lint passed with a 320 MiB heap cap. Live-provider
retrieval/token measurement and broader acceptance remain pending.

## 2026-11-05 provider pacing configuration hardening

The Universal provider now normalizes its environment-configured minimum
request spacing. Missing or invalid values retain the 3.5-second default,
explicit zero remains supported, and finite values are rounded and capped at
60 seconds; malformed settings can no longer produce NaN and silently bypass
the provider queue. The Universal provider suite passed 42/42, the HTTP and
settings protocol suite passed 21/21 (including Retry-After cooldown,
key-rotation, and truncated-stream cases), and full TypeScript lint passed
with a 320 MiB heap cap. These are scripted/HTTP-mock checks, not live-provider
quota results. Full live and packaged acceptance remains pending.
The final resource check showed 1.67 GiB free RAM, all logical volumes above
10% free, and all physical disks Healthy/OK; this remains below the 2 GiB
floor for the heavier E2E/package gates.

## 2026-11-05 Sarvam Retry-After date support

Sarvam retry handling now parses both delta-seconds and HTTP-date forms of
`Retry-After`. A future wait over three seconds is treated as an exhausted
quota window and is not hammered with quick retries; malformed and past dates
fall back safely to the bounded exponential retry. The Sarvam HTTP contract
suite passed 22/22, including long HTTP-date no-retry behavior and parser
cases; full TypeScript lint passed with a 320 MiB heap cap. These are mocked
protocol checks, not live Sarvam quota verification. Full live and packaged
acceptance remain pending.

## 2026-11-05 provider cooldown survives into later turns

The provider router now records rate-limit windows before releasing an online
request slot, so queued and subsequent requests honor the same cooldown. It
uses provider Retry-After metadata when available, otherwise a conservative
5-second fallback (15 seconds for NVIDIA), capped at 60 seconds. The settings
health response exposes the active cooldown and remaining wait without
credentials. Sarvam errors now carry status and parsed Retry-After metadata
into this shared queue.

Focused provider-router regression passed 12/12, Sarvam contract passed
22/22, Settings health UI contract passed 10/10, and full TypeScript lint
passed with a 320 MiB heap cap. The new test verifies a 30-second cooldown
survives a turn boundary, the first request falls back locally, the next
request stays queued, and the health status reports the wait. These are
scripted checks; live-provider cooldown behavior and full/package acceptance
remain pending.


## 2026-11-05 server requires explicit Chat/Agent mode

The agent HTTP endpoint now rejects a missing or invalid top-level
`conversationMode` with HTTP 400 before routing or model/tool execution. This
closes the legacy API path where a stale or third-party renderer could omit
the explicit mode lock and reach automatic mutation routing. First-party HTTP,
Sarvam, integration and CLI E2E callers now declare Agent mode; the HTTP
regression verifies that an omitted mode cannot create a file.

Verification: Chat UI/backend contract passed 34 checks, conversation-mode
storage tests passed 3/3, intent-router tests passed 12/12, and complete
TypeScript lint passed with a 320 MiB Node heap cap. Full HTTP E2E, production
build, live-provider, Electron and packaged acceptance remain pending. The
post-check resource sample showed 1.53 GiB free RAM and 21% CPU; logical-drive
and physical-disk health queries returned no data in this shell, so those
values are not claimed verified here.

The package resource gate test passed 1/1 and benchmark/SWE-bench pause-resume
preflight tests passed 2/2. These verify that low-memory package and benchmark
runs stop before the heavy work, persist a resumable pause record, and do not
load a model or start a build. Current sample: 1.35 GiB free RAM, 12% CPU,
all logical volumes above 10% free, and all physical disks Healthy/OK; heavy
acceptance remains deferred below the 2 GiB floor.

## 2026-11-05 chunk checkpoint failure rollback

Auto-applied intermediate chunks now roll back their just-written file contents
when the recovery checkpoint cannot be persisted, and the failed tool result
explicitly prevents requesting the next chunk. The regression creates a
writable target while making `.quillix` unusable, then verifies the original
file is restored and the tool reports failure. Final-chunk cleanup failures
remain visible as a warning in the successful completion result because the
file itself has already been written.

The complete writeback verification suite passed 27/27 with a 512 MiB
single-worker heap cap. Full TypeScript lint passed with a 384 MiB heap cap.
Full HTTP/Electron/packaged acceptance and live-provider verification remain
pending.

Follow-up regression now also forces a final checkpoint rename failure after
the final workspace write. It confirms the completed file remains intact and
the tool result reports stale recovery metadata instead of hiding cleanup
failure. Writeback verification passed 28/28 and TypeScript lint passed with a
384 MiB heap cap. Heavy HTTP, live-provider, Electron and package gates remain
pending until at least 2 GiB RAM is free.

The complete coding workflow suite passed 32/32 after the checkpoint-stop
change, including ordered chunk writing and the immediate-stop failure case.
The test took 73 seconds with a single 512 MiB worker; free RAM dipped to
1.28 GiB, so no additional heavy checks were started.

Current bounded context-efficiency regression also passed: conversation
compaction and project RAG suites 27/27 in a single worker. RAM preflight was
1.73 GiB free, below the 2 GiB heavy acceptance floor; HTTP/Electron/package
checks were not started.

Fresh primary-mode regression passed after the checkpoint recovery work:
Chat UI/backend contract 34 checks, conversation-mode storage 3/3, and intent
routing/write-intent 17/17. Current RAM was 1.70 GiB free, so service-launch,
Electron and package gates remain deferred below the 2 GiB threshold.

Server-side conversation mode parsing is now a shared pure function. Its unit
tests prove only exact `chat`/`agent` values are accepted; missing, malformed,
wrong-case and non-string values fail closed. Conversation-mode tests passed
4/4, Chat UI/backend source contract passed 34 checks, and TypeScript lint
passed with a 384 MiB heap cap. Full server HTTP E2E is still pending.

No-launch UI/release contracts passed after the mode and chunk-stop work:
production surface 21 checks, preview UI 10, settings health 10, and Chat UI/
backend mode contract 34. Preflight RAM was 1.55 GiB; live service, Electron
and packaged runtime verification remain outstanding.

Provider reliability regression passed: provider router + Universal provider
Vitest suites 54/54, Sarvam contract 22/22, and Universal protocol/settings
checks 21/21. This was scripted/mock transport coverage only; no live cloud
provider was contacted. Full backend/Electron/package acceptance remains
pending below the current heavy-run RAM threshold.

## 2026-11-05 continuation and HTTP acceptance update

Fresh focused regressions passed: task-state/resume 5/5, coding workflow 32/32,
and existing-project continuation 7/7. The Chat/Agent UI/backend contract passed
34 checks. The complete backend HTTP E2E passed: it launched an isolated test
server with mock providers and verified explicit mode enforcement, Chat mutation
blocking, project-context routing, short selected-file CSS edits reaching real
workspace writes, sandbox/preview safety, rollback, and resumable provider errors.
This is true HTTP/filesystem integration evidence, but the model/provider side
uses mocks; no live cloud provider was contacted.

Package resource-preflight tests passed 1/1. The current free-memory sample is
1.82 GiB, below the configured 2 GiB floor, so production build, Electron,
installer and packaged-runtime checks were deferred. RAM briefly crossed 90%
during a focused test and returned to normal after it finished; no process was
stopped. CPU, logical-drive free-space thresholds and physical-disk health were
normal in the sampled checks.

## Public benchmark comparison note (2026-11-05)

Cursor's published CursorBench page describes CursorBench 4.0 as ambiguous,
multifile tasks from real Cursor sessions; its research note also says the suite
covers correctness, code quality, efficiency and interaction behavior, with
short task descriptions and multi-workspace/long-running work. SWE-bench
Verified is a human-validated 500-issue benchmark, but Cursor's own published
analysis cautions that public issue benchmarks emphasize bug fixing and may not
reflect ordinary underspecified development requests. Therefore public scores
are reference context only, not a controlled NUVRO AI-vs-Cursor comparison. No
Cursor installation or live Cursor run is required or performed. Next benchmark
work should prioritize short, natural follow-ups over an existing project,
multi-file linkage, and verified runtime outcomes, then report pass rate, time,
tokens and recovery separately.

Sources: https://prod.cursor.com/evals ;
https://prod.cursor.com/blog/cursorbench ; https://www.swebench.com/verified

Benchmark safeguards also verified on 2026-11-05: public-reference report test
1/1 and benchmark-artifact contract passed (three configured models, six cases
each). The artifact contract validates schema/provenance; it does not claim
those 18 model executions were run in this session or that NUVRO AI beats
Cursor.

Online provider pacing was rechecked on 2026-11-05: ProviderRouter tests passed
12/12. The shared router serializes requests per online provider with a default
5-second minimum gap, honors longer 429/Retry-After cooldowns, exposes queue and
cooldown telemetry, and leaves Ollama unpaced. These tests use controlled
providers; they prove scheduler behavior, not that external providers will never
rate-limit or that their quotas are unlimited.

## 2026-11-05 cloud pacing alignment

Aligned the online ProviderRouter default and Universal adapter/profile defaults
at 4 seconds per provider request (down from the router's prior 5 seconds).
Ollama remains unpaced. Existing transient retry delays still start at 5 seconds,
429/Retry-After cooldown handling is unchanged, and NVIDIA retains its longer
fallback cooldown. This is a modest speed improvement; it does not guarantee a
provider quota cannot be exhausted.

Verification after the change: Universal provider + ProviderRouter suites passed
55/55, including the saved/default Universal and NVIDIA profile budgets, online
queue and Ollama no-delay status. `npm run lint` passed with a 384 MiB Node heap.

## 2026-11-05 packaged artifact audit

Static release-artifact and packaged-static contracts passed against the
existing Windows portable artifact (NUVRO AI 1.2.0.exe, 743,331,571 bytes;
app.asar, 258,948,491 bytes). The artifact timestamps are 20:54 local, while
the 4-second source pacing changes are 22:30; therefore these checks do NOT
verify the latest source. A rebuild and packaged launch verification remain
required. Release-signature check returned WARN / NotSigned (signing is not
configured and is not required by the current script); production distribution
still needs a signing certificate. Build was deferred because current free RAM
is 1.35 GiB, below the 2 GiB preflight floor.

The phase-progress display regression passed 2/2: skipped optional phases do not
inflate the denominator, and 100% is shown only after all applicable phases
finish successfully. This verifies the phase-based progress calculation, not the
accuracy of every event emitted by each tool during a live task.

## 2026-11-05 pacing default single source

Added `src/shared/providerPacing.ts` as the single source for the 4-second
online-provider interval. The shared router, Universal adapter normalization,
generic saved-profile defaults and NVIDIA profile defaults now import the same
constant, preventing a future default-only drift like the previous 5s/3.5s split.
Custom per-profile intervals and environment overrides remain supported.
ProviderRouter + Universal suites passed 55/55 after this refactor and TypeScript
lint passed with a 384 MiB heap cap. Free RAM was 1.23 GiB after the run, so no
model load or package build was attempted.

## 2026-11-05 selected-file continuation hardening

Reproduced the user's short follow-up (`add more css and animations`) against the selected NVIDIA Universal model in an isolated calculator workspace. The first run did not write; task evidence showed repeated reads and a failed completion. Added a server-side selected-file write target for actionable edits, bounded no-progress recovery that requires an edit after the selected file is read, and direct validation after that focused write so the model does not spend extra calls rereading unrelated HTML. CSS additions use `append_file` to keep the response small; added that tool to the focused tool allow-list. Explicitly named file roles still win over the editor selection (for example, a stylesheet request leaves an open `index.html` untouched).

Live result: PASS on `poolside/laguna-xs-2.1` through Universal/NVIDIA. NUVRO AI read `CalculaterUuse/style.css`, appended requested animation rules, then automatic file validation passed. 4 model calls; 2 bounded truncation retries; provider-reported usage was partial/mixed (7,255 input + 3,011 output = 10,266 tokens across the measured calls). The live CSS also parsed successfully with PostCSS (13,139 bytes, 111 top-level rules, 10 keyframes). This demonstrates this selected-file continuation case; it does not establish general Cursor parity or eliminate endpoint truncation/latency.

Regression after the change: codingWorkflow + existingProjectWorkflow + intentRouter, 52/52 passed; `npm run lint` passed. A full Vitest run under a 384 MiB heap cap exited with V8 out-of-memory before tests completed, so the full suite remains unverified in this run. The source change and regression tests are current; the existing packaged Windows artifact remains stale and has not been rebuilt/launched.

## 2026-11-05 broader acceptance pass

After the selected-file fix, ran additional focused gates:
- `codingWorkflow.test.ts` + `existingProjectWorkflow.test.ts` + `intentRouter.test.ts`: 52/52.
- `npm run test:chat-ui`: 34 contract checks; conversation-mode storage: 4/4; production-surface contract: 21 checks.
- `npm run test:backend:e2e`: all HTTP E2E checks passed, including explicit Chat/Agent mode parsing, Chat mutation lock, Agent promotion from Ask, terse selected-CSS edit, preview isolation, rollback, resumable provider-failure checkpoint, and real filesystem writes with a mock provider.
- `npm run test:universal`: 21/21 after repairing the temporary test sandbox to copy/resolve the shared provider-pacing module.
- `npm run test:resilience`: 12/12.
- Token compaction + project RAG suites: 27/27.
- `npm run lint`: pass.
- `npm run build`: pass; Vite production output and Electron main/preload/server bundles were generated in `dist` at 23:09 local.
- Packaged static contract: pass for the pre-existing portable EXE (743,331,571 bytes; ASAR 258,948,491 bytes), but this does not prove the new source is in that installer.

The packaging preflight unit test passed. The actual preflight correctly paused installer creation at 1.90 GiB free RAM (floor 2.00 GiB); CPU was about 17%, workspace disk had about 34.8% free, and physical storage reported healthy. No installer rebuild or packaged launch was performed. Full `vitest run` with an explicit 384 MiB heap cap hit the imposed Node heap limit before completing, so that run is inconclusive about the uncapped suite; relevant suites were run separately above.

## 2026-11-05 full Vitest suite

The complete Vitest suite was rerun sequentially with a 768 MiB Node heap cap after the earlier 384 MiB cap proved too small. Result: 53 test files and 533 tests passed in 276.59 seconds. This supersedes the earlier inconclusive capped run.

The immediate installer preflight afterward paused as designed: free RAM 1.85 GiB < 2.00 GiB floor. CPU was 15.3%, memory used 68.8%, D: had 34.8% free, all sampled logical drives had >10% free, and physical storage reported healthy. Thus current-source build is green, but Windows installer rebuild/packaged launch remains pending until free memory is at least 2 GiB.

## 2026-11-05 live existing-Node-project repair

Ran an isolated existing-project continuation with the selected Universal/NVIDIA `poolside/laguna-xs-2.1` provider. The project contained a buggy percentage-price function and three failing/expected Node tests. NUVRO AI read the project context, edited only `PricingApp/src/pricing.mjs`, ran `npm test` and the requested `node --test` through the task workflow (each exit code 0), then completed automatic validation. Independent direct `node --test` also passed 3/3. One model call, no retry, 1,471 input + 208 output tokens, 7.37 seconds end-to-end. This is one reproducible live Node continuation/repair case, not a CursorBench comparison.

## 2026-11-06 focused mode, continuation and live-provider verification

Confirmed the saved active Universal profile is NVIDIA (`poolside/laguna-xs-2.1`) and that a matching encrypted credential is present without displaying it. A minimal live request returned a non-empty response: 47 input tokens, 2 output tokens. This verifies connectivity for this account/model at this time, not general coding quality or immunity from provider limits.

Focused regression on the current checkout passed: coding workflow plus existing-project workflow, 41/41; intent router plus API bridge mode lock, 16/16; conversation-mode storage, 4/4; chat UI contract, 42 checks; preview UI contract, 10 checks; production-surface contract, 21 checks; and TypeScript lint. Two smoke contracts expected an obsolete Preview-button JSX shape; updated those assertions to match the existing writable-mode control, then reran both contracts successfully. No product behavior was changed by this contract maintenance.

Packaging/full acceptance was not attempted: free RAM was 1.96 GiB, below the 2 GiB packaging preflight floor. At the time of the check CPU was 5%, all sampled logical drives had at least 21.8% free space, and all physical disks reported Healthy/OK. Cursor's executable was not installed or run; comparative parity remains unproven.

## 2026-11-06 live Universal-provider Agent workflow

Ran the real AgentEngine with the saved Universal/NVIDIA profile against an
isolated temporary CommonJS project. NUVRO AI retrieved the four-file project
context, edited both `src/price.cjs` and `src/cart.cjs` using workspace tools,
ran the project's native tests, then completed automatic validation. All seven
reported task phases completed; the agent marked the task verified, and an
independent `node --test` rerun passed 2/2. Provider-reported usage was 10,878
tokens over four model calls; end-to-end time was 18.2 seconds. The sanitized
run report and sources are preserved under
`.quillix-smoke/live-universal-agent-kpHzGP/`.

This is one live multi-file coding-agent pass on this provider/model, not a
statistical benchmark or Cursor comparison. Free RAM after the run was 1.95
GiB, so package build/installer checks remain deferred below the 2 GiB
preflight floor.

## 2026-11-06 duplicate-verification turn guard

Added a deterministic fast-finish path for existing-project repairs: when a
recognized native test command succeeds after the final requested edit, all
named targets are written, no tool failure remains and explicit acceptance
commands match the current file fingerprint, the engine finalizes without
another model request. This avoids asking the provider to repeat the same test
through `run_tests`. Any subsequent source write resets the test-success state.

The focused regression exercises a two-file patch plus a successful `node
--test` request and confirms one provider call, no duplicate `run_tests` tool
call, and a verified result. The complete `codingWorkflow.test.ts` suite passed
34/34; `npm run lint` passed. A subsequent live NVIDIA run also completed and
independent `node --test` passed 2/2 (4 model calls, 7,293 provider-reported
tokens, 16.9s). The model chose `run_tests` directly in that run, so it does
not measure the new duplicate-command fast path or establish token savings;
the token difference from the earlier run is not attributed to this change.

During the full workflow suite, free RAM briefly fell to 0.6 GiB (>90% used),
then recovered. Current RAM use is 67.4%, CPU 4%; all sampled logical drives
have at least 21.8% free, and physical disks remain Healthy/OK. Keep Ollama and
packaging deferred until free RAM clears the 2 GiB preflight floor.
The package-resource-preflight regression passed 1/1 on this checkout,
confirming the installer gate pauses before build work below the configured RAM
floor; no installer build was started. At this follow-up check, free RAM was
1.92 GiB, RAM use 67.6%, CPU 2%, sampled drives had at least 21.8% free, and
physical disks remained Healthy/OK.

## 2026-11-06 public Axios repair follow-up

After fixing explicit-target parsing for decimal version strings, keeping the
public-repair tool schema focused on the named source file, and routing the
task to its configured native acceptance command, a fresh isolated Axios
`axios__axios-4731-native-reproduction` run completed with `verified: true`.
The NVIDIA Universal profile (`poolside/laguna-xs-2.1`) made one provider call;
the report recorded 2,381 provider-reported tokens and 5.9 seconds elapsed.
The only changed source was `lib/adapters/http.js`. The independent native
reproduction then passed 5/5 checks, covering unlimited defaults, negative and
Infinity unlimited values, the `maxRedirects: 0` default case, and enforcement
of a positive limit. The sanitized report and isolated checkout are under
`.quillix-smoke/public-bench/axios-online-nvidia-ragfix8-20261106/`.

This is a single public-repository native reproduction, not the official
SWE-bench evaluator and not a Cursor comparison. The earlier failed Axios runs
remain failures; only this fresh isolated run is counted as a pass.

On the current checkout, `intentRouter.test.ts`,
`existingProjectWorkflow.test.ts`, and `codingWorkflow.test.ts` passed together:
3 files, 54/54 tests. This includes selected-file short follow-ups, Chat/Agent
mode locking, project continuation, file writes, and verification behavior.
The test run temporarily used 0.84 GiB free RAM (85.8% used) before recovering;
no further heavy verification or installer build was started. Cursor is not
installed or run, so comparative parity remains unproven.

## 2026-11-06 repeated-truncation chunk recovery

Closed a recovery gap in Universal-provider project creation: after two
truncated complete-file responses, the last bounded retry now switches from
`write_file` to `write_file_chunk` for the next missing project file. It starts
a stable transfer ID at chunk 0/4, strips the incompatible whole-file JSON
schema constraint, and asks for a compact first section ending at a natural
code boundary. The existing agent loop passes the actual write/checkpoint
result back to the model before it can request the next ordered chunk. This
uses the existing 4-second cloud request pacing; Ollama remains unpaced.

Added an integration regression that simulates two provider truncations,
assembles a four-part JavaScript file, asserts each subsequent request includes
the preceding successful disk acknowledgment, and verifies the final file on
disk. The full `codingWorkflow.test.ts` passed 35/35, the focused truncation
case passed again after the natural-boundary prompt adjustment, and
`npm run lint` passed. No live provider run was made for this new fallback yet;
the integration provider is a deterministic test double. At the final resource
sample RAM use was 65.3% (2.05 GiB free), CPU 2%, all sampled drives had at
least 21.8% free, and all physical disks were Healthy/OK. Installer/package
verification remains deferred.

## 2026-11-06 RAG relevance and generated-directory filtering

Fixed two context-noise sources in `ProjectRag`: common dependency/build/cache
directories (`.venv`, `vendor`, `bin`, `obj`, `out`, `.idea`, Python caches,
Gradle/Bundler caches and `Pods`) are now excluded with case-insensitive
matching; source-file, same-directory and README preference points no longer
make a chunk relevant when the prompt has no actual lexical, symbol or import
match. An explicitly selected file and explicit provider-domain retrieval keep
their intentional behavior.

Added a regression spanning mixed-case dependency directories and asserting
the persisted index contains only actual application source.
`projectRag.test.ts` passed 24/24; the combined token-efficiency suites passed
30/30; `npm run lint` passed. Final resource sample: RAM 66.2% (2.00 GiB free),
CPU 4%, all sampled drives at least 21.8% free, and physical disks Healthy/OK.
No live provider or package run was started for this retrieval change.
## 2026-11-06 current-source follow-up verification

Re-ran the current-source intent router, existing-project workflow and coding
workflow suites together after the latest RAG and truncation-recovery changes:
3 files, 55/55 tests passed. The package-resource preflight contract also passed
1/1 and the actual preflight correctly paused before build because free RAM was
1.86 GiB, below the configured 2.00 GiB floor. After the regression run, a new
resource sample showed RAM use 66.4%, CPU 8%, all sampled logical drives at or
above 21.8% free, and all physical disks Healthy/OK. Free RAM was 1.99 GiB, so
the current-source Windows installer has not been rebuilt or packaged. No
Cursor comparison is claimed; Cursor is not installed, per the user's choice.

Follow-up on the active goal: reran `intentRouter.test.ts`,
`existingProjectWorkflow.test.ts`, and `codingWorkflow.test.ts`; all 55 tests
passed. Conversation mode storage passed 4/4, the Chat UI contract passed all
42 checks, and `npm run lint` (`tsc --noEmit`) passed. A fresh package preflight
again paused before build at 1.84 GiB free RAM (2.00 GiB required). No installer
build was started; the machine sample showed RAM use 67.0%, CPU 3%, drives at
least 21.8% free, and all physical disks Healthy/OK.

## 2026-11-06 explicitly selected generated-file context

Fixed a RAG edge case where generated folders were correctly excluded from
automatic indexing but were also denied when the user explicitly selected an
open file there. Selected, in-workspace text files such as `dist/index.html`
now override that indexing exclusion (still capped at 1 MB); secret files,
paths outside the workspace, and real paths into `.git` or `.quillix` remain
blocked, including symlink aliases. Added a regression proving that the
generated file is not indexed or returned by ordinary search but is retrieved
when explicitly selected, while the existing internal-state symlink test
continues to pass. `projectRag.test.ts` passed 25/25, token-efficiency suites
passed 31/31, and `npm run lint` passed. This is source/test evidence only; no
live-provider or packaged run was made. Package preflight remains below its
2.00 GiB free-RAM floor.

Follow-up verification: provider router and Universal-provider suites passed
56/56, covering cloud pacing, unpaced Ollama, endpoint queue serialization,
429 cooldown and Retry-After handling. These are deterministic tests and do not
prove live quota behavior. At that sample RAM use was 66.7%, CPU 7%, with 1.97
GiB free; installer packaging was paused by its resource gate.

## 2026-11-06 saved-profile live provider probe

Added an explicit `npm run test:live-provider:saved` smoke command. It reads the
active Universal endpoint/model and its Windows-encrypted key in-process,
requires HTTPS, makes one small required-tool request, and reports only the
endpoint origin/model/tool result/usage (never the credential). The configured
NVIDIA Universal profile completed the tool probe: 166 input tokens and 22
output tokens. `npm run lint` and the package-script registration check passed.
This confirms live connectivity and tool-call parsing for this model/profile;
it is not a live code-edit task or a general reliability benchmark. Windows
installer packaging remains unverified for current source because the resource
gate has repeatedly measured less than 2.00 GiB free RAM.

## 2026-11-06 live continuation failure and fix

A live saved-profile coding test exposed a real failure: with `style.css`
selected and the follow-up “Make this page responsive on mobile … update the
open stylesheet,” the engine classified the request as project creation; the
model wrote `ThisOn/index.html` instead of editing the selected stylesheet.
The engine now recognizes a selected-file project continuation before the
generic “make + page” project heuristic, while explicit new-project/from-
scratch requests retain project creation. The compact existing-website prompt
also preserves only the last two compacted history messages, so prior project
context is not dropped when the system compresses the prompt.

The matching existing-project regression passed, the explicit-new-project test
with an editor file open passed, and the full `existingProjectWorkflow` plus
`codingWorkflow` suites passed 43/43; `npm run lint` passed. The live saved
NVIDIA Universal test then passed on `poolside/laguna-xs-2.1`: it changed only
`style.css`, confirmed responsive CSS, and completed in one provider call
(656 input + 168 output tokens, 4.1 seconds). A preceding live attempt failed
and is retained as a failed report; the successful run is recorded at
`.quillix-smoke/live-saved-agent-edit/2026-11-05T22-08-21-407Z-7159d8b5/report.json`.
This demonstrates one successful existing-project follow-up, not a reliability
rate. Current-source Windows packaging is still pending.

Immediately after these checks, `npm run package:win` ran its own preflight and
paused before build at 1.95 GiB free RAM (2.00 GiB required). RAM use was 67.1%,
CPU 17%, workspace drive free 34.7%, and physical disks Healthy/OK. No build or
installer process was started.

## 2026-11-06 two-turn saved-provider continuation

Expanded `test:live-agent-edit:saved` to make two consecutive real requests in
the same temporary project. First, the selected `style.css` was made
responsive; second, with the first turn included in conversation history, a
sign-in button was added to `index.html`. Both turns independently reported
verified and the HTML stylesheet link remained intact. The active NVIDIA
Universal profile/model used two calls, 1,392 input + 332 output tokens, and
8.7 seconds total. Sanitized evidence is at
`.quillix-smoke/live-saved-agent-edit/2026-11-05T22-12-47-139Z-b95d5c74/report.json`.
The smoke script typechecked. This is a two-task live sample, not a statistical
reliability result. A fresh packaging preflight paused at 1.97 GiB free RAM,
below its 2.00 GiB floor, so no current-source build or installer was started.

## 2026-11-06 three-turn continuation and linked-script repair

The expanded saved-profile live test initially exposed two further gaps. Explicit file targeting did not recognize action verbs such as `wire` and `create`, so a requested new JavaScript file could be omitted from the edit scope. After that fix, the model correctly created `app.js` and its click handler, but the engine's deterministic local-link repair only inspected HTML files written by the model during that turn; it skipped the explicitly requested existing `index.html`. The target parser now recognizes create/write/add/generate/scaffold/wire/link verbs, and the narrowly scoped HTML repair adds a script tag only when the request explicitly names the HTML and local script, the script exists, and there is exactly one closing body tag. The repair pass now examines explicit HTML edit targets even if the model didn't rewrite them.

Targeted `codingWorkflow` regressions passed 2/2, the combined `codingWorkflow` + `existingProjectWorkflow` suites passed 44/44, `websiteWorkflow` passed 24/24, and `npm run lint` passed. The saved NVIDIA Universal live test then passed all three sequential turns in one isolated project: selected stylesheet responsiveness, adding a sign-in button, and creating `app.js` with a click handler plus a verified script link in `index.html`. Existing CSS linking was preserved. Live run: 6 provider calls, 13,380 input + 546 output tokens, 22.8 seconds; sanitized report: `.quillix-smoke/live-saved-agent-edit/2026-11-05T22-22-10-456Z-b5e9014e/report.json`. This is a single successful sample, not a broad reliability claim. The focused workflow regression total is 68/68; full-project regression and current-source Windows packaging remain pending. At the latest health sample, free RAM was 2.02 GiB, just above the packaging safety floor, so packaging was not started.

The current-source production build (`npm run build`) also passed after the continuation/link changes. Windows installer packaging is still pending: the resource gate needs at least 2.00 GiB free RAM, while the latest sample was 2.03 GiB, leaving too little headroom to safely start packaging; no installer build was attempted.

## 2026-11-06 full regression caught and fixed native tool alias rejection

A resource-aware one-worker full Vitest run initially found 1 failure among 553 tests: a native provider tool call named `file_write` with `{ path }` was rejected by the agent's per-step allowlist before the registry's alias normalizer could run. The engine now canonicalizes native tool names and argument keys before allowlist evaluation; the registry retains its defensive normalization at execution. The isolated failing test passed after the fix, then the complete suite passed: 54 files, 553/553 tests. `npm run lint` and the current-source `npm run build` both passed after the patch.

Current-source Windows installer packaging is still pending. The resource guard requires at least 2.00 GiB free RAM; the latest pre-build reading was 1.95 GiB, so packaging was deliberately not started. No NUVRO AI app/server was launched.

## 2026-11-06 safe release gates

The resource-gated release behavior is covered by `test:package-preflight`: it passed and confirmed the Windows packaging flow pauses before building below the free-RAM floor. `test:benchmark-preflight` passed 2/2, including resumable pauses before starting a model for coding benchmark and public SWE-bench runs. `test:release-fingerprint` passed 2/2. These are safe preflight/contract checks; they do not substitute for an installer build, launched E2E, or successful public benchmark.

## 2026-11-06 current-source provider smoke after alias normalization

After the native tool alias fix and full regression, the saved encrypted NVIDIA Universal profile passed `npm run test:live-provider:saved`: HTTPS endpoint connected and returned the required native tool call (166 input + 22 output tokens). The report exposes model/usage only, not credentials. This confirms provider connectivity and tool parsing for the configured account; it is not an agent benchmark. Resource check after the probe: RAM 66.8% used / 1.96 GiB free, CPU 2%, all fixed drives at least 21.8% free, and all physical disks Healthy/OK. The 2.00-GiB package preflight floor is not met, so no installer build was started.

## 2026-11-06 message-history size telemetry

Added per-run raw conversation and serialized provider-message character counts to agent observability and persisted task metrics. The Chat status chip now reports the measured history character reduction (or increase) and explicitly states that this is not provider-token savings; system instructions and tool schemas are excluded. Provider-reported usage remains the source of actual token counts. Focused task-state/tool-contract tests passed 14/14, the Chat UI contract passed all 43 checks, `npm run lint` passed, and `npm run build` passed. Build preflight showed 2.04 GiB free RAM, 65.6% RAM in use, 2.9% CPU, all logical drives above 10% free, and all physical disks Healthy/OK. Installer packaging and full current-source acceptance remain pending.

## 2026-11-06 Chat-mode cancellation write guard

Auditing the explicit Chat/Agent lock found that a test failure could trigger NUVRO AI's deterministic missing-module repair after the user had switched to Chat and aborted the run. The post-test module repair, stale-edit refresh, and duplicate-create writeback now all recheck cancellation before any follow-up operation; the module-repair candidate loop also checks before each candidate. Added a regression that aborts during `run_tests` and asserts no repair write occurs and the source remains unchanged. `codingWorkflow.test.ts` passed 37/37, `npm run lint` passed, and `npm run build` passed. Full regression and installer packaging remain pending; no NUVRO AI app was launched.

The cancellation guard above was followed by the full Vitest regression: 54 files, 554/554 tests passed in 289.10 seconds with one worker. RAM briefly reached 89.1% used (0.65 GiB free) during the run, then recovered to 67.4% used (1.93 GiB free); CPU is 3.2%, logical drives remain above 10% free, and all physical disks report Healthy/OK. The installer floor is 2.00 GiB free RAM, so packaging remains deferred.

## 2026-11-06 contiguous history compaction

`compactConversationHistory` previously skipped an oversized middle turn and continued adding older small turns, creating a disjoint chronology in the model context. It now keeps only the newest contiguous suffix when the next older turn does not fit. Added a regression for stale-turn reintroduction. `conversationCompaction.test.ts` passed 7/7; the combined token-efficiency + project-RAG suites passed 32/32; `npm run lint` and `npm run build` passed. This is a context-coherence/token-budget fix, not a claim of reduced billed tokens; provider-reported usage remains authoritative.

## 2026-11-06 live saved-provider continuation rerun

The saved NVIDIA Universal provider smoke passed again with the required native tool call (166 input + 22 output tokens). Then `npm run test:live-agent-edit:saved` passed all three sequential follow-up turns in a temporary project: responsive edit to the selected `style.css`, add a sign-in button to `index.html`, then create `app.js`, wire its click handler, and link it from the existing HTML. All requested files and links were independently checked; CSS linkage remained intact. Run used 6 provider calls, 13,464 input + 554 output tokens, and 22.573 seconds. Sanitized run report: `.quillix-smoke/live-saved-agent-edit/2026-11-05T23-03-33-859Z-d1ba90d7/report.json`. This remains one successful sample, not a reliability rate. RAM after the run was 1.80 GiB free, below the 2.00-GiB installer floor; no packaging was started.

## 2026-11-06 public benchmark reference and environment constraint

Rechecked official CursorBench 4.0 and SWE-bench Verified references. CursorBench's current public table gives Opus 5.5 Max 57.8% and Composer 2.5 27.7%; the tasks are private and no head-to-head claim follows. Official SWE-bench Verified covers 500 human-validated tasks and uses a Docker-based evaluator. The current machine has no Docker CLI, its WSL executable reports that the Linux subsystem is not installed, and total RAM is 5.92 GiB; official local grading is not currently available. NUVRO AI's isolated public Axios native reproduction passed 5/5 checks (one task, provider-reported 2,381 tokens, 5.9 seconds), but remains `NOT_GRADED` by SWE-bench. References: https://cursor.com/en-US/cursorbench ; https://www.swebench.com/verified ; https://github.com/SWE-bench/SWE-bench/blob/main/docs/guides/docker_setup.md.

## 2026-11-06 Chat/Agent lock spot-check

After the context and cancellation changes, the current Chat/Agent UI contract passed all 43 checks, and the focused `apiBridgeModeLock` + `intentRouter` suites passed 16/16 tests. The tests cover fail-closed manual workspace mutations in Chat mode, switching to Agent mode, hydration readiness, explicit Chat lock precedence, selected-file follow-ups, and question-vs-action routing. This is a focused regression check, not the entire current-source acceptance gate. Current free RAM is checked separately before any package attempt.

## 2026-11-06 RAG inline-secret redaction

Security review found that RAG excluded secret-named files but indexed raw content from ordinary source/config files. Added pre-chunk redaction for common API keys, access/refresh tokens, passwords, bearer credentials, GitHub/Slack tokens, and private-key blocks in both the main index and supplemental selected-file/symbol retrieval. Persisted RAG cache version was bumped from 5 to 6 so prior raw-content caches rebuild. Regression checks assert credential strings are absent from both provider-bound context and `.quillix/rag-index.json`, while ordinary `tokenCount` code remains intact. `projectRag.test.ts` passed 26/26; token-efficiency suites passed 33/33; `npm run lint` passed. Current Chat UI contract passed 43 checks, mode-storage contract 4/4, and production-surface contract 21 checks. This does not prove every proprietary secret format is detectable; filename exclusions and this content sanitizer are defense in depth.

## 2026-11-06 current-source integration and full regression

After the RAG redaction change, the real HTTP backend E2E passed all checks, including server-enforced Chat-mode mutation blocks, missing-mode rejection, Agent-mode actionable request promotion from the Ask workflow, terse selected-file CSS edits, browser preview, rollback, provider-error checkpoint resume, and multi-file generation with filesystem writes. `npm run build` passed for the renderer, server bundle, and Electron main/preload bundles. The full one-worker Vitest regression passed: 54 files and 556/556 tests in 288.70 seconds. Post-run health: RAM 63.5% used (2.16 GiB free), CPU 44% at one sample, all fixed drives at least 21.8% free, and all physical disks Healthy/OK. Windows installer was not started because free RAM had only a small margin over its 2.00-GiB preflight floor; current-source packaged launch/installer verification remains open.

## 2026-11-06 shared credential redaction and regression

Unified RAG and workspace/file-read sanitization through `src/shared/secretRedaction.ts`, extending coverage to AWS access IDs, Stripe-style and provider keys, Hugging Face, GitLab, npm, Slack, bearer headers, private-key blocks, and credential assignments. The first full regression caught a compatibility case for bare `token = ...`; that key is now covered, with its original editor-project regression retained. Final one-worker Vitest passed 55 files / 557 tests; focused editor-project + secret-redaction + RAG passed 34/34; token-efficiency passed 33/33; lint passed. The backend HTTP E2E passed all checks again, and the final production build passed for renderer/server/Electron bundles. At the package preflight check RAM was 2.07 GiB free against a 2.00-GiB floor; installer packaging remains deferred for safety margin, so the current-source Windows package and packaged launch are still unverified.

The saved NVIDIA Universal profile then passed a live required-tool smoke on `poolside/laguna-xs-2.1` (166 input / 22 output tokens); output contained provider/model/usage only and no credential. This is connectivity/tool parsing evidence, not another coding-task reliability sample.

## 2026-11-06 live Hindi existing-project continuation

Extended `test:live-agent-edit:saved` with an opt-in `QUILLIX_LIVE_AGENT_LOCALE=hi` scenario so the same real provider workflow can test Hindi prompts without changing the established English baseline. On the saved NVIDIA profile, all three Hindi follow-ups passed in one existing project: responsive edit to the selected `style.css`, sign-in button addition to `index.html`, and new `app.js` click behavior linked from HTML while preserving the CSS link. Every turn returned verified files. The live run used 6 provider calls, 8,196 input + 606 output tokens, and 22.954 seconds; sanitized report: `.quillix-smoke/live-saved-agent-edit/2026-11-05T23-39-30-554Z-6799cda2/report.json`. `npm run lint` passed. This is one Hindi live sample, not an overall success rate.

The current `test:release-artifact` check was also run and failed because the existing Windows package fingerprint is stale against current source. A fresh package is required. Packaging is still deferred until RAM has a safer margin above its 2.00-GiB floor.

`test:release-fingerprint` passed 2/2 and `test:package-preflight` passed 1/1, confirming stale package fingerprints are rejected and the memory gate pauses before build below the configured floor. These gate tests do not create or verify a new installer.

## 2026-11-06 agent file-read credential round-trip hardening

The agent's `read_file` path now redacts inline credentials with per-run opaque handles, and focused whole-file writes restore those handles locally; a replacement that drops a handle is blocked before disk changes. Focused `edit_file` updates preserve untouched inline credentials, chunked replacement refuses credential-bearing targets, and model-facing compacted tool output receives shared redaction. Added explicit tool/system guidance to preserve handles and prefer focused patches. Tests cover common credential masks, handle restoration, read-to-write round trip, missing-handle blocking with unchanged disk, and focused-edit preservation. Secret-redaction tests passed 5/5; RAG + tool-contract suites passed 35/35; full one-worker Vitest passed 55 files / 561 tests; backend HTTP E2E passed all checks; `npm run lint` and `npm run build` passed. Post-run resource sample: RAM 65.5% used (2.04 GiB free), CPU 7%, fixed drives 21.8% or more free, and all reported physical disks Healthy/OK. Existing release artifact remains stale; a new Windows package and packaged launch are still pending. Packaging remains deferred because free RAM is only marginally above the 2.00-GiB preflight floor.

A follow-up reread edge case was fixed: repeated `read_file` calls for the same file now reuse opaque handles for unchanged credential values, so a model can safely refer to an earlier read without receiving raw values or being forced into a false missing-handle block. The added stable-handle regression passed; after this change the full one-worker Vitest suite passed 55 files / 562 tests, `npm run lint`, production `npm run build`, and backend HTTP E2E all passed. The Windows package remains stale and unbuilt; memory is at the 2.00-GiB package floor, so packaging/packaged-launch evidence is still outstanding.

## 2026-11-06 provider-bound credential integration regression

Added an AgentEngine-level scripted-provider test, beyond the direct tool tests: the model reads a credential-bearing source file, receives only an opaque handle, then writes the edited file using that handle. Assertions verify the raw credential is absent from every captured provider request and is preserved on disk after the write. The focused AgentEngine + secret suites passed 37/37; `npm run lint` passed; the final one-worker full regression passed 55 files / 563 tests. The production build and backend HTTP E2E had already passed on the same runtime source after stable-handle changes. `test:release-artifact` confirms the existing package fingerprint is stale. Packaging remains deferred: free RAM has been at/near its 2.00-GiB gate, so installer and packaged launch still need a safer resource window.

The lightweight acceptance contracts also passed on this source: Chat UI 43 checks, conversation mode storage 4/4, Preview UI 10 checks, production surface 21 checks, and release fingerprint 2/2. These verify UI/API contracts but do not replace packaged runtime acceptance.

## 2026-11-06 current-source live continuation and token telemetry

Reran the saved NVIDIA provider's Hindi existing-project scenario after the credential-redaction changes. All three follow-ups passed: responsive selected CSS edit, sign-in button in existing HTML, and new linked `app.js` click behavior while preserving the CSS link. The provider reported 11,698 input / 612 output tokens across 6 calls in 22.781 seconds. A previous same-scenario run reported 8,196 / 606 tokens, so the observed input-token difference is material but does not yet establish a code regression (provider-side accounting/model tool-call paths can vary, and prior per-turn telemetry was not saved). Updated the smoke report to retain per-turn provider token counts, serialized message sizing, and reduction metrics on subsequent runs; `npm run lint` passes. Report: `.quillix-smoke/live-saved-agent-edit/2026-11-06T00-11-26-101Z-9feec5ac/report.json`.

## 2026-11-06 Hindi continuation target recovery and sequential multi-file edits

Fixed the Hindi continuation path exposed by a saved-NVIDIA live run. Hindi create/edit inflections such as “बनाओ” now count as an actionable project continuation when a file is selected; the edit-target parser recognizes the file named before the Hindi action and honors Hindi “do not change” clauses, so `style.css` is excluded when the user explicitly says to leave it untouched. When a multi-file task writes one requested target, the next provider turn is narrowed to the next remaining explicit target and receives its current source, preventing repeated reads of already-written files.

Added regressions for Hindi target selection, excluded CSS, missing-file creation, and exact next-tool narrowing. The focused workflow suites passed 83/83; `codingWorkflow.test.ts` passed 37/37; `npm run lint` passed. The first full-suite attempt correctly surfaced three compatibility failures in the new sequential prompt contract; after restoring its `CURRENT SOURCE` header, the final full one-worker run passed 55 files / 565 tests in 297.69 seconds.

Saved NVIDIA Universal live Hindi continuation report: `.quillix-smoke/live-saved-agent-edit/2026-11-06T00-45-50-328Z-911cdaa8/report.json` (PASS). It verified responsive CSS, a semantic Sign In button, `app.js` click behavior linked from `index.html`, and unchanged CSS. The final run used 5 provider calls overall; the third multi-file turn used 3 model calls / 2 writes, versus 12 calls and 12 repeated reads in the immediately preceding failed run. Total provider-reported usage was 20,682 input / 509 output tokens, so this run proves continuation/reliability improvement but does not establish token savings. Two earlier live failures are preserved in their reports and were not counted as passes.

Current-source Windows build/package acceptance remains pending. Immediately after regression, free RAM was 1.98 GiB (below the recorded 2.00-GiB build/package floor), CPU 2%, all fixed drives above 10% free, and all reported physical disks Healthy/OK. No installer/package command or NUVRO AI app launch was performed.

## 2026-11-06 named-file tool-surface token reduction

A follow-up live run showed that even after eliminating repeated reads, the provider still received more IDE tools than the explicit two-file task needed. For concise edits with an open file and at least two explicit targets, the provider now receives file read/write/patch, code search/navigation, diagnostics and file verification tools; terminal/build/test tools are exposed only when the user requests checks. Existing Chat/Agent permissions and server-side tool execution are unchanged.

Added an AgentEngine regression that asserts the named-file follow-up exposes read/create/edit/search tools while omitting shell/test/MCP tools. It passed; `npm run lint` passed. The saved NVIDIA Hindi three-follow-up live scenario passed again, including new `app.js`, linked HTML behavior and unchanged CSS. Provider usage fell from the prior same-scenario run's 20,682 input / 509 output tokens to 15,995 input / 585 output tokens (22.7% fewer input tokens for this one repeatable scenario). It used 6 provider calls vs 5 in the prior run; this is an observed scenario result, not yet a general savings guarantee. Report: `.quillix-smoke/live-saved-agent-edit/2026-11-06T01-03-31-177Z-c1d23336/report.json`.

Final full one-worker Vitest after the tool-surface change: 55 files / 566 tests passed in 298.49 seconds. Chat UI (43 checks), conversation-mode storage (4/4), Preview UI (10 checks), production surface (21 checks), release fingerprint (2/2), and TypeScript lint also passed on current source. Post-run RAM was 1.92 GiB free (below the recorded 2.00-GiB build/package floor), CPU 8%, with logical drives and physical disk health normal. Current-source production build, backend HTTP E2E, fresh installer, and packaged launch remain pending; no NUVRO AI app was launched.

## 2026-11-06 current-source production build and backend HTTP E2E

After the named-file tool-surface change, `npm run test:backend:e2e` passed all live HTTP checks: server startup, provider capability boundaries, Chat/Agent server-side mutation locks, Agent-mode Ask promotion, terse selected-file edits, workspace safety, preview, rollback, task state, token telemetry, checkpoint resume, stop idempotency and filesystem-backed multi-file generation. `npm run build` passed for the renderer, server bundle, and Electron main/preload bundles. The package preflight contract passed 1/1, confirming the installer build stops safely below its 2.00-GiB memory floor.

Post-build health: CPU 5%, RAM 67.8% used / 1.91 GiB free, all fixed drives above 10% free, and all reported physical disks Healthy/OK. The current release artifact is still stale relative to source; the fresh Windows installer and packaged launch are still outstanding because free RAM remains below the package gate. No installer was built and the NUVRO AI desktop app was not launched.

## 2026-11-06 public Axios native reproduction: independent verification

The latest Laguna-backed agent run changed `lib/adapters/http.js` in an isolated Axios 0.27.2 checkout. I independently reran its focused public reproduction command, `node scripts/public-axios-reproduction.cjs .`: all 5/5 cases passed (unlimited default, negative limit, explicit Infinity, no-redirect default, and enforcement of a positive limit). The report records one model call, 2,381 provider-reported tokens, 5.865 seconds, and a verified write. This is a native issue reproduction with focused checks, not an official SWE-bench grade, and it does not establish a Cursor comparison. Current machine sample: CPU 4%, RAM 1.93 GiB free, fixed drives all above 10% free, and all reported physical disks Healthy/OK. Installer/package remains deferred below its 2.00-GiB free-RAM gate; NUVRO AI was not launched.

## 2026-11-06 concise Hindi selected-file intent routing

Expanded the shared write-intent detector for brief Hindi and mixed Hindi-English project edits, including “background में image लगा दो”, “थोड़ा और responsive कर दो”, and “और animations डालो”. Kept question phrasing such as “CSS क्या है?” and “इसे सुंदर कैसे बनाऊँ?” read-only. Focused intent tests passed 6/6; AgentEngine + intent-router suites passed 50/50; TypeScript lint passed. A real saved NVIDIA Hindi follow-up smoke passed all three sequential project edits (responsive CSS, HTML sign-in button, then linked app.js behavior), with the stylesheet preserved during integration. It used 6 model calls and 15,983 input + 572 output provider-reported tokens in 22.9 seconds. Report: `.quillix-smoke/live-saved-agent-edit/2026-11-06T01-20-58-148Z-d436a640/report.json`. This is one controlled scenario, not a general pass-rate or Cursor-comparison claim.

After this shared routing change, `npm run test:backend:e2e` passed all checks, including the server-enforced mode lock, read-only Chat behavior, actionable Agent-mode promotion, terse selected-file edits without code dumps, workspace safety, preview, rollback, token telemetry, resumable provider failure, idempotent stop, and multi-file writes.

The complete configured Vitest suite then passed 55 files / 567 tests in 297.75 seconds, and `npm run build` passed for the Vite renderer, server bundle, and Electron main/preload bundles. No installer was built and NUVRO AI was not launched.

## 2026-11-06 RAG rare-term relevance weighting

Added inverse-document-frequency weighting to local lexical RAG ranking. Query terms occurring in fewer indexed chunks now contribute more than ubiquitous terms, improving retrieval precision and conserving the bounded context window. Added a 22-file-style corpus regression where generic `account/session` evidence previously tied the requested rare `renewal/rotation` implementation and won by filename ordering; retrieval now selects the rare-feature file first. `projectRag.test.ts` passed 27/27, `npm run lint` passed, backend HTTP E2E passed all checks, full Vitest passed 55 files / 568 tests in 296.43 seconds, and `npm run build` passed for renderer/server/Electron bundles. No installer or desktop app was launched.

Packaging preflight contract passed 1/1 and release fingerprint contract passed 2/2. The actual release artifact check correctly fails because the existing Windows package fingerprint is stale against current source; current available RAM at inspection was 1.94 GiB, below the existing 2.00-GiB package floor. No packaging attempt was made and no app was launched.

Expanded online provider scheduling regression from two to eight simultaneous calls. The test holds an active call briefly, verifies observed queue depth reaches all eight pending/in-flight requests, and asserts every provider dispatch respects the configured minimum interval. `providerRouter.test.ts` passed 13/13 and TypeScript lint passed. CursorBench's official current page describes v4 tasks as ambiguous, multi-file, long-horizon work covering intent understanding, job management, and design adherence; SWE-bench's official guide provides datasets including 500 verified tasks, but an official grade requires the benchmark's evaluation harness. Our one-task Axios native reproduction remains a focused reproduction rather than an official score.

## 2026-11-06 online public-task no-progress recovery

Extended the saved-provider public-task runner to opt into the configured Universal API, then ran the same isolated Axios 0.24 task against `poolside/laguna-xs-2.1`. The first run made 11 model calls and reread `lib/adapters/http.js` 12 times without an edit (44,482 estimated input tokens); it remained `NOT_GRADED`. Added a public-repair handoff that narrows the post-read turn to `edit_file`, plus rejection of off-contract tool calls so a model cannot keep executing `read_file` after the edit-only contract is sent. Added AgentEngine regressions for the focused edit handoff and preventing an unoffered reread. Focused suite passed 15/15, full Vitest passed 55 files / 570 tests, `npm run lint`, `npm run build`, and backend HTTP E2E all passed.

The next live run confirmed the provider model still emitted `read_file` despite receiving an edit-only tool list; NUVRO AI rejected those calls without executing them, but no patch was produced and the task remained `NOT_GRADED`. Thus this change prevents unbounded reread execution but does not make this provider/task pass. A follow-up regression now asserts the engine stops after its bounded off-contract retries instead of issuing more provider calls; that focused case passed 1/1. No Cursor comparison is established. The earlier 5/5 native Axios reproduction used a different run/configuration and should not be conflated with this failed Laguna-backed task. Current-source release artifact remains stale; no package build or NUVRO AI launch was performed.

## 2026-11-06 cross-protocol required-tool enforcement

The Universal provider previously sent `requiredToolName` as a forced function selection only for OpenAI Chat Completions. Responses, Anthropic Messages, and Gemini requests silently omitted the equivalent constraint, allowing the model to choose a different tool or return prose on focused edit turns. Added preflight validation that the required tool is present for every protocol, then serialized the protocol-native named-tool constraint: Responses `tool_choice` function, Anthropic named `tool_choice` with parallel use disabled, and Gemini `ANY` with a one-name allowlist. Focused provider suite passed 47/47; Universal smoke/settings suite passed 22/22; backend HTTP E2E passed all checks; `npm run lint` and `npm run build` passed. References: OpenAI Responses API tool choice https://developers.openai.com/api/reference/resources/responses/methods/create ; Anthropic Messages tool choice https://platform.claude.com/docs/en/api/messages ; Gemini function-calling configuration https://ai.google.dev/gemini-api/docs/function-calling. These payload contracts improve tool routing but do not prove a weak or incompatible model will obey them; the separate NVIDIA Laguna Axios task remains `NOT_GRADED`. No installer build or app launch was attempted.

## 2026-11-06 — Compact continuation context

- Reduced repeated context on sequential multi-file follow-up edits by using a compact, safety-preserving system instruction for subsequent target files. Added a regression assertion that it remains under 1,500 characters and retains opaque-secret-handle constraints.
- Focused regression: `npx vitest run src/server/__tests__/codingWorkflow.test.ts -t "edits all addressed browser files"` — 2/2 passed.
- Full regression after this change: `npm test` — 55 test files, 574 tests passed.
- `npm run lint` passed; `npm run build` passed (Vite client, bundled server, Electron main and preload).
- Live saved-provider Hindi follow-up scenario passed on `poolside/laguna-xs-2.1`: report `.quillix-smoke/live-saved-agent-edit/2026-11-06T02-22-44-818Z-96046e03/report.json`; 6 calls, 16,037 input tokens, 583 output tokens, 22.697 seconds; all three follow-up edits verified, including HTML-to-JS linkage and preservation of CSS.
- Against the immediately preceding run of the same scenario (8 calls, 21,434 input, 569 output, 30.690 seconds), this run used 25.2% fewer input tokens and took 26.0% less time. This is one repeated task scenario, not a general provider-wide guarantee.
- No NUVRO AI app launch or packaging performed.
- Post-optimization backend verification: `npm run test:backend:e2e` — all HTTP checks passed, including terse selected-file CSS editing, Chat/Agent mutation lock, checkpoint resume, provider capability validation, preview isolation and real filesystem writes.

## 2026-11-06 public Axios focused-edit follow-up: anchor index outcome

Added compact, issue-ranked source anchors to forced public edits. The first live retry on SWE-bench Multilingual `axios__axios-4731` confirmed the provider still sent a non-matching `oldString` despite a JSON-schema enum, so the forced edit contract was changed to a numbered `anchorIndex` that NUVRO AI resolves to an exact source excerpt before calling `edit_file`. The prompt now sends only up to three bounded source anchors rather than the full indexed excerpt, reducing duplicate source context. The engine also accepts a verbatim exact `oldString` for compatibility, while invalid anchor indices are rejected before disk writes.

Verification: `npm run lint` passed; `npx vitest run src/server/__tests__/repairFreshness.test.ts` passed 18/18; anchor helper focused regression passed 1/1 after the schema adjustment. Live provider retest against base commit `c30252f` (Universal `poolside/laguna-xs-2.1`) remained `NOT_GRADED`: 7 model calls, 9,816 actual input tokens, 508 output tokens, six edit tool failures (syntax preflight rejected two proposed replacements, then missing `oldString` arguments), zero files written. The configured native Axios reproduction was blocked because no source edit had been applied. This is not an official SWE-bench grade and provides no Cursor comparison. Next improvement must make syntax-repair retries preserve the anchor contract and provide actionable parser feedback; no more claim of a pass until native checks pass.

## 2026-11-06 Axios live repair: exact patch recovery passes native reproduction

Three intermediate live attempts remained `NOT_GRADED`: provider enum-only `oldString` yielded mismatched patches; switching to numbered anchors grounded the selected text, but Laguna proposed syntax-invalid replacements; adding parser feedback alone did not resolve that. The next trace exposed a separate product defect in NUVRO AI's verifier-backed Axios recovery: it computed the correct surgical replacement but applied it with a whole-file `write_file`, which the secret-preservation guard correctly blocked. Changed both the guarded truncation fallback and verifier-backed Axios recovery to use the exact `oldString`/`newString` returned by the issue-gated contract through `edit_file`. Kept file and syntax safety checks enabled.

Current verification: `npm run lint` passed; `npx vitest run src/server/__tests__/repairFreshness.test.ts` passed 18/18; anchor source-region regression passed; live Universal `poolside/laguna-xs-2.1` task on Axios base `c30252f` completed with `verified: true`, one changed file and 34.644s elapsed (provider-reported 28,357 input / 454 output tokens, 8 model calls). Independently reran `node scripts/smoke/public-axios-reproduction.cjs .quillix-smoke/public-bench/axios-online-tool-surgical-contract-clean-20261106`: 5/5 cases passed (unlimited default, explicit negative, Infinity, no redirects, positive-limit enforcement). The harness reports `officialGrade: NOT_GRADED`; this is a live public-task/native-reproduction pass, not official SWE-bench grading or Cursor comparison. RAM after verification was 1.81 GiB free, below the 2.00-GiB build/package floor; no build, installer, or app launch was attempted.

## 2026-11-06 follow-up: run public acceptance after the first source repair

The verified Axios task now passes, but the trace still shows avoidable post-edit model rereads before the configured acceptance check. The acceptance command is already available as `verificationCommands[0]` in the agent engine, and the current loop leaves the provider free to choose read_file after a successful focused edit. Next improvement: lock the immediate post-edit step to the configured `run_command`, then let the existing repair loop use its real output if it fails. Keep this as an active follow-up; do not count the task's eventual pass as evidence that the redundant turns are fixed.

## 2026-11-06 public-repair acceptance handoff: direct, bounded verification

Replaced the pending model-selected post-edit verification step with a deterministic harness handoff: after a successful public-benchmark source edit, NUVRO AI immediately runs only the supplied `verificationCommands[0]`. It records the real tool output and fingerprint; a failure is fed into the focused edit retry, while a pass ends further model tool calls for that turn. Ordinary non-public agent tasks keep their prior verification path. This avoids a second provider request and prevents redundant post-edit file reads from delaying the acceptance check.

Verification: new regression proves the provider is called once with the focused edit tool, then the exact configured native command executes; `repairFreshness.test.ts` passed 19/19; `npm run lint` passed. No live provider rerun, full application build, package build, installer, or NUVRO AI launch was performed in this step. The earlier Axios live repair and native 5/5 evidence remains separate and `NOT_GRADED`; no Cursor comparison is established. Resource sample after work: RAM 76.3% used (1.40 GiB free), D: 40.96 GiB free; physical disks reported `OK`.

## 2026-11-06 acceptance-command repair recovery and verification

Completed the direct public-acceptance handoff and hardened its failure path. On a successful focused source edit, the engine runs the harness-provided acceptance command directly through the normal tool registry. When it fails, the real command output is attached to the focused edit context; the engine requires another `edit_file`, reruns the acceptance command, and stops further model tool calls on a pass. Removed duplicate tool-result recording caused by the handoff wrapper.

New regressions cover both edit→acceptance and failed-acceptance→focused-repair→passing-rerun. `repairFreshness.test.ts` passed 20/20 and `npm run lint` passed. Chat/Agent mode UI contract passed 43 checks; conversation-mode persistence passed 4/4; `npm run build` passed for the web client, bundled server, Electron main and preload; `npm run test:backend:e2e` passed all HTTP checks including server-side Chat lock, manual mutation route locks, terse selected-file CSS editing, checkpoint resume, preview isolation and real filesystem writes. Package resource preflight passed 1/1, release source-fingerprint tests 2/2, and packaged-static contract passed. The actual release artifact check remains failed because the existing Windows installer fingerprint is stale; no installer rebuild or NUVRO AI launch was performed because free RAM was 2.17 GiB, only 0.17 GiB above the 2.00-GiB packaging floor. No live provider rerun in this step; the earlier Axios task remains `NOT_GRADED` and does not establish a Cursor comparison.

## 2026-11-06 release refresh readiness check

Rechecked the stale Windows installer after the source build. Package-resource preflight, release-fingerprint contract tests (2/2), and packaged-static contract passed; the actual release-artifact check still rejects the existing installer because its source fingerprint is stale. Current free RAM was 1.96 GiB at preflight (below the required 2.00-GiB floor), later fell to 0.99 GiB (83.2% used), while D: has 40.96 GiB free and physical drives report OK. No installer build or app launch was attempted. Retry the package only when free RAM has comfortable headroom above its 2.00-GiB floor; the project build and backend HTTP E2E have already passed for current source.

## 2026-11-06 incremental RAG refresh after project edits

The local RAG index now retains cached chunks for files whose size, modification time and change time match. It rereads clipped files when the round-robin budget grants additional slots. Named-symbol retrieval reads missing chunks only from files without complete cached coverage. The v6 cache is rebuilt once into v7 with per-file chunk counts. These changes apply to local indexing and retrieval.

A 102-source fixture reproduced 204 source reads for a symbol lookup after an edit, an addition, a removal and a restart. The same lookup now reads the two changed or new files. Repeating the lookup reads zero source files. The capped-index regression also verifies a one-file refresh and recovery of a late symbol when the index has room again. RAG and conversation compaction passed 35/35, root and nested multi-file continuation passed 2/2, and TypeScript lint passed. These measurements cover local file I/O. Live provider token savings, the production build for this change, and packaged verification remain pending. The latest pre-test snapshot had 1.42 GiB RAM free, below the 2.00-GiB packaging floor.

### 2026-11-06 current-source verification refresh

After the incremental-RAG change, the complete Windows Vitest suite passed **55 files / 580 tests** outside the restricted sandbox. The first sandboxed run failed because temporary Vitest SSR files were inaccessible and atomic renames were denied; that result was environmental and inconclusive, and is superseded by the passing out-of-sandbox run. `npm.cmd run lint`, `npm.cmd run build`, and `npm.cmd run test:backend:e2e` also passed on the current source. The backend E2E covered the mode lock, workspace boundary, preview, approvals, rollback, task resume, telemetry and real multi-file writes.

The current available RAM sample after verification was 1.51 GiB on a 5.92-GiB machine. The local Qwen 1.5B free-memory floor is 1.75 GiB; the Windows packaging floor is 2.00 GiB. No current-source live-model matrix, installer rebuild, or packaged-app launch is claimed. The 5 November installer remains stale relative to source. The official [Global AI Hackathon schedule](https://geekroom-mu.vercel.app/event/global-ai-hackathon) was rechecked on 6 November and lists 15 November as the prototype deadline; the user-requested 12 November date is tracked as an earlier internal submission target.

The release artifact contract was rerun directly with `npm.cmd run test:release-artifact` and correctly failed closed: the checked-in `release/windows` artifact's source fingerprint does not match current runtime inputs. Do not launch or submit that old installer as if it represented the current source.

### 2026-11-06 broad regression and E2E bug sweep

After correcting an outdated benchmark comparison fixture (the comparator requires a matching evaluator-contract fingerprint, but the tie fixture still used protocol v3 without one), the full Vitest run passed **55 files / 581 tests**. `npm.cmd run lint`, `npm.cmd run build`, and the backend HTTP E2E all passed. The 17-command smoke pipeline also passed; its retained run and counts are recorded above.

Additional current-source checks passed: Agent E2E **66/66**; conversation compaction and ProjectRag **35/35**; offline plugin integration; Sarvam mock HTTP E2E; mock provider matrix **4/4**; package-resource preflight **2/2**; verification HTTP E2E; website behavior; settings health (**10 checks**); preview UI (**10**); chat UI (**43**); conversation-mode storage (**4/4**); and production surface (**21 checks**).

The verification HTTP E2E initially timed out because the deterministic mock-provider process was still subject to the production model RAM floor, so it paused before the correction workflow. The fixture now sets a lower floor only in the mock child process; production ResourceGuard defaults are unchanged. Its current run verifies a real failing Node acceptance command, a targeted edit, and a successful retest. A physical Electron launch and fresh package build were not run at a 0.62-GiB-free-memory sample. The current package remains stale and must not be presented as a current-source release.

### 2026-11-06 smoke-pipeline refresh

After repairing the isolated OpenAI dependency fixture, switching core and atomic smoke commands to `tsx`, and updating the current SWE-bench preflight message assertion, `npm.cmd run test:smoke` completed with exit code 0. All 17 subcommands passed (131 tests, 0 failures). The retained output is `.quillix-smoke/test-smoke-roadmap-2026-11-06.log`. This verifies local contract suites only; it does not refresh the 581-test Vitest result, current-source local-model matrix, or packaged launch evidence. The old package remains rejected by the source-fingerprint check, and the current v7 matrix remains unrun.

## 2026-11-07 stale patch rebase regression

A focused review tested whether a stale modification patch can land on the wrong duplicate function. In the constructed case, `PatchEngine.applyPatch` applied the intended first-function change and preserved a concurrent second-function edit. The hypothesized misapplication was not reproduced, so production code was left unchanged. Added an exact-output regression for this safely contextualized rebase in `src/server/__tests__/agent.test.ts`. Focused Vitest passed 1/1 and `npm.cmd run lint` passed. This covers the demonstrated case only; it does not establish behavior for every ambiguous repeated-hunk layout.

## 2026-11-07 benchmark comparison repeat gate

Found that `compare-benchmark.mjs` accepted one-run summaries as `COMPARABLE`, although the model-matrix artifact contract requires at least three repeated trials. The comparator now rejects fewer than three complete repetitions per case and reports that requirement explicitly. Updated comparison fixtures and added one- and two-repeat rejection cases. Verification: `npm.cmd run test:benchmark-compare` passed 8/8; `npm.cmd run test:benchmark-artifact-contract` passed 7/7; `npm.cmd run test:benchmark-contract` passed 1/1; `npm.cmd run lint` passed.

The live `.quillix-smoke/ollama-model-matrix.json` is dated 2026-11-04 and has no v7 protocol field and only six cases; `npm.cmd run test:benchmark-artifact` therefore fails its current-source freshness contract. Current free RAM sampled during this work was 1.54 GiB, below the recorded 1.75-GiB smallest-model and 2.00-GiB packaging floors. No live matrix or installer rebuild is claimed.

## 2026-11-07 pass-rate uncertainty reporting

Extended the benchmark comparator to require at least three complete repeats per case and to report descriptive 95% Wilson intervals for pass rates. If the two intervals overlap, the pass-rate row is marked `inconclusive`; the JSON output explicitly says the intervals are not a significance test and repeated trials on the same cases are correlated. The interval helpers are isolated in `scripts/smoke/benchmark-statistics.mjs` for direct tests.

Verification: `npm.cmd run test:benchmark-compare` passed 12/12, including known interval values, low-sample overlap/inconclusive behavior, and separated-interval direction. `npm.cmd run test:benchmark-artifact-contract` passed 7/7; `npm.cmd run test:benchmark-contract` passed 1/1; `npm.cmd run lint` passed. The live matrix remains stale (2026-11-04, missing v7 protocol metadata, six cases); the latest RAM sample was 1.54 GiB, so no live local-model run or installer rebuild is claimed.

## 2026-11-07 public SWE-bench online attempt and timeout recovery

Prepared public instance `django__django-10914` from SWE-bench Lite against pinned Django base commit `e7fd69d051eaa67cb17f172a39b57253e9cb831a` in an isolated shallow checkout. The NUVRO AI Universal run used the saved NVIDIA endpoint and model `minimaxai/minimax-m3.1-flash`. It ended after about 80 seconds with one model call, zero output characters, no patch, and `officialGrade: NOT_GRADED`; this is a failed attempt, not a benchmark score. A separate saved-provider tool-call probe also timed out at its 45-second deadline. Docker is not installed, so official SWE-bench grading is unavailable on this machine.

The run exposed an error-reporting defect: `AgentEngine` treated any provider error containing “cancelled” as a user abort even when the caller signal was not aborted. Cancellation now follows only the caller's actual abort signal, preserving provider timeout errors as failures. The focused `codingWorkflow.test.ts` run passed both the new provider-timeout regression and the existing real-abort regression (2 passed, 37 skipped); `npm.cmd run lint` passed. Retry the public task when the saved online endpoint responds. No Cursor software was downloaded or installed.

A follow-up Claude Code CLI review recommended asserting the persisted task status, not only the thrown timeout. The regression now also verifies the task is recorded as `failed` with provider-failure text. Re-ran the focused timeout/real-abort cases: 2 passed, 37 skipped; `npm.cmd run lint` passed again.

Claude Code CLI also created `scripts/smoke/fetch-swebench-task.mjs`, a one-task manifest fetcher that filters the Hugging Face row to task metadata and writes with exclusive-create semantics. Its comments now accurately state that the API response may contain solution fields transiently, while the manifest never stores them; extra arguments are rejected. `node --check` and missing/extra-argument checks passed. A live fetch attempt returned HTTP 500 from the Hugging Face search endpoint, so no manifest was written by the helper; the benchmark result above remains the only NUVRO AI attempt and remains ungraded.

## 2026-11-07 Universal timeout cause and race diagnostics

Separated caller cancellation from provider inactivity/total deadlines in `UniversalProvider`. The first abort source now wins for both the returned error and diagnostics, even when the caller aborts immediately after a timeout. Internal errors include timeout class and duration; caller aborts retain a cancellation-specific error. Retry policy was not changed.

Added assertions for total timeout, short inactivity timeout, already-aborted caller, cancellation during rate-limit wait, and the timeout-then-caller-abort race. Focused `universalProvider.test.ts` passed 61/61; `npm.cmd run lint` passed. The real configured NVIDIA endpoint and Hugging Face search API have not been re-probed after this change, so no live model task pass is claimed.

The broader `npm.cmd run test:universal` smoke also passed 24/24 after the timeout diagnostics change. The latest RAM sample was 0.55 GiB free, so the extended live task retry is deferred until machine headroom recovers; no user processes were stopped.

## 2026-11-07 current-session regression refresh

Rechecked Claude Code availability before continuing: no active Claude/Node/terminal process or Claude agent was visible in this workspace session. The latest workspace-scoped Claude transcript is the earlier Universal timeout review, which ended before tool edits. A bounded `claude -p` review attempt with explicit `claude-sonnet-4-5` produced no output and was stopped; no user process was stopped. The user's separate interactive terminal is not visible to this session.

Current-source checks passed: `npm.cmd run test:smoke` completed all 17 sequential smoke commands with exit code 0; focused `src/server/__tests__/universalProvider.test.ts` passed 61/61; focused provider-timeout and real-abort cases in `codingWorkflow.test.ts` passed 2/2 (37 skipped); `npm.cmd run lint` passed. The smoke chain includes benchmark preflight/artifact/comparison contracts, resource guard recovery, provider formats, repair budget, atomic writes and Tavily demo. No additional defect was reproduced, so no source edit was needed in this verification turn.

Live cloud benchmark remains unverified: the latest public SWE-bench run returned zero generated characters and no patch, so it is not a score. Current free RAM sampled at 0.53 GiB; live local inference, production build/package and a fresh model matrix were not started. Cursor was not installed.

## 2026-11-07 autonomous repair freshness audit

Rechecked the self-healing path rather than relying only on the smoke `repairBudget` contract. The end-to-end `src/server/__tests__/repairFreshness.test.ts` suite passed 20/20 in 88.55 seconds. This covers edit-first public repairs, stale read/edit recovery, targeted symbol search, destructive-write recovery, acceptance-command selection, and invalidation of verification after later source edits. No failure or unsafe acceptance path was reproduced, so no production behavior was changed. Current free RAM after this suite remains below the recorded 2-GiB live-model/package floor; Claude Code and Ollama still have no active process in this session.
