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
import { evaluateClient } from '../lib/client.js';
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
  // Outside the fixture: Git finds the enclosing repository for a missing directory inside one.
  const broken = readBranches({ repo: path.join(os.tmpdir(), 'wf-plan-no-such-dir'), base: 'main', trustedBranch: 'main', recordsDir: RD });
  assert.equal(broken.parts.size, 0);
  assert.match(broken.warnings.join('\n'), /live reading skipped/);
});
