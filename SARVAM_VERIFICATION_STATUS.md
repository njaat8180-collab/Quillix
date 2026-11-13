# Sarvam integration verification status — 2026-10-11

Status: **DEVELOPMENT CANDIDATE — NOT PRODUCTION VERIFIED**

## Changes in this revision

- Encrypt saved Sarvam credentials with Windows user-profile DPAPI. The old plaintext key is automatically migrated (and then removed) if present. UI save fails closed on unsupported OSes instead of writing plaintext; environment-based credentials remain supported.
- Allow users to **test connection** to Sarvam 105B from Settings (explicit request; may incur API charges), and **remove key**.
- Prevent key changes during an active coding-agent task.
- Ensure agent system instructions, temperature, and JSON-schema formatting options reach Sarvam Chat Completion V1.
- Increase maximum output token budget to 8192 by default for coding files (requests may incur costs).
- Handle malformed tool-call argument JSON without crashing the parser; block Sarvam in Offline Mode.
- Add `sarvamProvider.test.ts` regression tests using mocked upstream responses.

## Checks performed

- PASS: Standalone mock request/response checks: API header, model ID, system messages, tool definitions/calls, JSON schema, temperature, and offline block.
- PASS: TypeScript *syntax/transpilation* for modified TS and TSX files.
- BLOCKED: `npm ci --offline` (npm cache lacks `yocto-queue@0.1.0`). Online npm install could not complete in this sandbox.
- NOT RUN: Complete `npm run lint`, `npm run build`, `npm test`, `npm run test:backend:e2e` against installed dependencies.
- NOT RUN: Windows DPAPI live test (test machine is Linux).
- NOT RUN: Live Sarvam API test or project-generation agent test (no API key available).

Before labeling this build *complete*, run dependency install and the full test suite on the Windows target, save a Sarvam key, test its connection, restart NUVRO AI and confirm key persists encrypted, verify key removal, and make a real multi-file project with Sarvam. Do not report these as passed before checking them.
