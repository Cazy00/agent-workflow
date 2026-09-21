// Discover governing dependencies at BOTH revisions. New applicable decisions
// must enter the comparison even when the task did not previously name them.
import { list, loadAll } from './records.js';
import { safePath } from './sources.js';
import { overlaps } from './scope.js';

function relevant(source, rd, seeds) {
  const all = loadAll(source, rd);
  if (all.errors.length) throw new Error('cannot establish freshness from invalid governing records');
  const paths = new Set([`${rd}/profile.md`, 'docs/workflow/config.json']);
  const acceptance = new Set();
  const tasks = new Map();
  const milestones = new Set();
  const decisions = new Set();
  const visited = new Set();
  const queue = seeds.filter(Boolean).map(data => ({ type: 'task', data }));
  const ref = value => {
    if (value === 'PROFILE') return;
    if (/^D-\d{4}$/.test(value)) { decisions.add(value); return; }
    if (/^T-\d{4}$/.test(value)) {
      paths.add(`${rd}/tasks/${value}.md`);
      const data = all.tasks.get(value)?.data;
      if (data) queue.push({ type: 'task', data });
      return;
    }
    if (/^M-\d{4}$/.test(value)) { milestones.add(value); return; }
    if (value.startsWith('contract:')) value = value.slice(9);
    paths.add(safePath(value));
  };
  // Expansion includes reverse supersession and dependencies, with cycle guards.
  let expanded = true;
  while (expanded || queue.length) {
    expanded = false;
    while (queue.length) {
      const { type, data } = queue.shift();
      const key = `${type}:${JSON.stringify(data)}`;
      if (visited.has(key)) continue;
      visited.add(key);
      for (const id of list(data.acceptance)) acceptance.add(id);
      if (type === 'task') {
        tasks.set(key, data);
        if (data.milestone) milestones.add(data.milestone);
      }
      for (const f of ['governing', 'prerequisites', 'decisions']) for (const r of list(data[f])) ref(r);
      for (const d of list(data.deferred_inputs)) ref(d.split('@')[0]);
      for (const f of ['feature_readiness', 'design']) if (data[f]) ref(data[f]);
      for (const f of ['supersedes', 'superseded_by']) if (data[f]) ref(data[f]);
    }
    for (const id of milestones) {
      paths.add(`${rd}/milestones/${id}.md`);
      const data = all.milestones.get(id)?.data;
      if (data && !visited.has(`milestone:${JSON.stringify(data)}`)) { queue.push({ type: 'milestone', data }); expanded = true; }
    }
    for (const [id, record] of all.decisions) {
      const d = record.data;
      const applies = list(d.affects).some(a => milestones.has(a) || [...tasks.values()].some(t =>
        a === t.id || a === t.feature || a === t.milestone || (a.startsWith('paths:') && list(t.scope).some(p => overlaps(a.slice(6), p)))));
      if (applies || decisions.has(d.supersedes) || decisions.has(d.superseded_by)) {
        if (!decisions.has(id)) { decisions.add(id); expanded = true; }
      }
    }
    for (const id of decisions) {
      paths.add(`${rd}/decisions/${id}.md`);
      const data = all.decisions.get(id)?.data;
      if (data && !visited.has(`decision:${JSON.stringify(data)}`)) { queue.push({ type: 'decision', data }); expanded = true; }
    }
  }
  const text = source.read('docs/workflow/acceptance.json');
  const examples = text === null ? [] : JSON.parse(text).examples;
  if (!Array.isArray(examples)) throw new Error('invalid acceptance definitions for freshness');
  const definitions = new Map();
  for (const example of examples) {
    if (typeof example?.id !== 'string' || definitions.has(example.id)) throw new Error('invalid or duplicate acceptance definition');
    definitions.set(example.id, example);
    if (acceptance.has(example.id) && example.requirement) paths.add(safePath(example.requirement));
  }
  return { paths, acceptance, definitions };
}

export function governingChanged({ baseline, revision, recordsDir, task, previous }) {
  const old = baseline.atRevision(revision);
  const oldTask = loadAll(old, recordsDir).tasks.get(task.id)?.data;
  const seeds = [task, previous, oldTask];
  const before = relevant(old, recordsDir, seeds);
  const after = relevant(baseline, recordsDir, seeds);
  const paths = new Set([...before.paths, ...after.paths]);
  const ids = new Set([...before.acceptance, ...after.acceptance]);
  for (const id of ids) {
    if (JSON.stringify(before.definitions.get(id)) !== JSON.stringify(after.definitions.get(id))) return true;
  }
  return baseline.changedSince(revision, [...paths]);
}
