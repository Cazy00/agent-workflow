# Explicit approval evidence

## Enforced mode

POLICY § 7 accepts a record on the authoritative branch as approval evidence when the verified protection configuration makes that inference valid. That is `enforced` mode, the owner's chosen default (IDEA-10, 2026-09-25). Before switching to it, the setup record must show, from steps 5 and 9 of `setup.md`: a ruleset or branch protection on the trusted branch requiring a pull request, code-owner review, the `wf ci` check and each check in the profile's `required_checks`, with branches up to date before merging, stale reviews dismissed, administrators included and no worker bypass; `CODEOWNERS` covering every governing and enforcement path, including itself, `docs/workflow/config.json` and the profile, and every path in a shared project (`setup.md`); the CI entry point running the pinned validator from protected configuration; and an approval-path test in which a worker push and an unapproved protected change were rejected and an approved change was admitted. Then set `approval.label` in `docs/workflow/config.json` and `approval_label` in the profile to `enforced` in one code-owner-reviewed pull request.

In enforced mode the fetched authoritative baseline is the approved baseline and no key is needed. The checker still verifies records, classification, readiness, scope, freshness and acceptance mappings; whatever would come from a receipt (test execution, the independent review, the integration rerun, acceptance, release) it lists as `unverified` in its output instead of failing. The agents must collect and assess that technical evidence on the PR; owner approval is not a code or security audit. The list states what this validator has not authenticated. The optional routine integration lane in `delivery.md` adds mandatory agent-attested evidence or exact-head GitHub owner approval; it does not turn those reports into signed receipts. Supplying the trust options runs the full receipt gate instead, exactly as in manual mode; there is no hybrid. A candidate cannot switch the mode, because config and profile are read from the baseline and code owners protect them. If the protections are later found lacking, switch back to `manual`; that is a workflow change and is reviewed as one.

## Manual mode

This implementation also provides the policy's **manual alternative**. It does not infer owner approval from `main`, an `enforced` label, Git authorship, a signature without an established identity, or a GitHub ruleset snapshot. An owner-controlled collector reviews the exact baseline and evidence and signs narrowly scoped receipts. This adds manual collection work and is not claimed equivalent to protected-branch enforcement or an unattended checker.

Provision an Ed25519 owner public key outside the candidate repository in the trusted checker's environment. Establish who controls it during setup. Keep the private key and any signing passphrase inaccessible to candidate execution and routine workers. Replacing the trust anchor requires owner-controlled setup. `--trust-key` inside the candidate repository is rejected; physical credential isolation must still be tested separately.

Every receipt is `{ "payload": { ... }, "signature": "base64" }`. Sign the UTF-8 bytes of `JSON.stringify(payload)` with Ed25519 (Node `crypto.sign(null, bytes, ownerPrivateKey)`). The input JSON key order is preserved by parsing/stringifying. Receipts passed to the validator form one JSON array. All purposes require:

```json
{
  "purpose": "baseline",
  "repository": "OWNER/REPOSITORY",
  "revision": "FULL_COMMIT_HASH",
  "expires_at": "ISO_8601_EXPIRY"
}
```

A baseline receipt means the owner explicitly approved that exact baseline's governing content and authority records for this repository. Read and review the content before signing; signing an unexamined worker request defeats the control. Fetch and record the current authoritative branch before validating. The immutable baseline, project identity and externally pinned validator must agree. The wrapper never chooses executable code from candidate config and extracts committed files instead of a writable cache.

Other purposes add these fields:

| Purpose | Required evidence |
|---|---|
| `governing-change` | Exact candidate and explicit `paths` receiving focused requirements/decision approval |
| `workflow-change` | Exact candidate and explicit protected enforcement `paths` approved as a workflow change |
| `verification` | `environment`, nonempty `checks` array of `{name,result,evidence}`, and `execution: {revision,tests:[{file,name,status}]}` from actual runner output |
| `review` | `reviewer`, `implementer`, `separate_context`, `evidence`, `coverage` of scope/correctness/maintainability/security/regression/test-fidelity, and `findings` with disposition |
| `integration` | `environment` and `checks` for the assembled candidate |
| `acceptance` | `decision: accepted` and accepted `scenarios` IDs, based on the owner's observed product decision |
| `release` | `authority`, `artifact`, `candidate_revision`, and `readiness` values for configuration/permissions/migration/monitoring/recovery/support/devices/deferred_information |

Checks must be `passed`; required test executions must be `passed`, exactly once per mapped file/name. Preserve raw logs in signed `artifacts` keyed by evidence reference, not as committed files. Capturing raw post-commit logs in the receipt avoids a circular commit that changes the tested revision merely to include its result. Review results come from the separate reviewer, not a completion declaration written by the implementer. The owner-controlled collector authenticates the source of technical records before signing their receipt; a signature authenticates the collector's attestation and does not itself prove tests were adequate.

Release readiness values are `verified` or `not-applicable`, with the underlying rationale in the release record. Scope receipt paths explicitly. Multiple receipts with the same purpose/revision are ambiguous and rejected; replace the previous receipt after re-review. Wrong key, repository, revision, purpose, expiration or altered payload supplies no authority.

Example owner-side signing code (run only in the owner's signing environment after inspecting `payload.json`):

```js
import fs from 'node:fs';
import { createPrivateKey, sign } from 'node:crypto';
const payload = JSON.parse(fs.readFileSync('payload.json', 'utf8'));
const key = createPrivateKey({ key: fs.readFileSync(process.env.OWNER_SIGNING_KEY), passphrase: process.env.OWNER_SIGNING_PASSPHRASE });
const signature = sign(null, Buffer.from(JSON.stringify(payload)), key).toString('base64');
fs.writeFileSync('receipt.json', JSON.stringify({ payload, signature }, null, 2) + '\n', { mode: 0o600 });
```

The gate never calls this signing operation. Signing keys and candidate tests must not share a credential-bearing execution context. No live trust anchor or approval receipt was created by the conformance inspection; setup and owner adoption are separate recorded actions.

### Signing rounds

A round is one file of unsigned payloads, one per receipt, that the coordinator stages outside every checkout in the owner's inbox (`$WF_INBOX`, set by the trusted operator like `$WF_RECEIPTS`): `<round>-unsigned.json`, a JSON array, with a new round name each time. Beside it the coordinator writes the owner's brief, `wf brief --payloads FILE --repo DIR --baseline APPROVED_SHA > <round>-brief.md`, and sends one request naming both files, the revisions and anything the brief lists under *Needs your judgement*. The brief is rendered from the file and headed by its sha256; it says what each signature attests and approves nothing. `wf brief` exits 1 for a file the gates would reject: fix it before asking. The owner reads the brief, inspects what it points to, signs the file whose digest matches and adds the receipts to `$WF_RECEIPTS`.

In manual mode a round also ends the coordinator's session: record the outcome and handoff naming the round file, and stop. A fresh session resumes after signing (`execute.md`, *Resume, limits and handoff*).

### Unsigned dry runs

Before staging a round, run the gates it must satisfy with `--unsigned-receipts FILE` beside the trust options. A signed receipt takes precedence over an unsigned payload of the same purpose and revision. A result that relies on an unsigned payload reports `authoritative: false`, lists the payloads it relied on and exits 3, which is never success: authoritative launchers and CI entries never pass the option, and no step treats exit 3 as approval. It replaces signing copies with a throwaway key.

### Derived baselines

With `approval.derived_baselines: true` in the approved baseline's `docs/workflow/config.json` (a workflow change, so the owner's receipt enables it; absent or `false` keeps every baseline explicit), a revision needs no baseline receipt of its own when every path that differs from its nearest first-parent ancestor with a baseline receipt is covered by a receipt at a revision where the path already had its current content: a `governing-change` or `workflow-change` receipt listing it, or, for a production or generated path, complete `verification`, `review` and `integration` receipts whose checks all passed, including the profile's required checks, and whose run passed every mapped test once. Planning paths need none, as in a planning-only `wf ci` and a records-only merge in enforced mode. An unclassified path or records that fail validation prevent derivation; classification comes from that ancestor's config. The Done record after a signed candidate, and a milestone close with its governing-change receipt, then become baselines without another signature. The owner no longer signs planning records on their own, such as a task marked Done; `wf brief --baseline` lists them in the round they arrive with.

### Milestone rounds

A milestone whose authorised record sets `signing: milestone` collects its signatures in one round at its end instead of one per task. The coordinator works through its tasks on the milestone's branch, gating each with `--unsigned-receipts` holding the payloads staged for the tasks before it (exit 3 is expected), so every task still gets its verification, review and integration payloads and every governing change its own. The final round holds all of them with the acceptance and the close; `wf closeout` then re-runs every task's gate on the signed receipts before the trusted branch moves. The owner signs everything the per-task route signs, only later; the cost is reworking later tasks if an earlier one is refused. `signing: task`, the default, keeps a round per task.

### Closeout

After the owner signs a round, run `wf closeout --baseline TRUSTED_TIP --candidate ROUND_END` with the trust options. It re-runs `wf ci` for each task the round marks Done, at the `baseline_revision` and `verified` revisions its record names; requires, for each milestone the round marks Accepted, an acceptance receipt in the round naming every scenario; and requires the round's end to be an approved baseline, by receipt or derivation. It is read-only: when every step passes it prints the fast-forward of the trusted branch for the operator to run. It needs no model, so the owner or a fresh session can run it.
