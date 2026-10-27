import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { evaluateAcceptance, expandExecution } from '../lib/acceptance.js';
import { DELIVERY_MARKER, parseDeliveryEvidence } from '../lib/delivery-evidence.js';
import { cli, evidence, project } from './helpers/maint-0018.js';

// MAINT-0023 P7, rebuilt (27 October 2026): the delivery evidence's execution may list its passing tests once, by name under their
// file, with the run's reference given once; failed, skipped and pending tests keep their full entries. The gate still requires every
// mapped test exactly once, passed or pending (acceptance.js), so a compact block that misses one, repeats one or names one twice fails.
const RUN = 'https://github.com/o/r/actions/runs/42';
const mapped = [
  { acceptance: 'AC-001-1', file: 'tests/a.test.js', name: 'rejects an invalid payment' },
  { acceptance: 'AC-001-1', file: 'tests/a.test.js', name: 'accepts a valid payment' },
  { acceptance: 'AC-001-1', file: 'tests/b.test.js', name: 'rejects an invalid payment' },
];
const definition = { examples: [{ id: 'AC-001-1', requirement: 'docs/specs/payment.md', method: 'automated' }] };
function source(entries, name = 'candidate') { return { name, read: p => entries[p] ?? null, exists: p => p in entries }; }
// The gate's own path, as ci.js runs it: the compact form is expanded, then every mapped test is judged.
function judge(execution, { maps = mapped, pending = new Map() } = {}) {
  const files = { 'docs/specs/payment.md': 'Approved behaviour', 'tests/a.test.js': 'x', 'tests/b.test.js': 'y' };
  const baseline = source({ ...files, 'docs/workflow/acceptance.json': JSON.stringify(definition), 'tests/acceptance-map.json': JSON.stringify(maps) }, 'baseline');
  const candidate = source({ ...files, 'tests/acceptance-map.json': JSON.stringify(maps) });
  const expanded = expandExecution(execution);
  const result = evaluateAcceptance({ baseline, candidate, execution: expanded.execution, requiredIds: ['AC-001-1'], pending });
  return { errors: [...expanded.errors, ...result.errors], pending: result.pending };
}
const compact = (passed, more = {}) => ({ revision: 'candidate', run: RUN, passed, ...more });
const everyone = { 'tests/a.test.js': ['rejects an invalid payment', 'accepts a valid payment'], 'tests/b.test.js': ['rejects an invalid payment'] };

test('MAINT-0023 P7: a compact block that names every mapped test passes', () => {
  assert.deepEqual(judge(compact(everyone)).errors, []);
  // The same name in two files is two tests: each file lists its own.
  assert.deepEqual(judge(compact(everyone, { tests: [] })).errors, []);
  // The full form still passes, and so do both together for different tests.
  assert.deepEqual(judge({ revision: 'candidate', tests: mapped.map(m => ({ file: m.file, name: m.name, status: 'passed' })) }).errors, []);
  assert.deepEqual(judge(compact({ 'tests/a.test.js': everyone['tests/a.test.js'] }, { tests: [{ file: 'tests/b.test.js', name: 'rejects an invalid payment', status: 'passed' }] })).errors, []);
});

test('MAINT-0023 P7: a compact block missing a mapped test fails', () => {
  assert.match(judge(compact({ 'tests/a.test.js': ['rejects an invalid payment'], 'tests/b.test.js': everyone['tests/b.test.js'] })).errors.join(' | '), /required test did not run exactly once and pass: tests\/a\.test\.js \/ accepts a valid payment/);
  // A name listed under the wrong file does not stand for the same name in another file.
  assert.match(judge(compact({ 'tests/a.test.js': everyone['tests/a.test.js'] })).errors.join(' | '), /required test did not run exactly once and pass: tests\/b\.test\.js \/ rejects an invalid payment/);
  assert.match(judge(compact({})).errors.join(' | '), /required test did not run exactly once and pass: tests\/a\.test\.js \/ rejects an invalid payment/);
});

test('MAINT-0023 P7: a compact block naming a failed test fails', () => {
  // The failed test keeps its full entry; it is not in the list, so it is not run and passing.
  const failed = judge(compact({ 'tests/a.test.js': ['rejects an invalid payment'], 'tests/b.test.js': everyone['tests/b.test.js'] }, { tests: [{ file: 'tests/a.test.js', name: 'accepts a valid payment', status: 'failed' }] }));
  assert.match(failed.errors.join(' | '), /required test did not run exactly once and pass: tests\/a\.test\.js \/ accepts a valid payment/);
  // Named as passing and as failed: the evidence contradicts itself.
  const both = judge(compact(everyone, { tests: [{ file: 'tests/a.test.js', name: 'accepts a valid payment', status: 'failed' }] }));
  assert.match(both.errors.join(' | '), /tests\/a\.test\.js \/ accepts a valid payment is in both execution\.passed and execution\.tests: list each test once/);
});

test('MAINT-0023 P7: a name in both the compact list and a full entry fails, passed or not', () => {
  for (const status of ['passed', 'failed', 'skipped']) {
    const r = judge(compact(everyone, { tests: [{ file: 'tests/b.test.js', name: 'rejects an invalid payment', status }] }));
    assert.match(r.errors.join(' | '), /tests\/b\.test\.js \/ rejects an invalid payment is in both execution\.passed and execution\.tests: list each test once/, status);
    assert.match(r.errors.join(' | '), /required test did not run exactly once and pass: tests\/b\.test\.js \/ rejects an invalid payment/, `the gate's own count too (${status})`);
  }
});

test('MAINT-0023 P7: a name repeated in the compact list fails', () => {
  const r = judge(compact({ ...everyone, 'tests/a.test.js': [...everyone['tests/a.test.js'], 'accepts a valid payment'] }));
  assert.match(r.errors.join(' | '), /tests\/a\.test\.js \/ accepts a valid payment is listed more than once in execution\.passed/);
  assert.match(r.errors.join(' | '), /required test did not run exactly once and pass: tests\/a\.test\.js \/ accepts a valid payment/);
  // A repeated name that no test maps is refused too: nothing about the list is left unchecked.
  assert.match(judge(compact({ ...everyone, 'tests/c.test.js': ['x', 'x'] })).errors.join(' | '), /tests\/c\.test\.js \/ x is listed more than once in execution\.passed/);
});

test('MAINT-0023 P7: failed, skipped and pending tests keep their full entries', () => {
  const pending = new Map([['AC-001-1', ['T-0002']]]);
  const compactWith = status => compact({ 'tests/a.test.js': ['rejects an invalid payment'], 'tests/b.test.js': everyone['tests/b.test.js'] }, { tests: [{ file: 'tests/a.test.js', name: 'accepts a valid payment', status }] });
  for (const status of ['failed', 'skipped']) {
    const r = judge(compactWith(status), { pending });
    assert.deepEqual(r.errors, [], status);
    assert.equal(r.pending.length, 1, 'the pending test is noted, as in the full form');
  }
  // A pending test left out of both forms did not run.
  assert.match(judge(compact({ 'tests/b.test.js': everyone['tests/b.test.js'], 'tests/a.test.js': ['rejects an invalid payment'] }), { pending }).errors.join(' | '), /pending test did not run exactly once with a reported result/);
  // Where nothing is pending, a failed test fails the evidence.
  assert.match(judge(compactWith('failed')).errors.join(' | '), /required test did not run exactly once and pass/);
});

test('MAINT-0023 P7: the compact block is well formed, and names its run once', () => {
  const errors = x => judge(x).errors.join(' | ');
  assert.match(errors({ revision: 'candidate', passed: everyone }), /execution\.run must be an https reference to the run that passed the listed tests, given once/);
  assert.match(errors(compact(everyone, { run: 'the CI job' })), /execution\.run must be an https reference/);
  assert.match(errors(compact(['a'])), /execution\.passed must map each test file to the list of the names of its passing tests/);
  assert.match(errors(compact({ 'tests/a.test.js': 'rejects' })), /execution\.passed must map each test file to the list of the names of its passing tests/);
  assert.match(errors(compact({ 'tests/a.test.js': [''] })), /execution\.passed must map each test file to the list of the names of its passing tests/);
  assert.match(errors(compact({ 'tests/a.test.js': [{ name: 'x' }] })), /execution\.passed must map each test file/);
  assert.match(errors({ ...compact(everyone), tests: 'none' }), /execution evidence is missing or names a different candidate revision/);
  // Neither form at all is still a missing execution.
  assert.match(errors({ revision: 'candidate' }), /execution evidence is missing or names a different candidate revision/);
  // The run is for this block only: no run is needed for the full form.
  assert.deepEqual(judge({ revision: 'candidate', tests: mapped.map(m => ({ file: m.file, name: m.name, status: 'passed' })) }).errors, []);
});

test('MAINT-0023 P7: the expansion reads nothing but the compact fields, and leaves a receipt\'s execution as it is', () => {
  const full = { revision: 'candidate', tests: [{ file: 'tests/a.test.js', name: 'x', status: 'passed' }] };
  assert.deepEqual(expandExecution(full), { execution: full, errors: [] });
  assert.deepEqual(expandExecution(undefined), { execution: undefined, errors: [] });
  const expanded = expandExecution(compact({ 'tests/a.test.js': ['x', 'y'] }, { tests: [{ file: 'tests/b.test.js', name: 'z', status: 'failed' }] })).execution;
  assert.deepEqual(expanded.tests, [{ file: 'tests/b.test.js', name: 'z', status: 'failed' }, { file: 'tests/a.test.js', name: 'x', status: 'passed' }, { file: 'tests/a.test.js', name: 'y', status: 'passed' }]);
  assert.equal(expanded.revision, 'candidate');
});

// The endpoint: `wf ci` with the pull request description's evidence, as the CI job runs it.
const automated = ({ edit, write }) => {
  edit('docs/workflow/acceptance.json', x => x.replace('inspection', 'automated'));
  write('tests/acceptance-map.json', JSON.stringify(mapped.map(m => ({ ...m, acceptance: 'AC-001-1' }))));
  write('tests/a.test.js', 'the tests\n'); write('tests/b.test.js', 'the tests\n');
};
function ciWith(t, execution) {
  const p = project(t, { baselineEdit: automated });
  p.write('src/a.js', 'export const result = 1;\n'); const head = p.commit('T-0001: the work');
  const e = evidence(head); e.verification.execution = { revision: head, ...execution };
  const r = p.run(['ci', '--baseline', p.baseline, '--candidate', head, '--task', 'T-0001'], { evidence: e });
  return { ...r, findings: r.out?.findings.join(' | ') ?? r.stdout + r.stderr };
}

test('MAINT-0023 P7: wf ci accepts a compact block that names every mapped test', t => {
  const r = ciWith(t, { run: RUN, passed: everyone });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.doesNotMatch(r.findings, /required test|execution/);
});

test('MAINT-0023 P7: wf ci refuses a compact block with a test missing, repeated or named twice', t => {
  const missing = ciWith(t, { run: RUN, passed: { 'tests/a.test.js': ['rejects an invalid payment'], 'tests/b.test.js': everyone['tests/b.test.js'] } });
  assert.equal(missing.status, 1, missing.stdout + missing.stderr);
  assert.match(missing.findings, /required test did not run exactly once and pass: tests\/a\.test\.js \/ accepts a valid payment/);
  const repeated = ciWith(t, { run: RUN, passed: { ...everyone, 'tests/b.test.js': ['rejects an invalid payment', 'rejects an invalid payment'] } });
  assert.equal(repeated.status, 1, repeated.stdout + repeated.stderr);
  assert.match(repeated.findings, /tests\/b\.test\.js \/ rejects an invalid payment is listed more than once in execution\.passed/);
  const twice = ciWith(t, { run: RUN, passed: everyone, tests: [{ file: 'tests/b.test.js', name: 'rejects an invalid payment', status: 'passed' }] });
  assert.equal(twice.status, 1, twice.stdout + twice.stderr);
  assert.match(twice.findings, /is in both execution\.passed and execution\.tests/);
  const failed = ciWith(t, { run: RUN, passed: { 'tests/a.test.js': ['rejects an invalid payment'], 'tests/b.test.js': everyone['tests/b.test.js'] }, tests: [{ file: 'tests/a.test.js', name: 'accepts a valid payment', status: 'failed' }] });
  assert.equal(failed.status, 1, failed.stdout + failed.stderr);
  const noRun = ciWith(t, { passed: everyone });
  assert.equal(noRun.status, 1, noRun.stdout + noRun.stderr);
  assert.match(noRun.findings, /execution\.run must be an https reference/);
});

test('MAINT-0023 P7: the full form is still accepted by wf ci', t => {
  const r = ciWith(t, { tests: mapped.map(m => ({ file: m.file, name: m.name, status: 'passed' })) });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

// `wf evidence` writes the compact form, with the run left for the agent to name.
const fixture = fileURLToPath(new URL('../../fixtures/04a-accepted-decision-permits/baseline', import.meta.url));
test('MAINT-0023 P7: wf evidence writes the compact form, and the gate refuses it until the run is named', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-compact-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.cpSync(fixture, dir, { recursive: true });
  const git = (...args) => { const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'tests/acceptance-map.json'), JSON.stringify([{ acceptance: 'AC-001-1', file: 'tests/a.test.js', name: 'works' }, { acceptance: 'AC-001-1', file: 'tests/a.test.js', name: 'also works' }, { acceptance: 'AC-009-1', file: 'tests/z.test.js', name: 'other' }]));
  git('init', '-q', '-b', 'main'); git('config', 'user.name', 'T'); git('config', 'user.email', 't@example.invalid');
  git('add', '-A'); git('commit', '-qm', 'base'); const base = git('rev-parse', 'HEAD');
  fs.writeFileSync(path.join(dir, 'src.js'), 'x\n'); git('add', '-A'); git('commit', '-qm', 'T-0001: work'); const head = git('rev-parse', 'HEAD');
  const r = spawnSync(process.execPath, [cli, 'evidence', '--repo', dir, '--baseline', base, '--candidate', head, '--task', 'T-0001'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(r.stdout.startsWith(DELIVERY_MARKER));
  const e = parseDeliveryEvidence(r.stdout);
  assert.deepEqual(e.verification.execution, { revision: head, run: '', passed: { 'tests/a.test.js': ['works', 'also works'] }, tests: [] });
  assert.match(r.stderr, /execution lists the task's mapped tests as passed under their files: name the run in run, and move any test that did not pass to tests with its status/);
});
