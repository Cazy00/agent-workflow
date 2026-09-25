# Agent-Assisted Software Development Workflow

**Version:** 1.0 — consolidated proposal  
**Status:** Proposed; implementation has not been authorised  
**Applies to:** New and existing software projects, using Codex, Claude Code, or another compatible agent

## 1. Purpose and operating model

This workflow enables agents to develop software through authorised milestones, with durable records, meaningful verification, and clear limits on their authority.

The owner defines the intended outcome, resolves reserved decisions, and tests the delivered experience. Agents organise implementation and perform technical testing, code review, and security checks before presenting it.

### The development flow

**Discover → Establish readiness → Authorise a milestone → Implement and verify tasks → Independently review → Verify the assembled milestone → Obtain product acceptance → Release when authorised → Improve from evidence**

### Roles

| Role | Responsibility |
|---|---|
| Owner | Approves scope, reserved decisions, product acceptance, and release authority |
| Coordinator | Selects ready work, maintains progress, manages dependencies and limits, and prepares acceptance packages |
| Implementer | Implements a bounded task and produces verification evidence |
| Independent reviewer | Checks scope, correctness, maintainability, security, and test fidelity in a separate context |
| Workflow maintainer | Investigates reported workflow problems in a separately authorised maintenance session |

These are responsibilities, not a requirement for five permanent agents.

Default to one coordinating agent per active milestone. Use additional workers only for bounded, separable work that justifies the coordination cost.

### Daily use

This document is the reference policy. Agents should normally load:

1. The short repository guide.
2. The relevant procedure.
3. The current task and milestone records.
4. The governing requirements and applicable technical guidance.

The full document is consulted when a rule is unclear or the workflow is being maintained.

---

## 2. Establish the project profile

Each project maintains a concise profile covering:

| Area | Required information |
|---|---|
| Purpose | Users, problems being solved, and measurable success |
| Scope | Included outcomes, exclusions, and known constraints |
| Starting point | Existing code, prototypes, production systems, and technical debt |
| Experience | Main journeys, devices, languages, accessibility, and visual direction |
| Technical context | Stack, components, integrations, environments, and data |
| Authority | Decision owners, delegated choices, permitted assumptions, and reserved decisions |
| Quality | Required checks, evidence, responsible roles, and enforcement stages |
| Delivery | Milestones, acceptance method, integration and deployment authority |
| Operations | Monitoring, recovery, migration, support, and device management where applicable |
| Execution | Tools, account identities, runner mode, and resource limits |
| Workflow | Adopted version, project settings, approved deviations, and optional tooling |

Unknown information is recorded honestly. Its absence blocks only work that needs it.

For each quality expectation, define:

> **Condition → Evidence method → Responsible role → Required stage**

For example, “reliable” must become concrete expectations about failures, recovery, data integrity, or availability.

A project may begin discovery with an incomplete profile. Production implementation requires the relevant information to satisfy the gates in section 4.

---

## 3. Keep knowledge durable and tool-neutral

### Authoritative records

The repository holds the project’s durable working context:

- Project profile and brief.
- Requirements and acceptance definitions.
- Designs, contracts, and decision records.
- Milestones and tasks.
- Release records.
- Workflow feedback.

Run evidence stays out of the repository. Test output, review results, session outcomes, usage and handoffs go on the task's GitHub pull request, or on its issue before a pull request exists, with raw logs kept in signed receipt artifacts. The repository holds only what future work needs to read. Record a durable finding by updating the relevant record, not by committing a log.

Give records stable IDs and locations. Record explicit supersession when a decision changes.

The project must state which sources govern when documents conflict. A newer timestamp alone does not make a document authoritative.

Prototypes, generated summaries, historical material, and navigation indexes must be distinguishable from approved requirements.

### Agent entry points and procedures

Use a short `AGENTS.md` as the repository map. Tool-specific entry points should direct agents to the same governing material.

Keep shared procedures in a neutral location, such as `.agents/skills/`, with tested adapters for each supported tool.

Verify that each tool actually discovers and follows the intended instructions. Do not assume identical discovery behaviour across tools.

### Skills and reusable tools

Skills provide procedures and specialist guidance. They do not override approved project requirements or grant additional authority.

Before adopting an external skill or tool:

- Inspect its instructions, scripts, permissions, and dependencies.
- Pin an identifiable version.
- Test it on representative work.
- Record its intended purpose and limitations.

### Optional navigation tools

Knowledge graphs, symbol indexes, generated document indexes, and similar tools are optional aids.

Their output is derived information. Agents must verify consequential claims against the governing source, and gates must read authoritative records directly.

Direct source access must remain available.

Graphify and similar tools remain **deferred optional tooling** until observed navigation problems justify a trial. Their absence is not an unresolved prerequisite.

Evaluate the simplest suitable option against real questions, including correctness, missed relationships, maintenance, and total usage.

---

## 4. Establish readiness before implementation

Readiness is assessed at three levels.

### A. Project readiness

Before production development, establish enough understanding to identify:

- The intended users and outcomes.
- The initial scope and exclusions.
- Important journeys and data.
- Major constraints, risks, and decision owners.
- An initial verification and delivery approach.

If these are missing, begin **discovery**.

Discovery may include inspection, interviews, research, journey sketches, and explicitly labelled prototypes. Its output is a brief and a clear account of what is known, assumed, and unresolved.

### B. Feature readiness

Before implementing a feature, establish the relevant:

- User behaviour and acceptance examples.
- Business rules and permissions.
- Data ownership and lifecycle.
- Interface behaviour and important states.
- Failure, retry, conflict, and recovery behaviour.
- Dependencies and shared contracts.
- Verification approach.

A design record is required for changes involving shared contracts, synchronisation, money, stock, security boundaries, irreversible data operations, or consequential changes across components.

Reuse an adequate existing design. Document size and file count alone do not determine readiness.

### C. Task readiness

Before beginning a task, check that:

- Its objective, scope, owner, and milestone are clear.
- Governing sources are identified.
- Required prerequisites are satisfied.
- Relevant reserved decisions have valid approval.
- Assumptions fall within delegated authority.
- The starting revision and baseline condition are recorded.
- Verification and review requirements are known.
- Readiness uses current governing records.

A prerequisite can be an approved contract; the entire upstream feature need not be complete.

A failing baseline does not automatically block a bug fix. Record relevant failures and distinguish existing problems from regressions.

### Gate outcomes

A gate returns one of:

- **Ready.**
- **Ready for a bounded subset**, with its boundaries stated.
- **Needs discovery or resolution**, with the missing prerequisite identified.

Agents may establish readiness from existing approved material. The owner is involved when a reserved decision remains unresolved.

Readiness must be reassessed when relevant requirements, dependencies, assumptions, or scope change.

---

## 5. Handle missing information according to its nature

| Situation | Required response |
|---|---|
| Information already exists | Read the governing source |
| A factual question can be researched | Research it and retain evidence |
| A decision belongs to an owner | Request that decision and block affected work |
| Technical feasibility is uncertain | Run an authorised, bounded spike |
| A choice is delegated and reversible | Choose, record it where consequential, and proceed |
| Information is needed at a later stage | Record when it becomes required and defer appropriately |

Waiting for an answer never becomes permission to invent one.

### Authority categories

The profile distinguishes:

- **Delegated decisions:** choices agents may make within approved requirements.
- **Permitted assumptions:** explicit, reversible assumptions allowed under stated conditions.
- **Reserved decisions:** choices requiring approval from the named owner.

Reserved decisions include changes to approved scope, business behaviour, acceptance conditions, financial rules, consequential permissions, privacy commitments, external data sharing, and destructive operations outside existing authority.

Not every internal schema or implementation change is reserved. Its consequences and the project’s delegation rules determine that.

Agents continue unrelated ready work while a decision is pending.

---

## 6. Track decisions, milestones, and tasks

### Decision records

Use stable records containing:

- ID and question.
- Decision type and owner.
- Affected work.
- Required-before stage.
- Status: **Open → Proposed → Resolved**.
- Resolution and supporting evidence.
- Supersession links where applicable.

Keep the record at a stable location when its status changes.

Markers in documents point to these records. The structured record determines which work is blocked.

An agent-written `approved` field is not approval evidence.

### Milestone records

A milestone delivers one coherent journey or a clearly demonstrable technical outcome.

Record:

- Outcome and exclusions.
- Acceptance scenarios.
- Governing requirements and decisions.
- Tasks and prerequisites.
- Coordinator and execution authority.
- Technical verification and review requirements.
- Time, usage, retry, and spending limits where applicable.
- Demonstration method.
- Stop conditions and release authority.

Milestone authorisation allows agents to organise and execute eligible tasks within those boundaries without requesting approval for every implementation step.

### Task records

Use:

**Draft → Ready → Active → Done**, with **Blocked** available when necessary.

Each task records:

- ID, objective, scope, milestone, and assigned owner.
- Governing requirements and acceptance IDs.
- Dependencies, decisions, and assumptions.
- Branch and starting revision.
- Governing baseline revision used for readiness.
- Baseline results and known failures.
- Verification method and evidence references.
- Review findings and disposition.
- Checkpoint, blockers, and next action.

A task becomes Done when its defined completion conditions are met. That does not automatically mean the whole milestone is accepted or released.

### Checkpoints and handoffs

A shared code checkpoint is a commit on the task or milestone branch. Agent-authored work commits begin with the relevant task ID. Merge operations remain traceable through their pull requests.

A checkpoint may contain incomplete work, provided its condition is explicit.

Publish checkpoints to the authorised shared location when another session or clone needs them.

Post each handoff on the task's pull request, or on its issue before a pull request exists. A handoff states:

- What changed.
- What was verified, against which revision.
- What remains uncertain or blocked.
- The next eligible action.
- **Workflow friction this session: none / report IDs.**

Read-only verification or research can produce useful progress without changing production code. Record durable findings in the relevant record and post the supporting evidence on the task's pull request or issue.

---

## 7. Separate repository ownership, worker access, and approval

### Account arrangement for Monta’s projects

| Purpose | Account reference |
|---|---|
| Personal owner account | `oman.m123456@gmail.com` |
| Development worker account | `almuntaser.dev@gmail.com` |

The repository must be created, initialised, and retained under the owner’s **personal GitHub account**.

The worker account receives the access needed to contribute. Agents do not own the repository.

Verify the actual GitHub usernames during setup. Email addresses do not establish authenticated identity.

The owner reports that the computer is connected to the main account; worker authentication still requires configuration and verification.

### Local separation

Use:

- A human working clone with the owner’s publishing configuration.
- An agent working clone with explicit worker publishing configuration.
- Separate worktrees within the agent environment when concurrent tasks need isolation.

Do not rely on worktrees alone to separate account configuration.

Configure these independently:

1. Commit author metadata.
2. Git transport authentication.
3. GitHub API or CLI authentication.

Preserve genuine human commit attribution. The AI service login and GitHub publishing identity are separate settings.

Routine agent work must not switch the computer’s global account configuration.

Keep credentials in appropriate secret storage, not repository files.

### Identity checks

Before publishing or changing GitHub state, verify:

- Target repository and branch.
- Authenticated worker identity.
- Applicable authority.
- The particular tool route being used.

This applies to terminals, connectors, desktop integrations, and other publishing routes.

An expired or missing worker credential must not trigger fallback to the owner account. Local authorised work may continue if it does not require the unavailable access.

Separate configurations provide practical separation. Strong credential isolation requires a tested environment that cannot access owner credentials.

### Approval and protected material

Protect:

- Approved requirements and acceptance definitions.
- Reserved decision resolutions.
- Gate policy and classification rules.
- Validators, runner code, and enforcement configuration.
- CI configuration and `CODEOWNERS` itself.

Use required owner review and required checks on the authoritative branch. Apply restrictions to administrators, invalidate stale approvals when relevant changes occur, and prevent the worker from bypassing them. GitHub documents these controls and the need to protect `CODEOWNERS` itself. [Protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches), [Code owners](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners)

A reserved decision change goes through its own focused approval before dependent implementation. The proposal should explain the behavioural difference in plain language.

Worker-authored pull requests allow the owner to supply the required approval. Arrange human-authored contributions so the required review can also be obtained without falsifying attribution.

### Approval evidence

Fetch the configured authoritative branch and record the exact revision used for validation.

A resolved record on that baseline is acceptable approval evidence only when the verified protection configuration makes that inference valid. Merely appearing on a branch named `main` is insufficient.

A free-text Git author field does not prove approval. A signature is relevant only when its identity and the specific content approved are established.

Check repository-plan support during setup. GitHub’s documented availability differs for public and private repositories. If required enforcement is unavailable, record the limitation and use an explicit alternative; do not claim equivalent protection. [GitHub availability](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)

---

## 8. Execute authorised milestones

### The coordinator loop

Within an authorised milestone:

1. Read current records and inspect actual repository state.
2. Recompute readiness.
3. Select the highest-priority eligible task.
4. Claim it and establish its working context.
5. Implement and verify.
6. Obtain independent review.
7. Resolve findings and preserve evidence.
8. Update progress and continue with the next eligible task.

Use separate worktrees for concurrent changes. Agree shared contracts before dependent work diverges.

### Implementation procedure

For each task:

1. Read its governing material and checkpoint.
2. Confirm the environment, scope, and relevant identity.
3. Record the baseline.
4. Check the relevant existing components, helpers, scripts, and approved toolbox.
5. Implement the smallest coherent change that satisfies the task.
6. Run appropriate checks and investigate failures.
7. Prepare the change for independent review.
8. Record results, checkpoint, and next action.

Follow the project’s established patterns for boundaries, data handling, errors, dependencies, interfaces, and tests.

Register a new reusable asset after review when future work would benefit from finding it. Task-specific helpers do not need to become shared frameworks.

### Session outcome contract

Every completed session leaves one explicit outcome:

| Outcome | Required evidence |
|---|---|
| Progress | Meaningful checkpoint or durable new findings, with the next action |
| Ready for review | Candidate revision and required implementation checks |
| Verified complete | Completion criteria and review evidence satisfied |
| Blocked | Specific prerequisite, its effect, and the next responsible party |
| Stopped by limit | Saved progress and the limit reached |
| No progress or execution failure | What failed and why another attempt would differ |

A successful process exit is not evidence of completion.

A new commit or status change is not sufficient evidence of progress. Conversely, a legitimate read-only verification or blocker does not become a failure merely because no code changed.

### Runner requirements

A runner may automate session selection and continuation using the supported interfaces of each agent tool.

It must:

- Operate within the authorised milestone and worker identity.
- Prevent duplicate task claims.
- Inspect actual state before resuming interrupted work.
- Collect structured outcomes and verify their supporting evidence.
- Preserve cumulative budgets across sessions and retries.
- Bound individual calls and repeated attempts.
- Stop or clean up its child processes when limits are reached.
- Preserve evidence and explain why it stopped.

If a session crashes before producing a handoff, inspect its branch, working tree, and existing external actions before retrying. Do not blindly replay side effects.

Fresh sessions recover context from records. Independent review always uses a separate context; continuing a bounded implementation task does not require unnecessary session resets.

Durable progress records, incremental work, and end-to-end verification are also central to Anthropic’s published experiments with long-running agents. Those experiments are supporting evidence for the approach, not proof that a particular runner is reliable. [Long-running-agent research](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)

### Stop conditions

Pause dependent work when:

- A reserved decision or missing access prevents progress.
- The authorised budget is exhausted.
- Repeated attempts produce no meaningful progress.
- A suspected safeguard failure needs attention.
- The milestone is ready for owner acceptance.

Continue unrelated eligible work when appropriate.

Starting another milestone or deploying requires the authority defined in the profile or a subsequent owner instruction.

When stopping, state the recommended next action. If manual continuation is necessary, provide a ready-to-use prompt with the relevant record references.

---

## 9. Verify, review, and integrate

### Four layers of verification

1. **Implementer verification:** execute relevant checks and retain results.
2. **Independent review:** inspect the candidate in a separate context.
3. **Integration verification:** rerun required checks against the assembled candidate.
4. **Owner product acceptance:** test the intended experience and outcomes.

Self-verification is useful evidence. It does not replace the other layers.

### Technical quality and security

Choose checks according to the changed behaviour and risk, including applicable:

- Business-rule and regression tests.
- Type, build, lint, and component-boundary checks.
- Integration and user-journey tests.
- Permissions, input validation, data exposure, and secret handling.
- Dependency and security checks.
- Migration, concurrency, retry, and recovery tests.
- Performance, accessibility, and device behaviour.

Address security during design and implementation, and verify relevant controls before presenting the milestone.

Record the tested revision, environment, results, and limitations. Material changes require the affected checks and review to be repeated.

### Acceptance IDs and test traceability

Give approved acceptance examples stable IDs, such as `AC-042-3`.

Automated tests reference the IDs they exercise through supported names, tags, or mappings. Acceptance conditions requiring human or operational evidence use an explicit evidence method instead.

The checking mechanism should:

- Validate references to acceptance definitions.
- Compare required coverage with the trusted baseline.
- Identify removed mappings, disabled tests, skipped scenarios, and suspicious expectation changes.
- Confirm required tests actually ran.
- Detect missing or unexpectedly reduced execution.

**A tag provides traceability, not proof of test quality.**

A test can retain its ID while its helper, fixture, setup, assertion, or execution configuration is weakened. Review must inspect those surrounding changes.

Untagged tests remain subject to normal quality and regression review.

### Rules for test changes

| Change | Required handling |
|---|---|
| Add tests for approved behaviour | Include with implementation and review normally |
| Refactor tests while preserving their meaning | Explain material changes and verify preserved coverage |
| Correct a test that contradicts approved requirements | Cite the governing requirement and independently verify the correction |
| Change approved acceptance behaviour | Obtain a separate approved requirement change first |
| Remove, disable, or weaken required coverage | Block integration until justified and resolved through the appropriate route |

Referencing a specification-change PR is insufficient by itself. The change must be applicable, approved, and present in the authoritative baseline.

Automated checks flag what they can establish mechanically. They must not claim to infer every semantic weakening from a diff.

### Independent review

The reviewer receives:

- Task and milestone scope.
- Governing requirements and acceptance definitions.
- Relevant design records.
- Candidate revision and diff.
- Verification evidence and known limitations.

The reviewer does **not** receive the implementer’s conversation or informal reasoning. Canonical design rationale remains available.

Review covers scope, correctness, maintainability, security, regression risk, and whether tests still represent approved behaviour.

Collect review results through the review procedure. An implementer-written `reviewed: true` field cannot substitute for it.

### Integration enforcement

Classify changed paths by their effect:

| Category | Treatment |
|---|---|
| Planning and reporting records | May be updated while implementation is blocked |
| Approved requirements and reserved decisions | Follow protected approval rules |
| Production-affecting changes | Require implementation readiness and relevant verification |
| Enforcement files | Require workflow-change approval |
| Generated artifacts | Follow rules for their source and downstream effect |

Migrations, dependency files, infrastructure, scripts, and generation inputs may affect production even when outside application folders.

Unclassified changes require classification before integration.

CI must recompute relevant gates using trusted policy and validator code from the recorded authoritative baseline. Protect the CI entry point and result-reporting mechanism as well; a familiar check name alone is not trustworthy evidence.

Candidate code must not run with owner credentials or privileges that allow it to approve itself.

Hooks provide feedback and traceability. They do not prove that no premature local edit occurred.

---

## 10. Present, accept, and release the milestone

### Acceptance package

Before requesting owner acceptance, provide:

1. **Candidate identity:** revision, build, and environment.
2. **Delivered behaviour:** what works and what remains outside scope.
3. **Demonstration:** access or reproducible steps.
4. **Acceptance scenarios:** actions and expected results.
5. **Data verification:** relevant persistence, calculations, and state transitions.
6. **Technical evidence:** checks, independent review, and resolved findings.
7. **Limitations:** known issues and unavailable verification.
8. **Consequential changes:** the summary below.
9. **Next recommendation:** the next milestone, prerequisites, and proposed limits.

### Consequential-changes summary

| Category | Explain in plain language |
|---|---|
| Data | Schema, migration, deletion, and retention changes |
| Access | New or changed roles and permissions |
| External services | New integrations and information leaving the system |
| Configuration | Required settings and credentials, without secret values |
| Operations | Deployment, recovery, provisioning, and update changes |

Derive the summary from the actual candidate.

Use “none” when verified absent and “not verified” when information is unavailable.

This summary cannot retroactively authorise a reserved decision.

### Owner acceptance

The owner tests the product experience and intended outcomes.

The acceptance record includes:

> Acceptance is not a declaration that you audited its code or security.

Record accepted scenarios, candidate identity, remaining issues, and the owner’s decision.

Technical verification happens before this acceptance. A good-looking demonstration cannot substitute for an unavailable required check.

Changes after acceptance require appropriate re-verification. If they change the accepted experience or outcome, obtain acceptance of the new candidate.

### Release readiness

Before release, confirm applicable:

- Configuration, secrets, and permissions.
- Migration and compatibility requirements.
- Monitoring and failure visibility.
- Backup, restoration, rollback, or forward-recovery procedures.
- Deployment and support instructions.
- Device provisioning and update procedures.
- Required deferred information.
- Release authority.

Keep **Implemented, Verified, Accepted, and Released** distinct.

Deploy the verified, accepted artifact—or establish and verify the relationship between the accepted candidate and the artifact being released.

---

## 11. Version, set up, and pilot the workflow

### One versioned workflow source

Maintain a central workflow repository containing:

- This reference policy.
- Short operational procedures.
- Profile, task, milestone, decision, acceptance, and feedback templates.
- Validator and classification defaults.
- Tool and identity adapters.
- Runner, when adopted.
- Verification fixtures.

Each project adopts a tagged version and records its immutable revision.

Project-specific choices belong in the profile. Workflow deviations are explicit and approved.

Reusable improvements return to the workflow repository. Projects adopt released changes deliberately; updates must not silently change the rules of an active milestone.

### Initial setup budget

Default setup timebox: **two working days**, unless the owner sets another limit.

The initial setup should establish:

1. The project profile and source authority.
2. Owner repository and worker access.
3. Verified account separation.
4. Essential templates and procedures.
5. Trusted gate execution and branch protections.
6. Acceptance traceability appropriate to the project.
7. Required fixtures.
8. A real approval-path test.
9. Assisted execution, or a runner if unattended operation is included in the promised capability.

If this does not fit, explicitly narrow the initial supported scope, extend the budget, or retain assisted execution. Do not silently remove controls while claiming the full workflow is operating.

Record the owner-controlled bootstrap and the point at which normal protections become active.

### Minimum gate fixtures

Verify these eight cases:

1. An unresolved decision blocks its affected work.
2. An unrelated task remains eligible.
3. An agent’s self-declared resolution or `passed` field cannot supply approval.
4. An approved resolution permits work, while a relevant superseding change invalidates stale readiness.
5. Deferred information becomes blocking at its required stage.
6. Approved contracts and documented failing bug-fix baselines are handled correctly.
7. Planning, checkpointing, and feedback remain possible while implementation is blocked.
8. Production-affecting changes cannot bypass gates through path misclassification or candidate changes to enforcement.

### Acceptance-test fixtures

Verify that the mechanism:

- Allows new tests for approved behaviour.
- Flags removal of an existing acceptance mapping.
- Flags disabled or missing required execution.
- Routes expectation changes for the appropriate review.
- Accepts a justified test correction without requiring an unnecessary business-rule change.
- Rejects an unsupported claim that a specification change was approved.

Document which indirect weakening cases require review rather than automated detection.

### Identity and runner fixtures

Verify:

- Worker identity on each supported publishing route.
- Missing worker access does not fall back to owner access.
- Protected changes and direct pushes cannot bypass the intended approval path.
- A clean process exit with no useful result is not completion.
- Read-only evidence and legitimate blockers are recognised.
- Duplicate task claims are prevented.
- Interrupted runs can recover without blindly repeating actions.
- Limits persist across retries and new sessions.
- The runner stops at the correct acceptance or authority boundary.

### Pilot before unattended use

Start with a deliberately small, approved milestone under observation.

Record two separate results:

- **Technical result:** what the software or spike established.
- **Workflow result:** whether readiness, identities, handoffs, checks, review, and acceptance worked.

Promote the runner to unattended use only after the relevant fixtures and observed pilot demonstrate its required behaviour.

Completing one milestone is useful evidence; it does not replace testing interruptions, limits, and blocked conditions that the milestone never encountered.

---

## 12. Improve the workflow through reported evidence

### Working-agent responsibility

Agents report suspected workflow problems instead of quietly bypassing rules or changing their own enforcement.

Report concrete issues such as:

- Contradictory instructions.
- A gate blocking work that approved policy permits.
- A gate admitting work it should block.
- Broken identity or handoff behaviour.
- Repeated difficulty locating governing material.
- Substantial repeated effort caused by the procedure.

An expected safeguard is not automatically a defect.

Report a suspected safeguard failure immediately. Other friction may be recorded at the next checkpoint or handoff.

### Feedback record

Use a short record with a stable ID and task reference.

Include six fields:

1. Workflow version.
2. Rule or step involved.
3. Expected behaviour.
4. Actual behaviour.
5. Evidence reference.
6. Impact.

Say when information is unavailable. Do not invent details or include secrets.

Reference a duplicate if already known; the working agent does not need to search the whole inbox.

The reporting path remains available while implementation is blocked.

**Filing a report does not change task readiness, grant an assumption, or create permission to bypass a rule.**

### Independent maintenance procedure

Start maintenance manually as a separately authorised session.

Default limit: **three reports or thirty minutes, whichever comes first**. Apply spending limits where supported, record actual usage when available, and state when it is unknown.

The maintenance agent:

1. Reads the applicable workflow version and selected reports.
2. Checks evidence and groups known duplicates.
3. Classifies each report.
4. Reproduces the issue using deterministic fixtures where possible.
5. Proposes the smallest supported correction.
6. Verifies the correction and existing safeguards.
7. Produces dispositions, a conclusion, and any proposed change for approval.

Use these classifications:

- Workflow defect.
- Project configuration problem.
- Agent misunderstanding.
- Expected safeguard.
- Improvement proposal.
- Insufficient evidence.

A proposed change to a blocking fixture’s expected result must cite the policy it allegedly contradicts and explain the contradiction.

A citation alone does not prove the change is a bug fix. A change to intended authority or permitted behaviour is a policy change.

### Maintenance output

Each run ends with:

- Classification counts.
- A disposition for each examined report.
- Evidence and remaining uncertainty.
- One clear statement of what should change: instruction, configuration, implementation, fixture, or nothing.
- Usage and follow-up work.

If misunderstandings recur, assess whether the instructions need clarification. If safeguards repeatedly fail, prioritise the underlying defect.

Judge improvement through recurrence, severity, wasted effort, and whether adopted fixes actually helped. Do not infer success from an empty inbox or an arbitrary confirmation percentage.

Workflow changes follow their own review and approval path, receive a new version, and are explicitly adopted by projects.

---

## Operating principle

**The owner authorises outcomes and consequential decisions. Agents perform the technical work within those boundaries, preserve evidence, recommend the next step, and stop at meaningful decision points.**

The workflow’s effectiveness must be demonstrated through its fixtures and real use. Written rules alone are not proof that the system follows them.