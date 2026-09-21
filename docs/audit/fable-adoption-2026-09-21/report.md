# Fable 5.1 consultation: adoption and field feedback

The owner explicitly invoked the second-opinion skill and asked for Fable 5.1's independent limitations first, followed by a discussion with Codex to improve adoption readiness, cost and cross-project feedback. This report records that consultation and independently checked findings. It is not a release review or an implementation result.

## Method

- Source revision: `7743e8616db9413328d7c9502e0af901e8914d43`.
- Advisor: requested and observed `claude-fable-5-1` through Claude Code 2.1.274, high effort, read/search tools only, safe mode, external MCP disabled. No permission denials.
- First round: fresh session with an isolated canonical source packet. Codex's earlier assessment, ratings, remedies and conversation were excluded. The owner-specific central-feedback design was introduced after the first independent response.
- Later rounds: resumed that advisor session for comparison and a final narrowed proposal. Those responses are collaborative refinement, not additional independent assessments.
- Session: `842f487a-76c4-445f-bea2-5ef5fe189de3`.
- Prompts, raw responses, parsed responses and invocation records are retained alongside this file. The first CLI call also reports a small auxiliary Haiku harness call; the substantive opinion is attributed to the requested Fable model.

## Agreement and differences

Fable's foundation rating was 3.5/5, equivalent to Codex's 7/10. Fable rated operational readiness 2/5 versus Codex's earlier 5/10. The difference is subjective; both identify missing operational evidence and unmeasured owner effort. Fable also rated coordination and learning maturity 2/5.

Fable identified concrete milestone bookkeeping/freshness friction that Codex's earlier broad assessment missed. Codex independently reproduced it. This shifted the recommendation toward repairing observed friction and preparing target-specific evidence before building a full controller.

Fable initially preferred a private central intake. Codex retained the owner's requested public repository and proposed automatic reports rendered only from approved fixed statement templates and constrained metadata, with private narratives kept outside the public payload. Fable withdrew the private-intake prerequisite, while requiring catalog usefulness, metadata leakage, private UUID-to-project mapping and delivery bounds to be measured/specified.

Fable initially proposed more pre-pilot helpers. The final joint package removes separate wizard/dashboard products and generic reporter support from the prerequisite list. The target project's test reporter determines the one evidence helper needed. Unknown private project facts remain unknown.

## Corrections and verification

| Advisor claim | Independent check / disposition |
|---|---|
| Routine milestone claims/usage conflict with protected records; broad freshness affects unrelated tasks | Confirmed with a disposable Git fixture and default classification. Initial Ready, then usage-only governing approval requirement and stale readiness; unrelated M-0002 also caused staleness. See probes.mjs and probes.json. |
| Real launcher may fail because extracted ESM package metadata is absent | Default installed Node v22.23.1 passed. Detection-disabled Node failed to parse imports. Reclassified as portability hazard; no early-Node test was performed. |
| No CI definition exists | Incorrect due to Codex's initial packet omitting .github. Actual pinned unprivileged regression CI was provided in round two and Fable corrected the statement. Trusted operational collector is still distinct. |
| About 71 tests | Advisor's unexecuted source count was not reliable. Codex ran npm test: 95 passed, zero failures/skips/cancellations. |
| Compare a native GitHub route using only baseline receipts | Not runnable through current wf ci: candidate-bound verification, review and integration receipts remain required. Fable retracted it as an operational alternative; a native adapter would require separate implementation/review. |
| Sustainable cost cannot be achieved currently | Too strong without measurements. Corrected to sustainable owner cost is unproven. |
| Reporter should automatically group similar incidents | Narrowed to stable event identity; fingerprint is only a grouping candidate. Semantic grouping remains triage. |
| Author-filtered issue text can be trusted for maintenance | Clarified: all issue/comment text is untrusted data regardless of author; filtering only reduces spam. |

The initial local probe used a fixture's reduced classifier and therefore classified the milestone as planning. It was corrected to use the repository's actual config.default.json before the recorded reproduction was treated as confirmation. The retained probe and output use that default configuration.

No implementation code or policy was changed. The existing full suite passed in 4.08 seconds; this does not test future reporting/controller code or product operation.

## Actual central issue

[Issue #2](https://github.com/Cazy00/agent-workflow/issues/2) records the reproduced milestone interaction. The owner requested central GitHub reporting. Before publication, Codex verified the explicit MontaDev-sys credential route, destination and issue availability, and checked existing all-state issues for duplicates. The prepared body contains public source links and synthetic reproduction details, with a stable report marker. The issue was read back to verify its author, marker and URL.

This proves one authenticated issue write. It does not prove least-privilege token scope, automatic cross-project delivery, fault recovery, private-context payload safety, or a complete field learning loop. No remote settings, code, release tags or other projects were changed.

## Recommendation and handoff

The concrete [proposal](../../proposals/adoption-and-central-feedback-2026-09-21.md) specifies the implementation order, central reporting boundaries, user feedback cadence, acceptance scenarios and evidence required to revisit the ratings. The first adopting repository is still needed to scope its test adapter and pilot. No further opinion round is necessary on the current question.

Session outcome: progress — independent opinion, reconciliation, one reproduced central issue and a concrete proposal preserved. Workflow friction this session: confirmed bookkeeping interaction tracked in issue #2. The evidence remains local and uncommitted; no workflow implementation or automatic monitor was installed.
