# Quillix mission (autonomous, deadline-driven)

You are working on the **QUILLIX deadline mission**. The authoritative goal
lives in the repository, not in chat history.

## Reload order (do this first in every session)

1. `.quillix/mission/GOAL.md` — mission, deadline, outcomes, non-negotiables
2. `.quillix/mission/ROADMAP.md` — four-day phase schedule and scope-freeze rule
3. `.quillix/mission/TASKS.md` — the task list with owners and status
4. `.quillix/mission/PROGRESS.md` — last verified results and activity
5. `.quillix/mission/goal-state.json` — machine-readable tracker state
6. `.quillix/mission/BLOCKERS.md`, `.quillix/mission/BENCHMARKS.md`, `.quillix/mission/SESSION_MEMORY.md`

## Hard rules

- **Never fabricate** progress, benchmarks, test results, or background activity.
- **Never weaken a gate** to make it green and never substitute a mock for real verification.
- **Never bypass approvals**: shared-server changes, destructive operations, external actions.
- **File ownership** (multi-agent): Cline owns `src/server/**`, `src/shared/**`,
  `src/services/**`, shell (`src/App.tsx`, `src/main.tsx`, `src/theme.tsx`,
  `TopHeader.tsx`, `WorkbenchLayout.tsx`, `CommandPalette.tsx`, `CrashBoundary.tsx`),
  `scripts/**`, `benchmarks/**`, `.quillix/**`, `extensions/**`.
  Kilo owns UI components/panels. `index.css`, `atlas.css`, `src/animations/*`
  are sequential-only — never edit them without coordination.
- **After each verified increment**: back up edited files to `_checkpoints/`
  (there is no git repo here) and update `.quillix/mission/goal-state.json`
  plus `PROGRESS.md`.

## Environment

- Commands are capped at ~30s: run long suites detached, log a `DONE_MARKER`,
  and poll the log.
- No jsdom/RTL: verify UI with `tsc --noEmit` plus source-scanning contract
  tests in `scripts/smoke/*-contract.mjs`.
- Live model credentials may be absent: blocked gates must be recorded, not faked.

## Verification checklist (run before claiming any increment)

```
npm run lint        # tsc --noEmit, strict
npm test            # Vitest regression
npm run build       # production build
npm run test:smoke   # smoke + contract suites
```
