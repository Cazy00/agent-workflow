# Workflow conformance implementation plan

> Execute in this session using the supplied policy as the requirements. Independent review uses a separate context.

**Goal:** Bring the repository into alignment with the supplied consolidated workflow, with tested local controls and explicit evidence for operational limitations.

**Architecture:** Retain the zero-dependency Node validator. Add separate modules for approval evidence, acceptance coverage, and lifecycle/session validation. Shared procedures provide assisted execution; an unattended runner is conditional in the policy and is not adopted here.

**Tech stack:** Node.js 22+, Git, GitHub CLI for read-only identity inspection.

**Spec:** User attachment `pasted-text.txt`, copied verbatim to `POLICY.md`. Original implementation: `90621cfebb8d377a2edb14b19fa22ecf6fdf4b63`.

## Constraints

- Owner approval, product acceptance, and release remain distinct.
- Candidate records and successful exits cannot attest to their own approval or completion.
- Local fixes do not publish a release, change GitHub protections, or prove a live approval path.
- Keep planning and feedback usable while production work is blocked.
- Keep the existing v1.0.0 tag immutable. Changes are an unreleased candidate.

## Work

- [x] Restore the exact reference and add the missing neutral procedures, adapters, and record templates. Map every policy section to implementation, verification, and remaining operational evidence in `docs/audit/conformance.md`.
- [x] Reproduce readiness/source/CLI failures in `validator/test/conformance.test.js`: unapproved baseline, omitted path-scoped decision, malformed governing records, superseded prerequisite, generated production output, stale candidate selection, invalid git references and renames. Fix the responsible source, record, readiness, classification, and CLI modules.
- [x] Add approval attestations and milestone/feature/project readiness. Exercise signed, tampered, expired, wrong-revision, and absent approvals using generated test keys. Require external owner trust for consequential gates.
- [x] Add acceptance mappings and execution checking, including all six acceptance fixtures, plus review/lifecycle/session evidence checks and their adverse cases.
- [x] Replace unsafe adoption instructions and wrapper behaviour with explicit pinned-validator execution. Document isolated identity checks, trusted CI bootstrap, review collection, manual continuation, pilot and maintenance procedures.
- [x] Run all tests, CLI integration tests against real temporary Git repositories, and independent review. Preserve findings, test output, live read-only GitHub evidence, and any required owner actions. Leave a reviewable local diff.

Run focused tests with `node --test validator/test/<name>.test.js`; run the assembled suite with `npm test`. Validate shell syntax with `bash -n bin/wf`. Review the final diff with `git diff --check` and independent review against the starting revision.

Local work completed with 95 passing tests and all bounded independent-review findings resolved. Live operational setup, approval-path exercises, tool discovery and the observed pilot remain explicitly open in docs/audit/conformance.md.
