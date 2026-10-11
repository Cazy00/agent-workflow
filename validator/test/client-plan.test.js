import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirSource, gitSource, loadConfig } from '../lib/index.js';
import { loadPlan } from '../lib/client-plan.js';
import { gitHistory } from '../lib/client-history.js';
import { evaluateClient, renderClient } from '../lib/client.js';
import { readBranches } from '../lib/client-live.js';

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
  const milestoneText = (id, status, title, tasks = []) => `---\nrecord: milestone\nid: ${id}\noutcome: ${title} works.\nclient_title: ${title}\nstatus: ${status}\ncoordinator: agent\nowner: alice-owner\nscope: [src]\ngoverning: [PROFILE]\nacceptance: []\nauthority: owner\nlimits: x\ndemonstration: x\nstop_conditions: x\nrelease_authority: owner\ntasks: [${tasks.join(', ')}]\n---\n# ${id} — ${title}\n`;
  const milestone = (id, ...rest) => write(`${RD}/milestones/${id}.md`, milestoneText(id, ...rest));
  const taskText = (id, status, milestoneId, title) => `---\nrecord: task\nid: ${id}\ntitle: ${id} internal title for bob-worker\nclient_title: ${title}\nstatus: ${status}\nmilestone: ${milestoneId}\nowner: bob-worker\nscope: [src]\ngoverning: [PROFILE]\nacceptance: []\nbranch: claude/${id}-work\nresume_condition: waiting on D-0009\n---\n# ${id}\n`;
  const task = (id, ...rest) => write(`${RD}/tasks/${id}.md`, taskText(id, ...rest));
  const plan = value => write('docs/client-page/plan.json', JSON.stringify(value));
  const commit = (message, date) => { git(['add', '-A'], date); git(['commit', '-qm', message], date); return git(['rev-parse', 'HEAD']); };
  git(['init', '-q', '-b', 'main']);
  return { dir, git, write, rm, milestone, task, plan, commit, milestoneText, taskText };
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

test('with detail "stages" a step still counts its parts and sees a moving part', t => {
  const r = standard(t, { client: { plan: 'docs/client-page/plan.json', detail: 'stages' } });
  const ordering = () => view(r).plan.steps[2];
  assert.deepEqual(ordering().parts, { done: 1, total: 3 });
  assert.equal(ordering().progress, 1 / 3);
  r.milestone('M-0002', 'Authorised', 'Online ordering', ['T-0002', 'T-0003', 'T-0004']);
  r.task('T-0003', 'Active', 'M-0002', 'Pay by card');
  assert.equal(ordering().state, 'active', 'the items are hidden, but a task in progress still moves its step');
});

test('a step counts a finished milestone by its planned parts, whatever the detail and with or without history', t => {
  for (const detail of ['full', 'stages']) {
    const r = repo(t, { client: { plan: 'docs/client-page/plan.json', detail } });
    r.milestone('M-0001', 'Active', 'Menu online', ['T-0001', 'T-0002']);
    r.task('T-0001', 'Done', 'M-0001', 'Put the menu online');
    r.task('T-0002', 'Done', 'M-0001', 'Show prices');
    r.milestone('M-0002', 'Active', 'Online ordering', ['T-0003', 'T-0004']);
    r.task('T-0003', 'Ready', 'M-0002', 'Choose a cake');
    r.task('T-0004', 'Ready', 'M-0002', 'Pay by card');
    r.plan({ phases: [{ title: 'All', steps: [{ title: 'Ordering', milestones: ['M-0001', 'M-0002'] }] }] });
    r.commit('work', '2026-09-01T09:00:00Z');
    r.milestone('M-0001', 'Accepted', 'Menu online', ['T-0001', 'T-0002']);
    r.rm(`${RD}/tasks/T-0001.md`); r.rm(`${RD}/tasks/T-0002.md`);
    r.commit('accept M-0001', '2026-09-02T09:00:00Z');
    for (const history of [null, gitHistory(r.dir, 'main', RD)]) {
      const ordering = view(r, { source: gitSource(r.dir, 'main'), history }).plan.steps[0];
      const label = `detail ${detail}, ${history ? 'with' : 'without'} history`;
      assert.deepEqual(ordering.parts, { done: 2, total: 4 }, label);
      assert.equal(ordering.progress, 0.5, label);
    }
  }
});

test('history is asked only for what the page shows', t => {
  const asked = [];
  const history = { lastVersion: id => { asked.push(`record ${id}`); return null; }, doneDate: id => { asked.push(`done ${id}`); return null; } };
  view(standard(t, { client: {} }), { history });
  assert.deepEqual(asked, [], 'without a plan there is no Recently done, and M-0001 keeps its record');
  const r = standard(t, { client: { plan: 'docs/client-page/plan.json', detail: 'stages' } });
  r.rm(`${RD}/tasks/T-0001.md`);
  view(r, { history });
  assert.deepEqual(asked, [], 'detail "stages" lists no parts, and counts a finished stage by its plan');
  view(standard(t), { history });
  assert.deepEqual(asked.sort(), ['done T-0001', 'done T-0002']);
});

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

const part = (v, title) => v.plan.steps.flatMap(s => s.items).find(i => i.title === title);

// Many commits at once, through one `git fast-import`: each entry is { date, files: { path: text | null } }.
function importCommits(r, entries) {
  const from = r.git(['rev-parse', 'main']);
  const data = text => `data ${Buffer.byteLength(text)}\n${text}\n`;
  const stream = entries.map(({ date, files }, i) => `commit refs/heads/main\ncommitter Fixture <fixture@example.invalid> ${Date.parse(date) / 1000} +0000\n${data(`commit ${i}`)}${i ? '' : `from ${from}\n`}${Object.entries(files).map(([file, text]) => text == null ? `D ${file}\n` : `M 100644 inline ${file}\n${data(text)}`).join('')}\n`).join('');
  const done = spawnSync('git', ['-C', r.dir, 'fast-import', '--quiet', '--force'], { input: stream, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  assert.equal(done.status, 0, done.stderr);
}

test('history is read in one pass: hundreds of parts, each done in its own commit, build in under 3 seconds', t => {
  const r = repo(t);
  const M = 10, N = 30; // 300 parts; the first six milestones are accepted and their records removed
  const mid = m => `M-${String(m).padStart(4, '0')}`;
  const tid = (m, n) => `T-${String(m * 100 + n).padStart(4, '0')}`;
  const ids = m => Array.from({ length: N }, (_, n) => tid(m, n + 1));
  r.plan({ phases: [{ title: 'All', steps: Array.from({ length: M }, (_, m) => ({ title: `Step ${m + 1}`, milestones: [mid(m + 1)] })) }] });
  for (let m = 1; m <= M; m++) r.milestone(mid(m), 'Active', `Milestone ${m}`, ids(m));
  r.commit('plan', '2026-01-01T00:00:00Z');
  let minute = 0;
  const at = () => new Date(Date.parse('2026-01-02T00:00:00Z') + 60000 * minute++).toISOString().replace('.000Z', 'Z');
  const entries = [];
  for (let m = 1; m <= M; m++) entries.push({ date: at(), files: Object.fromEntries(ids(m).map(id => [`${RD}/tasks/${id}.md`, r.taskText(id, 'Ready', mid(m), `Part ${id}`)])) });
  for (let m = 1; m <= M; m++) for (const id of ids(m)) {
    entries.push({ date: at(), files: { [`${RD}/tasks/${id}.md`]: r.taskText(id, 'Active', mid(m), `Part ${id}`) } });
    entries.push({ date: at(), files: { [`${RD}/tasks/${id}.md`]: r.taskText(id, 'Done', mid(m), `Part ${id}`) } });
  }
  for (let m = 1; m <= 6; m++) {
    entries.push({ date: at(), files: { [`${RD}/milestones/${mid(m)}.md`]: r.milestoneText(mid(m), 'Accepted', `Milestone ${m}`, ids(m)) } });
    entries.push({ date: at(), files: Object.fromEntries(ids(m).map(id => [`${RD}/tasks/${id}.md`, null])) });
  }
  importCommits(r, entries);
  const started = performance.now();
  const v = view(r, { source: gitSource(r.dir, 'main'), history: gitHistory(r.dir, 'main', RD) });
  const html = renderClient(v);
  const took = performance.now() - started;
  t.diagnostic(`built in ${Math.round(took)} ms over ${entries.length + 1} commits`);
  assert.ok(took < 3000, `took ${Math.round(took)} ms`);
  const items = v.plan.steps.flatMap(s => s.items);
  assert.equal(items.length, M * N, 'every removed record comes back');
  assert.ok(items.every(i => i.state === 'done' && i.doneAt), 'and every part has its date');
  // Each part's Done commit is the second of its two, after the ten creation commits: minute 10 + 2k + 1.
  const doneAt = k => new Date(Date.parse('2026-01-02T00:00:00Z') + 60000 * (M + 2 * k + 1)).toISOString().replace('.000Z', 'Z');
  assert.equal(items.find(i => i.title === `Part ${tid(1, 1)}`).doneAt, doneAt(0));
  assert.deepEqual(v.recent.map(p => [p.title, p.date]), [5, 4, 3, 2, 1].map(k => [`Part ${tid(M, N - 5 + k)}`, doneAt(M * N - 6 + k)]));
  assert.match(html, /Part T-0101/);
});

test('a part merged by a merge commit is dated when it reached the trusted branch', t => {
  const r = standard(t);
  r.commit('plan', '2026-09-01T09:00:00Z');
  r.git(['switch', '-q', '-c', 'side']);
  r.task('T-0003', 'Done', 'M-0002', 'Pay by card');
  r.commit('T-0003 done on its branch', '2026-09-05T09:00:00Z');
  r.git(['switch', '-q', 'main']);
  r.write('README.md', 'other work\n');
  r.commit('other work', '2026-09-06T09:00:00Z');
  r.git(['merge', '-q', '--no-ff', '-m', 'merge T-0003', 'side'], '2026-09-08T09:00:00Z');
  const v = view(r, { source: gitSource(r.dir, 'main'), history: gitHistory(r.dir, 'main', RD) });
  assert.equal(part(v, 'Pay by card').doneAt, '2026-09-08T09:00:00Z', 'the merge, not the commit on the side branch');
});

test('a record reads Done by its front matter, as the records are read', t => {
  const r = standard(t);
  r.commit('plan', '2026-09-01T09:00:00Z');
  r.write(`${RD}/tasks/T-0003.md`, r.taskText('T-0003', 'Ready', 'M-0002', 'Pay by card').replace('status: Ready', 'status:  Done'));
  r.commit('T-0003 done, with two spaces', '2026-09-03T09:00:00Z');
  const history = gitHistory(r.dir, 'main', RD);
  assert.equal(history.doneDate('T-0003'), '2026-09-03T09:00:00Z');
  assert.equal(history.doneDate('T-0004'), null, 'never Done');
  assert.equal(history.lastVersion('T-0003'), null, 'never removed');
  assert.equal(history.doneDate('../T-0003'), null, 'only a task ID is looked up');
  const none = gitHistory(r.dir, 'no-such-branch', RD);
  assert.deepEqual([none.doneDate('T-0003'), none.lastVersion('T-0003')], [null, null], 'a revision Git cannot read answers nothing, and throws nothing');
});

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

test('a branch cannot move a part by a record it did not change', t => {
  const r = standard(t);
  r.task('T-0003', 'Active', 'M-0002', 'Pay by card');
  r.commit('plan', '2026-10-01T09:00:00Z');
  // The branch forks while T-0003 is Active and leaves it alone, so its copy goes stale when the trusted branch moves on.
  branch(r, 'claude/T-0004-email', '2026-10-11T09:00:00Z', () => r.task('T-0004', 'Active', 'M-0002', 'Email the receipt'));
  r.task('T-0003', 'Blocked', 'M-0002', 'Pay by card');
  r.commit('T-0003 blocked', '2026-10-11T10:00:00Z');
  const { v } = live(r);
  assert.equal(part(v, 'Pay by card').state, 'hold', 'the untouched copy on the branch (Active) does not override the trusted branch');
  assert.equal(part(v, 'Email the receipt').state, 'active');
});

test('a branch record with a status or an id of the wrong kind is ignored', t => {
  const r = standard(t);
  r.commit('plan', '2026-10-01T09:00:00Z');
  branch(r, 'claude/T-0003-odd', '2026-10-11T09:00:00Z', () => {
    r.task('T-0003', 'constructor', 'M-0002', 'Pay by card'); // an Object.prototype name is not a status
    r.task('T-0005', 'toString', 'M-0002', 'Gift wrap');
    r.write(`${RD}/tasks/T-0007.md`, '---\nrecord: task\nid: [T-0007]\ntitle: Odd\nstatus: Active\nmilestone: M-0002\n---\n# T-0007\n');
  });
  const { v } = live(r);
  assert.equal(part(v, 'Pay by card').state, 'next', 'the trusted Ready state stands');
  assert.equal(part(v, 'Gift wrap'), undefined);
  assert.equal(part(v, 'Odd'), undefined, 'an id that is not a task ID adds nothing and does not break the build');
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
  assert.match(renderClient(v), /<bdi>Gift wrap<\/bdi> <span class="tag">added along the way<\/span><\/span><span class="state">In progress<\/span>/, 'the page marks it added');
  assert.equal(part(v, 'Unknown milestone'), undefined, 'a part of a milestone the trusted branch lacks is ignored');
  assert.deepEqual(v.plan.phases.map(p => p.title), ['Foundations', 'Ordering']);
  assert.equal(v.stages.find(s => s.id === 'M-0002').title, 'Online ordering');
});

test('a branch cannot add a part to a finished milestone, or move one of its parts', t => {
  const r = standard(t);
  r.task('T-0008', 'Ready', 'M-0001', 'Print the menu'); // a record the acceptance left behind
  r.commit('plan', '2026-10-01T09:00:00Z');
  branch(r, 'claude/T-0009-late', '2026-10-11T09:00:00Z', () => {
    r.task('T-0009', 'Active', 'M-0001', 'Gift wrap');
    r.task('T-0008', 'Active', 'M-0001', 'Print the menu, again');
  });
  const { v } = live(r);
  assert.equal(part(v, 'Gift wrap'), undefined, 'a signed-off milestone gains no part from a branch');
  assert.equal(part(v, 'Print the menu, again'), undefined, 'nor new wording');
  assert.deepEqual(v.plan.steps[1].items.map(i => [i.title, i.state]), [['Put the menu online', 'done'], ['Print the menu', 'done']]);
  assert.equal(v.plan.steps[1].state, 'done');
});

test('a branch tip dated in the future counts as now, so the page is never updated later than it was built', t => {
  const r = standard(t);
  r.commit('plan', '2026-10-01T09:00:00Z');
  branch(r, 'claude/T-0003-ahead', '2027-01-01T09:00:00Z', () => r.task('T-0003', 'Blocked', 'M-0002', 'Pay by card'));
  branch(r, 'claude/T-0003-today', '2026-10-11T11:00:00Z', () => r.task('T-0003', 'Active', 'M-0002', 'Pay by card'));
  const { v, reading } = live(r);
  assert.equal(reading.newest, '2026-10-11T12:00:00.000Z', 'the reading\'s own time, not 2027');
  assert.equal(v.updated, '2026-10-11T12:00:00.000Z');
  assert.equal(part(v, 'Pay by card').state, 'hold', 'clamped to now, the future tip is still the newer of the two');
});

test('an old branch without a pull request is ignored, and a reading failure falls back with a warning', t => {
  const r = standard(t);
  r.commit('plan', '2026-10-01T09:00:00Z');
  branch(r, 'claude/T-0003-stale', '2026-09-20T09:00:00Z', () => r.task('T-0003', 'Active', 'M-0002', 'Pay by card'));
  let { v } = live(r);
  assert.equal(part(v, 'Pay by card').state, 'next', 'older than 14 days and no pull request');
  ({ v } = live(r, { pullRequests: [{ headRefName: 'claude/T-0003-stale', isDraft: false, isCrossRepository: false }] }));
  assert.equal(part(v, 'Pay by card').state, 'checking', 'an open pull request keeps an old branch in view');
  // Outside the fixture: Git finds the enclosing repository for a missing directory inside one.
  const broken = readBranches({ repo: path.join(os.tmpdir(), 'wf-plan-no-such-dir'), base: 'main', trustedBranch: 'main', recordsDir: RD });
  assert.equal(broken.parts.size, 0);
  assert.match(broken.warnings.join('\n'), /live reading skipped/);
});

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

test('the Arabic plan page holds no ID, branch, person or team wording either', t => {
  const r = standard(t, { client: { plan: 'docs/client-page/plan.json', language: 'ar' } });
  r.commit('plan', '2026-10-01T09:00:00Z');
  r.write(`${RD}/decisions/D-0009.md`, '---\nrecord: decision\nid: D-0009\nquestion: Which card provider?\nclient_question: أي جهاز دفع تستخدمون؟\ntype: decision\nowner: alice-owner\naffects: [M-0002]\nrequired_before: implement\nstatus: Open\n---\n# D-0009\n');
  r.commit('decision', '2026-10-02T09:00:00Z');
  branch(r, 'claude/T-0003-pay', '2026-10-11T11:00:00Z', () => r.task('T-0003', 'Active', 'M-0002', 'Pay by card'));
  branch(r, 'claude/T-0005-wrap', '2026-10-11T11:30:00Z', () => r.task('T-0005', 'Active', 'M-0002', 'Gift wrap'));
  const { v } = live(r, { pullRequests: [{ headRefName: 'claude/T-0003-pay', number: 41, isDraft: false, isCrossRepository: false }] });
  const html = renderClient(v);
  assert.match(html, /<html lang="ar" dir="rtl">/);
  assert.match(html, /<bdi>Pay by card<\/bdi>[\s\S]*قيد المراجعة/, 'the part is being checked');
  assert.match(html, /<bdi>Gift wrap<\/bdi> <span class="tag">أُضيف أثناء العمل<\/span>/, 'the branch-only part is marked added');
  assert.match(html, /بانتظارك[\s\S]*أي جهاز دفع تستخدمون؟/);
  for (const absent of ['T-000', 'M-000', 'D-0009', 'claude/', 'bob-worker', 'alice-owner', 'internal title', 'waiting on D-0009', 'Which card provider', '#41', 'T-0003-pay']) assert.ok(!html.includes(absent), absent);
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

test('a plan with no steps to show renders without throwing', t => {
  const r = standard(t, { client: { plan: 'docs/client-page/plan.json', exclude: ['M-0001', 'M-0002', 'M-0003'] } });
  r.plan({ phases: [{ title: 'All', steps: [{ title: 'Everything', milestones: ['M-0001', 'M-0002', 'M-0003'] }] }] });
  const v = view(r);
  assert.equal(v.plan.steps.length, 0);
  assert.doesNotThrow(() => renderClient(v));
  assert.match(renderClient(v), /<h1>The project is being planned\.<\/h1>/);
});

test('a plan page under a brand band shows the title once, in the band', t => {
  const r = standard(t, { client: { plan: 'docs/client-page/plan.json', theme: { colors: { brand: '#174A7C', on_brand: '#FFFFFF' } } } });
  const html = renderClient(view(r));
  assert.match(html, /<div class="band"><div class="inner"><p>shop<\/p><\/div><\/div>/);
  assert.doesNotMatch(html, /<p class="project">/);
  assert.equal(html.split('<p>shop</p>').length - 1, 1, 'the title appears once');
});

test('a plan page without a band shows the project name, and the logo when the theme has one', t => {
  const r = standard(t, { client: { plan: 'docs/client-page/plan.json', theme: { logo: 'docs/client-page/logo.svg' } } });
  r.write('docs/client-page/logo.svg', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"><rect width="4" height="4"/></svg>');
  const html = renderClient(view(r));
  assert.match(html, /<img class="logo" src="data:image\/svg\+xml[^"]*" alt="shop">\s*<p class="project">shop<\/p>/);
});

// The headline and the Now panel of a rendered plan page, as text with the markup kept.
const top = html => ({ h1: html.match(/<h1>([\s\S]*?)<\/h1>/)[1], now: html.match(/<section class="panel now"[\s\S]*?<\/section>/)[0] });

test('Now and the headline name what is in progress, in every state a step can be in', t => {
  // A part moving: the part, with its step.
  let r = standard(t);
  r.task('T-0003', 'Active', 'M-0002', 'Pay by card');
  let { h1, now } = top(renderClient(view(r)));
  assert.equal(h1, 'Now working on ordering a cake.');
  assert.match(now, /<li class="item active">[\s\S]*<bdi>Pay by card<\/bdi> <span class="where">in <bdi>Ordering a cake<\/bdi><\/span>[\s\S]*In progress/);

  // The step in progress with no part moving, and a part up next: that part, with its step, not the following step.
  r = standard(t);
  ({ h1, now } = top(renderClient(view(r))));
  assert.equal(h1, 'Now working on ordering a cake.');
  assert.match(now, /<li class="item next">[\s\S]*<bdi>Pay by card<\/bdi> <span class="where">in <bdi>Ordering a cake<\/bdi><\/span>[\s\S]*Up next/);
  assert.doesNotMatch(now, /Deliveries/);

  // Nothing up next: the step itself.
  r.task('T-0003', 'Draft', 'M-0002', 'Pay by card');
  ({ now } = top(renderClient(view(r))));
  assert.match(now, /<li class="item active">[\s\S]*<span class="name"><bdi>Ordering a cake<\/bdi><\/span><span class="state">In progress<\/span>/);
  assert.doesNotMatch(now, /Deliveries|Starting next/);

  // A paused milestone: paused, in the headline and in Now.
  r.task('T-0003', 'Blocked', 'M-0002', 'Pay by card');
  r.milestone('M-0002', 'Blocked', 'Online ordering', ['T-0002', 'T-0003', 'T-0004']);
  ({ h1, now } = top(renderClient(view(r))));
  assert.equal(h1, '<bdi>Ordering a cake</bdi> is paused for now.');
  assert.match(now, /<li class="item hold">[\s\S]*<bdi>Ordering a cake<\/bdi> is paused for now\./);
  assert.doesNotMatch(h1 + now, /working on|Deliveries/);

  // Built and checked: the step is in progress, waiting for sign-off.
  r = standard(t);
  for (const id of ['T-0003', 'T-0004']) r.task(id, 'Done', 'M-0002', id === 'T-0003' ? 'Pay by card' : 'Email the receipt');
  r.milestone('M-0002', 'Verified', 'Online ordering', ['T-0002', 'T-0003', 'T-0004']);
  r.milestone('M-0003', 'Verified', 'Daily orders', []);
  const v = view(r);
  assert.equal(v.plan.steps[2].state, 'active');
  ({ h1, now } = top(renderClient(v)));
  assert.equal(h1, '<bdi>Ordering a cake</bdi>: built and checked, and waiting for sign-off.');
  assert.match(now, /<bdi>Ordering a cake<\/bdi>: built and checked, and waiting for sign-off\./);
  assert.doesNotMatch(now, /Deliveries/);
});

test('every step in progress is open and in Now; the last step in progress is not "every step is done"', t => {
  const r = standard(t);
  r.milestone('M-0003', 'Active', 'Daily orders', ['T-0005']);
  r.task('T-0005', 'Active', 'M-0003', 'List the day\'s orders');
  r.task('T-0003', 'Active', 'M-0002', 'Pay by card');
  r.plan({ phases: [{ title: 'All', steps: [{ title: 'Menu', milestones: ['M-0001'] }, { title: 'Ordering', milestones: ['M-0002'] }, { title: 'Daily orders', milestones: ['M-0003'] }] }] });
  let html = renderClient(view(r));
  const { now } = top(html);
  assert.match(now, /Pay by card[\s\S]*in <bdi>Ordering<\/bdi>[\s\S]*List the day&#39;s orders[\s\S]*in <bdi>Daily orders<\/bdi>/);
  assert.match(html, /<li class="step active current">[\s\S]*<h4><bdi>Ordering<\/bdi><\/h4>[\s\S]*?<ul class="items"/);
  assert.match(html, /<li class="step active"><span class="marker"[^>]*><\/span><div class="body">[\s\S]*<h4><bdi>Daily orders<\/bdi><\/h4>(?:(?!<li class="step)[\s\S])*?<\/div><ul class="items" role="list">/, 'the second step in progress lists its parts open, not in a disclosure');
  assert.doesNotMatch(html, /<details class="more"><summary>Its parts/);
  // The last step in progress with nothing moving: it is named, and the page never says every step is done.
  r.task('T-0003', 'Done', 'M-0002', 'Pay by card');
  r.task('T-0004', 'Done', 'M-0002', 'Email the receipt');
  r.milestone('M-0002', 'Accepted', 'Online ordering', ['T-0002', 'T-0003', 'T-0004']);
  r.task('T-0005', 'Draft', 'M-0003', 'List the day\'s orders');
  html = renderClient(view(r));
  assert.doesNotMatch(html, /Every step is done/);
  assert.equal(top(html).h1, 'Now working on daily orders.');
  assert.match(top(html).now, /<bdi>Daily orders<\/bdi><\/span><span class="state">In progress/);
});

test('a plan with no steps is being planned, and detail "stages" names the steps in progress', t => {
  const r = standard(t, { client: { plan: 'docs/client-page/plan.json', exclude: ['M-0001', 'M-0002', 'M-0003'] } });
  r.plan({ phases: [{ title: 'All', steps: [{ title: 'Everything', milestones: ['M-0001', 'M-0002', 'M-0003'] }] }] });
  let { h1, now } = top(renderClient(view(r)));
  assert.equal(h1, 'The project is being planned.');
  assert.match(now, /The project is being planned\./);
  const s = standard(t, { client: { plan: 'docs/client-page/plan.json', detail: 'stages' } });
  s.task('T-0003', 'Active', 'M-0002', 'Pay by card');
  ({ h1, now } = top(renderClient(view(s))));
  assert.equal(h1, 'Now working on ordering a cake.');
  assert.match(now, /<bdi>Ordering a cake<\/bdi><\/span><span class="state">In progress/);
  assert.doesNotMatch(now, /Pay by card|Deliveries|Starting next/);
});

test('the step that starts next keeps its own direction, and a title cannot inject replacement patterns', t => {
  const r = standard(t);
  r.milestone('M-0002', 'Authorised', 'Online ordering', ['T-0002', 'T-0003', 'T-0004']);
  r.plan({ phases: [{ title: 'All', steps: [{ title: 'Menu', milestones: ['M-0001'] }, { title: '2 cakes $& more', milestones: ['M-0002', 'M-0003'] }] }] });
  const { h1, now } = top(renderClient(view(r)));
  assert.equal(h1, 'Next: <bdi>2 cakes $&amp; more</bdi>.');
  assert.match(now, /<p>Starting next: <bdi>2 cakes \$&amp; more<\/bdi><\/p>/);
});

test('Now lists the parts in progress before the parts being checked', t => {
  const r = standard(t);
  r.commit('plan', '2026-10-01T09:00:00Z');
  branch(r, 'claude/T-0003-pay', '2026-10-11T11:00:00Z', () => r.task('T-0003', 'Active', 'M-0002', 'Pay by card'));
  branch(r, 'claude/T-0004-receipt', '2026-10-11T11:30:00Z', () => r.task('T-0004', 'Active', 'M-0002', 'Email the receipt'));
  const { v } = live(r, { pullRequests: [{ headRefName: 'claude/T-0003-pay', isDraft: false, isCrossRepository: false }] });
  assert.deepEqual([part(v, 'Pay by card').state, part(v, 'Email the receipt').state], ['checking', 'active']);
  const now = renderClient(v).match(/<section class="panel now"[\s\S]*?<\/section>/)[0];
  assert.ok(now.indexOf('Email the receipt') > 0 && now.indexOf('Email the receipt') < now.indexOf('Pay by card'), 'in progress first, then being checked');
});

test('the plan draws its timeline, and only a step with no milestones says its parts are not planned yet', t => {
  const r = standard(t, { client: { plan: 'docs/client-page/plan.json', detail: 'stages' } });
  const html = renderClient(view(r));
  assert.equal(html.split('Its parts are planned when we reach it.').length - 1, 1, 'only Deliveries, which names no milestone');
  assert.match(html, /ol\.steps::before[^}]*inset-inline-start/);
  assert.doesNotMatch(html.match(/<style>[\s\S]*<\/style>/)[0].match(/ol\.steps[^{]*\{[^}]*\}/g).join(''), /\bleft:|\bright:/);
  assert.match(html, /\.panel\.now \.item \{ grid-template-columns: 1\.25rem minmax\(0, 1fr\) auto/);
});

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

test('the client page workflow rebuilds on any push and deploys only from the trusted branch', () => {
  const yml = fs.readFileSync(path.join(root, 'templates/github/wf-client-page.yml'), 'utf8');
  assert.match(yml, /push:\n\s+branches: \['\*\*'\]/);
  assert.match(yml, /pull_request:\n\s+types: \[opened, reopened, ready_for_review, converted_to_draft, closed\]/);
  assert.match(yml, /schedule:/);
  assert.match(yml, /gh workflow run wf-client-page\.yml --ref __TRUSTED_BRANCH__/);
  assert.match(yml, /if: github\.ref != 'refs\/heads\/__TRUSTED_BRANCH__' && \(github\.event_name != 'pull_request' \|\| !github\.event\.pull_request\.head\.repo\.fork\) && github\.actor != 'dependabot\[bot\]'/);
  assert.match(yml, /cancel-in-progress: \$\{\{ github\.ref != 'refs\/heads\/__TRUSTED_BRANCH__' \}\}/, 'a running trusted build is not cancelled');
  assert.doesNotMatch(yml, /cancel-in-progress: true/);
  assert.match(yml, /if: github\.ref == 'refs\/heads\/__TRUSTED_BRANCH__'/);
  assert.match(yml, /fetch-depth: 0/);
  assert.match(yml, /scripts\/wf status --client --live --candidate "\$GITHUB_SHA" --pull-requests "\$RUNNER_TEMP\/pull-requests\.json"/);
  assert.doesNotMatch(yml, /uses: [^@\n]+@(?![0-9a-f]{40}\b)/, 'actions pinned by commit');
});
