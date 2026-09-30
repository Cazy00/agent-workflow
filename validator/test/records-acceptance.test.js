// `wf records` checks the acceptance definitions and the test map where they are written (MAINT-0004): setup once
// recorded AC-M1-1, which `wf records` passed and every later `wf ci` would have rejected.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirSource, validateRecords } from '../lib/index.js';
import { evaluateStatus } from '../lib/status.js';

const fixture = fileURLToPath(new URL('../../fixtures/04a-accepted-decision-permits/baseline', import.meta.url));
const cli = fileURLToPath(new URL('../cli.js', import.meta.url));
function project(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-acceptance-files-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.cpSync(fixture, root, { recursive: true });
  const write = (p, value) => fs.writeFileSync(path.join(root, p), typeof value === 'string' ? value : JSON.stringify(value));
  const records = () => validateRecords(dirSource(root), 'docs/workflow');
  return { root, write, records };
}
const definitions = examples => ({ examples });
const example = (id, extra = {}) => ({ id, requirement: 'docs/specs/feature.md', method: 'automated', ...extra });

test('well-formed acceptance files pass, and absent ones are not required here', t => {
  const p = project(t);
  p.write('docs/workflow/acceptance.json', definitions([example('AC-001-1'), example('AC-012-3', { method: 'human' })]));
  p.write('tests/acceptance-map.json', [{ acceptance: 'AC-001-1', file: 'evidence/log.txt', name: 'suite > case' }]);
  assert.deepEqual(p.records().errors, []);
  fs.rmSync(path.join(p.root, 'docs/workflow/acceptance.json')); fs.rmSync(path.join(p.root, 'tests/acceptance-map.json'));
  assert.deepEqual(p.records().errors, []);
});

test('an ID outside AC-NNN-N fails wf records, as it would fail every later wf ci', t => {
  const p = project(t);
  p.write('docs/workflow/acceptance.json', definitions([example('AC-M1-1')]));
  p.write('tests/acceptance-map.json', []);
  const errors = p.records().errors.join('\n');
  assert.match(errors, /AC-M1-1.*must look like AC-001-1/);
  const r = spawnSync(process.execPath, [cli, 'records', '--repo', p.root, '--json'], { encoding: 'utf8' });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /AC-M1-1/);
});

test('duplicates, unknown methods, missing requirements and malformed files are reported', t => {
  const p = project(t);
  p.write('docs/workflow/acceptance.json', definitions([example('AC-001-1'), example('AC-001-1'), example('AC-001-2', { method: 'vibes' }), example('AC-001-3', { requirement: 'docs/specs/missing.md' })]));
  p.write('tests/acceptance-map.json', []);
  const errors = p.records().errors.join('\n');
  assert.match(errors, /duplicate id AC-001-1/);
  assert.match(errors, /AC-001-2 method/);
  assert.match(errors, /AC-001-3 requirement/);
  p.write('docs/workflow/acceptance.json', '{ not json');
  assert.match(p.records().errors.join('\n'), /acceptance\.json: invalid JSON/);
  p.write('docs/workflow/acceptance.json', { examples: 'AC-001-1' });
  assert.match(p.records().errors.join('\n'), /examples must be an array/);
});

test('a mapping must name a defined ID, an existing test file and a test name, once', t => {
  const p = project(t);
  p.write('docs/workflow/acceptance.json', definitions([example('AC-001-1')]));
  const good = { acceptance: 'AC-001-1', file: 'evidence/log.txt', name: 'case' };
  p.write('tests/acceptance-map.json', [good, good, { acceptance: 'AC-009-9', file: 'evidence/log.txt', name: 'x' }, { acceptance: 'AC-001-1', file: 'tests/nowhere.js', name: '' }]);
  const errors = p.records().errors.join('\n');
  assert.match(errors, /\[1\]: duplicate mapping/);
  assert.match(errors, /AC-009-9.*is not defined/);
  assert.match(errors, /tests\/nowhere\.js.*is not in this revision/);
  assert.match(errors, /needs the test's full name/);
  p.write('tests/acceptance-map.json', { acceptance: 'AC-001-1' });
  assert.match(p.records().errors.join('\n'), /must be an array/);
});

test('the owner status view shows acceptance file errors with the other record errors', t => {
  const p = project(t);
  p.write('docs/workflow/acceptance.json', definitions([example('AC-M1-1')]));
  const view = evaluateStatus({ baseline: dirSource(p.root) });
  assert.ok(view.record_errors.some(e => /AC-M1-1/.test(e)));
});

test('a milestone may choose task or milestone signing, nothing else', t => {
  const p = project(t);
  const file = path.join(p.root, 'docs/workflow/milestones/M-0001.md');
  const original = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, original.replace('status: Authorised', 'status: Authorised\nsigning: milestone'));
  assert.deepEqual(p.records().errors, []);
  fs.writeFileSync(file, original.replace('status: Authorised', 'status: Authorised\nsigning: never'));
  assert.match(p.records().errors.join('\n'), /signing must be one of task, milestone/);
});
