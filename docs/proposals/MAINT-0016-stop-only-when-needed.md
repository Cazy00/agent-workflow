# MAINT-0016: Stop only when needed, review in proportion, walk the trial first

**Status:** proposal for the owner's approval, 12 October 2026. Implementation plan: `docs/proposals/MAINT-0016-plan.md`.

**Classification** (`procedures/maintenance.md`): improvement proposal. Two parts change who approves what in owner-merge mode, which is the owner's policy decision: A1 (the agent's own pull requests merge themselves) and A3 (some approvals wait for the milestone's acceptance). Both are opt-in project settings, so nothing changes for a project until its owner turns them on. The rest changes procedures, templates and the validator within existing authority.

**Owner's words (12 October 2026):**
- "It requires my intervention a lot. So it actually stops and asks me to merge again and again and again." "I'm not reviewing anything. I'm just blindly approving." "It only stops when it finishes or when there is something that blocks it from continuing and it requires my attention or input."
- On Playwright: "at the end when we are finishing a milestone and before we just give it to the owner … it's actually seeing it and actually interacting with the user interface … as if it's a real user."
- On review: "We want review, but also we don't want it to happen excessively … if we have changed a button, we should not check the whole application … later on at the end when we finish a very big chunk of work, we could run one big review with maybe one big model." "Codex might not be available always … Sol 6.1 maybe would do the trick … Astra is a no-no." "There is no issue to actually spawn a Claude agent to review." "We could actually check the availability of Codex or set it up before the user starts working on a project."
- "We don't want to record those new ideas, we want to implement them."

---

## 1. What happened in M-0003 (a client project, 10–11 October 2026)

Measured from the three session transcripts ("Continue working" and the two sessions it started) and the repository's pull requests.

| Measure | M-0003 |
|---|---|
| Owner messages | 41, of which 29 were "merged", "continue", "what now", or a pasted out-of-date banner or CI failure |
| Pull requests the owner had to merge | 13 (#42, #44, #49, #51, #54–#62); #42 twice, after a flaky test |
| Time the work sat waiting for the owner | 12 h 40 min; 7 h 25 min of it while the agent waited on CI with nothing needed from the owner (one overnight stop: 4 h 50 min) |
| Questions asked of the owner | 10; five about leftover review notes once fix rounds ran out |
| Model calls / cached tokens | 2,571 calls; 1.14 billion cache reads, 24.8 million cache writes, 2.5 million output tokens |
| API-equivalent cost (Opus 5.5 list prices) | about $475, 78 % of it in implementer helpers; plus Codex |
| Agent context per call | coordinator median 537 K tokens (never refreshed in 32 h); helpers reused for fix rounds grew to 900 K–964 K |
| Reviews | 23 (R-0020–R-0042), all Codex `gpt-6.1-sol` high |
| CI runs | at least 200, about 100 of them the client-page workflow |

What the reviews caught:

| Kind of review | Count | Result |
|---|---|---|
| First review of a large task (T-0008–T-0011) | 4 | Real problems every time (5–14 findings) |
| First review of a small task (T-0014, T-0018) | 2 | Nothing |
| Milestone review (R-0040) | 1 | One blocking defect after every task review had passed |
| Review of a fix | 9 | The first usually found real leftovers; later rounds only test-helper notes |
| Re-check of a new head (records edit, merge of main, CI fix) | 7 | Nothing in its own pull request |

The owner's acceptance trial found what no check had: the trial steps were wrong (paste mode, the name of the ⋯ menu) and staging lacked the sections the steps needed. M-0003 already had 56 scripted Playwright tests; nobody had walked the trial.

## 2. Why

1. **Waiting for CI ends the turn.** The delivery evidence must cite every required check as passed with a link (`delivery-evidence.js`), so the agent cannot finish a pull request before CI does. The agent may merge only "once every required check has passed", and auto-merge is forbidden in owner-merge mode (`AGENTS.md`, POLICY). The Claude desktop app tells the agent not to poll CI, and its CI monitor wakes a session only on failures. So the agent ends its turn and asks the owner to say "continue".
2. **`merge: owner` fires for bookkeeping.** `ci.js` sends to the owner: any accepted review finding, whatever its severity; any change to acceptance tests; a records change that completes or extends a scenario; any governing record. In M-0003 that was 11 merges beyond authorise and accept, which the owner approved unread.
3. **The earlier fix did not apply here.** IDEA-18 (v1.6) ended bookkeeping round trips with auto-merge and un-owned task records, which only the enforced arrangement can use; owner-merge projects are told "never turn on auto-merge".
4. **Review is all-or-nothing and tied to the exact head.** Every task got the same full Codex review. A review covers only its exact commit, so a merge of main or a one-line records edit needed another (`ci.js` via `evidenceErrors`), although the procedure itself only asks to revalidate review at the assembled candidate (`review.md`).
5. **Nobody walks the trial before the owner.** Acceptance asks for scenarios and evidence, not a walk through the owner's own steps on a ready environment.

Two smaller defects: `wf next` reads the local trusted branch, which `git fetch` never moves, so it named a stale next action (found in the stale-line session); and every delivery evidence block is assembled by hand from CI job links.

## 3. The changes

Each change names the failure it prevents and the check that catches a recurrence (`procedures/maintenance.md`).

### Part A: the agent stops only for decisions

**A1. The agent's pull requests merge themselves** (`approval.auto_merge: true`, owner-merge with checkpoint `milestone` or `plan`).
- When `wf ci` reports `merge: agent`, the agent turns on GitHub auto-merge as it finishes the pull request and moves on. GitHub merges once every required check passes. `bin/wf-protect --apply` allows auto-merge for such a project and requires the checks on an up-to-date branch, as today.
- Guard: `wf-ci.yml` also runs when auto-merge is turned on or off, and `wf ci` fails a pull request that has auto-merge on when it leaves the merge to the owner, or when the project has not chosen auto-merge. A failing required check stops GitHub merging it.
- Limit, stated as owner-merge's other limits are: the guard stops an owner pull request merging while its checks still run; nothing in owner-merge mode stops an agent that merges by hand against the rule (`approval-evidence.md`).
- Prevents: the turn ending to wait for CI, and the "say continue" round trip. Check: `checkpoints.test.js` (guard), `protect.test.js` (setting), the `wf-ci.yml` template test (events).

**A2. Evidence without waiting for CI.** With `approval.auto_merge`, the delivery evidence may give a required check the result `enforced`: GitHub requires it before any merge (`bin/wf-protect`). The agent posts the evidence as soon as its own checks and the review are done. At least one check the agent ran must be listed as `passed` in `verification`.
- Prevents: waiting for CI links before the evidence. Check: `delivery-evidence.test.js`.

**A3. Approvals the owner gives at acceptance** (`approval.defer_to_acceptance: true`, same checkpoints).
- `wf ci` reports these as `deferred`, not `owner_reasons`, and the agent merges:
  - a change to acceptance tests (removing a mapped test already fails the gate, `acceptance.js`);
  - a records change that makes a scenario wait for a found task, or completes one;
  - a review finding accepted rather than fixed, unless its severity is `blocking` (or `critical`/`high`).
- Each accepted finding the agent merges must be listed in its task record's `accepted_findings` (`R-0030/N1`). Done task records stay until the milestone is accepted, so they are on the trusted branch when the acceptance pull request lists them.
- Still the owner's, unchanged: the plan and requirements (governing paths), the records the owner approves (milestones, decisions, profile, acceptance definitions, config), the workflow (enforcement paths), a blocking finding accepted rather than fixed, a task in a milestone held for an earlier acceptance, and the acceptance itself.
- Prevents: ten of M-0003's thirteen owner merges. Check: `checkpoints.test.js`.

**A4. Done in the task's own pull request.** `wf ci` adds a note when a production pull request with complete evidence leaves its task Active, saying a separate Done record would need a pull request of its own. Prevents #50 and #56. Check: `checkpoints.test.js`.

**A5. Defaults instead of questions** (procedure, `execute.md`):
- **Fix limit reached:** when only non-blocking findings remain, accept them with a resolution and `accepted_findings`, and carry on.
- **Merges:** a `merge: agent` pull request is merged (by auto-merge), not handed to the owner out of caution.
- **Governing edits:** clarifications that nothing waits on are batched into the acceptance pull request.
- **Flaky checks:** a required check that fails on a change that cannot cause it is rerun once; if it then passes, record a found task for it and carry on. The owner is never asked to merge again.
- Prevents: five of the ten questions, #49 and #60, and the second merge of #42. No check can judge these; the procedure text is the carrier.

### Part B: review in proportion

**B1. The review policy is configuration** (`review` in `docs/workflow/config.json`):

```json
"review": {
  "second_model": { "tool": "codex", "model": "gpt-6.1-sol", "max_effort": "high" },
  "deep_paths": ["apps/server/src/auth/**", "**/migrations/**"]
}
```

- `second_model`: a reviewer from another model family. Use it for deep reviews and the milestone review, at no more than `max_effort`. Leave it out, or set it to null, and every review is a fresh reviewer of the implementer's own tool.
- `deep_paths`: changes that always need a deep review.
- `bin/wf-setup` finds whether Codex is installed and signed in, and asks.

**B2. Three review levels**, set in the evidence's `review.level`:

| Level | For | Reviewer | Looks at |
|---|---|---|---|
| `light` | copy, styling, one component, test-only fixes, records | fresh reviewer of the implementer's tool, low or medium effort | the change and what directly uses it |
| `standard` (default) | a feature inside one area | fresh reviewer, high effort | the change, its callers, the records for that area |
| `deep` | permissions, money, migrations, sign-in, deleting data, `deep_paths` | the second model if available, otherwise the implementer's tool at its highest effort with a security focus | the change and the code it affects |

- `wf ci` fails a change to a `deep_paths` path whose review is not `deep`. When a second model is configured, a deep review must name it in `review.model`, or say in `review.fallback` why it could not be used (not installed, out of quota). Running out of Codex is then a recorded fallback, not a stop.
- Prevents: full second-model reviews of small changes, and a stop when Codex is unavailable. Check: `checkpoints.test.js`.

**B3. Review and verification carry over a clean merge.** Evidence may name an earlier revision for `review.context.candidate` and `verification`. `wf ci` accepts it when every path changed since then either:
- holds the trusted branch's own content (a merge of main), or
- is a planning record (task, feedback or checkpoint records), never an acceptance test.

`integration` stays for the exact head: CI runs there, and GitHub enforces it. This is what `review.md` already asks: "revalidate … review at that exact candidate", not redo it.
- Prevents: the seven re-checks of M-0003. Check: `carry.test.js` and `checkpoints.test.js` with real Git histories, including a hand-resolved conflict, which must not carry over.

**B4. One review per task, one fix review, one milestone review** (procedure, `review.md`):
- A task is reviewed once, on its final code.
- At most one review of its fixes, covering only the fix.
- The milestone gets one review of its whole diff, by the strongest configured reviewer, before acceptance (checked in C1).
- Fix reviews of light and standard tasks never use the second model.

**B5. Prompt focus.** The `independent-reviewer` agent is told its level and to review "the change and what it can break", not the whole application.

### Part C: walk the trial before the owner does

**C1. Acceptance evidence on the acceptance pull request** (`acceptance_evidence: true`, the scaffold default; opt-in on upgrade). The pull request that sets a milestone Accepted carries a marked block (`templates/acceptance-evidence.json`), checked by `wf ci`:
- the code being accepted (an ancestor of the head, with no production change after it);
- the milestone review (reviewer, model, revision, report link);
- the trial walkthrough, or `not_applicable` with a reason for a project without a user interface;
- the `deferred` items, which must include every `accepted_findings` entry of the milestone's tasks;
- the acceptance tests changed in the milestone.

Prevents: presenting a milestone that nobody walked through, or whose deferred items the owner never sees. Check: `acceptance-evidence.test.js`.

**C2. The `trial-walker` agent** (`.claude/agents/trial-walker.md`, installed by `wf-adopt` and `wf-upgrade`) is a fresh context that receives only:
- the acceptance package's trial steps;
- how to start the app with the project's demo data;
- the languages and screen sizes from the profile.

It drives the real interface with browser automation (Playwright or the harness's browser), as a person would. It walks every step and records the expected and observed result with a screenshot, along with console errors and failed requests. Where a step's wording does not match the screen, it reports the correction. It modifies no tracked file. Failures are fixed, or the steps corrected and walked again, before the owner is asked. It runs on a local build with the same demo data as the owner's environment, since the agent may not enter real credentials anywhere else.

**C3. A ready trial environment** (procedure, `accept-release.md`): before asking the owner, the agent prepares the owner's trial environment with demo data that matches the steps. The M-0003 trial needed sections and a person that staging did not have.

### Part D: cheaper agents (procedure, `execute.md`; measured on the next milestone)

- **A task lead per task.** The coordinator hands each task to a fresh task lead, which:
  - runs the task's cycle: implementer helpers, checks, review launch, evidence, pull request, auto-merge;
  - returns only the result.

  The coordinator's context then grows by results, as `execute.md` already intends; in M-0003 it did all of this itself and read 537 K tokens per call. Nesting stays within Claude Code's documented depth: coordinator, task lead, then helper or reviewer.
- **A fresh helper for each fix round,** given the task record, the review and the current head, instead of resuming the helper that built the task. Resumed helpers reached 900 K+ tokens per call.
- **Effort follows the review level:** light → medium, standard → high, deep → the highest. Recorded in the profile's *Execution* when a project differs.
- **Parallel task leads for independent tasks.** Tasks with no prerequisite between them and disjoint scopes may run at the same time, each in its own worktree, branch and pull request, with at most three at once. A pull request that another one's merge leaves behind is brought up to date, and its review carries over (B3).

### Part E: smaller fixes

- **E1. `wf next` reads the newest trusted branch.**
  - When the local trusted branch is behind `origin/<branch>`, `wf next` reads the remote-tracking branch and says so.
  - When the two have diverged, it reads the local branch and says so.
  - Prevents: the stale next action in the stale-line session. Check: `checkpoints.test.js`.
- **E2. `wf evidence`** prints the delivery evidence for a candidate with everything the validator can derive filled in: revisions, tasks, the profile's required checks (`enforced` under auto-merge), the mapped tests to run, and the earlier review and verification when they carry over. The agent fills in what it ran and the review. Prevents: hand-built evidence scripts in every pull request. Check: `evidence-command.test.js`.

## 4. What stays as it is

- Every gate:
  - readiness, scope, classification and records;
  - required checks on an up-to-date branch;
  - mapped acceptance tests run and passing (pending ones as in MAINT-0012);
  - a separate-context review covering all six areas, with every finding resolved or accepted with a resolution.
- Governing, owner-record and enforcement changes, a blocking finding accepted rather than fixed, and the acceptance itself stay the owner's merge.
- Manual and enforced modes are unchanged. Owner-merge without the new settings behaves exactly as in v2.3.1.
- Owner-merge's stated limit: nothing proves who merged.

## 5. Not in this change

- **A milestone integration branch** (IDEA-11, parked). Task pull requests would merge into `milestone/M-NNNN`, and the owner would merge once at acceptance. Its precondition, a test environment, now holds for the client project. It touches every gate's notion of the trusted branch, so it should follow once A1–A3 have been measured on M-0004: as a separate maintenance item if owner merges or out-of-date churn are still a cost.
- **Several milestones at once.** The next milestone usually needs the owner's answers first (M-0004 has four questions), and two coordinators on one trusted branch multiply out-of-date pull requests. Part D's parallel task leads cover independent work inside a milestone.
- **The client-page workflow's run count.** About 100 runs cost GitHub Actions minutes, not model tokens. It is a separate change to the published template.
- **A per-milestone budget for second-model runs.** B2's levels already limit them. A count across pull requests needs history the gate does not read.

## 6. Expected outcome

The table replays M-0003 under the new rules, with `auto_merge`, `defer_to_acceptance`, a second model for deep reviews, and the procedure changes. The estimates are to be measured on M-0004 (§ 7).

| | M-0003 | Expected with v2.4.0 |
|---|---|---|
| Owner merges | 13 | 3: authorise, the client-plan change (governing in that project), accept |
| Owner "merged / continue / what now" messages | 29 | 3–6: authorise, accept, and in the desktop app a "continue" when the next task needs a merge whose CI is still running |
| Idle time waiting on the owner with nothing needed | 7 h 25 min | Near zero from the CLI. In the desktop app only where the next task needs the previous merge before CI finishes (usually 5–10 min, then a "continue") |
| Questions to the owner | 10 | 3–4: the milestone's own questions, and decisions no default covers |
| Reviews | 23 | about 8: one per task at its level, one fix review where needed, one milestone review |
| Second-model (Codex) runs | 23 | about 4: deep tasks and the milestone |
| Model tokens | ≈ 1.16 billion (≈ $475) | estimated 40–50 % less, from smaller contexts (Part D) and fewer reviews and CI cycles |
| What the owner's trial finds | wrong steps, missing setup | steps already walked, corrected and illustrated; environment ready |

## 7. How we will know

Run M-0004 on v2.4.0 and record, with `templates/pilot.md`:
- owner messages by kind, owner merges and idle time;
- reviews and second-model runs by level, and what each found;
- tokens per task, from the transcripts as in § 1;
- what the owner's trial found.

The decision on the milestone integration branch rests on these numbers.

## 8. Release and adoption

Release `v2.4.0`. `upgrades.json` lists, for a project moving its pin:
- refresh `.github/workflows/wf-ci.yml` (new events and the auto-merge environment value);
- add `.claude/agents/trial-walker.md`;
- choose the new settings with `bin/wf-setup`;
- rerun `bin/wf-protect --apply` to allow auto-merge;
- replace `AGENTS.md`'s merge sentence;
- set `acceptance_evidence` if wanted.

For the client project, after the release (owner-run steps, in that repository):
1. `bin/wf-upgrade` to v2.4.0, merged by the owner (an enforcement change).
2. `bin/wf-setup`: auto-merge on, approvals at acceptance on, second reviewer Codex `gpt-6.1-sol` at most `high`, deep paths for permissions, money, numbering and migrations, and acceptance evidence on.
3. `bin/wf-protect --apply` with the owner's own login.
4. The profile's *Delivery* review paragraph is replaced by a pointer to `config.review`, keeping the owner's words.

## 9. Corpus size

The shared corpus (policy, schema, quickstart, procedures, templates, skill and agent templates) is 35,133 words before this change. `procedures/execute.md` is 1,838 words, against the session budget of three to four thousand words for one procedure and its records. The plan records both after the change and keeps `execute.md`'s net growth under 250 words, moving rules into checks where it can.
