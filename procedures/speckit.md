# Spec Kit planning adapter

Experimental and opt-in. Source protection, package inventories and experimental installation checks exist. The planning flow and pilots remain incomplete; all feature command entries stop explicitly. `integrations/speckit/compatibility.json` records the intended upstream pin and certification state. An API number is not approval, installation proof or a successful pilot. Existing projects keep their current workflow and approval mode.

## Sources and protected configuration

After independent review and owner approval, an adopting project's protected configuration can add:

```json
"planning_frontend": {"name": "speckit", "compatibility_api": 1, "feature_root": "docs/specs"}
```

Omission or `null` keeps existing behavior. Other names, roots, API versions or options fail closed. The opt-in adds enforcement protection for `.specify/**`, `.agents/**`, `.claude/**`, `.codex/**`, `adapters/**`, `integrations/speckit/**`, `docs/workflow/speckit.lock.json` and `.gitignore`. It grants no execution or approval authority. CI reads baseline configuration; a candidate cannot disable these controls for its own changes.

Keep requirements at `docs/specs/<feature>/spec.md`, design at `docs/specs/<feature>/plan.md`, and durable contracts alongside them. That root is governing, subject to existing classification precedence. Executable contracts retain production gates; initially use Markdown, JSON or YAML for governing contracts. Importing another root needs a reviewed contract/configuration change before use. The adapter does not migrate or approve it.

Native task records remain the only ledger. Group steps into coherent reviewable outcomes, retaining required tests and independent review. The future ignored `docs/specs/<feature>/tasks.md` projection cannot supply completion, readiness or scope. The constitution entry points to adopted policy/profile without amending either. All reserved choices, including more than three unresolved choices, remain native decisions.

## Readiness and delivery

Use `readiness.md` and its existing dependency closure: name the specification, design and relevant contract paths in native records. A directory dependency includes additions and removals. A relevant source change stales readiness; unrelated feature work alone does not. Classification does not replace declaring governing dependencies.

Delivery follows the integration plan: source contract → verified reversible installation → native Draft writer/projection → complete commands and fresh Codex/Claude pilot (G1). Only a successful G1 permits GitHub provider investment. The classifier grants no installation or readiness authority. Adapter-enabled CI rejects tracked projections, temporary research/checklists and runtime selectors at the complete Git candidate; a directory diagnostic cannot establish tracked-file exclusion.

Follow `review.md` and `accept-release.md`. Do not install into a consumer yet. Adoption needs a protected pin/configuration change and a bounded non-production pilot; preserve the previous pin and unknown/custom files. Upgrades need the exact source/package inventory, affected tests, rematerialization checks for both integrations and a discovery trial; see `maintenance.md`. Never silently change an active milestone's rules.

## Installation experiment

The preset and hook-free extension are pinned to Spec Kit v1.0.12. Their commands deliberately stop; they cannot yet plan or implement a feature. `adapters/speckit/staging.mjs` exports `stageInstallation` for a fresh absent scratch directory, using a clean committed adapter and an isolated Python environment. It verifies the package inventory and dependency versions, stages both Codex and Claude, and records every managed path. Its experimental lock records exact candidate revisions, not a certified release. It never writes to a consumer.

Build the exact upstream revision from the compatibility manifest in a disposable checkout. Resolve nothing during installation: install `integrations/speckit/python-requirements.lock` with hash checking in an isolated Python 3.11+ environment, build using that environment's `python -m hatchling build -t wheel`, verify the wheel against `distribution_sha256`, then install that wheel with `--no-deps`. The lock includes runtime and build dependencies. Preserve upstream attribution. Runtime checks inspect Spec Kit file contents and dependency versions, not the entire host or dependency-package bytes; the isolated environment must remain trusted and outside candidate control.

`node adapters/speckit.mjs check-install --repo STAGE --integration codex --lock LOCK --python ISOLATED_PYTHON` returns JSON, with exit 0 for intact local content, 1 for unsupported/mismatched content, 2 for invalid input/execution. Success is explicitly uncertified and supplies no workflow authority. Both inactive and active entries are checked. Upstream switching also changes shared instruction/script bytes; the lock admits only the exact Codex/Claude variants collected during staging, never arbitrary changes.

`applyStagedInstallation` is a library helper for a reviewed staged diff: it refuses collisions before writes, preserves unrelated files, and creates missing files only. The stage holds the intended bytes. After interruption, inspect the target and rerun only with that same stage; identical files are retained, conflicting files stop recovery. Do not delete user files, overwrite existing installations, or treat this helper as an upgrade/approval tool. Consumer scaffold integration and supported upgrade handling remain unimplemented.

Ordinary `npm test` uses synthetic fixtures without Python/network. The additional live contract lane is:

```sh
WF_SPECKIT_UPSTREAM=1 WF_SPECKIT_SOURCE=/absolute/pinned-source WF_SPECKIT_EXECUTABLE=/absolute/venv/bin/specify node --test validator/test/speckit-upstream.test.js
```

Missing live inputs fail; supplying live variables without the switch is an error. Run against a committed clean adapter candidate. A successful lane is package/materialization evidence, not a fresh-agent discovery or PrintFlow pilot.

## Experimental native planning helpers

These helpers are available for technical fixtures and a later reviewed installation. The Spec Kit feature commands still stop: command composition, scaffold support and the fresh-agent pilot remain incomplete. Do not adopt this checkpoint into PrintFlow.

All commands require an explicit repository and integration (`codex` or `claude`), matching the verified local selector, and the trusted isolated `--python`. Planning operations also require an exact `--baseline`; its protected config must opt in and its installation lock must match the working copy and core pin. The generated authority pointer binds the pinned policy and exact project profile contents. Changed profiles block until the pointer and protected lock are updated in the same reviewed governing change. This first adapter surface supports one owner; shared-owner projects stop explicitly. Draft batches also undergo native schema/profile validation before any write. The helper never supplies baseline approval or task readiness.

- `context --repo DIR --integration KEY --python PYTHON --baseline SHA --feature docs/specs/slug [--milestone M-NNNN] [--plan EXTERNAL_JSON]` returns paths, the non-persistent feature environment, source count and digest, without dumping source text. When preparing a task proposal, pass the proposed plan so its milestone, acceptance and governing dependencies enter the digest; copy that digest into the proposal's `source_digest`.
- `allocation-snapshot --repo DIR --integration KEY --python PYTHON --baseline SHA` retrieves full Git history (including unpublished local history/claim branches) and paginated live open PR heads using `WF_WORKER_TOKEN` and the baseline's separate `approval.agent_identity`. Save its JSON outside the project. Missing worker access, shallow history, incomplete pages, moved/unavailable heads or a moved baseline block creation. No owner credential fallback is attempted.
- `write-tasks --repo DIR --integration KEY --python PYTHON --baseline SHA --plan EXTERNAL_JSON --open-pulls EXTERNAL_JSON` independently retrieves live allocation again, checks the supplied snapshot (maximum age 60 seconds), rechecks source freshness and creates only new native Drafts. Proposal keys become native prerequisite IDs; internal steps stay body checklists. Existing records are never overwritten. Recheck collisions before publishing; this is assisted allocation, not a distributed lock.
- `project` and `check-projection` take `--repo`, `--integration`, `--python`, `--baseline`, `--feature` and one explicit `--task T-NNNN`. They use native sources and the core's governing dependency closure at both the baseline and working tree. Digests include source paths and distinguish baseline/working copies. They never change native task progress. The output must be ignored and untracked. A differing existing view needs explicit `project --regenerate`, which preserves a recovery copy before replacement.

Keep `/docs/specs/*/tasks.md`, `/docs/specs/*/research.md`, `/docs/specs/*/analysis.md`, `/docs/specs/*/checklists/`, `/docs/specs/*/.wf-speckit/`, `/.specify/integration.json` and `/.specify/feature.json` ignored in the reviewed installation diff. The last selector remains forbidden at runtime: commands use `SPECIFY_FEATURE_DIRECTORY` and `SPECIFY_FEATURE_NO_PERSIST=1` instead. CI rejects tracked copies; it does not infer readiness from a digest or ignore rule.

Writes serialize through `wf-speckit-operation.lock` in Git metadata and record intent before mutation. A normal error before mutation removes the lock; a failure after intent or a killed process retains it for inspection. A coordinator compares the recorded intended paths/bytes with actual state before an explicit recovery, never blindly removes a lock or replays a write. Draft batch preflight checks all targets before writing and rolls back unchanged files it created on a caught write error; process termination can still leave uncommitted partial Drafts. Automatic crash recovery is not implemented. Do not commit a partial batch or claim an interruption pilot passed. A reviewed complete batch becomes durable at its task-prefixed Git checkpoint. Projection replacement is an atomic single-file rename; recovery copies remain ignored local data.
