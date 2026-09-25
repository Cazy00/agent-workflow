import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirSource, evaluateReadiness, createEnforcedTrust } from '../lib/index.js';
import { evaluateLifecycle } from '../lib/lifecycle.js';

// Enforced approval mode (POLICY § 7, SCHEMA.md "Approval receipts"): setup verified GitHub protection and
// recorded `enforced` in the baseline's config and profile. The immutable authoritative baseline is then the
// approved baseline; receipt-dependent evidence is listed as unverified for the code-owner review.
const fixture = fileURLToPath(new URL('../../fixtures/04a-accepted-decision-permits/baseline', import.meta.url));
const cli = fileURLToPath(new URL('../cli.js', import.meta.url));
const taskPath = 'docs/workflow/tasks/T-0001.md';
function setup(t, { label = 'enforced', profileLabel = label, decisionOpen = false } = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-enforced-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const repo = path.join(temp, 'project'); fs.cpSync(fixture, repo, { recursive: true });
  const write = (p, text) => { fs.mkdirSync(path.dirname(path.join(repo, p)), { recursive: true }); fs.writeFileSync(path.join(repo, p), text); };
  const edit = (p, fn) => write(p, fn(fs.readFileSync(path.join(repo, p), 'utf8')));
  const git = (...args) => { const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  git('init', '-q'); git('config', 'user.name', 'Test Worker'); git('config', 'user.email', 'worker@example.invalid');
  edit('docs/workflow/config.json', text => { const c = JSON.parse(text); c.approval.label = label; c.repository = 'fixture/project'; return JSON.stringify(c); });
  edit('docs/workflow/profile.md', x => x.replace('approval_label: enforced', `approval_label: ${profileLabel}`));
  if (decisionOpen) edit('docs/workflow/decisions/D-0001.md', x => x.replace('status: Resolved', 'status: Open'));
  git('add', '.'); git('commit', '-qm', 'initial'); const initial = git('rev-parse', 'HEAD');
  edit(taskPath, x => x.replaceAll('fixture-rev', initial));
  git('add', '.'); git('commit', '-qm', 'authorised baseline'); const baseline = git('rev-parse', 'HEAD');
  edit(taskPath, x => x.replace(`governing_baseline_revision: ${initial}`, `governing_baseline_revision: ${baseline}`));
  write('src/a.js', 'export const result = 1;\n');
  git('add', '.'); git('commit', '-qm', 'T-0001: candidate'); const candidate = git('rev-parse', 'HEAD');
  const run = (cmd, { candidate: cand = candidate, args = [] } = {}) => spawnSync(process.execPath, [cli, cmd, '--repo', repo, '--baseline', baseline, '--candidate', cand, '--task', 'T-0001', '--json', ...args], { encoding: 'utf8' });
  return { repo, git, edit, write, baseline, candidate, run };
}

test('enforced mode: readiness, ci and lifecycle pass without receipts and list what the pull request review covers', t => {
  const p = setup(t);
  const readiness = p.run('readiness');
  assert.equal(readiness.status, 0, readiness.stdout + readiness.stderr);
  assert.equal(JSON.parse(readiness.stdout).outcome, 'Ready');
  const ci = p.run('ci');
  assert.equal(ci.status, 0, ci.stdout + ci.stderr);
  const out = JSON.parse(ci.stdout);
  assert.equal(out.verdict, 'pass');
  for (const purpose of ['verification', 'review', 'integration', 'execution']) assert.ok(out.findings.some(f => f.startsWith(`unverified: ${purpose}:`)), `${purpose} listed as unverified: ${out.findings.join(' | ')}`);
  const accept = p.run('lifecycle', { args: ['--stage', 'accept'] });
  assert.equal(accept.status, 0, accept.stdout + accept.stderr);
  assert.ok(JSON.parse(accept.stdout).unverified.some(u => u.startsWith('acceptance:')));
});

test('manual mode still refuses work without owner approval evidence', t => {
  const p = setup(t, { label: 'manual' });
  const r = p.run('readiness');
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /approval evidence/);
});

test('a candidate cannot switch a manual baseline into enforced mode', t => {
  const p = setup(t, { label: 'manual' });
  p.edit('docs/workflow/config.json', text => { const c = JSON.parse(text); c.approval.label = 'enforced'; return JSON.stringify(c); });
  p.edit('docs/workflow/profile.md', x => x.replace('approval_label: manual', 'approval_label: enforced'));
  p.git('add', '.'); p.git('commit', '-qm', 'T-0001: try to relabel');
  const r = p.run('readiness', { candidate: p.git('rev-parse', 'HEAD') });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /approval evidence/);
});

test('enforced mode requires the baseline config and profile to agree', t => {
  const p = setup(t, { label: 'enforced', profileLabel: 'manual' });
  const r = p.run('readiness');
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /approval label differs/);
});

test('enforced mode: a protected-path change is referred to code-owner review instead of failing', t => {
  const p = setup(t);
  p.write('AGENTS.md', '# guide\n');
  p.git('add', '.'); p.git('commit', '-qm', 'T-0001: governing change');
  const r = p.run('ci', { candidate: p.git('rev-parse', 'HEAD') });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.verdict, 'pass');
  assert.ok(out.findings.some(f => f.startsWith('unverified: governing-change:') && f.includes('AGENTS.md')), out.findings.join(' | '));
});

test('enforced mode still refuses hand-picked changed paths', t => {
  const p = setup(t);
  assert.equal(p.run('ci', { args: ['--changed', 'README.md'] }).status, 2);
});

test('supplying the trust options in an enforced project runs the full receipt gate, not a hybrid', t => {
  const p = setup(t);
  const key = path.join(p.repo, '..', 'owner.pem'); fs.writeFileSync(key, '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=\n-----END PUBLIC KEY-----\n');
  const receipts = path.join(p.repo, '..', 'receipts.json'); fs.writeFileSync(receipts, '[]');
  const r = p.run('readiness', { args: ['--trust-key', key, '--receipts', receipts, '--repository', 'fixture/project'] });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /approval evidence/);
});

test('enforced mode still blocks on an open reserved decision', t => {
  const p = setup(t, { decisionOpen: true });
  const r = p.run('readiness');
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.outcome, 'Needs discovery or resolution');
  assert.match(out.reasons.join(' '), /D-0001.*Open/);
  assert.equal(p.run('ci').status, 1);
});

test('a directory baseline never receives enforced trust, even with enforced labels', t => {
  const p = setup(t);
  const r = spawnSync(process.execPath, [cli, 'readiness', '--repo', p.repo, '--baseline', p.repo, '--candidate', p.repo, '--task', 'T-0001', '--json'], { encoding: 'utf8' });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /approval evidence/);
});

test('enforced mode: a verified-complete session must link the evidence it could not verify', t => {
  const p = setup(t);
  const record = path.join(p.repo, '..', 'session.json');
  fs.writeFileSync(record, JSON.stringify({ outcome: 'verified-complete', next_action: 'owner acceptance', friction: 'none' }));
  const bare = p.run('session', { args: ['--record', record] });
  assert.equal(bare.status, 1, bare.stdout + bare.stderr);
  assert.match(bare.stdout, /durable evidence/);
  fs.writeFileSync(record, JSON.stringify({ outcome: 'verified-complete', next_action: 'owner acceptance', friction: 'none', evidence: ['https://github.com/fixture/project/pull/1'] }));
  const linked = p.run('session', { args: ['--record', record] });
  assert.equal(linked.status, 0, linked.stdout + linked.stderr);
  assert.ok(JSON.parse(linked.stdout).unverified.some(u => u.startsWith('review:')));
});

test('enforced trust is bound to the exact baseline and supplies no receipts of its own', () => {
  const src = dirSource(fixture);
  const other = 'f'.repeat(40);
  const unbound = evaluateReadiness({ baseline: src, task: 'T-0001', trust: createEnforcedTrust({ baseline: other }) });
  assert.equal(unbound.outcome, 'Needs discovery or resolution');
  assert.match(unbound.reasons.join(' '), /approval evidence/);
  const task = { owner: 'agent', acceptance: [] };
  const bare = evaluateLifecycle({ candidate: src, task, requiredChecks: ['unit'], trust: createEnforcedTrust({ baseline: other }) });
  assert.deepEqual(bare.errors, []);
  assert.equal(bare.unverified.length, 2);
  assert.equal(createEnforcedTrust({ baseline: other }).claim('review', other), null);
  assert.throws(() => createEnforcedTrust({ baseline: 'main' }), /immutable/);
});
