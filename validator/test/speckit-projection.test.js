import test from 'node:test';
import assert from 'node:assert/strict';
import { renderTaskProjection, verifyTaskProjection } from '../../adapters/speckit/projection.mjs';
const task = (id, status = 'Draft') => ({ path: `docs/workflow/tasks/${id}.md`, text: `---\nrecord: task\nid: ${id}\ntitle: Order flow\nstatus: ${status}\nobjective: Reviewable behavior\n---\n- [ ] Implement and verify\n` });
const inputs = () => ({ selectedTask: 'T-0001', lockDigest: 'a'.repeat(64), sources: [
  { path: 'docs/specs/orders/spec.md', text: 'AC-001: approved requirements' },
  { path: 'docs/specs/orders/plan.md', text: 'Design' },
  { path: 'docs/specs/orders/contracts/order.json', text: '{"version":1}' },
  { path: 'docs/workflow/milestones/M-0001.md', text: 'Authorised scope' },
  { path: 'docs/workflow/decisions/D-0001.md', text: 'Reserved decision' },
  { path: 'docs/workflow/acceptance.json', text: '{"examples":[]}' }, task('T-0001'), task('T-0002'),
] });
test('projection is deterministic for path order, identifies selected task and is one-way', () => {
  const input = inputs(), before = structuredClone(input);
  const result = renderTaskProjection(input);
  assert.equal(renderTaskProjection({ ...input, sources: [...input.sources].reverse() }).bytes, result.bytes);
  assert.match(result.bytes, /generated: wf-task-projection\/v1/);
  assert.match(result.bytes, /T-0001 \(selected\)/);
  assert.deepEqual(verifyTaskProjection({ ...input, bytes: result.bytes }), { ok: true, reasons: [] });
  assert.deepEqual(input, before);
});
test('every canonical input and the lock affects freshness, including task progress', () => {
  const base = inputs(), bytes = renderTaskProjection(base).bytes;
  for (let i = 0; i < base.sources.length; i++) {
    const changed = structuredClone(base); changed.sources[i].text += '\nNew canonical content.';
    assert.deepEqual(verifyTaskProjection({ ...changed, bytes }).reasons, ['projection_stale']);
  }
  const changed = inputs(); changed.sources[6] = task('T-0001', 'Active');
  assert.deepEqual(verifyTaskProjection({ ...changed, bytes }).reasons, ['projection_stale']);
  assert.equal(verifyTaskProjection({ ...base, lockDigest: 'b'.repeat(64), bytes }).ok, false);
});
test('manual checkbox/header edits are rejected and cannot alter native records', () => {
  const input = inputs(), before = structuredClone(input), bytes = renderTaskProjection(input).bytes;
  for (const edited of [bytes.replace('- [ ]', '- [x]'), bytes + '\nDone', bytes.replace('# Native task view', '# Approved')])
    assert.deepEqual(verifyTaskProjection({ ...input, bytes: edited }).reasons, ['projection_modified']);
  assert.deepEqual(input, before);
});
test('retired tasks are not restored by regeneration and task selection changes the view', () => {
  const input = inputs(), original = renderTaskProjection(input);
  assert.notEqual(renderTaskProjection({ ...input, selectedTask: 'T-0002' }).sourceDigest, original.sourceDigest);
  input.sources = input.sources.filter(s => !s.path.endsWith('T-0002.md'));
  assert.doesNotMatch(renderTaskProjection(input).bytes, /T-0002/);
  assert.throws(() => renderTaskProjection({ ...input, selectedTask: 'T-0002' }), /absent/);
});
test('duplicate, unsafe and projected sources cannot enter the canonical inputs', () => {
  for (const path of ['../outside', 'docs/specs/orders/tasks.md', 'docs/specs/orders/spec.md']) {
    const input = inputs(); input.sources.push({ path, text: 'fake' });
    assert.throws(() => renderTaskProjection(input), /invalid|canonical|duplicate/);
  }
});
