# Share a project between people

Read this with the procedure for your next action only when the profile lists two or more `owners`; a project with one owner never needs it. Setup reads *Setting it up*; every session reads *Who approves what* and what follows it.

## Setting it up

Two or more people may share the owner role, each with their own agents. List their GitHub usernames in the profile's `owners`; `wf-adopt --owner NAME`, once for each, adds these steps to the checklist. To convert an adopted project, add `owners` and set every milestone's and task's `owner` in one code-owner-reviewed pull request, then reassess readiness. The repository stays under one person's personal account, recorded in the profile's *Workflow configuration* as an approved deviation from POLICY § 7's single owner; that person alone can change its settings, turns on deleting head branches after merge, and gives the others and every worker account write access. `CODEOWNERS` assigns every path (`*`) to the people and names no worker, with code-owner review required: workers have write access, so otherwise one person's agent could approve the other's pull request. The ruleset also requires approval of the most recent reviewable push, and setup step 9 shows that a worker's approval cannot merge. Each person verifies their own usernames, keeps their own agent clone and worker token, and runs the `identity.md` check and setup step 8's discovery test with their own worker and tools.

## Who approves what

The profile's *Authority* records who approves what. Default: whoever is asked to do work approves the plan that assigns it, the milestone's owner approves the result, and a change to the profile, config, `CODEOWNERS`, required checks or workflow files is approved by the person whose agent did not write it. GitHub checks only that a code owner approved who neither opened the pull request nor, with that setting, pushed to it last, so the people keep this rule; naming one person in `CODEOWNERS` for a milestone or decision file enforces it for that file. Record who approves when one person is away; waiting is never approval. Manual mode has one owner key: one person signs, or the project uses enforced mode.

## Who selects work

Each milestone has one coordinator, its `owner`'s agent, which selects work and sets each task's `owner` to the person whose agents implement it. Until the owners decide otherwise in the profile, each person coordinates at most one active milestone. Other agents implement only tasks assigned to their person and never select or reassign work; they record work they find as Draft tasks whose `owner` is the owner of the milestone the task names, or of the one it was found in while the named milestone has no record, so that person approves the change that adds it and the coordinator assigns it.

## Claiming a task

Claim a task before starting, once its coordinator has made it Ready: on the fetched trusted branch, commit its record with the start facts and status `Active`, create the claim branch, named exactly the task ID, with a push that fails if the branch exists (`git push --force-with-lease=refs/heads/T-0007: origin HEAD:refs/heads/T-0007`; the empty lease means "must not exist", and `wf ci` reads the task from that name), then open a draft pull request from it titled with the task ID. A rejected push means the branch exists or the push failed: stop, report the actual error, and never pull, rebase or build on that branch. The claim branch holds the claim; a pull request on another branch naming the task holds it only when no claim branch exists, the lowest-numbered first, so list the open pull requests again after opening yours. The holder releases a claim by closing its pull request and deleting the branch; nobody else deletes a claim branch without the holding person's agreement.

## Changing the plan

Add work as new task records and batch edits to milestone records and the profile: each edit fails the readiness of the active tasks it governs until each is reassessed, which its implementing agent does on its own branch: it reads what changed in its governing records since the recorded revision, records the new `governing_baseline_revision` and reruns the gate.
