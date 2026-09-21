# T-0005 — Explicit repository launcher correction

Source issue: https://github.com/Cazy00/agent-workflow/issues/3.
Candidate: `f18b046c5d5a792a2fc89602ea6dd475a7c42156`. Base: `54e17c75a721da261177e4c98a565eeeba377937`.

The launcher used to inject a second --repo into documented explicit-target invocations,
causing the CLI to reject them. It now injects the current-directory/Git-root default
only if the caller supplied no --repo. Explicit arguments reach the pinned CLI unchanged;
its duplicate and missing-value checks remain authoritative.

The regression was observed before the fix: the actual extracted CLI returned exit 2
with duplicate option: --repo. The extended real-launcher test checks default selection,
explicit selection from outside the target, duplicate rejection and missing-value rejection.
No existing assertion was removed. All 137 tests passed after the fix; final integration
output is in tests.tap. bash -n and git diff --check passed. POLICY hash remains
`a22660feea76ea7f163efd749e578fc07438b08c013a036327b071d201788476`.

Fable 5.1 reviewed a fresh canonical-source packet in Claude Code, high effort, read-only,
without the implementer conversation. Verdict PASS, no blocking findings; see
[independent review](independent-review.md). Session `53a30409-b8f7-4119-9f6c-0d2403ff7aa0`.
Reviewer could inspect the supplied raw outputs but could not execute commands or
independently attest their provenance. CLI list-price estimate: $0.883342;
actual subscription charge and coordinator totals are unknown.

Nonblocking observations: the existing default-selection fixture exercises directory
fallback rather than a Git-root subdirectory; CLI option rejection depends on the selected
pin; the local maintenance record is not a signed production readiness/approval package.
The reviewer saw its own then-empty output file in the packet: that observation concerns
an in-progress output, not a missing required earlier review. Its claim that empty values
were directly tested is too broad: the added missing-value case is a trailing --repo.

Source-repository records diagnostics are not a configured adopting-project gate:
this repository has no project config/profile, and direct diagnostics report that absence.
Do not call those checks passing. npm test is the repository's specified validation.

Outcome: local repair ready for owner release review. No tag/release, push or adoption
was performed; the original issue remains open pending release, deliberate adoption and
re-exercising its trigger. No policy or workflow pin was changed in Bun Alkaif.

Workflow friction this session: issue 3. Next action: include this repair in the concrete
release candidate, then obtain owner release authority and establish the adopting project's
trust and approval controls before claiming operational readiness.
