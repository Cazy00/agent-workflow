# Record schema and gate rules (workflow 1.0)

The validator implements exactly what this file says. When they disagree, one of them has a bug: fix
both together and add a fixture. POLICY.md says why; this file says what is checked.

## Front matter

A record is a Markdown file that starts with a `---` line, `key: value` lines, and a closing `---`.
Values are plain text; `[a, b, c]` is a list; an empty value means unset; lines starting with `#` are
ignored; no multi-line values. Identifiers: `T-0001` tasks, `D-0001` decisions, `F-0001` feedback,
`PROFILE` the profile. A record's `id` must equal its filename stem.

## Locations

Relative to the repository root, under `records_dir` from `config.json` (default `docs/workflow`):

| Record | Path |
|---|---|
| Config | `docs/workflow/config.json` (fixed; the validator reads it from the trusted baseline) |
| Profile | `profile.md` |
| Task | `tasks/T-0001.md` |
| Decision | `decisions/D-0001.md` |
| Feedback | `feedback/inbox/F-0001.md` |
| Checkpoint | a commit on the task branch whose message starts with the task id (`templates/checkpoint.md`) |

## Profile

Required: `record: profile`, `project`, `workflow_version`, `approval_mechanism`, `approval_label`
(`enforced` | `manual`), `coordinator`, `setup_budget_days`. Body sections follow POLICY §2.

## Task

Required: `record: task`, `id`, `title`, `status` (`Draft` | `Ready` | `Active` | `Blocked` | `Done`),
`owner`, `objective`.

Optional: `scope`, `governing` (list of `PROFILE` | `D-xxxx` | `T-xxxx` | path), `prerequisites` (list
of `T-xxxx` | `D-xxxx` | `contract:<path>`), `decisions` (list of `D-xxxx`), `assumptions` (list),
`deferred_inputs` (list of `D-xxxx@<stage>`), `subset` (list of directory prefixes), `branch`,
`start_revision`, `baseline_revision`, `baseline_result` (`pass` | `fail: <summary>`),
`resume_condition` (required when `Blocked`), `implemented`, `verified`, `accepted`, `released` (dates).

**Stage** (derived): `release` when `accepted` is set; `accept` when `verified` is set; `verify` when
`implemented` is set; otherwise `implement`. Order: implement < verify < accept < release.

## Decision

Required: `record: decision`, `id`, `question`, `type` (`decision` | `fact` | `technical` |
`assumption` | `deferred`), `owner`, `status` (`Open` | `Proposed` | `Resolved`), `required_before`
(`implement` | `verify` | `accept` | `release` | `none`).

Optional: `affects` (list of `T-xxxx` | feature name | `paths:<directory prefix>`), `supersedes`
(`D-xxxx`), `superseded_by` (`D-xxxx`).

**Trusted meaning:** a decision counts as approved only when its record is `Resolved` on the trusted
baseline. A candidate copy is checked for schema only; its status is evidence of nothing.

## Feedback

Required: `record: feedback`, `id`, `task`, `revision`, `workflow_version`, `rule`, `status` (`Open` |
`Classified` | `Closed`). Optional: `classification`. Body: Expected, Actual, Evidence, Impact.

## Readiness evaluation

Inputs: task id `T`, trusted baseline `B` (a git revision or a directory), candidate `C` (the working
tree, a revision, or a directory). Reads config, profile, decisions, prerequisite tasks, and contracts
from `B`; reads the task record from `C`, falling back to `B`.

Checks, in order; each failure adds a reason:

1. The task record parses and satisfies the schema.
2. `status`: `Draft` blocks ("not Ready"); `Blocked` blocks and reports `resume_condition`; `Done`
   blocks ("open a new task").
3. `profile.md` exists on `B`; every `governing` entry resolves on `B`.
4. `prerequisites`: `T-xxxx` is `Done` on `B`; `D-xxxx` is `Resolved` on `B`; `contract:<path>` exists
   on `B`.
5. Decisions in scope = those listed in `decisions` plus every decision on `B` whose `affects` names
   `T`. Each must be `Resolved` on `B` (a copy that is `Resolved` only on `C` is reported as "Resolved
   only in the candidate") and not superseded (`superseded_by` set, or another `Resolved` decision on
   `B` with `supersedes` naming it). A decision whose `required_before` is later than the current stage
   is reported as pending, not blocking.
6. `deferred_inputs` `D-xxxx@<stage>` block when the current stage is at or past `<stage>` and `D-xxxx`
   is not `Resolved` on `B`.
7. `baseline_revision` and `baseline_result` are set (`fail: …` is acceptable; it records a known
   failing baseline).
8. When `B` is a git revision, `baseline_revision` is an ancestor of `B`.

Outcome: no reasons → **Ready**. Reasons come only from decisions or deferred inputs whose path scopes
do not overlap the task's `subset` (and `subset` is set) → **Ready for a bounded subset**, naming the
subset. Otherwise → **Needs discovery or resolution**. Path scopes are directory prefixes; two scopes
overlap when one is a prefix of the other; a blocking decision with no `paths:` scope blocks everything.

## Path classification

Categories and precedence: `enforcement` > `production` > `generated` > `governing` > `planning`; a path
matching none is `unclassified`. Patterns are globs (`**`, `*`, `?`, `{a,b}`); `**/` matches zero or
more directories. The config is always read from `B`, never from `C`.

## CI verdict

1. Every record on `C` is schema-valid.
2. No changed path is unclassified.
3. Changed `production` paths require the task's readiness to be **Ready** with status `Ready` or
   `Active`, or **Ready for a bounded subset** whose subset contains every changed production path. No
   task id → fail.
4. `enforcement`, `governing`, and `generated` changes are reported as findings (the repository's
   required review enforces them); they do not fail the check by themselves.
5. Planning-only changes pass regardless of task readiness.

Exit codes: `0` pass, `1` fail, `2` usage or internal error.
