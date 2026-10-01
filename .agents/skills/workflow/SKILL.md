---
name: workflow
description: Execute an authorised software milestone using durable records, readiness gates, independent review, and owner acceptance.
---

Read the repository `AGENTS.md`, then run `wf next`: it names the next action, the records and the one procedure to read for it, and the commands to run. Read those and nothing else unless one of them points further. The table maps actions to procedures when `wf next` cannot run (no records yet, or setup):

| Action | Procedure |
|---|---|
| Adopt or verify setup | `procedures/setup.md` and `procedures/identity.md` |
| Use an explicitly adopted Spec Kit planning frontend | `procedures/speckit.md`, then the native action procedure |
| Discover, resolve or assess readiness | `procedures/readiness.md` |
| Implement, checkpoint or recover | `procedures/execute.md` |
| Work in a project with two or more owners | `procedures/shared.md`, with the procedure for the action |
| Use approved local batches or routine integration delegation | `procedures/delivery.md` |
| Review candidate and test fidelity | `procedures/review.md` |
| Present, accept or release | `procedures/accept-release.md` |
| Stage, dry-run or close a manual-mode signing round | `procedures/approval-evidence.md` |
| Deploy, handle an incident, maintain or upgrade | `procedures/operate.md` |
| Report or maintain workflow | `procedures/maintenance.md` and `procedures/operations.md` |

Paths above are relative to the workflow repository; adopting projects keep this folder and the procedures together under their recorded workflow installation and point their short repository guide there.

A session reads the repository guide and what `wf next` names, one procedure and the records for its action, three to four thousand words; read nothing else unless one of them points to it. Use approved sources directly. Derived indexes never supply authority. An expected safeguard is not a defect. Post a session outcome and handoff on the task's GitHub pull request or issue (without either, in manual mode, beside the signing round in the signing drop) even for read-only work, blockers, limits or execution failures. Never commit logs, transcripts or handoff files. Skills supply a procedure, not extra authority.
