# Workflow ideas — Codex and Fable conclusion

**Status:** settled recommendation, not adoption. **Date:** 2026-09-21. **Task:** [T-0002](../workflow/tasks/T-0002.md).

The owner requested a short discussion with Fable 5.1 at high effort. After authentication was restored, two successful Claude Code calls used `claude-fable-5-1`; the CLI invocation specified `--effort high`, and both result objects report that exact reviewer model. The first response took 53.6 seconds; the follow-up took 27.2 seconds. Fable initially received canonical sources and the original unevaluated backlog without Codex's assessment or conversation. The follow-up challenged specific disagreements and supplied additional evidence.

## Include in the implementation package

| Addition | Concrete scope | Why include it |
|---|---|---|
| **Run and inspect the changed app journey** | Clarify `procedures/execute.md`: run UI-affecting work, exercise the relevant journey, inspect rendering, fix in-scope defects, and repeat affected checks within existing limits. Record revision/environment/results through existing checkpoint evidence. Add startup/test-environment/test-data instructions and secret-store references to `templates/profile.md`. | The workflow already permits self-testing, but agents need practical access and a clear expectation to perform it. This strengthens implementer evidence while preserving review, integration verification, and owner acceptance. |
| **Sharper task context** | Add optional prose for references/starting read paths and exclusions/behavior to preserve in `templates/task.md`. Reuse `scope`, existing command references, and the Evidence field. | Reduces avoidable discovery and accidental scope expansion without a new form, competing allowlist, or validator field. |
| **Testing appropriate to the task** | Add a few optional examples in existing Approach/execution guidance: test-first for clear rules, prototypes for uncertain experiences, contract checks for interfaces, negative examples for consequential behavior. Add a compact bug recipe: reproduce or preserve evidence → regression check where practical → scoped fix → recheck the original symptom. | Makes existing verification requirements actionable. No mandatory technique-selection step, standalone procedure, universal TDD mandate, or weaker bug-fix approval lane. |
| **Product-AI evaluation expectation** | Add one conditional sentence to profile/design verification guidance: when model behavior affects the product, define representative cases, success criteria, unacceptable outcomes, and configuration/version evidence alongside normal software checks. | Covers behavior conventional code tests alone cannot establish. Datasets, scoring, tooling, and thresholds remain project-specific and are piloted on an authorised feature. No new readiness gate engine. |

For UI testing, use dedicated test accounts with the app roles required by the journey, including admin where necessary. Use non-production environments or explicitly isolated test tenants/data. Credentials supplied by the owner are suitable only when their permissions and environment fit the test; they must not expose repository-owner or workflow-approval authority. Store references, not secrets, in the profile and keep secrets/tokens out of screenshots and traces. Do not add an authentication bypass by default. Follow the actual browser tool's supported authentication route.

## Defer or pass

| Decision | Items | Reason |
|---|---|---|
| **Pass on for this package** | Full ECC installation; copied common rule packs/hooks; automatic merging or learned-rule adoption | No demonstrated incremental benefit here, substantial inspection/maintenance burden, and defaults that do not fit our authority and risk-based checks. ECC can remain reference material. |
| **Defer until a concrete task needs them** | Individual adapted ECC assets, installed TDD/domain-modeling skill adoption, model routing, stack-specific MCP bundles, an extra test designer | Select, vet, pin, and trial the smallest useful tool when there is a real need. No automatic toolbox registration. A separate test designer is an option for consequential work, not a standing team member. |
| **Do not add** | Universal TDD/coverage quotas; a new `technique` or `out_of_bounds` schema field; a separate techniques document; compulsory prompt rewriting; routine approval for every reversible detail; blanket dependency bans; unconditional rollback | These duplicate current mechanisms, overconstrain delegated work, or create process cost without established benefit. Dependency choices still follow project policy, task scope, and consequential-decision rules. |

## What changed through discussion

Codex accepted Fable's pressure to reduce paperwork: the initial standalone technique-guide proposal is replaced by brief examples within existing guidance. Fable withdrew the blanket dependency prohibition, the new exclusion field, and the unconditional bug-test requirement. After reading the complete supplied technique document, it corrected its initial acceptance of excluding refactoring from TDD and agreed to the conditional product-AI sentence.

Both agree that a domain glossary can coexist with the workflow when canonical records designate or link it; it is not inherently a competing decision system. Neither installed skill is adopted by this assessment.

Fable suggested an “adopted” backlog label for a partial recommendation. Codex did not apply that label: expert agreement supplies a recommendation, not evidence of implementation, owner approval, release, or adoption. The backlog remains **Needs owner decision**, with the evaluation complete.

## Evidence and limits

The [initial response](../audit/fable-ideas-2026-09-21/round1-retry.json) and [follow-up](../audit/fable-ideas-2026-09-21/round2.json), plus their prompts and [invocation record](../audit/fable-ideas-2026-09-21/invocation.json), preserve the discussion. Fable explicitly did not inspect the supplied ECC excerpts; its ECC agreement relies on Codex's [pinned source assessment](../audit/ecc-source-review-2026-09-21.md). This is therefore not a second independent ECC audit. Browser constraints similarly rely on the documented sources in the [earlier evaluation](ideas-evaluation-2026-09-21.md).

The successful calls report API list-cost estimates of USD 0.87462625 and USD 0.34759250, including a small auxiliary harness-model call in the first result; these are not a statement of actual subscription charges. No permission denials occurred. No workflow implementation or installed-tool changes were made, so the unchanged validator suite was not rerun after this discussion. The earlier evaluation's 95-test result remains evidence for that unchanged code only.

**Next action:** prepare only the four selected additions as a reviewable implementation if authorised. Preserve existing safeguards and validate representative behavior. Independent review of that implementation, owner approval, a versioned release, and explicit adoption remain separate from this design discussion.

**Session outcome:** progress — requested consultation completed and recommendation settled. Workflow friction this session: none; the earlier authentication blocker was resolved.
