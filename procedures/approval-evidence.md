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

A round is one file of unsigned payloads, one per receipt, that the coordinator stages in the signing drop: a directory outside every checkout that the trusted operator names in `$WF_SIGNING_DIR`, as it names `$WF_RECEIPTS` (not the project's `docs/workflow/inbox/`). Call the round `<M-NNNN or T-NNNN>-r<N>` and its file `<round>-unsigned.json`, a JSON array; a new name each time keeps an earlier file, and the brief that describes it, from being signed for a later one. A task's round holds its `verification`, `review` and `integration` payloads, one `governing-change` or `workflow-change` payload per revision listing the protected paths it changes there and, without derived baselines, a `baseline` payload for the commit that marks it Done; a milestone's closing round adds the acceptance, the close's change payload, a `release` payload when it releases, and without derived baselines a `baseline` payload for the round's end. Before asking, the coordinator dry-runs the round (*Unsigned dry runs*), since a refused signature costs the owner another round, and writes a preview of the brief beside it, `wf brief --payloads FILE --repo DIR --baseline APPROVED_SHA --candidate ROUND_END > <round>-brief.md`, then sends one request naming both files, the revisions and what the brief lists under *Needs your judgement*. The brief exits 1 for a payload the gates would reject on its own content (missing fields, a check not passed, a missing required check, a mapped test not run once and passed, a duplicate); whether the gates pass as a whole is the dry run's answer.

The owner renders the brief again with their own launcher, which reads a verified mirror of the repository, from a clone the agent cannot write when they have one (the coordinator's copy is only a preview), reads it and inspects what it points to, then signs every payload in the file whose sha256 heads it, replacing any receipt in `$WF_RECEIPTS` with the same purpose and revision, since duplicates supply nothing. Saved as `sign-round.mjs` outside every checkout and run as `node sign-round.mjs FILE SHA256`:

```js
import fs from 'node:fs';
import { createHash, createPrivateKey, sign } from 'node:crypto';
const [file, digest] = process.argv.slice(2);
const raw = fs.readFileSync(file);
if (createHash('sha256').update(raw).digest('hex') !== digest) throw new Error('not the file the brief describes');
const key = createPrivateKey({ key: fs.readFileSync(process.env.OWNER_SIGNING_KEY), passphrase: process.env.OWNER_SIGNING_PASSPHRASE });
const signed = JSON.parse(raw).map(item => item.payload ?? item).map(payload => ({ payload, signature: sign(null, Buffer.from(JSON.stringify(payload)), key).toString('base64') }));
const same = (a, b) => a.payload.purpose === b.payload.purpose && a.payload.revision === b.payload.revision;
const target = process.env.WF_RECEIPTS;
const kept = (fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, 'utf8')) : []).filter(r => !signed.some(s => same(r, s)));
fs.writeFileSync(`${target}.tmp`, JSON.stringify([...kept, ...signed], null, 2) + '\n', { mode: 0o600 });
fs.renameSync(`${target}.tmp`, target);
```

A round ends the coordinator's session (`execute.md`, *Resume, limits and handoff*): the handoff names the round file.

### Unsigned dry runs

Before staging a round, run the gates it must satisfy with `--unsigned-receipts FILE` beside the trust options. A signed receipt takes precedence over an unsigned payload of the same purpose and revision. A result that relies on an unsigned payload reports `authoritative: false`, lists the payloads it relied on, and exits 3 instead of 0 (a blocked result still exits 1). Exit 3 is never success: authoritative launchers and CI entries never pass the option, and no step treats it as approval. Agents never sign payloads, even with a key of their own: a result under any key but the owner's means nothing.

### Derived baselines

With `approval.derived_baselines: true` in the config at the newest baseline receipt in a revision's history and in the revision's own config (a workflow change, so the owner's receipt enables it; absent or `false` in either keeps every baseline explicit), the revision needs no baseline receipt of its own when everything it changes from that newest approval is already approved by the owner's other receipts. Each changed path, classified by both configs, needs a receipt at a revision where it already had its current content: a `governing-change` receipt listing a governing path, a `workflow-change` receipt listing an enforcement path; complete `verification`, `review` and `integration` receipts the gates accept for a production or generated path (checks passed with their evidence, the profiles' required checks among them, every mapped test run once and passed, a review whose implementer owns a Ready, Active or Done task and whose reviewer owns none), with one such set covering the revision's production content as a whole; any of these for another planning path. Task and feedback records alone need nothing, as a records-only merge in enforced mode needs no owner review. Unclassified paths, a path that could pass for another (a backslash, a control, format or invisible character, unusual whitespace), receipts that do not form one line, an ambiguous newest receipt, a shallow clone, a Git error or records that fail validation prevent derivation; replace refs and grafts are ignored. So the Done record after a signed candidate, and a milestone close whose governing-change receipt lists every path it changes, become baselines without another signature. `wf brief --baseline --candidate` lists what a round changes that no payload covers, and the task records riding along. Derivation checks receipts, not every gate: `wf closeout` re-runs the gates before the trusted branch moves. A derived baseline rests on every receipt since the newest explicit one, so it lapses when the earliest of them expires; sign an explicit baseline before then.

### Milestone rounds

A milestone whose authorised record sets `signing: milestone` collects its signatures in one round at its end; no gate reads the field, which records the owner's choice. The coordinator works through the milestone's tasks on one branch. Each later task records the previous task's Done commit as its `baseline_revision` and is gated against it with `--unsigned-receipts` holding everything staged so far: the earlier tasks' verification, review and integration payloads and, without derived baselines, a `baseline` payload for each Done commit. Exit 3 is expected. The final round holds all of them with the acceptance, the close's change payload and, without derived baselines, a `baseline` payload for the round's end; `wf closeout` then re-runs every task's gate on the signed receipts before the trusted branch moves. The owner signs everything the per-task route signs, later: the pilot's second milestone would have taken two rounds, its authorisation and its close, instead of four. The cost is reworking later tasks if an earlier one is refused. `signing: task`, the default, keeps a round per task.

### Closeout

After the owner signs a round, run `wf closeout --baseline TRUSTED_TIP --candidate ROUND_END` with the trust options; dry-run it with the staged file before asking. It reads a mirror of the clone that Git builds by re-hashing every object, without the clone's config, hooks or caches, so the round's end must be on a branch. It requires a full clone, the local trusted branch at the tip and the round's end to descend from it; in a round that changes production content, no record of a task not Done at the tip removed; the tasks the round marks Done to form one chain from the tip, each gated against the tip or the previous task's work, and `wf ci` to pass again for each at its record's `baseline_revision` and `implemented`; no production or generated change outside those candidates; the owner's acceptance receipt for each milestone the round accepts, and a release receipt for one it releases, naming its own revision as `candidate_revision`; and the round's end to be an approved baseline, by receipt or derivation. It is read-only: when every step passes on signed receipts it prints the fast-forward of the trusted branch, shell-quoted and with the clone's hooks off; a dry run prints none. Every gate reads Git with replace refs, grafts and the commit-graph ignored, the clone's settings that could change an answer or run a program overridden, no fetching and a minimal environment; closeout and `wf brief --repo` also read through the verified mirror, so a rewritten object file fails them. A clone the agent can write still holds the agent's refs and receipts file, so the owner closes out from their own clone when they have one. It needs no model: the fresh session after signing runs it and then that fast-forward, or the owner does; nothing else moves the trusted branch.
