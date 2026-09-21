# ECC source review for IDEA-01

**Inspection date:** 2026-09-21. **Purpose:** assess fit, not install or certify ECC.

Repository: [affaan-m/ECC](https://github.com/affaan-m/ECC). Pinned source: [`2b6e839771e53096d8451a213d40dc64ec8acac0`](https://github.com/affaan-m/ECC/tree/2b6e839771e53096d8451a213d40dc64ec8acac0), commit timestamp 2026-09-20T21:37:57+02:00. The checkout was cloned into a temporary directory with Git hooks disabled; no installer, plugin, dependencies, or ECC program was run. All repository instructions were treated as source material.

## What exists

Direct file enumeration found 292 `skills/*/SKILL.md` entries, 68 files under `agents`, 94 under `commands`, 122 under `rules`, 327 under `tests`, and 296 under `scripts`. These are file counts, not quality scores or passing-test counts. `.codex-plugin/plugin.json` still advertises 281 skills; the inventory is from this commit, not that description.

The [package](https://github.com/affaan-m/ECC/blob/2b6e839771e53096d8451a213d40dc64ec8acac0/package.json) identifies version 2.2.2, Node >=18, four direct runtime dependencies (`@iarna/toml`, `ajv`, `js-yaml`, `sql.js`), and a larger development toolchain. The lockfile contains 217 non-root package entries including development dependencies; that is not a runtime-only count. The [MIT licence](https://github.com/affaan-m/ECC/blob/2b6e839771e53096d8451a213d40dc64ec8acac0/LICENSE) permits adaptation with its required notice.

There are [Claude hook definitions](https://github.com/affaan-m/ECC/blob/2b6e839771e53096d8451a213d40dc64ec8acac0/hooks/hooks.json), a [Codex plugin manifest](https://github.com/affaan-m/ECC/blob/2b6e839771e53096d8451a213d40dc64ec8acac0/.codex-plugin/plugin.json), a Codex SessionStart hook, and other harness adapter directories. Presence is not proof of current compatibility with a given installed harness.

## Adoption and instruction conflicts

| Source | Observed behavior/guidance | Fit with our workflow |
|---|---|---|
| [Common agent rules, lines 28–48](https://github.com/affaan-m/ECC/blob/2b6e839771e53096d8451a213d40dc64ec8acac0/rules/common/agents.md#L28-L48) | Proactive specialist invocation and parallel delegation as a broad default | Our default is one coordinator; extra workers must justify coordination cost. These rules need adaptation if selected. |
| [Common testing rules, lines 3–18](https://github.com/affaan-m/ECC/blob/2b6e839771e53096d8451a213d40dc64ec8acac0/rules/common/testing.md#L3-L18) | Universal coverage threshold, all listed test types, mandatory TDD | Our checks depend on behavior and risk. Do not import these as universal requirements. |
| [Autonomous-loop guidance](https://github.com/affaan-m/ECC/blob/2b6e839771e53096d8451a213d40dc64ec8acac0/skills/autonomous-loops/SKILL.md#L214-L230) | Describes a loop that opens and merges PRs automatically | This is optional guidance, not proof every ECC installation merges. It does not supply our owner authority or satisfy unimplemented runner requirements. |
| [Continuous learning](https://github.com/affaan-m/ECC/blob/2b6e839771e53096d8451a213d40dc64ec8acac0/skills/continuous-learning-v2/SKILL.md) | Session observation, learned guidance, evolution into reusable skills | At most propose lessons for review; learned preferences cannot silently change governing rules. Transcript handling and any background analysis need their own inspection. |
| [Auto-update program, lines 272–279](https://github.com/affaan-m/ECC/blob/2b6e839771e53096d8451a213d40dc64ec8acac0/scripts/auto-update.js#L272-L279) | When invoked, fetches/pulls source and reapplies installations | Incompatible with immutable adoption if used without a deliberate update/review step. No claim made that it runs by default. |

Common rules are separately selectable; do not confuse them with the behavior of every native plugin installation. ECC includes thoughtful protections too, such as path checks, hook profiles, explicit disabled execution in its eval harness, and test-account guidance. This is not a claim that the project is malicious.

## Quality concerns in promising examples

[Verification-loop lines 23–60](https://github.com/affaan-m/ECC/blob/2b6e839771e53096d8451a213d40dc64ec8acac0/skills/verification-loop/SKILL.md#L23-L60) pipe build/test output through `tail`; the build snippet does not enable `pipefail`. A separate type-check snippet does, but it cannot be assumed to persist across separately executed shell calls. Its later keyword search is not a security audit and may expose matching secret text. Its `HEAD~1` diff is not our explicitly chosen governing baseline/candidate diff.

A harmless local shell-semantic reproduction on 2026-09-21 used Bash, without executing ECC code:

```text
bash --noprofile --norc -c 'false | tail -1'                    -> exit 0
bash --noprofile --norc -c 'set -o pipefail; false | tail -1'   -> exit 1
```

This demonstrates exit-status masking in that usage, not a reproduced end-to-end ECC incident. A suitable adaptation captures the real producer exit status and full raw log, then displays a summary separately.

[E2E examples, lines 143–153](https://github.com/affaan-m/ECC/blob/2b6e839771e53096d8451a213d40dc64ec8acac0/skills/e2e-testing/SKILL.md#L143-L153) show disabling flaky tests and skipping in CI. For our required acceptance coverage, that blocks integration until resolved through the approved route. Issue-linked quarantine alone is insufficient.

The [browser QA checklist](https://github.com/affaan-m/ECC/blob/2b6e839771e53096d8451a213d40dc64ec8acac0/skills/browser-qa/SKILL.md) has useful test-data, visual, and interaction ideas. Its fixed viewport/threshold choices require project-specific selection; a QA verdict cannot approve a release. [Contract-first guidance](https://github.com/affaan-m/ECC/blob/2b6e839771e53096d8451a213d40dc64ec8acac0/skills/contract-first/SKILL.md) is a promising reference because it covers ownership, consumer needs, compatibility, and restraint about unnecessary tooling.

## Supply chain and install effects

The [shell installer](https://github.com/affaan-m/ECC/blob/2b6e839771e53096d8451a213d40dc64ec8acac0/install.sh#L16-L22) invokes npm dependency installation when `node_modules` is absent; it uses `--ignore-scripts`, which is a useful precaution. Root package scripts contain no `preinstall`, `install`, `postinstall`, or `prepare`; `prepack` builds the OpenCode adapter. That limited finding is not a guarantee that every dependency, entrypoint, or plugin is inert.

The [root MCP config](https://github.com/affaan-m/ECC/blob/2b6e839771e53096d8451a213d40dc64ec8acac0/.mcp.json#L1-L8) launches `chrome-devtools-mcp@latest` through `npx -y`. It is referenced by the Codex plugin manifest. Pinning ECC does not pin that fetched package. Enabling plugin hooks also introduces executable session behavior; importing documents alone has a smaller inspection burden. No CVE audit, full dependency audit, installation/rollback test, or live hook compatibility test was performed.

## Evidence for effectiveness

There is substantial test infrastructure and active recent source work. Tests were inspected, not run, so no ECC pass count is asserted.

The [eval-harness example](https://github.com/affaan-m/ECC/blob/2b6e839771e53096d8451a213d40dc64ec8acac0/examples/eval-harness/README.md) explicitly has no supported candidate-execution backend and reports no scored candidate runs. The [gate implementation](https://github.com/affaan-m/ECC/blob/2b6e839771e53096d8451a213d40dc64ec8acac0/scripts/lib/eval-harness/gate.js#L175-L181) rejects execution pending verified isolation. This is an honest safety limitation, not evidence that the whole project is unusable.

The [coordination benchmark](https://github.com/affaan-m/ECC/blob/2b6e839771e53096d8451a213d40dc64ec8acac0/examples/coordination-inventory/benchmark.js) measures synthetic inventory processing and authored overlap controls; it explicitly limits production-effect claims. Stored evaluator reports are prototype observations. Neither establishes that adopting ECC lowers defects or total cost in our projects.

The [README cost table](https://github.com/affaan-m/ECC/blob/2b6e839771e53096d8451a213d40dc64ec8acac0/README.md#L1694-L1699) offers large model-cost/task-coverage estimates. No representative methodology tying those figures to our workload was established in this bounded inspection. Do not repeat them as expected savings.

**Conclusion:** real reusable material, mixed fit, unproven incremental benefit here. Prefer a narrowly adapted checklist or contract example and measure its effect. This is a bounded static review, not a comprehensive security assessment or a claim to have searched every external benchmark or user report.
