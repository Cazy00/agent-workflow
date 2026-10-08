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
test('local Done does not satisfy an unfinished trusted prerequisite', t => {
  const p = setup(t);
  p.both('docs/workflow/tasks/T-0002.md', () => p.baseline.read(task).replaceAll('T-0001', 'T-0002').replace('prerequisites: []', 'prerequisites: [T-0001]'));
  p.edit('candidate', task, x => x.replace('status: Ready', 'status: Done'));
  const r = evaluateReadiness({ ...p, task: 'T-0002', trust: p.trust() });
  assert.equal(r.outcome, 'Needs discovery or resolution');
  assert.match(r.reasons.join('\n'), /prerequisite T-0001 is not Done on the trusted baseline/);
});
