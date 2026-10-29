# Maintenance — MAINT-0024: the owner's merge approves a found task

Separate owner authorisation: the owner, 29 October 2026, through a client project's M-0007 manager session: "bring this up to agent workflow session specifically, and let it determine by itself whether it needs to be removed or not". They called the rule "nonsense ... It's holding us back, it's slowing us down." Changing an approval rule is on the owner's confirm-first list, so this release merges only with the owner's merge.
Workflow version and immutable revision: v2.12.0, `452847b` (main).
Selected report IDs: one, the M-0007 incident below (no feedback record; the manager's message).
Start, limit: 29 October 2026, one session; no spending limit set; usage not measured.

## Classification counts
Workflow defect: 1 (with an expected safeguard inside it). Others: 0.

## Per-report disposition
| Report | Classification | Evidence / reproduction | Disposition and uncertainty |
|---|---|---|---|
| A client project's M-0007, T-0061 (29 October 2026) | Workflow defect around an expected safeguard | See below; reproduced in `validator/test/maint-0024.test.js` | **Changed**, not removed. Certain about the cause; the second cause (a broken required check) is the project's, not the workflow's. |

**What happened.** An end-to-end test on main chose a due date three days ahead, which from 29 October falls in November while the calendar opens on October, so the required `checks` failed on every pull request until 1 November. The owner approved the fix in conversation as a found task, T-0061. It fixes no review or trial finding, so it has no `found_from`. Readiness (`validator/lib/readiness.js`) refuses a found task of an Active milestone without `found_from` unless the trusted branch's `tasks:` names it, and reads `tasks:` only from the trusted branch. So T-0061's own pull request, which also added T-0061 to `tasks:`, failed `wf ci`. The records-only pull request that would have put T-0061 in `tasks:` first failed the broken check, and nothing merges with a failing required check. Nothing could merge for about three days; the workaround widened a planned task's scope.

## Decision: change the rule, keep the safeguard

**Why not remove it.** The rule stops an agent starting work the owner did not plan, without asking. That is the authority the milestone delegates, and it is the owner's. Removing the check would let any agent add a task to any Active milestone and merge it under `checkpoint: milestone`. That includes "fixing" a failing check by editing the test.

**What was wrong.** The rule asked for the owner's approval and then ignored where the owner gives it. A milestone record is governing in projects that protect it. So a pull request that changes the record already needs the owner's approval of that exact candidate in every mode: the governing-change check fails without it, and owner-merge mode gives the merge to the owner. Requiring the approval to be on the trusted branch *before* the work forced a second, records-only pull request. That pull request depends on the same required checks, and here they were the thing broken. Its only effect was the deadlock.

**The change.**
1. *Readiness* (`addedByOwner`): a task the candidate's milestone record names in `tasks:`, and the trusted branch's does not, is planned. This applies only when both records are `governing` by the trusted branch's config. Readiness adds a `pending` note saying the owner approves it with the record. Where milestone records are not governing, nothing changes.
2. *`wf next`*: it neither counts nor holds such a task.
3. *Freshness*: a milestone's `tasks:` line no longer counts, as `workflow_version` already did not. Before this, adding a task to `tasks:` sent every other open task of the milestone back to readiness. That is why `execute.md` said never to add found work to `tasks:`. Which tasks a milestone lists governs no task's requirements. The found-task rule reads the list afresh at every readiness run, so a task removed from it becomes found at once.
4. *Procedure*: once the owner says yes, add the task to `tasks:` in the pull request that carries its work. No records-only pull request goes first.

**How this differs from MAINT-0023 P8, which was rejected.** P8 would have trusted a candidate's `found_from`, a task field nothing on the trusted branch could confirm. Any change could have called itself a found task. Here the authority is not a field the agent sets. The candidate changes a governing record, which `wf ci` refuses to pass to the agent and requires the owner's approval for. Agents still never approve.

**`found_tasks` and `found_from`.** These stay as they are. Without the owner, an agent still fixes only findings of the milestone's own review or trial, within the allowance. Extending `found_from` to a broken check (`check:<name>`) was considered and rejected: an agent alone could then rewrite a failing test. A task the owner adds is planned, not found, and uses none of the allowance. It counts toward no other found task's place, because only tasks with a `found_from` count.

**Residual cost.** It is one owner merge per owner-approved found task, which the owner already gives. An agent can run `wf next` on its own working tree, after adding a task to `tasks:`, and see the task as startable before the owner has agreed. That buys only wasted work: the merge still waits for the owner. The procedure says to add the task only after the owner says yes.

## Proposed change
Implementation: `validator/lib/readiness.js`, `next.js`, `freshness.js`. Instruction: `procedures/execute.md`, `procedures/readiness.md`, `templates/milestone.md`, `SCHEMA.md`. Fixture: `validator/test/maint-0024.test.js`.
Policy basis: POLICY's owner-merge paragraph, "A change to requirements, decisions or workflow controls still waits for the owner's merge". The owner's approval is still required. The change is only that the same merge carries the approval and the work. No blocking fixture expectation changed: the existing MAINT-0020 found-task tests pass unchanged.

## Verification
These checks would catch a recurrence: the new tests show T-0002 refused without the milestone change, ready with it, `wf ci` passing with `merge: owner`, and `wf next` not holding it. The rule still stands where milestone records are not governing, and where the candidate's change to the record does not name the task. Adding to `tasks:` leaves another task fresh, while a change to `limits:` still makes it stale. `npm test`: 841 pass, 3 of them new.

Words: `SCHEMA.md` 10,544 → 10,603, `procedures/execute.md` 2,400 → 2,454 (within the session budget alongside the skill and one procedure), `procedures/readiness.md` 1,377 → 1,390, `templates/milestone.md` 392 → 405.

## Usage and follow-up
Usage: not measured. Next: one independent review of the final head (approval-rule code), then the owner's merge, which tags v2.13.0. The client project adopts the release by moving its pin, when the owner chooses: mid-milestone with a decision in M-0007's record, or at the start of M-0008.
