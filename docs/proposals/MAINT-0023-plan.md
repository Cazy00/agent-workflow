# MAINT-0023 build plan

**Status:** built in v2.12.0 (27 October 2026), except P8. The owner approved building every MAINT-0023 proposal on 27 October 2026, including the two policy changes the record left to the owner, P5(b) and P6. This file is the plan's part about this repository: how the proposals were built, the corrections the code mapping found, and the plan's review. The record is `MAINT-0023-measured-on-v2.11.1.md`; what shipped is `CHANGELOG.md` under v2.12.0.

## Corrections found while mapping the code

- **P7's premise was wrong.** The record said `wf ci` judges every mapped test from the CI job. It does not. `ci.js` takes the execution results from the delivery evidence in the pull request description, and `evaluateAcceptance` requires every mapped test to appear once and pass or be pending. Recording only a link and counts would have removed that check, which is not what the owner approved. P7 was rebuilt as a smaller format that keeps the check.
- **P5(b) needs no gate change.** The validator never inspects a run reference. The rule that the trusted branch's own run on the baseline commit counts exists only in `procedures/readiness.md`. P5(b) is therefore a procedure change plus a `wf next` hint.
- **P8's "Draft" is dropped.** Production changes need a Ready or Active task (`statusOk`).
- **P3's text is in `procedures/execute.md`**, not `delivery.md`.
- **P3's saving depends on the merge route.** Where a route counts superseded check runs, the first, failed "evidence missing" run still blocks the merge, so an empty commit stays as the fallback there.

## A. agent-workflow v2.12.0: one release pull request, one deep review

The validator and the CI templates are risky paths, so the release had one deep review of its final head and at most one fix check. Four workers built it on their own branches from main, merged into the release branch; at most two ran the full test suite at once.

As built (details and tests in `CHANGELOG.md` under v2.12.0):

1. **Templates and text (P1, P2, P3).** `wf-status` keeps one status issue and heals duplicates, considering only issues its own account wrote; the scheduled status run is skipped without a gate runner; the evidence is written after the head's CI has finished, with the empty commit only as a fallback where a route counts superseded runs.
2. **Baseline (P5).** `baseline_result` accepts `pass: <reference>`. `wf next` names the run a baseline may use: a merge commit whose tree equals its merged head (P5(b)), or an ancestor differing only in planning records (P5(c)). Only runs that test a commit (`push`, `workflow_dispatch`, `pull_request`) decide; scheduled runs neither lend a run nor reject a commit.
3. **Milestone review and evidence size (P6, P7).** The milestone review may come in contiguous `review.parts`, judged by one function the gate and `wf usage` share; `wf next` warns past a 700 KiB milestone diff. The delivery evidence may list passing tests once under the run they came from; `wf ci` still requires every mapped test exactly once, and `wf evidence` leaves each result for the agent to state. Measured on one adopting project's largest evidence: 103.9 KB full, 80.6 KB compact.
4. **CLI and doctor (P9, P10).** `wf --help` and per-command help; `wf doctor` warns, without failing, when auto-merge is on and the trusted branch's rules (or classic protection) need a review or merge queue the agent's account cannot satisfy.

**P8 was not built.** It would have let a found task's record appear in the same pull request as its fix, when its `found_from` names a finding recorded on the trusted branch for the milestone. No review finding exists on the trusted branch before its fix: reviews and evidence live on pull requests, never in the repository. Without that check any change could call itself a found task. Feedback F-0005 stays open.

## B. An adopting project's CI (P4): the project's own work

P4 is built through the adopting project's own workflow and records, in its next milestone, never by edits from this repository:

- adopt v2.12.0;
- (b) run the acceptance files in parallel, one database per worker;
- (c) skip CI for records-only changes, with a baseline from P5(c). The skip uses a job-level `if:` from a first "changes" job, not a path filter on the trigger: required checks then conclude as skipped, which GitHub counts as passed, instead of staying pending and blocking the merge;
- (a) a second runner is decided after (b), against measured memory.

## C. Adoption elsewhere

- A project in an active milestone keeps its pin and adopts v2.12.0 when that milestone ends.
- Projects on old pins keep `wf-status` off; re-adopting is their owners' choice.
- The adopting projects' feedback records close when a release carrying their fix is adopted.

## Plan review (27 October 2026)

One plan review, one round, Opus, verdict fail. Every finding about this repository was folded into the plan before the build:

| # | Severity | Finding | Change |
|---|---|---|---|
| 1 | blocking | P3 forbade the empty commit while a merge route may still count the first, failed "evidence missing" run, which would leave pull requests unmergeable there. | The empty commit stays as the fallback where a route counts superseded runs. |
| 2 | blocking | P8 let any change call itself a found task. | `found_from` must resolve to a finding recorded on the trusted branch for the milestone, used once; otherwise P8 is not built (it was not). |
| 3 | should-fix | P5(b) does not cover P4(c); a path-filtered workflow leaves required checks pending. | P5(c) added for records-only differences; P4(c) uses a job-level `if:`. |
| 4 | should-fix | A `pull_request` run tests a test-merge, not the head. | The hint checks the tested tree and the run's conclusion; a stale test-merge fixture. |
| 6 | should-fix | P6's endpoints are untested; self-marked parts could hide the budget. | Endpoint tests; `usage.js` uses the same contiguity check. |
| 7 | should-fix | Duplicates across P7's two forms are untested. | Both cases added. |
| 8 | note | Two workers would conflict on `wf next` and `SCHEMA.md`; P1 has no concurrency group. | One worker owned those edits and the other branched after it. `wf-status.yml` already has a workflow-level `concurrency: wf-status` group, so no change. |

Finding 5 concerned infrastructure outside this repository.
