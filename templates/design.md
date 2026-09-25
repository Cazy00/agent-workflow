# Design / feature readiness — DES-0000

Status: Draft / Approved / Superseded
Governing requirements and acceptance IDs:
Decision owner and approval evidence:
Supersedes / superseded by:

## Behaviour and examples

## Business rules, permissions and security boundaries

## Data ownership, lifecycle and invariants
Each invariant (what must always or never hold: balances reconcile, stock never negative, no cross-tenant read) gets an acceptance ID with method `automated`, listed in the milestone and the implementing task, and a test that tries to break it (property-based where the stack supports it), or a recorded reason none is possible; `wf ci` fails a task that claims the ID without a mapped test.

## Interfaces, shared contracts and important UI states

## Failure, retry, conflict, concurrency and recovery

## Dependencies, alternatives and decision rationale

## Verification and acceptance evidence
If model behaviour affects the product, define representative evaluation cases, success criteria, unacceptable outcomes and model/prompt/tool configuration and version evidence alongside normal software checks; link the profile's applicable evidence, role and required stage. An unacceptable outcome is not offset by aggregate success; results apply only to the recorded configuration, and affected checks must be repeated after changes.

## Risks, delegated assumptions and unresolved decisions
Record required-before stages. Unknowns block only affected work.
