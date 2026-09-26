import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAcceptance } from '../lib/acceptance.js';
const definition = { examples: [{ id: 'AC-001-1', requirement: 'docs/specs/payment.md', method: 'automated' }] };
const mapping = [{ acceptance: 'AC-001-1', file: 'test/payment.js', name: 'reject invalid payment' }];
function source(entries, name = 'candidate') { return { name, read: p => entries[p] ?? null, exists: p => p in entries }; }
function scenario({ maps = mapping, old = mapping, tests, defs = definition } = {}) {
  const common = { 'docs/specs/payment.md': 'Approved behaviour', 'test/payment.js': 'test implementation' };
  const baseline = source({ ...common, 'docs/workflow/acceptance.json': JSON.stringify(defs), 'tests/acceptance-map.json': JSON.stringify(old) }, 'baseline');
  const candidate = source({ ...common, 'tests/acceptance-map.json': JSON.stringify(maps) });
  return evaluateAcceptance({ baseline, candidate, execution: { revision: 'candidate', tests: tests ?? maps.map(m => ({ ...m, status: 'passed' })) }, requiredIds: ['AC-001-1'] });
}
test('allows new tests for approved acceptance behaviour', () => assert.equal(scenario({ maps: [...mapping, { ...mapping[0], name: 'also rejects empty amount' }] }).ok, true));
test('removing an existing mapping blocks integration', () => assert.match(scenario({ maps: [] }).errors.join(' '), /removed.*mapping/i));
test('disabled and missing required execution block integration', () => {
  assert.equal(scenario({ tests: [{ ...mapping[0], status: 'skipped' }] }).ok, false);
  assert.equal(scenario({ tests: [] }).ok, false);
});
test('unknown acceptance references reject unsupported specification approval claims', () => assert.match(scenario({ maps: [{ ...mapping[0], acceptance: 'AC-999-1', approved: true }] }).errors.join(' '), /unknown acceptance/i));
test('preserved mapping permits a justified test correction; semantic review remains required', () => { const r = scenario(); assert.equal(r.ok, true); assert.equal(r.reviewRequired, true); });
test('stale execution reports cannot prove tests ran for a candidate', () => {
  const baseline = source({ 'docs/workflow/acceptance.json': JSON.stringify(definition), 'tests/acceptance-map.json': JSON.stringify(mapping), 'docs/specs/payment.md': 'spec' });
  const candidate = source({ 'tests/acceptance-map.json': JSON.stringify(mapping), 'test/payment.js': 'test' });
  const r = evaluateAcceptance({ baseline, candidate, execution: { revision: 'wrong', tests: [{ ...mapping[0], status: 'passed' }] } });
  assert.equal(r.ok, false);
});
test('unrelated future acceptance definitions do not block the current task', () => {
  const defs = { examples: [...definition.examples, { ...definition.examples[0], id: 'AC-002-1' }] };
  assert.equal(scenario({ defs }).ok, true);
});
// A project moving its pin from a release without acceptance traceability has no map on its baseline; the change
// adding one is a production change, so a baseline without the map must require nothing rather than fail.
test('a baseline without a map requires no mappings, so the change adding the map can pass', () => {
  const baseline = source({ 'docs/workflow/acceptance.json': JSON.stringify(definition), 'docs/specs/payment.md': 'spec' }, 'baseline');
  const empty = evaluateAcceptance({ baseline, candidate: source({ 'tests/acceptance-map.json': '[]' }), execution: { revision: 'candidate', tests: [] } });
  assert.deepEqual(empty.errors, []);
  const added = evaluateAcceptance({ baseline, candidate: source({ 'tests/acceptance-map.json': JSON.stringify(mapping), 'test/payment.js': 'test' }), execution: { revision: 'candidate', tests: mapping.map(m => ({ ...m, status: 'passed' })) }, requiredIds: ['AC-001-1'] });
  assert.equal(added.ok, true, added.errors.join(' | '));
});
test('the candidate must still carry the map, with or without one on the baseline', () => {
  const withMap = source({ 'docs/workflow/acceptance.json': JSON.stringify(definition), 'tests/acceptance-map.json': '[]', 'docs/specs/payment.md': 'spec' }, 'baseline');
  const withoutMap = source({ 'docs/workflow/acceptance.json': JSON.stringify(definition), 'docs/specs/payment.md': 'spec' }, 'baseline');
  for (const baseline of [withMap, withoutMap]) {
    const r = evaluateAcceptance({ baseline, candidate: source({}), execution: { revision: 'candidate', tests: [] } });
    assert.match(r.errors.join(' '), /tests\/acceptance-map\.json: missing/);
  }
});
