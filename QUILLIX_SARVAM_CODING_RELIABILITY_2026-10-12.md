# NUVRO AI Sarvam Coding Reliability Patch (2026-10-12)

## What changed

1. Missing-file recovery in `src/server/agentEngine.ts` now retains the real tool definitions and requests `write_file` natively instead of disabling all tools and hoping the model prints a JSON tool-call string. This fixes one concrete source-level cause of `AGENT INCOMPLETE` / `0 file(s) were written` when Sarvam is asked to create `index.html`.
2. The Sarvam adapter accepts a `requiredToolName` hint and maps it to the documented `tool_choice: {type:'function',function:{name:'write_file'}}` call. Native tools and a competing `response_format` are never sent together.
3. Tool-only assistant turns now send `content: null` to Sarvam while preserving `tool_calls` and subsequent `tool_call_id` result messages.
4. A transient HTTP 429 or 503 produces **at most one extra network request** before failure. API-key failures (403) are not retried. Local file write operations are never repeated by this HTTP transport retry.
5. Provider errors now identify response categories (bad request, auth, unknown model, rate limit, unavailable service), and network timeouts are distinguished. Raw upstream response bodies and API keys are never included in UI errors.
6. Sarvam's Settings UI **Save & Connect** saves the key using the existing Windows DPAPI encrypted storage then runs the explicit connection check. Key saved != connected; the UI only shows verified connection if a nonempty response was received.
7. `/api/providers/sarvam/test` rejects empty model responses instead of claiming a successful connection.

## Verification performed in the authoring environment

- `npm run test:smoke`: **74 passed, 0 failed**. (Some are static contract/mock tests; they do not validate the real Sarvam cloud or Windows DPAPI.)
- TypeScript/TSX syntax transpilation: PASS for all five modified source files using globally installed TypeScript 5.8.3.
- `npm ci --offline`: BLOCKED, missing uncached package `yocto-queue@0.1.0`.
- `npm run lint`: BLOCKED by missing `vite/client` declaration from unavailable dependencies.
- Full Electron build, Windows DPAPI round trip, and actual Sarvam API account/coding flow: **NOT TESTED** here. No user key was available.

## Windows acceptance test

Unzip the source into a **new** directory; do not replace the original while it is running.

```powershell
npm ci
npm run test:smoke
npm run lint
npm run build
npm run check:sarvam-storage
npm start
```

In Settings -> Sarvam, turn off Offline Mode, enter your key in NUVRO AI (do not share it), click **Save & Connect**. Verify the status says `Connected` only when a real cloud answer arrives. Select a writable workspace and **Agent Mode**, then ask:

> Create a file named index.html with a Hello World heading and a simple CSS animation. Write the file to the workspace and verify it exists.

Look for a real file on disk and a verified completion report. If it still fails, share the redacted **error message**, which phase failed, the selected provider/mode, and output of the above tests—never send the API key or full request headers.

## Important limitations

No automated software can guarantee zero bugs or successful code generation for every prompt. Rate limits, credits, Windows account policy, AI model behavior, and API availability remain external factors. The 20-attempt repair mechanism does not override security approvals or guarantee success.
