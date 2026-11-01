# Maintenance — MAINT-0027: a fast lane per task, a full lane per milestone

Separate owner authorisation: the owner, 1 November 2026: develop and test locally, push once per task, run the slow checks once when the milestone is ready, and tap only at the plan and the acceptance. This restates their 30 October 2026 decision (MAINT-0026) for the pull request and its checks.
Workflow version and immutable revision: v2.15.1, `19e2923` (main).
Selected report IDs: one, the owner's request above (no feedback record).
Start, limit: 1 November 2026, one session; no spending limit set; usage not measured.

## Classification counts
Workflow defect: 1 (a task pull request pays the whole milestone's CI, more than once). Others: 0.

## Cost observed
In one adopting project, a task pull request took several pushes: the first failed `wf ci` for the missing delivery evidence, then the description was edited and each later fix pushed again. Each push reran the project's full CI, whose slowest job (the browser acceptance suite) took tens of minutes on a shared pool, so a one-hour task waited most of a day for green. Review requests to the repository's default code owner mailed the owner on every pull request, though the owner merges only at the plan and the acceptance. A found task without `found_from`, or beyond `found_tasks`, still needed the owner's answer in conversation, a second tap inside the milestone.

## Rules
- **Fast lane per task.** `wf precheck` runs the project's `checks.fast` locally in the repository root, one command at a time, stopping at the first failure with its exit code; `--full` runs `checks.full`. The agent runs it before the first push, opens the task pull request as a draft, pushes once, fixes locally, writes the delivery evidence, then `gh pr ready`, which reruns `wf ci`; it merges only after that run. `wf doctor` warns when `checks.fast` is missing.
- **Lane, one judge** (`validator/lib/lane.js`): `records` when `records_only`; `full` when the candidate closes a milestone (a milestone status moves to Verified, Accepted or Released versus the baseline), changes an enforcement path or changes the config's `checks`; else `fast`. `full` outranks `records`: a milestone-closing change is records only and still runs the slow checks. `wf paths --json`, `wf ci` and `wf lane` report it; a pin without the field is read as `full`. The project template runs its acceptance job on `full` only (no schedule).
- **Skipped counts only on the fast lane.** Delivery evidence may report a required check `skipped` only when `wf ci` recomputes `fast` from the baseline and the candidate; the evidence cannot name its own lane.
- **Draft runs never fail.** `wf-ci.yml` runs on `ready_for_review` and `converted_to_draft`; a draft's job is named `wf ci (draft)`, writes its verdict to the step summary and exits 0. The required check named `wf ci` is therefore never satisfied by a draft run, and GitHub refuses to merge a draft.
- **Found tasks are the acceptance's.** Under `approval.defer_to_acceptance` and `acceptance_evidence: true`, a found task without `found_from` or beyond `found_tasks` passes readiness, `wf ci` adds a `deferred` line, and the acceptance evidence lists it as it lists MAINT-0026's tasks. Scope and acceptance IDs outside the milestone still fail. Without both keys nothing changes.
- **Still the owner's:** the plan and the acceptance (the checkpoint, governing records, enforcement paths, the milestone hold), accepted blocking findings not carried, Done-record removal or change, new acceptance definitions.
- **No default code owner.** The root `CODEOWNERS` requests nobody; merges go through the project's merge route.

## Fixtures
`validator/test/maint-0027.test.js`: lanes (code, records, each closing status, enforcement, `checks`), `wf precheck` (order, root, stop, exit code, missing key, `--full`), the doctor warning, a found task beyond its allowance and without `found_from` (agent plus deferred), outside scope or acceptance (fails), the same without either key (unchanged byte for byte), an uncarried blocking finding, the approved plan, the accepted milestone, new acceptance definitions, an enforcement path, a Done-record change (each the owner's), `owedFoundTasks` and the acceptance error, a skipped required check on a full and a fast lane, and the two templates.

## Evidence / uncertainty
The cost above is one project's. Over-listing at the acceptance is chosen on purpose: when the allowance is exceeded the records do not keep the order the found tasks began in, so every found task is listed. `skipped` is a new `result` the evidence schema allows only for required checks on the fast lane.

## Size (words; `procedures/maintenance.md`)
| | before | after |
|---|---|---|
| POLICY | 6229 | 6229 |
| SCHEMA | 11139 | 11433 |
| QUICKSTART | 2886 | 2970 |
| procedures | 19290 | 19587 |
| templates | 11418 | 11965 |
| skill | 321 | 321 |
| `execute.md` | 2556 | 2622 |
| `delivery.md` | 876 | 1091 |
| `setup.md` | 2566 | 2595 |

A session reads one procedure and its records, three to four thousand words (`.agents/skills/workflow/SKILL.md`); `execute.md` stays inside that.

## Recommendation
Implementation and fixtures; instructions limited to the sentences above.
