import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirSource, evaluateCi, evaluateReadiness, validateRecords } from '../lib/index.js';
import { fixtureTrust, integrationClaims } from './helpers.js';
const fixture = fileURLToPath(new URL('../../fixtures/04a-accepted-decision-permits/baseline', import.meta.url));
function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-delivery-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const side of ['baseline', 'candidate']) fs.cpSync(fixture, path.join(root, side), { recursive: true });
  const edit = (side, p, fn) => { const f = path.join(root, side, p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, fn(fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '')); };
  const both = (p, fn) => { for (const side of ['baseline', 'candidate']) edit(side, p, fn); };
  both('evidence/log.txt', () => 'Observed checks and review');
  const baseline = dirSource(path.join(root, 'baseline')), candidate = dirSource(path.join(root, 'candidate'));
  const trust = () => fixtureTrust(baseline, candidate, integrationClaims(candidate).map(c => c.purpose === 'review' ? { ...c, tasks: ['T-0001', 'T-0002'] } : c));
  const ci = (extra = {}) => evaluateCi({ baseline, candidate, task: 'T-0001', changed: ['src/a.js'], trust: trust(), ...extra });
  return { baseline, candidate, edit, both, trust, ci };
}
const decision = 'docs/workflow/decisions/D-0001.md';
const task = 'docs/workflow/tasks/T-0001.md';
test('a pre-merge decision permits local implementation and verification but blocks integration', t => {
  const p = setup(t);
  p.both(decision, x => x.replace('required_before: implement', 'required_before: integrate').replace('status: Resolved', 'status: Open'));
  assert.equal(validateRecords(p.baseline, 'docs/workflow').ok, true);
  for (const stage of ['implement', 'verify']) assert.equal(evaluateReadiness({ ...p, task: 'T-0001', trust: p.trust(), stage }).outcome, 'Ready');
  for (const stage of ['integrate', 'accept', 'release']) assert.equal(evaluateReadiness({ ...p, task: 'T-0001', trust: p.trust(), stage }).outcome, 'Needs discovery or resolution');
  assert.equal(p.ci().verdict, 'fail');
  assert.match(p.ci().findings.join('\n'), /required before integrate/);
  p.edit('candidate', decision, x => x.replace('status: Open', 'status: Resolved'));
  assert.equal(p.ci().verdict, 'fail', 'candidate cannot approve its own merge condition');
  p.edit('baseline', decision, x => x.replace('status: Open', 'status: Resolved'));
  assert.equal(p.ci().verdict, 'pass');
});
test('deferred integrate input is not lost by the lifecycle stage ordering', t => {
  const p = setup(t);
  p.both(decision, x => x.replace('required_before: implement', 'required_before: none').replace('status: Resolved', 'status: Open'));
  p.both(task, x => x.replace('deferred_inputs: []', 'deferred_inputs: [D-0001@integrate]'));
  assert.equal(validateRecords(p.baseline, 'docs/workflow').ok, true);
  assert.equal(evaluateReadiness({ ...p, task: 'T-0001', trust: p.trust(), stage: 'verify' }).outcome, 'Ready');
  assert.equal(p.ci().verdict, 'fail');
  assert.match(p.ci().findings.join('\n'), /deferred input D-0001 is required before integrate/);
});
function batch(t) {
  const p = setup(t);
  p.both('docs/workflow/config.json', x => JSON.stringify({ ...JSON.parse(x), delivery: { batching: { max_tasks: 3, environment: 'isolated integration demo', rollback: 'revert the delivery commit' } } }));
  p.both(task, x => x.replace('scope: [src, docs/workflow/tasks]', 'scope: [src/a.js]'));
  p.both('docs/workflow/tasks/T-0002.md', () => p.baseline.read(task).replaceAll('T-0001', 'T-0002').replace('src/a.js', 'src/b.js'));
  p.run = (extra = {}) => p.ci({ task: undefined, tasks: ['T-0001', 'T-0002'], changed: ['src/a.js', 'src/b.js'], ...extra });
  return p;
}
test('one batch validates both tasks and the final candidate evidence', t => {
  const p = batch(t), r = p.run();
  assert.equal(r.verdict, 'pass', r.findings.join('\n'));
  assert.deepEqual(Object.keys(r.readinessByTask), ['T-0001', 'T-0002']);
  p.edit('candidate', 'docs/workflow/tasks/T-0002.md', x => x.replace('status: Ready', 'status: Blocked\nresume_condition: fix failing journey'));
  assert.equal(p.run().verdict, 'fail', 'no gate is hidden by the other task');
});
test('batch opt-in must be on the approved baseline; candidate opt-in cannot enable it', t => {
  const p = batch(t);
  p.edit('baseline', 'docs/workflow/config.json', x => { const c = JSON.parse(x); delete c.delivery; return JSON.stringify(c); });
  assert.equal(p.run().verdict, 'fail');
  assert.match(p.run().findings.join('\n'), /approved baseline delivery.batching/);
});
test('unassigned and multiply assigned production paths block a batch', t => {
  const p = batch(t);
  assert.equal(p.run({ changed: ['src/a.js', 'src/b.js', 'src/hidden.js'] }).verdict, 'fail');
  p.edit('candidate', 'docs/workflow/tasks/T-0002.md', x => x.replace('scope: [src/b.js]', 'scope: [src]'));
  assert.equal(p.run().verdict, 'fail');
  assert.match(p.run().findings.join('\n'), /src\/a.js.*found 2/);
});
test('local Done does not satisfy an unfinished trusted prerequisite', t => {
  const p = batch(t);
  p.edit('candidate', task, x => x.replace('status: Ready', 'status: Done'));
  assert.equal(p.run().verdict, 'pass');
  p.both('docs/workflow/tasks/T-0002.md', x => x.replace('prerequisites: []', 'prerequisites: [T-0001]'));
  assert.equal(p.run().verdict, 'fail');
  assert.match(p.run().findings.join('\n'), /prerequisite T-0001 is not Done on the trusted baseline/);
});
test('batch cannot borrow review of one task, exceed its limit, or cross implementers', t => {
  const p = batch(t);
  const partial = fixtureTrust(p.baseline, p.candidate, integrationClaims(p.candidate).map(c => c.purpose === 'review' ? { ...c, tasks: ['T-0001'] } : c));
  assert.equal(p.run({ trust: partial }).verdict, 'fail');
  p.edit('candidate', 'docs/workflow/tasks/T-0002.md', x => x.replace('owner: agent', 'owner: other'));
  assert.equal(p.run().verdict, 'fail');
  assert.equal(p.run({ tasks: ['T-0001', 'T-0002', 'T-0003', 'T-0004'] }).verdict, 'fail');
  assert.throws(() => p.run({ tasks: ['T-0001', 'T-0001'] }), /distinct/);
});
