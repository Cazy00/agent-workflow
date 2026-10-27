# MAINT-0022: the review diet for projects — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task by
> task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a project can choose the owner's review diet of 22 October 2026:
- `review.cadence: milestone`: tasks need no review; the milestone gets one review of its whole
  diff, with a security focus on `review.deep_paths`, one fix check after findings, no round three;
- `review.same_vendor: separate-session`: a reviewer of the implementer's vendor counts when the
  evidence records that it ran as a fresh session;
- under the milestone cadence, a milestone's plan gets one quick review before its tasks start.

A project that sets none of the new keys keeps v2.10.0's rules exactly: every new evidence field
is read only under the new keys. The release is v2.11.0.

**Plan review** (`codereview plan`, Opus, 22 October 2026): one blocking and seven should-fix
findings, all taken; the dispositions are at the end of this plan.

**Architecture:** three optional config keys, read from the trusted branch's config as every
review key is (`ci.js`, `readiness.js` load the baseline's):
- **`wf ci`, a task's change:** under the milestone cadence, while the task's milestone is
  Authorised or Active on the trusted branch, the review is optional, as for a test-only change
  today (`reviewOptional`), and the deep-path level check is skipped when no review is given.
- **`wf ci`, the acceptance change:** under the milestone cadence the milestone review records its
  `base`, which must come at or before every task's start, so it reviewed the whole milestone diff;
  it lists the `deep_paths` globs that diff reaches, its security focus; and it may carry one
  `fix_check`, whose revision then covers the code changed after the review.
- **Vendor:** equal vendors pass only with `same_vendor: separate-session` and a recorded fresh
  session, in the delivery evidence, its fix check and the acceptance evidence.
- **Readiness:** under the milestone cadence, a task's milestone on the trusted branch needs
  `plan_review`, the https link to its plan's review.
- **Briefs, `wf next`:** print the plan review, no task review, and the milestone's budget.
- **Text:** `procedures/review.md`, `readiness.md`, `accept-release.md`, `POLICY.md`, `SCHEMA.md`,
  the milestone template.

**Tech Stack:** Node ≥ 22, ES modules, `node --test`, no dependencies.

**Spec:** the owner's review diet, approved 22 October 2026 ("Approved: build the review diet as
planned in #146 …"), section 7 for projects. This repository stays self-contained: the rule is
written here in full; `docs/proposals/MAINT-0022-review-diet.md` (Task 6) records the evidence and
the approval. The owner's earlier words that started it: "let's try and adopt and see how it's
going to work out."

## Global Constraints

- **`review.cadence`:** `task` (the default, v2.10.0) or `milestone`. `milestone` holds only in the
  pull-request modes (`approval.label` `enforced` or `owner-merge`) with `acceptance_evidence:
  true`, so `wf ci` checks the one review; config load refuses it otherwise:
  `review.cadence milestone needs a pull-request mode (approval label enforced or owner-merge) and acceptance_evidence: true, so wf ci checks the milestone's one review`.
- **`review.same_vendor`:** `never` (the default, v2.10.0) or `separate-session`.
- **`review.plan_command`:** optional, one line of at most 300 printable characters containing
  `{file}`; printed for the plan review with `{file}` the milestone record's path. Example (a
  project whose reviewer is Harbor's codereview):
  `codereview plan --file {file} --author-vendor anthropic --project <project>`.
- **`review.reviewer_command`** now needs `{role}` **or** `{level}` (v2.10.0: `{role}`), so a
  command that takes levels, such as `codereview run --level {level} …`, can be the reviewer.
  Every v2.10.0 value stays valid. `{level}` is already the review's own word in v2.10.0
  (`reviewerCommand`): `light`, `standard`, `deep`, `fixcheck` for a fix check and `milestone` for
  the milestone review, the words codereview's `--level` takes.
- **What `reviewOptional` skips** (`evidenceErrors`): only the `review` block, when it is absent
  or names level `none`. Verification, integration, the required checks, the tasks, the
  acceptance-test owner approval (`ci.js`, outside `evidenceErrors`) and the deferred lists are
  checked as before. The semantic review that `review.md` asks for an acceptance-test or mapping
  change is, under the milestone cadence, the milestone review's, which reviews the whole diff.
- **The milestone review under the cadence** (acceptance evidence `review`):
  - `base`: a full hash, an ancestor of `review.revision`, and an ancestor of (or equal to) the
    `start_revision` of every task of the milestone that has one (trusted and candidate records);
    so `base..revision` holds every task's code. Error: `the milestone review's base X comes after
    T-NNNN's start_revision Y: under review.cadence milestone it reviews the whole milestone diff,
    from a base at or before every task's start`.
  - `deep_paths`: every glob of the config's `review.deep_paths` that a production path of
    `base..revision` matches. Error: `the milestone review's deep_paths must list the review.deep_paths
    the milestone changed, its security focus: <globs>`.
  - `fix_check`, optional: `{ revision, reviewer, model, report, vendor?, fresh_session? }`.
    `revision` (not `candidate` as in the task evidence's fix check), because every revision in the
    acceptance evidence is named `revision`. It must be in the candidate's history (`covers`) and
    come after `review.revision`; `covers(fix_check.revision)` replaces `covers(review.revision)`.
  Under the task cadence none of these three is read, and `covers(review.revision)` holds as in
  v2.10.0.
- **A fresh session**, the record same-vendor needs: `review.context.fresh_session: true` (task
  evidence), `review.fix_check.fresh_session: true`, and in the acceptance evidence
  `review.fresh_session: true` and `review.fix_check.fresh_session: true`. It states that the
  reviewer ran as a new process started for the review (for example `claude -p`), with none of the
  implementer's conversation: not a subagent of the implementer's session, not resumed or forked.
  A non-boolean value is refused. It is agent-attested like all evidence: checked for presence,
  not truth.
- **The vendor rule:** given together and equal (trimmed, any case), `vendor` and
  `implementer_vendor` are refused, unless `same_vendor` is `separate-session` and the matching
  `fresh_session` is `true`. Absent vendors are not checked (as v2.10.0).
- **Budget under the milestone cadence:** two runs per milestone (its review and one fix check),
  none per task; the plan review runs before authorisation and is not in the authorised
  milestone's budget.
- **No round three:** one `fix_check` object, never a list. Code after the fix check's revision
  fails `covers`, as code after an uncovered review does today.

## Review Focus

1. **A candidate cannot choose its own cadence.** `ci.js` and `readiness.js` read the baseline's
   config. Pinned by `MAINT-0022: a candidate that sets cadence milestone still needs its review`.
2. **Defaults unchanged.** With no new key, a task change with no review still fails, equal
   vendors with `fresh_session` still fail, and an acceptance evidence `fix_check` does not cover
   code after the milestone review. Pinned by `MAINT-0022: without the new keys v2.10.0 holds`.
3. **The one review is of the whole milestone** (plan review F1). A milestone review whose `base`
   comes after an earlier task's start fails. Pinned by `MAINT-0022: the milestone review covers
   every task from its start`.
4. **The cadence waives a task's review only inside a live milestone** (F2): its milestone on the
   trusted branch Authorised or Active. Pinned by `MAINT-0022: no waiver outside an authorised
   milestone`.
5. **Only the review is waived** (F3): an acceptance-test change under the cadence still goes to
   the owner or to `deferred`, as before. Pinned by `MAINT-0022: an acceptance-test change keeps
   its owner approval under the cadence`.
6. **Deep paths keep their focus** (F4): a milestone diff that reaches a deep glob needs it in the
   review's `deep_paths`. Pinned by `MAINT-0022: the milestone review names the deep paths it
   reached`.
7. **Cadence milestone without its check.** Config with cadence milestone but no
   `acceptance_evidence`, or in manual mode, is refused at load. Pinned in `config-keys.test.js`.
8. **The fix check covers only what follows the review** (F6). A `fix_check.revision` that is not
   after `review.revision`, or not in the candidate's history (a side branch), or followed by code,
   fails. Pinned by `MAINT-0022: the milestone's fix check covers the fixes, and nothing after it`.
9. **Same vendor without a fresh session** fails under `separate-session`, in task evidence, its
   fix check and the acceptance evidence. Pinned by `MAINT-0022: same vendor needs a fresh
   session`.
10. **Readiness reads `plan_review` from the trusted branch**, not the candidate. Pinned by
   `MAINT-0022: the plan review is read from the trusted branch`.

---

### Task 1: The config keys

**Files:**
- Modify: `validator/lib/records.js` (`validateReviewConfig`, `loadConfig`, milestone fields)
- Test: `validator/test/config-keys.test.js`

**Interfaces:**
- Produces: `review` keys `second_model, deep_paths, reviewer_command, cadence, same_vendor,
  plan_command`; refusals:
  - `review.cadence must be task or milestone`
  - `review.same_vendor must be never or separate-session`
  - `review.plan_command must be one line of at most 300 characters containing {file}`
  - `review.reviewer_command must be one line of at most 300 characters containing {role} or {level}`
  - the cadence refusal in Global Constraints.
- Milestone record: `plan_review`, when present and non-empty, an https URL, else
  `plan_review must be the https link to the review of the milestone's plan (procedures/readiness.md)`.

- [ ] **Step 1: Write the failing tests** in `config-keys.test.js`: each refusal above; a good
  config with all three keys loads; a `reviewer_command` with only `{level}` loads.
- [ ] **Step 2: Run** `node --test validator/test/config-keys.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** in `records.js`.
- [ ] **Step 4: Run the whole suite** (`npm test 2>&1 | tail -5`). Expected: `# fail 0` after
  updating the existing message test for the key list.
- [ ] **Step 5: Commit** `MAINT-0022: review.cadence, review.same_vendor and review.plan_command`.

### Task 2: No task review under the milestone cadence

**Files:**
- Modify: `validator/lib/ci.js` (the `covered` block)
- Create: `validator/test/maint-0022.test.js`

**Interfaces:**
- `const cadence = config.review?.cadence === 'milestone' && ['Authorised', 'Active'].includes(<the
  task's milestone status on the baseline>)` (baseline config and records).
- `evidenceErrors({ …, reviewOptional: testOnly || cadence })`.
- `reviewLevelErrors` runs only when a review with a level other than `none` is given, or when
  the cadence is `task`.
- A note: `note: review.cadence milestone: no task review is needed; the milestone review covers this change (procedures/review.md)`, and, when deep paths changed,
  `…; its security focus includes the deep paths changed here: <paths>`.
- A review given anyway is checked as given (as today).

- [ ] **Step 1: Write the failing tests** in `maint-0022.test.js` (helpers from
  `./helpers/maint-0018.js`, as `maint-0021.test.js`):
  - `MAINT-0022: under cadence milestone a task merges with no review`: product code and a deep
    path, evidence without review, and with `{ level: 'none' }`: status 0, the note.
  - `MAINT-0022: a candidate that sets cadence milestone still needs its review`: the candidate's
    config sets it, the baseline's does not: status 1, `independent review evidence is missing`.
  - `MAINT-0022: without the new keys v2.10.0 holds`: product code, no review: status 1.
  - `MAINT-0022: no waiver outside an authorised milestone`: cadence milestone, the task's
    milestone Accepted on the baseline: `independent review evidence is missing`.
  - `MAINT-0022: an acceptance-test change keeps its owner approval under the cadence`: with
    `paths.acceptance_tests` and `defer_to_acceptance`, a change to one is still in `deferred`.
- [ ] **Step 2: Run** `node --test validator/test/maint-0022.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** in `ci.js`.
- [ ] **Step 4: Run the whole suite.** Expected: `# fail 0`.
- [ ] **Step 5: Commit** `MAINT-0022: under review.cadence milestone a task needs no review`.

### Task 3: Same vendor from a fresh session

**Files:**
- Modify: `validator/lib/delivery-evidence.js` (`evidenceErrors`, `fixedAfterError`)
- Modify: `validator/lib/ci.js` (pass `sameVendor`)
- Test: `validator/test/delivery-evidence.test.js`, `validator/test/maint-0022.test.js`

**Interfaces:**
- `evidenceErrors({ …, sameVendor = 'never' })`, `fixedAfterError({ …, sameVendor = 'never' })`.
- Errors: `review context fresh_session must be true or false when given`; with equal vendors
  under `separate-session` and no fresh session: `the reviewer is of the implementer's vendor:
  review.same_vendor separate-session accepts that only with review.context.fresh_session true, a
  new session with none of the implementer's conversation (procedures/review.md)`; the fix check's
  likewise with `review.fix_check.fresh_session`. Under `never` the v2.10.0 messages stay.

- [ ] **Step 1: Write the failing tests:** unit cases for both functions (never: equal refused,
  fresh_session or not; separate-session: equal with fresh_session passes, without it refused;
  a string fresh_session refused) and `MAINT-0022: same vendor needs a fresh session` through
  `wf ci`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the whole suite.** Expected: `# fail 0`.
- [ ] **Step 5: Commit** `MAINT-0022: review.same_vendor separate-session accepts a fresh session of the implementer's vendor`.

### Task 4: The milestone's one review, its fix check and its plan review

**Files:**
- Modify: `validator/lib/acceptance-evidence.js` (the review block; vendor; `fix_check`)
- Modify: `validator/lib/readiness.js` (`plan_review` under the milestone cadence)
- Test: `validator/test/maint-0022.test.js`, `validator/test/acceptance-evidence.test.js`

**Interfaces:**
- `acceptanceEvidenceErrors` reads the cadence and `same_vendor` from `config` (the baseline's).
- Acceptance evidence `review`, optional new fields at any cadence: `vendor`, `implementer_vendor`
  (non-empty text when given), `fresh_session` (boolean); the vendor rule of Global Constraints.
- Under the milestone cadence only: `base` and `deep_paths` (required), `fix_check` (optional), as
  Global Constraints says. With `fix_check`:
  - `review.revision` must be in the candidate's history (`isAncestor`) and an ancestor of
    `fix_check.revision` other than it (`candidate.atRevision(fix).isAncestor(review)`);
  - `covers(fix_check.revision)` replaces `covers(review.revision)`; `covers` also refuses a
    revision outside the candidate's history (a side branch);
  - `reviewer`, `model` non-empty, `report` https; its vendor checked as the review's.
  - The deep globs are computed on `candidate.atRevision(review.revision).changedPaths(base)`,
    production paths only, with `deepChanges` per glob.
- Readiness: with the baseline's cadence `milestone`, a task whose milestone on the baseline has no
  `plan_review` fails: `milestone M-NNNN has no plan_review: with review.cadence milestone its plan
  gets one quick review before its tasks start (procedures/readiness.md)`.

- [ ] **Step 1: Write the failing tests:**
  - `MAINT-0022: the milestone's fix check covers the fixes, and nothing after it`: review at R1,
    a fix commit R2 (code), `fix_check` at R2, accepted candidate R2 plus a records commit: pass;
    a further code commit after R2: fail; a `fix_check.revision` not after R1: fail; one on a side
    branch: fail.
  - `MAINT-0022: the milestone review covers every task from its start`: two tasks with
    `start_revision` S1 < S2; `base` S1: pass; `base` S2: fail naming the first task; no `base`:
    fail.
  - `MAINT-0022: the milestone review names the deep paths it reached`: a deep glob matched in
    `base..revision`, missing from `deep_paths`: fail; listed: pass.
  - The no-new-keys part of `MAINT-0022: without the new keys v2.10.0 holds`: `fix_check` given,
    code after the review: the v2.10.0 `covers` error.
  - `MAINT-0022: same vendor needs a fresh session` (acceptance part).
  - `MAINT-0022: the plan review is read from the trusted branch`: cadence milestone, milestone
    without `plan_review` on the baseline, the candidate adds it: readiness fails; on the baseline:
    passes. Cadence task: no `plan_review` needed.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the whole suite.** Expected: `# fail 0`.
- [ ] **Step 5: Commit** `MAINT-0022: the milestone review's fix check, vendors and plan review`.

### Task 5: Briefs, `wf next` and the budget

**Files:**
- Modify: `validator/lib/roles.js` (`planReviewCommand(config, file)`)
- Modify: `validator/lib/lead-brief.js`, `validator/lib/acceptance-brief.js`, `validator/lib/next.js`,
  `validator/lib/evidence-skeleton.js` (under the cadence, `review: { level: 'none' }` with a note)
- Test: `validator/test/maint-0022.test.js`

**Interfaces:**
- `planReviewCommand(config, file) -> string | null`: `plan_command` with `{file}` substituted,
  null without it.
- `wf brief --lead`, cadence milestone: the review bullet is `no task review (review.cadence
  milestone): the milestone review covers this task (procedures/review.md)`, in place of the
  reviewer-command and second-model bullets.
- `wf brief --acceptance`, cadence milestone: the reviewer line adds `the milestone's one review
  (review.cadence milestone: its tasks had none), with a security focus on review.deep_paths
  (<globs>), reviewed as deep; after findings, one fix check, recorded as review.fix_check; no
  round three`.
- `wf next`, a Draft milestone under cadence milestone: a run line for the plan review, with the
  plan command or, without one, "by a reviewer as procedures/review.md *Who reviews* says, given the
  milestone record and its Draft task records"; "post it on the plan's pull request and put its link
  in plan_review".
- `secondModelBudget`: cadence milestone returns `{ milestone, cadence: 'milestone', runs: 2 }`
  for each authorised milestone, whether or not a reviewer key is set; printed
  `M-NNNN: review budget: 2 runs (review.cadence milestone: none per task; the milestone review and its one fix check)`.

- [ ] **Step 1: Write the failing tests** (`MAINT-0022: briefs and budget under cadence
  milestone`; `MAINT-0022: wf next asks for the plan review of a Draft milestone`; and
  `MAINT-0022: a level-only reviewer command`, whose deep brief prints `--level deep` and
  `--level fixcheck`, and whose acceptance brief prints `--level milestone`).
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the whole suite.** Expected: `# fail 0`.
- [ ] **Step 5: Commit** `MAINT-0022: briefs, wf next and the budget follow review.cadence`.

### Task 6: The rule in the procedures, policy, schema and templates; record and release

**Files:**
- Modify: `procedures/review.md` (one paragraph, *Cadence*, including that the milestone review
  is the semantic review of acceptance-test changes under it; the *Who reviews* vendor sentence)
- Modify: `procedures/readiness.md` (one sentence: the plan review)
- Modify: `procedures/accept-release.md` (one clause: the fix check in the evidence)
- Modify: `POLICY.md` (*Independent review*: the same-vendor exception; the review cadence)
- Modify: `SCHEMA.md` (the three keys, `plan_review`, the evidence fields, readiness, budget)
- Modify: `templates/milestone.md` (`plan_review:`)
- Create: `docs/proposals/MAINT-0022-review-diet.md`; add this plan as `MAINT-0022-plan.md`
- Modify: `CHANGELOG.md`, `upgrades.json`, `package.json` (2.11.0)

- [ ] **Step 1: Write the text.** Keep `review.md` under 2,100 words (the session budget is three
  to four thousand words with the brief); record the corpus words before and after.
- [ ] **Step 2: The record:** the evidence (Harbor's 22 October count: 69 answered reviewer calls on
  37 changes, about four with serious findings, all in root, merge-gate or money code; a client
  project's rounds from MAINT-0021), the owner's approval, the controls this weakens (task reviews,
  other-vendor independence) and what to watch (escaped bugs in code merged without a review; the
  30-day check on 22 November 2026).
- [ ] **Step 3: Upgrade notes:** "Nothing changes until the project sets `review.cadence`,
  `review.same_vendor` or `review.plan_command`. To adopt the diet: cadence milestone needs
  `acceptance_evidence: true`; an authorised milestone needs `plan_review` before its next task
  starts, added in the pull request that sets the cadence."
- [ ] **Step 4: Run the whole suite** and `node validator/cli.js --help >/dev/null`.
- [ ] **Step 5: Commit** `v2.11.0: MAINT-0022, the review diet for projects`.
- [ ] **Step 6: Review and release.** The validator is a gate: one deep review on the final head
  (`codereview attest --level deep`); one fix check only after findings; the merge tags the
  release, so it waits for the owner's approval (`github-merge`, a tap).
  - **Who reviews this change** (plan review F8): this repository's merges pass the owner's merge
    gate, whose review rule the owner set on 22 October 2026 (the review diet, Harbor's rule 5):
    Opus first, a reviewer of the author's vendor accepted from a separate session (the reviewer
    account runs a fresh `claude -p` with no tools and none of the author's conversation), Codex an
    optional second opinion. That approval covers this change; it is the owner's rule for agent code,
    not this release's project option reviewing itself. The PR records the reviewer, its vendor and
    the fresh session, and asks Codex for a second look while its quota allows.

## Plan review dispositions

The plan review (`codereview plan`, `claude:opus`, verdict fail, 22 October 2026):

| Finding | Severity | Disposition |
|---|---|---|
| F1: nothing checks that the milestone review covers the whole milestone | blocking | Taken: `review.base` at or before every task's `start_revision` (Global Constraints, Task 4, Review Focus 3; the deep review later anchored it on history, see the record). |
| F2: the waiver applies to tasks outside a live milestone | should fix | Taken: only while the task's milestone is Authorised or Active on the trusted branch (Task 2, Review Focus 4). |
| F3: what `reviewOptional` skips | should fix | Taken: only the `review` block; listed in Global Constraints; the acceptance-test owner approval is pinned (Review Focus 5); `review.md` says the milestone review is the semantic review. |
| F4: deep paths lose their gate | should fix | Taken: `review.deep_paths` must list the deep globs the milestone diff reaches (Review Focus 6). A list rather than `level: deep`, because it names what the reviewer was told to focus on. |
| F5: `fix_check` naming; relaxing `covers` for default projects | should fix | Taken in part: `fix_check` is read only under the milestone cadence, so defaults stay exactly (Review Focus 2). Kept `revision`, the acceptance evidence's word for every revision. |
| F6: a fix check on a side branch | should fix | Taken: stated, and tested (Task 4). |
| F7: `{level}` for the fix check and the milestone | should fix | Taken: `{level}` is `fixcheck` and `milestone` (v2.10.0's `reviewerCommand`), codereview's own level words; a level-only command is tested (Task 5). |
| F8: same-vendor review of this change | should fix | Taken: the owner's 22 October rule for agent code is cited (Task 6, Step 6); Codex asked for a second look. |
