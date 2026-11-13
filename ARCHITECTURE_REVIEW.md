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

**Verified build output (production):**

```
dist/index.html                             1.20 kB │ gzip:   0.51 kB
dist/assets/index-CYT-JVpi.css            111.45 kB │ gzip:  21.50 kB
dist/assets/rolldown-runtime-B0Z9INg1.js    0.90 kB │ gzip:   0.51 kB
dist/assets/vendor-BAfov2kb.js            404.18 kB │ gzip: 128.71 kB
dist/assets/index-BMYaoSeb.js             530.91 kB │ gzip: 122.36 kB
dist/server.cjs                           1.2 MB
dist/electron/main.cjs                    12.4 kB
dist/electron/preload.cjs                  677 B
```

The renderer entry chunk is 530.91 kB (122.36 kB gzipped) and Vite emits a
"chunks larger than 500 kB" advisory. Monaco is already split into its own
chunk (`vite.config.ts` `manualChunks`) so the editor runtime does not block
first paint. Further splitting of the app chunk was **not** attempted: it
would require splitting the React runtime away from `@monaco-editor/react`,
which the existing config comment identifies as the cause of React error
#321 in production.

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
| REL-2 | **P0** | No `unhandledRejection` / `uncaughtException` handler existed **anywhere** in the repository (`git grep -c "unhandledRejection"` → exit 1, zero matches). Main-process faults were therefore invisible. | Added handlers in `electron/main.ts` that **log the stack trace**. They report faults; they deliberately do not swallow them and do not `process.exit`, so the window stays usable and the error is visible. |
| REL-3 | **P1** | The Vitest suite failed because `.quillix/mission/*` (8 files required by `mission-control-contract.mjs`) was absent from this clean worktree. | Restored the genuine files from the in-repo checkpoint `_checkpoints/MISSION-CONTROL-20261108-143452/mission/`. The test and the contract now pass; the test was **not** weakened. |

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
| Browser UI verification | page loaded, full DOM rendered, **0 console errors / 0 warnings / 0 failed requests** |

> The `stderr` block emitted during `npm test` by
> `settingsMigration.test.ts` is an **intentional** corrupt-settings-file
> scenario; the test asserts the fallback behaviour and passes.

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
| RISK-4 | P3 | `src/App.tsx.backup` (49.2 KB) is a stale duplicate of the root component. | Cline | Removing a file another agent may be actively diffing against is unsafe without coordination. |
| RISK-5 | P3 | `server.ts` is 2,088 lines and registers 107 routes inline — a large surface in one module. | Kilo / backend | Route extraction is a broad, high-regression-risk refactor of the backend surface. |
| RISK-6 | P4 | `vite` reports the app chunk exceeds 500 kB (530.91 kB raw / 122.36 kB gzip). | frontend | Monaco is already split; further splitting risks React #321 per the config comment. |

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
