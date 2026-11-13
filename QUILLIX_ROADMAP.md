# QUILLIX ROADMAP

**Generated:** 2026-11-08 (from real repository audit)  
**Baseline:** 617/617 Vitest tests passing (58 files), TypeScript clean, Turbo Speed wired (Home + Studio), benchmark tie fix applied  
**Last full acceptance:** 24/24 suites (2026-11-05) — 467/467 regression, Agent E2E 66/66, HTTP E2E, browser E2E, packaged debugger, fresh NSIS, packaged-static  
**Evidence sources:** `QUILLIX_COMPLETION_AUDIT.md` (2026-11-02), `QUILLIX_PHASE1_STATUS_2026-11-04.md` (2026-11-05), `QUILLIX_200_HOUR_ROADMAP.md` (13.3/200 focused hours recorded)

---

## EXECUTIVE SUMMARY

NUVRO AI is an **advanced, substantially implemented AI coding agent** — not a prototype. The codebase already contains:

| Area | Status | Evidence |
|------|--------|----------|
| **Agent engine** | ✅ Production | `agentEngine.ts`, `toolRegistry.ts` (2124 lines), `taskState.ts` (681 lines) — multi-step plan→inspect→edit→test→fix→retest with resume/recovery |
| **Repository indexing & RAG** | ✅ Production | `indexer.ts` (337 lines), `sourceContext.ts` (229 lines), `projectRag.ts` (451 lines) — focused context, scoped project context, task context, file evidence |
| **Multi-file edits & diff approval** | ✅ Production | `patchEngine.ts`, `editTargets.ts`, `workspace.ts` — atomic writes, conflict-safe rollback, approval gates |
| **Terminal, Git, debugging** | ✅ Production | `terminal.ts` (251 lines), `git.ts`, `nodeDebugger.ts`, `languageRunners.ts` — integrated terminal, Git workflows, Node debugging |
| **Provider infrastructure** | ✅ Production | `universal.ts` (1011 lines) — Retry-After, circuit breaker, adaptive pacing, request serialization, RPM/TPM budgets |
| **Turbo/Eco/Balanced modes** | ✅ Wired | `providerPacing.ts` — 1s/1s/4s/6s intervals (TurboSpeed aligned to Turbo profile to stay inside free-tier RPM limits); **UI now wired to TopHeader (Home) + WorkbenchLayout (Studio)** |
| **UI / Workspace** | ✅ Production | `WorkspaceView.tsx` (774 lines), `WorkbenchLayout.tsx` — explorer, search, Git, build, debug, terminal, editor, agent panel |
| **Security / Keys** | ✅ Production | `encryptedKeyPool.ts`, DPAPI storage, offline mode, provider routing |
| **Tests & Gates** | ✅ Production | 602 Vitest tests, 16/16 safe acceptance, 24/24 full acceptance, smoke pipeline 140 tests |

**Open evidence gaps (from audit):**
1. Live cloud-provider acceptance pending user credentials
2. Local model matrix (3 models × 5 cases) is bounded — broader reliability needs larger samples
3. Cursor comparative baseline not collected (no Cursor telemetry in workspace)

---

## MILESTONES (CHECKLIST)

Each milestone has: **ID**, **Title**, **Acceptance Test**, **Status** (⬜ = not started, 🔄 = in progress, ✅ = verified), **Files/Surface**, **Notes**.

---

### M0: ROADMAP & BASELINE (this document)
- **Acceptance:** `QUILLIX_ROADMAP.md` exists; all baseline commands pass
- **Status:** ✅ **COMPLETE** (this write)
- **Commands:**
  - `npm run lint` → EXIT 0
  - `npm test` → 602/602 passed
  - `npm run build` → EXIT 0

---

### M1: REPOSITORY UNDERSTANDING & SEARCH (Core)

| ID | Title | Acceptance Test | Status | Files |
|----|-------|-----------------|--------|-------|
| M1.1 | Symbol-precise retrieval (JS/TS/Python/Rust/Go) | `npm run test:benchmark-quality` passes; indexer follows imports, `mod`, `use` | ✅ | `indexer.ts`, `sourceContext.ts`, `projectRag.ts` |
| M1.2 | Focused context retrieval (task-scoped) | `getFocusedContext`, `getTaskContext` return ≤N files with evidence | ✅ | `indexer.ts:120-200` |
| M1.3 | Cross-file edit grounding | Multi-file backend refactor case passes independent verification | ✅ | Benchmark case `multi-file-backend-refactor` |
| M1.4 | **Live codebase Q&A (chat)** | Ask "where is X defined?" → returns file:line with snippet | ✅ (API) | `codebaseQa.ts`, `server.ts` (`/api/codebase/answer`), `apiBridge.ts`, `__tests__/codebaseQa.test.ts` |
| M1.5 | **Incremental re-index on save** | Edit file → symbol index updates within 2s without full rebuild | ✅ | `projectRag.ts` (`invalidate()` / `status()`), `server.ts`, `apiBridge.ts`, `agentEngine.ts` |
| M1.6 | **Search across history (Git)** | `git log --oneline -p \| grep` integrated into search panel | ⬜ | `WorkspaceView.tsx`, `git.ts` |

---

### M2: MULTI-FILE EDITS & DIFF APPROVAL (Core)

| ID | Title | Acceptance Test | Status | Files |
|----|-------|-----------------|--------|-------|
| M2.1 | Atomic multi-file write with rollback | `npm run test:atomic` passes; conflict-safe rollback on failure | ✅ | `workspace.ts`, `patchEngine.ts` |
| M2.2 | Diff preview in editor (side-by-side) | Editor shows unified diff; accept/reject per hunk | ✅ | `WorkspaceView.tsx`, `editor` |
| M2.3 | **Batch approve/reject** | "Approve all" / "Reject all" for multi-file changeset | ✅ | `approvalBatch.ts`, `server.ts`, `apiBridge.ts`, `WorkbenchLayout.tsx`, `__tests__/approvalBatch.test.ts` |
| M2.4 | **Undo last changeset** | Ctrl+Z reverts entire agent changeset atomically | ⬜ | `taskState.ts`, `workspace.ts` |
| M2.5 | **Edit conflict detection** | Concurrent user edit + agent edit → merge dialog | ⬜ | `workspace.ts`, `editor` |

---

### M3: TERMINAL, GIT, DEBUGGING, TESTS (Core)

| ID | Title | Acceptance Test | Status | Files |
|----|-------|-----------------|--------|-------|
| M3.1 | Integrated terminal with agent awareness | Terminal shows agent commands; "Send to agent" context menu | ✅ | `WorkspaceView.tsx`, `terminal.ts` |
| M3.2 | Git workflow: diff, commit, push, PR | "Stage all", "Commit", "Push" buttons in Git panel | ✅ | `WorkspaceView.tsx`, `git.ts` |
| M3.3 | Node debugging (breakpoints, inspect) | F5 launches debug; variables, call stack, watch work | ✅ | `nodeDebugger.ts`, `languageRunners.ts` |
| M3.4 | **Auto-run tests on save** | Configure `test:watch` → results in Build panel | ⬜ | `WorkspaceView.tsx`, `languageRunners.ts` |
| M3.5 | **Test failure → agent auto-repair** | Failed test → agent proposes fix → re-runs → passes | 🔄 | `agentEngine.ts`, `verifier.ts` |
| M3.6 | **Git bisect assist** | "Find breaking commit" → agent runs bisect with test | ⬜ | `git.ts`, `agentEngine.ts` |

---

### M4: TASK PLANNING, CANCELLATION, RESUME/RECOVERY (Core)

| ID | Title | Acceptance Test | Status | Files |
|----|-------|-----------------|--------|-------|
| M4.1 | Visible agent plan/timeline | Plan panel shows steps: ☐ inspect → ☐ edit → ☐ test → ☐ fix | ✅ | `WorkbenchLayout.tsx`, `agentEngine.ts` |
| M4.2 | Task cancellation (mid-flight) | "Stop" button halts provider call, rolls back partial edits | ✅ | `agentEngine.ts`, `taskState.ts` |
| M4.3 | Resume after crash/restart | Reload app → "Resume last task" restores plan + context | ✅ | `taskState.ts`, `projectMemory.ts` |
| M4.4 | **Checkpoint / snapshot** | "Save checkpoint" → named restore point with diff | ⬜ | `taskState.ts`, `sourceArchive.ts` |
| M4.5 | **Branch per task** | New task → auto-create `quillix/task-<id>` branch | ⬜ | `git.ts`, `agentEngine.ts` |
| M4.6 | **Interruption recovery (provider quota)** | 429 → auto-switch to local Ollama → continue | ✅ | `universal.ts` (router fallback) |

---

### M5: API / PERFORMANCE — PROVIDER SCHEDULING & BUDGETS (API/Perf)

| ID | Title | Acceptance Test | Status | Files |
|----|-------|-----------------|--------|-------|
| M5.1 | RPM/TPM budgets per provider | `universal.ts` enforces `requestsPerMinute`, `tokensPerMinute` | ✅ | `universal.ts`, `providerProfiles.ts` |
| M5.2 | Retry-After header handling | 429/503 with `Retry-After` → honors delay (≤60s) | ✅ | `universal.ts:providerResetMs()` |
| M5.3 | Circuit breaker (3 failures → 30s open) | 3 consecutive 5xx → pauses endpoint 30s | ✅ | `universal.ts:noteProviderServerFailure()` |
| M5.4 | Request serialization per endpoint | `providerSlotQueues` serializes concurrent calls | ✅ | `universal.ts` |
| M5.5 | **Adaptive pacing (token-bucket)** | `noteProviderPacing()` adjusts interval from remaining | ✅ | `universal.ts` |
| M5.6 | **Prompt deduplication cache** | Identical prompt hash → returns cached response (TTL) | ⬜ | `universal.ts`, `providerStream.ts` |
| M5.7 | **Parallel independent work** | Independent sub-tasks → concurrent provider calls | ⬜ | `agentEngine.ts`, `universal.ts` |
| M5.8 | Error taxonomy (401/402/403/404/429/5xx) | Each maps to typed `ProviderError` with recovery hint | ✅ | `providerErrors.ts`, `universal.ts` |

---

### M6: SPEED MODES — ECO / BALANCED / TURBO (API/Perf + UI)

| ID | Title | Acceptance Test | Status | Files |
|----|-------|-----------------|--------|-------|
| M6.1 | `getEffectiveProviderIntervalMs()` logic | Eco=6000ms, Balanced=4000ms, Turbo=1000ms, TurboSpeed=1000ms (~60 RPM burst ceiling; free-tier safe) | ✅ | `providerPacing.ts` |
| M6.2 | Turbo Speed UI in TopHeader (Home) | Zap button toggles `turboSpeedMode`; shows TURBO pulse | ✅ | `TopHeader.tsx`, `index.css` |
| M6.3 | Turbo Speed UI in WorkbenchLayout (Studio) | Same button synced; state persists in settings | ✅ | `WorkbenchLayout.tsx`, `App.tsx` |
| M6.4 | **Settings panel: Eco/Balanced/Turbo selector** | Radio group persists `performanceMode`; updates interval live | ⬜ | `SettingsScreen.tsx`, `settings.ts` |
| M6.5 | **Per-provider override in UI** | Saved provider profile limits + pricing editable in UI | ✅ | `SettingsScreen.tsx`, `src/components/ProviderProfiles.tsx` |
| M6.6 | **Turbo respects provider limits** | When provider returns 429, Turbo backs off → not hammer | ✅ | `universal.ts` (circuit + cooldown) |

---

### M7: CREATIVE UI — QUILLIX SIGNATURE EXPERIENCE (UI/UX)

| ID | Title | Acceptance Test | Status | Files |
|----|-------|-----------------|--------|-------|
| M7.1 | Command Palette (Ctrl+Shift+P) | Opens in Studio; fuzzy search commands; keyboard nav | ✅ | `WorkbenchLayout.tsx` |
| M7.2 | Resizable workspace (editor/agent/terminal) | Drag dividers persist widths; mobile tabs | ✅ | `WorkbenchLayout.tsx`, `WorkspaceView.tsx` |
| M7.3 | **Developer Cockpit (unique)** | Single view: plan timeline + live tokens + file tree + diff + terminal | ⬜ | New component |
| M7.4 | **Contextual chat (inline in editor)** | Hover line → "Ask about this" → chat bubble anchored to line | ⬜ | New component |
| M7.5 | **Live performance monitor** | Top bar: tokens/sec, cost, latency, RPM, queue depth | 🔄 | `TopHeader.tsx`, `universal.ts` |
| M7.6 | **Task history / timeline** | Sidebar: past tasks with outcome, duration, files touched | ⬜ | `projectMemory.ts`, new UI |
| M7.7 | **Integrated search (cmd+P / cmd+Shift+F)** | File search + symbol search + grep unified | ✅ | `WorkspaceView.tsx` |
| M7.8 | **Preview pane (live reload)** | Isolated iframe with responsive presets, error overlay | ✅ | `WorkspaceView.tsx`, `previewSession.ts` |
| M7.9 | **Animations & polish (motion/react)** | Smooth panel transitions, loading skeletons, micro-interactions | ✅ | `animations/`, `TopHeader.tsx` |
| M7.10 | **Keyboard-first: every action reachable** | No mouse-only workflows; full ARIA labels | 🔄 | All components |

---

### M8: VALIDATION — BASELINES, BENCHMARKS, BUILDS (Validation)

| ID | Title | Acceptance Test | Status | Files |
|----|-------|-----------------|--------|-------|
| M8.1 | TypeScript strict mode clean | `npm run lint` → EXIT 0, zero errors | ✅ | `tsconfig.json` |
| M8.2 | Unit/Integration tests pass | `npm test` → 602/602 | ✅ | `vitest.config.ts` |
| M8.3 | E2E tests pass | `npm run test:backend:e2e`, `test:agent-e2e` → all pass | ✅ | `scripts/smoke/` |
| M8.4 | **Windows build (NSIS + portable)** | `npm run package:win` → signed installer + portable .exe | 🔄 | `scripts/smoke/package-win.mjs` |
| M8.5 | **Electron browser E2E** | `npm run test:electron-browser` → DOM, interaction, console clean | ✅ | `scripts/smoke/electron-browser-e2e.cjs` |
| M8.6 | **Packaged debugger acceptance** | `npm run test:packaged-debugger` → breakpoints, inspect work | ✅ | `scripts/smoke/packaged-debugger-acceptance.mjs` |
| M8.7 | **Coding benchmark (local models)** | `npm run benchmark:coding` → 5 cases × 3 models × 3 reps | 🔄 | `scripts/smoke/coding-benchmark.ts` |
| M8.8 | **Benchmark comparison (Wilson)** | `npm run benchmark:compare` → tie/inconclusive/better | ✅ | `scripts/smoke/compare-benchmark.mjs` |
| M8.9 | **Add missing test coverage** | Coverage ≥80% on `agentEngine`, `universal`, `indexer`, `workspace` | ⬜ | `__tests__/` |

---

### M9: FINAL HARDENING — BUG FIXES, RECOVERY, EDGE CASES (Final)

| ID | Title | Acceptance Test | Status | Files |
|----|-------|-----------------|--------|-------|
| M9.1 | **Settings migration / versioning** | Legacy no-version file → normalized + `version` stamped, zero field loss; corrupt → defaults; newer-version safe; `settingsMigration.test.ts` (6) PASS | ✅ | `src/server/settings.ts`, `src/shared/types.ts`, `src/server/__tests__/settingsMigration.test.ts` (new) |
| M9.2 | **Corrupt index recovery** | Corrupt JSON / outdated `version` / structurally-invalid / deleted `.quillix/rag-index.json` → rebuild; `projectRagRecovery.test.ts` (4) PASS | ✅ | `projectRag.ts` (`loadIndex`), `src/server/__tests__/projectRagRecovery.test.ts` (new) |
| M9.3 | **Provider key rotation** | Expired key → prompt → re-verify → continue | ⬜ | `encryptedKeyPool.ts`, `SettingsScreen.tsx` |
| M9.4 | **Offline mode guarantee** | Offline=ON → zero network requests (verified by test) | ✅ | `settings.ts`, `universal.ts` |
| M9.5 | **Large file handling (>1MB)** | Edit 5MB file → no OOM, diff works, save works | ⬜ | `patchEngine.ts`, `workspace.ts` |
| M9.6 | **Concurrent workspace safety** | Two NUVRO AI instances same folder → lock + notify | ⬜ | `workspace.ts` |
| M9.7 | **Memory leak audit** | 4hr session → no RSS growth >200MB baseline | ⬜ | `resourceGuard.ts`, Electron |
| M9.8 | **Accessibility (WCAG AA)** | Screen reader, keyboard, contrast, focus visible | 🔄 | All components |
| M9.9 | **Error boundary + crash reporter** | Uncaught error → modal with "Restart", "Recover", "Copy crash report"; `npm run test:crash-boundary` PASS | ✅ | `src/components/CrashBoundary.tsx` (new), `src/main.tsx` |
| M9.10 | **Installer signing (production)** | `package:win` → Authenticode signed; SmartScreen clean | ⬜ | `scripts/smoke/package-win.mjs` |

---

### M-TURBO-1: UNIFY HOME DASHBOARD TURBO TOGGLE ONTO PERSISTED GLOBAL STATE

- **Acceptance:** Every Turbo surface routes through `handleTurboSpeedToggle` → `api.updateSettings`; `npm run test:turbo-global-state` passes and FAILS on pre-fix code; `tsc` + `chat-ui`/`production-surface`/`preview-ui`/`settings-health` contracts green.
- **Status:** ✅ **COMPLETE** (2026-11-08)
- **Root cause (real bug):** `DashboardView` Home Turbo toggle called `onSettingsChanged` → local `setSettings` only — never persisted to `~/.quillix/settings.json`, never applied server-side, reverted on reload. Desynced from the header/Studio controls that correctly use the persisted path.
- **Fix:** Added `onToggleTurboSpeed` prop to `DashboardView`; `App.tsx` passes `handleTurboSpeedToggle`; toggle routes through the persisted global state (safe local fallback retained for isolated use).
- **Files:** `src/App.tsx`, `src/components/DashboardView.tsx`, `scripts/smoke/turbo-global-state-contract.mjs` (new, wired into `test:smoke`), `package.json`. `src/shared/providerPacing.ts` asserted unchanged.
- **Baseline re-verified this session:** `tsc --noEmit` clean; targeted UI contracts green. Full 602-Vitest suite NOT re-run here (30s command cap) — prior 602/602 checkpoint still stands.
- **No git repo:** edit checkpoints saved under `_checkpoints/<ts>/` (see `_checkpoints/BACKUP_LOG.md`).

---

### M9.9: CRASH BOUNDARY + CRASH REPORTER

- **Acceptance:** `npm run test:crash-boundary` PASS; `tsc --noEmit` clean; `chat-ui`/`production-surface` contracts show no regression from the `main.tsx` wrap.
- **Status:** ✅ **COMPLETE** (2026-11-08)
- **Root cause:** No React error boundary existed — any uncaught render error blanked the whole window with no recovery path.
- **Fix:** `src/components/CrashBoundary.tsx` — class boundary (`getDerivedStateFromError` + `componentDidCatch`) wrapping the whole tree in `main.tsx` (outside `ThemeProvider`, so provider errors are caught too). Recovery screen offers Restart / Recover (clears transient `quillix_*` renderer state, keeps preferences, server settings untouched) / Copy crash report (persisted under `quillix_last_crash`, redacted).
- **Browser-safety (verified):** dependency-free (inline SVG, no `lucide`/`monaco`/`fetch`) and no `node:crypto` / server-redaction import, so it renders even when the app's own module graph is the failure; credentials are scrubbed from crash text.
- **Files:** `src/components/CrashBoundary.tsx` (new), `src/main.tsx`, `scripts/smoke/crash-boundary-contract.mjs` (new, in `test:smoke`), `package.json`.

---

### M9.2: CORRUPT / STALE / DELETED INDEX AUTO-REBUILD

- **Acceptance:** Corrupt JSON, outdated `version`, structurally-invalid, or deleted `.quillix/rag-index.json` → retrieval still works and a valid index is re-persisted; `projectRagRecovery.test.ts` (4) PASS; existing `projectRag.test.ts` (29) no regression; `tsc` clean.
- **Status:** ✅ **COMPLETE** (2026-11-08) — the recovery behavior **already existed** in `loadIndex`; this session added the missing regression tests and corrected the roadmap attribution (owner is `projectRag.ts`, file is `.quillix/rag-index.json`, not `indexer.ts` / `.quillix/index`).
- **Evidence:** `loadIndex` guards `JSON.parse` + `version === RAG_INDEX_VERSION` + `Array.isArray(chunks)`; on any failure it returns `undefined` and `refresh()` rebuilds from source then re-persists via atomic temp+rename. Tests lock all four recovery paths (no user-data risk — the index is a rebuildable cache).
- **Files:** `src/server/projectRag.ts` (unchanged, asserted), `src/server/__tests__/projectRagRecovery.test.ts` (new).

---

## PRIORITY ORDER (next 5 milestones to execute)

1. **M7.3** — Developer Cockpit (unique NUVRO AI differentiator)
2. **M7.4** — Contextual inline chat (killer UX feature)
3. **M7.5** — Live performance monitor (visible Turbo value)
4. **M6.4** — Settings: Eco/Balanced/Turbo selector (completes speed modes)
5. **M9.9** — Error boundary + crash reporter (production hardening)

---

## VERIFICATION CHECKLIST (run after each milestone)

```
☐ npm run lint              # TypeScript strict
☐ npm test                  # 602/602 Vitest
☐ npm run build             # Production build
☐ npm run test:backend:e2e  # HTTP E2E
☐ npm run test:agent-e2e    # Agent E2E
☐ npm run test:smoke        # 140 smoke tests
☐ npm run test:electron-browser  # Browser E2E (if resources)
☐ npm run package:win       # Windows package (if RAM ≥2GiB)
```

---

## EVIDENCE TRACKING

| Milestone | Commit / Date | Test Output / Artifact | Notes |
|-----------|---------------|------------------------|-------|
| M0 | 2026-11-08 | This file | Baseline established |
| M-TURBO-1 | 2026-11-08 | `test:turbo-global-state` PASS (fails on pre-fix code); tsc + chat-ui/production-surface green | Home Dashboard Turbo desync → single persisted global state |
| M6.5 (Kilo) | 2026-11-08 | `test:provider-profile-limits` 11/11 PASS (fails on pre-fix code); tsc clean; `npm test` 617/617; `test:smoke` EXIT 0 | Saved-provider limits/pricing editor in `ProviderProfiles.tsx`; stale `test:universal` copy-list repaired (24/24) |
| M9.8 increment (Kilo) | 2026-11-08 | `test:ui-accessibility` 7/7 PASS; `npm test` 617/617; `test:smoke` EXIT 0 | Icon-only names + history-popover Escape/focus pattern |
| M9.9 | 2026-11-08 | `test:crash-boundary` PASS; tsc green; chat-ui/production-surface no regression | Crash boundary + reporter (self-contained, redacted) wired into `main.tsx` |
| M9.2 | 2026-11-08 | `projectRagRecovery.test.ts` 4/4 PASS; tsc clean; `projectRag.test.ts` 33/33 no regression | Corrupt/stale/deleted RAG index auto-rebuild (behavior existed; tests added) |
| M9.1 | 2026-11-08 | `settingsMigration.test.ts` 6/6 PASS; tsc clean; `universal-settings` smoke 3/3 no regression | Settings versioning + forward-migration; legacy files migrate without data loss |
| M7.5(contract) | 2026-11-08 | `providerPerformanceSummary.test.ts` 5/5; `universalProvider` 61/61 (health added to snapshot, no regression); tsc clean | `summarizeProviderHealth` + `ProviderHealthSummary`; `diagnosticsSnapshot().health` feeds Studio monitor + benchmarks |
| Backend regression | 2026-11-08 | ~573 Vitest tests green across the full `src/server/__tests__/**` (batched + detached); tsc clean; 0 failures | Full fresh backend regression re-verified this session |
| Safe acceptance | 2026-11-08 | lint EXIT 0 · full `npm test` passed · build EXIT 0 · all smoke suites PASS **except** `test:benchmark-artifact` (external) | Full safe acceptance re-run; only the live-Ollama benchmark-artifact gate is externally blocked |
| MISSION-CONTROL | 2026-11-08 | `missionState.test.ts` 15/15 · `test:mission-control` 44 checks (fails without the tracker) · tsc EXIT 0 · build EXIT 0 | Persisted `.quillix/mission/*` goal state + `/api/mission/state` + Studio `MissionControlPanel` + VS Code sidebar extension (dependency-free) + `.clinerules` reload rules |
| Agent E2E (fresh) | 2026-11-08 | `npm run test:agent-e2e` **66/66 PASS** (real server + mock Ollama; S1 single file, S2 project + preview, S3/S4 test→fix→retest, S5/S6 Python+Node execution, S7 bug-fix, S8 task state/resume) | First run had 11 failures traced via SSE to the ResourceGuard RAM floor (environmental), not defects; re-run with `QUILLIX_E2E_MOCK_MIN_FREE_RAM_GIB=0.1` (mock harness only) passes fully |
| Full regression (fresh) | 2026-11-08 | `npm test` **675/675 across 64 files** (0 failures, 351s) | Final re-run: includes missionState (15), projectRagIncremental (7), approvalBatch (7), codebaseQa (11). No drift from any increment |
| M1.5 (incremental index) | 2026-11-08 | `projectRagIncremental.test.ts` **7/7** · `test:rag-incremental` 22 checks (fails without it) · tsc EXIT 0 · build EXIT 0 | Save/delete now drops only that file's cached chunks; one shared `ProjectRag` instance; `status()` proves one edit → one file re-read |
| M2.3 (batch approvals, backend) | 2026-11-08 | `approvalBatch.test.ts` **7/7** · `test:approval-batch` 17 checks (fails without it) · tsc EXIT 0 · build EXIT 0 | Pure decision module + `/api/agent/approvals` + `/api/agent/approvals/batch` + `api.batchResolveApprovals()`; M2.3 milestone still ⬜ pending Kilo's Review UI |
| M2.3 + M1.4 (Cline, Kilo inactive) | 2026-11-08 | `approvalBatch` 22 checks + `codebaseQa` **11/11** + `test:codebase-qa` 19 checks · tsc EXIT 0 · build EXIT 0 · all proven to fail without the change | Studio review bar (Approve all / Reject all, polls only while working, never auto-approves) + codebase Q&A endpoint answering `file:line` + snippet; 2 real matcher bugs fixed during verification |
| Packaging (attempt) | 2026-11-08 | `package:win` preflight → `PAUSED_RESOURCE_GUARD` (free RAM 0.61 GiB < 2.00 GiB floor) | Environmental blocker (B9); no artifact claimed |
| Turbo UI | prior session | `TopHeader.tsx`, `WorkbenchLayout.tsx`, `index.css` | Wired Home + Studio |
| Benchmark tie fix | prior session | `compare-benchmark.mjs:91` | `q === b ? 'tie'` |
| Full acceptance | 2026-11-05 | 24/24 suites, 467/467 tests | Authoritative checkpoint |

---

## KNOWN BLOCKERS (external, not in repo control)

1. **Live cloud provider keys** — Requires user-supplied API credentials
2. **Windows RAM floor (2.00 GiB)** — Package/build paused below threshold (ResourceGuard)
3. **Installer signing** — Requires code signing certificate (not in repo)
4. **Cursor telemetry** — Not available in this workspace for comparative baseline

---

## HOW TO USE THIS ROADMAP

1. **Pick next ⬜ milestone** from Priority Order
2. **Implement** → run Verification Checklist
3. **Update this file**: change status to ✅, add Evidence Tracking row
4. **Commit** with message: `feat: M<id> <title> — <acceptance summary>`
5. **Repeat** until all ✅

> **Principle**: Never claim a milestone ✅ without passing Verification Checklist. Preserve all failing evidence — never weaken a gate to make it green.

---

## PRODUCT ROADMAP DIVISION — Cline (TurquoiseLark) vs Kilo (MistyJaguar)

- **Cline (core/backend/integration):** phases 01 audit, 02 roadmap, 03 API + Chat/Agent routing, 04 indexing/RAG, 05 terminal/git/tool exec, 07 multi-file edit + diff, 08 autonomous agent/planning, 11 rate-limit scheduler, 13 speed optimization, 14 auto repair/resume, 16 security/Windows hardening, 17 benchmarks (shared), 18 release (lead). Files: all `src/server/**`, `src/shared/**`, `src/services/apiBridge.ts`, shell (`App.tsx`, `main.tsx`, `theme.tsx`, `TopHeader.tsx`, `WorkbenchLayout.tsx`, `CommandPalette.tsx`, `CrashBoundary.tsx`), `scripts/`, `benchmarks/`. Turbo engine (`universal.ts`, `providerPacing.ts`) + shell/Home toggles.
- **Kilo (UI/UX):** phases 06 premium UI, 09 Home dashboard, 10 Studio content, 15 UI bug fixing (P0 dead controls → P1 freeze/flicker/overlap → P2 themes → P3 polish). Files: `DashboardView`, `ChatView`, `ChatPanel`, `Composer`, `ActionHub`, `SettingsScreen`, `EditorArea`, `TerminalPanel`, `GitPanel`, `DebuggerPanel`, `BuildTestPanel`, `ToolRegistryPanel`, `FileTree`, `GlobalSearch`, `PreviewPane`, `ProjectRunner`, `DiffViewer`, `DiagnosticsModal`, `CodingPluginsPanel`, `QuickConnect`, `ProviderProfiles`, `AtlasDashboard`.
- **Shared / sequential (announce selectors/keys; one editor at a time):** `src/index.css`, `src/atlas.css`, `src/animations/*`.
- **Coordination:** Cline filed EXCLUSIVE reservations for its set (0 conflicts); Kilo to reserve its set; cross-boundary changes requested over Agent Mail, never edited unilaterally.

---

## SESSION 2026-11-08 (Kilo / MistyJaguar) — WORK COMPLETED & NEXT QUEUE

**Completed this session (implementation + tests + verification):**
- **M6.5 (✅):** Per-provider override UI. `ProviderProfiles.tsx` (Kilo-owned) now shows a selected saved provider's limits and lets the user edit max input chars, max output tokens, minimum request spacing (ms) and input/output price per million tokens; blank fields fall back to provider-documented defaults. The edit rides the existing validated settings contract (`api.updateSettings({providerProfiles})` → server `validateProfiles`), so no backend model change was needed. Regression contract `test:provider-profile-limits` (11 checks, discriminating — fails on pre-fix code) wired into `test:smoke`.
- **Smoke-gate repair (✅):** `test:universal` failed to even load (`ERR_MODULE_NOT_FOUND` for `settings.js` / `shared/*`) because `universal-provider.test.mjs`'s temp-dir copy list was stale (missing `settings.ts`, `modelDefaults`, `providerPresets`) and its import rewrite only matched double-quoted specifiers while the sources use single quotes. Fixed the copy list + quote handling → 24/24 pass. Pre-existing breakage, unrelated to any UI change.
- **P0 dead-controls audit (✅, no bugs found):** Read-only audit of the Kilo-owned surfaces (`ChatPanel`, `ChatView`, `Composer`, `ActionHub`, `SettingsScreen`, `AtlasDashboard`, panels) plus a repo-wide scan for no-op handlers/placeholders — every control routes to a real handler; no fixes required.
- **M9.8 accessibility pass (✅, first increment):** Added accessible names to icon-only controls (`DiagnosticsModal` close, `ToolRegistryPanel` refresh, `TerminalPanel` run) and the dialog keyboard pattern to the chat history popover in `ChatPanel` (Escape closes, focus returns to the trigger, listener cleanup). Regression contract `test:ui-accessibility` (7 checks) wired into `test:smoke`. Remaining M9.8 work: focus-visible/contrance contrast review needs the shared CSS files (claim protocol with Cline) and a browser pass.

**Deferred (needs server-side model change, owned by Cline/TurquoiseLark):**
- Per-provider RPM/TPM editable fields — `ProviderRequestBudget` (src/server/universal.ts) and `validateProfiles` (src/server/providerProfiles.ts) define a fixed key set; adding RPM/TPM overrides is a backend contract change. Requested via Agent Mail.

**Verification this session:** `npm run lint` EXIT 0 · `npm test` 617/617 (58 files) · `npm run test:smoke` EXIT 0.
**No git repo:** checkpoint under `_checkpoints/M65-provider-limits-20261108-101136/`.

**NEXT QUEUE (safe/reversible order):**
1. **M9.8 Accessibility (WCAG AA)** — focus-visible/ARIA/keyboard pass over Kilo-owned components.
2. **M1.4 Live codebase Q&A (chat)** — needs an agent query contract from Cline (`file:line` retrieval API).
3. **M9.3 Provider key rotation UX** — expired-key prompt flow in `SettingsScreen` (engine integration is Cline's side).

---

## SESSION 2026-11-08 — WORK COMPLETED, AUDIT CORRECTIONS & NEXT QUEUE

**Completed this session (implementation + tests + verification, not just plans):**
- **M-TURBO-1 (✅):** Home/Dashboard Turbo toggle was local-only (`onSettingsChanged` → `setSettings`) and never persisted → desynced/reverted vs the header & Studio controls. Routed through the single persisted global state `handleTurboSpeedToggle` → `api.updateSettings`. Regression test `test:turbo-global-state` (discriminating — fails on pre-fix code), wired into `test:smoke`.
- **M9.9 (✅):** No React error boundary existed (uncaught error = blank window). Added `src/components/CrashBoundary.tsx` (self-contained, dependency-free, credential-redacting) wrapping the whole tree in `main.tsx` with Restart / Recover / Copy-crash-report. Test `test:crash-boundary`, wired into `test:smoke`.
- **M9.2 (✅):** Corrupt/stale/deleted RAG index recovery already worked in `projectRag.ts::loadIndex` (guards `JSON.parse` + version + shape → rebuild). Added the missing regression tests `src/server/__tests__/projectRagRecovery.test.ts` (corrupt JSON, outdated version, structurally-invalid, deleted file → 4/4 PASS).

**Verified-EXISTING (gap-analysis; intentionally NOT rebuilt/duplicated per goal):**
- **Rate-limit scheduler (`universal.ts` + `universalProvider.test.ts`)** already covers 429+Retry-After shared cooldown, 401/402/403 clear errors (no failover, no quota bypass), jittered exponential backoff, exhausted-quota error, headerless-429 backoff, compound reset windows, `x-ratelimit-*` token/request pacing, circuit breaker. **No changes made.**
- **M6.4 (Settings Eco/Balanced/Turbo) is already implemented** in `SettingsScreen.tsx` (performance-mode radiogroup + request-pacing adaptive/fixed + Turbo toggle) — priority-list entry was stale.

**NEXT QUEUE (safe/reversible order, each: implement → test → verify → update this file):**
1. **M9.1 Settings migration/versioning** — ✅ **DONE** (2026-11-08): `SETTINGS_VERSION` + forward-migration pipeline in `settings.ts`; `version` stamped on load/persist; legacy files normalize with zero field loss; `settingsMigration.test.ts` 6/6 PASS.
2. **M9.3 Provider key rotation** — expired key → prompt → re-verify → continue (`encryptedKeyPool.ts`; SettingsScreen UI portion coordinated with Kilo).
3. **M7.5 Live performance monitor** — surface real tokens/sec, queue wait, effective interval (from `universal.ts` diagnostics) in Studio; I supply the diagnostics contract, Kilo places UI.
- **External blocker (2026-11-08):** Agent Mail `send_message` refused with `DURABILITY_DEGRADED` (server write-back queue recovering; self-retries ~1/min). Non-blocking; coordination retried. (Earlier transient: acceptance `lint` briefly failed on `ToolRegistryPanel.tsx` — a concurrent mid-save race with Kilo; NOT touched/edited; lint clean on re-run.)
- **External blocker (2026-11-08):** `test:benchmark-artifact` fails — `.quillix-smoke/ollama-model-matrix.json` is a STALE generated artifact (protocol null, repeats 1) that must be regenerated by `npm run benchmark:matrix` against **live local Ollama** (3 Qwen models). Ollama is not reachable here; producer + contract verified coherent (dry-run OK). NOT fabricated, NOT weakened — blocked pending live models.

**Run commands:** `npm run test:turbo-global-state`, `npm run test:crash-boundary` (in `npm run test:smoke`), `npm run lint`.
**No git repo:** all edits checkpointed under `_checkpoints/<ts>/`; see `_checkpoints/BACKUP_LOG.md` for rollback.