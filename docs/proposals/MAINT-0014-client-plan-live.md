# MAINT-0014: the client page shows the whole plan, live (design)

Status: design, awaiting the owner's review. Target release: v2.3.0 (minor: everything new is optional).

## The report

| Report | Classification | Evidence | Disposition |
|---|---|---|---|
| mateen-systems, 10–11 October 2026 (owner-merge, pinned to v2.2.0) | Improvement proposal | The published client page (https://cazy00.github.io/mateen-systems/) said "nothing is being built at this moment" while T-0009 had two commits on its branch that day: the page reads the trusted branch only and rebuilds only on a push to it. It shows three stages, while the project's plan runs to Phase 1's ten steps and going live (`docs/plans/phase-1-pilot.md`), which exist in no record the page reads. The current stage's parts are behind a disclosure, and accepted stages list none. | Fixed here |

The owner's brief, in their words: "what is important to the user is to see the full plan and see progress, see what have been done and what is being done, and what will be done. in real time. the plan can change its okay, things can be added to it. accordingly it will be updated remember 'real time'." The `wf-status` issue is the comparison they liked, "but not for a non technical person", and it addresses the developer.

Choices the owner made in the design conversation (11 October 2026):

- **Real time means within minutes**: the page rebuilds when work is pushed to a task branch, not only on merge. Not a live service; not daily.
- **Phase → step → part, opening up as the work arrives**: every step shows from the start; a step lists its parts once they are planned; finished steps keep their parts.
- **Approach 1**: a client plan file in the project, read by `wf status --client` in this repository, so every adopting project gets it.
- The page layout, plan file, live updates and delivery below, each section approved in turn.

## What the client sees

One self-contained HTML page, as today (no external requests, `noindex`, the project's `client.theme` and `client.language`). It addresses the client as *you* and the team as *we*; it never names a developer, an agent, an ID, a branch or a person. Top to bottom:

1. **Header.** The page title; one overall progress bar for the whole plan with a line such as "Step 3 of 12"; and "Last updated N minutes ago", where the page embeds the newest change time it read and the browser turns it into a relative time (with the absolute date as its `title`, and the absolute date alone when scripts are off).
2. **Now.** The parts in progress, each with the step it belongs to; then the parts being checked. When nothing is in progress: the part or step that starts next.
3. **Waiting on you.** Today's *Waiting on a decision* section, moved up: each Open or Proposed decision that holds up a part or step still open, its `client_question` and what it holds up. Absent when there are none.
4. **Recently done.** The five most recently finished parts, newest first, each with its date.
5. **The plan.** Each phase as a heading with its own progress bar and one-sentence summary; under it, each step as a row on a vertical timeline with its state chip (*Done*, *In progress*, *Next*, *Later*), title and one-sentence summary.
   - The step in progress (or, with none, the next step) is open and lists its parts, each with its state.
   - Done steps are closed and open to list what they delivered.
   - Later steps with no milestones say their parts are planned when we reach them; later steps with milestones list their planned parts closed.
   - A step or part added after the plan was shared carries an *Added* mark.
6. **Footer.** How to read the page in one line, and that it is read-only.

Dropped from today's page: the *Next* queue of four parts and the "stages delivered" and "parts done in the stages still open" counts. The timeline carries both.

Without `client.plan` the page is today's page, unchanged, except that accepted stages also list their parts (below, *Finished parts*) and the live reading (below) applies when enabled.

## The plan file

`client.plan` in `docs/workflow/config.json` names a JSON file in the repository, for example `docs/client-page/plan.json`. It is read at the same revision as the records (the trusted branch), so a branch cannot change it. It holds the plan's skeleton and its client wording only; every state comes from the records.

```json
{
  "phases": [
    {
      "title": "Foundations",
      "summary": "One sentence for the client.",
      "steps": [
        { "title": "…", "summary": "…", "done": true },
        { "title": "…", "summary": "…", "milestones": ["M-0001"] }
      ]
    },
    {
      "title": "The pilot",
      "summary": "…",
      "steps": [
        { "title": "…", "summary": "…", "milestones": ["M-0002", "M-0003"] },
        { "title": "…", "summary": "…" },
        { "title": "…", "summary": "…", "added": "2026-11-02" }
      ]
    }
  ]
}
```

Fields. `phases`: one or more. A phase has `title` (required), `summary` (optional) and `steps` (one or more). A step has `title` (required), `summary` (optional), `milestones` (milestone IDs, each in at most one step, in order), `done` (`true` for work finished before the project kept records; not allowed with `milestones`) and `added` (a date, `YYYY-MM-DD`). Any other key, a wrong type, a duplicate milestone or a file over 256 KB fails. Text is plain and escaped.

**A step's state**, first match wins:

| State | When |
|---|---|
| Done | `done: true`; or it has milestones and every one is Accepted or Released |
| In progress | one of its milestones is Active, Verified or Blocked; or one of its parts is in progress or being checked |
| Next | the first step in plan order that is neither Done nor In progress (at most one step is Next) |
| Later | anything else |

A step with Blocked milestones and no part moving shows *In progress* with its parts on hold, as the stage shows *Paused for now* today. Several steps may be In progress at once; *Now* lists them all.

**A step's parts** are the task records of its milestones, in milestone order, each milestone's planned `tasks` order first and then work added along the way (marked *Added*), as stages order them today. A part's state is today's mapping (Done, In progress for Active, Up next for Ready, Being planned for Draft, On hold for Blocked) plus *Being checked* from the live reading.

**Overall progress.** Each step counts 1. A Done step counts 1; a step with parts counts its share of parts done; any other step 0. The bar is the sum over the number of steps; each phase's bar is the same over its own steps. "Step N of M" names the first step not Done.

**Keeping it honest.**
- A milestone no step lists (and not in `client.exclude`) still shows: as its own step after the last phase's steps, marked *Added*, with the milestone's client title and outcome as its title and summary. `wf status --client` writes a warning naming it to standard error.
- A step that names a milestone with no record, or a `client.plan` path that does not exist, fails `wf status --client` with a message naming it, so the page is not published.
- A milestone in `client.exclude` is left out of its step; a step whose milestones are all excluded is left out.
- `procedures/readiness.md`, where milestone records are written, gains one line: when `client.plan` is set, the pull request that adds a milestone places it in a step. `wf status --client`'s warning is the check that catches a miss.

## Finished parts

Workflow rule: a task record is removed once its milestone is accepted. A finished step keeps its parts by reading history:

- For each milestone, the parts are its task records at the revision, plus every ID in its `tasks` list whose record is gone, read at the last commit on the trusted branch where `docs/workflow/tasks/<ID>.md` existed (`git log -1 --format=%H --diff-filter=D`, then its parent).
- A part's done date is the committer date of the first commit on the trusted branch where its record reads `status: Done` (`git log --reverse -S'status: Done'` on the record's path, verified by reading the record at that commit). Without Git (a directory source) there are no dates and *Recently done* is left out.
- History is read at most once per record and the page build stays under a few seconds for a few hundred records.

## Live reading

`wf status --client --live` adds, on top of the trusted branch's records, the state of parts on the branches being worked on.

- **Branches read.** Every remote branch (`refs/remotes/origin/*`) other than the trusted branch whose tip is newer than 14 days, or that has an open pull request. Branch names never appear on the page.
- **What a branch can change.** Only parts: a task record on the branch whose ID exists on the trusted branch, or that names a `milestone` that exists there. From it the page takes `status` and `client_title` (else `title`); nothing else. A branch cannot change phases, steps, milestones, decisions, wording of anything but its own parts, or the plan file.
- **Precedence.** The trusted branch's Done always wins. Otherwise a branch's Active beats the trusted branch's Draft or Ready. When two branches disagree about one part, the newer tip wins.
- **Being checked.** With `--pull-requests FILE` (the JSON the `wf-status` workflow already passes to `wf status`), a part whose branch has an open, non-draft pull request shows *Being checked*. Without the file, branch states alone apply.
- **Added parts.** A task record that exists only on a branch shows under its milestone's step, marked *Added*.
- **Updated time.** The newest committer date among the trusted branch's tip and the branches read.
- **Failure.** If listing or reading branches fails, the page renders from the trusted branch alone and writes a warning to standard error; it does not fail.

## Publishing within minutes

`templates/github/wf-client-page.yml` changes:

- Triggers: `push` to any branch, `pull_request` (`opened`, `reopened`, `ready_for_review`, `converted_to_draft`, `closed`), `workflow_dispatch`, and a daily `schedule`.
- GitHub Pages deploys only from the trusted branch, so a run on any other ref has one job: it dispatches this workflow on the trusted branch (`gh workflow run wf-client-page.yml --ref main`, with `actions: write`; GitHub lets the built-in token start a `workflow_dispatch` run). Only runs on the trusted branch build and deploy. Pull requests from forks get no token with `actions: write` and so cannot trigger a build.
- The build checks out the trusted branch with full history and all remote branches (`fetch-depth: 0`), writes open pull requests to a file with `gh pr list --json`, and runs `scripts/wf status --client --live --pull-requests FILE`.
- `concurrency: cancel-in-progress` keeps only the newest build.
- If the build fails, nothing deploys and the last good page stays live.

Expected delay from a push to the page: about two to three minutes (dispatch, build, Pages deploy). The mateen-systems rollout measures it.

## Code changes

- `validator/lib/client.js`: the plan layer (load and check the plan file, step states, parts per step, overall and phase progress, unplaced milestones), *Recently done*, parts of finished milestones from history, the live overlay, and the new layout in `renderClient`. Both languages' strings. Projects without `client.plan` keep today's view model and page apart from accepted stages listing their parts.
- `validator/lib/records.js`, where `client` keys are checked: `client.plan`, a safe repository path ending in `.json`. Liveness is a command option (`--live`), not configuration.
- `validator/cli.js`: `status --client` accepts `--live` and `--pull-requests`.
- `templates/github/wf-client-page.yml`: as above.
- `SCHEMA.md`: `client.plan`, the plan file's format, step states, the live reading. `QUICKSTART.md`: the two options. `CHANGELOG.md`, `upgrades.json`, `package.json` (2.3.0).
- `procedures/readiness.md`: the one line above.

## Tests

In `validator/test/client.test.js`, with fixtures built in temporary Git repositories as the existing tests do:

- The plan file: valid file; each failure (unknown key, wrong type, `done` with `milestones`, a milestone in two steps, a missing milestone record, a missing file).
- Step states: one case per row of the table, Blocked, several steps in progress, excluded milestones.
- Unplaced milestone: shown as an *Added* step at the end, and the warning written.
- Progress: overall and per phase, with a partly done step.
- Finished parts: a removed task record recovered from history with its title; done dates; no *Recently done* without Git.
- Live: a branch's Active shows *In progress*; the trusted branch's Done beats a stale branch; newer tip wins between branches; *Being checked* from the pull request file; a branch-only part shows *Added*; a branch changing a milestone's wording or the plan file changes nothing; a branch older than 14 days with no pull request is ignored; branch reading failure falls back with a warning.
- Privacy: the HTML holds no task or milestone ID, branch name, person or pull request number, in English and Arabic.
- Unchanged behaviour: the existing tests pass, adjusted only for accepted stages now listing parts.

Then `npm test`, an independent review in a separate context, and the mateen-systems page rendered with `--live` and checked in a browser at 1366 px and 360 px wide, light and dark.

## Rollout

1. **agent-workflow, MAINT-0014**, branch `claude/MAINT-0014-client-plan`: this design, the code, tests and documents in one pull request. Merging it is the owner's approval of the release; `release-tag.yml` tags v2.3.0.
2. **mateen-systems**, its own branch from `main` (not T-0009's): move the pin to v2.3.0 with `bin/wf-upgrade`; add `docs/client-page/plan.json` with Arabic titles and summaries for Phase 0 (its steps 1–7 `done`, step 8 M-0001), Phase 1's ten steps and going live (step 1 with M-0002 and M-0003), drafted for the owner to approve; Arabic `client_title`s for M-0001's and M-0002's parts where they are English; set `client.plan`; copy the new `wf-client-page.yml`. The owner merges it.
3. **Measured once live**: push a commit to a task branch and record the minutes until the page shows the part *In progress*, in the mateen-systems pull request.

## Not in this change

Notifications to the client, comments on the page, dates or estimates for future steps, a second language on one page, and a server that pushes changes to an open page.
