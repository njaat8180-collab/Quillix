# QUILLIX — MISSION ROADMAP (deadline-driven)

**Deadline:** 2026-11-11 23:59 IST · **Release:** before 2026-11-12
Source of truth for task detail: `QUILLIX_ROADMAP.md` (M0–M9 audits) + `.quillix/mission/TASKS.md`.

## Phase P1 — Foundation & recovery (Nov 8)
- Audit complete; baseline verified (`tsc` 0, full `npm test` 602, build 0) — DONE
- Mission tracker (`.quillix/mission/*`) + `src/shared/missionState.ts` — DONE
- VS Code sidebar "QUILLIX MISSION CONTROL" — DONE (extension scaffold, dependency-free)
- Safe multi-agent ownership (Cline core/backend; Kilo UI) — DONE, handoff msg id 10 delivered
- P0 defect triage — IN PROGRESS (Kilo owns the UI dead-controls audit; Cline owns backend defects)
- **Exit:** tracker reads persisted state; priority list published in TASKS.md

## Phase P2 — Core coding agent (Nov 9) — critical path to release
Highest user value, in this order:
1. **M3.5** test failure → agent auto-repair (🔄 finish: verify → re-run loop) — *core differentiator*
2. **M2.3** batch approve/reject (multi-file changeset UX, Kilo + `agentEngine`)
3. **M4.4** checkpoint / named restore point with diff
4. **M1.5** incremental re-index on save (index refresh ≤2s)
5. **M1.4** live codebase Q&A in chat (file:line + snippet)
6. **M2.4** undo last changeset (atomic)
7. **M3.4** auto-run tests on save → Build panel

## Phase P3 — Intelligence & reliability (Nov 10)
- **M2.5** edit conflict detection · **M9.6** concurrent workspace safety
- **M5.6** prompt dedup cache · **M5.7** parallel independent work (token efficiency, throughput)
- **M9.3** provider key rotation · **M4.5** branch per task
- **M9.5** large-file handling (>1MB) · **M9.7** memory-leak audit
- **M8.4** Windows packaging validation (NSIS + portable) · **M8.9** coverage ≥80% on core modules

## Phase P4 — Final acceptance (Nov 11, to 23:59 IST)
- Freeze optional features · fix release blockers · full regression (`test:acceptance:safe` + `:all` where resources allow)
- Real coding workflow runs · long-running task recovery
- Reproducible Cursor comparison (**requires a collected Cursor baseline** — see BENCHMARKS.md)
- Windows build verification · security review · artifacts · **final acceptance report**

## Scope-freeze rule
After Nov 10 23:59 IST, only release-blocking defects, verification, and documentation.
