import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { gitSource } from '../lib/index.js';
import { acceptanceEvidenceErrors } from '../lib/acceptance-evidence.js';
import { evidence, fixture, project, taskPath } from './helpers/maint-0018.js';

// MAINT-0026: under approval.defer_to_acceptance, a change that only appends task ids to an Authorised or Active milestone's
// tasks: is the agent's merge, and the owner approves those tasks at the milestone's acceptance, where they are listed. Before,
// the owner's merge of the milestone record was the approval (MAINT-0024), a second answer inside the milestone.
const milestonePath = 'docs/workflow/milestones/M-0001.md';
const governing = c => ({ ...c, paths: { ...c.paths, governing: [...c.paths.governing, 'docs/workflow/milestones/**'] } });
const deferring = c => governing({ ...c, approval: { ...c.approval, defer_to_acceptance: true } });
const plan = (...ids) => q => q.edit(milestonePath, x => x.replace('status: Authorised\n', `status: Authorised\ntasks: [${ids.join(', ')}]\n`));
const taskLike = (p, id, scope, edit = x => x) => p.write(`docs/workflow/tasks/${id}.md`, edit(fs.readFileSync(path.join(p.repo, taskPath), 'utf8').replaceAll('T-0001', id).replace(/^scope: .*$/m, `scope: [${scope}]`)));
const append = x => x.replace(/^tasks: \[(.*)\]$/m, (_, ids) => `tasks: [${ids}, T-0002]`);

// A project whose M-0001 plans `planned`, with T-0002 waiting as a found Draft with no found_from.
function found(t, { configEdit = deferring, planned = ['T-0001'], baselineEdit = () => {} } = {}) {
  const p = project(t, { configEdit, baselineEdit: q => { plan(...planned)(q); baselineEdit(q); } });
  taskLike(p, 'T-0002', 'src/b', x => x.replace('status: Ready', 'status: Draft'));
  for (const id of planned.filter(i => i !== 'T-0001')) taskLike(p, id, 'src/c', x => x.replace('status: Ready', 'status: Draft'));
  return { ...p, base: p.commit('records: T-0002, found, with no found_from') };
}
// The pull request carrying T-0002's work and `edit` of M-0001's record.
const change = (p, edit = append) => {
  p.edit(milestonePath, edit);
  p.edit('docs/workflow/tasks/T-0002.md', x => x.replace('status: Draft', 'status: Active'));
  p.write('src/b/index.js', 'export const b = 1;\n');
  return p.commit('T-0002: the fix, and M-0001 names it');
};
const ci = (p, head) => {
  const e = evidence(head); e.tasks = ['T-0002']; e.review.tasks = ['T-0002'];
  const r = p.run(['ci', '--baseline', p.base, '--candidate', head, '--task', 'T-0002'], { evidence: e });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return r.out;
};
const entry = /adds tasks to M-0001's tasks: list, for the owner to approve at the milestone's acceptance: T-0002/;

test('MAINT-0026: appending a task to tasks: is the agent\'s merge, listed as deferred for the acceptance', t => {
  const p = found(t);
  const out = ci(p, change(p));
  assert.equal(out.merge, 'agent', JSON.stringify(out.owner_reasons));
  assert.deepEqual(out.owner_reasons, []);
  assert.ok(out.deferred.some(d => entry.test(d)), JSON.stringify(out.deferred));
  assert.ok(!out.findings.some(f => /governing paths changed|governing-change/.test(f)), out.findings.join(' | '));
  assert.ok(out.findings.some(f => /readiness T-0002: Ready/.test(f)), out.findings.join(' | '));
});

test('MAINT-0026: readiness says the owner approves the task at the milestone\'s acceptance', t => {
  const p = found(t);
  const head = change(p);
  const ready = p.run(['readiness', '--baseline', p.base, '--candidate', head, '--task', 'T-0002']).out;
  assert.equal(ready.outcome, 'Ready', ready.reasons.join(' | '));
  assert.ok(ready.pending.some(x => /T-0002 is added to M-0001's tasks: in this change, so it is planned; the owner approves it at M-0001's acceptance, where it is listed/.test(x)), ready.pending.join(' | '));
  // Beyond the tasks-only change, the old note stands.
  const q = found(t);
  const other = change(q, x => append(x).replace('outcome: ', 'outcome: Now '));
  const note = q.run(['readiness', '--baseline', q.base, '--candidate', other, '--task', 'T-0002']).out.pending;
  assert.ok(note.some(x => /planned once the owner approves the milestone record/.test(x)), note.join(' | '));
});

// Each stays the owner's: the change is more than an append of task ids, or not on a milestone the plan can still grow.
const staysOwner = {
  'a status change': x => append(x).replace('status: Authorised', 'status: Active'),
  'a scope change': x => append(x).replace('scope: [src, docs/workflow/tasks]', 'scope: [src, docs/workflow/tasks, ops]'),
  'a body change': x => append(x).replace('# Fixture milestone', '# Fixture milestone\nA new exclusion.'),
  'a limits change': x => append(x).replace('limits: ', 'limits: two sessions, '),
  'a found_tasks change': x => append(x).replace('tasks: [T-0001, T-0002]', 'tasks: [T-0001, T-0002]\nfound_tasks: 3'),
  'a comment in the front matter': x => append(x).replace('authority:', '# a note\nauthority:'),
  'a layout change': x => append(x).replace('limits: one', 'limits:   one'),
  'a tasks: line that swallows a comment': x => x.replace(/^tasks: \[(.*)\]$/m, 'tasks: [T-0001, T-0002, # and the lines below]'),
  'a tasks: line that never closes its list': x => x.replace(/^tasks: \[(.*)\]$/m, 'tasks: [T-0001, T-0002'),
  'a non-id entry': x => x.replace(/^tasks: \[(.*)\]$/m, 'tasks: [T-0001, T-0002, release notes]'),
  'a quoted entry': x => x.replace(/^tasks: \[(.*)\]$/m, 'tasks: [T-0001, "T-0002"]'),
  'a duplicate entry': x => x.replace(/^tasks: \[(.*)\]$/m, 'tasks: [T-0001, T-0002, T-0002]'),
};
for (const [name, edit] of Object.entries(staysOwner)) {
  test(`MAINT-0026: ${name} stays the owner's`, t => {
    const p = found(t);
    p.edit(milestonePath, edit);
    p.edit('docs/workflow/tasks/T-0002.md', x => x.replace('status: Draft', 'status: Active'));
    p.write('src/b/index.js', 'export const b = 1;\n');
    const head = p.commit('T-0002 and a milestone change');
    const e = evidence(head); e.tasks = ['T-0002']; e.review.tasks = ['T-0002'];
    const r = p.run(['ci', '--baseline', p.base, '--candidate', head, '--task', 'T-0002'], { evidence: e });
    // Either the owner merges it, or the records check refuses the record (a list that does not parse): never the agent.
    assert.notEqual(r.out?.merge, 'agent', r.stdout);
    assert.ok(r.out?.merge === 'owner' || r.status !== 0, r.stdout);
    assert.ok(!(r.out?.deferred ?? []).some(d => entry.test(d)), JSON.stringify(r.out?.deferred));
  });
}

test('MAINT-0026: reordering or dropping a planned task stays the owner\'s', t => {
  for (const edit of [x => x.replace('tasks: [T-0001, T-0003]', 'tasks: [T-0003, T-0001, T-0002]'), x => x.replace('tasks: [T-0001, T-0003]', 'tasks: [T-0001, T-0002]')]) {
    const p = found(t, { planned: ['T-0001', 'T-0003'] });
    const out = ci(p, change(p, edit));
    assert.equal(out.merge, 'owner');
    assert.ok(out.owner_reasons.some(r => /it changes the plan or requirements: docs\/workflow\/milestones\/M-0001\.md/.test(r)), JSON.stringify(out.owner_reasons));
    assert.ok(!(out.deferred ?? []).some(d => entry.test(d)), JSON.stringify(out.deferred));
  }
});

test('MAINT-0026: an added id with another milestone\'s task record, or none, stays the owner\'s', t => {
  const p = found(t, { baselineEdit: q => q.write('docs/workflow/milestones/M-0002.md', fs.readFileSync(path.join(fixture, milestonePath), 'utf8').replaceAll('M-0001', 'M-0002').replace('status: Authorised', 'status: Draft')) });
  p.edit('docs/workflow/tasks/T-0002.md', x => x.replace('milestone: M-0001', 'milestone: M-0002'));
  const base = p.commit('T-0002 belongs to M-0002');
  p.edit(milestonePath, append);
  p.write('src/b/index.js', 'export const b = 1;\n');
  const head = p.commit('M-0001 names T-0002, which belongs to M-0002');
  const r = p.run(['ci', '--baseline', base, '--candidate', head]);
  assert.notEqual(r.out?.merge, 'agent', r.stdout);
  const q = found(t);
  q.edit(milestonePath, x => x.replace(/^tasks: \[(.*)\]$/m, 'tasks: [T-0001, T-0009]'));
  const none = q.commit('M-0001 names T-0009, which has no record');
  const n = q.run(['ci', '--baseline', q.base, '--candidate', none]);
  assert.notEqual(n.out?.merge, 'agent', n.stdout);
});

test('MAINT-0026: a Draft or an Accepted milestone stays the owner\'s', t => {
  for (const status of ['Draft', 'Accepted']) {
    const p = found(t, { baselineEdit: q => q.edit(milestonePath, x => x.replace('status: Authorised', `status: ${status}`)) });
    // A task of a milestone that is not open is not ready for its work, so the change is judged on the milestone record alone.
    p.edit(milestonePath, append);
    const head = p.commit(`M-0001 (${status}) names T-0002`);
    const out = p.run(['ci', '--baseline', p.base, '--candidate', head]).out;
    assert.equal(out.merge, 'owner', `${status}: ${JSON.stringify(out)}`);
    assert.ok(!(out.deferred ?? []).some(d => entry.test(d)), JSON.stringify(out.deferred));
  }
});

test('MAINT-0026: without defer_to_acceptance the owner\'s merge approves the task, as in MAINT-0024', t => {
  const p = found(t, { configEdit: governing });
  const head = change(p);
  const out = ci(p, head);
  assert.equal(out.merge, 'owner');
  assert.ok(out.owner_reasons.some(r => /it changes the plan or requirements/.test(r)), JSON.stringify(out.owner_reasons));
  assert.equal(out.deferred, undefined);
  const ready = p.run(['readiness', '--baseline', p.base, '--candidate', head, '--task', 'T-0002']).out;
  assert.ok(ready.pending.some(x => /planned once the owner approves the milestone record/.test(x)), ready.pending.join(' | '));
});

test('MAINT-0026 review F7: where milestone records are not governing, the found-task rule and the owner stand', t => {
  const p = found(t, { configEdit: c => ({ ...c, approval: { ...c.approval, defer_to_acceptance: true } }) });
  const head = change(p);
  const ready = p.run(['readiness', '--baseline', p.base, '--candidate', head, '--task', 'T-0002']).out;
  assert.ok(ready.reasons.some(r => /T-0002 is a found task of M-0001 \(its tasks: list does not name it\) without found_from/.test(r)), ready.reasons.join(' | '));
  const e = evidence(head); e.tasks = ['T-0002']; e.review.tasks = ['T-0002'];
  const out = p.run(['ci', '--baseline', p.base, '--candidate', head, '--task', 'T-0002'], { evidence: e }).out;
  assert.notEqual(out?.merge, 'agent');
});

// The acceptance evidence: the tasks added since the milestone's plan was last authorised are listed in deferred.
const config = { approval: { label: 'owner-merge', mechanism: 'owner-merge', checkpoint: 'milestone', defer_to_acceptance: true }, paths: { production: ['src/**'], governing: ['docs/workflow/milestones/**'], planning: ['docs/**'] } };
const msText = ({ status = 'Authorised', tasks = ['T-0001'], scope = 'src' } = {}) => `---\nrecord: milestone\nid: M-0001\noutcome: a journey\nstatus: ${status}\nscope: [${scope}]\ntasks: [${tasks.join(', ')}]\n---\n# M-0001\n`;
function history(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-maint-0026-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => { const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  const write = (p, text) => { fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true }); fs.writeFileSync(path.join(dir, p), text); };
  const commit = m => { git('add', '-A'); git('commit', '-qm', m); return git('rev-parse', 'HEAD'); };
  git('init', '-q', '-b', 'main'); git('config', 'user.name', 'T'); git('config', 'user.email', 't@example.invalid');
  write('src/a.js', 'a\n');
  const root = commit('initial');
  // A task record per id, for the milestone that names it: a tasks-only change needs the record in its own commit.
  const task = id => write(`docs/workflow/tasks/${id}.md`, `---\nrecord: task\nid: ${id}\nmilestone: M-0001\nstatus: Draft\n---\n# ${id}\n`);
  const milestone = (m, message, ...ids) => { ids.forEach(task); write(milestonePath, msText(m)); return commit(message); };
  return { root, milestone, write, commit, at: rev => gitSource(dir, rev) };
}
function evidenceFor(rev, deferred = []) {
  return {
    schema: 'agent-workflow/acceptance-evidence@1', milestone: 'M-0001', candidate: rev,
    review: { reviewer: 'codex exec, fresh context', model: 'gpt-6.1-sol', revision: rev, report: 'https://github.com/o/r/pull/9#issuecomment-1' },
    walkthrough: { not_applicable: 'the project has no user interface: it is a command-line tool' },
    deferred, tests_changed: [],
  };
}
const owed = (h, trusted, head, deferred, base = h.at(trusted)) => acceptanceEvidenceErrors({ evidence: evidenceFor(head, deferred), milestone: 'M-0001', config, candidate: h.at(head), baseline: base, records: { tasks: new Map() } }).filter(e => /tasks added to M-0001/.test(e));

test('MAINT-0026: the acceptance evidence must list a task added since the plan, and passes when it does', t => {
  const h = history(t);
  h.milestone({}, 'M-0001 authorised', 'T-0001');
  const added = h.milestone({ tasks: ['T-0001', 'T-0002'] }, 'M-0001 names T-0002', 'T-0002');
  h.write(milestonePath, msText({ status: 'Accepted', tasks: ['T-0001', 'T-0002'] }));
  const head = h.commit('Accept M-0001');
  const errors = owed(h, added, head, []);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /deferred must list the tasks added to M-0001's tasks: since its plan was last authorised \([0-9a-f]{12}\), which the owner approves here: T-0002$/);
  assert.deepEqual(owed(h, added, head, ['T-0002: the fix of the date bug']), []);
  // A line naming only another task does not stand for it.
  assert.equal(owed(h, added, head, ['T-0001: planned']).length, 1);
});

test('MAINT-0026: a milestone created Authorised in one commit needs nothing listed for its own tasks, only for those added later', t => {
  const h = history(t);
  const created = h.milestone({ tasks: ['T-0001', 'T-0003'] }, 'M-0001 created Authorised', 'T-0001', 'T-0003');
  h.write(milestonePath, msText({ status: 'Accepted', tasks: ['T-0001', 'T-0003'] }));
  const head = h.commit('Accept M-0001');
  assert.deepEqual(owed(h, created, head, []), []);
  const g = history(t);
  g.milestone({ tasks: ['T-0001', 'T-0003'] }, 'M-0001 created Authorised', 'T-0001', 'T-0003');
  const added = g.milestone({ tasks: ['T-0001', 'T-0003', 'T-0004'] }, 'T-0004 added', 'T-0004');
  g.write(milestonePath, msText({ status: 'Accepted', tasks: ['T-0001', 'T-0003', 'T-0004'] }));
  assert.match(owed(g, added, g.commit('Accept M-0001 with T-0004'), [])[0], /approves here: T-0004$/);
});

test('MAINT-0026: after a re-plan the ids it carries are the owner\'s, and later tasks-only additions are owed', t => {
  const h = history(t);
  h.milestone({}, 'M-0001 authorised', 'T-0001');
  h.milestone({ tasks: ['T-0001', 'T-0002'] }, 'T-0002 added', 'T-0002');
  h.milestone({ status: 'Active', tasks: ['T-0001', 'T-0002'] }, 'M-0001 starts');
  // The owner re-plans: Active back to Authorised, with a wider scope and T-0003.
  h.milestone({ status: 'Authorised', scope: 'src, ops', tasks: ['T-0001', 'T-0002', 'T-0003'] }, 'M-0001 re-planned', 'T-0003');
  const added = h.milestone({ status: 'Authorised', scope: 'src, ops', tasks: ['T-0001', 'T-0002', 'T-0003', 'T-0004'] }, 'T-0004 added', 'T-0004');
  h.write(milestonePath, msText({ status: 'Accepted', scope: 'src, ops', tasks: ['T-0001', 'T-0002', 'T-0003', 'T-0004'] }));
  const head = h.commit('Accept M-0001');
  const errors = owed(h, added, head, []);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /approves here: T-0004$/);
  assert.deepEqual(owed(h, added, head, ['T-0004: listed']), []);
});

test('MAINT-0026: an Authorised to Active move is not a plan revision, and the walk goes on past it', t => {
  const h = history(t);
  h.milestone({}, 'M-0001 authorised', 'T-0001');
  h.milestone({ tasks: ['T-0001', 'T-0002'] }, 'T-0002 added', 'T-0002');
  const started = h.milestone({ status: 'Active', tasks: ['T-0001', 'T-0002'] }, 'M-0001 starts');
  h.write(milestonePath, msText({ status: 'Accepted', tasks: ['T-0001', 'T-0002'] }));
  const head = h.commit('Accept M-0001');
  assert.match(owed(h, started, head, [])[0], /approves here: T-0002$/);
});

test('MAINT-0026: the acceptance check fails closed, naming why, when the walk cannot finish', t => {
  const h = history(t);
  h.milestone({}, 'M-0001 authorised', 'T-0001');
  const added = h.milestone({ tasks: ['T-0001', 'T-0002'] }, 'M-0001 names T-0002', 'T-0002');
  h.write(milestonePath, msText({ status: 'Accepted', tasks: ['T-0001', 'T-0002'] }));
  const head = h.commit('Accept M-0001');
  // No trusted history to read.
  assert.match(owed(h, added, head, ['T-0002'], null)[0], /cannot be worked out: the trusted branch is not a Git history/);
  // The milestone is not in the trusted branch's history at all (renamed, or never merged there).
  assert.match(owed(h, h.root, head, ['T-0002'])[0], /cannot be worked out: the trusted branch's history shows no revision that planned M-0001/);
  // Nothing to work out when the milestone lists no tasks.
  h.write(milestonePath, msText({ status: 'Accepted', tasks: [] }));
  assert.deepEqual(owed(h, added, h.commit('Accept M-0001 with no tasks'), []), []);
});

// Review of the pull request (R1 to R3): the ids owed are computed from the trusted branch, not from what the agent's own diffs show.
test('MAINT-0026 review R1: an agent-added task stays owed after a later non-plan owner edit', t => {
  const h = history(t);
  h.milestone({}, 'M-0001 authorised', 'T-0001');
  h.milestone({ tasks: ['T-0001', 'T-0002'] }, 'T-0002 added (agent merge)', 'T-0002');
  const verified = h.milestone({ status: 'Verified', tasks: ['T-0001', 'T-0002'] }, 'M-0001 verified');
  h.write(milestonePath, msText({ status: 'Accepted', tasks: ['T-0001', 'T-0002'] }));
  assert.equal(owed(h, verified, h.commit('Accept M-0001'), []).length, 1);
});

test('MAINT-0026 review R2: a rebase-merged append before its task record stays owed', t => {
  const h = history(t);
  h.milestone({}, 'M-0001 authorised', 'T-0001');
  h.write(milestonePath, msText({ tasks: ['T-0001', 'T-0002'] })); h.commit('M-0001 names T-0002');
  h.write('docs/workflow/tasks/T-0002.md', '---\nrecord: task\nid: T-0002\nmilestone: M-0001\nstatus: Draft\n---\n# T-0002\n');
  const tip = h.commit('T-0002 record');
  h.write(milestonePath, msText({ status: 'Accepted', tasks: ['T-0001', 'T-0002'] }));
  assert.equal(owed(h, tip, h.commit('Accept M-0001'), []).length, 1);
});

test('MAINT-0026 review R3: the acceptance cannot hide an appended task by dropping it from tasks:', t => {
  const h = history(t);
  h.milestone({}, 'M-0001 authorised', 'T-0001');
  const added = h.milestone({ tasks: ['T-0001', 'T-0002'] }, 'T-0002 added', 'T-0002');
  h.write(milestonePath, msText({ status: 'Accepted', tasks: ['T-0001'] }));
  assert.equal(owed(h, added, h.commit('Accept M-0001'), []).length, 1);
});
