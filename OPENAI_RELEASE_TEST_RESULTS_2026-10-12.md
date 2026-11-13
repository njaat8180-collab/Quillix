# NUVRO AI v1.2.0 — verification summary

Date: 12 October 2026

## Confirmed in the isolated Linux test environment
- 96 of 96 offline smoke tests passed (`npm run test:smoke`).
- Includes 9 dedicated OpenAI mocked API tests (`npm run test:openai`):
  official Responses endpoint, credential isolation, tool-call roundtrip,
  agent provider routing, saved model persistence, offline enforcement,
  missing-key refusal, invalid response rejection, and error sanitization.
- 73 `.ts`/`.tsx` source files parsed with global TypeScript 5.8.3 and
  produced zero parser diagnostics.
- Source ZIP verification should be performed on the delivered ZIP.

## Explicitly not verified
- Full `npm run lint` and Electron build: local `node_modules` lacks Vite
  type definitions and executable packages. `npm ping` failed with DNS
  `EAI_AGAIN`, so the required dependencies cannot be freshly downloaded
  in this environment. No passing build claim is made.
- Live OpenAI API usage: no user OpenAI API key was available.
- Windows DPAPI encryption, restart persistence and Windows installer.
- End-to-end code writing using a real OpenAI model on a user's workspace.

## Windows checks before submission

```
npm ci
npm run test:smoke
npm run lint
npm run build
npm start
```

Within NUVRO AI: save and verify a dedicated OpenAI API key with an exact
model ID, then create a real `index.html` in Agent Mode. Check the file on disk
and restart NUVRO AI to validate Windows credential persistence.

The release is a tested **source candidate**, not an independently certified
Windows production build. Network conditions, model permissions, provider rate
limits and API credit balances can still produce legitimate failures.
