# QUILLIX mission — GOAL (fixture)

**Fixture notice:** this is tracked *test data* used by the mission-control
contract when a repository has no live `.quillix/mission/` state (for example a
fresh clone or a fresh git worktree). The machine-readable mirror lives in
`goal-state.json`; both must stay internally consistent.

**Mission:** ship a stable, verified Windows build of Quillix and prove the
mission-control tracker is honest at every layer — persisted state, server,
renderer and the VS Code sidebar — without ever inventing progress.

**Release gates the tracker reports:**

| # | Gate |
|---|---|
| G1 | No known critical bugs |
| G2 | Core coding workflows tested |
| G3 | Build succeeds |
| G4 | Secrets protected (DPAPI, redaction) |
| G5 | Real provider workflows tested |
| G6 | Regression results documented |
| G7 | Windows package verified |
| G8 | Benchmark evidence preserved |
| G9 | Limitations disclosed |

**Non-negotiable rules**

1. Never fabricate progress, benchmarks, test results or background activity.
2. Never weaken a gate to make it green; never mock a real verification.
3. Never bypass required approvals (shared-server changes, destructive ops).
4. Preserve other agents' work; no concurrent edits outside reserved files.