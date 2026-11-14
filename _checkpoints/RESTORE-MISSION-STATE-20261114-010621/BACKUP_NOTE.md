# Backup: mission tracker restore (20261114-010621)

Restored the live .quillix/mission/* tracker (missing in this worktree because **/.quillix/ is gitignored and the published baseline never shipped it) from the authoritative copy at _checkpoints/MISSION-CONTROL-20261108-143452/mission/.

Why: src/server/__tests__/missionState.test.ts ('reads the real persisted mission state') and scripts/smoke/mission-control-contract.mjs require the file to exist and be internally consistent. Restoring real data (not weakening the test, not fabricating counts) makes them green for the right reason.

