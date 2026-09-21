# Evaluation of the owner's workflow ideas

**Date:** 2026-09-21. **Record:** MAINT-2026-09-21-IDEAS; [task T-0001](../workflow/tasks/T-0001.md). **Status:** evaluation complete; recommendations only, pending owner decision. No workflow rule, installed skill, tool configuration, release, or project adoption was changed.

**Recommendation:** keep the current workflow and improve a few practical instructions. Prioritise running-app verification, a clearer task brief, and task-appropriate testing. Add product AI evaluations when relevant. Use ECC as a source of selected examples, not as a replacement workflow or a bundle to install now.

**Follow-up:** the [Codex/Fable conclusion](ideas-joint-conclusion-2026-09-21.md) settles the selection after two short discussion rounds. It narrows the implementation plan below: use brief technique examples within existing guidance, and keep product-AI guidance in profile/design verification rather than adding readiness machinery.

## Scope and evidence

The owner requested evaluation of the ideas for value, contradictions, alternatives, and reasons to reject them. This authorises research and proposal records, not adoption. All five groups in the [backlog](ideas-backlog.md) were examined; this explicit requested scope supersedes the default three-report selection limit. The thirty-minute maintenance timebox remains applicable.

Workflow comparison source: local clean checkout `eed4b97e6585a7413b9817a60b3877dffc4f74bd`, package `1.1.0-dev.0`. This identifies the inspected material; it is not a claim of owner approval or a freshly verified remote governing baseline. Read [POLICY.md](../../POLICY.md) in full, the relevant procedures/templates, validator scope and lifecycle logic, the existing [conformance record](../audit/conformance.md), and the complete [technique document](sources/technique-selection.md).

ECC was inspected at immutable source revision `2b6e839771e53096d8451a213d40dc64ec8acac0`. See the [source audit](../audit/ecc-source-review-2026-09-21.md). No ECC installation, external hooks, agent instructions, or test programs were executed. External skills were read as evaluation subjects, not invoked.

The video URLs and full original transcripts are absent from this checkout. The A/B verdicts assess the recorded claims, not the accuracy of the videos' summaries or their demonstrations. The sponsorships neither prove nor disprove the advice. No project-level defect, time-saving, or cost-reduction measurements were supplied; priorities below are reasoned recommendations to test, not measured returns.

## IDEA-01 — ECC

**Verdict: take selected ideas after adaptation and a trial; do not install the whole bundle now.**

ECC contains real implementation: skill documents, specialist agents, commands, common/language rules, hook programs, installers, MCP configuration, and tests. The inspected package is 2.2.2 with Claude and Codex plugin manifests and additional harness adapters. That proves substantial tooling exists; it does not establish improvement on our tasks. Its broad model-cost claims were not substantiated by a representative comparison in the inspected evidence. Its eval example explicitly does not execute or score candidate agents. [Detailed evidence and limitations](../audit/ecc-source-review-2026-09-21.md).

Potentially useful parts:

| Candidate | Value here | Required adaptation |
|---|---|---|
| `browser-qa` / `e2e-testing` | Concrete interaction checks, visual evidence, traces and failure investigation | Use the project's devices and acceptance examples. Preserve required tests; do not copy skip/quarantine examples as a way to pass. QA cannot grant release authority. |
| `contract-first` | Practical examples for keeping consumers and providers aligned | Reference our approved contract and decision records. Use the smallest suitable checks; do not require a new framework for every interface. |
| `verification-loop` report shape | Makes checked/failed/unavailable results easy to scan | Our checkpoint already covers most of this. Do not copy its shell pipelines or treat simple text searches as a security audit. |

I would borrow the useful checklist details in our own small procedure first. A whole external skill is justified only if that saves maintenance and passes a representative test.

Specific conflicts or poor defaults: importing ECC's common rules would introduce mandatory TDD, a universal 80% coverage target, and broad automatic delegation. Its autonomous-loop examples include automatic merging; its learning system can turn observations into future guidance. These cannot replace our scope, approval, separate review, explicit adoption, or assisted-runner limits. Some are optional features or separately installed rule packs, not unavoidable behavior of every ECC installation.

The source is MIT-licensed; retain the notice for copied material. The installer can fetch dependencies, plugins carry executable hooks, and the root MCP configuration uses an unpinned `@latest` package. Pinning the ECC commit alone therefore does not pin every executable dependency. Full supply-chain and runtime compatibility testing remain undone. See [POLICY §3](../../POLICY.md#skills-and-reusable-tools).

## IDEA-02 — Run the app, log in, inspect it, and iterate

**Verdict: recommend an explicit implementer-verification instruction. No workflow prohibition needs removing.**

[POLICY §9](../../POLICY.md#9-verify-review-and-integrate) already requires relevant journeys, device behavior, and implementer verification. [Execution](../../procedures/execute.md) permits fixing and repeating checks; stopping is tied to authority, limits, missing access, and repeated lack of progress. Self-testing does not replace independent review or product acceptance.

The gap is practical: the profile does not explicitly say how to start the app, reach the test environment, obtain a permitted test session, or find safe test data. The task template does not explicitly request evidence of visual inspection.

Recommended instruction, for a later reviewed change:

> For UI-affecting work, run the affected journey in an authorised environment, inspect the rendered result at relevant viewport/device settings, and compare behavior with approved acceptance examples. Fix in-scope defects and repeat affected checks within existing limits. Record the revision, environment, account role, actions, expected/observed results, and useful redacted evidence. If required verification is unavailable, record that limitation and its blocker; do not claim verification.

Screenshots establish appearance, not successful persistence, calculations, or permissions. Test those outcomes where relevant. Do not demand screenshots for unrelated backend or prose edits.

**Authentication needs a tool-specific answer.** Claude Code's Chrome integration currently shares existing browser login state but pauses for manual handling of login pages and CAPTCHAs. That supports the narrower restriction, not the backlog's blanket claim about all agent tools. [Claude documentation](https://code.claude.com/docs/en/chrome).

The installed Codex browser skills also restrict authentication handling: an explicitly selected browser requires a supported documented flow or user sign-in when blocked. They prohibit inspecting browser session stores. This inspection did not perform a live login test or identify the tool involved in the owner's earlier difficulty. [Installed browser skill](/Users/monta/.codex/plugins/cache/openai-bundled/browser/26.915.31945/skills/control-in-app-browser/SKILL.md).

For a project that supports automated test authentication, use dedicated test accounts and the permitted testing route. Playwright supports authenticated setup and reused state; those state files contain secrets and belong outside committed evidence. Such a route is not permission to circumvent a selected browser's restrictions. Prefer the real test login flow or a supported test session over introducing an auth bypass. A bypass would create extra security work and could hide login defects. [Playwright authentication](https://playwright.dev/docs/auth).

The profile should hold secret-store references, environment, test roles, allowed test effects, and reset instructions—never passwords or session tokens. User-supplied credentials do not automatically establish safe scope. A test administrator may be necessary to verify admin journeys; it must not carry repository-owner or workflow-approval power. Do not expose real owner credentials to candidate code. Existing retry, spending, time, and no-progress limits already bound iteration.

## IDEA-03 — Video A

**Verdict: adopt a few brief improvements; most advice already exists or is too absolute.**

| Claim | Assessment and smallest useful response |
|---|---|
| A1: the owner must already program | Reject as a workflow entry requirement. Technical judgment matters, but POLICY assigns technical verification to agents/reviewers and product decisions to the owner. Owner acceptance is explicitly not a code/security audit. |
| A2: very specific technical prompts | Partly useful. Readiness and the task record already provide the brief. Link stack/commands and concrete outcomes from canonical sources; do not require the owner to prescribe files, libraries, and architecture they have delegated. One successful demonstration does not establish a universal prompting rule. |
| A3–A5: docs, mock-ups, screenshots, `llms.txt` | Add optional task references and starting read paths. Record versions and distinguish reference material from approved requirements. `llms.txt` can help navigation; its filename does not establish authority or freshness. |
| Prompt rewriting | Optional aid for exposing omissions. Reject a mandatory prompt-optimisation step: it can polish an ambiguity without resolving it. |
| A6: smaller tasks | Already substantially covered. Recommend one independently checkable outcome per task; split when unrelated outcomes, conflicts, dependencies, or review difficulty justify it. No arbitrary file/line/time threshold. |
| A7: human owns all solution design | Partly reject. The owner owns reserved decisions; agents may make delegated technical choices under POLICY §5. Keep consequential designs explicit without transferring every implementation decision back to the owner. |
| A8: Task / Background / Do not | Useful clarification. Add exclusions and behaviors to preserve to the existing task prose. Keep the existing `scope` field as the permitted change boundary; do not create a competing allowlist. |
| A9: persistent project instructions | Already present. A setup example could show short links to stack, commands, conventions, and scoped guides. Avoid copied rules that drift. Test actual instruction discovery for each harness. |
| A10: MCP verification tools | Select tools by a demonstrated need through the toolbox process. Start with existing tests/CLI/browser capability; do not install Context7 or multiple MCP servers by default. |
| A11: meaningful verification | Already strong in policy and review. IDEA-02 makes the running-app part more actionable. No additional generic gate needed. |

Basis: [profile](../../templates/profile.md), [task](../../templates/task.md), [readiness](../../procedures/readiness.md), [setup](../../procedures/setup.md), and [review](../../procedures/review.md).

## IDEA-04 — Video B

**Verdict: useful context guidance; reject blanket stops, rigid model routing, and permanent agent teams.**

| Claim | Assessment and smallest useful response |
|---|---|
| B1: global/project/scoped rules and indexing | Clarify where personal preferences, project facts, and local conventions belong. Global preferences and derived indexes must not grant project authority or silently change approved behavior. Scoped rules are useful when needed and must be tested per harness. Keep indexing optional. |
| B2: precise brief and assumptions first | Already mostly implemented. The validator checks listed assumptions against the baseline profile and checks changed production paths against task scope. It cannot detect every unstated assumption or prove the agent ran a gate before its first edit. Clarify the execution instruction; avoid overstating enforcement. |
| B3: files to read | Add optional starting read paths/references distinct from permitted write scope. Treat them as a navigation aid, not a prohibition on inspecting a relevant dependency. |
| B4: model per role and short sessions | Defer fixed routing until measurements exist. Compare total cost, correction/review time, latency, and outcome quality. Cache effects depend on the provider and request; no universal savings claim is established here. Preserve task continuity when useful; POLICY already avoids unnecessary resets. |
| B5: plan first; stop on every ambiguity; no dependencies | Use proportional planning. Stopping on every ambiguity contradicts delegated reversible decisions in POLICY §5. Research facts, choose within delegation, and ask for reserved choices with meaningful options. Dependency additions follow project authority, licensing/security checks, and effects; neither blanket prohibition nor unrestricted addition is appropriate. |
| B6: human reviews all code | Independent technical review already exists. The owner can inspect code but should not be made responsible for certifying security through product acceptance. |
| B7: writer/reviewer/test-writer teams | Keep one coordinator and separate review. A separate test designer may help high-consequence rules by deriving expected results from approved examples; trial it only when that benefit justifies cost. No permanent three-agent requirement. Worktrees isolate files, not approval identities. |
| B8: natural-language Git, screenshots, diagrams | Useful tools, largely covered. Commands still require verified identity and scope. Generate diagrams when they answer a real question; verify them against sources. |
| B9: permission tiers | Already covered. Setup should test that harness permissions allow intended work without granting reserved authority. A tool's ability to run an action is not owner approval. |
| B10: stop and revert | Stop/checkpoint/recovery already exist, but there is no unconditional revert instruction—and adding one would be harmful. Inspect the current diff and external effects; use a scoped fix or revert when appropriate. Code rollback cannot undo a payment, message, or migration automatically. |

Mechanical evidence: [readiness implementation](../../validator/lib/readiness.js), [session/lifecycle implementation](../../validator/lib/lifecycle.js). These checks constrain recorded evidence and integration, not every local action or semantic decision.

## IDEA-05 — Select techniques by the task

**Verdict: recommend a short optional selection guide in the existing Approach section. The workflow already has the discipline; it has not mandated TDD, BDD tooling, or DDD architecture.**

| Proposed gap | Decision | Smallest useful change |
|---|---|---|
| Technique selection | Recommend | State the uncertainty/risk, chosen approach, and evidence in a few lines. No new mandatory `technique` schema field. |
| Prototyping | Mostly covered | Clarify prototype findings → owner resolution where needed → approved behavior → production task. Prototype code needs normal production checks before reuse. [Prototype guidance](https://www.gov.uk/service-manual/design/making-prototypes). |
| BDD / Given-When-Then | Substance already covered | Offer Given-When-Then for ambiguous behavior and examples; do not require Gherkin/Cucumber or ceremonial workshops. [BDD](https://cucumber.io/docs/bdd/). |
| TDD | Recommend selectively | Prefer observed failing test → minimal passing implementation → refactor for clear rules/calculations and reproducible bugs. Record the meaningful red/green evidence once per relevant behavior, not a diary of every edit. Setup failure is not proof of the intended red test. [TDD](https://martinfowler.com/bliki/TestDrivenDevelopment.html). |
| DDD / glossary | Conditional | Add a glossary or domain boundary model where concepts and ownership are genuinely ambiguous. Do not mandate microservices, aggregates, or extra ADRs for simple CRUD. Existing design records already cover ownership and invariants. [Domain analysis](https://learn.microsoft.com/en-us/azure/architecture/microservices/model/domain-analysis). |
| Contract testing | Recommend naming explicitly | Check relevant consumers and providers against the agreed interface; shared types alone do not prove runtime agreement. Use lightweight schema/examples where sufficient; add consumer-driven tooling only when justified. Preserve integration journeys. [Pact](https://docs.pact.io/). |
| Bug-fix lane | Recommend a compact recipe, not weaker gates | Reuse approved behavior/design, reproduce or preserve evidence of the fault, add a regression check where practical, fix narrowly, and retest the original symptom. Failing baselines already work. Unknown intended behavior still needs resolution. |
| Negative examples / properties | Recommend explicit prompts | Ask what must never happen for relevant permissions, money, stock, and irreversible operations. Property-based tests are an option for broad invariants, not a universal dependency. [Hypothesis](https://hypothesis.readthedocs.io/en/latest/). |
| AI behavior inside the product | Real documentation gap | Require a task-specific evaluation plan when model behavior affects acceptance. Existing check/receipt mechanisms can carry its results; no separate gate engine is initially necessary. |
| Passed / failed / not tested | Already covered | Retain current evidence and limitation rules. |
| Test weakening and independent expected results | Already covered substantively | Review already examines helpers/assertions and compares tests with approved behavior, not only IDs. Add a worked wrong-expectation example to training material only if misunderstanding recurs. |
| Short instructions and improvement through results | Already covered | Link the guide instead of expanding AGENTS.md; evaluate changes using observed defects, rework, review effort, and cost. |

For product AI, the plan should identify representative ordinary, edge, adversarial, and relevant language cases; approved expected behavior or scoring criteria; unacceptable actions; thresholds; model/prompt/tool configuration and data-set version; repeat strategy for variable outputs; and results/limitations. Keep withheld cases where useful and calibrate automated grading against human judgments. Run conventional software checks for the surrounding permissions, tools, and persistence too. A passing average must not conceal a forbidden action. This is a recommendation for our workflow, supported by [OpenAI's evaluation guidance](https://developers.openai.com/api/docs/guides/evaluation-best-practices).

**Installed skill fit matters.** The local [tdd skill](/Users/monta/.agents/skills/tdd/SKILL.md) explicitly excludes refactoring from its implementation loop (line 38), contradicting the supplied document and standard red/green/refactor usage. It also requires user confirmation of each testing boundary (line 22), adding approval friction when the project has already delegated that choice. Its absolute rejection of database inspection is too broad for migration or persistence invariants. Keep its useful advice on independent expected values and behavior-oriented tests, but adapt/pin/review it before toolbox adoption. This evaluation does not modify that skill.

The [domain-modeling skill](/Users/monta/.agents/skills/domain-modeling/SKILL.md) has useful terminology and boundary practices. Its glossary and ADR conventions must point to the project's canonical records; writing a glossary entry must not resolve a reserved business decision by itself. No installed skill is automatically approved for every project.

Bun Alkaif could supply a future UI or business-rule trial, and the assistant mentioned in the source could supply an AI-evaluation trial. Those are illustrative candidates only: this evaluation did not inspect either project's current requirements or authorise work there.

## Small implementation plan, if selected

| Order | Proposed change | Files | Evidence needed before recommending release |
|---|---|---|---|
| 1 | Explain UI journey/visual verification and test access | `procedures/execute.md`, `templates/profile.md`; reuse task checkpoint fields | Observe one UI task catch and fix a real issue. Check missing access is reported honestly, test data is isolated, no secrets enter evidence, and self-testing still cannot replace review/acceptance. |
| 2 | Sharpen the task brief | `templates/task.md`, short clarification in `procedures/readiness.md` | Add prose for references/read paths, exclusions/behavior to preserve, and links to run/check commands. Exercise one small repair and one feature without extra owner questions for delegated choices. Preserve existing scope/assumption checks. |
| 3 | Add optional technique examples and a compact bug recipe | Existing Approach guidance in `templates/task.md` and `procedures/execute.md`; no standalone guide | Use one logic bug and one UI-only adjustment: meaningful red/green for the former, appropriate visual evidence without contrived tests for the latter. Check negative examples and contract checks where relevant. |
| 4 | Add a conditional product-AI evaluation sentence | `templates/profile.md` and `templates/design.md` verification guidance | On an authorised AI feature, demonstrate a failing case, an improvement, and evaluation against approved criteria. Preserve configuration/data provenance and conventional permission tests. No new readiness gate logic. |
| 5 | Trial an external excerpt or adapted skill only if needed | Project toolbox record; narrowly selected asset | Inspect all referenced scripts/dependencies and permissions, pin content and executable packages, test discovery and behavior in a disposable environment, review results, then propose registration. Preserve licence notices. |

No validator or schema expansion is justified by this evaluation alone. Guidance can first use existing verification fields, profile checks, acceptance methods, and evidence receipts. If a later proposal adds a mandatory gate or new permitted behavior, explicitly approve that policy choice and then add meaningful positive/adverse fixtures; do not call it a simple clarification.

Judge the trial by defects found before owner testing, avoidable clarification turns, rework, review effort, and total cost. Retain additions that show value. Do not use document count, coverage percentage, or number of agents as success measures.

Independent review of an implementation must use a separate context with canonical sources and an exact candidate. Owner approval, a new workflow version, and explicit project adoption follow [maintenance](../../procedures/maintenance.md). This report itself neither adopts the recommendations nor certifies the existing candidate's outstanding operational controls.

## Maintenance disposition and handoff

- Classification counts: **5 improvement proposals**; 0 reproduced defects in this repository, 0 demonstrated project configuration incidents. Supporting factual corrections: browser restrictions are tool-specific; the installed TDD skill does not match the proposed technique; ECC's implementation/tests do not establish general productivity gains.
- Change recommendation: **instructions and template prose first; optional scoped tooling trials later.** Reject duplicate gates, blanket TDD/coverage requirements, automatic policy learning/adoption, mandatory agent teams, unconditional rollback, and a readiness bypass for bugs.
- Verification: fresh `npm test` passed **95 tests, zero failed or skipped**; output is retained in [the run log](../audit/ideas-evaluation-2026-09-21.tests.tap). That checks the unchanged local validator; it does not validate the proposed practices or ECC.
- Record check: the local session-record validator passed. The full session CLI could not run because this source repository's baseline has no adopting-project `docs/workflow/config.json`; the existing `evaluateSession` function was called directly against the durable files. No configuration, receipt, or readiness approval was invented. This is a local record check, not authoritative gate evidence.
- Session outcome: **progress — all five idea groups evaluated; proposal and evidence preserved.** See [session record](../audit/ideas-evaluation-2026-09-21.session.json). No technical completion, independent review, or owner approval is claimed.
- Usage: tokens/spend unavailable. Timing and completion details are in the session record; the first recorded clock reading was 09:32:03 UTC, with earlier preparation unmeasured.
- Workflow friction this session: none observed in the current workflow's execution. External candidate incompatibilities are recorded above.
- Next action: owner selects or rejects the concrete recommendation groups. Then prepare only the selected implementation for independent review; leave release and adoption to their existing approval path.
