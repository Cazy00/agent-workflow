import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { fakeExecutable } from './helpers.js';
const fixture = fileURLToPath(new URL('../../fixtures/04a-accepted-decision-permits/baseline', import.meta.url));
const cli = fileURLToPath(new URL('../cli.js', import.meta.url));
function setup(t, { eligible = true, enabled = true, blocked = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-delegation-cli-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, 'repo'); fs.cpSync(fixture, repo, { recursive: true });
  const write = (p, s) => { fs.mkdirSync(path.dirname(path.join(repo, p)), { recursive: true }); fs.writeFileSync(path.join(repo, p), s); };
  const edit = (p, fn) => write(p, fn(fs.readFileSync(path.join(repo, p), 'utf8')));
  const git = (...args) => { const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  if (blocked) edit('docs/workflow/decisions/D-0001.md', x => x.replace('status: Resolved', 'status: Open'));
  const routine = { enabled, paths: [eligible ? 'src/ui/**' : 'src/other/**'], reserved_paths: ['src/auth/**'], max_files: 5, max_changed_lines: 100, evidence_assurance: 'agent-attested' };
  edit('docs/workflow/config.json', x => JSON.stringify({ ...JSON.parse(x), repository: 'fixture/project', trusted_branch: 'main', delegation: { routine } }));
  const taskPath = 'docs/workflow/tasks/T-0001.md';
  edit(taskPath, x => x.replace('scope: [src, docs/workflow/tasks]', 'scope: [src/ui]').replace('decisions: [D-0001]', 'decisions: []'));
  git('init', '-q'); git('config', 'user.name', 'agent'); git('config', 'user.email', 'agent@example.invalid'); git('add', '.'); git('commit', '-qm', 'initial');
  edit(taskPath, x => x.replaceAll('fixture-rev', git('rev-parse', 'HEAD')));
  git('add', '.'); git('commit', '-qm', 'baseline'); const baseline = git('rev-parse', 'HEAD');
  edit(taskPath, x => x.replace(/governing_baseline_revision: .*/, `governing_baseline_revision: ${baseline}`));
  write('src/ui/StatusBadge.js', 'export const label = "Ready";\n');
  git('add', '.'); git('commit', '-qm', 'T-0001 candidate'); const candidate = git('rev-parse', 'HEAD');
  const checks = { revision: candidate, environment: 'isolated fixture', checks: [{ name: 'unit', result: 'passed', reference: 'https://github.com/fixture/project/actions/runs/1' }] };
  const evidence = { schema: 'agent-workflow/delivery-evidence@1', candidate, assurance: 'agent-attested', tasks: ['T-0001'], verification: checks, integration: checks, review: { reviewer: 'reviewer', implementer: 'agent', separate_context: true, context: { provider: 'fixture', context_id: 'separate-1', inherited_context: false, candidate, launch_evidence: 'https://github.com/fixture/project/pull/1#issuecomment-1' }, coverage: ['scope', 'correctness', 'maintainability', 'security', 'regression', 'test-fidelity'], findings: [], tasks: ['T-0001'], report: 'https://github.com/fixture/project/pull/1#issuecomment-2' } };
  const evidenceFile = path.join(root, 'evidence.json');
  const saveEvidence = value => fs.writeFileSync(evidenceFile, JSON.stringify(value)); saveEvidence(evidence);
  const stateFile = path.join(root, 'github.json');
  const state = { pr: { number: 1, state: 'open', draft: false, head: { sha: candidate, repo: { full_name: 'fixture/project' } }, base: { sha: baseline, ref: 'main', repo: { full_name: 'fixture/project' } }, updated_at: '2026-09-30T00:00:00Z' }, reviews: [], comments: [] };
  const saveGithub = () => fs.writeFileSync(stateFile, JSON.stringify(state)); saveGithub();
  const fakeGh = path.join(root, 'gh');
  fakeExecutable(fakeGh, `const fs=require('fs');const s=JSON.parse(fs.readFileSync(process.env.WF_TEST_GITHUB));const e=process.argv.at(-1);process.stdout.write(JSON.stringify(e.includes('/reviews?')?s.reviews:e.includes('/comments?')?s.comments:s.pr));\n`);
  const run = (args = []) => spawnSync(process.execPath, [cli, 'ci', '--repo', repo, '--baseline', baseline, '--candidate', git('rev-parse', 'HEAD'), '--task', 'T-0001', '--json', ...args], { encoding: 'utf8', env: { ...process.env, PATH: `${root}${path.delimiter}${process.env.PATH}`, WF_TEST_GITHUB: stateFile } });
  return { repo, root, git, edit, baseline, candidate, evidence, evidenceFile, saveEvidence, state, saveGithub, run };
}
test('real Git diff plus complete external evidence enables only the opted-in routine lane', t => {
  const p = setup(t);
  assert.equal(p.run().status, 1, 'missing evidence is blocked');
  const r = p.run(['--delivery-evidence', p.evidenceFile]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.equal(JSON.parse(r.stdout).delegation.approval_basis, 'delegated-routine');
  assert.match(r.stdout, /agent-attested and unauthenticated/);
  assert.equal(p.run(['--owner-approved', 'true']).status, 2);
  assert.equal(p.run(['--changed', 'README.md', '--delivery-evidence', p.evidenceFile]).status, 2);
});
test('GitHub worker comment supplies data, while forged owner fields or inherited review context cannot pass', t => {
  const p = setup(t);
  const post = value => { p.state.comments = [{ id: 3, user: { login: 'agent' }, body: '<!-- agent-workflow:delivery-evidence@1 -->\n' + JSON.stringify(value) }]; p.saveGithub(); };
  post(p.evidence);
  const r = p.run(['--pull-request', '1']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(JSON.parse(r.stdout).delegation.evidence_source, /issuecomment-3$/);
  post({ ...p.evidence, owner_approved: true });
  assert.equal(p.run(['--pull-request', '1']).status, 1);
  post({ ...p.evidence, review: { ...p.evidence.review, context: { ...p.evidence.review.context, inherited_context: true } } });
  assert.equal(p.run(['--pull-request', '1']).status, 1);
});
test('an ineligible candidate needs actual exact-head owner approval; worker approval cannot substitute', t => {
  const p = setup(t, { eligible: false });
  assert.equal(p.run(['--delivery-evidence', p.evidenceFile]).status, 1);
  p.state.reviews = [{ id: 10, user: { login: 'agent' }, state: 'APPROVED', commit_id: p.candidate, submitted_at: '2026-09-30T00:00:00Z' }]; p.saveGithub();
  assert.equal(p.run(['--pull-request', '1']).status, 1);
  p.state.reviews[0].user.login = 'owner'; p.saveGithub();
  const r = p.run(['--pull-request', '1']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(JSON.parse(r.stdout).delegation.approval_basis, 'owner-review');
  p.state.reviews[0].state = 'DISMISSED'; p.saveGithub();
  assert.equal(p.run(['--pull-request', '1']).status, 1);
});
test('a post-review commit invalidates external evidence and authenticated approval', t => {
  const p = setup(t);
  p.edit('src/ui/StatusBadge.js', x => x + 'export const other = 2;\n'); p.git('add', '.'); p.git('commit', '-qm', 'T-0001 changed');
  assert.equal(p.run(['--delivery-evidence', p.evidenceFile]).status, 1);
  assert.equal(p.run(['--pull-request', '1']).status, 2, 'PR head no longer matches candidate');
});
test('candidate opt-in has no effect on a baseline where delegation is off', t => {
  const p = setup(t, { enabled: false });
  p.edit('docs/workflow/config.json', x => { const c = JSON.parse(x); c.delegation.routine.enabled = true; return JSON.stringify(c); }); p.git('add', '.'); p.git('commit', '-qm', 'T-0001 candidate opt-in');
  const r = p.run();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(JSON.parse(r.stdout).delegation, undefined);
  assert.match(r.stdout, /workflow-change.*code-owner review/, 'still needs existing protected approval');
});

test('owner approval cannot override a still-open governing decision', t => {
  const p = setup(t, { blocked: true });
  p.state.reviews = [{ id: 10, user: { login: 'owner' }, state: 'APPROVED', commit_id: p.candidate, submitted_at: '2026-09-30T00:00:00Z' }]; p.saveGithub();
  const r = p.run(['--pull-request', '1']);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /D-0001.*Open/);
});

test('file size and binary limits come from the actual Git diff, not evidence fields', t => {
  const p = setup(t);
  p.edit('src/ui/StatusBadge.js', () => 'export const label = "Ready";\n' + '// padding\n'.repeat(120)); p.git('add', '.'); p.git('commit', '-qm', 'T-0001 large');
  let revision = p.git('rev-parse', 'HEAD');
  p.saveEvidence(JSON.parse(JSON.stringify(p.evidence).replaceAll(p.candidate, revision)));
  const large = p.run(['--delivery-evidence', p.evidenceFile]);
  assert.equal(large.status, 1);
  assert.match(large.stdout, /exceed max_changed_lines/);
  p.edit('src/ui/StatusBadge.js', () => Buffer.from([0, 1, 2, 3])); p.git('add', '.'); p.git('commit', '-qm', 'T-0001 binary');
  revision = p.git('rev-parse', 'HEAD');
  p.saveEvidence(JSON.parse(JSON.stringify(p.evidence).replaceAll(p.candidate, revision)));
  const binary = p.run(['--delivery-evidence', p.evidenceFile]);
  assert.equal(binary.status, 1);
  assert.match(binary.stdout, /binary or unmeasured/);
});
