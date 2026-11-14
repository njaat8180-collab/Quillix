# QUILLIX mission - SESSION MEMORY (fixture)

Fixture input for the mission-control contract. A fresh checkout has no live
`.quillix/mission/` state, so the contract reads this file (and its siblings)
instead.

- The persisted state file is the single source of truth for mission progress.
- A missing, partial or wrong-shape state file must degrade to explicit
  defaults (the tracker says "not available") instead of inventing values.
- The renderer must never write mission state; the server endpoint is read-only.
- Mission state is per workspace: `path.join(root, ...MISSION_STATE_PATH)`.