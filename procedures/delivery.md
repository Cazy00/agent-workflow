# Fewer delivery round trips

Keep one coordinator and independent review. First group related edits and checks inside a coherent task; a checklist item is not a new planning/review cycle. The options below change integration packaging or authority, not scope, verification, acceptance or release. Defaults remain one task per PR and owner review of protected changes.

## Local batches

When several ready tasks form one demonstrable outcome, an owner-approved baseline may set `delivery.batching` in `docs/workflow/config.json`:

```json
{"max_tasks":3,"environment":"isolated integration and owner demo environment","rollback":"revert the delivery commit; data changes need a separate recovery plan"}
```

Choose the smallest useful batch. Retain task-prefixed commits, scope, checkpoints and evidence for each task, and independently review the whole assembled candidate. Push one delivery PR when it is reviewable; publish intermediate checkpoints only when collaboration or recovery needs them. Run `wf ci --baseline BASE --candidate HEAD_SHA --tasks T-0001,T-0002`. The trusted CI entry must pass the complete explicit list, not silently infer only the first task from a branch name. The PR names every task and its commit range; the current status view associates the PR with its leading task only, so link it from the other task handoffs.

Each changed production path must belong to exactly one selected task; every task must own a production change, have the same milestone/implementer, and pass its gates. Overlapping work is usually one coherent task, not a reason to weaken scope checks. A signed review for a batch lists every task in `tasks`. Tasks may become Done in the delivery candidate only under the existing Done-in-this-PR rule. Local Done never satisfies a prerequisite requiring Done on the trusted baseline; use an already approved contract or deliver that dependency first. Do not create per-step PRs to simulate local integration.

Batching needs a suitable integration/demo environment and rollback boundary. If only production can exercise the journey, retain a smaller delivery unit until the owner approves a safe environment. Final assembled checks and owner acceptance still apply. Size, risk and rollback difficulty can outweigh saved PR/CI cycles.

## Agent-operated routine merges

This is opt-in assisted execution. It deliberately trusts agents to report technical evidence honestly; it is not a trusted reviewer service or an unattended runner. The owner may approve the routine lane once within an authorised milestone instead of clicking approval for every small change. In one protected setup change, record this authority and its assurance limit in the profile, configure narrow `delegation.routine` paths and limits, and update GitHub enforcement. Keep worker credentials separate.

```json
{"enabled":true,"evidence_assurance":"agent-attested","paths":["src/components/StatusBadge.tsx"],"reserved_paths":["src/auth/**","src/payments/**"],"max_files":8,"max_changed_lines":200}
```

Use exact paths or narrow directory prefixes ending in `/**`; a broad `src/**` grant is invalid. Paths do not establish semantic safety: a UI edit can still change money, permissions or data handling. Those changes need the governing decision and owner route. Tests, dependency files, migrations, generated outputs, protected/unknown paths and consequential task records do not qualify for routine delegation. Existing task, milestone, readiness and acceptance gates all remain active.

After checks and fresh-context review, prepare an external `templates/delivery-evidence.json` and post it from the configured worker account as a PR comment beginning with `<!-- agent-workflow:delivery-evidence@1 -->`, followed by the JSON only. Run the pinned gate with `--pull-request NUMBER` alongside normal `wf ci` arguments. It reads the latest marked worker comment; malformed or stale new evidence never falls back to an older green report. For a local check, `--delivery-evidence /external/delivery.json` supplies the same unauthenticated data directly. The manifest must cover all tasks at the exact candidate, verification and integration checks, all review areas, resolved findings and fresh-context launch provenance. It is agent-attested, never owner approval. Missing/stale/invalid evidence blocks the routine lane. The same manifest, in the pull request description, is what `wf ci` requires of every production change in the pull-request modes (`execute.md`); one copy serves both. The gate reads actual changed paths/line counts; binary or unmeasurable diffs require the owner route.

An ineligible production candidate must obtain exact-head owner approval, read directly from GitHub using the protected baseline's repository/owner/worker/branch identities. A field in the manifest cannot supply it. The collector rejects stale, dismissed, superseded, draft, closed, mismatched and fork PRs. Both this additional gate and all existing checks must pass. Protected governing/enforcement files still require GitHub code-owner approval.

GitHub setup must keep the pinned gate required, branches up to date, stale approvals dismissed and worker bypass disabled. Keep `* @OWNER`; un-own only the approved narrow routine paths and ordinary task/feedback records, with protected overrides last. Never remove ownership broadly. The trusted gate must receive the evidence manifest and PR number, run after head changes **and after owner review submission/dismissal**, and collect GitHub state using a trusted `gh` executable outside candidate control. Otherwise an owner-required candidate remains blocked after approval; do not treat that as permission to bypass the check. The integration gate evaluates an open PR before merge; main/push product checks and `delivery-check` verify the merged revision separately. This release supplies read-only GitHub approval/comment collection, not a hosted reviewer, evidence signing service or universal CI installation.

Before activation, exercise: valid routine merge; missing/stale review blocked; new push invalidates evidence; mixed/protected change waits for owner; forged owner fields fail; dismissed approval fails; direct worker push rejected. Record the real results. Default setup does not enable this lane, alter CODEOWNERS or change an existing project's pin.

Stop further delegated merges on a required main-check failure and record the owner’s disposition. Check the exact delivered revision with `wf delivery-check` before closeout. Routine integration grants no production deployment or release authority; do not enable it on an automatically deploying branch unless its separate deployment authority and acceptance conditions are already satisfied.

## Avoid repeated CI and owner work

Keep the required workflow check running on both PR and main/push events. Use the trusted classifier on the actual before/after commits to skip expensive product steps only when every changed path is planning-only; continue record, workflow and applicable documentation checks. Unknown paths, enforcement, dependencies, code and generation inputs require the relevant full checks. Do not use whole-workflow path exclusions that strand required checks, or optimize only the PR side while every bookkeeping merge repeats the full main suite. Verify the fast path with one records-only and one production change on both events before adopting it.

Measure approvals, CI runs and runner-minutes per accepted outcome, including local integration time, review findings, rework and defects. A smaller PR count is not itself a quality or cost improvement. Use the next comparable task's benchmark in `templates/pilot.md`.
