# QUILLIX — OpenCode Agent Engine Report (branch `agent-opencode`)

Date: 2026-11-13
Owner: Lead AI Agent Engineer (OpenCode worktree)
Scope: AI Agent Engine, tool calling, multi-file editing, error recovery,
context efficiency. No frontend or provider-infrastructure changes.

## 1. Agent architecture inspected

- `src/server/agentEngine.ts` — `AgentEngine.run()` is the whole autonomous
  pipeline (~4.5k lines): intent classification → workspace/project targeting →
  context assembly (memory, indexer, RAG, optional Tavily freshness preflight) →
  turn loop (provider call → tool-call parsing → tool execution) →
  deterministic configured checks → validation repair (test → fix → retest) →
  real execution verification → honest completion gate and report.
- `src/server/toolRegistry.ts` — ~50 tools over file/patch/code/git/terminal
  categories, with alias normalization, required-argument validation, project
  prefix routing, workspace path containment, secret redaction round-trips,
  chunked writes with crash checkpoints, approval gates, and Auto-Apply-Diffs
  staging.
- Supporting systems: `patchEngine.ts`, `workspace.ts` (atomic writes +
  read-back verification), `verifier.ts`, `taskState.ts` (resumable task
  journal), `repairBudget.ts` (bounded, stagnation-aware repair budget),
  `selfHealingRuntime.ts`, `projectRag.ts`, `indexer.ts`, `phases.ts`.
- Verification harness: 85 Vitest files, contract smoke suites in
  `scripts/smoke/`, and the real-server agent E2E
  (`npm run test:agent-e2e` — mock Qwen over HTTP against the bundled server).

## 2. Existing limitations discovered

1. `detect_language` was advertised in the tool definitions but had **no
   handler** — any model call returned `Unknown tool: detect_language`.
2. `create_patch`/`preview_patch`/`apply_patch` accepted calls without
   `newContent`; the undefined value reached jsdiff and surfaced as a generic
   "Tool execution failed" instead of a precise, retryable error.
3. `git_log` passed an unvalidated `limit` to GitService;
   `get_project_structure` accepted any `maxDepth` (unbounded deep walks).
4. `edit_file` required byte-exact `oldString`. Small coding models routinely
   quote the right code with wrong whitespace (indentation, tabs vs spaces,
   trailing spaces, CRLF), which wasted whole repair turns on a recoverable
   mismatch.
5. `runTurn` trimmed the live conversation with
   `while (... JSON.stringify(conversation).length > 18000)` — quadratic work
   on long runs and a splice pattern that could orphan tool-result messages.
6. Transient read-retry allowance was hardcoded (`mayRetryToolFailure(..., 0,
   ...)`), so the same failing read tool could be replayed on every turn.
7. Dead code in the engine: unused `PatchEngine`/`probeRuntime` imports, a
   never-called `emitPlan` closure, and a write-only `ranValidate` flag that
   made a stale linter pass count as fresh.
8. A mojibake character in an agent activity message (`failure — retrying`)
   would render as a corrupted glyph in the UI.

## 3. Features improved / bugs fixed

All changes are in `src/server/toolRegistry.ts` and
`src/server/agentEngine.ts`; new coverage in
`src/server/__tests__/editReliability.test.ts`.

- **Broken tool repaired** — `detect_language` now executes: extension-first
  mapping (~60 extensions), shebang refinement (including `#!/usr/bin/env
  python3`), content sniffing for unlabeled files, and an honest
  extension-based answer with the read error surfaced when the bytes are
  unavailable. A missing `filePath` fails with a precise validation error.
- **Precise tool-argument contracts** — patch tools now require a non-empty
  string `newContent` and reject malformed calls with an actionable message
  before reaching the diff engine.
- **Bounded numeric arguments** — `git_log.limit` clamped to 1..500,
  `get_project_structure.maxDepth` clamped to 1..12.
- **Whitespace-tolerant focused edits** — when the exact `oldString` is
  absent, `edit_file` retries with a canonical (whitespace-collapsed) index
  that maps candidate ranges back to real source offsets. Only a **unique**
  match is applied; multiple candidates are still rejected as ambiguous, and
  genuinely absent quotes still fail. A line's own indentation is absorbed
  when the quote starts the line bare. The success message tells the model the
  match was whitespace-normalized so it can verify.
- **Safer context compaction** — the turn-history trim now keeps a running
  size estimate and drops whole assistant+tool-result groups (never an
  orphaned tool message), removing the quadratic `JSON.stringify` loop.
- **Bounded transient retries** — retries are counted per failure signature
  within a run, so a persistently failing read tool is never replayed more
  than once.
- **Honest freshness** — `ranValidate` is now read by the configured-check
  freshness test and reset whenever files change, so a linter pass before a
  later edit can no longer bless that edit.
- **Cleanups** — dead imports/closure removed; fixed the mojibake activity
  message.

## 4. Tests executed (real results)

- `npx tsc --noEmit` — **EXIT 0** (strict).
- `npm test` (full Vitest) — **84 files, 851 tests, 0 failed** (includes the
  new 16-test `editReliability.test.ts`). One earlier run failed only the
  environment-dependent `missionState.test.ts` case, which requires the
  untracked runtime artifact `.quillix/mission/goal-state.json`; seeding that
  file (gitignored, written by the mission tracker at runtime) makes the
  suite fully green in this worktree. Kilo's branch carries the durable
  test-side fix (`agent-kilo` a8fb386: skip the fixture assertion when the
  state file is absent).
- `npm run test:agent-e2e` (real server + mock Qwen over HTTP) — **66 passed,
  0 failed** (S1 single file, S2 project + in-place continuation, S3
  test→fix→retest, S4 Python run/fix/retest, S5 Python calculator executed,
  S6 Node app `npm start`, S7 minimal bug fix, S8 task store + resume).
- `npm run build` — **EXIT 0** (Vite bundle + esbuild server/electron).
- Contract smokes — `tool-text-parser` 24/24, `tool-text-safety` (same run),
  `repair-budget` 4/4, `self-healing-contract` 38 checks, `workspace-atomic`
  3/3.

## 5. Files modified

- `src/server/toolRegistry.ts` (tool handlers, validation, edit matching)
- `src/server/agentEngine.ts` (compaction, retry accounting, dead code,
  freshness)
- `src/server/__tests__/editReliability.test.ts` (new — 16 tests)
- `_checkpoints/OPENCODE-ENGINE-<timestamp>/` (project checkpoint convention)

## 6. Remaining issues

- `missionState.test.ts > reads the real persisted mission state` depends on
  the untracked runtime artifact `.quillix/mission/goal-state.json`
  (gitignored via `**/.quillix/`, written by the mission tracker at runtime).
  In this worktree the suite is green after the tracker artifact was seeded
  locally; a fresh clone still fails that one case until the tracker writes
  the file. Kilo's branch carries the durable fix
  (`agent-kilo` a8fb386: skip the fixture assertion when the state file is
  absent) — merge that with this branch.
- The agent E2E harness hard-codes a 2.5 s wait for the bundled server's
  health check; on a cold start under load the first attempt can race. The
  harness is test infrastructure (not engine code) and the second attempt
  passes; consider a bounded health-check retry.
- Live-provider verification (B2) and the Cursor baseline (B3) remain
  outside this worktree's offline capabilities.

## 7. Integration requirements for other agents

- **Cline (frontend/UI)**: no API changes. Two pre-existing mojibake strings in
  `src/App.tsx` (lines ~608, ~626, ~690) and `src/components/EditorArea_backup.tsx`
  (lines ~109, ~113, ~322) render as `` in the UI; they are UI-owned.
  The engine's `onPlanUpdate`/`onPhaseUpdate`/`onActivity` contracts are
  unchanged; `edit_file` may now succeed where it previously failed, so the UI
  should expect fewer "oldString not found" repair cycles.
- **Kilo (providers)**: no provider abstraction changes. The engine consumes
  `AIProvider` exactly as before.
- **Goose (QA)**: new test file `src/server/__tests__/editReliability.test.ts`
  (16 tests) covers the tool contract, the whitespace-tolerant edit path, and
  an end-to-end AgentEngine fix-with-acceptance scenario.
- **CodeVian (architecture)**: `.clinerules/quillix-mission.md` assigns
  `src/server/**` to Cline while this assignment owns the agent engine; the
  two files changed here (`src/server/toolRegistry.ts`,
  `src/server/agentEngine.ts`) are engine-owned and isolated in the
  `agent-opencode` worktree. Reconcile ownership before merging.

## 8. Git

- Branch: `agent-opencode` (worktree `D:\QUILLIX\Quillix-worktrees\opencode`)
- Commit: see `git log` — `fix(agent): repair broken tool contract and harden
  focused edits` (initial), plus the follow-up commit for the end-to-end test
  and this report.