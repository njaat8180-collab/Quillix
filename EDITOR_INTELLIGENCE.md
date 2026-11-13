# Offline editor intelligence

JavaScript and TypeScript open tabs now use distinct, workspace/editor-isolated
Monaco model URIs. Relative import paths are preserved, and the bundled language
service eagerly synchronizes open models, including unsaved content. Suggestions,
hover, signature help, syntax/type diagnostics and definition lookup use Monaco's
local language service, not a cloud model. MJS/CJS/MTS/CTS use the appropriate
language mode too.

The editor keeps trigger suggestions, parameter hints, code lenses, validation
decorations and the local TypeScript lightbulb/quick-fix path enabled. When the
active file has diagnostics, the tab bar shows a problem count; clicking it moves
to the next marker. Monaco's normal F8, Ctrl+Space and Ctrl+. actions remain
available. These fixes are language-service fixes only; NUVRO AI does not silently
write them to disk.

Use Ctrl+Space for suggestions, F12 for definition and Shift+F12 for Monaco's
references UI. Cross-tab F12 routes into the
existing tab without saving or discarding dirty buffers; same-file locations and
definition ranges are handled separately. Tab switching retains model undo state;
unmounted editor models are disposed; closed files remain as project context while
included in the bounded snapshot. Switching workspace isolates model
identity as well as relative file names.

This is **not** a full workspace LSP, AI ghost-text completion or debugger.
The editor now also exposes an AI inline-completion provider when a workspace is
open. It sends a bounded cursor prefix/suffix plus a small local source-context
snapshot to the selected provider and returns insertion-only ghost text. The
request is cancellable, single-flight, never writes files, and is intentionally
rate-limited so a local 3B model does not build a queue while typing. Press Tab
to accept a suggestion; normal Monaco completion remains available with
Ctrl+Space. Cloud providers may be faster, but their privacy and network
behavior follow the selected provider settings.
Unopened JS/TS files now load through a local, no-store source snapshot. Maximum
128 files, 64 KiB per file, 2 MiB combined source, 3,000 inspected entries and 200
directories (depth 10). Heavy/build/dependency/hidden directories, symlinks,
protected paths and credential-like filenames are excluded; common embedded
credentials are redacted. This is pattern-based filtering, not proof that arbitrary
source contains no secrets. The bounded asynchronous walk does not construct an
unbounded file tree. It uses existing safe workspace reads. Root changes reject
in-flight server results; the client aborts stale fetches and scopes model identity
by workspace/editor. Unsaved open buffers take priority over disk context.

F12 can open an unopened file included in that snapshot via the existing safe file
reader. Source context refreshes after workspace tree refreshes (including saves,
formatting and file operations), agent refresh signals, or the source-count button.
There is no filesystem watcher: external edits require a refresh. The count button
reports truncation or unavailable context, with open-tab-only fallback on errors.
Installed dependency declarations and project tsconfig are not automatically
loaded. Defaults are generic ES2022/ESNext, Node resolution, React
JSX and strict type checking; diagnostics may flag missing third-party typings.
Other languages retain Monaco's existing support; no Python/Rust/Go server was
added. User provider settings and model choices are unchanged.

Agent retrieval now has a separate bounded TypeScript/JavaScript semantic
adapter in `src/server/typescriptLanguageService.ts`. It uses the local Monaco
TypeScript runtime, scans at most 700 project files (512 KiB each), and exposes
semantic `find_definition`, `find_references`/`find_usages`, plus
`language_diagnostics` tools. It is workspace-only, has no network or package
installation path, and falls back to the existing lexical index when semantic
results are unavailable. The adapter is intentionally not described as a
full-language LSP: debugger support, non-JS/TS language servers, and broad
dependency/project-config loading remain separate work.

Verification: TypeScript check and production build passed. Four helper regression
tests cover model paths/isolation, language defaults and range/position navigation.
The full suite passed 228 tests across 23 files. Browser verification found and
fixed a definition-range crash, then confirmed checkout.ts -> money.ts F12 and
typed function suggestions in an isolated local fixture with Ollama connected.
The diagnostics stage passed the final full 236-test suite across 24
files, including a cumulative byte-budget test. Browser QA confirmed F12 from checkout.ts into a
previously unopened money.ts and the two-source-files context indicator.
Only the fixture's unsaved buffer was changed during the earlier completion QA; no user source or provider settings
were changed by browser QA. Computer-use verification caught the range bug that
compilation alone missed. No Cursor parity or broad AI quality claim is implied.
