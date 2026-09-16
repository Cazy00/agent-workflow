# Agent workflow repository

Read `README.md`, the relevant procedure in `procedures/`, and the current task or maintenance record. `POLICY.md` is the reference supplied by the owner; it governs over schema, procedures, templates, examples, generated indexes, and historical material. `SCHEMA.md` describes mechanical checks and their limits.

This repository maintains the workflow itself. Workflow changes need independent review and owner approval before release; a working agent must not weaken its own rules. The current local conformance work is authorised by the owner's request recorded in `docs/audit/conformance.md`. That does not publish or adopt a new version in other projects.

- Shared entry: `.agents/skills/workflow/SKILL.md`; Claude entry: `CLAUDE.md`.
- Setup and identity: `procedures/setup.md`, `procedures/identity.md`.
- Readiness and implementation: `procedures/readiness.md`, `procedures/execute.md`.
- Review, acceptance, release: `procedures/review.md`, `procedures/accept-release.md`.
- Feedback and maintenance: `procedures/maintenance.md`.
- Validation: `npm test`; command usage: `QUICKSTART.md`.
- Reusable records: `templates/`; operational evidence and limitations: `docs/audit/`.

Default to one coordinator. Independent review uses a separate context and canonical sources, without the implementer's conversation. Preserve task-prefixed checkpoints and an explicit session outcome. Never infer approval from a task field, Git author, process exit, or branch name. Do not publish using an owner account when worker credentials fail.
