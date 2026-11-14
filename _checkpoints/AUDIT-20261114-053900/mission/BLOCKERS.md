# QUILLIX — BLOCKERS (active)

Nothing here is silently ignored. Approval-gated items are marked.

| ID | Severity | Blocker | Impact | Approval needed | Next safe action |
|---|---|---|---|---|---|
| B1 | **Medium** | Agent Mail live server (127.0.0.1:8765) is down → Git-archive write-back lagged (`DURABILITY_DEGRADED`); mailbox writes stay durable in SQLite | Coordination archive parity; resend risk (duplicate messages) | **Yes** — supervised restart / `am doctor repair` affects the shared server + MistyJaguar | Poll `am health`; never resend a delivered id; verify parity when approved |
| B2 | **Medium** | Ollama unreachable + no live provider credentials | `test:benchmark-artifact`, live throughput, `benchmark:coding`, real-workflow runs | No (user credentials) | Regenerate the artifact when a model is reachable; do not fabricate |
| B3 | **Medium** | No Cursor baseline collected | CURSOR SUPERIORITY verdict cannot be claimed | No | Define the pinned comparison plan (BENCHMARKS.md) and collect real numbers |
| B4 | Low | No `@types/vscode` offline (no network) | VS Code extension cannot be type-checked locally | No | Extension is dependency-free JS so it runs as-is; type-check when network returns |
| B5 | Low | No git repository in this workspace | No commit history / easy rollback | No | `_checkpoints/` backups before every edit (established pattern) |
| B6 | Low | 30 s per-command cap | Long suites cannot run in one call | No | Detached background run + `DONE_MARKER` polling (established pattern) |
| B7 | Low | `npm run package:win` not yet re-run this session | Release artifact freshness | No | Run during P4 (needs RAM ≥2 GiB) |

## Known external dependency (recorded, not a defect)

- Windows code signing (M9.10) requires a certificate; SmartScreen clean install is unverified.
