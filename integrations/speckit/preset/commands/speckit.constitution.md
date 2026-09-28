---
description: "Check or propose the source-bound native authority pointer"
handoffs: []
---

Experimental candidate; only an explicitly authorised non-production pilot may use it before release/adoption. Read AGENTS.md, the trusted workflow skill and applicable native maintenance/readiness procedure. POLICY.md governs. The installed constitution is a generated pointer, not an editable policy copy.

Use the trusted adopted `adapters/speckit.mjs` with explicit `--repo`, exact freshly fetched `--baseline`, trusted isolated `--python` and literal `--integration __AGENT__`. Run `activate` for that integration, then `check-install` with the protected `--lock`. Stop: an unknown installation, changed instruction bytes or missing authority source cannot be repaired by changing hashes to bless it.

Run `propose-authority` with those same arguments. It validates the existing baseline policy/profile binding and reads the current proposed profile; it returns JSON containing generated pointer, metadata and protected lock bytes without writing the project. Save that proposal outside the repository. If unchanged, report the existing pointer without rewriting. If changed, review those exact bytes in the same native governing change as the profile. No separate owner bookkeeping approval is introduced. Current planning remains blocked until the governing change is approved and adopted as the exact baseline. Core upgrades and unknown instruction changes need their separate reviewed update route.

Do not edit or ratify policy, resolve reserved decisions, grant readiness, sign or approve from this command. A pointer, digest, Git author or command success grants no authority. No hooks, workflow runner or automatic handoffs. Before a checkpoint, restore `activate --integration codex` and inspect the diff; never commit runtime switching differences. Use the native session outcome procedure.
