# QUILLIX MISSION — GOAL

**Owner:** Lead Autonomous Engineering Agent (Cline / TurquoiseLark)  
**Started:** 2026-11-08  
**Hard deadline:** 2026-11-11 23:59 IST (2026-11-11T23:59:00+05:30)  
**Release target:** before 2026-11-12  
**Mode:** MAXIMUM SAFE DEVELOPMENT THROUGHPUT

## Mission statement

Make **Quillix demonstrably better than Cursor** and ship a stable, verified
Windows release before the deadline.

## Two tracked outcomes (kept separate, never merged)

| Outcome | Definition | Verdict rule |
|---|---|---|
| **DEADLINE RELEASE** | Stable, usable, verified Quillix build delivered before Nov 12 | `goal-state.json` release gates all green |
| **CURSOR SUPERIORITY** | All mandatory release criteria met, success rate ≥ Cursor on the agreed benchmark, and measurable advantage in ≥2 dimensions | Requires benchmark evidence + a documented Cursor baseline. **Unverified until collected.** |

Chasing the release must never degrade correctness, security, or existing work.

## Phase schedule

| Phase | Dates (IST) | Focus | Exit criteria |
|---|---|---|---|
| P1 Foundation & recovery | Nov 8 | audit complete, baseline tests, mission tracker, safe multi-agent ownership, defect triage | tracker reads persisted state; priority P0 list published |
| P2 Core coding agent | Nov 9 | coding-vs-chat routing, tool execution, multi-file edits, terminal, tests/debug, project continuation, indexing/retrieval, permission-aware workflows | core workflows pass automated gates |
| P3 Intelligence & reliability | Nov 10 | autonomous repair, checkpoint/recovery, provider failover, token efficiency, large-codebase reasoning, code verification, UI regression, perf, Windows packaging | recovery + packaging verified |
| P4 Final acceptance | Nov 11 (to 23:59) | freeze optional features, fix release blockers, full regression, real coding workflows, reproducible Cursor comparison, Windows build verification, long-run recovery, security defects, artifacts, final report | acceptance report published |

## Non-negotiable rules

1. Never fabricate progress, benchmarks, test results, or background activity.
2. Never weaken a gate to make it green; never mock a real verification.
3. Never bypass required approvals (shared-server changes, destructive ops, external actions).
4. Preserve other agents' work; no concurrent edits outside reserved files.
5. If blocked, save state and switch to a non-conflicting task.

## Reload instruction for future sessions

Read `.quillix/mission/GOAL.md`, then `.quillix/mission/ROADMAP.md`, then
`.quillix/mission/goal-state.json`. Cline automatically loads
`.clinerules/quillix-mission.md`, which points here.
