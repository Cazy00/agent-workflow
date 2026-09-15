import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../cli.js', import.meta.url));
const fx = fileURLToPath(new URL('../../fixtures/07-planning-while-blocked/baseline', import.meta.url));
const run = (...args) => spawnSync(process.execPath, [cli, '--repo', fx, '--baseline', fx, '--candidate', fx, ...args], { encoding: 'utf8' });

test('ci exits 0 for a planning-only change while the task is blocked', () => {
  const r = run('ci', '--task', 'T-0001', '--changed', 'docs/workflow/tasks/T-0001.md');
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('ci exits 1 for a production change while the task is blocked', () => {
  const r = run('ci', '--task', 'T-0001', '--changed', 'src/a.ts');
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /D-0001/);
});

test('records exits 0 on valid records and --json prints JSON', () => {
  const r = run('records', '--json');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.doesNotThrow(() => JSON.parse(r.stdout));
});

test('an unknown command exits 2', () => {
  assert.equal(run('bogus').status, 2);
});
