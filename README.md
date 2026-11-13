> **v1.1.0 Next-Level Upgrade (2026-10-12):** See [Upgrade report](QUILLIX_NEXT_LEVEL_UPGRADE_2026-10-12.md) for Home Quick Connect, OpenAI Responses API, scoped encrypted credentials, and verified testing limitations.

> **Current source checkpoint (2026-11-06):** After the project-memory trust-boundary change and correction of an outdated benchmark-comparison test fixture, `npm.cmd test` passed 55 files / 581 tests; `npm.cmd run lint`, production build and backend HTTP E2E also passed. The portable artifact described below is stale; `test:release-artifact` correctly rejects it. Rebuild and verify a fresh package before distribution. A local-model benchmark previously paused below its 2.00-GiB RAM floor. See [submission readiness checklist](HACKATHON_SUBMISSION_PACK.md) and [200-hour roadmap](QUILLIX_200_HOUR_ROADMAP.md).

> **Smoke-suite refresh (2026-11-06):** Latest `npm.cmd run test:smoke` passed all 17 subcommands (140 tests, 0 failures; exit code 0). The retained log is `.quillix-smoke/test-smoke-roadmap-2026-11-06-schema3.log`. Several Git/settings fixtures now use a workspace-local temporary directory because this Windows sandbox denies Git writes under OS temp. Symlink-specific coverage only runs when Windows permits creating the symlink. This does not include a new live model matrix or packaged launch acceptance.

> **Latest source hardening:** `QUILLIX_AGENT_HARDENING_REPORT.md` documents adaptive phases, bounded tool retries, new browser-script checks and current verification limits. Run `npm run test:resilience` as part of acceptance testing.

> **Previous package checkpoint (November 6, 2026):** Portable Windows executable at `release/windows/NUVRO AI 1.2.0.exe`, 743,496,219 bytes; SHA-256 `A8A57E66DDF1E40D48E56F44BBA18A6378A7C889C2EFDE693F286D6F7E47F3F1`. Artifact/static checks passed at that source revision, but a later trust-boundary update made its fingerprint stale; do not distribute this copy. Signature check reports `NotSigned`. It was a portable fallback, not an NSIS installer, and packaged launch remains unverified. The failed NSIS run's undersized EXE and blockmap residuals were removed; the fallback packager now cleans such files only after a successful portable build and preserves any installer at least 10 MiB.

> **Windows signing contract:** `package:win` supports electron-builder's `CSC_LINK`/`CSC_KEY_PASSWORD` or the explicit `QUILLIX_WIN_CERTIFICATE_FILE`/`QUILLIX_WIN_CERTIFICATE_PASSWORD` variables. The explicit certificate path is validated before packaging. `test:release-signature` checks both the packaged app executable and installer. Run `QUILLIX_REQUIRE_SIGNED_RELEASE=1 npm run test:release-signature` in a signed/allow-listed release environment; the local unsigned artifact must remain a warning, never a false pass.

> **Acceptance supersession:** The checkpoint above supersedes older 45/394, 46/405, 48/415 and portable-only notes below. The 3-model local matrix passed 18/18 historically; the current-source single-case model run paused because free RAM was below the model floor. A 6 November public Axios task passed its focused native reproduction 5/5, but it is not an official SWE-bench grade; a separate provider-backed attempt remains ungraded. The latest recorded packaged-debugger run passed on older packaged source; current-source packaged launch remains pending. The older Device Guard failure is historical.

> **Benchmark gate:** `npm run test:benchmark-artifact` validates `.quillix-smoke/ollama-model-matrix.json` for the required 3-model × 7-case matrix with 3 repetitions (63 live runs across 21 unique conditions), including the adversarial project prompt-injection case, 100% pass rate, per-model protocol/evaluator/case-set fingerprints, hardware metadata, and summary schema v3. Schema v3 separates successful-run quality from all-attempt latency, token and model-call percentiles, repair-phase outcomes, and regression counts; it reports provider, mixed, estimated, zero-call, and unaccounted token coverage explicitly, and rejects incomplete accounting. Historical 18/18 artifacts represent the former six-case, single-trial protocol and do not satisfy the new gate.

> **Historical feature checkpoint (2026-11-05):** The 52-file / 465-test regression and provider, RAG, Tavily, and project-continuation features recorded for this date are superseded as a current-source test count by the 6 November checkpoint above. `npm run test:acceptance:safe` is the no-launch/static path; `npm run test:acceptance:all` is the explicit live-service and packaged-debugger gate. A fresh current-source full gate remains pending.

Provider Profiles also include a local-only “Import provider code” helper: paste a literal Python `requests.post` example from a provider’s docs to prefill endpoint, model, protocol and supported authentication fields. The snippet is never executed or uploaded; credentials are saved only after explicit confirmation through the existing encrypted provider-key flow.

Token-efficiency observability records estimated sizing for every brain and uses provider-reported usage when Ollama or a compatible online API returns token counts; benchmark reports preserve the source as estimate, provider, or mixed. Every model-facing tool result is now compacted deterministically by tool type: source and failure evidence retain useful head/tail lines, noisy listings are deduplicated and bounded more tightly, ANSI noise is removed, and identical repeated results are replaced by a short reference. This keeps the verified evidence while reducing repeated input-token spend; the telemetry counts the compact envelope actually sent to the model. A project request sent to a profile that explicitly declares `tools: false` now fails fast with a clear capability diagnostic instead of retrying a text-only model and wasting tokens or rate-limit quota; tool-shaped text is still never executed accidentally.

The built-in web preview is available from the Studio project runner with an isolated loopback origin, live reload, retry/stop/open controls, and responsive viewport presets for responsive, mobile (390px), tablet (768px), and desktop (1280px) checks.

Universal provider connection tests verify text access and, when a profile declares function calling, send a harmless native tool probe. A profile is not reported as fully connected when text works but the model cannot return the tool contract required by the coding agent.

The backend E2E covers that probe through a real local OpenAI-compatible endpoint. Follow-up edits also preserve the active project target: implicit requests such as “connect the CSS and JavaScript” or “add login” continue in the remembered project, while explicit “create a new/another project” requests still receive a fresh folder.

Acceptance coding benchmarks enforce a focused first-call budget: at most 12
tools and at least 80% tool-schema reduction. Override these thresholds only
for a deliberate experiment with `QUILLIX_BENCHMARK_MAX_FIRST_TOOLS` and
`QUILLIX_BENCHMARK_MIN_SCHEMA_REDUCTION_PERCENT`.

# NUVRO AI

## Tavily stale-answer verification

NUVRO AI now includes an optional Tavily verification layer using the official
`@tavily/core` JavaScript SDK. The agent exposes a read-only
`verify_current_information` tool for version-sensitive API, library, and
documentation claims. It performs bounded Search + Extract retrieval, ranks
official documentation, returns `supported`, `possibly_stale`,
`contradicted`, `unverified`, or `offline` findings with source URLs, caches
recent checks for 15 minutes, and records aggregate search/extract/credit usage.

Configure the key from Settings → Tavily freshness verification. Keys are
encrypted with Windows DPAPI. Offline Mode never calls Tavily and returns an
explicit `offline` result; a stale finding never edits files directly and must
flow through NUVRO AI's normal approval, edit, test, rollback, and retest path.
See [QUILLIX_TAVILY_VERIFICATION.md](src/server/QUILLIX_TAVILY_VERIFICATION.md)
for the API surface and hackathon mapping.

Run `npm run demo:tavily` for a reproducible hackathon demonstration. It shows
claim extraction, official-source contradiction, approval, targeted correction
and a real `node --check` retest using a recorded fixture; fixture mode is
explicit and spends no Tavily credits. The live Search + Extract path is covered
separately by the service, HTTP E2E and configured-key verification.

For an optional real-account smoke, run `npm run test:live-tavily`. It prints
only sanitized findings, citations and usage; without a configured key it
returns an explicit `SKIP` and never contacts the network.

For the complete hackathon walkthrough, evidence commands, architecture
disclosure and submission checklist, see
[HACKATHON_SUBMISSION_PACK.md](HACKATHON_SUBMISSION_PACK.md).

**NUVRO AI — Local AI Coding Agent (Windows Desktop App)**

**Release status:** Windows-verified stabilization candidate (November 1, 2026). The source, offline Ollama repair loop, runtime website smoke, and fresh NSIS installer have passed the current acceptance gates listed below. This is not a claim of zero defects, code signing, or Cursor/Codex equivalence.

NUVRO AI is a chat-first AI coding agent with a full local-first workflow. It can use a local Qwen model through Ollama for offline coding, or an explicitly selected online provider/API when you choose one. Behind the clean chat dashboard sits a full agent toolchain: file tools, search, patching, terminal, Git, diagnostics, and an autonomous multi-turn agent engine.

## Quick start (desktop app)

```powershell
npm install
npm start
```

That is the whole workflow. `npm start`:

1. Builds NUVRO AI automatically on first run (if `dist/` does not exist yet).
2. Starts the local NUVRO AI server on **127.0.0.1:3000** (localhost only — never `0.0.0.0`).
3. Waits until the server is actually ready before opening the window.
4. Opens the native NUVRO AI **Electron desktop window** with the full UI.

No browser tab, no manual server, no extra commands. If Ollama is not running, the window still opens and shows a clear local error — NUVRO AI never silently falls back to a cloud AI provider. Select and verify an online provider explicitly when you want cloud coding.

If you prefer the classic browser workflow during development: `npm run dev` (server + Vite HMR at http://127.0.0.1:3000).

```
NUVRO AI
  ↓
AgentEngine (10–15 phase workflow, live phase events)
  ↓
Tool-Call Parser (native tool_calls AND text-emitted tool-call JSON)
  ↓
Tool Validation (registry + workspace safety)
  ↓
Real Tool Executor (files / terminal / build / tests / git)
  ↓
Automatic Verification (node --check, py_compile, JSON & HTML checks)
  ↓
Language Runner System (per-language adapters: entry point, install/build/run/test)
  ↓
REAL project execution (run the project, capture output & exit code)
  ↓
Test → Fix → Retest repair loop (syntax AND runtime errors)
  ↓
Project Memory (workspace, project root, language, errors, fixes)
  ↓
Project RAG (local bounded chunks, relevant-file retrieval, secret/generated-file exclusion)
  ↓
File-location report (PROJECT ROOT + every file with its absolute path)
  ↓
AIProvider
  ↓
OllamaQwenProvider (loopback only)
  ↓
Ollama http://localhost:11434
  ↓
Local Qwen model (qwen2.5-coder:3b)
  ↓
Coding Agent Tools
```

**Tool calls are executed, never displayed.** Small local models sometimes write
tool calls as text (`{"name": "create_file", "arguments": {...}}`) instead of
using the native tool-calling format. The agent engine intercepts that text,
executes the real tools against the active workspace, and keeps the raw JSON —
and large generated source code — out of Chat. Chat shows conversation,
progress, phase status and summaries; generated code goes into the files
themselves and the Editor. Every substantial request runs as a 10–15 phase
workflow (Understand → Inspect → Plan → Implement → Validate → Test → Fix →
Retest → Verify → Report) shown live in a collapsible Agent Activity panel;
phases only advance when the real work behind them actually happened, and are
honestly reported as *skipped* when not needed.

For a single prompt such as `Build a task tracker website`, the project
contract requires `index.html`, `style.css`, and `script.js` (unless the prompt
explicitly requests a single-file page). If the prompt asks for assets or a
config file, those are added to the manifest too. NUVRO AI writes each file in
small staged tool calls, checks that local HTML references resolve, checks that
the page has meaningful structure and linked CSS/JS, and loops through bounded
repair attempts before claiming success. Static websites are previewable but
are not treated as browser-executed tests.

There is **no silent cloud AI fallback**. Cloud requests are made only after you explicitly select an online provider, turn Offline Mode off, configure its endpoint/model, and verify its credential. Universal API supports OpenAI-compatible Chat Completions, OpenAI Responses, Anthropic Messages, Gemini, and custom HTTPS-compatible gateways.

## Brain/body architecture

NUVRO AI's **body** owns the workspace, file/search tools, patching, terminal,
Git, approvals, verification loops, activity logs, and the desktop/browser UX.
The **brain** is a replaceable provider behind that body. The built-in brain
registry currently exposes Ollama (offline) plus Sarvam, OpenAI, Grok, Groq,
and Universal API (online), with capability metadata for tools, streaming, and
reasoning. Offline Mode blocks every online brain before credentials or network
requests are used.

The local `GET /api/brains` endpoint exposes only the active brain and safe
catalog metadata; provider factories and credentials never cross the API
boundary. In-process extensions can register another `BrainDefinition` through
`ProviderRouter.registerBrain(...)` without changing the agent engine. This is
the extension point for future packaged plugins while keeping the body
provider-agnostic.

For model catalogs exposed by the selected provider, recoverable model errors
can retry the same request against another model on that same endpoint. This
does not switch cloud providers or bypass account quota/cooldown headers. A
streamed retry is allowed only before any response text reaches the UI; after
partial output, NUVRO AI stops rather than duplicating the reply. NVIDIA NIM
uses its account-specific model catalog; other compatible APIs use their
configured `/models` endpoint. Providers that do not expose a model catalog
cannot offer this fallback.

## Requirements

- Node.js
- Ollama installed locally
- A local Qwen coding model installed through Ollama (default: `qwen2.5-coder:3b`)

## Setup

1. Install Ollama from <https://ollama.com>.
2. Install a local Qwen coding model, e.g. `ollama pull qwen2.5-coder:3b`. NUVRO AI never downloads models automatically.
3. Start Ollama (`ollama serve` or the desktop app).
4. Install NUVRO AI dependencies: `npm install`
5. Start NUVRO AI: `npm run dev`
6. Open <http://127.0.0.1:3000> and verify the connection via **Settings → Test Connection**.

**After Ollama and the local model are installed, AI inference does not require an internet connection.** Disable your network and NUVRO AI keeps working.

## The dashboard

- **Chat-first UI** — tell NUVRO AI what you want; NUVRO AI does the coding. Quick actions (Fix a bug, Build something, Analyze project, Run tests, Fix errors, Refactor code) start the right workflow.
- **Agent modes** — Agent (execute), Ask (explain), Plan (roadmap), Debug (investigate & fix).
- **Live activity** — friendly step-by-step progress ("Analyzing project", "Reading relevant files", "Running tests") with a Details expander for the raw log.
- **Result cards** — summary, changed files, verification (Tests / Build / TypeScript), and View Changes / Continue / Run Again.
- **Themes** — Light, Dark, Gray, and Gradient; your choice persists across restarts.
- **Workspace on demand** — the full IDE (explorer, Monaco editor, terminal, Git, build panel) opens from the sidebar without cluttering the dashboard.

## Offline Mode & security

- Offline Mode is **ON by default**: AI requests only go to Ollama on `localhost`, `127.0.0.1`, or `::1`. Remote Ollama URLs are rejected while it is enabled, and NUVRO AI never silently switches providers.
- The local API binds to **127.0.0.1 only** — no LAN exposure of your files, terminal, or tools.
- All file and terminal operations are confined to the active workspace: `../` traversal, absolute paths outside the root, and symlink escapes are blocked.
- Dangerous terminal commands require explicit approval (streamed to you while the agent works). Git commits and restores require authorization.
- **Auto Apply Diffs** is off by default. Agent file edits are staged as reviewable diffs until you approve them; turn it on in Settings if you want automatic application.
- The Electron renderer is fully sandboxed (`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`) and receives **no privileged Node APIs** — it talks to the local server over HTTP exactly like the browser build. External links cannot navigate the window away from NUVRO AI.

## Desktop app behavior

- The desktop window waits for server readiness, then opens maximized (min 1024×700) with the NUVRO AI icon.
- **Port already in use?** If another NUVRO AI server is already listening on 127.0.0.1:3000, the app reuses it (no EADDRINUSE crash, no duplicate server). If an unrelated application holds the port, NUVRO AI reports the problem clearly instead of crashing. A second desktop launch focuses the existing window instead of spawning duplicates.
- **No orphan processes:** closing the window (or Ctrl+C in the terminal) stops the server cleanly; even if Electron is killed abruptly, the server detects the dead parent and shuts itself down.
- If the server crashes while the app is open, you are offered a one-click restart.

## Settings

All settings are live and persisted in `~/.quillix/settings.json`:

| Setting | Effect |
| --- | --- |
| Model | The Ollama model used for every request |
| Ollama URL | Provider endpoint (loopback only while Offline Mode is ON) |
| Offline Mode | Restricts AI requests to local Ollama |
| Max Autonomous Turns | Real cap on agent iterations per prompt |
| Temperature | Sampling temperature sent to Ollama |
| Terminal Approval | Dangerous commands need your approval |
| Auto Apply Diffs | When off, edits are staged for review |
| Git Authorization | Commits/restores need your authorization |
| Theme | Light / Dark / Gray / Gradient |

## Two modes: Normal Chat & Coding Agent

NUVRO AI automatically detects what you want before touching any tools:

- **Normal Chat** — greetings, questions, advice, explanations ("Hi", "Give me advice about my project", "Explain Python classes"). These are answered conversationally by the local model. **No tools are passed to the model at all**, so a normal conversation can never read, write, or delete files.
- **Coding Agent** — build/fix/run requests ("Create a Python calculator", "Build a shooting game from scratch", "Run npm test", "Fix this project"). These run the autonomous agent loop: inspect workspace → plan → create/modify files → run commands → check errors → fix → verify, until the task is complete. Multi-file projects are created file by file, directly on disk.

The intent router is deterministic (no model guessing), and ambiguous messages default to chat — never to accidental tool execution.

## Navigation: Dashboard · Chat · Action

The primary navigation is intentionally minimal — three entries only:

- **Dashboard** — NUVRO AI status, Ollama connection, active model, the ACTIVE WORKSPACE path, recent projects, real recent activity, and quick actions (Open Workspace / Create Project / Open Chat).
- **Chat** — the primary coding-agent interface. Ask in plain language; every activity shown (inspecting workspace, creating files, running tests) corresponds to a real operation the agent executed.
- **Action** — the separate project/workspace system: Open Workspace, Create New Project, File Explorer, Terminal, Run Project, Build Project, Test Project, and Project Settings. Run/Build/Test execute real commands in the active workspace and show the real output with exit codes (plus a "Fix with Agent" shortcut that sends failures to the chat agent).

The File Explorer / Terminal / editor open as a full workspace view from **Action** — they never clutter the primary navigation.

### The active workspace is authoritative

When you select a folder (Action → Open Workspace, Dashboard → Open Workspace, or the native picker), it becomes the single active workspace:

- Every agent file operation resolves against it (`read_file("src/app.py")` → `<workspace>/src/app.py`), with path-traversal and symlink escapes blocked.
- Every terminal command, test and build runs with `cwd` = the workspace.
- It is persisted in `~/.quillix/settings.json` and restored on the next start (recently used workspaces are tracked for the Dashboard).
- `.env` / key / credential files are protected from being read into the model context.

## Real Coding Agent upgrade — what NUVRO AI does with a prompt

NUVRO AI is a LOCAL CODING AGENT, not a chatbot that writes code. For any coding
request the full loop is:

INSPECT → UNDERSTAND → PLAN → CREATE/MODIFY FILES → RUN → TEST →
ANALYZE ERRORS → FIX → RETEST → VERIFY → REPORT

Key systems behind it:

- **Dedicated project folders.** "Create a calculator" creates
  `<workspace>/Calculator/` — every file of that request is routed into the
  folder automatically, even when the model writes bare paths like
  `index.html`. Follow-ups ("fix the car") continue in the same folder.
- **Multi-language runner system.** Per-language adapters (Python,
  JavaScript/TypeScript/Node, static web, React/Vite, C, C++, C#, Java, Go,
  Rust, PHP, Ruby, Kotlin, Swift, Shell/PowerShell) each know their entry
  point, package manager, install/build/run/test commands and how to verify
  them. Runtime availability is probed (`python --version`, `g++`, …) — never
  assumed; a missing runtime is reported honestly.
- **Real execution verification.** After the files are written, NUVRO AI
  EXECUTES the project for real. A non-zero exit code feeds the actual error
  output back into a bounded repair loop, then re-runs. A process that
  survives the smoke-test window (games, servers) counts as "started
  successfully".
- **RUN / PREVIEW buttons.** A bar above the editor shows the detected
  language and entry point, with a real **Run** button (spawns the actual
  process, live output, exit status, stop & restart) and — for web projects —
  **Preview**, which opens the site inside NUVRO AI through the loopback-only
  preview server.
- **Resizable terminal.** A draggable divider between the editor/preview and
  the terminal (drag up = bigger terminal, double-click = reset). The height
  is remembered for the session. Multiple terminal tabs, stop, restart,
  auto-scroll toggle, copy, and clear are all supported.
- **File-location reporting.** Every project run ends with a real filesystem
  report: project name, absolute project root, every created or modified file
  with its absolute path, the project file tree, and the verification summary.
  It is generated from the disk state, never from the model's claims.
- **Project memory.** NUVRO AI remembers the selected workspace, each
  project's root, language, framework, entry point, dependencies, previous
  errors and fixes, and the last test status (stored in
  `<workspace>/.quillix/memory.json`). "Fix the car" resolves to the CarGame
  project you built earlier. Secret files are never stored or exposed.
- **Chat stays clean.** Tool calls written as text are parsed and EXECUTED,
  never displayed; source code goes into files and the editor, not into chat.

### Deterministic tool-call contract

Qwen can request tools through any of these structured formats — all are
validated, normalized and EXECUTED (never displayed):

    {"name": "write_file", "arguments": {"filePath": "x.html", "content": "…"}}
    {"tool":  "file_write", "arguments": {"path": "x.html", "content": "…"}}
    {"tool":  "create_directory", "dirPath": "src"}            (inline args)
    ```json … fenced blocks and <tool_call> tags also work … ```
    + Ollama's native tool_calls field

Well-known synonyms are normalized (`file_write` → `write_file`, `path` →
`filePath`, `mkdir` → `create_directory`, …); unknown tools, malformed JSON,
missing required arguments and path traversal are rejected with precise
errors, and every path stays inside the active workspace/project folder.

### Debug tracing (QUILLIX_DEBUG=1)

Start the server with `QUILLIX_DEBUG=1` (e.g. `QUILLIX_DEBUG=1 npm run dev`) to
get a complete `[AGENT_*]` / `[OLLAMA_*]` / `[TOOL_*]` execution trace on
stderr — every model request, stream connect, chunk, parsed tool call,
execution result, continuation and completion:

    [AGENT_REQUEST] turn 1/12: sending conversation to the model
    [OLLAMA_REQUEST] POST /api/chat (stream) model=qwen2.5-coder:3b
    [OLLAMA_STREAM_START] connected
    [AGENT_CONTINUE] model returned no tool calls (nudge 1/2) — redirecting to tool usage
    [TOOL_CALL_DETECTED] native=0 text-parsed=2 ["create_file","create_file"]
    [TOOL_EXECUTION_START] create_file
    [TOOL_EXECUTION_RESULT] create_file -> success
    [AGENT_COMPLETE] success {"files":2}

The Ollama stream timeout is an INACTIVITY timeout (rearmed on every received
chunk, default 300s), so a slow local model actively generating a large file
is never cut off mid-stream; only a silent connection aborts, and the abort
message tells you exactly which trace tag to look at.

**Honest completion:** for a project request, implementation phases are only
COMPLETED when their work really happened. Optional phases that the request did
not require are explicitly marked SKIPPED, never FAILED. If the model replies
conversationally, the engine redirects it to tool usage (up to 2 times); if a
project request ends with zero files on disk, every required phase is marked
FAILED and the final response says so — the agent never reports fake success
and never hides required missing work behind "(not needed)".

### Full-agent E2E (real server + real protocol + mock local Qwen)

```powershell
npm run test:agent-e2e
```

Boots the REAL NUVRO AI server plus a scripted local Qwen over the real HTTP
protocol and proves, for each scenario, that files physically appear on disk,
tool results flow back into the model conversation, broken code is repaired
through the real test→fix→retest loop, and the final response reports exact
absolute paths with no raw tool JSON in chat.

## Verification

Post-checkpoint resilience update (November 3, 2026): the regression suite is
45 files / 394 tests. The agent now cleans up only newly-created misplaced
duplicate files after a verified contract repair, and acceptance packaging
records whether NSIS or portable output was actually selected.

```bash
npm run lint
npm test
# Full AGENT end-to-end (real server + mock Qwen, 8 scenarios, 63 checks):
npm run test:agent-e2e
npm run test:acceptance:safe # no-launch/static acceptance path
# Explicit live gate (starts services and the packaged debugger):
npm run test:acceptance:all

# Full end-to-end check against a fake local Ollama (chat/tool gating,
# multi-file generation, terminal history, secret protection, persistence):
HOME=$(mktemp -d) npx tsx scripts/integration-verify.ts
npm run build   # produces dist/index.html, dist/assets/*, dist/server.cjs, dist/electron/main.cjs, dist/electron/preload.cjs
```

## Windows desktop build

```bash
npm run build:electron
npm run package:win
```

Produces a deterministic x64 NSIS installer by default when its helper is available (`QUILLIX_PACKAGE_ARCH=arm64` opts into arm64), otherwise a portable
fallback in `release/windows/`. The packaged artifact uses `app.asar`; the
selected target is recorded in `.quillix-smoke/package-output.json`.

## Configuration file (optional)

Copy `.env.example` to `.env` to override the defaults:

```env
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=qwen2.5-coder:3b
# Optional: keep the selected local brain warm; default is 10m.
OLLAMA_KEEP_ALIVE=10m
# Optional: choose an installed model for offline timeout/repair fallback.
# Useful on CPU-only machines where qwen3 is accurate but too slow.
QUILLIX_OLLAMA_FALLBACK_MODEL=qwen2.5-coder:1.5b
```

Settings changed in the UI take precedence and are persisted.

For benchmark-only reliability sampling, set `QUILLIX_BENCHMARK_REPEATS` to an
integer from 1 to 5; it creates independent fresh workspaces and records an
aggregate pass rate in `summary.json`.

## Current implementation upgrades

Latest verified local-model benchmark: `qwen2.5-coder:3b` passed 6/6
representative cases (CommonJS, async repair, backend refactor, Python,
Node and Electron entry contract). The benchmark recorded a median 1,495
provider tokens and 95% tool-schema reduction on the first call. The live
packaged-debugger suite remains explicit because it launches NUVRO AI.

Historical continuation checkpoint (superseded by the current checkpoint above): `npm test` passed 42 files / 366 tests. The detailed historical evidence remains below for traceability.

This build includes the requested coding-agent/editor improvements:

- Local/offline Ollama + Qwen workflow with a focused tool surface for project tasks.
- Native Ollama tool calls plus a deterministic `<tool_call>...</tool_call>` fallback for small models that emit tool calls as text.
- Provider-independent extension tools through HTTP plugins, Streamable HTTP MCP, local MCP stdio servers and configurable local LSP stdio servers; local processes use direct spawning without a shell and stay scoped to the active workspace. Local MCP/LSP tools remain available in Offline Mode while network extensions stay blocked.
- Real project-folder creation and real filesystem verification before completion.
- Honest failure state: Ollama timeouts/errors cannot become a successful completion.
- Project phase milestones are driven by real operations; successful projects no longer show required implementation phases as "not needed".
- Monaco-based VS Code-style editor with broader syntax highlighting mappings.
- Resizable integrated terminal and project run/preview support.
- Language runners/adapters for Python, JavaScript/TypeScript/Node, HTML/CSS/static web, React/Vite, C, C++, C#, Java, Go, Rust, PHP, Ruby, Kotlin, Swift, Dart, Lua, R, SQL, Bash, and PowerShell, subject to the corresponding runtime being installed locally.
- Project memory, diagnostics, testing, build/run verification, bounded repair/retest loops, safe workspace paths, and secret-file protection remain enabled. Agent-side JavaScript/TypeScript retrieval also has bounded local semantic definitions/references and `language_diagnostics`, with lexical fallback; configured local LSP servers add read-only cross-language definition, reference, diagnostics, hover, completion and rename-preview tools.

### Verification note

Post-fix local-model matrix checkpoint (2026-11-02): a fresh five-case sweep
passed 5/5 on qwen2.5-coder:1.5b after the stale implementation-milestone
recovery fix. The earlier 4/5 result is retained in the audit as the failure
that exposed the bug; qwen2.5-coder:3b and qwen3:4b also passed 5/5 in the
same installed-model sampling.

The current workspace has been verified with `npm run lint`, `npm test` (42 files / 357 tests), the provider smoke suite, the 63-check agent E2E suite, backend E2E, Sarvam HTTP E2E, offline-plugin checks, website behavior checks, production build, and Windows NSIS packaging. Real qwen3:4b greeting, async-retry and two-file backend-refactor cases passed independent behavioral checks; qwen2.5-coder:3b has recorded passes for greeting-module, async-retry, backend-refactor, Python runtime-repair, Node/CommonJS runtime-repair and the generic tiny-website smoke after bounded contract repairs. The high-end three-file ecommerce probe now passes static, fake-DOM and real Electron Chromium checks. Explicit multi-file edit targets now hand off to deterministic verification as soon as every named source file is changed, preventing a slow local model from wandering after a correct edit. Task-scoped rollback now records safe file snapshots, restores only unchanged outputs, and reports manual-edit conflicts; the Agent Stop action is idempotent and cancellation-safe. Persisted `running` task records are recovered as explicit interrupted/cancelled records on restart or workspace rebind, so dead sessions no longer block new work while their resume evidence remains available by task ID. Sarvam tool turns disable invisible reasoning by default, force one native tool call, and retry up to twice with compact single-file prompts after truncation; tool-call JSON still fails closed and executes no partial tool call. Plain website requests are generated one file per turn when needed, so a large HTML/CSS/JS task does not depend on one oversized tool payload. Website repair uses a complete single-file write for small local models while preserving structured schema guidance for streaming/cloud providers; verifier-backed inline and linked CSS repair now closes responsive, animation and focus gaps in generated pages. Runtime repair turns retain the original request and real execution failure so compact local-model repair cannot lose task context. The latest pass also covers bounded semantic JS/TS retrieval, a workspace-scoped local LSP stdio bridge with definition/references/diagnostics/hover/completion/rename preview/workspace symbols/document symbols wired into Monaco and the agent, language diagnostics, local MCP stdio discovery/invocation, a timeout-safe Ollama status indicator, an approval-gated local Node debugger (launch, breakpoints, stepping, pause/resume, stack, evaluate, stop) with dedicated workspace UI, browser-script HTML-document rejection, and `npm run test:electron-browser`: a real Electron Chromium smoke that loads the AURA fixture, exercises search/filter/cart/localStorage, checks responsive overflow and reduced-motion CSS, and saves desktop/mobile screenshots. Repeated coding benchmarks now also emit median/p95 pass-rate, duration, token and tool-call aggregates; the latest installed-model matrix passes 5/5 on qwen2.5-coder:1.5b, qwen2.5-coder:3b and qwen3:4b after stale completion-milestone recovery.


## Release-candidate verification (Node 22.16+)

The source distribution now includes two additional test scripts that do not need a real
Ollama model:

```powershell
npm run test:core
npm run test:backend:e2e
```

`test:core` checks the ZIP export, local API protection, Git safety, secret-safe
workspace search and large-file bounds. `test:backend:e2e` starts a real local
NUVRO AI HTTP backend with a mock Ollama server, then verifies actual filesystem
writes, preview isolation, ZIP export, terminal approvals and multi-file agent
execution. This is not a substitute for `npm test`, a Windows Electron launch,
or testing against your installed Qwen model.

**Isolated Preview:** NUVRO AI's API stays on `127.0.0.1:3000` by default.
Generated websites are served from a separate random localhost port so their
JavaScript and localStorage work without inheriting NUVRO AI's privileged API
origin. The preview server is shut down together with NUVRO AI.

## Sarvam v1.1.1 reliability update

NUVRO AI's dedicated Sarvam V1 adapter now uses a Starter-compatible token budget, bounded transient HTTP retries, stricter tool-call validation, and precedence for the key securely saved through Home > Quick Connect. See `QUILLIX_SARVAM_COMPATIBILITY_v1.1.1.md` for documented limits, test evidence and a Windows acceptance checklist. The new `npm run test:sarvam-http:e2e` command tests real workspace file writing against a simulated Sarvam response without a live API key.

### Dedicated OpenAI / ChatGPT API (added in this release)

The Home **Quick Connect** panel and **Studio Settings** provide a dedicated
**OpenAI / ChatGPT API** choice in addition to Ollama, Sarvam AI and Universal
API. Enter an exact OpenAI API model ID (for example `gpt-6-astra`) and an
OpenAI **API** key, then select **Save & Connect**. The official
`https://api.openai.com/v1/responses` endpoint is used for both ordinary
responses and coding-agent function calls; the endpoint cannot be changed in
the dedicated provider. Only use a model available to your OpenAI API account.
A ChatGPT subscription alone does not supply API credits.

The dedicated OpenAI key has separate Windows DPAPI-encrypted storage at
`~/.quillix/openai-key.dpapi.json`. It is never stored in `settings.json`, sent
to an arbitrary Universal API endpoint, or returned to the browser. On non-
Windows machines NUVRO AI accepts an `OPENAI_API_KEY` environment variable but
refuses to persist a key as plaintext. Remove Key deletes the saved DPAPI key;
an environment variable, if configured, must be cleared separately.

`npm run test:openai` performs offline, mocked network contract checks for
OpenAI request shape, tool calling, router dispatch, key isolation, error
handling, and persistence. `npm run test:smoke` also runs these checks. Real
OpenAI service access, DPAPI on Windows, and a complete Windows installer build
must be tested separately; offline tests do not prove live API availability.
