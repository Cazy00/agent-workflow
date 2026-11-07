# Proposal — one release channel instead of a pin per project

Owner's request, 7 November 2026: "now it's put individually in each project and if we have 5 projects in development we need to update all of them one by one, why is it not central? how can we do that? it will be easier and instant."
Workflow version and immutable revision: v2.18.3, `2bf2a63` (main).
Status: proposal for the owner's approval. It changes POLICY (§ *Central workflow repository*: "each project adopts a tagged version and records its immutable revision"; "projects adopt released changes deliberately"), so it is a policy change (`procedures/maintenance.md`, *Changing the workflow during a project*). A MAINT number is assigned when it is approved; its plan is reviewed once before building.

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

**Chosen: B.** It is the only route that is both central and instant in both directions (promote and roll back), and it reuses release tags the owner already approves.

## The design

### Config and resolution

- `docs/workflow/config.json` names **either** `workflow.channel` (`"stable"`, `"canary"`) **or** `workflow.revision` (a full hash), never both; `workflow.repo` stays. A revision is a **hold**: a project that must not move (a milestone near acceptance, a client freeze) pins, exactly as today.
- A channel is the branch `refs/heads/channel/<name>` in this repository. It always points at a commit that a release tag `vX.Y.Z` also points at.
- **Resolver** (`bin/wf-resolve`, one module with one job; contract *channel-resolve v1*): input the base config; output `{channel, revision, version}` or a failure. It reads the channel name from the base branch's config (never the candidate's), runs `git ls-remote` for `refs/heads/channel/<name>` and `refs/tags/v*`, requires a release tag at the same commit, fetches that commit by hash and verifies it, as `wf-ci.yml` verifies the pin today. Any failure (network, missing ref, no tag at the commit, both keys set) fails `wf ci` closed with the reason; it never falls back to `main` or to a cached revision.
- The local launcher (`bin/wf`) and `wf next` resolve the same way for feedback runs; authoritative runs stay in CI.

### One shared gate instead of copied files

- The gate's logic moves out of the YAML into the repository (`bin/wf-gate-ci`, the body of today's *Run the gate* step), so it is versioned with the validator and travels with the channel.
- `.github/workflows/wf-gate.yml` in this repository becomes a reusable workflow (`on: workflow_call`). It holds the job: runner choice, the exact-branch refusal, checkout, Node, `bin/wf-resolve`, then `bin/wf-gate-ci` **from the resolved revision**. The step summary's existing line becomes `Judged by agent-workflow v2.19.0 (abc123def456), channel stable, resolved at <time>`; `wf ci`'s JSON carries the same three fields.
- The project keeps one thin caller: its triggers, `permissions`, `concurrency` and one `uses: Cazy00/agent-workflow/.github/workflows/wf-gate.yml@channel/<name>` line. Triggers and permissions belong to the caller under GitHub's rules, so the caller changes only when they do, which is rare and is a major release.
- The caller's `@channel/<name>` chooses only the thin entry; the rules come from the channel the **base config** names, resolved inside. `wf ci` fails when the caller's channel and the config's differ, so they move together in one PR.
- `wf-status.yml` and `wf-client-page.yml` get the same treatment.
- Exposure is unchanged from today: a pull request already runs its own copy of the caller and could rewrite it; code-owner review of `.github/` (enforced mode) or the owner's check of every `.github/` change (owner-merge mode) is what protects it, as `procedures/setup.md` step 6 says now.

### Procedures and skills from one installation

Agents read procedures from one installation per machine and channel, kept at the channel's revision, instead of a copy per project. The project's `AGENTS.md` names the channel; `wf install --channel stable` (new, the resolver plus a checkout of the verified commit into a per-user directory) refreshes it at session start. A project on a hold reads an installation at its pin, as now.

### Releases that need a per-project change

No person moves a pin any more, so a release on a channel must not need one. Rules, enforced by `npm test` here:

- **Compatible within a major.** A release may add optional config keys and record fields with defaults; it may not make a valid record or config of the previous release invalid. A key a release stops reading is ignored with a note, never an error, until the next major. Fixture: `validator/test/channel-compat.test.js` runs the candidate validator over the previous release's fixture projects and every `templates/` record; any new failure fails the build.
- **Forward-tolerant for rollback.** The previous release on the channel must accept what the new one writes: within a major, the validator notes an unknown optional key instead of failing on it.
- **`upgrades.json` entries on a channel release** may only carry automated cleanup (`remove_config`, `add_files`); a `notes` step a person must do makes the release a major.
- **A major release gets a new channel** (`stable-3`). Moving a project to it is one migration PR per project, opened by the agent with `bin/wf-upgrade --to-channel stable-3 --apply` and merged on the project's normal merge route. That is the only per-project step left, once per major.

### Active milestones

A milestone's `workflow_version` becomes the channel name for a project on a channel; `wf records` requires it to equal the config's channel, as it requires the pin today. The adoption of a channel is the deliberate adoption POLICY asks for; after it, rules reach an active milestone only through a channel move, which is announced (below) and recorded in every run, never silent. This sentence is the POLICY amendment the owner approves.

### Who may move a channel

- A repository ruleset on `refs/heads/channel/*` forbids creation, update, deletion and force pushes for everyone except a bypass list: the owner's account and one release identity (a GitHub App or deploy key held by the owner's broker, never by an agent's own token).
- A move is allowed only to a commit with a release tag; release tags come only from `release-tag.yml` on the owner's merge of a version bump, so a move can choose only among releases the owner approved.
- **canary:** moved to each new release as soon as it is tagged.
- **stable:** promoted to the canary's release once the canary has held it at least 24 hours and the canary project's trusted-branch `wf ci` and status runs passed at it (the soak). The broker's op checks both before moving.
- **Rollback:** a move back to the release the channel held immediately before, allowed at any time with no soak. A move to any older release is the owner's, since an older release can be a weaker rule set and an agent's own pull request could benefit from it.
- **Log:** each move posts a comment on a pinned *Channels* issue in this repository (channel, from, to, by which identity, why) and on each channel project's *Project status* issue at its next refresh. GitHub's ruleset and audit history are the second record.

### Failure and rollback

- **Bad release on canary:** only the canary project's runs fail or misjudge. Move canary back; stable never saw it.
- **Bad release on stable:** every channel project's next run uses it. One move back fixes every project at its next run; no project PR is needed. `wf channel audit --revision X` (new, read-only) lists, per project, the pull requests whose `wf ci` ran at X and merged, from the logged revision, for the owner to recheck.
- **Resolution fails** (GitHub down, ref deleted): `wf ci` fails closed in every channel project, as a failed pin fetch does today. Recovery: restore the ref; a project that cannot wait sets a hold.
- **A run straddles a move:** the entry and the gate script could come from different releases. The entry's contract (inputs, the resolved fields it logs) is versioned and changes only on a major, so either combination is valid; the logged revision is the one that judged.
- **A pull request green before a move** keeps its check; GitHub does not rerun it. Its run names the revision that judged it.

### Shared repositories

A repository with two or more `owners` stays on a hold by default. It opts in only when every owner approves the opt-in PR (the config is approved by the person whose agent did not write it, `procedures/shared.md`), and its profile's *Authority* then records that channel moves by this repository's owner apply to it. A collaborator can leave the channel at any time with a hold PR.

### Opting in

One last pin-move PR per project: `bin/wf-upgrade --project PATH --to-channel stable --apply` replaces `workflow.revision` with `workflow.channel`, replaces the three copied workflow files with the thin callers where the project has not changed them (else lists them), sets each active milestone's `workflow_version` to the channel and runs `wf records`. Merged on the project's normal route; for a shared repository, as above. After that the project never takes another pin-move PR within the major.

## Replace test

To replace the channel mechanism (for example with route C's file, or a signed manifest): only `bin/wf-resolve` and the broker op that moves a channel change. The contract stays: the base config names a channel; the resolver returns a full revision with its release tag or fails closed; every run logs `{channel, revision, version}`. Projects, callers, the gate script and the records do not change.

## Rollout order

1. The owner approves this proposal and its POLICY sentences; its plan is reviewed once.
2. Release v2.19.0 here: `bin/wf-resolve`, `bin/wf-gate-ci`, the reusable `wf-gate.yml` and the two status workflows, `workflow.channel` in the validator and `wf records`, the compatibility fixture, `wf-upgrade --to-channel`, `wf install`, `wf channel audit`. Pinned projects keep working unchanged.
3. Create `channel/canary` and `channel/stable` at v2.19.0, the ruleset, and the *Channels* issue (owner's identity; one-time).
4. Workspace side (list below) ships the move op.
5. One single-owner project goes to `canary` (its last pin-move PR) and holds through at least one release.
6. The other single-owner projects go to `stable`, one opt-in PR each.
7. Shared repositories: offered to their owners; on a hold until each approves.

## What the owner's workspace must change (for its own plan)

- **Broker:** a new op `wf-channel-move <channel> <tag>` holding the release identity: canary on any release tag (notify); stable only after the soak check (notify, or tap by the owner's decision below); rollback to the previous release (notify, always available); anything else refused. The identity is added to the ruleset's bypass list and nowhere else.
- **Task merge route:** the per-project pin-move category becomes the one-time opt-in PR, the hold and unhold PRs, and the once-per-major migration PR; routine pin moves for channel projects stop.
- **Release routine:** after each tag, move canary; after the soak, promote stable; post both on the *Channels* issue.
- **Skills sync:** install and refresh the channel installations on each machine (`wf install --channel …`) instead of a copy per project; project guides point at the channel.
- **Monitoring:** a daily check that each channel project's latest trusted-branch run resolved its channel's current revision; a mismatch or a resolve failure is an issue.
- **Records:** which project is on which channel or hold, and which is the canary; the weekly review lists channel moves and holds.

## Owner decisions

1. Approve the POLICY change: adopting a channel is the deliberate adoption, and channel moves reach active milestones, logged.
2. Promotion to stable: the agent after the soak, no tap (recommended: the release itself was already the owner's approval), or a tap each time.
3. The soak: 24 hours and one passing trusted-branch run on the canary (recommended), or longer.
4. Which project is the canary.
5. Shared repositories stay on a hold until every owner opts in (recommended).

## Size

No procedure text changes in this proposal. The implementation's maintenance record will report the corpus word counts before and after (`procedures/maintenance.md`); `procedures/operate.md` *Updates and upgrades* is expected to get shorter.
