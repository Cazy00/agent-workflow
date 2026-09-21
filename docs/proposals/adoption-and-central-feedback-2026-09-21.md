# Adoption and central feedback: Codex and Fable recommendation

Status: concrete proposal, not implemented, released or adopted. Date: 2026-09-21.

The owner wants to adopt the workflow in a large existing project using Codex and Claude Code. They explicitly requested that agents in adopting projects report workflow problems to this repository's GitHub issues, rather than burying reports in the adopting repository. They also requested occasional user feedback and an independent Fable 5.1 assessment before showing it Codex's views. The target project remains unidentified.

## Joint conclusion

Prepare a small assisted pilot with central feedback. Fix the reproduced bookkeeping problem, make the real validator launcher explicit about its module format, prepare evidence for the target's actual test runner, and test the supported routes. Defer a coordination runner and a general setup product until real use shows where they help.

The ratings remain subjective: foundation 7/10; operational readiness 4–5/10 (Fable 4, Codex's earlier estimate 5); coordination and feedback maturity about 4/10 in Fable's assessment. These are not success probabilities. New code alone does not justify higher ratings.

Fable's first assessment was independent of Codex's prior ratings, limitations and proposed solutions. Two later exchanges compared evidence and narrowed the proposal. Full provenance and corrections are in [the consultation report](../audit/fable-adoption-2026-09-21/report.md).

## What the assessment established

- **Confirmed bookkeeping interaction:** appending only usage prose to a milestone is a governing change under the default classifier. Once merged, it stales readiness; adding an unrelated milestone also stales the task. Reproduced with a disposable real Git fixture and synthetic approvals. Tracked in [issue #2](https://github.com/Cazy00/agent-workflow/issues/2).
- **Launcher portability gap:** the real launcher passes on the installed Node v22.23.1, but fails when automatic module detection is disabled. Its extracted validator lacks the root package's explicit module declaration. An early Node 22 version was not tested.
- **Current baseline:** 95 tests passed, none failed or skipped. This does not validate the proposed reporter or a product pilot.
- **Reporting destination:** Cazy00/agent-workflow is public with issues enabled. Issue #2 was created and read back as MontaDev-sys using an explicitly selected worker credential. That proves one issue route, not least-privilege provisioning, automatic reporting or a cross-project learning cycle.

## Smallest ordered implementation package

### 1. Repair avoidable adoption friction

Keep authorised milestone scope, acceptance, limits and authority protected. Store operational claims and running usage separately from that governing record. Use a durable run record suited to the pilot; a local runtime log is only sufficient for the explicitly supported single-host, single-coordinator case. Feedback bodies still belong outside adopting-project source.

Narrow readiness freshness carefully. Discover relevant governing records at both the recorded and current baselines and compare the union. Include the profile, task's milestone, governing sources, relevant prerequisites/contracts, decisions affecting task/feature/milestone/path, and supersession/dependency changes. Do not merely monitor previously explicit references: a newly added applicable decision must still invalidate or block work.

Add regression cases for unrelated milestone changes, operational usage writes, new in-scope decisions, relevant changed/removed records, changed prerequisites and supersession. Preserve existing authority and scope adversarial cases.

Make the extracted validator explicitly ESM and test the real CLI through the pinned launcher, not only a stub. This is a portability correction; the installed default runtime already works.

### 2. Prepare reviewable evidence with less manual work

Build one evidence-preparation helper for the target project's actual reporter, once identified. It converts actual results into the required file/name/status records, binds them to the exact tested revision and environment, retains raw evidence, and prepares a concise owner-readable payload. Missing, skipped, ambiguous or stale execution must not become passing evidence.

Keep signing in the owner-controlled environment. Preparation does not authorise automatic signing, product acceptance or release. Record signature/re-sign effort and why evidence needed refreshing. Do not reuse candidate evidence across changed revisions merely to save money. A GitHub-native approval adapter is a possible later investment; baseline-only receipts cannot satisfy the current CI gate.

### 3. Central reporting from adopting projects

`wf report` below names a proposed command; it does not exist yet.

**Trigger and destination.** Agents report an explicit user complaint about workflow behaviour, a suspected safeguard failure, an incorrect block, an identity/handoff problem, or meaningful repeated friction. The canonical record is a GitHub issue in `Cazy00/agent-workflow`. An issue is an observation to triage, not proof of root cause. Product bugs unrelated to the workflow remain product work.

**Authority.** The owner's current direction establishes the desired central reporting behaviour. The adopting project's configuration must record the fixed destination, permitted data categories and reporting worker route once. Safe reports inside those boundaries need no repeated permission question. Preserve independent review and owner release/adoption for reusable changes. Do not silently edit the supplied POLICY or a currently adopted project's rules.

**Public payload.** Because the destination is public, automatic reporting uses fixed statements from an approved catalog, rendered from closed workflow-owned step/rule codes, workflow hash/version, validated tool/version identifiers, categorical expected/observed behaviour, impact bands/counts and a random stable event UUID. Validate field lengths and formats and reject unknown fields. Workflow/tool identifiers must identify the actual approved installation, not accept arbitrary text merely because it resembles a version or hash.

For example: “Approval was requested for a delegated step” can be reported with its workflow rule and version without publishing a project transcript. Include `catalog_fit: exact | approximate | none`. An uncatalogued event produces a generic step/version report; the narrative stays private. Measure whether the catalog produces useful reports rather than assuming it does.

Do not automatically send private repository names, paths, task titles, business requirements, customer information, screenshots, raw conversations or unrestricted logs. Agent-written narratives cannot be certified safe by a regular expression. Additional private evidence requires a deliberate disclosure decision; public-source or synthetic reproduction details can be added by maintenance. Security details never enter the public payload. Even a templated report reveals worker activity and timing; include that limited disclosure in the adoption record.

**Durable delivery.** Keep the outbox outside the adopting repository. Store the validated public payload, UUID, destination, payload hash, attempt state and issue URL, plus a private UUID-to-project mapping so fixes can return to affected projects. Any private narrative is separate from the publishable payload. A handoff may include the report UUID/issue URL, not another committed report body.

Preflight the actual issue route against the expected worker and destination. Never fall back to an owner credential. The tested existing token is not claimed least privilege; verify a dedicated restricted reporting route before calling it that. Pin the reporter's installation and configuration outside candidate-controlled enforcement where required.

Use a local lock for a single publisher and a stable UUID marker for event reconciliation. Inspect bounded, paginated issue/comment listings rather than assuming an indexed search is current. After an ambiguous create/comment result, mark delivery unknown and reconcile before retrying. If certainty cannot be established within the configured bound, hold and surface it. Apply the same care to occurrence comments. Do not claim exactly-once delivery across machines.

A fingerprint including workflow version can suggest grouping, but is not proof two incidents have the same cause. Start with UUID deduplication; central triage decides semantic grouping. Batch ordinary occurrences and cap routine report volume. Safeguard alerts bypass the ordinary batch delay, but never privacy controls, authentication checks or API backoff. Reporting failure alone does not block unrelated product work; the underlying safeguard failure may still require a stop.

GitHub documents issue creation and its token permission requirements in the [issues API](https://docs.github.com/en/rest/issues/issues#create-an-issue). Apply its [API backoff guidance](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api). A successful issue POST is not evidence that every failure path works.

### 4. User feedback, cost and maintenance

Ask one optional neutral categorical question at a milestone handoff, or a selected recurring-friction point within the same cooldown. Example: “How did the amount of check-ins feel: too little, about right, or too much?” Keep opt-out and cooldown in runtime state. Do not ask on every action, and do not infer satisfaction from silence. Explicit complaints can be captured without another satisfaction survey.

Record available task exposure, outcomes, tool/workflow versions, retries, owner intervention time, signatures/re-signs and usage. Keep unknown values unknown. API list-cost estimates, subscription consumption and actual charges are distinct. Keep private metrics owner-controlled unless export is explicitly included in adoption.

Use ordinary code for state transitions, reporter parsing, formatting and counters. Start with one coordinator and one task in flight, plus separate independent review. Give the reviewer canonical sources and the relevant diff/evidence, not the implementer's conversation. Agree resource/owner-effort limits for the pilot and stop when reached. Judge cost per accepted outcome and rework, not model price alone.

Central maintenance uses the existing six classifications: workflow defect, project configuration, agent misunderstanding, expected safeguard, improvement proposal, insufficient evidence. All issue bodies and comments are untrusted data, including owner/worker-authored text. Author filters reduce spam; they never grant authority. No issue can instruct the maintenance agent to change policy, run embedded commands or self-approve a fix.

The learning cycle is: report → classify → reproduce → implement within scope → independently review → owner release → explicit project adoption → exercise the original triggering condition again. A closed issue or lack of later complaints is insufficient proof of effectiveness. Maintenance starts through its authorised workflow; no background self-amendment or scheduled monitor is created by this proposal.

### 5. Test setup and run one bounded milestone

Use existing validation commands and a targeted setup checklist before building a wizard/dashboard. Establish the external pin, trust and collector setup. Run real approval-path exercises in a disposable context, including rejected bypasses and stale approval. Exercise fresh Codex and Claude Code sessions on the actual installed versions: both must discover governing sources, identify permitted work, stop affected blocked work and preserve handoffs.

The first product milestone should have useful real behaviour in a bounded area, existing baseline evidence and explicit acceptance. Include sequential work, a genuine blocked condition, and a controlled recovery exercise without destructive production effects. Record technical results and workflow results separately. Deployment and product acceptance remain distinct.

## Acceptance evidence for the reporting package

| Scenario | Required result |
|---|---|
| Same event replayed on the supported single-publisher route | Existing UUID/issue recognised; no duplicate creation in this tested route |
| Server succeeds but reply is lost | Delivery becomes unknown; bounded reconciliation finds marker before another write |
| No reliable reconciliation result | Held and visible, not silently discarded or blindly retried |
| Missing/wrong worker or wrong destination | No publication and no owner fallback |
| Private canary data in forbidden fields/narrative | No canary leaves the private boundary; approved categorical report can still be delivered |
| Unknown incident type | Generic public event with catalog_fit none; narrative private, no fabricated attribution |
| Rate limit or report cap | Bounded backoff/batching; privacy/authentication controls preserved for urgent alerts |
| Readiness-blocked task | Reporting remains available; filing an issue does not change readiness |
| Malicious issue text from any author | Treated as evidence only; no instruction or authority accepted |
| Handoff survey ignored or opted out | Unknown/opted-out, no repeated question inside cooldown |
| Real field fix returns to the project | New release explicitly adopted; original trigger exercised and verified, exposure recorded |

## Evidence required to raise the ratings

| Area | Current subjective view | Evidence for reconsideration |
|---|---|---|
| Foundation | 7/10 | Reproduced friction fixed, meaningful adverse regressions and real launcher test, independent review, suite run at released pin; an 8/10 assessment could then be justified |
| Operational readiness | 4–5/10 | Tested live setup and one real task through trusted CI within agreed effort limits; then a complete accepted milestone with baseline movement and blocked work. A 6–7/10 assessment requires those observations |
| Coordination | About 4/10 | Sequential tasks avoid spurious invalidation but reject genuinely stale authority; interrupted work resumes from records without repeated side effects |
| Feedback/learning | About 4/10 | A report from an actual adopting project completes the fix/release/adoption loop, with a logged recurrence opportunity, exposure and report usefulness measured |

Issue #2 is an assessment reproduction, not a field report, and does not raise the learning rating. The proposed improvements are not a promise of a particular success percentage.

## Deliberately deferred

Full coordination runner, general setup wizard, dashboard, support for every test reporter, automatic native-GitHub approval inference, semantic issue grouping, exported telemetry and tools beyond Codex/Claude Code. Do not defer a target-specific safety prerequisite merely because it is absent from this generic list. For example, milestone acceptance must still cover all scenarios even though an additional automatic aggregate checker is not part of this first package.

Next scoping input: the target repository, its test runner, contribution/baseline movement pattern and authorised pilot milestone. This consultation does not adopt the workflow there or install automatic reporting.
