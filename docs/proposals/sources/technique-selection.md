<!-- Owner-supplied source material for IDEA-05 in ../ideas-backlog.md. Recorded verbatim on 2026-09-19. Not approved policy; no authority. -->

# AI-Assisted Software Development: Which Techniques to Use and When

## Core recommendation

**Software design and development techniques still matter when AI writes the code—but an AI should not follow one technique for every project.**

> Use a consistent development workflow, but select the design and testing techniques according to the particular task, its uncertainty, and the consequences of getting it wrong.

The choice can change between features within the same application, not just between different projects.

## 1. These techniques are not all competing alternatives

Approaches such as specification-driven development, Behavior-Driven Development (BDD), Test-Driven Development (TDD), and Domain-Driven Design (DDD) operate at different levels.

**Specifications and BDD** help answer: “What should this software actually do?” BDD focuses on agreeing on concrete examples with the people who understand the requirements. **TDD** helps answer: “How do we implement that behaviour in small, checked steps?” These can work together. See [Cucumber: Behavior-Driven Development][bdd] and [Martin Fowler: Test-Driven Development][tdd].

**DDD** addresses a different question: “How should we organise the business concepts, rules, and boundaries?” It becomes particularly relevant when the business itself is complicated. See [Microsoft: Domain analysis][domain-analysis].

**Prototyping and user-centred design** help answer: “Are we building the right experience in the first place?” A prototype lets you explore an idea before committing to production-quality implementation. See [GOV.UK: Making prototypes][prototypes].

So asking **“Should we use TDD or DDD?”** is usually the wrong comparison. A project might use a prototype to discover the experience, BDD to clarify its behaviour, DDD to organise its business rules, and TDD to implement those rules.

## 2. What changes when AI writes the software?

The emphasis should be on **clear expectations, usable feedback, and evidence that the result works**—not on producing more process documents.

This is consistent with coding-agent guidance: Anthropic emphasises giving the agent executable checks and using planning where the task warrants it. OpenAI’s account of agent-led development similarly describes engineering work shifting toward defining intent, preparing the environment, and building feedback loops. See [Claude Code: Best practices][claude-best-practices] and [OpenAI: Harness engineering][harness-engineering].

The important distinction is:

> AI can write the implementation. It can also help write the specification and tests. But those three things agreeing with each other does not automatically mean they match what you actually needed.

That is why “let the AI build it” should not mean “let the AI decide every requirement, implement its interpretation, and approve its own result without further checks.”

## 3. Which approach should be used, and when?

The following is a practical selection guide, not a set of rigid rules or a claim that one approach is universally best.

| Situation | Suggested approach | Reason |
|---|---|---|
| You are exploring an idea or are unsure about the user experience. | **Prototyping + user feedback**, with a short brief. | Learn what is useful before investing heavily in implementation. Do not assume prototype code is ready for production. [Source][prototypes] |
| The required behaviour is clear: calculations, validation, or eligibility rules. | **TDD**, using agreed examples and edge cases. | There is a concrete result to test, so the tests can guide implementation and subsequent refactoring. [Source][tdd] |
| The business requirement has several possible interpretations. | **BDD or acceptance-test-first collaboration**, followed by implementation. | Settle what the feature should do before making an agent encode one interpretation. [Source][bdd] |
| There are many interacting business concepts and complicated rules. | **DDD**, combined with specifications and tests. | Give those concepts clear boundaries and responsibilities. Elaborate DDD patterns are not necessary for simple record-management features. [Source][ddd-patterns] |
| Several applications or components must communicate. | **Define interfaces early + contract and integration testing.** | Check that the components agree on requests, responses, and messages—not merely that each works in isolation. [Source][pact] |
| You are fixing a bug in an existing application. | **Reproduce the failure, add a regression test where practical, make a scoped fix, and verify the original symptom.** | You need diagnosis and evidence of repair, not necessarily a full new-feature specification process. GitHub’s Spec Kit separates these workflows. [Source][spec-kit] |
| Incorrect results could damage data, bypass permissions, or break important operations. | **Explicit correctness rules + stronger failure testing and security verification.** | Test what must never happen, not only the normal successful path. Property-based testing can explore many inputs; security checks need explicit access-control expectations. [Property-based testing reference][hypothesis] |
| The application itself contains an AI feature, such as a chatbot. | **Task-specific evaluations alongside normal software tests.** | The surrounding code needs conventional tests, while variable model outputs need evaluation against representative cases and quality criteria. This is separate from merely using AI to write code. [Source][evals] |

**A small project is not automatically low-risk.** For example, a ten-line script that deletes customer records may need stronger safeguards than a large website that only displays public information.

Choose the process according to **uncertainty, failure consequences, complexity, and expected lifetime**—not just the number of files.

## 4. A default workflow for an AI coding agent

For normal production development, use:

**Understand → define success → implement a small change → verify → review and record.**

### A. Understand the existing system before editing it

Have the agent inspect the relevant code, existing tests, constraints, and established patterns.

For a substantial feature, ask it to identify important unanswered questions. For a typo or a straightforward visual adjustment, do not demand a lengthy planning phase. Anthropic’s guidance makes this distinction: planning is useful for uncertainty and larger changes, but adds unnecessary overhead to obvious, small fixes. See [Claude Code: Best practices][claude-best-practices].

### B. Write a small, usable specification

Define the expected behaviour, important examples, constraints, and what is outside the task.

For example, rather than:

> Implement loyalty points.

Use a brief that exposes the decisions that need to be settled:

> Award points only after a payment is confirmed. Define which amount earns points, how rounding works, and what happens after a refund.

These are illustrative questions and rules—not proposed final requirements for every loyalty system.

**Specification-driven does not have to mean designing the whole application upfront.** A practical approach is to specify the next meaningful feature, implement it, learn from it, and update the relevant specification. GitHub’s Spec Kit similarly distinguishes project-level principles from its repeated per-feature specification and implementation process. See [GitHub: Spec Kit][spec-kit].

### C. Choose the checks, then implement incrementally

For well-defined logic, have the agent use actual TDD:

**Write a test → run it and observe the expected failure → implement the behaviour → run the test → refactor while keeping it passing.**

Writing an entire feature and then generating tests is **not the same process as TDD**, even though those tests may still be valuable. Refactoring is also part of TDD, not an optional afterthought. See [Martin Fowler: Test-Driven Development][tdd].

For a visual experiment, start with a prototype and direct interaction. For an integration, include checks against the relevant interface and running components.

**The check should match the thing being changed.**

### D. Verify the running behaviour—not just the code

Require the agent to show what it actually checked: test results, a successful build, an exercised user journey, or another relevant result.

For a web feature, passing isolated tests is not enough evidence that the complete feature works. In its long-running-agent experiments, Anthropic observed cases where agents performed limited testing but missed end-to-end failures; explicit browser-based verification helped address that gap. See [Anthropic: Effective harnesses for long-running agents][long-running-agents].

The reporting requirement should be:

> Report what passed, what failed, and what could not be tested. Do not turn “not tested” into “probably works.”

### E. Review the change and preserve the important decisions

For important work, use a separate review to check both the requirements and the implementation. For changes involving permissions, money, destructive operations, or production data, retain an appropriate human approval step.

Keep the relevant requirements and decisions in the repository—not only inside a long conversation. Keep the main agent instructions short, with pointers to more detailed documents when needed. This is the approach OpenAI describes after finding that one enormous instruction file was difficult to maintain and use effectively. See [OpenAI: Harness engineering][harness-engineering].

## 5. The biggest trap: the AI’s tests can confirm the AI’s mistake

Consider this hypothetical situation.

The business requirement is:

> Customers earn points after successful payment.

The AI implements:

> Customers earn points when an order is created.

Then it writes a test confirming that creating an order awards points.

**The code works as implemented. The test passes. The business requirement is still wrong.**

That is a logical problem, not something that disappears by adding more tests based on the same misunderstanding.

For that reason, review important examples and expected results **against the business requirement**, rather than deriving every expectation from the generated implementation.

Also prohibit weakening or removing checks merely to achieve a passing result. Legitimate requirement changes can require test changes—but the reason should be explicit and reviewed. Anthropic’s agent experiments similarly used safeguards against agents removing or rewriting feature checks. See [Anthropic: Effective harnesses for long-running agents][long-running-agents].

A second AI reviewer can help challenge the work, but **agreement between two agents is not proof**.

## 6. Example: applying the techniques to a café platform

For a café platform such as **Bun Alkaif**, do not tell the agent:

> This whole project uses TDD, so use exactly the same process everywhere.

Instead, make different choices within the project. The following are proposed development choices, not claims about an existing implementation.

| Part of the platform | Suggested approach |
|---|---|
| **Menu browsing and ordering experience** | Prototype the interactions, try them with users, then add appropriate browser and behavioural checks. |
| **Loyalty, discounts, and order calculations** | Agree on business examples, then use TDD for the rules and boundary cases. |
| **Orders, payments, inventory, and loyalty responsibilities** | Use DDD principles to clarify ownership and boundaries, without automatically introducing every DDD pattern. |
| **Payment integration and offline synchronisation** | Define the relevant contracts and state changes, then test retries, interruptions, duplicate events, and recovery. |

For example, an acceptance rule worth agreeing on could be:

> **Given** a payment has already resulted in a loyalty award,  
> **when** the same payment confirmation arrives again,  
> **then** the customer must not receive a second award.

That one feature could involve **BDD** to agree on the rule, **DDD** to decide which component owns the award, **TDD** to implement the duplicate-handling logic, and **integration tests** to exercise the actual notification path.

**That is several techniques working together on one feature—not a competition to select one winner.**

## 7. Recommended policy

For an AI doing most of the development, standardise this policy:

> Use lightweight specifications and small, verifiable changes as the foundation. Prefer TDD for clear behavioural logic. Use prototyping where the right experience is uncertain. Add DDD where business complexity justifies it, and strengthen integration, security, and failure testing where the consequences demand it.

Adjust the process based on **defects, rework, review effort, and total development cost**, not the amount of code or documentation the agent produces.

**Keep the discipline consistent. Adapt the technique to the problem.**

## References

- [Cucumber: Behavior-Driven Development][bdd]
- [Martin Fowler: Test-Driven Development][tdd]
- [Microsoft: Domain analysis for microservices][domain-analysis]
- [Microsoft: Designing a DDD-oriented microservice][ddd-patterns]
- [GOV.UK Service Manual: Making prototypes][prototypes]
- [Claude Code: Best practices][claude-best-practices]
- [OpenAI: Harness engineering][harness-engineering]
- [Anthropic: Effective harnesses for long-running agents][long-running-agents]
- [GitHub: Spec Kit][spec-kit]
- [Pact documentation: Contract testing][pact]
- [Hypothesis documentation: Property-based testing][hypothesis]
- [OpenAI: Evaluation best practices][evals]

[bdd]: https://cucumber.io/docs/bdd/
[tdd]: https://martinfowler.com/bliki/TestDrivenDevelopment.html
[domain-analysis]: https://learn.microsoft.com/en-us/azure/architecture/microservices/model/domain-analysis
[ddd-patterns]: https://learn.microsoft.com/en-us/dotnet/architecture/microservices/microservice-ddd-cqrs-patterns/ddd-oriented-microservice
[prototypes]: https://www.gov.uk/service-manual/design/making-prototypes
[claude-best-practices]: https://code.claude.com/docs/en/best-practices
[harness-engineering]: https://openai.com/index/harness-engineering/
[long-running-agents]: https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents
[spec-kit]: https://github.com/github/spec-kit
[pact]: https://docs.pact.io/
[hypothesis]: https://hypothesis.readthedocs.io/en/latest/
[evals]: https://developers.openai.com/api/docs/guides/evaluation-best-practices
