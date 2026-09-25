# Agent-assisted software development workflow

An **unreleased implementation candidate** of the supplied consolidated policy, with assisted execution procedures, record templates and a zero-dependency Node.js 22 validator.

Start with [QUICKSTART.md](QUICKSTART.md). Local tests pass; owner setup (trust key, approval path) and live operational evidence are still required before supported operation (see `procedures/setup.md`).

| Material | Purpose |
|---|---|
| `POLICY.md` | Owner-supplied policy; governs everything else |
| `AGENTS.md`, `CLAUDE.md`, `.agents/skills/workflow/` | Short repository map and shared agent entry |
| `procedures/` | Setup, identity, readiness, execution, review, acceptance/release, approval evidence, maintenance |
| `templates/` | Profile, milestone, task, decision, design, acceptance, review, release, session, setup, pilot, toolbox, feedback and maintenance |
| `SCHEMA.md`, `config.default.json` | Mechanical gates, record formats, limits and path defaults |
| `validator/`, `bin/wf` | Approval/readiness/coverage/lifecycle checks and externally pinned launcher |
| `adapters/` | Read-only explicit-worker identity preflight for terminal GitHub routes |
| `fixtures/`, `validator/test/` | Policy gate cases and adverse acceptance, identity, Git, trust and session tests |
| `docs/proposals/ideas-backlog.md` | Owner ideas awaiting evaluation (no authority) |

The repository holds only the workflow and its tests. Run history (reviews, test output, handoffs) lives on GitHub pull requests and issues, and in git history.

Run `npm test`. Authoritative gates require a provisioned validator, external owner trust key, and explicit signed approval/evidence receipts. Candidate code runs without owner credentials. Local checks alone do not establish protected integration or product acceptance.

Supported execution is **assisted**. An unattended runner is not adopted; runner-specific claims require implementation, adverse-condition fixtures and an observed pilot. Graphify remains deferred optional tooling. Codex and Claude entry adapters are supplied; live instruction discovery must be tested per project and tool version.

Assisted operations now include fixed-catalog central GitHub reporting, a private runtime ledger and optional feedback cadence, plus unsigned Node-test evidence preparation. See [operations](procedures/operations.md). Configuration and live adoption are still required.

The existing `v1.0.0` tag remains unchanged. Review and owner approval must precede a new release/tag and deliberate project adoption. These edits do not silently upgrade PrintFlow or any other project.
