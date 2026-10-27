import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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

// MAINT-0023 P9: `wf --help` and `wf <command> --help` print the usage, which names every command.
test('wf --help and wf <command> --help print the usage and exit 0', () => {
  for (const args of [['--help'], ['-h'], ['session', '--help'], ['records', '-h']]) {
    const r = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${args}: ${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /^usage: wf </, args.join(' '));
    assert.equal(r.stderr, '');
  }
  assert.equal(spawnSync(process.execPath, [cli, 'bogus', '--help'], { encoding: 'utf8' }).status, 2);
});

test('the usage has a line for session, records, readiness, lifecycle and acceptance', () => {
  const { stdout } = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8' });
  for (const cmd of ['session', 'records', 'readiness', 'lifecycle', 'acceptance']) assert.match(stdout, new RegExp(`^  ${cmd}\\b[^\\n]*:`, 'm'), cmd);
  assert.match(stdout, /^  session --record PATH/m);
  assert.match(stdout, /templates\/session\.json/);
});

test('wf session errors name what it accepts', () => {
  const noRecord = run('session', '--task', 'T-0001');
  assert.equal(noRecord.status, 2);
  assert.match(noRecord.stderr, /session needs --record PATH.*templates\/session\.json.*--task T-0001/);
  const missing = run('session', '--task', 'T-0001', '--record', '/nonexistent/session.json');
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /session --record \/nonexistent\/session\.json cannot be read.*templates\/session\.json/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-cli-'));
  try {
    const bad = path.join(dir, 'bad.json'); fs.writeFileSync(bad, '{ not json');
    const r = run('session', '--task', 'T-0001', '--record', bad);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /cannot be read as JSON.*templates\/session\.json/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
