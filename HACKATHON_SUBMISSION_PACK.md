# NUVRO AI Hackathon Submission Pack

**Evidence refresh:** 6 November 2026  
**Internal submission target:** 12 November 2026 (user-requested)  
**Official prototype deadline:** 15 November 2026 ([Global AI Hackathon event page](https://geekroom-mu.vercel.app/event/global-ai-hackathon), rechecked 6 November)  
**Engineering roadmap:** [200-hour NUVRO AI quality roadmap](QUILLIX_200_HOUR_ROADMAP.md)
**Recording guide:** [4–5 minute demo script](QUILLIX_DEMO_SCRIPT_12NOV.md)

This document is the reproducible demo and evidence checklist for the unified
token-efficient coding agent and Tavily stale-answer verification build.

## One-line pitch

NUVRO AI is a brain/body coding agent: the body safely inspects, edits, runs and
repairs real projects, while the brain can be Ollama offline or a compatible
online provider. Tavily is used selectively as a freshness oracle for
version-sensitive coding claims, then the final answer is checked against the
retrieved evidence.

## Demo path

1. Start NUVRO AI with `npm run dev` or open the packaged Windows build.
2. In Settings, configure a coding brain and optionally save a Tavily key.
3. Open the `Active Provider + Tavily API Health` panel. It shows only the
   active coding provider plus `Tavily API · verification`; tests never display
   keys.
4. Run an ordinary coding request such as “Create a REST API endpoint”. This
   path does not call Tavily.
5. Run a freshness-sensitive request such as “Check the current React API
   documentation before implementing this integration”. NUVRO AI performs a
   bounded Tavily preflight, uses official sources as context, then performs a
   final-answer freshness comparison and cites the trusted URLs.
6. Turn on Offline Mode and repeat the freshness request. The result is an
   explicit offline fallback and no Tavily network request.
7. For a stale-code repair, approve the file change, let NUVRO AI run the
   configured check, and show the corrected source plus the passing retest.

## Evidence commands

```powershell
npm run benchmark:acceptance
npm run benchmark:compare -- <quillix-summary.json> <baseline-summary.json>
npm run benchmark:tavily
npm run demo:tavily
npm run test:live-tavily
npm run test:acceptance:all
```

The live command requires a Tavily key in Windows DPAPI storage or the
session-only `TAVILY_API_KEY` environment variable. Never commit that value.
The deterministic demo and benchmark do not spend Tavily credits.

## Current verified evidence

Historical report counts below this section are not current acceptance results.
The most recent full acceptance report recorded 24/24 suites, 52 Vitest files /
467 tests, Agent E2E 66/66, the 3-model local coding matrix 18/18, Electron
browser interactions, packaged debugger checks, and a 5 November Windows
installer of 170,800,684 bytes (SHA-256
`D2484C1CE9759E092FCB969DB8149EEF1B11025E994C7EEC5ACAAC53F436DC66`). That
installer is now stale relative to source and unsigned.

Current-source verification on 6 November passed `npm.cmd test` after the
project-memory trust-boundary change and a test-fixture correction (55 files /
581 tests), `npm.cmd run lint`, `npm.cmd run build`, and
`npm.cmd run test:backend:e2e` (all HTTP checks). Earlier, the two focused
context/agent regression files passed 26/26 after the reviewer-prompt wrapper.
A fresh portable Windows package was built from current source
(743,496,219 bytes); `npm.cmd run test:release-artifact` and
`npm.cmd run test:packaged-static` passed at that source revision. A later
project-memory trust-boundary change made the artifact fingerprint stale, and
the current `test:release-artifact` run now correctly rejects it. Do not
distribute it; rebuild after source changes. NSIS packaging failed with Windows
`spawn UNKNOWN`, so the package script used its portable fallback. Both app and
package are unsigned. The previous EXE SHA-256 is
`A8A57E66DDF1E40D48E56F44BBA18A6378A7C889C2EFDE693F286D6F7E47F3F1`.
Packaged launch/browser/debugger checks remain pending. The failed NSIS attempt
left undersized `Setup` EXE and blockmap residuals; they have been removed.
Fallback packaging now removes such a generated pair only after a successful
portable build while preserving full-size installers; the regression passed
4/4.

The previous NSIS installer is stale and cannot serve as the release candidate.
The refreshed portable artifact is at `release/windows/NUVRO AI 1.2.0.exe`;
it has passed fingerprint/artifact and static package checks. The signature
checker and Windows Authenticode inspection report `NotSigned`; packaged launch
acceptance has not passed. A fresh local model case
also paused safely when free RAM fell to 1.90–1.93 GiB, below its 2.00-GiB
ResourceGuard floor.

The current local smoke pipeline was rerun on 6 November after correcting its
isolated TypeScript fixtures and stale preflight assertion. All 17 smoke
subcommands passed (140 tests total, 0 failures; exit code 0); the retained log
is `.quillix-smoke/test-smoke-roadmap-2026-11-06-schema3.log`. This covers provider,
workspace, storage, benchmark-contract and demo smoke checks, but does not
replace the full Vitest suite, live local-model matrix, or packaged-app launch
acceptance.

The broader bug sweep also passed Agent E2E (66/66), token-efficiency/RAG
checks (35/35), offline plugins, Sarvam mock HTTP, verification HTTP, mock
provider protocol matrix (4/4), package-resource preflight (2/2), website
behavior, settings health, preview UI, chat UI, conversation-mode storage, and
the 21-check production-surface contract. The deterministic verification HTTP
fixture now lowers only its mock process's ResourceGuard threshold, so low
host RAM does not prevent that test from reaching its mocked model; production
ResourceGuard defaults are unchanged. A physical Electron launch was not run
at the 0.62-GiB-free-RAM sample.

The deterministic Tavily demo was also rerun on 6 November. Claim extraction,
contradiction classification, approval, targeted correction and `node --check`
all passed. Its report now records zero actual searches, extracts, credits and
cost, with the simulated 1-search/1-extract fixture activity separated in
`simulatedOperations`.

Added `npm.cmd run test:tavily-demo` to the smoke-test pipeline. Its focused
contract passed 1/1, asserting both the zero real usage and separately labeled
fixture operations.

The 6 November public Axios task record reports a verified one-file repair and
5/5 independent native reproduction checks, with 2,381 provider-reported
tokens and 5.865 seconds. It is a focused public-task reproduction, not an
official SWE-bench grade. A separate Laguna-backed Axios attempt is recorded
as `NOT_GRADED`; neither result is a Cursor comparison. See
[`PUBLIC_CURSOR_COMPARISON.md`](PUBLIC_CURSOR_COMPARISON.md) and the dated
entries in [`QUILLIX_PHASE1_STATUS_2026-11-04.md`](QUILLIX_PHASE1_STATUS_2026-11-04.md).

The historical 3-model / 18-run local matrix covers the prior six-case,
single-trial protocol. The current benchmark protocol is v7 and requires 3
models × 7 cases × 3 repetitions (63 runs across 21 unique conditions), adding an adversarial project-context injection case with a fake
secret canary, protected files, and an independent verification command. That
expanded live matrix has not yet run; do not reuse the old 18/18 count as its
result. Summary schema v3 separately reports successful-run quality and all-
attempt latency, token/model-call percentiles, repair-phase outcomes, and
regression counts. It identifies provider-reported, mixed, estimated, zero-call,
and unaccounted token attempts; the matrix gate rejects incomplete accounting.
The comparison CLI rejects missing or stale summary schemas. Matrix artifacts
also validate matching protocol, summary,
evaluator-contract, and case-set fingerprints for every model.

## Internal submission checklist for 12 November

- [x] Check official schedule: Global AI Hackathon prototypes are due 15
  November; 12 November is the earlier internal target requested for this
  project. The public page does not show the detailed problem descriptions or
  full judging rubric.
- [ ] Confirm the submission form, exact rubric, and required artifacts with
  the organizer or private problem-statement document.
- [ ] Refresh the full acceptance gate on current source, including a focused
  regression after the final reviewer-prompt update and a fresh local-model run
  when RAM is above its floor.
- [ ] Rebuild the final-source portable Windows package and pass artifact and
  packaged-static checks. The previous portable output is stale after the
  latest trust-boundary update and fallback cleanup change.
- [ ] Produce an NSIS installer and verify current packaged launch, browser
  interactions, and debugger acceptance.
- [ ] Decide whether the event requires code signing; the current portable app
  and package are unsigned and must not be described as signed.
- [ ] Run the demo from a clean workspace and capture the final recording.
- [x] Prepare a timed demo script that separates live coding evidence from the
  deterministic Tavily fixture walkthrough.
- [x] Run the deterministic Tavily demo and confirm its artifact reports zero
  actual credit usage.
- [x] Include setup instructions, product architecture and runtime AI/data-flow
  disclosure, benchmark provenance, and known limitations in this pack and its
  linked evidence.
- [ ] Complete organizer-specific disclosure of development-time AI tools and
  human contribution from the actual team workflow.
- [ ] Verify the complete pre-existing-code timeline, any prior hackathon
  submission, and reused-code extent against team records before submitting.
- [ ] Submit the final package and retain the exact source/artifact hashes.

The full 200-hour improvement program is tracked separately; 200 focused hours
cannot fit between 6 and 12 November. This checklist is the near-term internal
target, ahead of the official 15 November prototype deadline, not a claim that
the 200-hour roadmap is complete.

## Architecture disclosure

- Brain adapters: Ollama, Sarvam, OpenAI Responses, Grok, Groq and Universal
  OpenAI-compatible/Anthropic/Gemini protocols.
- Body: bounded retrieval, focused tool schemas, workspace sandboxing, atomic
  writes, staged approvals, rollback, project memory, LSP/debugger/plugins,
  real command execution and verification loops.
- Tavily layer: official `@tavily/core` Search + Extract, DPAPI key storage,
  official-source ranking, claim classification, cache, retry/rate-limit
  handling, usage/cost history, offline blocking and final-answer postflight.

## AI use and data-flow disclosure

NUVRO AI is itself an AI coding agent. At runtime, the operator selects a model
profile: Ollama for local inference, or a configured online provider such as
OpenAI, Sarvam, Grok, Groq, or a compatible endpoint. Online requests send the
prompt and task context needed for that provider call to the selected service;
local Ollama inference is served by the user's local Ollama installation.
Provider credentials use the application's protected storage path on Windows.
NUVRO AI does not silently borrow credentials from another provider or fall
back from an explicitly selected local profile to cloud inference. Tool
actions that require approval remain subject to the app's approval flow.

The hackathon form may separately request disclosure of development-time AI
tools and human contribution. That provenance is not inferable from the
product architecture; complete it from the actual team workflow before
submission rather than inventing an attribution here.

## Pre-existing work and reuse disclosure

This is an existing NUVRO AI product, not a project built from scratch after
the Global AI Hackathon problem statements opened on 1 November. The available
workspace identifies NUVRO AI v1.2.0 with an `2026-10-12` checkpoint; the
existing product scope includes its Windows Electron application, provider
adapters, coding-agent tools and approvals, project retrieval/memory, editor,
preview/debugger, bounded repair/retest, and Windows packaging. Those existing
product components are reused by this submission. The 6 November roadmap,
smoke-evidence refresh, and Tavily demo/evaluation work are documented as
dated updates, not as the origin of the product.

HackCulture's Code of Conduct asks teams submitting reused code or resubmitting
a prior hackathon project to disclose the earlier use and its extent. The
available workspace cannot prove whether this project was entered in another
hackathon, nor provide a complete file-by-file creation timeline. Before
submitting, the team must confirm both points and add any previous event names,
dates, and reused/new component breakdown required by the form. Do not describe
this entry as a new build or claim all code was written in the problem window.
Policy: [HackCulture Code of Conduct](https://hackculture.io/legal/code-of-conduct).

## Honest submission gaps

The public event page does not publish the detailed six-problem statement or a
complete judging rubric, so the supplied problem guide remains separately
attributed in `HACKATHON_REQUIREMENTS_MAPPING.md`. A public submission form,
team details and final demo recording still need to be supplied externally.
An external same-task Cursor baseline is also not claimed because NUVRO AI does
not control Cursor's runtime or telemetry.

### External baseline protocol

When a baseline environment is available, run the same five task prompts on a
fresh workspace with the same model family and record: completion rate,
independent-check pass rate, provider input/output tokens, tool-call count,
wall-clock duration, files changed, and repair attempts. Report median and p95
for each metric. A baseline is only comparable if both agents receive the same
prompt, workspace seed, acceptance command, and network/offline policy; do not
infer a Cursor result from NUVRO AI telemetry or compare unverified demos. For
NUVRO AI benchmark artifacts, retain both the case-set fingerprint and the
evaluator-contract fingerprint; reports with a missing or mismatched evaluator
contract are not comparable.
