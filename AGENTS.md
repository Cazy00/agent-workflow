# Agent workflow repository

Read `README.md`, the relevant procedure in `procedures/`, and the current task or maintenance record. `POLICY.md` is the reference supplied by the owner; it governs over schema, procedures, templates, examples, generated indexes, and historical material. `SCHEMA.md` describes mechanical checks and their limits.

This repository maintains the workflow itself. Workflow changes need independent review and owner approval before release; a working agent must not weaken its own rules. Local changes do not publish or adopt a new version in other projects.

- Shared entry: `.agents/skills/workflow/SKILL.md`; Claude entry: `CLAUDE.md`.
- Setup and identity: `procedures/setup.md`, `procedures/identity.md`; model-free scaffold: `bin/wf-adopt`.
- Readiness and implementation: `procedures/readiness.md`, `procedures/execute.md`.
- Review, acceptance, release: `procedures/review.md`, `procedures/accept-release.md`.
- Deployment, incidents, maintenance, upgrades: `procedures/operate.md`.
- Feedback and maintenance: `procedures/maintenance.md`.
- Validation: `npm test`; command usage: `QUICKSTART.md`. Owner view: `wf status` (derived, read-only); adopting projects also get it as a pinned GitHub issue from `templates/github/wf-status.yml`.
- Reusable records: `templates/`. Run evidence, reviews and handoffs go on the task's GitHub pull request or issue, never into the repository; `npm test` enforces this.
- Owner ideas awaiting evaluation (no authority): `docs/proposals/ideas-backlog.md`.

Default to one coordinator. Independent review uses a separate context and canonical sources, without the implementer's conversation. Preserve task-prefixed checkpoints and an explicit session outcome. Remove a task record once its work is merged; the pull request is the permanent record. Never infer approval from a task field, Git author, process exit, or branch name. Do not publish using an owner account when worker credentials fail.
