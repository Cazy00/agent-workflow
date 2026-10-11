import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirSource, gitSource, loadConfig } from '../lib/index.js';
import { loadPlan } from '../lib/client-plan.js';
import { evaluateClient } from '../lib/client.js';

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
