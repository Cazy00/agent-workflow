# Owner ideas backlog

**Status of this file:** the owner's list of ideas, recorded 2026-09-19. On 2026-09-21 the owner authorised the four selected additions. Their local implementation and validation are recorded in [T-0003](../audit/T-0003/report.md); they remain unreleased. Original ideas and first-read notes below are historical, not operating instructions.
**Audience:** the agent asked to evaluate these ideas. For each idea, decide whether it adds value, and if it does, write an implementation plan.
**Authority:** none. `POLICY.md` still governs. An adopted idea goes through `procedures/maintenance.md`: classify it as an *improvement proposal*, then get independent review, owner approval, a new workflow version and explicit project adoption. A working agent must not weaken its own rules, and an idea written here does not count as permission to do so.

**Evaluation:** all five groups were assessed on 2026-09-21 in [MAINT-2026-09-21-IDEAS](ideas-evaluation-2026-09-21.md). The assessment and implementation proposals supersede the unverified first-read notes below where they differ. The original ideas and quotations are preserved; implementation status below distinguishes local changes from release and project adoption.

**Expert discussion:** the owner-requested [Codex/Fable conclusion](ideas-joint-conclusion-2026-09-21.md) settles the recommended include/defer/pass list and narrows the implementation plan. The owner subsequently authorised its four-item implementation package. Release and adoption in other projects remain separate.

## How to evaluate each idea

1. Read the idea, including the owner's own words in the quote.
2. Check what the workflow already covers. The coverage notes below are the note-taker's first read and have **not** been verified, so check them against `POLICY.md`, `procedures/` and `templates/`.
3. Decide: adopt, adopt in part, reject, or needs owner decision. Give evidence for the decision, following POLICY's approach of judging by recurrence, severity, wasted effort and observed benefit.
4. When you adopt something, propose the smallest change that works (instructions, a template, config, the validator, or a fixture). Show that existing safeguards still hold.
5. Update this file's **Status** line for the idea, and link any resulting maintenance record, decision or plan.

Status values: `Unevaluated` · `Under evaluation` · `Adopted → <link>` · `Partly adopted → <link>` · `Rejected (reason)` · `Needs owner decision` · `Implemented (unreleased)` · `Partly implemented (unreleased)` · `Deferred`.

---

## IDEA-01 — Evaluate ECC (`https://github.com/affaan-m/ECC`)

**Status:** Deferred — no ECC bundle installation or asset adoption in this package; individual assets need a concrete task and vetting. See the [settled scope](ideas-joint-conclusion-2026-09-21.md#defer-or-pass).

**Owner's question (verbatim):**
> how can we use https://github.com/affaan-m/ECC.git ?? is it good as thay are saying ?? what can we do with it ?? or its just a hype ?

**Restated:** The owner has seen this repository being promoted and wants an honest assessment. What is it? Does it work as claimed? Is any part of it useful for this workflow or for projects that use this workflow? Or is it mostly hype?

**The note-taker did not research it.** The note-taker has no view on the repo's contents or quality. Start from the source itself, not from its README or from social media claims.

**Questions to answer:**
- What does ECC actually contain: skills, agents, hooks, rules, commands, MCP configs, scripts? Which harness does it target (Claude Code, Codex, others)?
- Which claims can be checked, and which are marketing? Is there evidence of effect, such as benchmarks, tests or real-world reports, or only assertions?
- How does it overlap with what this workflow already provides: readiness gates, independent review, durable records, the validator? Does any part of it conflict with `POLICY.md`? Example: anything that grants autonomy the policy reserves, auto-approves work, or blurs the owner and worker identities.
- Is there a small piece worth taking (a single skill, a hook, a checklist) as opposed to installing the whole thing?
- Maintenance and supply-chain risk: licence, activity, how much it pulls in, whether scripts run on install.

**Constraints that already apply:** POLICY § *Skills and reusable tools* says that before adopting an external skill or tool you must: inspect its instructions, scripts, permissions and dependencies; pin a version; test it on representative work; and record its purpose and limitations. Anything adopted is registered in `templates/toolbox.md`. Skills never grant extra authority.

**Expected output:** a short verdict (use / take specific parts / do not use) with evidence, plus the list of candidate parts if any.

---

## IDEA-02 — Let the agent open, log into and look at the running app itself, then iterate

**Status:** Implemented (unreleased) — running-app verification with authorised test accounts/data and existing safeguards. [Implementation and validation](../audit/T-0003/report.md).

**Owner's words (verbatim):**
> Is there any rule in the current agent that prohibits the agent from actually open and seize the output itself? If there is, let's remove this policy. As long the app have demo credentials or it have credentials that have been provided by me, the agent should be able to log in and actually test and see the output by itself.
>
> And actually make corrections and go with iterations if it wants to do so in order to get the task or the work done.

**Restated:** The owner wants the implementing agent to verify its own work visually and interactively, and to fix problems in a loop. That means starting the app, opening it in a browser (or a simulator), logging in with demo or test credentials, or credentials the owner supplied, then going through the flows, looking at the result, fixing what is wrong, and repeating until the task works. Where a rule blocks this, the owner wants it removed.

**Note-taker's first read of the current rules (verify these):**
- A grep of `POLICY.md`, `procedures/` and `templates/` found **no workflow rule that forbids the agent from running the app, opening it in a browser or looking at its output**. The rules point the other way:
  - POLICY § 9 and `procedures/execute.md` already require "integration/journey" checks, plus "performance/accessibility/device" checks where they apply.
  - POLICY § 9 calls self-verification "useful evidence".
  - `procedures/execute.md` allows repeat attempts until they stop making progress. Its stop condition is "repeated no-progress attempts", not "one try".
- **Rules nearby that the idea must not break:**
  - POLICY § 9 (≈ line 566): "Candidate code must not run with owner credentials or privileges that allow it to approve itself." Logging into the app under test with the owner's *real* account could conflict with this. Demo or test accounts would not.
  - POLICY ≈ line 336 and `procedures/identity.md`: credentials go in secret storage, never in repository files, task records or transcripts.
  - POLICY ≈ line 349: when worker credentials fail, never fall back to the owner account.
  - POLICY § 9: self-verification does **not** replace independent review, integration verification or owner acceptance. The idea should be adopted as *stronger implementer verification*, not as a way around the other layers.
- **The likely real blocker is outside this repository.** The agent harness (for example, Claude Code's built-in browser tools) has its own safety rules: it will not type passwords into login forms or create accounts, whatever the user or the repo says. That is probably why the agent "couldn't log in", not a rule in this workflow. **This repo cannot turn that rule off.** The evaluator should confirm this. If it holds, look at approaches that don't need the agent to type a password, for example:
  - a dev/test-only auth bypass or seeded session, switched on only in local/test environments;
  - automated browser tests (such as Playwright) that read test credentials from environment variables and save a logged-in session state, which the agent then reuses;
  - pre-created demo accounts that the owner logs into once, sharing the resulting session;
  - opening protected pages with a test token instead of the login form.

**Questions to answer:**
- Is there any wording in this repo, or in how projects adopt it, that agents *read* as forbidding self-testing, even though it doesn't? If so, clarify it.
- Should the workflow **require** a "run it and look" step for UI-affecting tasks, with screenshots or journey results recorded as evidence in the task checkpoint?
- Where do demo or test credentials belong: in the profile (`templates/profile.md`) as a reference to secret storage, never as values? What makes a credential "safe for the agent" (test-only, no owner privileges, no approval power)?
- How should the iterate-until-it-works loop be bounded? The existing limits on retries, usage and spending, and the "no meaningful progress" stop rule, look like the right mechanism. Confirm this.

**Expected output:** either a clarification or a change to implementer verification (instructions, template fields, maybe a fixture), plus a clear statement of what the harness blocks and the recommended workaround.

---

## IDEA-03 — Lessons from YouTube video A ("tips after hundreds of hours coding with AI", sponsored by JetBrains Junie)

**Status:** Partly implemented (unreleased) — optional references and exclusions in the existing task brief; most advice was already covered. [Implementation](../audit/T-0003/report.md) and [remaining dispositions](ideas-joint-conclusion-2026-09-21.md#defer-or-pass).

The owner shared a transcript and asked "what can we take from it?". Below is the note-taker's summary of the video's claims, each with a first guess at where this workflow already stands. The evaluator decides what, if anything, is worth adding.

| # | The video's claim (summarised) | First guess at existing coverage | Possible gap to evaluate |
|---|---|---|---|
| A1 | The person using AI must already know how to program. AI multiplies existing skill. | Not a workflow concern. The owner/agent split is defined in POLICY § 1. | Probably none. |
| A2 | Be as specific as possible. Vague prompts produce bad or "catfish" code (looks fine, rotten underneath). The video compares three prompt levels (bare, non-technical, fully technical), and only the fully technical one ran first time. | Readiness gates (`procedures/readiness.md`) block work until requirements, acceptance examples and decisions exist. | Is there a standard **task brief** telling the agent the exact stack, files, commands and expected behaviour? Or does it rebuild this from records every time? |
| A3–A5 | Attach documentation, screenshots or mock-ups, and reference links. Let the agent fetch docs, preferring `llms.txt` pages. | Profile has "visual direction". Design records exist. | Should task or feature records have a place for **reference material** (doc URLs, `llms.txt`, screenshots, mock-ups)? |
| — | Tip: write a short but technically complete prompt, then ask the AI to improve it using LLM prompting best practices. | Not covered. | Probably low value for this workflow. Evaluate briefly. |
| A6 | Smaller tasks give better results. If you can't break a task down, you don't understand it yet. | Milestones → tasks already exist, and a milestone is "one coherent journey". | Is there a size guideline for a single task? |
| A7 | Don't let the AI do all the thinking. The human owns the solution design. | The owner reserves decisions. Design records exist for consequential changes. | Probably covered. |
| A8 | Prompt pattern: **Task / Background info / "Do not" section**, where the last lists what must not be touched and the only files that may change. | Task records have `scope: []`. There is no explicit "must not touch" or "out of bounds" field. | **Worth evaluating:** an explicit *Do-not / out-of-bounds* section in `templates/task.md`. |
| A9 | Persistent project memory: an `AGENTS.md` or guidelines file with project summary, stack, commands and workflow. Separate rule files per technology if needed. | `AGENTS.md`, `CLAUDE.md`, profile and procedures. | Do adopting projects get guidance to keep **stack, commands and conventions** in their short repo guide? Should rule files per area or per sub-module be allowed? |
| A10 | Use MCP tools: docs fetchers (Context7), framework dev-tool MCPs (Next.js), browser DevTools MCP (console, network, layout shifts, performance). | POLICY § *Skills and reusable tools* plus `templates/toolbox.md` (vetting and registration). | Should the profile or toolbox suggest a **recommended verification toolset** per stack? Links to IDEA-02. |
| A11 | Always give the AI a way to verify its work: tests, running the app, CLI, CI. Check that AI-written tests actually test something. | POLICY § 9 (four verification layers, test fidelity in review, acceptance-ID traceability). | Mostly covered. Links to IDEA-02 for the "run the app and look" part. |

---

## IDEA-04 — Lessons from YouTube video B ("code with AI, not vibe code", sponsored by Warp)

**Status:** Partly implemented (unreleased) — starting read hints and preserved behaviour, without new approval stops or fixed agent teams. [Implementation](../audit/T-0003/report.md) and [remaining dispositions](ideas-joint-conclusion-2026-09-21.md#defer-or-pass).

The owner shared this transcript with the same question. Note-taker's summary:

| # | The video's claim (summarised) | First guess at existing coverage | Possible gap to evaluate |
|---|---|---|---|
| B1 | Set the foundation once: index the codebase, plus **global rules** (personal standards for every project) and **project rules** (stack, schema, API patterns, branch naming). You can add extra rule files for sub-modules. | Project level: `AGENTS.md` / `CLAUDE.md` / profile. Global level: the owner's `~/.claude/CLAUDE.md`, outside this repo. | Should the workflow say what goes in global versus project instructions, and allow scoped rule files per sub-module? |
| B2 | Be concrete. Use a prompt template: *Implement {thing} to {goal} using {lib}. Work in {paths} only. Respect {style/tests/rules}. Provide {tests/docs/migration}. If assumptions are needed, list them first.* | Task record has objective, scope, assumptions and verification. | Compare the task template field by field. Is "list assumptions **before** starting" enforced? Is "work in these paths only" enforced? (The validator may already check scope. Verify.) |
| B3 | Point the agent at the specific files to read or change. This improves accuracy and saves tokens compared with letting it search. | `scope: []` on tasks. | Should the task list **files to read** as well as files to change? |
| B4 | Choose models on purpose (expensive vs cheap). Use a strong reasoning model to plan and a coding model to implement. Don't switch models mid-conversation without reason, because it drops the cache. Keep conversations short, one per task, because history makes each turn cost more. | Profile records usage and spending limits. POLICY says fresh sessions recover from records. | Should the profile or procedures recommend a **model per role** (planner / implementer / reviewer) and session length? Measure cost before adding rules. |
| B5 | Plan first ("don't write code yet"), then implement exactly that plan with restrictions (listed files only, no new dependencies, keep existing behaviour). **If anything is unclear, stop and give two options with trade-offs instead of guessing.** | Readiness, reserved decisions, `templates/decision.md`. Agents must not self-resolve reserved decisions (fixture 03). | Check that the "present options, don't guess" behaviour is also required for *non-reserved* ambiguity found during implementation. Is "no new dependencies unless approved" a default? |
| B6 | Review AI output like pair-programming with a junior. Ask why a pattern was chosen, what the error cases are, and what it costs in performance. The human should read and edit code too. | Independent review in a separate context (`procedures/review.md`). | Probably covered for agents. Human code reading is an owner choice (acceptance explicitly isn't a code audit). |
| B7 | Several agents on one task: one writes code, one reviews, one writes tests, optionally one refactors from the feedback. Separate contexts avoid confirmation bias. Use git worktrees for parallel independent tasks. Two or three agents at most, or it gets overwhelming. | One coordinator by default. Independent reviewer in a separate context. Worktrees for parallel tasks (POLICY § 8, `procedures/execute.md`). | Is a **separate test-writer agent** (tests written without seeing the implementation's reasoning) worth adding? Evaluate against its cost. |
| B8 | Git through natural language. Screenshots for UI bugs. Docs URLs for APIs (whole pages cost tokens). Use AI to explore unfamiliar codebases and draw flowcharts for onboarding. | Graphify and similar tools are deferred (POLICY § *Optional navigation tools*). | Probably nothing new. Possibly an onboarding note. |
| B9 | Set permission tiers: some actions need approval, others run on their own. | Profile authority, reserved decisions, identity separation, approval receipts. | Probably covered. Check that the harness-level permission settings match the workflow's authority model. |
| B10 | Know when to stop. If agents cause chaos, stop and revert to the last good checkpoint or commit. | Stop conditions and checkpoints in `procedures/execute.md`. POLICY: don't blindly replay side effects after a crash. | Probably covered. Check that a "revert to last good checkpoint" instruction exists. |

---

## IDEA-05 — Choose the development technique per task (TDD / BDD / DDD / prototyping / contract testing / evals)

**Status:** Partly implemented (unreleased) — task-appropriate testing examples, practical bug repair guidance and conditional product-AI evaluations. No mandatory technique field, standalone guide or skill adoption. [Implementation](../audit/T-0003/report.md).

**Source:** the owner's document, kept verbatim with its references at [`sources/technique-selection.md`](sources/technique-selection.md). Read that file in full. What follows is only a summary and a first map against the workflow.

**Owner's question (paraphrased):** The owner is unsure about three things. Should the workflow adopt a development technique such as TDD, BDD or DDD? Is it better off without one? Or has it effectively adopted one already? The owner wants the evaluator to decide what would genuinely improve the agent flow.

**The document's core argument:**
- Keep **one consistent discipline** for every task: understand → define success → make a small change → verify → review and record.
- Choose the **technique per task, even per feature**, based on uncertainty, the consequences of failure, complexity and expected lifetime. Project size is not the deciding factor.
- The techniques aren't rivals because each answers a different question:
  - Prototyping / user-centred design: is this the right experience?
  - BDD / specifications: what should the software do?
  - DDD: how are the concepts and boundaries organised?
  - TDD: how do we build it in small, checked steps?
  - Contract / integration testing: do the components agree?
  - Evaluations: does an AI feature inside the product behave well enough?
- The biggest risk: when an AI writes the spec, the code and the tests, all three can agree with one another and still miss the real requirement. Expected results must be checked **against the business requirement**. Agreement between two agents is not proof.

**First map against the current workflow (unverified; check it):**

| Document's point | What seems to exist already | Possible gap |
|---|---|---|
| Consistent discipline: understand → define success → small change → verify → review/record | Readiness → execute → review → accept (`procedures/`). Checkpoints and durable records. | Looks covered, and in stricter form. |
| Choose the technique by uncertainty, consequences, complexity and lifetime | Readiness sets the *level of detail* required. `templates/design.md` is mandatory for money, stock, security boundaries, sync, shared contracts and irreversible data operations. `procedures/execute.md` lists check *types* to "choose applicable". | **No explicit technique-selection step.** Nothing asks "which technique suits this task, and why". `templates/task.md` has a free-text "Approach" section. Would a short selection guide plus an `approach`/`technique` field help, or would it only add paperwork? |
| Prototyping when the experience is uncertain; prototype code isn't production | POLICY § Discovery allows "explicitly labelled prototypes". POLICY requires prototypes to be kept distinct from approved requirements. Bounded spikes cover feasibility. | Mostly covered. Is there a clear route from **prototype → approved requirement → production task**? |
| BDD: agree concrete examples with the requirement owner first | Feature readiness requires acceptance examples. Stable acceptance IDs (`AC-…`). Tests map to IDs. Owner acceptance tests scenarios. | Largely covered in substance. Should the Given/When/Then format be recommended for acceptance examples? |
| TDD done properly: red → green → refactor, and "writing tests after" is not TDD | No mention of test-first. Tests are required, but *when* they are written isn't specified. | **Possible gap.** Should test-first be *preferred* for clear rule/calculation logic, with evidence of the observed failing run recorded in the checkpoint? The owner already has a `tdd` skill installed. Check whether it fits the toolbox process. |
| DDD for complex business domains, but only as much as complexity justifies | Design records cover ownership and lifecycle. Feature readiness includes "ownership/lifecycle". | Probably enough. Possibly guidance on when a domain model or glossary is warranted (there's also a `domain-modeling` skill installed). |
| Interfaces first, plus contract and integration tests between components | POLICY: agree shared contracts before work diverges. Approved contracts can satisfy dependencies. Design records are mandatory for shared contracts. | Contracts are covered. Is **contract testing** (such as consumer-driven tests) named as a check type? |
| Bug fixes: reproduce → regression test → scoped fix → verify the original symptom | POLICY and readiness accept a documented failing baseline for a bug fix. Regression tests appear among the check types. | Is there a **lighter bug-fix lane** that doesn't demand full feature-level readiness? Is "reproduce first, then confirm the original symptom is gone" required? |
| High-consequence work: test what must never happen; property-based testing; explicit access-control expectations | Check types cover permissions, data exposure, failure/retry/recovery. Design records are mandatory for security/money/irreversible data work. | Possibly add **negative / "must never happen" examples** to acceptance examples, and name property-based testing as an option. |
| AI features inside the product (chatbots) need evals, not just tests | Not covered. | **Real gap for the owner's projects** (e.g. the Al Nahwi WhatsApp assistant). Should the profile/readiness recognise "the product contains model behaviour" and require an eval set with quality criteria? |
| Report passed / failed / not tested; never turn "not tested" into "probably works" | POLICY: use "not verified" when evidence is unavailable. Limitations in the acceptance package. Unavailable required checks block acceptance. | Looks covered. |
| Don't weaken or remove tests just to get a pass; test changes need a stated, reviewed reason | POLICY § *Rules for test changes*, `procedures/review.md`. Validator coverage comparison. | Covered, and in strong form. |
| Check expected results against the business requirement, not the generated code | Independent review checks "whether tests still represent approved behaviour". Acceptance examples come from approved requirements, not code. | Mostly covered. Check whether tests *authored by the implementer* are compared against owner-approved examples, or only mapped to their IDs. |
| Keep main instructions short, with pointers to detail | `AGENTS.md` is short and points to procedures. | Covered. |
| Adjust the process by defects, rework, review effort and total cost | POLICY § maintenance: judge by recurrence, severity, wasted effort, observed benefit. | Covered. |

**Questions for the evaluator:**
1. Has the workflow already adopted the *substance* of this document without naming the techniques? If so, is naming them (a short technique-selection table in a procedure) worth the extra text?
2. Which gaps are real and worth closing? Candidates: a technique-selection step, test-first preference with evidence, a bug-fix lane, negative examples, evals for AI features, contract testing as a named check.
3. Would any addition make simple tasks heavier? The document itself warns against demanding a long planning phase for small, obvious changes.
4. Could the café example (Bun Alkaif) or the Al Nahwi assistant serve as a representative fixture or pilot for whatever is adopted?

**Expected output:** a verdict per gap (adopt / already covered / reject), and for anything adopted, the smallest change to procedures, templates or fixtures.

---

## Themes across the ideas (note-taker's observation, for the evaluator to confirm or discard)

1. **Self-verification by running the app** (IDEA-02, A10, A11). This is the one change the owner explicitly asked for. It is probably the highest-value item, and the harness credential limit needs a practical workaround.
2. **A sharper task brief** (A2, A8, B2, B3, B5): explicit do-not / out-of-bounds, files to read, "list assumptions first", "present options instead of guessing". These could be small additions to `templates/task.md` and `procedures/execute.md`.
3. **Tooling and model choices** (IDEA-01, A10, B4): vet external tools through the existing toolbox process. Recommend models only if usage data justifies it.
4. **Technique selection** (IDEA-05, overlapping A2/A6/A11 and B5/B7): mostly present in substance. The likely real gaps are a test-first preference, a lighter bug-fix lane, negative examples, and evals for AI features in the product.
5. **Much of the videos' advice already exists here in stricter form** (readiness gates, independent review, stop conditions, durable records). Don't add rules that repeat what the workflow already enforces.
