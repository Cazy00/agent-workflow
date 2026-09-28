import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { evaluateAcceptance } from '../lib/acceptance.js';
import { gitSource } from '../lib/sources.js';
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
test('a map that existed on the baseline and was removed still fails closed; one never there does not', t => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-map-'));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  const git = (...args) => { const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true }); fs.writeFileSync(path.join(repo, rel), text); };
  git('init', '-q'); git('config', 'user.email', 'fixture@example.invalid'); git('config', 'user.name', 'fixture');
  write('docs/workflow/acceptance.json', JSON.stringify(definition)); write('docs/specs/payment.md', 'spec'); write('test/payment.js', 'test');
  git('add', '-A'); git('commit', '-qm', 'no map yet');
  const never = git('rev-parse', 'HEAD');
  write('tests/acceptance-map.json', JSON.stringify(mapping)); git('add', '-A'); git('commit', '-qm', 'map');
  git('rm', '-q', 'tests/acceptance-map.json'); git('commit', '-qm', 'map removed');
  const removed = git('rev-parse', 'HEAD');
  const candidate = source({ 'tests/acceptance-map.json': '[]' });
  const run = rev => evaluateAcceptance({ baseline: gitSource(repo, rev), candidate, execution: { revision: 'candidate', tests: [] } });
  assert.deepEqual(run(never).errors, []);
  assert.match(run(removed).errors.join(' '), /tests\/acceptance-map\.json: missing/);
});

const renamed = { ...mapping[0], file: 'test/renamed.js', name: 'reject invalid payment after rename' };
const grant = { task: 'T-0001', from: mapping[0], to: renamed, requirement: 'docs/specs/payment.md' };
function migrationCase({ declarations = [grant], candidateDeclarations, old = mapping, maps = [renamed], task = 'T-0001', tests, enforced = false } = {}) {
  const baseline = source({
    'docs/workflow/acceptance.json': JSON.stringify({ ...definition, mapping_migrations: declarations }),
    'docs/specs/payment.md': 'approved requirement',
    'tests/acceptance-map.json': JSON.stringify(old),
  }, 'baseline');
  const candidate = source({
    'docs/workflow/acceptance.json': JSON.stringify({ ...definition, mapping_migrations: candidateDeclarations }),
    'tests/acceptance-map.json': JSON.stringify(maps),
    'test/payment.js': 'old test',
    'test/renamed.js': 'new test',
  });
  return evaluateAcceptance({ baseline, candidate, task, requiredIds: ['AC-001-1'], enforced,
    execution: enforced ? undefined : { revision: 'candidate', tests: tests ?? maps.map(m => ({ ...m, status: 'passed' })) } });
}
test('a baseline-approved exact rename for the current task passes with one successful new test run', () => {
  assert.equal(migrationCase().ok, true);
  assert.match(migrationCase({ tests: [] }).errors.join(' '), /did not run exactly once and pass/);
  assert.match(migrationCase({ tests: [{ ...renamed, status: 'passed' }, { ...renamed, status: 'passed' }] }).errors.join(' '), /did not run exactly once and pass/);
  assert.match(migrationCase({ tests: [{ ...renamed, status: 'skipped' }] }).errors.join(' '), /did not run exactly once and pass/);
});
test('wrong task and candidate-only declarations cannot remove a baseline mapping', () => {
  assert.match(migrationCase({ task: 'T-0002' }).errors.join(' '), /removed required mapping/);
  assert.match(migrationCase({ declarations: [], candidateDeclarations: [grant] }).errors.join(' '), /removed required mapping/);
});
test('a migration permits only its exact pair and never an unrelated removal', () => {
  const other = { ...mapping[0], name: 'another required scenario' };
  assert.match(migrationCase({ old: [mapping[0], other] }).errors.join(' '), /removed required mapping/);
  assert.match(migrationCase({ maps: [{ ...renamed, name: 'different name' }] }).errors.join(' '), /destination mapping is missing/);
  assert.match(migrationCase({ maps: [] }).errors.join(' '), /destination mapping is missing/);
});
test('malformed, unsafe and non-automated grants fail closed even when otherwise unused', () => {
  const bad = [
    { ...grant, task: 'T-0002', requirement: '../outside.md' },
    { ...grant, task: 'T-0002', from: { ...mapping[0], file: '../outside.js' } },
    { ...grant, task: 'T-0002', to: { ...renamed, acceptance: 'AC-999-1' } },
    { ...grant, task: 'T-0002', requirement: 'docs/specs/other.md' },
    { ...grant, task: 42 },
    { ...grant, unexpected: true },
    null,
  ];
  for (const declaration of bad) assert.equal(migrationCase({ declarations: [declaration], maps: mapping }).ok, false, JSON.stringify(declaration));
});
test('duplicate, fan-in, fan-out, reverse and chained migration declarations fail closed', () => {
  const another = { ...mapping[0], name: 'another scenario' };
  const variants = [
    [grant, grant],
    [grant, { ...grant, to: { ...renamed, name: 'second destination' } }],
    [grant, { ...grant, from: another }],
    [grant, { ...grant, from: renamed, to: mapping[0] }],
    [grant, { ...grant, from: renamed, to: { ...renamed, name: 'third destination' } }],
  ];
  for (const declarations of variants) assert.equal(migrationCase({ declarations, old: [mapping[0], another] }).ok, false, JSON.stringify(declarations));
});
test('a consumed grant is inert and its destination remains protected as a baseline mapping', () => {
  assert.equal(migrationCase({ old: [renamed], maps: [renamed] }).ok, true);
  assert.match(migrationCase({ old: [renamed], maps: [mapping[0]] }).errors.join(' '), /removed required mapping/);
  assert.equal(migrationCase({ old: [], maps: [renamed] }).ok, false);
  assert.equal(migrationCase({ old: [mapping[0], renamed], maps: [renamed] }).ok, false);
});
test('enforced mode leaves migrated coverage and execution for code-owner review', () => {
  const result = migrationCase({ enforced: true });
  assert.equal(result.ok, true, result.errors.join(' | '));
  assert.ok(result.unverified.some(x => x.includes('renamed test execution')));
  assert.ok(result.unverified.some(x => x.startsWith('execution:')));
});
