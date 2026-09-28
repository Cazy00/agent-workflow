# Spec Kit integration implementation plan

> **For agentic workers:** Follow this repository's `AGENTS.md`, governing `POLICY.md`, and the procedure for the current action. Use this plan task by task after implementation is authorised. The writing-plans skill informed its structure; it does not grant authority or replace the workflow's review and approval rules.

**Goal:** Make Spec Kit the standard planning frontend for a small, independently usable agent-workflow core, then add a GitHub evidence provider that makes the delivery gates verifiable and the owner's next action clear.

**Architecture:** A pinned Spec Kit preset and small extension adapt planning into existing specifications, designs and native task records. A separate protected evaluator reuses the current core and consumes bounded evidence from unprivileged candidate tests and live GitHub decisions. Neither prompts nor extension hooks are enforcement boundaries.

**Tech stack:** Existing zero-dependency Node.js 22 core and Node test reporter; Spec Kit v1.0.12 at `e77daa9021d20db26b878f7dfa5640fe5a42d04e`, with its Python 3.11+ runtime and pinned dependencies; Git; GitHub Actions and one narrowly scoped GitHub App. First supported development hosts: macOS and Linux, using Spec Kit's Python script variant.

**Spec:** Design contract below — accepted direction for planning, 2026-09-27.

**Status:** Non-authoritative design proposal. On 2026-09-28 the owner expanded the earlier efficiency-only scope to implementation, with a two-hour first local adapter tranche followed by reviewed progress. The owner selected PrintFlow for their pilot. This does not approve the proposed evidence-policy amendments, privileged setup, release or consumer adoption. Implementation status and evidence belong on the maintenance PR/issue; design checkboxes are not approval evidence. See [IDEA-19](ideas-backlog.md#idea-19--spec-kit-planning-with-an-independent-agent-workflow-delivery-core).

**Source baseline:** agent-workflow v1.6.2, `5e4e75d31f7e51bc66904b538ef33a30ca0c0ad7`. Its exact baseline-approved acceptance mapping migrations already exist; reuse them rather than rebuilding that mechanism. The efficiency instructions accompanying this proposal are a local maintenance candidate until reviewed, approved and released. All other new interfaces and paths below are proposed unless explicitly described as existing. `P01`–`P10` are plan references, not allocated workflow task IDs.

## Global constraints

- `POLICY.md` governs. Reusable changes require separate-context independent review, owner approval, a released version and explicit consumer adoption.
- Preserve existing `manual` and `enforced` behavior and their honest limitations. The stricter provider is a new opt-in mode, never an implicit upgrade.
- Preserve one coordinator, one coherent native task per PR, task-prefixed checkpoints, Done in the task PR, existing records-only auto-merge treatment, and task retention rules.
- One owner, GitHub, Codex and Claude entry paths, one pinned Spec Kit version and the existing Node reporter are the initial compatibility surface.
- No Spec Kit fork, unattended runner, web service, database, dashboard, scheduler, model routing, shared-owner expansion, other forge, public marketplace launch or mass migration.
- No agent performs privileged owner setup or falls back to owner publishing credentials. Candidate code receives no owner, App, signing or deployment credential.
- Reuse the existing readiness, scope, freshness, acceptance, lifecycle and record fixtures. Introduce seams where needed; do not rewrite these evaluators.
- Run evidence, live review results, pilot measurements and session outcomes belong on task PRs/issues and external artifacts, never in this repository. Test fixtures are synthetic, deterministic inputs.
- Give the owner one consolidated decision package and one meaningful delivery PR per task. Do not add owner approvals for checklist steps, projections, refreshes or ordinary delegated task decomposition.
- Apply `procedures/execute.md` to coordination: one coordinator plus a separate-context independent reviewer by default; additional workers need bounded, separable work that justifies their cost. Run routine checks directly with compact output, reuse still-valid plans/evidence, and name the changed input, unresolved finding or required gate before repeating work. Keep all required verification layers and approved retry limits.

## Review focus

These failure modes need explicit tests, beyond the normal happy path:

1. Inactive Codex/Claude integrations retain stale materialized commands after a preset change; activation must rematerialize and verify them before use (P02/P04).
2. A user edits or checks a generated `tasks.md`, or a retired task ID disappears from the current tree; edits must not become task truth, and deleted historical IDs must not be reused (P03).
3. A specification, imported contract or enforcement script changes through an unexpected path, override, symlink or generator; classification and freshness must still apply (P01/P02/P05).
4. A successful run tests a synthetic merge, a previous attempt or a different candidate, or carries a forged result file; it must not establish evidence for the current candidate (P06/P07).
5. An owner decision is edited, deleted or superseded, or a squash merge changes the revision after acceptance; the next stage must reject stale identity or require an explicit verified artifact relationship (P08).

## 1. Decision and design contract

### 1.1 Product boundary

The owner authorises an outcome, resolves reserved choices, reviews the delivered experience and grants product acceptance/release authority. The coordinator organises eligible work, gathers technical evidence and presents only decisions requiring the owner. Spec Kit helps express the work; agent-workflow decides whether its current records and evidence permit a stage.

Keep the core usable without Spec Kit. Keep the planning adapter usable under today's controls before building the new provider. The first adapter pilot must succeed before the protected GitHub route becomes the next investment.

The tighter provider must never produce a successful verdict with required machine evidence hidden in `unverified`. It must still distinguish machine provenance, semantic review and the owner's product decision. No digest, signature, App identity or checkbox proves that a test is meaningful or that a reviewer reasoned independently.

### 1.2 One source for each kind of truth

| Material | Canonical location in an adopting project | Treatment |
|---|---|---|
| Policy and delegation | Adopted workflow `POLICY.md`; project `docs/workflow/profile.md` | Highest policy plus protected project authority; source precedence is explicit |
| Spec Kit constitution entry | `.specify/memory/constitution.md` | Generated pointer to policy/profile, with source digest; no independently editable constitution |
| Feature behavior and examples | `docs/specs/<feature>/spec.md` | One living specification; a draft remains proposed until approved on the governing baseline |
| Design | `docs/specs/<feature>/plan.md`, with necessary `data-model.md` and `contracts/` | The Spec Kit plan is the workflow design source; no copied second design record |
| Durable research conclusions | Plan or a native decision record | Preserve conclusions and necessary rationale; raw research/analysis output stays external or ignored |
| Acceptance index | `docs/workflow/acceptance.json` | Existing `{examples:[{id,requirement,method}]}`; `requirement` names the canonical spec path, and that spec contains the ID and prose |
| Automated mapping | `tests/acceptance-map.json` | Existing mapping schema and test-name identity |
| Delivery ledger | `docs/workflow/tasks/T-NNNN.md` | Only task status/scope/dependency truth; native IDs and existing front matter |
| Milestones and reserved decisions | Existing `milestones/M-NNNN.md` and `decisions/D-NNNN.md` | Existing authority and supersession rules |
| Spec Kit task view | `docs/specs/<feature>/tasks.md` | Generated, ignored, disposable local projection; never committed or imported |
| Review, evidence, acceptance package, decisions | Task/milestone GitHub PR or issue plus retained artifacts | Evidence records, not a second task ledger |
| Owner view | Existing `wf status` and pinned status issue | Derived status with provenance/limits; never a gate itself |

Native task body checklists hold stable implementation steps; a command phase or checkbox does not allocate another native task or PR. Group related steps into a reviewable outcome before milestone authorisation, assessing shared behaviour/verification and necessary dependency, risk or release boundaries. Neither a file-count threshold nor fewer task IDs proves efficient sizing. A separately authorised trial may compare a naturally coupled pair with the same accepted scope; it does not grant permission to combine unrelated changes or remove gates. Checklist marks mean working progress, not verification or acceptance. The generated view reflects canonical task status and identifies the selected task; it never imports checkbox completion, expands scope or causes the next task to start.

After merge, retain Done task records through milestone acceptance and while any task names them. Remove eligible records in one planning change. Preserve their PRs. Regeneration omits removed tasks; it does not recreate them. Never renumber surviving IDs.

### 1.3 Classification and approval precede dependent work

The current defaults already classify `docs/specs/**` as governing but do not classify native `specs/**` that way. The initial integration uses `docs/specs/<feature>` only. An existing Spec Kit project must explicitly add every imported spec/design root to governing classification and readiness sources before using it. The installer reports this diff; it cannot silently migrate or approve it.

In the adapter-enabled configuration, classify these as enforcement: the adapter lock and policy, `.specify/**` instruction/template/script/registry/preset/extension/configuration content, generated agent entry instructions under `.agents/**` and `.claude/**`, any `.codex/**` instruction configuration used, launcher files, adapter packages, and their generator inputs. Existing `AGENTS.md`/`CLAUDE.md` remain governing at minimum; any executable tool settings are enforcement. Include `.gitignore` changes controlling projection/evidence exclusions in the adapter's protected installation review.

The current precedence is enforcement → production → generated → governing → planning. A `.py`, `.js` or `.sh` contract inside a governing directory can therefore classify as production. Do not globally reverse precedence. Initially permit governing contracts as Markdown/JSON/YAML only; executable contracts require an explicit approved production scope or a narrowly reviewed classifier change. Path classification never substitutes for including the file in the task's governing dependency closure.

Ignored projections cannot be authoritative inputs. Adapter-enabled CI also rejects a tracked `tasks.md` projection, raw Spec Kit analysis/checklist/research output and a tracked feature-context runtime file. Durable examples or conclusions are moved into the canonical spec/design instead. The adapter lock enumerates these paths so the rejection is precise rather than a ban on all files with a common name.

### 1.4 Compatibility and policy changes

`manual` keeps Ed25519 receipts and existing commands. `enforced` keeps its existing baseline inference and explicit `unverified` lifecycle list. New provider mode is named **`github-verified`**, with `approval.mechanism: github-verified-evidence-v1` and matching `approval_label: github-verified` in the profile. It requires a protected, externally supplied trust configuration as well as baseline opt-in. A candidate cannot select it or fall back to legacy mode if its provider fails.

P05/P08 require focused owner approval of the new evidence policy: which protected GitHub facts establish baseline/governing approval, how an assisted review attestation is admitted, how explicit owner comments/reviews establish product acceptance/release, and what live revalidation can and cannot establish. Those amendments change no active consumer until explicit adoption. Never describe a new provider as a reinterpretation of existing signed receipts.

The workflow repository's current `release-tag.yml` treats the owner's merge of a version-bump PR as release authorisation. Preserve that existing behavior while releasing this work under current rules. A consumer using `github-verified` needs the explicit release decision defined below. Migrating this repository itself to that provider is separate, scoped adoption work; ordinary merge approval in that provider is not product acceptance or release authority.

## 2. Planning adapter

### 2.1 Distribution and installation

Keep the first-party packages in this repository:

| Proposed path | Responsibility |
|---|---|
| `integrations/speckit/preset/preset.yml` | Preset manifest, ID `agent-workflow`, exact supported upstream version |
| `integrations/speckit/preset/commands/` | Composed specify/clarify/plan; replacement constitution/tasks/implement; `unsupported.md` registered for conflicting unsupported commands |
| `integrations/speckit/preset/templates/constitution-template.md` | Generated authority pointer, not copied policy |
| `integrations/speckit/extension/extension.yml` | Extension ID `agent-workflow`; explicit adapter helper command |
| `integrations/speckit/extension/commands/speckit.agent-workflow.prepare.md` | Entry to deterministic validation/projection; grants no authority |
| `integrations/speckit/compatibility.json` | Tested API/schema versions, upstream commit and expected asset inventory |
| `integrations/speckit/python-requirements.lock` | Hash-pinned Spec Kit runtime/build dependencies for the tested distribution |
| `adapters/speckit.mjs` | Small CLI, path-safe orchestration and installation checks |
| `adapters/speckit/{installation,task-plan,projection}.mjs` | Installation proof, Draft task writer and one-way projection |
| `procedures/speckit.md` | Supported daily flow, recovery, installation and upgrade limits |

No upstream fork or bulk prompt copy. Build/install the exact upstream commit in an isolated Python environment; pin its dependency resolution and retain package/content digests. `specify version` or a bundle label alone is insufficient. Verify packaged templates, commands, scripts and integration modules against a manifest derived from that source. A package missing an advertised asset fails preflight even if its version is correct.

Use supported upstream commands in a scratch installation first: `specify init --here --non-interactive --integration codex --script py` in an empty staging directory; `specify preset add --dev <preset-dir>`; `specify extension add --dev <extension-dir>`; `specify integration install claude --script py`; `specify integration use <key>`. Test their exact syntax at the pin. Use `--force` only inside disposable staging when needed. No destructive `specify preset update` on a working project: that command removes before adding and supplies no rollback transaction.

Compare the staged installation with the target. Produce a reviewable install manifest, preserve unknown/custom files and refuse collisions. Approved installation materializes managed files and the lock in one protected change. Runtime selection of Codex versus Claude is local and ignored; both integrations' content is generated/tested during staging. Treat `.specify/integration.json` as a generated local selector: validate its installed integration set/options against the lock, permitting only the active choice to vary. Do not hash that varying field as fixed instruction content or accept arbitrary configuration from it. Upstream only refreshes the active integration, so activation must call `integration use`, check the new materialized files, and refuse a stale inactive copy. The pinned upstream changes shared templates/scripts and init metadata when the active integration changes. Stage both integrations and record exact per-integration hashes for those files; switching may select only the preapproved byte variant and needs no owner bookkeeping approval. Restore the default Codex shared bytes before a task checkpoint and verify that switching adds no tracked diff; never commit runtime switching differences. Any other content change is an enforcement diff to review. Verify inactive materialized entries too; do not exempt entire metadata or script files from integrity checks.

The installed lock is `docs/workflow/speckit.lock.json`, schema `wf-speckit-lock/v1`. Required fields:

- `upstream`: `version`, full `revision`, distribution SHA-256, dependency-lock SHA-256.
- `adapter`: released version and full repository revision; `core`: full adopted workflow revision and compatibility API `1`.
- `preset_id: agent-workflow`, `extension_id: agent-workflow`, `script: py`, `integrations: [codex, claude]`.
- `managed_files`: sorted `{path,sha256,role,integration_sha256?}` entries for actual upstream assets, registered configuration, effective templates, commands and materialized instructions; `role` is `upstream`, `adapter` or `materialized`. `sha256` names the Codex/default bytes; only files observed to vary during staging carry `integration_sha256: {codex,claude}`, and the Codex entry must equal `sha256`. Both complete inventories and their variants are reviewed together.
- `feature_root: docs/specs`, `runtime_paths`, `unsupported_commands`, and `allowed_overrides: []` initially.
- `authority`: schema `wf-speckit-authority/v1`, exact `core_revision`, `policy: {path: POLICY.md, sha256}` and `profile: {path: docs/workflow/profile.md, sha256}`. The generated pointer binds these canonical contents without copying policy or granting approval.

For normal adoption the lock records an already verified release pair; a separately authorised non-production pre-release pilot uses exact reviewed candidate revisions, a development adapter version and an explicit uncertified result; a source file does not try to contain its own future commit SHA. Missing/extra overrides, unexpected enabled presets/extensions, unknown instruction-generating configuration, altered assets and runtime version drift return unsupported integration. Do not claim to attest arbitrary user-global skills or the whole agent environment; the pilot records tool versions and tests instruction discovery in clean contexts.

### 2.2 Command contract

| Command | Behavior under the preset |
|---|---|
| `speckit.constitution` | Refresh/check the generated pointer; policy changes become native governing-change proposals |
| `speckit.specify` | Compose upstream spec work with explicit feature path, owner-decision handling, canonical IDs and ignored temporary quality checklist |
| `speckit.clarify` | Compose upstream clarification; unresolved reserved choices become native decisions, never inferred defaults |
| `speckit.plan` | Compose upstream design; reuse existing adequate plans/contracts; keep supporting output local and promote only durable conclusions |
| `speckit.tasks` | Replace native task-file writing; produce a proposed breakdown grouped into coherent native Draft tasks; retain the required tests/review work |
| `speckit.implement` | Replace whole-feature execution; require one explicit `T-NNNN`, fresh readiness and approved scope; update only native task progress; stop at its next workflow boundary |
| `speckit.agent-workflow.prepare` | Validate installation/context and render/check the selected task projection; local feedback only |
| `analyze`, `checklist`, `converge`, `taskstoissues`, workflow runner and unrelated extensions | Unsupported in the first certified flow; install a clear stop/routing entry for available conflicting commands, not the upstream whole-feature execution behavior |

Use supported `wrap`/prepend/append command composition for the first three reusable prompts and their explicit override rules. Replacement commands are intentionally small and point to the native procedures. Pin and test the composed text, including handoffs; no handoff automatically starts implementation.

Composition must address actual upstream contradictions: specification defaults cannot resolve reserved decisions or cap unresolved decisions at three; task generation cannot make required tests optional; task execution cannot tick/execute an entire generated feature list. The native `specify` prompt explicitly writes `.specify/feature.json`; script-level `SPECIFY_FEATURE_NO_PERSIST` alone does not suppress that instruction. The wrapper must explicitly disable that write, supply `SPECIFY_FEATURE_DIRECTORY` on every operation, and verify no persistent selector was created. All subsequent scripts receive `SPECIFY_FEATURE_NO_PERSIST=1`.

### 2.3 Deterministic helper interfaces

The new CLI is `node adapters/speckit.mjs <command>`. It returns JSON; exit `0` succeeds, `1` is a supported blocked/unsupported-state result, `2` is invalid input or an execution error. It never publishes, signs, merges or selects another task automatically.

| Command | Inputs and result |
|---|---|
| `check-install` | `--repo DIR --integration codex\|claude --lock FILE --python ISOLATED_PYTHON`; returns `InstallationReport {ok, integration, lock_digest, mismatches[]}` |
| `context` | `--repo DIR --integration codex\|claude --python ISOLATED_PYTHON --baseline B --feature docs/specs/<slug> [--milestone M-NNNN] [--plan EXTERNAL_JSON]`; returns `FeatureContext {baseline_revision,feature_path,spec_path,plan_path,environment}` after containment/installation checks |
| `write-tasks` | `--repo DIR --integration codex\|claude --python ISOLATED_PYTHON --baseline B --plan EXTERNAL_JSON --open-pulls EXTERNAL_JSON`; validates and atomically creates only new native Draft records; returns `{created:[{id,path}],allocation_digest}` |
| `project` | `--repo DIR --integration codex\|claude --python ISOLATED_PYTHON --baseline B --feature PATH --task T-NNNN`; writes the ignored projection atomically and returns `{path,source_digest,content_digest}` |
| `check-projection` | Same selection as `project`; recomputes source and rendered content; returns `{ok,reasons[]}`; never updates native records |

`activate --repo DIR --baseline B --integration KEY --python ISOLATED_PYTHON` verifies the current baseline-bound installation, rematerializes the requested integration and admits only its preapproved byte variants. It serializes mutation and retains an intent on failure. `propose-authority` with those same arguments returns generated pointer/metadata/lock bytes for a proposed working profile without writing the project; include them in the same reviewed governing change. It does not upgrade the core or authorize the new profile.

An additional read-only `allocation-snapshot --repo DIR --integration KEY --python ISOLATED_PYTHON --baseline B` prepares the external open-PR/ID snapshot. The writer retrieves live state independently and rejects a stale or different supplied snapshot. Every CLI operation requires the explicit integration, which must match the validated active integration in `.specify/integration.json`; missing or conflicting selection blocks. Command materialization supplies its own literal integration key. Library functions use the same nouns: `verifyInstallation({repo,lock,integration,python})`, `resolveFeatureContext({repo,baseline,feature,integration})`, `writeDraftTasks({repo,baseline,plan,openPulls,integration})`, `renderTaskProjection({sources,selectedTask,lockDigest})`, and `verifyTaskProjection({sources,selectedTask,lockDigest,bytes})`. The first two return the corresponding reports above; the writer returns the created list; render returns `{bytes,sourceDigest,contentDigest}` and verify returns `{ok,reasons}`. The CLI runs installation verification before calling the pure projection helpers. Reuse current safe-path/front-matter/record primitives.

The temporary task-plan schema is `wf-task-plan/v1`: `{feature,milestone,source_digest,tasks:[{key,title,objective,owner,scope,acceptance,governing,prerequisites,decisions,risks,steps,verification,review}]}`. Keys are local proposal references, never persisted as a second task ID. `steps` are plain strings. `prerequisites` accept `key:<local-key>`, existing `T-NNNN` or `contract:<path>`; reject cycles and missing references. Resolve local keys to newly allocated native IDs in the single write. The coordinator edits this temporary proposal until it forms reviewable tasks; the helper does not claim to determine cohesion semantically. Existing Drafts are edited directly under normal workflow rules, not overwritten from regenerated proposals.

Allocation fetches the authoritative branch through the verified worker route, requires complete history, and scans every historical native task filename plus live open PR branches/titles and task files, as well as local records/claims. An incomplete API page, unavailable PR head, stale snapshot or shallow clone blocks allocation. Choose IDs above the maximum and serialize the local write. Recheck before publication; a collision is resolved by assigning a new unused ID, never renaming someone else's task. This is assisted one-coordinator allocation, not a distributed allocator. Stop explicitly if the four-digit space is exhausted; do not silently change the schema.

The projection starts with `generated: wf-task-projection/v1`, selected native ID and SHA-256 `source_digest`. The digest covers canonical, path-sorted records plus their bytes: selected feature spec/design/contracts; all projected native tasks; relevant milestone, acceptance definitions and decisions; relevant baseline dependencies; adapter lock and rendering version. Encode structured digest input with recursively sorted object keys and ordered arrays, UTF-8 and LF. Source entries distinguish `working` and `baseline` versions of the same canonical path; neither can hide or overwrite the other in the digest. Include path names so a rename changes the digest. Hashing is a content-freshness check, not approval.

Freshness checks include uncommitted canonical edits used for local planning and re-render the expected entire file. This catches manual projection edits even when the header digest is untouched. A hand-edited projection returns `projection_modified`; preserve it as an ignored local recovery copy only on an explicit regenerate action, then regenerate from native records. Never import it. Canonical progress changes invalidate the projection; regenerate before the next command. Authoritative gates read committed native sources directly and never trust the projection or its digest.

## 3. GitHub evidence architecture

### 3.1 Identities and revision vocabulary

Use consistent identities throughout:

- `B`: freshly fetched trusted branch commit used as the governing baseline.
- `C`: exact committed candidate; for integration it is the live PR head and contains `B` as an ancestor.
- `W`: commit from which the test/evaluator workflow actually executed. Its approved workflow/dependency bytes are checked independently of `C`.
- `R`: immutable published build/artifact digest and its build provenance; not a mutable environment URL.
- `A`: SHA-256 digest of the complete acceptance package manifest and its referenced content digests.

Tests explicitly check out **C**, with credentials not persisted. Do not rely on `GITHUB_SHA` being C. A default `pull_request` checkout may test a synthetic merge; an artifact saying `revision: C` cannot change what was executed. The initial supported route is a **protected default-branch `workflow_dispatch` test workflow**, passed a PR number and request ID. A trusted preparation job resolves B/C from live API/Git, emits the request manifest and passes fixed SHAs to separate unprivileged verification and integration jobs. Integration runs after the review report is available and rechecks the same assembled C. If assembly creates a different commit, that new commit becomes C and affected verification/review repeat.

The coordinator dispatches these runs using the verified worker route; this is ordinary assisted execution, not a new owner click or a scheduler. `workflow_run` then wakes the protected evaluator. A run's default-branch `head_sha` establishes W, not the tested C; C comes from the trusted request/job configuration and is checked against checkout and reporter evidence. Runs dispatched on a tag/other branch are ineligible even if they share a workflow ID/name.

### 3.2 Trust boundaries

| Boundary | May do | Must not do |
|---|---|---|
| Local adapter/agent | Draft records, prepare evidence, request tests, show diagnostics | Approve policy, grant itself authority, publish with owner credentials |
| Trusted preparation job | Read current PR/base/config; create immutable request data using pinned code | Execute candidate scripts or accept a candidate-selected command/workflow |
| Candidate test jobs | Execute C on separate ephemeral hosted runners; install candidate dependencies; emit logs/results | Receive App/owner/deploy secrets, write source/check approvals, share writable state/caches with evaluator |
| Protected evaluator | Fetch Git objects as data; validate sources, API provenance and bounded artifacts; write the App check | Check out/run candidate files, install candidate dependencies, use candidate-selected actions, restore candidate caches, evaluate artifact text as code |
| Owner | Configure protections/App/environment, approve reserved changes, author acceptance/release decisions | Be replaced by Git authorship, agent-written fields or ordinary review state |
| Release operator/workflow | Live revalidate exact decision and artifact immediately before its authorised side effect | Use a historical green check as an enduring release token |

All workflows reachable from the credential environment and their pinned dependencies belong to the trust boundary. Environment name alone is not access control. The owner restricts its secrets to the selected trusted branch, excluding other branches, PR refs and tags, and verifies that no candidate-executing default-branch job can request the environment. Do not set routine environment reviewer prompts as a substitute for this separation.

The App is installed only on the pilot repository initially. Required permissions: Checks write; Contents, Actions, Pull requests, Issues and Metadata read. Add Administration read only if a selected documented protection inspection API requires it and the owner approves that read scope. It has no content-write, merge, deployment or administration-write permission. Worker dispatch uses worker Actions permission, not the App credential. The existing status publisher keeps its own Issues-write token and never receives the App private key.

Use a full-SHA-pinned action/evaluator and a protected caller. Prefer standard pinned App-token tooling; neither a tag nor a mutable caller is a trust anchor. The App credential is accessed only after basic event/repository checks in its protected job and revoked/expired promptly after use. All GitHub API requests use an explicit supported API version and bounded pagination; absent permissions, rate limits, incomplete lists and unavailable artifacts mean unavailable evidence, not success.

### 3.3 External trust configuration

New external schema `wf-github-trust/v1` contains:

- `repository_id`, canonical `repository`, `trusted_branch`, stable numeric `owner_user_id`, stable `worker_user_ids`.
- `bootstrap_baseline_revision`: full SHA of the governing baseline explicitly approved by the owner under the prior approval route; `bootstrap_approval_url` and its captured digest identify that owner provisioning record.
- `app_id`, `installation_id`, `required_check: wf / delivery`.
- Full `validator_revision`, compatible provider version `1`, and an approved caller/dependency digest.
- `test_workflow`: exact numeric `workflow_id`, repository-relative path, allowed `workflow_dispatch` event and approved workflow-content/dependency digest; a separate equivalent identity for the evaluator workflow.
- Baseline-approved `checks`: `{name,argv,working_directory,reporter,purpose}` entries, where `purpose` is `verification` or `integration`; Node reporter is required for mapped test execution. Commands are arrays, not interpolated shell strings, and come from B/protected configuration.
- `artifact_retention_days: 30`, `max_evidence_age_hours: 168`, `max_snapshot_age_seconds: 60`, and bounded input limits: 1 MiB metadata/decision/package JSON, 16 MiB raw test evidence per check, 64 MiB total evaluation input. Exceeding a bound blocks with a reason; a project can propose a reviewed change to these limits.
- Expected protection/environment configuration and `policy_digest`, including required App-source check, current-branch requirement, protected paths and no worker bypass.

These initial retention/freshness bounds are proposed policy values, not existing facts. The owner approves them in P05. Store the config in the protected evaluator environment or derive it from a protected workflow installation at B with an externally pinned digest. Never load it from C. It contains public IDs/configuration only; credentials stay in secret storage. Record observed setup/protection evidence externally, with the durable selected settings in the project setup record.

Baseline trust has an explicit bootstrap anchor, B0. The owner provisions B0 after approving its exact governing content and verifying the selected protections. For each later B, require B0 to be an ancestor in complete Git history, require GitHub's current trusted-branch ref to equal B, and verify the current protection/configuration snapshot matches the approved trust configuration. The initial provider does **not** reconstruct complete GitHub protection history or every historical owner review. Its baseline inference relies on an explicit operational assumption that the owner-controlled protections and no-bypass rule remained in force between observed snapshots. State that assumption in the setup record and provider output. A force rewrite, known protection lapse, disputed history or unverifiable current settings blocks and requires owner investigation/re-anchoring under the prior approved route; the agent cannot select a more convenient B0. New candidate governing/enforcement changes still require exact scoped live approval before integration.

### 3.4 Evidence schemas and provider seam

Reuse the existing `trust.claim(purpose, revision)` / `trust.allows(purpose, revision)` interface. Add `createGitHubTrust({snapshot,config,now})`, returning `mode: github-verified` and claims only after all provider checks pass. `snapshot` is created by the live collector inside the trusted process, not accepted as a user-supplied proof file. Frozen normalized claims adapt to current verification/review/integration/acceptance/release shapes. Existing core evaluators continue checking acceptance mappings and stage requirements. Diagnostics may serialize snapshots, but reloading one does not confer live trust.

New modules and functions:

| Proposed module | Interface/responsibility |
|---|---|
| `validator/github.js` | `runGitHub(command,options)`; orchestration for `github-request`, `github-evaluate`, `github-preflight` |
| `validator/lib/github/client.js` | `createGitHubClient({token,apiVersion,limits})`; typed, paginated API reads, redacted errors, no arbitrary URL credential forwarding |
| `validator/lib/github/config.js` | `loadGitHubTrustConfig({path,repo,baseline})`; strict external config and baseline/provider agreement |
| `validator/lib/github/runs.js` | `collectRunEvidence({client,config,request,now}) -> RunEvidence[]`; exact workflow/run/attempt/artifact source validation |
| `validator/lib/github/decisions.js` | `collectOwnerDecisions({client,config,target,now}) -> DecisionEvidence[]`; live actor/content/state/supersession verification |
| `validator/lib/github/provider.js` | `collectGitHubSnapshot({client,config,target,now}) -> GitHubSnapshot`; `createGitHubTrust({snapshot,config,now})` |
| `validator/lib/github/package.js` | `validateAcceptancePackage({manifest,artifacts,target}) -> {ok,digest,reasons}` |
| `validator/lib/github/check.js` | `publishDeliveryCheck({client,config,evaluation})`; idempotent App-check update after final live refresh |
| `validator/lib/github/evaluate.js` | `evaluateGitHubStage({baseline,candidate,target,snapshot,config,stage}) -> GitHubEvaluation`; adapts existing CI/readiness/coverage/lifecycle results |

`GitHubTarget` is `{repository_id,repository,pr_number,task_id,milestone_id,phase,baseline_revision,candidate_revision,integration,stage}`. `phase` is `pull-request` or `integrated`; `integration` is `{baseline_revision,candidate_revision,pr_number}` preserving the original pre-merge B/C pair. Stages are `verify`, `integrate`, `accept`, `release`. The collector derives phase and revisions from live PR/Git state: an open PR uses its current head; a merged PR uses its recorded merge-result commit M. It never takes a caller's preferred candidate over that identity. Acceptance/release require `integrated` in the initial CLI and evaluate the milestone's full acceptance set, not just the latest task's IDs. An evaluation after merge retains the integration B/C pair and separately identifies the current governing baseline; never rerun the integration diff with the merged candidate as its own base and accidentally erase the change.

The new command handlers are dispatched before the legacy CLI's manual-trust option parser, as existing operations commands are today; they do not reinterpret `--repository` as an incomplete receipt request. Before integration, use readiness/coverage/lifecycle at the requested stage; call the full existing `evaluateCi` for the integration merge gate. After merge, revalidate lifecycle and current relevant governing dependencies against the preserved integration evidence and final candidate, rather than invoking an empty post-merge CI diff as proof. Missing retained task/milestone evidence after cleanup is unavailable evidence, not an excuse to omit a stage.

`RunEvidence` has schema `wf-github-run/v1`: target identities; `purpose`; request ID; workflow ID/path/W/content digest; run ID/attempt; exact required job IDs and step conclusions; actual checkout revision; Node collector revision/digest; environment; start/completion timestamps; required check name; process exit/result; artifact IDs, digests, byte counts and expiration; normalized execution plus raw-evidence references. Claims from artifact bodies are cross-checked with live Actions API metadata and approved job structure. Candidate-produced fields never select a workflow, trusted revision or executable collector.

`GitHubSnapshot` has schema `wf-github-snapshot/v1`, target, `collected_at`, `valid_until`, `policy_digest`, protection observations, runs, decision evidence and review evidence. `GitHubEvaluation` has `{ok,stage,target,checked_at,valid_until,errors,mechanical,assisted,owner_decisions,unavailable,evidence_digest}`. `unavailable` required evidence makes `ok:false`; `assisted` clearly lists semantic/context attestation limits. No new provider falls through to `createEnforcedTrust`.

Candidate artifact bytes remain hostile even when transport provenance is verified. Download only by API-selected artifact ID from the exact run; validate archive entries without general extraction, reject traversal/symlinks/duplicate names and expansion-limit violations, and parse only allowlisted JSON/NDJSON. Do not execute binaries, source text or workflow commands found in artifacts. Run success without the required jobs, process success, complete Node stream, exact mapped-test execution and raw evidence is insufficient.

The first implementation does **not** prove arbitrary candidate code honestly emitted every test event. A pinned launcher/reporter and Actions provenance identify the observed run; malicious tests can still fake output or weaken assertions. Separate semantic review, protected test-runner changes and an injected weakened-assertion pilot remain required. Do not label raw stdout as cryptographically proven test execution.

### 3.5 Evaluation and invalidation

1. Read the event as an untrusted hint; derive repository identity from protected configuration and fetch current PR/base/run/decision objects from GitHub.
2. Refuse a wrong repository, fork candidate, unsupported event/ref, closed-unmerged PR or mismatched task. First release supports same-repository PRs only.
3. Resolve revisions to full commits and require full trusted history. For an open PR, verify C contains current B and compute actual paths B→C. For an integrated target, verify M is the recorded PR result on trusted history and retain its original integration B/C evidence; test M itself and revalidate the relevant governing-source closure against today's trusted baseline. Unrelated later commits need not force acceptance of a new build; a relevant governing change requires reassessment and any newly applicable candidate/decision. Read current baseline mode/config, not candidate selections.
4. Verify actual run workflow ID/path/event/W and the workflow/dependency bytes at W against the approved version. Check current run attempt and its exact jobs; only completed success is eligible. Reject queued, waiting, cancelled, timed-out, skipped, neutral, failed or superseded attempts. A cancelled new attempt does not revive an old successful one.
5. Validate request metadata from the trusted preparation job, actual checkout C (or M in integrated phase), collector identity, required execution, artifacts and independent review report. Missing evidence blocks. Implementation and integration are distinct runs/purposes; one JSON payload cannot self-label as both.
6. Run the existing record/readiness/scope/freshness/mapping checks and the new stage evidence checks. For protected path changes, require the appropriate current, owner-authored scoped decision; baseline content never approves candidate changes before merge.
7. Immediately before writing success, refetch PR head/base, current run attempts/conclusions and referenced decisions. If anything changed, discard this result and require a fresh evaluation. Publish to C with App identity and an external ID derived from repository/PR/B/C/stage/policy/evidence digest.

Serialize App-check writes per repository/PR in the evaluator and never let an old run overwrite newer state. Query and reconcile existing App checks by external ID before retrying an ambiguous write. Use `cancel-in-progress: false`; GitHub concurrency is not a durable queue, so dropped pending work remains pending and is explicitly redispatched by the coordinator. Partial reruns must not reuse jobs/artifacts from another attempt; the initial provider requires a fresh complete run when required job-attempt provenance is ambiguous.

Trigger normal evaluation on completed test runs; use default-branch issue-comment events and explicit worker dispatch to refresh owner decisions; use trusted-branch pushes to invalidate/re-evaluate affected open PRs. PR head changes naturally require a check on the new C. Revalidation also occurs before presenting acceptance, before merging in the supported assisted flow, and immediately before any release/deployment operation. Review edits/dismissals and events without a reliable default-branch callback are caught by those live reads; do not promise every event is observed instantaneously.

There is no atomic transaction across editing a GitHub comment, updating a check and pressing Merge. Without a hosted observer or platform-native transactional rule, delayed/missing events can leave an old green check visible temporarily; GitHub does not automatically expire an arbitrary check at this provider's `valid_until`. A successful App check is a timestamped evaluation, not irrevocable permission. The supported assisted flow requires the fresh pre-stage read, and acceptance/release consumers enforce the snapshot age. This limitation must appear in setup and owner evidence. If the required assurance becomes “no merge can occur after any unobserved revocation,” stop and redesign that separately; do not claim this initial design provides it.

### 3.6 Owner decisions, review and accepted artifacts

An owner posts a structured decision as a new issue comment on the target PR/milestone issue, or in a submitted PR review body. The collector fetches it through the corresponding API, matches stable numeric actor/repository/target IDs, validates the current body and state, and records its object ID, timestamp and content digest. Names quoted in text, commit authors, labels, ordinary `APPROVED` reviews and merge events provide no acceptance authority.

One fenced JSON object uses schema `wf-owner-decision/v1` with:

| Field | Meaning |
|---|---|
| `repository_id`, `repository`, `target_number` | Exact approved repository and PR/issue |
| `candidate_revision`, `build_digest`, `package_digest` | Exact C/R/A; all required for acceptance/release |
| `milestone_id`, `scenarios` | Exact milestone and accepted native acceptance IDs |
| `decisions` | Array of `{purpose,decision}`; `acceptance/accepted`, `release/authorised`, or `governing-change/approved`, `workflow-change/approved` |
| `paths` | Exact scoped protected paths for the two change-approval purposes; otherwise empty |
| `expires_at` | Explicit expiry; no implicit indefinite permission |
| `supersedes` | IDs of earlier decisions intentionally replaced; otherwise empty |

A single owner response may include both acceptance and release, while retaining two distinct purposes and their checks. Governing/workflow-change decisions bind C, the protected path list and a review-package digest; they do not require a product build or accepted scenarios. The parser uses a purpose-specific schema, not optional fields that let an acceptance decision omit C/R/A. Baseline approval follows the explicit bootstrap/continuity contract in §3.3; it is never derived from the mere word `main` or presented as a complete protection-history proof.

The acceptance package schema is `wf-acceptance-package/v1`: repository/milestone/C; immutable build locator and digest R; environment and reproducible demo; delivered behavior/exclusions; full scenario IDs with actions/expected outcomes; persistence/state evidence; exact technical run and independent-review references with digests; known issues; consequential changes; release readiness and recommendation. Its manifest binds every referenced content digest. A is the digest of its canonical manifest, excluding only its own digest field. Changing a linked report, build or scenario package changes A and requires a new applicable decision. No mutable URL alone identifies an accepted product.

Independent review uses the current separate-context procedure and six coverage areas. Capture the actual report, findings/disposition, reviewer/implementer IDs, harness/version, canonical input references, C and context attestation. The implementer cannot self-author the report. In the initial one-owner deployment, the owner authenticates the supplied review report's source when approving the PR/package; the evidence says `assurance: assisted-attestation`. A signature or authenticated comment establishes authorship and binding, not independence of reasoning. Missing report, mismatched C or unresolved findings blocks presentation.

Treat referenced decisions as immutable once relied upon. Any edit invalidates that object until replaced by a new decision; compare live body/state/timestamp against its recorded fingerprint. Initially edited comments cannot establish authority even if the new text looks valid. Fetch review lifecycle/timeline metadata when the review API alone cannot establish edit/dismissal history; if required history is unavailable, use a new owner comment instead. Deleted, dismissed, expired, duplicated/conflicting or cyclically superseded decisions fail closed. A replacement must explicitly name what it supersedes. Never restore an older decision simply because its replacement was deleted.

The evaluator's prior check output/linked retained package stores the evidence IDs/fingerprints it relied on. Revalidation rereads them live; an absent history anchor is unavailable evidence, not permission to reconstruct a favorable past. An edit followed by restoration is still an edit. GitHub APIs/current state and retained observations cannot prove a complete history of edits that occurred before observation; this is another stated evidence limit, not grounds for treating unobserved text as an original signed receipt.

Prefer acceptance of the final integrated build after merge. For a merge/squash/rebase commit M different from tested C, do not infer equivalence from a PR number or merge success. Preserve the original B/C integration evidence, prove M is the recorded PR merge result on trusted history, and bind acceptance to M and its actual R. The first supported path repeats required integration checks on M and obtains a review attestation for the final artifact/package. If the owner already accepted C/R and the exact immutable R is deployed unchanged, a separately verified C→M/R relationship may preserve product acceptance only when the approved release policy permits it; a rebuilt/different digest requires a fresh package and owner decision. The default pilot takes the simpler post-merge path.

Before release, fetch the decision, build metadata, package, current governing dependencies and deferred inputs again. Release consumes exact R; it does not rebuild from a moving branch. Record the actual side effect afterward on the PR/issue/release record. Revocation after shipment blocks subsequent operations and starts the existing incident/recovery procedure; it cannot undo an already shipped artifact. No automatic destructive rollback is implied.

## 4. Work breakdown and dependencies

Each P-task is a cohesive reviewable deliverable. On authorisation, allocate real T-IDs using full trusted history and open PRs; these plan numbers reserve none. Each implementation task uses one PR, with fixes and Done status in that PR. Apply the current execution/review/release procedure throughout. Focused policy and adoption changes merge before dependent production changes; do not approve a change with its own candidate rules.

```text
P01 ──> P02 ──> P03 ──> P04  [adapter pilot gate]
                          │
                          └──> P05 ──> P06 ──> P07 ──> P08
                                                    │        │
                                                    └────────┴──> P09
                                                                  │
                                                                  └──> P10
```

Some pure provider parsing tests can be prepared alongside P06 after P05, but one coordinator owns the integration order. P07's App setup waits for reviewed P06 isolation and remains a non-authoritative provenance probe under current controls. P08 implements all decision/review collection and obtains its explicit policy approval before enabling `github-verified` or requiring the authoritative delivery check. P09 is the first supported release gate; P10 decides further expansion.

### P01 — Establish source/classification and compatibility contracts

**Complexity:** Medium; narrow policy/design work with consequential compatibility boundaries.

**Files:** Modify `SCHEMA.md`, `config.default.json`, `procedures/readiness.md`, `procedures/maintenance.md`; create `procedures/speckit.md` and `integrations/speckit/compatibility.json`; extend `validator/test/conformance.test.js`, `validator/test/freshness.test.js`, `validator/test/procedure-links.test.js`; add `validator/test/speckit-classification.test.js`. Change `POLICY.md` only for an explicitly approved amendment, not merely to restate this proposal.

**Interfaces:** Produces adapter compatibility API `1`, exact supported source/path contract and baseline-approved adoption diff. Existing source/record/evaluator interfaces remain unchanged.

- [ ] Record the approved implementation scope, pilot repository/non-production boundary, complexity budget and stopping rule on the task issue. Record before/after shared-corpus word counts required by maintenance.
- [ ] Add assertions that adapter instructions, locks, overrides and materialized commands classify as enforcement; imported spec roots classify as governing; executable contract precedence is explicit; unknown paths block. Observe the intended missing-classification failures.
- [ ] Add freshness cases for spec/plan/contract edits, removed/new relevant sources, and an unrelated feature edit that leaves an unrelated task eligible. Use existing evaluator fixtures.
- [ ] Implement the smallest optional adapter configuration/contract change; no consumer is enabled by default. Document the proposed installation and policy boundaries.
- [ ] Run `node --test validator/test/speckit-classification.test.js validator/test/freshness.test.js validator/test/conformance.test.js validator/test/procedure-links.test.js`, then `npm test`. Expected: all pass, including existing modes.
- [ ] Obtain separate-context review and owner approval of consequential contract changes before merging. Post test evidence and the session outcome on the PR.

### P02 — Ship a verifiable, reversible adapter installation

**Complexity:** Medium–high; upstream packaging and integration materialization are the main uncertainty.

**Files:** Create `adapters/speckit.mjs`, `adapters/speckit/installation.mjs`, preset/extension manifests and constitution template listed in §2.1, `integrations/speckit/preset/commands/speckit.{specify,clarify,plan,constitution,tasks,implement}.md`, `integrations/speckit/preset/commands/unsupported.md`, `integrations/speckit/extension/commands/speckit.agent-workflow.prepare.md`, `integrations/speckit/python-requirements.lock`, `validator/test/speckit-installation.test.js`, `validator/test/speckit-upstream.test.js`; modify `integrations/speckit/compatibility.json`, `bin/wf-adopt`, `validator/test/adopt.test.js`, `procedures/speckit.md` and `templates/setup.md`.

**Interfaces:** Implements `verifyInstallation`, `check-install`, staging/manifest generation and `wf-speckit-lock/v1`. Extend `wf-adopt` with an explicit `--planning-frontend speckit --speckit-python /absolute/isolated/venv/bin/python` opt-in; existing invocations are byte/behavior compatible where practical. An already adopted project receives a planned diff via the documented adapter flow, not a second `wf-adopt` or overwrite.

- [ ] Test missing packaged core assets, altered installed script, unexpected overrides, wrong upstream commit/dependency digest and a stale inactive integration. Each returns unsupported with the exact path and changes no target file.
- [ ] Implement isolated pinned installation and staging from actual packaged content. Preserve the upstream license/attribution for distributed fragments. Do not vendor the entire tool or assume source-install success proves a complete package.
- [ ] Ship every file referenced by the manifests. Until P04, feature commands contain explicit incomplete-integration stop entries, constitution only points to native authority, and the prepare command runs `check-install` only. The installation can be tested as a valid package but cannot claim a working planning flow or fall through to upstream task execution. P04 replaces these bounded entries with the final command behavior.
- [ ] Generate/check managed content for Codex `.agents/skills/speckit-*/SKILL.md` and Claude `.claude/skills/speckit-*/SKILL.md` at this upstream pin. Keep the existing workflow skill and Claude independent reviewer intact.
- [ ] Verify collision refusal and interrupted-install recovery: stage fully before target changes, keep a manifest of intended writes, and resume by inspecting actual bytes. No blind overwrite or deletion of user files.
- [ ] Run `node --test validator/test/speckit-installation.test.js validator/test/adopt.test.js`; run the real upstream contract lane with `WF_SPECKIT_UPSTREAM=1 WF_SPECKIT_SOURCE=<verified-checkout> WF_SPECKIT_EXECUTABLE=<isolated-specify> node --test validator/test/speckit-upstream.test.js`. The file always runs synthetic contracts, so ordinary `npm test` remains self-contained with no integration skips. Only `WF_SPECKIT_UPSTREAM=1` additionally registers/runs the live upstream cases; in that lane missing/wrong source, executable or dependencies fails explicitly. Supplying live-lane variables without the switch is an input error, not a misleading pass. The requested live lane is a release gate.
- [ ] Review the complete installed diff and rollback manifest. Publish no package or consumer adoption until the normal release/adoption gate.

### P03 — Make native tasks the only ledger

**Complexity:** Medium; deterministic records, history and freshness.

**Files:** Create `adapters/speckit/task-plan.mjs`, `adapters/speckit/projection.mjs`, `validator/test/speckit-tasks.test.js`, `validator/test/speckit-projection.test.js`; modify `adapters/speckit.mjs`, `validator/lib/sources.js` only for a reusable full-history enumeration helper if needed, `validator/test/record-ids.test.js`, `validator/test/record-references.test.js`, `validator/test/repository-hygiene.test.js`, `procedures/speckit.md`.

**Interfaces:** Implements §2.3 `context`, `write-tasks`, `project`, `check-projection` and their exact schemas. Outputs only native records and disposable local projections.

- [ ] Add allocation tests for an ID deleted on a merged branch, an ID in an open PR but absent locally, incomplete pagination, shallow history, local collision, dependency cycles and four-digit exhaustion. Expected: no reused ID, no partial writes, explicit blocking reasons.
- [ ] Add Draft-write tests: preserve acceptance/governing/dependency fields, resolve proposal keys once, refuse overwriting existing tasks, and keep task/milestone/reference validation valid. Cohesive grouping gets reviewer assessment, not a false automated guarantee.
- [ ] Add projection tests: equal inputs yield equal bytes; changes to each governing source or task status stale the view; a checked box/header-only forgery fails; tampering never modifies a task; regeneration never restores retired tasks; another selected task yields a different projection.
- [ ] Implement atomic writes and safe path handling; reject symlinks, traversal and unsafe feature names. Keep open-PR snapshots external and require current live retrieval for actual allocation.
- [ ] Run `node --test validator/test/speckit-tasks.test.js validator/test/speckit-projection.test.js validator/test/record-ids.test.js validator/test/record-references.test.js validator/test/repository-hygiene.test.js`, then `npm test`. Check the adoption diff ignores projections/runtime artifacts and rejects accidental tracked copies.
- [ ] Review one multi-step feature with meaningful native task boundaries and internal step checklists. Confirm there is no automatic phase/step-to-task or step-to-PR conversion, no bidirectional sync, and no arbitrary target task count. Retain every acceptance ID and necessary risk/release boundary.

### P04 — Complete the preset flow and observe the adapter pilot

**Complexity:** Medium; prompt compatibility needs a live tool-discovery trial.

**Files:** Create `validator/test/speckit-commands.test.js`; replace the bounded P02 entries in `integrations/speckit/preset/commands/speckit.{specify,clarify,plan,constitution,tasks,implement}.md` and `integrations/speckit/extension/commands/speckit.agent-workflow.prepare.md` with the complete commands; modify `integrations/speckit/preset/commands/unsupported.md`, manifests, `validator/test/speckit-upstream.test.js`, `procedures/speckit.md`, `.agents/skills/workflow/SKILL.md`, `templates/pilot.md`, `QUICKSTART.md` and `templates/setup.md`.

**Interfaces:** Produces the command table in §2.2; consumes P02 installation proof and P03 task/projection helpers. No new core authority.

- [ ] Test materialized command content for the pin: explicit native task selection, no whole-feature execution, no native checkbox writes, no required-tests-optional instruction taking precedence, no self-authorised constitution amendment, and no automatic implementation handoff.
- [ ] Test specify/clarify composition with four unresolved reserved choices: preserve all four as decisions, permit only delegated assumptions, and generate no persistent feature selector. Test plan reuse and ignored supporting artifacts.
- [ ] Implement commands through supported upstream composition. Verify both integrations independently, switching active integration before checking its actual materialized output.
- [ ] Run `node --test validator/test/speckit-commands.test.js validator/test/speckit-installation.test.js validator/test/speckit-projection.test.js`, the P02 upstream lane, and `npm test`.
- [ ] In an owner-authorised disposable/non-production project under existing controls, use fresh Codex and Claude contexts from brief through spec/design to native Draft tasks. Inject an edited projection and missing reserved decision. Confirm affected work blocks and unrelated eligible work continues. Record actual harness versions and discovery behavior on the pilot PR/issue.
- [ ] Before the first real delivery trial, record the fixed scope, starting revision, completion stage, model/effort, owner-time categories and comparison method from §6. Distinguish current workflow versus workflow with the adapter (adapter value) from ordinary AI-assisted work with equivalent gates (overall workflow value). Keep setup measurements separate. P09 and P10 must use the predeclared comparison; do not choose it after seeing trial results.
- [ ] Independent review confirms a single source for each artifact and one PR per native task. **Adapter gate:** no duplicate editable ledger/policy/design, no authority expansion, zero owner turns solely for bookkeeping, and a tested reversible installation. Failure pauses provider investment until corrected within the agreed budget.

### P05 — Add the strict provider contract without changing legacy modes

**Complexity:** High; this is the central policy/evidence seam.

**Files:** Create `validator/lib/github/config.js`, `validator/lib/github/provider.js`, `validator/lib/github/evaluate.js`, `validator/test/github-provider.test.js`; modify `validator/lib/trust.js`, `validator/lib/records.js`, `validator/lib/lifecycle.js`, `validator/lib/acceptance.js`, `validator/lib/ci.js`, `validator/cli.js`, `SCHEMA.md`, `procedures/approval-evidence.md`, `templates/profile.md`, `templates/setup.md`; extend `validator/test/enforced.test.js`, `validator/test/trust.test.js`, `validator/test/lifecycle.test.js`. Any `POLICY.md` amendment is its own focused approved change before activating the provider.

**Interfaces:** Implements the provider types in §3.4 and `github-verified` selection. Existing `createTrust` and `createEnforcedTrust` results and CLI behavior remain compatible. CLI use of a provider-selected baseline without live provider configuration fails explicitly; `status` remains a derived diagnostic.

- [ ] Have the owner approve the provider's evidence/policy contract, proposed age/retention values and assisted limitations. Keep legacy policy wording specific to its modes.
- [ ] Add mode-matrix tests: manual still requires receipts; enforced still reports its existing `unverified` list; new provider blocks missing, failed, stale or skipped machine evidence and never falls back. Candidate/profile mismatch and candidate attempts to change modes fail.
- [ ] Add strict schema/digest/bounds tests and cases where local JSON claims, a Git author, a mode label or a familiar check name try to create trust. Assert no claim is produced.
- [ ] Implement the smallest adaptation around existing evaluators. Acceptance-stage evaluation uses every milestone scenario and the approved current dependency closure, not merely one task's list.
- [ ] Run `node --test validator/test/github-provider.test.js validator/test/enforced.test.js validator/test/trust.test.js validator/test/lifecycle.test.js validator/test/acceptance.test.js validator/test/fixtures.test.js`, then `npm test`. All previous blocking fixtures retain their expectations unless a separately approved policy change explains one.
- [ ] Obtain independent review of the mode boundary before implementing its live collector. Record instruction growth and the fixtures that justify it.

### P06 — Produce candidate-bound evidence in isolated jobs

**Complexity:** High; provenance is harder than artifact parsing.

**Files:** Create `templates/github/wf-candidate.yml`, `validator/lib/github/client.js`, `validator/lib/github/runs.js`, `validator/github.js`, `validator/test/github-runs.test.js`, `validator/test/github-artifacts.test.js`, `validator/test/github-workflows.test.js`; modify `validator/cli.js`, `validator/lib/evidence.js`, `validator/reporters/node-test.js` only if an additive reporter fix is required, `validator/test/evidence.test.js`, `procedures/approval-evidence.md` and `templates/setup.md`.

**Interfaces:** `wf github-request --github-trust-config EXTERNAL_FILE --pr NUMBER --stage verify|integrate` dispatches the fixed default-branch test workflow via verified worker authentication; returns request/run identity, not approval. It resolves phase/C from the live PR: before merge test the current head; after merge test the recorded M. Its trusted preparation output is `wf-github-request/v1` with `{request_id,target,purpose,workflow_revision,checks_digest,collector_revision}`; it is uploaded before any candidate job starts, under a unique immutable name. The collector requires that exact preparation job and a unique artifact created before candidate execution; candidate-created duplicates or replacement attempts block. `collectRunEvidence` produces authenticated transport/run metadata and normalized candidate data. Keep existing `prepare-evidence` output compatible.

- [ ] Add API replay fixtures for wrong workflow ID/path/content/W, other repository, fork, tag/branch dispatch, changed B/C, C not containing B, synthetic merge checkout, old/partial attempt, queued/cancelled/skipped job and missing/expired artifact. Every case blocks; a complete current intended run passes.
- [ ] Add bounded artifact tests for traversal, symlink/duplicate entries, malformed/truncated streams, duplicate test identity, reduced required execution, skipped tests, excessive data and arbitrary URL redirects. None execute or extract candidate content into trusted code paths.
- [ ] Implement the default-branch preparation job and separate ephemeral verification/integration jobs. Bind the expected commands/reporting collector from B; record the actual checkout and test environment. No credential-bearing environment, credential-persisting checkout, privileged token, shared writable cache or candidate-selected reusable action is reachable by candidate code.
- [ ] Implement worker dispatch with explicit request identity and ambiguous-response reconciliation. Do not redispatch blindly after a network interruption. The API version/dispatch response contract is pinned and tested against live documentation/observed pilot responses.
- [ ] Run `node --test validator/test/github-runs.test.js validator/test/github-artifacts.test.js validator/test/github-workflows.test.js validator/test/evidence.test.js`, then `npm test`. Inspect generated workflow permissions and ensure a nonzero process exit cannot be hidden by an upload step.
- [ ] On the authorised pilot repository, run actual passing/failing/skipped/cancelled candidates and inspect run/job/artifact identities. Record that successful source provenance does not certify test semantics.

### P07 — Prove the protected evaluator and App boundary

**Complexity:** High; owner setup and negative live tests determine feasibility.

**Files:** Create `templates/github/wf-evaluate.yml`, `templates/github-trust.json`, `validator/lib/github/check.js`, `validator/test/github-check.test.js`, `validator/test/github-preflight.test.js`; modify `validator/github.js`, `validator/lib/github/evaluate.js`, `validator/cli.js`, `validator/test/github-workflows.test.js`, `procedures/setup.md`, `procedures/identity.md`, `templates/setup.md`, `bin/wf-adopt` and `validator/test/adopt.test.js`.

**Interfaces:** `wf github-preflight --github-trust-config FILE --repository OWNER/REPO` is read-only. `wf github-evaluate --github-trust-config FILE --pr NUMBER --stage verify|integrate|accept|release` collects live evidence and emits `GitHubEvaluation`. In P07, successful provenance probes use the separate name `wf / provenance-probe`; they are not delivery authority. A complete delivery verdict remains blocked until P08 supplies valid owner/review evidence. Only the approved protected evaluator job may ultimately publish `wf / delivery` with the App. Local output is diagnostic.

- [ ] Implement read-only preflight that checks stable owner/repository IDs, supported platform/account capabilities, protected caller/environments, required exact App source and externally pinned validator/config. Missing API visibility blocks a verified setup claim; the owner may supply documented setup evidence only where the approved contract explicitly allows it.
- [ ] Owner creates/installs the scoped App, places its credential in the restricted environment, and configures protected paths/current-branch requirements/no bypass. Test exact-App source restrictions with the provenance probe on the disposable target. Keep the consumer's current approval mode/checks active; do not yet require `wf / delivery` or switch to `github-verified`. The agent supplies exact non-secret settings and validates observed effects; it does not provision or inspect private keys.
- [ ] Implement evaluator data-only Git access and full history, using pinned core code outside C. Validate all dependency/caller identities, final live state and check-write reconciliation from §3.5.
- [ ] Test stale-result ordering, two run attempts, baseline/head movement during collection and before publish, API denial, revoked App permission, expired config/evidence and ambiguous publication. Never leave an intentionally refreshed failed verdict represented as new success.
- [ ] Run `node --test validator/test/github-check.test.js validator/test/github-preflight.test.js validator/test/github-workflows.test.js validator/test/github-provider.test.js validator/test/wrapper.test.js`, then `npm test`.
- [ ] Observe negative live tests on the disposable target: worker-branch/tag/PR workflow tries to request the credential environment; same-name check from another App/GitHub Actions tries to satisfy the probe's exact-App source restriction; stale candidate violates the configured current-branch rule; candidate artifact tries to supply executable evaluator instructions. These must fail without revealing a secret. Observe one correctly sourced intended run pass the provenance probe, while the incomplete delivery gate still blocks. Unsupported account restrictions fail this milestone; retain existing supported mode.

### P08 — Bind owner decisions and release consumption to live evidence

**Complexity:** High; lifecycle identity and revocation are consequential.

**Files:** Create `validator/lib/github/decisions.js`, `validator/lib/github/package.js`, `templates/github-owner-decision.json`, `templates/github-acceptance-package.json`, `validator/test/github-decisions.test.js`, `validator/test/github-package.test.js`, `validator/test/github-lifecycle.test.js`; modify `validator/lib/github/provider.js`, `validator/lib/github/evaluate.js`, `validator/lib/github/check.js`, `templates/github/wf-evaluate.yml`, `procedures/approval-evidence.md`, `procedures/accept-release.md`, `procedures/review.md`, `procedures/operate.md`, `templates/review.md`, `templates/acceptance.md`, `templates/release.md` and `SCHEMA.md`.

**Interfaces:** Implements §3.6 schemas and `collectOwnerDecisions`/`validateAcceptancePackage`; provider exposes purpose-specific current claims. Existing manual receipt types are untouched. The release evaluator returns permission evidence only; deployment remains the project's existing authorised operation.

- [ ] Obtain explicit policy approval for the new decision route and assisted review-source attestation. State the merge/check/decision race limit and release consumer's mandatory live revalidation.
- [ ] Test wrong actor numeric ID despite matching display name; copied owner text; ordinary approval/merge; wrong repository/C/R/A/scenario/purpose; conflicting decisions; edits/restoration, deletion, dismissal, expiry, cyclic supersession and unavailable timeline/history. Each supplies no authority; a new explicit valid replacement passes.
- [ ] Test package mutation via linked report/build content, changed build digest, incomplete milestone scenarios, missing review report, implementer-as-reviewer and unresolved findings. All block acceptance presentation/acceptance as applicable.
- [ ] Implement retained fingerprints and live revalidation before stage use, publication and release. Event handlers are hints and never trust event-embedded authors/body. Preserve evidence links and unavailable state after retention expiry.
- [ ] Test post-merge M versus C: original B→C evidence remains inspectable; final M/build checks and explicit owner decision are required by default; a same-PR or same-tree assertion alone never proves a rebuilt artifact's identity. Test revocation after shipment as an incident/next-operation block, without claiming it undoes release.
- [ ] Run `node --test validator/test/github-decisions.test.js validator/test/github-package.test.js validator/test/github-lifecycle.test.js validator/test/lifecycle.test.js validator/test/enforced.test.js`, then `npm test`. Exercise one live owner comment and one review route, including edited/deleted replacement behavior, on the pilot.
- [ ] Only after the complete G3 route passes, have the owner approve the protected mode-change/configuration PR, require `wf / delivery` from the exact App and remove the temporary probe requirement. Repeat the intended full delivery success and relevant negative checks with the authoritative name; no stub approval claims or test-only evidence may satisfy it. Current controls govern this activation change.

### P09 — Deliver the owner view and complete the first release pilot

**Complexity:** Medium–high; integration across already tested pieces, plus observed operations.

**Files:** Modify `validator/lib/status.js`, `templates/github/wf-status.yml`, `validator/test/status.test.js`, `validator/test/status-workflow.test.js`, `templates/pilot.md`, `templates/setup.md`, `QUICKSTART.md`, `README.md`, `procedures/speckit.md`, `procedures/approval-evidence.md`; create `validator/test/speckit-github-flow.test.js`. The release PR also changes `package.json` and documented release/version references under current procedure. Do not change `.github/workflows/release-tag.yml` as part of implicit self-adoption.

**Interfaces:** Optional provider observation input to the status renderer is `{checked_at,valid_until,target,mechanical,assisted,owner_decisions,unavailable,next_action}`. `wf status` remains derived/read-only and never establishes trust. The status publisher reads App-check results through its existing restricted route; it does not impersonate the evaluator.

- [ ] Add status assertions for Implemented/Verified/Accepted/Released separately, stale/unavailable evidence, assisted review provenance, one responsible next action and unaffected eligible tasks. Legacy unverified items remain visibly unverified. Do not turn expired history into a current green summary.
- [ ] Add a deterministic full-flow fixture: authorised sources → native tasks → projection → candidate tests/review → App evaluation → final integrated build → explicit acceptance/release. Inject the P04–P08 failures and assert the correct stage blocks without blocking unrelated planning/feedback.
- [ ] Run `node --test validator/test/speckit-github-flow.test.js validator/test/status.test.js validator/test/status-workflow.test.js`, the P02 upstream lane and `npm test`. Independent review reads canonical sources/diff/evidence without the implementer's conversation.
- [ ] Complete one real bounded milestone on an explicitly authorised consumer: implement, independent review, assembled checks, post-merge candidate/build identity, owner product test, acceptance and explicit release decision. Rehearse interruption after a harmless recorded side effect and resume by inspection without replay. Record technical and workflow outcomes separately.
- [ ] Exercise recovery/rollback and a non-production backup restore where applicable. Verify evidence survives long enough for the whole milestone; expiration produces a blocker and a new run/decision, never a bypass.
- [ ] Release only after G1–G3 and G4's pre-release evidence in §6 pass, normal independent workflow review and owner release approval. After the tag exists, one consumer adopts the exact released core/adapter/upstream pair in a protected PR for its next milestone; that adoption completes G4. Other consumers retain their pins. G5 is the subsequent expansion decision, not a circular prerequisite for this first release.

### P10 — Validate attention savings and rehearse one upstream upgrade

**Complexity:** Medium; outcome measurement and compatibility maintenance, not new platform scope.

**Files:** Modify `integrations/speckit/compatibility.json`, `integrations/speckit/python-requirements.lock`, adapter/preset files only when the approved upstream upgrade requires it, `validator/test/speckit-upstream.test.js`, `validator/test/speckit-installation.test.js`, `procedures/speckit.md`, `templates/pilot.md`, and the relevant idea's verdict/notes. Actual measurements and upgrade observations stay on PRs/issues.

**Interfaces:** Same compatibility API `1` unless a reviewed breaking change is necessary. A later upstream version is selected and pinned only when this task is authorised; this plan invents no future release number.

- [ ] Confirm the baseline/method recorded in P04 preceded P09's first delivery trial, and use the same categories for the second. Keep setup effort separate from owner administration during delivery; record usage as unknown when unavailable. A missing predeclared comparison means the improvement claim is unavailable and needs a new properly designed trial.
- [ ] Complete the second bounded real milestone and measure §6's elapsed time, owner effort, usage and quality outcomes, including false blocks, missed scenarios and recovery clarity. Apply the acceptance thresholds below without claiming statistical certainty or experienced-engineer parity from two milestones.
- [ ] In isolated staging, build a reviewed upstream version; compare packaged assets, command composition/materialization, dependency lock and installation manifest. Run the entire compatibility suite and fresh Codex/Claude discovery tests. Do not mutate a live installation with upstream's remove-then-add updater.
- [ ] Prove rollback to the preceding approved adapter/core/upstream pair while retaining canonical records. Refuse incompatible source/schema rollback and keep the newer pin until an owner-approved conversion exists; never delete records merely to make a rollback pass.
- [ ] Run the P02 upstream lane, all `validator/test/speckit-*.test.js` in the documented test environments, provider regression tests and `npm test` for an actual upgrade diff. Review only new failures/changes after a passing run.
- [ ] Make one evidence-based investment decision. Any authority bypass fails release. If repeated duplicate maintenance or insufficient owner-time improvement persists after one focused correction, stop expansion and retain only demonstrated useful controls; do not compensate by adding a runner/dashboard.

## 5. Ownership, adoption and recovery

| Agent work within an authorised task | Owner action reserved by the workflow |
|---|---|
| Inspect source, produce installation/configuration diffs, implement and test | Authorise the implementation milestones and approve policy/authority changes |
| Prepare scoped protected PRs and task/acceptance packages | Review protected governing/enforcement changes using the established route |
| Request ordinary unprivileged test runs with worker identity | Create/install App; set credentials, environment restrictions and repository protections |
| Read back configuration and run authorised negative probes | Approve selected settings/permissions and any platform-plan change |
| Obtain fresh independent review, resolve findings, present evidence | Test the product and author exact acceptance/release decisions |
| Prepare version/pin/rollback diffs | Approve workflow release and explicit consumer adoption/rollback |

Adoption order is fixed: record scope and authority → protected path/configuration approval → reviewed pinned adapter installation → discovery test → new bounded milestone. For the strict provider, add approved policy contract → owner setup and negative tests → protected mode-change PR → one observed pilot. Bootstrap uses current controls and a deliberately limited disposable/non-production project; the new checker cannot self-authorise its installation.

Do not rewrite historical feature archives. Existing consumers need only the records relevant to their next adopted milestone. Preserve task/decision/acceptance IDs, native task retention and approved source homes. A project with native `specs/` either retains that root with explicit governing classification and source references or moves it in a focused owner-approved change; never keep two live spec copies.

Rollback has three independent parts. The adapter can be disabled/removed through a reviewed installation diff while native records and core continue. A bad new core/provider release is corrected by an explicit compatible pin change under the prior controls; missing evidence never authorises automatic downgrade. Credentials/App installation are revoked or rotated by the owner after dependent checks/operations are deliberately disabled or replaced; removing a required check to make a red PR merge is not recovery.

Upgrade the core, adapter and Spec Kit as a tested compatibility pair, with full immutable SHAs and verified installed bytes. Never auto-update a live active milestone. Changes to relevant governing/design content still stale readiness even when a workflow-pin-only change does not under today's rules. Regenerate projections and rematerialize every supported integration after an approved upgrade, and retain enough external evidence to explain the prior release without treating expired evidence as current authority.

## 6. Objective gates, measurements and stopping rules

| Gate | Required observation |
|---|---|
| G1: adapter seam, after P04 | Fresh Codex and Claude find the intended entry; one canonical spec/design/task truth; complete materialized-content validation; native IDs survive history/deletion; edited projection rejected; existing authority preserved |
| G2: protected evaluator probe, after P07 | Exact App source restriction is demonstrated on the disposable probe; wrong-source same-name checks fail; other branch/tag/PR code cannot reach App credential; candidate execution is isolated; old/missing/skipped/cancelled evidence and B/C drift block; intended provenance passes without claiming delivery authority |
| G3: decision lifecycle and activation, after P08 | Current stable owner identity, C/R/A and all scenario IDs verified; ordinary review approval grants no product authority; edited/deleted/superseded decisions fail before next use; final merged build relationship is established; race/semantic limits are explicit; owner activates the authoritative App check and a complete intended delivery passes |
| G4: first supported release, P09 | Before tagging: complete real bounded milestone with technical and workflow outcomes, independent workflow review and owner approval, passing regression/upstream suites, observed interruption/recovery and applicable rollback/restore. Complete G4 after the approved release tag and one explicit consumer adoption |
| G5: expand or stop, P10 | Two bounded trials, zero owner turns solely for task bookkeeping, no lost acceptance coverage or unauthorised action, no quality/rework regression hidden by deferral, and at least 25% less owner administration time against the predeclared comparison; report elapsed-time/usage tradeoffs and one isolated upstream upgrade/rollback rehearsal |

The 25% target remains a proposed investment threshold for owner administration, not a promised saving, adopted rule or statistically reliable conclusion. It alone cannot establish the owner's broader goal: comparable engineering quality with less elapsed time, human attention and usage. Record tradeoffs and unmatched factors. Agree a bounded effort budget before P01/P05 and before any uncertain live setup trial; forecast from dependencies, checks, owner availability and release windows rather than agent count.

Use `templates/maintenance.md` for the predeclared benchmark and keep observations external. Count each response's usage once across agents and continuation files; report cached and non-cached input, output and its reasoning subset, without summing cumulative counters or treating cached repetition as unique content. Measure coordinator input size/response count, per-task setup, verification/review cycles and why work was repeated. Use interval unions and the critical path; distinguish turn-active time, tool/CI waits, owner-response latency and actual owner labour. Include setup, access preparation and owner review effort separately, never as free savings.

Keep scope, acceptance, risk and required gates equivalent between comparison arms. Supply both fresh contexts with canonical approved requirements/plans, withhold the other trial's outputs, and record learning/order effects. Independently assess correctness, maintainability, security, test fidelity and acceptance completeness, blind where practical. Track rework through acceptance and escaped defects/reopened work for a fixed 14-day follow-up. A task-sizing trial needs separate authorisation and the same quality controls. Two observations guide investment; several matched tasks and an experienced engineer's assessment are needed before claiming comparative quality or superiority. No reliable comparator means no such claim.

Required injected failures across the pilots: missing reserved decision; changed requirement; skipped required test; forged same-name check; edited generated task view; interrupted side effect; stale run/candidate; edited/deleted owner decision; and a weakened assertion retaining its acceptance ID. The mechanical gate must catch what its schema/provenance can establish. Independent review must catch the weakened assertion. A missed authority boundary fails immediately. Document residual limits instead of describing the pilot as proof of universal enforcement.

If a platform capability cannot provide the selected environment/source restriction, the protected-provider milestone is incomplete. If exact run/workflow/C provenance cannot be recovered from the supported APIs and protected request job, no green result is emitted. If adapter maintenance repeatedly duplicates canonical records/prompts, stop and reduce the supported surface. None of these outcomes authorises a hidden fallback, a fork or a platform rewrite.

## 7. Coverage matrix

| Requirement | Tasks | Evidence/check |
|---|---|---|
| Independent small core; preserve manual/enforced semantics | P01/P05/P09 | Mode-matrix, existing trust/enforced/fixture suites; explicit consumer pin diff |
| One policy/spec/design home and governing classification | P01/P02/P04 | Classification/freshness tests; materialized constitution/spec/plan inspection |
| Native ledger, meaningful task/PR, no completion sync | P03/P04 | Draft/projection tests; reviewed two-task breakdown and pilot PRs |
| Full-history IDs and retained referenced tasks | P03 | Historical-deletion/open-PR allocation cases; existing ID/reference fixtures |
| Pins, real installation assets, active-only materialization | P02/P04/P10 | Actual upstream contract lane; tamper/missing-asset tests; both live tool contexts |
| Imported roots, overrides, scripts and generated paths | P01/P02/P05 | Unexpected-root/script precedence/override tests and protected adoption diff |
| Readiness, scope, acceptance coverage and subset behavior | P01/P03/P05/P09 | Existing evaluators/fixtures plus complete-flow failure injection |
| Protected caller/App/environment; no privileged candidate code | P06/P07 | Workflow static/behavior tests and owner-observed negative access/check-source tests |
| Exact workflow/run/attempt/B/C and actual checkout provenance | P06/P07 | Wrong-W/workflow/ref/merge/attempt cases; inspected live run/job/artifact identities |
| Bounded hostile artifacts; required actual execution evidence | P05/P06 | Archive/NDJSON/bounds/missing/duplicate/skipped/failed/reduced-execution tests |
| Honest review provenance and semantic limits | P05/P08/P09 | Missing/mismatched/self-review cases; separate-context report; weakened-assertion review |
| Owner acceptance/release, stable actor, current object state | P08 | Actor/purpose/C/R/A/scenario/edit/delete/dismiss/supersession fixtures and live examples |
| Merge/build relation, stage freshness and revocation limits | P07/P08 | B/C movement, final M/build and post-shipment revocation cases; explicit assisted pre-stage procedure |
| Existing concise owner view with honest unavailable state | P09 | Status snapshots and pilot owner observation; status remains non-authoritative |
| Explicit migration, rollback, retention and upgrade | P02/P08/P09/P10 | Interrupted installation, expired artifact, pin rollback and isolated upstream rehearsal |
| Measurable value and bounded expansion | P04/P09/P10 | G1–G5; baseline/trial observations on PRs/issues; zero bookkeeping-only owner turns |

## 8. Source basis and implementation reading order

Start each authorised task with the repository guide/[README](../../README.md), the relevant procedure and its actual native task record, plus only the relevant contract/task sections of this plan. Consult governing [POLICY](../../POLICY.md) and the mechanical reference [SCHEMA](../../SCHEMA.md) when the current procedure/task points there or a rule is unclear; do not load the full corpus on every step. This plan supplies design decisions, not a new governing baseline. The most consequential existing seams are [trust](../../validator/lib/trust.js), [lifecycle](../../validator/lib/lifecycle.js), [acceptance](../../validator/lib/acceptance.js), [CI](../../validator/lib/ci.js), [freshness](../../validator/lib/freshness.js), [Git sources](../../validator/lib/sources.js), [evidence preparation](../../validator/lib/evidence.js), [launcher](../../bin/wf), [adoption](../../bin/wf-adopt), [execution](../../procedures/execute.md), [approval evidence](../../procedures/approval-evidence.md) and [maintenance](../../procedures/maintenance.md).

Upstream claims were checked at the immutable Spec Kit pin: [preset resolution/composition](https://github.com/github/spec-kit/blob/e77daa9021d20db26b878f7dfa5640fe5a42d04e/docs/reference/presets.md), [extension hooks](https://github.com/github/spec-kit/blob/e77daa9021d20db26b878f7dfa5640fe5a42d04e/docs/reference/extensions.md), [packaged asset inventory and Python floor](https://github.com/github/spec-kit/blob/e77daa9021d20db26b878f7dfa5640fe5a42d04e/pyproject.toml), [initialization](https://github.com/github/spec-kit/blob/e77daa9021d20db26b878f7dfa5640fe5a42d04e/src/specify_cli/command_init.py), [feature-context scripts](https://github.com/github/spec-kit/blob/e77daa9021d20db26b878f7dfa5640fe5a42d04e/scripts/python/common.py), [specify instructions](https://github.com/github/spec-kit/blob/e77daa9021d20db26b878f7dfa5640fe5a42d04e/templates/commands/specify.md), [task instructions](https://github.com/github/spec-kit/blob/e77daa9021d20db26b878f7dfa5640fe5a42d04e/templates/commands/tasks.md), [implementation instructions](https://github.com/github/spec-kit/blob/e77daa9021d20db26b878f7dfa5640fe5a42d04e/templates/commands/implement.md), [Codex integration](https://github.com/github/spec-kit/blob/e77daa9021d20db26b878f7dfa5640fe5a42d04e/src/specify_cli/integrations/codex/__init__.py), [Claude integration](https://github.com/github/spec-kit/blob/e77daa9021d20db26b878f7dfa5640fe5a42d04e/src/specify_cli/integrations/claude/__init__.py), and [integration activation](https://github.com/github/spec-kit/blob/e77daa9021d20db26b878f7dfa5640fe5a42d04e/src/specify_cli/integrations/command_use.py).

GitHub platform capabilities were checked against primary documentation on 2026-09-27: [required-check App source and branch protection](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches), [environment restrictions](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments), [workflow event behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows), [workflow dispatch API](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event), [run/attempt API](https://docs.github.com/en/rest/actions/workflow-runs), [artifact API](https://docs.github.com/en/rest/actions/artifacts), [issue-comment API](https://docs.github.com/en/rest/issues/comments), and [PR-review API](https://docs.github.com/en/rest/pulls/reviews). Recheck the relevant APIs/account features during P06/P07; documentation and mocked responses alone do not establish a live safe configuration.

The preceding architectural recommendation and comparison are background. Everything required to understand the chosen direction is contained here; execution does not depend on a machine-local briefing file. This proposal creates no task allocation, approval evidence, deployed integration or released version.
