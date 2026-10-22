# MAINT-0022: the review diet for projects

**Status:** proposed for v2.11.0, waiting for the owner's release approval. The owner approved the
review diet on 22 October 2026: "Approved: build the review diet as planned in #146, keeping dash/
and relay/ on the risky list and agents' instruction files at review none" (Cazy00/workspace #146,
whose section 7 is this release). The plan is `MAINT-0022-plan.md`, reviewed once before the build.

## Why

The owner, on 22 October 2026, adopting the diet: "let's try and adopt and see how it's going to
work out."

What the owner's own repositories showed that day:
- 69 answered reviewer calls on 37 changes: 32 deep reviews and 24 fix checks, 24 of the calls
  failing. Codex's quota ran out while Gemini's was out too.
- About four changes had serious findings, all in root, merge-gate or money code.
- About a third of the reviews were of records, docs or configs.

What projects showed (MAINT-0021): mateen-systems' review rounds found fewer findings each round
(about 5.5, 2.2, 1.6, 1.5 per review), and the serious late catches were in permissions, money,
data loss and gates. v2.10.0 cut the repeat rounds; projects still review every task, about one
run per task and two per deep task, on top of the milestone review.

## What changes

| Before (v2.10.0) | From v2.11.0, where the project sets the key |
|---|---|
| Every task with product code is reviewed; a deep path needs a deep review. | `review.cadence: milestone`: a task needs no review while its milestone is Authorised or Active. The milestone gets one review of its whole diff, with a security focus on `review.deep_paths`: its base comes at or before every task's start, and it names the deep globs the diff reached. One fix check, recorded in the acceptance evidence, covers the fixes; code after it needs a new review or the owner. |
| The plan is authorised by the owner, with no review. | Under the milestone cadence the plan gets one quick review before authorisation, linked from the milestone record (`plan_review`), which readiness requires before a task starts. |
| The reviewer is never of the implementer's vendor. | `review.same_vendor: separate-session`: a reviewer of the implementer's vendor counts when it ran as a fresh session, with none of the implementer's conversation, and the evidence says so (`fresh_session`). |
| `review.reviewer_command` names `{role}`. | It may name `{level}` alone, so a reviewer that takes levels can be the command; `review.plan_command` names the plan review's. |

A project that sets none of these keys keeps v2.10.0's rules exactly: the new evidence fields are
read only under the new keys, and `wf ci` reads the keys from the trusted branch's config, so a
pull request cannot choose its own cadence.

## Controls this weakens, and why

- **Task reviews.** Under the milestone cadence, task code reaches the trusted branch unreviewed,
  deep paths included, until the milestone review. In return:
  - that review must cover every task from its start (its `base`), and name the deep globs the
    diff reaches;
  - its fixes get one fix check;
  - the owner accepts the milestone in a pull request that `wf ci` leaves to the owner.

  A project that deploys the trusted branch before acceptance runs that code unreviewed until then,
  so it keeps the task cadence. Setting the task cadence again before a milestone's acceptance is
  the owner's config change, and it drops the base check for that milestone: its earlier tasks then
  rest on a milestone review that `wf ci` no longer holds to the whole diff.
- **Independence of vendor.** Under `separate-session` a model of the implementer's vendor reviews.
  It is still a separate context: a new session with none of the implementer's conversation, never
  a subagent of the implementer's session.

  This differs from Harbor's own reviewer account, which also runs with no tools. Project reviewers
  run checks with a shell, as they did before.

## Checks, and what they catch

Each rule ships as a `wf ci`, readiness or config check, pinned in `validator/test/maint-0022.test.js`:
- the cadence from the trusted config only;
- no waiver outside an authorised milestone;
- acceptance-test changes keep their owner approval;
- the review's base before every task's start;
- the deep globs named;
- the fix check after the review, in the history, and nothing after it;
- the same vendor only with a fresh session;
- the plan review read from the trusted branch;
- the cadence refused without acceptance evidence.

What no check can see: whether the reviewer really focused on security, or really ran fresh. The
briefs print the deep globs and the fresh-session rule, so the reviewer's input carries them.

## What to watch

The 30-day check on 22 November 2026: escaped bugs in code merged with no review, by project and
path; milestone reviews and fix checks per milestone; plan reviews. If escaped bugs appear in a
project's unreviewed task code, that project goes back to the task cadence, or the path joins its
`review.deep_paths` with a task review, rather than adding rounds everywhere.

## Word counts

`procedures/review.md` 1,916 → 2,099, `procedures/readiness.md` 1,128 → 1,219,
`procedures/accept-release.md` 967 → 990, `POLICY.md` 6,172 → 6,229, `SCHEMA.md` 9,388 → 9,716,
`templates/milestone.md` 330 → 353. The shared corpus (policy, schema, quickstart, procedures,
templates, skill) went from 40,130 to 40,835. `review.md` stays under the plan's 2,100 words, inside
the session budget of three to four thousand words with the brief.
