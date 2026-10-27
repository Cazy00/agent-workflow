# Changelog

Releases are tags. From `v1.6.0` a release is tagged by `.github/workflows/release-tag.yml` when the owner merges the pull request that bumps `package.json`; review and owner approval precede every tag. A project adopts a release only by moving its pin, with `bin/wf-upgrade` from `v2.0.0`; a new tag never upgrades a project by itself. What a project must do when it moves to a release is under that release, and `bin/wf-upgrade` lists it from `upgrades.json`.

## Unreleased

Ships in the next release; nothing is pinned to it yet.
- Nothing yet.

## v2.12.0

MAINT-0023: what v2.11.1 measured in two adopting projects, and the cuts it found (`docs/proposals/MAINT-0023-measured-on-v2.11.1.md`; the owner approved building every proposal on 27 October 2026, including the two policy changes, P5(b) and P6). Every change is optional for an adopted project or takes effect only when it re-copies a template; none loosens a check.
- **P1, one status issue that heals itself** (`templates/github/wf-status.yml`). The publish step lists every open `wf-status` issue through the REST API with pagination, ignoring pull requests, edits the oldest and closes the others with a comment naming the one kept. It creates an issue only when a second lookup, a few seconds later, also finds none. In one project a single scheduled run got an empty answer while an issue was open, opened a second, and `--limit 1` then kept updating the newer one. Tests: `status-workflow.test.js`, the publish script against a stub `gh` with zero, one and two open issues, a failed lookup that writes nothing, and the listing's pagination.
- **P2, no scheduled status run on GitHub's own runner** (same template). The job's `if:` adds `github.event_name != 'schedule' || vars.WF_GATE == 'on'`, as `wf-client-page.yml` already does. Without a gate runner the status refreshes on pushes to the trusted branch and on manual runs; a skipped job uses no minutes and sends no failure email (a project whose account had run out of included minutes got about four emails a day from the scheduled run). A project with a gate runner keeps the six-hourly refresh. Test: `status-workflow.test.js` pins the condition and the header comment.
- **P3, the order of a pull request's evidence** (`procedures/execute.md`, `QUICKSTART.md`, `procedures/approval-evidence.md`, the `wf-ci.yml` header). Push the head, let its CI finish, then write the evidence into the description, which reruns `wf ci` on the same head. The first run on the push still fails ("evidence missing") and the rerun supersedes it, harmless where the merge route judges each check by its latest run. Where a route still counts superseded runs, an empty commit after the evidence stays as a fallback; the text says so. Tests: `ci-order.test.js` (the order, and the empty commit only as a fallback).
- **P5, the baseline result.**
  - (a) `baseline_result` accepts `pass: <reference>` beside `pass`; an empty reference is refused (`records.js`, readiness messages, `SCHEMA.md`).
  - (b) `wf next` (with `--check-runs`, or `--runs FILE`) prints the run a claim's baseline may name. When the baseline is a merge commit whose tree equals its merged pull request's head, the passing run of that head counts: `pass: <run reference> (head of #N)`, so a task can start with the baseline filled in instead of `pending`. The hint checks that the run concluded `success` and that the tree it tested equals the baseline's tree; a `pull_request` run tests a test-merge, so a run whose base is not already contained in the head is not named. Squash and rebase merges keep today's rule. The validator never inspected a run reference, so the gate itself is unchanged; the rule lives in `procedures/readiness.md` and the hint.
  - (c) A baseline may also name the latest passing run of an ancestor that differs from the baseline only under `docs/workflow/`; one code file in the difference ends the walk. This is what lets a records-only change reuse the last code commit's run.
  - Tests: `maint-0023-baseline.test.js` (both forms; equal and different trees; a failed, cancelled or unfinished run; a stale test-merge; squash fallback; records-only and code differences; no way to read the runs) and `maint-0020.test.js`.
- **P6, the milestone review in contiguous parts** (`acceptance-evidence.js`, `usage.js`, `next.js`, `templates/acceptance-evidence.json`). Under `review.cadence: milestone`, the acceptance evidence's milestone review may carry `review.parts`, a list of `{base, revision}` without a gap or overlap: the first `base` is the one at or before the milestone's authorisation, each later `base` is the previous `revision`, and the last `revision` is the reviewed revision. The deep paths and the rule that no code follows the review are checked over the union, and the one fix check follows the last part. `wf usage` counts several runs as one review only when they form such a set, by the same function the gate uses (`reviewPartsErrors`); a run merely marked as a part does not count. `wf next` warns once the milestone's diff from its authorisation to `HEAD` passes 700 KB, measured during the milestone, since there is no diff at planning. The template now documents `base`, `parts`, `deep_paths` and `fix_check`. Tests: `maint-0023-review-parts.test.js` (contiguous parts pass; a gap, an overlap, a first base that is not at or before the authorisation, a last revision that is not the reviewed one, a missing or misplaced fix check, extra runs that repeat or leave the chain, and a malformed list fail; deep paths over the union; parts read only under the milestone cadence; usage; the 700 KB warning).
- **P7, passing tests listed once** (`validator/lib/ci.js`, `evidence-skeleton.js`, `templates/delivery-evidence.json`). The record proposed recording only a link and counts, on the premise that `wf ci` judges the CI job's tests. It does not: it judges the tests in the evidence, and `evaluateAcceptance` requires every mapped test exactly once. So the check is kept and the format is smaller. The delivery evidence's `verification.execution` may be compact, `{revision, run, passed: {FILE: [NAME, ...]}, tests: [...]}`: the run reference once, every passing test once under its file, and full entries only for the rest. `wf ci` expands it before the checks, so each (file, name) is still required exactly once; a name listed twice, in both places, or as failed is refused, and the full form is still read. `wf evidence` writes the compact form; signed receipts keep the full form. **Measured** on the evidence of mateen-systems PR #118: 103.9 KB in the full form, 80.6 KB compact. Tests: `maint-0023-compact-tests.test.js`.
- **P9, `wf --help`** (`validator/cli.js`). `wf --help` and `wf <command> --help` print the usage and exit 0; the usage gains lines for `session`, `records`, `readiness`, `lifecycle` and `acceptance`; `wf session` names what it accepts (`--record PATH`; a missing, unreadable or non-JSON record is named). Tests: `cli.test.js`.
- **P10, `wf doctor` checks auto-merge against the rules** (`validator/lib/doctor.js`). A new warning level that never changes `ok` or the exit code. With `approval.auto_merge` on, it reads the trusted branch's rules and warns when they need a review count, a code-owner review, approval of the latest push or a merge queue that the agent's account cannot satisfy, or when the rules cannot be read. Bypass lists are not visible to the agent's account, so they are not used. Tests: `maint-0018-b.test.js` (a stubbed rule list).
- **P8 was not built.** It would have let a found task's record appear in the same pull request as its fix when its `found_from` names a finding. No review finding exists on the trusted branch before its fix: reviews and evidence live on pull requests, never in the repository. `found_from` would have nothing to resolve against, and without that check any change could call itself a found task. Feedback F-0005 stays open.
- **`bin/wf-adopt` no longer asks the owner to review everything in owner-merge mode** (already under "Unreleased", shipped here). Owner-merge has no code-owner review and nothing waits on one (`wf ci` says which pull requests the owner merges), yet the scaffold wrote `.github/CODEOWNERS` as `* @OWNER`, so GitHub asked the owner to review every pull request an agent opened: 22 requests in 2.5 days on one project. The line is now written as a comment, with the reason and the instruction to uncomment it, in a pull request merged on its own, before `wf-protect --target enforced --apply` (GitHub reads `CODEOWNERS` from the branch a pull request merges into, so the switch pull request must not be the one that restores it). The owner-merge checklist's step 9 says so, and `wf-protect --target enforced` already fails while the line is off. The task and feedback record lines stay. Manual and shared projects keep the line on, unchanged. An existing `CODEOWNERS` is still left alone. Tests: `adopt.test.js` shows owner-merge off (with a worker, and the step 9 text), manual and shared on; `protect.test.js` shows the enforced read-back fails on the commented line and passes once it is uncommented.

Words: `SCHEMA.md` 9,869 → 10,405, `QUICKSTART.md` 2,764 → 2,821, `procedures/readiness.md` 1,219 → 1,368, `procedures/execute.md` 2,317 → 2,400, `procedures/review.md` 2,100 → 2,163, `procedures/approval-evidence.md` 3,817 → 3,869, `procedures/accept-release.md` 990 → 993, `templates/acceptance-evidence.json` 367 → 508, `templates/delivery-evidence.json` 485 → 518, `templates/github/wf-status.yml` 625 → 808, `templates/github/wf-ci.yml` 1,122 → 1,179.

Reviews: the plan had one review (Opus), whose eight findings were folded in before the build: P8 resolves a found task only against a finding recorded on the trusted branch, P5(c) covers records-only changes, the `pull_request` test-merge is checked, the parts' endpoints and duplicates in the compact list are tested. The release had one deep review of its final head; the pull request records it and any fix check.

Moving a project to this pin: `upgrades.json`. Nothing is required: the new fields and the compact form are optional, and a project that does nothing keeps its behaviour, except that `wf doctor` may print a warning. To get the fixes, re-copy `templates/github/wf-status.yml` and `templates/github/wf-ci.yml` into `.github/workflows/` where unedited, set the repository variable `WF_GATE` to `on` where a gate runner should keep the scheduled status refresh, and write the evidence after the head's CI has finished. A task may record `baseline_result: pass: <reference>`, and `wf evidence` now writes the compact test list. One adopted earlier in owner-merge mode can comment out the owner line in `.github/CODEOWNERS` the same way, as a workflow change.

## v2.11.1

The status issue after an acceptance. In headless-lightroom (23 October 2026) the accepted M-0001 read "0 of 0 done · No tasks yet", though its edit history showed "6 of 6 done" until the prune, and it still waited for release authority although nothing is deployed.
- **An accepted or released milestone shows its tasks.** `wf prune` removes the Done task records after acceptance, and `wf status` counted only the records left. It now brings them back from Git history the way the client page does, through the same code (`recoverRemoved` in `validator/lib/client-history.js`, which the client page now calls as well): the tasks the milestone's plan names and every Done record that named it, so tasks found after authorisation count too. M-0001 of headless-lightroom reads "6 of 6 done · planned 3 · discovered 3", the figure it had before the prune.
  - A Git source reads history (the `wf-status` workflow's `--candidate "$GITHUB_SHA"`, on a full clone). A working tree has none and a shallow clone has nothing to read, so there the milestone reads "Accepted" with "No task records are kept for an accepted milestone", never "0 of 0". A history Git cannot read adds one warning on standard error. A task the plan names comes back only if its last record was Done and named this milestone or none, so a dropped draft is not counted and a task moved to a later milestone is counted there only.
- **"Release authority is next" waits for the owner only when something is to be released.** The milestone's `release_authority` declares it: text that starts with `None`, or has a sentence of its own such as `Nothing is deployed;` or `Nothing is released.`, means it releases nothing, and an Accepted milestone then raises no release item. Anything else keeps the item: an empty field, a sentence that goes on ("nothing is deployed by the agent", "nothing is deployed, except the migration") and one that holds only for a while ("until then nothing is released"), so a real release is never hidden. The records of headless-lightroom and mateen-systems already say so (mateen-systems showed five such items).
- **Tests:** `status-finished.test.js`: a pruned milestone's count from history (found tasks included, a kept record not counted twice, a never-Done or other milestone's record left out, the fallbacks, the CLI); no release item for a milestone declaring nothing to release; the item kept for one with a real release and for every wording that merely mentions deploying. The client page's tests pass unchanged.

Words: `SCHEMA.md` 9,774 → 9,869, `templates/milestone.md` 353 → 392.

Moving a project to this pin: `upgrades.json`. A project's status issue changes on its first `wf-status` run after the pin moves.

## v2.11.0

MAINT-0022: the review diet for projects (`docs/proposals/MAINT-0022-review-diet.md`; the owner's review diet of 22 October 2026). Three optional `review` keys, read from the trusted branch's config; without them v2.10.0 holds.
- **`review.cadence: milestone`**, in a pull-request mode with `acceptance_evidence`: one review per milestone.
  - A task needs no review while its milestone is Authorised or Active. Verification, integration and the acceptance tests' owner approval still apply.
  - The milestone gets one review of its whole diff, with a security focus on `review.deep_paths`. The acceptance evidence's milestone review names its `base`, at or before the milestone's authorisation in the trusted branch's history, and the deep globs the reviewed and fixed code reached (`deep_paths`).
  - One `fix_check` covers the fixes: every task not Done at the review's revision must be a found task fixing one of its findings. Code after it needs a new review or the owner.
  - A milestone that goes straight to Released carries the acceptance evidence too.
  - Before authorisation the plan gets one quick review, linked from the milestone record (`plan_review`), which readiness requires before a task starts.
  - `wf brief`, `wf next` (a budget of two runs per milestone, and the plan review for a Draft milestone) and `wf evidence` follow it.
- **`review.same_vendor: separate-session`**: a reviewer of the implementer's vendor counts when the evidence records a fresh session (`fresh_session: true`): a new process with none of the implementer's conversation. This covers the task review, its fix check and the milestone review.
- **`review.plan_command`** (one line with `{file}`) names the plan review's command. `review.reviewer_command` may name `{level}` alone, so a reviewer that takes levels can be the command.
- **Reviews:**
  - The plan had one quick review (Opus), which found one blocking problem: nothing checked that the milestone review covered the whole milestone. It also found seven should-fix items. All were taken before the build; the plan lists them.
  - The release had one deep review (Opus, receipt `rv227981d99071078c`) and a Codex second look. Both found that the milestone review's coverage rested on task records a later change can edit, and that a fix check could stand in for the review. The base is now anchored on the trusted branch's history, and the fix check's range holds only fixes. Opus also raised: release straight to Released, which the gate did not catch, and the plan review asked at later stages. All are fixed, each with a test. One fix check followed; the PR lists it.

Words: `review.md` 1,916 → 2,100, `readiness.md` 1,128 → 1,219, `accept-release.md` 967 → 990, `POLICY.md` 6,172 → 6,229, `SCHEMA.md` 9,388 → 9,774, `templates/milestone.md` 330 → 353.

Moving a project to this pin: `upgrades.json`. Nothing changes until the project sets one of the new keys, except that a milestone review naming equal `vendor` and `implementer_vendor` in the acceptance evidence is refused, as the policy already required.

## v2.10.0

MAINT-0021: review what needs it, once, by another vendor (`docs/proposals/MAINT-0021-review-policy.md`; the owner's review policy of 18 October 2026).
- **A test-only change needs no review** (level `none`). It applies when every production path is in a `test/`, `tests/` or `__tests__/` folder or is a test file, none is an acceptance test and none is deep. `wf ci` notes it, and still needs verification and integration evidence. `none` on any other change is refused.
- **Every level is reviewed by another vendor's model.**
  - There is no fallback to the implementer's own tool, in the procedure, the briefs or `wf doctor`: the next model of another vendor, or the review is missing and the gate stops.
  - The evidence may name `review.vendor` and `review.implementer_vendor`, and `wf ci` refuses them equal.
- **One review, on the final code.**
  - Light and standard changes get nothing after the fixes; each blocking fix comes with a test that failed first. The evidence keeps the earlier review and lists those tests in `review.fixes_after.tests`, and `wf ci` lets that review stand for the fixes.
  - Deep changes and the milestone get one fix check, only after a blocking finding, covering only the findings and the fix diff (fixed, half-fixed or fix broke); for a deep task it is recorded as `review.fix_check` of the candidate.
  - There is no round three.
- **`review.reviewer_command`** (optional) names one command for every level, with `{role}` (`cheap`, `standard`, `strong`, `fixcheck`, `milestone`) and `{level}` filled in.
  - `wf brief --lead` and `--acceptance` print it in place of the second model's launch.
  - `wf next` prints a review budget: one run per light or standard task, two per deep task, none for a test-only task, and two for the milestone.
  - Without it, `review.second_model` works as before.
- **Severity** (blocking, should fix, note) is defined in the procedure and the reviewer templates. Notes never start a round. A review reports at most ten findings, and "no findings" is a valid answer.
- **Reviews:** deep, by Codex (`gpt-6.1-sol`, high effort, passed explicitly) with a Gemini 4 Argon shadow review. Codex found two blocking problems: a backslash in a file name passed as a test path, and fixes after a light or standard review could never merge. It also raised three should-fix items: manual mode, `second_model` still required beside a command, and a sentence still asking semantic review of every test change. All five are fixed, each with a test; the PR lists them and the fix check.

Words: `SCHEMA.md` 9,107 → 9,272, `review.md` 1,509 → 1,821, `POLICY.md` 6,160 → 6,172, `templates/review.md` 253 → 336, `independent-reviewer.md` 772 → 870.

Moving a project to this pin: `upgrades.json`. Nothing changes until the project sets `review.reviewer_command`; a test-only change stops needing a review at once.

## v2.9.0

MAINT-0020, second part: the rest of what M-0005 of mateen-systems measured (record §§ 1–9), as the owner chose it (§ 10), with the owner's rule of 17 October for the second model.
- **`wf usage`** (P14). It reads the harnesses' own records, Claude Code's session transcript with its helpers and Codex's session logs. It prints, per agent, task and role: calls, cache reads, cache writes, writes after a wait with the call before each, peak context, model and effort.
  - With `usage.prices`, it adds an estimated list-price cost.
  - With `--milestone`, it adds the second-model runs used against the budget, warning before the milestone review's reserve. This is P5(a)'s count, moved from v2.8.0. A run counts as this project's by its folder: the repository, a worktree, or a `usage.folders` name. A run elsewhere is not counted, whatever its prompt names; the prompt is read only for a run with no folder.
  - `--outcome` prints a session outcome's `usage` block.
  - One reader per harness sits behind one contract (`usage-reader@1`, aggregated as `usage@1`). Launch names (`T-NNNN implementer`, `M-NNNN walker`, …) attribute each helper.
  - Run on M-0005's session, it reproduces the record's figures: 1,177 M cache reads, and 19.4 M helper writes after a wait. M-0005's two studies were made by hand.
  - It needs a full installation (`scripts/wf`); `bin/wf` extracts only the validator. No gate reads it.
- **Implement in slices** (P1). `wf brief --lead` splits a task into up to four slices by its acceptance IDs, or else by its scope. Each slice goes to a fresh implementing helper that ends at its checkpoint, given the record, the earlier checkpoints and the diff so far. A light task, or one with a single acceptance ID, is one slice. Helpers read each file once, by range, and `wf usage` flags an implementing helper past 350 K. In M-0005, four helpers grew to 571–814 K and held 37 % of the cache reads, and a quarter to a half of their reading re-read files.
- **A small coordinator** (P3). `wf brief --acceptance --milestone M` hands the acceptance package and its evidence (`M-NNNN acceptance`, the new `roles.acceptance`, Sonnet at medium), the milestone review (`reviewer`) and the trial walk (`walker`) to fresh helpers, and points the next milestone's draft to another (`plan`, the next free ID). `wf next` prints it at acceptance. M-0005's coordinator wrote the package and drafted M-0006 itself, and grew to 708 K with 13 rebuilds.
- **The final check on its own model** (the owner's rule of 17 October). `review.second_model.final_model` and `final_effort` serve the milestone review only; a task's review, at any level and with or without a fallback, is refused on `final_model`, and its fallback is the implementer's own tool. Briefs print the effort explicitly (Codex's `-c model_reasoning_effort=…`), because Codex defaults to low, and on 16 October reviews launched without it ran at low. The acceptance evidence's milestone review now names its model, or a fallback; a carried review keeps the model of the revision it reviewed. The settings page sets both fields.
- **The walk is the owner's trial** (P7).
  - The walker walks the address and build the owner is given (`trial_environment`), records what it walked and `first_load_seconds`, and uses its own demo accounts, or the data is reset after it (`walk_data`).
  - Each step names its scenario, and before the steps the walker tries each scenario from its outcome alone, as a newcomer (`unguided`: reached, or stuck with a note). A stuck scenario, or a first load over 5 s, goes in `deferred` for the owner.
  - The comparison is a consistency check. What keeps the walk off a development server is the profile's trial line and the walker's instructions.
  - A local production build counts when that is what the owner is given. No environment for the owner is a blocker for the plan's question.
  - In M-0005 the owner, starting cold, found what the guided walk could not (T-0037), on a development server that took 30 s to open.
- **Smaller:** `wf next`'s `wf brief --lead` and `--acceptance` keep the selected `--candidate`. A Draft found task takes a place in the allowance once any task's `accepted_findings` names its `found_from`, so P11's carriers stay within `found_tasks`; removing such a carrier, or changing its `milestone` or `found_from`, is the owner's merge until its milestone is accepted (the final check's A1).
- **Reviews:** each slice was reviewed as it landed, by Codex (`gpt-6.1-sol`, high effort, passed explicitly) or, out of quota, by a fresh Claude reviewer; a fresh Claude final review at max effort, then the owner's final check on Astra at high effort; both found findings, fixed and re-reviewed.

Corpus: 42,979 → 44,815 words; `SCHEMA.md` 8,102 → 9,107 (the new evidence and config fields), `accept-release.md` 775 → 967, `review.md` 1,413 → 1,509, `execute.md` 2,286 → 2,317, `readiness.md` unchanged. MAINT-0020 in all added 2,868 words, more than its estimate of 400–600, mostly in SCHEMA's reference text; IDEA-16 (the corpus keeps growing) has the follow-up.

Moving a project to this pin: `upgrades.json`. Finish an acceptance in progress first: its walk would need redoing.

## v2.8.0

MAINT-0020, first part: what M-0005 of mateen-systems (14–16 October) cost on v2.7.0, as measured twice (record §§ 1–9), with the owner's decisions of 16 October (§ 10). The rest (work in slices, a small coordinator, the trial walked on the owner's build, `wf usage`) is v2.9.0.
- **Waits end inside the prompt cache** (P12). One `wf wait` call returns after at most 270 s with `pending` (exit status 4) and the command to run again; `--timeout MINUTES` still asks for one longer wait. A waiting helper's five-minute cache had expired during 6–10 minute waits and its whole context was written again: 19.4 M tokens, about $97 of M-0005's $528, $50 of it in deliberate waits. The lead's brief says: no command waits longer than four and a half minutes, a longer test run goes to the background and is checked every four minutes, and `wf wait`, never a loop of the agent's own.
- **`wf wait --commit SHA`** (P10) waits for the trusted branch's required checks on a commit, the same way as `--pr`; the coordinator had written 24 loops of its own.
- **Tasks that can start together, start together** (P2). `wf next` lists the startable set: Ready, unclaimed tasks whose readiness passes and whose scopes overlap neither each other's nor a running task's, up to three running. Task leads run in the background. Planned Drafts of an Authorised or Active milestone count, as they are claimed on their own branch. A claim no longer waits for the trusted branch's CI (the owner's decision of 17 October, POLICY § task readiness): `baseline_result: pending: <run>` passes at implement, and readiness from verify on, `wf review-packet` and `wf ci` still require it filled (`wf wait --commit` at the claim). Six claims had waited 9–16 min each, and 17.4 h of the milestone ran under foreground leads.
- **A model and an effort for each role** (P4, `roles` in the config). Defaults: the lead Sonnet at low effort, paperwork Haiku at low, the walker Sonnet at medium, the implementer the session's model at the effort of the task's review level (light medium, standard high, deep xhigh). `wf brief --lead` prints them; a session outcome may record `models`, and `wf session` notes a difference. In M-0005, 46 of 51 helpers ran at the session's `xhigh`, though `execute.md` said effort follows the review level. Model values are the harness's own names: a project on another harness sets its own.
- **The second model's budget** (P5). `wf next` prints each running milestone's budget of second-model runs (two per deep task, one for the milestone review). After merging the trusted branch, a lead runs `wf ci` before any review: R-0067 re-reviewed a merge whose review carried over. A second-model review runs detached from the agent's process, so a session restart does not kill it.
- **`wf doctor` at planning, and where the session started** (P7(c), P9). `wf next` prints `wf doctor` when a Draft milestone is prepared for authorisation, so its gaps go in the plan's question; M-0005's staging gap was found 7 h 40 min after that question. Doctor reports a gap when the session did not start in the repository's root, where the project's agents and instructions are loaded.
- **Limits that count what matters** (P6, the owner's decision). A failing check in tests the task does not change, which passes on a rerun of the same revision, is a flake recorded with a found task, and does not use the task's attempts. A milestone's `found_tasks` (0–3) allows that many found tasks, each naming in `found_from` the milestone's own review finding or `trial` it fixes, without asking; the acceptance package lists them. The allowance counts the found tasks already begun (past Draft), whatever their IDs. Readiness refuses one beyond it or without `found_from`, and says to ask the owner. An explicit `tasks: []` makes every task of the milestone a found task. A flake's found task fits neither, so it goes to a later milestone or to the owner.
- **A blocking finding in code the pull request does not change** (P11, the owner's decision). Under `approval.defer_to_acceptance`, it keeps the agent's merge when the finding names `paths` the pull request does not change, `merge_increases_exposure: false`, and `carried_by`, a found task of the same milestone (not the task itself, and within its allowance) whose `found_from` names the finding, and the finding is in the task's `accepted_findings`. A blocking finding the task introduced, or one in its changed paths, still waits for the owner. #91 of mateen-systems waited for this.
- **An owed finding cannot be dropped quietly.** A change that edits or removes a task record that is Done on the trusted branch, in a milestone not yet accepted, is the owner's merge, judged by the trusted branch's copy; P11 had made an owed finding possibly blocking (reviews C3 and its fix review). A correction to such a record goes in the milestone's acceptance pull request.
- **Friction is written, not defaulted** (P13). The lead's skeleton and `templates/session.json` leave `friction` empty, and `wf session` refuses an empty one: all 13 of M-0005's outcomes had kept the pre-filled "none".
- **`wf prune --milestone M-NNNN`** (P8): removes an Accepted or Released milestone's Done task records in one records-only commit. It selects them by each task's own `milestone` field: three of M-0005's ten were not in its `tasks:` list. It keeps any record another record still names, and says which; `--dry-run` lists without committing. It never commits on the trusted branch, and checks that its commit holds only the removals. `wf ci` notes the Done records an accepted milestone left on the trusted branch, and `wf next` names the prune in the next milestone's authorisation, which the owner merges anyway. 34 such records sat on mateen-systems' `main`, and an ad hoc removal had been refused as irreversible deletion.
- **Not done, and why:** P5(a)'s count of second-model runs already used, with its warning before the milestone's reserve: `wf next` does not read merged pull requests, so the count moves to v2.9.0's `wf usage` (review X2). P15, a draft's pushes running only quick checks, was withdrawn: GitHub counts a skipped required check as passed, the hole v2.4.1 closed.

Corpus: 41,947 → 42,979 words; `execute.md` 2,174 → 2,286, `review.md` 1,329 → 1,413, `readiness.md` 1,114 → 1,128, `accept-release.md` 760 → 775.

Moving a project to this pin: `upgrades.json`.

## v2.7.0

MAINT-0018 Part B: the rest of what M-0004 of mateen-systems cost (record § 4).
- **Task leads get their brief from the records** (`wf brief --lead --task T-NNNN`). It says that a fresh helper implements, a new helper takes each fix round and a small one writes the closing paperwork; what the lead must not edit; the task's own records; and the commands with their revisions. In M-0004, seven of eight leads implemented their tasks themselves and grew to 400–635 K tokens. A lead's session outcome may say who implemented (`implementer`), and `wf session` notes a lead that did.
- **The trial walk comes after the milestone review and its fixes, in the background** (`accept-release.md`, `trial-walker.md`). The walker keeps its scripts, so a later walk reruns only the steps that changed. M-0004's first walk was voided by a later fix, and while it ran a blocking review result sat unread for 81 minutes. No new check: `wf ci` already refuses a walk of code that changed afterwards.
- **Putting a governing file back keeps the review** (`lib/carry.js`). A governing file restored to the trusted branch's content no longer voids the review, and `wf ci`'s owner reason for a governing change says the clarification can move to the milestone's acceptance pull request. #73 of mateen-systems waited 13 hours on such an edit.
- **A blocking finding states its exposure** (`delivery-evidence.js`, `review.md`, the review template and reviewer). Severity follows exposure. A residual with none left after a fix review is accepted and carried to a later milestone, without a second fix review or a question. M-0004's second fix review chased a gap the server already refused. The milestone template budgets two second-model runs per deep task and one for the milestone.
- **`wf doctor`:** checks node, git, `gh` (signed in as the agent's account, with push access), the second model's tool and the project's own `preflight` commands. Those come from the trusted branch's config and run without signing variables. `execute.md` puts every gap in the first question to the owner, and `wf next` lists `wf doctor` and the lead's brief first in every action that starts, readies or continues a task. M-0004's missing staging access was seen at 18:17 and reported at 04:44.
- **Commands for what agents wrote by hand:**
  - `wf wait --pr N [--merged]` works through `gh api` with any `gh` and follows the current head. It waits until every required check (and `wf ci`) has a finished run and two polls agree, ignores a cancelled run, and survives network errors;
  - `wf done --task T-NNNN --implemented SHA` writes the Done record;
  - `wf next` reports `next_ids`, the next free T, M, D and F IDs;
  - `wf evidence --json` prints the evidence alone.
- **Baselines from CI** (`readiness.md`): the trusted branch's own CI run on a task's exact baseline commit counts as its baseline run.
- **Not done, and why:** skipping `wf ci` on draft pull requests. GitHub counts a skipped required check as passed, the hole v2.4.1 closed, so a pull request marked ready could merge before the check ran again.

Moving a project to this pin: `upgrades.json`.

## v2.6.0

MAINT-0018 Part A: what M-0004 of mateen-systems (12–14 October) still cost, and which workflow version each piece of work ran under.
- **A task's Done record travels with its work.** `wf ci` accepted Done as a pull request's last commit only while the trusted branch held the task Ready or Active, but planned tasks wait there as Draft and are claimed on their own branch. So every task needed a Done pull request of its own (six in M-0004), each another round of checks and a wait before the next task. Now Done is accepted when the pull request itself claims the task: an earlier commit of its own sets it Ready or Active. A Draft marked Done without that claim still fails.
- **A workflow upgrade no longer voids a milestone's acceptance.** The acceptance evidence's review and walk now carry over the files `bin/wf-upgrade` writes (`docs/workflow/config.json`, where the pin is, `scripts/wf`, the installed `wf` workflows and agents) when a merge of the trusted branch brought them in, as delivery evidence already carried such a merge (`lib/carry.js`). M-0004's acceptance had to merge before the owner's upgrade, or need a new review and walk. Anything else from the trusted branch (the project's own code, its deploy workflows, other enforcement paths), or a workflow file the acceptance pull request changes itself, still needs them (the independent review, S1).
- **Test files are not deep by accident.** A `review.deep_paths` glob that matches by name anywhere (starting with `**`) reaches a test file only when it names tests; a glob anchored on a folder still reaches everything under it. Test files are recognised narrowly, by each language's convention, so a file in doubt stays deep: never a non-code spec such as an OpenAPI document, nor a production file like `test_mode.py` (the independent review's S5 and its fix review). mateen's `**/*{invoice,numbering,issuer}*` had made a test-only task take three deep second-model reviews.
- **The launcher is a template** (`templates/scripts/wf`), so `bin/wf-upgrade` refreshes it. It passes an explicit `--repo` on instead of doubling it, so `wf review-packet` can be pointed at a clean clone (mateen's F-0002, met in six tasks), and it passes `wf next` the newest release its installation knows (releases only, not pre-release tags), fetching tags at most daily, never prompting, and only reading a read-only installation (review S2, N2, N4).
- **Session outcomes:** the template has `limit` (mateen's F-0001), a missing outcome field says what it holds, and `wf session` needs `--task` only for verified-complete.
- **Workflow version stamps:**
  - `wf next` names the pinned version and its full revision, and a newer release when there is one;
  - a session outcome names the version it ran under (`workflow`), checked by `wf session`;
  - `wf ci`'s result and its workflow summary name the version that judged the change;
  - the review template and reviewer agent record it;
  - a milestone records the release it runs under (`workflow_version`): set when it is authorised, which `wf ci` requires; `wf records` refuses one in progress whose version is not the pin; `bin/wf-upgrade` moves milestones in progress with the pin, so the owner's merge of the upgrade is the decision; and that line alone stales no task.

Moving a project to this pin: `upgrades.json`.

## v2.5.1

What the owner's CI runners trust. The independent review of this release refuted its first draft, which said the gate trusted only accounts that can change workflow files:
- **The gate takes `wf ci` only for pull requests into the trusted branch** (`wf-ci.yml`'s `runs-on`; `wf-adopt` and `wf-upgrade` fill in the branch). The validator comes from the base branch's pin. Before this release, a pull request into any other branch could have the gate run a validator of that branch's choosing, with no workflow change and no merge.
- **What each runner trusts**, stated in `server/ci-runner/README.md`, `operate.md` *CI runners* and `wf-ci.yml`:
  - the build runner trusts any account that can push;
  - the gate trusts any account that can change workflow files or the trusted branch. In owner-merge and manual modes, only the workflow's rules stop any account with write access from merging, so there the gate is as trustworthy as every such account.
- **Runner labels are fixed in the workflow files, and the variables are only on/off switches** (found by the owner's home-server session). Any write collaborator can set an Actions variable. With v2.5.0's `WF_CI_RUNNER` naming the runner, an agent could have sent `wf ci` to the build container it controls. Now:
  - the gate is `wf-gate` and the build runner is `wf-build`;
  - `WF_GATE=on` and `CI_BUILD=on` only switch them on, and any other value sends the jobs to GitHub's runner;
  - `ci-runner register` derives each runner's label from its container (`register OWNER/REPO NAME...`) and refuses a mismatched one.
- **Every gate job's first step checks the branch name exactly** (second review). GitHub compares strings in expressions ignoring case, so a branch named `MAIN` passed the `runs-on` and `if:` guards. Before switching `WF_GATE` on, delete or update any branch carrying v2.5.0's `wf-ci.yml`, and turn on "Automatically delete head branches".
- **The agents' credential** is stated positively in the README: Contents and Pull requests only (or a classic `repo` token for a non-admin account); no workflow, variable or runner rights; no write keys; and the fork pull request setting kept off.
- **`ci-runner init` sets only the keys a profile lacks.** A host's own limits survive a re-run, a half-made profile is repaired, and a failed read stops it rather than overwriting a value. `usage` no longer prints a line of code.
- **The containers come back after a power cut** (found on the owner's home server). `ci-runner create` sets `boot.autostart` on each container itself, not only on its profile, because LXD's snap starts its daemon at boot only when an instance itself has it. `install-host.sh` also starts LXD's daemon at every boot. Re-running `create` on an existing container repairs it.
- **The README covers sizing and LXD updates:** sizing per project (6 + 1 GiB each) and protecting remote access from the out-of-memory killer. LXD updates reload the daemon without stopping running containers; a refresh window or a hold is still offered.

Moving a project to this pin: `upgrades.json`.

## v2.5.0

MAINT-0017 Part A: our own machines. On 13 October GitHub Actions stopped on the owner's account when its included minutes ran out, and no pull request could merge, because `wf ci` ran only on GitHub's runners.
- **A runner switch** (A1): every installed workflow job runs on `runs-on: ${{ vars.WF_CI_RUNNER || 'ubuntu-latest' }}`. A project's own CI uses `CI_RUNNER` the same way.
- **The owner's runners** (A2): `server/ci-runner/` sets up two containers per project with LXD, for private repositories only:
  - a build container: Docker, the project's tests and deploys;
  - a gate container: no Docker or sudo, and only the workflow's own jobs.

  Both are persistent, and any account that can push can run code on either one. Until each job gets a fresh container (D1), `wf ci` on the gate is only as trustworthy as those accounts, and jobs holding deployment secrets stay on GitHub's runner.
- **A private workflow repository** (A5): the installed workflows fetch the pin with the secret `WF_READ_TOKEN` when it is set. It should be a fine-grained token with access to that repository only and Contents: Read-only, also set as a Dependabot secret. Only the fetch step uses it, and any account that can push can read it.
- **The client page** (A4) rebuilds on the trusted branch, on pull request events, daily, and every 15 minutes with a gate runner. The dispatch on every push to every branch is gone.
- **`wf paths` reports `planning_only`** (A3).
- **Procedures:** `setup.md` step 6 and `operate.md` *CI runners*.

Moving a project to this pin: `upgrades.json`.

## v2.4.2

Closes the four minor findings of MAINT-0016's independent review (texts and the setup page; no gate changes):
- **`templates/review.md`** has a line for the review's level, which the reviewer agent is told to report.
- **`procedures/review.md` and `SCHEMA.md`** describe carry-over as the check does since the review's C1 fix: a path changed since the reviewed revision is a planning record, or one the pull request had not touched that now holds the trusted branch's content. SCHEMA had still described the earlier rule.
- **`SCHEMA.md`** says that only the finding part of an `accepted_findings` entry (after `/`) is matched; the review part is for the owner.
- **The setup page** labels `acceptance_evidence` by what it requires: the trial walk and the milestone review before acceptance.

Moving a project to this pin: nothing to do beyond moving it.

## v2.4.1

Names the client page workflow's jobs, so none can answer for a project's own required check. Found while moving mateen-systems to v2.4.0.
- The jobs were `build` and `deploy`. GitHub matches a required status check by the job's name and counts a job skipped by its condition as passed.
- So on every pull request, the client page's skipped `deploy` answered for the project's own required `deploy` check.
- Under auto-merge (v2.4.0), that could merge a change before the project's real deploy check finished.

Changes:
- **`templates/github/wf-client-page.yml`**: its jobs report as `client page dispatch`, `client page build` and `client page deploy`. A test keeps every job named.

Moving a project to this pin:
- If the client page is installed, `bin/wf-upgrade` refreshes `.github/workflows/wf-client-page.yml` (an enforcement-path change for the owner).
- A copy changed in the project takes the three `name:` lines by hand.

## v2.4.0

Lets the agent stop only for decisions, sizes review to the change, and has a milestone's trial walked in a browser before the owner tries it (MAINT-0016). In mateen-systems' M-0003, the owner:
- sent 41 messages, 29 of them "merged", "continue" or "what now";
- merged 13 pull requests unread;
- waited 7 h 25 min while the agent waited on CI with nothing needed from the owner;
- found in the trial what no check had.

Of 23 reviews, the first review of each large task and the milestone review found real problems; seven re-checks of a merged-in head found nothing.

- **`approval.auto_merge`** (owner-merge, checkpoint `milestone` or `plan`):
  - The agent turns on auto-merge for the pull requests `wf ci` leaves to it, and GitHub merges them once every required check passes.
  - The delivery evidence may give a required check as `enforced`, so it is posted without waiting for CI.
  - `wf-ci.yml` runs when auto-merge is turned on or off, and `wf ci` fails a pull request the owner merges that has it on. `bin/wf-protect --apply` allows auto-merge for such a project.
- **`approval.defer_to_acceptance`** (same checkpoints):
  - These wait for the milestone's acceptance instead of each waiting for the owner's merge: changes to acceptance tests, scenario changes from work found along the way, and accepted findings that are not blocking. `wf ci` reports them as `deferred`.
  - Each accepted finding is listed in its task record's `accepted_findings`.
  - The plan, requirements, workflow, blocking findings and the acceptance itself stay the owner's merge.
- **Review in proportion:**
  - `review.level` (`light`, `standard`, `deep`).
  - `config.review.second_model` (a reviewer from another model family, at no more than `max_effort`) and `config.review.deep_paths`.
  - A fallback when the second model is unavailable.
  - Review and verification carry over a merge of the trusted branch or a records commit (`lib/carry.js`).
- **The trial walk and the acceptance evidence:**
  - The `trial-walker` agent walks the owner's trial steps in a browser, in each language and screen size, before the owner is asked.
  - With `acceptance_evidence` (the default for new scaffolds), the pull request that accepts a milestone carries the milestone review, the walk and everything deferred (`templates/acceptance-evidence.json`), checked by `wf ci`.
- **`wf next`** reads `origin/<trusted branch>` when the local branch is behind it, and says so. **`wf evidence`** starts the delivery evidence.
- **Procedures:**
  - A task lead per task.
  - A fresh helper per fix round.
  - Effort by review level.
  - Parallel task leads for independent tasks.
  - Defaults instead of questions when fix rounds run out.
  - One rerun and a found task for an unreliable check.

Corpus: 35,133 words before, 37,410 after; `procedures/execute.md` 1,838 → 2,088 words, `procedures/review.md` 931 → 1,138, `procedures/accept-release.md` 520 → 665.

Moving a project to this pin:
- `bin/wf-upgrade` refreshes `.github/workflows/wf-ci.yml` (an enforcement change for the owner) and adds `.claude/agents/trial-walker.md`.
- The new settings are opt-in, chosen with `bin/wf-setup`:
  - with auto-merge, rerun `bin/wf-protect --apply` and replace `AGENTS.md`'s merge sentence with the new scaffold's;
  - to require the acceptance evidence, set `acceptance_evidence`.

## v2.3.1

Stops the client page workflow from deploying from a pull-request run (MAINT-0015). In v2.3.0 a merged pull request's `closed` run went to the build and deploy jobs, and GitHub Pages refused the deploy (environment protection), so every merge left a failed run, while the merge's own push to the trusted branch had already rebuilt the page.

- **`templates/github/wf-client-page.yml`**: a pull-request run only dispatches a rebuild on the trusted branch, and a merged pull request does nothing; build and deploy run only for pushes, dispatches and the schedule on the trusted branch. Pull-request runs never join the trusted build's concurrency group.
- A test now evaluates the template's job conditions and concurrency for each GitHub event.

Moving a project to this pin:
- If the client page is installed, `bin/wf-upgrade` refreshes `.github/workflows/wf-client-page.yml` (an enforcement-path change for the owner); a copy changed in the project is merged by hand from `templates/github/wf-client-page.yml` with `__TRUSTED_BRANCH__` replaced.

## v2.3.0

Lets the client page show the whole plan and keep up with the work within minutes (MAINT-0014). Before this, the page showed only the milestones on the trusted branch and changed only when work was merged: a part being built all day read as not started, the steps after the current milestone were nowhere, and a signed-off stage listed nothing it delivered.

- **`client.plan`** names a plan file of phases and steps in the client's words, each step naming the milestones that carry it out (or `done: true` for work before the records). The page leads with Now, Waiting on you and Recently done, then every phase and step with its state (Done, In progress, Next, Later) and its parts; a milestone the plan does not place still shows, marked added, with a warning.
- **Finished parts stay**: a removed task record is read from the last commit that had it, and a part's done date from the first commit on the trusted branch (its first-parent history, so a merge commit dates what it merged) where it read Done. The tasks directory's history is read in one pass, so a page over a few hundred records builds in seconds, not minutes.
- **`wf status --client --live`** adds the parts moving on remote branches, and `--pull-requests` marks those with an open pull request *Being checked*. Only parts, and only those the trusted branch allows: a branch speaks for a part whose trusted record is Draft or Ready (state and wording) or Active (wording, and *Being checked* with an open non-draft pull request), or that the trusted branch lacks; never one the trusted branch has Blocked or Done.
- **`templates/github/wf-client-page.yml`** rebuilds on any push or pull request change and deploys from the trusted branch only. It therefore runs on every push to any branch, which uses GitHub Actions minutes on private repositories.

Moving a project to this pin:
- Nothing changes without `client.plan`, except that a signed-off stage lists its parts.
- To use it, write the plan file in the client's language, set `client.plan`, and, if the client page is installed, let `bin/wf-upgrade` refresh `.github/workflows/wf-client-page.yml` (an enforcement-path change for the owner); a copy changed in the project is merged by hand from `templates/github/wf-client-page.yml` with `__TRUSTED_BRANCH__` replaced. Every pull request that adds a milestone then places it in a step.

## v2.2.0

Lets the client page speak the client's words for every stage, not only for each part (MAINT-0013). Before this, a stage showed its milestone's own title, outcome and measure, which are written for the team (technical, with spec references, in the team's language), so a client page in the client's language still showed them in the team's.

- **A milestone's `client_title`, `client_outcome` and `client_measure`** replace its title, outcome and measure on the client page, field by field; a field left out or empty shows the record's own, as before. The headline names the stage by its `client_title` too.
- **The profile's `client_measure`** replaces its `measure` as the goal the page shows first.
- The milestone and profile templates carry the new fields, empty.

Moving a project to this pin:
- Nothing changes until a milestone or the profile gives a `client_` field. Adding one is a change to a governing record, so it goes to the owner as any other.

## v2.1.0

Lets owner-approved acceptance tests be approved before the work and fail until it is done, in every mode (MAINT-0012). Before this, every mapped test had to pass on every production pull request, so tests written ahead of the work blocked every other task until all of them passed.

- **Pending scenarios,** in a project whose config names `paths.acceptance_tests` (so the owner approves its acceptance tests): while a milestone is `Authorised`, `Active` or `Blocked`, the mapped tests of a scenario it lists may fail as long as a task of that milestone serving the scenario is neither `Done` nor delivered by the candidate. Each must still be reported once, with any result. Every other mapped test must run once and pass, including a scenario's tests in the pull request that marks its last task `Done`.
- **Only the owner widens it:** a test is pending only when the approved baseline's records and the candidate's both say so (and, in `closeout`, the trusted tip's), so a candidate can only make the gate stricter. For a scenario with a test (mapped, or an `automated` definition awaiting one), a change whose task records make it wait for a task it did not wait for (a new or reopened task, or one given the scenario), or that completes it with no test run (a change with no production content, or a scenario with no mapped test), goes to the owner in owner-merge mode; fails `wf ci` in enforced mode unless the record of the milestone concerned, classified governing, changes too; and in manual mode needs the round's explicit baseline receipt, unless the round changes that governing milestone record under its governing-change. A scenario that becomes tested while it waits names every task it waits for to the owner. Unmapped inspection, human and operational scenarios, and projects that name no acceptance tests, are unaffected.
- **`wf pending`** checks the candidate's map as `wf ci` does, then reports the task it takes as delivered (`--task`, or the task `--branch` names), the mapped tests that may fail and the `required` rest, so a project's acceptance job can stay a required check and fail on any required test.
- `wf ci`, `wf acceptance` and `wf lifecycle` name each pending test that did not pass in a note. `wf brief`, with `--baseline` and a round end, lists one for judgement at a revision a task of the round names as `implemented`, as closeout gates that task, and asks for the explicit `baseline` payload the round then needs, since no derived baseline rests on failing evidence. `wf attest` and derived baselines excuse none: a check's exit status cannot tell a pending failure from another.

Moving a project to this pin:
- Nothing changes in a project whose config names no `paths.acceptance_tests`.
- Otherwise, the mapped tests of a scenario an in-progress milestone still waits on (an open task serving it, other than the pull request's) may fail from then on, including tests that pass today: check the map for such scenarios first.
- For scenarios with a test (mapped, or `automated` awaiting one), task-record changes that add a waiting task or complete a scenario without a test run now go to the owner (owner-merge), need a milestone record change (enforced) or an explicit baseline receipt (manual). Mark a task `Done` in the pull request that delivers it to avoid this.
- To approve tests ahead of the work, authorise the milestone, then add the tests in its first task (`readiness.md`), and run them in a required job that fails on any test `wf pending` lists as required.

## v2.0.0

Removes what no project used, and lets an upgrade clean up after older releases.

- **Removed:** central reporting and the runtime ledger (`wf report`, `wf runtime`, `wf prepare-evidence`, `procedures/operations.md`), agent-operated routine merges in enforced mode (`delegation.routine`, `--pull-request`), and local batches (`delivery.batching`, `--tasks`). An owner-merge checkpoint now lets the agent merge, and one pull request carries one task. The config keys nothing reads any more (`delegation`, `delivery`, `execution`, `setup_budget_days`) are no longer written; a config that still switches the routine lane or batches on is refused with a message saying so.
- **Added `bin/wf-upgrade`:** it moves a project's pin and removes what the releases in between left behind: the config keys and files listed in `upgrades.json`, the workflow files the scaffold installed (refreshed where the project has not changed them), and the steps each release leaves to the owner, listed. It reports first, writes only with `--apply`, refuses to overwrite uncommitted edits, runs the new release's `wf records`, and never commits. Removing the unread keys does not stale any task's readiness.
- **Restructured:** this changelog holds the release history the README used to; `procedures/execute.md` is shorter; `procedures/delivery.md` keeps only its CI advice.

Moving a project to this pin: run `bin/wf-upgrade --project PATH` from an up-to-date workflow checkout, review its report, then `--apply` and open a pull request. If the project used central reporting, delete its external operations config and runtime directory too.

## v1.14.0

Makes setup a choice of where the agent stops rather than of approval machinery, and keeps the quality gates the same in every mode. A single owner now adopts in owner-merge mode with a checkpoint (`approval.checkpoint`): `milestone` by default (the agent merges each task's pull request once the gates pass, and stops when a milestone is finished until the owner accepts it), `change` (the owner merges every pull request) or `plan` (no stop between the milestones the owner authorised); the setup page asks this first and keeps signed receipts under *Stricter proof*. In enforced and owner-merge modes `wf ci` now requires the agent's delivery evidence for a production change, read from the pull request description, and checks it as manual mode checks receipts (required checks passed, every mapped test run once, a separate-context review with every finding dealt with); in owner-merge mode it also reports who merges and why, and changes to governing paths, the workflow or acceptance tests always go to the owner. The owner's setup checklist lists only what they must do (with one account and owner-merge, nothing) and keeps the rest under *Optional*, which `wf status` does not count; the agent's setup takes two sessions; personal account references are gone from the policy. Before moving an enforced or owner-merge project to this pin: its production pull requests fail `wf ci` until they carry the evidence block, so replace its `.github/workflows/wf-ci.yml` with the new template (a workflow change), which reads the description and reruns when it is edited; an owner-merge project from `v1.11.0` to `v1.13.0` keeps the owner merging every pull request until its config gains a checkpoint (the owner then accepts a milestone by merging the pull request that sets it Accepted, which `wf ci` always leaves to the owner), and its `AGENTS.md` forbids the agent to merge until it takes the new scaffold's sentence.

## v1.13.0

Adds `bin/wf-setup`, a local page for setup and later changes: it asks four questions in plain words and runs the scaffold, working out the rest itself, then edits only what an owner decides (approval, accounts, the project's name and measure, the client page's title, language and hidden stages) and lets the owner tick their setup steps, each a short title with its instructions folded away; the agent's settings and the client theme are kept as they are, every save is validated first, and the config and profile labels stay in sync; it writes only the workflow files, never commits, pushes or approves, and accepts only its own page's requests (127.0.0.1, a token for the run, its own Host); a shared project is adopted with the command line.

## v1.12.0

Adds a page for clients: `wf status --client` renders the records as one plain-language, self-contained HTML page (what is being worked on now, what comes next, what waits on a decision, and every stage with its parts and their state, in plain words; no IDs, people or reasons) to send as a file, or to publish on GitHub Pages with the workflow `wf-adopt --client-page` installs, which is public even for a private repository. It follows the client's design system (`client.theme`: colours, fonts, logo, radius, embedded) and language (`client.language`: English, or Arabic right-to-left).

## v1.11.0

Makes setup lighter without dropping an agent step: one GitHub account is an approved arrangement, `owner-merge` is a third approval mode for one account or no rulesets (the owner's own merge is the approval, stated as unproven), `bin/wf-protect` applies and reads back the protections in one command and replaces the disposable-repository test as the default evidence before enforced mode, `bin/wf-sign` makes the key and signs rounds, the scaffold writes `CODEOWNERS` and the `wf ci` workflow, central reporting leaves the default checklist, `wf next` works before the scaffold is committed, and `claude/T-0001-…` branches name their task. A single-owner manual-mode project moving its pin should know that `wf-protect --apply` turns auto-merge off, while its `AGENTS.md` from an earlier scaffold still tells the agent to turn it on: replace that sentence with the new scaffold's (a governing change).

## v1.10.1

Keeps sessions short without the owner restarting them between tasks: inside a signing round the coordinator hands each task to a fresh helper agent and keeps only its result; at a signing round a new session starts, never one carried over by `/compact`, whose summary no gate checks; and new projects' `CLAUDE.md` carries a *Compact Instructions* section that asks every compaction to keep the task's IDs, commits, decisions and open items, and tells the agent to recheck `wf next` and git afterwards. Claude Code does not always follow such instructions after compacting, which is why the recheck matters. Existing projects copy `templates/claude/compact-instructions.md` into their own `CLAUDE.md` (a governing change); the scaffold says so when one already exists. In enforced mode the owner still reviews each pull request. The evidence is in `docs/proposals/sources/compact-reliability.md`.

## v1.10.0

Arranges the workflow around how an agent works rather than how a team of people works: `wf next` works out the next action from the records, so a session reads what that action needs and carries no milestone history; owner-approved acceptance tests (`paths.acceptance_tests`) need the owner's receipt for every change, so the agent that writes the code cannot also rewrite the tests that judge it; in manual mode `wf attest` lets the owner's machine run the checks in a sandbox and write the verification the owner signs; and review prefers a reviewer from another model family, with a reproduction for each blocking finding. All of it is opt-in for an existing project: nothing changes until its config names `paths.acceptance_tests` or `attest`, both workflow changes the owner signs; new projects get `paths.acceptance_tests` by default.

## v1.9.0

Cuts manual-mode signing rounds while keeping every stage and protected-path receipt: unsigned dry runs that exit 3, opt-in derived baselines, optional one round per milestone, `wf closeout` after signing and `wf brief` for the owner; it also checks acceptance files with the records, flags a trusted branch that moved past approval, and keeps reviewers in the foreground. Before moving a project's pin to it, run its `wf records`: malformed acceptance files (IDs outside `AC-NNN-N`, duplicates, unknown methods, missing requirement or test files, mappings to undefined IDs) now fail `wf records` and every `wf ci`.

## v1.8.0

Read-only setup inspection, bounded local batches, opt-in agent-operated routine integration, explicit pre-merge gates, fresh-context review packets and exact-revision delivery checks.

## v1.7.0

Coherent task grouping, bounded coordination and repeated checks, quality-aware measurements, and an optional experimental Spec Kit planning adapter under existing approval controls.

## v1.6.2

A required test can be renamed through an exact old/new mapping pair approved in the baseline.

## v1.6.1

Setup records, for a single owner, the repository settings that let records-only pull requests merge by themselves.

## v1.6.0

Fewer round trips: a task marked Done in its own pull request, pin moves no longer stale readiness, releases tagged on merge.

## v1.5.0

A status view that is easier to read: counts, tables, a diagram of blocking decisions, details folded away.

## v1.4.2

A baseline without `tests/acceptance-map.json` requires no mappings, so a project moving its pin can add the map.

## v1.4.1

Readiness no longer blocks a task on a superseded decision reached only through a feature, milestone or path effect.

## v1.4.0

## v1.3.0

## v1.2.0

## v1.1.0

## v1.0.0

PrintFlow ran it until it moved to `v1.4.1` on 2026-09-26.
