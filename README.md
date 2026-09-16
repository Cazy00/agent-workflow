# Agent-assisted software development workflow

An **unreleased implementation candidate** of the supplied consolidated policy, with assisted execution procedures, record templates and a zero-dependency Node.js 22 validator.

Start with [QUICKSTART.md](QUICKSTART.md). The full [conformance report](docs/audit/conformance.md) distinguishes local verification from controls that still require owner setup and live operational evidence.

| Material | Purpose |
|---|---|
| `POLICY.md` | Exact supplied reference; its original proposed status is preserved |
| `AGENTS.md`, `CLAUDE.md`, `.agents/skills/workflow/` | Short repository map and shared agent entry |
| `procedures/` | Setup, identity, readiness, execution, review, acceptance/release, approval evidence, maintenance |
| `templates/` | Profile, milestone, task, decision, design, acceptance, review, release, session, setup, pilot, toolbox, feedback and maintenance |
| `SCHEMA.md`, `config.default.json` | Mechanical gates, record formats, limits and path defaults |
| `validator/`, `bin/wf` | Approval/readiness/coverage/lifecycle checks and externally pinned launcher |
| `adapters/` | Read-only explicit-worker identity preflight for terminal GitHub routes |
| `fixtures/`, `validator/test/` | Policy gate cases and adverse acceptance, identity, Git, trust and session tests |
| `docs/audit/` | Findings, independent review disposition, test output and live read-only setup evidence |

Run `npm test`. Authoritative gates require a provisioned validator, external owner trust key, and explicit signed approval/evidence receipts. Candidate code runs without owner credentials. Local checks alone do not establish protected integration or product acceptance.

Supported execution is **assisted**. An unattended runner is not adopted; runner-specific claims require implementation, adverse-condition fixtures and an observed pilot. Graphify remains deferred optional tooling. Codex and Claude entry adapters are supplied; live instruction discovery must be tested per project and tool version.

The existing `v1.0.0` tag remains unchanged. Review and owner approval must precede a new release/tag and deliberate project adoption. These edits do not silently upgrade PrintFlow or any other project.
