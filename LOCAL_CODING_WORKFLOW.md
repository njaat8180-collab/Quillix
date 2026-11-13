# Local coding workflow

NUVRO AI is a general workspace coding assistant using Ollama. The default local
model is `qwen2.5-coder:3b`. It can work on existing backend projects, scripts,
libraries, CLI tools, desktop source, tests and websites through its editor,
file/search tools, patches, terminal, Git and language runners.

## Run

Start the installed Ollama service, then run `npm start` from this directory.
For development use `npm run dev` and open http://127.0.0.1:3000.
Select Ollama in Home or Settings and use the exact installed model name.
Choose the project folder in the workspace UI before requesting changes.

Agent mode edits code; Ask/Review/Plan modes remain read-only. Example tasks:

- Refactor util.cjs and app.cjs to use a shared validator and run the tests.
- Fix the Python parser error and verify the changed scripts.
- Add an API endpoint to the existing server and update its tests.
- Build a CLI utility with source, tests and usage documentation.

## Coding studio UI

The active saved editor file is included in agent context; save unsaved drafts
before asking for edits. Agent/Debug mode's **Acceptance check** accepts a real
test command for the current workspace session. It uses normal permissions,
reruns after source repairs, and clears when switching folders. See
[CODING_RELIABILITY_REPORT.md](CODING_RELIABILITY_REPORT.md) for measured local
coding observations and the limits of these guarantees.

See [CODING_PLUGINS.md](CODING_PLUGINS.md) for the nine bundled offline coding
packs, their eleven tools, enable/disable controls and compatibility limits.

Open **Studio** for the explorer, editor, terminal and agent side by side.
Drag the agent divider to resize it; its width is remembered locally.
On smaller screens use the Code / Agent tabs.

- Ctrl+Shift+P: searchable command palette (arrow keys, Enter, Escape).
- Ctrl+L: reveal and focus the agent composer.
- Ctrl+K: inline AI request for the current file or selection.
- Ctrl+S: save the active file; Ctrl+P: project search.
- Ctrl+B: explorer; Ctrl+backtick: terminal.

Editor tabs and unsaved changes survive navigation to Home or Chat. Switching
projects asks before discarding unsaved edits. Inline AI and failed-check actions
prepare a prompt for review; they do not send it automatically.

## Reliability changes

See [CODING_ENGINE_UPGRADE.md](CODING_ENGINE_UPGRADE.md) for the October 19 source
retrieval, fresh-test tracking, explicit export contracts and real-model benchmark
results, including known acceptance failures and hardware limitations.

- Source retrieval ranks relevant files using the request and reads bounded
  snippets through the workspace's existing protected-file checks.
- Small Qwen models receive a focused set of coding tools. Git tools remain
  available for explicit Git requests; larger-model tool selection is unchanged.
- Existing-project edits/refactors now use the edit/validate workflow rather
  than being mislabeled as analysis. Hindi workspace requests are recognized.
- Configured package test/build scripts run after edits even if the model stops.
  Failures are returned to the model for bounded corrections and reruns.
- Static validation runs on changed files, with a repair target, current HTML
  and failing source supplied to the model. External browser JavaScript is
  checked for accidental script tags and fixed DOM-ID mismatches.
- Original requirements and verified writes are repeated during targeted work
  so history compaction does not erase the task.
- Create/delete patch application rejects stale content. Broken UI connections
  retain received patches and explicitly report unverified completion.
- Provider errors checkpoint task failure. Active streaming resets inactivity
  timeouts; malformed stream JSON is rejected before tool execution.
- Type checking includes application sources and scripts, excluding generated
  sample projects from the application's compiler inputs.

## Verify

`npm test`, `npm run lint`, and `npm run build` check the application.
`npm run test:local-qwen` runs the actual installed local model in a fresh
`test/qwen-acceptance-*` workspace, with independent settings. It saves an
`acceptance-report.json` containing actual files, tool results and checks.
It neither downloads models nor changes the selected workspace/provider.

The real local acceptance run created all three linked website files and
passed verification. Automated coverage also exercises multi-file backend
refactoring with a real Node test command, validation repair, read-only modes,
staged patches, workspace boundaries and stream integrity.

## Practical limits

The inspected computer has about 6 GB physical RAM; local Qwen generation on
CPU can take several minutes. Orchestration improves reliability but cannot
increase a model's knowledge or guarantee Cursor-equivalent results. This
release has no measured basis for claiming superiority over Cursor.

Automatic package test/build checks currently use package.json scripts.
Other languages use available syntax checks, language-aware tools and explicit
commands; end-to-end runtime tests depend on installed toolchains and tests.
Static browser checks do not replace a real browser interaction test, and DOM
checks deliberately skip dynamically created markup. Generated code still
needs review. Terminal/Git permissions and workspace boundaries remain active.
