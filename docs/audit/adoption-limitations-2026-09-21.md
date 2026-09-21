# Assessment: limits to broad developer adoption

Date: 2026-09-21. Inspected revision: `7743e8616db9413328d7c9502e0af901e8914d43` with an initially clean working tree.

Authority: the owner's question about limitations to becoming an essential workflow for developers and people building software. Scope: local source assessment and durable findings, not implementation, independent release review, adoption or publication.

## Conclusion

The repository supplies detailed assisted-development governance. Its strongest documented features are bounded authority, durable context, independent review, test traceability and explicit acceptance. Broad adoption depends on demonstrating better delivery outcomes while making this discipline easy to use. More policy text alone does not establish that value.

This is a product assessment grounded in local sources, not a market survey or a fresh security audit. Prior test and review results below are attributed to their existing records, not rerun here. External GitHub state was not rechecked.

## Limits and implications

1. **Operational benefit remains unproven in the inspected evidence.** `docs/audit/conformance.md` leaves live approval-path exercises, fresh tool discovery and an observed adopting-project pilot pending. `docs/audit/T-0003/report.md` records 95 passing tests and eight hypothetical instruction scenarios, explicitly not live product pilots. These establish bounded tooling/instruction evidence, not reduced defects, lower cost or faster delivery. Measure setup effort, time to accepted work, owner intervention, rework and escaped defects across representative real tasks, with a comparison to the prior process.

2. **Adoption asks users to understand substantial machinery.** `QUICKSTART.md` requires records, configuration, an external launcher and pin, signed receipts, identity setup and operational exercises. `POLICY.md` sets a default setup budget of two working days; this is a timebox, not measured setup time. `validator/cli.js` exposes validation commands but no setup wizard. Guided setup, understandable diagnostics and automatic preparation of records/evidence are product opportunities. They must preserve the trust boundary and explicit owner actions.

3. **The user still coordinates much of execution.** `SCHEMA.md` and `procedures/execute.md` describe assisted task claims, cumulative budgets and recovery. No durable unattended runner is adopted. That is a declared scope boundary, not a policy defect. Reliable automation would require separate authorisation and evidence for interruption recovery, duplicate claims, retries, spending and side effects; adding an unattended promise prematurely would enlarge the risk.

4. **Mechanical compliance cannot establish substantive quality.** `SCHEMA.md` expressly limits semantic checks. A signed result authenticates an attestation, not the truth of every requirement or the completeness of every test. A separate reviewer context can still share a mistaken assumption. Real acceptance examples, independent evidence and product operation remain necessary. No workflow can guarantee good software from a wrong problem definition.

5. **Beginners face a different product problem from experienced developers.** Templates ask for authority, acceptance, constraints, environments and verification; they do not constitute a guided user interface for eliciting those decisions. A nontechnical builder needs short questions, concrete examples, visible demonstrations and plain-language consequences. Developers need low overhead, existing-repository compatibility and integration into their normal tools. One undifferentiated onboarding experience is unlikely to serve both well; this is an inference, not a measured usability result.

6. **Generality is an intention with a narrower evidenced implementation.** `POLICY.md` includes Monta-specific account arrangements; README supplies Codex/Claude entry adapters and requires live discovery per project/tool version. The publishing adapter is a terminal GitHub route. Wider distribution needs approved configuration boundaries for personal/team roles, a clearly tested support matrix and deliberate upgrade/migration support. Do not infer support for other providers or enterprise arrangements from neutral document formats.

7. **The effort/value balance has not been measured.** Detailed task records, four verification layers and evidence collection may be justified for consequential changes, but their actual burden for ordinary changes is unknown. Current instructions already allow appropriate testing and simple repair work; adding universal TDD or mandatory extra forms would duplicate or burden them. Automate clerical work and reuse approved context before considering any change to safeguards. An essential tool must make its benefit visible during normal use.

## Suggested direction for owner consideration

First establish one supported assisted setup and complete the pending live exercises. Then observe a small set of real tasks spanning a bug fix, a user-facing feature and a consequential integration; compare quality and effort with the prior process without claiming a controlled causal study. Use those results to improve setup, status explanations and evidence collection. Expand supported tools or unattended operation only when observed demand and operational evidence justify them.

The clearest initial audience is a developer or small team already using coding agents and losing context or verification discipline between sessions. A beginner-oriented experience is a distinct product layer requiring validation. The practical promise to test is: describe an outcome, resume work reliably, see what was verified and understand the next decision.

Recent T-0003 work already adds changed-app journey inspection, task reference/exclusion hints, task-appropriate testing and conditional product-AI evaluations. These should be piloted rather than listed again as absent features.

## Session outcome and handoff

Outcome: progress — assessment completed and preserved. No governing rules, code, adoption configuration or external state changed. No workflow defect was reproduced; these are product limitations, documented operational gaps and improvement hypotheses. Workflow friction this session: none.

Next eligible action: use this assessment to select a bounded pilot or usability improvement in a separately scoped request. Any reusable workflow implementation still follows independent review and owner release/adoption approval. No test suite rerun was needed for this documentation-only assessment.

## Follow-up: readiness rating and practical remedies

The owner clarified an intention to adopt this in a large existing project, with Codex and Claude Code as the only required agent tools, and asked for an estimated rating and implementable remedies. This narrows compatibility scope; it does not identify the target repository or authorise a release or a particular implementation package.

Subjective assessment: 7/10 for the documented engineering foundation; 5/10 for immediate operational adoption readiness. These are judgment scores, not measured success probabilities. Confidence is moderate for a bounded supervised milestone after required setup, and unattended operation is currently unsupported. No defensible 90%, 95% or 100% project-success probability can be derived from local validator tests. The target project's complexity, baseline, acceptance quality and tool behavior are still unknown.

Proposed implementation priorities:

- Guided setup and diagnosis: inspect a target repository, prepare draft records and adapters, expose unresolved decisions, verify permissions and trusted-checker setup, and distinguish configured, tested and unavailable controls. Do not guess owner decisions or claim operational setup from generated files alone.
- Routine assisted coordination: prepare canonical task/review packets, capture actual results and checkpoints, and show the next eligible action. A later bounded controller can enforce persistent task claims, budgets, retries, child cleanup and recovery, but must be separately implemented, tested and observed before claiming unattended operation.
- Evidence preparation: parse supported test reporters and preserve candidate/environment identity and raw logs. Prepare review and approval packets automatically. Under the current manual-receipt mechanism the owner-controlled collector still examines evidence; automatic signing based on authenticated machine evidence would be a separately reviewed trust-mechanism change, not a silent convenience patch. Workers never receive owner signing keys, and product acceptance remains an actual owner decision.
- Two tested tool adapters: use the same canonical records with Codex and Claude Code, test fresh instruction discovery, handoffs, blocked work and interruption behavior on the versions actually installed. Broad third-party provider compatibility is outside the requested target.
- Cost accounting: record available token usage, elapsed time, tool calls, retries, review passes and owner effort per accepted task. Distinguish API list-cost estimates, subscription consumption and actual charges; unknown measurements stay unknown. Use deterministic programs for state and parsing, scoped context packets, one default implementer and an independent reviewer, and bounded retries. Preserve required integration reruns and affected re-review after changes.
- Product-quality evidence: test owner-approved behavioral examples, relevant negative cases, actual user journeys, persistence and permissions. Review expected results against governing requirements. A failing-path demonstration can reveal a meaningless test, but a workflow cannot prove that all requirements and failure modes are complete.

Start adoption within one bounded milestone of the large project after setup and live control exercises. Measure the workflow alongside the product result, repair observed friction, then expand. Do not require the entire workflow product to be perfected before any supervised trial, or impose it across all project work before evidence exists.

These are recommendations for a concrete next scope, not implemented features. No savings percentage, success probability, timeline or spend estimate is asserted without measurements.
