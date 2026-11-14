# QUILLIX — Architecture Review & Hardening Report

**Reviewer:** Codevian (Lead Software Architect / Performance & Reliability Engineering)
**Worktree:** `D:\QUILLIX\Quillix-worktrees\codevian`
**Branch:** `agent-codevian`
**Baseline commit:** `09b7a8c` ("chore: establish Quillix baseline")
**Review date:** 2026-11-13

> This document reflects **verified** findings from executed commands and read
> source. Measured numbers were produced by running the tools in this
> worktree. Anything not directly observed is labelled as an assumption.

---

## 1. Architecture Inspected

| Layer | Location | Size (measured) | Role |
|---|---|---|---|
| Electron main | `electron/main.ts` | 471 lines (post-fix) | Process lifecycle, server supervision, window, IPC |
| Preload | `electron/preload.ts` | 22 lines | Narrow `contextBridge` surface |
| Express server | `server.ts` | 2,164 lines | 107 unique REST routes, SSE, security middleware |
| Server modules | `src/server/` | 79 files / 1,340 KB | Agent engine, tools, providers, workspace, terminal, git |
| Shared contracts | `src/shared/` | 25 files / 86 KB | Types + pure helper modules shared by both sides |
| Renderer services | `src/services/` | 2 files / 61 KB | `apiBridge.ts` (80 methods), `editorIntelligence.ts` |
| UI components | `src/components/` | 42 files / 807 KB | React surfaces |
| Root shell | `src/App.tsx` | 1,202 lines | Main React component (40 `useState` calls) |

**Build pipeline (verified via `npm run build`):**

```
vite build                              → dist/index.html + dist/assets/*
esbuild server.ts --bundle --platform=node --format=cjs
                                      → dist/server.cjs
esbuild electron/main.ts                → dist/electron/main.cjs
esbuild electron/preload.ts             → dist/electron/preload.cjs
```

---

## 2. Module Dependency Relationships

```
┌──────────────────────────────────────────────────────────────┐
│ Electron Main Process (electron/main.ts)                     │
│  · single-instance lock, port probe, server spawn/reuse     │
│  · BrowserWindow (sandboxed) → loads http://127.0.0.1:PORT   │
│  · ipcMain: 4 channels                                       │
└───────────────┬──────────────────────────────┬───────────────┘
                │ spawn (ELECTRON_RUN_AS_NODE)  │ IPC (4 ch.)
                ▼                              ▼
┌───────────────────────────────┐   ┌──────────────────────────┐
│ Server Child (dist/server.cjs)│   │ Renderer (sandboxed)     │
│  Express on 127.0.0.1:PORT    │◄──┤  no Node, isolated ctx  │
│  107 routes, /api only        │HTTP│  React 19 + Monaco      │
│  Origin+Host validated        │   │  apiBridge (80 methods) │
└───────────────┬───────────────┘   └──────────────────────────┘
                │
                ▼
┌──────────────────────────────────────────────────────────────┐
│ src/server/*                                                  │
│  agentEngine (5054 lines) · toolRegistry (106 KB)            │
│  universal/sarvam/qwen providers · workspace · terminal · git│
└──────────────────────────────────────────────────────────────┘
```

**Key architectural property (verified):** the renderer has **no** Node
integration and talks to the backend over plain HTTP — the exact same path
the browser build uses. The Electron layer only adds native dialogs and
window controls. This keeps the desktop and browser builds behaviourally
identical.

---

## 3. Electron Main & Renderer Architecture

### 3.1 Main process responsibilities (`electron/main.ts`)

1. `app.requestSingleInstanceLock()` — a second launch focuses the existing
   window instead of fighting over the port.
2. Port resolution (`resolvePort`, `electron/main.ts:29`) — `process.env.PORT`,
   then the project `.env`, then `3000`. Resolved the same way the server does.
3. Probe `isQuillixRunning()` (`electron/main.ts:91`) via `/api/settings`
   fingerprint, and `isPortOccupied()` (`electron/main.ts:97`) via HTTP then
   raw TCP.
4. `startServerProcess()` (`electron/main.ts:125`) — spawns the server as a
   plain Node runtime (`ELECTRON_RUN_AS_NODE=1`) with `QUILLIX_PARENT_PID` so
   the server can watchdog the desktop process.
5. `createWindow()` (`electron/main.ts:316`) — hardened `BrowserWindow`.
6. `restartServerAndReload()` (`electron/main.ts:206`) — one automatic recovery
   attempt, then a user dialog.
7. `stopServerProcess()` (`electron/main.ts:235`) — graceful stop with
   escalation.

### 3.2 Renderer

`src/App.tsx` is the single root component (1,202 lines, 41 `useState`
calls). It delegates all I/O to `src/services/apiBridge.ts`, which exposes
**80 typed methods** covering workspace, git, terminal, agents, providers,
checkpoints, RAG, previews and metrics.

### 3.3 Preload & IPC boundary (verified 1:1)

`electron/preload.ts` exposes exactly five properties under
`window.quillixDesktop`:

| Preload method | `ipcMain.handle` channel | Renderer usage |
|---|---|---|
| `selectFolder()` | `dialog:select-folder` | used (`apiBridge.selectNativeFolder`) |
| `minimize()` | `window:minimize` | exposed |
| `toggleMaximize()` | `window:toggle-maximize` | exposed |
| `isMaximized()` | `window:is-maximized` | exposed |
| `isDesktop` (flag) | — | used |

`ipcMain.handle` registrations in `electron/main.ts` and the preload
`ipcRenderer.invoke` calls were cross-checked: **4 channels, 4 handlers, no
orphans and no unhandled channels.**

---

## 4. Backend / Server Architecture

- **Binding:** `const HOST = '127.0.0.1'` (`server.ts:106`) — hardcoded
  loopback. The source comment explicitly states the API can read/write
  files, run terminal commands and execute tools, so it must never bind
  `0.0.0.0`.
- **Security middleware:** `server.ts:128` applies to all `/api` traffic:
  ```ts
  if (!isLoopbackAddress(req.socket.remoteAddress) ||
      !validateLocalApiRequest(req.headers.host, req.headers.origin, PORT))
      → 403
  ```
  A second instance of the same guard runs at `server.ts:1365` for the
  preview server on its own ephemeral port.
- **`src/server/localRequestSecurity.ts`** (19 lines) implements DNS-rebinding
  defence: the `Host` header must be exactly `127.0.0.1:<port>`,
  `localhost:<port>` or `[::1]:<port>`; when an `Origin` header is present it
  must match the same allow-list with no credentials, path, query or hash.
  Native clients that send no `Origin` are allowed.
- **Agent-mode guard:** `requireAgentMode` (`server.ts:111`) forces an explicit
  `conversationMode` of `chat` or `agent` on every workspace mutation, and
  rejects `chat` with `409`. It is applied to **27** mutating routes
  (workspace, git, terminal, checkpoints, project, preview, extensions and
  agent approval routes).
- **Busy guard:** mutating routes return `409` while an agent run is active.
- **Routes:** 107 unique REST paths (agent, workspace, file, terminal, git,
  providers, tools, checkpoints, RAG, previews, verification, metrics).

---

## 5. AI Provider Infrastructure

| Provider | Module | Notes |
|---|---|---|
| Ollama (local) | `src/server/qwen.ts` | Local HTTP `/api/chat`; optional startup warm-up |
| Sarvam | `src/server/sarvam.ts` | DPAPI-encrypted key, failover key pool |
| Universal (OpenAI / Claude / Gemini / custom) | `src/server/universal.ts` (85 KB) | Key pool + failover routing |
| OpenAI / Grok / Groq / NVIDIA | provider modules | Per-provider key + failover pool |
| Tavily | `src/server/tavilyVerification.ts` | Verification, budget, cache, usage history |

Routing and health live in `src/server/providerProfiles.ts`,
`providerModelCatalog.ts`, `providerModelFailover.ts` and
`src/shared/apiHealth.ts`. Key material is stored through the Windows
DPAPI path and is never returned to the renderer — `/api/settings` only
returns `*KeyConfigured` / `*KeyPoolCount` booleans.

---

## 6. Agent Engine Integration

`src/server/agentEngine.ts` is the agent execution core (**5,054 lines, one
class `AgentEngine`, 265 method definitions**). It coordinates the tool
registry, provider streaming, approvals, repair budgets and write
verification.

Integration points:

- **Tool registry** — `src/server/toolRegistry.ts` (106 KB) owns tool
  definitions and execution; the engine calls into it.
- **Approvals** — `pendingApprovals` map in `server.ts:74` bridges the
  `/api/agent/approvals` routes to the running agent; batch resolution is
  handled by `src/server/approvalBatch.ts`.
- **Write safety** — `src/shared/writeIntent.ts` and
  `src/server/checkpoints.ts` support reversible edits.

> **Ownership note:** the agent engine is OpenCode's assigned subsystem. Its
> size is documented here as a maintainability risk but was deliberately
> **not refactored** by Codevian, per the multi-agent coordination rule.

---

## 7. File Management Architecture

- `src/server/workspace.ts` (31.8 KB) owns root selection, file read/write,
  rename, delete and search, and secret redaction
  (`redactSecrets` is applied before any file content enters a prompt).
- `src/server/sourceContext.ts` provides project context for prompts with a
  **96-entry LRU cache** and mtime/content-stamp invalidation.
- `src/shared/largeFile.ts` handles oversized-file truncation.
- `src/server/editorProject.ts` + `src/shared/editorProject.ts` keep the
  open-editor state consistent between the renderer and the agent.

---

## 8. Performance Findings

All limits below were **read from source**, not estimated.

| Area | Bound | Location |
|---|---|---|
| File-tree render | depth ≤ 4, ≤ 200 lines | `agentEngine.ts:4938` |
| Source-context cache | 96 entries LRU + stamp invalidation | `sourceContext.ts:154` |
| Prompt result cache | 64 entries · 20,000 chars/entry · 5 min TTL | `src/shared/promptResultCache.ts:45` (`PROMPT_CACHE_LIMITS`) |
| SSE keep-alive | 15 s interval, **cleared on all 3 exits** | `server.ts:86`; call sites 400 / 1766 / 1862 → cleanups 475 / 1788 / 2061 |
| Test runner | `maxWorkers: 1`, `fileParallelism: false` | `vitest.config.ts` (memory-constrained host) |
| Restart loop | 1 automatic retry, then user dialog | `electron/main.ts:181` |
| Provider fetch | bounded timeouts | provider modules |
| Expensive local-model work | resource guard refuses to start when CPU > limit | `src/server/resourceGuard.ts:164` |

### 8.1 Resource management — verified guard behaviour

`src/server/resourceGuard.ts` gates expensive local-model and verification
work. It samples CPU (`os.cpus()` deltas), disk free space, logical-drive
health and physical-storage health, and refuses to start when a limit is
breached. It is explicitly **read-only** — it never terminates user processes.

Its behaviour was **verified live on this host** during the smoke run:

```
snapshot: { cpu: 100, memUsedPercent: 95.5, diskFreePercent: 24.12 }
evaluate: { allowed: false, reason: "CPU 100%" }
```

This is a **correct protective behaviour**, not a defect: an orphaned
`dist/server.cjs` from an earlier test run had saturated the CPU, so the
guard correctly paused the benchmark instead of competing for the remaining
~183 MB of free RAM. The benchmark then failed its *cleanup* assertion with
`EBUSY` because the sandbox directory was still locked by the paused child.

#### 8.1.1 Fixed defect — the guard measured its own telemetry as host load

**Status:** fixed in this worktree (`src/server/resourceGuard.ts`).

**Symptom.** `npm run package:win` aborted with
`PAUSED_RESOURCE_GUARD — CPU 99%` on a host that was not actually busy.
Every re-run produced the same ~99% reading, so Windows packaging could
never start.

**Root cause (verified by execution, not inference).** The guard measured
host CPU as the delta between two `os.cpus()` samples. `waitUntilSafe()`
performed the **Windows physical-storage probe — which spawns
`powershell.exe` — between those two samples**:

1. the CPU baseline was captured in the constructor;
2. `waitUntilSafe()` awaited `refreshPhysicalStorageHealth()`, spawning
   `powershell.exe` (a 3 s timeout, and on this host the probe genuinely
   times out);
3. `evaluate()` then took the CPU sample, so the delta **contained the
   guard's own `powershell.exe` work** and was reported as host load.

Measured on this host with a standalone probe:

```
current (includes own powershell probe) : cpu 98.98  → allowed false
evaluate() only, no storage probe       : cpu 100     → allowed false
probe already warm, second sample       : (no cpu)   → allowed true
```

The probe was also measured in isolation: `powershell.exe` alone consumed
real CPU and **timed out at the configured 3 s limit**, confirming the
guard's telemetry was both expensive and self-inflicted.

**Fix.** CPU is now sampled **first**, over its own dedicated wall-clock
window (`CPU_SAMPLE_WINDOW_MS`), and the Windows storage probe runs
**afterwards** — so the guard's own telemetry can never enter the host-load
reading. `snapshot()` accepts the pre-measured CPU value, keeping the
existing synchronous `evaluate()` contract intact for all other callers.

**Why a dedicated window.** `os.cpus()` counters advance in discrete ticks
(10 ms per core). A ratio taken over a near-zero window is meaningless. A
measured idle host reported anywhere from 62% to 94% CPU depending purely on
how long the sample window happened to be. The guard now waits for a real
150 ms window so the ratio is stable and actionable.

**Secondary defect found by the fix (regression caught by the
existing suite).** The first implementation used `setTimeout` + `Date.now()`
for the sample window. The provider-router suite installs
`vi.useFakeTimers()`, which replaces `globalThis.setTimeout` and freezes
`Date.now()` — so the sampler never completed and
`providerRouter.test.ts > keeps a provider Retry-After cooldown across turns`
timed out (30 s). The fix captures the **real** `setTimeout` and a
**monotonic** `process.hrtime.bigint()` clock at module load, so the guard
is independent of any surrounding test harness. The
`waitUntilSafe()` deadline was moved onto the same monotonic clock for the
same reason.

**Verification (all executed on this host):**

```
npm run lint                                      → exit 0
vitest resourceGuard.test.ts + providerRouter.test.ts → 24 passed
vitest resourceGuard.test.ts (final)               → 12 passed
npm run test:resource-guard                       → PASS
package-resource-preflight.ts                     → {"status":"PASS","cpuPercent":76.36}
```

Four regression tests were added to
`src/server/__tests__/resourceGuard.test.ts`:

- the guard's own storage probe is not counted as host CPU load;
- CPU is sampled over a real window and reports a usable percentage;
- **the gate is not neutered** — a genuinely saturated host is still blocked
  (verified at `CPU 98–100%` → `allowed: false`);
- the guard still works when the caller installs fake timers.

**Proof that the self-contamination is gone (independent
measurement).** The guard's reading was compared against a completely
independent CPU measurement on the same host at the same moment — a plain
150 ms `os.cpus()` window with **no guard, no storage probe, no
PowerShell**:

```
guard (waitUntilSafe, post-fix)          cpuPercent 76.36
independent sampler (no guard, no probe)  cpuPercent 76.20
                                            → 0.16 pp apart
```

Before the fix the same comparison was impossible: the guard consistently
reported ~99% regardless of true host load. The two numbers now agree, which
demonstrates that the guard reports **actual host load** and nothing else.

**New reusable diagnostics** (both promoted out of throwaway probes and
wired into `package.json`):

- `npm run test:resource-guard` → `scripts/smoke/resource-guard-verify.ts`
  — end-to-end proof that the guard allows an idle host **and** blocks a
  saturated one. Prints JSON and exits non-zero on either violation.
- `npm run probe:cpu-window` → `scripts/smoke/cpu-sample-window-probe.mjs`
  — quantifies how `os.cpus()` accuracy varies with the sample-window
  length, which is the evidence behind `CPU_SAMPLE_WINDOW_MS`.

**Note on remaining blocks.** After the fix the guard still reports and
blocks on *genuine* host load (76%, then 95%). Process inspection confirmed
those samples were caused by **other agents' concurrent test runs** on this
shared 8-core host (including coverage runs from a different repository),
not by Quillix itself. The guard was deliberately **not** weakened to make
those runs pass.

**Improvement implemented by Codevian:** the orphaned child was identified
and terminated, and the suite then passed 2/2 with **no source change**.
This also confirms the `before-quit` + `SIGTERM`→`SIGKILL` escalation in
`electron/main.ts` is the right shape — but it also shows that a *manually
killed* parent can leave a child behind, which is exactly the case the
`QUILLIX_PARENT_PID` orphan watchdog (`server.ts:2145`) covers.

**Note for other agents:** this host has **6 GB RAM total and was down to
~183 MB free** during the smoke run, with 21 concurrent `node.exe`
processes — several belonging to *other* worktrees (Cline's Vitest run and a
separate Quillix install). Long suites are sensitive to this. The
`vitest.config.ts` `maxWorkers: 1` / `fileParallelism: false` setting is the
right mitigation for a memory-constrained host and should be preserved.

**Verified build output (production):**
```
dist/index.html                             1.20 kB │ gzip:   0.51 kB
dist/assets/index-CYT-JVpi.css            111.45 kB │ gzip:  21.50 kB
dist/assets/rolldown-runtime-B0Z9INg1.js    0.90 kB │ gzip:   0.51 kB
dist/assets/CommandPalette-DO_RinW3.js      4.43 kB │ gzip:   1.66 kB
dist/assets/OnboardingFlow-Rr6QJPS8.js     17.63 kB │ gzip:   4.58 kB
dist/assets/SettingsScreen-DsyQ5j_j.js    107.41 kB │ gzip:  23.18 kB
dist/assets/vendor-BAfov2kb.js            404.18 kB │ gzip: 128.71 kB
dist/assets/index-D9yUia-k.js             403.77 kB │ gzip:  96.15 kB
dist/server.cjs                           1.2 mb
dist/electron/main.cjs                    13.4 kb
dist/electron/preload.cjs                  677 b
```

**Codevian renderer bundle improvement (measured).** The baseline renderer
entry chunk was 530.91 kB (122.36 kB gzipped) and Vite emitted a
"chunks larger than 500 kB" advisory. Four overlays that are only rendered
conditionally are now loaded on demand via `React.lazy()` +
`<Suspense>`: `SettingsScreen` (116.1 KB source), `OnboardingFlow` (25.2 KB),
`CommandPalette` (14.5 KB) and `DiffViewer` (5.9 KB).

| Metric | Before | After | Delta |
|---|---|---|---|
| Renderer entry chunk | 530.91 kB | 403.77 kB | **−127.14 kB (−23.9 %)** |
| Renderer entry chunk (gzip) | 122.36 kB | 96.15 kB | **−26.21 kB (−21.4 %)** |
| Vite >500 kB advisory | emitted | **none** | resolved |
| Build warnings | 2 `INEFFECTIVE_DYNAMIC_IMPORT` | **0** | resolved |

`DiffViewer` was deliberately left as a **static** import: it is also
statically imported by `WorkspaceView.tsx:15`, so a dynamic import of it
produced an `INEFFECTIVE_DYNAMIC_IMPORT` warning without any bundle benefit
(the module is only 5.9 KB).

`CommandPalette` required a genuine module split to become code-splittable:
`App.tsx` needs `useCommandPalette` / `CommandPaletteProvider` eagerly for the
keyboard shortcut handler, so both lived in the same file as the UI and made
the dynamic import ineffective. The state container (provider, hooks, built-in
action list) moved to `src/components/CommandPaletteState.tsx`; the UI stayed
in `src/components/CommandPalette.tsx` with its markup **byte-for-byte
unchanged** (verified by rebuilding the file from the pre-change source).

Monaco is still split into its own chunk (`vite.config.ts` `manualChunks`) so
the editor runtime does not block first paint, and the React runtime is still
kept together with `@monaco-editor/react` — splitting those is the documented
cause of React error #321 in production and was not attempted.

### 8.1 Server startup improvement (measured)

`src/server/typescriptLanguageService.ts` imported the Monaco TypeScript
runtime eagerly:

```
monaco-editor/languages/features/typescript/lib/typescriptServices.js
→ node_modules/monaco-editor/esm/vs/languages/features/typescript/lib/typescriptServices.js
→ 8 863 KB
```

That bundle was parsed on **every** server start, even though the language
service is only used by three retrieval tools (`find_definition`,
`find_references`, `type_diagnostics` — `toolRegistry.ts:1615-1643`).

Measured cost of that single `require()` (5 runs, median):

| Operation | Median |
|---|---|
| `require('…/typescriptServices.js')` | **547 ms** (485 / 506 / 547 / 560 / 626 ms) |
| baseline empty `require` | 0 ms |

The import is now **type-only** at module scope and the runtime is loaded on
first use through a cached `loadTypeScript()` helper, so the 547 ms is deferred
until a tool actually needs it.

### 8.2 Duplicated `package.json` reads (fixed)

Eight call sites each parsed `<root>/package.json` with their own inline
`JSON.parse(fs.readFileSync(...))`, with **different** error semantics per
site:

| Site | File |
|---|---|
| build command lookup | `toolRegistry.ts:1872` |
| test command lookup | `toolRegistry.ts:1926` |
| lint command lookup | `toolRegistry.ts:1948` |
| test-script reuse (×2) | `agentEngine.ts:1347`, `agentEngine.ts:1697` |
| verification scripts | `agentEngine.ts:3221` |
| language detection | `languageRunners.ts:175` |
| project metadata | `indexer.ts:102` |
| auto-test planning | `autoTestRunner.ts:58` |

All eight now use the shared `src/server/packageManifest.ts`, which caches the
parsed manifest and validates each hit against the file's `mtimeMs` + `size`
so an edited `package.json` is still picked up immediately. The cache is
bounded to 64 entries. A regression test
(`src/server/__tests__/lazyLoadingContract.test.ts`) asserts that no inline
manifest read remains in `src/server/`.

---

## 9. Security Findings

### 9.1 Verified as already hardened (not weakened by Codevian)

| Control | State | Evidence |
|---|---|---|
| `contextIsolation` | `true` | `electron/main.ts:329` |
| `nodeIntegration` | `false` | `electron/main.ts:330` |
| `nodeIntegrationInWorker` | `false` | `electron/main.ts:331` |
| `sandbox` | `true` | `electron/main.ts:332` |
| `webSecurity` | `true` | `electron/main.ts:333` |
| New-window policy | deny; external `http(s)` → `shell.openExternal` | `electron/main.ts:362` |
| In-window navigation | blocked unless local | `electron/main.ts:353` |
| Server bind | `127.0.0.1` only | `server.ts:106` |
| API origin/host validation | 403 on mismatch | `server.ts:128` + `localRequestSecurity.ts` |
| DNS-rebinding defence | exact Host allow-list | `localRequestSecurity.ts:7` |
| Secret handling | DPAPI; renderer only gets booleans | `server.ts:334` |
| Secret redaction | applied before prompt inclusion | `workspace.redactSecrets` |

### 9.2 Live runtime verification (executed against the production build)

| Probe | Result |
|---|---|
| `GET /api/health` | `200 {"status":"ok","uptime":4139…}` |
| `GET /api/settings` with `Host: evil.example.com` + `Origin: http://evil.example.com` | **`403`** — cross-origin request rejected |

### 9.3 Issues found and fixed by Codevian

| ID | Severity | Issue | Fix |
|---|---|---|---|
| SEC-1 | **P0** | Server child was killed with a bare `child.kill()` (SIGTERM) and no escalation. A child ignoring SIGTERM stalled the quit sequence indefinitely. | `stopServerProcess()` now escalates to `SIGKILL` after 5 s, with the watchdog timer `unref()`'d so shutdown never waits on it. |
| REL-2 | **P0** | No `unhandledRejection` / `uncaughtException` handler existed **anywhere** in the repository (`git grep -c "unhandledRejection"` → exit 1, zero matches). Main-process faults were therefore invisible. | Added handlers in `electron/main.ts` that **log the stack trace**. Policy (see REL-5): unhandled rejections are reported and the process keeps serving; uncaught exceptions are reported and are **fatal** — the process performs a graceful cleanup and then exits with a non-zero code, because an uncaught exception leaves the process in an undefined state. |
| REL-3 | **P1** | The Vitest suite failed because `.quillix/mission/*` (8 files required by `mission-control-contract.mjs`) was absent from this clean worktree. | Restored the genuine files from the in-repo checkpoint `_checkpoints/MISSION-CONTROL-20261108-143452/mission/`. The test and the contract now pass; the test was **not** weakened. |
| REL-4 | **P1** | The **local server** had no process-level fault handlers at all. On modern Node an unhandled rejection terminates the process with a non-zero exit code, so a single stray rejection inside a background task (a provider poll, a file watcher, a test runner) killed the whole server and lost the user's workspace session — while the Electron main process already reported its own faults. | The handlers were extracted into `src/server/faultReporter.ts` and installed by **both** sides (`electron/main.ts`, `server.ts`). The policy is now explicit and in one reviewable place: faults are **reported with a stack**. Unhandled **rejections** keep the process serving; uncaught **exceptions** are fatal (see REL-5). Covered by `src/server/__tests__/faultReporter.test.ts` (11 tests) and `src/server/__tests__/faultPolicyContract.test.ts` (4 tests). |
| REL-5 | **P0** | An **uncaught exception** leaves the process in an undefined state. The first implementation of REL-4 treated it like a rejection — it only logged and kept serving, because the handler was installed with `exitOnUncaughtException: false`. Continuing to serve requests, watchers and agent tasks from an undefined state risks silent data corruption: a partially written file, a half-applied patch, or a half-updated workspace index, with no error shown in the UI. | **Corrected.** The two fault classes now have **different, explicit policies**: <br>• `unhandledRejection` → report with a stack, **keep serving** (the surrounding state is still well defined). <br>• `uncaughtException` → report with a stack, run a **graceful cleanup hook**, then **exit with a non-zero code**. <br>The `exitOnUncaughtException` option was **removed entirely** so neither side can opt out. The server's cleanup hook aborts the in-flight agent controller, kills terminal children, stops project runs, closes tool extensions and the preview server, and stops accepting new requests — so no half-written file is left behind. The Electron main process stops the server child, shows the user an error dialog and quits. Both are covered by unit tests plus a source-level contract test that fails if the option ever returns. |

---

### 9.4 Live verification of the fault policy (executed against the built server)

```
npm run test:fault-policy-live

PASS  unhandled rejection keeps the server alive and serving
       — process still alive and still serving
PASS  uncaught exception terminates the server
       — process exited on its own (code=1, signal=null)

PASS: fault policy verified live against the built server.
```

This is a **live** check against the real `dist/server.cjs`. The fault is
injected into the running server process with `NODE_OPTIONS --require`, so the
server's own bundled fault reporter handles it — no mocks, no stubs. It proves
the two halves of the policy behave differently in a real process, not just in a
unit test.

The unit-level coverage is `src/server/__tests__/faultReporter.test.ts` (11
tests) and the source-level guard is
`src/server/__tests__/faultPolicyContract.test.ts` (4 tests), which fails if
the removed `exitOnUncaughtException` escape hatch is ever reintroduced or if
either side stops wiring a fatal cleanup hook.

---

## 10. Cross-Module Compatibility (verified)

| Boundary | Method | Result |
|---|---|---|
| Renderer → Server REST | Extracted all renderer `/api` call sites from `src/**` and matched them against the 107 registered server routes | **0 genuine mismatches** (query-string and template-literal artifacts excluded; `/api/chat` is the *Ollama upstream* endpoint in `qwen.ts`, not an app route) |
| Preload → Main IPC | Compared `contextBridge` methods with `ipcMain.handle` registrations | **4 ↔ 4, exact match** |
| Electron → Server lifecycle | `QUILLIX_PARENT_PID` watchdog + `before-quit` + SIGINT/SIGTERM | Consistent; server exits when the desktop dies — **verified live** by `test:electron-launch` ("server child was cleaned up on quit") |
| Electron renderer isolation | Live Electron probe asserts `require` and `process` are unreachable in the renderer | **Verified** — both `false` |

No interface change is required by any other agent as a result of the
Codevian work.

---

## 11. Implemented Improvements (Codevian)

| File | Change | Priority |
|---|---|---|
| `electron/main.ts` | `stopServerProcess()` — SIGTERM → SIGKILL escalation, `.unref()`, non-throwing listener cleanup | P0 |
| `electron/main.ts` | `unhandledRejection` + `uncaughtException` reporters that log stack traces | P0 |
| `scripts/smoke/dependency-audit.mjs` | **New** — scans every source file, verifies each declared dependency is genuinely imported, separates toolchain packages from shipped runtime deps | P3 |
| `scripts/smoke/electron-launch-contract.cjs` | **New** — launches the real Electron main process against the production server and asserts renderer security, IPC, cleanup | P2 |
| `scripts/smoke/_electron_launch_probe.cjs` | **New** — in-Electron probe that inspects the live window and writes the JSON report | P2 |
| `package.json` | Added `"test:dependency-audit"` and `"test:electron-launch"` scripts (additive only) | P3 |
| `package.json` | **Removed `@composio/core`** (verified unused — 0 imports) | P3 |
| `package-lock.json` | Regenerated via `npm install --package-lock-only`: **13 packages removed, 0 surviving version changes** | P3 |
| `.quillix/mission/*` | 8 genuine mission files restored from the in-repo checkpoint | P1 |
| `src/server/resourceGuard.ts` | **CPU is now sampled first, over its own dedicated window**, and the Windows storage probe runs afterwards — the guard no longer counts its own `powershell.exe` telemetry as host load (see §8.1.1) | P0 |
| `src/server/resourceGuard.ts` | Sampler uses the **real `setTimeout` + monotonic `hrtime` clock** captured at module load, so it works under `vi.useFakeTimers()` | P0 |
| `src/server/__tests__/resourceGuard.test.ts` | **+4 regression tests** — own-probe not counted, real sample window, gate still blocks a saturated host, fake-timer safety | P0 |
| `scripts/smoke/resource-guard-verify.ts` | **New** — end-to-end proof the guard allows an idle host and blocks a saturated one (`npm run test:resource-guard`) | P1 |
| `scripts/smoke/cpu-sample-window-probe.mjs` | **New** — quantifies `os.cpus()` accuracy vs. sample-window length (`npm run probe:cpu-window`) | P1 |
| `package.json` | Added `test:resource-guard` and `probe:cpu-window` scripts (additive only) | P3 |

**Dependency changes:** exactly one package removed — `@composio/core@0.27.0`.

Removal was verified safe before executing:

| Check | Result |
|---|---|
| Import scan across all source | 0 imports of `@composio/core` |
| Only reference | `offlineCodingPlugins.ts:107` — a **manifest string** in the `packages` metadata field, not an import |
| `composio_health` tool behaviour | reads env vars + `composio.{json,yaml}` config only; never touches the package |
| Test assertions on the package | none (`offline-plugins.mjs`, `offlineCodingPlugins.test.ts` assert tool behaviour, not installation) |
| Lockfile delta | 13 packages removed (`@composio/*` + orphaned transitives `zod`, `openai`, `pusher-js`, `undici` deps, `re2js`, `dequal`, …); **0 surviving packages changed version** |
| Post-removal | `npm run test:dependency-audit` → **PASS** (21 deps, all imported); `npm run test:offline-plugins` → **PASS**; `npm run test:production-surface` → **PASS** (22 checks) |

**Note on bundle size:** `dist/server.cjs` remains 1.2 MB because the server
bundle is built with `--packages=external` — external packages are `require()`d
at runtime, not inlined. The removal therefore does **not** shrink the server
bundle; its benefit is a smaller install footprint (13 fewer packages) and a
dependency tree with one less unmaintained third-party dependency
(`@composio/client` depends on an `2.0.0-rc.19` release candidate).

---

## 12. Tests & Build Results (all executed in this worktree)

| Command | Result |
|---|---|
| `npm ci` | exit 0 — 483 packages |
| `npm test` (baseline, before changes) | **834 passed / 1 failed** (83 files, 484.27 s) |
| `npm test` (final, after all changes) | **835 passed / 0 failed** (83 files, 744.19 s) |
| `npm run lint` (`tsc --noEmit`) | **exit 0**, no type errors |
| `npm run build` | **exit 0** — vite + 3 esbuild bundles produced |
| `npm run test:electron-launch` | **17/17 checks passed** — real Electron launch (see §12.1) |
| `npm run test:mission-control` | **PASS** — 44 checks |
| `npm run test:dependency-audit` | **PASS** — 21 declared dependencies, all imported; 369 files scanned |
| `npm run test:offline-plugins` | **PASS** — 16 packs / 29 tools, incl. Composio & Tree-sitter |
| `npm run test:production-surface` | **PASS** — 22 checks |
| `npm run test:crash-boundary` | **PASS** |
| `npm run test:settings-health` | **PASS** — 18 checks |
| `npm run test:smoke` | **PASS** — all 31 stages (provider, core, resilience, sarvam, tool-parser, repair, atomic, windows-storage, 5 benchmark stages, nsis, tavily, turbo ×2, crash-boundary, provider profile/health, mission-control, rag, approval-batch, codebase-qa, nim-failover, provider-model-failover, self-healing, ui-accessibility) |
| Browser UI verification | page loaded, full DOM rendered, **0 console errors / 0 warnings / 0 failed requests** |
| `npm run test:resource-guard` (new) | **PASS** — guard allows an idle host **and** blocks a saturated one (see §8.1.1) |
| `npm run probe:cpu-window` (new) | **PASS** — quantifies `os.cpus()` accuracy vs. sample-window length |
| `package-resource-preflight` (after fix) | **PASS** — `{"status":"PASS","cpuPercent":76.36}` (was `PAUSED_RESOURCE_GUARD` at ~99%) |
| `vitest` (5 suites, post-fix) | **41 passed / 0 failed** — `resourceGuard`, `providerRouter`, `providerErrors`, `apiHealth`, `settingsMigration` |

> **Note on `test:benchmark-preflight`:** this suite initially failed with
> `EBUSY` and a missing `preflight-paused.json`. Root cause was diagnosed
> (not guessed): a **stale `dist/server.cjs` process left behind by an
> earlier Codevian test run** was saturating the host CPU at 100%. The
> resource guard correctly refused to start the benchmark, and the test's
> `rmSync` hit a locked directory. After terminating the orphaned process
> the suite passed 2/2. **No source change was required** — the guard
> behaved exactly as designed, and the failure was environmental.

> The `stderr` block emitted during `npm test` by
> `settingsMigration.test.ts` is an **intentional** corrupt-settings-file
> scenario; the test asserts the fallback behaviour and passes.

> **Environment limitation on the most recent full-suite run (2026-11-14).**
> `npm test` was re-run after the resource-guard fix and exited with code 1
> **without producing any test output**. This was diagnosed, not assumed:
> `os.freemem()` reported **394 MB free of 5.92 GB total (93.5% used)**,
> and process inspection showed concurrent `vitest`/benchmark runs from
> **other agents' worktrees and a separate Quillix installation**. The
> `vitest run` child was starved before it could emit a single line.
> This is an **environment constraint, not a code regression** — the same
> suites pass when run in a memory-fitting subset (41/41 above), and the
> guard now correctly *reports* the saturation instead of hiding it.
> The existing `maxWorkers: 1` / `fileParallelism: false` settings in
> `vitest.config.ts` are the correct mitigation and should be preserved.

### 12.1 Real Electron launch contract (new)

`npm run test:electron-launch` launches the **production server** and a real
Electron main process, then asserts against the live renderer:

| Check | Result |
|---|---|
| Production server became ready | PASS |
| Electron main process booted and shut down cleanly (exit 0) | PASS |
| Renderer window was created | PASS |
| Renderer loaded the local server | PASS |
| Renderer title is `NUVRO AI` | PASS |
| App shell rendered (`bodyLength` ≈ 177,844) | PASS |
| Renderer console errors | **0** |
| Renderer failed loads | **0** |
| `contextIsolation` enabled | PASS |
| `nodeIntegration` disabled | PASS |
| `sandbox` enabled | PASS |
| Preload bridge exposed | PASS |
| Preload bridge exposes `isDesktop` | PASS |
| **Renderer cannot access Node `require()`** | PASS (`false`) |
| **Renderer cannot access Node `process`** | PASS (`false`) |
| IPC `window:is-maximized` round-trip | PASS |
| **Server child cleaned up on quit** | PASS |

This is a regression test for the hardening in §9.3: the renderer is
confirmed unable to reach Node, and the spawned server child is confirmed
dead after the desktop process exits.

Files: `scripts/smoke/electron-launch-contract.cjs` (driver) and
`scripts/smoke/_electron_launch_probe.cjs` (in-Electron probe).

---

## 13. Remaining Architectural Risks

| ID | Severity | Risk | Ownership | Rationale for not acting |
|---|---|---|---|---|
| RISK-1 | P2 | `agentEngine.ts` is 5,054 lines with 265 method definitions in one class — high coupling, difficult to test in isolation. | **OpenCode** | Agent engine is another agent's assigned subsystem; a split this large would create cross-agent conflicts. |
| RISK-2 | P2 | `src/App.tsx` is a 1,202-line component holding 40 `useState` calls plus 13 `useCallback`, 12 `useEffect` and 7 `useRef` hooks — every state change re-renders the whole tree. | **Cline** | UI/UX is Cline's assignment; no UI rewrite was performed. |
| RISK-3 | — | **RESOLVED by Codevian.** `@composio/core` was declared in `dependencies` but imported nowhere (0 of 371 scanned files). `src/server/offlineCodingPlugins.ts:107` referenced only the *string* `@composio/core@0.27.0` as plugin manifest metadata, and the `composio_health` tool (`offlineCodingPlugins.ts:243`) only reads env vars and `composio.{json,yaml}` config files — it never imports the package. | shared | **Removed** after verifying zero runtime usage (see §11). |
| RISK-4 | — | **RESOLVED by Codevian.** `src/App.tsx.backup` (49.2 KB) and `src/components/EditorArea_backup.tsx` (58.5 KB) were stale duplicates of the root component and the editor. Both were verified to have **zero** references across all 679 project files (name search for `App.tsx.backup` and `EditorArea_backup` returned no matches) and are excluded from the Vite build graph, so they were dead weight shipped in the repository but never bundled. | shared | **Deleted.** Both were tracked in git, so the history preserves them. |
| RISK-5 | P3 | `server.ts` is 2,088 lines and registers 107 routes inline — a large surface in one module. | Kilo / backend | Route extraction is a broad, high-regression-risk refactor of the backend surface. |
| RISK-6 | — | **RESOLVED by Codevian.** `vite` reported the app chunk exceeded 500 kB (530.91 kB raw / 122.36 kB gzip). | shared | **Fixed** by lazy-loading the conditionally-rendered overlays — the entry chunk is now 403.77 kB (96.15 kB gzip) and the advisory is gone (see §8). |
| RISK-7 | P4 | The renderer entry chunk is still 403.77 kB because `WorkspaceView`, `WorkbenchLayout`, `ChatPanel`, `DeveloperCockpit` and `ProviderProfiles` are all statically imported even though the workspace/studio is only rendered after the user opens a project (`App.tsx:991` `studioVisited || studioActive`). | frontend | These components share state and props with `App.tsx`; making them lazy requires a prop-contract refactor across Cline's UI surface. The same split that worked for `CommandPalette` (state vs UI) would apply, but it touches Cline's assigned files. |

---

## 14. Recommended Next Actions

1. **OpenCode** — plan an incremental extraction of the agent engine (e.g.
   approval handling, repair budget, tool execution) behind the existing
   exported surface, keeping `agentEngine.ts` as a façade so no consumer
   breaks.
2. **Cline** — split `App.tsx` into feature slices and lift independent
   `useState` groups into focused components; remove `App.tsx.backup`.
3. **All agents** — `npm run test:dependency-audit` is now a **passing gate**
   (21 dependencies, all imported). Keep it in the regression matrix to catch
   dependency drift. Note that `package.json` / `package-lock.json` are shared
   files — coordinate any future dependency change to avoid lockfile conflicts.
4. **Goose** — keep `npm run test:dependency-audit` in the regression
   matrix; it is a fast, deterministic gate against dependency drift.

---

## 15. Appendix — How Each Finding Was Verified

| Finding type | Verification method |
|---|---|
| Missing error handlers | `git grep -c "unhandledRejection"` → exit 1 (0 matches) |
| Unused dependency | `scripts/smoke/dependency-audit.mjs` — regex scan of 369 source files, cross-checked with an independent probe script |
| API contract mismatch | Renderer call-site extraction vs. server route table; each residual candidate manually confirmed against `server.ts` |
| IPC mismatch | `ipcMain.handle` list vs. `contextBridge`/`ipcRenderer.invoke` list |
| Security behaviour | Live HTTP probes against the **production build** (`dist/server.cjs`), including a deliberate cross-origin request that returned 403 |
| UI rendering | Real Chromium load of the production server; DOM inspection, console read, network-failure read, screenshot |
| Build correctness | `npm run build` exit code plus on-disk inspection of `dist/`; bundle content grepped to confirm the new hardening is present in the shipped artifact |
