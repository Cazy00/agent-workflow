# MAINT-0018: What M-0004 measured, a version on every piece of work, and the next cuts

**Status:** Part A was released as v2.6.0 (Cazy00/agent-workflow#49, merged 14 October 2026). Part B is built for v2.7.0 at the owner's word of 14 October ("Do you want to actually build them … We need to get over with this"), with two changes from § 4 recorded in § 4a.

**Classification** (`procedures/maintenance.md`): A1 and F-0001/F-0002 are workflow defects; A2 and A3 change what a gate accepts, the owner's policy decision, given below; A4 is an improvement proposal the owner asked for. Part B is improvement proposals.

**Owner's words (14 October 2026):**
- On the review of the M-0004 sessions: "Okay, good. Let's add those things. Let's change our agent workflow and add those upgrades and enhancements accordingly."
- On versions: "whenever we work on something I think it needs to have some sort of tag or some sort of identification like what version of agent workflow it was running with; this will make us actually track the use and actually know whether that came from a specific version or another."

---

## 1. What happened in M-0004 (mateen-systems, 12–14 October 2026)

M-0004 was MAINT-0016's measurement (its § 7). It ran in two sessions, both on agent-workflow **v2.4.2**: a Claude CLI session on the owner's MacBook (12 Oct 06:00 → 13 Oct 06:46 UTC) and one on the owner's home server (13 Oct 18:09 → 14 Oct 04:50). v2.5.1 was released an hour before the second session began, and the milestone stayed on v2.4.2 until the owner merged the upgrade after accepting it. Finding that out needed the project's Git history: no session outcome, review or milestone record said which version it ran under.

| | M-0003 (v2.2.0–v2.3.1) | Predicted for v2.4.0 | M-0004 (v2.4.2) |
|---|---|---|---|
| Owner merges | 13 | 3 | 4: authorise #66, #73 (avoidable, § 2), #83 (a residual finding the owner accepted), accept #84 |
| Owner "merged / continue / what now" messages | 29 | 3–6 | 3 |
| Waiting on CI with nothing needed from the owner | 7 h 25 min | near zero | about 1 h 20 min, mostly the Done pull requests (A1) |
| Work idle on the owner | 12 h 40 min | — | about 20 h: 13 h 18 min on #73, 4 h 47 min overnight, 1 h 57 min on a question |
| Reviews / second-model runs | 23 / 23 | about 8 / about 4 | 14 / 11 |
| Model tokens | ≈ 1.16 billion | 40–50 % less | ≈ 0.84 billion (27 % less); the Mac session's own count is $257 |
| The owner's trial | wrong steps, missing setup | walked first | walked twice: real defects found, 13 step wordings corrected, 32 screenshots; staging not prepared |

Auto-merge worked for all 12 of the agent's own pull requests. What remains is mostly idle time and helpers that grew large.

## 2. Findings and dispositions

| Finding | Classification | Evidence | Disposition |
|---|---|---|---|
| Every task needed a Done pull request of its own | workflow defect | `ci.js` accepted Done in a task's pull request only while the trusted branch held it Ready or Active; planned tasks wait there as Draft and are claimed on their branch. #68, #70, #72, #75, #77, #82; #77 stalled 11 h 41 min on the GitHub billing outage | A1 |
| The acceptance had to merge before the owner's upgrade (#84 before #79) | workflow defect | `acceptance-evidence.js` refused any non-record change after the accepted revision, workflow files merged from the trusted branch included; delivery evidence already carried them (`carry.js`). The owner had turned on auto-merge for #79 | A2 |
| A test-only task reviewed deep three times | workflow defect | mateen's `**/*{invoice,numbering,issuer}*` matched `apps/server/test/acceptance/numbering.ts`; T-0019: three Codex runs, about 3 h, about 174 M tokens | A3 |
| F-0001: the session template has no `limit` | workflow defect | mateen `docs/workflow/feedback/inbox/F-0001.md` | A5 |
| F-0002: `scripts/wf` cannot be pointed at a clean review clone | workflow defect | `bin/wf-adopt` wrote `--repo "$ROOT"` unconditionally; recurred in T-0020, T-0021, T-0016, T-0017, T-0022, T-0023 | A5 |
| No record of the workflow version a piece of work ran under | improvement proposal | the owner's words above; this review had to rebuild it from `docs/workflow/config.json`'s history | A4 |
| Task leads implemented their tasks themselves; leads grew to 535–635 K tokens | agent misunderstanding, made likely by hand-written briefs | `execute.md`: "It has a fresh helper implement it"; briefs said "Build it." for 7 of 8 tasks; task leads spent about 60 % of the milestone's tokens | B1 |
| A trial walk in the foreground hid a blocking review result for 81 min | improvement proposal | `trial-walker.md`: "Launch it in the foreground"; walk 1 ran before R-0054 returned and was voided by T-0024's fix | B2 |
| A governing edit made #73 the owner's merge, idle 13 h 18 min | improvement proposal | T-0016's lead edited `apps/web/ARCHITECTURE.md`; restoring it voided the review under `carry.js` | B3 |
| A second fix review bought nothing | improvement proposal | R-0056 found the same narrowed gap, which the owner accepted; the coordinator recommended it against its own reading that nothing was exposed, and resumed a 535 K-token lead | B4 |
| Missing staging access found at 18:17, told at 04:44 | improvement proposal | the home server had no SSH key for `workhorse`; #84 asked the owner to deploy | B5 |
| Agents wrote their own waits, Done commits and ID searches | improvement proposal | one wait loop silently saw no checks (`gh pr checks --json` unsupported on the server); another died on one network error | B6 |
| `wf ci` red on every draft push; baseline suites rerun | improvement proposal | 45 red `wf ci` runs in M-0004, nearly all drafts before evidence | B7 |
| Questions blocked the session (about 2 h) | covered by MAINT-0017 B3 | the billing failure went unnoticed meanwhile | MAINT-0017 B3, unchanged here |

## 3. Part A: built for v2.6.0

- **A1. Done in the pull request that claims the task** (`ci.js`, `execute.md`, SCHEMA *Integration and CLI*). Done is accepted as the last commit when an earlier commit of the same pull request, not of the trusted branch, sets the record Ready or Active. A Draft marked Done without its claim still fails, with a message saying what is missing. The claim is the agent's own record: it keeps a Done marking on the normal claim path but authenticates nothing; readiness, the delivery evidence and the review still gate, as they did for a Draft claimed and implemented in one pull request. Prevents: one Done pull request per task. Check: `maint-0018.test.js`, including a Ready record in the trusted branch's history (the independent review, S3).
- **A2. Acceptance across a workflow upgrade** (`acceptance-evidence.js`, `carry.js`, `accept-release.md`). The accepted, reviewed and walked revisions may be followed by records and by the files `bin/wf-upgrade` writes (`docs/workflow/config.json`, where the pin is, `scripts/wf`, the installed `wf` workflows and agents) where a merge of the trusted branch brought them in, untouched by the pull request. Anything else from the trusted branch, the project's own code, deploy workflows and other enforcement paths included (the independent review, S1), or a workflow file the pull request edits itself, still needs a new review and walk. **The owner's policy decision:** a workflow upgrade during a milestone is judged by its own pull request, which the owner merges; it does not reopen the milestone's acceptance. Check: `maint-0018.test.js`.
- **A3. Test files are not deep by accident** (`paths.js`, `ci.js`, `review.md`). A deep glob that matches by name anywhere reaches a test file only when it names tests; one anchored on a folder reaches everything under it. A test file is recognised narrowly, by each language's convention, so a file in doubt stays deep; a non-code spec, such as an OpenAPI document, is never one (the independent review's S5 and its fix review). **The owner's policy decision:** a test-only change to deep code is reviewed at its own level; a project that wants its tests reviewed deep names them. Check: `maint-0018.test.js`.
- **A4. A version on every piece of work.** `wf next` prints the pin and a newer release; session outcomes carry `workflow`, checked by `wf session`; `wf ci` and its summary name the judging version; reviews record it; milestones carry `workflow_version`, required at authorisation, kept equal to the pin while in progress, and moved by `bin/wf-upgrade` with the owner's merge. Prevents: work that cannot be traced to a release, and a pin moved under a running milestone without a visible decision (the existing rule in `maintenance.md`, now a check). Check: `maint-0018.test.js`.
- **A5. Smaller fixes.** The launcher is `templates/scripts/wf`, refreshed by `bin/wf-upgrade` (the old copy is recognised by its hash, `adapters/launcher.mjs`); it passes `--repo` on, and in a read-only installation only reads. The session template has `limit`; missing outcome fields say what they hold; `wf session` needs `--task` only for verified-complete. Prevents: F-0001's extra run and F-0002's failed runs before every deep review, and a session stuck on an acceptance pull request without a task. Check: `maint-0018.test.js`.

## 4. Part B: proposed for the next release

Each item states the failure it prevents and the check that would catch a recurrence, as `maintenance.md` requires.

- **B1. Task-lead briefs from a command.** `wf brief --lead T-NNNN` prints the brief: the task's governing excerpts (not whole records), the governing paths the lead must not edit, the review level, and the instruction that a fresh helper implements, a fresh helper takes each fix round, and a small one does the closing paperwork, with the PR-body and evidence skeleton. The session outcome gains `implementer` (`helper` or `lead`), and `wf session` flags a lead that implemented its own task. Prevents: leads at 400–635 K tokens, which spent about 60 % of M-0004's tokens. Check: `wf session` on the lead's outcome; per-task tokens on M-0005.
- **B2. End-of-milestone order.** Milestone review, then its fixes, then one walk, in the background, run after the review is clean. The walker keeps its scripts so a re-walk reruns only the steps whose code or wording changed, and checks results with page text, viewing only key screenshots. `accept-release.md` and `trial-walker.md`. Prevents: a walk voided by a later fix (walk 1 of M-0004), and a blocking result unread for 81 min while a foreground helper ran. Check: `acceptance-evidence.js` requires the walk's revision to follow the milestone review's.
- **B3. Putting a governing file back keeps the review.** `carry.js` accepts a commit that only restores governing paths to the trusted branch's content, and `wf ci`'s owner reason for a governing change says it can be moved into the milestone's acceptance pull request. Prevents: #73's 13 h 18 min stall. Check: a `carry` test.
- **B4. Fix reviews in proportion.** A blocking security finding states the concrete exposure (`review.md`, the reviewer template). Where a fix review finds no exposure, the coordinator's default is to accept the residual and carry it to a later milestone, without asking; each fix round goes to a fresh helper (`wf next` says so). The milestone template budgets two second-model runs per deep task plus one for the milestone. Prevents: R-0056, an owner question, a Codex run and 29 M tokens that changed nothing. Check: the delivery evidence's blocking findings need an `exposure` field (`delivery-evidence.js`).
- **B5. Start-of-session preflight.** `wf doctor` checks what the milestone's authority needs (staging deploy access, a browser for the walk, Codex, `gh` scopes and version) and puts any gap into the first question to the owner. Prevents: a gap known at 18:17 reaching the owner at 04:44. Check: `wf next` names `wf doctor` as the first action of a session whose milestone has not passed it.
- **B6. Commands instead of hand-written loops.** `wf wait --pr N [--merged]` (tolerates network errors, ignores superseded runs, works with an older `gh`), `wf done T-NNNN` (the Done commit for A1), the next free review and task IDs in `wf next`, and `wf evidence --json`. Prevents: a wait that silently saw no checks, one that died on a single network error, and IDs found by searching comments. Check: each command's tests, and `wf next` prints them in its `Run:` lines.
- **B7. Less CI noise.** `wf ci` skips draft pull requests and runs on `ready_for_review` (GitHub will not merge a draft); a task's `baseline_result` may cite the trusted branch's CI run for the same commit instead of rerunning the suite. Prevents: 45 red runs that meant "not finished", and a full suite rerun at every task's start. Check: a `wf-ci.yml` test for the draft guard, and `readiness.js` accepting a cited run for the exact baseline.

Not in Part B: running questions without stopping (MAINT-0017 B3, already proposed), and the milestone integration branch (IDEA-11, parked).

## 4a. Part B as built (v2.7.0)

What was built, against § 4, and the checks that hold it (`validator/test/maint-0018-b.test.js`):
- **B1.** `wf brief --lead` prints the brief: the rule that a fresh helper implements, a new helper takes each fix round and a small one writes the paperwork; the task's records (its record, its milestone's outcome, limits and stop conditions, its acceptance definitions); the governing and enforcement paths it must not edit; the commands, with the trust options in manual mode. It lists the governing records to read rather than excerpting them, and gives the session outcome's skeleton, not a pull-request body. A lead's outcome may give `implementer`; `wf session` notes `lead`. `wf next` lists the brief, and `wf doctor`, first in every action that starts, readies or continues a task.
- **B2.** The procedure and the walker's template only: walk after the milestone review and its fixes, in the background, rerunning only the steps that changed. The check § 4 proposed adds nothing: `acceptance-evidence.js` already refuses a walk or a review of code that changed afterwards, which is why M-0004 needed its second walk. What went wrong was timing, which no record holds.
- **B3.** A governing file put back to the trusted branch's content no longer voids review or verification (`carry.js`); an acceptance test never carries this way. The owner's reason for a governing change in a pull request with code says the clarification can move to the milestone's acceptance pull request. Nothing checks the code against the restored text: the coordinator confirms the code does not rely on it.
- **B4.** A blocking, critical or high finding needs `exposure` (`delivery-evidence.js`); the review template, the reviewer and `review.md` say severity follows exposure and the reviewer sets it. **The owner's policy decision** (14 October, approving § 4): a finding nothing is exposed to is not blocking, so with `approval.defer_to_acceptance` such a residual waits for the acceptance rather than the owner's merge. POLICY's rule that a blocking finding accepted rather than fixed always waits for the owner is unchanged; what changes is that severity is set by exposure. Not built: `wf next` naming a fresh helper for each fix round; the lead's brief says so instead.
- **B5.** `wf doctor` checks node, git, `gh` (the account `gh api user` reports against `approval.agent_identity`, and push access), the second model's tool, and the config's `preflight` commands, read from the trusted branch and run without signing, `WF_` or `GPG_` variables. Not built: a gh token-scope check, and a record of a session's doctor run that `wf next` could test; `wf next` lists `wf doctor` instead.
- **B6.** `wf wait` (the required checks must appear and finish, two polls must agree, a failed check ends a `--merged` wait, numbers are validated, 30 minutes by default), `wf done`, `next_ids` (T, M, D, F past every record the history added; an open pull request's new records are not seen; review IDs live on the pull requests and are not computed), `wf evidence --json`.
- **B7.** Its second half only: the trusted branch's own CI run on a task's exact baseline commit counts as its baseline run when it ran the task's verification commands (`readiness.md`); no check can verify that, so it is prose. Skipping `wf ci` on draft pull requests would bring back the hole v2.4.1 closed: GitHub counts a skipped required check as passed, so a pull request marked ready, with auto-merge turned on at once, could merge before the check ran again.

Independent review: approve with notes; its findings S1–S9 and notes N2–N7 are dealt with in this release (the pull request lists each).

## 5. What stays as it is

Every gate's evidence requirement, the owner's merge of the plan, the acceptance and workflow changes, the independent review, and manual and enforced modes. A1 accepts Done only with the claim in the pull request's own history; A2 carries only enforcement paths the trusted branch brought in; A3 changes only which test files a glob reaches.

## 6. Expected outcome and how we will know

On M-0005: no Done pull requests (A1); no acceptance ordering advice (A2); no deep review of a test-only task (A3); every session outcome, review and milestone names its version (A4). With Part B: leads under 300 K tokens, one walk per milestone, and the owner's idle time limited to decisions. Record, with `templates/pilot.md`: owner merges and messages by kind, idle time by cause, reviews and second-model runs by level, tokens per task, and the version each session names.

## 7. Release and adoption

Release v2.6.0. For mateen-systems, in that repository: run `bin/wf-upgrade` (it refreshes `scripts/wf`, `wf-ci.yml` and the reviewer agent, and sets M-0005's `workflow_version` if M-0005 is authorised by then); the owner merges it. Authorising M-0005 afterwards sets `workflow_version: v2.6.0`.

## 8. Corpus size

The shared corpus (policy, schema, quickstart, procedures, templates, skill) is 40,505 words before this change and 41,324 (+819) after, about 300 of it the launcher, now a template (`templates/scripts/wf`) rather than text inside `bin/wf-adopt`. Procedures changed, against the session budget of three to four thousand words for one procedure and its records: `execute.md` 2,088 → 2,120, `review.md` 1,148 → 1,196, `accept-release.md` 665 → 719, `operate.md` 1,099 → 1,143, `readiness.md` 1,072 → 1,080; `SCHEMA.md` 7,017 → 7,263.

Part B (v2.7.0): the corpus grows from 41,324 to 41,874 words (+550); `execute.md` 2,120 → 2,174, `review.md` 1,196 → 1,329, `accept-release.md` 719 → 760, `readiness.md` 1,080 → 1,114; `SCHEMA.md` 7,263 → 7,424. `review.md` takes most of it, for the exposure rule and the fix-review default.
