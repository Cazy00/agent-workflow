# Agent-assisted software development workflow

Version **v2.0.0** of the supplied consolidated policy: assisted execution procedures, record templates, a one-command adoption scaffold and upgrade, required project checks, an owner status view that adopting projects also get as a pinned GitHub issue, support for two or more people who share a project with their own agents, milestone planning with work found along the way kept as records, and a zero-dependency Node.js 22 validator. Independent review and owner approval are required before tagging; a version in an unmerged branch is a release candidate, not a released or adopted version. What each release changed is in [CHANGELOG.md](CHANGELOG.md).

Start with [QUICKSTART.md](QUICKSTART.md): inspect an existing setup with `bin/wf-adopt --inspect --project PATH`, then run `bin/wf-adopt` (or the setup page, `bin/wf-setup`) against the project, then follow `procedures/setup.md`, whose steps say which are the owner's and which the agent's. A single-owner project starts in `owner-merge` mode, where the owner chooses when the agent stops for them (at each milestone by default, at every change, or when the authorised plan is done); a shared project starts in `manual` mode, with signed receipts; either can switch to `enforced` once it has a worker account and its GitHub protections are verified. The quality gates are the same in every mode. The optional Spec Kit adapter is experimental and uncertified.

| Material | Purpose |
|---|---|
| `POLICY.md` | Owner-supplied policy; governs everything else |
| `AGENTS.md`, `CLAUDE.md`, `.agents/skills/workflow/` | Short repository map and shared agent entry |
| `procedures/` | Setup, identity, readiness, execution, shared projects, review, acceptance/release, approval evidence, operation (deploy, incidents, maintenance, upgrades), maintenance |
| `templates/` | Profile, milestone, task, decision, design, acceptance, review, release, session, setup, pilot, toolbox, feedback, maintenance and delivery evidence; `claude/agents/` holds the Claude Code independent-reviewer subagent and `github/` the `wf ci`, status-issue and client-page workflows |
| `SCHEMA.md`, `config.default.json` | Mechanical gates, record formats, limits and path defaults |
| `validator/`, `bin/wf` | Approval/readiness/coverage/lifecycle checks, the derived `status` view, and externally pinned launcher |
| `bin/wf-adopt`, `bin/wf-setup` | The model-free scaffold that adopts the workflow and writes the owner checklist; a local page that asks its questions in plain words and edits the settings later |
| `bin/wf-upgrade`, `upgrades.json` | Moves a project's pin and removes what the releases in between left behind; reports first, never commits |
| `bin/wf-protect`, `bin/wf-sign` | The owner's GitHub protections in one command, with a read-back; the owner's signing key and round signing in manual mode |
| `adapters/` | Setup, upgrade, protection and identity helpers, and the experimental Spec Kit adapter (`procedures/speckit.md`) |
| `fixtures/`, `validator/test/` | Policy gate cases and adverse acceptance, identity, Git, trust and session tests |
| `docs/proposals/ideas-backlog.md` | Owner ideas with their verdicts and implementation notes (no authority) |

The repository holds only the workflow and its tests. Run history (reviews, test output, handoffs) lives on GitHub pull requests and issues, and in git history.

Run `npm test`. Authoritative gates require a provisioned validator and either verified GitHub enforcement (`enforced` mode, no key) or an external owner trust key with signed receipts (`manual` mode); `owner-merge` mode runs the same gates but proves nothing about who merged. Candidate code runs without owner credentials. Local checks alone do not establish protected integration or product acceptance. `wf review-packet` prepares fixed canonical review inputs; `wf delivery-check` checks CI for the exact delivered revision; both are read-only.

Supported execution is **assisted**. An unattended runner is not adopted; runner-specific claims require implementation, adverse-condition fixtures and an observed pilot. Codex and Claude entry adapters are supplied; live instruction discovery must be tested per project and tool version. What happens after release is in [operate](procedures/operate.md). Comparative time, usage and quality gains still need the benchmark in `templates/pilot.md`.

A project adopts a release only by moving its pin (`bin/wf-upgrade`); a new tag never upgrades a project by itself.
