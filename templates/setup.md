# Workflow setup — SETUP-0000

Profile, repository, workflow tag and immutable revision:
Owner authority for setup:
Start, two-working-day timebox (or approved alternative), agent allowance (default half a working day across the agent steps), usage per step:

| Control | Evidence and outcome |
|---|---|
| Source precedence and relevant project readiness | |
| Personal repository owner verified | |
| Accounts: worker username verified, or one account recorded as the owner's choice | |
| With a worker: separate clones; author, Git transport and API identities | |
| With a worker: per-route credentials, no owner fallback | |
| Tool entry discovery, for each tool the owner uses (Claude Code, Codex) | |
| Protected requirements, decisions, acceptance, enforcement, CI, CODEOWNERS | |
| Plan support (rulesets available or not), admin restrictions, stale approvals, no bypass (`wf-protect` read-back) | |
| Trusted validator revision and external trust anchor | |
| Approval mode (owner-merge with its checkpoint, manual, enforced) and what it does not prove | |
| Acceptance mapping and reporter | |
| Required checks in the profile; each a required status check, branches up to date | |
| Shared project, if any: each person's worker and tools, `CODEOWNERS`, who approves what and when one is away | |
| Setup check: `wf records` and `wf next` on the committed setup (the release's tests ran the fixtures) | |
| Before enforced: protection read-back, or the real approval-path exercise | |
| Observed pilot | |

## Owner-controlled bootstrap
What was allowed; who performed it; when normal protections became active:

## Supported scope and limitations
Execution mode: assisted. Runner not adopted. Optional navigation tools deferred.
Remaining controls, owner, required-before stage and evidence needed:

Optional Spec Kit pilot: see `procedures/speckit.md` in the trusted workflow installation. Record the exact reviewed adapter/core/upstream pins, isolated Python, complete staged diff, actual profile binding, ignore rules, rollback/recovery evidence and fresh Codex/Claude observations. Default remains disabled; a scaffold or passing package test does not approve adoption.
