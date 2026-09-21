## Verdict: **PASS** — ready for owner release review

This does not authorise a release or a new pin. I reviewed candidate `f18b046c5d5a792a2fc89602ea6dd475a7c42156` read-only. I could not run the tests or verify that `tests-after.tap` was produced from that commit.

### Blocking findings
None.

### What I checked

**Default target (`bin/wf:9,18-26`).**
- When no argument is exactly `--repo`, the launcher still injects `--repo "$WF_PROJECT_ROOT"`, which is the Git root or the current directory outside Git. This is unchanged from before.
- The test still runs the default case from `cwd:project` (`freshness.test.js:51-52`).
- An empty argument list is safe under `set -u`.

**Explicit target.**
- The arguments are forwarded unchanged.
- The test runs from `cwd:temp`, which has no `docs/workflow/config.json` (`freshness.test.js:54-56`). If `--repo` were ignored, `loadConfig` and the pin comparison (`cli.js:63,65`) would fail, so a pass means the option was honoured.
- `regression-before.tap:39-57` shows this assertion failing before the fix with `duplicate option: --repo`, status 2. `tests-after.tap:361` shows it passing.

**Duplicate and missing options.**
- The launcher only detects `--repo`; the pinned CLI still does the rejecting.
- Two `--repo` options give `duplicate option` (`cli.js:37`).
- A trailing `--repo`, or an empty value, gives `invalid option or missing value` (`cli.js:34`). Both exit 2 and both are asserted (`freshness.test.js:57-60`).
- The exact-token scan cannot misfire. The CLI rejects any option value that starts with `--`, so `--repo` is never a legitimate value.
- The CLI does not support `--repo=DIR`. The launcher injects the default and the CLI then rejects the argument with exit 2.

**Pin integrity (`bin/wf:5-15`).**
- The full-hash check, the `rev-parse --verify` comparison, the `WF_LOCAL` refusal and the `git archive` extraction of the pinned revision are untouched by the diff.
- Wrapper tests 135–137 pass.
- The baseline adoption-pin comparison (`cli.js:65`) now applies to the explicitly selected repository, which is correct.

**Policy.**
- `POLICY.md` is not in the diff.
- The trust-key-outside-repo check and the `--changed` restriction in a trusted gate (`cli.js:72,80`) still apply to whichever repository is selected.
- The new `QUICKSTART.md:19` text matches what the launcher does.

### Nonblocking limitations
1. The default branch where the launcher resolves a Git root is still untested, because the test project directory is not a Git repository. Only the fallback to the current directory is exercised. This gap existed before the change.
2. Duplicate and missing-value rejection depends on the CLI at the pinned revision. The launcher itself does not enforce it. That is acceptable, and the code comment says so.
3. `docs/workflow/tasks/T-0005.md` omits `milestone`, `acceptance`, `governing_baseline_revision` and `feature_readiness`.
   - SCHEMA.md:31 and POLICY §6 (lines 265-275) expect these for production readiness.
   - The snapshot has no root `docs/workflow/config.json`, so nothing validates this record.
   - The owner should fill these in before release rather than treat their absence as a defect in the fix.
   - The record's `baseline_result: pass` is consistent with the evidence, because the failing test was new.
4. The record's claim of owner authorisation is the implementer's statement and cannot be verified from this snapshot. The owner should confirm it.
5. `review.json` and `review.stderr` are empty, so no prior review result exists.
6. The test gives 0 for the default case. If run inside a Git checkout whose root lacks a workflow config, the default would resolve to that root and fail, as documented.
