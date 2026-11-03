import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { evaluateAcceptance, expandExecution } from '../lib/acceptance.js';
import { mapAtRevision } from '../lib/ci.js';
import { dirSource, gitSource } from '../lib/sources.js';
import { DELIVERY_MARKER, parseDeliveryEvidence } from '../lib/delivery-evidence.js';
import { evidence, project } from './helpers/maint-0018.js';

// v2.17.0: `execution.passed_files` lists a file whose mapped tests all ran once and passed by its name alone, because a large acceptance
// map named test by test passes the 128 KiB cap on the pull request description (mateen-systems: 806 mapped tests, names alone 137,251 bytes).
// It is expanded against the acceptance map AT THE RUN'S REVISION exactly as `passed` is, and the gate still requires every mapped test exactly once.
// A file means "every mapped test in it passed, except the ones named in execution.tests" (a pending or failing test is named there in full).
const RUN = 'https://github.com/o/r/actions/runs/42';
const mapped = [
  { acceptance: 'AC-001-1', file: 'tests/a.test.js', name: 'rejects an invalid payment' },
  { acceptance: 'AC-001-1', file: 'tests/a.test.js', name: 'accepts a valid payment' },
  { acceptance: 'AC-001-1', file: 'tests/b.test.js', name: 'rejects an invalid payment' },
];
const definitionOf = maps => ({ examples: [...new Set(maps.map(m => m.acceptance))].map(id => ({ id, requirement: 'docs/specs/payment.md', method: 'automated' })) });
const source = (entries, name = 'candidate') => ({ name, read: p => entries[p] ?? null, exists: p => p in entries });
// `ranMaps`: the map at the revision the run was of (what ci.js expands against); `maps`: the candidate's own map. They differ for a carried-over run.
function judge(execution, { maps = mapped, ranMaps = maps, pending = new Map(), carriedFrom = null } = {}) {
  const present = { 'docs/specs/payment.md': 'Approved behaviour', ...Object.fromEntries([...new Set(maps.map(m => m.file))].map(f => [f, 'x'])) };
  const baseline = source({ ...present, 'docs/workflow/acceptance.json': JSON.stringify(definitionOf(maps)), 'tests/acceptance-map.json': JSON.stringify(maps) }, 'baseline');
  const candidate = source({ ...present, 'tests/acceptance-map.json': JSON.stringify(maps) });
  const expanded = expandExecution(execution, ranMaps);
  const result = evaluateAcceptance({ baseline, candidate, execution: expanded.execution, requiredIds: [...new Set(maps.map(m => m.acceptance))], pending, carriedFrom });
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

test('passed_files: a test named in tests is excepted from its file, whatever its status, and counts once', () => {
  const waiting = { pending: new Map([['AC-001-1', ['T-0002']]]) };
  const named = status => ({ tests: [{ file: 'tests/a.test.js', name: 'accepts a valid payment', status }] });
  // The file stands for its other tests; the named one keeps its own entry and status, as the full form always had it.
  const ok = judge(files(['tests/a.test.js', 'tests/b.test.js'], named('failed')), waiting);
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.pending.length, 1);
  assert.equal(ok.pending[0].name, 'accepts a valid payment');
  assert.deepEqual(ok.execution.tests.filter(t => t.file === 'tests/a.test.js').map(t => [t.name, t.status]), [['accepts a valid payment', 'failed'], ['rejects an invalid payment', 'passed']]);
  for (const status of ['skipped', 'passed']) assert.deepEqual(judge(files(['tests/a.test.js', 'tests/b.test.js'], named(status)), waiting).errors, [], status);
  // A named test that did not pass still fails where nothing is pending (it is not covered by its file).
  assert.match(errorsOf(files(['tests/a.test.js', 'tests/b.test.js'], named('failed'))), /required test did not run exactly once and pass: tests\/a\.test\.js \/ accepts a valid payment/);
  // Named twice in tests: the full form's count refuses it, as before.
  const twice = { tests: [...named('failed').tests, ...named('failed').tests] };
  assert.match(errorsOf(files(['tests/a.test.js', 'tests/b.test.js'], twice), waiting), /pending test did not run exactly once.*accepts a valid payment/);
  // A test in both passed and a listed file is still refused: passed does not name an exception.
  assert.match(errorsOf(files(['tests/a.test.js', 'tests/b.test.js'], { passed: { 'tests/a.test.js': ['accepts a valid payment'] } })), /is in both execution\.passed_files and execution\.passed/);
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
  for (const maps of [undefined, null, 'x', {}, [null], [1]]) {
    assert.match(expandExecution(files(['tests/a.test.js']), maps).errors.join(' | '), /execution\.passed_files cannot be expanded: tests\/acceptance-map\.json is missing, unreadable or malformed/);
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

// The reported case (mateen-systems, task 174): 806 mapped tests over 40 files, names totalling 137,251 bytes against the description's 128 KiB cap,
// 182 of them pending (reported failed, spread over most files, 4-5 a file) and the other 624 passing. (The report said 625 passed and 182 pending, which is 807;
// the map holds 806.)
const FILES = 40, TESTS = 806, PENDING = 182, NAME_BYTES = 137251;
const stem = 'behaves as the approved acceptance scenario requires in this case '.repeat(3);
const fileOf = i => `tests/area-${String(i % FILES).padStart(2, '0')}.test.js`;
const pendingPerFile = f => (f < 22 ? 5 : 4); // 22 x 5 + 18 x 4 = 182
const big = Array.from({ length: TESTS }, (_, i) => ({ acceptance: 'AC-001-1', file: fileOf(i), name: `${String(i).padStart(3, '0')} ${stem}`.slice(0, i < NAME_BYTES - 170 * TESTS ? 171 : 170) }));
const bigFiles = [...new Set(big.map(m => m.file))];
const ofFile = f => big.filter(m => m.file === f);
// The first pendingPerFile tests of each file are pending: their scenario is AC-002-1, which waits for another task.
for (const f of bigFiles) ofFile(f).slice(0, pendingPerFile(bigFiles.indexOf(f))).forEach(m => { m.acceptance = 'AC-002-1'; });
const pendingTests = big.filter(m => m.acceptance === 'AC-002-1'), passingTests = big.filter(m => m.acceptance === 'AC-001-1');
const asEntry = m => ({ file: m.file, name: m.name, status: 'failed' });
const byFile = Object.fromEntries(bigFiles.map(f => [f, ofFile(f).filter(m => m.acceptance === 'AC-001-1').map(m => m.name)]));
const waitingOnTask = new Map([['AC-002-1', ['T-0002']]]);
const marked = execution => `${DELIVERY_MARKER}\n${JSON.stringify({ execution })}`;

test('passed_files: the reported 806 mapped tests with 182 pending, spread over the files, fit well under 128 KiB, where naming each one does not', () => {
  assert.equal(big.reduce((n, m) => n + Buffer.byteLength(m.name), 0), NAME_BYTES);
  assert.deepEqual([pendingTests.length, passingTests.length], [PENDING, TESTS - PENDING]);
  assert.ok(bigFiles.every(f => ofFile(f).some(m => m.acceptance === 'AC-002-1')), 'every file holds a pending test');
  // By name (the compact form with every passing test under its file) the evidence is over the cap.
  assert.throws(() => parseDeliveryEvidence(marked({ revision: 'candidate', run: RUN, passed: byFile, tests: pendingTests.map(asEntry) })), /delivery evidence is larger than 128 KiB/);
  // By file, the pending tests named in full in tests: the files stand for the 624 others.
  const compact = marked({ revision: 'candidate', run: RUN, passed_files: bigFiles, tests: pendingTests.map(asEntry) });
  const size = Buffer.byteLength(compact);
  // Measured 43,340 bytes (42.3 KiB): the 182 pending entries in full are nearly all of it; the 624 passing tests cost the 40 file names.
  assert.ok(size < 64 * 1024, `${size} bytes`);
  assert.equal(size, 43340);
  const parsed = parseDeliveryEvidence(compact);
  const r = judge(parsed.execution, { maps: big, pending: waitingOnTask });
  assert.deepEqual(r.errors, []);
  assert.equal(r.execution.tests.length, TESTS);
  assert.equal(r.pending.length, PENDING);
  // One file short leaves exactly its passing tests unrun.
  const short = judge({ ...parsed.execution, passed_files: bigFiles.slice(1) }, { maps: big, pending: waitingOnTask });
  assert.equal(short.errors.length, byFile[bigFiles[0]].length);
  assert.ok(short.errors.every(e => e.startsWith('required test did not run exactly once and pass: ' + bigFiles[0])));
  // A test the evidence does not name in tests is one its file reports as passed, as a test missing from `passed` would be one not reported: the evidence is the agent's claim either way.
  const unnamed = judge({ ...parsed.execution, tests: parsed.execution.tests.slice(1) }, { maps: big, pending: waitingOnTask });
  assert.deepEqual(unnamed.errors, []);
});

test('passed_files: a test mapped after the run stays unrun, for a verification carried over (the map is read at the run\'s revision)', () => {
  const later = [...mapped, { acceptance: 'AC-001-1', file: 'tests/a.test.js', name: 'added on the trusted branch' }];
  const execution = files(['tests/a.test.js', 'tests/b.test.js'], { revision: 'earlier' });
  // The map at the run's revision: the added test is not in it, so it is not expanded, and the carried-over gate fails it as it fails `passed`.
  const r = judge(execution, { maps: later, ranMaps: mapped, carriedFrom: 'earlier' });
  assert.match(r.errors.join(' | '), /required test did not run exactly once and pass: tests\/a\.test\.js \/ added on the trusted branch/);
  assert.equal(r.errors.length, 1);
  // The candidate's own map would have passed it: the bug this closes.
  assert.deepEqual(judge(execution, { maps: later, ranMaps: later, carriedFrom: 'earlier' }).errors, []);
  // Honest, same revision: the map at the run is the candidate's.
  assert.deepEqual(judge(files(['tests/a.test.js', 'tests/b.test.js']), { maps: later }).errors, []);
});

test('passed_files: mapAtRevision reads the map at the revision of the run, and fails closed where it cannot', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-passed-files-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => { const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  const commit = (map, m) => { fs.mkdirSync(path.join(dir, 'tests'), { recursive: true }); if (map === undefined) fs.rmSync(path.join(dir, 'tests/acceptance-map.json'), { force: true }); else fs.writeFileSync(path.join(dir, 'tests/acceptance-map.json'), map); git('add', '-A'); git('commit', '-qm', m, '--allow-empty'); return git('rev-parse', 'HEAD'); };
  git('init', '-q', '-b', 'main'); git('config', 'user.name', 'T'); git('config', 'user.email', 't@example.invalid');
  const later = [...mapped, { acceptance: 'AC-001-1', file: 'tests/a.test.js', name: 'added later' }];
  const nomap = commit(undefined, 'no map yet'), earlier = commit(JSON.stringify(mapped), 'the run was of this'), bad = commit('{not json', 'malformed'), head = commit(JSON.stringify(later), 'the candidate');
  const candidate = gitSource(dir, head);
  assert.deepEqual(mapAtRevision(candidate, head), later);
  assert.deepEqual(mapAtRevision(candidate, earlier), mapped);
  for (const revision of [nomap, bad, 'a'.repeat(40), 'earlier', undefined, null, 7, 'main']) assert.equal(mapAtRevision(candidate, revision), null, String(revision));
  // A directory has no history: only its own state.
  fs.writeFileSync(path.join(dir, 'tests/acceptance-map.json'), JSON.stringify(mapped));
  const here = dirSource(dir);
  assert.deepEqual(mapAtRevision(here, here.name), mapped);
  assert.equal(mapAtRevision(here, earlier), null);
  // The end result: the run of `earlier` does not cover the test mapped since.
  const r = judge(files(['tests/a.test.js', 'tests/b.test.js'], { revision: earlier }), { maps: later, ranMaps: mapAtRevision(candidate, earlier), carriedFrom: earlier });
  assert.match(r.errors.join(' | '), /added later/);
  // No readable map at the run: refused, not guessed.
  assert.match(expandExecution(files(['tests/a.test.js'], { revision: nomap }), mapAtRevision(candidate, nomap)).errors.join(' | '), /cannot be expanded: tests\/acceptance-map\.json is missing, unreadable or malformed/);
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
  const all = big.map(m => ({ ...m, acceptance: 'AC-001-1' }));
  const names = Object.fromEntries(bigFiles.map(f => [f, all.filter(m => m.file === f).map(m => m.name)]));
  const named = ciWith(t, all, { run: RUN, passed: names });
  // The cap stays: the by-name evidence is refused as a file over 128 KiB (the run exits 2).
  assert.equal(named.status, 2, named.stdout + named.stderr);
  assert.match(named.findings, /under 128 KiB/);
  const r = ciWith(t, all, { run: RUN, passed_files: bigFiles });
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

test('passed_files: wf ci excepts a named test from its file, and refuses an expansion where the map at the run cannot be read', t => {
  const failed = ciWith(t, mapped, { run: RUN, passed_files: ['tests/a.test.js', 'tests/b.test.js'], tests: [{ file: 'tests/a.test.js', name: 'accepts a valid payment', status: 'failed' }] });
  assert.equal(failed.status, 1, failed.stdout + failed.stderr);
  assert.match(failed.findings, /required test did not run exactly once and pass: tests\/a\.test\.js \/ accepts a valid payment/);
  assert.doesNotMatch(failed.findings, /rejects an invalid payment/);
  // The run was of a revision the repository does not hold: no map there, so nothing is guessed from the candidate's.
  const elsewhere = ciWith(t, mapped, { run: RUN, revision: 'a'.repeat(40), passed_files: ['tests/a.test.js', 'tests/b.test.js'] });
  assert.equal(elsewhere.status, 1, elsewhere.stdout + elsewhere.stderr);
  assert.match(elsewhere.findings, /execution\.passed_files cannot be expanded: tests\/acceptance-map\.json is missing, unreadable or malformed/);
});
