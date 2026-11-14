# NUVRO AI E2E acceptance harness

Runs the full agent acceptance test (To-Do List project creation) against a
mock Ollama that simulates `qwen2.5-coder:3b` — including its failure mode
of writing tool calls as plain text instead of using native `tool_calls`.

1. Build the app: `npm install && npm run build`
2. Start the mock:    `node scripts/e2e/mock-ollama.cjs`
3. Start the server:  `NODE_ENV=production node dist/server.cjs`
4. Run the driver:    `node scripts/e2e/e2e-driver.cjs`

The driver selects `/tmp/QUILLIX_AGENT_TEST` as the workspace (change
`WORKSPACE` at the top for Windows, e.g. `D:\\QUILLIX\\QUILLIX_AGENT_TEST`),
points the server at the mock via `/api/settings`, then sends the acceptance
prompt and asserts: real files on disk, no tool-call JSON or source dumps in
the chat stream, the 15-phase workflow streamed live, and a real
test -> fix -> retest cycle (a broken app.js is caught by `node --check`,
repaired by the agent, and re-verified).

`fetch-polyfill.cjs` is only needed on systems where Node's built-in fetch
cannot allocate WASM memory; on normal machines simply omit the
`--require scripts/e2e/fetch-polyfill.cjs` flag.
