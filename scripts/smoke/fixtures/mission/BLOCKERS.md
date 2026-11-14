# QUILLIX mission - BLOCKERS (fixture)

Fixture input for the mission-control contract. A fresh checkout has no live
`.quillix/mission/` state, so the contract reads this file (and its siblings)
instead.

| ID | Severity | Blocker | Approval required |
|---|---|---|---|
| B_LIVE_MODEL | medium | Live provider credentials may be absent on CI/offline hosts, so live provider workflows cannot run | no |
| B_PACKAGING | medium | Windows packaging depends on host resources and can legitimately pause | no |

The machine-readable `goal-state.json` mirrors this list. The contract asserts
that every `critical` blocker carries `approvalRequired: true`, so no blocker in
the fixture may be marked `critical` without an approval.