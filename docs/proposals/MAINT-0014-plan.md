# MAINT-0014 Client Plan, Live: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `wf status --client` shows a client the whole plan (phase → step → part) from a plan file, keeps finished parts from Git history, and reads the branches being worked on so the published page is current within minutes of a push.

**Architecture:** Three new focused modules beside `validator/lib/client.js`: `client-plan.js` (load and check the plan file; derive phases, steps, states and progress from the per-milestone stages `evaluateClient` already builds), `client-history.js` (removed task records and done dates from Git), and `client-live.js` (task states from remote branches, with precedence rules). `evaluateClient` takes optional `history` and `live` inputs that `cli.js` builds, so the view stays testable with real temporary Git repositories. A new `client-plan-render.js` renders the plan page body; `renderClient` uses it when the view has a plan and is otherwise unchanged.

**Tech Stack:** Node.js ≥ 22, ES modules, no dependencies, `node:test`; Git through `validator/lib/git.js`'s `gitRunner`; GitHub Actions for publishing.

**Spec:** `docs/proposals/MAINT-0014-client-plan-live.md` (approved by the owner on 11 October 2026). Read it before any task.

## Global Constraints

- No new dependencies; `package.json` keeps `"type": "module"` and `engines.node >=22`.
- The page stays one self-contained file: no external requests, `noindex`; the only script allowed is the inline relative-time script on the plan page.
- Every record or plan text reaching HTML goes through `esc` or `bdi`; the HTML never holds a task or milestone ID, a branch name, a person, a pull request number, a resume condition or a readiness reason.
- Wording comes only from `client_` fields (else the record's own field) and the plan file; never other record fields.
- Without `client.plan` the page is today's page, except accepted stages also list their parts (closed). Existing tests change only where that rule requires.
- The plan file is read at the trusted revision only; a branch cannot change phases, steps, milestones, decisions or the plan.
- Plan file: at most 256 KB; any unknown key, wrong type, `done` with `milestones`, or a milestone in two steps fails; a step naming a milestone with no record fails `wf status --client` (exit 2).
- Live reading: branches under `refs/remotes/origin/` other than the trusted branch, tip newer than 14 days or with an open pull request; only task records the branch itself changed (diff from its merge base); the trusted branch's `Done` always wins; newer tip wins between branches; a failure falls back to the trusted branch with a warning on standard error, never a failed build.
- Release v2.3.0: `package.json`, `CHANGELOG.md`, `upgrades.json`.
- Code style: match `client.js`: terse, comments say why, one-line helpers, two-space indent, single quotes.

## Review Focus

1. **A branch whose records are copies of `main` from an older point** (every task branch carries all task files): must not move any part backwards or forwards; only tasks the branch itself changed count. Test in Task 4.
2. **A task marked `Done` on a branch but not merged:** must show *In progress* (or *Being checked* with an open pull request), never *Done*. Test in Task 4.
3. **A plan whose every phase is emptied by `client.exclude`, with unplaced milestones left over:** must still render those milestones, not crash on `phases.at(-1)`. Test in Task 2.
4. **A shallow clone or a directory source** (no history, no remote branches): the page must render with no *Recently done* and no live states, with no error. Test in Task 3 and Task 6.
5. **Plan text with markup or right-to-left text** (`<script>`, Arabic titles on an English page): escaped and wrapped in `<bdi>`. Test in Task 5.

---

## File Structure

| File | Responsibility |
|---|---|
| `validator/lib/client-plan.js` (new) | `loadPlan(source, file)`; `planView({ plan, stages, known, exclude })` |
| `validator/lib/client-history.js` (new) | `gitHistory(repo, revision, recordsDir)` → `{ lastVersion(id), doneDate(id) }` |
| `validator/lib/client-live.js` (new) | `readBranches({...})` → `{ parts, newest, warnings }`; `overlayTasks(tasks, parts, milestoneIds)` |
| `validator/lib/client-plan-render.js` (new) | `planBody(view, say, h)` and `PLAN_CSS` |
| `validator/lib/client.js` | strings; `evaluateClient` accepts `history`, `live`; finished stages list parts; `checking` part state; plan view; `renderClient` picks the plan body |
| `validator/lib/records.js` | `client.plan` config key |
| `validator/cli.js` | `--live`; `--pull-requests` allowed with `--client`; builds history and live inputs; warnings to stderr |
| `validator/test/client-plan.test.js` (new) | all new behaviour, on temporary Git repositories |
| `validator/test/client.test.js` | adjusted only for finished stages listing parts |
| `templates/github/wf-client-page.yml` | triggers, dispatch job, live build |
| `SCHEMA.md`, `QUICKSTART.md`, `CHANGELOG.md`, `upgrades.json`, `package.json`, `procedures/readiness.md`, `AGENTS.md` | documents and release |

---

### Task 1: The plan file and its config key

**Files:**
- Create: `validator/lib/client-plan.js`
- Modify: `validator/lib/records.js` (`validateClientConfig`, the `only(c, [...], 'client')` line)
- Test: `validator/test/client-plan.test.js` (create)

**Interfaces:**
- Produces: `loadPlan(source, file) → { phases: [{ title, summary?, steps: [{ title, summary?, milestones?, done?, added? }] }] }` (throws `Error` with a message starting `client.plan`); config accepts `client.plan` (a repository path ending `.json`).

- [ ] **Step 1: Write the test file with its fixture and the failing tests**

Create `validator/test/client-plan.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirSource, gitSource, loadConfig } from '../lib/index.js';
import { loadPlan } from '../lib/client-plan.js';

// MAINT-0014: the client page's whole plan, from a plan file, with finished parts from history and live branch states.
const root = fileURLToPath(new URL('../..', import.meta.url));
const cli = path.join(root, 'validator/cli.js');
const RD = 'docs/workflow';

// A project in a temporary Git repository on `main`. Each helper writes a record; `commit` commits everything at a date.
export function repo(t, { client = { plan: 'docs/client-page/plan.json' } } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-plan-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const git = (args, date = '2026-10-01T10:00:00Z') => {
    const r = spawnSync('git', ['-C', dir, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
  const rm = rel => fs.rmSync(path.join(dir, rel));
  const config = JSON.parse(fs.readFileSync(path.join(root, 'config.default.json'), 'utf8'));
  write(`${RD}/config.json`, JSON.stringify({ ...config, repository: 'acme/shop', client }));
  write(`${RD}/profile.md`, '---\nrecord: profile\nproject: shop\nworkflow_version: v1\napproval_mechanism: owner-merge\napproval_label: owner-merge\ncoordinator: alice-owner\nmeasure: A customer can order a cake online.\nreadiness: Ready\nrequired_checks: [test]\nsetup_budget_days: 2\n---\n# Profile\n');
  const milestone = (id, status, title, tasks = []) => write(`${RD}/milestones/${id}.md`, `---\nrecord: milestone\nid: ${id}\noutcome: ${title} works.\nclient_title: ${title}\nstatus: ${status}\ncoordinator: agent\nowner: alice-owner\nscope: [src]\ngoverning: [PROFILE]\nacceptance: []\nauthority: owner\nlimits: x\ndemonstration: x\nstop_conditions: x\nrelease_authority: owner\ntasks: [${tasks.join(', ')}]\n---\n# ${id} — ${title}\n`);
  const task = (id, status, milestoneId, title) => write(`${RD}/tasks/${id}.md`, `---\nrecord: task\nid: ${id}\ntitle: ${id} internal title for bob-worker\nclient_title: ${title}\nstatus: ${status}\nmilestone: ${milestoneId}\nowner: bob-worker\nscope: [src]\ngoverning: [PROFILE]\nacceptance: []\nbranch: claude/${id}-work\nresume_condition: waiting on D-0009\n---\n# ${id}\n`);
  const plan = value => write('docs/client-page/plan.json', JSON.stringify(value));
  const commit = (message, date) => { git(['add', '-A'], date); git(['commit', '-qm', message], date); return git(['rev-parse', 'HEAD']); };
  git(['init', '-q', '-b', 'main']);
  return { dir, git, write, rm, milestone, task, plan, commit };
}

// The shop's plan: Foundations (done before records, then M-0001), Ordering (M-0002, M-0003) and a later step.
export function standard(t, options) {
  const r = repo(t, options);
  r.milestone('M-0001', 'Accepted', 'Menu online', ['T-0001']);
  r.task('T-0001', 'Done', 'M-0001', 'Put the menu online');
  r.milestone('M-0002', 'Active', 'Online ordering', ['T-0002', 'T-0003', 'T-0004']);
  r.task('T-0002', 'Done', 'M-0002', 'Choose a cake');
  r.task('T-0003', 'Ready', 'M-0002', 'Pay by card');
  r.task('T-0004', 'Draft', 'M-0002', 'Email the receipt');
  r.milestone('M-0003', 'Draft', 'Daily orders', []);
  r.plan({ phases: [
    { title: 'Foundations', summary: 'The base everything runs on.', steps: [
      { title: 'Accounts and sign-in', summary: 'People sign in.', done: true },
      { title: 'Menu online', summary: 'The menu is on the web.', milestones: ['M-0001'] },
    ] },
    { title: 'Ordering', summary: 'Customers order online.', steps: [
      { title: 'Ordering a cake', summary: 'Choose, pay, get a receipt.', milestones: ['M-0002', 'M-0003'] },
      { title: 'Deliveries', summary: 'Cakes reach the door.' },
    ] },
  ] });
  return r;
}

test('a plan file loads, and every malformed shape fails with a message naming it', t => {
  const r = standard(t);
  const source = dirSource(r.dir);
  assert.equal(loadConfig(source).client.plan, 'docs/client-page/plan.json');
  assert.equal(loadPlan(source, 'docs/client-page/plan.json').phases.length, 2);
  const bad = (value, message) => { r.plan(value); assert.throws(() => loadPlan(source, 'docs/client-page/plan.json'), message); };
  bad({ phases: [] }, /phases must list at least one phase/);
  bad({ phases: [{ title: 'A', steps: [{ title: 'S' }] }], extra: 1 }, /may contain only phases/);
  bad({ phases: [{ title: 'A', steps: [{ title: 'S', colour: 'red' }] }] }, /phases\[0\]\.steps\[0\] may contain only title, summary, milestones, done, added/);
  bad({ phases: [{ title: '', steps: [{ title: 'S' }] }] }, /phases\[0\]\.title must be a non-empty string/);
  bad({ phases: [{ title: 'A', steps: [] }] }, /steps must list at least one step/);
  bad({ phases: [{ title: 'A', steps: [{ title: 'S', done: true, milestones: ['M-0001'] }] }] }, /not both/);
  bad({ phases: [{ title: 'A', steps: [{ title: 'S', done: false }] }] }, /done may only be true/);
  bad({ phases: [{ title: 'A', steps: [{ title: 'S', milestones: ['T-0001'] }] }] }, /milestone IDs like M-0001/);
  bad({ phases: [{ title: 'A', steps: [{ title: 'S', milestones: ['M-0001'] }, { title: 'T', milestones: ['M-0001'] }] }] }, /M-0001 is in two steps/);
  bad({ phases: [{ title: 'A', steps: [{ title: 'S', added: 'last week' }] }] }, /added must be a date like 2026-11-02/);
  r.write('docs/client-page/plan.json', '{ not json');
  assert.throws(() => loadPlan(source, 'docs/client-page/plan.json'), /is not valid JSON/);
  r.write('docs/client-page/plan.json', JSON.stringify({ phases: [{ title: 'x'.repeat(300 * 1024), steps: [{ title: 'S' }] }] }));
  assert.throws(() => loadPlan(source, 'docs/client-page/plan.json'), /larger than 256 KB/);
  assert.throws(() => loadPlan(source, 'docs/client-page/missing.json'), /client\.plan: docs\/client-page\/missing\.json is not a file/);
});

test('client.plan must be a repository path to a JSON file', t => {
  for (const [plan, ok] of [['docs/plan.json', true], ['../plan.json', false], ['/etc/plan.json', false], ['docs/plan.md', false], [7, false]]) {
    const r = repo(t, { client: { plan } });
    if (ok) assert.equal(loadConfig(dirSource(r.dir)).client.plan, plan);
    else assert.throws(() => loadConfig(dirSource(r.dir)), /client\.plan must be a path inside the repository ending in \.json/);
  }
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `node --test validator/test/client-plan.test.js`
Expected: FAIL: `Cannot find module '../lib/client-plan.js'`.

- [ ] **Step 3: Accept `client.plan` in the config**

In `validator/lib/records.js`, `validateClientConfig`, replace the first line and add the check after the `language` check:

```js
  only(c, ['title', 'exclude', 'language', 'detail', 'theme', 'plan'], 'client');
```

```js
  if (c.plan !== undefined) { try { repoPath(c.plan, 'client.plan'); } catch { throw new Error('client.plan must be a path inside the repository ending in .json'); } if (!c.plan.endsWith('.json')) throw new Error('client.plan must be a path inside the repository ending in .json'); }
```

- [ ] **Step 4: Write `loadPlan`**

Create `validator/lib/client-plan.js`:

```js
// The client plan (MAINT-0014): the project's phases and steps in the client's words, from the file `client.plan` names.
// It holds the plan's shape only; every state comes from the records. It is read at the same revision as the records
// (the trusted branch), so a branch being worked on cannot change it.
const LIMIT = 256 * 1024;
const plainObject = v => v && typeof v === 'object' && !Array.isArray(v);
const only = (v, keys, where) => {
  if (!plainObject(v)) throw new Error(`${where} must be an object`);
  if (Object.keys(v).some(k => !keys.includes(k))) throw new Error(`${where} may contain only ${keys.join(', ')}`);
};
const words = (v, where, required = false) => {
  if (v === undefined && !required) return;
  if (typeof v !== 'string' || !v.trim()) throw new Error(`${where} must be a non-empty string`);
};

export function loadPlan(source, file) {
  const raw = source.read(file);
  if (raw == null) throw new Error(`client.plan: ${file} is not a file in ${source.name}`);
  if (Buffer.byteLength(raw) > LIMIT) throw new Error(`client.plan: ${file} is larger than 256 KB`);
  let plan;
  try { plan = JSON.parse(raw); } catch (e) { throw new Error(`client.plan: ${file} is not valid JSON: ${e.message}`); }
  const where = `client.plan (${file})`;
  only(plan, ['phases'], where);
  if (!Array.isArray(plan.phases) || !plan.phases.length) throw new Error(`${where}: phases must list at least one phase`);
  const placed = new Map(); // a milestone belongs to one step, so its parts are counted once
  plan.phases.forEach((phase, i) => {
    const at = `${where}: phases[${i}]`;
    only(phase, ['title', 'summary', 'steps'], at);
    words(phase.title, `${at}.title`, true); words(phase.summary, `${at}.summary`);
    if (!Array.isArray(phase.steps) || !phase.steps.length) throw new Error(`${at}.steps must list at least one step`);
    phase.steps.forEach((step, j) => {
      const sat = `${at}.steps[${j}]`;
      only(step, ['title', 'summary', 'milestones', 'done', 'added'], sat);
      words(step.title, `${sat}.title`, true); words(step.summary, `${sat}.summary`);
      if (step.done !== undefined && step.done !== true) throw new Error(`${sat}.done may only be true`);
      if (step.added !== undefined && (typeof step.added !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(step.added))) throw new Error(`${sat}.added must be a date like 2026-11-02`);
      if (step.milestones === undefined) return;
      if (step.done) throw new Error(`${sat}: a step is done by its milestones or by done: true, not both`);
      if (!Array.isArray(step.milestones) || step.milestones.some(id => typeof id !== 'string' || !/^M-\d{4}$/.test(id))) throw new Error(`${sat}.milestones must list milestone IDs like M-0001`);
      for (const id of step.milestones) {
        if (placed.has(id)) throw new Error(`${where}: ${id} is in two steps (${placed.get(id)} and ${sat})`);
        placed.set(id, sat);
      }
    });
  });
  return plan;
}
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `node --test validator/test/client-plan.test.js && node --test validator/test/client.test.js`
Expected: PASS, both files.

- [ ] **Step 6: Commit**

```bash
git add validator/lib/client-plan.js validator/lib/records.js validator/test/client-plan.test.js
git commit -m "MAINT-0014: the client plan file and client.plan" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Steps, states and progress from the plan

**Files:**
- Modify: `validator/lib/client-plan.js` (add `planView`)
- Modify: `validator/lib/client.js` (`evaluateClient`: call `loadPlan`/`planView`; `view.plan`, `view.warnings`)
- Test: `validator/test/client-plan.test.js`

**Interfaces:**
- Consumes: `loadPlan` (Task 1); the per-milestone `stages` objects `evaluateClient` already builds (`{ id, title, outcome, tone, finished, paused, upNext, parts, on_hold, items: [{ id, title, state, added }] }`).
- Produces: `planView({ plan, stages, known, exclude }) → { phases: [{ title, summary, steps, progress }], steps (flat, plan order), progress, position, unplaced: [milestone id] }`, where each step is `{ title, summary, state: 'done'|'active'|'next'|'later', added: boolean, items, parts: { done, total } | null, on_hold, progress }` and `progress` is a number from 0 to 1, `position` is `{ index, total }` (1-based index of the first step not done) or `null` when all are done. `evaluateClient(...)` returns `plan: <planView result> | null` and `warnings: string[]`.

- [ ] **Step 1: Write the failing tests**

Append to `validator/test/client-plan.test.js` (add `import { evaluateClient } from '../lib/client.js';` to the imports):

```js
const view = (r, extra = {}) => evaluateClient({ source: dirSource(r.dir), ...extra });
const states = v => v.plan.steps.map(s => [s.title, s.state]);

test('each step takes its state from its milestones and parts, with exactly one Next', t => {
  const r = standard(t);
  let v = view(r);
  assert.deepEqual(states(v), [['Accounts and sign-in', 'done'], ['Menu online', 'done'], ['Ordering a cake', 'active'], ['Deliveries', 'next']]);
  r.milestone('M-0002', 'Authorised', 'Online ordering', ['T-0002', 'T-0003', 'T-0004']);
  v = view(r);
  assert.deepEqual(states(v).slice(2), [['Ordering a cake', 'next'], ['Deliveries', 'later']], 'nothing moving: the first open step is Next');
  r.task('T-0003', 'Active', 'M-0002', 'Pay by card');
  assert.equal(view(r).plan.steps[2].state, 'active', 'a part in progress makes its step in progress');
  r.task('T-0003', 'Blocked', 'M-0002', 'Pay by card');
  r.milestone('M-0002', 'Blocked', 'Online ordering', ['T-0002', 'T-0003', 'T-0004']);
  v = view(r);
  assert.equal(v.plan.steps[2].state, 'active', 'a blocked milestone keeps its step in progress');
  assert.equal(v.plan.steps[2].on_hold, 1);
  r.milestone('M-0002', 'Released', 'Online ordering', ['T-0002', 'T-0003', 'T-0004']);
  r.milestone('M-0003', 'Accepted', 'Daily orders', []);
  assert.deepEqual(states(view(r)).slice(2), [['Ordering a cake', 'done'], ['Deliveries', 'next']]);
});

test('progress counts each step once, and a step with parts by its share done', t => {
  const v = view(standard(t));
  const ordering = v.plan.steps[2];
  assert.deepEqual(ordering.parts, { done: 1, total: 3 });
  assert.equal(ordering.progress, 1 / 3);
  assert.equal(v.plan.progress, (1 + 1 + 1 / 3 + 0) / 4);
  assert.deepEqual(v.plan.phases.map(p => p.progress), [1, (1 / 3) / 2]);
  assert.deepEqual(v.plan.position, { index: 3, total: 4 });
  assert.deepEqual(v.plan.steps[2].items.map(i => [i.title, i.state]), [['Choose a cake', 'done'], ['Pay by card', 'next'], ['Email the receipt', 'planned']]);
});

test('a milestone no step lists still shows, as an added step at the end, with a warning', t => {
  const r = standard(t);
  r.milestone('M-0004', 'Draft', 'Gift cards', []);
  const v = view(r);
  assert.deepEqual(v.plan.steps.at(-1), { ...v.plan.steps.at(-1), title: 'Gift cards', summary: 'Gift cards works.', added: true });
  assert.equal(v.plan.phases.at(-1).steps.at(-1).title, 'Gift cards');
  assert.match(v.warnings.join('\n'), /M-0004 is in no step of the client plan/);
});

test('excluded milestones leave their steps; a plan emptied by exclusion still shows unplaced milestones', t => {
  const r = standard(t, { client: { plan: 'docs/client-page/plan.json', exclude: ['M-0002', 'M-0003'] } });
  assert.deepEqual(states(view(r)).map(([title]) => title), ['Accounts and sign-in', 'Menu online', 'Deliveries']);
  r.plan({ phases: [{ title: 'Only', steps: [{ title: 'Ordering', milestones: ['M-0002', 'M-0003'] }] }] });
  r.milestone('M-0004', 'Draft', 'Gift cards', []);
  const v = view(r);
  assert.deepEqual(v.plan.steps.map(s => s.title), ['Menu online', 'Gift cards']);
  assert.equal(v.plan.phases.length, 1);
  assert.equal(v.plan.phases[0].title, null, 'the unplaced milestones get an untitled phase when no phase is left');
});

test('a step naming a milestone with no record stops the page', t => {
  const r = standard(t);
  r.plan({ phases: [{ title: 'A', steps: [{ title: 'S', milestones: ['M-0009'] }] }] });
  assert.throws(() => view(r), /client\.plan: the step "S" names M-0009, which has no milestone record/);
});

test('without client.plan the view has no plan', t => {
  const r = standard(t, { client: {} });
  assert.equal(view(r).plan, null);
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `node --test validator/test/client-plan.test.js`
Expected: FAIL: `view.plan` is undefined (`Cannot read properties of undefined (reading 'steps')`).

- [ ] **Step 3: Write `planView`**

Append to `validator/lib/client-plan.js`:

```js
// A step from its milestones' stages. Done: done by hand, or every milestone signed off. In progress: a milestone under
// way, awaiting sign-off or paused, or a part moving. Next is given afterwards, to the first step neither.
function step({ title, summary, done, added, stages }) {
  const items = stages.flatMap(s => s.items);
  const moving = items.some(i => i.state === 'active' || i.state === 'checking');
  const state = done || (stages.length && stages.every(s => s.finished)) ? 'done'
    : stages.some(s => s.tone === 'active' || s.tone === 'review') || moving ? 'active' : 'later';
  const total = stages.reduce((n, s) => n + (s.parts?.total ?? s.items.length), 0);
  const parts = total ? { done: items.filter(i => i.state === 'done').length, total } : null;
  return {
    title, summary, state, added, items, parts,
    on_hold: stages.reduce((n, s) => n + (s.on_hold ?? 0), 0),
    progress: state === 'done' ? 1 : parts ? parts.done / parts.total : 0,
  };
}
const share = steps => steps.length ? steps.reduce((n, s) => n + s.progress, 0) / steps.length : 0;

export function planView({ plan, stages, known, exclude }) {
  const byId = new Map(stages.map(s => [s.id, s]));
  const placed = new Set();
  const phases = plan.phases.map(p => ({
    title: p.title.trim(), summary: p.summary?.trim() ?? null,
    steps: p.steps.map(s => {
      const ids = s.milestones ?? [];
      for (const id of ids) if (!known.has(id)) throw new Error(`client.plan: the step "${s.title.trim()}" names ${id}, which has no milestone record`);
      ids.forEach(id => placed.add(id));
      const own = ids.filter(id => !exclude.has(id)).map(id => byId.get(id)).filter(Boolean);
      if (ids.length && !own.length) return null; // every milestone it names is left out of the page
      return step({ title: s.title.trim(), summary: s.summary?.trim() ?? null, done: s.done === true, added: Boolean(s.added), stages: own });
    }).filter(Boolean),
  })).filter(p => p.steps.length);
  // A milestone the plan does not place still shows, so a forgotten line in the plan hides nothing.
  const unplaced = stages.filter(s => !placed.has(s.id));
  if (unplaced.length) {
    if (!phases.length) phases.push({ title: null, summary: null, steps: [] });
    phases.at(-1).steps.push(...unplaced.map(s => step({ title: s.title, summary: s.outcome, done: false, added: true, stages: [s] })));
  }
  const steps = phases.flatMap(p => p.steps);
  const next = steps.find(s => s.state === 'later');
  if (next) next.state = 'next';
  for (const p of phases) p.progress = share(p.steps);
  const open = steps.findIndex(s => s.state !== 'done');
  return { phases, steps, progress: share(steps), position: open === -1 ? null : { index: open + 1, total: steps.length }, unplaced: unplaced.map(s => s.id) };
}
```

- [ ] **Step 4: Wire it into `evaluateClient`**

In `validator/lib/client.js`, add the import beside the existing one:

```js
import { loadPlan, planView } from './client-plan.js';
```

In `evaluateClient`, just before `const theme = client.theme ?? null;`, add:

```js
  // The whole plan (MAINT-0014), when the project keeps one: phases and steps from the plan file, states from the stages.
  const warnings = [];
  let plan = null;
  if (client.plan) {
    const known = new Set([...all.milestones.values()].map(r => r.data?.id).filter(Boolean));
    plan = planView({ plan: loadPlan(source, client.plan), stages, known, exclude });
    for (const id of plan.unplaced) warnings.push(`client.plan: ${id} is in no step of the client plan; it shows as an added step at the end until a step lists it`);
  }
```

and add `plan, warnings,` to the returned object, after `stages, updated, look,`:

```js
    stages, updated, look, plan, warnings,
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `node --test validator/test/client-plan.test.js && node --test validator/test/client.test.js`
Expected: PASS, both files.

- [ ] **Step 6: Commit**

```bash
git add validator/lib/client-plan.js validator/lib/client.js validator/test/client-plan.test.js
git commit -m "MAINT-0014: steps, their states and progress from the client plan" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Finished parts and done dates from history

**Files:**
- Create: `validator/lib/client-history.js`
- Modify: `validator/lib/client.js` (`evaluateClient` signature; stage items for finished stages; `doneAt`; `view.recent`)
- Modify: `validator/test/client.test.js` (only assertions that a finished stage lists no parts)
- Test: `validator/test/client-plan.test.js`

**Interfaces:**
- Consumes: `parseFrontMatter(text) → { data, body, errors }` from `./frontmatter.js`.
- Produces: `gitHistory(repo, revision, recordsDir) → { lastVersion(id) → string|null, doneDate(id) → ISO string|null }`. `evaluateClient({ source, updated, history = null, live = null })`; each item gains `doneAt: string|null`; the view gains `recent: [{ title, date }]` (at most five, newest first; empty without history).

- [ ] **Step 1: Write the failing tests**

Append to `validator/test/client-plan.test.js` (add `import { gitHistory } from '../lib/client-history.js';`):

```js
test('a finished step keeps its parts after their records are removed, with the dates they were done', t => {
  const r = standard(t);
  r.task('T-0001', 'Active', 'M-0001', 'Put the menu online');
  r.milestone('M-0001', 'Active', 'Menu online', ['T-0001']);
  r.commit('start', '2026-09-01T09:00:00Z');
  r.task('T-0001', 'Done', 'M-0001', 'Put the menu online');
  r.commit('T-0001 done', '2026-09-05T09:00:00Z');
  r.milestone('M-0001', 'Accepted', 'Menu online', ['T-0001']);
  r.commit('accept M-0001', '2026-09-06T09:00:00Z');
  r.rm(`${RD}/tasks/T-0001.md`);
  r.commit('remove T-0001 after acceptance', '2026-09-07T09:00:00Z');
  const v = view(r, { source: gitSource(r.dir, 'main'), history: gitHistory(r.dir, 'main', RD) });
  const menu = v.plan.steps[1];
  assert.equal(menu.state, 'done');
  assert.deepEqual(menu.items.map(i => [i.title, i.state, i.doneAt]), [['Put the menu online', 'done', '2026-09-05T09:00:00Z']]);
  assert.deepEqual(v.recent, [{ title: 'Put the menu online', date: '2026-09-05T09:00:00Z' }, { title: 'Choose a cake', date: '2026-09-01T09:00:00Z' }], 'newest first; T-0002 was Done from the first commit');
});

test('Recently done lists the five newest finished parts, and is empty without history', t => {
  const r = repo(t);
  r.milestone('M-0001', 'Active', 'Many parts', ['T-0001', 'T-0002', 'T-0003', 'T-0004', 'T-0005', 'T-0006']);
  r.plan({ phases: [{ title: 'A', steps: [{ title: 'S', milestones: ['M-0001'] }] }] });
  for (let i = 1; i <= 6; i++) r.task(`T-000${i}`, 'Ready', 'M-0001', `Part ${i}`);
  r.commit('plan');
  for (let i = 1; i <= 6; i++) { r.task(`T-000${i}`, 'Done', 'M-0001', `Part ${i}`); r.commit(`T-000${i} done`, `2026-10-0${i}T08:00:00Z`); }
  const v = view(r, { source: gitSource(r.dir, 'main'), history: gitHistory(r.dir, 'main', RD) });
  assert.deepEqual(v.recent.map(p => p.title), ['Part 6', 'Part 5', 'Part 4', 'Part 3', 'Part 2']);
  assert.deepEqual(view(r).recent, [], 'a directory source has no history');
});

test('a shallow clone has no history to read, and still renders', t => {
  const r = standard(t);
  r.commit('one', '2026-09-01T09:00:00Z');
  r.task('T-0003', 'Done', 'M-0002', 'Pay by card');
  r.commit('two', '2026-09-02T09:00:00Z');
  const shallow = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-shallow-'));
  t.after(() => fs.rmSync(shallow, { recursive: true, force: true }));
  assert.equal(spawnSync('git', ['clone', '-q', '--depth', '1', `file://${r.dir}`, shallow]).status, 0);
  const v = view(r, { source: gitSource(shallow, 'HEAD'), history: gitHistory(shallow, 'HEAD', RD) });
  assert.equal(v.plan.steps[2].parts.done, 2);
  assert.ok(v.recent.every(p => p.date === '2026-09-02T09:00:00Z'), 'the only commit is the one the record was Done at');
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `node --test validator/test/client-plan.test.js`
Expected: FAIL: `Cannot find module '../lib/client-history.js'`.

- [ ] **Step 3: Write `gitHistory`**

Create `validator/lib/client-history.js`:

```js
// History for the client page (MAINT-0014). A task record is removed once its milestone is accepted, so a finished
// step's parts are read from the last commit that had them; a part's done date is the first commit on the trusted
// branch where its record read `status: Done`. Every answer is read once. Without history (a shallow clone), a removed
// record is simply missing and a date is the oldest commit available.
import { gitRunner } from './git.js';

const ID = /^T-\d{4,}$/;
export function gitHistory(repo, revision, recordsDir) {
  const git = gitRunner(repo, { maxBuffer: 16 * 1024 * 1024 });
  const cache = new Map();
  const once = (key, read) => { if (!cache.has(key)) cache.set(key, read()); return cache.get(key); };
  const file = id => `${recordsDir}/tasks/${id}.md`;
  return {
    lastVersion: id => once(`record ${id}`, () => {
      if (!ID.test(id)) return null;
      const removed = git('log', '-1', '--format=%H', '--diff-filter=D', revision, '--', file(id));
      const commit = removed.status === 0 ? removed.stdout.trim() : '';
      if (!commit) return null;
      const before = git('show', `${commit}^:${file(id)}`);
      return before.status === 0 ? before.stdout : null;
    }),
    doneDate: id => once(`done ${id}`, () => {
      if (!ID.test(id)) return null;
      const r = git('log', '--reverse', '--format=%H %cI', '-S', 'status: Done', revision, '--', file(id));
      for (const line of r.status === 0 ? r.stdout.split('\n').filter(Boolean) : []) {
        const [commit, date] = line.split(' ');
        const at = git('show', `${commit}:${file(id)}`);
        if (at.status === 0 && /^status:\s*Done\s*$/m.test(at.stdout)) return date;
      }
      return null;
    }),
  };
}
```

- [ ] **Step 4: Use history in `evaluateClient`**

In `validator/lib/client.js`:

1. Import the parser: `import { parseFrontMatter } from './frontmatter.js';`
2. Change the signature: `export function evaluateClient({ source, updated = null, history = null, live = null }) {` (`live` is used in Task 4).
3. Inside the `.map(r => {` that builds a stage, replace the `own` computation's input and the `items:` line. Replace:

```js
      const own = tasks.filter(t => t.milestone === m.id).sort((a, b) => {
```

with:

```js
      // A finished milestone's removed task records come back from history, so a done step keeps what it delivered.
      const kept = tasks.filter(t => t.milestone === m.id);
      const recovered = tone === 'done' && history ? planned.filter(id => !kept.some(t => t.id === id)).map(id => parseFrontMatter(history.lastVersion(id) ?? '').data).filter(t => t?.id) : [];
      const own = [...kept, ...recovered].sort((a, b) => {
```

(`tone` and `planned` are already defined above this point, and `finished` below it is unchanged.) Then replace the `items:` line with:

```js
        items: detail === 'stages' ? [] : own.map(t => {
          const state = finished ? 'done' : PART[t.status] ?? 'planned';
          return { id: t.id, title: text(t.client_title) ?? text(t.title) ?? say.untitledPart, state, added: planned.length > 0 && !planned.includes(t.id), doneAt: state === 'done' ? history?.doneDate(t.id) ?? null : null };
        }),
```

4. After the `overall` line, add:

```js
  // The five parts finished most recently, newest first, when history gives their dates.
  const recent = stages.flatMap(s => s.items).filter(i => i.doneAt).sort((a, b) => Date.parse(b.doneAt) - Date.parse(a.doneAt)).slice(0, 5).map(i => ({ title: i.title, date: i.doneAt }));
```

and add `recent,` to the returned object after `overall, now, next, then, waiting,`.

5. Today's page now lists a finished stage's parts. `now`/`next` already skip finished stages; `visible` (decisions) already filters `!s.finished`. Nothing else changes.

- [ ] **Step 5: Adjust the existing tests for finished stages listing parts**

Run: `node --test validator/test/client.test.js`
For each failure, change only an assertion that expects a finished (Accepted or Released) stage to have `items: []` or no parts list in HTML, so it expects the stage's task records as `done` items. In the existing fixture M-0001 is Released with no task records, so its `items` stay `[]`; expected result: no assertion needs changing. If one does, make that the only change and say so in the commit message.

- [ ] **Step 6: Run the tests to see them pass**

Run: `node --test validator/test/client-plan.test.js && node --test validator/test/client.test.js`
Expected: PASS, both files.

- [ ] **Step 7: Commit**

```bash
git add validator/lib/client-history.js validator/lib/client.js validator/test/client-plan.test.js validator/test/client.test.js
git commit -m "MAINT-0014: finished steps keep their parts, with the dates they were done" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Live states from the branches being worked on

**Files:**
- Create: `validator/lib/client-live.js`
- Modify: `validator/lib/client.js` (apply `overlayTasks`; `checking` part state; `updated` and `warnings` from `live`)
- Test: `validator/test/client-plan.test.js`

**Interfaces:**
- Consumes: `gitRunner` (`./git.js`), `gitSource` (`./sources.js`), `parseFrontMatter` (`./frontmatter.js`).
- Produces: `readBranches({ repo, base, trustedBranch, recordsDir, pullRequests = null, now = Date.now(), maxAgeDays = 14 }) → { parts: Map<id, { record, date, checking }>, newest: ISO|null, warnings: string[] }`; `overlayTasks(tasks, parts, milestoneIds: Set) → task data[]` where a task may carry `live: 'checking'|null`. `evaluateClient`'s `live` input is the `readBranches` result. Part state `checking` (*Being checked*).

- [ ] **Step 1: Write the failing tests**

Append to `validator/test/client-plan.test.js` (add `import { readBranches } from '../lib/client-live.js';`):

```js
// A branch as GitHub Actions' checkout has it: a remote-tracking ref at the branch's tip.
function branch(r, name, date, change) {
  r.git(['switch', '-q', '-c', name, 'main']);
  change();
  const tip = r.commit(`${name} work`, date);
  r.git(['update-ref', `refs/remotes/origin/${name}`, tip]);
  r.git(['switch', '-q', 'main']);
  return tip;
}
const live = (r, extra = {}) => {
  const base = r.git(['rev-parse', 'main']);
  r.git(['update-ref', 'refs/remotes/origin/main', base]);
  const reading = readBranches({ repo: r.dir, base, trustedBranch: 'main', recordsDir: RD, now: Date.parse('2026-10-11T12:00:00Z'), ...extra });
  return { reading, v: view(r, { source: gitSource(r.dir, base), history: gitHistory(r.dir, base, RD), live: reading }) };
};
const part = (v, title) => v.plan.steps.flatMap(s => s.items).find(i => i.title === title);

test('a part being worked on a branch shows in progress, and being checked once its pull request is open', t => {
  const r = standard(t);
  r.commit('plan', '2026-10-01T09:00:00Z');
  branch(r, 'claude/T-0003-pay', '2026-10-11T11:00:00Z', () => r.task('T-0003', 'Active', 'M-0002', 'Pay by card'));
  let { v, reading } = live(r);
  assert.equal(part(v, 'Pay by card').state, 'active');
  assert.equal(v.plan.steps[2].state, 'active');
  assert.equal(reading.newest, '2026-10-11T11:00:00Z');
  assert.equal(v.updated, '2026-10-11T11:00:00Z', 'updated is the newest change the page read');
  ({ v } = live(r, { pullRequests: [{ headRefName: 'claude/T-0003-pay', isDraft: false, isCrossRepository: false }] }));
  assert.equal(part(v, 'Pay by card').state, 'checking');
  ({ v } = live(r, { pullRequests: [{ headRefName: 'claude/T-0003-pay', isDraft: true, isCrossRepository: false }] }));
  assert.equal(part(v, 'Pay by card').state, 'active', 'a draft pull request is still being built');
});

test('a branch counts only for the records it changed, and never moves a part back', t => {
  const r = standard(t);
  r.commit('plan', '2026-10-01T09:00:00Z');
  // An old branch whose copy of T-0002 still reads Ready: it did not change T-0002, so T-0002 stays Done.
  branch(r, 'claude/T-0004-email', '2026-10-10T09:00:00Z', () => r.task('T-0004', 'Active', 'M-0002', 'Email the receipt'));
  r.task('T-0003', 'Done', 'M-0002', 'Pay by card');
  r.commit('T-0003 merged', '2026-10-10T10:00:00Z');
  // A stale branch that still says T-0003 is Active: the trusted branch's Done wins.
  branch(r, 'claude/T-0003-old', '2026-10-09T09:00:00Z', () => r.task('T-0003', 'Active', 'M-0002', 'Pay by card'));
  const { v } = live(r);
  assert.equal(part(v, 'Choose a cake').state, 'done');
  assert.equal(part(v, 'Pay by card').state, 'done');
  assert.equal(part(v, 'Email the receipt').state, 'active');
});

test('Done on a branch is not done until merged, and the newer branch wins', t => {
  const r = standard(t);
  r.commit('plan', '2026-10-01T09:00:00Z');
  branch(r, 'claude/T-0003-a', '2026-10-10T09:00:00Z', () => r.task('T-0003', 'Blocked', 'M-0002', 'Pay by card'));
  branch(r, 'claude/T-0003-b', '2026-10-11T09:00:00Z', () => r.task('T-0003', 'Done', 'M-0002', 'Pay by card'));
  const { v } = live(r);
  assert.equal(part(v, 'Pay by card').state, 'active', 'the newer branch says Done, which shows as in progress until merged');
});

test('a part that exists only on a branch shows as added; a branch cannot change anything else', t => {
  const r = standard(t);
  r.commit('plan', '2026-10-01T09:00:00Z');
  branch(r, 'claude/T-0005-wrap', '2026-10-11T09:00:00Z', () => {
    r.task('T-0005', 'Active', 'M-0002', 'Gift wrap');
    r.task('T-0006', 'Active', 'M-0099', 'Unknown milestone');
    r.milestone('M-0002', 'Active', 'Renamed by a branch', ['T-0002', 'T-0003', 'T-0004']);
    r.plan({ phases: [{ title: 'Branch plan', steps: [{ title: 'Nope' }] }] });
  });
  const { v } = live(r);
  assert.deepEqual([part(v, 'Gift wrap').state, part(v, 'Gift wrap').added], ['active', true]);
  assert.equal(part(v, 'Unknown milestone'), undefined, 'a part of a milestone the trusted branch lacks is ignored');
  assert.deepEqual(v.plan.phases.map(p => p.title), ['Foundations', 'Ordering']);
  assert.equal(v.stages.find(s => s.id === 'M-0002').title, 'Online ordering');
});

test('an old branch without a pull request is ignored, and a reading failure falls back with a warning', t => {
  const r = standard(t);
  r.commit('plan', '2026-10-01T09:00:00Z');
  branch(r, 'claude/T-0003-stale', '2026-09-20T09:00:00Z', () => r.task('T-0003', 'Active', 'M-0002', 'Pay by card'));
  let { v } = live(r);
  assert.equal(part(v, 'Pay by card').state, 'next', 'older than 14 days and no pull request');
  ({ v } = live(r, { pullRequests: [{ headRefName: 'claude/T-0003-stale', isDraft: false, isCrossRepository: false }] }));
  assert.equal(part(v, 'Pay by card').state, 'checking', 'an open pull request keeps an old branch in view');
  const broken = readBranches({ repo: path.join(r.dir, 'no-such-dir'), base: 'main', trustedBranch: 'main', recordsDir: RD });
  assert.equal(broken.parts.size, 0);
  assert.match(broken.warnings.join('\n'), /live reading skipped/);
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `node --test validator/test/client-plan.test.js`
Expected: FAIL: `Cannot find module '../lib/client-live.js'`.

- [ ] **Step 3: Write `readBranches` and `overlayTasks`**

Create `validator/lib/client-live.js`:

```js
// The client page's live reading (MAINT-0014): what the branches being worked on say about their own parts, on top of
// the trusted branch's records. A branch counts only for the task records it changed since it left the trusted
// branch (every branch carries copies of all of them), only for parts, and only forward: the trusted branch's Done
// always wins, and a branch's Done shows as in progress until it is merged. Branch names never reach the page.
import { gitRunner } from './git.js';
import { parseFrontMatter } from './frontmatter.js';

const DAY = 24 * 60 * 60 * 1000;
const PREFIX = 'refs/remotes/origin/';
// The states a branch may give a part; anything else leaves the trusted branch's.
const FORWARD = { Active: 'Active', Blocked: 'Blocked', Done: 'Active' };

export function readBranches({ repo, base, trustedBranch, recordsDir, pullRequests = null, now = Date.now(), maxAgeDays = 14 }) {
  const parts = new Map();
  const warnings = [];
  let newest = null;
  try {
    const git = gitRunner(repo, { maxBuffer: 16 * 1024 * 1024 });
    const refs = git('for-each-ref', '--format=%(refname)%00%(objectname)%00%(committerdate:iso-strict)', PREFIX);
    if (refs.error || refs.status !== 0) throw new Error(refs.error?.message ?? (refs.stderr.trim() || 'git for-each-ref failed'));
    const open = new Map((pullRequests ?? []).filter(p => !p.isCrossRepository).map(p => [p.headRefName, p]));
    for (const line of refs.stdout.split('\n').filter(Boolean)) {
      const [ref, tip, date] = line.split('\0');
      const name = ref.slice(PREFIX.length);
      if (name === 'HEAD' || name === trustedBranch) continue;
      const pr = open.get(name);
      if (!pr && now - Date.parse(date) > maxAgeDays * DAY) continue;
      const fork = git('merge-base', base, tip);
      if (fork.status !== 0) { warnings.push(`live reading: a branch shares no history with ${trustedBranch}; skipped`); continue; }
      const changed = git('diff', '--name-only', '--no-renames', '-z', fork.stdout.trim(), tip, '--', `${recordsDir}/tasks/`);
      if (changed.status !== 0) { warnings.push('live reading: a branch could not be compared; skipped'); continue; }
      if (!newest || Date.parse(date) > Date.parse(newest)) newest = date;
      for (const file of changed.stdout.split('\0').filter(f => f.endsWith('.md'))) {
        const shown = git('show', `${tip}:${file}`);
        const record = shown.status === 0 ? parseFrontMatter(shown.stdout).data : null; // removed on the branch: nothing to show
        if (!record?.id) continue;
        const seen = parts.get(record.id);
        if (seen && Date.parse(seen.date) >= Date.parse(date)) continue; // the newer branch wins
        parts.set(record.id, { record, date, checking: Boolean(pr && !pr.isDraft) });
      }
    }
  } catch (e) {
    return { parts: new Map(), newest: null, warnings: [...warnings, `live reading skipped: ${e.message}`] };
  }
  return { parts, newest, warnings };
}

export function overlayTasks(tasks, parts, milestoneIds) {
  const ids = new Set(tasks.map(t => t.id));
  const moved = (t, b) => {
    const status = FORWARD[b.record.status];
    if (!status) return t;
    return { ...t, status, client_title: b.record.client_title ?? t.client_title, title: b.record.title ?? t.title, live: b.checking && status === 'Active' ? 'checking' : null };
  };
  const out = tasks.map(t => { const b = parts.get(t.id); return b && t.status !== 'Done' ? moved(t, b) : t; });
  for (const [id, b] of parts) {
    if (ids.has(id) || !milestoneIds.has(b.record.milestone)) continue;
    const added = moved({ id, milestone: b.record.milestone, status: 'Draft', title: null, client_title: null }, b);
    if (added.status !== 'Draft') out.push(added);
  }
  return out;
}
```

- [ ] **Step 4: Apply the live reading in `evaluateClient`**

In `validator/lib/client.js`:

1. Import: `import { overlayTasks } from './client-live.js';`
2. Add the state to both languages' `part` strings: English `checking: 'Being checked'`, Arabic `checking: 'قيد المراجعة'`; and add to `ICON`:

```js
  checking: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5" /><path d="M5.5 8.2l1.8 1.8 3.2-3.6" /></svg>',
```

3. Replace the `const tasks = ...` line with:

```js
  const milestoneIds = new Set([...all.milestones.values()].map(r => r.data?.id).filter(Boolean));
  const recorded = [...all.tasks.values()].map(r => r.data).filter(t => t?.id);
  // Branches being worked on move their own parts forward (client-live.js); nothing else on the page comes from them.
  const tasks = live ? overlayTasks(recorded, live.parts, milestoneIds) : recorded;
```

and in Task 2's block use `milestoneIds` in place of `known` (`planView({ ..., known: milestoneIds, ... })`, removing the `const known` line).

4. In the items map from Task 3, change the state line to:

```js
          const state = finished ? 'done' : t.live === 'checking' ? 'checking' : PART[t.status] ?? 'planned';
```

5. In the `now` computation, count parts being checked as current work: change `items: focus.items.filter(i => i.state === 'active').map(i => i.title)` to `items: focus.items.filter(i => i.state === 'active' || i.state === 'checking').map(i => i.title)`.
6. Before the `return`, fold in the live reading's time and warnings:

```js
  if (live) {
    warnings.push(...live.warnings);
    if (live.newest && (!updated || Date.parse(live.newest) > Date.parse(updated))) updated = live.newest;
  }
```

(`updated` is a parameter; it is reassigned here, which is fine in a function parameter.)

- [ ] **Step 5: Run the tests to see them pass**

Run: `node --test validator/test/client-plan.test.js && node --test validator/test/client.test.js`
Expected: PASS, both files.

- [ ] **Step 6: Commit**

```bash
git add validator/lib/client-live.js validator/lib/client.js validator/test/client-plan.test.js
git commit -m "MAINT-0014: parts move with the branches being worked on" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The plan page

**Files:**
- Create: `validator/lib/client-plan-render.js`
- Modify: `validator/lib/client.js` (strings; `renderClient` uses `planBody` when `view.plan`)
- Test: `validator/test/client-plan.test.js`

**Interfaces:**
- Consumes: the view from Tasks 2–4 (`plan`, `recent`, `now`, `waiting`, `updated`, `goal`, `title`, `language`).
- Produces: `planBody(view, say, h) → string` (the `<main>` contents) and `PLAN_CSS` (string), where `h = { esc, bdi, ICON }`. New `STRINGS` keys in both languages: `step`, `stepOf`, `allDone`, `planHeading`, `recent`, `waitingYou`, `startsNext`, `laterParts`, `delivered`, `stepParts`, `addedStep`, `lastUpdated`, `readPlan`, `readOnly`.

- [ ] **Step 1: Write the failing tests**

Append to `validator/test/client-plan.test.js` (add `renderClient` to the `client.js` import):

```js
test('the plan page shows now, waiting, recently done and every step, without IDs, branches or people', t => {
  const r = standard(t);
  r.commit('plan', '2026-10-01T09:00:00Z');
  r.write(`${RD}/decisions/D-0009.md`, '---\nrecord: decision\nid: D-0009\nquestion: Which card provider?\nclient_question: Which card machine do you use?\ntype: decision\nowner: alice-owner\naffects: [M-0002]\nrequired_before: implement\nstatus: Open\n---\n# D-0009\n');
  r.commit('decision', '2026-10-02T09:00:00Z');
  branch(r, 'claude/T-0003-pay', '2026-10-11T11:00:00Z', () => r.task('T-0003', 'Active', 'M-0002', 'Pay by card'));
  const { v } = live(r);
  const html = renderClient(v);
  assert.match(html, /<h1>Now working on ordering a cake\.<\/h1>/, 'English sentence case, as today\'s headline');
  assert.match(html, /Step 3 of 4/);
  assert.match(html, /<section class="panel now"[\s\S]*Pay by card[\s\S]*Ordering a cake/);
  assert.match(html, /<h2 id="waiting">[\s\S]*Waiting on you[\s\S]*Which card machine do you use\?/);
  assert.match(html, /<h2 id="plan">The plan<\/h2>/);
  assert.match(html, /<h3><bdi>Foundations<\/bdi><\/h3>/);
  assert.match(html, /<li class="step done">[\s\S]*Accounts and sign-in/);
  assert.match(html, /<li class="step active current">[\s\S]*Ordering a cake[\s\S]*Choose a cake[\s\S]*Pay by card[\s\S]*Email the receipt/);
  assert.match(html, /<li class="step next">[\s\S]*Deliveries[\s\S]*Its parts are planned when we reach it\./);
  assert.match(html, /<time data-ago datetime="2026-10-11T11:00:00Z"/);
  for (const absent of ['T-000', 'M-000', 'D-0009', 'claude/', 'bob-worker', 'alice-owner', 'internal title', 'waiting on D-0009', 'Which card provider']) assert.ok(!html.includes(absent), absent);
  assert.doesNotMatch(html, /<script src|https?:\/\/(?!www\.w3\.org)/, 'still self-contained: one inline script, no requests');
});

test('the plan page escapes plan text, keeps right-to-left text apart, and speaks Arabic', t => {
  const r = standard(t, { client: { plan: 'docs/client-page/plan.json', language: 'ar' } });
  r.plan({ phases: [{ title: 'الأساسات <b>', summary: 'Summary with <script>alert(1)</script>', steps: [{ title: 'تجهيز المحل', milestones: ['M-0001', 'M-0002', 'M-0003'] }, { title: 'الطلبات', added: '2026-11-02' }] }] });
  const html = renderClient(view(r));
  assert.match(html, /<html lang="ar" dir="rtl">/);
  assert.match(html, /<bdi>الأساسات &lt;b&gt;<\/bdi>/);
  assert.ok(!html.includes('<script>alert'), 'plan text is escaped');
  assert.match(html, /الخطة/);
  assert.match(html, /الخطوة 1 من 2/);
  assert.match(html, /أُضيفت/, 'an added step carries its mark');
});

test('a step that is done opens to what it delivered, and a project with every step done says so', t => {
  const r = standard(t);
  for (const [id, title, tasks] of [['M-0002', 'Online ordering', ['T-0002', 'T-0003', 'T-0004']], ['M-0003', 'Daily orders', []]]) r.milestone(id, 'Accepted', title, tasks);
  r.plan({ phases: [{ title: 'All', steps: [{ title: 'Menu', milestones: ['M-0001'] }, { title: 'Ordering', milestones: ['M-0002', 'M-0003'] }] }] });
  const html = renderClient(view(r));
  assert.match(html, /<h1>Every step is done\.<\/h1>/);
  assert.match(html, /<details class="more"><summary>What it delivered \(3\)<\/summary>[\s\S]*Choose a cake/);
  assert.doesNotMatch(html, /Step \d+ of/);
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `node --test validator/test/client-plan.test.js`
Expected: FAIL: the plan tests do not find `Step 3 of 4` (the old page renders).

- [ ] **Step 3: Add the strings**

In `validator/lib/client.js`, add to `STRINGS.en` (after `title:`):

```js
    step: { done: 'Done', active: 'In progress', next: 'Next', later: 'Later' },
    stepOf: (i, n) => `Step ${i} of ${n}`,
    allDone: 'Every step is done.',
    planHeading: 'The plan',
    recent: 'Recently done',
    waitingYou: 'Waiting on you',
    startsNext: t => `Starting next: ${t}`,
    laterParts: 'Its parts are planned when we reach it.',
    delivered: n => `What it delivered (${n})`,
    stepParts: n => `Its parts (${n})`,
    addedStep: 'Added',
    lastUpdated: 'Last updated',
    readPlan: 'Each step is done, in progress, next or later; a step is made of parts, which we plan when we reach it. The plan can grow: what we add along the way is marked.',
    readOnly: 'This page shows progress only; nothing can be changed from it.',
```

and to `STRINGS.ar`:

```js
    step: { done: 'منجزة', active: 'قيد التنفيذ', next: 'التالية', later: 'لاحقاً' },
    stepOf: (i, n) => `الخطوة ${i} من ${n}`,
    allDone: 'اكتملت كل الخطوات.',
    planHeading: 'الخطة',
    recent: 'أُنجز مؤخراً',
    waitingYou: 'بانتظارك',
    startsNext: t => `يبدأ بعد ذلك: ${t}`,
    laterParts: 'نحدد أجزاءها حين نصل إليها.',
    delivered: n => `ما أنجزته (${n})`,
    stepParts: n => `أجزاؤها (${n})`,
    addedStep: 'أُضيفت',
    lastUpdated: 'آخر تحديث',
    readPlan: 'كل خطوة إما منجزة أو قيد التنفيذ أو التالية أو لاحقة، وتتكون من أجزاء نحددها حين نصل إليها. قد تكبر الخطة، وما نضيفه أثناء العمل يظهر بعلامة.',
    readOnly: 'تعرض هذه الصفحة سير العمل فقط، ولا يمكن تغيير شيء منها.',
```

- [ ] **Step 4: Write the plan body**

Create `validator/lib/client-plan-render.js`:

```js
// The client page with a plan (MAINT-0014): header with the whole plan's progress, Now, Waiting on you, Recently done,
// then each phase and its steps. `renderClient` wraps it in the page's head and theme; `h` carries its escaping helpers.
export function planBody(view, say, { esc, bdi, ICON }) {
  const plan = view.plan;
  const pct = n => `${Math.round(Math.min(1, Math.max(0, n)) * 100)}%`;
  const bar = n => `<div class="bar" aria-hidden="true"><span style="width:${pct(n)}"></span></div>`;
  const date = iso => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(say.locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }); };
  const active = plan.steps.filter(s => s.state === 'active');
  const next = plan.steps.find(s => s.state === 'next');
  const headline = active.length ? say.working(active[0].title) : next ? say.next(next.title) : say.allDone;
  const named = active[0]?.title ?? next?.title;
  const h1 = named && headline.includes(named) ? esc(headline).replace(esc(named), bdi(named)) : esc(headline);
  const partList = items => `<ul class="items" role="list">${items.map(i => `<li class="item ${i.state}"><span class="icon" aria-hidden="true">${ICON[i.state]}</span><span class="name">${bdi(i.title)}${i.added ? ` <span class="tag">${esc(say.added)}</span>` : ''}</span><span class="state">${esc(say.part[i.state])}</span></li>`).join('')}</ul>`;
  const nowItems = active.flatMap(s => s.items.filter(i => i.state === 'active' || i.state === 'checking').map(i => ({ ...i, step: s.title })));
  const now = `<section class="panel now" aria-labelledby="now"><h2 id="now">${esc(say.now)}</h2>${nowItems.length
    ? `<ul class="items" role="list">${nowItems.map(i => `<li class="item ${i.state}"><span class="icon" aria-hidden="true">${ICON[i.state]}</span><span class="name">${bdi(i.title)} <span class="where">${esc(say.nextIn)} ${bdi(i.step)}</span></span><span class="state">${esc(say.part[i.state])}</span></li>`).join('')}</ul>`
    : `<p>${next ? esc(say.startsNext(next.title)) : esc(say.allDone)}</p>`}</section>`;
  const waiting = view.waiting.length ? `<section class="panel waiting" aria-labelledby="waiting"><h2 id="waiting"><span aria-hidden="true">${ICON.hold}</span>${esc(say.waitingYou)}</h2><ul class="decisions" role="list">${view.waiting.map(d => `<li><p class="question">${bdi(d.question)}</p><p class="meta">${esc(d.proposed ? say.decisionProposed : say.decisionOpen)}. ${esc(say.holds)} ${d.holds.map(bdi).join(view.language === 'ar' ? '، ' : ', ')}</p></li>`).join('')}</ul></section>` : '';
  const recent = view.recent.length ? `<section class="panel recent" aria-labelledby="recent"><h2 id="recent">${esc(say.recent)}</h2><ul class="items" role="list">${view.recent.map(p => `<li class="item done"><span class="icon" aria-hidden="true">${ICON.done}</span><span class="name">${bdi(p.title)}</span><span class="state">${esc(date(p.date))}</span></li>`).join('')}</ul></section>` : '';
  const current = active[0] ?? next;
  const step = s => {
    const parts = s.items.length
      ? s === current ? partList(s.items) : `<details class="more"><summary>${esc(s.state === 'done' ? say.delivered(s.items.length) : say.stepParts(s.items.length))}</summary>${partList(s.items)}</details>`
      : s.state === 'done' ? '' : `<p class="later">${esc(say.laterParts)}</p>`;
    return `<li class="step ${s.state}${s === current ? ' current' : ''}"><span class="marker" aria-hidden="true">${s.state === 'done' ? ICON.done : ''}</span><div class="body"><p class="status">${esc(say.step[s.state])}${s.added ? ` <span class="tag">${esc(say.addedStep)}</span>` : ''}</p><h4>${bdi(s.title)}</h4>${s.summary ? `<p class="outcome">${bdi(s.summary)}</p>` : ''}${s.parts && s.state !== 'done' ? `<div class="parts">${bar(s.progress)}<p>${esc(say.parts(s.parts.done, s.parts.total, s.on_hold))}</p></div>` : ''}${parts}</div></li>`;
  };
  const phases = plan.phases.map(p => `<section class="phase">${p.title ? `<div class="phase-head"><h3>${bdi(p.title)}</h3>${bar(p.progress)}</div>${p.summary ? `<p class="outcome">${bdi(p.summary)}</p>` : ''}` : ''}<ol class="steps" role="list">${p.steps.map(step).join('')}</ol></section>`).join('');
  const updated = view.updated ? `<p>${esc(say.lastUpdated)}: <time data-ago datetime="${esc(view.updated)}" data-locale="${esc(say.locale)}">${esc(date(view.updated))}</time></p>` : '';
  return `<header>
    <p class="project">${esc(view.title)}</p>
    <h1>${h1}</h1>
    <div class="overall">${bar(plan.progress)}<p>${plan.position ? esc(say.stepOf(plan.position.index, plan.position.total)) : ''}</p></div>
    ${view.goal ? `<p class="goal">${esc(say.goal)} ${bdi(view.goal)}</p>` : ''}
    ${updated}
  </header>
  <div class="panels">${now}${waiting}${recent}</div>
  <section aria-labelledby="plan"><h2 id="plan">${esc(say.planHeading)}</h2>${phases}</section>
  <footer><p>${esc(say.readPlan)}</p><p>${esc(say.readOnly)}</p></footer>
  <script>(() => { const el = document.querySelector('time[data-ago]'); if (!el || !window.Intl || !Intl.RelativeTimeFormat) return; const show = () => { const s = Math.max(0, (Date.now() - Date.parse(el.dateTime)) / 1000); const [n, u] = s < 3600 ? [Math.round(s / 60), 'minute'] : s < 86400 ? [Math.round(s / 3600), 'hour'] : [Math.round(s / 86400), 'day']; el.title = el.title || el.textContent; el.textContent = new Intl.RelativeTimeFormat(el.dataset.locale, { numeric: 'auto' }).format(-n, u); }; show(); setInterval(show, 60000); })();</script>`;
}

export const PLAN_CSS = `
  .header-time, header time { color: var(--muted); }
  .phase { margin-top: 2rem; }
  .phase-head { display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; }
  .phase-head h3 { margin: 0; font: 600 1.25rem/1.35 var(--display-font); }
  .phase-head .bar { flex: 1 1 8rem; max-width: 14rem; }
  ol.steps { list-style: none; margin: 1rem 0 0; padding: 0; display: grid; gap: 1.1rem; }
  .step { display: grid; grid-template-columns: 1.6rem minmax(0, 1fr); gap: .9rem; }
  .step .marker { width: 1.6rem; height: 1.6rem; border-radius: 50%; display: grid; place-items: center; border: 2px solid var(--planned); background: var(--page); }
  .step .marker svg { width: .9rem; height: .9rem; fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
  .step.done .marker { background: var(--done); border-color: var(--done); color: var(--surface); }
  .step.active .marker { border-color: var(--active); background: var(--active); }
  .step.next .marker { border-color: var(--text); }
  .step.done .status { color: var(--done); } .step.active .status { color: var(--active); } .step.next .status { color: var(--text); }
  .step h4 { margin: .1rem 0 0; font: 400 1.15rem/1.4 var(--display-font); }
  .step.later h4 { color: var(--muted); }
  .step.current .body { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: .9rem 1.05rem 1rem; margin-top: -.3rem; }
  .step .later { margin: .35rem 0 0; color: var(--muted); font-size: .92rem; }
  .step.active .bar span { background: var(--active); }
  .item.checking .icon { color: var(--active); } .item.checking .state { color: var(--active); }
  .panel .where { color: var(--muted); font-size: .9rem; }
  .panel.recent .item { grid-template-columns: 1.25rem minmax(0, 1fr) auto; }
`;
```

- [ ] **Step 5: Use it in `renderClient`**

In `validator/lib/client.js`:

1. Import: `import { planBody, PLAN_CSS } from './client-plan-render.js';`
2. In `renderClient`, after the `<style>` block's last rule (`@media print { ... }`), add `${view.plan ? PLAN_CSS : ''}`.
3. Replace the `<main>` element's contents with a choice. Change:

```js
<main>
  <header>
```

to:

```js
<main>
  ${view.plan ? planBody(view, say, { esc, bdi, ICON }) : `<header>
```

and close the template literal after the existing `</footer>`:

```js
  </footer>`}
</main>
```

So the existing header, panels, stages, how and footer render only without a plan.

- [ ] **Step 6: Run the tests to see them pass**

Run: `node --test validator/test/client-plan.test.js && node --test validator/test/client.test.js`
Expected: PASS, both files.

- [ ] **Step 7: Commit**

```bash
git add validator/lib/client-plan-render.js validator/lib/client.js validator/test/client-plan.test.js
git commit -m "MAINT-0014: the plan page: now, waiting on you, recently done and every step" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: `wf status --client --live`

**Files:**
- Modify: `validator/cli.js` (option parsing; the `status --client` block; `USAGE` text)
- Test: `validator/test/client-plan.test.js`

**Interfaces:**
- Consumes: `gitHistory` (Task 3), `readBranches` (Task 4), `evaluateClient({ source, updated, history, live })`, `view.warnings`.
- Produces: `wf status --client [--candidate REV] [--live] [--pull-requests FILE]`; warnings on standard error, prefixed `wf status --client: `; exit 0, or 2 on a plan error.

- [ ] **Step 1: Write the failing tests**

Append to `validator/test/client-plan.test.js`:

```js
const run = (dir, ...args) => spawnSync(process.execPath, [cli, 'status', '--client', '--repo', dir, ...args], { encoding: 'utf8' });

test('wf status --client --live reads the branches, takes pull requests, and warns on standard error', t => {
  const r = standard(t);
  r.milestone('M-0004', 'Draft', 'Gift cards', []);
  r.commit('plan', '2026-10-01T09:00:00Z');
  r.git(['update-ref', 'refs/remotes/origin/main', r.git(['rev-parse', 'main'])]);
  const now = new Date(Date.now() - 60 * 60 * 1000).toISOString().replace(/\.\d+Z$/, 'Z');
  branch(r, 'claude/T-0003-pay', now, () => r.task('T-0003', 'Active', 'M-0002', 'Pay by card'));
  const prs = path.join(r.dir, '..', `${path.basename(r.dir)}-prs.json`);
  fs.writeFileSync(prs, JSON.stringify([{ headRefName: 'claude/T-0003-pay', isDraft: false, isCrossRepository: false }]));
  t.after(() => fs.rmSync(prs, { force: true }));
  const plain = run(r.dir, '--candidate', 'main');
  assert.equal(plain.status, 0, plain.stderr);
  assert.match(plain.stdout, /Pay by card[\s\S]*?Up next/, 'without --live the trusted branch alone');
  assert.match(plain.stderr, /wf status --client: client\.plan: M-0004 is in no step/);
  const withLive = run(r.dir, '--candidate', 'main', '--live', '--pull-requests', prs);
  assert.equal(withLive.status, 0, withLive.stderr);
  assert.match(withLive.stdout, /Pay by card[\s\S]*?Being checked/);
  assert.match(withLive.stdout, new RegExp(`datetime="${now}"`));
});

test('a plan error stops wf status --client; a directory source renders without history', t => {
  const r = standard(t);
  const ok = run(r.dir);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /The plan/);
  assert.doesNotMatch(ok.stdout, /Recently done/);
  r.plan({ phases: [{ title: 'A', steps: [{ title: 'S', milestones: ['M-0009'] }] }] });
  const bad = run(r.dir);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /names M-0009, which has no milestone record/);
  assert.match(run(r.dir, '--json').stderr, /--client is only for status/);
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `node --test validator/test/client-plan.test.js`
Expected: FAIL: `invalid option or missing value: --live` and `--client is only for status, alone` for `--pull-requests`.

- [ ] **Step 3: Parse `--live` and allow `--pull-requests` with `--client`**

In `validator/cli.js`, beside `if (a === '--client') { o.client = true; continue; }`, add:

```js
    if (a === '--live') { o.live = true; continue; }
```

Replace the `--client` guard line with:

```js
  if (o.client && (cmd !== 'status' || o.json || o['trust-key'])) throw new WfError('--client is only for status, without --json or the trust options: it prints the client page as HTML');
  if (o.live && !o.client) throw new WfError('--live is only for status --client');
```

In `USAGE`, change the `status --client` line to:

```
    status --client [--candidate REV] [--live] [--pull-requests FILE]: the same records as one plain-language HTML page for a client (no IDs, people or reasons); --live adds the parts moving on remote branches
```

- [ ] **Step 4: Build history and the live reading**

Add imports at the top of `validator/cli.js`:

```js
import { gitHistory } from './lib/client-history.js';
import { readBranches } from './lib/client-live.js';
```

Replace the body of `if (cmd === 'status' && o.client) { ... }` with:

```js
  if (cmd === 'status' && o.client) {
    const isGit = candidate.kind === 'git';
    const date = isGit ? gitRunner(repo)('show', '-s', '--no-show-signature', '--format=%cI', candidate.name, '--') : null;
    let pullRequests = null;
    if (o['pull-requests']) {
      try { pullRequests = JSON.parse(fs.readFileSync(o['pull-requests'], 'utf8')); } catch (e) { throw new WfError(`--pull-requests: ${e.message}`); }
      if (!Array.isArray(pullRequests)) throw new WfError('--pull-requests: pull requests must be a JSON array');
    }
    // History and branches need Git: a directory source renders from the working tree alone.
    const history = isGit ? gitHistory(repo, candidate.name, rd) : null;
    const live = o.live && isGit ? readBranches({ repo, base: candidate.name, trustedBranch: config.trusted_branch ?? 'main', recordsDir: rd, pullRequests }) : null;
    let view;
    try { view = evaluateClient({ source: candidate, updated: date?.status === 0 ? date.stdout.trim() : new Date().toISOString(), history, live }); } catch (e) { throw new WfError(e.message); }
    for (const w of view.warnings) process.stderr.write(`wf status --client: ${w}\n`);
    process.stdout.write(renderClient(view));
    return 0;
  }
```

Check that a thrown `WfError` exits 2: read the `main().catch` / exit handling at the end of `cli.js` and confirm `WfError` maps to exit 2 (the existing missing-logo test expects a non-zero status with the message on stderr). If it maps to a different code, change the test's `assert.equal(bad.status, 2)` to that code and note why in the commit.

- [ ] **Step 5: Run the tests to see them pass**

Run: `node --test validator/test/client-plan.test.js && node --test validator/test/client.test.js`
Expected: PASS, both files.

- [ ] **Step 6: Commit**

```bash
git add validator/cli.js validator/test/client-plan.test.js
git commit -m "MAINT-0014: wf status --client --live" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Publishing within minutes, documents and the release

**Files:**
- Modify: `templates/github/wf-client-page.yml`
- Modify: `SCHEMA.md` (the `status --client` paragraph), `QUICKSTART.md` (the `status --client` sentence), `procedures/readiness.md`, `AGENTS.md` (the client view line), `CHANGELOG.md`, `upgrades.json`, `package.json`
- Test: `validator/test/client-plan.test.js`, then `npm test`

**Interfaces:**
- Consumes: `wf status --client --live --pull-requests FILE` (Task 6).
- Produces: release v2.3.0.

- [ ] **Step 1: Write the failing test for the workflow template**

Append to `validator/test/client-plan.test.js`:

```js
test('the client page workflow rebuilds on any push and deploys only from the trusted branch', () => {
  const yml = fs.readFileSync(path.join(root, 'templates/github/wf-client-page.yml'), 'utf8');
  assert.match(yml, /push:\n\s+branches: \['\*\*'\]/);
  assert.match(yml, /pull_request:\n\s+types: \[opened, reopened, ready_for_review, converted_to_draft, closed\]/);
  assert.match(yml, /schedule:/);
  assert.match(yml, /gh workflow run wf-client-page\.yml --ref __TRUSTED_BRANCH__/);
  assert.match(yml, /if: github\.ref != 'refs\/heads\/__TRUSTED_BRANCH__'/);
  assert.match(yml, /if: github\.ref == 'refs\/heads\/__TRUSTED_BRANCH__'/);
  assert.match(yml, /fetch-depth: 0/);
  assert.match(yml, /scripts\/wf status --client --live --candidate "\$GITHUB_SHA" --pull-requests "\$RUNNER_TEMP\/pull-requests\.json"/);
  assert.doesNotMatch(yml, /uses: [^@\n]+@(?![0-9a-f]{40}\b)/, 'actions pinned by commit');
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test validator/test/client-plan.test.js`
Expected: FAIL on `push: branches: ['**']`.

- [ ] **Step 3: Rewrite the workflow template**

Read the current `templates/github/wf-client-page.yml` first and keep its header comment, adding one paragraph. Replace everything from `name: wf-client-page` to the end with:

```yaml
name: wf-client-page
# Within minutes (MAINT-0014): a push to any branch, or a pull request opening, closing or changing draft state, asks
# for a rebuild; GitHub Pages deploys only from the trusted branch, so any other ref only dispatches this workflow on
# it. The build reads the trusted branch's records and plan, then the parts moving on the branches (`--live`).
on:
  push:
    branches: ['**']
  pull_request:
    types: [opened, reopened, ready_for_review, converted_to_draft, closed]
  workflow_dispatch:
  schedule:
    - cron: '17 3 * * *'
permissions:
  contents: read
concurrency:
  group: wf-client-page-${{ github.ref == 'refs/heads/__TRUSTED_BRANCH__' && 'build' || github.ref }}
  cancel-in-progress: true
jobs:
  dispatch:
    if: github.ref != 'refs/heads/__TRUSTED_BRANCH__'
    runs-on: ubuntu-latest
    timeout-minutes: 2
    permissions:
      actions: write
    steps:
      - name: Ask for a rebuild on the trusted branch
        env:
          GH_TOKEN: ${{ github.token }}
        run: gh workflow run wf-client-page.yml --ref __TRUSTED_BRANCH__ --repo "$GITHUB_REPOSITORY"
  build:
    if: github.ref == 'refs/heads/__TRUSTED_BRANCH__'
    runs-on: ubuntu-latest
    timeout-minutes: 5
    permissions:
      contents: read
      pull-requests: read
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4
        with:
          fetch-depth: 0
          persist-credentials: false
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4
        with:
          node-version: 22
      - name: List the open pull requests
        env:
          GH_TOKEN: ${{ github.token }}
        run: gh pr list --repo "$GITHUB_REPOSITORY" --state open --limit 500 --json headRefName,isDraft,isCrossRepository > "$RUNNER_TEMP/pull-requests.json"
      - name: Render the client page
        run: |
          set -euo pipefail
          mkdir -p "$RUNNER_TEMP/site"
          scripts/wf status --client --live --candidate "$GITHUB_SHA" --pull-requests "$RUNNER_TEMP/pull-requests.json" > "$RUNNER_TEMP/site/index.html"
      - uses: actions/upload-pages-artifact@fc324d3547104276b827a68afc52ff2a11cc49c9 # v5.0.0
        with:
          path: ${{ runner.temp }}/site
  deploy:
    needs: build
    permissions:
      pages: write
      id-token: write
    runs-on: ubuntu-latest
    timeout-minutes: 5
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@368f82528645a54fb793d4d04e342629a3f51346 # v5.0.1
```

Note: `$GITHUB_SHA` on a `workflow_dispatch` or `schedule` run is the trusted branch's tip, which is what the build should read. The `pull_request` trigger runs in the base repository's context only for same-repository pull requests with a token that can dispatch; a fork's pull request gets a read-only token, so its `dispatch` job fails harmlessly and nothing is built from it.

- [ ] **Step 4: Update the documents**

1. `SCHEMA.md`, at the end of the `status --client` paragraph, append:

> With `client.plan` (a repository path ending `.json`, read at the same revision as the records) the page shows the whole plan: the file's `phases` (`title`, optional `summary`, `steps`), each step (`title`, optional `summary`, and either `milestones`, a list of milestone IDs each in at most one step, or `done: true` for work before the records; optional `added`, a `YYYY-MM-DD` date that marks it added) in the client's words. A step is *Done* when `done` or every milestone is Accepted or Released; *In progress* when a milestone is Active, Verified or Blocked or a part is moving; the first other step is *Next* and the rest *Later*. Its parts are its milestones' task records, those removed after acceptance read from the last commit that had them; overall and phase progress count each step once, a step with parts by its share done. A milestone no step lists shows as an added step at the end, with a warning on standard error; a step naming a milestone with no record fails. The page leads with Now, Waiting on you and the five parts done most recently (dated by the first commit where their record read Done), and its last update as a relative time. Unknown keys, wrong types, `done` with `milestones`, a milestone in two steps and a file over 256 KB fail. `--live` adds the parts moving on remote branches (`refs/remotes/origin/*` other than the trusted branch, with a tip under 14 days old or an open pull request): only task records the branch changed since it left the trusted branch, only their `status` (Active, Blocked; Done shows as in progress until merged) and wording, never moving a part the trusted branch has Done, the newer branch winning; with `--pull-requests` (`gh pr list --json headRefName,isDraft,isCrossRepository`) a part whose branch has an open, non-draft pull request shows *Being checked*. A failure to read branches falls back to the trusted branch with a warning. Without `client.plan` the page is as above, and a finished stage also lists its parts.

2. `QUICKSTART.md`, after `(SCHEMA.md).` in the `status --client` sentence, insert:

> With `client.plan` it shows the whole plan, phase by phase and step by step, from a plan file in the client's words; `--live` (with `--pull-requests`) adds what is moving on the branches, and the installed workflow rebuilds the page within minutes of any push.

3. `procedures/readiness.md`: find the sentence where a milestone record is written or drafted (search for `milestone` in the section on planning milestones) and add after it:

> When `client.plan` is set, the pull request that adds a milestone also places it in a step of the plan file; `wf status --client` warns about a milestone no step lists.

4. `AGENTS.md`: in the line that ends `Client view: \`wf st...`, add after its first clause: `with \`client.plan\`, the whole plan, live within minutes (MAINT-0014)`.

5. `package.json`: `"version": "2.3.0"`.

6. `CHANGELOG.md`, above `## v2.2.0`:

```markdown
## v2.3.0

Lets the client page show the whole plan and keep up with the work within minutes (MAINT-0014). Before this, the page showed only the milestones on the trusted branch and changed only when work was merged: a part being built all day read as not started, the steps after the current milestone were nowhere, and a signed-off stage listed nothing it delivered.

- **`client.plan`** names a plan file of phases and steps in the client's words, each step naming the milestones that carry it out (or `done: true` for work before the records). The page leads with Now, Waiting on you and Recently done, then every phase and step with its state (Done, In progress, Next, Later) and its parts; a milestone the plan does not place still shows, marked added, with a warning.
- **Finished parts stay**: a removed task record is read from the last commit that had it, and a part's done date from the first commit where it read Done.
- **`wf status --client --live`** adds the parts moving on remote branches, and `--pull-requests` marks those with an open pull request *Being checked*. Only parts, only forward, never past the trusted branch's Done.
- **`templates/github/wf-client-page.yml`** rebuilds on any push or pull request change and deploys from the trusted branch only.

Moving a project to this pin:
- Nothing changes without `client.plan`, except that a signed-off stage lists its parts.
- To use it, write the plan file in the client's language, set `client.plan`, and copy the new `wf-client-page.yml` (an enforcement-path change for the owner). Every pull request that adds a milestone then places it in a step.
```

7. `upgrades.json`, add after the `v2.2.0` entry (keep valid JSON, same indentation):

```json
  "v2.3.0": {
    "notes": [
      "Optional: write a client plan file (phases and steps in the client's words, each step naming its milestones) and set client.plan in docs/workflow/config.json; a governing-record change.",
      "If the client page is installed: copy .github/workflows/wf-client-page.yml from this release, so the page rebuilds within minutes of any push and reads the branches (--live); an enforcement-path change for the owner."
    ]
  }
```

- [ ] **Step 5: Run every test**

Run: `node --test validator/test/client-plan.test.js && npm test`
Expected: all pass, except possibly *release tags sort by version number and ignore tags that are not versions*, which fails identically on unmodified `main` in this local environment (recorded in MAINT-0013's pull request; CI is the judge). Any other failure must be fixed; a test that checks documents (for example a word budget or a template list) is fixed by adjusting this change, not the test.

- [ ] **Step 6: Record the corpus size**

`procedures/maintenance.md` asks for the shared corpus's word count before and after. Run both and note the numbers for the pull request:

```bash
corpus() { cat POLICY.md SCHEMA.md QUICKSTART.md procedures/*.md templates/*.md .agents/skills/workflow/SKILL.md | wc -w; }
git stash -q && corpus && git stash pop -q   # before: Tasks 1-6 change no corpus file
corpus                                        # after
```

- [ ] **Step 7: Commit**

```bash
git add templates/github/wf-client-page.yml SCHEMA.md QUICKSTART.md procedures/readiness.md AGENTS.md CHANGELOG.md upgrades.json package.json validator/test/client-plan.test.js
git commit -m "MAINT-0014: publish within minutes; documents and v2.3.0" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Check the real page, review, and open the pull request (agent-workflow)

**Files:** none changed unless the review finds something.

- [ ] **Step 1: Render mateen-systems' page with this branch's code**

Using a copy of the plan file drafted for mateen-systems (Task 9, Step 2) in a scratch copy of the mateen-systems checkout, run from that copy:

```bash
node ~/Dev/agent-workflow/validator/cli.js status --client --live --candidate main --repo . > "$SCRATCH/mateen-client.html"
```

Open it in the browser pane at 1366 px and at 360 px wide, in light and dark. Check: T-0009 shows *In progress* under *Now*; every Phase 1 step shows; no ID, branch or name appears (search the HTML for `T-0`, `M-0`, `claude/`, `Cazy00`); the relative time reads in Arabic; no horizontal scroll at 360 px.

- [ ] **Step 2: Independent review**

Launch the `independent-reviewer` agent in the foreground with only paths and revisions: the spec path, this plan's path, and the range `origin/main..HEAD` on `claude/MAINT-0014-client-plan`. Fix findings it confirms, in new commits; for a second round launch a new reviewer with the earlier review.

- [ ] **Step 3: Push and open the pull request**

```bash
git push -u origin claude/MAINT-0014-client-plan
gh pr create --repo Cazy00/agent-workflow --title "MAINT-0014: the client page shows the whole plan, live (v2.3.0 candidate)" --body-file "$SCRATCH/maint-0014-pr.md"
```

The body follows MAINT-0013's: owner authorisation (the owner's words from 11 October 2026, quoted from the spec), base, the report table, what changes, verification (test counts, the known local failure, corpus words before and after), the review table, and ends with:

```
🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

Do not merge it: the owner's merge is the release approval.

---

### Task 9: mateen-systems: adopt v2.3.0 and write the plan (after the owner merges and v2.3.0 is tagged)

**Files (in mateen-systems, a new branch `claude/client-plan` from `main`, in its own worktree; never T-0009's branch):**
- Create: `docs/client-page/plan.json`
- Modify: `docs/workflow/config.json` (pin by `bin/wf-upgrade`; `client.plan`)
- Modify: `.github/workflows/wf-client-page.yml` (copied from v2.3.0, `__TRUSTED_BRANCH__` → `main`)
- Modify: `docs/workflow/tasks/T-0001.md` … `T-0007.md`, `T-0012.md` (`client_title` in Arabic where English or missing)

- [ ] **Step 1: Move the pin**

Run `bin/wf-upgrade` as `QUICKSTART.md` describes for v2.3.0 (it is the owner-run tool; if it needs the owner, prepare the exact command for them instead), then `scripts/wf next` and `scripts/wf records` to confirm the records still validate.

- [ ] **Step 2: Write `docs/client-page/plan.json`**

From `docs/plans/phase-0-foundations.md` and `docs/plans/phase-1-pilot.md`: Phase 0 with steps 1–7 `done: true` and step 8 → `M-0001`; Phase 1 with its ten steps and *Going live* in the plan's order (*Going live* after step 3), step 1 → `["M-0002", "M-0003"]`, the others without milestones. Every title and summary in plain Arabic for the shop owner, one sentence each, no spec references (no `B1`, `A6.5`, `D2`), no English except product names (Mateen Print, WhatsApp). Each summary says what the shop gets, not how it is built.

- [ ] **Step 3: Arabic part titles**

For each task record whose `client_title` is English or missing (`grep -L "client_title: [^A-Za-z]" docs/workflow/tasks/*.md` as a first pass), write an Arabic `client_title` in the same voice as M-0003's tasks.

- [ ] **Step 4: Config and workflow**

Add `"plan": "docs/client-page/plan.json"` to `client` in `docs/workflow/config.json`; copy `templates/github/wf-client-page.yml` from the v2.3.0 installation with `__TRUSTED_BRANCH__` replaced by `main`.

- [ ] **Step 5: Check it**

Run `scripts/wf status --client --live --candidate HEAD > "$SCRATCH/client.html"` (no warnings expected on stderr), open it at 1366 px and 360 px, light and dark, and confirm the same points as Task 8 Step 1. Run `scripts/wf records` and `scripts/wf ci` as the repository's workflow requires.

- [ ] **Step 6: Commit, push, pull request**

One commit, `Client page: the whole plan, live (agent-workflow v2.3.0)`, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Open the pull request with the Arabic plan shown in its description for the owner to approve, and the body ending `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. Bind it with the `ccd_pr` tools. The owner merges.

- [ ] **Step 7: Measure once live**

After the merge and the first Pages deploy, push one commit to a task branch (the next real task commit; never an empty commit made only to test) and record the minutes from the push until the page shows the part *In progress*, as a comment on the mateen-systems pull request.
