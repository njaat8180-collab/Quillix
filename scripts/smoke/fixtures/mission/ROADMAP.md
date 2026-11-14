# QUILLIX mission — ROADMAP (fixture)

Fixture input for the mission-control contract. A fresh checkout has no live
`.quillix/mission/` state, so the contract reads this file (and its siblings)
instead. The phase list below is static: it records the shape the tracker is
expected to render, not a schedule that is being claimed as finished.

| Phase | Focus | Exit criteria |
|---|---|---|
| P1 Foundation & recovery | audit, baseline tests, mission tracker, multi-agent ownership, defect triage | tracker reads persisted state; P0 list published |
| P2 Core coding agent | coding-vs-chat routing, tool execution, multi-file edits, terminal, tests/debug, project continuation, indexing/retrieval | core workflows pass automated gates |
| P3 Intelligence & reliability | autonomous repair, checkpoint/recovery, provider failover, token efficiency, large-codebase reasoning, Windows packaging | recovery + packaging verified |
| P4 Final acceptance | freeze optional features, fix release blockers, full regression, build verification, security defects, artifacts, final report | acceptance report published |

**Scope-freeze rule:** optional features do not start until P4 is open.