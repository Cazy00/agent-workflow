import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { prepareDraftTasks, writeDraftBatch, featurePath } from '../../adapters/speckit/task-plan.mjs';
import { parseFrontMatter } from '../lib/frontmatter.js';
const input = () => ({ sourceDigest: 'a'.repeat(64), usedIds: ['T-0001', 'T-0007', 'T-0011'], exists: p => !/tasks\/T-00(12|13)\.md$/.test(p),
  plan: { schema: 'wf-task-plan/v1', feature: 'docs/specs/orders', milestone: 'M-0001', source_digest: 'a'.repeat(64), tasks: [
    { key: 'order', title: 'Complete order behavior', objective: 'Deliver the complete order behavior', owner: 'worker',
      scope: ['src/orders','tests/orders'], acceptance: ['AC-001-1'], governing: ['PROFILE'], prerequisites: ['T-0001'], decisions: ['D-0001'], risks: ['money'],
      steps: ['Implement order rules', 'Verify negative cases', 'Obtain independent review'], verification: 'npm test', review: 'separate canonical context' },
    { key: 'refund', title: 'Refund behavior', objective: 'Deliver refunds', owner: 'worker', scope: ['src/refunds'], acceptance: ['AC-001-2'],
      governing: ['PROFILE'], prerequisites: ['key:order'], decisions: [], risks: [], steps: ['Implement and review refund behavior'], verification: 'npm test', review: 'independent review' },
  ] } });
test('native Drafts allocate above all claimed IDs and preserve semantics and internal steps', () => {
  const i = input(), before = structuredClone(i.plan), drafts = prepareDraftTasks(i);
  assert.deepEqual(drafts.map(d => d.id), ['T-0012','T-0013']);
  const first = parseFrontMatter(drafts[0].text).data, second = parseFrontMatter(drafts[1].text).data;
  assert.equal(first.status, 'Draft'); assert.deepEqual(first.acceptance, ['AC-001-1']);
  assert.deepEqual(first.scope, ['src/orders','tests/orders']); assert.deepEqual(first.decisions, ['D-0001']);
  assert.deepEqual(second.prerequisites, ['T-0012']); assert.match(drafts[0].text, /- \[ \] Verify negative cases/);
  assert.deepEqual(i.plan, before);
});
for (const kind of ['cycle','missing prerequisite','exhausted','stale','collision','injection','unknown field']) {
  test(`Draft preparation rejects ${kind} before writing`, () => {
    const i = input();
    if (kind === 'cycle') i.plan.tasks[0].prerequisites = ['key:refund'];
    if (kind === 'missing prerequisite') i.plan.tasks[0].prerequisites = ['key:missing'];
    if (kind === 'exhausted') i.usedIds.push('T-9999');
    if (kind === 'stale') i.sourceDigest = 'b'.repeat(64);
    if (kind === 'collision') i.exists = () => true;
    if (kind === 'injection') i.plan.tasks[0].objective = 'Text\nstatus: Ready';
    if (kind === 'unknown field') i.plan.tasks[0].status = 'Ready';
    assert.throws(() => prepareDraftTasks(i));
  });
}
test('writing Drafts refuses existing records and safely creates a new batch', t => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(),'wf-speckit-tasks-'));t.after(()=>fs.rmSync(repo,{recursive:true,force:true}));
  const drafts = prepareDraftTasks(input());
  assert.equal(writeDraftBatch({repo,drafts}).length,2);
  assert.throws(()=>writeDraftBatch({repo,drafts}),/collision/);
  assert.equal(fs.readFileSync(path.join(repo,drafts[0].path),'utf8'),drafts[0].text);
});
test('feature paths reject traversal, ambiguous names and alternate roots', () => {
  for (const p of ['specs/orders','docs/specs/../orders','docs/specs/Orders','docs/specs/a/b','docs/specs/a--b']) assert.throws(()=>featurePath(p));
});

import { taskIdsFromPaths, validateAllocationSnapshot } from '../../adapters/speckit/allocation.mjs';
test('ID inventory consumes deleted and PR history paths without renumbering survivors', () => {
  assert.deepEqual(taskIdsFromPaths(['docs/workflow/tasks/T-0011.md','docs/workflow/tasks/T-0007.md','docs/workflow/tasks/T-0011.md','src/T-9999.md']), ['T-0007','T-0011']);
});
test('allocation snapshots reject stale, incomplete, shallow and unavailable-head evidence', () => {
  const s={schema:'wf-speckit-allocation/v1',repository:'owner/project',baseline:'a'.repeat(40),complete:true,shallow:false,observed_at:100000,ids:['T-0011'],pulls:[{number:2,head:'b'.repeat(40),available:true}]};
  const expected={repository:s.repository,baseline:s.baseline,now:100001};
  assert.equal(validateAllocationSnapshot(s,expected),s);
  for (const delta of [{complete:false},{shallow:true},{observed_at:0},{pulls:[{number:2,head:'b'.repeat(40),available:false}]},{baseline:'c'.repeat(40)}])
    assert.throws(()=>validateAllocationSnapshot({...s,...delta},expected),/snapshot/);
});
