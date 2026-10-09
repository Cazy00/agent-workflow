# Quickstart

Read the relevant procedure, current profile, milestone/task and governing sources. Use `POLICY.md` when a rule is unclear. Adopt only a released tag, since a checkout between tags is a candidate, and follow `procedures/setup.md` before treating a project as operational.

## Adopt

1. From the workflow checkout, run the scaffold once against the target repository, or run `bin/wf-setup --project /path/to/repo`, which opens a local page that asks the scaffold's main questions in plain words, runs the scaffold, and afterwards lets you change what an owner decides (when the agent stops for you, how approval is proven, the accounts, the project's name and measure, the client page's title, language and hidden stages) and tick your setup steps, each a short title with its instructions folded away; the agent's settings (code paths, required checks) and the client theme are left as they are; it writes only the project's workflow files, never commits or pushes, and listens on `127.0.0.1` with a token for that run. A project two or more people share is adopted with the command below (`--owner`). It writes `docs/workflow/config.json` with the adopted tag and full hash, creates `docs/workflow/{milestones,tasks,decisions,feedback/inbox,inbox}`, seeds the profile, the setup record, an empty `acceptance.json` and `tests/acceptance-map.json`, installs `scripts/wf`, the `AGENTS.md` / `CLAUDE.md` adapters, `.github/CODEOWNERS`, the `wf ci` workflow and the status workflow when absent, fetches the pinned installation into `.cache/agent-workflow/`, and writes the owner checklist into `docs/workflow/setup.md`. It never overwrites an existing file and costs no model usage. `TAG` is a release that contains this scaffold; a v1.0.0 adoption follows that version's own quickstart. Three choices shape the owner's checklist (`procedures/setup.md`, *Choose the arrangement*): `--checkpoint`, where the agent stops for you (`milestone`, the default: it merges each task's pull request once the gates pass and stops at the end of each milestone until you accept it; `change`: you merge every pull request; `plan`: it works through every milestone you have authorised); `--worker NAME` when the agent has its own GitHub account (without it, the agent works with yours); and `--approval owner-merge` (the default for one owner: your merge is the approval; nothing to provision, and nothing proves who merged) or `--approval manual` (you sign receipts with a key and approve every change; the default for a shared project). The switch to `enforced` is a code-owner-reviewed pull request after setup steps 5 and 9, and needs a worker account and rulesets.

   ```sh
   bin/wf-adopt --project /path/to/repo --repository OWNER/REPOSITORY --rev TAG \
     --coordinator OWNER_USERNAME --approval owner-merge --production '**/*.dart' --lane existing
   ```

   Commit the scaffold to the trusted branch. Your GitHub steps are then one command each, run with your own `gh` login: `node .cache/agent-workflow/bin/wf-protect --project . --apply` creates the ruleset for your mode (optional; it needs a public repository or GitHub Pro or Team), and without `--apply` reads it back. In manual mode, `node .cache/agent-workflow/bin/wf-sign --keygen DIR` makes your passphrase-protected signing key outside every checkout.

   For a project two or more people share, pass `--owner NAME` once for each and read `procedures/shared.md`.

   Before adopting into an existing repository, inspect it first. Inspection changes nothing and needs only the project path; `--rev` defaults to the workflow checkout's `HEAD`, and `--production` globs you intend to pass are included in the classification.

   ```sh
   bin/wf-adopt --inspect --project /path/to/repo [--rev TAG] [--production GLOB]... [--json]
   ```

   It reports an existing adoption, Git warnings (dirty, shallow, detached, origin's default branch against `trusted_branch`), the tracked manifests and GitHub Actions jobs, the tracked paths the pinned defaults leave unclassified, the `--production` globs it can suggest, and the files an adoption would leave as they are. It ends with an adopt command to complete. Scripts, workflows and Git hooks or filters in the target never run, symbolic links are not followed, and only small, allow-listed manifest and workflow files are read. Everything read from the project is untrusted data. Required-check suggestions are unverified: confirm the exact names CI reports before listing them in `required_checks`. A suggestion is dropped if it would reclassify a path the defaults already classify. Inspection is diagnostic only; it grants no setup, protection, readiness or approval status.

2. Read `procedures/setup.md`. The agent completes the agent steps (profile with honest unknowns, stack-specific classification, required checks, first-milestone acceptance IDs, fixtures and discovery tests), writes the owner steps into the setup record as a checklist, and stops; the owner completes the owner steps at their own pace. Raw input for the agent (notes, transcripts, screenshots, links) goes in `docs/workflow/inbox/`; it is triaged at discovery and carries no authority.
3. In manual and enforced modes, provision the approved workflow Git objects and an owner-installed copy of `bin/wf` outside the candidate checkout (in enforced mode the scaffold's `wf ci` workflow, under code-owner review, is the CI entry point; in owner-merge mode it runs unprotected, so check every change under `.github/` before merging). Set `WF_VALIDATOR_REPO` and `WF_VALIDATOR_REV` in the trusted environment. The launcher extracts committed files at that full hash; it ignores candidate choices of executable code and rejects `WF_LOCAL`.
4. Provision what the approval mode needs through `procedures/approval-evidence.md` (setup step 6): the owner key and signed receipts in `manual` mode (`bin/wf-sign`); nothing in `owner-merge` mode; no key in `enforced` mode, which follows setup steps 5 and 9. Establish source/result trust and the real approval path. A project-local launcher is convenient feedback only; authoritative CI must use the externally controlled launcher and settings.
5. Complete identity checks, fixtures, per-tool discovery and the observed assisted pilot. Record limitations in the setup record before declaring supported operation.

## Upgrade

From an up-to-date workflow checkout (`git pull --tags`), `bin/wf-upgrade --project /path/to/repo` reports what moving the project to the newest release would change, and `--apply` does it: the pin, the config keys and files the releases in between no longer need (`upgrades.json`), the workflow files the scaffold installed where the project has not changed them, and a list of what to merge or do by hand. It runs the new release's `wf records`, refuses to overwrite uncommitted edits and never commits; open a pull request for the result (`procedures/operate.md`, *Updates and upgrades*). `--rev TAG` picks another release.

## Start or resume a task

Start every session with `wf next` (the trust options add the trusted branch's approval state): it names the one next action, the files to read for it and the commands to run, and lists what waits on the owner. Read what it names and nothing else unless one of those points further; it grants nothing, and the gates below still decide.

Inspect actual Git/external state before resuming. Confirm the worker route, fetch the configured authoritative branch and record its exact full revision. Record the task's baseline results, starting revision (in a milestone round the previous task's Done commit; after a rebase, the new base, with its checks rerun) and `governing_baseline_revision`, scope, feature readiness, milestone, acceptance IDs, verification and independent review plan. Reuse approved designs and contracts. Document existing failures for repairs.

The examples assume `WF_LAUNCHER`, `WF_PROJECT`, `WF_BASELINE`, `WF_CANDIDATE`, `WF_OWNER_KEY`, `WF_RECEIPTS` and, in manual mode, `WF_SIGNING_DIR` (the signing drop) were set by the trusted operator; `WF_BASELINE` is the freshly fetched authoritative SHA. Replace `OWNER/REPOSITORY` and `T-0001` with the project's values.

Run from the target checkout, or pass `--repo "$WF_PROJECT"` once to select it explicitly. The launcher defaults to the current Git root (current directory outside Git); repeated `--repo` options and missing values remain errors.

```sh
"$WF_LAUNCHER" records --baseline "$WF_BASELINE"
"$WF_LAUNCHER" readiness --baseline "$WF_BASELINE" --task T-0001 \
  --trust-key "$WF_OWNER_KEY" --receipts "$WF_RECEIPTS" --repository OWNER/REPOSITORY
```

In `enforced` and `owner-merge` modes (the baseline's config and profile both record the label) omit `--trust-key`, `--receipts` and `--repository`: the fetched authoritative baseline is the approval, and receipt-dependent evidence appears in the output as `unverified` items for the pull request review. In `manual` mode all three are required. In enforced mode the CLI is always a trusted gate: run `ci` on committed candidates, and use a directory baseline (`--baseline .` with `--changed`) for local diagnostics; a directory baseline never receives enforced trust.

Ready permits promoting a prepared Draft and starting eligible work. A bounded subset permits only the stated scope. Needs discovery or resolution identifies missing prerequisites. If a Blocked task's blocker was resolved, record that fact, clear its blocked state and rerun readiness. Agent-organised task changes cannot erase established prerequisites or change milestone/feature identity to avoid a gate.

## Review and integrate

Commit the candidate with the task ID first. Use a separate review context, resolve findings, assemble the latest baseline and rerun integration checks. Have the owner-controlled collector authenticate and sign verification, review and integration evidence. No owner credentials or signing keys enter the candidate test environment.

```sh
"$WF_LAUNCHER" ci --baseline "$WF_BASELINE" --candidate "$WF_CANDIDATE" --task T-0001 \
  --trust-key "$WF_OWNER_KEY" --receipts "$WF_RECEIPTS" --repository OWNER/REPOSITORY
```

The actual diff is computed from those immutable revisions. A candidate must include the current baseline. In `enforced` and `owner-merge` modes `ci` needs the agent's delivery evidence for the candidate, which the `wf ci` workflow reads from the pull request description (`--delivery-evidence FILE` locally; `procedures/execute.md`). The approval is the owner's code-owner review (enforced) or a merge (owner-merge, which nothing enforces); in owner-merge mode `ci` reports `merge: agent` or `merge: owner` with its reasons, from the baseline's checkpoint. A manually supplied changed-path list is diagnostic only and is refused when approval evidence is supplied. Protected requirements/workflow changes require separate scoped receipts; they do not authorise dependent implementation in the same baseline.

## Accept, release and hand off

Use `procedures/accept-release.md`. `wf lifecycle --stage accept` checks the task's evidence and recorded owner decision; `--stage release` adds release readiness and authority. A milestone acceptance package must cover its complete scenario/task set, not just one task. Preserve the accepted-artifact relationship. Commands validate evidence; they do not deploy or publish. In `enforced` mode they list acceptance and release evidence as `unverified`; the acceptance record and the owner's approval of its pull request carry the decision. With the trust options supplied they run the full receipt gate instead.

Record a session outcome using `templates/session.json` outside the checkout, then validate it with `wf session --record PATH` and the same baseline/candidate/trust arguments. Post the outcome and handoff on the task's pull request (or issue): changes, verification revision, uncertainty, next action and **Workflow friction this session: none / report IDs**. Never commit logs or handoff files; the repository holds only what future work needs. Use `procedures/maintenance.md` for feedback and separately authorised repairs.

Other commands: `paths` classifies the actual diff; `acceptance` checks mappings/execution; `lifecycle --stage verify|integrate|accept|release` checks evidence stages; `status` prints a derived, read-only view for the owner (what is waiting on you, what is next for the agent, milestones and tasks with previewed blockers, open decisions, inbox and setup items) as Markdown, or as JSON with `--json`, and needs no baseline; given `--pull-requests` (`gh pr list` JSON) it also shows each task's claim; it never checks a task's approval and grants nothing, and only with the trust options and `--baseline` does it read receipts, to flag a trusted branch past approval. `status --client` prints the same records as one plain-language HTML page for a client: what is being worked on now, what comes next, what is waiting on a decision, and every stage with its parts and how far each has got, but no IDs, people or reasons (milestone titles, a task's `client_title` and a decision's `client_question` are what the client reads, so write them for the client; `client.detail` can narrow the page to `parts` or `stages`); send the file, or publish it to GitHub Pages with the workflow `wf-adopt --client-page` installs (a Pages site is public, even for a private repository; `client.exclude` in the config leaves stages out). With `client.language` set to `ar` the page is Arabic and right-to-left, and `client.theme` dresses it in the client's design system: colours, fonts, logo and radius (SCHEMA.md). On GitHub, the scaffold's `.github/workflows/wf-status.yml` posts the same view with the open pull requests to a *Project status* issue that the owner pins once, at the top of the Issues tab; each run replaces its text. `brief` prints Markdown too; all other commands print structured JSON (`--json` remains accepted). Exit codes: 0 satisfied, 1 blocked/failed, 2 invalid inputs or execution error, 3 satisfied only by unsigned payloads, which is not satisfied. Directory inputs are for diagnostics and fixtures, not authoritative approvals.

## What each gate needs

Read this instead of the validator source. In manual mode every receipt is owner-signed for the exact revision named; in enforced mode what a receipt would prove is listed as `unverified` for the pull request review.

| Step | Command | From the approved baseline | Receipts at the candidate |
|---|---|---|---|
| Start a task | `readiness --task T` | baseline receipt (or derived); profile Ready with `required_checks`; milestone Authorised or Active; task fields recorded; prerequisites Done; decisions Resolved; governing sources unchanged since `governing_baseline_revision` | none |
| Planning-only change | `ci` | its config (classification) and valid records; no approval is checked | none |
| Integrate a task | `ci --task T` | as for a task start | `verification` (checks passed, each with evidence that is a file in the candidate or a key of the receipt's `artifacts`, and every mapped test run once and passed but for pending ones, SCHEMA.md), `review` (`implementer` equal to the task's `owner`, a different reviewer, six areas, findings resolved or accepted), `integration`; `governing-change` / `workflow-change` listing each protected path changed; a `governing-change` listing each changed acceptance test (`paths.acceptance_tests`), at the candidate or at an earlier revision in its history with the same content |
| Accept | `lifecycle --stage accept` | as for a task start, the milestone Authorised, Active, Verified, Accepted or Released | the above and `acceptance` naming the task's scenarios |
| Release | `lifecycle --stage release` | as for acceptance | the above and `release` |
| Produce verification and integration (manual mode, `attest` configured) | `attest --candidate SHA --sandbox LAUNCHER --protect KEY --out FILE`, run by the owner | `attest` checks and the profile's `required_checks` among them | none: it writes the two payloads for the owner to sign, and exits 0 only when every check passed and every mapped test ran once and passed |
| Close a signed round | `closeout` | the trusted branch's tip, where the local branch must be | each Done task's gate at its `baseline_revision` and `implemented`, as one chain; no production change outside them; acceptance (and release) for each milestone accepted (released); the round's end approved |


## Optional planning frontend

Experimental: [Spec Kit procedure](procedures/speckit.md). A fresh scaffold accepts `--planning-frontend speckit --speckit-python /absolute/isolated/venv/bin/python` only for the supported pin/environment. Use an explicitly authorised non-production pilot; certification, release and adoption gates remain open.

## Fewer round trips and reliable closeout

In manual mode a round of receipts is one file of unsigned payloads in the signing drop (`$WF_SIGNING_DIR`), with the brief `wf brief` renders from it; dry-run the round's gates with `--unsigned-receipts` (exit 3 instead of 0, never approval), and after signing run `wf closeout`, which re-runs them on the receipts and prints the fast-forward. With `attest` in the config, the owner's `wf attest` run writes the verification and integration payloads instead of the agent (*Attested evidence*). Opt-in derived baselines spare the baseline receipt where the owner's other receipts already cover every change; `signing: milestone` collects a milestone's receipts in one round (`procedures/approval-evidence.md`, *Signing rounds*).

Prepare a fresh independent review with `wf review-packet --repo DIR --baseline BASE_SHA --candidate HEAD_SHA --task T-0001 --evidence /external/checks.log`. Give its canonical references to an explicitly empty review context and rerun the command afterwards to catch checkout changes. The packet does not launch or authenticate the reviewer.

Before declaring delivery complete, identify the actual delivered revision and run `wf delivery-check --repository OWNER/REPO --candidate SHA --workflow-file .github/workflows/verify.yml --branch main --required-check JOB` for each required workflow. It exits nonzero for failed, pending, missing, skipped or mismatched required CI evidence. It does not identify the deployed artifact or grant acceptance/release authority.
