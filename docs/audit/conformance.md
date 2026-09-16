# Workflow conformance inspection and corrections

**Result:** The original implementation was incomplete. This branch supplies a substantially expanded, tested **assisted workflow candidate**. It is not yet evidence that the complete workflow is operational in a real adopting project. The outstanding live controls below must be established before making that claim.

Authorisation: the owner's 2026-09-16 request to make the agent workflow correct and complete against the attached consolidated document. This authorises the local inspection and corrections; no GitHub protections, remote branches, project adoptions or releases were changed.

Original revision: `90621cfebb8d377a2edb14b19fa22ecf6fdf4b63`. Local branch: `codex/workflow-conformance`. The existing `v1.0.0` tag remains unchanged. Package version `1.1.0-dev.0` identifies unreleased work, not a published release. `POLICY.md` now matches the supplied attachment byte for byte, including its original proposed status. The former PrintFlow adoption claim was part of the older reference and is not carried into the supplied policy.

## Corrections

The original 38 tests passed despite reproducible gaps. New regressions and implementation corrections cover:

- Candidate task edits removing prerequisites, deferred inputs, governing/acceptance references or risk classifications; stage rollback; feature or milestone changes that evade decisions.
- Ignored path/feature/milestone-scoped decisions, superseded prerequisite/deferred resolutions, missing project/feature/milestone/task context, scope violations and stale readiness. Actual starting/test baselines may be on an authorised milestone branch; the governing approval baseline remains separate.
- Baseline Resolved/approved fields being mistaken for authority. The candidate provides an explicit manual alternative using owner-signed, revision-bound receipts and an externally provisioned trust key. It does not infer GitHub approval from a branch or label.
- Generated production outputs bypassing gates; invalid Git diffs passing as empty changes; mutable Git refs; wrong candidate records; renamed production paths; source traversal and duplicate authority fields.
- Candidate config, a local override or modified cache selecting executable enforcement. The launcher requires an external immutable pin and runs committed files extracted from that revision.
- Missing acceptance mapping/execution checks, independent review evidence, assembled integration evidence, owner acceptance, release evidence and session outcome validation.
- Missing neutral procedures, agent entry maps, milestone/design/review/acceptance/release/setup/pilot/maintenance/session/toolbox templates and identity preflight.
- Multiple Git push destinations being hidden by a first-URL-only identity check.

The manual receipt mechanism is an implementation choice within the policy's explicit-alternative allowance. It introduces owner-controlled evidence collection and signing; it is not represented as equivalent to fully configured branch protection or an autonomous runner. Owner review must approve this candidate and its setup before adoption.

## Policy coverage

| Supplied policy | Local implementation / evidence | Operational boundary |
|---|---|---|
| §1 roles, milestone sequence, daily loading | AGENTS/CLAUDE/shared entry; readiness, execute, review and acceptance procedures | Fresh tool discovery and pilot still required |
| §2 complete profile; unknowns; quality condition/evidence/role/stage | Expanded profile and design templates; project/feature/task readiness fields; required check plans | Human review establishes substantive adequacy of governing content |
| §3 durable records, precedence, stable IDs, supersession, neutral adapters, skill/tool adoption | Record schemas, templates, source access, toolbox procedure, pinned validator | Tool-specific discovery must be observed; Graphify is explicitly optional/deferred |
| §4 three readiness levels, design triggers, contracts, repair baseline, bounded subsets, reassessment | `readiness.js`, `records.js`, original gate cases plus conformance and real-Git regressions | Semantic risk classification and adequate design still require coordinator/reviewer judgement |
| §5 read/research/owner/spike/delegate/defer responses | Readiness procedure, scoped decisions and assumptions, required-before gates | Actual research and owner decisions are project work, not fabricated setup data |
| §6 decisions, milestones, tasks, checkpoints and handoffs | Milestone/task/decision/checkpoint/session templates; basic schemas and scoped readiness | Assisted coordinator maintains actual claims, priorities, checkpoints and budgets |
| §7 personal ownership, worker separation, each publishing route, protected material, approval evidence | Live read-only GitHub snapshot; terminal identity adapter; scoped signed receipts; protected path defaults; setup/identity procedures | No live push rejection/approval-path test, complete author configuration or strong credential isolation has been demonstrated |
| §8 coordinator/implementation loops, session outcomes, limits/recovery, authority stops | Execute procedure, session validator, adverse session fixtures and continuation prompt | Assisted execution only; an unattended runner is not adopted |
| §9 four verification layers, security, test fidelity, traceability, protected integration | Acceptance/lifecycle modules; CI composes readiness, actual diff, implementer checks, separate review, integration and coverage; receipt scopes protect governing/enforcement changes | Trusted collector/launcher/result source must be provisioned; semantic test quality still needs review |
| §10 complete acceptance package, consequential changes, owner statement, release readiness/artifact relationship | Acceptance/release templates; stage checks and signed owner decisions | Actual owner product acceptance and deployment evidence are not supplied by tests; milestone package must cover all tasks/scenarios |
| §11 central versioned source, setup budget, fixtures, approval-path test and pilot | Reference, procedures, templates, classifier, adapters, fixtures and assisted-scope declaration | New release/adoption, live setup exercises and observed pilot remain pending |
| §12 feedback and independent maintenance | Feedback and maintenance templates/procedure, classifications, bounded defaults, evidence and disposition rules | No background maintainer or automatic self-amendment is enabled |

## Required fixture inventory

| Requirement | Evidence |
|---|---|
| Eight minimum gate cases, including unrelated work, supersession, deferred stages, contracts/repair baselines, planning while blocked and classification | `fixtures/01-*` through `fixtures/08*`; original expected outcomes preserved with explicit synthetic approval/check/review evidence |
| Bounded subsets | `fixtures/09-bounded-subset`, scope regressions |
| Acceptance additions, removal, disabled/missing execution, expectation-review route, justified correction and unsupported spec approval | `validator/test/acceptance.test.js`; real-Git lifecycle/session execution regression |
| No self approval; exact-revision/key/repository/purpose/expiration | `validator/test/trust.test.js`, conformance and real-Git tests |
| Independent review, integration, acceptance/release distinction and raw post-commit evidence | `validator/test/lifecycle.test.js`, `git-integration.test.js` |
| Explicit worker identity; missing/expired credential and no owner fallback; branch and multiple destinations | `validator/test/identity.test.js`; live terminal adapter snapshot (read-only) |
| Process exit is not completion; read-only evidence and legitimate blockers; stopped-by-limit fields | `validator/test/lifecycle.test.js` |
| Git source pinning, failed diffs, candidate selection, rename handling, external trust anchor and executable pinning | `conformance.test.js`, `git-integration.test.js`, `wrapper.test.js` |
| Duplicate claims, unattended crash/side-effect recovery, persistent retry budgets, child cleanup and runner stop boundaries | Conditional on adopting a runner; **not implemented or claimed**. Assisted procedures record the corresponding responsibilities. |
| Real protected-write rejection, fresh agent discovery and observed pilot | **Not performed**; required operational evidence remains open. |

Automated tests do not infer every indirect weakening of helpers, assertions, fixtures, setup or execution configuration. Independent review examines those changes, including untagged tests. Existing baseline mappings remain required; unrelated future acceptance definitions do not demand premature implementation.

## Independent review

A separate reviewer context inspected the original pinned implementation and reproduced its bypasses. A second pass inspected the new code and found feature-label evasion, missing acceptance validation in lifecycle/session, missing integration receipts in CI, stage-insensitive milestone status checks, and unrelated-future acceptance blocking. Each was corrected and covered by regression checks.

The final bounded pass found the multiple-push-URL case. The adapter now enumerates all push URLs and rejects multiple destinations. The reviewer verified the final fix and reported all findings from this bounded review resolved. This is technical review evidence for the local candidate, not an owner approval or live pilot.

## Live GitHub findings

See `github-snapshot.json` for timestamped read-only evidence. Repository `Cazy00/agent-workflow` is public and personally owned by `Cazy00`. The authenticated API worker is `MontaDev-sys`; its reported repository permissions include push but not administration. The terminal adapter passed with an explicitly selected worker credential, expected repository and current branch. The probe does not prove push permission, author attribution or strong credential isolation.

Ruleset `protect-main` is active, requires one owner review, dismisses stale approvals, requires last-push approval, and prevents deletion/non-fast-forward changes. The current worker cannot bypass it. The required check is `test`; the snapshot contains no pinned producing application, and strict up-to-date checks are disabled. The local CI definition now pins its action revisions, has read-only permissions, does not persist checkout credentials and bounds execution time. It remains a candidate regression job, not the external authoritative approval checker.

GitHub documents why check provenance, stale reviews, administrator restrictions and CODEOWNERS protection matter: [protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches), [code owners](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners). Candidate test isolation follows the [secure-use guidance](https://docs.github.com/en/actions/reference/security/secure-use). No remote control was changed by this inspection.

## Remaining adoption work

1. **Owner review and release:** approve this local candidate, including the manual receipt alternative; release a new immutable tag and explicitly adopt it in each project. Keep current milestones on their previously adopted version until approved migration.
2. **Trusted operational setup:** provision the external launcher, pin, owner public key, signing/collection environment and trustworthy result mechanism. Verify separate author/transport/API configurations. Test missing worker access and prohibited owner fallback on every publishing route actually supported. Resolve check provenance/up-to-date enforcement and record any plan or permission limitation. The current worker lacks administrative permission.
3. **Live approval-path exercise:** in an authorised disposable context, demonstrate rejected worker direct pushes/protected changes, valid focused owner approval, and stale-approval invalidation. No destructive probe against main was attempted.
4. **Tool discovery and observed pilot:** use fresh Codex and Claude Code sessions to exercise the adapters, then a small approved milestone. Preserve separate technical and workflow results, actual owner acceptance and correct stop behaviour.

Only an explicit promise of unattended execution makes a runner an additional required implementation. Its absence does not prevent the documented assisted mode, but neither a passing fixture suite nor a successful single milestone would certify unattended operation.

## Verification and handoff

The final assembled suite passed **95 tests, with zero failures or skipped tests**; its output is retained in `test-results.tap`. Source identity is recorded in `candidate-files.sha256`; this is a local file-content snapshot rather than a commit claiming to include uncommitted work. Shell syntax, JavaScript syntax, patch whitespace outside the verbatim policy, and exact policy preservation were also checked. The supplied policy intentionally retains its two Markdown line-break spaces; its bytes were not rewritten to satisfy a whitespace heuristic.

Session outcome: **progress — implementation candidate prepared and technically reviewed; operational adoption evidence remains pending**. Workflow friction this session: the original implementation defects are recorded in this report. Next eligible action is owner review of this concrete candidate and the setup steps above.

Ready-to-use continuation:

> Review the local workflow candidate on codex/workflow-conformance. Read docs/audit/conformance.md, POLICY.md, SCHEMA.md and procedures/setup.md. Preserve the existing v1.0.0 tag. Establish the owner-approved release and explicit project adoption, provision the trusted approval/checker environment, then run the documented live approval-path, agent-discovery and observed-pilot exercises. Do not claim operational or unattended conformance without their evidence.
