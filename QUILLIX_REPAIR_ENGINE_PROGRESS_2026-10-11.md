# NUVRO AI Repair Engine and Real Progress Update — 11 October 2026

## Implemented in this ZIP

1. **Shared 20-attempt repair budget** in `src/server/repairBudget.ts`, covering failed tool operations, automatic syntax/structure validation, and runtime-repair rounds within one agent run. The budget is an upper limit, *not* a promise that every failure can be solved.
2. **Every repair uses actual error feedback, then a real file update and retest** where possible. A successful read, empty model reply, or failed write is no longer counted as a successful repair.
3. **No-progress guard.** The engine compares real file bytes, not timestamps, before/after each repair. After two consecutive unchanged validation/runtime attempts it stops rather than looping forever; repeated identical tool failures also stop without false success.
4. **Approvals and cancellation stay authoritative.** If a file modification is staged for review or permission is denied, NUVRO AI pauses rather than silently retrying. Runs remain bounded by a turn limit.
5. **More durable file writing.** Temp filenames use UUIDs, temporary artifacts are cleaned up even if rename/install fails, temp data are synced before installation, and `createFile` uses exclusive linking to avoid clobbering a file created concurrently. `writeFile` continues to verify actual disk contents by reading back the entire file.
6. **Honest task-specific progress.** The UI computes percentage from actual completed request-specific phases, distinguishes unfinished/failed runs from passed checks, and labels written files as awaiting verification while the task is live. It no longer shows a green completion symbol for a failed run.

## Verification performed in this environment

- `npm run test:smoke`: **52/52 passing**, across the existing suites and 7 new regression tests.
- New repair tests: 20-attempt ceiling, early no-progress detection, resumed progress after a real change, byte-content checks.
- New file-write tests: verified write/overwrite, preserving content on duplicate create, no temporary-file debris on failed writes, workspace and symlink escape checks.
- TS/TSX syntactic parse checks: modified `agentEngine.ts`, `repairBudget.ts`, `workspace.ts` and `ChatView.tsx` parsed without syntax errors using TypeScript.
- `npm ci --offline --ignore-scripts`: **blocked by missing cached package** `yocto-queue-0.1.0.tgz`. Therefore the full frontend/Electron build and Windows GUI have **not** been verified here.
- Real Sarvam credentials/connection and a live browser preview were **not** tested. No API key is included.

## Windows verification (Node 22.23.2)

Extract the ZIP and run in a PowerShell terminal opened inside the `NUVRO AI` folder:

```powershell
npm ci
npm run test:smoke
npm run build
npm start
```

Choose Sarvam as the AI provider in NUVRO AI Settings, disable Offline Mode, and save your API key **only** in NUVRO AI Settings. Test with a small multi-file website and inspect the actual files, progress phases, browser preview and errors. A pass in the smoke suites does not guarantee every model-generated project will compile or work; a failed test must remain visible.

## Limits and safeguards

- Up to 20 repair **attempts**, but fewer if there are repeated no-change loops, permission denials, user cancellation, exhausted model turns, or a provider outage.
- Never claim that all coding errors can be prevented. Errors that cannot be fixed automatically remain reported as failures.
- The previous ZIP remains unchanged. This is a new source-only ZIP without `node_modules`.
