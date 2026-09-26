# Quickstart

Read the relevant procedure, current profile, milestone/task and governing sources. Use `POLICY.md` when a rule is unclear. Adopt only a released tag, since a checkout between tags is a candidate, and follow `procedures/setup.md` before treating a project as operational.

## Adopt

1. From the workflow checkout, run the scaffold once against the target repository. It writes `docs/workflow/config.json` with the adopted tag and full hash, creates `docs/workflow/{milestones,tasks,decisions,feedback/inbox,inbox}`, seeds the profile, the setup record, an empty `acceptance.json` and `tests/acceptance-map.json`, installs `scripts/wf`, the `AGENTS.md` / `CLAUDE.md` adapters and the status workflow when absent, fetches the pinned installation into `.cache/agent-workflow/`, and writes the owner checklist into `docs/workflow/setup.md`. It never overwrites an existing file and costs no model usage. `TAG` is a release that contains this scaffold; a v1.0.0 adoption follows that version's own quickstart. The project always starts in `manual` mode, in which nothing is approved; the switch to `enforced` is the code-owner-reviewed pull request after setup steps 5 and 9.

   ```sh
   bin/wf-adopt --project /path/to/repo --repository OWNER/REPOSITORY --rev TAG \
     --coordinator OWNER_USERNAME --production '**/*.dart' --lane existing
   ```

   For a project two or more people share, pass `--owner NAME` once for each and read `procedures/setup.md`, *Shared project*.

2. Read `procedures/setup.md`. The agent completes the agent steps (profile with honest unknowns, stack-specific classification, required checks, first-milestone acceptance IDs, fixtures and discovery tests), writes the owner steps into the setup record as a checklist, and stops; the owner completes the owner steps at their own pace. Raw input for the agent (notes, transcripts, screenshots, links) goes in `docs/workflow/inbox/`; it is triaged at discovery and carries no authority.
3. Provision the approved workflow Git objects and an owner-installed copy of `bin/wf` outside the candidate checkout. Set `WF_VALIDATOR_REPO` and `WF_VALIDATOR_REV` in the trusted environment. The launcher extracts committed files at that full hash; it ignores candidate choices of executable code and rejects `WF_LOCAL`.
4. Provision the owner public key and signed receipts through `procedures/approval-evidence.md`. Establish source/result trust and the real approval path. A project-local launcher is convenient feedback only; authoritative CI must use the externally controlled launcher and settings.
5. Complete identity checks, fixtures, per-tool discovery and the observed assisted pilot. Record limitations in the setup record before declaring supported operation.

## Start or resume a task

Inspect actual Git/external state before resuming. Confirm the worker route, fetch the configured authoritative branch and record its exact full revision. Record the task's baseline results, starting revision and `governing_baseline_revision`, scope, feature readiness, milestone, acceptance IDs, verification and independent review plan. Reuse approved designs and contracts. Document existing failures for repairs.

The examples assume `WF_LAUNCHER`, `WF_PROJECT`, `WF_BASELINE`, `WF_CANDIDATE`, `WF_OWNER_KEY`, and `WF_RECEIPTS` were set by the trusted operator; `WF_BASELINE` is the freshly fetched authoritative SHA. Replace `OWNER/REPOSITORY` and `T-0001` with the project's values.

Run from the target checkout, or pass `--repo "$WF_PROJECT"` once to select it explicitly. The launcher defaults to the current Git root (current directory outside Git); repeated `--repo` options and missing values remain errors.

```sh
"$WF_LAUNCHER" records --baseline "$WF_BASELINE"
"$WF_LAUNCHER" readiness --baseline "$WF_BASELINE" --task T-0001 \
  --trust-key "$WF_OWNER_KEY" --receipts "$WF_RECEIPTS" --repository OWNER/REPOSITORY
```

In `enforced` mode (the baseline's config and profile both record it after setup steps 5 and 9) omit `--trust-key`, `--receipts` and `--repository`: the fetched authoritative baseline is the approval, and receipt-dependent evidence appears in the output as `unverified` items for the pull request review. In `manual` mode all three are required. In enforced mode the CLI is always a trusted gate: run `ci` on committed candidates, and use a directory baseline (`--baseline .` with `--changed`) for local diagnostics; a directory baseline never receives enforced trust.

Ready permits promoting a prepared Draft and starting eligible work. A bounded subset permits only the stated scope. Needs discovery or resolution identifies missing prerequisites. If a Blocked task's blocker was resolved, record that fact, clear its blocked state and rerun readiness. Agent-organised task changes cannot erase established prerequisites or change milestone/feature identity to avoid a gate.

## Review and integrate

Commit the candidate with the task ID first. Use a separate review context, resolve findings, assemble the latest baseline and rerun integration checks. Have the owner-controlled collector authenticate and sign verification, review and integration evidence. No owner credentials or signing keys enter the candidate test environment.

```sh
"$WF_LAUNCHER" ci --baseline "$WF_BASELINE" --candidate "$WF_CANDIDATE" --task T-0001 \
  --trust-key "$WF_OWNER_KEY" --receipts "$WF_RECEIPTS" --repository OWNER/REPOSITORY
```

The actual diff is computed from those immutable revisions. A candidate must include the current baseline. In `enforced` mode the owner's code-owner review of the pull request is the approval, and the `unverified` list in the `ci` output names what that review must cover: the posted test evidence, the independent review, the integration rerun. A manually supplied changed-path list is diagnostic only and is refused when approval evidence is supplied. Protected requirements/workflow changes require separate scoped receipts; they do not authorise dependent implementation in the same baseline.

## Accept, release and hand off

Use `procedures/accept-release.md`. `wf lifecycle --stage accept` checks the task's evidence and recorded owner decision; `--stage release` adds release readiness and authority. A milestone acceptance package must cover its complete scenario/task set, not just one task. Preserve the accepted-artifact relationship. Commands validate evidence; they do not deploy or publish. In `enforced` mode they list acceptance and release evidence as `unverified`; the acceptance record and the owner's approval of its pull request carry the decision. With the trust options supplied they run the full receipt gate instead.

Record a session outcome using `templates/session.json` outside the checkout, then validate it with `wf session --record PATH` and the same baseline/candidate/trust arguments. Post the outcome and handoff on the task's pull request (or issue): changes, verification revision, uncertainty, next action and **Workflow friction this session: none / report IDs**. Never commit logs or handoff files; the repository holds only what future work needs. Use `procedures/maintenance.md` for feedback and separately authorised repairs.

Other commands: `paths` classifies the actual diff; `acceptance` checks mappings/execution; `lifecycle --stage verify|integrate|accept|release` checks evidence stages; `status` prints a derived, read-only view for the owner (what is waiting on you, what is next for the agent, milestones and tasks with previewed blockers, open decisions, inbox and setup items) as Markdown, or as JSON with `--json`, and needs no baseline; given `--pull-requests` (`gh pr list` JSON) it also shows each task's claim; it never checks approval and grants nothing. On GitHub, the scaffold's `.github/workflows/wf-status.yml` posts the same view with the open pull requests to a *Project status* issue that the owner pins once, at the top of the Issues tab; each run replaces its text. All other commands print structured JSON (`--json` remains accepted). Exit codes: 0 satisfied, 1 blocked/failed, 2 invalid inputs or execution error. Directory inputs are for diagnostics and fixtures, not authoritative approvals.

## Central reporting and assisted runtime

After the owner-directed central mode is adopted, use [operations.md](procedures/operations.md) for `wf report`, `wf runtime` and `wf prepare-evidence`. Their configuration and private outbox live outside the product repository. Reporting works even when readiness blocks implementation; it cannot approve work. The evidence helper currently supports the included Node test reporter, produces unsigned drafts only, and does not imply compatibility with an uninspected product test runner.
