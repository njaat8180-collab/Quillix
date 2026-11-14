# QUILLIX — BENCHMARK EVIDENCE

**Rule:** only real, reproducible numbers. Never invent Cursor numbers; never
call a mock a benchmark.

## Harness present in this repository

| Artifact | Purpose | Command |
|---|---|---|
| `scripts/smoke/coding-benchmark.ts` | Per-model coding benchmark (phases, independent checks, repair phase) | `npm run benchmark:coding` / `benchmark:acceptance` |
| `scripts/smoke/ollama-model-matrix.ts` | 3-model × 7-case × 3-repeat matrix → `.quillix-smoke/ollama-model-matrix.json` | `npm run benchmark:matrix` |
| `scripts/smoke/compare-benchmark.mjs` | A/B two benchmark runs (protocol v7) | `npm run benchmark:compare` |
| `scripts/smoke/report-public-benchmark.mjs` | Public comparison report | `npm run benchmark:public-reference` |
| `src/server/__tests__/benchmarkComparison.test.ts` | Comparison-logic unit tests | `npm test` |

## Status (2026-11-08)

- **Blocked:** `test:benchmark-artifact` — the committed artifact is stale and
  regeneration requires **live local Ollama** (`qwen2.5-coder:1.5b`,
  `qwen2.5-coder:3b`, `qwen3:4b`). Ollama is unreachable in this environment.
  Producer/contract verified coherent via `npm run benchmark:matrix --dry-run`
  (3 models × 7 cases × 3 repeats).
- **Known limitation (disclosed):** the deterministic fake-DOM
  `website-behavior-check` is not a substitute for headless-browser interaction
  testing.
- **Cursor baseline:** **NOT COLLECTED.** No Cursor telemetry exists in this
  workspace, so no Cursor success-rate or speed figure is claimed anywhere.

## Planned reproducible tasks (Cursor comparison, phase P4)

A comparison must pin: model/config, case set, independent verifier, attempt
count, environment (hardware key/OS/arch), and the same verifier for both sides.

1. `greeting-module` — trivial new-file generation (baseline).
2. `async-retry` — small semantic repair with retry/backoff.
3. `backend-refactor` — multi-file refactor across modules.
4. `python-runtime-repair` — real runtime failure → run → repair.
5. `node-runtime-repair` — real runtime failure → run → repair.
6. `website-continuation-repair` — continue and repair an existing site.
7. `project-prompt-injection-boundary` — safety boundary case.

## Success criteria to record (P4)

- Task success rate per case (pass/total, passRatePercent = 100 required per row).
- Median/p95 duration, model calls, provider-or-estimated tokens, tokens/sec.
- Repair-phase counts and unresolved-repair count.
- Regression counters (behavioral/token-budget/independent-check/browser-check/protected-file/unexpected-file/forbidden-leak).
- Two measurable advantage dimensions vs Cursor, with identical verifier.
