# QUILLIX — TASKS (deadline-driven, derived from QUILLIX_ROADMAP.md audit)

Legend: ✅ verified · 🔄 in progress · ⬜ not started · 🟡 partial. Statuses come from real evidence only.

## P1 — Foundation & recovery (Nov 8)

| ID | Task | Owner | Status | Evidence |
|---|---|---|---|---|
| P1.1 | Audit + baseline (`tsc`, `npm test`, build) | Cline | ✅ | tsc EXIT 0, 602 Vitest, build EXIT 0 |
| P1.2 | Persisted mission state (`.quillix/mission/*`) | Cline | ✅ | this directory + `src/shared/missionState.ts` |
| P1.3 | QUILLIX MISSION CONTROL sidebar (VS Code) | Cline | ✅ | `extensions/quillix-mission-control/` |
| P1.4 | QUILLIX MISSION CONTROL panel (Studio) | Cline | ✅ | `src/components/MissionControlPanel.tsx` |
| P1.5 | Multi-agent file ownership + handoff | Cline | ✅ | msg id 10 (ack-required) to MistyJaguar |
| P1.6 | P0 dead-controls audit (UI) | Kilo | ⬜ | requested in handoff msg |
| P1.7 | P0 backend defect scan | Cline | 🔄 | see TASKS.md P4 defect queue |

## Completed milestone backlog (verified ✅, 40 items)

M0 · M-TURBO-1 · M1.1 M1.2 M1.3 · M2.1 M2.2 · M3.1 M3.2 M3.3 · M4.1 M4.2 M4.3 M4.6 · M5.1 M5.2 M5.3 M5.4 M5.5 M5.8 · M6.1 M6.2 M6.3 M6.5 M6.6 · M7.1 M7.2 M7.5 M7.7 M7.8 M7.9 · M8.1 M8.2 M8.3 M8.5 M8.6 M8.8 · M9.1 M9.2 M9.4 M9.9

---

## P2 — Core coding agent (Nov 9) · **priority order**

| ID | Task | Owner | Status | Notes |
|---|---|---|---|---|
| P2.1 | **M3.5** Failed test → agent auto-repair (verify + re-run) | Cline | 🔄 | roadmap 🔄; must be proven with a real failing-test run |
| P2.2 | **M2.3** Batch approve / reject all (multi-file changeset) | Kilo + Cline | ⬜ | UI in WorkbenchLayout (Cline) + changeset API |
| P2.3 | **M4.4** Named checkpoint / restore point with diff | Cline | ⬜ | `taskState.ts`, `sourceArchive.ts` |
| P2.4 | **M1.5** Incremental re-index on save (≤2s) | Cline | ⬜ | `projectRag.ts` refresh path |
| P2.5 | **M1.4** Live codebase Q&A in chat (file:line + snippet) | Kilo + Cline | ⬜ | retrieval exists (`sourceContext.ts`); needs UI + agent route |
| P2.6 | **M2.4** Undo last changeset atomically | Cline | ⬜ | backup/rollback exists (`workspace.ts`) → expose undo |
| P2.7 | **M3.4** Auto-run tests on save → Build panel | Kilo + Cline | ⬜ | `languageRunners.ts` exists |

## P3 — Intelligence & reliability (Nov 10)

| ID | Task | Owner | Status |
|---|---|---|---|
| P3.1 | M2.5 Edit conflict detection | Cline + Kilo | ⬜ |
| P3.2 | M9.6 Concurrent workspace safety (two instances) | Cline | ⬜ |
| P3.3 | M5.6 Prompt dedup cache | Cline | ⬜ |
| P3.4 | M5.7 Parallel independent work | Cline | ⬜ |
| P3.5 | M9.3 Provider key rotation | Cline + Kilo | ⬜ (M9.3 key-swap-on-failure deliberately avoided to protect quota/billing) |
| P3.6 | M4.5 Branch per task | Cline | ⬜ |
| P3.7 | M9.5 Large-file handling (>1MB) | Cline | ⬜ |
| P3.8 | M9.7 Memory-leak audit | Cline | ⬜ |
| P3.9 | M8.4 Windows packaging (NSIS + portable) | Cline | 🔄 |
| P3.10 | M8.9 Coverage ≥80% core modules | Cline | ⬜ |

## P4 — Final acceptance (Nov 11, to 23:59 IST)

| ID | Task | Owner | Status |
|---|---|---|---|
| P4.1 | Full regression (`test:acceptance:safe`, `:all`) | Cline | ⬜ |
| P4.2 | Real coding workflow runs (no mocks) | Cline | ⬜ (needs reachable model) |
| P4.3 | Long-running task recovery test | Cline | ⬜ |
| P4.4 | Reproducible Cursor comparison | Cline | ⬜ (needs Cursor baseline) |
| P4.5 | Windows build verification + artifacts | Cline | ⬜ |
| P4.6 | Security review (secrets, IPC, file scope) | Cline | ⬜ |
| P4.7 | Final acceptance report | Cline | ⬜ |

## Partial / verify

| ID | Task | Status | Note |
|---|---|---|---|
| M6.4 | Settings Eco/Balanced/Turbo selector | 🟡 | audit says implemented in `SettingsScreen.tsx`; needs a contract test |
| M7.10 | Keyboard-first / ARIA | 🟡 | `test:ui-accessibility` 23 checks PASS across 7 panels |
| M7.6 | Task history / timeline | ⬜ | not started |
| M9.8 | WCAG AA accessibility | 🟡 | partial (labels/focus/Escape done) |
