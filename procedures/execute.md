# Coordinate, implement and hand off

Use one coordinator for an authorised milestone. Read current records and actual Git/external state, recompute readiness, select the highest-priority eligible task and claim it before work. With assisted execution, the coordinator serialises claims in the milestone record. Do not run concurrent coordinators; parallel workers require separately assigned tasks and worktrees, with agreed shared contracts. This manual claim protocol is not an unattended distributed lock.

For each task: load governing sources/checkpoint; confirm scope, environment and identity; record the baseline; inspect existing components/helpers/scripts/toolbox; implement the smallest coherent change; run meaningful checks; investigate failures; obtain independent review; resolve findings; save evidence and next action. Register useful reusable assets only after review. Task-specific helpers need not become frameworks.

For UI-affecting tasks, run the app in the profile's authorised test environment, exercise the changed journey and inspect its rendering at relevant device/viewport settings against approved examples. Use dedicated test accounts/data and the tool's supported authentication flow; do not introduce an auth bypass or circumvent a tool restriction to complete a check. Fix in-scope defects and repeat affected checks within existing authority and limits. In the checkpoint's Evidence, record revision, environment, account role, actions, expected/observed results and useful screenshots or journey output, keeping secrets and tokens out. Check relevant persistence and permissions as well as appearance. Unavailable required verification remains a blocker, not a pass. This is implementer evidence; independent review, integration verification and owner acceptance still apply.

Use project patterns for boundaries, errors, data, dependencies, interfaces and tests. Choose applicable business/regression, type/build/lint, integration/journey/contract, permissions/input/data exposure/secrets, negative examples and invariants, dependency/security, migration/concurrency/retry/recovery, performance/accessibility/device checks. Preserve tested revision, environment, raw results and limitations. Repeat affected checks and review after material changes.

For bug fixes, reproduce the failure or preserve available failure evidence; add a meaningful regression check where practical, make a scoped fix and recheck the original symptom. Record what could not be reproduced or verified and why. Reuse approved behaviour and designs; documented failing baselines remain valid, and existing readiness, required checks and review still apply.

A shared checkpoint is a commit beginning with the task ID. Its condition may be incomplete if explicit. Publish only to the authorised location after the exact route identity check. Preserve genuine human authorship. Merge traceability may use the PR. Read-only findings may be stored in the task or run log without a code commit.

Before resuming interrupted work, inspect branch, working tree, task claims, logs, PRs and any other external actions already performed. Do not replay side effects from a missing handoff. Save cumulative time/usage/retries/spend in the milestone and run record; unknown usage is unknown. Check the remaining budget before each assisted call. Save progress and stop when a limit is reached.

Every session records one outcome with `templates/session.json`: progress, ready-for-review, verified-complete, blocked, stopped-by-limit, or no-progress. Run `wf session`. Process success or a new commit alone is insufficient; inspect evidence for meaningful progress.

Stop affected work on reserved decisions, missing access, exhausted budgets, repeated no-progress attempts or suspected safeguard failure. Stop the milestone at owner acceptance. Starting another milestone and release require their own authority. A handoff states changed work, verification and revision, uncertainty/blockers, next eligible action, and **Workflow friction this session: none / report IDs**.

When manual continuation is needed, supply:

> Resume task T-____ in milestone M-____. Read AGENTS.md, the profile, those records and their governing sources. Inspect the latest checkpoint and actual Git/external state. Recompute readiness against the freshly fetched authoritative revision. Continue only the next eligible action recorded in the handoff, within remaining limits. Preserve evidence and an explicit outcome; stop at the next reserved decision or acceptance boundary.
