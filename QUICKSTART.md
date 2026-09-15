# Quickstart

The policy is `POLICY.md`; the checked rules are `SCHEMA.md`. This page is the daily procedure.

## Adopting the workflow in a project

1. Copy `templates/` records into `docs/workflow/` (`profile.md`, `tasks/`, `decisions/`, `feedback/inbox/`).
2. Copy `config.default.json` to `docs/workflow/config.json`; set `workflow.version` and
   `workflow.revision` to the adopted tag and its commit; classify the project's paths.
3. Copy `bin/wf` to `scripts/wf` (executable). It fetches the validator at the pinned revision into
   `.cache/agent-workflow/` and runs it; CI and humans use the same script. Add `.cache/` to `.gitignore`.
4. Write a short root `AGENTS.md` (where the profile and governing sources are, how to start or resume a
   task, which readiness procedure applies, where commands, task records, and feedback live). Give other
   agents thin adapters (`CLAUDE.md`, …) that point at it.
5. Protect the repository: `CODEOWNERS`, a ruleset on the trusted branch (pull requests only, one
   approval, code-owner review, stale approvals dismissed, required check `readiness`, no bypass), and
   a CI job that runs `scripts/wf ci --base <merge base> --head <head>`.

## Starting a task

1. Create `docs/workflow/tasks/T-xxxx.md` from the template. Fill objective, scope, owner, governing
   records, prerequisites, decisions, assumptions, and deferred inputs.
2. Branch `T-xxxx-<slug>` from the trusted branch. Record `start_revision`.
3. Run the baseline checks; record `baseline_revision` and `baseline_result` (`pass` or `fail: …`).
4. `scripts/wf readiness --task T-xxxx --baseline origin/main`. Act on the outcome: Ready → set
   `status: Ready` and start; bounded subset → work only inside it; Needs → resolve or do permitted
   discovery, and set `Blocked` with a `resume_condition` if waiting on someone.

## Resuming a task

Read the task record and its Latest checkpoint; inspect the branch and working tree; rerun readiness;
record the baseline result and the next bounded action before changing code.

## Checkpoints and handoff

Commit on the task branch with the task id first in the message (`templates/checkpoint.md`), copy the
checkpoint block into the task record, push. A handoff is the same block with the friction line filled.

## Reporting workflow friction

Copy `templates/feedback.md` to `docs/workflow/feedback/inbox/F-xxxx.md`. Reporting changes nothing
else; the owner launches a separate maintenance session (POLICY §12).

## Commands

```
scripts/wf records                                   # schema-check every record in the working tree
scripts/wf readiness --task T-0001 --baseline origin/main
scripts/wf paths --base origin/main --head HEAD      # classify the changed paths
scripts/wf ci --base origin/main --head HEAD         # what CI runs; task id from the branch name
```
Add `--json` for machine-readable output. Exit codes: 0 pass, 1 fail, 2 error.
