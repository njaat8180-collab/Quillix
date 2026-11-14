# QUILLIX mission - BENCHMARKS (fixture)

Fixture input for the mission-control contract. A fresh checkout has no live
`.quillix/mission/` state, so the contract reads this file (and its siblings)
instead.

- **Cursor baseline:** `not-collected`. The contract asserts this value: no
  Cursor number may be claimed without a pinned, reproducible baseline.
- **Harness verified:** the benchmark harness runs locally, but no live model
  numbers are asserted here.
- **What must never appear in this file:** invented pass rates, invented
  latency, or a comparison whose reference measurement does not exist.