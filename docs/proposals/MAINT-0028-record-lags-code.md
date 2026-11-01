# Maintenance — MAINT-0028: a task whose record lags its code passes the milestone review check

Separate owner authorisation: the owner's backlog item B42 (Cazy00/workspace `docs/backlog.md`), found 31 October 2026 at headless-lightroom M-0006's acceptance (#104, pinned v2.13.0); assigned to this session by the coordinator on 1 November 2026.
Workflow version and immutable revision: v2.16.0, `6559dd7` (main).
Selected report IDs: one, B42 (no feedback record).
Start, limit: 1 November 2026, one session; spend capped by the coordinator; usage not measured.

## Classification counts
Workflow defect: 1 (a false block: a reviewed task fails `wf ci` because its record was marked Done after the review). Others: 0.

## Cost observed
Under `review.cadence: milestone` with a fix check, `onlyReviewErrors` (`validator/lib/acceptance-evidence.js`) accepts a task of the milestone only when its record says `Done` at the review's revision or its `found_from` names a review finding. In M-0006 a task's code was merged, and read by the milestone review, before its record was marked `Done` in a later commit (its live run waited for the review). The acceptance pull request failed `wf ci`; the broker's `github-merge` refuses a pull request with a failed check, so the owner could not merge past it either. M-0006 got through with one more review part and no fix check.

## Rule (the fix)
A task that was not `Done` at the review's revision and fixes no finding also passes when the records show its code was delivered before the review. Every one of these must hold:

1. **It was planned before the review.** The task's record exists at the review's revision with a status other than `Draft`.
2. **It names its delivered revision.** Among the versions of the record the check reads (at the fix check's revision and in the change), at least one is `Done`, and every `Done` one names the same `implemented`, a full commit hash. `implemented` already exists: the candidate a Done task's receipts name (`closeout.js`).
3. **The review read that revision.** `implemented` resolves in this pull request's history, is the review's revision or an ancestor of it, and is not the review's base (the first part's base with `parts`) nor an ancestor of it: the code sits inside `base..revision`. A hash that is not a commit, a commit on a side branch, a commit after the review, or the base or one of its ancestors fails. A commit made on a branch before the authorisation but merged inside `base..revision` passes; the review's diff holds it.
4. **None of its code came after the review.** The task has a non-empty `scope`. No production or generated path changed between the review's revision and the fix check's revision lies in its scope (the union of its `scope` at the review's revision, the fix check's revision and the change), unless that path also lies, at the fix check's revision, in the `scope` of another task the fix check stands for: past `Draft`, not `Done` at the review's revision, a finding in `found_from` in every version read (deep review B1, S1). Scope is matched by the one helper readiness uses (`scope.js` `inTaskScope`, deep review S2). This is what stops a record from naming an early, reviewed commit while the task's real code landed after the review: wf ci's readiness check already keeps a task's changed production paths inside its scope (`readiness.js`).

The failure message says which of these failed. It suggests setting `implemented` only when it is missing; an `implemented` after the review is told that its code needs the review or must fix a finding, never to name an earlier commit (plan review F2).

Rule 3 assumes task pull requests merge with merge commits, as Harbor's merge route does: a squash or rebase merge leaves `implemented` out of history, and the task still fails as before. SCHEMA and the message say so (plan review F3).

## What this does not weaken
- A task whose code the review never read still fails: its delivered revision comes after the review (3), or its scope's code changed after the review (4).
- The fix check still stands only for fixes of findings; trial-found tasks (`found_from: trial`) are unchanged.
- Code after the fix check still fails `covers()`; no round three.
- As with the existing rule, the check judges the records' completeness and binding to Git history, not their truth (the file's header). The residual: a forger who controls the records can still name a fix task whose scope covers the late code; the existing rule had the same exposure through `found_from`. The scope is read at three snapshots (the review's revision, the fix check's, the change), so a scope widened and narrowed again between them is missed; readiness checked each pull request against its own version (plan review F5).

## Option not taken
B42's other option, `wf ci` requiring a task's delivery pull request to mark its record `Done` in the same merge, was not taken: tasks are delivered in several pull requests (M-0006's T-0055 had part 1 in its own PR), a task's Done can rightly wait for a run after the review, and it fixes only future histories, not a lagging one already merged.

## Left out
B42's related detail: `fix_check.revision` must descend from the review's revision, and a fix check run on a head that does not descend from it had to be named through a later merge commit with the same code. It does not fall out of this change; it stays open in B42.

## Fixtures
`validator/test/maint-0028.test.js`: the M-0006 shape (code reviewed, record `Done` with `implemented` after the review) passes; a task whose code came after the review fails (implemented after the review; implemented forged to an early commit while its scope's code changed after the review); a hash that is not a commit, a side-branch commit and a commit before the base fail; no `implemented`, no scope, or Draft at the review fails; a late path in a fix task's scope passes; with `parts` the first part's base bounds it. Code after the review in both its scope and a fix task's still fails on its delivered revision (plan review F4). The MAINT-0022 fixtures stand unchanged.

On M-0006's own history (headless-lightroom, plan review F1): the task the old check failed was T-0062 (`found_from: trial`), Active at the review's revision 249a2c3, marked Done in 97cb026 with `implemented` a806531, an ancestor of 249a2c3 and not of the base 673f38d; its scope lies inside the finding-fixing T-0063's. T-0062 passed rule 4 through that fix scope, so the case did not exercise rule 4's failure; the fixtures do. Replaying (by hand, not committed: it reads another repository) the acceptance evidence's check on that history with the fix check at #108's merge, the old code reports T-0062 and the new code passes it.

## Ships as
A patch release, v2.16.1 (`CHANGELOG.md`: a release is the merge of the pull request that bumps `package.json`). Nothing is required to move the pin. No project's pin changes here.

## Recommendation
Implementation and fixtures; one sentence in `SCHEMA.md` and `procedures/review.md`, and a clause in `procedures/execute.md` where `implemented` is defined (plan review F6).

## Plan review
`codereview plan`, claude:opus, verdict pass, 1 November 2026: F1 (check M-0006's real history) done above; F2 (do not push agents to rewrite `implemented`) taken in the messages; F3 (squash merges) documented; F4 fixture added; F5 noted in the residual; F6 clause added.

## Deep review
`codereview attest --level deep`, claude:opus, receipt `rv5c8b00851a4a22a6`, verdict fail at `06256fd`: B1 (a Draft or pre-review finding task's scope excused late code) and S1 (the judged task's own scope did) fixed, fix scopes now come only from tasks the fix check stands for; S2 (a second scope matcher) fixed, one shared `inTaskScope`; N1 wording aligned here; N2 a merged-branch fixture added and the replay marked as by hand.

## Size (words; `procedures/maintenance.md`)
| | before | after |
|---|---|---|
| POLICY | 6229 | 6229 |
| SCHEMA | 11529 | 11657 |
| QUICKSTART | 2997 | 2997 |
| skill | 321 | 321 |
| `execute.md` | 2622 | 2645 |
| `review.md` | 2163 | 2191 |

Both procedures stay inside a session's three to four thousand words.
