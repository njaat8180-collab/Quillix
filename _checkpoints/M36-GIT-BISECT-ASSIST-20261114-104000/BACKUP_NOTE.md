# M3.6 — Git Bisect Assist (checkpoint)

**Date:** 2026-11-14
**Branch:** `cline/b137d` (no merge, no rebase, no cherry-pick, no history rewrite)
**Baseline for the pre-change state:** git `HEAD` on `cline/b137d` (the repository
keeps the committed baseline; this folder holds the *verified increment*).

## What this increment contains

| File | Change |
|---|---|
| `src/server/gitBisect.ts` | **New.** Self-contained bisect service: shell-free Git, revision validation, dirty-tree gate, test classification, culprit extraction, progress tracking, interruption recovery, safe finish. |
| `src/server/__tests__/gitBisect.test.ts` | **New.** 25 tests against **real temporary Git repositories**. |
| `server.ts` | `POST /api/git/bisect`, `GET /api/git/bisect/status`, `POST /api/git/bisect/finish`. |
| `src/services/apiBridge.ts` | Renderer bridge methods `startGitBisect()`, `getGitBisectStatus()`, `finishGitBisect()`. |
| `scripts/smoke/git-bisect-contract.mjs` | **New.** Contract: source-surface checks **plus** a runtime run that finds the culprit and leaves the repository on its original branch and commit. |
| `package.json` | New `test:git-bisect` script, wired into the `test:smoke` chain. |

## Verification recorded for this increment

- `src/server/__tests__/gitBisect.test.ts` — **25 passed / 0 failed** (vitest, real temp Git repos)
- `npm run test:git-bisect` — **EXIT 0** (source checks + real runtime behaviour)
- `npm run lint` (tsc --noEmit, strict) — **EXIT 0**

## Design guarantees (why the search is safe)

1. **Shell-free Git.** Every Git call goes through `spawn` with an argument array;
   no command string is ever handed to a shell, so a revision or path can never
   inject a second command.
2. **History is never rewritten.** The service never runs `reset --hard`,
   `rebase`, `merge`, `cherry-pick`, `push` or `clean`. The contract asserts
   this against the *actual Git argument arrays*, not against prose.
3. **The repository is left exactly as it was found.** `finish()` restores the
   original branch and commit; the contract proves the commit graph is
   byte-identical afterwards.
4. **A dirty working tree blocks the search.** Bisecting a dirty tree would
   produce verdicts about uncommitted changes, so the service refuses to start.
5. **Boundaries are pinned to real SHAs** and validated to be ordered
   ancestors, so the search space cannot silently include unrelated history.
6. **Inconclusive ≠ bad.** Git's own skip exit code (`125`) and test timeouts
   are classified as inconclusive and never contribute a verdict, so a flaky
   test cannot manufacture a culprit.
