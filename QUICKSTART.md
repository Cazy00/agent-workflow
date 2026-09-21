# Quickstart

Read the relevant procedure, current profile, milestone/task and governing sources. Use `POLICY.md` when a rule is unclear. This checkout is an unreleased candidate; follow `procedures/setup.md` before treating a project as operational.

## Adopt

1. Create `docs/workflow/profile.md`, `milestones/`, `tasks/`, `decisions/`, `feedback/inbox/` and the governing requirements from the templates. Keep unknowns explicit. Add `docs/workflow/acceptance.json` and `tests/acceptance-map.json`; use an empty mapping array when all applicable acceptance methods are human/operational/inspection.
2. Copy `config.default.json` to `docs/workflow/config.json`. Set the target `repository`, adopted workflow tag/full hash, authority and classifications. Configure the profile's required checks. Review shared procedures and add short `AGENTS.md` / `CLAUDE.md` adapters pointing to the adopted installation.
3. Provision the approved workflow Git objects and an owner-installed copy of `bin/wf` outside the candidate checkout. Set `WF_VALIDATOR_REPO` and `WF_VALIDATOR_REV` in the trusted environment. The launcher extracts committed files at that full hash; it ignores candidate choices of executable code and rejects `WF_LOCAL`.
4. Provision the owner public key and signed receipts through `procedures/approval-evidence.md`. Establish source/result trust and the real approval path. A project-local launcher is convenient feedback only; authoritative CI must use the externally controlled launcher and settings.
5. Complete identity checks, fixtures, per-tool discovery and the observed assisted pilot. Record limitations in the setup record before declaring supported operation.

## Start or resume a task

Inspect actual Git/external state before resuming. Confirm the worker route, fetch the configured authoritative branch and record its exact full revision. Record the task's baseline results, starting revision and `governing_baseline_revision`, scope, feature readiness, milestone, acceptance IDs, verification and independent review plan. Reuse approved designs and contracts. Document existing failures for repairs.

The examples assume `WF_LAUNCHER`, `WF_PROJECT`, `WF_BASELINE`, `WF_CANDIDATE`, `WF_OWNER_KEY`, and `WF_RECEIPTS` were set by the trusted operator; `WF_BASELINE` is the freshly fetched authoritative SHA. Replace `OWNER/REPOSITORY` and `T-0001` with the project's values.

```sh
"$WF_LAUNCHER" records --baseline "$WF_BASELINE"
"$WF_LAUNCHER" readiness --baseline "$WF_BASELINE" --task T-0001 \
  --trust-key "$WF_OWNER_KEY" --receipts "$WF_RECEIPTS" --repository OWNER/REPOSITORY
```

Ready permits promoting a prepared Draft and starting eligible work. A bounded subset permits only the stated scope. Needs discovery or resolution identifies missing prerequisites. If a Blocked task's blocker was resolved, record that fact, clear its blocked state and rerun readiness. Agent-organised task changes cannot erase established prerequisites or change milestone/feature identity to avoid a gate.

## Review and integrate

Commit the candidate with the task ID first. Use a separate review context, resolve findings, assemble the latest baseline and rerun integration checks. Have the owner-controlled collector authenticate and sign verification, review and integration evidence. No owner credentials or signing keys enter the candidate test environment.

```sh
"$WF_LAUNCHER" ci --baseline "$WF_BASELINE" --candidate "$WF_CANDIDATE" --task T-0001 \
  --trust-key "$WF_OWNER_KEY" --receipts "$WF_RECEIPTS" --repository OWNER/REPOSITORY
```

The actual diff is computed from those immutable revisions. A candidate must include the current baseline. A manually supplied changed-path list is diagnostic only and is refused when approval evidence is supplied. Protected requirements/workflow changes require separate scoped receipts; they do not authorise dependent implementation in the same baseline.

## Accept, release and hand off

Use `procedures/accept-release.md`. `wf lifecycle --stage accept` checks the task's evidence and recorded owner decision; `--stage release` adds release readiness and authority. A milestone acceptance package must cover its complete scenario/task set, not just one task. Preserve the accepted-artifact relationship. Commands validate evidence; they do not deploy or publish.

Record a session outcome using `templates/session.json`, then validate it with `wf session --record PATH` and the same baseline/candidate/trust arguments. A handoff preserves changes, verification revision, uncertainty, next action and **Workflow friction this session: none / report IDs**. Use `procedures/maintenance.md` for feedback and separately authorised repairs.

Other commands: `paths` classifies the actual diff; `acceptance` checks mappings/execution; `lifecycle --stage verify|integrate|accept|release` checks evidence stages. All commands print structured JSON (`--json` remains accepted). Exit codes: 0 satisfied, 1 blocked/failed, 2 invalid inputs or execution error. Directory inputs are for diagnostics and fixtures, not authoritative approvals.

## Central reporting and assisted runtime

After the owner-directed central mode is adopted, use [operations.md](procedures/operations.md) for `wf report`, `wf runtime` and `wf prepare-evidence`. Their configuration and private outbox live outside the product repository. Reporting works even when readiness blocks implementation; it cannot approve work. The evidence helper currently supports the included Node test reporter, produces unsigned drafts only, and does not imply compatibility with an uninspected product test runner.
