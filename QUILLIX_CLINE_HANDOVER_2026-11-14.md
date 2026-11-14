# QUILLIX — Cline handover package

**Branch:** `agent-opencode` · **Base:** `09b7a8c` · **HEAD at handover:** `79d20d7`
**Prepared by:** the `agent-opencode` agent · **Date:** 2026-11-14

This package is the complete handover of everything that is **Cline-owned**
(`src/server/**`, `src/shared/**`, `src/services/**`, `src/**` components,
`scripts/**`, `benchmarks/**`, `.quillix/**`, `extensions/**`) and that this
agent either **changed**, or **could not complete**.

Nothing in this package has been applied to Cline's files except the two
changes explicitly listed in §1.2, which are called out so they can be
reviewed or reverted.

**How to use it:** §3, §4 and §5 contain ready-to-apply diffs. §2 is a table
edit. §6 and §7 are specifications that need a human decision. §9 has the
merge-safety facts.

---

## 1. What this agent changed in Cline-owned paths

### 1.1 The 24 files (all need a review pass)

```
scripts/e2e/agent-e2e.sh
scripts/e2e/classify-failures.sh
scripts/e2e/classify-failures.test.mjs
scripts/e2e/host-capacity.mjs
scripts/smoke/benchmark-preflight.test.mjs
scripts/smoke/package-resource-preflight.test.mjs
scripts/smoke/packaged-static-contract.mjs
scripts/smoke/rag-incremental-contract.mjs
scripts/smoke/release-artifact-check.mjs
scripts/smoke/release-artifact-names.mjs
scripts/smoke/release-artifact-names.test.mjs
scripts/smoke/release-signature-check.mjs
scripts/smoke/release-source-fingerprint.test.mjs
scripts/smoke/tavily-hackathon-demo.test.mjs
src/App.tsx
src/server/__tests__/editReliability.test.ts
src/server/__tests__/missionState.test.ts
src/server/__tests__/verificationIntegrity.test.ts
src/server/agentEngine.ts
src/server/indexer.ts
src/server/projectRag.ts
src/server/reviewAgent.ts
src/server/toolRegistry.ts
src/server/verifier.ts
```

**Total:** 24 files changed, **1,506 insertions(+), 214 deletions(-)**.

| Commit | Cline-owned files | What it did |
|---|---|---|
| `b8e3cdb` | 3 | repaired the broken tool contract, hardened focused edits |
| `1790334` | 1 | whitespace-tolerant edit path, end-to-end |
| `7b930f0` | 7 | stopped reporting verification failures as success |
| `cdc0772` | 13 | made the release gates match what the packager builds |
| `471770f` | 2 | mojibake repair (`src/App.tsx`) + `packaged-static-contract.mjs` name derivation |

### 1.2 The two most recent changes (the ones to look at first)

**`src/App.tsx` — UTF-8 mojibake repair.** 13 occurrences across 8 places had
been decoded as cp1252: the error glyph rendered as `â<control><Œ>` instead of
U+274C (`❌`), the em dash as `â€”` instead of U+2014 (`—`), the ellipsis as
`â€¦` instead of U+2026 (`…`). A repair script mapped every mis-decoded
character back to its cp1252 byte and re-decoded the byte run as UTF-8, so the
result is the original character, not a guess. **No logic changed.**

**`scripts/smoke/packaged-static-contract.mjs` — release-gate name derivation.**
The gate hardcoded `'Quillix.exe'` / `'Quillix Setup 1.2.0.exe'` while
`electron-builder.json` declares `"productName": "NUVRO AI"`, so the packager's
correct artifact was rejected and **the gate could never pass on this branch**.
It now uses the same `releaseArtifactNames()` helper as the artifact and
signature gates (legacy names kept as fallbacks).

```
npm run test:packaged-static
  before: AssertionError: unpacked Quillix executable is missing   (EXIT 1)
  after:  {"status":"PASS","installer":"NUVRO AI Setup 1.2.0.exe",
           "installerBytes":142789154,"asarBytes":183390975,
           "requiredEntries":5,"serverMarkers":5}                (EXIT 0)
```

**This is a missed sibling of `cdc0772`:** that commit migrated
`release-artifact-check.mjs` and `release-signature-check.mjs` to the shared
derivation and left this third gate behind (`git log -- scripts/smoke/packaged-static-contract.mjs`
→ last touched at the baseline `09b7a8c`).

---

## 2. Tracker sync — 12 rows are marked pending but are done

`.quillix/mission/TASKS.md` is **two days stale** (last edited 12-11 20:21),
while `.quillix/mission/goal-state.json` says `93/110 = 85 %` and the table
itself says `41/67 = 61 %`. The two sources disagree. Every row below was
verified in code, not inferred.

| Row | Feature | Evidence | New marker |
|---|---|---|---|
| `P3.1` | M2.5 Edit conflict detection | `server.ts:1111-1127`, `src/components/EditConflictDialog.tsx`, `src/components/WorkspaceView.tsx:861` | ✅ |
| `P3.2` | M9.6 Concurrent workspace safety | implemented by this agent — see §10 | ✅ |
| `P3.4` | M5.7 Parallel independent work | `src/shared/concurrency.ts` + parallel read-only tool calls in `agentEngine.ts` | ✅ |
| `P3.6` | M4.5 Branch per task | `src/shared/types.ts:294-296`, `src/server/settings.ts:42-43`, `src/App.tsx:454`, `src/components/SettingsScreen.tsx:1210` | ✅ |
| `P3.8` | M9.7 Memory-leak audit | `npm run test:memory-hygiene` → `{"status":"PASS", ...}` | ✅ |
| `P4.2` Part 2 | Centralized rate-limit service | `src/server/rateLimitService.ts` | ✅ |
| `M7.6` | Task history / timeline | `src/components/TaskHistoryPanel.tsx`, wired at `src/components/WorkbenchLayout.tsx:321` | ✅ |
| `P2.3` | M4.4 Named checkpoint / restore point | duplicate of `P6.3` (already ✅) | ✅ |
| `P2.6` | M2.4 Undo last changeset atomically | duplicate of `P6.2` (already ✅) | ✅ |
| `P2.7` | M3.4 Auto-run tests on save | duplicate of `P6.1` (already ✅) | ✅ |
| `P3.3` | M5.6 Prompt dedup cache | duplicate of `P6.4` (already ✅) | ✅ |
| `P3.7` | M9.5 Large-file handling | duplicate of `P6.5` (already ✅) | ✅ |

**Effect:** `TASKS.md` goes from **41/67 (61 %)** to **54/67 (81 %)**. Add
`P3.2` and the table agrees with the roadmap the product actually ships.

---

## 3. P4.6 — error-message leak sweep (the largest remaining code item)

### 3.1 Why this matters

`src/server/providerErrors.ts` already exports `safeProviderError()`, but it is
only for **provider connection-test failures**. Its fallback is:

```
`${provider} connection failed. Check the API key, model access, credits and network.`
```

Applying it to a **filesystem** error would turn
`EPERM: operation not permitted, mkdir 'C:\Users\…\project'` into *"NUVRO AI
connection failed. Check the API key…"* — nonsense, and it destroys the
diagnostic value. **This sweep therefore needs two different treatments**, not
one.

There are **39 raw error sites** in Cline-owned server code. The redaction
logic already exists and is unit-tested in `platform/diagnostics.ts`
(`redactSecrets`, `redactAbsolutePaths`, `sanitizeServerDiagnostic`) — it is
pure string logic with no Node dependencies, and it already removes absolute
Windows/POSIX/UNC paths, bearer tokens, API keys, client secrets, private-key
blocks and long opaque tokens.

### 3.2 DO NOT TOUCH — these feed logic, not display

| Site | Why |
|---|---|
| `src/server/nvidiaFailover.ts:74` | `errorMessage()` feeds `classifyNimFailure` **and** a `retry-after` regex. Sanitizing here breaks failover classification. |
| `src/server/providerModelFailover.ts:30` | same `retryAfterMs()` pattern |
| `src/server/providerStream.ts:33`, `:1261`, `:1263` | `e.message` is an SDK **message object**, not an `Error`. These are false positives — changing them breaks streaming. |

### 3.3 Class A — provider / upstream API (use `safeProviderError`)

| Site | Current | Proposed |
|---|---|---|
| `src/server/universal.ts:1244` | `throw new Error(\`Universal API response failed: ${e.message}\`)` | `throw new Error(safeProviderError(e.message, 'Universal'))` |
| `src/server/nvidia.ts:93` | `nimCatalogError = error instanceof Error ? error.message : String(error ?? 'NVIDIA model discovery failed.')` | `nimCatalogError = error instanceof Error ? safeProviderError(error.message, 'NVIDIA NIM') : String(error ?? 'NVIDIA model discovery failed.')` |

`src/server/qwen.ts:320` is a `TypeError` from a **local** fetch
(`CANNOT_CONNECT_MESSAGE` + detail) — classify it as Class C, not A.

### 3.4 Class B/C/D — filesystem, process and protocol errors (redact paths and secrets)

Add one helper next to the code it protects, then wrap the message.

```ts
// src/server/safeErrors.ts   (new file, Cline-owned)
/**
 * Error text that leaves the server must never carry an absolute user path,
 * a bearer token, an API key or a client secret. The redaction rules are
 * ported from platform/diagnostics.ts, which the Electron shell already uses
 * for the same purpose and which has its own unit tests.
 *
 * Unlike providerErrors.safeProviderError (which is about provider
 * connectivity), this keeps the useful part of a local error and only
 * removes what must not be shown.
 */
import { redactSecrets, redactAbsolutePaths } from '../../platform/diagnostics.js';

const MAX_ERROR_LENGTH = 300;

/** Redact secrets and absolute paths from a local error, keeping it useful. */
export function safeLocalError(error: unknown, fallback = 'The operation failed.'): string {
  const raw = error instanceof Error ? error.message : String(error ?? '').trim();
  if (!raw) return fallback;
  const redacted = redactAbsolutePaths(redactSecrets(raw)).replace(/\s+/g, ' ').trim();
  return (redacted || fallback).slice(0, MAX_ERROR_LENGTH);
}
```

> **Dependency note:** this diff imports `platform/diagnostics.ts`. If you take
> the whole branch that is fine. If you cherry-pick, either take `platform/`
> as well or inline `redactSecrets` / `redactAbsolutePaths` into
> `src/server/safeErrors.ts` — they are ~40 lines of pure string logic.

Per-site replacements:

| Site | Current | Proposed |
|---|---|---|
| `src/server/workspace.ts:98` | `` `File not found or not accessible: ${relativePath} (${err.message})` `` | `` `File not found or not accessible: ${relativePath} (${safeLocalError(err)})` `` |
| `src/server/workspace.ts:165` | `error: err.message` | `error: safeLocalError(err)` |
| `src/server/workspace.ts:180` | `error: err.message` | `error: safeLocalError(err)` |
| `src/server/workspace.ts:287` | `error: err.message` | `error: safeLocalError(err)` |
| `src/server/workspace.ts:426` | `error: err.message` | `error: safeLocalError(err)` |
| `src/server/workspace.ts:451` | `` `Write verification failed: ${err.message}` `` | `` `Write verification failed: ${safeLocalError(err)}` `` |
| `src/server/workspace.ts:531` | `error: err.message` | `error: safeLocalError(err)` |
| `src/server/workspace.ts:559` | `error: err.message` | `error: safeLocalError(err)` |
| `src/server/workspace.ts:580` | `error: err.message` | `error: safeLocalError(err)` |
| `src/server/workspace.ts:605` | `error: err.message` | `error: safeLocalError(err)` |
| `src/server/workspace.ts:635` | `error: err.message` | `error: safeLocalError(err)` |
| `src/server/workspace.ts:701` | `error: err.message` | `error: safeLocalError(err)` |
| `src/server/workspace.ts:730` | `error: err.message` | `error: safeLocalError(err)` |
| `src/server/workspace.ts:769` | `error: err.message` | `error: safeLocalError(err)` |
| `src/server/toolRegistry.ts:1063` | `error: error.message` | `error: safeLocalError(error)` |
| `src/server/toolRegistry.ts:1077` | `error: e.message` | `error: safeLocalError(e)` |
| `src/server/toolRegistry.ts:1449` | `String(error.message).slice(0, 600)` | `safeLocalError(error, 'Edit would break source syntax')` (the 600-char slice is then redundant) |
| `src/server/toolRegistry.ts:2336` | `` `Tool execution failed: ${err.message}` `` | `` `Tool execution failed: ${safeLocalError(err)}` `` |
| `src/server/toolRegistry.ts:2337` | `error: err.message` | `error: safeLocalError(err)` |
| `src/server/terminal.ts:144` | `` `Failed to spawn process: ${err.message}` `` | `` `Failed to spawn process: ${safeLocalError(err)}` `` |
| `src/server/terminal.ts:185` | `` `${stderr}\n${err.message}` `` / `` err.message `` | `safeLocalError(err)` |
| `src/server/languageRunners.ts:837` | `` `[Process error: ${err.message}]` `` | `` `[Process error: ${safeLocalError(err)}]` `` |
| `src/server/languageRunners.ts:849` | `` `Failed to start project: ${err.message}` `` | `` `Failed to start project: ${safeLocalError(err)}` `` |
| `src/server/autoTestRunner.ts:134` | `` `[spawn error: ${error.message}]` `` | `` `[spawn error: ${safeLocalError(error)}]` `` |
| `src/server/git.ts:34` | `` `${stderr}\n${err.message}` `` | `safeLocalError(err)` |
| `src/server/lspStdio.ts:109` | `` `LSP process failed: ${error.message}` `` | `` `LSP process failed: ${safeLocalError(error)}` `` |
| `src/server/lspStdio.ts:148` | `String(message.error.message \|\| 'LSP JSON-RPC request failed.')` | `safeLocalError(message.error?.message, 'LSP JSON-RPC request failed.')` |
| `src/server/mcpStdio.ts:57` | `` `MCP stdio process failed: ${error.message}` `` | `` `MCP stdio process failed: ${safeLocalError(error)}` `` |
| `src/server/mcpStdio.ts:105` | `String(message.error.message \|\| 'MCP JSON-RPC request failed.')` | `safeLocalError(message.error?.message, 'MCP JSON-RPC request failed.')` |
| `src/server/nodeDebugger.ts:219` | `message.error.message \|\| 'Inspector request failed.'` | `safeLocalError(message.error?.message, 'Inspector request failed.')` |
| `src/server/verifier.ts:84` | `` `Invalid JSON: ${err.message}` `` | `` `Invalid JSON: ${safeLocalError(err)}` `` |
| `src/server/verifier.ts:105` | `err?.message.slice(0, 300)` | `safeLocalError(err, 'Syntax checking unavailable')` |
| `src/server/offlineCodingPlugins.ts:282` | `` `Invalid JSON: ${error.message}` `` | `` `Invalid JSON: ${safeLocalError(error)}` `` |
| `src/server/agentEngine.ts:763` | `err instanceof Error ? err.message : 'Unknown filesystem error'` | `safeLocalError(err, 'Unknown filesystem error')` |
| `src/server/settings.ts:374` | `error: e.message` | `error: safeLocalError(e)` |
| `src/server/qwen.ts:320` | `` `${CANNOT_CONNECT_MESSAGE}${detail ? ` (${detail})` : ''}` `` | `` `${CANNOT_CONNECT_MESSAGE}${detail ? ` (${safeLocalError(detail, '')})` : ''}` `` |

**36 sites.** Add one import line per touched file:
`import { safeLocalError } from './safeErrors.js';` (or `'../safeErrors.js'` from `__tests__`).

### 3.5 One decision Cline must make

`redactAbsolutePaths` replaces an absolute path with a placeholder. For a
**filesystem** error the path is often the useful part ("cannot write
`D:\my project\a.ts`"). Two options:

* **(a) keep paths** — redact only secrets, leave paths. Better diagnostics,
  but the user's home directory is still exposed to the model and to any log
  the error reaches.
* **(b) redact paths too** — what §3.4 above does. Safer, slightly less
  informative.

This agent recommends **(b)** for anything that reaches the model or the UI
(`toolRegistry`, `agentEngine`, `terminal`, `languageRunners`) and **(a)** for
purely internal diagnostics that never leave the process. Pick one and apply it
consistently — the security-review claim is only as strong as the weakest site.

### 3.6 Verification after applying

```
npm run lint
npm test                        # 939 tests, 93 files, currently all green
npm run test:security           # the redaction contract lives here
```

---

## 4. `test:benchmark-artifact` accepts a stale artifact (gate defect)

`scripts/smoke/benchmark-artifact-contract.mjs:11` validates both provenance
fingerprints with `/^[a-f0-9]{64}$/i` — the **shape**, never the **value**.
Line 20 only checks that each matrix row agrees with the report. A **stale**
artifact therefore passes as long as it is internally consistent.

This is not theoretical. The artifact in the main checkout
(`.quillix-smoke/ollama-model-matrix.json`, produced 2026-11-14 07:34Z on the
same host) has:

| Fingerprint | Value | Matches |
|---|---|---|
| `evaluatorContractFingerprint` | `cab2e73a…7dcb` | this branch ✅ |
| `caseSetFingerprint` | `04701f4c…a9a9` | **neither** this branch (`9785d615…a3f`) **nor** the main checkout's current code (`6a4977c8…b09a`) ❌ |

The case-set fingerprint covers the case prompts/fixtures/checks **and**
`scripts/smoke/website-continuation-browser.cjs`, which differs between the two
checkouts. Copying that artifact would have turned the gate green on evidence
of different code — a fake PASS. It was not copied.

### 4.1 The clean fix — one shared derivation, used by producer and checker

`scripts/smoke/coding-benchmark.ts:182-190` already computes both
fingerprints. Export that computation and let the contract call it, so the
check can never drift from the generator.

```diff
--- a/scripts/smoke/coding-benchmark.ts
+++ b/scripts/smoke/coding-benchmark.ts
@@
-const evaluatorContractFingerprint = createHash('sha256')
-  .update(fs.readFileSync(new URL('./benchmark-quality.ts', import.meta.url)))
-  .digest('hex');
-const caseSetFingerprint = createHash('sha256')
-  .update(JSON.stringify({ protocol: benchmarkProtocol, evaluatorContractFingerprint, cases: runCases.map(…
-  .digest('hex');
+export function computeEvaluatorContractFingerprint(root = import.meta.dirname): string {
+  return createHash('sha256')
+    .update(fs.readFileSync(path.join(root, 'benchmark-quality.ts')))
+    .digest('hex');
+}
+export function computeCaseSetFingerprint(runCases: CodingCase[], evaluatorContractFingerprint: string): string {
+  return createHash('sha256')
+    .update(JSON.stringify({ protocol: benchmarkProtocol, evaluatorContractFingerprint, cases: runCases.map(…
+    .digest('hex');
+}
```

```diff
--- a/scripts/smoke/benchmark-artifact-contract.mjs
+++ b/scripts/smoke/benchmark-artifact-contract.mjs
@@
+import { computeEvaluatorContractFingerprint, computeCaseSetFingerprint } from './coding-benchmark.ts';
@@
-if (!/^[a-f0-9]{64}$/i.test(report.evaluatorContractFingerprint || '')) throw new Error('Benchmark matrix evaluator contract fingerprint is missing.');
+if (report.evaluatorContractFingerprint !== computeEvaluatorContractFingerprint())
+  throw new Error('Benchmark matrix evaluator contract is stale: rebuild it with `npm run benchmark:matrix`.');
-if (!/^[a-f0-9]{64}$/i.test(report.caseSetFingerprint || '')) throw new Error('Benchmark matrix case-set fingerprint is missing.');
+if (report.caseSetFingerprint !== computeCaseSetFingerprint(...))
+  throw new Error('Benchmark matrix case set is stale: rebuild it with `npm run benchmark:matrix`.');
```

> The contract script is plain `.mjs` and the producer is TypeScript, so the
> import needs `tsx` or a compiled helper. The alternative — a small
> `scripts/smoke/benchmark-case-fingerprint.mjs` helper that both call — avoids
> the loader question entirely. **Do not** duplicate the hash logic in two
> places; a shared helper is the whole point.

### 4.2 A second decision: should the chain generate the artifact?

`scripts/smoke/full-acceptance.mjs` runs `test:benchmark-artifact` as a plain
step and never produces the artifact. The artifact needs
`npm run benchmark:matrix` — **63 real local Ollama runs** (3 models × 7 cases
× 3 repeats). Options:

* keep it as a hard failure (current), or
* make the suite **skip explicitly** when the artifact is absent, so the chain
  reports *"skipped: no local benchmark artifact"* instead of a hard failure
  that hides every suite behind it.

The second is what this agent would pick for CI, with the hard failure kept
for the release gate.

---

## 5. `src/components/EditorArea_backup.tsx`

**Tracked in git** (194 lines) and **imported nowhere** — it is a dead backup
file. It still contains **5 mojibake markers**. Two options:

* **(a) fix the 5 characters** — 2 minutes, zero risk, keeps the reference.
* **(b) delete the file** — it is dead code, and the repo already carries
  **114,889 lines** of duplicate source under `_checkpoints/` (see §8). Needs
  Cline's confirmation, because someone may be using it as a reference.

This agent recommends **(a)** now and **(b)** as part of a `_checkpoints/`
retention policy.

---

## 6. M9.8 WCAG AA — a specification, not a patch

**This agent did not implement this and did not claim it as done.** WCAG AA is
not a mechanical property, and the existing contract
(`scripts/smoke/ui-accessibility-contract.mjs`, 7 files, 23 checks) is a
**source-regex** audit: it asserts that specific `aria-label` attributes and
focus-handling calls exist in the source. Adding more regex checks would make
the contract longer without making the app more accessible.

What is actually missing, and what a real implementation needs:

| Gap | What it takes |
|---|---|
| Colour contrast | A computed contrast check over the real token palette; no ratio is asserted today |
| Focus trap in modals | Escape + focus-return exist for the chat-history popover; the other modal surfaces (Diagnostics, Tool Registry, Settings) need the same treatment |
| Screen-reader live region | Streaming agent output and status changes need an `aria-live` region; the chat panel has none |
| App-wide tab order | Not audited at all |
| Form labelling | Not audited at all |
| Scalable zoom / 200 % reflow | Not audited at all |

**Recommendation:** run a real audit (axe-core or manual with a screen reader)
before writing any contract, and let the audit drive the fixes. A regex
contract that asserts a *new* pattern is not evidence of accessibility.

---

## 7. P4.3 — long-running task recovery test

Never written. The pieces it needs already exist:

| Piece | Where |
|---|---|
| persisted task state | `src/server/taskState.ts` → `<workspace>/.quillix/tasks.json` |
| latest incomplete task | `GET /api/tasks/latest-incomplete` |
| task resume | `taskId` + `resumable` on the chat message, `POST /api/agent/...` resume path |
| rollback | `POST /api/tasks/undo-last-changeset` |
| named checkpoints | `src/server/checkpoints.ts`, `GET/POST /api/checkpoints` |

Suggested shape (deterministic, **no sleeps** — wait on a state predicate with
a bounded timeout, because the harness budget is 60 s):

1. start a task that writes a file, let it reach a known state
2. interrupt it (abort / kill the run)
3. assert the task is listed by `GET /api/tasks`, is marked incomplete, and its
   snapshot is on disk
4. assert the workspace still contains the partial, valid output
5. resume with the task id, assert the task completes and the final file is
   verified
6. assert `GET /api/tasks/latest-incomplete` is empty afterwards

---

## 8. Repository hygiene — `_checkpoints/` is 2× the codebase

| Path | Lines | Files |
|---|---|---|
| production code (`src/` + root/`platform/`/`electron/`/`scripts/`) | **55,727** | 265 |
| tests | 13,182 | 93 |
| `_checkpoints/` (tracked duplicate source copies) | **114,889** | 194 |

A fresh clone carries **~170,000 lines** where **~55,700** is live code.
This agent did **not** touch these files — they are other agents' recovery
points — but a retention policy (archive the old ones, keep only the current
round) would halve the repository size.

---

## 9. Merge-safety facts

| Check | Result |
|---|---|
| Intersection of Cline-owned paths changed by this agent with `main` (`b65bbf9`) | **empty** |
| Intersection with `cline/b137d` (`a63ad8d`) | **empty** |
| Intersection with `agent-kilo` (`a8fb386`) | `src/server/__tests__/missionState.test.ts` — **blob-identical** (`73236e1`), no conflict |
| New Cline-owned paths introduced in the last two commits | **none** |
| Merge requests still outstanding (not merged by this agent) | `b65bbf9` (M2.5 external-write catch-up), `6f7cbc9` (self-provisioning acceptance fixture) |

---

## 10. M9.6 — concurrent workspace safety (implemented, needs review)

This was the only genuinely missing code gap. It is **implemented** by this
agent, but it belongs to Cline's domain, so it is listed here for review.

* New `platform/workspaceLease.ts` — an exclusive, heartbeat-refreshed lease
  over `<workspace>/.quillix/workspace.lease.json`. Acquisition is an atomic
  exclusive create, so the OS decides the winner. An expired lease (the owner
  crashed) may be taken over; a corrupt lease file is treated as no lease so a
  workspace can never be locked forever.
* `server.ts` takes the lease **before it accepts a single request** and
  refuses to start with an actionable message when another live instance owns
  the folder. Every workspace switch acquires the target folder's lease
  **before** switching and gives it back when the switch fails. The lease is
  renewed on a timer and released on shutdown.
* `GET /api/workspace/lease` reports the owner.
* Live proof — two real servers on one workspace, the second one printed:

```
Quillix could not start: Another NUVRO AI instance (pid 2856) is already
using this workspace. Stop that instance, or choose a different folder.
Two instances writing to the same folder would overwrite each other's work.
```

* 11 new assertions in `verification/workspaceLease.test.ts`.

**Review points for Cline:** (1) the lease file lives in the workspace's
`.quillix/` folder — already git-ignored by `**/.quillix/`, but it does write
into the user's project directory; (2) the 30 s TTL and the 10 s heartbeat;
(3) the fail-fast behaviour on startup — should a second instance instead open
read-only?

---

## 11. Apply order

```
1. §2  tracker sync            20 min    (no risk)
2. §5a EditorArea mojibake      2 min    (no risk)
3. §3  error sweep            2-3 h      (run npm test after)
4. §4  benchmark contract      1.5-2.5 h
5. §6  WCAG AA                3-5 h      (audit first, then fix)
6. §7  recovery test          2-3 h
7. §1  review the 24 files    2-4 h      (merge risk, no code)
8. §8  _checkpoints policy     decision
```

Every step is verifiable with `npm run lint`, `npm test` (939 tests / 93 files,
currently green) and `npm run build`.
