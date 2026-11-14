# Offline coding plugins

NUVRO AI includes eleven bundled coding packs and twenty-four executable offline tools.
These run locally, including when Offline Mode is on. They work independently
of the AI provider; small Qwen models receive only task-relevant plugin schemas.
No account or cloud API is required. Existing editor/search, terminal/testing,
Git and verification tools remain available alongside these packs.

## Use

Restart NUVRO AI after updating the production build. Open **Tools → Coding
plugins**, or **Studio → wrench (Tool Registry) → Plugins**. Search the installed
packs and use their switches to enable/disable them. Changes persist in the
normal application settings and take effect on the next agent request; toggles
are blocked while an agent task is active. Core capabilities are not toggleable.

In the studio plugin card, expand **Tools & details** and choose a tool to open
its argument editor. Use a workspace-relative `filePath` or `dirPath`. The
editor also has a **Format current file with Prettier** toolbar button; save
unsaved changes first. Formatting stages a diff when Auto Apply Diffs is off.

Examples for Agent mode:

- Format src/app.ts with Prettier.
- Inspect imports and symbols in src/server.ts before refactoring it.
- Validate config.yaml and explain the parser errors.
- Scan TODOs in this project.
- Inspect this project's dependency declarations without installing anything.
- Read AGENTS.md and project rules as context.
- Audit a static website for broken references, responsive CSS and interaction gaps.

## Installed packs

| Pack | Tools | Engine / limits |
| --- | --- | --- |
| Prettier Formatter | `plugin_format_check`, `plugin_format_file` | Prettier 3.9.10; JS/TS, HTML/Vue, CSS/SCSS/Less, JSON/JSONC, YAML, Markdown/MDX, GraphQL |
| JavaScript & TypeScript Syntax | `plugin_syntax_diagnostics` | Babel parser 8.0.7; JS/JSX/TS/TSX syntax, not semantic type checking |
| AST Code Navigation | `plugin_symbols_outline`, `plugin_imports_inspect` | Babel AST; declarations/imports in one file, not cross-file language-server resolution |
| JSON / JSONC / YAML Validator | `plugin_config_validate` | jsonc-parser 3.3.1 and yaml 2.9.1; parser diagnostics, not JSON Schema validation |
| TODO Explorer | `plugin_todos_scan` | Text markers, including non-comment matches; 400 files / 4 MiB / 200 results maximum |
| Dependency Inspector | `plugin_dependencies_inspect` | Local package.json, requirements.txt, Cargo.toml, go.mod; no registry audit or install |
| Project Rules Reader | `plugin_rules_read` | AGENTS.md, .cursorrules, .cursor/rules/*.md[c]; returned as untrusted context, not automatically executed |
| Whitespace Quality | `plugin_whitespace_check` | Trailing whitespace, mixed indentation, final newline; no language lint claims |
| Markdown Navigator | `plugin_markdown_outline` | ATX headings and inline links outside fences; no link fetching |
| Web Quality & Accessibility | `plugin_web_quality_check` | Static HTML/CSS/JS audit for local references, responsive/accessibility basics, motion safety and recognizable interactions |
| Node Debugger | `plugin_debug_launch`, `plugin_debug_pause`, `plugin_debug_continue`, `plugin_debug_set_breakpoint`, `plugin_debug_clear_breakpoint`, `plugin_debug_breakpoints`, `plugin_debug_step_over`, `plugin_debug_step_into`, `plugin_debug_step_out`, `plugin_debug_stack`, `plugin_debug_evaluate`, `plugin_debug_stop` | Approval-gated workspace-local Node inspector; bounded launch, breakpoints, stepping, pause/resume, stack, expression evaluation and stop |

## Local language servers

Settings can also connect a local language server over stdio. This is not a
bundled coding pack: it adds six bounded, read-only provider-independent tools
for the current session:

- `plugin_lsp_<id>_definition`
- `plugin_lsp_<id>_references`
- `plugin_lsp_<id>_diagnostics`
- `plugin_lsp_<id>_hover`
- `plugin_lsp_<id>_completion`
- `plugin_lsp_<id>_rename_preview`

The server is spawned without a shell, rooted at the active workspace, and
bounded to workspace files up to 512 KiB. The built-in HTTP smoke and mock LSP
regression verify discovery, navigation, completion, diagnostics, rename
edits and outside-workspace rejection. Rename preview returns edits for review
and never writes files. Use a local executable and JSON argument array, for
example `typescript-language-server` with `["--stdio"]`.

## Offline, compatibility and safety

- The four external libraries were installed from npm with exact versions and
  lifecycle scripts disabled. package-lock.json records their integrity hashes.
  Prettier/Babel/jsonc-parser are MIT licensed; YAML is ISC licensed. Their
  package license files remain in node_modules.
- Node 22.18+ (or supported Node 24+) is needed by Babel 8. The current machine's
  Node 22.23.2 satisfies this. Production Electron must provide a supported Node
  version too; the production-server smoke test checks the current runtime.
- Keep installed production dependencies with the app for offline use. A fresh
  installation on another offline computer needs the dependencies or an app
  package containing them; a lockfile alone is not an offline installer.
- Bundled tools make no network requests. Executable Prettier config files and
  workspace-provided formatter plugins are deliberately not loaded. Formatting
  uses stable safe defaults rather than silently executing project config.
- Individual files are limited to 512 KiB. Protected secret paths, outside-root
  paths and escaping symlinks are blocked. Common inline secret patterns are
  redacted; files requiring redaction are not rewritten by the formatter.
- Formatting rechecks source content and workspace identity after its async
  parse. Stale, redacted or changed content is not written back.
- Network HTTP/MCP extensions are separate, require explicit setup/approval,
  and cannot execute in Offline Mode. Local MCP stdio servers and local LSP
  servers can be connected from Settings with a direct command and JSON
  argument list; NUVRO AI never invokes their command through a shell, caps
  JSON-RPC frames, cleans them up with the server, and keeps LSP navigation
  read-only and workspace-scoped.
  Project commands may still require installed language runtimes/dependencies
  and can have their own network use.
- Web Quality & Accessibility is a deterministic static audit, not a browser
  visual regression test. It never fetches remote assets or executes generated
  JavaScript.
- These are real NUVRO AI integrations, not VS Code/Cursor VSIX packages. A VSIX
  extension host, full LSP/debugger integration and cloud services are not
  supplied by this change. The existing language runners/build/test tools remain
  the way to check Python, Rust, Go, Java, C# and other project languages.

## Verification

```powershell
npm run lint
npm test
npm run build
npm run test:offline-plugins
npx vitest run src/server/__tests__/extensionTools.test.ts
```

The HTTP smoke test launches the built production server on port 3012 with
temporary settings and fixtures, exercises all eighteen bundled tools, the
local LSP bridge and plugin toggles,
then shuts down that test server and removes only its own temporary directory.
It never changes the user's active workspace. Override a busy port with
`QUILLIX_PLUGIN_TEST_PORT`. Unit tests forbid fetch for bundled tool invocations
and cover parser results, patch staging, disabled-pack persistence, protected
files, traversal, symlink escapes, input/result limits and small-Qwen integration.

Dependency audit on this machine after patch updates: zero high/critical
findings; ten moderate findings remain in existing Monaco/DOMPurify and desktop
packaging dependencies (two in production-only audit). They were not force-fixed
with potentially breaking editor/packager upgrades. The four newly added
libraries were not listed among the remaining audit findings.

Primary documentation: [Prettier API](https://prettier.io/docs/api),
[Babel parser](https://babeljs.io/docs/babel-parser),
[YAML](https://eemeli.org/yaml/),
[Microsoft jsonc-parser](https://github.com/microsoft/node-jsonc-parser).
