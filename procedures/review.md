# Independent review and integration

Prepare a committed candidate plus scope, task/milestone records, governing requirements and acceptance definitions, relevant designs, exact base/candidate diff, verification evidence and limitations. Launch a separate review context without the implementer's conversation or informal reasoning. Canonical design rationale remains available.

Review scope, correctness, maintainability, security, regression risk and test fidelity. Inspect supporting helpers, fixtures, setup, assertions, execution configuration and untagged tests. Mapping IDs prove traceability, not quality. Record candidate identity, reviewer/context, checks, findings with severity/disposition, evidence and limits in `templates/review.md`. Collect the actual separate-context result; the implementer cannot substitute `reviewed: true`.

New tests for approved behaviour are normal implementation. Explain meaningful test refactors. Correct tests contradicting approved requirements by citing the requirement and independently checking the correction. Approved behaviour changes need a focused requirement/decision approval present on the authoritative baseline first. Removed/disabled/weakened required coverage blocks integration until justified through the correct route; a linked spec PR or candidate approved field is insufficient.

For a renamed required test, approve the mapping migration with its preserved coverage before relying on it; arbitrary removal is blocked. All test code changes require semantic review. The checker does not pretend to identify every weakening mechanically.

After review, assemble the candidate with the latest authoritative baseline and rerun required integration checks. Revalidate approval, readiness, paths, coverage and review at that exact candidate. Capture verification/execution and review through the owner-controlled receipt procedure. Keep candidate code in a separate unprivileged environment. Invoke the external trusted validator with explicit baseline/candidate; never execute a candidate-selected validator or accept a check name as proof of provenance.

Planning, checkpoints and feedback remain possible while production is blocked. Generated outputs conservatively receive production gates. Protected governing/enforcement changes need scoped signed receipts; dependent implementation still reads requirements/decisions from the earlier approved baseline, so a combined proposal does not approve itself.
