import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { evidence, project, taskPath } from './helpers/maint-0018.js';

// MAINT-0024 (a client project, 29 October 2026). The owner approved a found task, a test fix, in conversation. Readiness read
// `tasks:` from the trusted branch only, so the pull request adding T-0061 to its milestone with its fix failed `wf ci`, and
// the records-only one before it failed the broken required check: nothing merged for three days. A task the candidate's
// governing milestone record adds to `tasks:` is now planned there, since `wf ci` then needs the owner's approval of it.
const milestonePath = 'docs/workflow/milestones/M-0001.md';
const governing = c => ({ ...c, paths: { ...c.paths, governing: [...c.paths.governing, 'docs/workflow/milestones/**'] } });
const plan = q => q.edit(milestonePath, x => x.replace('status: Authorised\n', 'status: Authorised\ntasks: [T-0001]\n'));
const taskLike = (p, id, scope, edit = x => x) => p.write(`docs/workflow/tasks/${id}.md`, edit(fs.readFileSync(path.join(p.repo, taskPath), 'utf8').replaceAll('T-0001', id).replace(/^scope: .*$/m, `scope: [${scope}]`)));
const ask = 'ask the owner, who adds it to M-0001\'s tasks: or moves the work to a later milestone';

function found(t, configEdit = governing) {
  const p = project(t, { configEdit, baselineEdit: plan });
  taskLike(p, 'T-0002', 'src/b', x => x.replace('status: Ready', 'status: Draft'));
  const base = p.commit('records: T-0002, found, with no found_from');
  return { ...p, base };
}
const ownersChange = (p, edit = x => x.replace('tasks: [T-0001]', 'tasks: [T-0001, T-0002]')) => {
  p.edit(milestonePath, edit);
  p.edit('docs/workflow/tasks/T-0002.md', x => x.replace('status: Draft', 'status: Active'));
  p.write('src/b/index.js', 'export const b = 1;\n');
  return p.commit('T-0002: the fix, and M-0001 names it');
};

test('MAINT-0024: a found task the candidate\'s governing milestone record adds to tasks: is ready, and wf ci gives the merge to the owner', t => {
  const p = found(t);
  const refused = p.run(['readiness', '--baseline', p.base, '--task', 'T-0002']).out;
  assert.deepEqual(refused.reasons, [`T-0002 is a found task of M-0001 (its tasks: list does not name it) without found_from: name the review finding (R-NNNN/F1) or trial it fixes, or ${ask}`]);
  const head = ownersChange(p);
  const ready = p.run(['readiness', '--baseline', p.base, '--candidate', head, '--task', 'T-0002']).out;
  assert.equal(ready.outcome, 'Ready', ready.reasons.join(' | '));
  assert.ok(ready.pending.some(x => /T-0002 is added to M-0001's tasks: in this change, so it is planned once the owner approves the milestone record/.test(x)), ready.pending.join(' | '));
  // The owner's approval is the merge: wf ci passes, and only the owner merges.
  const e = evidence(head); e.tasks = ['T-0002']; e.review.tasks = ['T-0002'];
  const ci = p.run(['ci', '--baseline', p.base, '--candidate', head, '--task', 'T-0002'], { evidence: e });
  assert.equal(ci.status, 0, ci.stdout + ci.stderr);
  assert.equal(ci.out.merge, 'owner');
});

test('MAINT-0024 review F1, F2: wf next starts a Draft the owner adds, which takes no place in the found_tasks allowance', t => {
  const p = found(t);
  // The action wf next gives the task, and whether it holds it for the owner.
  const startable = (rev, id) => { const n = p.run(['next', '--baseline', p.base, '--candidate', rev]).out; return [[n.next, ...n.also].find(a => a?.item === id)?.kind, (n.held ?? []).filter(h => h.task === id)]; };
  assert.deepEqual(startable(p.base, 'T-0002'), ['plan', []], 'a found task to plan or ask about before the owner adds it');
  p.edit(milestonePath, x => x.replace('tasks: [T-0001]', 'tasks: [T-0001, T-0002]'));
  const added = p.commit('M-0001: the owner adds T-0002');
  assert.deepEqual(startable(added, 'T-0002'), ['start', []]);
  // With found_tasks: 1, an owner-added task with a found_from is not counted as begun, so a found Draft keeps the place.
  const q = project(t, { configEdit: governing, baselineEdit: r => { plan(r); r.edit(milestonePath, x => x.replace('tasks: [T-0001]', 'tasks: [T-0001]\nfound_tasks: 1')); } });
  taskLike(q, 'T-0002', 'src/b', x => x.replace('status: Ready', 'status: Draft'));
  taskLike(q, 'T-0003', 'src/c', x => x.replace('status: Ready', 'status: Draft\nfound_from: R-0001/F2'));
  const base = q.commit('records: T-0002, and T-0003 fixing R-0001/F2; M-0001 allows one found task');
  q.edit(milestonePath, x => x.replace('tasks: [T-0001]', 'tasks: [T-0001, T-0002]'));
  q.edit('docs/workflow/tasks/T-0002.md', x => x.replace('status: Draft', 'status: Active\nfound_from: R-0001/F1'));
  const head = q.commit('T-0002 added by the owner and begun');
  const n = q.run(['next', '--baseline', base, '--candidate', head]).out;
  assert.ok(!(n.held ?? []).some(h => h.task === 'T-0003'), JSON.stringify(n.held));
  const r3 = q.run(['readiness', '--baseline', base, '--candidate', head, '--task', 'T-0003']).out;
  assert.equal(r3.outcome, 'Ready', r3.reasons.join(' | '));
});

test('MAINT-0024 review F8: in manual mode the same change still needs the owner\'s governing-change receipt', t => {
  const manual = c => governing({ ...c, approval: { ...c.approval, label: 'manual', mechanism: 'manual', checkpoint: undefined } });
  const p = project(t, { configEdit: manual, baselineEdit: q => { plan(q); q.edit('docs/workflow/profile.md', x => x.replace('approval_label: owner-merge', 'approval_label: manual')); } });
  taskLike(p, 'T-0002', 'src/b', x => x.replace('status: Ready', 'status: Draft'));
  const base = p.commit('records: T-0002');
  const head = ownersChange(p);
  const ci = p.run(['ci', '--baseline', base, '--candidate', head, '--task', 'T-0002']);
  assert.notEqual(ci.status, 0);
  assert.ok(ci.out.findings.some(f => /governing-change approval for the exact candidate and protected paths is required/.test(f)), ci.out.findings.join(' | '));
});

test('MAINT-0024: without a governing milestone record, or without the task in the candidate\'s tasks:, the found-task rule stands', t => {
  const planning = found(t, c => c);
  const head = ownersChange(planning);
  assert.deepEqual(planning.run(['readiness', '--baseline', planning.base, '--candidate', head, '--task', 'T-0002']).out.reasons, [`T-0002 is a found task of M-0001 (its tasks: list does not name it) without found_from: name the review finding (R-NNNN/F1) or trial it fixes, or ${ask}`]);
  const other = found(t);
  const unnamed = ownersChange(other, x => x.replace('outcome: ', 'outcome: Now '));
  assert.deepEqual(other.run(['readiness', '--baseline', other.base, '--candidate', unnamed, '--task', 'T-0002']).out.reasons, [`T-0002 is a found task of M-0001 (its tasks: list does not name it) without found_from: name the review finding (R-NNNN/F1) or trial it fixes, or ${ask}`]);
});

test('MAINT-0024: adding a task to a milestone\'s tasks: leaves its other tasks fresh; any other change to the record does not', t => {
  const p = found(t);
  p.edit(taskPath, x => x.replace(/^governing_baseline_revision: .*$/m, `governing_baseline_revision: ${p.base}`));
  const assessed = p.commit('T-0001: assessed on the base');
  p.edit(milestonePath, x => x.replace('tasks: [T-0001]', 'tasks: [T-0001, T-0002]'));
  const added = p.commit('M-0001: the owner adds T-0002');
  const at = rev => p.run(['readiness', '--baseline', rev, '--task', 'T-0001']).out;
  assert.equal(at(assessed).outcome, 'Ready', at(assessed).reasons.join(' | '));
  assert.equal(at(added).outcome, 'Ready', at(added).reasons.join(' | '));
  p.edit(milestonePath, x => x.replace('limits: ', 'limits: two sessions, '));
  const changed = p.commit('M-0001: its limits change');
  assert.ok(at(changed).reasons.some(r => /readiness is stale/.test(r)), at(changed).reasons.join(' | '));
});
