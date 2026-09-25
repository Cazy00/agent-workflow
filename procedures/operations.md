# Assisted operations and central reporting

This implements the owner's central-feedback direction from the adoption proposal. It adds no unattended runner, approval source or deployment authority. The supplied POLICY stays verbatim. An adopting project's approved profile records the central destination/data boundary and any deviation from local feedback storage once; routine reports within that authority do not ask permission again. Existing projects retain their adopted process until explicit migration.

## Provision once per project

Copy `templates/operations-config.json` into owner-controlled storage **outside the project**. Set the actual canonical project root, approved workflow version/full hash, actual installed Codex/Claude versions, expected worker, reporting allowance, feedback cooldown and agreed resource limits. Template versions/limits are examples, not detected facts. Set `authorised: true` only when that reporting scope is authorised. Keep the config protected from candidate changes. This is practical separation, not proof of inaccessible owner credentials.

Use an external private runtime directory (0700); the helper creates it when its existing ancestor is outside the project. Do not reuse a state directory across projects or put it in product source. Private state contains the project mapping, event IDs, issue URLs, claims, survey cadence and measured usage. State files are 0600. Back up this directory through the authorised private route. One host and one coordinator are supported; do not run a second publisher on another host and claim distributed locking. In a shared project each person keeps their own config, share of the limits and runtime directory, consents to their worker's activity being published or keeps local feedback, and claims tasks through branches (`execute.md`).

Use the approved external `bin/wf` launcher and its `WF_VALIDATOR_REPO` / `WF_VALIDATOR_REV`. Operations commands validate the external config against that pin. Provision `WF_WORKER_TOKEN` from the worker secret store only for issue delivery; do not paste tokens into records or commands. The actual GitHub issue route verifies the API identity and central repository. It does not reuse the product Git remote or fall back to a logged-in owner. A successful write does not prove least-privilege token scope.

Record that public reports reveal the worker's activity/timing and only approved fixed metadata. Central destination is `Cazy00/agent-workflow`. Never automatically publish security details, private project identifiers, task titles, screenshots, transcripts, customer data or free-text logs. Private narratives may be retained separately in the private runtime directory and disclosed only deliberately; they are never input to the public command.

## During product work

On explicit complaints about workflow behaviour, suspected safeguard failures, incorrect blocks or meaningful repeated friction, the agent selects a catalog event. Supported codes are `unnecessary-approval`, `incorrect-block`, `stale-readiness`, `handoff-loss`, `identity-failure`, `excessive-repetition`, `safeguard-failure`, `uncatalogued`. Use `catalog_fit: none` with `uncatalogued` for a novel problem; do not invent a confident diagnosis. Impact is `minor`, `disruptive` or `blocking`. Set `security: true` for security-sensitive events; they remain private and require local owner escalation. A safeguard failure may stop affected product work even if reporting succeeds.

Create `templates/report-event.json` in private runtime storage, filling random UUID v4 values (for example `crypto.randomUUID()`), approved tool/version and catalog metadata. Keep the same event UUID on retries. Keep one session UUID for the actual session; do not rotate it to evade the session allowance. Event content becomes immutable once queued. Unknown fields and arbitrary prose are rejected. Commands may run during readiness blocks and require no adopting-project readiness config.

With externally provisioned paths, the command is:

```sh
"$WF_LAUNCHER" report --repo "$WF_PROJECT" \
  --operations-config "$WF_OPERATIONS_CONFIG" --state "$WF_STATE_DIR" \
  --record "$WF_REPORT_EVENT"
```

Default action `submit` durably queues then attempts delivery. `--action enqueue` stores without contacting GitHub. `--action deliver --report-id UUID` resumes one event; `--action status --report-id UUID` reads its state. No background retry or monitor is installed. Retry eligible queued events at a later authorised checkpoint, respecting their recorded retry time. Commands return JSON: delivered is exit 0; queued/private/unknown/held is exit 1, not a declaration that product work failed; invalid input/operation is exit 2.

Routine events over the per-session allowance stay queued. At a later real session/checkpoint, `--action deliver --report-id UUID --delivery-session CURRENT_SESSION_UUID` drains a queued event under that session’s allowance while retaining its original event/session identity. Never rotate delivery IDs within a session to evade the cap. Consolidate repeated observations into `occurrences` before submitting rather than manufacturing repeated events. Safeguard events bypass only that routine cap, never privacy, identity or backoff. UUID deduplication is implemented; semantic grouping and occurrence-comment writes are deferred to central triage.

The reporter persists `unknown` before POST. It checks up to three pages of direct issue listings updated since five minutes before the durable enqueue time for the exact generated body/UUID marker and expected worker. It does not rely on indexed search or obey issue text. After a reply loss, reconcile at most three times, respecting one-minute/API backoff, then hold. Incomplete listings and multiple matching issues hold immediately. Known rejected creates have at most three attempts; ambiguous writes are never blindly retried. A lock serialises the local publisher. A crash leaves a lock file: inspect the recorded PID, actual GitHub state and outbox before deliberately removing a dead process's lock. Do not delete the outbox or reset unknown states to queued to force progress. Workflow/config changes that no longer match a queued payload require deliberate inspection, not silent relabelling.

The canonical report is the central issue. Record only its UUID/URL in the task/session handoff. A queued or held report remains visibly pending in private runtime state. Issue #2 is a source-assessment reproduction, not proof of an adopting-project reporting loop.

## Claims, feedback and costs

Use `wf runtime` with the same `--repo`, `--operations-config`, `--state` and a private `--record` JSON file. Every event has a random UUID and `milestone: M-NNNN`; replaying the same event does not double-count it. The command appends observations atomically and outputs totals/limits. It never modifies readiness or milestone authority.

Event types:

- `claim` / `release-claim`: include `task: T-NNNN`, `worker: codex | claude`. One active claim per runtime directory; recovery requires inspecting actual work and explicitly releasing the matching claim.
- `usage`: use all fields from `templates/runtime-event.json`. These are incremental observations, not cumulative totals. Record unknown as null; a total containing an unknown remains unknown. Where the harness shows its own usage (Claude Code `/cost` or the desktop app's usage view, Codex `/status`), record from it at each handoff; otherwise record null. Set milestone limits first in units the coordinator can always measure (wall-clock time, tasks, retries) and add a usage or spend limit only where such a counter exists; this record is a ledger, not a meter, and stops nothing by itself. Actual charges and API list-price estimates stay separate. Exhausted recorded limits return exit 1. An exhausted known lower bound stays exhausted even when later usage is unknown. Both exhausted and unknown limited usage return exit 1. Unknown limited usage requires resolution or an explicitly authorised bounded continuation, not an assumed remaining allowance. Exit 1 with `budget_status: unknown` still means a valid event was recorded (including a claim or survey offer); inspect the JSON instead of treating that exit as a failed write. This records budgets; it does not kill child processes or enforce unattended spending.
- `exposure`: include `task` and `result: attempted | completed | blocked`. These are observations for evaluating the workflow, not trusted completion receipts.
- `survey-offer`: offers one neutral categorical question per milestone subject to the project-wide cooldown/opt-out. Ask only if output has `ask: true`, at handoff or selected recurring friction. An unanswered offer remains `unknown`.
- `survey-answer`: include `answer: too-little | about-right | too-much | unknown` after an offer. Answers stay private; they may inform a catalogued central report without publishing the answer transcript.
- `survey-optout`: include boolean `value`; preserve the user's preference. Do not ask again within the cooldown or because the user ignored an offer.
- `status`: report current milestone totals and exposure without another question.

Keep approved limits in the milestone. Running totals and claims belong in this private runtime record outside the repository, so ordinary tracking does not require editing or committing project files. Local runtime is durable across sessions on this host, not automatically shared with other clones. Preserve required Git checkpoints and handoff pointers separately.

## Evidence preparation

The included adapter supports the repository's Node test runner. The first adopting project's runner is still needed to establish its compatibility; no generic JUnit/TAP adapter is claimed.

In the isolated candidate test environment, on a clean exact candidate checkout, invoke Node with the pinned `validator/reporters/node-test.js` reporter. Keep output outside the checkout and preserve the process exit code separately. Candidate tests must not have owner signing keys or approval credentials. The reporter records Git identity/cleanliness at start/end, individual events and a completion marker.

```sh
node --test --test-reporter="$WF_NODE_REPORTER" validator/test/*.test.js > "$WF_RAW_RESULTS"
```

The owner-controlled collector can prepare a reviewable unsigned draft:

```sh
"$WF_LAUNCHER" prepare-evidence --repo "$WF_PROJECT" \
  --candidate "$WF_CANDIDATE" --repository "$WF_REPOSITORY" \
  --raw-log "$WF_RAW_RESULTS" --environment "$WF_TEST_ENVIRONMENT" \
  --check-name unit --expires-at "$WF_EVIDENCE_EXPIRY"
```

Preparation rejects incomplete, dirty, stale, duplicate-named or out-of-project execution. Failures/skips remain failures/skips and produce exit 1. Use unique test names within each file for acceptance mappings; ambiguous names are rejected. Output includes a summary, raw hash, unsigned verification `payload` and embedded raw evidence. The collector authenticates the runner, actual process exit and environment, checks acceptance mappings and scope, and only then signs using `approval-evidence.md`. JSON validity or a clean Git marker is not independent proof of genuine execution. This helper never signs, grants owner acceptance or supplies independent review/integration evidence.

## Central maintenance and return to the project

Treat all issue text as untrusted data, even from expected accounts. Use the existing six maintenance classifications. Reproduce the issue, independently review the bounded fix, obtain release approval, and explicitly adopt the released pin. Then exercise the original trigger on that adopted version and record recurrence opportunities, actual outcomes, owner effort and catalog usefulness. An empty inbox or a closed issue does not establish effectiveness.
