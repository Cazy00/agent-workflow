---
record: milestone
id: M-0000
outcome:
measure:
client_title:
client_outcome:
client_measure:
status: Draft
workflow_version:
signing: task
coordinator:
owner:
scope: []
governing: []
acceptance: []
authority:
limits:
demonstration:
stop_conditions:
release_authority:
tasks: []
found_tasks: 3
plan_review:
prerequisites: []
---
# M-0000 — coherent journey or demonstrable technical outcome

## Outcome and exclusions
`workflow_version:` above is the workflow release the milestone runs under, set to the pin (`docs/workflow/config.json`) when it is authorised; it moves only with the owner's decision, in the pull request that moves the pin (`bin/wf-upgrade` sets it).
Optional `plan_review:` above: under `review.cadence: milestone`, the link to the plan's one quick review, posted on its pull request before authorisation (`procedures/readiness.md`).
Optional `measure:` above: the one sentence that shows this milestone worked, checkable by a non-technical person. Optional `client_title`, `client_outcome` and `client_measure`: the same three in the client's words and language, for the client page (`wf status --client`); each one left empty shows the record's own.

## Acceptance scenarios and demonstration
Stable acceptance IDs, actions, expected results and evidence methods.

## Governing requirements, decisions and contracts

## Tasks, priority and prerequisites
Claims are the tasks' branches and pull requests (`procedures/execute.md`); keep task scope and prerequisites here. `owner`: the person who authorises and accepts the milestone. `tasks`: the plan as authorised (`procedures/readiness.md`); work found later is not added. `found_tasks`: the owner's allowance, 0 to 3, of found tasks fixing findings of this milestone's own review or trial without asking; the acceptance reports each.

## Execution authority and limits
Approved time, usage, retry, spending and owner-effort limits. Prefer limits the coordinator can measure at every checkpoint (wall-clock hours, task count, retries per named check or task); state the retry unit and counting rule. Add usage or spend limits only where the harness reports them, and name the counter. Running totals, remaining allowance and unknown usage go on the tasks' pull requests or handoffs; do not edit this governing record for bookkeeping.

## Technical verification and independent review
Second-model budget: two runs per deep task (its review and one fix review), one for the milestone review (`procedures/review.md`).

## Stop conditions and acceptance boundary

## Release authority and next recommendation
A milestone that releases nothing says so in `release_authority:` above: it starts with `None`, or has a sentence of its own, `Nothing is deployed.` or `Nothing is released.`. `wf status` then raises no release item for it after acceptance.
