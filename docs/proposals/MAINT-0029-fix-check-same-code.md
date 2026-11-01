# Maintenance — MAINT-0029: a fix check run on a head that does not descend from the milestone review

Separate owner authorisation: the owner's backlog item B44 (Cazy00/workspace `docs/backlog.md`), found 31 October 2026 at headless-lightroom M-0006's acceptance, left out of B42's fix (MAINT-0028, v2.16.1); assigned to this session by the coordinator on 1 November 2026.
Workflow version and immutable revision: v2.16.1, `c992c47` (main).
Selected report IDs: one, B44 (no feedback record).
Start, limit: 1 November 2026, one session; spend capped by the coordinator.

## Cost observed
Under `review.cadence: milestone`, `onlyReviewErrors` (`validator/lib/acceptance-evidence.js`) refuses a `review.fix_check.revision` that is not a descendant of the review's `revision`. At M-0006 the fix check ran on a head H whose history did not hold the review's revision R (the fixes were branched from a commit before R; R's line differed from H's only in records). The evidence could not name H, the head the fix check actually read; it had to name a later merge commit M of H and R's line, with the same code, and say so in prose.

## Rule (the fix)
`fix_check.revision` F still passes as today when it descends from R (F ≠ R). It also passes when it does not descend from R and every one of these holds:

1. **Not before the review.** F is not an ancestor of R (a fix check cannot fix findings of a review that came after it).
2. **The review is in the change.** R is the candidate (the pull request's head being checked) or an ancestor of it.
3. **Same code as the checked head.** No production or generated path differs between F's tree and the candidate's tree: the classes MAINT-0028 reads for code after the review (`classifyPaths`, categories `production` and `generated`). Records-only differences are ignored; one changed code line fails.
4. **The review's line after the fork holds records only** (deep review S1). No production or generated path differs between R and the merge base of R and F (`git merge-base`; one is taken where there are several). Otherwise code the review read could be dropped at the merge, and the drop would never be in the diff the fix check was given (merge-base..F).
5. Unchanged and still applied: `covers()` of F, so F is in the pull request's history and no code (its broader class: everything but planning and governing, acceptance tests included) changed after it.

When rules 1–4 pass it, `wf ci` prints a note naming the rule: `note: acceptance evidence: the milestone review's fix check revision F does not descend from the review's revision R; it passes because its production code equals the checked head's (MAINT-0029)`. `acceptanceEvidenceErrors` takes an optional `notes` array for this; its return value stays a list of errors. When neither rule holds, the error names both.

Everything downstream keeps reading F: the deep paths (base..F), MAINT-0028's late paths (R..F) and the records at F. The diffs are tree diffs (`git diff-tree A B`), so they do not need F to descend from R; with F's production code equal to the candidate's, which descends from R, R..F's production paths are R..candidate's. The records (plan review F1): which tasks were `Done` at the review is read at R itself, never at F; the task versions judged are F's together with the baseline's and the change's records, so a record only R's line holds is still read; the scopes of the tasks the fix check stands for are read at F, the head the fix check read, which is where its fix tasks' records live. The M-0006 test puts a task's `Done` on R's records commit only, so F holds it as `Active`.

**Order** (plan review F2). Ancestry was always a proxy: descending from R proves F's commit was made after R's, not that the fix check ran after the review. What ties the fix check to the review is outside the commit graph and unchanged: the fix check's receipt is taken `--of` the review's receipt, and MAINT-0028's rule makes every task not `Done` at R cite one of the review's findings (`found_from`) or show its code was delivered before the review. Rule 1 refuses only what the graph can prove wrong.

**Rule 3 and `covers()`** (plan review F3). `covers()` is a tree comparison too (`candidate.changedPaths(F)`), in a broader class, so in this history it also refuses what rule 3 refuses. Rule 3 stays as the rule's own statement, in MAINT-0028's production classes, so the rule does not depend on how `covers()` is written and its failure says which rule failed; a difference only `covers()` reads (a test, an acceptance test) fails there with its own message, and the note is printed only when `covers()` of F passes too.

Callers (plan review F6): `wf ci` (`validator/lib/ci.js`) is the only caller and passes `notes`.

## What this does not weaken
- Any code difference between F and the head still fails (rule 3, then `covers()`), so no code reaches the head that the fix check did not read.
- A fix check before the review, or a review outside the change, still fails.
- No round three; the fix check still stands only for fixes of findings (MAINT-0028 unchanged).

## Tests (`validator/test/maint-0029.test.js`, the MAINT-0028 fixture style)
- The M-0006 shape: fixes branched before R, R a records-only commit (a task marked `Done` there), H merged with R's line into the head; the evidence names H: passes, and the note names the rule. Naming the merge commit still passes by the old rule, with no note.
- The same with one changed code line in the merge: fails, naming the path; a generated-only difference fails the same way; a test-only difference fails in `covers()`, with no note.
- The old descending case still passes, with no note; F an ancestor of R, F equal to R, and R outside the pull request's history still fail (plan review F4, F5).

## Release
A patch, v2.16.2 (a false block lifted, nothing to do to move the pin), as v2.16.1 was: `CHANGELOG.md`, `package.json`, `upgrades.json`, SCHEMA's fix-check sentence. No project's pin changes.
