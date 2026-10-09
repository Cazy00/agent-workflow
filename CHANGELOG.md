# Changelog

Releases are tags. From `v1.6.0` a release is tagged by `.github/workflows/release-tag.yml` when the owner merges the pull request that bumps `package.json`; review and owner approval precede every tag. A project adopts a release only by moving its pin, with `bin/wf-upgrade` from `v2.0.0`; a new tag never upgrades a project by itself. What a project must do when it moves to a release is under that release, and `bin/wf-upgrade` lists it from `upgrades.json`.

## v2.1.0

Lets owner-approved acceptance tests be approved before the work and fail until it is done, in every mode (MAINT-0012).

- **Pending scenarios:** while a milestone is `Authorised`, `Active` or `Blocked` on the approved baseline, the mapped tests of a scenario it lists may fail, or not run, as long as a task of that milestone serving the scenario is neither `Done` there nor delivered by the candidate. Every other mapped test must still run once and pass, and a pending one must from the pull request that delivers its last task. The baseline's records decide, so a candidate cannot make its own failing test pending. Before this, every mapped test had to pass on every production pull request, so tests written ahead of the work blocked every other task until all of them passed.
- `wf ci`, `wf acceptance` and `wf lifecycle` apply it and name each pending test that did not pass in a `note:` finding; `wf brief` lists one for judgement instead of refusing the file, with `--baseline` and a round end. `wf attest` and derived baselines excuse none: a check's exit status cannot tell a pending failure from another.

Moving a project to this pin: nothing changes until it maps tests ahead of the work. Then run them where a pending failure fails no required check (a CI job of their own, not in `required_checks`), and list every mapped test in the delivery evidence.

## v2.0.0

Removes what no project used, and lets an upgrade clean up after older releases.

- **Removed:** central reporting and the runtime ledger (`wf report`, `wf runtime`, `wf prepare-evidence`, `procedures/operations.md`), agent-operated routine merges in enforced mode (`delegation.routine`, `--pull-request`), and local batches (`delivery.batching`, `--tasks`). An owner-merge checkpoint now lets the agent merge, and one pull request carries one task. The config keys nothing reads any more (`delegation`, `delivery`, `execution`, `setup_budget_days`) are no longer written; a config that still switches the routine lane or batches on is refused with a message saying so.
- **Added `bin/wf-upgrade`:** it moves a project's pin and removes what the releases in between left behind: the config keys and files listed in `upgrades.json`, the workflow files the scaffold installed (refreshed where the project has not changed them), and the steps each release leaves to the owner, listed. It reports first, writes only with `--apply`, refuses to overwrite uncommitted edits, runs the new release's `wf records`, and never commits. Removing the unread keys does not stale any task's readiness.
- **Restructured:** this changelog holds the release history the README used to; `procedures/execute.md` is shorter; `procedures/delivery.md` keeps only its CI advice.

Moving a project to this pin: run `bin/wf-upgrade --project PATH` from an up-to-date workflow checkout, review its report, then `--apply` and open a pull request. If the project used central reporting, delete its external operations config and runtime directory too.

## v1.14.0

Makes setup a choice of where the agent stops rather than of approval machinery, and keeps the quality gates the same in every mode. A single owner now adopts in owner-merge mode with a checkpoint (`approval.checkpoint`): `milestone` by default (the agent merges each task's pull request once the gates pass, and stops when a milestone is finished until the owner accepts it), `change` (the owner merges every pull request) or `plan` (no stop between the milestones the owner authorised); the setup page asks this first and keeps signed receipts under *Stricter proof*. In enforced and owner-merge modes `wf ci` now requires the agent's delivery evidence for a production change, read from the pull request description, and checks it as manual mode checks receipts (required checks passed, every mapped test run once, a separate-context review with every finding dealt with); in owner-merge mode it also reports who merges and why, and changes to governing paths, the workflow or acceptance tests always go to the owner. The owner's setup checklist lists only what they must do (with one account and owner-merge, nothing) and keeps the rest under *Optional*, which `wf status` does not count; the agent's setup takes two sessions; personal account references are gone from the policy. Before moving an enforced or owner-merge project to this pin: its production pull requests fail `wf ci` until they carry the evidence block, so replace its `.github/workflows/wf-ci.yml` with the new template (a workflow change), which reads the description and reruns when it is edited; an owner-merge project from `v1.11.0` to `v1.13.0` keeps the owner merging every pull request until its config gains a checkpoint (the owner then accepts a milestone by merging the pull request that sets it Accepted, which `wf ci` always leaves to the owner), and its `AGENTS.md` forbids the agent to merge until it takes the new scaffold's sentence.

## v1.13.0

Adds `bin/wf-setup`, a local page for setup and later changes: it asks four questions in plain words and runs the scaffold, working out the rest itself, then edits only what an owner decides (approval, accounts, the project's name and measure, the client page's title, language and hidden stages) and lets the owner tick their setup steps, each a short title with its instructions folded away; the agent's settings and the client theme are kept as they are, every save is validated first, and the config and profile labels stay in sync; it writes only the workflow files, never commits, pushes or approves, and accepts only its own page's requests (127.0.0.1, a token for the run, its own Host); a shared project is adopted with the command line.

## v1.12.0

Adds a page for clients: `wf status --client` renders the records as one plain-language, self-contained HTML page (what is being worked on now, what comes next, what waits on a decision, and every stage with its parts and their state, in plain words; no IDs, people or reasons) to send as a file, or to publish on GitHub Pages with the workflow `wf-adopt --client-page` installs, which is public even for a private repository. It follows the client's design system (`client.theme`: colours, fonts, logo, radius, embedded) and language (`client.language`: English, or Arabic right-to-left).

## v1.11.0

Makes setup lighter without dropping an agent step: one GitHub account is an approved arrangement, `owner-merge` is a third approval mode for one account or no rulesets (the owner's own merge is the approval, stated as unproven), `bin/wf-protect` applies and reads back the protections in one command and replaces the disposable-repository test as the default evidence before enforced mode, `bin/wf-sign` makes the key and signs rounds, the scaffold writes `CODEOWNERS` and the `wf ci` workflow, central reporting leaves the default checklist, `wf next` works before the scaffold is committed, and `claude/T-0001-…` branches name their task. A single-owner manual-mode project moving its pin should know that `wf-protect --apply` turns auto-merge off, while its `AGENTS.md` from an earlier scaffold still tells the agent to turn it on: replace that sentence with the new scaffold's (a governing change).

## v1.10.1

Keeps sessions short without the owner restarting them between tasks: inside a signing round the coordinator hands each task to a fresh helper agent and keeps only its result; at a signing round a new session starts, never one carried over by `/compact`, whose summary no gate checks; and new projects' `CLAUDE.md` carries a *Compact Instructions* section that asks every compaction to keep the task's IDs, commits, decisions and open items, and tells the agent to recheck `wf next` and git afterwards. Claude Code does not always follow such instructions after compacting, which is why the recheck matters. Existing projects copy `templates/claude/compact-instructions.md` into their own `CLAUDE.md` (a governing change); the scaffold says so when one already exists. In enforced mode the owner still reviews each pull request. The evidence is in `docs/proposals/sources/compact-reliability.md`.

## v1.10.0

Arranges the workflow around how an agent works rather than how a team of people works: `wf next` works out the next action from the records, so a session reads what that action needs and carries no milestone history; owner-approved acceptance tests (`paths.acceptance_tests`) need the owner's receipt for every change, so the agent that writes the code cannot also rewrite the tests that judge it; in manual mode `wf attest` lets the owner's machine run the checks in a sandbox and write the verification the owner signs; and review prefers a reviewer from another model family, with a reproduction for each blocking finding. All of it is opt-in for an existing project: nothing changes until its config names `paths.acceptance_tests` or `attest`, both workflow changes the owner signs; new projects get `paths.acceptance_tests` by default.

## v1.9.0

Cuts manual-mode signing rounds while keeping every stage and protected-path receipt: unsigned dry runs that exit 3, opt-in derived baselines, optional one round per milestone, `wf closeout` after signing and `wf brief` for the owner; it also checks acceptance files with the records, flags a trusted branch that moved past approval, and keeps reviewers in the foreground. Before moving a project's pin to it, run its `wf records`: malformed acceptance files (IDs outside `AC-NNN-N`, duplicates, unknown methods, missing requirement or test files, mappings to undefined IDs) now fail `wf records` and every `wf ci`.

## v1.8.0

Read-only setup inspection, bounded local batches, opt-in agent-operated routine integration, explicit pre-merge gates, fresh-context review packets and exact-revision delivery checks.

## v1.7.0

Coherent task grouping, bounded coordination and repeated checks, quality-aware measurements, and an optional experimental Spec Kit planning adapter under existing approval controls.

## v1.6.2

A required test can be renamed through an exact old/new mapping pair approved in the baseline.

## v1.6.1

Setup records, for a single owner, the repository settings that let records-only pull requests merge by themselves.

## v1.6.0

Fewer round trips: a task marked Done in its own pull request, pin moves no longer stale readiness, releases tagged on merge.

## v1.5.0

A status view that is easier to read: counts, tables, a diagram of blocking decisions, details folded away.

## v1.4.2

A baseline without `tests/acceptance-map.json` requires no mappings, so a project moving its pin can add the map.

## v1.4.1

Readiness no longer blocks a task on a superseded decision reached only through a feature, milestone or path effect.

## v1.4.0

## v1.3.0

## v1.2.0

## v1.1.0

## v1.0.0

PrintFlow ran it until it moved to `v1.4.1` on 2026-09-26.
