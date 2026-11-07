# Proposal — one release channel instead of a pin per project

Owner's request, 7 November 2026: "now it's put individually in each project and if we have 5 projects in development we need to update all of them one by one, why is it not central? how can we do that? it will be easier and instant."
Workflow version and immutable revision: v2.18.3, `2bf2a63` (main).
Status: proposal for the owner's approval, revised after its one plan review (last section). It changes POLICY (§ *Central workflow repository*: "each project adopts a tagged version and records its immutable revision"; "projects adopt released changes deliberately"), so it is a policy change (`procedures/maintenance.md`, *Changing the workflow during a project*). A MAINT number is assigned when it is approved; its plan is reviewed once before building.

## Why the pin exists, and what it costs

Each project names an exact revision in `docs/workflow/config.json` (`workflow.version`, `workflow.revision`). `wf-ci.yml`, `wf-status.yml` and `wf-client-page.yml` are copied into the project and fetch the validator at the **base** branch's pin; agents read procedures from the project's pinned installation; `bin/wf-upgrade` and `upgrades.json` move a pin and clean up. The pin protects two things:

1. **A pull request cannot change the rules that judge it.** The base branch's pin chooses the validator, not the candidate's.
2. **One bad release cannot break every project at once.** Each project moves when its own upgrade task passes.

The cost: every release is N upgrade pull requests, N CI runs, N merges, and N copies of the `.github/` files that drift. With five projects in development a fix reaches the last one days after the first, and a project forgotten for a month runs rules two releases old.

## Routes compared

| | A. Automated pin fan-out | B. Channel ref + one shared gate (chosen) | C. Channel file on `main` |
|---|---|---|---|
| How | A job opens and merges a pin-move PR in every project after each release | Config names `workflow.channel`; CI resolves a protected ref `channel/<name>` in this repository to a release commit at run time; the gate is a reusable workflow | Same, but the channel → revision map is a file (`channels.json`) on this repository's `main` |
| Reaches all projects | Minutes to hours; N PRs, N runs, N merges | Next run of each project (seconds) | Next run after the map's PR merges (CI on this repository first) |
| Protection 1 | Unchanged | Kept: the channel is named by the base config and moved only by the owner's identities | Kept, but anyone who can merge to `main` moves every project |
| Protection 2 | Unchanged | Kept by a canary channel and a one-move rollback | Kept by canary; rollback is a revert PR that waits on CI |
| Shared repos | A collaborator's approval on every PR | One opt-in approval, then nothing | One opt-in approval, then nothing |
| `.github/` copies | Still change each release | Stop changing (one thin caller) | Stop changing |
| Weakness | Not central; the cost the owner asked to remove | Moves are not Git history: logged separately (below) | Couples unreleased `main` to every project; slow rollback |

**Chosen: B.** It is the only route that is both central and instant in both directions (promote and roll back), and it reuses release tags, which only the reviewed release workflow can create.

## The design

### Config and resolution

- `docs/workflow/config.json` names **either** `workflow.channel` (`"stable"`, `"canary"`) **or** `workflow.revision` (a full hash), never both; `workflow.repo` stays. A revision is a **hold**: a project that must not move (a milestone near acceptance, a client freeze) pins, exactly as today.
- A channel is the branch `refs/heads/channel/<name>` in this repository. It always points at a commit that a release tag `vX.Y.Z` also points at.
- **Resolver** (`bin/wf-resolve`, one module with one job; contract *channel-resolve v1*): input the base config; output `{channel, revision, version}` or a failure. It reads the key from the base branch's config (never the candidate's). For a hold it returns `{channel: "hold", revision, version}` from the pin. For a channel it runs `git ls-remote` for `refs/heads/channel/<name>` and `refs/tags/v*` and requires, at the channel's commit: a `v*` tag; that tag's GitHub release, created by the release identity (below); and the commit reachable from `main`. It then fetches the commit by hash and verifies it, as `wf-ci.yml` verifies the pin today. Any failure (network, missing ref, no tag or release, a release by another author, both keys set) fails `wf ci` closed with the reason; it never falls back to `main` or to a cached revision. Tests: a tag pushed by another identity, and a tag without its release, are refused.
- **Visibility.** This repository is public, and that is part of the contract: `git ls-remote` and the fetch need no token, and GitHub lets any repository, private or owned by another account, call a reusable workflow in a public repository. The calling repository's own Actions policy must allow `Cazy00/agent-workflow` workflows (setting it is a step of the opt-in). Making this repository private would fail every channel project closed, so it is a major change.
- The local launcher (`bin/wf`) and `wf next` resolve the same way for feedback runs; authoritative runs stay in CI.

### One shared gate instead of copied files

- The gate's logic moves out of the YAML into the repository (`bin/wf-gate-ci`, the body of today's *Run the gate* step), so it is versioned with the validator and travels with the channel.
- `.github/workflows/wf-gate.yml` in this repository becomes a reusable workflow (`on: workflow_call`). It holds the job: runner choice, the exact-branch refusal, checkout, Node, `bin/wf-resolve`, then `bin/wf-gate-ci` **from the resolved revision**. The step summary's existing line becomes `Judged by agent-workflow v2.19.0 (abc123def456), channel stable, resolved at <time>`; `wf ci`'s JSON carries the same three fields.
- The project keeps one thin caller: its triggers, `permissions`, `concurrency` and one `uses: Cazy00/agent-workflow/.github/workflows/wf-gate.yml@channel/<name>` line. Triggers and permissions belong to the caller under GitHub's rules, so the caller changes only when they do, which is rare and is a major release.
- The caller's `@channel/<name>` chooses only the thin entry; the rules come from what the **base config** names, resolved inside. A held project's caller names its pin instead (`@<full hash>`), so holds of thin-caller projects must be v2.19.0 or later.
- **Caller/config check:** `wf ci` reads the `uses:` line from the caller file in the **head** checkout (no runtime context needed) and fails unless its ref equals the **head** config's channel or revision. Caller and config therefore move together in one PR; the base config is never compared with the head caller, so stable→canary and hold↔channel PRs pass.
- **Record:** the entry writes `{channel, revision, version}` as the output of a check run `wf resolved` on the judged commit (caller permission `checks: write`), which does not expire with the run's logs, and the status workflow copies it to the *Project status* issue.
- `wf-status.yml` and `wf-client-page.yml` get the same treatment. The gate and status callers also carry `workflow_dispatch` and a daily `schedule` on the trusted branch.
- Exposure is unchanged from today: a pull request already runs its own copy of the caller and could rewrite it; code-owner review of `.github/` (enforced mode) or the owner's check of every `.github/` change (owner-merge mode) is what protects it, as `procedures/setup.md` step 6 says now.

### Procedures and skills from one installation

Agents read procedures from a per-user installation instead of a copy per project. `wf install --channel stable` (new: the resolver, then a checkout of the verified commit) installs each verified revision into its own directory, `revisions/<hash>/`, made read-only, then switches the pointer `channels/<name>` to it atomically (a new symlink renamed over the old one). A session resolves the pointer once when it starts, logs the revision and reads that directory to its end, so a later switch never mixes two releases into one task. A revision directory is removed only when no session started in the last 7 days used it. The project's `AGENTS.md` names the channel; a project on a hold reads `revisions/<pin>/`.

### Releases that need a per-project change

No person moves a pin any more, so a release on a channel must not need one. Rules, enforced by `npm test` here:

- **Compatible within a major.** A release may add optional config keys and record fields with defaults; it may not make a record or config that is merged and valid under the previous release invalid. A key a release stops reading is ignored with a note, never an error, until the next major.
- **Tightening judges new changes, never history.** A release within a major may make a rule stricter when (a) every merged record and config valid under the previous release stays valid, and (b) the stricter rule applies only to records and config a pull request adds or modifies, compared with its base; a record the pull request does not touch, and every trusted-branch run, is judged by the previous rule. A tightening that must reach existing records is a major.
- **Forward-tolerant for rollback.** The previous release on the channel must accept what the new one writes: within a major, the validator notes an unknown optional key instead of failing on it.
- **Fixture** `validator/test/channel-compat.test.js`, both directions: the candidate validator over the previous release's fixture projects and every `templates/` record (any new failure fails the build, except a tightened rule's own fixture that edits a record), and the previous release's validator over the candidate's new fixtures, which must pass with notes at most.
- **`upgrades.json` entries on a channel release** may only carry automated cleanup (`remove_config`, `add_files`); a `notes` step a person must do makes the release a major.
- **A major release gets a new channel** (`stable-3`). Moving a project to it is one migration PR per project, opened by the agent with `bin/wf-upgrade --to-channel stable-3 --apply` and merged on the project's normal merge route. That is the only per-project step left, once per major.

### Active milestones

A milestone's `workflow_version` becomes the channel name for a project on a channel; `wf records` requires it to equal the config's channel, as it requires the pin today. The adoption of a channel is the deliberate adoption POLICY asks for; after it, rules reach an active milestone only through a channel move, which is announced (below) and recorded in every run, never silent. This sentence is the POLICY amendment the owner approves.

### Who may move a channel

- **Channel ruleset** (target branches, include `refs/heads/channel/*`): restrict creations, restrict updates, restrict deletions, block force pushes; bypass list: the owner's account and one move identity (a GitHub App held by the owner's broker, never an agent's own token).
- **Tag ruleset** (target tags, include `refs/tags/v*`): restrict creations, restrict updates, restrict deletions, block force pushes; bypass list: only the **release App**, a dedicated GitHub App whose key is a secret of a `release` environment that only `main` may deploy to. `release-tag.yml` runs in that environment on `main` pushes, mints the App's token, pushes the tag and creates the tag's GitHub release with it. The Actions token cannot be the bypass, since every workflow holds it. The owner sets both rulesets once.
- **Release approval:** a version bump merges after one deep review of its final head (recommended default), not the owner's merge; the tag follows from the merge. A move can choose only among releases made that way.
- **History:** the broker keeps each channel's moves in its own append-only store: channel, from and to revision and version, time, identity, kind (forward or rollback), why. Before a move it checks that the ref equals the store's last `to`, and refuses on a mismatch. The soak and rollback are computed from this store only.
- **canary:** moved forward to each new release as soon as it is tagged. Right after, the broker dispatches the gate and status workflows on the canary project's trusted branch; the daily schedule keeps exercising it.
- **stable:** promoted automatically, no tap, to the canary's release once the store shows canary moved to it at least 24 hours ago and the canary's trusted branch has a passing gate run and status run that started after that move and whose `wf resolved` record names that revision (the soak).
- **Rollback** undoes the channel's latest move, and only if that move was forward: the target is that move's `from`, the revision the channel held before it. With no forward move in between, a second rollback is refused, so rollbacks never walk to older releases. Allowed at any time with no soak. Any other backward move is the owner's own, by the owner's account, since an older release can be a weaker rule set. Tests: a double rollback and a forged *Channels* comment change nothing.
- **Log:** each move posts a comment on a pinned *Channels* issue in this repository and on each channel project's *Project status* issue at its next refresh. The issue is a log for people and is never read back.

### Failure and rollback

- **Bad release on canary:** only the canary project's runs fail or misjudge. Move canary back; stable never saw it.
- **Bad release on stable:** every channel project's next run uses it. One move back fixes every project at its next run; no project PR is needed. `wf channel audit --revision X` (new, read-only) lists, per project, the pull requests whose `wf ci` ran at X and merged, from their `wf resolved` check-run records, for the owner to recheck.
- **Resolution fails** (GitHub down, ref deleted): `wf ci` fails closed in every channel project, as a failed pin fetch does today. Recovery: restore the ref; a project that cannot wait sets a hold.
- **A run straddles a move:** the entry and the gate script could come from different releases. The entry's contract (inputs, the resolved fields it logs) is versioned and changes only on a major, so either combination is valid; the logged revision is the one that judged.
- **A pull request green before a move** keeps its check; GitHub does not rerun it. Its run names the revision that judged it.

### Shared repositories

A repository with two or more `owners` stays on a hold by default. It opts in only when every owner approves the opt-in PR (the config is approved by the person whose agent did not write it, `procedures/shared.md`), and its profile's *Authority* then records that channel moves by this repository's owner apply to it. A collaborator can leave the channel at any time with a hold PR.

### Opting in

Two PRs per project, both on its normal merge route (for a shared repository, as above):

1. **Pin to v2.19.0 or later**, an ordinary pin-move PR on today's copied files. It is needed because on `pull_request` GitHub runs the head's workflow file, so the opt-in PR's thin caller runs against the base config, and a v2.18.3 pin has no `bin/wf-gate-ci`.
2. **Opt in:** `bin/wf-upgrade --project PATH --to-channel stable --apply` replaces `workflow.revision` with `workflow.channel`, replaces the three copied workflow files with the thin callers where the project has not changed them (else lists them), sets each active milestone's `workflow_version` to the channel and runs `wf records`.

The opt-in PR passes: the head caller runs the entry from `channel/stable`; the resolver reads the base config, still `workflow.revision` at v2.19.0, and returns the hold, so `bin/wf-gate-ci` runs from that pinned revision, as protection 1 requires; the caller/config check compares the head caller (`@channel/stable`) with the head config (`stable`) and they agree. After the merge the base names the channel and every later run resolves it. The project takes no further pin-move PR within the major.

## Replace test

To replace the channel mechanism (for example with route C's file, or a signed manifest): only `bin/wf-resolve` and the broker op that moves a channel change. The contract stays: the base config names a channel; the resolver returns a full revision with its release tag or fails closed; every run logs `{channel, revision, version}`. Projects, callers, the gate script and the records do not change.

## Rollout order

1. The owner approves this proposal and its POLICY sentences; its plan is reviewed once.
2. Release v2.19.0 here: `bin/wf-resolve`, `bin/wf-gate-ci`, the reusable `wf-gate.yml` and the two status workflows, `workflow.channel` in the validator and `wf records`, the compatibility fixture, `wf-upgrade --to-channel`, `wf install`, `wf channel audit`. Pinned projects keep working unchanged.
3. Create `channel/canary` and `channel/stable` at v2.19.0, both rulesets, the release App and its `release` environment, and the *Channels* issue (owner's identity; one-time). v2.19.0 itself is tagged by `release-tag.yml` after the App is in place, so it carries a release by the App.
4. Workspace side (list below) ships the move op.
5. One single-owner project goes to `canary` (its last pin-move PR) and holds through at least one release.
6. The other single-owner projects go to `stable`, one opt-in PR each.
7. Shared repositories: offered to their owners; on a hold until each approves.

## What the owner's workspace must change (for its own plan)

- **Broker:** a new op `wf-channel-move <channel> <tag>` holding the release identity: canary forward to a release the resolver accepts, then dispatch the canary's runs (notify); stable only after the soak check (notify); rollback as defined above (notify, always available); anything else refused. It keeps the append-only move history. The move identity is on the channel ruleset's bypass list and nowhere else.
- **Task merge route:** the per-project pin-move category becomes the one-time opt-in PR, the hold and unhold PRs, and the once-per-major migration PR; routine pin moves for channel projects stop.
- **Release routine:** after each tag, move canary; after the soak, promote stable; post both on the *Channels* issue.
- **Skills sync:** install and refresh the channel installations on each machine (`wf install --channel …`) instead of a copy per project; project guides point at the channel.
- **Monitoring:** a daily check that each channel project's latest trusted-branch run resolved its channel's current revision; a mismatch or a resolve failure is an issue.
- **Records:** which project is on which channel or hold, and which is the canary; the weekly review lists channel moves and holds.

## Owner decisions

Promotion to stable is automatic after the soak (24 hours and the passing runs above), and a release needs one deep review, not the owner's merge, following the owner's decision of 7 November 2026 to keep taps for permanent deletion and money only. What remains:

1. Approve the POLICY wording: adopting a channel is the deliberate adoption, and channel moves reach active milestones, logged.
2. Which project is the canary.
3. Shared repositories stay on a hold until every owner opts in (recommended).

## Size

No procedure text changes in this proposal. The implementation's maintenance record will report the corpus word counts before and after (`procedures/maintenance.md`); `procedures/operate.md` *Updates and upgrades* is expected to get shorter.

## Plan review (2026-11-07, FAIL) and what changed

- F1 (blocking, tags were the whole authority): a tag ruleset on `refs/tags/v*` lets only the release App create, move or delete tags; the resolver also requires the tag's GitHub release by that App and the commit on `main`; rogue-tag tests added.
- F2 (blocking, the opt-in PR could not pass): opting in is two PRs (pin to v2.19.0+, then the channel); the resolver serves holds; the caller/config check compares head caller with head config; the first opt-in PR is walked through.
- F3 (blocking, no source of truth for history): the broker keeps an append-only move history; rollback is the `from` of the latest move when that was forward; the *Channels* issue is never read back.
- F4 (should-fix, quiet canary stalls the soak): the broker dispatches gate and status runs on the canary's trusted branch after each move, plus a daily schedule; promotion checks those runs.
- F5 (should-fix, no tightening within a major): tightening allowed when it judges only what a pull request adds or modifies; the fixture also runs the previous validator over the candidate's new fixtures.
- F6 (should-fix, access unstated): this repository is public; what that gives `ls-remote` and reusable-workflow calls, including from other accounts, is stated, with the caller's Actions policy as an opt-in step.
- F7 (should-fix, in-place refresh): one directory per verified revision, an atomic channel pointer, and each session keeps its starting revision.
- F8 (note, logs expire): `{channel, revision, version}` is recorded in a `wf resolved` check run and the *Project status* issue; the audit reads those.
