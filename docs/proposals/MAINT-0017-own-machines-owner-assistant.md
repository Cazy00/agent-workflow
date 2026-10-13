# MAINT-0017: Our own machines, an assistant who acts on the owner's word, and questions that don't stop the work

**Status:** approved by the owner, 13 October 2026 ("approved", in the session that wrote it). Implementation plan for v2.5.0: `docs/proposals/MAINT-0017-plan.md`; v2.6.0 gets its own.

**Classification** (`procedures/maintenance.md`): improvement proposal, after a workflow defect. Four parts change authority or a control, which is the owner's policy decision: running `wf ci` on the owner's own runner (A2), the owner's assistant (B1), making this repository private (C1), and removing arrangements the owner won't use (C2). The rest changes templates, procedures and the validator within existing authority.

**Owner's words (12–13 October 2026):**
- "I do not want to pay." All development and long-running work moves to the owner's always-on server; the cloud host is mainly for hosting.
- "Agent workflow will not be for anyone else. It will be for me … optimized for our way of working." "We will make the repository private."
- "I'm not going to look at any code at all … I'm just going to view the viewable thing or the viewable milestone." Maybe changed documents.
- On questions: "I don't want them to sit idle because I didn't see their question … It needs to only stop if my input is affecting the process itself."
- On the owner's own AI assistant, which holds the owner's account: "me and my AI agent … we are like one entity." After the limit in B1 was explained: "What you have said sounds really right."

---

## 1. What happened (1–13 October 2026)

GitHub Actions stopped on the owner's account on 13 October. Every job on mateen-systems #77 failed without starting: "The job was not started because recent account payments have failed or your spending limit needs to be increased." `wf ci` is a required check that runs only on GitHub's runners, so no pull request could merge. M-0004 stopped with T-0022 and T-0023 recorded but unable to start.

Billable minutes, 1–12 October, rebuilt from every job's duration (rounded up per job, as GitHub bills). Total 2,737; GitHub's alert said 2,704 of 3,000.

| Source | Minutes | Share |
|---|---|---|
| mateen-systems `CI` (`checks`, `acceptance`, `deploy`) | 1,969 | 72 % |
|  of which re-run on `main` after each merge | 581 | |
| mateen-systems `wf-client-page` | 313 | 11 % |
| mateen-systems `wf ci` | 162 | 6 % |
| mateen-systems `wf-status` | 61 | 2 % |
| two other private projects | 232 | 8 % |

- Daily use in mateen-systems: 83, 348, 517, 752, 805 minutes (8–12 October). It rose with the acceptance suite, whose test step alone reached about 6¼ minutes per run.
- 532 jobs ran 20 seconds or less, and each was billed a full minute: 532 minutes. The client page alone ran 642 jobs (313 minutes): a dispatch on every push to every branch, then a build and a deploy.
- 30 of 72 pull requests changed only records or documents. Each still ran the full suite twice, on the pull request and again on `main`: about 330 minutes.
- Of 64 runs on `main` after a merge, one failed: a timeout in `sections.test.ts` on a records-only merge whose pull request had passed on the same tree. It was a flaky test, not a defect the pull request's run missed. The ruleset requires branches to be up to date, so `main` always held exactly the tree the pull request had tested.
- GitHub Pages for a private repository needs a paid plan. The client page depends on it.

## 2. Why

1. **Every gate runs on metered machines the owner doesn't control.** The installed workflows hard-code `ubuntu-latest`. When the minutes ran out, nothing could merge: not even a records-only change.
2. **Cost grows with every pull request.** `delivery.md` describes skipping product steps on planning-only changes, but no template implements it. The client page rebuilds three jobs on every push to every branch.
3. **The workflow is fetched without a token.** `wf-ci.yml` and the acceptance job fetch the validator anonymously from this repository, so it can't go private without breaking every project's CI.
4. **A question ends the session.** POLICY § 5 already says agents continue unrelated ready work while a decision is pending. But an agent that asks in chat ends its turn, and nothing carries the question anywhere else. The work waits for the owner to read and reply.
5. **The owner is asked to judge code.** When `wf ci` says `merge: owner`, its reason is a file list ("it changes the workflow: .github/workflows/ci.yml"). The owner doesn't read code, so the merge is approved unread, as MAINT-0016 measured in M-0003.
6. **Nobody may do owner-side chores.** Repository variables, runner registration tokens, settings, and merges the owner has decided all wait for the owner's own hands. Worker agents are rightly barred from the owner's account, and nothing defines an assistant that acts on the owner's word. On 13 October, CI stayed blocked on three such steps.

## 3. The changes

Each change names the failure it prevents and the check that catches a recurrence (`procedures/maintenance.md`).

### Part A: run on our own machines

**A1. A runner switch in every installed workflow.** `wf-ci.yml`, `wf-status.yml` and `wf-client-page.yml` use `runs-on: ${{ vars.WF_CI_RUNNER || 'ubuntu-latest' }}`. The setup procedure gives a project's own CI the same pattern with `vars.CI_RUNNER` (mateen-systems #74 is the first instance). Deleting a variable sends those jobs back to GitHub.
- Prevents: § 2.1. Check: template tests assert each installed job's `runs-on`. `wf-upgrade` refreshes the three files.

**A2. Two runners per project: build and gate** (setup and operate procedures; scripts under `server/`).
- **Build:** a container with Docker, where the project's tests and deploys run: pull-request code and its packages. Docker is cleared after every job.
- **Gate:** a container with no Docker and no sudo. It runs only `wf ci`, `wf-status` and the client page. Product code and its packages never run there, so they can't tamper with the check that decides who merges.
- **Policy:** `wf ci` on a persistent self-hosted runner is weaker than on GitHub's fresh machines: a job that ran there earlier could have left something behind. The gate keeps product code out. D1 (a fresh container per job) closes the rest. This is the owner's decision.
- Prevents: § 2.1. Check: no check can see where a job ran. The project's setup record lists its runners, as it lists protections today.

**A3. The planning-only fast path in templates.** `wf paths --planning-only` exits 0 when every changed path is planning, read with the baseline's config. It's run on both events, from the base-pinned validator. A project's CI skips its expensive product steps on that answer; records, workflow and documentation checks still run (`delivery.md`, unchanged).
- Prevents: § 2.2. On self-hosted runners it saves queue time, not money. Check: `paths.test.js` with a records-only and a production diff, on a pull request and on a push.

**A4. The client page: less often, and not on Pages.**
- Build on the gate runner on a push to `main`, when a pull request opens or closes, and every 15 minutes. The dispatch job on every branch push goes.
- ~~Publish through `client.publish`: `pages` or `cloudflare`.~~ Moved to D4 when planning v2.5.0. Pages works for as long as the paid plan does, and on the owner's runner a rebuild costs nothing. Where the page is published belongs with the GitHub plan decision.
- Prevents: § 2.2. Check: the template test evaluates each event's `if:`, including both schedules with and without the gate runner.

**A5. A private workflow repository.** The fetch in `wf-ci.yml`, the acceptance job and `scripts/wf` uses a read-only token when the secret `WF_READ_TOKEN` is set, or a mirror named in `workflow.mirror`. The pin and the base-branch rule are unchanged.
- Prevents: § 2.3. Check: a template test, and a fixture that fetches a pinned revision from a local mirror.

**A6. When the runner is down** (`operate.md`). Jobs queue rather than fail, and merges stall. The fix is one setting: delete the variable, then re-run the waiting jobs on GitHub. A re-run uses the run's own commit, so a pull request whose workflow files changed needs a new push instead.
- No check; this is operating knowledge.

### Part B: the owner sees results, not code, and never holds up unrelated work

**B1. The owner's assistant** (POLICY § 7, `identity.md`, profile).
- An owner may name an assistant: an AI session that holds the owner's account and does owner-side work for the owner. Its actions are the owner's.
- It acts only on the owner's explicit word, given in its own conversation. Never on a worker agent's request or anything a worker wrote. It never approves, accepts or merges on its own judgement.
- The independent reviewer stays a separate context. Worker accounts never hold the owner's token (unchanged): it lives where worker accounts can't read it.
- Prevents: § 2.6, without letting an AI approve an AI's work. Check: none can tell the owner's word from the assistant's. Like owner-merge's existing limit ("nothing proves who merged"), this rests on the arrangement the owner records in the profile.

**B2. A plain-language card for every owner merge.** When `wf ci` reports `merge: owner`, the delivery evidence must carry `owner_summary`: what changes for the owner, the risk, how to undo it, and the reviewer's verdict, in words a non-programmer can act on. `wf ci` prints it in the run summary.
- Prevents: § 2.5. Check: `wf ci` fails a `merge: owner` pull request without `owner_summary` (`checkpoints.test.js`).

**B3. Questions never stop unrelated work** (`execute.md`, session outcome).
- An agent that needs the owner records the question as an Open decision, naming the work it blocks. It tells the owner (B4 later), and carries on with everything else.
- It ends its session only when `wf next` lists nothing unblocked.
- The session outcome gains `open_questions` and `continued_with`.
- Prevents: § 2.4. Check: `wf session` fails an outcome that stops with open questions while unblocked work remained at its baseline.

**B4. Acceptance the owner can click** (`accept-release.md`). The owner gets a preview link to the milestone, and a short "what to try" list built from its acceptance scenarios. The trial is walked first, as since MAINT-0016. Changed documents are listed in plain words.
- Prevents: asking a non-programmer to accept what they can't see. Check: `acceptance-evidence.js` requires the preview link, or `not_applicable` with a reason.

### Part C: the workflow is the owner's

**C1. Private repository.** After A5 is released and every project has moved its pin, the owner makes this repository private. Its own CI then runs on the owner's runner (A1).

**C2. Remove what the owner won't use**, one decision each, recorded here before anything is deleted. Candidates:
- two or more owners (`shared.md`);
- the Spec Kit adapter;
- the one-account arrangement.

**Manual mode stays** until the GitHub plan decision (D4): it is the arrangement that needs no GitHub protections.

**C3. Written for one owner.** README and QUICKSTART drop the guidance for other people adopting the workflow.

### Part D: server services, each a later maintenance item

- **D1.** A fresh container for every job, as on GitHub's runners, for every project, with the owner's token kept root-only on the server.
- **D2.** One owner inbox across projects (what waits on the owner, what each agent is doing, what's blocked), with phone alerts.
- **D3.** A preview link for each pull request, behind the owner's sign-in.
- **D4.** The GitHub plan. On the free plan, private repositories lose rulesets (required checks, required pull requests) and Pages. The choices: keep a paid plan; host Git and CI on the owner's server; or manual mode. Where the client page is published (Pages, or a static upload to Cloudflare) follows from the choice. Decide before the current plan ends.

## 4. What stays as it is

- Every gate, independent review in a separate context, the owner's acceptance, and the owner's merge of governing, owner-record and enforcement changes (now with B2's card).
- Each project pins its workflow version, and the validator that judges a pull request comes from the base branch's pin.
- A milestone keeps the version it started on.

## 5. Not in this change

Part D, each a later maintenance item. Moving the CI run on `main` to a nightly run: `delivery.md` keeps it on every push, and on the owner's runners it costs nothing.

## 6. Expected outcome

| | 1–12 October | Expected |
|---|---|---|
| GitHub minutes | 2,704 in 12 days (about 6,800 a month at that rate) | near 0 with A1–A2 |
| A merge blocked by GitHub billing | 13 October, all projects | not possible while the runners are up |
| Owner merges judged from code | every `merge: owner` | none: each comes with a card |
| Work idle while a question waits | until the owner replies | only the work the question blocks |

## 7. How we will know

Run M-0005 on the new version, and record:
- GitHub minutes and queue time;
- owner messages by kind, and owner merges with their cards;
- questions, with the work done while each was open;
- what the owner's trial found.

## 8. Release and adoption

- **v2.5.0 (Part A):** A1, A2, A4, A5, A6, then A3. mateen-systems keeps #74's project-local switches until it moves its pin.
- **v2.6.0 (Parts B and C):** B1–B4, C2, C3. C1 is the owner's action once every project is past v2.5.0.
- **mateen-systems** finishes M-0004 on v2.4.x. It moves its pin as the first task of M-0005 on the owner's server.

## 9. Corpus size

Shared corpus: 39,204 words before v2.5.0, 39,858 after (counted as `cat POLICY.md SCHEMA.md QUICKSTART.md procedures/*.md .agents/skills/workflow/SKILL.md $(git ls-files templates) | wc -w`). Most of the 654 are the two new fetch steps and the comments in the installed workflow files. Procedures grew by 200 words: `setup.md` 2,305 → 2,372, `operate.md` 888 → 969, `delivery.md` 200 → 252. `procedures/execute.md` is unchanged. v2.6.0 records its own, with `execute.md`'s net growth kept under 250 words.
