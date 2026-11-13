# Global AI Hackathon mapping

Audit date: 2026-11-06

## Source status

- Event page: <https://geekroom-mu.vercel.app/event/global-ai-hackathon>
- Registration page linked by the event page: <https://hackculture.io/hackathons/ai-global-hackathon>
- The official event page ([Global AI Hackathon](https://geekroom-mu.vercel.app/event/global-ai-hackathon), checked 2026-11-06) lists the event as 9 October–29 November, says prototypes are due 15 November, and judging is 29 November. The user requested 12 November as this project's internal target, which is earlier than the published deadline.
- The official page exposes the schedule, partners and submission window but not the detailed six-problem descriptions or a complete judging rubric. The detailed problem mapping was attributed to a user-provided guide at `C:\Users\nakul\.codex\attachments\e4dea85b-35a8-45d0-b4f2-496173a60a79\Pasted text.txt`, but that attachment is not present at the recorded path in this workspace. Treat the selected-problem mapping below as provisional until the guide or organizer rubric is available. Search results for other Nebius/Tavily events were not merged because they are separate events with different rules.
- HackCulture's [Code of Conduct](https://hackculture.io/legal/code-of-conduct), which applies to hackathons and event projects, requires disclosure of the extent of reused code or prior hackathon submissions. NUVRO AI has an October 12 version checkpoint and was substantially developed before the November 1 problem-statement release. The submission pack now contains a reuse disclosure; prior event submissions and precise timeline/component attribution still require confirmation from the team records.

## Selected problem mapping

| Requirement from the supplied guide | NUVRO AI implementation | Evidence |
| --- | --- | --- |
| Bifrost: Token-Efficient Coding Agent | Bounded retrieval, focused tool schemas, provider usage telemetry, context/token budgets, rate-limit cooldowns, local fallback, and coding benchmark reports | `src/server/agentEngine.ts`, `src/server/qwen.ts`, `scripts/smoke/coding-benchmark.ts`, `npm test` |
| Tavily: Stale-Answer Detector | Official `@tavily/core` Search + Extract, secure key storage, source ranking, claim extraction, per-claim finding/confidence/citations, aggregate freshness score, cache and usage telemetry | `src/server/tavilyVerification.ts`, `src/components/SettingsScreen.tsx`, `npm run benchmark:tavily` |
| Evidence dashboard | Settings panel displays result, freshness score, claims, cited sources, suggested action and usage; `Active Provider Health` shows only the currently selected coding brain with live status, model and latency | `src/components/SettingsScreen.tsx`, Electron browser acceptance |
| Correction workflow | Version-sensitive agent preflight supplies Tavily evidence; normal approval-gated write → test → fix → retest workflow remains authoritative | `src/server/agentEngine.ts`, `src/server/__tests__/agentProjectFlow.test.ts`, backend E2E |
| Complete end-to-end demonstration | Deterministic fixture demo runs claim extraction → official contradiction → approval → code correction → real syntax retest and emits a JSON evidence report; the release gate also runs the optional credential-safe live smoke | `npm run demo:tavily`, `npm run test:live-tavily`, `.quillix-smoke/tavily-hackathon-demo.json` |
| Offline safety | Offline Mode returns an explicit `offline` result and never contacts Tavily | `src/server/tavilyVerification.ts`, `npm run test:backend:e2e` |
| Token/cost efficiency | Freshness gate ignores ordinary API implementation prompts, caps automatic Tavily queries at 500 characters, and preserves the 15-minute cache; the active-provider health test avoids testing unrelated credentials | `src/server/agentEngine.ts`, `src/components/SettingsScreen.tsx`, `src/server/__tests__/agentProjectFlow.test.ts` |

## Historical acceptance evidence (2 November)

- `npm run test:acceptance:all`: **16/16 suites passed** on 2026-11-02.
- Full Vitest regression: **44 files / 384 tests passed**.
- Windows NSIS packaging, Electron browser interaction, and packaged debugger acceptance passed.
- Direct packaged Electron accessibility inspection confirmed `Active Provider + Tavily Health`, the selected `Groq` row, the `Tavily · verification` row, and the `Test active + Tavily` action are rendered in Settings.

## Current-source checkpoint (6 November)

- `npm.cmd test`: 55 files / 581 tests passed (out-of-sandbox Windows run; before final reviewer-prompt wrapper). After that wrapper, focused agent/context regression passed 26/26.
- `npm.cmd run lint`: passed.
- `npm.cmd run build`: passed for renderer, server, Electron main and preload.
- `npm.cmd run test:backend:e2e`: all checks passed.
- After adding project memory and prior task summaries to the context trust boundary, focused agent regression passed 11/11; lint, production build and backend HTTP E2E passed. The prior portable package (743,496,219 bytes; SHA-256 `A8A57E66DDF1E40D48E56F44BBA18A6378A7C889C2EFDE693F286D6F7E47F3F1`) is now stale and `test:release-artifact` rejects it. Rebuild and rerun artifact/static checks. NSIS failed with `spawn UNKNOWN`; the previous portable fallback was unsigned. Packaged launch/debugger acceptance is pending. The undersized NSIS residuals were cleaned; the new fallback cleanup regression passed 4/4.
- A fresh local Qwen 1.5B benchmark paused at 1.90–1.93 GiB free RAM, below the 2.00-GiB ResourceGuard floor. The full 3-model live matrix remains unverified on current source. The 5 November NSIS installer is stale.
- Benchmark protocol v7 now runs the 3×7 matrix three times (63 live runs across 21 unique conditions), adding an adversarial repo-guidance injection case, fake canary leakage check, byte-preserved files, strict new-file detection, and independent Node verification. Summary schema v3 reports all-attempt latency/token/model-call costs, repair outcomes and regression counts separately from successful-run metrics; it distinguishes provider-reported, mixed, estimated, zero-call and unaccounted token usage, and the artifact gate rejects incomplete accounting. Comparison requires matching v7 evaluator provenance and schema v3. Focused summary tests passed 3/3, artifact-contract tests 7/7 and comparator tests 6/6; live execution is pending the model RAM floor. The earlier 18/18 artifact is from the old six-case, single-trial matrix.

## Explicit remaining gaps

1. `npm run test:live-tavily` is ready for the live Tavily-key demonstration, but a measured production accuracy/cost sample still requires the user's API key and real public claims; synthetic benchmarks are not a substitute for that live evidence.
2. The public event page does not publish the detailed six-problem statement or complete judging rubric, so final submission-specific compliance cannot be marked verified until the organizer's private/linked problem document is available.
3. External Cursor comparison is not claimed: NUVRO AI has internal token/correctness benchmarks, but a reproducible same-task Cursor baseline has not been run.
4. A submission package still needs the final demo video, public repository/submission form, team details, and AI-tool disclosure when the organizer's submission portal is available.
5. Before submission, confirm any previous hackathon entries and the full reused-code extent. HackCulture's code-of-conduct disclosure rule makes an unsupported “built from scratch during the challenge” claim unsafe; the current pack instead discloses NUVRO AI as an existing product and flags the missing team-history details.

The gaps above are deliberately recorded rather than treated as completed by inference.
