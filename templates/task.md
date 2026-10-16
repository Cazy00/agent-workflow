---
record: task
id: T-0000
title:
client_title:
status: Draft
owner:
objective:
milestone:
found_from:
feature:
acceptance: []
feature_readiness:
risks: []
design:
verification:
review:
accepted_findings: []
scope: []
governing: [PROFILE]
prerequisites: []
decisions: []
assumptions: []
deferred_inputs: []
subset: []
branch:
start_revision:
governing_baseline_revision:
baseline_revision:
baseline_result:
resume_condition:
implemented:
verified:
accepted:
released:
---
# T-0000 — title

## Objective and scope
Optional exclusions / behaviour to preserve. Keep permitted change paths in `scope`; prose does not expand them. A found task (one its milestone's `tasks:` omits) names in `found_from` the review finding (`R-0073/F1`) or `trial` it fixes.

## Governing requirements and acceptance examples
Optional references / starting read paths, with relevant versions. Distinguish approved requirements from reference material. Read paths guide discovery; they do not restrict relevant inspection or grant permission to edit.

## Prerequisites, decisions, assumptions, deferred inputs

## Approach (implementation and verification)
Link existing run/check commands. When the choice matters, briefly explain the approach: prefer test-first for clear rules/calculations; use prototypes for uncertain experiences, contract checks for interfaces, and negative examples for consequential behaviour. When using TDD, observe the intended failing test, implement the behaviour, then refactor as needed while checks pass; preserve meaningful red/green evidence. A setup error is not the intended failing test. Use only the techniques the task needs, within existing authority.

## Baseline results and known failures

## Handoffs
Post checkpoints, evidence and handoffs on the task's pull request (or its issue before one exists), not here. Update this record only with stable facts future work needs, such as a changed blocker or resume condition.

## Review, acceptance, integration, release
List each review finding accepted rather than fixed in `accepted_findings` as `R-0030/N1`; the milestone's acceptance lists them for the owner.
