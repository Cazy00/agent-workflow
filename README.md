# Agent-assisted software development workflow

Release **v1.2.0** of the supplied consolidated policy: assisted execution procedures, record templates, a one-command adoption scaffold, required project checks, an owner status view that adopting projects also get as a pinned GitHub issue, and a zero-dependency Node.js 22 validator. Reviewed in an independent context and approved by the owner before tagging.

Start with [QUICKSTART.md](QUICKSTART.md): run `bin/wf-adopt` against the project, then follow `procedures/setup.md`, whose steps say which are the owner's and which the agent's. A project starts in `manual` approval mode and switches to `enforced` once its GitHub protections and approval-path test are verified. Live operational evidence (a pilot on a real project) is still owed for this release.

| Material | Purpose |
|---|---|
| `POLICY.md` | Owner-supplied policy; governs everything else |
| `AGENTS.md`, `CLAUDE.md`, `.agents/skills/workflow/` | Short repository map and shared agent entry |
| `procedures/` | Setup, identity, readiness, execution, review, acceptance/release, approval evidence, operation (deploy, incidents, maintenance, upgrades), maintenance |
| `templates/` | Profile, milestone, task, decision, design, acceptance, review, release, session, setup, pilot, toolbox, feedback and maintenance; `claude/agents/` holds the Claude Code independent-reviewer subagent and `github/` the status-issue workflow |
| `SCHEMA.md`, `config.default.json` | Mechanical gates, record formats, limits and path defaults |
| `validator/`, `bin/wf` | Approval/readiness/coverage/lifecycle checks, the derived `status` view, and externally pinned launcher |
| `bin/wf-adopt` | Deterministic, model-free scaffold that adopts the workflow in a project and writes the owner checklist, for one owner or, with `--owner`, a project two or more people share |
| `adapters/` | Read-only explicit-worker identity preflight for terminal GitHub routes |
| `fixtures/`, `validator/test/` | Policy gate cases and adverse acceptance, identity, Git, trust and session tests |
| `docs/proposals/ideas-backlog.md` | Owner ideas with their verdicts and implementation notes (no authority) |

The repository holds only the workflow and its tests. Run history (reviews, test output, handoffs) lives on GitHub pull requests and issues, and in git history.

Run `npm test`. Authoritative gates require a provisioned validator and either verified GitHub enforcement (`enforced` mode, no key) or an external owner trust key with signed receipts (`manual` mode). Candidate code runs without owner credentials. Local checks alone do not establish protected integration or product acceptance.

Supported execution is **assisted**. An unattended runner is not adopted; runner-specific claims require implementation, adverse-condition fixtures and an observed pilot. Graphify remains deferred optional tooling. Codex and Claude entry adapters are supplied; live instruction discovery must be tested per project and tool version.

Assisted operations include fixed-catalog central GitHub reporting, a private runtime ledger and optional feedback cadence, plus unsigned Node-test evidence preparation ([operations](procedures/operations.md)); what happens after release is in [operate](procedures/operate.md). Their per-project configuration is part of setup.

Releases are tags: `v1.0.0` (the version PrintFlow runs), `v1.1.0` and `v1.2.0`. Review and owner approval precede every tag, and a project adopts a release only by changing its own pin; a new tag never upgrades a project by itself.
