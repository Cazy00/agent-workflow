---
description: "Check native planning context and one selected task projection"
handoffs: []
---

Experimental candidate; only an explicitly authorised non-production pilot may use it before release/adoption. Use the trusted adopted `adapters/speckit.mjs`, never a candidate-selected executable. Run `check-install` with `--repo`, literal `--integration __AGENT__`, protected `--lock`, and trusted isolated `--python`. Then run `context` with the same repository/integration/Python, exact freshly fetched `--baseline`, and explicit `--feature docs/specs/<slug>`. Stop on mismatches, stale profile/policy binding or persistent `.specify/feature.json`.

For a supplied explicit T-NNNN, run `check-projection` with `--task` and those same context arguments. If missing, `project` creates only the ignored view; if differing, preserve edits through explicit `project --regenerate` and recheck. Do not choose a task, import checkbox edits, change native progress, or start implementation. Without a task, report context only. Return paths/digests and blockers, not full source dumps. These are local integrity checks; use native readiness, independent review and owner approval for authority.
