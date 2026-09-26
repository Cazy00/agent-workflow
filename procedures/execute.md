# Coordinate, implement and hand off

## Coordinate and delegate

Use one coordinator for an authorised milestone. Read current records and actual Git/external state, recompute readiness, select the highest-priority eligible task and claim it before work. With assisted execution, the coordinator serialises claims in the separate operational run record (see `operations.md`); milestone records retain approved limits and authority. Do not run concurrent coordinators, except one per person in a shared project (`shared.md`); parallel workers require separately assigned tasks and worktrees, with agreed shared contracts. This manual claim protocol is not an unattended distributed lock.

Use the harness's delegation feature to keep the owner out of routine verification. Claude Code, Codex and Cursor subagents start with an empty context and see only their prompt; the coordinator uses them for independent review (`review.md`), for reruns of the required checks on the assembled candidate, and for bounded exploration whose output would otherwise fill its own context. A delegate receives the canonical inputs by path or revision, never the coordinator's conversation or reasoning, and returns a structured result that the coordinator posts on the pull request. Delegates inherit the task's authority and limits, not more: they do not resolve reserved decisions, publish, sign or approve. Without a delegation feature, a fresh session with the same inputs serves. The owner is involved only at reserved decisions, acceptance and the approvals the profile reserves to them; the owner does not run checks or reviews. Record the harness feature and version used in the profile's *Execution* section.

## Implement a task

For each task: load governing sources/checkpoint; confirm scope, environment and identity; record the baseline; inspect existing components/helpers/scripts/toolbox; implement the smallest coherent change; run meaningful checks; investigate failures; obtain independent review; resolve findings; post evidence and next action on the task's pull request. Register useful reusable assets only after review. Task-specific helpers need not become frameworks.

**Tests.** A production-affecting task ships with automated tests for the behaviour it adds or changes, mapped to its acceptance IDs where they exist. When no automated test is practical, the task record states why and names the manual evidence method before review, and the reviewer checks that reason. Tests are what let later tasks change the code safely; treat a missing test as a review finding, not a preference. For each new or changed automated acceptance mapping, post evidence of one observed failing run before the change and the passing run after it; a test that never failed has not shown that it tests anything.

**UI.** For UI-affecting tasks, run the app in the profile's authorised test environment, exercise the changed journey and inspect its rendering at relevant device/viewport settings against approved examples. Use dedicated test accounts/data and the tool's supported authentication flow; do not introduce an auth bypass or circumvent a tool restriction to complete a check. Fix in-scope defects and repeat affected checks within existing authority and limits. On the pull request, record revision, environment, account role, actions, expected/observed results and useful screenshots or journey output, keeping secrets and tokens out. Check relevant persistence and permissions as well as appearance. Unavailable required verification remains a blocker, not a pass. This is implementer evidence; independent review, integration verification and owner acceptance still apply.

**Checks.** Use project patterns for boundaries, errors, data, dependencies, interfaces and tests. Choose applicable business/regression, type/build/lint, integration/journey/contract, permissions/input/data exposure/secrets, negative examples and invariants, dependency/security, migration/concurrency/retry/recovery, performance/accessibility/device checks. Report tested revision, environment, results and limitations on the pull request; raw output belongs in signed receipt artifacts, not commits. Repeat affected checks and review after material changes.

**Bug fixes.** Reproduce the failure or preserve available failure evidence; add a meaningful regression check where practical, make a scoped fix and recheck the original symptom. Record what could not be reproduced or verified and why. Reuse approved behaviour and designs; documented failing baselines remain valid, and existing readiness, required checks and review still apply. A production incident follows the hotfix lane in `operate.md`.

## Work found along the way

Work found during a task that the plan did not include is recorded, never done beyond scope or left only in a handoff. Inside this task's scope and acceptance IDs, do it here and say so on the pull request. Needed for this milestone but outside this task, write a Draft task with the same `milestone:`, a body line `Found in T-NNNN: <reason>` and prerequisites for any order; leave the milestone's `tasks:` as authorised, so no active task goes stale and `wf status` marks it discovered. Anything else becomes a Draft task naming its later milestone from the profile's *Delivery* list, or a decision record when it changes scope, behaviour or acceptance (POLICY § 5). Tasks stay flat: order is a prerequisite, never a subtask. Number a new record above every ID in the trusted branch's history and in open pull requests.

## Checkpoints and task records

A shared checkpoint is a commit beginning with the task ID. Its condition may be incomplete if explicit. Publish only to the authorised location after the exact route identity check. Preserve genuine human authorship. Merge traceability may use the PR. Read-only findings go in the relevant record when future work needs them, otherwise on the task's pull request or issue.

After a task's pull request merges, the coordinator marks its record Done in a planning change, which may batch several, before any task that names it as a prerequisite is assessed. Keep Done records until the milestone is accepted: prerequisites, the milestone's coverage and its planned and discovered tasks are read from them. Then remove them in one planning change; the pull requests are the permanent record. A Done task in no milestone may be removed at once. A task in another milestone depends on an approved contract (`contract:`), not on a task; a record that another task's record still names in `prerequisites` or `governing` stays until that record goes, and `wf ci` fails a change that removes it earlier or names a task whose record is missing.

## Resume, limits and handoff

Before resuming interrupted work, inspect branch, working tree, task claims, logs, PRs and any other external actions already performed. Do not replay side effects from a missing handoff. Save cumulative time/usage/retries/spend in the operational run record, against the milestone’s approved limits; unknown usage is unknown. Check the remaining budget before each assisted call. Save progress and stop when a limit is reached.

At handoff, report workflow friction through the adopted central reporting route in `operations.md`, including explicit user complaints. A report never changes readiness. Offer the optional feedback question only when runtime cadence allows it.

Every session records one outcome with `templates/session.json`: progress, ready-for-review, verified-complete, blocked, stopped-by-limit, or no-progress. Write it outside the checkout, run `wf session`, and post the outcome on the pull request or issue. Evidence entries may be committed records or links to that pull request or issue. Process success or a new commit alone is insufficient; inspect evidence for meaningful progress.

Stop affected work on reserved decisions, missing access, exhausted budgets, repeated no-progress attempts or suspected safeguard failure. Stop the milestone at owner acceptance. Starting another milestone and release require their own authority. Post the handoff on the task's pull request (or its issue before one exists): changed work, verification and revision, uncertainty/blockers, next eligible action, and **Workflow friction this session: none / report IDs**. Do not commit handoff files.

When manual continuation is needed, supply:

> Resume task T-____ in milestone M-____. Read AGENTS.md, the profile, those records and their governing sources. Inspect the latest checkpoint, the handoff on the task's pull request or issue, and actual Git/external state. Recompute readiness against the freshly fetched authoritative revision. Continue only the next eligible action recorded in the handoff, within remaining limits. Post evidence and an explicit outcome on the pull request or issue; stop at the next reserved decision or acceptance boundary.

## More than one person

When the profile lists two or more `owners`, also follow `shared.md`: who selects and claims work, and how the plan changes.
