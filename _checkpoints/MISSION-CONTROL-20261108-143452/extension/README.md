# QUILLIX MISSION CONTROL (VS Code extension)

A real VS Code sidebar that shows the Quillix deadline mission, live, from the
repository's persisted goal state — the same `.quillix/mission/goal-state.json`
that the Quillix Studio panel reads.

## What it shows

| Section | Source field |
|---|---|
| Deadline countdown (d / h / m, critical under 24h) | `deadline` |
| Verified progress + done/active/pending/total | `counts`, `verifiedProgressPercent` |
| Current phase and current task | `phase`, `currentTask` |
| Next planned task | `nextPlannedTask` |
| Next tasks queue | `nextTasks` |
| Active blockers (+ approval-required flag) | `blockers` |
| Test results + pass/blocked/fail/n-a totals | `tests` |
| Release gates | `releaseGates` |
| Development activity + last verified time | `activity` |
| Latest verified checkpoint | `latestCheckpoint` |
| Cursor benchmark status | `benchmarks` |

The tracker **never invents or estimates** anything: if the state file is
missing, the sidebar says so instead of showing fabricated progress.

## Install / run (no build step)

The extension is dependency-free CommonJS, so it installs offline:

```bash
code --install-extension extensions/quillix-mission-control
```

Or for local development (F5):

```bash
cd extensions/quillix-mission-control
code .
# press F5, then choose a workspace root that has .quillix/mission/goal-state.json
```

## Refresh behavior

- Picks up external edits within 15 seconds (poll), and immediately when the
  workspace file changes (file watcher).
- Refreshes on demand via the toolbar refresh icon or
  `Quillix: Refresh Mission Control`.

## Packaging (when network is available)

```bash
cd extensions/quillix-mission-control
npm install --save-dev @types/vscode   # optional; the extension runs without it
npx @vscode/vsce package
```

## Notes

- Type declarations are intentionally not bundled: this repository is offline
  and the extension is plain CommonJS, so it runs as-is. Adding `@types/vscode`
  later only enables editor-time type checking.
- No network access, no secrets, no provider credentials: the extension reads
  one JSON file from the workspace.
