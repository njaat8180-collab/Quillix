# NUVRO AI restoration progress — 2026-11-10

This is an active engineering restoration log, not a release certification. The user requested a complete project audit with UI restoration as the first implementation priority. Older release and roadmap reports contain historical results; use this note for the current fixes and verification recorded in this session.

## Findings and changes

### Studio queued-approval UI (current continuation)

- The current smoke pipeline exposed a real behavior gap: `WorkbenchLayout` rendered pending approvals and batch buttons, but never loaded the queue and the handlers were placeholder timers.
- Connected queue polling to `api.listPendingApprovals()` while an agent run is active (2-second interval, cancelled on cleanup, cleared when work ends). Connected the user-triggered Approve all / Reject all actions to `api.batchResolveApprovals()` and refreshes the queue after a response instead of assuming it emptied. Added in-flight disabling and descriptive accessible labels.
- `npm run test:approval-batch` passes 22 contract checks and `npm run lint` passes after the fix.
- The full smoke pipeline was rerun before this fix and failed at `test:approval-batch`, accurately revealing the no-op UI; rerun it after this repair.

### UI, CSS, and motion

- Moved the global reset into Tailwind's base layer so spacing utilities such as `p-6` and `px-6` are not erased by the unlayered reset.
- Removed unlayered global font-size/weight utility duplicates that overrode responsive Tailwind typography. Added Tailwind line-height theme tokens instead.
- Kept the stylesheet order explicit in `src/main.tsx`: Tailwind/base and tokens, Atlas product styles, then production component overrides.
- Constrained Studio flex ancestors and editor/terminal regions so Monaco receives a shrinkable viewport; compacted Chat and editor empty states on short windows.
- Fixed Chat History row layout and sizing so title, metadata, and delete controls have separate space; restored the full-width New Conversation action.
- Wired Off, Minimal, and Full animation preferences through both Motion and CSS. Off suppresses transitions/animations; Minimal disables keyframes and caps transitions at 120 ms; Full follows the OS reduced-motion preference.
- Settings now update the selected motion state immediately; onboarding completion persists in settings.

### Renderer crash from the supplied screenshot

- Read the existing local crash report by its dedicated crash key. It recorded `Minified React error #321` from the `@monaco-editor/react` component (`Editor`) in `monaco-BTIDyDV-.js`, rendered beneath ReactDOM in `vendor-DsL9rUbS.js`.
- Root cause: the custom Vite `manualChunks` rule split `@monaco-editor/react` into a separate `monaco` chunk, separating the React hook component from the app's shared React runtime.
- Updated `vite.config.ts` to deduplicate `react` and `react-dom`, and to split only the standalone `monaco-editor` runtime. The React wrapper now remains in the shared vendor chunk.
- Added a production-surface contract for this chunk invariant and updated the crash-boundary contract to match the current animation-aware Motion config and source formatting.
- New production build output has no dedicated `monaco-*` React-wrapper chunk; the React runtime signature occurs in the shared vendor asset. Lint and production build pass.

### Test isolation and user data

- The full regression run showed that Tavily service tests read the real saved Windows DPAPI key instead of the synthetic test key. The failing tests therefore attempted real DPAPI access and failed in the sandbox.
- Added injectable state-directory and API-key-reader options to `TavilyVerificationService`; the production defaults still use the existing saved key and `~/.quillix` storage.
- Updated Tavily unit tests to use a unique workspace-local temporary directory and clean it after each test. The focused Tavily suite passes 6/6.
- The earlier full run's online Tavily tests failed before writing usage; the offline fixture's history write was denied by the read-only user-profile sandbox. The inspected user Tavily history/usage files retained their pre-test modification times and sizes.

### Python verifier shell-quoting regression

- Python syntax verification previously built `python -c "..."` as a shell command. On Windows, the command shell reduced the Python argument to `import`, producing a syntax error and downstream false agent failures.
- Changed the check to call `execFile(python, ['-c', script, absolutePath])`, avoiding shell parsing and keeping the source path as a distinct argument. The check remains read-only, with a 30-second timeout and 1 MB output cap.
- `npm run lint` passes after the change. The formerly failing `agentProjectFlow`, `carGameExecution`, and `nextGenCapabilities` suites now pass together: 3 files, 30 tests.

## Verification in this session

| Check | Result |
|---|---|
| `npm run lint` | PASS |
| `npm run build` | PASS; Vite 8.3.0 production build and server/Electron bundles completed |
| `npm run test:production-surface` | PASS, 22 checks |
| `npm run test:chat-ui` | PASS, 64 checks |
| `npm run test:preview-ui` | PASS, 10 checks |
| `npm run test:settings-health` | PASS, 18 checks |
| `npm run test:crash-boundary` | PASS |
| `npm test -- src/server/__tests__/tavilyVerification.test.ts` | PASS, 6 tests |
| Targeted agent/Python regression suites after verifier fix | PASS, 30 tests across 3 files |
| Full `npm test` after Tavily isolation and Python verifier fix | PASS, 72 test files and 763 tests |
| `npm run build` after Python verifier fix | PASS; Vite client and server/Electron bundles rebuilt |
| `npm run test:backend:e2e` | PASS; integration TypeScript compile and all HTTP end-to-end checks passed, including mode locks, offline Tavily, workspace traversal, protected files, preview isolation, command approval, and task recovery |
| `npm run test:electron-browser` | PASS; AURA browser fixture loads without console/network errors, interaction and persistence checks pass, 390px responsive check passes, desktop/mobile captures created. This validates the Electron browser harness, not the NUVRO AI renderer app. |
| `npm run test:ui-accessibility` | PASS, 23 source contracts covering accessible names, chat-history keyboard close/focus return, dialog focus/Tab behavior, roving tabs, and FileTree controls |
| `npm run test:electron-browser` | EXIT 1 with no diagnostic output; does not verify the NUVRO AI renderer fix. |

The NUVRO AI local-origin browser inspection was declined by the browser origin approval gate, so the updated app renderer was not runtime-reloaded in this session. The running app must reload the newly built renderer before its status can be confirmed. Do not claim the crash fix as runtime-verified until the app is restarted and Studio opens without the React error.

## Remaining mission scope

- Finish visual and interaction review of Home, Studio, Chat, Tools, Settings, onboarding, history, dialogs, and narrow/short layouts.
- Verify the React/Monaco fix in the reloaded desktop app when local app inspection is available.
- Complete UI/runtime review of the NUVRO AI renderer and remaining security, packaging, and roadmap audits.
- Trace major roadmap features through UI, API, backend, persistence, approvals, and error handling; classify incomplete or externally blocked features honestly.
- Continue backend, IPC, workspace security, provider, performance, packaging, and current-roadmap audits. The current package and live-model/release gates remain unverified as described in the README and release records.
- Produce the detailed final restoration report only after the full audit and required verification are complete.
