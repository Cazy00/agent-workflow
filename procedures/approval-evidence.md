# Explicit approval evidence

## Enforced mode

POLICY § 7 accepts a record on the authoritative branch as approval evidence when the verified protection configuration makes that inference valid. That is `enforced` mode, the owner's chosen default (IDEA-10, 2026-09-25). Before switching to it, the setup record must show, from steps 5 and 9 of `setup.md`: a ruleset or branch protection on the trusted branch requiring a pull request, code-owner review, the `wf ci` check and each check in the profile's `required_checks`, with branches up to date before merging, stale reviews dismissed, administrators included and no worker bypass; `CODEOWNERS` covering every governing and enforcement path, including itself, `docs/workflow/config.json` and the profile, and every path in a shared project (`setup.md`); the CI entry point running the pinned validator from protected configuration; and an approval-path test in which a worker push and an unapproved protected change were rejected and an approved change was admitted. Then set `approval.label` in `docs/workflow/config.json` and `approval_label` in the profile to `enforced` in one code-owner-reviewed pull request.

In enforced mode the fetched authoritative baseline is the approved baseline and no key is needed. The checker still verifies records, classification, readiness, scope, freshness and acceptance mappings; whatever would come from a receipt (test execution, the independent review, the integration rerun, acceptance, release) it lists as `unverified` in its output instead of failing. That list is what the owner's review of the pull request must cover, and the independent review posted there is the evidence for it. Supplying the trust options runs the full receipt gate instead, exactly as in manual mode; there is no hybrid. A candidate cannot switch the mode, because config and profile are read from the baseline and code owners protect them. If the protections are later found lacking, switch back to `manual`; that is a workflow change and is reviewed as one.

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
