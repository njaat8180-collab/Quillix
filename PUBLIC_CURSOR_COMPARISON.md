NUVRO AI comparison with published Cursor results

Checked 5 November 2026. The user selected published Internet results as the
Cursor baseline. Evaluation here uses the locally installed NUVRO AI and Ollama.

The official CursorBench page was rechecked on 5 November 2026. CursorBench 4.0
reports Opus 5.5 Max at 57.8% and Composer 2.5 at 27.7% (17,347 tokens and 41
steps for Composer 2.5). Cursor's March 2026 Composer 2 report separately gives
historical results on CursorBench 3.1, Terminal-Bench 2.0 and SWE-Bench
Multilingual. These are published targets only: CursorBench's task fixtures and
grader are private, and the models, harnesses and execution environments are
not available in this workspace.

| Published evaluation | Configuration | Reported result | NUVRO AI evidence on that evaluation |
| --- | --- | --- | --- |
| CursorBench 4.0 | Opus 5.5 Max in Cursor | 57.8%, 218,363 tokens, 185 steps | No run on these tasks |
| CursorBench 4.0 | Composer 2.5 in Cursor | 27.7%, 17,347 tokens, 41 steps | No run on these tasks |
| Terminal-Bench 2.0 | Composer 2, March 2026 release | 61.7 | No official graded run |
| SWE-bench Multilingual | Composer 2, March 2026 release | 73.7 | No official graded run |

The first two rows come from the current [official CursorBench 4.0 table](https://cursor.com/en-US/cursorbench).
The other rows come from the [Composer 2 release report](https://cursor.com/blog/composer-2).
The release report describes five iterations using Harbor and default
Terminal-Bench 2.0 settings. Those are historical release results. The
CursorBench version used for its original release chart differs from 4.0.

Cursor describes CursorBench as an internal evaluation of real development
sessions, covering correctness, quality, efficiency and interaction. Its
description includes ambiguous requests and changes across multiple files.
The published pages do not provide the complete task fixtures, grader and
configuration needed to reproduce the private evaluation locally.
[Method description](https://cursor.com/blog/cursorbench)

NUVRO AI's local coding fixtures exercise a smaller task distribution. Their
pass rate, runtime and tokens cannot establish a numerical lead over these
published results. A passing structural check also cannot establish working
browser interactions. The website continuation case now includes an isolated
Chromium check of real stylesheet loading, theme-button clicks, mobile
overflow, applied animation and console errors. Its script is
scripts/smoke/website-continuation-browser.cjs.

The open route for a comparable coding result is an official public dataset.
[SWE-bench Multilingual](https://www.swebench.com/multilingual.html) provides
300 tasks from 42 repositories across nine languages, with regression and
issue-specific tests. Its official grading uses container images. The current
machine has neither Docker nor an installed WSL distribution, as checked
through command discovery and wsl --list.

[Terminal-Bench's current instructions](https://www.tbench.ai/run) use Harbor
and GPU-capable environments for version 4.0. That version is separate from
the published Composer 2 result on 2.0. Public scores, task versions, model,
budgets and grading environment must remain attached to every imported result.

The local comparison command checks selected-case and evaluator-contract
fingerprints, settings, repetitions, completed run coverage and a hardware
fingerprint. Missing or mismatched evaluator hashes are explicitly rejected.
Equal scores appear as ties. A comparable report is labelled COMPARABLE, which
indicates matching evaluation conditions; it does not indicate that NUVRO AI won.

Current conclusion: published Cursor results supply a capability target.
NUVRO AI still requires official public-task results before a score comparison,
and broader real-project evidence before parity or superiority can be claimed.

The 5 November source check confirms that CursorBench 4.0 measures ambiguous,
multi-file work drawn from real Cursor sessions. Cursor describes its suite as
an internal evaluation and says public benchmarks have alignment, grading and
contamination limitations. This reinforces that its aggregate score is useful
as context, but not a reproducible NUVRO AI-versus-Cursor head-to-head result.
See the [CursorBench page](https://cursor.com/en-US/cursorbench) and [Cursor's
methodology note](https://cursor.com/blog/cursorbench).

Latest independent public-task evidence (4 November 2026): the pinned
`axios__axios-4731` task was attempted on clean checkouts with qwen2.5-coder:3b
and qwen3:4b. NUVRO AI indexed 460 chunks and selected 2–3 relevant files,
persisted a checkpoint, resumed after timeout, and applied an actual edit after
refreshing stale `oldString` context. One run exported a 448-byte patch, but the
native Axios reproduction still failed; later native-check runs timed out before
verification. These runs are `NOT_GRADED` because the official SWE-bench
container grader is unavailable locally. They are evidence of recovery and
verification behavior, not a public benchmark score or Cursor comparison.

The public runner now bounds the first local-model turn to 240 seconds, then
escalates to an installed fallback model. The native Axios reproduction is
registered in the task manifest and passed into the repair loop. This reduced
qwen3 cold-start waste and produced observable fallback and resume events, but
the latest bounded run still timed out before a verified native pass. That
remains an open reliability result rather than a win.

The isolated Electron browser continuation verifier also passed on the current
workspace fixture: the linked stylesheet loaded, the theme control toggled and
restored state, the mobile viewport had no horizontal overflow, the card had a
real animation, and there were zero browser console errors. This is a concrete
runtime regression result, but it is still a local fixture check rather than a
CursorBench or official SWE-bench score.

After the benchmark exposed a real failure where a local model appended CSS to
`script.js`, NUVRO AI now separates that misplaced CSS into the linked
`style.css` during acceptance repair. The targeted rerun completed with
`completed=true` and `independentChecks=true` in 163 seconds. This improves
recovery evidence for existing multi-file websites, but does not establish a
Cursor score by itself.

Latest local Ollama acceptance matrix (4 November 2026, protocol v5): 18/18
cases passed (100%) across qwen2.5-coder:1.5b, qwen2.5-coder:3b and qwen3:4b.
It covers CommonJS creation, async retry repair, multi-file backend
refactoring, Python and Node runtime repair, and browser-verified three-file
website continuation. The artifact records the machine hardware fingerprint,
resource-guard pauses and smaller-model fallback events. These are
NUVRO AI-local metrics and cannot be treated as a Cursor score; the published
CursorBench and SWE-bench results remain non-reproducible here.

This 18/18 result is protocol v5 and is historical. Protocol v7 now requires
21 unique conditions across the same three local models, with three repetitions
per condition (63 live runs), and adds adversarial project-context
injection/leakage checks. Its summary schema v3 keeps all-attempt latency,
token/model-call costs, repair outcomes and regression counters alongside
success-only quality metrics, and exposes missing token-accounting coverage;
v1/v2 summaries are rejected by the comparer. The
v7 matrix has not run yet; the v5 score does not satisfy the expanded gate.

## 5 November 2026 focused live provider follow-up (not head-to-head)

On the selected NVIDIA Universal endpoint (`poolside/laguna-xs-2.1`), NUVRO AI continued an existing calculator project after the short prompt `add more css and animations`. It read the selected `style.css`, appended CSS through a real workspace tool, and automatic validation plus a PostCSS parse passed. The task used 4 model calls, 2 bounded truncation retries, and 10,266 partially/mixed-accounted tokens; completion took about 103 seconds. This is one live NUVRO AI case, not one of CursorBench's private fixtures, so it cannot be compared numerically with CursorBench 4.0 or establish parity. The exact run report is `.quillix-smoke/selected-provider-stage-Uawogx/followup-live-report.json`.

A second focused live case on 5 November covered a Node existing-project repair: a percentage-discount implementation was corrected in `src/pricing.mjs`, and three existing Node tests passed through NUVRO AI plus a direct `node --test` rerun. It used one model call and 1,679 reported tokens in 7.37 seconds. The task fixture and report are `.quillix-smoke/live-node-continuation-pww9cr/`; this is still not a CursorBench task or head-to-head comparison.

## 6 November 2026 benchmark environment audit

Official CursorBench 4.0 is a private-task reference: the published table currently lists Opus 5.5 Max at 57.8% and Composer 2.5 at 27.7%, but the private task fixtures/grader are unavailable here, so these figures are not directly comparable with NUVRO AI's local cases. Official reference: https://cursor.com/en-US/cursorbench.

The public Axios `axios__axios-4731-native-reproduction` run remains a useful independent task: the fresh NVIDIA Universal run verified the single source edit and passed its native reproduction checks 5/5, using 2,381 provider-reported tokens in 5.9 seconds. It is not an official SWE-bench score. SWE-bench Verified is a human-validated 500-task subset, and its standard evaluator is Docker-based (https://www.swebench.com/verified; https://github.com/SWE-bench/SWE-bench/blob/main/docs/guides/docker_setup.md). Current machine check: Docker CLI absent, WSL executable present but the Windows Subsystem for Linux itself reports not installed, total RAM 5.92 GiB. The official harness therefore cannot be run on this machine in the current setup; no Cursor installation is needed or planned. Keep public-task native checks and official-grade claims separate.
