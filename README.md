# agent-workflow

The versioned workflow repository for agent-assisted software development (POLICY §11).

| File | Role |
|---|---|
| `POLICY.md` | The reference policy (v1.0) |
| `SCHEMA.md` | Record formats and the exact gate rules the validator checks |
| `QUICKSTART.md` | Daily procedure: adopt, start, resume, checkpoint, hand off, report friction |
| `templates/` | Profile, task, decision, checkpoint, feedback |
| `config.default.json` | Default settings and path classification for a project |
| `bin/wf` | Project entry point (copied to `scripts/wf`); runs the pinned validator |
| `validator/` | Zero-dependency Node 22 validator; `npm test` runs its fixtures |
| `fixtures/` | The regression cases POLICY §11 requires, one directory each |

Projects adopt a tag and record its commit in `docs/workflow/config.json`. Changes here go through a
reviewed pull request and a new tag; projects upgrade deliberately.
