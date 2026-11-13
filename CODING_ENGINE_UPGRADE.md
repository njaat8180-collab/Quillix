# Coding engine upgrade — 2026-10-19

Later implementation and measured follow-up results are recorded in
[CODING_RELIABILITY_REPORT.md](CODING_RELIABILITY_REPORT.md). The failures below
are retained as historical evidence, not the latest acceptance observations.

This is an incremental reliability upgrade, not a claim of Qoder/Cursor parity.
The local model remains user-selected; no model downloads, provider changes or
global Ollama configuration changes are part of this upgrade.

## Implemented

- Source retrieval now ranks identifiers/declarations and source text, not just
  filenames. It includes one-hop local JS/TS import dependencies and callers,
  recognizes `.js` imports backed by `.ts` source, and returns numbered excerpts
  near a matching symbol instead of always the start of the file. Relevant
  source gets a reserved context budget before the generic project overview.
- Search is bounded: 300 directories, 5,000 directory entries, 800 candidate
  files, 160 inspected source files, 2 MiB of source and 128 KiB per file.
  Generated/dependency directories, protected secrets, escaping paths and file
  symlinks are excluded from automatic retrieval. Inline secret redaction runs
  before caching. The 96-entry cache rechecks file metadata and workspace identity.
  This is lexical/symbol-assisted retrieval, **not** embeddings, a semantic graph,
  full LSP navigation, or an exhaustive repository analysis. Local import
  relationships currently cover JS/TS relative import/require syntax.
- A new, explicitly requested single-file Qwen task starts with only the real
  `write_file` schema when the destination does not exist. Existing-file tasks,
  repairs and explicit check requests retain navigation/check tools. Small local
  models also get a shorter system prompt; the full tool registry is unchanged.
- Explicit `.cjs`/`.mjs` creation is routed into the implementation workflow.
- Automatic configured tests/builds now allow up to three bounded inspection/
  correction turns per repair attempt. Read/search calls no longer cause an
  immediate premature retest. A prose-only correction receives one action nudge.
  A no-change failed check is not repeated against the same tracked file bytes.
- Successful tracked source edits invalidate earlier test/build results. Tests
  rerun after a build correction or a later syntax/runtime repair. Source changes
  after a runtime check invalidate that runtime claim. Passing corrective retests
  explicitly complete the real repair milestones; failed/pending work stays open.
- A narrowly explicit request such as `Export a named function parse via
  exports.parse` gets a static CommonJS declaration check. Default-only exports,
  comments and strings do not satisfy it. It does not infer an API from vague
  prose, execute code, validate behavior, resolve arbitrary dynamic exports, or
  assign API ownership across multiple modules. Parsing is limited to 512 KiB.
- Static-only successful writes include an explicit warning that runtime
  behavior was not tested. Syntax success must not be read as functional success.

## Reproduce actual-model acceptance

```powershell
npm run benchmark:coding
npm run benchmark:coding -- greeting-module
npm run benchmark:coding -- backend-refactor
```

An installed local Ollama/Qwen model is required. `OLLAMA_MODEL`,
`OLLAMA_BASE_URL` (loopback only) and `QUILLIX_BENCHMARK_TIMEOUT_MS` can override
the process-local defaults. Default timeout is 240 seconds per case, at most
600 seconds. No downloads or cloud fallback occur.

Each run creates its own `.quillix-smoke/coding-benchmark-*` workspace and settings.
The agent sees normal source/tests; independent trusted Node assertions are held
outside the model workspace in the runner. Assertions check named exports, empty
and missing inputs, cents rounding, totals, and shared-helper use. Reports record
model calls, request characters, first text latency, actual tools, phases, failures
and independent check exit codes. Failure reports are retained, not hidden or
counted as successes. These two cases are acceptance probes, not a statistically
representative benchmark or a score against another coding product.

## Measurements and remaining limits

The original single-file HTML probe timed out at 180 seconds on October 18.
On October 19 the pre-change engine completed that probe in 87.0 seconds;
the reduced-schema engine took 85.3 seconds. Request size fell from 4,737 to
2,220 characters. These are single observations, not a defensible percentage
speedup: storage path, model warm-up, response length and system load varied.

Real acceptance found issues that unit tests do not rule out: the 3B model first
returned a default export where the caller expected a named API, then a later
explicit named-export run omitted missing-input handling. A backend run fixed
one module but left its caller unchanged and failed independent tests. Reports:

- `.quillix-smoke/coding-benchmark-csu5WX/` — initial failing probes.
- `.quillix-smoke/coding-benchmark-2buNcF/` — shorter prompts and explicit API probe.
- `.quillix-smoke/coding-benchmark-Z3rQhz/` — final backend repair-recovery probe.

Final regression verification: **21 test files / 207 tests passed**, TypeScript
passed, and the UI/server/Electron production build completed. Tests cover symbol
retrieval, local import/caller context, cache refresh, protected files, junction
boundaries, bounded work, inspection-before-edit, stale test results, build and
syntax repair retests, prose-only recovery, and named-export contract repairs.

The final backend probe took 88.3 seconds and **still failed** its independent
behavior checks: only `src/money.cjs` was fixed, not its caller. The configured
test failure was retained as an incomplete task; the model's prose-only repair
did not count as a saved correction. The earlier named-export greeting probe
took 37.3 seconds and still crashed for a missing input. Neither is a successful
functional acceptance result. Warm caches and changing machine load mean these
times must not be compared as controlled performance measurements.

The inspected machine runs inference on CPU with about 6 GiB RAM. Reducing prompt
overhead helps, but cannot guarantee model reasoning or missing-edge-case handling.
Configured automatic checks still use package.json test/build scripts; other
languages need their toolchains and explicit test commands. Generated code needs
real behavioral tests and review. No claim is made that arbitrary tasks now pass.

During measurement, the Ollama model store became available at `D:\.ollama\models`
while the default `C:\Users\nakul\.ollama` instance listed no models. Acceptance
used a separate local server on port 11435 pointed at the existing store. User
app/provider settings were not silently rewritten. If the normal Ollama instance
still lists no models, its model-store configuration must be resolved separately.
