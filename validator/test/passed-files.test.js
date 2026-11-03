import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAcceptance, expandExecution } from '../lib/acceptance.js';
import { DELIVERY_MARKER, parseDeliveryEvidence } from '../lib/delivery-evidence.js';
import { evidence, project } from './helpers/maint-0018.js';

// v2.17.0: `execution.passed_files` lists a file whose mapped tests all ran once and passed by its name alone, because a large acceptance
// map named test by test passes the 128 KiB cap on the pull request description (mateen-systems: 806 mapped tests, names alone 137,251 bytes).
// It is expanded against the acceptance map exactly as `passed` is, and the gate still requires every mapped test exactly once.
const RUN = 'https://github.com/o/r/actions/runs/42';
const mapped = [
  { acceptance: 'AC-001-1', file: 'tests/a.test.js', name: 'rejects an invalid payment' },
  { acceptance: 'AC-001-1', file: 'tests/a.test.js', name: 'accepts a valid payment' },
  { acceptance: 'AC-001-1', file: 'tests/b.test.js', name: 'rejects an invalid payment' },
];
const definition = { examples: [{ id: 'AC-001-1', requirement: 'docs/specs/payment.md', method: 'automated' }] };
const source = (entries, name = 'candidate') => ({ name, read: p => entries[p] ?? null, exists: p => p in entries });
function judge(execution, { maps = mapped, pending = new Map() } = {}) {
  const files = { 'docs/specs/payment.md': 'Approved behaviour', ...Object.fromEntries([...new Set(maps.map(m => m.file))].map(f => [f, 'x'])) };
  const baseline = source({ ...files, 'docs/workflow/acceptance.json': JSON.stringify(definition), 'tests/acceptance-map.json': JSON.stringify(maps) }, 'baseline');
  const candidate = source({ ...files, 'tests/acceptance-map.json': JSON.stringify(maps) });
  const expanded = expandExecution(execution, maps);
  const result = evaluateAcceptance({ baseline, candidate, execution: expanded.execution, requiredIds: ['AC-001-1'], pending });
  return { errors: [...expanded.errors, ...result.errors], pending: result.pending, execution: expanded.execution };
}
const files = (passed_files, more = {}) => ({ revision: 'candidate', run: RUN, passed_files, ...more });
const errorsOf = (x, o) => judge(x, o).errors.join(' | ');

test('passed_files: every mapped test of the listed files passes, alone or with passed and tests', () => {
  assert.deepEqual(judge(files(['tests/a.test.js', 'tests/b.test.js'])).errors, []);
  // Beside `passed` for other files, and beside full entries for other tests.
  assert.deepEqual(judge(files(['tests/a.test.js'], { passed: { 'tests/b.test.js': ['rejects an invalid payment'] } })).errors, []);
  assert.deepEqual(judge(files(['tests/a.test.js'], { tests: [{ file: 'tests/b.test.js', name: 'rejects an invalid payment', status: 'passed' }] })).errors, []);
  // An empty list is the same as none.
  assert.deepEqual(judge(files([], { passed: { 'tests/a.test.js': ['rejects an invalid payment', 'accepts a valid payment'], 'tests/b.test.js': ['rejects an invalid payment'] } })).errors, []);
  // The expansion is one passed entry per mapped (file, name); the same name in another file is another test.
  assert.deepEqual(judge(files(['tests/a.test.js'])).execution.tests, [
    { file: 'tests/a.test.js', name: 'rejects an invalid payment', status: 'passed' }, { file: 'tests/a.test.js', name: 'accepts a valid payment', status: 'passed' }]);
});

test('passed_files: a file left out leaves its tests unrun, and only the listed file stands for its tests', () => {
  const r = errorsOf(files(['tests/a.test.js']));
  assert.match(r, /required test did not run exactly once and pass: tests\/b\.test\.js \/ rejects an invalid payment/);
  assert.doesNotMatch(r, /tests\/a\.test\.js/);
  assert.match(errorsOf(files([])), /required test did not run exactly once and pass: tests\/a\.test\.js \/ accepts a valid payment/);
});

test('passed_files: a file that is not in the acceptance map is refused', () => {
  assert.match(errorsOf(files(['tests/a.test.js', 'tests/b.test.js', 'tests/c.test.js'])), /tests\/c\.test\.js is in execution\.passed_files but has no mapped test in tests\/acceptance-map\.json/);
  assert.match(errorsOf(files(['tests/a.test.js', 'tests/b.test.js', 'tests/A.test.js'])), /tests\/A\.test\.js is in execution\.passed_files but has no mapped test/);
});

test('passed_files: a test listed through the file and in passed is refused', () => {
  const r = errorsOf(files(['tests/a.test.js', 'tests/b.test.js'], { passed: { 'tests/a.test.js': ['accepts a valid payment'] } }));
  assert.match(r, /tests\/a\.test\.js \/ accepts a valid payment is in both execution\.passed_files and execution\.passed: list each test once/);
});

test('passed_files: a file with a mapped test in tests is refused, whatever its status (pending, failed, skipped, even passed)', () => {
  for (const status of ['passed', 'failed', 'skipped']) {
    const r = judge(files(['tests/a.test.js', 'tests/b.test.js'], { tests: [{ file: 'tests/a.test.js', name: 'accepts a valid payment', status }] }), { pending: new Map([['AC-001-1', ['T-0002']]]) });
    assert.match(r.errors.join(' | '), /tests\/a\.test\.js \/ accepts a valid payment is in both execution\.passed_files and execution\.tests: list each test once/, status);
  }
  // The way to report a pending test in a file: its other tests under passed, the pending one in tests.
  const ok = judge(files(['tests/b.test.js'], { passed: { 'tests/a.test.js': ['rejects an invalid payment'] }, tests: [{ file: 'tests/a.test.js', name: 'accepts a valid payment', status: 'failed' }] }), { pending: new Map([['AC-001-1', ['T-0002']]]) });
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.pending.length, 1);
  // A failed test of a file that is not listed still fails where nothing is pending.
  assert.match(errorsOf(files(['tests/b.test.js'], { passed: { 'tests/a.test.js': ['rejects an invalid payment'] }, tests: [{ file: 'tests/a.test.js', name: 'accepts a valid payment', status: 'failed' }] })), /required test did not run exactly once and pass/);
});

test('passed_files: a file listed twice, a bad list and a missing run are refused', () => {
  assert.match(errorsOf(files(['tests/a.test.js', 'tests/b.test.js', 'tests/a.test.js'])), /tests\/a\.test\.js is listed more than once in execution\.passed_files/);
  for (const bad of ['tests/a.test.js', [''], [1], [['tests/a.test.js']], { 'tests/a.test.js': true }, null]) {
    assert.match(errorsOf(files(bad)), /execution\.passed_files must be a list of test files/, JSON.stringify(bad));
  }
  assert.match(errorsOf({ revision: 'candidate', passed_files: ['tests/a.test.js', 'tests/b.test.js'] }), /execution\.run must be an https reference/);
  assert.match(errorsOf(files(['tests/a.test.js', 'tests/b.test.js'], { run: 'the CI job' })), /execution\.run must be an https reference/);
  // No run is asked for when nothing is listed as passing.
  assert.doesNotMatch(errorsOf({ revision: 'candidate', passed_files: [], tests: mapped.map(m => ({ file: m.file, name: m.name, status: 'passed' })) }), /run must be/);
});

test('passed_files: without a readable acceptance map it cannot be expanded', () => {
  for (const maps of [undefined, null, 'x', {}]) {
    assert.match(expandExecution(files(['tests/a.test.js']), maps).errors.join(' | '), /execution\.passed_files cannot be expanded: tests\/acceptance-map\.json is missing or unreadable/);
  }
  // An execution without it needs no map.
  assert.deepEqual(expandExecution({ revision: 'c', run: RUN, passed: { 'tests/a.test.js': ['x'] } }).errors, []);
});

test('passed_files: an execution without it expands as before, and the full form is untouched', () => {
  const full = { revision: 'candidate', tests: [{ file: 'tests/a.test.js', name: 'x', status: 'passed' }] };
  assert.deepEqual(expandExecution(full, mapped), { execution: full, errors: [] });
  const r = expandExecution(files(['tests/a.test.js']), mapped).execution;
  assert.equal(Object.hasOwn(r, 'passed_files'), false);
  assert.equal(r.revision, 'candidate');
});

// The reported case: 806 mapped tests across files, names averaging 170 bytes (137,251 bytes in all), against the description's 128 KiB cap.
const FILES = 40, TESTS = 806;
const big = Array.from({ length: TESTS }, (_, i) => ({ acceptance: 'AC-001-1', file: `tests/area-${String(i % FILES).padStart(2, '0')}.test.js`, name: `${String(i).padStart(3, '0')} ${'behaves as the approved acceptance scenario requires in this case '.repeat(3)}`.slice(0, 170) }));
const bigFiles = [...new Set(big.map(m => m.file))];
const byFile = Object.fromEntries(bigFiles.map(f => [f, big.filter(m => m.file === f).map(m => m.name)]));
const marked = execution => `${DELIVERY_MARKER}\n${JSON.stringify({ execution })}`;

test('passed_files: 806 mapped tests across files fit well under 128 KiB, where naming each one does not', () => {
  assert.ok(Buffer.byteLength(JSON.stringify(byFile)) > 128 * 1024, 'the names alone are over the cap');
  assert.throws(() => parseDeliveryEvidence(marked({ revision: 'candidate', run: RUN, passed: byFile })), /delivery evidence is larger than 128 KiB/);
  const compact = marked({ revision: 'candidate', run: RUN, passed_files: bigFiles });
  assert.ok(Buffer.byteLength(compact) < 4 * 1024, `${Buffer.byteLength(compact)} bytes`);
  const parsed = parseDeliveryEvidence(compact);
  const r = judge(parsed.execution, { maps: big });
  assert.deepEqual(r.errors, []);
  assert.equal(r.execution.tests.length, TESTS);
  // One file short leaves exactly its tests unrun.
  const short = judge({ ...parsed.execution, passed_files: bigFiles.slice(1) }, { maps: big });
  assert.equal(short.errors.length, byFile[bigFiles[0]].length);
  assert.ok(short.errors.every(e => e.startsWith('required test did not run exactly once and pass: ' + bigFiles[0])));
});

// The endpoint: `wf ci` with the evidence as a file, which goes through the same cap.
function ciWith(t, maps, execution) {
  const p = project(t, { baselineEdit: ({ edit, write }) => {
    edit('docs/workflow/acceptance.json', x => x.replace('inspection', 'automated'));
    write('tests/acceptance-map.json', JSON.stringify(maps));
    for (const f of new Set(maps.map(m => m.file))) write(f, 'the tests\n');
  } });
  p.write('src/a.js', 'export const result = 1;\n'); const head = p.commit('T-0001: the work');
  const e = evidence(head); e.verification.execution = { revision: head, ...execution };
  const r = p.run(['ci', '--baseline', p.baseline, '--candidate', head, '--task', 'T-0001'], { evidence: e });
  return { ...r, findings: r.out?.findings.join(' | ') ?? r.stdout + r.stderr };
}

test('passed_files: wf ci passes 806 mapped tests listed by file, and refuses the same listed by name', t => {
  const named = ciWith(t, big, { run: RUN, passed: byFile });
  // The cap stays: the by-name evidence is refused as a file over 128 KiB (the run exits 2).
  assert.equal(named.status, 2, named.stdout + named.stderr);
  assert.match(named.findings, /under 128 KiB/);
  const r = ciWith(t, big, { run: RUN, passed_files: bigFiles });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.doesNotMatch(r.findings, /required test|execution/);
});

test('passed_files: wf ci refuses a file outside the map, a file short, and a test named twice', t => {
  const outside = ciWith(t, mapped.map(m => ({ ...m })), { run: RUN, passed_files: ['tests/a.test.js', 'tests/b.test.js', 'tests/z.test.js'] });
  assert.equal(outside.status, 1, outside.stdout + outside.stderr);
  assert.match(outside.findings, /tests\/z\.test\.js is in execution\.passed_files but has no mapped test/);
  const short = ciWith(t, mapped, { run: RUN, passed_files: ['tests/a.test.js'] });
  assert.equal(short.status, 1, short.stdout + short.stderr);
  assert.match(short.findings, /required test did not run exactly once and pass: tests\/b\.test\.js \/ rejects an invalid payment/);
  const twice = ciWith(t, mapped, { run: RUN, passed_files: ['tests/a.test.js', 'tests/b.test.js'], passed: { 'tests/b.test.js': ['rejects an invalid payment'] } });
  assert.equal(twice.status, 1, twice.stdout + twice.stderr);
  assert.match(twice.findings, /is in both execution\.passed_files and execution\.passed/);
  const ok = ciWith(t, mapped, { run: RUN, passed_files: ['tests/a.test.js', 'tests/b.test.js'] });
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
});
