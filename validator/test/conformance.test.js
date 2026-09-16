import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirSource, gitSource, evaluateReadiness, evaluateCi } from '../lib/index.js';

const fixture = fileURLToPath(new URL('../../fixtures/04a-accepted-decision-permits/baseline', import.meta.url));
const cli = fileURLToPath(new URL('../cli.js', import.meta.url));
function project(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-conformance-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.cpSync(fixture, root, { recursive: true });
  const edit = (file, fn) => fs.writeFileSync(path.join(root, file), fn(fs.readFileSync(path.join(root, file), 'utf8')));
  const run = (...args) => { const r = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  return { root, edit, run, source: dirSource(root) };
}
const taskPath = 'docs/workflow/tasks/T-0001.md';
const decisionPath = 'docs/workflow/decisions/D-0001.md';

test('a Resolved baseline without approval evidence cannot authorise work', (t) => {
  const p = project(t);
  const r = evaluateReadiness({ baseline: p.source, task: 'T-0001' });
  assert.equal(r.outcome, 'Needs discovery or resolution');
  assert.match(r.reasons.join(' '), /approval/i);
});

test('path-scoped unresolved decisions block even if omitted from task decisions', (t) => {
  const p = project(t);
  p.edit(taskPath, x => x.replace('decisions: [D-0001]', 'decisions: []') + '\n');
  p.edit(taskPath, x => x.replace('scope: [src, docs/workflow/tasks]', 'scope: [src/payments]'));
  p.edit(decisionPath, x => x.replace('affects: [T-0001]', 'affects: [paths:src/payments]').replace('status: Resolved', 'status: Open'));
  const r = evaluateReadiness({ baseline: p.source, task: 'T-0001' });
  assert.match(r.reasons.join(' '), /D-0001.*Open/);
});

test('invalid profile and decision records fail readiness', (t) => {
  const p = project(t);
  p.edit('docs/workflow/profile.md', x => x.replace('coordinator: owner', 'coordinator:'));
  p.edit(decisionPath, x => x.replace('owner: owner', 'owner:'));
  const r = evaluateReadiness({ baseline: p.source, task: 'T-0001' });
  assert.match(r.reasons.join(' '), /profile.*missing coordinator/);
  assert.match(r.reasons.join(' '), /D-0001.*missing owner/);
});

test('superseded decisions cannot be used only through prerequisites', (t) => {
  const p = project(t);
  p.edit(taskPath, x => x.replace('decisions: [D-0001]', 'decisions: []').replace('prerequisites: []', 'prerequisites: [D-0001]'));
  p.edit(decisionPath, x => x.replace('affects: [T-0001]', 'affects: []').replace('supersedes:', 'superseded_by: D-0002\nsupersedes:'));
  const r = evaluateReadiness({ baseline: p.source, task: 'T-0001' });
  assert.match(r.reasons.join(' '), /superseded/);
});

test('generated artifacts cannot bypass production gates', (t) => {
  const p = project(t);
  p.edit('docs/workflow/config.json', x => { const c = JSON.parse(x); c.paths.generated = [{ pattern: 'out/**', producer: 'build' }]; return JSON.stringify(c); });
  p.edit(taskPath, x => x.replace('status: Ready', 'status: Blocked\nresume_condition: owner decision'));
  const r = evaluateCi({ baseline: p.source, task: 'T-0001', changed: ['out/client.wasm'] });
  assert.equal(r.verdict, 'fail');
});

test('gitSource lists nested records and pins a symbolic revision once', (t) => {
  const p = project(t);
  p.run('init', '-q'); p.run('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'add', '.');
  p.run('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'baseline');
  const sha = p.run('rev-parse', 'HEAD');
  const source = gitSource(p.root, 'HEAD');
  assert.deepEqual(source.list('docs/workflow/decisions'), [decisionPath]);
  assert.equal(source.name, sha);
  p.edit(decisionPath, x => x.replace('status: Resolved', 'status: Open'));
  p.run('add', '.'); p.run('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'changed');
  assert.match(source.read(decisionPath), /status: Resolved/);
});

test('CLI refuses a failed git diff instead of approving an empty change', (t) => {
  const p = project(t);
  const r = spawnSync(process.execPath, [cli, 'ci', '--repo', p.root, '--baseline', p.root, '--base', 'not-a-revision', '--head', 'also-invalid', '--json'], { encoding: 'utf8' });
  assert.equal(r.status, 2, r.stdout + r.stderr);
});

test('directory sources cannot read outside their root', (t) => {
  const p = project(t);
  assert.throws(() => p.source.read('../outside'), /path|outside/i);
});

import { fixtureTrust } from './helpers.js';
test('task needs a milestone, scope, acceptance, start and feature verification context', (t) => {
  const p = project(t);
  p.edit(taskPath, x => x.replace(/^(milestone|scope|acceptance|start_revision|feature_readiness|verification|review):.*\n/gm, ''));
  const r = evaluateReadiness({ baseline: p.source, trust: fixtureTrust(p.source), task: 'T-0001' });
  assert.equal(r.outcome, 'Needs discovery or resolution');
  for (const field of ['milestone', 'scope', 'acceptance', 'start_revision', 'feature_readiness', 'verification', 'review']) assert.match(r.reasons.join(' '), new RegExp(field));
});
test('candidate cannot drop trusted task prerequisites or deferred inputs', (t) => {
  const p = project(t);
  p.edit(taskPath, x => x.replace('prerequisites: []', 'prerequisites: [D-0001]').replace('deferred_inputs: []', 'deferred_inputs: [D-0001@verify]'));
  const dir = path.join(p.root, 'candidate'); fs.cpSync(fixture, dir, { recursive: true });
  const r = evaluateReadiness({ baseline: p.source, candidate: dirSource(dir), trust: fixtureTrust(p.source), task: 'T-0001' });
  assert.match(r.reasons.join(' '), /removed.*prerequisites/);
  assert.match(r.reasons.join(' '), /removed.*deferred_inputs/);
});
test('candidate cannot move the task backwards to avoid a stage gate', (t) => {
  const p = project(t);
  p.edit(taskPath, x => x.replace('implemented: ', 'implemented: 2026-09-16'));
  p.edit(decisionPath, x => x.replace('status: Resolved', 'status: Open').replace('required_before: implement', 'required_before: verify'));
  const dir = path.join(p.root, 'candidate'); fs.cpSync(fixture, dir, { recursive: true });
  const r = evaluateReadiness({ baseline: p.source, candidate: dirSource(dir), trust: fixtureTrust(p.source), task: 'T-0001' });
  assert.equal(r.stage, 'verify');
  assert.match(r.reasons.join(' '), /D-0001.*Open/);
});
test('CI requires candidate verification and independent review, not readiness alone', (t) => {
  const p = project(t);
  const r = evaluateCi({ baseline: p.source, task: 'T-0001', changed: ['src/a.ts'], trust: fixtureTrust(p.source) });
  assert.equal(r.verdict, 'fail');
  assert.match(r.findings.join(' '), /verification|independent review/);
});
test('candidate enforcement changes require a separate workflow-change receipt', (t) => {
  const p = project(t);
  const r = evaluateCi({ baseline: p.source, changed: ['.github/workflows/ci.yml'], trust: fixtureTrust(p.source) });
  assert.equal(r.verdict, 'fail');
  assert.match(r.findings.join(' '), /approval/);
});
test('candidate cannot evade a feature-scoped decision by renaming its feature', (t) => {
  const p = project(t);
  p.edit(taskPath, x => x.replace('record: task', 'record: task\nfeature: payments').replace('decisions: [D-0001]', 'decisions: []'));
  p.edit(decisionPath, x => x.replace('affects: [T-0001]', 'affects: [payments]').replace('status: Resolved', 'status: Open'));
  const dir = path.join(p.root, 'candidate'); fs.cpSync(fixture, dir, { recursive: true });
  fs.writeFileSync(path.join(dir, taskPath), fs.readFileSync(path.join(p.root, taskPath), 'utf8').replace('feature: payments', 'feature: dashboard'));
  const r = evaluateReadiness({ baseline: p.source, candidate: dirSource(dir), trust: fixtureTrust(p.source), task: 'T-0001' });
  assert.match(r.reasons.join(' '), /feature.*changed/);
});
