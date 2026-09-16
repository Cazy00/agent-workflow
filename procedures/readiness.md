# Discover and assess readiness

Read the profile, current governing baseline, feature sources, milestone and task. Fetch the configured authoritative branch through the verified worker route; record its full commit hash. A merge base, stale local ref, newer timestamp, or branch named main does not establish authority. Validate the current owner approval receipt for that exact baseline.

Assess three levels. Project readiness needs users/outcomes, scope/exclusions, journeys/data, constraints/risks/owners and verification/delivery approach. Feature readiness needs acceptance examples, business rules/permissions, ownership/lifecycle, interface states, failure/retry/conflict/recovery, dependencies/contracts and verification. Use `templates/design.md` for shared contracts, synchronisation, money, stock, security boundaries, irreversible data operations and consequential cross-component changes. Reuse adequate existing designs.

For the task, record objective, scope, milestone, owner, governing and acceptance IDs, prerequisites, reserved decisions, permitted assumptions, branch/start revision, governing baseline, baseline results, verification/review plans, blockers and next action. Use the highest applicable stage from actual work and baseline records. Removing candidate fields cannot defer a gate. A documented failing bug-fix baseline is valid; identify existing failures and regressions separately. Approved contracts can satisfy dependencies without waiting for the whole upstream task.

Run `wf readiness` with explicit baseline and task. A complete Draft may be assessed before promotion. Ready permits promotion and eligible implementation. A bounded subset permits only its stated paths. Needs discovery or resolution identifies affected work and missing prerequisites. A Blocked status must be cleared with an explanation once its actual blocker is resolved; rerun the gate. Done is task completion, not milestone acceptance or release.

Handle missing information by type: read existing sources; research factual questions and preserve evidence; ask the named owner for reserved choices; run only authorised bounded feasibility spikes; choose delegated reversible details; defer later-stage inputs with their required stage. Waiting is never approval. Continue unrelated eligible work.

Reassess after governing requirements, dependencies, assumptions or scope change. The validator catches source changes and structured dependencies; a coordinator and reviewer still assess semantic completeness, risk classification and the quality of readiness evidence.
