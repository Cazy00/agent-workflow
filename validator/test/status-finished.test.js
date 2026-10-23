import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirSource, gitSource } from '../lib/index.js';
import { gitHistory } from '../lib/client-history.js';
import { evaluateStatus, releasesNothing, renderStatus } from '../lib/status.js';

// v2.11.1: the status issue after an acceptance. `wf prune` removes the accepted milestone's Done task records, so its
// tasks come back from Git history, as the client page reads them; and "release authority is next" waits for the owner
// only when the milestone has something to release.
const root = fileURLToPath(new URL('../..', import.meta.url));
const cli = path.join(root, 'validator/cli.js');
const RD = 'docs/workflow';

// A project in a temporary Git repository on `main`.
function project(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-finished-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const date = '2026-10-20T10:00:00Z';
  const git = (...args) => {
    const r = spawnSync('git', ['-C', dir, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
  const config = JSON.parse(fs.readFileSync(path.join(root, 'config.default.json'), 'utf8'));
  write(`${RD}/config.json`, JSON.stringify({ ...config, repository: 'acme/shop' }));
  write(`${RD}/profile.md`, '---\nrecord: profile\nproject: shop\nworkflow_version: v1\napproval_mechanism: manual-signed-receipts\napproval_label: manual\ncoordinator: alice-owner\nmeasure: A customer can order a cake online.\nreadiness: Ready\nrequired_checks: [test]\nsetup_budget_days: 2\n---\n# Profile\n');
  const milestone = (id, status, { tasks = [], releaseAuthority = 'Reserved to the owner.' } = {}) => write(`${RD}/milestones/${id}.md`, `---\nrecord: milestone\nid: ${id}\noutcome: ${id} works.\nstatus: ${status}\ncoordinator: agent\nowner: alice-owner\nscope: [src]\ngoverning: [PROFILE]\nacceptance: [AC-001-1]\nauthority: owner\nlimits: x\ndemonstration: x\nstop_conditions: x\nrelease_authority: ${releaseAuthority}\ntasks: [${tasks.join(', ')}]\n---\n# ${id}\n`);
  const task = (id, status, milestoneId, title = `Task ${id}`, extra = '') => write(`${RD}/tasks/${id}.md`, `---\nrecord: task\nid: ${id}\ntitle: ${title}\nstatus: ${status}\nmilestone: ${milestoneId}\nowner: bob-worker\nscope: [src]\ngoverning: [PROFILE]\nacceptance: [AC-001-1]\nbranch: claude/${id}-work\n${extra}---\n# ${id}\n`);
  const remove = id => fs.rmSync(path.join(dir, `${RD}/tasks/${id}.md`));
  const commit = message => { git('add', '-A'); git('commit', '-qm', message); };
  git('init', '-q', '-b', 'main');
  const view = (options = {}) => evaluateStatus({ baseline: gitSource(dir, 'main'), candidate: gitSource(dir, 'main'), history: gitHistory(dir, 'main', RD), ...options });
  return { dir, git, write, milestone, task, remove, commit, view };
}

// Two planned tasks and one found after authorisation, all Done, then accepted and pruned, as headless-lightroom's M-0001 was.
function pruned(t, options = {}) {
  const p = project(t);
  p.milestone('M-0001', 'Active', { tasks: ['T-0001', 'T-0002'], ...options });
  p.task('T-0001', 'Done', 'M-0001', 'Put the menu online');
  p.task('T-0002', 'Done', 'M-0001', 'Show prices');
  p.task('T-0003', 'Done', 'M-0001', 'Fix the review finding');
  p.commit('the milestone is done');
  p.milestone('M-0001', 'Accepted', { tasks: ['T-0001', 'T-0002'], ...options });
  p.commit('accept M-0001');
  for (const id of ['T-0001', 'T-0002', 'T-0003']) p.remove(id);
  p.commit('Prune M-0001');
  return p;
}

test('an accepted milestone whose task records were pruned shows its count from history, found tasks included', t => {
  const p = pruned(t);
  const s = p.view();
  const m = s.milestones.find(x => x.id === 'M-0001');
  assert.deepEqual(m.tasks.map(x => [x.id, x.status, x.discovered, x.recovered]), [['T-0001', 'Done', false, true], ['T-0002', 'Done', false, true], ['T-0003', 'Done', true, true]]);
  assert.deepEqual(m.plan, { planned: ['T-0001', 'T-0002'], discovered: ['T-0003'], uncovered: [], missing: [] });
  assert.deepEqual(s.waiting.filter(w => w.kind === 'plan'), [], 'an accepted milestone raises no plan items');
  assert.deepEqual(s.record_errors, []);
  const text = renderStatus(s);
  assert.match(text, /^## 🎯 M-0001 · Accepted\n/m);
  assert.match(text, /^\*\*Progress\*\* 🟩{10} \*\*3 of 3 done\*\* · planned 2 · discovered 1$/mu);
  assert.match(text, /^\| ✅ \| \*\*T-0003\*\* <sub>discovered<\/sub> \| Fix the review finding \| Done \| — \|$/m);
  assert.doesNotMatch(text, /0 of 0|No tasks yet/);
});

test('a record that is still kept is not counted twice, and a record of another milestone or one that was never Done is not recovered', t => {
  const p = project(t);
  p.milestone('M-0001', 'Active', { tasks: ['T-0001', 'T-0002'] });
  p.task('T-0001', 'Done', 'M-0001');
  p.task('T-0002', 'Done', 'M-0001');
  p.task('T-0004', 'Done', 'M-0002', 'Belongs to the next milestone');
  p.task('T-0005', 'Draft', 'M-0001', 'Dropped before it started');
  p.task('T-0006', 'Done', 'M-0001', 'A found task whose record stays');
  p.commit('work');
  p.milestone('M-0001', 'Accepted', { tasks: ['T-0001', 'T-0002'] });
  p.commit('accept');
  for (const id of ['T-0001', 'T-0004', 'T-0005']) p.remove(id);
  p.commit('prune');
  const m = p.view().milestones.find(x => x.id === 'M-0001');
  assert.deepEqual(m.tasks.map(x => [x.id, x.recovered ?? false]), [['T-0001', true], ['T-0002', false], ['T-0006', false]], 'T-0002 and T-0006 stay as their kept records; T-0004 and the never-Done T-0005 are not this milestone\'s finished work');
  assert.match(renderStatus(p.view()), /\*\*3 of 3 done\*\*/);
});

test('a planned task is recovered by the plan even when its last version names no milestone', t => {
  const p = project(t);
  p.milestone('M-0001', 'Active', { tasks: ['T-0001'] });
  p.write(`${RD}/tasks/T-0001.md`, '---\nrecord: task\nid: T-0001\ntitle: Planned work\nstatus: Done\nowner: bob-worker\nscope: [src]\ngoverning: [PROFILE]\nacceptance: [AC-001-1]\nbranch: claude/T-0001-work\n---\n# T-0001\n');
  p.commit('work');
  p.milestone('M-0001', 'Released', { tasks: ['T-0001'], releaseAuthority: 'Alice releases by hand.' });
  p.remove('T-0001');
  p.commit('release and prune');
  const text = renderStatus(p.view());
  assert.match(text, /^## 🎯 M-0001 · Released\n/m);
  assert.match(text, /\*\*1 of 1 done\*\*/);
});

test('a task the plan names comes back only as finished work of this milestone, counted once', t => {
  const p = project(t);
  p.milestone('M-0001', 'Active', { tasks: ['T-0001', 'T-0002', 'T-0003'] });
  p.milestone('M-0002', 'Active', { tasks: [] });
  p.task('T-0001', 'Done', 'M-0001', 'Finished here');
  p.task('T-0002', 'Draft', 'M-0001', 'Dropped before it started');
  p.task('T-0003', 'Done', 'M-0001', 'Moved to the next milestone');
  p.commit('work');
  p.task('T-0003', 'Done', 'M-0002', 'Moved to the next milestone');
  p.milestone('M-0001', 'Accepted', { tasks: ['T-0001', 'T-0002', 'T-0003'] });
  p.milestone('M-0002', 'Accepted', { tasks: [] });
  p.commit('accept both');
  for (const id of ['T-0001', 'T-0002', 'T-0003']) p.remove(id);
  p.commit('prune both');
  const s = p.view();
  const of = id => s.milestones.find(m => m.id === id).tasks.map(x => [x.id, x.status]);
  assert.deepEqual(of('M-0001'), [['T-0001', 'Done']], 'the dropped Draft and the moved task are not M-0001\'s finished work');
  assert.deepEqual(of('M-0002'), [['T-0003', 'Done']], 'the moved task is counted where its last record put it');
  const text = renderStatus(s);
  assert.match(text, /\*\*1 of 1 done\*\* · planned 3 · discovered 0$/m);
  assert.deepEqual(s.waiting.filter(w => w.kind === 'plan'), []);
});

test('the status workflow checks out the whole history, which the finished milestones are read from', () => {
  assert.match(fs.readFileSync(path.join(root, 'templates/github/wf-status.yml'), 'utf8'), /fetch-depth: 0/);
});

test('without history an accepted milestone says its records are gone, never "0 of 0 done"', t => {
  const p = pruned(t);
  for (const [label, s] of [['no history', p.view({ history: null })], ['a working-tree source', evaluateStatus({ baseline: dirSource(p.dir), history: null })]]) {
    const text = renderStatus(s);
    assert.match(text, /^\*\*Progress\*\* 🟩{10} \*\*Accepted\*\* · planned 2$/mu, label);
    assert.match(text, /^No task records are kept for an accepted milestone \(`wf prune` removes them\); the pull requests are the record\.$/m, label);
    assert.doesNotMatch(text, /0 of 0|No tasks yet/, label);
  }
  const shallow = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-finished-shallow-'));
  t.after(() => fs.rmSync(shallow, { recursive: true, force: true }));
  assert.equal(spawnSync('git', ['clone', '-q', '--depth', '1', `file://${p.dir}`, shallow]).status, 0);
  const shallowHistory = gitHistory(shallow, 'HEAD', RD);
  const text = renderStatus(evaluateStatus({ baseline: gitSource(shallow, 'HEAD'), candidate: gitSource(shallow, 'HEAD'), history: shallowHistory }));
  assert.match(text, /^No task records are kept for an accepted milestone \(`wf prune` removes them\); the pull requests are the record\.$/m, 'a shallow clone has nothing to read: the same message');
  assert.deepEqual(shallowHistory.warnings, [], 'and no warning');
});

test('a released milestone whose records are gone reads Released, with no release item', t => {
  const p = project(t);
  p.milestone('M-0001', 'Released', { tasks: ['T-0001'], releaseAuthority: 'Alice releases by hand.' });
  p.commit('released and pruned');
  const s = p.view({ history: null });
  assert.deepEqual(s.waiting.filter(w => w.kind === 'release'), []);
  assert.match(renderStatus(s), /^\*\*Progress\*\* 🟩{10} \*\*Released\*\* · planned 1$/mu);
});

test('a milestone that is not accepted yet ignores history, and an open one with no tasks still says so', t => {
  const p = project(t);
  p.milestone('M-0001', 'Authorised');
  p.commit('plan');
  const asked = [];
  const history = { lastVersion: id => { asked.push(id); return null; }, removedDone: m => { asked.push(m); return []; } };
  const text = renderStatus(p.view({ history }));
  assert.deepEqual(asked, [], 'history is read only for an accepted or released milestone');
  assert.match(text, /^No tasks yet\.$/m);
});

test('wf status reads history from a Git source, and says what is missing for the working tree', t => {
  const p = pruned(t);
  const run = (...args) => spawnSync(process.execPath, [cli, 'status', '--repo', p.dir, ...args], { encoding: 'utf8' });
  const git = run('--baseline', 'main', '--candidate', 'main');
  assert.equal(git.status, 0, git.stdout + git.stderr);
  assert.match(git.stdout, /\*\*3 of 3 done\*\* · planned 2 · discovered 1/);
  assert.equal(git.stderr, '');
  const json = JSON.parse(run('--baseline', 'main', '--candidate', 'main', '--json').stdout);
  assert.deepEqual(json.milestones[0].tasks.map(x => x.id), ['T-0001', 'T-0002', 'T-0003']);
  const tree = run();
  assert.equal(tree.status, 0, tree.stdout + tree.stderr);
  assert.match(tree.stdout, /No task records are kept/);
});

test('history Git cannot read leaves the milestone as without history, with one warning on standard error', t => {
  const p = pruned(t);
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-finished-not-a-repo-'));
  t.after(() => fs.rmSync(elsewhere, { recursive: true, force: true }));
  const history = gitHistory(elsewhere, 'main', RD);
  const text = renderStatus(p.view({ history }));
  assert.equal(history.warnings.length, 1);
  assert.match(history.warnings[0], /history could not be read from Git/);
  assert.match(text, /No task records are kept/);
});

test('an accepted milestone that declares nothing to release raises no release item', t => {
  for (const declared of [
    'None. Staging holds invented data only; production deployment is not part of this milestone.',
    'Reserved to the owner. Nothing is deployed; accepting the milestone ends it.',
    'none',
    'Nothing is released.',
    'Owner approves the pull request; nothing to deploy.',
  ]) {
    const p = pruned(t, { releaseAuthority: declared });
    const s = p.view();
    assert.deepEqual(s.waiting.filter(w => w.kind === 'release'), [], declared);
    assert.doesNotMatch(renderStatus(s), /release authority is next/, declared);
  }
});

test('an accepted milestone with something to release still waits for the owner\'s release authority', t => {
  for (const declared of [
    'Reserved to the owner.',
    'Cazy00, by approving each pull request into main, and by releasing the database change by hand',
    'Cazy00 releases it by hand; nothing is deployed by the agent',
    'Cazy00 releases it by hand after acceptance; until then nothing is released.',
    'Nothing is deployed, except the database migration Cazy00 runs by hand.',
    'Before acceptance nothing is deployed.',
    'None, except the database migration Cazy00 runs by hand.',
    'None of the staging checks replace the owner\'s release.',
    'No deployment without the owner\'s approval.',
    '',
  ]) {
    const p = pruned(t, { releaseAuthority: declared });
    const s = p.view();
    const item = s.waiting.filter(w => w.kind === 'release');
    assert.deepEqual(item.map(w => [w.item, w.owner, w.detail]), [['M-0001', 'alice-owner', 'milestone accepted; release authority is next']], JSON.stringify(declared));
    assert.match(renderStatus(s), /\*\*M-0001\*\* \(alice-owner\): milestone accepted; release authority is next/, declared);
  }
});

test('a milestone that is verified still waits for acceptance, and a released one has no release item', t => {
  const p = project(t);
  p.milestone('M-0001', 'Verified', { releaseAuthority: 'None.' });
  p.milestone('M-0002', 'Released', { releaseAuthority: 'Reserved to the owner.' });
  p.commit('records');
  const waiting = p.view().waiting.filter(w => ['acceptance', 'release'].includes(w.kind));
  assert.deepEqual(waiting.map(w => [w.kind, w.item]), [['acceptance', 'M-0001']]);
});

test('releasesNothing reads the milestone\'s release_authority', () => {
  for (const yes of ['None', 'None.', ' none; staging only', 'None — nothing ships', 'Nothing is deployed', 'nothing will be released.', 'Reserved to the owner. Nothing is deployed; accepting the milestone ends it.', 'Nothing to release; the tool runs on the home server']) assert.equal(releasesNothing(yes), true, yes);
  for (const no of [undefined, null, '', 'Reserved to the owner.', 'None of it ships without the owner', 'Nothing is deployed by the agent', 'No release before the owner signs', 'Production deploys from main', 'Cazy00 releases it by hand after acceptance; until then nothing is released.', 'Nothing is deployed, except the database migration Cazy00 runs by hand.', 'Before acceptance nothing is deployed.', 'None, except the migration']) assert.equal(releasesNothing(no), false, String(no));
});
