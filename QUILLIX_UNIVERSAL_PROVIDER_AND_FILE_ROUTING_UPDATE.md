# NUVRO AI — Universal API + single-file routing update

## Implemented
- Dedicated Ollama and Sarvam options retained.
- Universal API: OpenAI-compatible Chat Completions, Anthropic Messages (Claude) and Google Gemini generateContent; exact user-supplied model name and user-configured API root.
- The Universal API key is stored separately with Windows DPAPI CurrentUser encryption, not in settings.json or a project file. Environment override QUILLIX_UNIVERSAL_API_KEY is supported for controlled setups. Fails closed if Windows secure storage is unavailable.
- Save & Connect in Studio Settings persists endpoint/protocol/model, stores key, then tests the live API response. Error states remain visible; the app never infers successful connection from merely saving the key.
- Cloud providers blocked while Offline Mode is on. Remote API URLs require HTTPS (HTTP limited to localhost). Keys are not embedded in URLs or stdout.
- Provider router passes chat and native tool calls to the selected provider. API formats are different: a model name alone does not make an arbitrary proprietary API compatible.
- `create a index.html page ...` is recognized as a single-file request in the active workspace instead of creating a new project directory. Tool-less model responses still fail honestly; NUVRO AI does not invent files.
- Settings persistence now uses an atomic file replacement and reports Save failure instead of silently succeeding.

## Automated tests executed here
- Existing smoke tests: 60/60 passed (filesystem atomic write, agent progress/repair, Sarvam safety, Windows storage mock contract, text-tool parsing).
- Universal protocol mock tests: 6/6 passed (OpenAI-compatible, Anthropic, Gemini, tool argument safety, endpoint/offline behavior).
- Universal settings tests: 3/3 passed (persistence/reload, endpoint validation, honest save failure).
- TypeScript/JSX syntax transpilation checks passed for edited modules.

## Not yet verified
- Real Windows DPAPI API key save, live Sarvam/OpenAI/Claude/Gemini connections using personal credentials, full desktop Electron launch, complete `npm run lint`, `npm run build`, or end-to-end autonomous code generation. npm dependencies were unavailable in the offline test environment and a full npm ci could not complete. These are required before hackathon submission.

## Windows verification
1. Extract the ZIP into a fresh folder.
2. In the `NUVRO AI` subfolder run `npm ci`, `npm run lint`, `npm run test:smoke`, `npm run build`, then `npm start`.
3. In Settings choose Universal API, select the protocol, enter your actual service endpoint and exact supported model ID, enter a key, and select Save & Connect.
4. Close/restart the app; verify the saved model/provider is still selected and reconnection succeeds.
5. In Agent mode try: `create a index.html page with hello world heading and some animated temples in background`. Confirm that `index.html` exists on disk and inspect the task log if the model fails to issue tools.
Never share API keys or log them in screenshots.
