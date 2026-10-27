# MAINT-0023: What v2.11.1 measured in mateen-systems and headless-lightroom, and the next cuts

**Status:** proposed, 27 October 2026. Nothing here is built. The owner chooses which proposals to build. Two are the owner's policy decisions: P5(b) changes what `wf ci` accepts as a baseline result, and P6 changes the milestone review's budget. W1 and W2 change Harbor's merge route, outside this repository.

**Classification** (`procedures/maintenance.md`):
- Workflow defects: F1, F3, F5, F6, F7, F8.
- Project configuration problems: F2, F4 and F10. F2 is also the template's default.
- Improvement proposal: F9.
- Outside this repository: F11, F12 and F13 are Harbor's (the broker's merge route, the managers' habits). They are recorded here for the workspace.
- Nothing found is a safeguard failure.

**Owner's words (27 October 2026):** "see the like decisions that was using agent workflow latest version and start auditing them … when I go to GitHub and go to issues, I can see two issues for project status. Why is that? … I am feeling that the checks like CI checks, I think are very slow … you need to actually see where the time have been spent because some of those sessions have been running for days … look for areas where we could actually improve the way it works, where we could actually improve the cost and the speed … I still get emails about failed a test, something regarding print flow … What can we do about it?"

---

## 1. What ran on v2.11.1

Both projects moved their pin to v2.11.1 on 23 October 2026: headless-lightroom at 12:00 UTC (#22) and mateen-systems at 14:10 UTC (#107). Both run owner-merge with `review.cadence: milestone`, a build runner (`wf-build`) and a gate runner (`wf-gate`) on the home server. The measurement runs from then to 15:20 UTC on 27 October.

| | mateen-systems | headless-lightroom |
|---|---|---|
| Milestones | M-0006 "the full order": authorised 03:21 UTC 25 October (#108), accepted 15:07 UTC 27 October (#122). That is 59.8 h. | The end of M-0002 (accepted 13:15 UTC 25 October, #27). All of M-0003: plan merged 14:25 UTC 25 October, accepted 06:31 UTC 27 October (#51). M-0004's first five tasks. |
| Tasks merged | 15. Two of them (T-0046, T-0047) came from the milestone review, and two (T-0048, T-0049) from the owner's trial. | 22 (T-0010 to T-0030, and T-0033). Found tasks: T-0024 to T-0026 from M-0003's review, and T-0033 from a memory kill. |
| Pull requests | 23 merged, 1 open (#106 to #130) | 40 merged (#19 to #59) |
| CI runs | 119 runs of `CI` (three jobs each), 35 runner-hours, plus 139 `wf ci` | 152 `test` runs (2.6 runner-hours) and 169 `wf ci` |
| `wf ci` failed | 73 of 139 | 89 of 169 |
| Claude Code sessions | 1 Opus manager (60 h) and its plan session, plus 26 Sonnet workers (`job run`) | 11 Opus sessions, no workers |
| Cache reads | 0.91 billion tokens | 0.87 billion tokens |
| Cost, input side | about $330: the manager and its plan session $182, the workers $146 | about $495 |

Costs use MAINT-0020's prices (Opus 5.5: $4 / $20 per million input / output tokens, $0.20 cache read, cache write $5 or $8; Sonnet at half those). As in MAINT-0020, transcripts under-record output tokens, so these figures are the input side, which is most of the cost.

## 2. The owner's three questions

### 2.1 Why mateen-systems has two "Project status" issues

`templates/github/wf-status.yml` publishes the status into "the one open issue labelled `wf-status`".
- **How it finds the issue.** It asks GitHub for that issue with `gh issue list --state open --label wf-status --limit 1`. When the answer is empty, it opens a new issue.
- **What went wrong.** At 17:16 UTC on 22 October, one scheduled run on mateen-gate (run 39821208841) got an empty answer although #19 was open and labelled. #19's event history shows no unlabelling or closing, and the run before it, at 12:01, had updated #19. The run opened #104.
- **Why it stayed.** `--limit 1` takes the newest open issue, so every run since has updated #104. #19 stopped at 12:01 UTC on 22 October and still shows that day's state.
- **Why it can recur.** Nothing checks a second time before opening an issue. Nothing closes a second issue once it exists.

Fix: P1. Clean-up: #19 was closed as superseded by #104 on 27 October 2026, on the owner's yes.

### 2.2 The failure emails about PrintFlow

They come from PrintFlow's `wf-status` workflow, which is the v1.10.1 template.
- **Where it runs.** On GitHub's own runner (`runs-on: ubuntu-latest`), every six hours.
- **Why it fails.** Since 13 October GitHub refuses to start it: "The job was not started because recent account payments have failed or your spending limit needs to be increased". The account's spending limit is $0, so once October's included minutes ran out, around 13 October, GitHub runs nothing more on its own runners this month. Its last success was at 00:49 UTC on 13 October.
- **Who gets the email.** GitHub emails each failed scheduled run to the account the run belongs to, here the owner's. There have been 56 failures since 13 October, about four a day.
- **What still works.** PrintFlow's own checks (`verify`, `readiness`) are unaffected: they run on its build runner.

The Mateen repository has the same workflow from v1.4.0, with 54 failures. Those runs belong to the collaborator's account, so the emails go to the collaborator, not to the owner.

- **Now:** turn `wf-status` off in both repositories (`gh workflow disable wf-status.yml`, undone by `enable`). Their status issues have been stale since 13 October anyway. Done on 27 October 2026, on the owner's yes: both are `disabled_manually`.
- **If nothing is done:** the minutes return on 1 November and the runs succeed again until the minutes run out, so the emails come back late in the month.
- **Lasting:** P2.

### 2.3 Where the days went

**mateen-systems, M-0006, 59.8 h.** The causes, ranked by hours lost. The hours overlap, so they do not add up.
1. **Closing the milestone, about 14–16 h** (F6, F8). The milestone's diff was 1.27 MB, larger than any reviewer model takes (900 KiB), so its one review ran in two parts and later a third. Its found tasks needed a records pull request before their fixes could pass (#125). The owner's trial added T-0048, and its review added T-0049. Each change to the milestone meant rebuilding the acceptance evidence. That made five review runs against a budget of two, and the acceptance pull request #122 lived 24.7 h.
2. **Waiting for the owner's merge taps, about 12–15 h** (F11).
   - A merge tap expires after 30 minutes and must be sent again: T-0040 once, T-0042 three times overnight, T-0047 and T-0049 once each.
   - Two pull requests waited overnight.
   - Twice the owner had to ask whether the session was waiting for them: "are you waiting for me" at 08:15 and "What now ?" at 16:25 on 25 October. Each time the session was working or waiting, and nothing showed it.
3. **CI throughput, about 8–10 h** (F4). One push costs about 21 minutes of CI, plus a queue whenever pushes overlap (§ 3). There were 15 cancelled runs and 13 failures.
4. **The manager's own mistakes, about 8–9 h** (F10, F12).
   - About 3.5 h went to trying auto-merge, which the repository's rules make impossible (F10).
   - Two wait scripts expired after 2 h with nothing done.
   - There were launch mistakes: a stale ref, a missing `--write`, and two workers cancelled as duplicates.
   - After each of 16 compactions, the manager relearned lessons it had already learned.
5. **Two CI cycles per pull request, about 6–8 h** (F3). The worker pushes its code and waits for CI. It then writes the evidence into the description and pushes an empty commit, because a cancelled or failed earlier run on the head makes the merge route refuse it. That costs about 1.5 h more in rebuilt candidate commits.

A clean task (#117 to #121) took 1.5–2.5 h from the worker's start to the merge:
- the worker, about a third;
- CI, about 45 %: two cycles of about 21 minutes;
- the owner's tap, 15–20 %;
- review, nothing (under the milestone cadence the review comes at the end).

**headless-lightroom.** Three manager sessions carried the work:
- B: the end of M-0002, 14.6 h.
- A: M-0003, 41.4 h.
- C: M-0004's start, 7 h so far.

A's 41.4 h divide as follows:
- **20.8 h (50 %) asleep on its own timers.** While the owner tried the milestone, the session set wake-ups of 4 h and then 16.6 h. About 12 h of that was the trial itself. The owner wrote the trial's feedback between 20:18 and 00:35 UTC, but the session woke only at 05:01, 4.4 h after the last entry and 8.7 h after the first.
- **About 8.5 h waiting for the owner's answers in the conversation.**
  - The largest wait was a question sent at 00:48 UTC on 26 October and answered at 04:21, with no other work running meanwhile. The question was needed because M-0003's own limits allowed three found tasks, and a fourth finding remained.
  - Twice an action sat at the end of a long message. The trial message had no checklist, and the owner asked what to look for. A 330-word summary ended with "merge #51", and the owner replied "what you want me to do now ?" at 06:31 on 27 October.
- **About 4.2 h running the 10–15-minute acceptance suites on the server,** one at a time, with nothing else going. CI does not run them.
- **About 7 h working (17 %).**
- **0.75 h compacting, 37 times.** A works in its own context. Reading and diagnosing filled it: 820 file reads over 261 files, 315 of them repeats, with one 1,423-line file read in pieces 62 times. Each compaction began with re-reading. Images were not the cause: 26 of them, about 70 K tokens.

In B, two merge taps expired unanswered, and #25 waited 4.3 h until the owner asked whether it could merge. In C, the renders and the test suite's temporary files, which sit in memory, reached the account's 12 GB limit. Seven renders were killed, costing 30 minutes and a found task (T-0033, #56) that fixed it for good.

The causes, ranked:
1. Waiting for the owner with long timers or unclear asks: 15–18 h (F13).
2. Context churn: 53 compactions over three sessions, and an estimated 20–30 % of A's tokens avoidable (F12).
3. Acceptance suites run alone: about 4 h.
4. The memory kill: 30 minutes, then a 103-minute task.
5. Gate loops: 1–2 h. These were draft pull requests failing `wf ci` before their evidence, Done records reverted, and five per-task reviews with no findings. Those reviews were valid then: they ran before the project moved to one review per milestone at 05:48 UTC on 25 October (#30).

**So:** in mateen-systems, CI is the largest mechanical cost, but the days come from closing the milestone and waiting for taps. In headless-lightroom, CI takes a minute and costs nothing that matters.

### 2.4 Two follow-up questions from the owner

**Was the compaction count caused by the context cap?** Mostly yes, but it cost little time. Sessions A and B ran under the 200K cap of 24 October: all 47 of their compactions fired at 167–181K tokens, the cap less about 33K. C started after home moved to 240K and compacted at 207–237K. Across A's 37 compactions the time from the last reply before each to the first reply after was 92 minutes in all, median 84 seconds: about 1.5 h of A's 41.4 h. At 240K about a third fewer compactions would have saved about 30 minutes. A 1M window would have removed nearly all of them, but every request then carries the whole history: the large majority of the project's model cost is already cache reads at 167K, so most of that cost would grow with the window. The days came from the timers and the owner waits above; the lasting cure for the compactions is W3, the manager handing reading to workers, not a larger window.

**Would caching speed up CI?** Not in mateen-systems: caching is already there and working. In the successful runs, the medians are `npm ci` 5 s (`setup-node` with `cache: npm`), `setup-node` 12 s, and the Postgres service 9 s. The time is in the tests: acceptance 12.6 min, `test:e2e` 2.9 min, `test:db` 1.4 min. The general speed-ups that do apply are those in P4: run independent jobs at the same time, split the slow suite across workers, and skip the run when the change cannot affect it.

## 3. CI, measured

mateen-systems, 23–27 October, all on its one build runner (minutes):

| Job | Runs | Queue median / p90 / max | Run median / p90 | Runner-hours |
|---|---|---|---|---|
| `acceptance` | 119 | 5.5 / 19.8 / 37.8 | 13.6 / 14.3 | 22.7 |
| `checks` | 119 | 8.4 / 21.6 / 49.5 | 5.6 / 6.5 | 10.7 |
| `deploy` | 119 | 6.4 / 22.5 / 54.4 | 0.8 / 1.1 | 1.8 |
| `wf ci` (gate runner) | 139 | 0.1 / 0.3 / 1.4 | 0.4 / 0.5 | 1.3 |

- **The jobs wait for each other only because there is one runner.** The three jobs have no `needs:` between them. With room for all three at once, a push would take about 14 minutes instead of 21.
- **The acceptance tests run one file at a time.** That is 70 files with `fileParallelism: false` against one database, 12.6 minutes median. This one step is 57 % of the runner's time.
- **Every push to `main` reruns all three jobs.** That was 23 pushes and about 8 runner-hours. At least six of those pushes were records-only merges (#106, #108, #113, #125, #127, #128).
- **headless-lightroom's `test` job takes 0.9 minutes.** Its CI cost is negligible.

**Why `wf ci` is so often red.** In both projects, the gate runs on every push, before the agent can have evidence for that head. The finding found most often in failed runs is the designed state "delivery evidence for this candidate is missing": 62 of 71 failed runs read in mateen-systems and 54 of 86 in headless-lightroom. A gate run costs 0.4 minutes, so the cost is the red marks, not the time. Two findings are mistakes the gate could prevent:
- `baseline_result` written as "pass: main's CI run https://…". The gate refused this form in 8 failed runs across both projects (F5).
- A task's change to an acceptance test outside its scope: 8 failed runs in mateen-systems.

## 4. Findings and dispositions

| Finding | Classification | Evidence | Disposition |
|---|---|---|---|
| F1. The status workflow can open a second issue and never removes it | workflow defect | § 2.1 | P1 |
| F2. A scheduled status run on GitHub's runner under a $0 limit fails four times a day and emails each failure | project configuration (PrintFlow and Mateen predate the gate runner); the template's default | § 2.2 | P2 |
| F3. Every pull request pays two CI cycles | workflow defect (with Harbor's merge route, W2) | § 2.3 item 5. A description edit or a push cancels a running `wf ci`, and the merge route refuses a head with any cancelled or failed run, so agents push an empty commit after the evidence (mateen-systems F-0006). | P3, W2 |
| F4. mateen-systems' CI is serial and repeats itself | project configuration | § 3 | P4 |
| F5. The gate refuses `baseline_result: pass: <reference>`, and a pending baseline costs one more push | workflow defect | § 3. 8 runs refused for the form. 8 runs named a baseline still pending, which needs another push and another CI cycle to fill. | P5 |
| F6. The milestone's one review outgrows every reviewer | workflow defect | mateen-systems F-0003: 1.27 MB in 2 then 3 parts, 5 runs against a budget of 2, and the evidence has room for one `base` and one `revision` only | P6 |
| F7. The delivery evidence lists every mapped acceptance test | workflow defect | mateen-systems F-0004: 387 tests; #118's description was 105,402 characters, near the 128 KB that reaches the check | P7 |
| F8. A found task needs its record on `main` before its fix can pass | workflow defect | mateen-systems F-0005. M-0006 needed three records pull requests (#125, #127, #128), each with its own tap and CI cycle. | P8 |
| F9. `wf` has no `--help`, and `wf session` does not say what it accepts | improvement proposal | headless-lightroom F-0001 | P9 |
| F10. `approval.auto_merge` is on, but the rules let only the broker merge | project configuration problem that `wf doctor` can detect | § 2.3 item 4: about 3.5 h | P10 |
| F11. Merge taps expire after 30 minutes, and the owner cannot see that a session waits on them | outside this repository | § 2.3 item 2 | W1 |
| F12. Opus managers do the reading and implementing themselves | outside this repository (Harbor's rule that workers run on Sonnet) | headless-lightroom: 11 Opus sessions, no workers, about $495, 53 compactions. mateen-systems' manager delegated every task, yet still compacted 16 times. | W3 |
| F13. Waits on the owner run on long timers and unclear asks | outside this repository | § 2.3: a 16.6 h timer over a trial whose feedback came in that evening; actions placed after long summaries | W4 |

## 5. Proposals

**P1. One status issue, self-healing** (`templates/github/wf-status.yml`, F1). The new publish step:
1. Lists every open `wf-status` issue through the REST API.
2. Edits the oldest one.
3. Closes every other one with "Superseded by #N".
4. Opens a new issue only when two lookups a few seconds apart both find none.

It fixes an existing duplicate on its next run, so mateen-systems needs no manual clean-up once the project adopts it. Check: a test that runs the publish step against a stub `gh` with zero, one and two open issues.

**P2. No scheduled status run on GitHub's runner** (the same template, F2). The job gains `if: github.event_name != 'schedule' || vars.WF_GATE == 'on'`.
- Without a gate runner, the status refreshes on pushes to the trusted branch and on manual runs only.
- A skipped job uses no minutes and sends no email.
- A project with a gate runner keeps the six-hourly refresh, which shows the open pull requests' claims.

Check: a template test that the condition is present. For PrintFlow and Mateen now, see § 2.2.

**P3. One CI cycle per pull request** (F3, with W2).
- `procedures/delivery.md` says the order: push the head, wait for its CI, write the evidence into the description, and let the description edit rerun `wf ci` on the same head. Never push an empty commit to refresh the checks.
- W2 makes that order merge.
- Expected saving in mateen-systems: one CI cycle per pull request, about 21 minutes plus its queue. Over M-0006 that is about 7 runner-hours and 4–6 h of elapsed time.

Check: none in this repository can see the merge route. The record of the next milestone measures it.

**P4. mateen-systems' CI** (F4). This is project work for mateen-systems' own records, plus one admin step.
- (a) Let the build runner take its three jobs at once, through a second registration or container. The admin decides, against the home server's memory.
- (b) Run the acceptance files in parallel, one database per worker. The estimate is 12.6 minutes down to 4–5 with three workers.
- (c) Skip CI for records-only changes. This needs P5(b), so the next task can name the last code commit's run.

Together these could bring a push from about 21 minutes to about 6–7 (estimate).

**P5. The baseline result** (F5).
- (a) Accept `pass: <reference>` beside `pass`. The reference is what the owner would want to see. Check: a validator test for both forms.
- (b) Let a task's `baseline_result` name the passing run of the pull request whose merge made the baseline, when the merge commit's tree equals that head's. Then a task can start with a filled baseline instead of `pending`, and needs no later push to fill it. This changes what the gate accepts, so it is the owner's decision. Check: a fixture where a merge commit equals its pull request's head, and one where it does not.

**P6. The milestone review in parts** (F6, the owner's decision).
- The acceptance evidence's milestone review may name contiguous parts, each with its own `base..revision`, that together cover the milestone. The parts count as the one review, and the fix check stays the second run.
- `wf next` warns at planning when a milestone's tasks are likely to pass about 700 KB of diff.

Check: validator tests for contiguous and gapped parts.

**P7. Acceptance results by reference** (F7). The evidence records the acceptance run's link and the counts, and lists by name only the tests that failed or are pending. `wf ci` already judges every mapped test from the CI job, not from the description. Check: a validator test that an evidence block without per-test lines passes, and that one naming a failed test fails.

**P8. A found task and its fix in one pull request** (F8). A found task's record may first appear, Draft or Done, in the pull request that fixes it, when the record names the review that found it. This removes one pull request, one tap and one CI cycle per found task. Check: a fixture with a found task's record and its fix together.

**P9. `wf <command> --help`, and an error that says what `wf session` accepts** (F9). Check: CLI tests.

**P10. `wf doctor` checks auto-merge against the rules** (F10). It warns when `approval.auto_merge` is on but the trusted branch's rules let only a bypass actor merge. Check: a doctor test with a stubbed rules answer.

**For Harbor's workspace (outside this repository):**
- **W1. Merge taps.** A tap waits until it is answered or its head changes, instead of expiring after 30 minutes. A session that waits on a tap sets 🟡 in its title and adds an `ask-add` entry, so "what's waiting?" answers itself.
- **W2. The merge route judges each check by its latest run on the head.** That is GitHub's own rule for required checks, instead of failing on any earlier cancelled or failed run.
- **W3. Managers delegate the reading.** Implementing, diagnosing and test-fixing go to Sonnet `job run` workers with capped results, as mateen-systems does. The manager keeps the records, the merges and the owner.
  - At Sonnet's price, the work moved would cost about half. In headless-lightroom that is roughly a third of its $495 (estimate).
  - It also removes most compactions: C, using lead subagents, compacted 6 times in 470 calls, against A's 37 in 1,949.
- **W4. Waits on the owner.**
  - A session waiting for the owner's trial checks for new feedback at least hourly, never on a 16-hour timer.
  - Every message that needs the owner starts with the action, and a trial message carries its checklist.
  - A question the owner must answer runs beside other work wherever there is any.
- **W5.** The mateen-systems manager's umbrella job j20261026142544-c795 is still `running`, although M-0006 is accepted.

## 6. The projects' feedback records

| Record | Disposition here |
|---|---|
| mateen-systems F-0003 (the milestone review too big) | F6, P6 |
| mateen-systems F-0004 (evidence size) | F7, P7 |
| mateen-systems F-0005 (found tasks need records first) | F8, P8 |
| mateen-systems F-0006 (a cancelled run blocks the merge) | F3, P3 and W2 |
| headless-lightroom F-0001 (`--help`, `wf session`'s message) | F9, P9 |

They stay Open in the projects until a release carries their fix.

## 7. How it was measured

- **Transcripts.** 43 Claude Code transcripts from the two projects' folders on the home server, 22–27 October. Each assistant message's usage was counted once, and tool calls were timed from their start to their result.
- **Idle time.** A gap of over two minutes before an incoming message, classified by where the message came from: the owner, a background task, or another session.
- **GitHub.** Every Actions run and job of both repositories from 23 October, with step timings. The logs of the 159 failed `wf ci` runs, of which 157 were readable, grouped by finding. Pull requests with their pushes and runs.
- **The manager sessions.** mateen-systems' manager, and headless-lightroom's three, were each studied by a separate read-only session, with their state logs, job records, pull requests and Codex job outputs.
- **Limits.**
  - Job records give a start but no end, so per-task times run from the worker's start to the merge.
  - The split of a task's time between CI, worker and owner is an estimate from the narration and the run data.
  - The cost figures are the input side only.
