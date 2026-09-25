---
record: profile
project:
workflow_version: UNRELEASED
approval_mechanism: manual-signed-receipts
approval_label: manual
coordinator:
measure:
readiness: Needs discovery
required_checks: []
permitted_assumptions: []
setup_budget_days: 2
---
# Project profile

## Purpose
Users, problems, desired outcomes, measures of success. One measure: the single sentence a non-technical person can check to know the project is working, with the command or observation that checks it; also recorded in `measure:` above and shown first by `wf status`.

## Owner's words
Verbatim, dated quotations from the owner that shaped this profile, each with what it settled. Quotations are input; approval still comes through the approval route.

## Scope
Included work, exclusions, delivery priorities, constraints.

## Starting position
Existing software, integrations, prototypes, known limitations.

## Product expectations
Important journeys, visual direction, accessibility, languages, target devices.

## Technical context
Confirmed architecture, environments, dependencies, data, unresolved technical choices.

## Authority
Governing sources · decision owners · delegated choices · reserved decisions · permitted assumptions · authority by lifecycle stage (deployment, incidents, maintenance, upgrades) where it differs from the defaults in `procedures/operate.md`.

## Delivery
Verification commands · review and approval arrangement · deployment ownership · operational responsibilities.

## Quality expectations
| Expectation | Acceptance condition | Evidence method | Responsible role | Required stage |
|---|---|---|---|---|

If model behaviour affects the product, define representative evaluation cases, success criteria, unacceptable outcomes and model/prompt/tool configuration and version evidence alongside normal software checks, using the same evidence/role/stage arrangement. An unacceptable outcome is not offset by aggregate success; results apply only to the recorded configuration, and affected checks must be repeated after changes.

## Operations
Monitoring, recovery, migrations, support, device provisioning and updates; mark not applicable with reasons. Environments and who deploys to each; the production route (owner action or automatic from the trusted branch); rollback authority; incident contacts and the hotfix review window; the maintenance milestone and its limits (`procedures/operate.md`).

## Execution
Tools and versions, actual owner/worker GitHub usernames, separate clones, author/transport/API routes, assisted mode, time/usage/retry/spending limits and cumulative accounting. Delegation: the harness feature used for review and verification delegates (Claude Code, Codex or Cursor subagents, or fresh sessions), its version, and any model or tool limits.

For app verification: startup commands, test URL/environment, supported authentication flow, account roles, secret-store references, permitted test effects, and test-data setup/reset instructions. Use dedicated test accounts and isolated test data in non-production environments or explicitly authorised test tenants. Owner-supplied test accounts are suitable when their permissions and environment fit the test; app-admin roles may be used when required by the journey. Never use the owner's personal or repository-owner account, or accounts with workflow-approval privileges or real production data. Store references only, never credential/session values; keep secrets and tokens out of recorded evidence.

## Workflow configuration
Adopted version and revision · project settings · approved deviations · setup budget · optional tooling.

For central reporting, record the owner-directed destination `Cazy00/agent-workflow`, public fixed-catalog data categories (including worker activity/timing), expected worker and actual tested issue route, approved tool versions, external operations configuration and private runtime directory. Store references, never tokens. State whether central issues replace local feedback bodies; handoffs retain UUID/URL references. Identify the authorised collector, actual test reporter, cost limits and optional feedback cadence. See `procedures/operations.md`.

## Unknowns
