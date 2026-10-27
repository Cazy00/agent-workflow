# MAINT-0021: review what needs it, once, by another vendor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task by
> task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The workflow's review rule matches the owner's review policy of 2026-10-18:
- a test-only change needs no review;
- the reviewer is from another vendor at every level;
- one review on the final code;
- a fix check only after a blocking finding at deep or milestone, and no round three;
- a project can name one reviewer command that picks the model for each level.

**Architecture:**
- **Validator:** gains a `none` level for test-only production changes, an optional vendor pair in
  the review evidence, and an optional `review.reviewer_command` template.
- **Briefs and budget:** the briefs and the budget in `wf next` read `review.reviewer_command`
  when it is set, and `review.second_model` otherwise, so existing projects keep working.
- **Text:** procedures, policy, templates and schema say the new rule.

The release is v2.10.0. Every change is additive, so existing evidence and configs stay valid.

**Tech Stack:** Node ≥ 22, ES modules, `node --test`, no dependencies (as the validator).

**Spec:** the owner's review policy, recorded in Cazy00/workspace at
`docs/superpowers/specs/2026-10-17-review-policy-design.md` (approved 2026-10-18), §§ 4, 5.3, 6 and
8.1. This repository stays self-contained (modularity), so the rule is written here in full and
cites nothing outside it. `docs/proposals/MAINT-0021-review-policy.md` (Task 5) records the
evidence and the owner's approval.

## Global Constraints

- **Levels**, exactly these words: `none`, `light`, `standard`, `deep`. `none` is valid only for a
  test-only change.
- **A test-only change** is one where:
  - every production path is a test path: under a `test/`, `tests/` or `__tests__/` folder, or a
    test file by `isTestPath`;
  - no path is an owner-approved acceptance test (`paths.acceptance_tests`);
  - no path is deep by `review.deep_paths`.
- **Severity words:** blocking / should fix / note. The validator keeps `blocking|critical|high`
  as blocking (`isBlocking`).
- **`review.reviewer_command`:**
  - a single line of printable text, at most 300 characters, containing `{role}`;
  - `{level}` is optional;
  - roles by level: light→`cheap`, standard→`standard`, deep→`strong`, fix check→`fixcheck`,
    milestone→`milestone`.
- **Budget with `reviewer_command`:** one run per light or standard task, two per deep task (the
  review and one fix check), two for the milestone. Without it, today's second-model budget is
  unchanged.
- **No fallback to the implementer's own tool** in any new text. The reviewer is another vendor's;
  if none can run, the review is missing and the gate stops.
- **The vendor check:** when `review.vendor` and `review.implementer_vendor` are both given, they
  must differ (case-insensitive). Both are optional in `delivery-evidence@1`.

## Review Focus

1. **A test-only change that also touches an acceptance test** must still need a review. Pinned
   in Task 1 by `MAINT-0021: an acceptance test change is never test-only`.
2. **A test file that a deep glob names**, such as `**/*numbering*.test.ts` against a glob that
   names tests, must still need a deep review, not `none`. Pinned in Task 1 by
   `MAINT-0021: a deep test path is not test-only`.
3. **Evidence that says `level: none` on a change with product code** must fail, saying why.
   Pinned in Task 1 by `MAINT-0021: level none on product code fails`.
4. **A `reviewer_command` with a newline or without `{role}`** must be refused at config load,
   so a brief never prints a broken or injected command. Pinned in Task 3's config test.
5. **A project with both `second_model` and `reviewer_command`**: the briefs and the budget follow
   `reviewer_command`, and the `final_model` refusal still applies to a task review that names it.
   Pinned in Task 3 by `MAINT-0021: reviewer_command wins over second_model in briefs and budget`.

---

### Task 1: `none` for test-only changes

**Files:**
- Modify: `validator/lib/paths.js` (export a new `isTestOnlyPath`)
- Modify: `validator/lib/delivery-evidence.js` (`REVIEW_LEVELS`, `evidenceErrors`)
- Modify: `validator/lib/ci.js` (the `covered` block near lines 170–196)
- Create: `validator/test/maint-0021.test.js`

**Interfaces:**
- Produces:
  - `isTestOnlyPath(p: string) -> boolean`: true for a path under a `test/`, `tests/` or
    `__tests__/` folder, or for `isTestPath(p)`.
  - `REVIEW_LEVELS = ['none', 'light', 'standard', 'deep']`
  - `evidenceErrors({ …, reviewOptional = false })`. With `reviewOptional`, an absent `review`, or
    one whose `level` is `none`, adds no review errors. Without it, `level: 'none'` adds the
    error `review level none is only for a test-only change (procedures/review.md)`.
  - In `ci.js`:
    - `testOnly = production.length > 0 && production.every(isTestOnlyPath) && !classes.some(c => c.acceptance_test) && deep.length === 0`;
    - `evidenceErrors` gets `reviewOptional: testOnly`;
    - a test-only change still needs verification and integration evidence.

- [ ] **Step 1: Write the failing tests** in `validator/test/maint-0021.test.js`. Use
  `project`, `evidence` and `taskPath` from `./helpers/maint-0018.js`, set the task Active as
  `maint-0018.test.js` does, and commit a change to `tests/a.test.js` only. Then:

```js
test('MAINT-0021: a test-only change merges with no review', t => {
  // evidence without review; then evidence with review: { level: 'none' }
  // both: r.status === 0, no "independent review evidence is missing" finding
});
test('MAINT-0021: level none on product code fails', t => {
  // change src/a.js; evidence.review = { level: 'none' }
  // r.status === 1; findings match /review level none is only for a test-only change/
});
test('MAINT-0021: an acceptance test change is never test-only', t => {
  // configEdit adds paths.acceptance_tests: ['tests/acceptance/**']; change tests/acceptance/a.test.js
  // with evidence lacking review → r.status === 1, /independent review evidence is missing/
});
test('MAINT-0021: a deep test path is not test-only', t => {
  // configEdit: review.deep_paths ['**/*numbering*.test.js'] (names tests); change tests/numbering.test.js
  // evidence lacking review → r.status === 1
});
```

  Also add unit cases in `validator/test/delivery-evidence.test.js`:
  - `evidenceErrors({ ...ok, reviewOptional: true })` with `review` deleted returns `[]`;
  - with `review.level = 'none'` and no `reviewOptional`, it matches `/only for a test-only change/`;
  - `reviewLevelErrors` accepts `level: 'none'` as a level word.

- [ ] **Step 2: Run them to see them fail**

  Run: `node --test validator/test/maint-0021.test.js validator/test/delivery-evidence.test.js`
  Expected: FAIL. The test-only change reports a missing review, and `none` is not a level.

- [ ] **Step 3: Implement it**
  - `isTestOnlyPath` goes in `paths.js`, next to `isTestPath`.
  - In `evidenceErrors`: when `reviewOptional`, return the errors before the review checks if
    `review` is absent or its level is `none`; otherwise, if the level is `none`, push the error
    and carry on.
  - In `ci.js`, compute `deep` before `evidenceErrors`; it is computed today, so move the line up.
    Then compute `testOnly`, and pass `reviewOptional: testOnly`.
  - Add a note line to `findings` when a change is test-only: `note: a test-only change: no review
    is needed (procedures/review.md)`.

- [ ] **Step 4: Run them to see them pass, then the whole suite**

  Run: `npm test 2>&1 | tail -5`
  Expected: `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add validator/lib/paths.js validator/lib/delivery-evidence.js validator/lib/ci.js validator/test/maint-0021.test.js validator/test/delivery-evidence.test.js
git commit -m "MAINT-0021: a test-only change needs no review (level none)"
```

### Task 2: The reviewer's vendor differs from the implementer's

**Files:**
- Modify: `validator/lib/delivery-evidence.js` (`evidenceErrors`, the review block)
- Modify: `templates/delivery-evidence.json` (`review.vendor`, `review.implementer_vendor`)
- Test: `validator/test/delivery-evidence.test.js`

**Interfaces:**
- Produces: the optional evidence fields `review.vendor` and `review.implementer_vendor`
  (non-empty text when given). The error `the reviewer's vendor must differ from the
  implementer's (procedures/review.md)` applies when both are given and equal, compared trimmed
  and case-insensitive.

- [ ] **Step 1: Write the failing test**

```js
test('MAINT-0021: the reviewer is from another vendor when both vendors are given', () => {
  const e = evidence(); e.review.vendor = 'OpenAI'; e.review.implementer_vendor = 'Anthropic';
  assert.deepEqual(errorsFor(e), []);
  e.review.vendor = ' anthropic ';
  assert.match(errorsFor(e).join(), /the reviewer's vendor must differ from the implementer's/);
  e.review.vendor = ''; assert.match(errorsFor(e).join(), /review vendor must be a non-empty text/);
});
```

- [ ] **Step 2: Run it to see it fail**

  Run: `node --test validator/test/delivery-evidence.test.js`
  Expected: FAIL.

- [ ] **Step 3: Implement it.** Add both fields to the template: `"vendor": "<the maker of the
  reviewer's model>"` and `"implementer_vendor": "<the maker of the implementer's model>"`. The
  existing test `the evidence template holds placeholders only, which never pass` must still pass.

- [ ] **Step 4: Run the whole suite.** Run `npm test 2>&1 | tail -5`. Expected: `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add validator/lib/delivery-evidence.js templates/delivery-evidence.json validator/test/delivery-evidence.test.js
git commit -m "MAINT-0021: evidence may name both vendors; they must differ"
```

### Task 3: One reviewer command picks the model for each level

**Files:**
- Modify: `validator/lib/records.js` (`validateReviewConfig`)
- Modify: `validator/lib/roles.js` (add `ROLE_OF_LEVEL`, `reviewerCommand`)
- Modify: `validator/lib/lead-brief.js` (the reviewer bullet near line 68)
- Modify: `validator/lib/acceptance-brief.js` (the reviewer line near line 70)
- Modify: `validator/lib/next.js` (`secondModelBudget` and the printed line near 254)
- Test: `validator/test/config-keys.test.js`, `validator/test/maint-0021.test.js`

**Interfaces:**
- Produces:
  - config `review.reviewer_command` (Global Constraints);
  - `ROLE_OF_LEVEL = { light: 'cheap', standard: 'standard', deep: 'strong', fixcheck: 'fixcheck', milestone: 'milestone' }`;
  - `reviewerCommand(config, level) -> string | null`, with `{role}` and `{level}` substituted,
    and null without the key;
  - `secondModelBudget(config, records, milestoneIds)`, which with `reviewer_command` returns
    `{ milestone, deep_tasks, other_tasks, runs: other_tasks + 2 * deep_tasks + 2 }` and prints
    `review budget: N runs (one per light or standard task, two per deep task, two for the
    milestone review)`.

- [ ] **Step 1: Write the failing tests**
  - **`config-keys.test.js`:** a good `reviewer_command` (`'review run --role {role} --level
    {level}'`) loads. Each of these is refused with
    `/review\.reviewer_command must be one line of at most 300 characters containing \{role\}/`:
    - a missing `{role}`;
    - a newline;
    - 301 characters;
    - a non-string.

    Also: `review may contain only second_model, deep_paths, reviewer_command`.
  - **`maint-0021.test.js`:**

```js
test('MAINT-0021: reviewer_command wins over second_model in briefs and budget', t => {
  // configEdit: review = { second_model: { tool: 'codex', model: 'm1', final_model: 'm2' },
  //   reviewer_command: 'review run --role {role}' , deep_paths: ['src/auth/**'] }
  // wf brief --lead for a deep task prints 'review run --role strong' and 'review run --role fixcheck',
  //   and no 'fresh reviewer of your own tool'
  // wf brief --acceptance prints 'review run --role milestone'
  // wf next prints /review budget: 4 runs \(one per light or standard task, two per deep task, two for the milestone review\)/
  //   for one deep task (2) + the milestone (2)
  // a task review naming m2 (final_model) is still refused by wf ci
});
test('MAINT-0021: without reviewer_command the briefs and budget are unchanged', t => {
  // second_model only: the brief still prints the codex launch line; next prints 'second-model budget'
});
```

- [ ] **Step 2: Run them to see them fail**

  Run: `node --test validator/test/config-keys.test.js validator/test/maint-0021.test.js`
  Expected: FAIL.

- [ ] **Step 3: Implement it**
  - **Validation:** check `typeof === 'string'`, the length, `/^[^\x00-\x1f\x7f]+$/` and
    `includes('{role}')`.
  - **The lead brief:** with a command, its bullet reads: "the task's review (level L, procedures/review.md),
    by another vendor's model: `<reviewerCommand(config, L)>`; after a blocking finding at deep,
    one fix check: `<reviewerCommand(config, 'fixcheck')>`. If no reviewer can run, the review
    is missing: stop at the gate." Without a command, the existing bullet stays.
  - **The acceptance brief:** likewise, with `'milestone'`.
  - **The budget:** count light and standard tasks with `reviewLevel(...).level` in
    `light|standard|null`. A task at level `none` counts 0.

- [ ] **Step 4: Run the whole suite.** Run `npm test 2>&1 | tail -5`. Expected: `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add validator/lib/records.js validator/lib/roles.js validator/lib/lead-brief.js validator/lib/acceptance-brief.js validator/lib/next.js validator/test/config-keys.test.js validator/test/maint-0021.test.js
git commit -m "MAINT-0021: review.reviewer_command names one command per level; briefs and budget follow it"
```

### Task 4: The rule in the procedures, policy, templates and schema

**Files:**
- Modify: `procedures/review.md` (the **Levels** paragraph, the severity paragraph, **How many**, and the reviewer-failure sentence)
- Modify: `POLICY.md` (line 553, *Independent review*)
- Modify: `templates/claude/agents/independent-reviewer.md` and `templates/review.md` (severity
  words, the cap, fix-check mode)
- Modify: `SCHEMA.md` (the **Review levels** bullet, the evidence paragraph at line 43, and
  `review.reviewer_command` in the config keys)
- Test: the existing `procedure-links.test.js` and `agent-templates.test.js`

- [ ] **Step 1: Rewrite `procedures/review.md`**, keeping every sentence that does not conflict.
  Say:
  - **Levels:**
    - `none` for a test-only change, as defined above;
    - `light` and `standard` reviewed by another vendor's model at the `cheap` and `standard`
      roles;
    - `deep` at `strong`, with a security focus;
    - the milestone at `milestone`.
  - **Severity:** blocking / should fix / note, in these words:
    - blocking: a user or the owner would hit wrong behaviour, a security hole, a way to lose
      data, or a bypassable gate;
    - should fix: real, low impact, fixed without another review;
    - note: never starts anything.
  - **How many:**
    - one review on the final code;
    - after the fixes, light and standard get nothing more, and each blocking fix comes with a
      test that failed first;
    - deep and milestone get one fix check, only after a blocking finding, covering only the
      findings and the fix diff, which asks per finding: fixed, half-fixed, or fix broke;
    - no round three: a problem still left is fixed, tested and recorded in the pull request,
      and a further check runs only if the owner asks.
  - **Who:** always another vendor's model. With `review.reviewer_command`, the brief prints the
    command. Remove "a fresh reviewer of the implementer's tool" as a fallback everywhere. If no
    reviewer can run: relaunch once on a transport error, take the next model on a quota error,
    else record the review as missing and stop at the gate.
  - **Budget:** as in Global Constraints.
  - **The author's own checks:** self-review and subagent reviews by the implementer's own tool
    are optional and never count as the review.

- [ ] **Step 2: Change `POLICY.md` line 553** to: "Independence is of context and of vendor: the
  reviewer runs on a model from a different vendor than the implementer's, in a separate
  context."

- [ ] **Step 3: Change the templates.** In `independent-reviewer.md` and `templates/review.md`:
  - the three severities in the words of Step 1;
  - "report at most the ten most important findings";
  - "no findings is a valid answer";
  - a **fix check** mode: given only the earlier findings, the fix diff and the tests added,
    answer one line per finding (`fixed`, `half-fixed: …`, `fix broke: …`), add at most one
    finding the fix itself introduced, then the verdict.

- [ ] **Step 4: Update `SCHEMA.md`.** Cover:
  - `none` and the test-only definition;
  - `review.vendor` and `review.implementer_vendor`;
  - `review.reviewer_command` and the roles;
  - the budget with a command.

- [ ] **Step 5: Run the whole suite.** Run `npm test 2>&1 | tail -5`. Expected: `# fail 0`. The
  link and template tests stay green.

- [ ] **Step 6: Commit**

```bash
git add procedures/review.md POLICY.md templates/claude/agents/independent-reviewer.md templates/review.md SCHEMA.md
git commit -m "MAINT-0021: the review rule in the procedure, policy, templates and schema"
```

### Task 5: Record and release v2.10.0

**Files:**
- Create: `docs/proposals/MAINT-0021-review-policy.md`
- Modify: `CHANGELOG.md` (a new `## v2.10.0` at the top, in the existing style, with its corpus
  line)
- Modify: `upgrades.json` (a `v2.10.0` entry with `notes`)
- Modify: `package.json` (`"version": "2.10.0"`)

- [ ] **Step 1: Write the record.** Write `MAINT-0021-review-policy.md` in the style of the
  MAINT-0018 and MAINT-0020 records. It holds:
  - the evidence: 67 reviews of a client project over 24 fix chains, findings per round of 5.5, 2.2,
    1.6 and 1.5, 35% of blocking findings first seen in round 2 or later, and their origin
    (residuals and fix-introduced);
  - the owner's words and approval of 18 October 2026;
  - the controls this weakens (test-only changes, no fix review at light and standard) and why;
  - what to watch: escaped bugs per level.

- [ ] **Step 2: Write the CHANGELOG entry and the upgrade notes.**
  - Upgrade: "Set `review.reviewer_command` to move to one reviewer per level. Without it nothing
    changes. Evidence may add `review.vendor` and `review.implementer_vendor`."
  - Compute the corpus line the way v2.9.0's was computed: words of the procedures and
    `SCHEMA.md`, before → after. Use `wc -w` on the same files v2.9.0 lists.

- [ ] **Step 3: Run the whole suite**, and `node validator/cli.js --help >/dev/null`.
  Expected: `# fail 0`, exit 0.

- [ ] **Step 4: Commit**

```bash
git add docs/proposals/MAINT-0021-review-policy.md docs/proposals/MAINT-0021-plan.md CHANGELOG.md upgrades.json package.json
git commit -m "v2.10.0: MAINT-0021, review what needs it, once, by another vendor"
```

- [ ] **Step 5: Review and release.**
  - The change is deep: the validator is a gate. It gets one review by Codex `gpt-6.1-sol` at
    high effort.
  - Until 2026-11-05 it also gets a Gemini shadow review, the same input sent to Gemini 4 Argon.
  - Fix blocking and should-fix findings.
  - Run one fix check (OpenRouter `deep`) only after a blocking finding.
  - The merge creates the release tag, so it waits for the owner's yes, quoted in the PR
    (`CHANGELOG.md`: "review and owner approval precede every tag").
