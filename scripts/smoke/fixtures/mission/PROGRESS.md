# QUILLIX mission - PROGRESS (fixture)

Fixture input for the mission-control contract. A fresh checkout has no live
`.quillix/mission/` state, so the contract reads this file (and its siblings)
instead. Every entry below is a statement about the fixture itself - no
verification result is claimed here that was not actually run against the
fixture.

## Verified against this fixture

- `npm run test:mission-control` - PASS with `missionStateSource: "fixture"`
  when no live mission state is present.
- `npm test` (`src/server/__tests__/missionState.test.ts`) - the persisted-state
  case reads this fixture when `.quillix/mission/goal-state.json` is absent.

## Not verified by this fixture

- Anything about the real mission state of an operator checkout. When
  `.quillix/mission/` exists the contract validates that instead and the fixture
  is inert.