# Mission-control contract fixture

The Mission Control contract (`scripts/smoke/mission-control-contract.mjs`) and
`src/server/__tests__/missionState.test.ts` validate the deadline-mission tracker
against the persisted state at `<project>/.quillix/mission/`.

That directory is intentionally **not** tracked (`.gitignore` excludes `**/.quillix/`
so agent-run workspaces stay clean), so a fresh clone or a fresh git worktree has
no mission state at all. Without a fixture both suites hard-fail on every clean
checkout, which makes them environment-dependent instead of reproducible.

This directory is the tracked fallback:

- When `<project>/.quillix/mission/goal-state.json` exists (the real operator
  state, in the main checkout) the contract validates **that** and reports
  `missionStateSource: "live"`.
- Otherwise it validates this fixture and reports
  `missionStateSource: "fixture"`.

Everything here is test data. It is internally consistent by construction
(counts sum to `total`, `verifiedProgressPercent` is derived from `counts`, no
Cursor baseline is claimed) and it is deliberately static: no benchmark, test
result or activity claim is made that was not actually verified.