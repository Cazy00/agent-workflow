# T-0004 — Adoption and central feedback implementation

Local implementation is complete; independent Fable 5.1 recheck passed. This is an unreleased source candidate, not an adopted product workflow.

## Authority and candidate

The owner explicitly authorised implementation of the agreed [package](../../proposals/adoption-and-central-feedback-2026-09-21.md), including central reporting to Cazy00/agent-workflow. [T-0004](../../workflow/tasks/T-0004.md) preserves that authority and scope. POLICY.md is unchanged. Base: `7743e8616db9413328d7c9502e0af901e8914d43`. Reviewed fix candidate: `2e346f631baa8d7b1f37c35144504ecd9ffd89e2`. Branch: `codex/T-0004-adoption-feedback`.

## Delivered behaviour

- Relevant governing dependencies at both revisions determine stale readiness. Ordinary runtime bookkeeping and unrelated milestone/acceptance additions no longer invalidate every task. New applicable decisions, supersession, relevant requirements and transitive prerequisites remain checked. Git pathspec magic cannot suppress that comparison.
- The extracted validator declares its module format explicitly; a real pinned-launcher fixture runs with automatic module detection disabled.
- Central reporting builds fixed public-safe catalog payloads and keeps durable private state outside the adopting project. Explicit worker/destination checks, stable event IDs, bounded delivery, ambiguous-write reconciliation, local locking and session allowances are implemented. Reporting remains available during readiness blocks. Security-sensitive reports stay private. The CLI is invoked by the working agent; no background monitor is installed.
- Private runtime records track one active claim, milestone exposure, optional feedback cadence/opt-out and incremental usage. Unknown usage stays unknown; a known exhausted lower bound cannot be hidden by later unknown entries. This is assisted accounting, not an unattended spending enforcer.
- A Node test reporter and evidence adapter preserve actual test events and candidate identity in an unsigned draft. Owner-controlled execution authentication, signing, independent review and acceptance remain separate.

Usage and configuration: [operations procedure](../../../procedures/operations.md).

## Verification and independent review

`npm test`: **137 passed, 0 failed, 0 skipped**, both before the fix checkpoint and against the assembled fix candidate. See [final checks](final-checks.json) and [raw output](final-tests.tap). Regressions cover readiness dependency changes, root requirements, literal paths, real CLI/module startup, identity/privacy, ambiguous delivery, rate limits, bounded retries, queue draining, usage uncertainty, surveys, claims and actual Node reporter conversion. Tests use disposable fixtures; they do not establish a live adopting-project installation.

Fable 5.1 (`claude-fable-5-1`, high effort) reviewed in a fresh canonical-source context without the implementer's conversation or previous advice session. The first verdict required changes. All eight findings were addressed with regression coverage:

| Finding | Correction |
|---|---|
| F1, high: Git pathspec exclusion could hide governing changes | Reject leading-colon paths and use literal Git pathspecs |
| F2, medium: unknown usage could hide an already exhausted budget | Preserve known lower bounds and nonzero unknown/exhausted CLI status |
| F3, medium: root governing files were ignored | Track valid repository paths, including root requirements |
| F4, low: duplicated overlap logic disagreed on normalized paths | Share the same normalized overlap helper |
| F5, low: rate reset header delayed unrelated failures | Use reset only for actual exhausted 403/429 responses |
| F6, low: account lifetime issue count could permanently hold delivery | Bound listings relative to durable enqueue time |
| F7, low: missing event ID undermined replay deduplication | Require caller-persisted UUID |
| F8, low: unrelated acceptance additions still staled work | Compare only relevant acceptance definitions at both revisions |

The review also covers delivery in a later real session while preserving the original event ID and counting that session's attempts. Initial raw review, prompts, invocation metadata and follow-up evidence are retained in this directory. Independent review is not a signed owner-controlled lifecycle receipt. The [recheck](review-followup.parsed.json) passed with two low, non-blocking observations: the runtime exit-1 wording was clarified exactly as requested, and malformed governing references continue to fail closed with an explicit error (structured readiness reasons remain an optional improvement). Only that clarification and evidence/status records changed after the reviewed code candidate.

## Limits and adoption next step

Bun Alkaif's documents-gathering-and-organizing branch was identified as the source. The owner is deciding between the existing checkout and a curated fresh repository. Bun Alkaif has not been modified, migrated or configured. Recommended next step: selectively inspect the local source checkout, extract a short brief with source references, separate approved decisions from research, and identify reusable code/assets plus unresolved questions before choosing a destination. Its actual test runner remains unconfirmed; the included adapter currently supports Node only.

Before a product pilot: obtain release approval and a released pin, choose the destination/layout, provision the external config/trust/worker route, exercise actual Codex and Claude Code instruction discovery and approval paths, and select one bounded milestone with explicit acceptance and resource limits. The current GitHub issue route was exercised during consultation, but the new automatic reporter has fixture evidence only. No least-privilege token, cross-host exactly-once delivery, autonomous coordination, real-world benefit or success percentage is claimed.

[Issue #2](https://github.com/Cazy00/agent-workflow/issues/2) remains the central source-reproduction record. Release, explicit adoption and re-exercising its original trigger are still needed before claiming a demonstrated field fix. The existing v1.0.0 tag remains unchanged.
