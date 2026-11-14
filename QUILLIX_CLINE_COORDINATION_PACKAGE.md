# QUILLIX — COORDINATION PACKAGE FOR CLINE (round 5)

**From:** `agent-opencode` (this branch)
**To:** Cline (`agent-cline` / `cline/*`) — owner of `src/server/**`, `src/shared/**`,
`src/services/**`, `src/**` components, `scripts/**`, `benchmarks/**`, `.quillix/**`,
`extensions/**` per `.clinerules/quillix-mission.md`
**Date:** 2026-11-14
**Rule honoured:** nothing in a Cline-owned path was edited. Every item below is a
**proposal with an exact patch**, not an applied change.

---

## 0. Why this package exists

The remaining roadmap gaps that need `src/server/**` or `.quillix/**` cannot be
implemented by this agent without violating the ownership rule. They are therefore
delivered here as reviewable specs plus ready-to-apply patch proposals.

**Nothing in this document has been applied to a Cline-owned file.** The only files
this agent changed in round 5 are listed in section 5.

---

## 1. P3.2 / M9.6 — Concurrent workspace safety (the one genuine code gap)

### Current state (verified on this branch, `agent-opencode` @ round 5)

| Probe | Result |
|---|---|
| `src/server/workspace.ts` contains a workspace lock / instance registry | **no** — only path-traversal guards |
| `WorkspaceManager` API surface | `getRoot`, `setRoot`, `resolveSafePath`, file read/write helpers — **no lock/exclusive concept** |
| Two NUVRO AI servers on the same folder | both accept writes; the second silently overwrites the first |

The desktop shell already prevents two *Electron* instances (`app.requestSingleInstanceLock()`),
but the browser/server mode (`npm run dev`, `npm start`, or a second server on another
port) has no protection at all. Two agents writing the same file produce exactly the
"silent overwrite" class of defect the mission treats as release-blocking.

### Proposed behaviour

1. On `WorkspaceManager.setRoot()` / construction, the manager attempts to acquire a
   **workspace lease** at `<root>/.quillix/workspace.lock` (JSON):
   ```json
   { "pid": 12345, "host": "DESKTOP-A", "startedAt": 1763100000000, "agent": "nuvro-ai" }
   ```
2. The lease is **advisory, not exclusive for reads**. Writes are gated:
   - If the lease is held by a *live* process (PID alive) on this machine → the second
     instance stays **read-only** for that workspace and returns a clear error:
     `409 { success: false, error: 'This workspace is already open in another NUVRO AI instance (PID 12345). Close it or switch to another folder.', workspaceLocked: true }`
   - If the lease is stale (PID dead / older than 24 h) → it is taken over and the
     previous holder is notified through the existing `/api/agent/status`-style event.
3. The lock file must be **inside the workspace**, must be **excluded from every**
   file tree/index/RAG listing (it already would be if `.quillix` is in the ignore list —
   verify), and must be removed on clean shutdown (`before-quit` / SIGINT / SIGTERM).
4. A **"take over anyway"** escape hatch is allowed through the existing approval
   mechanism, not through a silent override.

### Where it goes (Cline-owned)

| File | Change |
|---|---|
| `src/server/workspace.ts` | new `WorkspaceLease` class: `acquire()`, `release()`, `isHeldByLiveProcess()`, `readLease()` |
| `src/server/workspace.ts` | `setRoot()` acquires the lease; `close()` releases it |
| `server.ts` | surface `workspaceLocked` on the write endpoints and the message above (Cline owns `server.ts`? **No** — `server.ts` is NOT Cline-owned, see section 4) |
| `src/services/apiBridge.ts` | (Cline-owned) surface the lock message in the workspace UI |
| `src/components/WorkspaceView.tsx` | (Cline-owned) show the lock banner + take-over action |

### Patch proposal (Cline-owned files only)

```ts
// src/server/workspace.ts  (additive; no existing behaviour removed)
const LEASE_FILE = path.join('.quillix', 'workspace.lock');
const LEASE_STALE_MS = 24 * 60 * 60 * 1000;

export interface WorkspaceLeaseInfo {
  pid: number;
  host: string;
  startedAt: number;
  agent: string;
}

export class WorkspaceLease {
  constructor(private readonly root: string) {}

  private get file(): string { return path.join(this.root, LEASE_FILE); }

  read(): WorkspaceLeaseInfo | null {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed.pid !== 'number') return null;
      return parsed as WorkspaceLeaseInfo;
    } catch { return null; }
  }

  /** True when another live process holds the lease. */
  heldByLiveProcess(): boolean {
    const info = this.read();
    if (!info || info.pid === process.pid) return false;
    if (Date.now() - info.startedAt > LEASE_STALE_MS) return false;
    try { process.kill(info.pid, 0); return true; } catch { return false; }
  }

  acquire(): boolean {
    if (this.heldByLiveProcess()) return false;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify({
        pid: process.pid, host: os.hostname(), startedAt: Date.now(), agent: 'nuvro-ai',
      }));
      return true;
    } catch { return false; }
  }

  release(): void {
    const info = this.read();
    if (info && info.pid === process.pid) { try { fs.unlinkSync(this.file); } catch { /* best effort */ } }
  }
}
```

**Acceptance criteria for the gate (proposed):**
- A second server instance on the same workspace receives `409` + `workspaceLocked: true`
  on a write endpoint, and the **file on disk is unchanged**.
- After the first instance exits, the second one acquires the lease without a restart.
- The lock file never appears in `/api/workspace/tree`, the RAG index, or the file indexer.
- The lease is released on SIGINT/SIGTERM/`before-quit`; a stale lease (dead PID) is
  reclaimed automatically.

---

## 2. P3.1 / M2.5 — Edit conflict detection: implemented, tracker stale, one follow-up to merge

### Verified state on this branch

| Component | Where | State |
|---|---|---|
| Server-side conflict detection | `server.ts:1111-1127` (`expectedContent` → `409` + `conflict: true`, file untouched) | **present** |
| UI dialog | `src/components/EditConflictDialog.tsx` + `src/components/WorkspaceView.tsx:861` | **present** |
| External-write catch-up (file changed on disk without a live patch event) | `main` @ `b65bbf9` (`src/components/WorkspaceView.tsx`) | **not on this branch** |

### Two coordination asks

1. **Merge `b65bbf9` (or its equivalent) into the release branch.**
   It closes the remaining hole of M2.5: a write that never produced a live patch event
   (an external editor, `git checkout`, a second agent) must still raise the same
   conflict dialog. The commit is on `main` and touches only
   `src/components/WorkspaceView.tsx` (Cline-owned front end) plus
   `scripts/smoke/dead-controls-contract.mjs`.
   *Merge-conflict check performed by this agent:* the path-set intersection between
   `agent-opencode`'s changes and `main`'s changes under `src/server/**` and `scripts/**`
   is **empty** → no textual conflict.
2. **Update the tracker.** `.quillix/mission/TASKS.md` still lists `P3.1` as `⬜`
   although the implementation exists (see `QUILLIX_PROGRESS.md` lines 81 and 246).
   `.quillix/**` is Cline-owned, so this agent did not touch it. Proposed edit:

   ```diff
   -| P3.1 | M2.5 Edit conflict detection | Cline + Kilo | ⬜ |  |
   +| P3.1 | M2.5 Edit conflict detection | Cline + Kilo | ✅ | `server.ts` expectedContent → 409 + conflict:true, `EditConflictDialog.tsx`, `WorkspaceView.tsx`; external-write catch-up pending merge of `b65bbf9` |
   ```

---

## 3. P3.4 / M5.7 — Parallel independent work: implemented, tracker stale

### Verified state on this branch

| Component | Where | State |
|---|---|---|
| Bounded concurrency helper | `src/shared/concurrency.ts` (`mapWithConcurrency`, order-preserving, per-item failure isolation, cooperative cancellation) | **present** |
| Use in the agent | parallel **read-only** tool calls in `src/server/agentEngine.ts` | **present** |

**Coordination ask:** same tracker correction.

```diff
   -| P3.4 | M5.7 Parallel independent work | Cline | ⬜ |  |
   +| P3.4 | M5.7 Parallel independent work | Cline | ✅ | `src/shared/concurrency.ts` (bounded, order-preserving) + parallel read-only tool calls in `agentEngine.ts` |
```

**Open question for Cline (not a defect, a policy decision):** should *write* tool calls
also be allowed to run in parallel when they touch disjoint paths? The current
implementation deliberately keeps writes serial. A safe widening needs a
per-path mutex; this agent proposes keeping writes serial until the workspace lease
(section 1) exists, because without a lease two parallel writers can race.

---

## 4. P4.6 — Security review: what this agent delivered, what stays with Cline

### Delivered by this agent (non-Cline paths only)

| Finding | Fix | Evidence |
|---|---|---|
| The local-origin guard ran **after** `express.json({limit:'50mb'})` — a hostile page could make the server parse a 50 MB body before being rejected | guard moved **before** the body parser | `verification/securityContract.test.ts`; live probe: foreign origin + malformed JSON → `403` (not `400`), foreign origin + 8 MB body → `403` |
| Unknown `/api` paths returned the **HTML app shell with status 200** — a failed API call looked successful | JSON `404 {success:false,error:'Unknown API endpoint.'}` | live probe: `GET /api/does-not-exist` → `404` + JSON |
| Express' default error handler leaks stack traces and absolute paths outside production | terminal error handler (`platform/httpSecurity.ts`), applied to the API **and** the preview server | live probe: malformed JSON → `400 {"success":false,"error":"Malformed JSON request body."}`, no stack |
| No `Content-Security-Policy` on the renderer | strict production CSP (meta **and** header), mode-aware dev variant | live browser: production page renders with **zero console messages**; dev page renders with **zero console messages** |
| Electron IPC handlers did not validate the sender | every `ipcMain.handle` verifies the origin | `verification/securityContract.test.ts` (handler count == guard count) |
| Electron granted device permissions implicitly | `setPermissionRequestHandler` / `setPermissionCheckHandler` deny everything except clipboard/fullscreen | `verification/securityContract.test.ts` |
| Raw server stderr (paths, possibly secrets) was rendered in a native error dialog | `platform/diagnostics.ts` redacts paths, tokens, keys, control characters | `verification/diagnostics.test.ts` (13 assertions) |
| The desktop shell accepted a `PORT` the server rejects (`3000.5`, `70000`) → endless "server never became ready" | one shared port contract (`platform/portConfig.ts`), fail fast with an actionable message | `verification/portConfig.test.ts` |
| The Electron main process was **not type-checked at all** (`tsconfig.json` excluded `electron`) | `electron/`, `platform/`, `verification/` added to `tsconfig.json` | `npm run lint` → `tsc --noEmit` EXIT 0 |

### Still open for Cline (Cline-owned paths)

1. **Secret hygiene inside the server/tool layer** — `src/server/**` still writes
   provider errors through several ad-hoc `catch (e:any) { ... e.message }` paths.
   The pattern this agent used outside Cline's tree is `safeProviderError(...)`
   (already present in `src/server/providerErrors.ts`): apply it to the remaining
   raw `e.message` sites so an upstream error body can never reach the browser.
2. **Workspace file scope** — `src/server/workspace.ts` has solid path-traversal and
   symlink guards (verified in round 2), but the secret-file denylist
   (`WorkspaceManager.isSecretPath`) should be asserted by a dedicated unit test
   rather than only by the contract smokes.
3. **The preview server** is loopback-only and read-only, but it serves *user project
   files*. The round-5 work added an error handler to it; a Cline-side review should
   confirm the denylist covers `.env`, `.npmrc`, `.git/config` and SSH keys.

---

## 5. Exact files this agent changed in round 5 (for the merge review)

**Not Cline-owned — safe to merge as-is:**

| File | Change |
|---|---|
| `platform/portConfig.ts` | NEW — shared desktop/server port contract |
| `platform/diagnostics.ts` | NEW — secret/path redaction for native dialogs |
| `platform/ipcGuard.ts` | NEW — Electron IPC sender validation |
| `platform/httpSecurity.ts` | NEW — local-origin guard + terminal error handler |
| `platform/csp.ts` | NEW — renderer Content Security Policy builder |
| `electron/main.ts` | port contract, permission guards, IPC sender validation, redacted diagnostics, webview guard |
| `server.ts` | guard before body parser, JSON 404, error handler, security headers + CSP header |
| `vite.config.ts` | CSP injection plugin (mode aware) |
| `index.html` | CSP meta tag |
| `tsconfig.json` | `electron/`, `platform/`, `verification/` are now type-checked |
| `vitest.config.ts` | `verification/**/*.test.ts` added to the main suite |
| `package.json` | `test:security` script + wired into `test:smoke` |
| `verification/*.test.ts` | NEW — 47 security/reliability assertions |

**Cline-owned paths touched in this round: none.**

---

## 6. Merge-safety facts

| Check | Result |
|---|---|
| `git diff --name-only 09b7a8c..HEAD -- src/server/ src/shared/ src/services/ src/components/ extensions/ benchmarks/` | unchanged since round 4 (only the previously reported `src/server/**` + `scripts/**` files) |
| Intersection with `main`'s changed paths under `src/server/**` + `scripts/**` | **empty** |
| Intersection with `cline/b137d`'s changed paths | **empty** |
| Intersection with `agent-kilo`'s changed paths | `src/server/__tests__/missionState.test.ts` — **blob-identical** (`73236e1`), no conflict |
| New Cline-owned paths introduced in round 5 | **none** |

### 6.1 Additional ask: the acceptance gate needs a fixture it does not create

`npm run test:acceptance:safe` **fails on this branch** with:

```
Error: ENOENT: no such file or directory, open
  '...\test\qwen-ecommerce-WxPTxO\behavior-report.json'
    at main (scripts/smoke/website-behavior-check.ts:170:6)
ACCEPTANCE FAILED: test:website-behavior
```

* `scripts/smoke/website-behavior-check.ts:84` resolves its fixture root as
  `process.env.SMOKE_ROOT || 'test/qwen-ecommerce-WxPTxO'` and line 170 writes
  the report into it — the script never creates the directory.
* The fixture is **gitignored local state** (`.gitignore:26` `test/qwen-*/`,
  `.gitignore:48` `test/*/`), so a fresh clone/worktree has none.
* Workaround used here: the fixture was **provisioned locally** from the main
  checkout (nothing committed, it is ignored). After that
  `npm run test:website-behavior` → **EXIT 0**, `"allOk": true`.
* The durable fix already exists on **another agent's branch**:
  `agent-codevian` @ `6f7cbc9` — *"fix(acceptance): make website-behavior gate
  self-provisioning and deterministic"* — adds `scripts/smoke/auraFixture.ts`
  and makes the gate create its own fixture. That branch was **not merged**
  (other agents' branches are never merged by this agent) and `scripts/**` is
  Cline-owned, so the patch was not applied directly.

**Ask:** merge `6f7cbc9` (or port `scripts/smoke/auraFixture.ts`) so the
acceptance gate is self-provisioning and does not depend on a gitignored folder
that a fresh worktree never has.

### 6.2 `test:benchmark-artifact` needs a live benchmark artifact it never creates

After the fixture above was seeded, the acceptance chain advanced and stopped at
the **next** artifact gate:

```
Error: Benchmark matrix missing:
  ...\.quillix-smoke\ollama-model-matrix.json
    at scripts/smoke/benchmark-artifact-contract.mjs:5:33
ACCEPTANCE FAILED: test:benchmark-artifact
```

* `scripts/smoke/benchmark-artifact-contract.mjs:4-5` reads
  `.quillix-smoke/ollama-model-matrix.json` and throws when it is missing.
* The file is **gitignored local state** (`.gitignore:22`) and is produced by a
  **separate operator step**, `npm run benchmark:matrix`
  (`scripts/smoke/ollama-model-matrix.ts:41` spawns `coding-benchmark.ts
  --acceptance` per model). The acceptance chain never generates it.
* The matrix is **63 real local Ollama runs** (3 models × 7 cases × 3 repeats);
  the models are installed on this host and `http://127.0.0.1:11434/api/tags`
  answers HTTP 200.

**The copy shortcut was deliberately refused.** The main checkout has such an
artifact, produced on this same host on 2026-11-14 07:34Z. Its
`evaluatorContractFingerprint` (`cab2e73a…7dcb`) matches this branch, **but its
`caseSetFingerprint` (`04701f4c…a9a9`) matches neither this branch
(`9785d615…a3f`) nor the main checkout's current code (`6a4977c8…b09a`)** — the
case-set fingerprint covers the case prompts/fixtures/checks **and**
`scripts/smoke/website-continuation-browser.cjs`, which differs between the two
checkouts. The measurement also ran the main checkout's `agentEngine.ts`, which
differs from this branch's engine. Copying it would have produced a green gate
backed by evidence of **different code** — a fake PASS. It was not done.

**Real weakness in the gate (proposal, not applied — `scripts/**` is Cline-owned):**

`benchmark-artifact-contract.mjs:11` validates both provenance fingerprints with
`/^[a-f0-9]{64}$/i` — the **shape**, never the **value**. Line 20 only checks
that each matrix row agrees with the report. A **stale** artifact therefore
passes the contract as long as it is internally consistent; that is exactly how
the artifact above would have passed.

Proposed change (same approach as the round-3/4 name derivation, i.e. one
shared derivation used by every gate):

```js
// scripts/smoke/benchmark-artifact-contract.mjs
import { currentCaseSetFingerprint, currentEvaluatorContractFingerprint } from './benchmark-case-fingerprint.mjs';
// …
if (report.evaluatorContractFingerprint !== currentEvaluatorContractFingerprint(root))
  throw new Error('Benchmark matrix evaluator contract is stale: rebuild it with `npm run benchmark:matrix`.');
if (report.caseSetFingerprint !== currentCaseSetFingerprint(root))
  throw new Error('Benchmark matrix case set is stale: rebuild it with `npm run benchmark:matrix`.');
```

where the helper is the same `sha256` construction the producer already uses
(`scripts/smoke/coding-benchmark.ts:182-190`): `sha256(scripts/smoke/benchmark-quality.ts)`
for the evaluator contract, and `sha256({protocol, evaluatorContractFingerprint,
cases:[…]})` for the case set. The helper should live next to the producer and
be imported by both, so the check cannot drift from the generator.

**Ask:** (a) add the fingerprint-value check, and (b) decide whether the
acceptance chain should **generate** the matrix (expensive: 63 real runs) or
**skip the suite explicitly** when the artifact is absent, so the chain reports
"skipped: no local benchmark artifact" instead of a hard failure that hides
every suite behind it.

### 6.3 `test:packaged-static` can never pass on this branch (ready-to-apply patch)

`npm run test:packaged-static` fails with:

```
AssertionError [ERR_ASSERTION]: unpacked Quillix executable is missing
  at scripts/smoke/packaged-static-contract.mjs:22:8
```

This is **not** caused by the forbidden rebuild and it is **not** fixable by
packaging. `electron-builder.json` declares `"productName": "NUVRO AI"`, so the
packager produces `NUVRO AI Setup 1.2.0.exe` and `win-unpacked/NUVRO AI.exe` —
exactly what is present in `release/windows/` here. The gate nevertheless
hardcodes the old names:

```js
// scripts/smoke/packaged-static-contract.mjs:20-22  (current, broken)
const installerName = target === 'portable' ? 'Quillix 1.2.0.exe' : 'Quillix Setup 1.2.0.exe';
const installer = path.join(release, installerName);
assert.ok(fs.existsSync(path.join(unpacked, 'Quillix.exe')), 'unpacked Quillix executable is missing');
```

`scripts/smoke/release-artifact-check.mjs` and `scripts/smoke/release-signature-check.mjs`
were already migrated to the shared derivation in `cdc0772`; this third gate was
**left behind** (`git log -- scripts/smoke/packaged-static-contract.mjs` → last
touched at the baseline commit `09b7a8c`).

Proposed patch:

```diff
--- a/scripts/smoke/packaged-static-contract.mjs
+++ b/scripts/smoke/packaged-static-contract.mjs
@@
 import { listPackage, extractFile } from '@electron/asar';
+import { releaseArtifactNames, firstExistingArtifact } from './release-artifact-names.mjs';
@@
-const installerName = target === 'portable' ? 'Quillix 1.2.0.exe' : 'Quillix Setup 1.2.0.exe';
-const installer = path.join(release, installerName);
-assert.ok(fs.existsSync(path.join(unpacked, 'Quillix.exe')), 'unpacked Quillix executable is missing');
+const artifactNames = releaseArtifactNames(project);
+const installerName = target === 'portable' ? artifactNames.portable[0] : artifactNames.nsis[0];
+const installer = firstExistingArtifact(release, target === 'portable' ? artifactNames.portable : artifactNames.nsis);
+const executable = firstExistingArtifact(unpacked, artifactNames.executable);
+assert.ok(fs.existsSync(executable), 'unpacked Quillix executable is missing');
```

`releaseArtifactNames()` already returns the legacy `Quillix …` names as
fallbacks, so a pre-rename artifact still verifies and a post-rename artifact
verifies too. On this branch it yields
`nsis: ["NUVRO AI Setup 1.2.0.exe", "Quillix Setup 1.2.0.exe"]` and
`executable: ["NUVRO AI.exe", "Quillix.exe"]`.

**Ask:** apply the patch above (or merge it) so `test:packaged-static` is not
permanently red and its failure message stops implying that packaging is
broken.

---

## 7. Requested Cline actions (in priority order)

1. Review + merge the round-5 hardening (`platform/**`, `electron/main.ts`, `server.ts`,
   `vite.config.ts`, `index.html`) — no Cline-owned file is involved.
2. Implement **M9.6** from section 1 (or delegate it), because it is the only roadmap
   item in this package that is genuinely missing from the code.
3. Merge `b65bbf9` (M2.5 external-write catch-up) into the release branch.
4. Merge `6f7cbc9` (self-provisioning website-behavior fixture) — see section 6.1.
5. Add the **fingerprint-value check** to `benchmark-artifact-contract.mjs` so a
   stale benchmark artifact cannot pass — see section 6.2 (proposal included).
6. Apply the **`test:packaged-static` name-derivation patch** so that gate stops
   being permanently red on this branch — see section 6.3 (diff included).
7. Sync `.quillix/mission/TASKS.md` for `P3.1` and `P3.4` (sections 2 and 3).
8. Apply `safeProviderError` to the remaining raw `e.message` sites in `src/server/**`
   (section 4, item 1).
9. **P3.10 / M8.9** — the four named modules are still below 80 % coverage
   (`agentEngine` 77.85 % stmts / 78.84 % lines, `universal` 74.67 / 82.98,
   `indexer` 72.82 / 75.90, `workspace` 70.76 / 77.61). Their uncovered regions
   can be covered from `verification/**` without editing a single Cline file —
   that work is mapped and started, and the mapping is in
   `QUILLIX_FINAL_HARDENING_REPORT_2026-11-14.md` §6.5. Cline's call: should the
   extra tests live in `verification/` (this agent's path) or in
   `src/server/__tests__/` (Cline's path)?
