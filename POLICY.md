# Agent-Assisted Software Development Workflow

**Version:** 1.0
**Status:** Adopted 2026-09-16 by the project owner for PrintFlow (originally proposed as "1.0 — updated proposal"; the body below is the proposal text, unchanged)
**Applies to:** New and existing software projects, using any capable coding agent

## 1. Purpose and working sequence

Deliver software through small, reviewable changes grounded in explicit requirements and verifiable evidence.

**Discover → Check readiness → Implement → Verify → Independently review → Accept and integrate → Release → Improve**

The project owner defines intended outcomes and retains reserved decisions. Agents investigate, propose, implement, test, document, and review within delegated authority.

Scale documentation and checks to the work. A small repair can use a short task record and existing requirements. A substantial feature needs more preparation.

This document is the reference policy. Daily agent instructions point to the relevant procedure and records; agents do not need to reread the entire policy every session.

## 2. Establish the project profile

Before production development, create or refresh a concise profile containing:

- **Purpose:** users, problems, desired outcomes, and measures of success.
- **Scope:** included work, exclusions, delivery priorities, and constraints.
- **Starting position:** existing software, integrations, prototypes, and known limitations.
- **Product expectations:** important journeys, visual direction, accessibility, languages, and target devices.
- **Technical context:** confirmed architecture, environments, dependencies, data, and unresolved technical choices.
- **Authority:** governing sources, decision owners, delegated choices, and reserved decisions.
- **Delivery:** verification commands, review and approval arrangements, deployment ownership, and operational responsibilities.
- **Workflow configuration:** adopted version, project-specific settings, approved deviations, setup budget, and optional tooling.

Record unknowns explicitly. Complete only what is needed for the next bounded piece of work.

For each relevant quality expectation, identify:

| Field | Meaning |
|---|---|
| Acceptance condition | What satisfactory behaviour looks like |
| Evidence method | Test, measurement, inspection, or human walkthrough |
| Responsible role | Who produces or assesses the evidence |
| Required stage | When it must be satisfied |

Cover correctness, maintainability, security, usability, accessibility, performance, and reliability where relevant. Convert these into named checks or review activities by the first integration of affected functionality.

**Completion condition:** The profile supports choosing the next task and identifying its prerequisites.

## 3. Keep shared knowledge accessible and authoritative

Maintain tool-neutral, version-controlled records for:

- Requirements and acceptance examples.
- Architecture and significant design decisions.
- Open questions, assumptions, and their resolution.
- Tasks, checkpoints, and verification evidence.
- Operational procedures.
- Workflow feedback.

Give records stable identifiers and locations. Record explicit supersession when a decision changes. A newer date alone does not establish authority.

Treat prototypes, research, generated summaries, and archived material according to their stated status.

### Agent instructions and skills

Keep the root `AGENTS.md` short. It should identify:

- Where the project profile and governing sources live.
- How to start or resume a task.
- Which readiness procedure applies.
- Where commands, task records, and feedback procedures are located.

Provide thin adapters for agents that require different instruction files. Verify that each selected agent can discover and follow the same procedures.

Skills provide methods for doing work. They remain subordinate to project requirements, permissions, and this workflow.

Before adopting a skill or tool, inspect its instructions, dependencies, automatic actions, data access, and compatibility. Pin the adopted version and test the behaviour the project will rely on.

### Optional navigation tools

Projects may adopt optional navigation tools when observed needs justify them. Their indexes are derived artifacts: record the tool version and indexed source revision, account for subsequent changes, and preserve document authority and source references. Agents verify consequential claims against authoritative sources; gates read governing records directly. Direct source inspection remains available when an index is missing, stale, or unsuitable. Evaluate benefits against targeted search, including correctness, time, usage, and maintenance cost.

Graphify, generated document indexes, and similar tools begin as **deferred optional tooling**. Their absence does not block readiness.

Repeated difficulty locating relevant material triggers investigation. First identify the cause: unclear routing, missing documentation, weak search, or difficult relationships. Try the simplest suitable improvement and measure its effect.

## 4. Use readiness gates before implementation

Readiness is assessed at three levels.

### Project readiness

Confirm enough is known about purpose, authority, scope, constraints, and delivery to undertake the proposed work.

When this information is missing, permitted discovery work includes:

- Inspecting existing material.
- Asking focused questions.
- Researching verifiable facts.
- Sketching user journeys.
- Running explicitly bounded experiments or labelled prototypes.

Discovery produces a brief, supporting evidence, and scoped open questions.

### Feature readiness

Confirm the affected feature has sufficient definition:

- Intended user outcome and boundaries.
- Business rules, permissions, and data ownership.
- Acceptance examples.
- Relevant interface behaviour and design references.
- Failure, recovery, and disconnected behaviour where applicable.
- Dependencies and unresolved decisions.
- Appropriate design and verification plans.

Reuse or create a design record when changing shared contracts, synchronisation, money or stock rules, security boundaries, or difficult-to-reverse data behaviour. Substantial changes across components also require a design record.

A design record can be short. Link to existing approved design when it already answers the question.

### Task readiness

Check mechanically where possible:

- Task owner and bounded objective are recorded.
- Governing records exist and are applicable.
- Required prerequisites are satisfied.
- Blocking decisions are resolved through the required approval mechanism.
- Permitted assumptions and deferred inputs are explicit.
- Baseline checks have been run and their results recorded.
- Readiness references the current applicable requirements and trusted baseline.

A prerequisite can be an approved interface contract; the entire upstream feature need not be finished.

A known failing baseline can be appropriate for a repair task. Record the failure rather than demanding a clean baseline.

### Gate outcomes

- **Ready:** implementation may proceed within the recorded scope.
- **Ready for a bounded subset:** only the specified independent portion may proceed.
- **Needs discovery or resolution:** continue permitted investigation and unaffected work.

Agents may move a task from Draft to Ready when existing approved material satisfies its prerequisites. Open reserved decisions require the designated owner's decision.

Reassess affected readiness when requirements, dependencies, or relevant evidence change.

## 5. Handle missing information according to its nature

| Situation | Required response |
|---|---|
| Information already exists | Locate and read its governing source |
| A fact can be investigated | Research or inspect it; record evidence |
| A business or product decision is needed | Route it to its decision owner |
| Technical feasibility is uncertain | Create a bounded experiment with an evaluation criterion |
| A choice is delegated and reversible | Make it within the recorded limits |
| Information is needed at a later stage | Record who supplies it and when it becomes blocking |

The profile distinguishes:

- **Delegated decisions:** agents may decide within stated boundaries.
- **Reserved decisions:** designated humans must decide.
- **Permitted assumptions:** temporary, reversible choices that must be recorded and revisited when relevant.

Reserved decisions include changes to approved scope, business behaviour, acceptance conditions, financial rules, security or privacy commitments, and other areas explicitly reserved by the project.

Internal variable naming may be delegated; changing a public API name may alter an approved contract. Classify choices by their consequences.

Waiting for an answer never silently becomes permission to assume one.

## 6. Track work and decisions with stable records

### Task record

Each task records:

- Identifier, objective, scope, owner, and status.
- Governing requirements and acceptance examples.
- Prerequisites, decisions, assumptions, and deferred inputs.
- Branch, starting revision, and readiness baseline.
- Implementation and verification approach.
- Baseline results and known failures.
- Latest checkpoint, blockers, next action, and evidence references.
- Review, acceptance, integration, and release information as applicable.

Use these statuses:

**Draft → Ready → Active → Done**, with **Blocked** available when progress depends on a missing prerequisite.

Record the condition for resuming blocked work.

Keep **implemented, verified, accepted, and released** as separate milestones. A passing test does not establish acceptance or deployment.

### Decision and open-question records

Each record includes:

- Stable identifier and question.
- Type: decision, factual input, technical uncertainty, assumption, or deferred input.
- Responsible owner or supplier.
- Affected features or tasks.
- Required-before stage.
- Status, proposed or accepted answer, and evidence.
- Supersession reference when applicable.

Decision states are **Open → Proposed → Resolved**. Keep the record at a stable path.

An agent may resolve a verifiable factual question with evidence. A reserved decision requires authenticated owner approval.

Inline markers may point to these records. Readiness uses the structured record and its affected-work scope, rather than blocking every task linked to a document containing an open question.

## 7. Bind reserved decisions to authenticated approval

An agent-written "approved" or "resolved" field is insufficient evidence of owner approval.

Use a project-defined mechanism that binds the authorised person's approval to the specific decision content.

### GitHub implementation

Where supported, configure:

- An agent publishing identity distinct from the human approver.
- Required owner review for governing requirements, reserved decisions, and acceptance definitions.
- Protection for `CODEOWNERS`, workflow policy, validator, and CI configuration.
- Required checks and invalidation of stale approvals.
- Rules applying to administrators, with no agent bypass permission.

`CODEOWNERS` must be accompanied by required-review configuration. Verify availability for the repository and plan. [GitHub code-owner documentation](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners), [ruleset documentation](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets).

Resolve and accept a blocking reserved decision **before** dependent production implementation. Use a separate decision change; bundling the decision with finished implementation does not satisfy the entry gate.

### Trusted baseline

Before validating readiness:

1. Fetch the configured authoritative repository state.
2. Select and record the exact accepted revision.
3. Read applicable approved records from that revision.
4. Evaluate the task against those records.

A record resolved on that baseline can provide approval evidence only when the protected integration process establishes that meaning. An arbitrary branch named `main` does not.

On other hosts, document and test an equivalent approval mechanism. If approval remains a manual check, label it as manual. Git author text alone is not authentication; a signature is relevant only when the signer is bound to the authorised decision owner and the approved content.

## 8. Implement through small increments and recoverable checkpoints

At task start:

1. Read the task, governing sources, and latest checkpoint.
2. Inspect the actual branch and working state.
3. Recompute relevant readiness.
4. Record the baseline results and next bounded action.

During implementation:

- Stay within the authorised scope.
- Follow applicable project conventions and selected procedures.
- Verify meaningful behaviour as it is introduced.
- Preserve approved requirements and acceptance conditions.
- Escalate newly discovered reserved decisions.
- Continue independent work when another part is blocked.

A meaningful checkpoint is a commit on the task branch, with the task ID at the start of the commit message. It may preserve incomplete work or known failures when clearly recorded.

Make checkpoints available to the next agent through the shared repository or agreed remote. Worktrees do not share uncommitted files.

### Coordination and handoff

The project coordinator assigns an owner before work begins. For a solo project, the human owner initially performs this role.

Concurrent implementation uses separate branches and worktrees, with explicit coordination for shared contracts.

A handoff records:

- What changed.
- What was verified, and against which revision.
- Remaining failures or uncertainty.
- The next concrete action.
- **Workflow friction: none observed / report IDs.**

## 9. Verify, independently review, and integrate

### Verification

Select checks appropriate to the change, including relevant:

- Business-rule and regression tests.
- Type, lint, build, and component-boundary checks.
- Integration and user-journey checks.
- Permission, security, and data-handling checks.
- Performance, recovery, accessibility, or human usability checks.

Record the tested revision, environment, results, and limitations. Distinguish unperformed checks from passing checks.

Recheck affected evidence after material changes.

### Independent review

Use a separate reviewer context containing:

- Task scope and governing requirements.
- Shared design records and decision rationale.
- Exact revision or diff.
- Tests, evidence, and known limitations.

The reviewer does **not** receive the implementer's conversation or informal reasoning transcript.

The reviewer investigates scope, correctness, maintainability, security, and regression risks. It reads relevant source material and verifies important findings.

Resolve findings or record an authorised disposition before integration.

### Integration enforcement

Classify changes according to their effect:

| Category | Treatment |
|---|---|
| Planning, checkpoints, and feedback | May proceed without implementation readiness |
| Governing requirements and decisions | Require applicable decision approval |
| Production-affecting changes | Require implementation readiness and relevant checks |
| Workflow enforcement | Require protected review; cannot approve themselves |
| Generated artifacts | Follow their declared producer and consumers |

Production-affecting changes include migrations, dependencies, infrastructure, scripts, and generated-code inputs where they alter delivered behaviour.

Unclassified paths require classification before integration. A documentation location does not exempt a file that changes production behaviour.

CI recomputes readiness using validator and policy code from the recorded trusted baseline. It evaluates candidate records without treating unapproved candidate changes as accepted authority.

Task status, commit labels, and stored "passed" fields do not substitute for that evaluation.

Hooks support traceability and early feedback. They do not prove that an agent never made an early local edit.

## 10. Release with operational evidence

Before release, satisfy the project's applicable release conditions:

- Accepted functionality and required verification.
- Correct production configuration, permissions, and secret handling.
- Tested migrations and data compatibility.
- Monitoring and useful failure diagnostics.
- Backup, restoration, rollback, or forward-recovery procedures.
- Provisioning and update procedures for managed devices.
- User or operator instructions.
- Named release and operational owners.

A deferred input becomes blocking at its required-before stage.

Deploy through the authorised process, verify important behaviour in the target environment, and record the released revision and outcome.

Maintain clear evidence for four milestones:

**Implemented → Verified → Accepted → Released**

## 11. Package, version, and introduce the workflow economically

Maintain one versioned workflow repository containing:

- This policy.
- A short quickstart and operating procedures.
- Project, task, decision, checkpoint, and feedback templates.
- Readiness validator.
- Default path-classification configuration.
- Regression fixtures.

Projects adopt a tagged release and record its immutable revision. Keep project settings and approved deviations explicit.

Propose reusable improvements upstream. Projects upgrade deliberately after reviewing relevant changes; they do not silently receive new rules mid-task.

### Initial setup

Default setup budget: **two working days**, unless the profile specifies otherwise.

Within that budget:

1. Adapt the minimum templates and instruction adapters.
2. Define project authority, approval arrangements, and path classifications.
3. Review the initial policy and validator to establish a trusted baseline.
4. Configure required checks and protections.
5. Run the validator fixtures.
6. Exercise the approval arrangement through a real review-and-merge test.

If setup exceeds the budget, report what remains and decide how to reduce scope or extend it. Do not silently remove safeguards or describe unfinished enforcement as operational.

The fixture suite must demonstrate:

1. An unresolved required decision blocks affected implementation.
2. An unrelated task remains ready.
3. A self-declared resolution or "passed" field cannot substitute for approval.
4. Accepted decision evidence permits dependent work, while relevant supersession invalidates stale readiness.
5. Deferred inputs become blocking at their required stage.
6. Satisfied contractual prerequisites and documented failing repair baselines are handled correctly.
7. Planning, checkpoints, and feedback remain possible while implementation is blocked.
8. Production-path misclassification, unclassified changes, and candidate validator changes cannot bypass the gate.

Then use the workflow on a bounded real task or technical experiment. Record **workflow performance** separately from **technical results**.

Navigation indexes and Graphify are not prerequisites for this setup.

## 12. Improve the workflow through reported evidence

Working agents report suspected workflow problems. A separately launched maintenance agent investigates them.

Reporting does not grant permission, alter readiness, create an assumption, or authorise a rule change.

### Seven-step feedback procedure

**1. Notice and report**

Report observed contradictions, incorrect gate outcomes, missing procedures, repeated navigation problems, or avoidable process work.

An expected safeguard is not automatically a defect.

Raise a suspected safeguard failure immediately. Raise a blocker when encountered. Record other friction by checkpoint or handoff.

**2. Write a short report**

Use a project-local feedback inbox. The report header identifies the task and relevant revision.

Include six fields:

- Workflow version.
- Rule or step.
- Expected behaviour.
- Actual behaviour.
- Evidence reference.
- Impact.

If information is unavailable, say so. Keep sensitive evidence in its authorised location.

Reference a known duplicate when convenient. The reporter does not need to search the entire inbox.

**3. Continue within existing authority**

Continue unaffected work or record the blocked condition and next action.

The feedback path remains available without passing the implementation gate.

**4. Launch independent maintenance manually**

The owner starts a separate maintenance session with a bounded instruction and access to the relevant policy, reports, and evidence.

Suggested investigation budget: **three distinct reports or thirty minutes**, whichever comes first. Use tool-enforced usage limits where available.

Record actual usage when available; otherwise record that it is unavailable.

**5. Classify and reproduce**

Group duplicates and classify reports as:

- Workflow defect.
- Project-configuration problem.
- Agent misunderstanding.
- Expected safeguard.
- Improvement proposal.
- Insufficient evidence.

Prefer small deterministic reproductions before costly full-agent scenarios.

**6. Propose and validate the smallest appropriate change**

Fix the established cause and add or correct relevant regression coverage.

Changing a blocking fixture's expected result requires identifying the policy it contradicted and explaining the mismatch. A citation alone does not establish that the change preserves policy.

If intended behaviour is ambiguous or the proposal relaxes an approved requirement, follow the decision-approval process.

The maintenance agent proposes changes; it cannot independently grant itself authority to weaken the workflow.

**7. End with a disposition and follow through**

Each run records:

- Classification counts and report dispositions.
- The proposed instruction, configuration, validator, or fixture changes.
- Checks performed and remaining uncertainty.
- Actual usage where available.
- A clear conclusion: change, no change, or further evidence needed.

Review and release reusable changes through the workflow repository. Projects adopt the resulting version explicitly.

Assess improvement through recurring causes, severity, wasted effort, and whether fixes stopped recurrence. Avoid arbitrary confirmation-rate thresholds.

An empty feedback inbox does not prove the workflow is defect-free.
