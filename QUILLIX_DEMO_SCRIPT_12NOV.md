# NUVRO AI submission demo script

**Internal target:** 12 November 2026  
**Official prototype deadline:** 15 November 2026  
**Target recording:** 4–5 minutes  
**Companion evidence:** [Hackathon submission pack](HACKATHON_SUBMISSION_PACK.md)

This is a recording guide, not evidence that a live demo has already been run.
Only record a step as a successful result after executing it on the current
source or the exact release candidate shown in the recording.

## Before recording

- Use the current source build or a freshly rebuilt installer. The 5 November
  installer is stale relative to current source and must not be used to imply
  current-source acceptance.
- Choose an explicitly configured provider. If using local Ollama, check that
  free RAM is above the selected model's ResourceGuard floor before the demo;
  NUVRO AI should remain visibly honest if the model is unavailable.
- Use a new empty demo workspace. Keep API keys and personal workspace files
  out of the recording.
- Have a small static website prompt ready; do not promise the generated result
  before NUVRO AI has actually run its configured checks.
- Keep the current evidence counts visible in a note: 55 files / 581 tests,
  lint, production build and backend HTTP E2E passed on 6 November after the
  final project-memory trust-boundary addition. The previous
  portable package passed artifact/static checks before that change and is now
  stale. Packaged launch acceptance has not passed. A fresh local-model run
  paused below its RAM floor.
- The latest smoke pipeline passed all 17 subcommands (131 tests, 0 failures)
  on 6 November. Its retained log is
  `.quillix-smoke/test-smoke-roadmap-2026-11-06.log`; this is local contract
  coverage, not live model or packaged-app evidence.

## Timed narration and actions

### 0:00–0:30 — What NUVRO AI does

**Say:** “NUVRO AI is a desktop coding agent. Its body safely inspects a chosen
workspace, edits files, runs checks and repairs failures. The brain can be a
local Ollama model or an online provider that I explicitly select. It does not
silently switch to cloud inference.”

**Show:** Dashboard, active provider, and Offline Mode setting. Do not show
credential values.

### 0:30–2:15 — Build a small project

**Do:** Select the empty demo workspace and ask NUVRO AI to:

> Create a three-file event waitlist page using index.html, style.css and
> script.js. Include a semantic email form, responsive layout, visible keyboard
> focus, email validation, and a clear success message. Do not add dependencies.
> Run the checks available in this project and report any that you could not
> run.

**Show:** Live agent activity, changed-file list, and the actual verification
result. If a check fails, show the failure and repair attempt instead of
presenting the task as complete.

### 2:15–3:15 — Continue in the selected file

**Do:** Open `style.css` and ask:

> इस project में mobile layout को बेहतर responsive करो। HTML और JavaScript को
> मत बदलना। बदलाव के बाद CSS validation चलाओ।

**Show:** NUVRO AI keeps the active project, targets the open stylesheet, and
reports changed files and check results. Confirm in the actual run that the
HTML/JavaScript remain untouched before describing that behavior as verified.

### 3:15–4:00 — Preview and evidence

**Show:** Open the built-in preview, use the mobile viewport preset, submit the
form, and show the actual browser result. If the interaction or visual check
was not run successfully, describe it as pending rather than implying the
static verifier proves browser behavior.

**Say:** “For this source checkpoint, the Windows regression passed 55 files
and 581 tests, plus lint, production build and backend HTTP E2E. The focused
trust-boundary regression after the last source change passed 11 of 11. The
previous portable package is stale after that change, so I am rebuilding before
showing a release candidate. The fresh local-model run paused below its RAM
requirement.”

### Optional 4:00–4:45 — Tavily stale-answer demonstration

From a separate terminal, run `npm.cmd run demo:tavily`. This is a deterministic
fixture demonstration of claim extraction, a stale finding, approval-gated
correction and a real syntax retest; it uses no live Tavily credits. Label it
as fixture mode. Use `npm.cmd run test:live-tavily` only when intentionally
showing a configured real Tavily account and its live result.

## Final recording checks

- [ ] The source/build or installer shown matches the current source evidence.
- [ ] The coding task completed and its reported checks were actually run.
- [ ] The preview actions and responsive behavior shown were exercised live.
- [ ] No credential, private workspace path, or unrelated personal data is visible.
- [ ] The video distinguishes current-source local tests, live-provider results,
  fixture demos, and official benchmark grades.
- [ ] The video makes no Cursor parity or superiority claim from unmatched
  NUVRO AI-only evidence.

## Evidence to attach after recording

Fill these from the actual run; do not estimate:

| Field | Recorded value |
|---|---|
| Recording date/time | Pending |
| Source/build identifier | Pending |
| Selected provider/model | Pending |
| Coding task outcome and changed files | Pending |
| Verification commands and results | Pending |
| Browser/preview interactions checked | Pending |
| Video filename/link | Pending |
