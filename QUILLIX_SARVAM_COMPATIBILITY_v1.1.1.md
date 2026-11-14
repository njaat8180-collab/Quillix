# NUVRO AI v1.1.1 — Sarvam API compatibility hardening

This update is based on NUVRO AI v1.1.0. It does **not** add an undocumented Sarvam API protocol, expose keys, or bypass app permissions.

## Fixed in source

1. **Starter-tier HTTP 400:** The old default `max_tokens: 8192` exceeded Sarvam V1's 4096-token Starter limit. The new default is **4096**, with a maximum **4096** unless the operator explicitly sets `SARVAM_MAX_TOKENS` to a valid larger plan allowance. Per-request limits are clamped to the configured ceiling. Pro customers can set a larger value supported by their account. Small-model tasks still need multiple agent turns for long files.
2. **Truncated website tool calls:** Plain websites are split into one file per turn, tool turns disable reasoning, and NUVRO AI forces one `write_file` call. If Sarvam still returns `finish_reason: length`, NUVRO AI retries the same file with a compact prompt up to twice; incomplete tool JSON is always rejected without filesystem execution.
3. **Reasoning consumes output budget:** V1 defaults to low reasoning in this adapter; the explicit connection check disables reasoning and allows 128 tokens so a tiny reply is less likely to be swallowed by internal thinking.
4. **Transient failures:** Retries only HTTP 429/500/502/503/504, at most two retries (three requests in total) with short backoff. Honors a numeric `Retry-After` up to three seconds; longer throttling stops rather than hammering the account. Never retries bad keys (403), invalid models (404), or malformed requests (400). Requests support cancellation and timeouts.
5. **API-key handling:** API key saved through Home/Settings in encrypted Windows storage now takes precedence over an old `SARVAM_API_KEY` environment variable. Environment key remains a fallback when no key is stored. A corrupt/unreadable encrypted record is not silently ignored. Linux/macOS still use environment-provided keys and must not save keys to plaintext through the UI.
6. **Tool safety:** Refuses duplicate native tool-call IDs, tool names absent from the actual agent tool definitions, and malformed arguments **before dispatch**. Supports text-part response arrays. Empty 200 replies with no text and no tools are rejected, not treated as successful.
7. **Transport safety:** `redirect: 'error'` prevents a remote redirect from forwarding the Sarvam API key to another host. Retries occur before tool calls are returned to the agent (local actions are never replayed by the transport).

## Configuration

Sarvam dedicated provider continues using **`sarvam-105b`** on **`https://api.sarvam.ai/v1/chat/completions`** with the official `api-subscription-key` header. V2 is beta and requires authorization; it is **not** enabled implicitly.

- Starter / unknown plan: **no settings needed**, output budget maximum 4096.
- Pro / Business plan: optionally set `SARVAM_MAX_TOKENS` in the *NUVRO AI server process environment* to an allowance your account actually has (for example `16384`). Setting an excessive value cannot upgrade the plan; the API may reject it.
- Save the key from **Home > Quick Connect > Sarvam AI > Save & Connect**, without sending it to ChatGPT. Connection tests consume a small amount of paid/free allowance; actual file creation must be verified independently.
- If the Windows DPAPI self-test fails, run `npm run check:sarvam-storage` in a normal Windows user terminal and report **only the diagnostic error**, not the secret.

## Test evidence / limitations

Run in source workspace (Linux, with dependencies borrowed from prior NUVRO AI build):
- `npm run test:smoke` — **87/87 pass** (including 20 Sarvam-specific tests)
- `tsc --noEmit` — **pass** (TypeScript 5.8.3 installed globally)
- `tsc --project tsconfig.integration.json` — **pass**
- `node scripts/smoke/http-e2e.mjs` — **pass** (real server, mock Ollama, file writes, preview, sandbox checks)
- `npm run build` — **not verified**: borrowed Linux dependencies lack executable permissions/native rolldown binding. This is an environment/dependency blocker; a clean Windows `npm ci` is required.
- Real Windows encryption, live Sarvam API calls, any model's actual cloud billing and full Electron launch — **not verified** without the target Windows PC/credentials.

No application can guarantee zero errors across API outages, token quotas, network failures or arbitrary AI tool output. The changes aim for correct failures, bounded recovery and no false completion.

## Windows acceptance before submission

In the extracted `NUVRO AI` source directory, use:

```powershell
npm ci
npm run test:smoke
npm run lint
npm run build
npm run check:sarvam-storage
npm start
```

Then use **Home > Quick Connect > Sarvam AI**, save your key and require a verified connection. Ask the agent: `Create index.html containing a Hello World heading, save it to the workspace, run a syntax check and verify the file exists.` Repeat after a restart to ensure the encrypted key, agent state and file outputs persist as intended.

References: https://docs.sarvam.ai/api-reference/chat/chat-completions-v1 and https://docs.sarvam.ai/api/api-guides-tutorials/chat-completion/overview.

### Sarvam mock HTTP end-to-end verification

`npm run test:sarvam-http:e2e` starts the **actual NUVRO AI HTTP backend** with a synthetic Sarvam API transport and a dummy key. It verifies Sarvam's health endpoint, an agent `write_file` native function call, and the actual `index.html` file containing Hello World and an animated background. The test uses no live account or credits. It is separate from the general backend E2E (mock Ollama), and does not establish live Sarvam availability.
