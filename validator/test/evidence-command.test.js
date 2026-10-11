import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DELIVERY_MARKER, parseDeliveryEvidence } from '../lib/delivery-evidence.js';

// MAINT-0016: `wf evidence` starts the delivery evidence with what the validator can derive, so the agent writes only what
// it ran and what the review found, and carries an earlier review and verification over a clean merge.
const fixture = fileURLToPath(new URL('../../fixtures/04a-accepted-decision-permits/baseline', import.meta.url));
const cli = fileURLToPath(new URL('../cli.js', import.meta.url));
function repo(t, { approval = {}, label = 'enforced' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-evidence-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.cpSync(fixture, dir, { recursive: true });
  const cfg = path.join(dir, 'docs/workflow/config.json'), profile = path.join(dir, 'docs/workflow/profile.md');
  const c = JSON.parse(fs.readFileSync(cfg, 'utf8')); c.approval = { ...c.approval, label, mechanism: label === 'enforced' ? c.approval.mechanism : label, ...approval };
  fs.writeFileSync(cfg, JSON.stringify(c));
  fs.writeFileSync(profile, fs.readFileSync(profile, 'utf8').replace(/^approval_label: .*$/m, `approval_label: ${label}`));
  fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'tests/acceptance-map.json'), JSON.stringify([{ acceptance: 'AC-001-1', file: 'tests/a.test.js', name: 'works' }, { acceptance: 'AC-009-1', file: 'tests/z.test.js', name: 'other' }]));
  const git = (...args) => { const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  git('init', '-q', '-b', 'main'); git('config', 'user.name', 'T'); git('config', 'user.email', 't@example.invalid');
  git('add', '-A'); git('commit', '-qm', 'base'); const base = git('rev-parse', 'HEAD');
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true }); fs.writeFileSync(path.join(dir, 'src/a.js'), 'export const a = 1;\n');
  git('add', '-A'); git('commit', '-qm', 'T-0001: work'); const candidate = git('rev-parse', 'HEAD');
  const evidence = (baseline, rev, ...extra) => {
    const r = spawnSync(process.execPath, [cli, 'evidence', '--repo', dir, '--baseline', baseline, '--candidate', rev, '--task', 'T-0001', ...extra], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(r.stdout.startsWith(DELIVERY_MARKER), r.stdout);
    return { evidence: parseDeliveryEvidence(r.stdout), stderr: r.stderr };
  };
  return { dir, git, base, candidate, evidence };
}

test('the evidence names the candidate, the task, the profile\'s required checks and the task\'s mapped tests', t => {
  const r = repo(t);
  const { evidence: e } = r.evidence(r.base, r.candidate);
  assert.equal(e.candidate, r.candidate);
  assert.deepEqual(e.tasks, ['T-0001']);
  assert.deepEqual(e.integration.checks.map(c => [c.name, c.result]), [['unit', 'passed']]);
  assert.deepEqual(e.verification.execution.tests, [{ file: 'tests/a.test.js', name: 'works', status: '' }]);
  assert.equal(e.review.implementer, 'agent');
});

test('under auto_merge the required checks are enforced, and verification keeps a line for a check the agent ran', t => {
  const r = repo(t, { label: 'owner-merge', approval: { checkpoint: 'milestone', auto_merge: true } });
  const { evidence: e } = r.evidence(r.base, r.candidate);
  assert.deepEqual(e.integration.checks.map(c => [c.name, c.result]), [['unit', 'enforced']]);
  assert.ok(e.verification.checks.some(c => c.result === 'passed'));
});

test('an earlier review and verification carry over a merge of the trusted branch, with a note', t => {
  const r = repo(t);
  const { evidence: first } = r.evidence(r.base, r.candidate);
  first.review.reviewer = 'independent-reviewer'; first.verification.environment = 'macOS, node 22';
  const prev = path.join(r.dir, '.git', 'previous-evidence.json'); fs.writeFileSync(prev, JSON.stringify(first));
  r.git('branch', 'task'); r.git('reset', '-q', '--hard', r.base);
  fs.mkdirSync(path.join(r.dir, 'src'), { recursive: true }); fs.writeFileSync(path.join(r.dir, 'src/b.js'), 'export const b = 2;\n');
  r.git('add', '-A'); r.git('commit', '-qm', 'another change merges'); const main = r.git('rev-parse', 'HEAD');
  r.git('switch', '-q', 'task'); r.git('merge', '-q', '--no-edit', main); const head = r.git('rev-parse', 'HEAD');
  const { evidence: e, stderr } = r.evidence(main, head, '--from', prev);
  assert.equal(e.candidate, head);
  assert.deepEqual([e.review.reviewer, e.verification.environment, e.integration.revision], ['independent-reviewer', 'macOS, node 22', head]);
  assert.match(stderr, /the review of [0-9a-f]{12} carries over/);
});
