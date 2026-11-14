# QUILLIX mission — TASKS (fixture)

Fixture input for the mission-control contract. A fresh checkout has no live
`.quillix/mission/` state, so the contract reads this file (and its siblings)
instead. These are the tasks the fixture `goal-state.json` counts must add up to.

| # | Task | Status |
|---|---|---|
| T1 | Project audit + baseline regression run | done |
| T2 | Mission Control tracker (persisted state) | done |
| T3 | Provider, tool-parser and core smoke contracts | done |
| T4 | Representative contract gates (chat UI, settings, accessibility, ...) | done |
| T5 | Regression suite on the agent branch | in progress |
| T6 | Live provider workflows (needs credentials) | blocked |
| T7 | Windows package verification | blocked |