# Fewer delivery round trips

Keep one coordinator and independent review. Group related edits and checks inside a coherent task; a checklist item is not a new planning or review cycle. One pull request carries one task. For fewer owner stops, an owner-merge project chooses its checkpoint (`approval-evidence.md`, *Owner-merge mode*); in manual mode, signing rounds and milestone rounds do the same for receipts.

## Avoid repeated CI and owner work

Keep the required workflow check running on both PR and main/push events. Use the trusted classifier on the actual before/after commits to skip expensive product steps only when every changed path is planning-only; continue record, workflow and applicable documentation checks. Unknown paths, enforcement, dependencies, code and generation inputs require the relevant full checks. Do not use whole-workflow path exclusions that strand required checks, or optimize only the PR side while every bookkeeping merge repeats the full main suite. Verify the fast path with one records-only and one production change on both events before adopting it.

Measure approvals, CI runs and runner-minutes per accepted outcome, including review findings, rework and defects. A smaller PR count is not itself a quality or cost improvement. Use the next comparable task's benchmark in `templates/pilot.md`.
