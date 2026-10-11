# MAINT-0016 Stop Only When Needed: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In owner-merge mode the agent's own pull requests merge themselves and some of the owner's approvals move to the milestone's acceptance. Review is sized to the change and carries over a clean merge of the trusted branch. A milestone is walked through in a browser before the owner tries it. `wf next` reads the newest trusted branch, and `wf evidence` starts the delivery evidence.

**Architecture:**
- **Validator:** two new modules beside `ci.js`. `carry.js` decides whether evidence of an earlier revision still covers a pull request's head. `acceptance-evidence.js` checks the block a milestone's acceptance pull request carries. `delivery-evidence.js` learns `enforced` check results and review levels. `ci.js` gains the deferral, the auto-merge guard and the deep-path rule. `records.js` validates four new config keys and one task field.
- **Owner tools:** `wf-adopt`, `wf-setup`, `wf-protect` and `wf-upgrade` learn the settings.
- **Agent template:** a new `trial-walker`.
- **Text:** procedures, policy, schema and templates change to match, with the corpus size recorded.

**Tech Stack:** Node.js ≥ 22, ES modules, no dependencies, `node:test`; Git through `validator/lib/git.js`'s `gitRunner`; GitHub Actions.

**Spec:** `docs/proposals/MAINT-0016-stop-only-when-needed.md`. Read it before any task.

## Global Constraints

- No new dependencies. `package.json` keeps `"type": "module"` and `engines.node >=22`.
- Every new setting is opt-in: `approval.auto_merge`, `approval.defer_to_acceptance`, `review`, and `acceptance_evidence` (the last is `true` only in a new scaffold's `config.default.json`). A project without them behaves exactly as on v2.3.1. Existing tests change only where a task below says so.
- Never weakened:
  - removing a mapped acceptance test fails (`acceptance.js`, unchanged);
  - governing, owner-record and enforcement paths are the owner's merge;
  - a blocking finding accepted rather than fixed is the owner's merge;
  - a milestone's acceptance is the owner's merge;
  - manual and enforced modes keep their own routes.
- The auto-merge value reaches `wf ci` through the environment variable `WF_PR_AUTO_MERGE` (`on`/`off`), never a command-line option. An older pinned validator, given the refreshed `wf-ci.yml`, must not fail on an option it does not know.
- Code style: match `ci.js`. Terse, comments say why, two-space indent, single quotes, one-line helpers, each new rule's comment names MAINT-0016.
- Every rule ships as a check where one can be written, and procedure prose names the check (`procedures/maintenance.md`).
- Release `v2.4.0`: `package.json`, `CHANGELOG.md`, `upgrades.json`.
- Corpus: 35,133 words before (`POLICY.md SCHEMA.md QUICKSTART.md procedures/*.md templates/*.md templates/*.json .agents/skills/workflow/SKILL.md templates/claude/agents/*.md templates/claude/*.md`). Record the number after. `procedures/execute.md` grows by at most 250 words net (1,838 before).
- Run one test file with `node --test validator/test/FILE.test.js`, and everything with `npm test`.
- Commit after every task, with messages beginning `MAINT-0016:`, on branch `claude/MAINT-0016-stop-only-when-needed`. End every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A merge that combines both sides' edits to one file** after the review is clean, yet holds content that is neither the reviewed commit's nor the trusted branch's. It must not carry the review over. Test in Task 2.
2. **Auto-merge turned on for a pull request the owner merges**, while its checks still run, must fail `wf ci`, which is a required check. An unset `WF_PR_AUTO_MERGE`, as an older workflow file leaves it, changes nothing. Test in Task 5.
3. **A minor accepted finding missing from the task record's `accepted_findings`** under `defer_to_acceptance` must fail with the fix in the message. A `blocking` one stays the owner's merge even with deferral on. Test in Task 5.
4. **Acceptance evidence whose accepted revision is followed by a production change**, or a walkthrough step that did not pass, must fail. A walkthrough marked `not_applicable` with an empty reason must fail too. Test in Task 7.
5. **`wf next` when the local trusted branch is ahead of or diverged from `origin/<branch>`** must read the local branch: ahead with no note, diverged with a note. Without a remote it must read the local branch as today. Test in Task 8.

---

## File Structure

| File | Responsibility |
|---|---|
| `validator/lib/records.js` (modify) | Validate `approval.auto_merge`, `approval.defer_to_acceptance`, `review`, `acceptance_evidence`, and the task field `accepted_findings` |
| `validator/lib/sources.js` (modify) | `gitSource().changedPaths(commit)` and `gitSource().blob(rel)`; `dirSource` stubs returning `null` |
| `validator/lib/paths.js` (modify) | `matchesAny(globs, path)` with the config's glob forms |
| `validator/lib/carry.js` (new) | `carriedFrom({ config, baseline, candidate, from })` → `{ ok, why?, paths? }` |
| `validator/lib/delivery-evidence.js` (modify) | `parseMarked`; `enforced` results; carried revisions; `reviewLevelErrors`; `isBlocking`; `REVIEW_LEVELS` |
| `validator/lib/acceptance.js` (modify) | `evaluateAcceptance` accepts an execution of a carried revision |
| `validator/lib/ci.js` (modify) | Carry-over, deep paths, Done note, deferral, `accepted_findings`, auto-merge guard, acceptance evidence |
| `validator/lib/acceptance-evidence.js` (new) | `ACCEPTANCE_MARKER`, `parseAcceptanceEvidence`, `acceptanceEvidenceErrors` |
| `validator/lib/evidence-skeleton.js` (new) | `evidenceSkeleton({ baseline, candidate, task, previous })` for `wf evidence` |
| `validator/lib/next.js` (modify) | The pull-request action says "turn on auto-merge" under `approval.auto_merge` |
| `validator/cli.js` (modify) | `WF_PR_AUTO_MERGE`; parse acceptance evidence; `wf next` reads `origin/<branch>` when the local branch is behind; `evidence` command |
| `templates/github/wf-ci.yml` (modify) | Run on `auto_merge_enabled`/`auto_merge_disabled`; pass `WF_PR_AUTO_MERGE`; summary lists deferred items |
| `templates/claude/agents/trial-walker.md` (new) | The fresh-context browser walkthrough of the trial |
| `templates/claude/agents/independent-reviewer.md` (modify) | Review levels and "what the change can break" |
| `templates/acceptance-evidence.json` (new), `templates/delivery-evidence.json`, `templates/acceptance.md`, `templates/task.md`, `templates/profile.md`, `config.default.json` (modify) | The records and evidence the new rules read |
| `adapters/protect.mjs` (modify) | Auto-merge allowed in owner-merge with `approval.auto_merge` |
| `bin/wf-adopt` (modify) | `--auto-merge`, `--defer-to-acceptance`, `--second-reviewer`; the `AGENTS.md` sentence; install `trial-walker.md` |
| `adapters/setup.mjs`, `adapters/setup-page.html` (modify) | Detect Codex; save the new settings; show them |
| `adapters/upgrade.mjs`, `upgrades.json` (modify) | Install and list `trial-walker.md`; v2.4.0 notes |
| `procedures/execute.md`, `review.md`, `accept-release.md`, `approval-evidence.md`, `readiness.md`, `setup.md`, `POLICY.md`, `SCHEMA.md`, `QUICKSTART.md` (modify) | The text that matches the checks |
| `validator/test/config-keys.test.js`, `carry.test.js`, `acceptance-evidence.test.js`, `next-baseline.test.js`, `evidence-command.test.js` (new); `delivery-evidence.test.js`, `checkpoints.test.js`, `protect.test.js`, `adopt.test.js`, `setup-gui.test.js`, `upgrade.test.js` (modify) | Tests |
| `package.json`, `CHANGELOG.md` (modify) | Release v2.4.0 |

Order matters in one place: `wf-adopt` and `wf-setup` read templates from the pinned revision (`--rev HEAD` in their tests), so Task 10's templates are committed before Tasks 12–13 run their tests.

---

### Task 1: Configuration keys and the `accepted_findings` task field

**Files:**
- Modify: `validator/lib/records.js`
- Test: `validator/test/config-keys.test.js` (create)

**Interfaces:**
- Produces:
  - `EFFORTS` (exported array `['low','medium','high','xhigh','max']`);
  - `loadConfig` refuses invalid `approval.auto_merge`, `approval.defer_to_acceptance`, `review` and `acceptance_evidence`;
  - `loadRecord(…, 'task')` reports a malformed `accepted_findings`.

- [ ] **Step 1: Write the failing tests**

Create `validator/test/config-keys.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dirSource, loadConfig, loadRecord } from '../lib/index.js';

// MAINT-0016: the settings that let the agent's pull requests merge themselves, move some approvals to the milestone's
// acceptance, shape review and require acceptance evidence; each is refused where it would not mean what it says.
function configWith(t, edit) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-config-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const base = JSON.parse(fs.readFileSync(new URL('../../config.default.json', import.meta.url), 'utf8'));
  fs.mkdirSync(path.join(dir, 'docs/workflow'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs/workflow/config.json'), JSON.stringify(edit(base)));
  return () => loadConfig(dirSource(dir));
}
const ownerMerge = (c, approval = {}) => ({ ...c, approval: { ...c.approval, label: 'owner-merge', mechanism: 'owner-merge', checkpoint: 'milestone', ...approval } });

test('auto_merge and defer_to_acceptance are true or false, and true only where the agent merges its own pull requests', t => {
  for (const key of ['auto_merge', 'defer_to_acceptance']) {
    assert.equal(configWith(t, c => ownerMerge(c, { [key]: true }))().approval[key], true);
    assert.equal(configWith(t, c => ownerMerge(c, { checkpoint: 'plan', [key]: true }))().approval[key], true);
    assert.equal(configWith(t, c => ownerMerge(c, { checkpoint: 'change', [key]: false }))().approval[key], false, 'false is allowed anywhere');
    assert.throws(configWith(t, c => ownerMerge(c, { [key]: 'yes' })), new RegExp(`approval\\.${key} must be true or false`));
    assert.throws(configWith(t, c => ownerMerge(c, { checkpoint: 'change', [key]: true })), /needs owner-merge approval with checkpoint milestone or plan/);
    assert.throws(configWith(t, c => ({ ...c, approval: { ...c.approval, [key]: true } })), /needs owner-merge approval/, 'manual mode');
  }
});

test('review names an optional second model and the paths that always need a deep review', t => {
  const good = { second_model: { tool: 'codex', model: 'gpt-6.1-sol', max_effort: 'high' }, deep_paths: ['src/auth/**'] };
  assert.deepEqual(configWith(t, c => ({ ...c, review: good }))().review, good);
  assert.ok(configWith(t, c => ({ ...c, review: { second_model: null } }))(), 'no second model');
  for (const [review, pattern] of [
    [{ reviewer: 'x' }, /review may contain only second_model, deep_paths/],
    [{ second_model: { tool: 'codex' } }, /review\.second_model\.model must be a plain name/],
    [{ second_model: { tool: 'codex', model: 'gpt 6' } }, /review\.second_model\.model must be a plain name/],
    [{ second_model: { tool: 'codex', model: 'gpt-6.1-sol', max_effort: 'extreme' } }, /max_effort must be one of low, medium, high, xhigh, max/],
    [{ deep_paths: 'src/**' }, /review\.deep_paths must be an array of glob strings/],
  ]) assert.throws(configWith(t, c => ({ ...c, review })), pattern);
});

test('acceptance_evidence is true or false', t => {
  assert.equal(configWith(t, c => ({ ...c, acceptance_evidence: true }))().acceptance_evidence, true);
  assert.throws(configWith(t, c => ({ ...c, acceptance_evidence: 'on' })), /acceptance_evidence must be true or false/);
});

test('a task record lists the findings it accepted rather than fixed as REVIEW/FINDING', () => {
  const record = text => loadRecord({ read: () => text }, 'docs/workflow/tasks/T-0001.md', 'task');
  const head = '---\nrecord: task\nid: T-0001\ntitle: t\nstatus: Active\nowner: a\nobjective: o\n';
  assert.deepEqual(record(`${head}accepted_findings: [R-0030/N1, R-0031/F7]\n---\n`).errors, []);
  assert.deepEqual(record(`${head}accepted_findings: []\n---\n`).errors, []);
  assert.match(record(`${head}accepted_findings: [N1]\n---\n`).errors.join(' | '), /accepted_findings entries must look like R-0030\/N1/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test validator/test/config-keys.test.js`
Expected: FAIL. The refusals do not happen yet (`assert.throws` sees no error), and `accepted_findings: [N1]` reports no error.

- [ ] **Step 3: Implement**

In `validator/lib/records.js`, change the import:

```js
import { CHECKPOINTS, agentMerges, checkpointOf } from './checkpoint.js';
```

After `validateClientConfig` (before `export function loadConfig`), add:

```js
// MAINT-0016: the project's review policy (procedures/review.md). An optional reviewer from another model family, used for
// deep reviews and the milestone review at no more than max_effort, and the paths whose changes always need a deep review.
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const PLAIN = /^[\w.@/:-]{1,80}$/;
function validateReviewConfig(r) {
  only(r, ['second_model', 'deep_paths'], 'review');
  const m = r.second_model;
  if (m != null) {
    only(m, ['tool', 'model', 'max_effort'], 'review.second_model');
    for (const k of ['tool', 'model']) if (typeof m[k] !== 'string' || !PLAIN.test(m[k])) throw new Error(`review.second_model.${k} must be a plain name`);
    if (m.max_effort !== undefined && !EFFORTS.includes(m.max_effort)) throw new Error(`review.second_model.max_effort must be one of ${EFFORTS.join(', ')}`);
  }
  if (r.deep_paths !== undefined && (!Array.isArray(r.deep_paths) || r.deep_paths.some(g => typeof g !== 'string' || !g.trim()))) throw new Error('review.deep_paths must be an array of glob strings');
}
```

In `loadConfig`, directly after the `if (checkpoint !== undefined) { … }` block, add:

```js
    // MAINT-0016: the agent's own pull requests merge themselves (auto_merge), and some of the owner's approvals wait for
    // the milestone's acceptance (defer_to_acceptance); both only where the checkpoint lets the agent merge at all.
    for (const key of ['auto_merge', 'defer_to_acceptance']) {
      const v = config.approval?.[key];
      if (v === undefined) continue;
      if (typeof v !== 'boolean') throw new Error(`approval.${key} must be true or false`);
      if (v && !agentMerges(checkpointOf(config))) throw new Error(`approval.${key} needs owner-merge approval with checkpoint milestone or plan, where the agent merges its own pull requests`);
    }
    if (config.review !== undefined) validateReviewConfig(config.review);
    if (config.acceptance_evidence !== undefined && typeof config.acceptance_evidence !== 'boolean') throw new Error('acceptance_evidence must be true or false');
```

In `loadRecord`, inside `if (expected === 'task') { … }`, add as the last line:

```js
    // MAINT-0016: the findings this task's reviews accepted rather than fixed, kept for the milestone's acceptance.
    if (data.accepted_findings != null && (!Array.isArray(data.accepted_findings) || data.accepted_findings.some(f => !/^[\w.-]+\/[\w.-]+$/.test(f)))) errors.push('accepted_findings entries must look like R-0030/N1: the review, then the finding it accepted rather than fixed');
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test validator/test/config-keys.test.js && npm test`
Expected: PASS; the full suite still passes.

- [ ] **Step 5: Commit**

```bash
git add validator/lib/records.js validator/test/config-keys.test.js
git commit -m "MAINT-0016: config keys for auto-merge, approvals at acceptance, review policy and acceptance evidence; accepted_findings on tasks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Evidence that carries over a clean merge (`carry.js`)

**Files:**
- Modify: `validator/lib/sources.js`, `validator/lib/paths.js`
- Create: `validator/lib/carry.js`
- Test: `validator/test/carry.test.js` (create)

**Interfaces:**
- Produces:
  - `gitSource(repo, rev).changedPaths(commit)` → `string[]`, the paths that differ between `commit` and `rev`;
  - `gitSource(repo, rev).blob(rel)` → `string | null`, the object id of `rel` at `rev`;
  - `dirSource(…).changedPaths()` and `dirSource(…).blob()` → `null`;
  - `matchesAny(globs: string[], path: string) → boolean` (from `paths.js`);
  - `carriedFrom({ config, baseline, candidate, from })` → `{ ok: true, paths: string[] }` or `{ ok: false, why: string }`.

- [ ] **Step 1: Write the failing tests**

Create `validator/test/carry.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { gitSource } from '../lib/index.js';
import { carriedFrom } from '../lib/carry.js';
import { matchesAny } from '../lib/paths.js';

// MAINT-0016: a review or verification of an earlier revision still covers a pull request's head when every path changed
// since holds the trusted branch's own content or is a planning record; the task's own code, an acceptance test or a
// merge that combined both sides' edits needs new evidence.
const config = { paths: { production: ['src/**', 'tests/**'], planning: ['docs/workflow/tasks/**', 'docs/**'], acceptance_tests: ['tests/acceptance/**'] } };
function repo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-carry-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => { const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  const write = (p, text) => { fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true }); fs.writeFileSync(path.join(dir, p), text); };
  const commit = m => { git('add', '-A'); git('commit', '-qm', m); return git('rev-parse', 'HEAD'); };
  git('init', '-q', '-b', 'main'); git('config', 'user.name', 'T'); git('config', 'user.email', 't@example.invalid');
  write('src/a.js', 'a\n'); write('src/shared.js', 'one\ntwo\nthree\nfour\nfive\n'); write('docs/workflow/tasks/T-0001.md', 'Active\n');
  const base = commit('base');
  git('switch', '-q', '-c', 'T-0001');
  write('src/a.js', 'a changed by the task\n');
  const reviewed = commit('T-0001: work');
  return { git, write, commit, base, reviewed, at: rev => gitSource(dir, rev) };
}
const carried = (r, baseline, candidate, from) => carriedFrom({ config, baseline: r.at(baseline), candidate: r.at(candidate), from });

test('a merge of the trusted branch and a records commit carry the evidence over', t => {
  const r = repo(t);
  r.git('switch', '-q', 'main'); r.write('src/b.js', 'from main\n'); const main = r.commit('main moves');
  r.git('switch', '-q', 'T-0001'); r.git('merge', '-q', '--no-edit', 'main');
  r.write('docs/workflow/tasks/T-0001.md', 'Done\n'); const head = r.commit('T-0001: Done');
  assert.equal(carried(r, main, head, r.reviewed).ok, true);
  assert.deepEqual(carried(r, main, head, head), { ok: true, paths: [] }, 'evidence for the head itself');
});

test('the task\'s own code or an acceptance test after the review does not carry over', t => {
  const r = repo(t);
  r.write('src/a.js', 'changed again after the review\n'); const own = r.commit('T-0001: more');
  assert.match(carried(r, r.base, own, r.reviewed).why, /changed since [0-9a-f]{12}: src\/a\.js/);
  r.git('reset', '-q', '--hard', r.reviewed);
  r.write('tests/acceptance/a.test.js', 'test\n'); const withTest = r.commit('T-0001: a test');
  assert.match(carried(r, r.base, withTest, r.reviewed).why, /tests\/acceptance\/a\.test\.js/, 'an acceptance test is never a record');
});

test('a clean merge that combined both sides\' edits to one file does not carry over', t => {
  const r = repo(t);
  r.write('src/shared.js', 'ONE\ntwo\nthree\nfour\nfive\n'); const reviewed = r.commit('T-0001: shared');
  r.git('switch', '-q', 'main'); r.write('src/shared.js', 'one\ntwo\nthree\nfour\nFIVE\n'); const main = r.commit('main edits shared');
  r.git('switch', '-q', 'T-0001'); r.git('merge', '-q', '--no-edit', 'main'); const head = r.git('rev-parse', 'HEAD');
  const c = carried(r, main, head, reviewed);
  assert.equal(c.ok, false, 'the merged file matches neither the reviewed commit nor the trusted branch');
  assert.match(c.why, /src\/shared\.js/);
});

test('a revision outside the candidate\'s history, or not a full hash, does not carry over', t => {
  const r = repo(t);
  r.git('switch', '-q', 'main'); r.write('src/c.js', 'c\n'); const other = r.commit('elsewhere');
  assert.match(carried(r, other, r.reviewed, other).why, /not an earlier revision of this candidate/);
  assert.match(carried(r, r.base, r.reviewed, 'abc123').why, /not an earlier revision of this candidate/);
});

test('matchesAny reads the config\'s glob forms', () => {
  assert.equal(matchesAny(['src/auth/**', { pattern: '**/migrations/**' }], 'db/migrations/001.sql'), true);
  assert.equal(matchesAny(['src/auth/**'], 'src/orders/a.js'), false);
  assert.equal(matchesAny(undefined, 'src/a.js'), false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test validator/test/carry.test.js`
Expected: FAIL with `Cannot find module '../lib/carry.js'`.

- [ ] **Step 3: Implement**

In `validator/lib/sources.js`, inside `gitSource`'s returned object, after `changedSince(…) { … },` add:

```js
    // MAINT-0016 (lib/carry.js): the paths that differ between an earlier commit and this revision, and the object a path
    // names here (null when absent), so content is compared without reading it.
    changedPaths(commit) {
      if (!/^[a-f0-9]{40,64}$/.test(commit)) throw new Error(`invalid revision: ${commit}`);
      const r = git('diff-tree', '-r', '--no-renames', '--name-only', '-z', commit, rev, '--');
      if (r.status !== 0) throw new Error(`cannot compare ${commit} with ${rev}`);
      return r.stdout.split('\0').filter(Boolean);
    },
    blob(rel) { safePath(rel); const r = git('rev-parse', '--verify', '--quiet', '--end-of-options', `${rev}:${rel}`); return r.status === 0 ? r.stdout.trim() : null; },
```

In `dirSource`'s returned object, after `changedSince() { return null; },` add:

```js
    changedPaths() { return null; },
    blob() { return null; },
```

In `validator/lib/paths.js`, after `isAcceptanceTest`, add:

```js
// Whether a path matches any of the config's globs, in either of their forms (a string, or { pattern }).
export const matchesAny = (globs, path) => (globs ?? []).some(g => matchGlob(patternOf(g), path));
```

Create `validator/lib/carry.js`:

```js
// MAINT-0016: whether evidence produced at an earlier revision of a pull request still covers its head. procedures/
// review.md assembles the candidate with the trusted branch after review and revalidates the review there; it does not
// redo it. The evidence carries over when every path changed since that revision holds the trusted branch's own content
// (as a merge of that branch leaves it) or is a planning record. The task's own code, an acceptance test, or a merge
// that combined both sides' edits to one file needs new evidence.
import { classifyPaths } from './paths.js';

const SHA = /^[0-9a-f]{40,64}$/;
export function carriedFrom({ config, baseline, candidate, from }) {
  if (candidate.kind !== 'git' || baseline.kind !== 'git') return { ok: false, why: 'evidence carries over only between Git revisions' };
  if (from === candidate.name) return { ok: true, paths: [] };
  if (!SHA.test(from ?? '') || !candidate.isAncestor(from)) return { ok: false, why: `${String(from).slice(0, 12)} is not an earlier revision of this candidate` };
  const changed = candidate.changedPaths(from);
  const own = classifyPaths(config, changed).filter(c => (c.category !== 'planning' || c.acceptance_test) && candidate.blob(c.path) !== baseline.blob(c.path)).map(c => c.path);
  return own.length ? { ok: false, why: `changed since ${from.slice(0, 12)}: ${own.slice(0, 5).join(', ')}${own.length > 5 ? ', …' : ''}` } : { ok: true, paths: changed };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test validator/test/carry.test.js && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add validator/lib/sources.js validator/lib/paths.js validator/lib/carry.js validator/test/carry.test.js
git commit -m "MAINT-0016: evidence of an earlier revision carries over a clean merge of the trusted branch and records

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Delivery evidence — `enforced` checks, carried revisions, review levels

**Files:**
- Modify: `validator/lib/delivery-evidence.js`, `validator/lib/acceptance.js`
- Test: `validator/test/delivery-evidence.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `parseMarked(text, marker, what)` → object or `null`;
  - `evidenceErrors({ …, enforcedChecks = false, carried = {} })`, where `carried` is `{ verification?: sha, review?: sha }`;
  - `REVIEW_LEVELS` (`['light','standard','deep']`);
  - `isBlocking(finding) → boolean`;
  - `reviewLevelErrors({ review, deep = [], secondModel = null })` → `string[]`;
  - `evaluateAcceptance({ …, carriedFrom = null })`.

- [ ] **Step 1: Write the failing tests**

In `validator/test/delivery-evidence.test.js`, change the import line `import { evidenceErrors } from '../lib/delivery-evidence.js';` to:

```js
import { evidenceErrors, isBlocking, reviewLevelErrors } from '../lib/delivery-evidence.js';
```

Append:

```js
// MAINT-0016: under auto-merge GitHub requires the profile's checks before any merge, so the evidence may say so rather
// than wait for them; the agent still lists a check it ran itself.
const enforced = name => ({ name, result: 'enforced', reference: 'https://github.com/o/r/pull/7/checks' });
test('under auto-merge a required check may be enforced, but verification still lists a check the agent ran', () => {
  const e = evidence();
  e.integration.checks = [enforced('wf ci'), enforced('test')];
  e.verification.checks = [check('npm test'), enforced('wf ci'), enforced('test')];
  assert.deepEqual(errorsFor(e, { enforcedChecks: true }), []);
  assert.match(errorsFor(e).join(' | '), /check "wf ci" is "enforced", which only a project with approval\.auto_merge may use/);
  e.verification.checks = e.verification.checks.slice(1);
  assert.match(errorsFor(e, { enforcedChecks: true }).join(' | '), /verification lists no check the agent ran and saw pass/);
  e.verification.checks.push(check('npm test'), enforced('lint'));
  assert.match(errorsFor(e, { enforcedChecks: true }).join(' | '), /check "lint" did not pass/, 'only a required check can be enforced');
});

test('verification and review of an earlier revision count only when ci.js found that they carry over; integration never does', () => {
  const e = evidence();
  e.verification.revision = OTHER; e.review.context.candidate = OTHER;
  assert.match(errorsFor(e).join(' | '), /verification evidence is not for this candidate revision/);
  assert.match(errorsFor(e).join(' | '), /review was not of this candidate revision/);
  assert.deepEqual(errorsFor(e, { carried: { verification: OTHER, review: OTHER } }), []);
  e.integration.revision = OTHER;
  assert.match(errorsFor(e, { carried: { verification: OTHER, review: OTHER } }).join(' | '), /integration evidence is not for this candidate revision/);
});

test('a review states its level, model and any fallback; a deep path needs a deep review by the second model or a reason', () => {
  const r = evidence().review;
  const second = { tool: 'codex', model: 'gpt-6.1-sol', max_effort: 'high' };
  const deep = ['src/auth/a.js'];
  assert.deepEqual(reviewLevelErrors({ review: r }), []);
  assert.match(reviewLevelErrors({ review: { ...r, level: 'heavy' } }).join(), /level must be one of light, standard, deep/);
  assert.match(reviewLevelErrors({ review: { ...r, model: ' ' } }).join(), /review model must be a non-empty text/);
  assert.match(reviewLevelErrors({ review: { ...r, level: 'light' }, deep }).join(), /need a deep review \(review\.deep_paths\): src\/auth\/a\.js; this review's level is light/);
  assert.match(reviewLevelErrors({ review: { ...r, level: 'deep' }, deep, secondModel: second }).join(), /a deep review is by gpt-6\.1-sol/);
  assert.deepEqual(reviewLevelErrors({ review: { ...r, level: 'deep', model: 'gpt-6.1-sol' }, deep, secondModel: second }), []);
  assert.deepEqual(reviewLevelErrors({ review: { ...r, level: 'deep', model: 'claude-opus-5-5', fallback: 'codex: usage limit reached' }, deep, secondModel: second }), []);
  assert.deepEqual(reviewLevelErrors({ review: { ...r, level: 'deep' }, deep }), [], 'without a second model any deep review will do');
});

test('blocking, critical and high are blocking severities; should fix, note, medium and low are not', () => {
  for (const s of ['blocking', 'Blocking', 'critical', 'high']) assert.equal(isBlocking({ severity: s }), true, s);
  for (const s of ['should fix', 'note', 'medium', 'low', undefined]) assert.equal(isBlocking({ severity: s }), false, String(s));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test validator/test/delivery-evidence.test.js`
Expected: FAIL. `isBlocking` and `reviewLevelErrors` are not exported, and `enforcedChecks`/`carried` are ignored.

- [ ] **Step 3: Implement**

In `validator/lib/delivery-evidence.js`, replace `parseDeliveryEvidence` with a generic parser and a wrapper:

```js
// Evidence from a pull request description: a marked block, the JSON in a fenced block after the marker (MAINT-0016
// reuses this for the acceptance evidence). A text without the marker holds none (null); two marked blocks are ambiguous.
export function parseMarked(text, marker, what) {
  const raw = String(text ?? '');
  if (Buffer.byteLength(raw, 'utf8') > 128 * 1024) throw new WfError(`${what} is larger than 128 KiB`);
  const parse = json => { try { return JSON.parse(json); } catch { throw new WfError(`the ${what} is not valid JSON`); } };
  const parts = raw.split(marker);
  if (parts.length === 1) return null;
  if (parts.length > 2) throw new WfError(`the text holds more than one ${what} block; keep only the one for the current head`);
  const fenced = parts[1].match(/^\s*```(?:json)?[^\n]*\n([\s\S]*?)\n\s*```/);
  return parse(fenced ? fenced[1] : parts[1].trim());
}
// Delivery evidence from a file: the JSON itself, a marked comment (the marker, then the JSON), or a pull request
// description holding the marker followed by a fenced JSON block, which is how the `wf ci` workflow passes it.
export function parseDeliveryEvidence(text) {
  const raw = String(text ?? '');
  return parseMarked(raw.trim().startsWith('{') ? `${DELIVERY_MARKER}\n${raw}` : raw, DELIVERY_MARKER, 'delivery evidence');
}
```

Change `evidenceErrors`'s signature and the stage loop. The whole loop becomes:

```js
export function evidenceErrors({ evidence, revision, taskIds, owner, requiredChecks, enforcedChecks = false, carried = {} }) {
```

```js
  for (const stage of ['verification', 'integration']) {
    const s = evidence[stage];
    if (!isObject(s)) { errors.push(`${stage} evidence is missing`); continue; }
    // MAINT-0016: verification of an earlier revision counts where ci.js found it carries over; integration is always
    // the exact candidate's.
    if (s.revision !== revision && !(stage === 'verification' && carried.verification && s.revision === carried.verification)) errors.push(`${stage} evidence is not for this candidate revision`);
    if (typeof s.environment !== 'string' || !s.environment.trim()) errors.push(`${stage} evidence needs its environment`);
    if (!Array.isArray(s.checks) || !s.checks.length) { errors.push(`${stage} evidence has no checks`); continue; }
    if (new Set(s.checks.map(c => c?.name)).size !== s.checks.length) errors.push(`${stage} contains duplicate check names`);
    // MAINT-0016: under auto-merge GitHub requires the profile's checks before any merge, so a required check may be
    // `enforced` rather than waited for; what the agent ran itself is listed too, and at least one of those passed.
    const counts = c => c?.result === 'passed' || (enforcedChecks && c?.result === 'enforced' && requiredChecks.includes(c?.name));
    for (const c of s.checks) {
      if (isObject(c) && c.result === 'enforced' && !enforcedChecks) errors.push(`${stage} check ${JSON.stringify(c.name)} is "enforced", which only a project with approval.auto_merge may use`);
      else if (!isObject(c) || typeof c.name !== 'string' || !c.name.trim() || !counts(c) || !reference(c.reference)) errors.push(`${stage} check ${JSON.stringify(c?.name)} did not pass or has no https reference`);
    }
    for (const name of requiredChecks) if (!s.checks.some(c => c?.name === name && counts(c))) errors.push(`${stage}: required check ${name} did not pass`);
    if (stage === 'verification' && !s.checks.some(c => c?.result === 'passed')) errors.push('verification lists no check the agent ran and saw pass');
  }
```

Replace the review-candidate line `if (x.candidate !== revision) errors.push('review was not of this candidate revision');` with:

```js
    if (x.candidate !== revision && !(carried.review && x.candidate === carried.review)) errors.push('review was not of this candidate revision');
```

Append to the file:

```js
// MAINT-0016: the review's level (procedures/review.md). A change to a path the project names in review.deep_paths needs a
// deep review, by the configured second model or with the reason it could not be used (review.fallback); running out of
// a second model is then a recorded fallback, not a stop.
export const REVIEW_LEVELS = ['light', 'standard', 'deep'];
const BLOCKING = /^(?:blocking|critical|high)$/i;
export const isBlocking = f => BLOCKING.test(String(f?.severity ?? '').trim());
export function reviewLevelErrors({ review, deep = [], secondModel = null }) {
  if (!isObject(review)) return [];
  const errors = [];
  if (review.level !== undefined && !REVIEW_LEVELS.includes(review.level)) errors.push(`review level must be one of ${REVIEW_LEVELS.join(', ')}`);
  for (const k of ['model', 'fallback']) if (review[k] !== undefined && (typeof review[k] !== 'string' || !review[k].trim())) errors.push(`review ${k} must be a non-empty text when given`);
  if (deep.length && review.level !== 'deep') errors.push(`it changes paths that need a deep review (review.deep_paths): ${deep.join(', ')}; this review's level is ${review.level ?? 'standard'}`);
  else if (deep.length && secondModel && review.model !== secondModel.model && !(typeof review.fallback === 'string' && review.fallback.trim())) errors.push(`a deep review is by ${secondModel.model} (review.second_model), or says in review.fallback why it could not be`);
  return errors;
}
```

In `validator/lib/acceptance.js`, change the signature of `evaluateAcceptance` to add `carriedFrom = null`:

```js
export function evaluateAcceptance({ baseline, candidate, task, execution, requiredIds = [], taskRequirements, enforced = false, pending = new Map(), carriedFrom = null }) {
```

and the execution-revision line to:

```js
    if ((execution?.revision !== candidate.name && !(carriedFrom && execution?.revision === carriedFrom)) || !Array.isArray(execution?.tests)) errors.push('execution evidence is missing or names a different candidate revision');
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test validator/test/delivery-evidence.test.js && npm test`
Expected: PASS. Existing parse tests still see the same messages, since `what` is `delivery evidence`.

- [ ] **Step 5: Commit**

```bash
git add validator/lib/delivery-evidence.js validator/lib/acceptance.js validator/test/delivery-evidence.test.js
git commit -m "MAINT-0016: delivery evidence may name checks GitHub enforces, carried revisions and the review's level

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `wf ci` — carry-over, enforced checks, deep paths and the Done note

**Files:**
- Modify: `validator/lib/ci.js`
- Test: `validator/test/checkpoints.test.js`

**Interfaces:**
- Consumes:
  - `carriedFrom` (Task 2), `matchesAny` (Task 2);
  - `evidenceErrors({ enforcedChecks, carried })`, `reviewLevelErrors` and `evaluateAcceptance({ carriedFrom })` (Task 3).
- Produces: findings `note: the review of <sha12> carries over: …`, `delivery evidence: the review of <sha12> does not carry over (…)`, and `note: T-NNNN stays Active in this pull request; …`.

- [ ] **Step 1: Write the failing tests**

In `validator/test/checkpoints.test.js`, let `setup`'s `run` pass an environment. Replace the `run` definition with:

```js
  const run = (cmd, { evidence, raw, args = [], env = {} } = {}) => {
    const extra = [];
    if (evidence !== undefined || raw !== undefined) { fs.writeFileSync(evidenceFile, raw ?? JSON.stringify(evidence)); extra.push('--delivery-evidence', evidenceFile); }
    return spawnSync(process.execPath, [cli, cmd, '--repo', repo, '--baseline', baseline, '--candidate', candidate, '--task', 'T-0001', '--json', ...extra, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
  };
```

Append:

```js
// MAINT-0016: what lets a pull request finish without waiting or re-reviewing.
const runAt = (p, baseline, candidate, ev, env = {}) => {
  const file = path.join(p.temp, 'evidence-at.json'); fs.writeFileSync(file, JSON.stringify(ev));
  return spawnSync(process.execPath, [cli, 'ci', '--repo', p.repo, '--baseline', baseline, '--candidate', candidate, '--task', 'T-0001', '--json', '--delivery-evidence', file], { encoding: 'utf8', env: { ...process.env, ...env } });
};
// The trusted branch moves after the review (another change merges), and the task's branch merges it in.
function mainMoves(p) {
  p.git('branch', 'task', p.candidate);
  p.git('reset', '-q', '--hard', p.baseline);
  p.write('src/b.js', 'export const b = 2;\n'); p.git('add', '-A'); p.git('commit', '-qm', 'another change merges'); const main = p.git('rev-parse', 'HEAD');
  p.git('switch', '-q', 'task'); p.git('merge', '-q', '--no-edit', main);
  return { main, head: p.git('rev-parse', 'HEAD') };
}
const reviewedAt = (p, rev) => ({ context: { provider: 'claude-code subagent', context_id: 'ctx-1', inherited_context: false, candidate: rev, launch_evidence: 'https://github.com/fixture/project/pull/1#issuecomment-1' } });

test('MAINT-0016: review and verification of the reviewed commit carry over a merge of the trusted branch; integration does not', t => {
  const p = setup(t, { checkpoint: 'milestone' });
  const { main, head } = mainMoves(p);
  const e = evidence(head, { verification: { revision: p.candidate, execution: { revision: p.candidate, tests: [] } }, review: reviewedAt(p, p.candidate) });
  const r = runAt(p, main, head, e);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(out(r).findings.some(f => /^note: the review of [0-9a-f]{12} carries over/.test(f)), out(r).findings.join(' | '));
  assert.equal(out(r).merge, 'agent');
  const stale = runAt(p, main, head, { ...e, integration: { ...e.integration, revision: p.candidate } });
  assert.equal(stale.status, 1);
  assert.match(out(stale).findings.join(' | '), /integration evidence is not for this candidate revision/);
});

test('MAINT-0016: a commit of the task\'s own code after the review needs a new review', t => {
  const p = setup(t, { checkpoint: 'milestone' });
  p.write('src/a.js', 'export const result = 2;\n'); p.git('add', '-A'); p.git('commit', '-qm', 'T-0001: after review'); const head = p.git('rev-parse', 'HEAD');
  const r = runAt(p, p.baseline, head, evidence(head, { review: reviewedAt(p, p.candidate) }));
  assert.equal(r.status, 1);
  assert.match(out(r).findings.join(' | '), /the review of [0-9a-f]{12} does not carry over \(changed since [0-9a-f]{12}: src\/a\.js\)/);
});

test('MAINT-0016: with auto_merge, required checks may be enforced by GitHub rather than waited for', t => {
  const auto = c => ({ ...c, approval: { ...c.approval, auto_merge: true } });
  const enforcedCheck = { name: 'unit', result: 'enforced', reference: 'https://github.com/fixture/project/pull/1/checks' };
  const p = setup(t, { checkpoint: 'milestone', configEdit: auto });
  const e = evidence(p.candidate, { verification: { checks: [check('npm test'), enforcedCheck] }, integration: { revision: p.candidate, environment: 'GitHub Actions, required before merge', checks: [enforcedCheck] } });
  const r = p.run('ci', { evidence: e });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(out(r).merge, 'agent');
  const off = setup(t, { checkpoint: 'milestone' });
  const r2 = off.run('ci', { evidence: evidence(off.candidate, { integration: { revision: off.candidate, environment: 'x', checks: [enforcedCheck] } }) });
  assert.equal(r2.status, 1);
  assert.match(out(r2).findings.join(' | '), /"enforced", which only a project with approval\.auto_merge may use/);
});

test('MAINT-0016: a change to a deep path needs a deep review by the second model, or a stated fallback', t => {
  const review = { second_model: { tool: 'codex', model: 'gpt-6.1-sol', max_effort: 'high' }, deep_paths: ['src/**'] };
  const p = setup(t, { checkpoint: 'milestone', configEdit: c => ({ ...c, review }) });
  const at = over => p.run('ci', { evidence: evidence(p.candidate, { review: over }) });
  assert.match(out(at({})).findings.join(' | '), /need a deep review \(review\.deep_paths\): src\/a\.js; this review's level is standard/);
  assert.match(out(at({ level: 'deep' })).findings.join(' | '), /a deep review is by gpt-6\.1-sol/);
  assert.equal(at({ level: 'deep', model: 'gpt-6.1-sol' }).status, 0);
  assert.equal(at({ level: 'deep', model: 'claude-opus-5-5', fallback: 'codex is not signed in on this machine' }).status, 0);
});

test('MAINT-0016: a finished pull request that leaves its task Active is told to carry the Done record', t => {
  const p = setup(t, { checkpoint: 'milestone', change: q => { q.write('src/a.js', 'export const result = 1;\n'); q.edit(taskPath, x => x.replace('status: Ready', 'status: Active')); } });
  assert.ok(out(p.run('ci', { evidence: evidence(p.candidate) })).findings.some(f => /^note: T-0001 stays Active in this pull request; mark it Done as its last commit/.test(f)));
  const ready = setup(t, { checkpoint: 'milestone' });
  assert.ok(!out(ready.run('ci', { evidence: evidence(ready.candidate) })).findings.some(f => /stays Active/.test(f)));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test validator/test/checkpoints.test.js`
Expected: the five new tests FAIL: no carry-over, `enforced` is refused even with `auto_merge`, no deep-path rule, no note.

- [ ] **Step 3: Implement**

In `validator/lib/ci.js`, extend the imports:

```js
import { classifyPaths, matchesAny } from './paths.js';
import { evidenceErrors, isBlocking, reviewLevelErrors } from './delivery-evidence.js';
import { carriedFrom } from './carry.js';
```

(replace the existing `classifyPaths` and `evidenceErrors` import lines; `isBlocking` is used in Task 5).

Replace the covered block (from `let attested = null;` to the closing `}` of `if (covered) { … }`) with:

```js
  let attested = null;
  let carried = {};
  const covered = prMode && selected.length > 0 && production.length > 0;
  if (covered) {
    const owners = [...new Set(selected.map(id => candidateRecords.tasks.get(id)?.data?.owner))];
    const requiredChecks = list(baselineRecords.profile?.data?.required_checks);
    if (deliveryEvidence == null) {
      findings.push('delivery evidence for this candidate is missing: post it in the pull request description (procedures/execute.md *Checkpoints and task records*); the `wf ci` check reruns when the description is edited');
      fail = true;
    } else {
      // MAINT-0016: review and verification of an earlier revision carry over when the commits since added only the
      // trusted branch's changes and records (lib/carry.js); integration stays the exact candidate's.
      for (const [stage, from] of [['verification', deliveryEvidence.verification?.revision], ['review', deliveryEvidence.review?.context?.candidate]]) {
        if (typeof from !== 'string' || from === candidate.name) continue;
        const c = carriedFrom({ config, baseline, candidate, from });
        if (c.ok) { carried[stage] = from; findings.push(`note: the ${stage} of ${from.slice(0, 12)} carries over: since then this candidate took only the trusted branch's changes and records`); }
        else findings.push(`delivery evidence: the ${stage} of ${from.slice(0, 12)} does not carry over (${c.why})`);
      }
      // MAINT-0016: a change to a path the project names in review.deep_paths needs a deep review (procedures/review.md).
      const deep = production.filter(p => matchesAny(config.review?.deep_paths, p));
      const errors = [
        ...evidenceErrors({ evidence: deliveryEvidence, revision: candidate.name, taskIds: selected, owner: owners.length === 1 ? owners[0] : null, requiredChecks, enforcedChecks: config.approval?.auto_merge === true, carried }),
        ...reviewLevelErrors({ review: deliveryEvidence.review, deep, secondModel: config.review?.second_model ?? null }),
      ];
      for (const e of errors) findings.push(`delivery evidence: ${e}`);
      if (errors.length) fail = true; else attested = deliveryEvidence;
    }
  }
```

In the per-task loop, after the `if (gate.outcome === OUTCOMES.ready) { … } else if (…subset…) { … } else fail = true;` chain, add:

```js
    // MAINT-0016: a task's Done record travels as its pull request's last commit (procedures/execute.md); left Active, it
    // needs a records pull request of its own later, one more round of checks.
    if (attested && gate.status === 'Active') findings.push(`note: ${id} stays Active in this pull request; mark it Done as its last commit (procedures/execute.md) unless more of its work follows, or its Done record needs a pull request of its own`);
```

In the acceptance call, pass the carried revision:

```js
    const acceptance = evaluateAcceptance({ baseline, candidate, taskRequirements, execution, enforced: prMode && !attested && trust.label, pending, carriedFrom: carried.verification ?? null });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test validator/test/checkpoints.test.js && npm test`
Expected: PASS. If an existing test compares a whole `findings` array with `deepEqual` and now sees the Active note, the fixture's task is Active there. Check that test's intent: the note is informational, and the expectation gains the note line.

- [ ] **Step 5: Commit**

```bash
git add validator/lib/ci.js validator/test/checkpoints.test.js
git commit -m "MAINT-0016: wf ci carries review over a clean merge, accepts enforced checks under auto-merge, requires deep reviews on deep paths

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `wf ci` — approvals at acceptance, `accepted_findings`, and the auto-merge guard

**Files:**
- Modify: `validator/lib/ci.js`, `validator/cli.js`
- Test: `validator/test/checkpoints.test.js`

**Interfaces:**
- Consumes: `isBlocking` (Task 3); `setup(…).run(cmd, { env })` (Task 4).
- Produces:
  - `evaluateCi({ …, autoMerge = false, acceptanceEvidence = null })` (`acceptanceEvidence` is used in Task 7);
  - a passing owner-merge result carries `deferred: string[]` when anything was deferred;
  - `cli.js` reads `WF_PR_AUTO_MERGE`.

- [ ] **Step 1: Write the failing tests**

Append to `validator/test/checkpoints.test.js`:

```js
const deferring = c => ({ ...c, approval: { ...c.approval, defer_to_acceptance: true } });
const minorFinding = [{ id: 'N1', severity: 'should fix', status: 'accepted', resolution: 'carried to T-0002' }];

test('MAINT-0016: with defer_to_acceptance a minor accepted finding waits for the acceptance, listed in the task record; a blocking one is still the owner\'s merge', t => {
  const listed = setup(t, { checkpoint: 'milestone', configEdit: deferring, change: q => { q.write('src/a.js', 'export const result = 1;\n'); q.edit(taskPath, x => x.replace('subset: []', 'subset: []\naccepted_findings: [R-0001/N1]')); } });
  const ok = listed.run('ci', { evidence: evidence(listed.candidate, { review: { findings: minorFinding } }) });
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.equal(out(ok).merge, 'agent');
  assert.deepEqual(out(ok).deferred, ['review findings accepted rather than fixed: N1']);

  const unlisted = setup(t, { checkpoint: 'milestone', configEdit: deferring });
  const missing = unlisted.run('ci', { evidence: evidence(unlisted.candidate, { review: { findings: minorFinding } }) });
  assert.equal(missing.status, 1);
  assert.match(out(missing).findings.join(' | '), /accepted findings N1 are not in the task record's accepted_findings \(as REVIEW\/FINDING, for example R-0030\/N1\)/);

  const blocking = setup(t, { checkpoint: 'milestone', configEdit: deferring });
  const b = blocking.run('ci', { evidence: evidence(blocking.candidate, { review: { findings: [{ id: 'F1', severity: 'blocking', status: 'accepted', resolution: 'for the owner to decide' }] } }) });
  assert.equal(b.status, 0, b.stdout + b.stderr);
  assert.equal(out(b).merge, 'owner');
  assert.match(out(b).owner_reasons.join(' | '), /blocking review findings accepted rather than fixed: F1/);
});

test('MAINT-0016: with defer_to_acceptance, changed acceptance tests wait for the acceptance; the plan stays the owner\'s merge', t => {
  const acceptance = setup(t, {
    checkpoint: 'plan', configEdit: c => deferring({ ...c, paths: { ...c.paths, acceptance_tests: ['tests/acceptance-map.json', 'src/acceptance/**'] } }),
    change: q => { q.write('src/a.js', 'export const result = 1;\n'); q.write('src/acceptance/a.test.js', 'test("a", () => {});\n'); },
  });
  const a = acceptance.run('ci', { evidence: evidence(acceptance.candidate) });
  assert.equal(a.status, 0, a.stdout + a.stderr);
  assert.equal(out(a).merge, 'agent');
  assert.deepEqual(out(a).deferred, ['it changes acceptance tests: src/acceptance/a.test.js']);
  const governing = setup(t, { checkpoint: 'plan', configEdit: deferring, change: q => { q.write('src/a.js', 'export const result = 1;\n'); q.edit('docs/specs/feature.md', x => `${x}\nMore.\n`); } });
  const g = governing.run('ci', { evidence: evidence(governing.candidate) });
  assert.equal(out(g).merge, 'owner');
  assert.match(out(g).owner_reasons.join(' | '), /plan or requirements: docs\/specs\/feature\.md/);
});

test('MAINT-0016: auto-merge on a pull request the owner merges, or in a project that has not chosen it, fails wf ci', t => {
  const env = { WF_PR_AUTO_MERGE: 'on' };
  const auto = c => ({ ...c, approval: { ...c.approval, auto_merge: true } });
  const agent = setup(t, { checkpoint: 'milestone', configEdit: auto });
  const own = agent.run('ci', { evidence: evidence(agent.candidate), env });
  assert.equal(own.status, 0, own.stdout + own.stderr);
  assert.equal(out(own).merge, 'agent');
  const owner = setup(t, { checkpoint: 'milestone', configEdit: auto });
  const r = owner.run('ci', { evidence: evidence(owner.candidate, { review: { findings: [{ id: 'F2', severity: 'medium', status: 'accepted', resolution: 'kept' }] } }), env });
  assert.equal(r.status, 1);
  assert.match(out(r).findings.join(' | '), /auto-merge is on, but the owner merges this pull request \(review findings accepted rather than fixed: F2\): turn it off with gh pr merge --disable-auto/);
  const unchosen = setup(t, { checkpoint: 'milestone' });
  assert.match(out(unchosen.run('ci', { evidence: evidence(unchosen.candidate), env })).findings.join(' | '), /auto-merge is on, but this project has not chosen it/);
  assert.equal(unchosen.run('ci', { evidence: evidence(unchosen.candidate), env: { WF_PR_AUTO_MERGE: 'off' } }).status, 0, 'off, or unset as an older workflow file leaves it, changes nothing');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test validator/test/checkpoints.test.js`
Expected: the three new tests FAIL. Nothing is deferred, there is no guard, and `cli.js` ignores `WF_PR_AUTO_MERGE`.

- [ ] **Step 3: Implement**

In `validator/lib/ci.js`, change the signature:

```js
export function evaluateCi({ baseline, candidate = baseline, task, changed = [], trust = null, deliveryEvidence = null, approved = null, autoMerge = false, acceptanceEvidence = null }) {
```

Replace the owner-merge block (from `let merge = null;` through `merge = ownerReasons.length ? 'owner' : 'agent';` and its closing `}`) with:

```js
  let merge = null;
  const ownerReasons = [], deferred = [];
  if (trust?.label === 'owner-merge') {
    const checkpoint = checkpointOf(config);
    // MAINT-0016: with defer_to_acceptance the owner approves these at the milestone's acceptance, where the acceptance
    // evidence lists them (lib/acceptance-evidence.js), rather than one pull request at a time; off, as by default, they
    // stay the owner's merge.
    const defer = config.approval?.defer_to_acceptance === true && agentMerges(checkpoint);
    const later = reason => (defer ? deferred : ownerReasons).push(reason);
    const of = category => classes.filter(c => c.category === category).map(c => c.path);
    if (!agentMerges(checkpoint)) ownerReasons.push(`the owner merges every change (checkpoint ${checkpoint ?? 'change'})`);
    if (of('governing').length) ownerReasons.push(`it changes the plan or requirements: ${of('governing').join(', ')}`);
    // The records the owner approves stay the owner's whatever an older config classifies them as: a milestone's
    // acceptance lifts the checkpoint's hold, so the agent must never merge it.
    const ownerRecords = classes.filter(c => ownerRecord(c.path, rd) && !['governing', 'enforcement'].includes(c.category)).map(c => c.path);
    if (ownerRecords.length) ownerReasons.push(`it changes records the owner approves: ${ownerRecords.join(', ')}`);
    if (of('enforcement').length) ownerReasons.push(`it changes the workflow: ${of('enforcement').join(', ')}`);
    if (acceptanceTests.length) later(`it changes acceptance tests: ${acceptanceTests.join(', ')}`);
    if (waiting.length) later(`it makes acceptance scenarios wait for tasks they did not wait for, so their mapped tests may fail until then: ${waiting.join(', ')}`);
    if (done.length) later(`it completes acceptance scenarios without a test run, so their mapped tests must pass from now on: ${done.join(', ')}`);
    const accepted = (attested?.review?.findings ?? []).filter(f => f?.status === 'accepted');
    if (!defer) { if (accepted.length) ownerReasons.push(`review findings accepted rather than fixed: ${accepted.map(f => f.id).join(', ')}`); }
    else {
      const blocking = accepted.filter(isBlocking).map(f => f.id), minor = accepted.filter(f => !isBlocking(f)).map(f => f.id);
      if (blocking.length) ownerReasons.push(`blocking review findings accepted rather than fixed: ${blocking.join(', ')}`);
      if (minor.length) {
        deferred.push(`review findings accepted rather than fixed: ${minor.join(', ')}`);
        // Kept in the task record, which stays until the milestone is accepted, so the acceptance evidence can name each.
        const listed = selected.flatMap(id => list(candidateRecords.tasks.get(id)?.data?.accepted_findings));
        const missing = minor.filter(id => !listed.some(e => e.split('/').pop() === id));
        if (missing.length) { findings.push(`accepted findings ${missing.join(', ')} are not in the task record's accepted_findings (as REVIEW/FINDING, for example R-0030/N1), so the milestone's acceptance would not list them`); fail = true; }
      }
    }
    const hold = milestoneHold({ checkpoint, milestones: baselineRecords.milestones });
    for (const id of selected) {
      const m = candidateRecords.tasks.get(id)?.data?.milestone;
      if (hold?.held.has(m)) ownerReasons.push(`${id} belongs to ${m}, which waits for the owner's acceptance of ${hold.first}`);
    }
    merge = ownerReasons.length ? 'owner' : 'agent';
  }
  // MAINT-0016: auto-merge lands a pull request as soon as its required checks pass, so in owner-merge mode it must never be
  // on for one the owner merges, or in a project that has not chosen it. `wf ci` is a required check: failing it here stops
  // the merge while the other checks still run. It cannot stop an agent that merges by hand against the rule.
  if (autoMerge && trust?.label === 'owner-merge') {
    if (config.approval?.auto_merge !== true) { findings.push('auto-merge is on, but this project has not chosen it (approval.auto_merge): turn it off with gh pr merge --disable-auto'); fail = true; }
    else if (merge === 'owner') { findings.push(`auto-merge is on, but the owner merges this pull request (${ownerReasons.join('; ')}): turn it off with gh pr merge --disable-auto`); fail = true; }
  }
```

Change the return statement's merge part to:

```js
  return { verdict: fail ? 'fail' : 'pass', findings, classes, readiness, ...(merge && !fail ? { merge, owner_reasons: ownerReasons, ...(deferred.length ? { deferred } : {}) } : {}), records: records.counts };
```

In `validator/cli.js`, change the `ci` call to:

```js
    result = evaluateCi({ baseline, candidate, task: taskId(), trust, changed: paths, deliveryEvidence, autoMerge: process.env.WF_PR_AUTO_MERGE === 'on' });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test validator/test/checkpoints.test.js && npm test`
Expected: PASS. The existing test "a finding accepted with a resolution passes, but the owner merges it" still passes: without `defer_to_acceptance`, its reason text is unchanged.

- [ ] **Step 5: Commit**

```bash
git add validator/lib/ci.js validator/cli.js validator/test/checkpoints.test.js
git commit -m "MAINT-0016: approvals at acceptance under defer_to_acceptance; accepted_findings; wf ci refuses auto-merge on the owner's pull requests

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The `wf ci` workflow — auto-merge events and the deferred summary

**Files:**
- Modify: `templates/github/wf-ci.yml`
- Test: `validator/test/checkpoints.test.js`

**Interfaces:**
- Consumes: `deferred` in `wf ci`'s JSON (Task 5); `WF_PR_AUTO_MERGE` (Task 5).
- Produces:
  - the template triggers on `auto_merge_enabled` and `auto_merge_disabled`;
  - the gate step's environment has `WF_PR_AUTO_MERGE`;
  - the summary has a "For the owner at the milestone's acceptance" list.

- [ ] **Step 1: Write the failing tests**

In `validator/test/checkpoints.test.js`, inside the test "the wf ci workflow summary names who merges, lists failing reasons and never stays blank", after the `run({ verdict: 'pass', findings: [], merge: 'agent', owner_reasons: [] })` assertion, add:

```js
  assert.match(run({ verdict: 'pass', findings: [], merge: 'agent', owner_reasons: [], deferred: ['it changes acceptance tests: a'] }).summary, /\*\*For the owner at the milestone's acceptance:\*\*\n- it changes acceptance tests: a/);
```

Append a new test:

```js
test('MAINT-0016: the wf ci workflow runs when auto-merge is turned on or off, and passes it to the gate as an environment value', () => {
  const template = fs.readFileSync(fileURLToPath(new URL('../../templates/github/wf-ci.yml', import.meta.url)), 'utf8');
  assert.match(template, /types: \[opened, synchronize, reopened, edited, auto_merge_enabled, auto_merge_disabled\]/);
  assert.match(template, /WF_PR_AUTO_MERGE: \$\{\{ github\.event\.pull_request\.auto_merge && 'on' \|\| 'off' \}\}/);
  assert.doesNotMatch(template, /--auto-merge/, 'an older pinned validator would refuse an unknown option');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test validator/test/checkpoints.test.js`
Expected: FAIL. No deferred list, no events, no environment value.

- [ ] **Step 3: Implement**

In `templates/github/wf-ci.yml`, append to the header comment:

```yaml
# Under owner-merge with approval.auto_merge (MAINT-0016) the agent turns on auto-merge for the pull requests `wf ci` leaves
# to it; this check also runs when auto-merge is turned on or off, and fails a pull request the owner merges that has it
# on, so GitHub cannot merge it on the other checks alone.
```

Change the trigger types:

```yaml
on:
  pull_request:
    types: [opened, synchronize, reopened, edited, auto_merge_enabled, auto_merge_disabled]
```

In the "Run the gate" step's `env:`, after `DESCRIPTION: …`, add:

```yaml
          # Whether auto-merge is on (MAINT-0016): an environment value, which an older pinned validator ignores.
          WF_PR_AUTO_MERGE: ${{ github.event.pull_request.auto_merge && 'on' || 'off' }}
```

In the summary script, after the `if (r.merge === "owner") { … }` line, add:

```js
              if (r.deferred?.length) lines.push("**For the owner at the milestone's acceptance:**", ...r.deferred.map(x => `- ${x}`));
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test validator/test/checkpoints.test.js && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add templates/github/wf-ci.yml validator/test/checkpoints.test.js
git commit -m "MAINT-0016: the wf ci workflow runs on auto-merge changes and lists what waits for the acceptance

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Acceptance evidence on the pull request that accepts a milestone

**Files:**
- Create: `validator/lib/acceptance-evidence.js`, `templates/acceptance-evidence.json`
- Modify: `validator/lib/ci.js`, `validator/cli.js`
- Test: `validator/test/acceptance-evidence.test.js` (create), `validator/test/checkpoints.test.js`

**Interfaces:**
- Consumes:
  - `parseMarked` (Task 3);
  - `gitSource().changedPaths` (Task 2);
  - `evaluateCi({ acceptanceEvidence })` (Task 5 signature).
- Produces:
  - `ACCEPTANCE_MARKER` (`'<!-- agent-workflow:acceptance-evidence@1 -->'`);
  - `parseAcceptanceEvidence(text)` → object or `null`;
  - `acceptanceEvidenceErrors({ evidence, milestone, config, candidate, records })` → `string[]`.

- [ ] **Step 1: Write the failing tests**

Create `validator/test/acceptance-evidence.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { gitSource } from '../lib/index.js';
import { ACCEPTANCE_MARKER, acceptanceEvidenceErrors, parseAcceptanceEvidence } from '../lib/acceptance-evidence.js';

// MAINT-0016: the pull request that accepts a milestone carries the milestone's review, the trial walked in a browser
// before the owner tries it, and what the agent decided for the owner's acceptance, each bound to the code being accepted.
const config = { paths: { production: ['src/**'], governing: ['docs/workflow/milestones/**'], planning: ['docs/**'] } };
function repo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-acceptance-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => { const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  const write = (p, text) => { fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true }); fs.writeFileSync(path.join(dir, p), text); };
  const commit = m => { git('add', '-A'); git('commit', '-qm', m); return git('rev-parse', 'HEAD'); };
  git('init', '-q', '-b', 'main'); git('config', 'user.name', 'T'); git('config', 'user.email', 't@example.invalid');
  write('src/a.js', 'a\n'); write('docs/workflow/milestones/M-0001.md', 'status: Verified\n');
  const accepted = commit('the code being accepted');
  write('docs/workflow/milestones/M-0001.md', 'status: Accepted\n');
  const head = commit('Accept M-0001');
  return { write, commit, accepted, head, at: rev => gitSource(dir, rev) };
}
function evidence(rev) {
  return {
    schema: 'agent-workflow/acceptance-evidence@1', milestone: 'M-0001', candidate: rev,
    review: { reviewer: 'codex exec, fresh context', model: 'gpt-6.1-sol', revision: rev, report: 'https://github.com/o/r/pull/9#issuecomment-1' },
    walkthrough: {
      revision: rev, environment: 'local build with the demo seed', walker: 'trial-walker subagent', languages: ['en', 'ar'], viewports: ['1366x900', '390x844'],
      steps: [{ step: '1. Import the list', expected: 'two added, one duplicate', observed: 'two added, one duplicate', result: 'passed', screenshot: 'https://github.com/o/r/pull/9#step-1' }],
    },
    deferred: ['R-0001/N1: a cleanup failure can go unreported (test helper only)'],
    tests_changed: [],
  };
}
const records = (accepted = ['R-0001/N1']) => ({ tasks: new Map([['T-0001', { data: { milestone: 'M-0001', accepted_findings: accepted } }], ['T-0002', { data: { milestone: 'M-0002', accepted_findings: ['R-0009/X1'] } }]]) });
const errorsAt = (r, rev, e, rec = records()) => acceptanceEvidenceErrors({ evidence: e, milestone: 'M-0001', config, candidate: r.at(rev), records: rec });

test('complete acceptance evidence for the code being accepted has no errors', t => {
  const r = repo(t);
  assert.deepEqual(errorsAt(r, r.head, evidence(r.accepted)), []);
  assert.deepEqual(errorsAt(r, r.head, evidence(r.head)), [], 'the head itself, when only records changed');
});

test('a production change after the accepted, reviewed or walked revision fails', t => {
  const r = repo(t);
  r.write('src/a.js', 'changed after the walkthrough\n'); const later = r.commit('a late fix');
  const errors = errorsAt(r, later, evidence(r.accepted)).join(' | ');
  assert.match(errors, /the accepted candidate [0-9a-f]{12} is followed by changes to src\/a\.js/);
  assert.match(errors, /the milestone review's revision [0-9a-f]{12} is followed by changes to src\/a\.js/);
  assert.match(errors, /the walkthrough's revision [0-9a-f]{12} is followed by changes to src\/a\.js/);
});

test('a step that did not pass, a missing screenshot, or an empty not_applicable fails', t => {
  const r = repo(t);
  const failed = evidence(r.accepted); failed.walkthrough.steps[0].result = 'failed';
  assert.match(errorsAt(r, r.head, failed).join(' | '), /walkthrough step 1 did not pass: fix it, or correct the step, and walk it again/);
  const noShot = evidence(r.accepted); delete noShot.walkthrough.steps[0].screenshot;
  assert.match(errorsAt(r, r.head, noShot).join(' | '), /walkthrough step 1 needs an https screenshot reference/);
  const na = evidence(r.accepted); na.walkthrough = { not_applicable: ' ' };
  assert.match(errorsAt(r, r.head, na).join(' | '), /a walkthrough that does not apply says only why, in not_applicable/);
  na.walkthrough = { not_applicable: 'the project has no user interface: it is a command-line tool' };
  assert.deepEqual(errorsAt(r, r.head, na), []);
});

test('deferred names every finding the milestone\'s tasks accepted rather than fixed, and only that milestone\'s', t => {
  const r = repo(t);
  assert.match(errorsAt(r, r.head, evidence(r.accepted), records(['R-0001/N1', 'R-0002/F7'])).join(' | '), /deferred must list the findings the milestone's tasks accepted rather than fixed: R-0002\/F7/);
  assert.deepEqual(errorsAt(r, r.head, evidence(r.accepted), records([])), [], 'T-0002 belongs to another milestone');
});

test('the wrong milestone, an unknown field or a missing review fails; the block is read from a pull request description', t => {
  const r = repo(t);
  const e = evidence(r.accepted);
  assert.match(errorsAt(r, r.head, { ...e, milestone: 'M-0002' }).join(' | '), /must name the milestone this pull request accepts, M-0001/);
  assert.match(errorsAt(r, r.head, { ...e, extra: 1 }).join(' | '), /unknown field extra/);
  assert.match(errorsAt(r, r.head, { ...e, review: undefined }).join(' | '), /the milestone review is missing/);
  assert.deepEqual(parseAcceptanceEvidence(`Accept M-0001.\n\n${ACCEPTANCE_MARKER}\n\`\`\`json\n${JSON.stringify(e)}\n\`\`\`\n`), e);
  assert.equal(parseAcceptanceEvidence('no block here'), null);
});

test('the acceptance evidence template has exactly the checked fields', () => {
  const t = JSON.parse(fs.readFileSync(new URL('../../templates/acceptance-evidence.json', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(t), ['schema', 'milestone', 'candidate', 'review', 'walkthrough', 'deferred', 'tests_changed']);
  assert.equal(t.schema, 'agent-workflow/acceptance-evidence@1');
});
```

Append to `validator/test/checkpoints.test.js`:

```js
test('MAINT-0016: with acceptance_evidence, the pull request that accepts a milestone carries the acceptance evidence', t => {
  const accept = q => q.edit('docs/workflow/milestones/M-0001.md', x => x.replace('status: Authorised', 'status: Accepted'));
  const p = setup(t, { checkpoint: 'milestone', configEdit: c => ({ ...c, acceptance_evidence: true }), change: accept });
  const missing = p.run('ci');
  assert.equal(missing.status, 1);
  assert.match(out(missing).findings.join(' | '), /acceptance evidence: the acceptance evidence for M-0001 is missing/);
  const block = {
    schema: 'agent-workflow/acceptance-evidence@1', milestone: 'M-0001', candidate: p.baseline,
    review: { reviewer: 'codex exec', model: 'gpt-6.1-sol', revision: p.baseline, report: 'https://github.com/fixture/project/pull/9#issuecomment-1' },
    walkthrough: { not_applicable: 'the fixture has no user interface' }, deferred: [], tests_changed: [],
  };
  const ok = p.run('ci', { raw: `Accept M-0001\n\n<!-- agent-workflow:acceptance-evidence@1 -->\n\`\`\`json\n${JSON.stringify(block)}\n\`\`\`\n` });
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.equal(out(ok).merge, 'owner', 'the acceptance stays the owner\'s merge');
  const without = setup(t, { checkpoint: 'milestone', change: accept });
  assert.equal(without.run('ci').status, 0, 'a project that has not asked for it is unchanged');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test validator/test/acceptance-evidence.test.js validator/test/checkpoints.test.js`
Expected: FAIL with `Cannot find module '../lib/acceptance-evidence.js'`, and the checkpoint test fails because nothing asks for the evidence.

- [ ] **Step 3: Implement**

Create `validator/lib/acceptance-evidence.js`:

```js
// The acceptance evidence (templates/acceptance-evidence.json, MAINT-0016): what the pull request that accepts a milestone
// carries in the pull-request modes when the project sets acceptance_evidence. It holds the milestone's review, the trial
// walked in a browser before the owner tries it (procedures/accept-release.md), and what the agent decided for the owner's
// acceptance. Like the delivery evidence it is the agent's own report: its completeness and its binding to the code being
// accepted are checked here, not its truth.
import { classifyPaths } from './paths.js';
import { list } from './records.js';
import { parseMarked } from './delivery-evidence.js';

export const ACCEPTANCE_MARKER = '<!-- agent-workflow:acceptance-evidence@1 -->';
export const parseAcceptanceEvidence = text => parseMarked(text, ACCEPTANCE_MARKER, 'acceptance evidence');
const KEYS = ['schema', 'milestone', 'candidate', 'review', 'walkthrough', 'deferred', 'tests_changed'];
const isObject = v => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = v => typeof v === 'string' && v.trim() !== '';
const https = v => { if (typeof v !== 'string' || /\s/.test(v)) return false; try { const u = new URL(v); return u.protocol === 'https:' && !!u.hostname && !u.username && !u.password; } catch { return false; } };

// A revision the acceptance relies on: in this pull request's history, with only records changed since (planning and
// governing paths, since the acceptance itself changes the milestone record), never an acceptance test.
function covers(config, candidate, rev, what) {
  if (!/^[0-9a-f]{40,64}$/.test(rev ?? '')) return [`${what} needs a full commit hash`];
  if (rev === candidate.name) return [];
  if (candidate.kind !== 'git' || !candidate.isAncestor(rev)) return [`${what} ${rev.slice(0, 12)} is not in this pull request's history`];
  const code = classifyPaths(config, candidate.changedPaths(rev)).filter(c => !['planning', 'governing'].includes(c.category) || c.acceptance_test).map(c => c.path);
  return code.length ? [`${what} ${rev.slice(0, 12)} is followed by changes to ${code.slice(0, 5).join(', ')}${code.length > 5 ? ', …' : ''}; review and walk the code being accepted`] : [];
}

export function acceptanceEvidenceErrors({ evidence: e, milestone, config, candidate, records }) {
  if (!isObject(e)) return ['acceptance evidence is missing'];
  const errors = [];
  for (const k of Object.keys(e)) if (!KEYS.includes(k)) errors.push(`acceptance evidence has an unknown field ${k}`);
  if (e.schema !== 'agent-workflow/acceptance-evidence@1') errors.push('acceptance evidence schema must be agent-workflow/acceptance-evidence@1');
  if (e.milestone !== milestone) errors.push(`acceptance evidence must name the milestone this pull request accepts, ${milestone}`);
  errors.push(...covers(config, candidate, e.candidate, 'the accepted candidate'));
  const r = e.review;
  if (!isObject(r)) errors.push('the milestone review is missing');
  else {
    for (const k of ['reviewer', 'model']) if (!text(r[k])) errors.push(`the milestone review needs its ${k}`);
    if (!https(r.report)) errors.push('the milestone review needs an https reference to its report');
    errors.push(...covers(config, candidate, r.revision, 'the milestone review\'s revision'));
  }
  const w = e.walkthrough;
  if (!isObject(w)) errors.push('the trial walkthrough is missing');
  else if (Object.hasOwn(w, 'not_applicable')) { if (!text(w.not_applicable) || Object.keys(w).length > 1) errors.push('a walkthrough that does not apply says only why, in not_applicable'); }
  else {
    errors.push(...covers(config, candidate, w.revision, 'the walkthrough\'s revision'));
    for (const k of ['environment', 'walker']) if (!text(w[k])) errors.push(`the walkthrough needs its ${k}`);
    for (const k of ['languages', 'viewports']) if (!Array.isArray(w[k]) || !w[k].length || !w[k].every(text)) errors.push(`the walkthrough lists its ${k}`);
    if (!Array.isArray(w.steps) || !w.steps.length) errors.push('the walkthrough lists no steps');
    else w.steps.forEach((s, i) => {
      if (!isObject(s) || !['step', 'expected', 'observed'].every(k => text(s[k]))) errors.push(`walkthrough step ${i + 1} needs step, expected and observed`);
      else if (s.result !== 'passed') errors.push(`walkthrough step ${i + 1} did not pass: fix it, or correct the step, and walk it again`);
      else if (!https(s.screenshot)) errors.push(`walkthrough step ${i + 1} needs an https screenshot reference`);
    });
  }
  for (const k of ['deferred', 'tests_changed']) if (!Array.isArray(e[k]) || !e[k].every(text)) errors.push(`acceptance evidence ${k} must be a list of lines (empty when there is nothing)`);
  // Every finding the milestone's tasks accepted rather than fixed (their accepted_findings) is listed for the owner.
  const owed = [...records.tasks.values()].map(t => t.data).filter(t => t?.milestone === milestone).flatMap(t => list(t.accepted_findings));
  const missing = owed.filter(id => !(Array.isArray(e.deferred) ? e.deferred : []).some(d => typeof d === 'string' && d.includes(id)));
  if (missing.length) errors.push(`deferred must list the findings the milestone's tasks accepted rather than fixed: ${missing.join(', ')}`);
  return errors;
}
```

Create `templates/acceptance-evidence.json`:

```json
{
  "schema": "agent-workflow/acceptance-evidence@1",
  "milestone": "<M-NNNN this pull request accepts>",
  "candidate": "<full commit hash of the code being accepted; only records may change after it>",
  "review": {
    "reviewer": "<the milestone reviewer: tool and context, e.g. codex exec in a fresh context>",
    "model": "<its model, e.g. the configured review.second_model>",
    "revision": "<full commit hash it reviewed (the whole milestone diff)>",
    "report": "<https link to the posted review report (templates/review.md)>"
  },
  "walkthrough": {
    "revision": "<full commit hash walked>",
    "environment": "<how the app ran: local build, demo data seed, browser>",
    "walker": "<the trial-walker agent and its context identifier>",
    "languages": ["<each language walked>"],
    "viewports": ["<each screen size walked, e.g. 1366x900, 390x844>"],
    "steps": [
      { "step": "<the trial step, as the owner will read it>", "expected": "<what the step says should happen>", "observed": "<what the walker saw>", "result": "passed", "screenshot": "<https link to the screenshot>" }
    ]
  },
  "deferred": ["<each item wf ci deferred to this acceptance, and every accepted_findings entry of the milestone's tasks, in plain words>"],
  "tests_changed": ["<each acceptance test changed in this milestone>"]
}
```

(A project without a user interface writes `"walkthrough": { "not_applicable": "<why>" }`.)

In `validator/lib/ci.js`, add the import:

```js
import { acceptanceEvidenceErrors } from './acceptance-evidence.js';
```

and, directly before `let merge = null;`, add:

```js
  // MAINT-0016: the pull request that accepts a milestone carries the acceptance evidence where the project asks for it
  // (acceptance_evidence; lib/acceptance-evidence.js): the milestone's review, the trial walkthrough, and what was deferred.
  const accepting = [...candidateRecords.milestones.values()].map(r => r.data).filter(m => m?.id && m.status === 'Accepted' && baselineRecords.milestones.get(m.id)?.data?.status !== 'Accepted').map(m => m.id);
  if (prMode && config.acceptance_evidence === true) for (const id of accepting) {
    const errors = acceptanceEvidence == null ? [`the acceptance evidence for ${id} is missing: post it in the pull request description (procedures/accept-release.md)`] : acceptanceEvidenceErrors({ evidence: acceptanceEvidence, milestone: id, config, candidate, records: candidateRecords });
    for (const e of errors) findings.push(`acceptance evidence: ${e}`);
    if (errors.length) fail = true;
  }
```

In `validator/cli.js`, add the import:

```js
import { parseAcceptanceEvidence } from './lib/acceptance-evidence.js';
```

Change `let deliveryEvidence = null;` to `let deliveryEvidence = null, acceptanceEvidence = null;`. In the `if (o['delivery-evidence']) { … }` block, replace `deliveryEvidence = parseDeliveryEvidence(fs.readFileSync(file, 'utf8'));` with:

```js
      const text = fs.readFileSync(file, 'utf8');
      deliveryEvidence = parseDeliveryEvidence(text);
      acceptanceEvidence = parseAcceptanceEvidence(text);
      // A file holding only the acceptance evidence's JSON reads as delivery evidence's raw form: move it over.
      if (deliveryEvidence?.schema === 'agent-workflow/acceptance-evidence@1') { acceptanceEvidence = deliveryEvidence; deliveryEvidence = null; }
```

and pass it to `evaluateCi`:

```js
    result = evaluateCi({ baseline, candidate, task: taskId(), trust, changed: paths, deliveryEvidence, acceptanceEvidence, autoMerge: process.env.WF_PR_AUTO_MERGE === 'on' });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test validator/test/acceptance-evidence.test.js validator/test/checkpoints.test.js && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add validator/lib/acceptance-evidence.js templates/acceptance-evidence.json validator/lib/ci.js validator/cli.js validator/test/acceptance-evidence.test.js validator/test/checkpoints.test.js
git commit -m "MAINT-0016: the acceptance pull request carries the milestone review, the trial walkthrough and what was deferred

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: `wf next` reads the newest trusted branch; its merge step names auto-merge

**Files:**
- Modify: `validator/cli.js`, `validator/lib/next.js`
- Test: `validator/test/next-baseline.test.js` (create), `validator/test/checkpoints.test.js`

**Interfaces:**
- Produces:
  - `wf next --json` without `--baseline` has `baseline` set to the newer of `refs/heads/<branch>` and `refs/remotes/origin/<branch>` when one contains the other;
  - `note` explains a behind or diverged local branch;
  - the `pr` action's run step names auto-merge under `approval.auto_merge`.

- [ ] **Step 1: Write the failing tests**

Create `validator/test/next-baseline.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// MAINT-0016: `git fetch` moves origin/<trusted branch>, never the local branch, so `wf next` reads the newer of the two
// when one contains the other, and says so. In mateen-systems a stale local main named a stale next action.
const fixture = fileURLToPath(new URL('../../fixtures/04a-accepted-decision-permits/baseline', import.meta.url));
const cli = fileURLToPath(new URL('../cli.js', import.meta.url));
function repo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-next-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.cpSync(fixture, dir, { recursive: true });
  const git = (...args) => { const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  const commit = (line, m) => { fs.appendFileSync(path.join(dir, 'README.md'), `${line}\n`); git('add', '-A'); git('commit', '-qm', m); return git('rev-parse', 'HEAD'); };
  git('init', '-q', '-b', 'main'); git('config', 'user.name', 'T'); git('config', 'user.email', 't@example.invalid');
  const first = commit('first', 'first'), second = commit('second', 'second');
  const next = () => { const r = spawnSync(process.execPath, [cli, 'next', '--repo', dir, '--json'], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stdout + r.stderr); return JSON.parse(r.stdout); };
  return { git, commit, first, second, next };
}

test('a local trusted branch behind origin reads origin, and says so', t => {
  const r = repo(t);
  r.git('update-ref', 'refs/remotes/origin/main', r.second); r.git('reset', '-q', '--hard', r.first);
  const n = r.next();
  assert.equal(n.baseline, r.second);
  assert.match(n.note, /the local main is behind origin\/main, so this reads origin\/main as last fetched/);
});

test('a local trusted branch ahead of origin, or with no remote, reads the local branch without a note', t => {
  const r = repo(t);
  assert.deepEqual([r.next().baseline, r.next().note], [r.second, undefined], 'no remote');
  r.git('update-ref', 'refs/remotes/origin/main', r.first);
  assert.deepEqual([r.next().baseline, r.next().note], [r.second, undefined], 'ahead');
});

test('a local trusted branch that has diverged from origin reads the local branch, and says so', t => {
  const r = repo(t);
  r.git('switch', '-q', '--detach', r.first); const elsewhere = r.commit('elsewhere', 'elsewhere');
  r.git('update-ref', 'refs/remotes/origin/main', elsewhere); r.git('switch', '-q', 'main');
  const n = r.next();
  assert.equal(n.baseline, r.second);
  assert.match(n.note, /the local main and origin\/main have diverged; this reads the local main/);
});
```

Append to `validator/test/checkpoints.test.js`:

```js
test('MAINT-0016: under auto_merge, wf next says to turn on auto-merge for a finished task\'s pull request', t => {
  for (const [auto, pattern] of [[true, /turn on auto-merge \(gh pr merge --auto\)/], [false, /merge it yourself only when that reports merge: agent/]]) {
    const p = setup(t, { checkpoint: 'milestone', configEdit: c => ({ ...c, approval: { ...c.approval, auto_merge: auto } }), change: q => { q.write('src/a.js', 'export const result = 1;\n'); q.edit(taskPath, x => x.replace('status: Ready', 'status: Done')); } });
    const view = evaluateNext({ baseline: gitSource(p.repo, p.baseline), candidate: gitSource(p.repo, p.candidate) });
    assert.match(JSON.stringify(view), pattern, String(auto));
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test validator/test/next-baseline.test.js validator/test/checkpoints.test.js`
Expected: FAIL. The behind case reads the local branch, no note is given, and the merge step never names auto-merge.

- [ ] **Step 3: Implement**

In `validator/cli.js`, replace the block that starts with the comment `` // `wf next` defaults its baseline to the local trusted branch `` and ends with the `else if (adopted) uncommitted = …` line and its closing `}` with:

```js
  // `wf next` defaults its baseline to the trusted branch named by the working tree's config. `git fetch` moves
  // origin/<branch>, never the local branch, so the newer of the two is read when one contains the other, and a note says
  // which (MAINT-0016). Right after bin/wf-adopt the adoption is not committed there yet: read the working tree then.
  let baselineNote = null;
  if (!o.baseline && cmd === 'next') {
    let branch = 'main', adopted = false;
    try { branch = loadConfig(dirSource(repo)).trusted_branch ?? 'main'; adopted = true; } catch { /* reported below */ }
    const run = gitRunner(repo);
    const tipOf = ref => { const r = run('rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`); return r.status === 0 ? r.stdout.trim() : null; };
    const contains = (older, newer) => run('merge-base', '--is-ancestor', older, newer).status === 0;
    const local = tipOf(`refs/heads/${branch}`), remote = tipOf(`refs/remotes/origin/${branch}`);
    let tip = local ?? remote;
    if (local && remote && local !== remote) {
      if (contains(local, remote)) { tip = remote; baselineNote = `the local ${branch} is behind origin/${branch}, so this reads origin/${branch} as last fetched; git fetch origin ${branch}:${branch} moves the local branch`; }
      else if (!contains(remote, local)) baselineNote = `the local ${branch} and origin/${branch} have diverged; this reads the local ${branch}`;
    }
    if (tip && (!adopted || gitSource(repo, tip).read('docs/workflow/config.json') != null)) o.baseline = tip;
    else if (adopted) baselineNote = `the adoption is not on ${branch} yet, so this reads the working tree: commit the scaffold (docs/workflow/, scripts/wf, AGENTS.md, CLAUDE.md, .github/, .gitignore) to ${branch}`;
  }
```

and in the `next` handler change `if (uncommitted) view.note = uncommitted;` to:

```js
    if (baselineNote) view.note = baselineNote;
```

In `validator/lib/next.js`, in the `pr` action (the line building `{ kind: 'pr', … }`), replace

```js
...(agentMerges(checkpoint) ? ['merge it yourself only when that reports merge: agent and every required check has passed; otherwise it waits for the owner'] : [])
```

with

```js
...(agentMerges(checkpoint) ? [config.approval?.auto_merge === true ? 'when that reports merge: agent, turn on auto-merge (gh pr merge --auto) and carry on with work that does not need this merge; otherwise it waits for the owner' : 'merge it yourself only when that reports merge: agent and every required check has passed; otherwise it waits for the owner'] : [])
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test validator/test/next-baseline.test.js validator/test/checkpoints.test.js && npm test`
Expected: PASS. The adopt test's "Note: the adoption is not on main yet" text is unchanged.

- [ ] **Step 5: Commit**

```bash
git add validator/cli.js validator/lib/next.js validator/test/next-baseline.test.js validator/test/checkpoints.test.js
git commit -m "MAINT-0016: wf next reads origin's trusted branch when the local one is behind; its merge step names auto-merge

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: `wf evidence` starts the delivery evidence

**Files:**
- Create: `validator/lib/evidence-skeleton.js`
- Modify: `validator/cli.js`
- Test: `validator/test/evidence-command.test.js` (create)

**Interfaces:**
- Consumes:
  - `carriedFrom` (Task 2);
  - `DELIVERY_MARKER` and `parseDeliveryEvidence` (`delivery-evidence.js`);
  - `ACCEPTANCE_MAP` (`acceptance-files.js`).
- Produces:
  - `evidenceSkeleton({ baseline, candidate, task, previous = null })` → `{ evidence, notes }`;
  - the command `wf evidence --baseline REV --candidate SHA [--task T-NNNN] [--from FILE]`, which prints the marked, fenced block to standard output and the notes to standard error.

- [ ] **Step 1: Write the failing tests**

Create `validator/test/evidence-command.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DELIVERY_MARKER, parseDeliveryEvidence } from '../lib/delivery-evidence.js';

// MAINT-0016: `wf evidence` starts the delivery evidence with what the validator can derive, so the agent writes only what
// it ran and what the review found, and carries an earlier review and verification over a clean merge.
const fixture = fileURLToPath(new URL('../../fixtures/04a-accepted-decision-permits/baseline', import.meta.url));
const cli = fileURLToPath(new URL('../cli.js', import.meta.url));
function repo(t, { approval = {}, label = 'enforced' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-evidence-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.cpSync(fixture, dir, { recursive: true });
  const cfg = path.join(dir, 'docs/workflow/config.json'), profile = path.join(dir, 'docs/workflow/profile.md');
  const c = JSON.parse(fs.readFileSync(cfg, 'utf8')); c.approval = { ...c.approval, label, mechanism: label === 'enforced' ? c.approval.mechanism : label, ...approval };
  fs.writeFileSync(cfg, JSON.stringify(c));
  fs.writeFileSync(profile, fs.readFileSync(profile, 'utf8').replace(/^approval_label: .*$/m, `approval_label: ${label}`));
  fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'tests/acceptance-map.json'), JSON.stringify([{ acceptance: 'AC-001-1', file: 'tests/a.test.js', name: 'works' }, { acceptance: 'AC-009-1', file: 'tests/z.test.js', name: 'other' }]));
  const git = (...args) => { const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  git('init', '-q', '-b', 'main'); git('config', 'user.name', 'T'); git('config', 'user.email', 't@example.invalid');
  git('add', '-A'); git('commit', '-qm', 'base'); const base = git('rev-parse', 'HEAD');
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true }); fs.writeFileSync(path.join(dir, 'src/a.js'), 'export const a = 1;\n');
  git('add', '-A'); git('commit', '-qm', 'T-0001: work'); const candidate = git('rev-parse', 'HEAD');
  const evidence = (baseline, rev, ...extra) => {
    const r = spawnSync(process.execPath, [cli, 'evidence', '--repo', dir, '--baseline', baseline, '--candidate', rev, '--task', 'T-0001', ...extra], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(r.stdout.startsWith(DELIVERY_MARKER), r.stdout);
    return { evidence: parseDeliveryEvidence(r.stdout), stderr: r.stderr };
  };
  return { dir, git, base, candidate, evidence };
}

test('the evidence names the candidate, the task, the profile\'s required checks and the task\'s mapped tests', t => {
  const r = repo(t);
  const { evidence: e } = r.evidence(r.base, r.candidate);
  assert.equal(e.candidate, r.candidate);
  assert.deepEqual(e.tasks, ['T-0001']);
  assert.deepEqual(e.integration.checks.map(c => [c.name, c.result]), [['unit', 'passed']]);
  assert.deepEqual(e.verification.execution.tests, [{ file: 'tests/a.test.js', name: 'works', status: '' }]);
  assert.equal(e.review.implementer, 'agent');
});

test('under auto_merge the required checks are enforced, and verification keeps a line for a check the agent ran', t => {
  const r = repo(t, { label: 'owner-merge', approval: { checkpoint: 'milestone', auto_merge: true } });
  const { evidence: e } = r.evidence(r.base, r.candidate);
  assert.deepEqual(e.integration.checks.map(c => [c.name, c.result]), [['unit', 'enforced']]);
  assert.ok(e.verification.checks.some(c => c.result === 'passed'));
});

test('an earlier review and verification carry over a merge of the trusted branch, with a note', t => {
  const r = repo(t);
  const { evidence: first } = r.evidence(r.base, r.candidate);
  first.review.reviewer = 'independent-reviewer'; first.verification.environment = 'macOS, node 22';
  const prev = path.join(r.dir, '.git', 'previous-evidence.json'); fs.writeFileSync(prev, JSON.stringify(first));
  r.git('branch', 'task'); r.git('reset', '-q', '--hard', r.base);
  fs.mkdirSync(path.join(r.dir, 'src'), { recursive: true }); fs.writeFileSync(path.join(r.dir, 'src/b.js'), 'export const b = 2;\n');
  r.git('add', '-A'); r.git('commit', '-qm', 'another change merges'); const main = r.git('rev-parse', 'HEAD');
  r.git('switch', '-q', 'task'); r.git('merge', '-q', '--no-edit', main); const head = r.git('rev-parse', 'HEAD');
  const { evidence: e, stderr } = r.evidence(main, head, '--from', prev);
  assert.equal(e.candidate, head);
  assert.deepEqual([e.review.reviewer, e.verification.environment, e.integration.revision], ['independent-reviewer', 'macOS, node 22', head]);
  assert.match(stderr, /the review of [0-9a-f]{12} carries over/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test validator/test/evidence-command.test.js`
Expected: FAIL. `wf: usage` (exit 2): `evidence` is not a command.

- [ ] **Step 3: Implement**

Create `validator/lib/evidence-skeleton.js`:

```js
// `wf evidence` (MAINT-0016): the delivery evidence for a candidate with what the validator can derive already filled in:
// revisions, tasks, the profile's required checks, the mapped tests to run, and an earlier review and verification that
// carry over (lib/carry.js). The agent writes only what it ran and what the review found; `wf ci` checks the result like any
// evidence, and this grants nothing.
import { list, loadAll, loadConfig } from './records.js';
import { ACCEPTANCE_MAP } from './acceptance-files.js';
import { carriedFrom } from './carry.js';

const AREAS = ['scope', 'correctness', 'maintainability', 'security', 'regression', 'test-fidelity'];
export function evidenceSkeleton({ baseline, candidate, task, previous = null }) {
  const config = loadConfig(baseline);
  const rd = config.records_dir ?? 'docs/workflow';
  const requiredChecks = list(loadAll(baseline, rd).profile?.data?.required_checks);
  const record = loadAll(candidate, rd).tasks.get(task)?.data ?? {};
  const enforced = config.approval?.auto_merge === true;
  let map = [];
  try { map = JSON.parse(candidate.read(ACCEPTANCE_MAP) ?? '[]'); } catch { map = []; }
  const ids = new Set(list(record.acceptance));
  const required = () => requiredChecks.map(name => ({ name, result: enforced ? 'enforced' : 'passed', reference: '' }));
  const evidence = {
    schema: 'agent-workflow/delivery-evidence@1', candidate: candidate.name, assurance: 'agent-attested', tasks: [task],
    verification: {
      revision: candidate.name, environment: '',
      checks: [...(enforced ? [{ name: '', result: 'passed', reference: '' }] : []), ...required()],
      execution: { revision: candidate.name, tests: (Array.isArray(map) ? map : []).filter(m => ids.has(m?.acceptance)).map(m => ({ file: m.file, name: m.name, status: '' })) },
    },
    integration: { revision: candidate.name, environment: enforced ? 'GitHub Actions, required by the ruleset before any merge' : '', checks: required() },
    review: {
      reviewer: '', implementer: record.owner ?? '', separate_context: true, level: 'standard', model: '',
      context: { provider: '', context_id: '', inherited_context: false, candidate: candidate.name, launch_evidence: '' },
      coverage: AREAS, findings: [], tasks: [task], report: '',
    },
  };
  const notes = [];
  for (const [stage, from] of [['verification', previous?.verification?.revision], ['review', previous?.review?.context?.candidate]]) {
    if (typeof from !== 'string') continue;
    const c = carriedFrom({ config, baseline, candidate, from });
    if (c.ok) { evidence[stage] = previous[stage]; notes.push(`the ${stage} of ${from.slice(0, 12)} carries over`); }
    else notes.push(`the ${stage} of ${from.slice(0, 12)} does not carry over (${c.why}): run it again for this candidate`);
  }
  return { evidence, notes };
}
```

In `validator/cli.js`:
- Add `'evidence'` to `COMMANDS` and `'from'` to `OPTIONS`.
- Add this usage line after the `review-packet` line:

```js
  evidence --baseline REV --candidate SHA [--task T-0001] [--from PREVIOUS_EVIDENCE]: the delivery evidence, started with what can be derived; fill in what you ran and the review
```

- Change the delivery-evidence import, and add the new one:

```js
import { DELIVERY_MARKER, parseDeliveryEvidence } from './lib/delivery-evidence.js';
import { evidenceSkeleton } from './lib/evidence-skeleton.js';
```

- Directly before `let result;` (after `const emit = …`), add:

```js
  // MAINT-0016: the delivery evidence, started (lib/evidence-skeleton.js). It grants nothing; `wf ci` checks the result.
  if (cmd === 'evidence') {
    if (baseline.kind !== 'git' || candidate.kind !== 'git' || !(o.candidate || o.head)) throw new WfError('evidence needs --baseline and --candidate as Git revisions');
    const task = taskId();
    if (!task) throw new WfError('--task T-0001 or a matching branch is required');
    const previous = o.from ? parseDeliveryEvidence(fs.readFileSync(o.from, 'utf8')) : null;
    const { evidence, notes } = evidenceSkeleton({ baseline, candidate, task, previous });
    for (const n of notes) console.error(`wf: ${n}`);
    console.log(`${DELIVERY_MARKER}\n\`\`\`json\n${JSON.stringify(evidence, null, 2)}\n\`\`\``);
    return 0;
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test validator/test/evidence-command.test.js && npm test`
Expected: PASS. `cli.test.js` may assert the usage text or the command list: update its expectation to include `evidence`.

- [ ] **Step 5: Commit**

```bash
git add validator/lib/evidence-skeleton.js validator/cli.js validator/test/evidence-command.test.js validator/test/cli.test.js
git commit -m "MAINT-0016: wf evidence starts the delivery evidence and carries an earlier review over a clean merge

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Templates — the trial walker, the reviewer's levels, and the records the rules read

**Files:**
- Create: `templates/claude/agents/trial-walker.md`
- Modify: `templates/claude/agents/independent-reviewer.md`, `templates/delivery-evidence.json`, `templates/acceptance.md`, `templates/task.md`, `templates/profile.md`, `config.default.json`
- Test: `validator/test/agent-templates.test.js` (create)

**Interfaces:**
- Produces:
  - the `trial-walker` agent definition (installed in Task 12 and Task 14);
  - `accepted_findings: []` in the task template;
  - `"acceptance_evidence": true` in new scaffolds.

- [ ] **Step 1: Write the failing tests**

Create `validator/test/agent-templates.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseFrontMatter } from '../lib/index.js';

// MAINT-0016: the agents a scaffold installs for Claude Code. The trial walker walks the owner's trial in a browser
// before the owner does and changes nothing; the reviewer is told its level and to review what the change can break.
const read = rel => fs.readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

test('the trial walker is a fresh-context agent that walks every step as a person would and changes no tracked file', () => {
  const text = read('templates/claude/agents/trial-walker.md');
  assert.equal(parseFrontMatter(text).data.name, 'trial-walker');
  assert.match(text, /never modify a tracked file/i);
  assert.match(text, /Do not call the app's API or change its database to make a step pass/);
  assert.match(text, /an unavailable walkthrough is a blocker, not a pass/);
});

test('the independent reviewer is told its level and to review what the change can break', () => {
  const text = read('templates/claude/agents/independent-reviewer.md');
  assert.match(text, /`light`[\s\S]*`standard`[\s\S]*`deep`/);
  assert.match(text, /review the change and what it can break/);
});

test('a new scaffold asks for acceptance evidence, and the task template lists accepted findings', () => {
  assert.equal(JSON.parse(read('config.default.json')).acceptance_evidence, true);
  assert.match(read('templates/task.md'), /^accepted_findings: \[\]$/m);
  assert.match(read('templates/delivery-evidence.json'), /"level": /);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test validator/test/agent-templates.test.js`
Expected: FAIL with `ENOENT … trial-walker.md`.

- [ ] **Step 3: Implement**

Create `templates/claude/agents/trial-walker.md`:

```md
---
name: trial-walker
description: Walks a milestone's acceptance trial in a browser, as the owner will, before the owner is asked (procedures/accept-release.md). Use once a milestone's last task has merged and its acceptance package is drafted. Give it the trial steps, how to start the app with demo data, and the languages and screen sizes; never your own conclusions. Launch it in the foreground and wait for its result.
---
You walk the owner's acceptance trial in a real browser before the owner does, so that what they try works and the steps they read match the screens. You are a fresh context: you know only what the prompt gives you, and you do not ask for the implementer's conversation. You never modify a tracked file, commit, push, merge or deploy; you may start the app, load demo data into a local database, and write screenshots and notes outside the repository.

The prompt gives you: the milestone and the exact revision, already checked out; the acceptance package's trial steps, numbered, as the owner will read them; how to start the app locally and load the project's demo data (the profile names the commands); the demo accounts to use, by where their test credentials are kept, never the owner's own; and the languages and screen sizes to walk. If something is missing, say so; do not guess it.

Work in this order:
1. Record the revision. Start the app and load the demo data. If it does not start, stop and report the error: an unavailable walkthrough is a blocker, not a pass.
2. Before the first step, make what the steps assume exist: the records, sections, people or settings a step relies on. Note each thing you added: the owner's trial environment needs it too.
3. Walk every step, in every language and at every screen size you were given, with browser automation (Playwright, or the harness's own browser), as a person would: click, type, choose, and wait for what a person would wait for. Do not call the app's API or change its database to make a step pass.
4. For each step record the step as written, what it says should happen, what you saw, passed or failed, and a screenshot. Watch the console and the network as you go: an error, a failed request or a layout that breaks at a screen size is a finding even when the step's outcome is right.
5. Where a step's wording does not match the screen (a button's name, a menu's place, a choice the step leaves out), write the corrected wording.

Output, in plain language: the revision and environment; a table of steps with expected, observed, result and screenshot file; the corrected trial steps in full; what the environment needed before the first step; every console error, failed request and layout problem with its step; and one line: walked and passed, or failed at steps N. Never write that the milestone is accepted: that is the owner's decision.
```

In `templates/claude/agents/independent-reviewer.md`, after the paragraph that begins "The prompt gives you:", insert:

```md
The prompt also names the review's level (`procedures/review.md`). `light`: the change and what directly uses it. `standard`: the change, its callers and the records for that area. `deep`: the change with the code it affects, security first. At every level, review the change and what it can break; do not audit unrelated parts of the application, and say what you left out.
```

and in the final paragraph change "candidate identity; your identity as `claude-code subagent independent-reviewer`, with your model if you know it;" to "candidate identity; your identity as `claude-code subagent independent-reviewer`, with your model if you know it; the level you reviewed at;".

In `templates/delivery-evidence.json`:
- Change both `"result"` placeholders to `"<passed | failed | skipped, as observed; under approval.auto_merge a required check GitHub enforces before merge may be enforced, with the pull request's checks page as its reference>"`.
- In `"review"`, after `"implementer"`, add:

```json
    "level": "<light | standard | deep (procedures/review.md)>",
    "model": "<the reviewer's model>",
    "fallback": "<only when a deep review could not use review.second_model: why; otherwise leave this field out>",
```

In `templates/acceptance.md`, after the `## Technical evidence` section, insert:

```md
## Trial walkthrough
Walked before you were asked (`procedures/accept-release.md`): revision, environment, languages and screen sizes; each step with what it showed and a screenshot; what was corrected in the steps; what the environment needed first. The trial steps below are the corrected ones.

## Decided for your acceptance
What `wf ci` left to this acceptance (`approval.defer_to_acceptance`): acceptance tests changed; review findings accepted rather than fixed (each task's `accepted_findings`), with why; scenarios that waited on work found along the way. Accepting the milestone accepts these; say which to change instead.
```

In `templates/task.md`'s front matter, after `review:`, add the line `accepted_findings: []`. In its body, under `## Review, acceptance, integration, release`, add:

```md
List each review finding accepted rather than fixed in `accepted_findings` as `R-0030/N1`; the milestone's acceptance lists them for the owner.
```

In `templates/profile.md`, under `## Delivery`, append to the first paragraph:

```md
Review levels and the second model are `config.review` (`procedures/review.md`). For the trial walkthrough (`procedures/accept-release.md`): how to start the app locally with demo data, the demo accounts (by where their test credentials are kept), and the languages and screen sizes to walk.
```

In `config.default.json`, after `"trusted_branch": "main",` add `"acceptance_evidence": true,`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test validator/test/agent-templates.test.js && npm test`
Expected: PASS. The adopt tests see `acceptance_evidence` in a new scaffold's config, which `loadConfig` now accepts.

- [ ] **Step 5: Commit**

These templates must be committed before Tasks 12 and 13: `wf-adopt` reads them from the pinned revision.

```bash
git add templates/claude/agents/trial-walker.md templates/claude/agents/independent-reviewer.md templates/delivery-evidence.json templates/acceptance.md templates/task.md templates/profile.md config.default.json validator/test/agent-templates.test.js
git commit -m "MAINT-0016: the trial-walker agent; review levels in the reviewer, evidence and records templates; acceptance evidence by default for new scaffolds

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: `bin/wf-protect` allows auto-merge where the owner chose it

**Files:**
- Modify: `adapters/protect.mjs`
- Test: `validator/test/protect.test.js`

**Interfaces:**
- Consumes: `config.approval.auto_merge` (Task 1).
- Produces: `plan({ … target: 'owner-merge' }).autoMerge === true` when `config.approval.auto_merge === true`.

- [ ] **Step 1: Write the failing test**

Append to `validator/test/protect.test.js`:

```js
test('MAINT-0016: owner-merge allows auto-merge only where the owner chose it', () => {
  const chosen = config('owner-merge'); chosen.approval.checkpoint = 'milestone'; chosen.approval.auto_merge = true;
  const p = plan({ config: chosen, requiredChecks: ['test'], branch: 'main', target: 'owner-merge' });
  assert.equal(p.autoMerge, true);
  assert.equal(p.ruleset.rules.find(r => r.type === 'required_status_checks').parameters.strict_required_status_checks_policy, true, 'GitHub still requires every check on an up-to-date branch');
  assert.equal(plan({ config: config('owner-merge'), branch: 'main', target: 'owner-merge' }).autoMerge, false);
  assert.equal(plan({ config: config('manual'), branch: 'main', target: 'manual' }).autoMerge, false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test validator/test/protect.test.js`
Expected: FAIL: `autoMerge` is `false`.

- [ ] **Step 3: Implement**

In `adapters/protect.mjs`, replace the auto-merge comment and line with:

```js
  // Auto-merge: on for one owner in enforced mode, where code-owner review holds back everything but records, and in
  // owner-merge mode where the owner chose it (approval.auto_merge, MAINT-0016): the agent turns it on only for pull requests
  // `wf ci` leaves to it, and `wf ci`, a required check, fails one the owner merges that has it on. Off otherwise in
  // owner-merge mode, and in manual mode, where the trusted branch moves only by the owner's closeout and a pull request
  // with nothing pending would merge at once; a shared project's code-owner review holds every pull request, so its
  // setting is left alone.
  const autoMerge = shared ? null : target === 'enforced' || (target === 'owner-merge' && config.approval?.auto_merge === true);
```

In `checkProtection`, replace the auto-merge item line with:

```js
  if (p.autoMerge !== null) item(`auto-merge ${p.autoMerge ? 'allowed' : 'off'}`, repo?.allow_auto_merge === p.autoMerge, p.autoMerge ? (p.target === 'owner-merge' ? 'the agent\'s pull requests then merge by themselves once every required check passes; yours wait for you' : 'a records-only pull request then merges by itself after its checks') : p.target === 'manual' ? 'in manual mode the trusted branch moves only by your closeout; auto-merge could merge a pull request first' : 'in owner-merge mode without approval.auto_merge, auto-merge would let the agent\'s pull requests merge on their checks alone');
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test validator/test/protect.test.js && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add adapters/protect.mjs validator/test/protect.test.js
git commit -m "MAINT-0016: wf-protect allows auto-merge in owner-merge mode where the owner chose it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: `bin/wf-adopt` — the new choices, the trial walker, and `AGENTS.md`'s merge sentence

**Files:**
- Modify: `bin/wf-adopt`
- Test: `validator/test/adopt.test.js`

**Interfaces:**
- Consumes: Task 10's committed templates (read at `--rev HEAD`); Task 1's config validation.
- Produces:
  - `--auto-merge`, `--defer-to-acceptance` and `--second-reviewer TOOL:MODEL[:EFFORT]`;
  - `.claude/agents/trial-walker.md` installed;
  - under `--auto-merge`, `AGENTS.md` tells the agent to turn on auto-merge for `merge: agent` pull requests.

- [ ] **Step 1: Write the failing test**

Append to `validator/test/adopt.test.js`:

```js
test('MAINT-0016: wf-adopt records auto-merge, approvals at acceptance and a second reviewer, installs the trial walker, and words AGENTS.md for auto-merge', t => {
  if (!head()) return t.skip('not a Git checkout');
  const dir = project(t);
  const r = adopt(dir, '--auto-merge', '--defer-to-acceptance', '--second-reviewer', 'codex:gpt-6.1-sol:high');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const config = loadConfig(dirSource(dir));
  assert.deepEqual([config.approval.auto_merge, config.approval.defer_to_acceptance, config.acceptance_evidence], [true, true, true]);
  assert.deepEqual(config.review.second_model, { tool: 'codex', model: 'gpt-6.1-sol', max_effort: 'high' });
  assert.ok(fs.existsSync(path.join(dir, '.claude/agents/trial-walker.md')));
  const agents = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
  assert.match(agents, /When `wf ci` reports `merge: agent`, turn on auto-merge/);
  assert.match(agents, /never turn on auto-merge for it/);
  const plain = project(t);
  assert.equal(adopt(plain).status, 0);
  assert.match(fs.readFileSync(path.join(plain, 'AGENTS.md'), 'utf8'), /Never turn on auto-merge, and never approve/, 'unchanged without the flag');
  assert.ok(fs.existsSync(path.join(plain, '.claude/agents/trial-walker.md')), 'every scaffold gets the walker');
  for (const bad of [['--checkpoint', 'change', '--auto-merge'], ['--approval', 'manual', '--defer-to-acceptance'], ['--second-reviewer', 'codex'], ['--second-reviewer', 'codex:gpt-6.1-sol:extreme']]) {
    const x = adopt(project(t), ...bad);
    assert.notEqual(x.status, 0, bad.join(' '));
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test validator/test/adopt.test.js`
Expected: FAIL. `--auto-merge` is an unknown option.

- [ ] **Step 3: Implement**

In `bin/wf-adopt`:
- Add `'second-reviewer'` to `OPTIONS`.
- Next to `if (a === '--client-page') { o.clientPage = true; continue; }`, add:

```js
    if (a === '--auto-merge') { o.autoMerge = true; continue; }
    if (a === '--defer-to-acceptance') { o.deferToAcceptance = true; continue; }
```

- Add to the usage text, after the `--client-page` line:

```js
  --auto-merge, with owner-merge and checkpoint milestone or plan: the agent turns on auto-merge for the pull requests wf ci
    leaves to it, which merge once every required check passes (run bin/wf-protect --apply to allow it)
  --defer-to-acceptance, same checkpoints: acceptance-test changes and minor accepted findings wait for the milestone's
    acceptance instead of each waiting for your merge
  --second-reviewer TOOL:MODEL[:EFFORT]: a reviewer from another model family for deep and milestone reviews, e.g. codex:gpt-6.1-sol:high
```

- After the `const checkpoint = …` line, add:

```js
// MAINT-0016: where the agent's own pull requests merge themselves, which approvals wait for the acceptance, and the second
// reviewer; loadConfig checks them again on the result.
for (const [flag, on] of [['--auto-merge', o.autoMerge], ['--defer-to-acceptance', o.deferToAcceptance]]) if (on && !['milestone', 'plan'].includes(checkpoint)) fail(`${flag} needs owner-merge approval with checkpoint milestone or plan`);
let secondReviewer = null;
if (o['second-reviewer'] !== undefined) {
  const [tool, model, effort] = o['second-reviewer'].split(':');
  if (!/^[\w.@/-]{1,80}$/.test(tool ?? '') || !/^[\w.@/-]{1,80}$/.test(model ?? '') || (effort !== undefined && !['low', 'medium', 'high', 'xhigh', 'max'].includes(effort))) fail('--second-reviewer must be TOOL:MODEL[:EFFORT], for example codex:gpt-6.1-sol:high');
  secondReviewer = { tool, model, ...(effort ? { max_effort: effort } : {}) };
}
```

- Change the `config.approval = …` line to add the two keys:

```js
config.approval = { ...(config.approval ?? {}), mechanism, label: approval, approver: ownerLogin ?? config.approval?.approver ?? '', agent_identity: o.worker ?? '', ...(checkpoint ? { checkpoint } : {}), ...(o.autoMerge ? { auto_merge: true } : {}), ...(o.deferToAcceptance ? { defer_to_acceptance: true } : {}) };
if (secondReviewer) config.review = { ...(config.review ?? {}), second_model: secondReviewer };
```

- In `pinned`, add `walker: optional('templates/claude/agents/trial-walker.md'),`. After the independent-reviewer write, add:

```js
// The trial walker (MAINT-0016): walks the owner's trial in a browser before the owner does (procedures/accept-release.md).
if (pinned.walker !== null) write('.claude/agents/trial-walker.md', pinned.walker);
else skipped.push('.claude/agents/trial-walker.md (not in this workflow revision)');
```

- In the `AGENTS.md` text, replace the owner-merge sentence:

```js
approval === 'owner-merge' ? 'The approval mode is owner-merge: the owner\'s own merge of a pull request is the approval. A production change needs your delivery evidence in the pull request description (`templates/delivery-evidence.json`). Merge a pull request yourself only when `wf ci` reports `merge: agent` and every required check has passed; anything else waits for the owner\'s merge. Never turn on auto-merge, and never approve,'
```

with:

```js
approval === 'owner-merge' ? (o.autoMerge
  ? 'The approval mode is owner-merge: the owner\'s own merge of a pull request is the approval. A production change needs your delivery evidence in the pull request description (`templates/delivery-evidence.json`; `scripts/wf evidence` starts it). When `wf ci` reports `merge: agent`, turn on auto-merge as you finish (`gh pr merge --auto`, with the merge method the repository allows) and carry on; GitHub merges it once every required check passes. Anything else waits for the owner\'s merge: never turn on auto-merge for it, and never approve,'
  : 'The approval mode is owner-merge: the owner\'s own merge of a pull request is the approval. A production change needs your delivery evidence in the pull request description (`templates/delivery-evidence.json`). Merge a pull request yourself only when `wf ci` reports `merge: agent` and every required check has passed; anything else waits for the owner\'s merge. Never turn on auto-merge, and never approve,')
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test validator/test/adopt.test.js && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add bin/wf-adopt validator/test/adopt.test.js
git commit -m "MAINT-0016: wf-adopt offers auto-merge, approvals at acceptance and a second reviewer, and installs the trial walker

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: `bin/wf-setup` — find Codex, and save and show the new settings

**Files:**
- Modify: `adapters/setup.mjs`, `adapters/setup-page.html`
- Test: `validator/test/setup-gui.test.js`

**Interfaces:**
- Consumes: Task 1's config validation (through `loadConfig` on the copy, as `saveSettings` already does).
- Produces:
  - `detectReviewers({ run = spawnSync } = {})` → `{ codex: { installed: false } }` or `{ codex: { installed: true, version, signed_in } }`;
  - `readState` adds `reviewers`, `settings.approval.auto_merge`, `settings.approval.defer_to_acceptance`, `settings.review` and `settings.acceptance_evidence`;
  - `saveSettings` saves `form.approval.auto_merge`, `form.approval.defer_to_acceptance`, `form.review` and `form.acceptance_evidence`.

- [ ] **Step 1: Write the failing tests**

In `validator/test/setup-gui.test.js`, add `detectReviewers` to the import from `../../adapters/setup.mjs`, then append:

```js
test('MAINT-0016: settings save auto-merge, approvals at acceptance, the second reviewer and acceptance evidence, and drop them where they do not apply', t => {
  const dir = project(t);
  const approval = { label: 'owner-merge', checkpoint: 'milestone', approver: 'owner', agent_identity: '', auto_merge: true, defer_to_acceptance: true };
  const review = { second_model: { tool: 'codex', model: 'gpt-6.1-sol', max_effort: 'high' } };
  const r = saveSettings({ project: dir, form: form({ dir, approval, review, acceptance_evidence: true }) });
  const config = loadConfig(dirSource(dir));
  assert.deepEqual([config.approval.auto_merge, config.approval.defer_to_acceptance, config.acceptance_evidence, config.review.second_model.model], [true, true, true, 'gpt-6.1-sol']);
  assert.ok(r.notes.some(n => /bin\/wf-protect --apply/.test(n)), r.notes.join(' | '));
  const switched = saveSettings({ project: dir, form: form({ dir, approval: { ...approval, checkpoint: 'change' } }) });
  const after = loadConfig(dirSource(dir));
  assert.deepEqual([after.approval.auto_merge, after.approval.defer_to_acceptance], [undefined, undefined], 'dropped where the owner merges every change');
  assert.ok(switched.notes.some(n => /Auto-merge is off/.test(n)), switched.notes.join(' | '));
  assert.throws(() => saveSettings({ project: dir, form: form({ dir, approval, review: { second_model: { tool: 'codex', model: 'bad model' } } }) }), /plain name/);
});

test('MAINT-0016: setup finds whether Codex is installed and signed in', () => {
  const run = (cmd, args) => (args[0] === '--version' ? { status: 0, stdout: 'codex-cli 1.4.0\n' } : { status: 1, stdout: '' });
  assert.deepEqual(detectReviewers({ run }), { codex: { installed: true, version: 'codex-cli 1.4.0', signed_in: false } });
  assert.deepEqual(detectReviewers({ run: () => ({ error: new Error('spawn codex ENOENT'), status: null }) }), { codex: { installed: false } });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test validator/test/setup-gui.test.js`
Expected: FAIL. `detectReviewers` is not exported, and the new keys are not saved.

- [ ] **Step 3: Implement**

In `adapters/setup.mjs`, import `agentMerges`:

```js
import { CHECKPOINTS, agentMerges } from '../validator/lib/checkpoint.js';
```

(`spawnSync` is already imported from `node:child_process`). Add after the imports:

```js
// Whether a second reviewer can run on this machine (MAINT-0016): the Codex CLI on PATH, and whether it is signed in.
export function detectReviewers({ run = spawnSync } = {}) {
  const version = run('codex', ['--version'], { encoding: 'utf8', timeout: 5000 });
  if (version.error || version.status !== 0) return { codex: { installed: false } };
  const login = run('codex', ['login', 'status'], { encoding: 'utf8', timeout: 5000 });
  return { codex: { installed: true, version: String(version.stdout ?? '').trim().split('\n')[0].slice(0, 80), signed_in: login.status === 0 } };
}
```

In `readState`:
- Set `state.reviewers = detectReviewers();` right after `const state = { … };`.
- In `state.settings.approval`, add `auto_merge: config.approval?.auto_merge === true, defer_to_acceptance: config.approval?.defer_to_acceptance === true`.
- In `state.settings`, add `review: { second_model: config.review?.second_model ?? null, deep_paths: list(config.review?.deep_paths) }, acceptance_evidence: config.acceptance_evidence === true,`.

In `saveSettings`, after the checkpoint block (`… next.approval.checkpoint = checkpoint; }`), add:

```js
  // MAINT-0016: auto-merge and approvals at acceptance need a checkpoint where the agent merges its own pull requests:
  // kept as they were unless the form sends them, and dropped where they no longer apply (a note says so).
  const dropped = [];
  for (const key of ['auto_merge', 'defer_to_acceptance']) {
    if (form.approval && Object.hasOwn(form.approval, key)) next.approval[key] = form.approval[key] === true;
    if (next.approval[key] !== undefined && !(label === 'owner-merge' && agentMerges(next.approval.checkpoint))) { if (next.approval[key]) dropped.push(key); delete next.approval[key]; }
  }
  if (has('review')) next.review = form.review;
  if (has('acceptance_evidence')) next.acceptance_evidence = form.acceptance_evidence === true;
```

After `const notes = [];`, add:

```js
  if (next.approval.auto_merge && config.approval?.auto_merge !== true) notes.push('The agent\'s pull requests will merge by themselves once their checks pass; yours still wait for you. After this is merged, run bin/wf-protect --apply with your own login so GitHub allows auto-merge, and tell the agent to update its instructions on merging (AGENTS.md) in the same pull request.');
  if (next.approval.defer_to_acceptance && config.approval?.defer_to_acceptance !== true) notes.push('Changes to acceptance tests, and review notes the agent accepted rather than fixed, will be listed for you when you accept the milestone, instead of each waiting for your merge. The plan, requirements and workflow still wait for you.');
  for (const key of dropped) notes.push(`${key === 'auto_merge' ? 'Auto-merge' : 'Approving at acceptance'} is off: it needs a checkpoint where the agent merges its own pull requests.`);
```

In `adapters/setup-page.html`, in `renderSettings`, inside the `#presets` section after `<p class="hint">${PRESET_HINT}</p>`, add:

```js
      <label class="choice"><input type="checkbox" name="auto_merge"${s.approval.auto_merge ? ' checked' : ''}><strong>Let the agent's pull requests merge by themselves</strong><p>Once their checks pass, GitHub merges them, so the agent never stops to wait for checks or for you. Yours still wait for you. It needs the protection step.</p></label>
      <label class="choice"><input type="checkbox" name="defer_to_acceptance"${s.approval.defer_to_acceptance ? ' checked' : ''}><strong>Approve tests and accepted review notes when you accept the milestone</strong><p>They are listed for you at acceptance instead of each waiting for your merge. Changes to your plan, requirements and the workflow still wait for you.</p></label>
```

After the *Accounts* section, add:

```js
    <section><h2>Reviews and your trial</h2>
      <p class="hint">${state.reviewers?.codex?.installed ? `Codex is installed (${esc(state.reviewers.codex.version)})${state.reviewers.codex.signed_in ? ' and signed in' : ', but not signed in: run codex login'}.` : 'Codex is not installed here: every review uses a fresh Claude reviewer.'}</p>
      <label class="choice"><input type="checkbox" name="second_model"${s.review.second_model ? ' checked' : ''}><strong>Use Codex for deep reviews and the milestone review</strong><p>Another model family catches what Claude misses. Small changes get a quick Claude review either way. If Codex runs out or is signed out, a Claude reviewer takes over and says why.</p></label>
      <label class="field"><span>Codex model</span><input type="text" name="second_model_name" value="${esc(s.review.second_model?.model ?? 'gpt-6.1-sol')}" autocomplete="off"></label>
      <label class="field"><span>Highest effort</span><select name="second_model_effort">${['low', 'medium', 'high', 'xhigh'].map(e => `<option value="${e}"${(s.review.second_model?.max_effort ?? 'high') === e ? ' selected' : ''}>${e}</option>`).join('')}</select></label>
      <label class="choice"><input type="checkbox" name="acceptance_evidence"${s.acceptance_evidence ? ' checked' : ''}><strong>Walk your trial in a browser before you try it</strong><p>Before asking you to accept a milestone, the agent walks your trial steps in a browser in each language, fixes what fails, corrects the steps and posts screenshots.</p></label>
    </section>
```

Add the helper next to `picked`: `const ticked = name => app.querySelector(\`[name="${name}"]\`)?.checked === true;`. In the save payload, change the `approval` entry to add the two keys, and add `review` and `acceptance_evidence`:

```js
        approval: { label: picked('label'), ...(picked('label') === 'owner-merge' && picked('checkpoint') ? { checkpoint: picked('checkpoint') } : {}), approver: value('approver'), agent_identity: picked('account') === 'worker' ? value('worker') : '', auto_merge: ticked('auto_merge'), defer_to_acceptance: ticked('defer_to_acceptance') },
        review: { ...(s.review.deep_paths.length ? { deep_paths: s.review.deep_paths } : {}), second_model: ticked('second_model') ? { tool: 'codex', model: value('second_model_name'), max_effort: value('second_model_effort') } : null },
        acceptance_evidence: ticked('acceptance_evidence'),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test validator/test/setup-gui.test.js && npm test`
Expected: PASS. The test "the page sends only what it shows…" still passes: a form without `review` keeps the project's review settings.

- [ ] **Step 5: Commit**

```bash
git add adapters/setup.mjs adapters/setup-page.html validator/test/setup-gui.test.js
git commit -m "MAINT-0016: wf-setup finds Codex and saves auto-merge, approvals at acceptance, the second reviewer and the trial walkthrough

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: `bin/wf-upgrade` installs the walker; `upgrades.json` lists v2.4.0

**Files:**
- Modify: `adapters/upgrade.mjs`, `upgrades.json`
- Test: `validator/test/upgrade.test.js`

**Interfaces:**
- Produces: the `INSTALLED` entry for `.claude/agents/trial-walker.md`, and `upgrades.json` `"v2.4.0"` with `add_files` and `notes`.

- [ ] **Step 1: Write the failing test**

Append to `validator/test/upgrade.test.js`:

```js
test('MAINT-0016: the v2.4.0 step adds the trial walker, and the upgrade installs it from its template', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../../upgrades.json', import.meta.url), 'utf8'));
  assert.ok(manifest['v2.4.0']?.add_files?.includes('.claude/agents/trial-walker.md'));
  assert.ok(manifest['v2.4.0'].notes.some(n => /wf-protect --apply/.test(n)) && manifest['v2.4.0'].notes.some(n => /AGENTS\.md/.test(n)));
  assert.match(fs.readFileSync(new URL('../../adapters/upgrade.mjs', import.meta.url), 'utf8'), /\{ path: '\.claude\/agents\/trial-walker\.md', template: 'templates\/claude\/agents\/trial-walker\.md' \}/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test validator/test/upgrade.test.js`
Expected: FAIL: there is no `v2.4.0` entry.

- [ ] **Step 3: Implement**

In `adapters/upgrade.mjs`, add to `INSTALLED`:

```js
  { path: '.claude/agents/trial-walker.md', template: 'templates/claude/agents/trial-walker.md' },
```

In `upgrades.json`, add:

```json
  "v2.4.0": {
    "add_files": [".claude/agents/trial-walker.md"],
    "notes": [
      "Refresh .github/workflows/wf-ci.yml (bin/wf-upgrade does it where the file is the old release's copy): it now runs when auto-merge is turned on or off and passes that to wf ci. An enforcement change for the owner.",
      "Optional, owner-merge with checkpoint milestone or plan: turn on approval.auto_merge with bin/wf-setup, then run bin/wf-protect --apply with your own login so GitHub allows auto-merge, and replace AGENTS.md's merge sentence with the new scaffold's (a governing change).",
      "Optional, same checkpoints: approval.defer_to_acceptance moves changes to acceptance tests, scenario changes from work found along the way, and accepted findings that are not blocking to the milestone's acceptance; the agent lists each accepted finding in its task record's accepted_findings.",
      "Optional: config.review names a second model for deep and milestone reviews (review.second_model, e.g. codex gpt-6.1-sol at most high) and the paths that always need a deep review (review.deep_paths); bin/wf-setup finds whether Codex is installed and signed in. A project profile that spelled out its own review rules can point to config.review instead.",
      "Optional: set acceptance_evidence to true so the pull request that accepts a milestone carries its review, the trial walkthrough and what was deferred (templates/acceptance-evidence.json). New scaffolds set it."
    ]
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test validator/test/upgrade.test.js && npm test`
Expected: PASS. The test that the release being made has an `upgrades.json` entry passes once Task 16 moves `package.json` to `2.4.0`; until then it still checks `2.3.1`, which has one.

- [ ] **Step 5: Commit**

```bash
git add adapters/upgrade.mjs upgrades.json validator/test/upgrade.test.js
git commit -m "MAINT-0016: wf-upgrade installs the trial walker; upgrades.json lists v2.4.0

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Procedures, policy, schema and quickstart say what the checks now do

**Files:**
- Modify: `procedures/execute.md`, `procedures/review.md`, `procedures/accept-release.md`, `procedures/approval-evidence.md`, `procedures/readiness.md`, `procedures/setup.md`, `POLICY.md`, `SCHEMA.md`, `QUICKSTART.md`
- Test: `validator/test/procedure-links.test.js` and `npm test` (no new test: prose carries only the judgement no check can make)

**Interfaces:**
- Consumes: every name above (`approval.auto_merge`, `approval.defer_to_acceptance`, `accepted_findings`, `review.level`, `review.second_model`, `review.deep_paths`, `review.fallback`, `acceptance_evidence`, `enforced`, `wf evidence`, `trial-walker`).

Every "replace" below quotes the current text exactly; each occurs once in its file.

- [ ] **Step 1: Record the corpus size before**

Run:

```bash
cat POLICY.md SCHEMA.md QUICKSTART.md procedures/*.md templates/*.md templates/*.json .agents/skills/workflow/SKILL.md templates/claude/agents/*.md templates/claude/*.md | wc -w; wc -w procedures/execute.md
```

Expected: the corpus number after Tasks 1–14, which includes Task 10's templates (the number before MAINT-0016 was 35,133), and 1838 for `execute.md`. Note both for the changelog.

- [ ] **Step 2: `procedures/execute.md`**

Replace

> Hand the claimed task to a fresh helper agent (an empty-context subagent, run in the foreground) with the task ID, what `wf next` names and the limits. Keep its result, check its commits, run the gates and launch the independent review yourself, then run `wf next` again.

with

> Hand each claimed task to a fresh task lead (an empty-context subagent, in the foreground) with the task ID, what `wf next` names and the limits. It has a fresh helper implement it, runs the gates, launches the independent review, finishes the pull request and returns the result; then run `wf next` again. Each fix round goes to a new helper given the record, the review and the head. Effort follows the review level (`review.md`) unless the profile's *Execution* says otherwise.

After

> A helper taking one task at a time works in the coordinator's place, not alongside it.

add

> Tasks with no prerequisite between them and disjoint scopes may have task leads at once, each in its own worktree and pull request, at most three; one that another's merge leaves behind is brought up to date, and its review carries over (`review.md`).

Replace

> Wait for an event or back off within limits; one coordinator owns a wait, and no agent is launched to poll. Never end a turn while work you started runs in the background: wait for it, or stop it and record why.

with

> Never wait for checks to merge: under `approval.auto_merge` turn on auto-merge and carry on. Wait only when the next step needs a result, on an event the harness allows; one coordinator owns a wait, and no agent is launched to poll. With no such event, end the turn naming the wait and saying nothing is needed from the owner. Never end a turn while other work you started runs in the background: wait for it, or stop it and record why.

After

> Repeat affected checks and review after material changes.

add

> A required check that fails on a change that cannot cause it is rerun once; if it then passes, record a found task for the unreliable check and carry on, never asking the owner to merge again.

Replace

> once a production candidate's checks and independent review are done, put the delivery evidence for its head

with

> once a production candidate's own checks and independent review are done, put the delivery evidence for its head (`wf evidence` starts it)

Replace

> Under owner-merge, merge the pull request yourself only when that reports `merge: agent` and every required check has passed; anything else waits for the owner's merge.

with

> Review and verification carry over a merge of the trusted branch or a records commit (`wf ci` checks it); under `approval.auto_merge` a required check may be `enforced`, so post the evidence without waiting for CI. Under owner-merge, when that reports `merge: agent`, turn on auto-merge (`approval.auto_merge`) or merge once every required check has passed; never hand it to the owner out of caution. Anything else waits for the owner's merge, never with auto-merge on. Under `approval.defer_to_acceptance` list each finding accepted rather than fixed in the task record's `accepted_findings` (`R-0030/N1`).

After

> Batch every other record change into the task's branch or one planning change: the owner reviews what the project protects, not bookkeeping.

add

> A clarification of a governing record that nothing waits on goes into the milestone's acceptance pull request.

After

> never erase failures or extend an exhausted allowance.

add

> When the review-of-fixes limit is reached and only non-blocking findings remain, accept them with a resolution and carry on; ask the owner only about a blocking finding you cannot fix within scope, or a reserved decision.

- [ ] **Step 3: `procedures/review.md`**

Replace the paragraph that begins

> Prefer a reviewer from a different model family when the harness offers one

(through "Record the implementer's and the reviewer's models in the review.") with:

> **Levels.** Each review has a level, stated in its evidence (`review.level`):
> - `light`: copy, styling, one component, test-only or records changes. A fresh reviewer of the implementer's tool at low or medium effort looks at the change and what directly uses it.
> - `standard`, the default: a feature inside one area, at high effort, adding its callers and the records for that area.
> - `deep`: permissions, money, migrations, sign-in, deleting data, and the project's `review.deep_paths`. It looks at the change with the code it affects. `wf ci` fails a change to a deep path without one.
>
> A deep review and the milestone review use the configured second model (`review.second_model`, another model family, at no more than its `max_effort`) when it runs here. When it does not (not installed, signed out, out of quota), a fresh reviewer of the implementer's tool at its highest effort, with a security focus, reviews instead, and `review.fallback` says why. Without a second model, give each reviewer a distinct focus, such as security or conformance to the specification. Record the implementer's and the reviewer's models in the review.
>
> **How many.** A task is reviewed once, on its final code. At most one review of its fixes follows, covering only the fix, and never by the second model for a light or standard task. Review and verification carry over a merge of the trusted branch or a records commit: `wf ci` checks that every path changed since holds the trusted branch's content or is a record. Anything else needs a new review. The milestone gets one review of its whole diff before acceptance (`accept-release.md`).

- [ ] **Step 4: `procedures/accept-release.md`**

After

> Before requesting owner acceptance, complete implementer verification, independent review and assembled-candidate verification.

add

> Then, in order:
> 1. The milestone review of the whole milestone diff (`review.md`).
> 2. The owner's trial environment, prepared with demo data so every trial step works as written.
> 3. The trial walk. Give the `trial-walker` agent, or a fresh context with browser automation, the trial steps, how to start the app with demo data, and the profile's languages and screen sizes, on a local build of the candidate. Fix what it finds, or correct the steps, and walk again until every step passes. Post its screenshots on the acceptance pull request.
>
> A project without a user interface says so instead. An unavailable walk is a blocker.

After

> and a checkpoint's hold on the next milestone lifts once it is on the trusted branch.

add

> Where the config sets `acceptance_evidence`, that pull request also carries the marked block of `templates/acceptance-evidence.json`: the accepted revision, the milestone review, the walk, everything `wf ci` deferred to this acceptance, and each task's `accepted_findings`. `wf ci` checks it.

- [ ] **Step 5: `procedures/approval-evidence.md`**

Replace

> and for a review finding accepted rather than fixed. Without a checkpoint the owner merges every pull request and nothing is held.

with

> and for a review finding accepted rather than fixed.
>
> With `approval.defer_to_acceptance` (checkpoint `milestone` or `plan`), these are reported as `deferred` instead, and the agent merges them:
> - a change to acceptance tests;
> - a records change that makes a scenario wait for a found task, or completes one;
> - a finding accepted rather than fixed that is not `blocking` (nor `critical` or `high`).
>
> The agent lists each accepted finding in its task record's `accepted_findings`, and the milestone's acceptance pull request lists every deferred item for the owner (`accept-release.md`).
>
> With `approval.auto_merge` (same checkpoints), the agent turns on GitHub auto-merge for a pull request `wf ci` leaves to it, and GitHub merges it once every required check passes. `wf ci`, a required check, fails a pull request the owner merges that has auto-merge on. `bin/wf-protect --apply` allows auto-merge only for such a project.
>
> Without a checkpoint the owner merges every pull request and nothing is held.

Replace

> The agent never approves or turns on auto-merge, and merges only what `wf ci` leaves to it (`AGENTS.md` says so, and `bin/wf-protect` turns auto-merge off)

with

> The agent never approves, turns on auto-merge only under `approval.auto_merge`, and merges only what `wf ci` leaves to it (`AGENTS.md` says so; `bin/wf-protect` turns auto-merge off unless the project chose it)

- [ ] **Step 6: `procedures/readiness.md`**

Replace

> In owner-merge mode the owner merges the plan first; then the milestone's first task, which serves every scenario alongside the tasks that implement it, adds the tests, failing, and the owner merges it.

with

> In owner-merge mode the owner merges the plan first. Then the milestone's first task, which serves every scenario alongside the tasks that implement it, adds the tests, failing, and the owner merges it; with `approval.defer_to_acceptance` the agent merges it, and the owner approves the tests at the milestone's acceptance.

- [ ] **Step 7: `procedures/setup.md`**

Replace

> The same gates run in each, and governing, workflow and acceptance-test changes always wait for the owner (`approval-evidence.md`, *Owner-merge mode*).

with

> The same gates run in each, and governing and workflow changes always wait for the owner. With `--defer-to-acceptance`, acceptance-test changes and accepted findings that are not blocking wait for the milestone's acceptance instead. With `--auto-merge`, the agent's own pull requests merge themselves once their checks pass (`approval-evidence.md`, *Owner-merge mode*). `--second-reviewer codex:MODEL:EFFORT` names the second model for deep and milestone reviews (`review.md`); so does `bin/wf-setup`, which finds whether Codex is installed and signed in.

Replace

> with no required review (one account can never approve its own pull request)

with

> with no required review (one account can never approve its own pull request), and allows auto-merge when `approval.auto_merge` is set

Replace

> auto-merge is off in the other modes.

with

> auto-merge is off in manual mode, and in owner-merge mode without `approval.auto_merge`.

- [ ] **Step 8: `POLICY.md`**

Replace

> A change to requirements, decisions, acceptance tests or workflow controls, or one whose review findings were accepted rather than fixed, still waits for the owner's merge. Agents never approve or enable automatic merging in it.

with

> A change to requirements, decisions or workflow controls still waits for the owner's merge. So does a change to acceptance tests, or one whose review findings were accepted rather than fixed, unless the owner chose to approve those at the milestone's acceptance, where every one is listed (`approval.defer_to_acceptance`). A blocking finding accepted rather than fixed always waits. Agents never approve, and turn on automatic merging only where the owner chose it (`approval.auto_merge`) and only for a change the gate leaves to them.

After

> which the owner can give before implementation, at the revision that wrote them.

add

> In owner-merge mode the owner may instead approve them at the milestone's acceptance, where every change to them is listed (`approval.defer_to_acceptance`); removing a mapped test still fails the gate.

- [ ] **Step 9: `SCHEMA.md`**

After

> every authorised milestone (Authorised, Active, Blocked or Verified) after the earliest such one by ID is held: `next` lists its open tasks under `held` until the earlier one is Accepted or Released.

add a new paragraph:

> MAINT-0016 adds the following.
> - **`approval.defer_to_acceptance`** (`true` only with checkpoint `milestone` or `plan`): a passing result also carries `deferred`. Changed acceptance tests, the scenario changes above, and accepted findings whose `severity` is not `blocking`, `critical` or `high` move there from `owner_reasons`. Each such finding must appear in the task record's `accepted_findings` (`REVIEW/FINDING`).
> - **`approval.auto_merge`** (same checkpoints): a required check in the delivery evidence may be `enforced`, and at least one `verification` check must be `passed`. `ci` fails when `WF_PR_AUTO_MERGE=on` (set by `wf-ci.yml`) and the result is `merge: owner`, or the project has not chosen auto-merge.
> - **Carry-over:** evidence of an earlier revision for `verification` or `review` counts when every path changed since holds the trusted branch's content or is a planning record, never an acceptance test (`lib/carry.js`). `integration` is always the candidate's.
> - **Review levels:** `review.level` is `light`, `standard` (the default) or `deep`. A production path matching `review.deep_paths` needs `deep`, and with `review.second_model` the review names that `model` or gives a `fallback`.
> - **Acceptance evidence:** where `acceptance_evidence` is `true`, a change that sets a milestone Accepted needs the marked block of `templates/acceptance-evidence.json` (`lib/acceptance-evidence.js`).
> - **`next`:** without `--baseline`, it reads `origin/<trusted branch>` when the local branch is behind it, with a `note`.
> - **`evidence`:** prints delivery evidence with what can be derived filled in.

- [ ] **Step 10: `QUICKSTART.md`**

Replace

> (`--delivery-evidence FILE` locally; `procedures/execute.md`)

with

> (`--delivery-evidence FILE` locally; `procedures/execute.md`; `wf evidence --baseline … --candidate … --task …` starts it, and `--from` carries an earlier review over a clean merge)

Replace

> in owner-merge mode `ci` reports `merge: agent` or `merge: owner` with its reasons, from the baseline's checkpoint.

with

> in owner-merge mode `ci` reports `merge: agent` or `merge: owner` with its reasons, from the baseline's checkpoint, and with `approval.defer_to_acceptance` what it leaves to the milestone's acceptance as `deferred`.

After

> A milestone acceptance package must cover its complete scenario/task set, not just one task.

add

> With `acceptance_evidence`, its pull request carries the block of `templates/acceptance-evidence.json`, after the `trial-walker` has walked the trial.

- [ ] **Step 11: Measure, check and commit**

Run:

```bash
cat POLICY.md SCHEMA.md QUICKSTART.md procedures/*.md templates/*.md templates/*.json .agents/skills/workflow/SKILL.md templates/claude/agents/*.md templates/claude/*.md | wc -w; wc -w procedures/execute.md procedures/review.md procedures/accept-release.md; npm test
```

Expected:
- `procedures/execute.md` is at most 2,088 words (1,838 + 250). If it is over, shorten this task's additions to `execute.md` (the task-lead and parallel sentences first), not existing safeguards.
- `npm test` passes. `procedure-links.test.js` checks every procedure reference.

Note the corpus number for Task 16. Then:

```bash
git add procedures/execute.md procedures/review.md procedures/accept-release.md procedures/approval-evidence.md procedures/readiness.md procedures/setup.md POLICY.md SCHEMA.md QUICKSTART.md
git commit -m "MAINT-0016: procedures, policy, schema and quickstart for auto-merge, approvals at acceptance, review levels and the trial walk

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: Release v2.4.0, independent review, and the pull request

**Files:**
- Modify: `package.json`, `CHANGELOG.md`

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Version and changelog**

In `package.json` set `"version": "2.4.0"`. At the top of `CHANGELOG.md`, under the introduction, add:

```md
## v2.4.0

Lets the agent stop only for decisions, sizes review to the change, and has a milestone's trial walked in a browser before the owner tries it (MAINT-0016). In mateen-systems' M-0003, the owner:
- sent 41 messages, 29 of them "merged", "continue" or "what now";
- merged 13 pull requests unread;
- waited 7 h 25 min while the agent waited on CI with nothing needed from the owner;
- found in the trial what no check had.

Of 23 reviews, the first review of each large task and the milestone review found real problems; seven re-checks of a merged-in head found nothing.

- **`approval.auto_merge`** (owner-merge, checkpoint `milestone` or `plan`):
  - The agent turns on auto-merge for the pull requests `wf ci` leaves to it, and GitHub merges them once every required check passes.
  - The delivery evidence may give a required check as `enforced`, so it is posted without waiting for CI.
  - `wf-ci.yml` runs when auto-merge is turned on or off, and `wf ci` fails a pull request the owner merges that has it on. `bin/wf-protect --apply` allows auto-merge for such a project.
- **`approval.defer_to_acceptance`** (same checkpoints):
  - These wait for the milestone's acceptance instead of each waiting for the owner's merge: changes to acceptance tests, scenario changes from work found along the way, and accepted findings that are not blocking. `wf ci` reports them as `deferred`.
  - Each accepted finding is listed in its task record's `accepted_findings`.
  - The plan, requirements, workflow, blocking findings and the acceptance itself stay the owner's merge.
- **Review in proportion:**
  - `review.level` (`light`, `standard`, `deep`).
  - `config.review.second_model` (a reviewer from another model family, at no more than `max_effort`) and `config.review.deep_paths`.
  - A fallback when the second model is unavailable.
  - Review and verification carry over a merge of the trusted branch or a records commit (`lib/carry.js`).
- **The trial walk and the acceptance evidence:**
  - The `trial-walker` agent walks the owner's trial steps in a browser, in each language and screen size, before the owner is asked.
  - With `acceptance_evidence` (the default for new scaffolds), the pull request that accepts a milestone carries the milestone review, the walk and everything deferred (`templates/acceptance-evidence.json`), checked by `wf ci`.
- **`wf next`** reads `origin/<trusted branch>` when the local branch is behind it, and says so. **`wf evidence`** starts the delivery evidence.
- **Procedures:**
  - A task lead per task.
  - A fresh helper per fix round.
  - Effort by review level.
  - Parallel task leads for independent tasks.
  - Defaults instead of questions when fix rounds run out.
  - One rerun and a found task for an unreliable check.

Corpus: 35,133 words before, N after (fill in from Task 15); `procedures/execute.md` 1,838 → N.

Moving a project to this pin:
- `bin/wf-upgrade` refreshes `.github/workflows/wf-ci.yml` (an enforcement change for the owner) and adds `.claude/agents/trial-walker.md`.
- The new settings are opt-in, chosen with `bin/wf-setup`:
  - with auto-merge, rerun `bin/wf-protect --apply` and replace `AGENTS.md`'s merge sentence with the new scaffold's;
  - to require the acceptance evidence, set `acceptance_evidence`.
```

Replace both `N` with the measured numbers.

- [ ] **Step 2: Full check**

Run: `npm test`
Expected: PASS, including "the release being made says what an upgrade to it changes" (`upgrades.json` has `v2.4.0`).

- [ ] **Step 3: Commit**

```bash
git add package.json CHANGELOG.md
git commit -m "MAINT-0016: release notes and v2.4.0

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Independent review of the whole branch**

`AGENTS.md`: workflow changes need independent review before release. Launch a fresh-context reviewer in the foreground. Use the `independent-reviewer` agent, or a fresh `general-purpose` subagent with its prompt. Give it:
- the spec and this plan;
- the diff `main..claude/MAINT-0016-stop-only-when-needed`.

Ask it to check:
- every safeguard in the spec's § 4 holds;
- the Review Focus items have tests;
- an older pinned validator with the refreshed `wf-ci.yml` still runs;
- the corpus growth is recorded.

Resolve every finding with a commit (`MAINT-0016: the review's notes: …`), or state why it is accepted. Rerun `npm test`.

- [ ] **Step 5: Push and open the pull request for the owner**

```bash
git push -u origin claude/MAINT-0016-stop-only-when-needed
gh pr create --base main --head claude/MAINT-0016-stop-only-when-needed --title "MAINT-0016: stop only when needed, review in proportion, walk the trial first (v2.4.0)" --body-file - <<'EOF'
Implements docs/proposals/MAINT-0016-stop-only-when-needed.md (plan: docs/proposals/MAINT-0016-plan.md).

<the spec's § 6 table, the review's result and dispositions, npm test result, corpus numbers>

Your merge approves the policy change (auto-merge for the agent's own pull requests and approvals at acceptance, both opt-in per project) and releases v2.4.0.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
```

Post the review on the pull request, as the workflow's own changes always are. The owner merges, and `release-tag.yml` tags `v2.4.0`.

---

## After the release: mateen-systems (separate work in that repository, by its owner and agent)

1. `bin/wf-upgrade` to v2.4.0 in a pull request the owner merges. It refreshes `wf-ci.yml` and adds `trial-walker.md`.
2. `bin/wf-setup` settings:
   - auto-merge on;
   - approvals at acceptance on;
   - Codex `gpt-6.1-sol` at most `high` as the second reviewer;
   - acceptance evidence on.
   
   Add `review.deep_paths` for permissions and data isolation, money, reference numbering and migrations, matching the profile's own list.
3. `bin/wf-protect --apply` with the owner's own login.
4. In the same pull request as step 2: `AGENTS.md`'s merge sentence from the new scaffold, and the profile's *Delivery* review paragraph pointing to `config.review`, keeping the owner's words.
5. Run M-0004 and measure it as the spec's § 7 says.

## Self-review notes

- **Spec coverage:**

  | Spec item | Task(s) |
  |---|---|
  | A1 | 1, 5, 6, 11, 12, 13 |
  | A2 | 3, 4 |
  | A3 | 1, 5, 10, 15 |
  | A4 | 4 |
  | A5 | 15 |
  | B1 | 1, 12, 13 |
  | B2 | 3, 4 |
  | B3 | 2, 3, 4, 9 |
  | B4 | 15 |
  | B5 | 10 |
  | C1 | 7 |
  | C2 | 10, 12, 14 |
  | C3 | 15 |
  | D | 15 |
  | E1 | 8 |
  | E2 | 9 |
  | Release | 14, 16 |

- **Names used across tasks:** `carriedFrom`, `changedPaths`, `blob`, `matchesAny`, `parseMarked`, `reviewLevelErrors`, `isBlocking`, `REVIEW_LEVELS`, `acceptanceEvidenceErrors`, `parseAcceptanceEvidence`, `ACCEPTANCE_MARKER`, `evidenceSkeleton`, `detectReviewers`, `WF_PR_AUTO_MERGE`, `accepted_findings`, `deferred`. Each is defined in the task named in its *Interfaces* before any later task uses it.
- **Review Focus:**

  | Item | Test |
  |---|---|
  | 1 | Task 2 (`a clean merge that combined both sides' edits…`) |
  | 2 | Task 5 (`auto-merge on a pull request the owner merges…`, including unset and `off`) |
  | 3 | Task 5 (minor unlisted fails, blocking stays the owner's) |
  | 4 | Task 7 (production change after the walked revision; failed step; empty `not_applicable`) |
  | 5 | Task 8 (ahead, diverged, no remote) |
