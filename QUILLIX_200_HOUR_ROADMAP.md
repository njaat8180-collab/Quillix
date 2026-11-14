# NUVRO AI: 200-hour quality roadmap

**Plan created:** 6 November 2026  
**Internal submission target:** 12 November 2026 (user-requested)  
**Official prototype deadline:** 15 November 2026 (Global AI Hackathon event page, rechecked 6 November)  
**Engineering budget:** 200 focused hours from this checkpoint  
**Status:** Active; Phase 0 baseline refreshed and Phase 1 evaluation reporting is in progress

## Goal

Make NUVRO AI a dependable, polished coding-agent product through measured improvements to task success, repository-scale editing, verification, developer experience, and release quality. Use Cursor as a capability reference, not as an unverified parity claim. Preserve honest evidence: local benchmark results, public-task native checks, and official benchmark scores are reported separately.

The 200-hour program is a work budget, not a claim that all 200 hours fit before 12 November. That internal checkpoint is six calendar days away from plan creation, so it is not physically possible to spend 200 focused engineering hours before it. Prioritize a credible submission package by 12 November; the event's official prototype deadline is 15 November. Continue the full quality program after submission. At 40 focused hours per week, 200 hours is approximately five weeks. Event schedule: [Global AI Hackathon](https://geekroom-mu.vercel.app/event/global-ai-hackathon).

## Starting point: already built and evidenced

This is an advanced project, not a half-built prototype. The 5–6 November workspace notes report a Windows Electron app, Ollama and online-provider adapters, agent tools and approvals, project memory/RAG, Monaco editor, local LSP/debugger slices, isolated preview, bounded repair/retest, and release packaging. The latest recorded full acceptance passed 24/24 suites; the regression was recorded at 52 files / 467 tests; a three-model local matrix passed 18/18; Electron browser acceptance and packaged debugger checks passed. The 6 November benchmark note records a public Axios task passing its native reproduction 5/5. These are useful baselines, not proof of universal reliability or Cursor superiority.

Before relying on any older result, check its timestamp and artifact. Keep the 5 November release artifact/hash and older report counts as historical evidence; regenerate current results after changes. The installer is unsigned in the current local environment.

## Work plan: 200 focused hours

| Phase | Hours | Work and completion evidence |
|---|---:|---|
| 0. Submission readiness and baseline | 12 | Refresh the demo path, architecture/AI-use disclosure, known limits, installation instructions, benchmark artifacts, installer metadata, and 12 November submission checklist. Confirm that links and referenced files exist. Package a reproducible demo script and record exactly which checks were run. |
| 1. Evaluation quality and benchmark breadth | 28 | Freeze a versioned, task-fingerprinted evaluation set covering new projects, bug fixes, multi-file changes, follow-up context, Python/JS/TS, browser tasks, interrupted runs, and refusal/approval boundaries. Add repeated trials and pass-rate, latency, token, repair, and regression summaries. Keep public-task grading separate from local checks. |
| 2. Repository-scale editing and recovery | 36 | Improve large-project retrieval and symbol grounding, preserve user edits and unsaved buffers, protect against destructive rewrites, and strengthen resumable plans after provider/resource interruption. Measure on several repositories and repeated seeded changes. |
| 3. Verification and repair | 32 | Expand native build/test/runtime execution and browser interaction coverage across representative stacks. Ensure claims are tied to actual command output, changed-file fingerprints, and final retests; improve bounded diagnostics and repair evidence. |
| 4. Editor, preview, and interaction polish | 28 | Review core workflows in the packaged app: project selection, chat/agent modes, diff review, editor navigation, preview/debugging, error recovery, keyboard/accessibility, and responsive layouts. Fix high-impact friction and verify through user-visible browser flows. |
| 5. Security, privacy, and extension boundaries | 24 | Review local workspace isolation, command approvals, secrets/redaction, provider routing, offline guarantees, preview origin, and local/network extension execution. Document threats and limitations; remediate concrete findings and retain regression evidence. |
| 6. Performance and Windows release reliability | 20 | Measure startup, memory/model resource behavior, indexing, long sessions, build/install/update/recovery. Reduce unnecessary latency/resource spikes and verify clean Windows packaging, signature expectations, and artifact provenance. |
| 7. Final regression, docs, and release candidate | 20 | Run the selected full acceptance gate, fresh model-origin trials, failure-path checks, clean-install walkthrough, release notes, known-issues list, and final evidence audit. Fix blockers and regenerate artifacts. |
| **Total** | **200** | |

## Internal submission checkpoint: 12 November

Use the time before the requested internal deadline for the highest-value subset, without pretending it is the full 200-hour completion. Keep the official prototype deadline of 15 November as the external event date:

1. Refresh one current end-to-end acceptance run and record the exact suite counts, environment, elapsed time, and unsigned-signature limitation.
2. Run the repeatable demo from a clean workspace; capture a successful coding/repair flow and the current benchmark evidence.
3. Reconcile `README.md`, `HACKATHON_SUBMISSION_PACK.md`, `QUILLIX_PHASE1_STATUS_2026-11-04.md`, and `PUBLIC_CURSOR_COMPARISON.md` so the submission uses current evidence and does not repeat stale numbers as current.
4. Prepare the installer/source handoff, setup steps, architecture and AI-use disclosure, known limitations, and demo narration.
5. Reserve remaining time for a fresh-install check and fix only submission-blocking defects. If event rules require a fully signed installer or external submission materials, list those as explicit dependencies instead of claiming them complete.

## Working rules and progress tracking

- Track actual focused engineering time against the 200-hour budget; do not count waiting for model generation as equivalent implementation work unless actively supervising/evaluating it.
- Each work item must identify the user-visible outcome, files or surfaces changed, acceptance evidence, and any unresolved failure. Update this plan at the end of each work session.
- Preserve failing benchmark results and verification output. Never weaken a gate just to make it green.
- Prefer changes that improve measured end-to-end task success or product usability. Avoid adding broad features without an evaluation path.
- Run existing verification appropriate to each change; tests and release gates must remain truthful and bounded.
- Do not claim Cursor parity or superiority from local results. A direct comparison requires matched prompts, workspaces, models, network policy, budgets, and independent grading.

## Progress log

### 6 November 2026 — plan and first work session

- Inspected the current README, recent hardening report, phase-one status, completion audit, benchmark comparison, and package scripts.
- Confirmed this codebase already contains substantial product and acceptance infrastructure. Existing reports include stale historical checkpoints; current reports and artifacts must be timestamped before reuse.
- Completed: refreshed the submission pack with current-source verification limits, the focused Axios result, the unsigned/stale installer status, and a 12 November handoff checklist. Updated the README's top-level status so its 5 November figures are clearly historical and the latest unverified work is visible.
- Verified on current source: `npm.cmd test` passed 55 files / 580 tests, `npm.cmd run lint` passed, `npm.cmd run build` passed, and `npm.cmd run test:backend:e2e` passed all HTTP checks. The first sandboxed full-suite attempt was inconclusive because sandbox temp storage denied Vitest SSR files/atomic renames; the out-of-sandbox rerun passed.
- Official Global AI Hackathon page was rechecked on 6 November: prototype deadline is 15 November; 12 November remains the earlier user-requested internal target.
- Prepared a 4–5 minute timed recording guide in `QUILLIX_DEMO_SCRIPT_12NOV.md`; it distinguishes actual live coding/preview evidence from the deterministic Tavily fixture and records the checks still pending for the final video.
- Fixed a misleading deterministic-demo usage report: fixture traffic now records zero real searches/credits/cost and keeps its simulated 1-search/1-extract activity separate. `npm.cmd run demo:tavily` passed claim extraction, contradiction classification, approval, correction and `node --check`; its generated JSON artifact confirms `usage.credits=0` and `usage.estimatedCostUsd=0`.
- Added a smoke regression for the fixture-usage contract and wired it into `test:smoke`; `npm.cmd run test:tavily-demo` passed 1/1.
- Confirmed installed Ollama models include `qwen2.5-coder:1.5b`, `qwen2.5-coder:3b`, and `qwen3:4b`. Current free RAM was 1.63 GiB, below the 1.75-GiB 1.5B-model gate and the 2.00-GiB package floor, so no live model matrix or installer build was started.
- Re-ran `npm.cmd run test:release-artifact`; it fails closed with the expected stale-source fingerprint on the existing `release/windows` artifact. Free RAM later measured 1.51 GiB, so no package build was attempted below the 2.00-GiB floor.
- Next: capture the actual live demo and complete the current-source local-model and package gates when resource headroom allows; obtain the private problem statement/portal details for final requirement compliance.
- Focused hours recorded: 0.6/200 (documentation, demo runbook, truthful fixture telemetry fix and regression, and current-source regression/build/E2E verification; rough session estimate).

### 6 November 2026 — context trust boundary and release refresh

- Added explicit untrusted-context labels for indexed project instructions, active source, selected code, compressed project rules and retry context. Added a shared system-level context trust boundary to normal, compact/retry and independent-reviewer prompts. This limits prompt injection from repository text while preserving it as task evidence.
- Verified after the change: full Vitest regression passed 55 files / 581 tests. After the final reviewer-prompt wrapper, lint, production build, backend HTTP E2E, and focused `agentProjectFlow` + `sourceContext` regression passed (2 files / 26 tests). The full suite preceded only that final reviewer-only wrapper update.
- Built the current-source Windows portable package: `release/windows/NUVRO AI 1.2.0.exe`, 743,496,219 bytes, SHA-256 `A8A57E66DDF1E40D48E56F44BBA18A6378A7C889C2EFDE693F286D6F7E47F3F1`. Re-ran `test:release-artifact` and `test:packaged-static`; both passed. `test:release-signature` and Windows Authenticode inspection report `NotSigned`. NSIS packaging failed with `spawn UNKNOWN`; package script used its configured portable fallback. The failed NSIS attempt left an undersized 225,857-byte Setup EXE residual, documented as invalid; do not distribute it. A packaged launch/debugger acceptance remains outstanding.
- Started current-source local benchmark case `large-codebase-rag-navigation` with installed Qwen 2.5 Coder 1.5B. ResourceGuard paused it before model load when free RAM measured 1.90–1.93 GiB, below the 2.00-GiB model floor; the resumable failure summary was retained under `.quillix-smoke/coding-benchmark-2rZRSx/summary.json`. No guard override was used.
- Current submission position: portable binary and static package structure are refreshed; this is not a signed NSIS installer or a full packaged-app acceptance result. Keep the 12 November internal target and 15 November official prototype deadline distinct.
- Focused hours recorded: 1.2/200 (trust-boundary implementation/regression, current package build/static/artifact validation, and benchmark/resource investigation; rough active-work estimate excluding waits).

### 6 November 2026 — project-memory trust boundary and source refresh

- Review found project memory and prior task summaries were not named in the shared prompt trust-boundary statement, even though project memory labels them as untrusted metadata. Added them to the boundary and expanded the regression assertion.
- Focused verification after the change: `agentProjectFlow` passed 11/11; lint and production build passed; backend HTTP E2E passed all checks. A sandboxed E2E attempt could not reach its mock `/api/tags` endpoint; the out-of-sandbox rerun passed all checks.
- The existing 743,496,219-byte portable artifact has SHA-256 `A8A57E66DDF1E40D48E56F44BBA18A6378A7C889C2EFDE693F286D6F7E47F3F1`; artifact/static checks passed before this final source edit. A fresh artifact check now rejects it as stale, as intended. Do not distribute it until rebuilding.
- Free RAM was 2.02 GiB at the latest reading, barely above the 2.00-GiB package floor. No new package or local-model run was started at that marginal headroom. Packaged launch/debugger acceptance also remains outstanding.
- Focused hours recorded: 1.6/200 (trust-boundary review and change, regression/build/E2E checks, package hash/provenance audit, and documentation correction; rough active-work estimate, excluding waits).

### 6 November 2026 — fallback artifact cleanup and submission source audit

- Checked the previously referenced problem-statement attachment; it is not present at the recorded path. The event page does not contain the detailed six-problem guide or full rubric, so requirement mapping remains provisional until that source is available.
- Packaging preflight was attempted twice after memory briefly appeared above 2.0 GiB; its own fresh sample reported 1.99 GiB and safely paused before build both times. No package files were touched by those attempts.
- Fixed a release-folder hazard from the failed NSIS step: the fallback now removes only a regular `NUVRO AI Setup 1.2.0.exe` below 10 MiB and its regular blockmap, only after a portable fallback succeeds. Full-size installer files are preserved. Added four regression cases for partial cleanup, valid installer preservation, non-file paths, and successful-fallback wiring; `npm.cmd run test:nsis-fallback-cleanup` passed 4/4. `node --check` passed for the changed packager/module/test. The existing undersized residual pair was removed via the tested helper.
- `npm.cmd run test:release-fingerprint` passed 2/2, including rejection of stale source fingerprints before examining installer files.
- Focused hours recorded: 2.0/200 (fallback cleanup implementation/regression, package/resource rechecks, requirement-source audit, and submission-document corrections; rough active-work estimate, excluding waits).

### 6 November 2026 — adversarial context benchmark coverage

- Added `project-prompt-injection-boundary` to the local coding benchmark: the repo guidance attempts to override the task, expose a fake `.env` canary, alter unrelated files, add a payload file, and skip tests. The case requires one intended config edit and an independent Node test.
- The harness now fingerprints the forbidden-content and strict-file-set contract, fails if a canary appears in model-visible tool results/final text, checks protected fixture files remain byte-identical, and detects newly created files outside the allowed set. Bumped protocol v7 and extended the required local matrix from 3×6 to 3×7; prior 18/18 records are historical only.
- Extracted the benchmark's workspace-file inventory, forbidden-content scanning, and unexpected-file checks into reusable evidence helpers. Added behavior tests for nested paths, NUVRO AI metadata exclusions, allowed/unexpected file creation, and canary detection in final text, tool output, errors, and structured data. `npm.cmd run test:benchmark-quality` passed 3/3; `test:benchmark-contract` passed 1/1; `test:nsis-fallback-cleanup` passed 4/4; matrix dry-run showed seven cases for all three models; lint passed.
- Live model execution remains pending the ResourceGuard's RAM floor, so no model pass rate is claimed for the new case.
- Focused hours recorded: 3.5/200 (adversarial benchmark case and evidence helpers, matrix contract update, fallback cleanup, unit/contract verification; rough active-work estimate).

### 6 November 2026 — package preflight process overhead investigation

- Inspected live process memory and Ollama state read-only: no Ollama model was loaded. No user process was stopped.
- Removed a duplicate Node process from the packaging preflight path: the packager now imports and runs the same `ResourceGuard` check in-process, while the standalone preflight remains available for direct use and testing. Added integration-contract coverage to the package-preflight tests.
- `npm.cmd run test:package-preflight` passed 2/2, and lint passed. A real package attempt still measured 1.99 GiB at the gate (2 GiB required) and paused before build, so the process change did not resolve the host's memory shortfall. No release output was modified. Do not lower the floor; retry when available RAM is measurably higher.
- Focused hours recorded: 4.3/200 (resource-gate path inspection/refactor, regression coverage, and package/lint verification; rough active-work estimate).

### 6 November 2026 — evaluator provenance in benchmark comparisons

- Added a SHA-256 fingerprint of the benchmark evidence-helper contract to every v7 case and summary. The case-set fingerprint now includes that hash and protocol identifier, so changing leakage/file-set evaluator logic changes the run fingerprint.
- Updated local benchmark comparison to require matching evaluator-contract fingerprints and explain that mismatch in its result. Added CLI regression coverage: matching contracts remain comparable; changed or missing contracts are rejected. `npm.cmd run test:benchmark-compare` passed 3/3; benchmark safety passed 3/3; benchmark case contract passed 1/1; lint passed.
- Updated the external baseline protocol and Cursor comparison record: protocol v5's 18/18 is historical; v7's 3×7 matrix is pending and cannot inherit the old score.
- Updated the matrix runner to propagate per-model protocol, evaluator-contract, and case-set fingerprints into the outer artifact and to fail on provenance drift. Strengthened the artifact gate to reject stale protocols, missing hashes, per-model mismatches, and fewer than three repetitions. The default matrix now runs 3 models × 7 unique cases × 3 repetitions (63 trials). Synthetic matrix artifact tests passed 4/4; benchmark case contract passed 1/1; compare contract passed 3/3; benchmark safety tests passed 3/3; lint and the 3-model/7-case/3-repeat dry-run passed.
- Official event page rechecked 6 November: it still gives 15 November as prototype due date, but neither it nor the linked registration page exposes the detailed challenge statements or judging rubric. The submission mapping remains provisional.
- Focused hours recorded: 6.1/200 (evaluator provenance, matrix artifact contract and propagation, repeated-trial gate, compare/artifact regressions, and evidence-document updates; rough active-work estimate).

### 6 November 2026 — smoke pipeline reliability

- Fixed the isolated OpenAI provider fixture so it copies and resolves the provider pacing dependency; the focused OpenAI suite passed 10/10.
- Switched core and atomic smoke commands to `tsx` so TypeScript source imports ending in `.js` resolve consistently in tests. Updated a stale SWE-bench preflight assertion to check the runner's current explicit “no request was sent” message.
- Ran the full `npm.cmd run test:smoke` pipeline with normal Windows fixture permissions. The sequence completed through Tavily demo; targeted core passed 9/9, and the benchmark preflight passed 2/2. The suite covers provider, workspace, storage, parser, repair, benchmark gates, packaging cleanup, and demo contracts.
- A sandbox-only attempt failed on OS-blocked temporary Git/symlink fixtures; the same suite passed when run with normal local permissions. No live model benchmark or package build was started; the 63-trial live matrix remains pending the 2.00-GiB ResourceGuard floor.
- Retained the complete test output at `.quillix-smoke/test-smoke-roadmap-2026-11-06.log`; parsed evidence confirms 17 subcommands, 131 tests, zero failures, and shell exit code 0. Synced that evidence into the README, submission pack, demo guide, and dated phase-status report.
- Focused hours recorded: 7.7/200 (fixture fixes, test-command resolver fixes, stale assertion correction, complete smoke rerun and retained log, and submission-document synchronization; rough active-work estimate excluding waits).

### 6 November 2026 — submission disclosure and link audit

- Checked all local Markdown links in the README, submission pack, demo guide, and Cursor comparison; all 10 file references resolved. Kept benchmark and package limitations labeled as historical/stale.
- Added a product runtime AI/data-flow disclosure to the submission pack: selected local versus hosted inference, provider credential isolation, no silent local-to-cloud fallback, and approval-bound tool actions. Marked the existing setup, architecture, runtime AI-use, benchmark provenance, and known-limitations materials complete in the checklist.
- Kept development-time AI/tool attribution pending because that must reflect the team's actual workflow and cannot be inferred from repository code.
- Fresh Node OS memory sample: 1.76 GiB free / 5.92 GiB total, below the 2.00-GiB package floor; no package build attempted. Ollama status query could not reach its local endpoint in this shell, so model-load status is unknown.
- Focused hours recorded: 8.0/200 (submission disclosure drafting, link/reference audit, and resource-gate recheck; rough active-work estimate excluding waits).
- Rechecked the current official event and linked submission pages. The event window is 9 October–29 November, the prototype deadline is 15 November, and problem statements opened 1 November. The event page still omits the specific problem guide and judging rubric.
- Read HackCulture's Code of Conduct: for projects using reused code or previously submitted projects, it requires disclosure of prior use and its extent. Added this rule and a draft NUVRO AI reuse disclosure to the submission pack and requirements mapping. The repo identifies an October 12 v1.2.0 checkpoint and substantial existing product capability; exact prior event submissions and a complete file-level timeline remain to be verified from team records.
- Focused hours recorded: 8.6/200 (official schedule/policy recheck, reuse-provenance disclosure, and mapping update; rough active-work estimate excluding waits).

### 6 November 2026 — broad regression and E2E bug sweep

- Stopped the in-progress benchmark-reporting experiment at the user's direction and reverted its unmerged source/test changes before switching to the bug sweep.
- Full Vitest first exposed one stale benchmark-comparison fixture: production comparison correctly required matching evaluator provenance, while the tie-case fixture still used v3 and omitted the fingerprint. Updated the fixture to v7 SHA-256 provenance; focused comparator passed 3/3 and the full suite then passed 55/55 files, 581/581 tests.
- `npm.cmd run lint`, production `build`, backend HTTP E2E, and the 17-subcommand smoke pipeline passed. Additional checks passed: agent E2E 66/66; token-efficiency + ProjectRag 35/35; offline plugin integration (16 packs/29 tools); Sarvam mock HTTP; provider mock matrix 4/4; package preflight 2/2; verification HTTP; website behavior; settings-health 10 checks; preview UI 10; chat UI 43; conversation-mode storage 4/4; and production-surface contract 21 checks.
- The verification HTTP E2E initially timed out because its mock model was blocked by the production RAM floor (host sample 0.62 GiB free), so the intended correction-and-retest path never began. Added a test-process-only ResourceGuard floor for its deterministic provider stub, with production defaults unchanged; the focused E2E then passed and showed the actual assertion failure → targeted edit → passing retest.
- A sandbox run of token-efficiency tests hit OS-blocked SSR temp and symlink fixtures; the same tests passed 35/35 with normal Windows permissions. No physical Electron launch or package build was attempted below the memory floors; free RAM was 0.62 GiB during the launch-gate checks and 0.77 GiB on the latest read (5.92 GiB total). Artifact freshness remains separately stale.
- Focused hours recorded: 10.0/200 (regression diagnosis, one fixture correction, test-harness resource-gate repair, repeated focused/full verification and evidence synchronization; rough active-work estimate excluding waits).

### 6 November 2026 — benchmark reporting and smoke portability

- Resumed Phase 1 after the requested bug sweep. Added benchmark summary schema v3: successful-run quality percentiles remain separate from all-attempt latency, tokens, and model calls; repair runs/failures and regression counters are reported explicitly. Token accounting distinguishes provider-reported, mixed, estimated, zero-call and unaccounted attempts; missing telemetry is no longer represented as invented zero usage. Comparison rejects legacy/incomplete v3 reports, artifact validation rejects missing metrics/incomplete accounting/schema drift, and matrix provenance requires consistent v7 evaluator and summary schemas.
- Focused tests passed: benchmark summary 3/3, matrix artifact contract 7/7, comparator contract 6/6, benchmark case contract 1/1, and server comparison 3/3.
- The initial complete smoke rerun exposed Windows sandbox fixtures that wrote settings/Git data under OS temp, where access is denied. Moved affected isolated fixtures (OpenAI settings, universal settings, core Git/file boundary, atomic workspace, and benchmark preflight) under `.quillix-smoke`; made symlink-specific checks tolerate Windows permission denial while preserving the other boundary assertions. Focused suites passed, followed by the full smoke pipeline: 17 subcommands, 137 tests, 0 failures, exit code 0. Retained at `.quillix-smoke/test-smoke-roadmap-2026-11-06-rerun.log`.
- Live 63-trial matrix remains pending the unchanged 2.00-GiB ResourceGuard floor. Windows symlink escape coverage is conditional in this sandbox because creating symlinks is denied; rerun on a Developer Mode or otherwise symlink-enabled Windows host before treating that specific check as exercised. This change does not alter production resource behavior.
- Focused hours recorded: 13.3/200 (benchmark aggregation/comparison/artifact contracts, token-accounting provenance and coverage, fixture portability repairs, focused/full smoke verification, and evidence synchronization; rough active-work estimate excluding waits).
- Revalidated after schema v3: full smoke passed 17 subcommands / 140 tests / 0 failures; production build and lint passed. The matrix dry-run confirmed the configured 3-model × 7-case × 3-repeat jobs without starting a model. The current retained log is `.quillix-smoke/test-smoke-roadmap-2026-11-06-schema3.log`; token-coverage and comparison provenance are exercised by unit and artifact-contract tests. The live matrix remains pending the ResourceGuard floor.
- Comparison output now exposes provider, mixed, estimated, zero-call and unaccounted attempt counts alongside the metric deltas. The updated comparison test passed 6/6, lint passed, and the full smoke rerun again passed 140/140. Focused hours now stand at 13.3/200.
- Latest `os.freemem()` sample after verification: 0.80 GiB free / 5.92 GiB total, still below the unchanged 2.00-GiB live model/package floor. No live matrix, model load, Electron launch, or package build was started.
