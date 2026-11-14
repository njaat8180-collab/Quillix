# M9.6 — Concurrent Workspace Safety (checkpoint)

**Date:** 2026-11-14
**Branch:** `cline/b137d` (no merge, no rebase, no cherry-pick, no history rewrite)
**Baseline for the pre-change state:** git `HEAD` on `cline/b137d` (the repository
keeps the committed baseline; this folder holds the *verified increment*).

## What this increment contains

| File | Change |
|---|---|
| `src/server/workspaceLock.ts` | **New.** Exclusive per-workspace lock service: atomic `wx` claim, owner record (session/instance/pid/process-start/host/user/app), per-instance heartbeat registry, stale takeover, bounded acquisition, owner-verified release, atomic writes. |
| `src/server/workspace.ts` | Mutating operations (`writeFile`, `createFile`, `deleteFile`, `renameFile`) now consult `assertWorkspaceWritable` and refuse to run while another live instance owns the workspace. |
| `server.ts` | Claims the workspace on start and on `set-root` / `create-project`; exposes `GET/POST /api/workspace/lock` and `POST /api/workspace/lock/release`; releases the claim on shutdown. |
| `src/services/apiBridge.ts` | Renderer bridge methods `getWorkspaceLockStatus()`, `acquireWorkspaceLock()`, `releaseWorkspaceLock()`. |
| `src/server/__tests__/workspaceLock.test.ts` | **New.** 18 real-filesystem tests (acquire/release, contention, timeout, race, isolation, stale/crash recovery, heartbeat, write protection, recovery after failure). |
| `scripts/smoke/workspace-lock-contract.mjs` | **New.** Contract: source-surface checks **plus** a runtime exercise of the real lock module (claim → contend → isolate → release → crash recovery). |
| `package.json` | New `test:workspace-lock` script, wired into the `test:smoke` chain. |

## Verification recorded for this increment

- `src/server/__tests__/workspaceLock.test.ts` — **18 passed / 0 failed** (vitest, real temp dirs)
- `npm run test:workspace-lock` — **EXIT 0** (source checks + runtime behaviour)
- `npm run lint` (tsc --noEmit, strict) — **EXIT 0**

## Design guarantees (why a stale lock is safe)

1. The lock file is created with the exclusive `wx` flag → only one process can win.
2. Liveness is proven by a **per-instance heartbeat record**, never by the PID alone
   (PIDs are reused on Windows; a dead PID is not proof that the owner is gone).
3. A crashed owner leaves a complete record behind (atomic temp+rename writes), so
   the next instance detects the dead heartbeat and takes the lock over.
4. Acquisition is bounded by a timeout → contention ends in an explicit error,
   never a deadlock. Re-acquiring a lock you already own returns the same session.
5. Only the owning session may release a lock; Windows `EPERM`/`EBUSY` removal
   failures are retried.
