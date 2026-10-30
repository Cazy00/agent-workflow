# Maintenance — MAINT-0026: a found task is approved at the milestone's acceptance

Separate owner authorisation: the owner, 30 October 2026, during a client project's milestone: the owner wants to answer twice per milestone, the plan and the finished result at acceptance, and asked why they must tap anything within the milestone's development. This restates their 29 October decision behind MAINT-0024 that task merges need no tap. Changing an approval rule is on the owner's confirm-first list, so this release merges only with the owner's merge.
Workflow version and immutable revision: v2.14.0, `9d0f6ba` (main).
Selected report IDs: one, the owner's request above (no feedback record).
Start, limit: 30 October 2026, one session; no spending limit set; usage not measured.

## Classification counts
Workflow defect: 1 (a second approval inside the milestone). Others: 0.

## Per-report disposition
| Report | Classification | Evidence / reproduction | Disposition and uncertainty |
|---|---|---|---|
| The owner's request (30 October 2026) | Workflow defect around an expected safeguard | A task beyond the milestone's `found_tasks` allowance, or with no `found_from`, needed the owner's yes in conversation and then the owner's merge of the milestone record that adds it to `tasks:` (MAINT-0024): two answers to one question. Reproduced in `validator/test/maint-0026.test.js`. | **Changed**, not removed. Certain about the cause. |

## Decision: the agent adds the task, the acceptance shows it

Under the owner's existing choice `approval.defer_to_acceptance: true` (owner-merge, checkpoint `milestone` or `plan`), a **tasks-only milestone change** goes to the agent. `ci.js` leaves the milestone's path out of the three owner signals it gave the change (the governing reason, the owner-records reason and the "code-owner review required" finding), and adds one `deferred` line naming the added ids. The owner approves those tasks at the milestone's acceptance, where they are listed. Production deploys still need the owner.

**The predicate** (`validator/lib/tasks-only.js`, `tasksOnlyChange`: the only place that decides it). A change is tasks-only for milestone record M when all of these hold:
- `defer_to_acceptance` is chosen and M is governing in the trusted config. Where it is not governing, MAINT-0024's position stands unchanged: the owner's merge, and readiness reads the added id as a found task.
- M is `Authorised` or `Active` on the trusted branch: a Draft is the plan's own approval, a Verified or Accepted milestone is past the build.
- The text of the record without the `tasks` line is byte-identical (body, status, every other key, comments and layout), and the parsed keys other than `tasks` are equal as the validator parses them.
- `tasks` is a list of distinct `T-NNNN` ids on both sides, and the candidate's list keeps every trusted id in order and only appends. Anything else says `tasks is not a list of task ids` or `it drops or reorders planned tasks`.
- Each added id has a task record in the candidate whose `milestone:` is M. Readiness keeps checking that its scope and acceptance IDs lie inside M's.
- Whether an acceptance scenario newly waits on an added task is not part of the predicate: under `defer_to_acceptance` `wf ci` already defers that change (`later()` in `ci.js`), so the existing rule applies unchanged.

Every other owner reason of the same change (another record, a governing file) stays, so the change goes to the owner if any remains. A test checks `owner_reasons` ends up empty for a pure tasks-only change.

**Readiness.** An id added this way stays planned, as in MAINT-0024. Its pending note says the owner approves it at the milestone's acceptance, instead of "with the milestone record".

**The acceptance lists them, computed, not the agent's word** (`acceptance-evidence.js`, `owedTasks`). The evidence's `deferred` must name every id in M's `tasks:` that M's last plan revision did not hold. The revision is found by walking M's first-parent history on the trusted branch, newest first, from the acceptance's base, judging each change with the same predicate. A bare `Authorised` → `Active` status move passes over (it carries no plan). The first other change is the last plan revision: a creation, a re-plan, any other edit, a squash that mixed a tasks-only change with another. The ids that revision carries are the owner's and not required. The check fails closed, with the reason, when the history cannot be read, the clone is shallow, or no such revision exists.

**What changes for the allowance.** Under `defer_to_acceptance`, `found_tasks` (0 to 3) and `found_from` limit only found tasks begun without being added to `tasks:`. A task appended to `tasks:` is bounded by M's scope and acceptance IDs and shown at acceptance. There is no cap on them: the owner asked for no taps mid-milestone, and every one is shown before release. `SCHEMA.md`, the milestone template and the upgrade notes say so. A project that already sets the flag gets this at its pin move, so each such project's manager is told.

**Unchanged.** MAINT-0023 P8's rejection (no trust in a candidate's `found_from`); projects without `defer_to_acceptance`, which keep MAINT-0024's merge; enforced and manual modes (the flag needs owner-merge).

## Plan review and how each finding was handled
One plan review (Opus), verdict pass, five should-fix findings and two notes. All were folded in before the build.

| Finding | Handled |
|---|---|
| F1 (byte comparison strips one line; block lists; a value that swallows the lines below) | The text without the `tasks` line is compared whole, the parsed keys other than `tasks` are compared, and every entry must be an id. The front matter parser reads inline lists only, so a block list cannot be tasks-only (it does not parse); tests cover an unclosed list, a comment inside the list, a non-id and a quoted entry, a duplicate, a comment and a layout change. |
| F2 (the allowance becomes inert) | Documented as above; no numeric cap. |
| F3 (three owner signals) | All three dropped for the path; a test checks `owner_reasons` is empty and the governing finding is absent. The receipt line for the path in the receipt loop is dropped too. |
| F4 (the merge route, rulesets, code owners) | Not code: a project checks that its merge automation reads no classification of its own and that its branch rules require no owner review of milestone records before it moves its pin. |
| F5 (which revision) | The walk back to the last plan revision, above; tests for a milestone created `Authorised`, a re-plan after `Active`, a bare status move, and each fail-closed case. |
| F6 (in-flight milestones) | A procedure and changelog note: tasks the owner added by merge are tasks-only changes too, so the first acceptance after the pin move lists them; harmless, the evidence may say the owner merged them. |
| F7 (non-governing records) | Nothing changes where M is not governing: the owner reason stays and readiness applies the found-task rule. Tested. |

## Proposed change
Implementation: `validator/lib/tasks-only.js` (new), `ci.js`, `readiness.js`, `acceptance-evidence.js`. Instruction: `SCHEMA.md`, `templates/milestone.md`, `templates/acceptance.md`, `procedures/execute.md`, `procedures/readiness.md`, `procedures/accept-release.md`. Fixture: `validator/test/maint-0026.test.js`.
Policy basis: POLICY's owner-merge paragraph, "A change to requirements, decisions or workflow controls still waits for the owner's merge". The owner still approves each task: at the acceptance, which cannot complete without listing it, not with a merge inside the milestone.

**Replace test.** To replace this rule: `tasks-only.js` (one predicate), the note in `readiness.js` and the evidence check change; `wf ci`'s output contract (`merge`, `owner_reasons`, `deferred`) does not.

## Risks
- An agent adds work the owner would not have allowed: bounded by M's scope and acceptance, listed at acceptance before any production release, and the owner chose `defer_to_acceptance`.
- The plan revision is hard to find after rebases or squashes: the acceptance fails closed, which costs the owner one look and never a silent approval. A squash that mixed a tasks-only change with another counts as a plan revision, so ids it added are not required; that change was the owner's merge.

## Usage and follow-up
Usage: not measured. Next: one independent review of the final head (approval-rule code), then the owner's merge, which tags v2.15.0.
