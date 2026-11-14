# QUILLIX Tavily Stale-Answer Verification

QUILLIX treats Tavily as an optional, evidence-gathering brain-side service. It
does not replace Ollama or an online coding model, and it never silently turns
an unavailable web check into a fresh answer.

## Setup

Install the official SDK with `npm install @tavily/core`, then save the key in
Settings → Tavily freshness verification. On Windows the key is encrypted with
the current user's DPAPI. `TAVILY_API_KEY` is supported for temporary/session
use, but it is never copied into settings or the renderer.

## Verification flow

1. The agent calls `verify_current_information` only for version-sensitive APIs,
   libraries, documentation, or other claims that can become stale.
2. QUILLIX performs one bounded Tavily Search request, preferring official docs,
   then extracts up to two highest-priority pages for evidence.
3. Search and Extract responses are cached for 15 minutes using a query/answer
   fingerprint. Usage is persisted as aggregate counts and credits only.
4. The answer is split into a bounded set of reviewable claims. Time-sensitive
   claims receive an individual finding, confidence, cited URLs, and an aggregate
   freshness score. The result is `supported`, `possibly_stale`, `contradicted`, `unverified`, or
   `offline`, with source URLs, timestamps, usage and an explanation.
5. The result is read-only. A stale finding can inform the normal QUILLIX plan →
   approval → edit → test → retest workflow; Tavily never writes files directly.

Usage stores searches, extracts, credits, timestamps, verification count, and an
estimated USD cost. The default estimate uses Tavily's current $0.008/credit
pay-as-you-go reference and can be overridden for an account or plan with
`QUILLIX_TAVILY_COST_PER_CREDIT_USD`; it is explicitly an estimate, not a bill.

Offline Mode always returns `offline` without a network request. This is an
explicit safety result, not a claim that the answer is current.

## HTTP surface

- `POST /api/verification/tavily` — verify `{ query, answer?, urls?, force? }`
- `GET /api/verification/tavily/usage` — aggregate usage only
- `POST/DELETE /api/providers/tavily/key` — secure key lifecycle

The Settings panel displays the finding, evidence explanation, trusted-source
links, and aggregate search/extract/credit counts. Tests cover offline blocking,
official-source prioritization, unsupported-version detection, and cache reuse.

## Hackathon mapping

This implements the selected Tavily Stale-Answer Detector path from the pasted
six-problem guide: claim/answer input, current search, source retrieval,
freshness finding, citations, cost-aware caching, and a human-visible evidence
dashboard. The Bifrost Token-Efficient Coding Agent remains the execution body;
Tavily is a selective verifier rather than a second autonomous writer.
