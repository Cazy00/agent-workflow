# MAINT-0020: What M-0005 measured on v2.7.0, and the next cuts

**Status:** proposed, 16 October 2026. Nothing here is built. The owner chooses which proposals to build; P6 and P11 change what a gate accepts and are the owner's policy decision.

**Classification** (`procedures/maintenance.md`): F1, F7 and F8 are workflow defects; F9 is a project configuration problem that the workflow can detect; F6 is an expected safeguard whose cost is set by the milestone's limits; the rest are improvement proposals. Nothing found is a safeguard failure.

**Owner's words (16 October 2026, in the session studied):** "take that session and study it and see how it was being driven by agent workflow, how well it have did. What are the improvements that we could actually make in order to make it run either cheaper, either also could be faster, it could be better, it could be also more robust".

---

## 1. What happened in M-0005 (mateen-systems, 14–16 October 2026)

M-0005 ("the setup interview and How we work") ran in one Claude Code session on the home server, "Mateen-systems GitHub updates" (session_01LdT6F1ioMdnaaoZRwNDKzn), on agent-workflow **v2.7.0** from first to last commit: the milestone record, every session outcome and every review name it (A4). The session opened at 10:42 UTC on 14 October, after the v2.7.0 upgrade (#85) had merged, and the owner merged the acceptance (#98) at 06:05 on 16 October: 43 h 23 min. Seven tasks were planned; ten ran (T-0025–T-0032, T-0035, T-0037), each extra one by the owner's choice.

**Where the line is drawn.** The session holds no M-0004 work: M-0004 ended in another session (13–14 October, accepted in #84 before this one opened). Its tail after 06:08 on 16 October is not M-0005 (M-0006 questions, removing another project from the server, starting this study) and is left out: 46 model calls, 33 M cache reads, about $14.

**How it was measured.** As MAINT-0016 § 1: the main transcript and its 51 helper transcripts (`subagents/`, each with its `meta.json` naming its parent and description), one count per API message ID; Codex from its own session logs; the repository's pull requests, comments and Actions runs. Prices are Opus 5.5 list prices ($4 / $20 per million input / output, $0.20 cache read, cache write $5 for the 5-minute cache and $8 for the 1-hour one; Sonnet 5.5 $2 / $10). The transcripts under-record output tokens (0.46 M logged against the 4.6 M the session reports), so total cost is taken from the session's own figure; per-agent figures use the logged input side, which is about 85 % of the cost.

| | M-0003 (v2.2–v2.3) | M-0004 (v2.4.2) | Predicted by MAINT-0018 (§ 6) | M-0005 (v2.7.0) |
|---|---|---|---|---|
| Tasks / lines changed | 4 | 8 / about 13,400 | — | 10 / about 19,500 |
| Owner merges | 13 | 4 | no Done pull requests; idle only on decisions | 3: the plan #86, #91 (a blocking finding accepted, F10), the acceptance #98. No Done pull requests. |
| Owner "merged / continue / what now" messages | 29 | 3 | — | 2 "merged", 1 "merged, accepted" |
| Questions to the owner | 10 | — | — | 7 rounds, 12 questions; all 12 answered with the recommended option; 5 rounds were about the milestone's limits or scope, not the product (F6) |
| Waiting on CI with nothing needed from the owner | 7 h 25 min | about 1 h 20 min | — | about 1 h 35 min: 69 min waiting for `main`'s CI before each claim (F2), 26 min on #98's checks |
| Work idle on the owner | 12 h 40 min | about 20 h | limited to decisions | about 17 h 30 min, all decisions: the plan 7 h 23 min (daytime), an overnight limits question 3 h 50 min (F6), the acceptance 6 h 15 min (overnight). #91's 1 h was covered by T-0028 running meanwhile. |
| Reviews / second-model runs | 23 / 23 | 14 / 11 | two per deep task plus one for the milestone (15 here) | 19 reviews: 14 by Codex, 5 by a fresh Claude reviewer; 17 Codex launches, of which 1 was killed by a container restart and 2 refused at Codex's usage limit (F5) |
| Model tokens (cache reads) | ≈ 1.14 billion | ≈ 0.84 billion | 40–50 % below M-0003 | ≈ 1.18 billion, 118 M per task (M-0004: 105 M); 60 M per thousand lines (M-0004: 63 M) |
| Cost | about $475 | $257 (Mac session only) | — | about $528 (the session reports $542 with the tail); plus about 35 M Codex input tokens, 95 % cached |
| Task leads | implemented themselves | 535–635 K tokens, ≈ 60 % of tokens | under 300 K | 140–237 K peak, 19 % of cost; a helper implemented every task (`implementer: helper` in all ten outcomes) |
| The trial walk | not walked | walked twice | once, after the review | once, after the milestone review and its fixes, in the background (33 min); 9 min re-walking the one step T-0037 changed. The owner's trial still found a defect the walk could not (F7). |

Cost by role and by task (input side, M-0005 only):

| Role | Agents | Share | | Task | Share | | Task | Share |
|---|---|---|---|---|---|---|---|---|
| implementing and fix helpers | 19 | 53.5 % | | T-0030 | 15.3 % | | T-0029 | 6.6 % |
| task leads | 11 | 18.6 % | | T-0031 | 15.0 % | | T-0026 | 5.2 % |
| coordinator | 1 | 13.7 % | | T-0027 | 13.9 % | | T-0032 | 5.1 % |
| reviewers (Claude) | 6 | 6.9 % | | coordinator | 13.7 % | | T-0028 | 4.5 % |
| closing paperwork | 10 | 3.2 % | | T-0035 | 6.7 % | | milestone review | 3.7 % |
| walk and UI checks | 3 | 2.6 % | | T-0037, T-0025 | 3.2 %, 3.1 % | | walk | 2.3 % |

Two measurements explain most of the rest:
- **Four implementing helpers spent 37 % of the milestone** (T-0031 137 M cache reads at up to 814 K context, T-0027 132 M over 357 calls, T-0030 105 M at up to 698 K, T-0029 61 M at up to 571 K). Reading code (`sed`, `cat`, `grep`) filled 45–76 % of their tool output; the rest was test output.
- **Two-thirds of all cache writes rebuilt a context that had expired while its agent waited.** Helpers use the 5-minute cache: 19.2 M of their 31.5 M written tokens came on the first call after a wait of more than five minutes (Codex, CI, a long test run), about $96. The coordinator uses the 1-hour cache, but waited one to four hours for each foreground task lead and rebuilt its whole context, 225 K growing to 620 K, thirteen times: 5.0 M tokens, about $40. Together about a quarter of the milestone's cost.

## 2. What v2.6 and v2.7 changed, as measured

- **Worked.** A1: every Done marking travelled in its task's own pull request (`wf done`, 28 uses); no Done pull requests. A4: the version is on every outcome, review and the milestone. B1: briefs came from `wf brief --lead`; leads stayed small and never implemented. B2: one walk, after the review's fixes, in the background, and a re-walk of only the changed step. B3: T-0037's architecture-note fix went into the acceptance pull request. B4: every blocking finding stated its exposure; the milestone review found nothing blocking. B7's second half: each claim cited `main`'s own CI run as its baseline.
- **Not exercised.** A2 (no upgrade during the milestone; #85 merged before authorisation) and A3 (T-0029, test-only, was reviewed deep by the plan's own choice, since its tests sit on numbering and permissions).
- **Half worked.** B5: `wf doctor` found at 18:30 on 14 October that staging could not be deployed from the home server and said to ask in the first question; the coordinator never asked, told the owner at 19:09 on 15 October with "Nothing needed", and the trial ran on the home preview instead (F7). B6: task leads used `wf wait` (31 times); the coordinator wrote 24 loops of its own, because `wf wait` waits on pull requests and the coordinator was waiting on `main` (F2).

## 3. Findings and dispositions

| Finding | Classification | Evidence | Disposition |
|---|---|---|---|
| F1. Implementing helpers grow to 571–814 K and spend half the milestone | improvement proposal | § 1; T-0027, planned light, became deep (it touched `invoice-series.ts`), ran a found-work round and a fix round, 196 M cache reads in all | P1 |
| F2. Tasks ran one at a time behind foreground leads, each claim waiting for `main`'s CI | workflow defect: `execute.md` says "in the foreground" and also allows three leads at once | about 19 h of foreground leads; T-0025, T-0026 and T-0028 shared no prerequisite or scope with T-0029, yet none started beside it; six claims waited 9–16 min each for `main`'s run; 24 hand-written wait loops | P2, P10 |
| F3. The coordinator's context grows for the whole milestone and is rebuilt after each lead returns | improvement proposal | median 405 K, 708 K by the end; 13 rebuilds (§ 1); it drafted M-0006, set up the trial server, investigated the trial's speed and wrote the acceptance package itself | P3 |
| F4. Every agent ran on Opus whatever its job | improvement proposal | leads 18.6 % of cost for coordination only; 5 of 10 paperwork helpers on Opus | P4 |
| F5. The second model ran out at the milestone review | improvement proposal | 14 Codex runs in about 22 h; the first milestone-review run died in a container restart, the second and T-0035's were refused at the usage limit; both fell back to a Claude reviewer (the profile allows it). R-0067, a third Codex run on T-0028 after a merge of `main`, found nothing. | P5 |
| F6. The milestone's limits turned settled choices into questions, one overnight | expected safeguard, costly as configured | 5 of 7 question rounds: a second fix round, three more CI attempts, a helper outside scope, tasks 8, 9 and 10. All answered with the recommendation. T-0030's three attempts went on two M-0003 screen tests it does not touch (a sign-in refused mid-run, a timeout); the question waited 3 h 50 min overnight | P6 |
| F7. The owner's trial found what the walk could not, on an environment the walk did not use | workflow defect | the walk followed the trial steps, which said where to go; the owner, starting cold, found that a new shop's Today never leads to the setup (T-0037). The trial ran on a development server: about 30 s to open (T-0038). The staging gap was known 35 h before and never asked. | P7 |
| F8. Done records are never removed | workflow defect: `execute.md` says remove them after acceptance, and nothing does | 34 Done records of four accepted milestones stay on `main`; the removal on 16 October was refused by the harness's safety classifier as irreversible deletion and dropped; its job closed "finished" | P8 |
| F9. The project's own agents were not loaded | project configuration problem | the session started in `~/dev`, not the repository, so `.claude/agents/independent-reviewer.md` and `trial-walker.md` were "not registered"; reviewers and the walker ran as general-purpose agents told to follow those files, with write tools | P9 |
| F10. A defect in code the task did not change made its pull request the owner's merge | improvement proposal | R-0063/F1, a race from M-0004's T-0020, found in T-0031's review; fixed by T-0032 as the owner chose; #91 waited for the owner | P11 |
| `wf ci` red on 69 of 123 runs, nearly all drafts before evidence | expected, as MAINT-0018 § 4a decided | Actions minutes only (73 min in all); no agent acted on them | no change |
| The coordinator deleted the evidence branch holding the walk's screenshots, then restored it | agent misunderstanding | 06:06 on 16 October | covered by P8 (the prune never touches evidence) |

## 4. Proposals

Each states the failure it prevents or the cost it removes and the check that would catch a recurrence, as `maintenance.md` requires. Estimates are against M-0005's $528.

- **P1. Implement in slices.** `wf brief --lead` splits the task into slices by its acceptance IDs (or, for a task without them, by the record's scope list) and tells the lead to give each slice to a fresh helper that ends at the slice's checkpoint commit; a fix round already goes to a fresh helper. A slice's helper gets the record, the previous checkpoints and the diff so far, not the earlier helper's conversation. Removes: helpers re-reading a 600–800 K context on every call; estimated $40–60 (the four largest helpers at a 300 K ceiling), and part of the rebuild cost in § 1. Check: the brief's slice list is tested; per-helper peak context is measured in the next study (target under 350 K). No gate can read a harness's token counts, so the measurement is the check.
- **P2. Start every task that can start, in the background.** `wf next` prints the startable set: claimed-ready tasks with no outstanding prerequisite and scopes disjoint from the running ones, up to the three `execute.md` allows. Leads are launched in the background and the coordinator acts on each return; "in the foreground" goes from `execute.md`. A claim no longer waits for `main`'s CI: `baseline_result` may be `pending: <run id>` at the claim and must be filled before the review packet (`readiness.js`, `review-packet`). Prevents: about 5–6 h of the 43 h (T-0025, T-0026, T-0028 beside the T-0029 → T-0032 chain) and the 69 min of baseline waits; the home server's memory ceiling and its heavy-test lock already serialise the browser suites. Check: a `next.js` test for the startable set; a `readiness.js` test that a pending baseline passes a claim and fails at the review packet.
- **P3. A small coordinator.** The acceptance package, the trial environment and the next milestone's draft go to fresh helpers with a brief from `wf brief --acceptance`, as the lead's brief does for a task; the coordinator posts their results. Prevents: the coordinator's 708 K context and its 13 rebuilds; estimated $30–40. Check: `wf next` names the acceptance helper's brief in the acceptance action; the next study measures the coordinator's median context (target under 250 K).
- **P4. A model for each role.** The profile names a model per role (coordinator, lead, implementer, reviewer, paperwork, walker); `wf brief` prints it, and the lead's session outcome records the models used. Default: implementer and reviewer as today, lead and walker Sonnet, paperwork Haiku. Removes: estimated $25–35 (half the leads' write and output prices). Check: `wf session` notes a role whose recorded model differs from the profile's.
- **P5. Keep the second model for what needs it.** (a) `wf next` counts the second-model reviews posted on the milestone's pull requests against the milestone template's budget (two per deep task plus one for the milestone) and warns before a run would use the milestone review's reserve. (b) A review of a merge of the trusted branch covers only the conflicted files, at standard level by the Claude reviewer, unless a conflict is in an enforcement path. (c) `review.md`: launch a second-model review detached from the session (its output to a file, its process not a child of the agent), so a restart does not kill it. Prevents: the milestone review falling back for want of quota, and R-0067. Check: a `next.js` test for the budget line; `review.md` for (b) and (c), which no gate can see.
- **P6. Limits that count what matters (the owner's policy decision).** (a) A failing check in tests the task does not change, which passes on a rerun of the same revision, is recorded as a flake with a found task and does not use the task's attempts. (b) The milestone template's `limits` gain a structured `tasks` count and `found_tasks`, an allowance (for example three) for tasks that fix findings of the milestone's own reviews or trial, reported in the acceptance package rather than asked; `readiness.js` refuses a claim beyond both and says to ask the owner. Prevents: the limits questions of four of the seven rounds, and the 3 h 50 min overnight wait. Check: `readiness.js` tests for both counts; (a) is prose, since attempts are counted by the agent.
- **P7. Walk what the owner will trial, and once without the steps.** (a) The walker uses the build and the address the owner will be given, and records the first page's load time; `acceptance-evidence.js` requires the walk's environment to equal the trial's. (b) Before the steps, the walker tries each scenario from its outcome sentence alone, from a fresh sign-in, and reports where a newcomer gets stuck (the `mateen-walkthrough` skill's method). (c) `wf doctor --record` writes its gaps to the session outcome, and `wf session` refuses an outcome with an unasked gap. Prevents: T-0037 found by the owner, the 30-second trial, and the staging gap reaching the owner a day late. Check: `acceptance-evidence.js` tests for (a) and for an `unguided` entry per scenario; a `wf session` test for (c).
- **P8. `wf prune`.** `wf prune --milestone M-NNNN` writes one records-only commit removing the Done task records of an Accepted milestone and nothing else (never an evidence branch); `wf next` names it after an acceptance, and it rides in the next authorisation pull request, which the owner merges anyway. Prevents: 34 stale records read by every `wf next` and readiness run, and a removal a safety classifier refuses as an ad hoc deletion. Check: a `wf ci` note when an Accepted milestone's Done records remain on the trusted branch; a prune test.
- **P9. `wf doctor` checks where the session started.** It reports a gap when the working directory is not the repository root, so the project's agents and instructions are not loaded. Prevents: reviewers and walkers without their restricted tool lists. Check: a `doctor.js` test.
- **P10. `wf wait --commit SHA`.** Waits for the trusted branch's required checks on a commit, as `--pr` does for a pull request. Prevents: the coordinator's 24 hand-written loops. Check: a `wait.js` test; `wf next` prints it in its `Run:` line after a merge.
- **P11. A defect found in unchanged code is a found task (the owner's policy decision).** A blocking finding whose code the pull request does not change, and whose exposure the merge does not increase, may be carried by a found task named in the delivery evidence; the pull request then keeps the agent's merge. POLICY's rule for a blocking finding the task introduced is unchanged. Prevents: #91's owner merge. Check: `delivery-evidence.js` requires the found task and the finding's paths outside the diff.

Order of value: P1, P2 and P3 together address about half of the measured waste; P7 is the one that would have changed the owner's trial; P8 and P9 are small fixes.

## 5. What stays as it is

Every gate's evidence, the owner's merges of the plan and the acceptance, independent review at the task's level, the milestone review by the second model when it can run, and the trial walk before the owner. `wf ci` keeps running on drafts (MAINT-0018 § 4a).

## 6. How we will know

On M-0006, record with `templates/pilot.md`: cost per task and per role, each helper's peak context, cache writes after waits, wall-clock with tasks overlapping, question rounds by kind, second-model runs against the budget, and whether the owner's trial finds anything the walk did not.

## 7. Corpus size

This record changes no corpus file. The shared corpus (policy, schema, quickstart, procedures, templates, skill) stays at 41,946 words; `execute.md` 2,174, `review.md` 1,329, `accept-release.md` 760, `readiness.md` 1,114, `SCHEMA.md` 7,496. P1–P11 lean on commands and checks; the prose they need is estimated at 400–600 words, mostly in `execute.md` and `accept-release.md`, against the session budget of three to four thousand words for one procedure and its records.

## 8. Limits of this measurement

Output tokens are under-recorded in transcripts (§ 1). Codex's logs for T-0029's two reviews (R-0057, R-0058) were not found, so the Codex total omits them. Savings are estimates from M-0005's own figures, not measurements.
